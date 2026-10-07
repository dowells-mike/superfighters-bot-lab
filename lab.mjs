import { decide } from '/policy.mjs';
import { createLearnedPolicy } from '/learned-policy.mjs';
import { createLearnedPolicy as createPreviousPolicy } from '/previous-policy.mjs';
import { MatchRecorder } from '/match-recorder.mjs';
const $ = id => document.getElementById(id);
let learnedDecide=null,previousDecide=null,latestWorld=null,worldAt=-Infinity;
try {
  const response=await fetch('/models/human-model.json');
  if(!response.ok)throw new Error('No trained model');
  const model=await response.json();
  learnedDecide=createLearnedPolicy(model,{trace:(...args)=>call('sfTrace',...args)});
  previousDecide=createPreviousPolicy(model);
  showEvaluation(model);
  const missing=[1,2,3,4,5,6].filter(arena=>!model.report.arenas.includes(arena));
  $('learning-status').textContent=`Learned from ${model.report.trainingMatches} matches · checked on ${model.report.validationMatches} separate matches.${missing.length?` Arenas without demonstrations: ${missing.join(', ')}.`:''}`;
} catch {
  $('controller').value='starter';
  $('controller').querySelector('option[value="learned"]').disabled=true;
  $('learning-status').textContent='No trained model available. Run Train Bot.cmd to train from recorded matches.';
}
async function showEvaluation(model) {
  try {
    const response=await fetch('/models/evaluation-report.json');
    if(!response.ok)return;
    const report=await response.json();
    if(report.modelTrainedAt!==model.report.trainedAt)return;
    const source=(await Promise.all(['/learned-policy.mjs','/combat-tactics.mjs','/navigation.mjs'].map(async url=>await (await fetch(url)).text()))).join('\n');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==report.controllerSha256)return;
    const learned=report.summary.learned,baseline=report.summary[report.baseline??'starter'];
    const signed=value=>`${value>=0?'+':''}${value.toFixed(1)}`;
    const trades=Number.isFinite(learned.meanDamageAdvantage)&&Number.isFinite(baseline.meanDamageAdvantage)?` Average damage dealt minus taken: ${signed(learned.meanDamageAdvantage)} HP · previous ${signed(baseline.meanDamageAdvantage)} HP.`:'';
    $('evaluation-status').textContent=`Latest Hard CPU test: learned ${learned.wins}/${learned.matches} wins · ${report.baseline==='previous'?'previous bot':'starter'} ${baseline.wins}/${baseline.matches}.${trades} Small test with random starting positions.`;
  } catch { /* Match reports are optional; the saved model can still play. */ }
}
function botLabel(paused=false) {return `${paused?'Pause':'Start'} ${$('controller').value==='learned'?'learned':$('controller').value==='previous'?'previous learned':'starter'} bot`;}
const order = ['up','down','left','right','melee','shoot','grenade','powerup','jump','crouch','sprint'];
const controls = await (await fetch('/controls.json')).json();
const specialCodes={ARROWUP:38,ARROWDOWN:40,ARROWLEFT:37,ARROWRIGHT:39,SPACE:32,SHIFT:16,CONTROL:17};
const codes = Object.fromEntries(order.map(action => {
  const key=controls[action].toUpperCase();
  const code=specialCodes[key] ?? (key.length===1?key.charCodeAt(0):0);
  if(!code) throw new Error(`Unknown key for ${action}: ${key}`);
  return [action,code];
}));
const configuredCsv=order.map(action=>codes[action]).join(',');
const serverInfo=await (await fetch('/__lab/status')).json();
async function save(payload) {
  const response=await fetch('/__lab/record',{method:'POST',headers:{'Content-Type':'application/json','x-lab-token':serverInfo.token},body:JSON.stringify(payload),keepalive:true});
  if(!response.ok)throw new Error('Saving failed');
  return response.json();
}
const recorder=new MatchRecorder({send:save,storage:localStorage,onStatus:text=>{$('recording').textContent=text;}});
recorder.status();
function showKeys() {
  const names={0:'unassigned',16:'Shift',17:'Ctrl',32:'Space',37:'Left arrow',38:'Up arrow',39:'Right arrow',40:'Down arrow'};
  $('keys').textContent=order.map(action=>`${action}: ${names[codes[action]] ?? String.fromCharCode(codes[action])}`).join(' · ');
}
showKeys();
const player = window.RufflePlayer.newest().createPlayer();
$('game').append(player);
await player.ruffle().load({ url:'/game.swf', allowScriptAccess:true });
const call = (name, ...args) => player.ruffle().callExternalInterface(name, ...args);
let connected = false, running = false, snapshot, busy = false, memory = {},lastRecordingTime=-Infinity;
let metrics={},previousObservation=null;
function measure(state) {
  if(metrics.roundId!==state.roundId) {metrics={roundId:state.roundId,bulletsSpent:0,grenadesSpent:0,pickups:0,blockedShotCommands:0,recoveryShotCommands:0,decisions:{}};previousObservation=null;}
  const me=state.players.find(p=>!p.bot),old=previousObservation?.players.find(p=>!p.bot);
  if(me&&old) {
    if(me.weapon===old.weapon&&me.ammo<old.ammo)metrics.bulletsSpent+=old.ammo-me.ammo;
    if(me.weapon&&me.weapon!==old.weapon||me.weapon===old.weapon&&me.ammo>old.ammo)metrics.pickups++;
    if(me.grenades<old.grenades)metrics.grenadesSpent+=old.grenades-me.grenades;
  }
  previousObservation=state;
}
function stop() {
  running = false;
  if (connected) call('sfKeys','');
  $('bot').textContent = botLabel();
  $('decision').textContent = 'Bot stopped. Manual play is available.';
}
window.addEventListener('blur',stop);
document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); });
document.addEventListener('keydown',event => {
  if(event.code === 'F8') { event.preventDefault(); stop(); }
  if($('game').contains(event.target)&&!event.repeat)recorder.key({phase:'down',keyCode:event.keyCode,pageTimeMs:performance.now(),gameTimeMs:snapshot?.timeMs??null});
},true);
document.addEventListener('keyup',event=>{if($('game').contains(event.target))recorder.key({phase:'up',keyCode:event.keyCode,pageTimeMs:performance.now(),gameTimeMs:snapshot?.timeMs??null});},true);
window.addEventListener('pagehide',()=>{stop();recorder.dispose();});
$('stop').onclick = stop;
$('duel').onclick = () => { stop(); call('sfDuel',Number($('map').value),Number($('difficulty').value),1); memory = {}; };
$('restart').onclick = () => { stop(); call('sfRestart'); memory = {}; };
$('controller').onchange=()=>{stop();memory={};};
$('bot').textContent=botLabel();
$('bot').onclick = () => { running = !running; if (!running) stop(); else {memory={};$('bot').textContent = botLabel(true);} };
$('export').onclick = async () => {
  try {const result=await save({kind:'snapshot',state:snapshot});$('snapshot-status').textContent=`Snapshot saved in recordings/${result.file}`;}
  catch {$('snapshot-status').textContent='Snapshot could not be saved. Restart the local launcher and try again.';}
};
setInterval(() => {
  if (busy) return;
  busy = true;
  try {
    snapshot = call('sfState');
    if (!snapshot?.bridgeVersion) { $('status').textContent='Click PLAY inside the game to connect.'; return; }
    if (!connected) {
      if(localStorage.getItem('sfControlSeed')!==configuredCsv) {
        call('sfConfigure',configuredCsv);
        localStorage.setItem('sfControlSeed',configuredCsv);
      }
      connected = true;
      for(const id of ['duel','restart','bot','export']) $(id).disabled=false;
    }
    order.forEach((action,index)=>{codes[action]=snapshot.keys[0][index];});
    if(snapshot.bridgeVersion>=4&&(latestWorld?.roundId!==snapshot.roundId||snapshot.timeMs-worldAt>300)) {
      latestWorld=call('sfWorld');worldAt=snapshot.timeMs;
    }
    snapshot.world=latestWorld;
    measure(snapshot);
    showKeys();
    $('status').textContent = snapshot.menuDemo ? 'Connected · choose a practice match' : snapshot.roundOver ? 'Connected · round finished' : 'Connected · reading live game state';
    $('players').replaceChildren(...snapshot.players.map(p => {
      const element=document.createElement('div'); element.className='fighter';
      element.textContent=`${p.bot?'CPU':'Player 1'} · HP ${Math.max(0,Math.round(p.hp))}\n${p.weapon ?? 'No gun'} · ammo ${p.ammo}\nPosition ${Math.round(p.x)}, ${Math.round(p.y)}`;
      element.style.whiteSpace='pre-line'; return element;
    }));
    let decision=null;
    if (running) {
      if($('controller').value==='learned'&&snapshot.bridgeVersion<4)throw new Error('Close this game window and reopen Start Local Game.cmd to load the new observations.');
      const policy=$('controller').value==='learned'?learnedDecide:$('controller').value==='previous'?previousDecide:decide;
      decision=(policy??decide)(snapshot,memory);
      const keys=[...new Set(decision.actions.map(action=>codes[action]))];
      const me=snapshot.players.find(p=>!p.bot),enemy=snapshot.players.find(p=>p.bot),sight=me?.sight?.find(s=>s.id===enemy?.id);
      if(snapshot.ready&&!snapshot.roundOver&&enemy?.hp>0&&me?.aiming&&me.aimMode===0&&snapshot.inputHeld.includes(codes.shoot)&&!keys.includes(codes.shoot)&&!['trap','hazard'].includes(decision.targetKind)) {
        if(!sight?.directShot)metrics.blockedShotCommands++;
        if(enemy?.immune||enemy?.rolling||enemy?.diving)metrics.recoveryShotCommands++;
      }
      const category=decision.cancelAim?'cancelAim':decision.fire?decision.targetKind??'shot':decision.pickup?'pickup':decision.grenade?'grenade':decision.dodge?'dodge':decision.navigation?'navigation':decision.reason;
      metrics.decisions[category]=(metrics.decisions[category]??0)+1;
      call('sfKeys',keys.join(','));
      $('decision').textContent=decision.reason;
    }
    if(snapshot.timeMs-lastRecordingTime>=75||snapshot.roundOver) {
      const recordingState={...snapshot};delete recordingState.world;
      recorder.observe(recordingState,running?`${$('controller').value}-bot`:'human',decision);
      lastRecordingTime=snapshot.timeMs;
    }
  } catch(error) {
    if(connected) { stop(); $('status').textContent=`Connection error: ${error.message}`; }
  } finally { busy=false; }
},40);
window.sfLab = { call, stop, state:()=>snapshot,metrics:()=>metrics,start:(controller='learned')=>{stop();$('controller').value=controller;memory={};running=true;$('bot').textContent=botLabel(true);},recorder };
