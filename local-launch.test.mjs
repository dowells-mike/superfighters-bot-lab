import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startOrReuse } from './local-launch.mjs';

async function close(server) {
  server.closeIdleConnections();
  await new Promise(resolve=>server.close(resolve));
}

test('repeat launch activates the existing instance and preserves its server',async()=>{
  let activations=0;
  const first=await startOrReuse(0,{onActivate:async()=>{activations++;}});
  try {
    assert.equal(first.existing,false);
    const second=await startOrReuse(Number(new URL(first.url).port));
    assert.equal(second.existing,true);
    assert.equal(second.activated,true);
    assert.equal(second.server,undefined);
    assert.equal(activations,1);
    assert.equal((await fetch(first.url)).status,200);
    assert.equal((await fetch(`${first.url}/__lab/activate`,{method:'POST'})).status,403);
  } finally {await close(first.server);}
});

test('earlier launcher is recognized without crashing or replacing it',async()=>{
  const legacy=http.createServer((req,res)=>{
    if(req.url==='/__lab/status') {res.writeHead(404);res.end();}
    else {res.writeHead(200);res.end('<title>Superfighters Bot Lab</title><script src="/lab.mjs"></script>');}
  });
  await new Promise(resolve=>legacy.listen(0,'127.0.0.1',resolve));
  try {
    const result=await startOrReuse(legacy.address().port);
    assert.equal(result.existing,true);
    assert.equal(result.legacy,true);
    assert.equal(result.activated,false);
  } finally {await close(legacy);}
});

test('unrelated server gives a clear conflict error and is left running',async()=>{
  const other=http.createServer((req,res)=>{res.writeHead(200);res.end('An unrelated application');});
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  try {
    await assert.rejects(()=>startOrReuse(other.address().port),/Another application is using/);
    assert.equal(await (await fetch(`http://127.0.0.1:${other.address().port}`)).text(),'An unrelated application');
  } finally {await close(other);}
});

test('closing the instance frees its address for the next launch',async()=>{
  const first=await startOrReuse(0);
  const port=first.server.address().port;
  await close(first.server);
  const next=await startOrReuse(port);
  try {assert.equal(next.existing,false);} finally {await close(next.server);}
});
