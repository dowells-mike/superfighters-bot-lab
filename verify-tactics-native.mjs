// Isolated checks using actual collisions and normal controls, never the user's game.
import {chromium} from 'playwright';
import {serveLocal} from './local-server.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='local-game/verification/tactics';
await mkdir(dir,{recursive:true});
const {server,url}=await serveLocal(0,{recordingDirectory:`${dir}/recordings`});
const browser=await chromium.launch({channel:'msedge',headless:true});
const observations=[];
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  await page.goto(url);await page.locator('ruffle-player').waitFor();await page.waitForTimeout(7000);
  const box=await page.locator('ruffle-player').boundingBox();
  await page.mouse.click(box.x+box.width*.5,box.y+box.height*.875);
  await page.waitForFunction(()=>window.sfLab?.state()?.bridgeVersion>=4,{},{timeout:30000});
  let success=false;
  for(let attempt=0;attempt<6&&!success;attempt++) {
    await page.evaluate(()=>{window.sfLab.stop();window.sfLab.call('sfDuel',2,1,1);});
    await page.waitForFunction(()=>{const s=window.sfLab.call('sfState');return s.ready&&!s.menuDemo;});
    const selected=await page.evaluate(async()=>{
      const s=window.sfLab.call('sfState'),p=s.players.find(p=>!p.bot),w=window.sfLab.call('sfWorld');
      const fuel=w.objects.find(o=>o.explosive);
      const blocked=fuel&&window.sfLab.call('sfTrace',fuel.x-20,fuel.y,fuel.x+20,fuel.y);
      const {findRoute,navigate}=await import('/navigation.mjs');
      const candidates=[];
      for(const holder of w.traps)for(const n of w.nodes) {
        const t={...holder,y:holder.y-Math.max(1,holder.height/2-1)};
        if(n.blocked||n.locked||Math.hypot(t.x-n.x,t.y-n.y)>p.range*.9)continue;
        const dir=t.x<n.x?-1:1;
        if(!window.sfLab.call('sfTrace',n.x-dir*4,n.y-6,t.x,t.y,t.id).clear)continue;
        const route=findRoute(w,{x:p.x,y:p.midY},n);
        if(route)candidates.push({trap:t,goal:n,cost:route.cost});
      }
      candidates.sort((a,b)=>a.cost-b.cost);
      window.nativeTacticsTest={navigate,memory:{}};
      return {p,...candidates[0],blocked};
    });
    observations.push({attempt,selected});
    assert.equal(selected.blocked.clear,false,'Bullet rays must account for breakable explosive cover');
    assert.equal(selected.blocked.blocker.explosive,true);
    if(!selected.trap)continue;
    const target=selected.trap;
    const keys=await page.evaluate(()=>window.sfLab.call('sfState').keys[0]);
    const travelling=Date.now();
    while(Date.now()-travelling<15000) {
      const arrived=await page.evaluate(({goal,target})=>{
        const s=window.sfLab.call('sfState'),p=s.players.find(p=>!p.bot);
        if(s.roundOver||p.hp<=0)return true;
        if(p.onGround&&window.sfLab.call('sfTrace',p.x-p.facing*4,p.y-14,target.x,target.y,target.id).clear)return true;
        s.world=window.sfLab.call('sfWorld');
        const t=window.nativeTacticsTest,result=t.navigate(s,p,{...goal,kind:'test'},t.memory);
        const order=['up','down','left','right','melee','shoot','grenade','powerup','jump','crouch','sprint'];
        window.sfLab.call('sfKeys',[...new Set(result.actions.map(a=>s.keys[0][order.indexOf(a)]))].join(','));
        return false;
      },{goal:selected.goal,target});
      if(arrived)break;
      await page.waitForTimeout(40);
    }
    const current=await page.evaluate(()=>window.sfLab.call('sfState').players.find(p=>!p.bot));
    const direction=target.x<current.x?-1:1;
    await page.evaluate(csv=>window.sfLab.call('sfKeys',csv),String(direction<0?keys[2]:keys[3]));
    await page.waitForTimeout(80);
    await page.evaluate(csv=>window.sfLab.call('sfKeys',csv),String(keys[5]));
    const started=Date.now();
    while(Date.now()-started<5000) {
      const s=await page.evaluate(()=>window.sfLab.call('sfState')),p=s.players.find(p=>!p.bot);
      if(s.roundOver||p.hp<=0)break;
      const angle=Math.atan2(target.y-(p.y-14),Math.abs(target.x-(p.x-p.facing*4)))*180/Math.PI,error=p.aimPitch-angle;
      const path=await page.evaluate(({p,target})=>window.sfLab.call('sfTrace',p.x-p.facing*4,p.y-14,target.x,target.y,target.id),{p,target});
      if(!path.clear)break;
      if(p.aiming&&!p.aimTurnDelay&&p.weaponCooldown<=0&&Math.abs(error)<1.2) {
        const ammo=p.ammo;
        await page.evaluate(()=>window.sfLab.call('sfKeys',''));
        await page.waitForTimeout(450);
        const after=await page.evaluate(()=>({state:window.sfLab.call('sfState'),world:window.sfLab.call('sfWorld')}));
        const remaining=after.world.traps.find(t=>t.id===target.id),platform=after.world.objects.find(o=>o.id===target.platform.id);
        const spent=ammo-after.state.players.find(p=>!p.bot).ammo;
        observations.push({attempt,target,goal:selected.goal,spent,remaining:remaining??null,platform:platform??null});
        success=!remaining&&platform&&platform.y>target.platform.y+4&&spent===1;
        break;
      }
      const actions=[keys[5],...(error>1.2?[keys[0]]:error<-1.2?[keys[1]]:[])];
      await page.evaluate(csv=>window.sfLab.call('sfKeys',csv),actions.join(','));
      await page.waitForTimeout(40);
    }
    await page.evaluate(()=>window.sfLab.call('sfKeys',''));
  }
  await writeFile(`${dir}/connector.json`,JSON.stringify({success,observations},null,2));
  assert.ok(success,'One normal pistol shot must cut the actual connector and drop its linked crate');
  console.log('Verified in the native game: breakable cover blocks the ray; one normal pistol shot cuts a connector and drops its crate.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
