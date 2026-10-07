import { mkdir, appendFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export function createRecordingStore(directory) {
  const writes=new Map();
  const lastSequences=new Map();
  return async payload=>{
    if(payload?.kind==='snapshot') {
      if(!payload.state?.bridgeVersion||!Array.isArray(payload.state.players)) throw new Error('Invalid snapshot');
      await mkdir(path.join(directory,'snapshots'),{recursive:true});
      const name=`snapshot-${new Date().toISOString().replaceAll(':','-')}-${crypto.randomUUID()}.json`;
      await writeFile(path.join(directory,'snapshots',name),JSON.stringify(payload.state,null,2));
      return {saved:true,file:`snapshots/${name}`};
    }
    if(payload?.version!==1||!/^[a-f0-9-]{36}$/i.test(payload.sessionId)||!Number.isSafeInteger(payload.roundId)||payload.roundId<1||!Array.isArray(payload.events)||payload.events.length<1||payload.events.length>16)
      throw new Error('Invalid recording batch');
    for(const event of payload.events) {
      if(!event||!['start','sample','key','end'].includes(event.type)||!Number.isSafeInteger(event.sequence)||event.sequence<0) throw new Error('Invalid recording event');
    }
    for(let i=1;i<payload.events.length;i++)if(payload.events[i].sequence<=payload.events[i-1].sequence)throw new Error('Recording events must be ordered');
    const relative=`matches/${payload.sessionId}/round-${String(payload.roundId).padStart(4,'0')}.jsonl`;
    const filename=path.join(directory,relative);
    const previous=writes.get(filename)??Promise.resolve();
    const job=previous.catch(()=>{}).then(async()=>{
      await mkdir(path.dirname(filename),{recursive:true});
      if(!lastSequences.has(filename)) {
        let last=-1;
        try {for(const line of (await readFile(filename,'utf8')).trim().split('\n'))last=Math.max(last,JSON.parse(line).sequence);} catch(error) {if(error.code!=='ENOENT')throw error;}
        lastSequences.set(filename,last);
      }
      const fresh=payload.events.filter(event=>event.sequence>lastSequences.get(filename));
      if(fresh.length) {
        await appendFile(filename,fresh.map(event=>JSON.stringify({...event,sessionId:payload.sessionId,roundId:payload.roundId})).join('\n')+'\n');
        lastSequences.set(filename,fresh.at(-1).sequence);
      }
    });
    writes.set(filename,job);
    try {await job;} finally {if(writes.get(filename)===job) writes.delete(filename);}
    return {saved:true,file:relative,events:payload.events.length};
  };
}
