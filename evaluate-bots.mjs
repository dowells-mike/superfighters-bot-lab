// Real matches in isolated browsers; does not touch the user's game/profile/recordings.
import {chromium} from 'playwright';
import {serveLocal} from './local-server.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readModelArtifact} from './model-store.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const rounds=Number(process.env.SF_EVAL_ROUNDS??'1'),limit=Number(process.env.SF_EVAL_LIMIT??'75');
const maps=(process.env.SF_EVAL_MAPS??'2,3,4,5,6,7').split(',').map(Number);
const baseline=process.env.SF_EVAL_BASELINE??'previous';
const concurrency=Number(process.env.SF_EVAL_WORKERS??'3');
const dir=path.join(root,'local-game/evaluation',new Date().toISOString().replaceAll(':','-'));
await mkdir(dir,{recursive:true});
const {server,url}=await serveLocal(0,{recordingDirectory:path.join(dir,'recordings')});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const jobs=[];
for(let round=0;round<rounds;round++)for(const map of maps)for(const controller of round%2?['learned',baseline]:[baseline,'learned'])jobs.push({map,controller,round});
const results=[],errors=[];
const model=JSON.parse(await readModelArtifact(root,'human-model.json'));
const sources=await Promise.all(['learned-policy.mjs','combat-tactics.mjs','navigation.mjs'].map(file=>readFile(path.join(root,file),'utf8')));
const controllerSha256=createHash('sha256').update(sources.join('\n')).digest('hex');
const bridgeSha256=createHash('sha256').update(await readFile(path.join(root,'local-game/superfighters-bridge.swf'))).digest('hex');
async function worker(workerId) {
  const context=await browser.newContext({viewport:{width:1200,height:900}});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(url);await page.locator('ruffle-player').waitFor();await page.waitForTimeout(7000);
    const box=await page.locator('ruffle-player').boundingBox();
    await page.mouse.click(box.x+box.width*.5,box.y+box.height*.875);
    await page.waitForFunction(()=>window.sfLab?.state()?.bridgeVersion>=2,{},{timeout:30000});
    while(jobs.length) {
      const job=jobs.shift();
      await page.evaluate(({map,controller})=>{window.sfLab.stop();window.sfLab.call('sfDuel',map,3,1);window.sfLab.start(controller);},job);
      await page.waitForFunction(()=>{const s=window.sfLab.call('sfState');return s.ready&&!s.menuDemo;},{},{timeout:30000});
      const initial=await page.evaluate(()=>window.sfLab.call('sfState')),start=Date.now();
      let state;
      while(Date.now()-start<limit*1000) {
        await page.waitForTimeout(500);state=await page.evaluate(()=>window.sfLab.call('sfState'));
        if(state.roundOver)break;
      }
      await page.evaluate(()=>window.sfLab.stop());
      const me=state.players.find(p=>!p.bot),enemy=state.players.find(p=>p.bot);
      const result={...job,arena:job.map-1,completed:state.roundOver,winner:state.roundOver?state.soloWinner:null,
        outcome:state.roundOver?(state.soloWinner===0?'win':state.soloWinner===1?'loss':'draw'):'timeout',
        playerHp:me?.hp,enemyHp:enemy?.hp,damageAdvantage:(me?.hp??0)-(enemy?.hp??0),wallSeconds:Math.round((Date.now()-start)/100)/10,
        gameMilliseconds:state.timeMs-initial.timeMs,initialPositions:initial.players.map(p=>({id:p.id,x:p.x,y:p.y})),
        finalPositions:state.players.map(p=>({id:p.id,x:p.x,y:p.y})),ammo:me?.ammo,weapon:me?.weapon,
        metrics:await page.evaluate(()=>window.sfLab.metrics())};
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(path.join(dir,'progress.json'),JSON.stringify({results,errors},null,2));
    }
  } finally {await context.close();}
}
try {await Promise.all(Array.from({length:concurrency},(_,i)=>worker(i)));}
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
const summary=Object.fromEntries([baseline,'learned'].map(controller=>{
  const r=results.filter(r=>r.controller===controller);
  return [controller,{matches:r.length,wins:r.filter(r=>r.outcome==='win').length,losses:r.filter(r=>r.outcome==='loss').length,draws:r.filter(r=>r.outcome==='draw').length,timeouts:r.filter(r=>r.outcome==='timeout').length,
    meanEnemyDamage:r.reduce((sum,r)=>sum+100-r.enemyHp,0)/r.length,meanRemainingHp:r.reduce((sum,r)=>sum+r.playerHp,0)/r.length,
    meanDamageAdvantage:r.reduce((sum,r)=>sum+r.damageAdvantage,0)/r.length,favorableDamageTrades:r.filter(r=>r.damageAdvantage>0).length,
    bulletsSpent:r.reduce((sum,r)=>sum+(r.metrics?.bulletsSpent??0),0),pickups:r.reduce((sum,r)=>sum+(r.metrics?.pickups??0),0),grenadesSpent:r.reduce((sum,r)=>sum+(r.metrics?.grenadesSpent??0),0),
    blockedShotCommands:r.reduce((sum,r)=>sum+(r.metrics?.blockedShotCommands??0),0),recoveryShotCommands:r.reduce((sum,r)=>sum+(r.metrics?.recoveryShotCommands??0),0),
    decisions:r.reduce((sum,r)=>{for(const[k,v]of Object.entries(r.metrics?.decisions??{}))sum[k]=(sum[k]??0)+v;return sum;},{})}];
}));
const report={evaluatedAt:new Date().toISOString(),modelVersion:model.version,modelTrainedAt:model.report.trainedAt,controllerSha256,bridgeSha256,baseline,difficulty:'Hard CPU',timeLimitSeconds:limit,
  conditions:'Unmodified rules and normal keyboard input; randomly chosen native spawn positions; independent trials, not identical seeded matches.',summary,results,errors};
await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));
await writeFile(path.join(root,'models/evaluation-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({summary,report:path.join(dir,'report.json'),errors},null,2));
