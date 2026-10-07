import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRecordingStore } from './recording-store.mjs';
import { MatchRecorder } from './match-recorder.mjs';
const sessionId='a4c3be30-1e60-4ac4-bb28-11341b6f80b2';

test('recordings survive retries and server restarts without duplicated frames',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sf-recording-test-'));
  try {
    const batch={version:1,sessionId,roundId:2,events:[{type:'start',sequence:0},{type:'sample',sequence:1,state:{playerInput:[71]}}]};
    const save=createRecordingStore(dir);
    await save(batch);await save(batch);
    await createRecordingStore(dir)(batch);
    const file=path.join(dir,`matches/${sessionId}/round-0002.jsonl`);
    const events=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.length,2);assert.deepEqual(events[1].state.playerInput,[71]);
    await assert.rejects(()=>save({...batch,sessionId:'../../outside'}),/Invalid recording batch/);
    await assert.rejects(()=>save({...batch,events:[{type:'sample',sequence:5},{type:'sample',sequence:4}]}),/ordered/);
  } finally {
    const resolved=path.resolve(dir);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('sf-recording-test-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

test('completed rounds and interrupted restarts are distinguished',async()=>{
  const sent=[];const persisted=new Map();
  const recorder=new MatchRecorder({send:async batch=>sent.push(batch),storage:{getItem:key=>persisted.get(key),setItem:(key,value)=>persisted.set(key,value)}});
  clearInterval(recorder.timer);
  try {
    const state={roundId:1,map:2,menuDemo:false,roundOver:false,keys:[[82,71]],difficulties:[0,3],playerInput:[71],timeMs:100};
    recorder.observe(state,'human');
    recorder.key({phase:'down',keyCode:71,gameTimeMs:100});
    recorder.observe({...state,roundOver:true,soloWinner:0,timeMs:200});
    while(recorder.saving)await new Promise(resolve=>setTimeout(resolve,1));
    while(recorder.queue.length)await recorder.flush();
    recorder.observe({...state,roundId:2,timeMs:250});
    recorder.observe({...state,roundId:3,timeMs:300});
    while(recorder.saving)await new Promise(resolve=>setTimeout(resolve,1));
    while(recorder.queue.length)await recorder.flush();
    const events=sent.flatMap(batch=>batch.events);
    const ends=events.filter(event=>event.type==='end');
    assert.equal(ends[0].completed,true);assert.equal(ends[0].winner,0);
    assert.equal(ends[1].completed,false);assert.equal(ends[1].reason,'restarted-before-round-ended');
    assert.ok(events.some(event=>event.type==='key'&&event.keyCode===71));
    assert.ok(events.some(event=>event.type==='sample'&&event.controller==='human'));
  } finally {await recorder.dispose();}
});

test('failed uploads stay buffered and are replayed after reopening',async()=>{
  const persisted=new Map();const storage={getItem:key=>persisted.get(key),setItem:(key,value)=>persisted.set(key,value)};
  const first=new MatchRecorder({storage,send:async()=>{throw new Error('connection lost');}});
  clearInterval(first.timer);
  first.observe({roundId:7,map:3,menuDemo:false,roundOver:false});
  await first.flush();assert.equal(first.queue.length,2);
  await first.dispose();
  const sent=[];
  const second=new MatchRecorder({storage,send:async batch=>sent.push(batch)});
  clearInterval(second.timer);
  try {await second.flush();assert.equal(second.queue.length,0);assert.equal(sent[0].sessionId,first.sessionId);}
  finally {await second.dispose();}
});
