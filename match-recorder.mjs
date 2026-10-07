export class MatchRecorder {
  constructor({send,storage,onStatus=()=>{}}) {
    this.send=send;this.storage=storage;this.onStatus=onStatus;
    this.sessionId=crypto.randomUUID();this.sequence=0;this.active=null;this.saving=false;this.problem=null;
    try {this.queue=JSON.parse(storage?.getItem('sfRecordingOutbox')??'[]');} catch {this.queue=[];}
    this.timer=setInterval(()=>this.flush(),500);
  }
  persist() {
    try {this.storage?.setItem('sfRecordingOutbox',JSON.stringify(this.queue));}
    catch {this.problem='Recording buffer could not be saved. Keep the game open while it retries.';}
  }
  enqueue(event) {
    if(!this.active)return;
    this.queue.push({sessionId:this.sessionId,roundId:this.active.roundId,event:{...event,sequence:this.sequence++,recordedAt:new Date().toISOString()}});
    this.persist();
    if(this.queue.length>=8)this.flush();
  }
  observe(state,controller='human',decision=null) {
    if(!state?.roundId) {this.onStatus('Restart the local game launcher to enable match recording.');return;}
    if(state.menuDemo) {this.finish('returned-to-menu');return;}
    if(this.active?.roundId!==state.roundId) {
      this.finish('restarted-before-round-ended');
      this.active={roundId:state.roundId,arena:state.map-1,finished:false,samples:0};
      this.enqueue({type:'start',arena:state.map-1,map:state.map,difficulties:state.difficulties,controls:state.keys,mode:state.mode,sampleIntervalMs:80});
    }
    if(this.active.finished)return;
    this.active.lastState=state;
    this.active.samples++;
    this.enqueue({type:'sample',controller,decision,state});
    if(state.roundOver) this.finish('round-ended');
    else this.status();
  }
  key(event) {
    if(this.active&&!this.active.finished)this.enqueue({type:'key',...event});
  }
  finish(reason) {
    if(!this.active||this.active.finished)return;
    this.enqueue({type:'end',reason,completed:reason==='round-ended',winner:reason==='round-ended'?this.active.lastState?.soloWinner:null,state:this.active.lastState});
    this.active.finished=true;
    this.flush();this.status();
  }
  status() {
    if(this.problem)this.onStatus(this.problem);
    else if(!this.active)this.onStatus('Practice matches record automatically.');
    else if(this.queue.length)this.onStatus(`${this.active.finished?'Saving match':'Recording'} · Arena ${this.active.arena} · ${this.active.samples} samples`);
    else this.onStatus(`${this.active.finished?'Match saved':'Recording'} · Arena ${this.active.arena} · ${this.active.samples} samples`);
  }
  async flush() {
    if(this.saving||!this.queue.length)return;
    this.saving=true;
    const first=this.queue[0],batch=[];
    for(const entry of this.queue) {
      if(batch.length>=8||entry.sessionId!==first.sessionId||entry.roundId!==first.roundId)break;
      if(batch.length && JSON.stringify(batch).length+JSON.stringify(entry).length>48000)break;
      batch.push(entry);
    }
    try {
      await this.send({version:1,sessionId:first.sessionId,roundId:first.roundId,events:batch.map(entry=>entry.event)});
      this.queue.splice(0,batch.length);this.problem=null;this.persist();
    } catch {this.problem='Saving is unavailable. Recording is buffered; keep the game open while it retries.';}
    finally {this.saving=false;this.status();}
  }
  async dispose() {clearInterval(this.timer);this.finish('page-closed');await this.flush();}
}
