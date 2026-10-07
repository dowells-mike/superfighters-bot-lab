import {actors} from './learning-features.mjs';
import {navigate,riskAt,findRoute,safeMovement} from './navigation.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const towards=dx=>dx<0?'left':'right';
const gunValues={PISTOL:1,UZI:1.9,RIFLE:2.4,SHOTGUN:2.1,MAGNUM:3.2,SNIPER:3.4,BAZOOKA:3.1,FLAMETHROWER:1.8};
export function weaponValue(type,ammo,range=120) {
  if(!ammo)return 0;
  let value=(gunValues[type]??0)*Math.min(1,ammo/(type==='SNIPER'||type==='BAZOOKA'||type==='MAGNUM'?3:8));
  if(type==='SHOTGUN'&&range<90)value*=1.35;
  if(type==='BAZOOKA'&&range<100)value*=.25;
  if(type==='FLAMETHROWER'&&range>140)value*=.4;
  return value;
}
export function chooseWeapon(state,p,e,memory) {
  const world=state.world??memory.world;
  const current=weaponValue(p.weapon,p.ammo,distance(p,e)),point={x:p.x,y:p.midY??p.y-8};
  const candidates=[];
  for(const w of state.weapons??[]) {
    if(!gunValues[w.type]||w.ammo<=0||state.timeMs<(memory.avoidWeapons?.[w.id]??0))continue;
    const value=weaponValue(w.type,w.ammo,distance(p,e));
    const needsAmmo=p.ammo<Math.ceil(e.hp/Math.max(1,p.damage||10));
    const ammoBonus=w.type===p.weapon&&needsAmmo&&w.ammo>p.ammo+3?(w.ammo-p.ammo)*8:0;
    if(current>0&&value<current*1.15&&p.ammo>3&&!ammoBonus)continue;
    const d=distance(point,w);if(d>320&&current>0)continue;
    const route=findRoute(world,point,w);
    if(world?.nodes?.length&&!route)continue;
    const cost=route?.cost??d;
    const score=(value-current)*100+ammoBonus-cost*.3-riskAt(w,world);
    if(score>0||current===0&&cost<500)candidates.push({...w,score});
  }
  return candidates.sort((a,b)=>b.score-a.score)[0]??null;
}
function trace(env,p,target,ignore=target.id??-1,cloud=false) {
  return env?.trace?env.trace(p.x-p.facing*4,p.y-14,target.x,target.y,ignore,cloud):{clear:false};
}
function cancelAim(p,result,memory) {
  // Keep the trigger down while pressing melee. Releasing it first would fire.
  if(p.aiming&&p.aimMode===0&&!result.actions.includes('shoot')&&!result.fire) {
    const pulse=memory.cancelPulse=!memory.cancelPulse;
    return {...result,actions:pulse?['shoot','melee']:['shoot'],reason:`Cancelling aim without a wasted bullet · ${result.reason}`,cancelAim:true};
  }
  return result;
}
function attackTarget(state,p,e,world) {
  const normal={kind:'enemy',id:e.id,x:e.midX??e.x,y:(e.midY??e.y-8)-(e.kneeling||e.knockedDown?0:2)};
  if(p.sight?.find(s=>s.id===e.id)?.directShot)return normal;
  // A connector breaks in one pistol hit; target it only if the CPU is beneath
  // its linked platform and our player is outside the fall corridor.
  for(const t of world?.traps??[]) {
    const platform=t.platform;if(!platform||t.hp<=0)continue;
    const width=Math.max(22,platform.width/2);
    if(Math.abs(e.x-platform.x)<width+4&&e.y>platform.y+12&&e.y-platform.y<170&&Math.abs(p.x-platform.x)>width+20&&distance(p,t)<p.range*.9)
      // The holder's centre overlaps the crate's top collision shape. Its
      // exposed upper edge is a real reachable connector hit, verified natively.
      return {...t,y:t.y-Math.max(1,t.height/2-1),kind:'trap',id:t.id};
  }
  for(const h of world?.objects??[]) {
    if(!h.explosive||h.hp<=0||distance(p,h)<110||distance(e,h)>70||distance(p,h)>p.range*.9)continue;
    const needed=Math.ceil(h.hp/Math.max(1,p.damage??10));
    if(p.ammo>=needed&&e.hp>15)return {...h,kind:'hazard'};
  }
  return normal;
}
function aim(state,p,e,target,memory,env,previous) {
  if(!p.aiming&&(!p.onGround||p.jumping||p.controllable===false))return null;
  const direction=target.x<p.x?-1:1,d=distance(p,target);
  const sight=p.sight?.find(s=>s.id===e.id);
  const los=target.kind==='enemy'?sight?.directShot===true:trace(env,p,target).clear;
  if(!los)return null;
  if(p.weapon==='BAZOOKA'&&(d<110||riskAt(p,state.world??memory.world)>100))return null;
  if(p.facing!==direction)return {actions:[towards(target.x-p.x)],reason:'Turning before committing ammunition'};
  const old=previous&&actors(previous).enemy,dt=previous?state.timeMs-previous.timeMs:0;
  let tx=target.x,ty=target.y;
  if(target.kind==='enemy'&&dt>0&&dt<250&&old) {
    // Preserve the previous controller's successful short horizontal lead.
    tx+=Math.max(-8,Math.min(8,(e.x-old.x)/dt*Math.min(90,d/3)));
  }
  const angle=Math.atan2(ty-(p.y-14),Math.abs(tx-(p.x-p.facing*4)))*180/Math.PI;
  const error=p.aimPitch-angle,tolerance=target.kind==='trap'?Math.max(.8,Math.min(2,Math.atan2(2.5,d)*180/Math.PI)):Math.max(1.2,Math.min(5,Math.atan2(4,d)*180/Math.PI));
  const recovering=target.kind==='enemy'&&(e.immune||e.rolling||e.diving);
  // A release only fires if the trigger was held. A draw animation can reject
  // a release; re-arm on the next observation instead of waiting with no key.
  const triggerHeld=!Array.isArray(state.inputHeld)||!state.keys||state.inputHeld.includes(state.keys[0][5]);
  const canFire=triggerHeld&&p.aiming&&p.aimMode===0&&!p.aimTurnDelay&&p.weaponCooldown<=0&&!recovering&&Math.abs(error)<tolerance;
  if(canFire) {
    // Check the predicted impact point again at trigger release, not just the
    // original observation. The caller supplies the real collision probe.
    const release=trace(env,p,{x:tx,y:ty,id:target.kind==='enemy'?-1:target.id},target.kind==='enemy'?(p.coverID??-1):target.id,p.weapon==='FLAMETHROWER');
    if(release.clear) {
      memory.lastFireAt=state.timeMs;memory.lastShot={at:state.timeMs,enemyHp:e.hp,ammo:p.ammo,target:target.kind};
      return {actions:[],reason:target.kind==='trap'?'Cutting the connector above the CPU':target.kind==='hazard'?'Detonating cover beside the CPU':'Taking a clear shot while the CPU is vulnerable',fire:true,targetKind:target.kind};
    }
  }
  const keys=['shoot'];
  // Up shares the jump key. Wait until aiming is actually active before using
  // aim controls, so an airborne attempt cannot turn into endless jumping.
  if(p.aiming) {if(error>tolerance)keys.push('up');else if(error<-tolerance)keys.push('down');}
  return {actions:keys,reason:recovering?'Holding fire while the CPU recovers':canFire?'Holding fire until the impact path is clear':'Tracking a target before spending ammunition',targetKind:target.kind};
}
export function tacticalDecision(state,memory,learned,env,previous) {
  const {me:p,enemy:e}=actors(state),world=state.world??memory.world;
  if(!p||!e||p.hp<=0||p.gone||state.roundOver||!state.ready||state.menuDemo)return {actions:[],reason:'Waiting for an active match'};
  const dx=e.x-p.x,dy=e.y-p.y,d=distance(p,e),time=state.timeMs,dir=towards(dx);
  memory.tick=(memory.tick??0)+1;
  // Grenades and reactive dodges are disabled. Do not retain an old retreat plan.
  delete memory.grenade;delete memory.retreatUntil;delete memory.lastDodgeAt;
  let result;
  const hazards=(world?.objects??[]).filter(h=>{
    if(h.active||h.burning)return distance(p,h)<(h.active?85:55);
    return h.explosive&&h.hp<=Math.max(10,e.damage||10)&&distance(p,h)<45&&e.aiming&&e.ammo>0;
  }).sort((a,b)=>distance(p,a)-distance(p,b));
  // Leave actual fire or an imminent explosion, but a burn timer by itself must
  // not cancel every shot for several seconds after moving clear of the fire.
  if(p.fireHere||hazards.length) {
    const h=hazards[0],escape=h?towards(p.x-h.x):p.terrain?.fireRight?'left':p.terrain?.fireLeft?'right':dir;
    const safeNodes=(world?.nodes??[]).filter(n=>!n.locked&&!n.blocked&&!n.fire&&!n.hazard&&distance(p,n)<190&&riskAt(n,world)<30);
    safeNodes.sort((a,b)=>(riskAt(a,world)+distance(p,a)*.55)-(riskAt(b,world)+distance(p,b)*.55));
    result=safeNodes.length?navigate(state,p,{...safeNodes[0],kind:'escape',id:'escape:'+safeNodes[0].id},memory,learned):{actions:[escape]};
    result.reason='Moving clear of active fire or an imminent explosion';
  } else if(Math.abs(dx)<=p.meleeRange+4&&Math.abs(dy)<13&&!e.immune) {
    result={actions:[...(p.facing!==(dx<0?-1:1)?[dir]:[]),...(memory.tick%2===0?['melee']:[])],reason:'Keeping close-range melee pressure on the CPU'};
  } else {
    // Gun pressure takes precedence over dodging, combo wind-ups, weapon detours,
    // and multi-shot barrel attacks. The normal weapon cooldown sets the pace.
    if(p.weapon&&p.ammo>0&&d<p.range*.95&&d>18) {
      const target=attackTarget(state,p,e,world);
      result=aim(state,p,e,target,memory,env,previous);
      if(!result&&target.kind!=='enemy')result=aim(state,p,e,{kind:'enemy',id:e.id,x:e.midX??e.x,y:(e.midY??e.y-8)-(e.kneeling||e.knockedDown?0:2)},memory,env,previous);
    }
    if(!result&&p.jumping&&!p.diving&&d<40&&Math.abs(dy)<24) {
      result={actions:[dir,...(memory.tick%2===0?['melee']:[])],reason:'Queueing a jump kick at close range'};
    }
    if(!result) {
      const gun=chooseWeapon(state,p,e,memory);
      const gunClose=gun&&Math.abs(gun.x-p.x)<Math.max(7,gun.pickupRadius-2)&&Math.abs(gun.y-(p.midY??p.y-8)-4)<=10;
      if(gunClose&&p.canGrab&&!p.aiming) {
        memory.pickup??={id:gun.id,started:time};
        if(memory.pickup.id!==gun.id)memory.pickup={id:gun.id,started:time};
        if(time-memory.pickup.started>1600) {memory.avoidWeapons??={};memory.avoidWeapons[gun.id]=time+5000;memory.pickup=null;}
        result={actions:memory.tick%2===0?['crouch','melee']:['crouch'],reason:'Collecting a stronger weapon while the firing lane is blocked',pickup:gun.type};
      } else if(gun&&(!p.weapon||p.ammo<=3||distance(p,gun)<80)&&d>24) {
        result=navigate(state,p,{...gun,kind:'weapon'},memory,learned);
      } else if(p.onGround&&p.controllable!==false&&d>28&&d<65&&Math.abs(dy)<18&&p.stamina>45&&time-(memory.lastComboAt??-Infinity)>2500&&((dx>0?p.terrain?.rightLanding:p.terrain?.leftLanding)??1000)<40) {
        if(p.sprinting&&p.canDive) {memory.lastComboAt=time;result={actions:[dir,'sprint','crouch'],reason:'Diving into a close-range opening'};}
        else result={actions:[dir,'sprint'],reason:'Closing aggressively for a melee combo'};
      }
      if(!result)result=navigate(state,p,{x:e.x,y:e.midY??e.y-8,kind:'opponent'},memory,learned);
    }
  }
  return cancelAim(p,safeMovement(p,result,world),memory);
}
