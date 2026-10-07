import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {features,featureNames,labels,actors,actions} from './learning-features.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const matches=[],rows=[];
const sessions=await readdir(path.join(root,'recordings/matches')).catch(error=>{
  if(error.code==='ENOENT')throw new Error('No practice matches have been recorded yet. Play manually before training.');
  throw error;
});
for(const session of sessions) {
  for(const file of (await readdir(path.join(root,'recordings/matches',session))).filter(f=>f.endsWith('.jsonl')).sort()) {
    const relative=path.join('recordings/matches',session,file);
    const events=(await readFile(path.join(root,relative),'utf8')).trim().split('\n').map(JSON.parse);
    const start=events.find(e=>e.type==='start'),end=events.find(e=>e.type==='end');
    const samples=events.filter(e=>e.type==='sample'&&e.controller==='human').map(e=>e.state);
    if(!start||samples.length<10)continue;
    const id=relative.replaceAll('\\','/');
    const match={id,arena:start.arena,completed:Boolean(end?.completed),won:end?.completed?end.winner===0:null,samples:samples.length,rows:0};
    matches.push(match);
    for(let i=1;i<samples.length-1;i++) {
      const state=samples[i],next=samples[i+1],dt=next.timeMs-state.timeMs,{me,enemy}=actors(state);
      if(!state.ready||state.roundOver||!me||!enemy||me.hp<=0||dt<15||dt>250||next.roundOver)continue;
      const x=features(state,samples[i-1]);
      // Weight successful demonstrations; retain losses for recovery situations.
      const weight=match.won===true?1:match.won===false?.65:.5;
      rows.push({match:id,x,y:labels(next),weight});match.rows++;
    }
  }
}
if(matches.length<2||rows.length<100)throw new Error('Record at least two useful manual practice matches before training. More matches across all arenas are recommended.');
await mkdir(path.join(root,'models'),{recursive:true});
await mkdir(path.join(root,'tools/training'),{recursive:true});
await writeFile(path.join(root,'tools/training/dataset.json'),JSON.stringify({featureNames,actions,matches,rows}));
console.log(JSON.stringify({matches:matches.length,rows:rows.length,arenas:[...new Set(matches.map(m=>m.arena))].sort(),wins:matches.filter(m=>m.won).length}));
