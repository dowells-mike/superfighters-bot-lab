import {features,actors,actions,featureNames} from './learning-features.mjs';
export function predict(model,x) {
  const result=Array(model.actions.length).fill(0);
  for(const tree of model.trees) {
    let i=0;
    while(tree.left[i]!==-1)i=x[tree.feature[i]]<=tree.threshold[i]?tree.left[i]:tree.right[i];
    for(let j=0;j<result.length;j++)result[j]+=tree.value[i][j]/model.trees.length;
  }
  return result;
}
export function createLearnedPolicy(model,{assist=true}={}) {
  if(model.schema!==1||JSON.stringify(model.featureNames)!==JSON.stringify(featureNames))throw new Error('Training model does not match this controller. Retrain the model.');
  function decide(state,memory={}) {
    const {me:p,enemy:e}=actors(state);
    if(!p||!e||p.hp<=0||p.gone||state.roundOver||!state.ready||state.menuDemo)return {actions:[],reason:'Waiting for an active match'};
    const previous=memory.previous;
    const x=features(state,previous),probabilities=predict(model,x);
    memory.previous=state;
    const selected=actions.filter((action,i)=>probabilities[i]>=model.thresholds[i]);
    // Opposing directional keys cancel in the game. Resolve to the more confident choice.
    for(const [a,b] of [['left','right'],['up','down']])if(selected.includes(a)&&selected.includes(b))selected.splice(selected.indexOf(probabilities[actions.indexOf(a)]>=probabilities[actions.indexOf(b)]?b:a),1);
    if(!p.aiming) {
      if(selected.includes('up'))selected.push('jump');
      if(selected.includes('down'))selected.push('crouch');
    }
    if(p.grenades<=0)selected.splice(selected.indexOf('grenade'),selected.includes('grenade')?1:0);
    if(assist) {
      const dx=e.x-p.x,dy=(e.midY??e.y-8)-(p.y-14),distance=Math.hypot(dx,e.y-p.y),direction=dx<0?-1:1;
      const sight=p.sight?.find(s=>s.id===e.id);
      const towards=direction<0?'left':'right';
      memory.tick=(memory.tick??0)+1;
      if(p.burn>0)return {actions:memory.tick%4<2?['crouch',towards]:['crouch'],reason:'Rolling to extinguish fire',probabilities};
      // Melee only within the actual horizontal/vertical reach. Repeated key-downs
      // queue the game's normal punch combo instead of holding one inert key.
      if(Math.abs(dx)<=p.meleeRange+4&&Math.abs(e.y-p.y)<13) {
        const combat=p.facing!==direction?[towards]:[];
        if(memory.tick%2===0)combat.push('melee');
        return {actions:combat,reason:'Learned approach · timing a close-range combo',probabilities};
      }
      // Pick up a nearby useful gun through the same crouch+melee keys as a human.
      const gunTypes=['PISTOL','RIFLE','UZI','SHOTGUN','MAGNUM','SNIPER','FLAMETHROWER'];
      const useful=(state.weapons??[]).filter(w=>gunTypes.includes(w.type)&&w.ammo>0&&Math.abs(w.y-p.y)<24);
      useful.sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x));
      const gun=useful[0];
      if(gun&&(!p.weapon||p.ammo<=0)&&Math.abs(gun.x-p.x)<Math.max(8,gun.pickupRadius-2)) {
        return {actions:memory.tick%2===0?['crouch','melee']:['crouch'],reason:'Collecting ammunition and a new weapon',probabilities};
      }
      if(p.weapon&&p.ammo>0&&sight?.clearShot&&distance<p.range*.95&&distance>18) {
        if(p.facing!==direction)return {actions:[towards],reason:'Turning for a clear shot',probabilities};
        const dt=previous?state.timeMs-previous.timeMs:0,oldEnemy=previous&&actors(previous).enemy;
        const evx=dt>0&&dt<250&&oldEnemy?(e.x-oldEnemy.x)/dt:0;
        // Small lead for moving targets; avoid extrapolating teleport/knockback jumps.
        const lead=Math.max(-8,Math.min(8,evx*Math.min(90,distance/3)));
        const targetX=(e.midX??e.x)+lead;
        const targetY=(e.midY??e.y-8)-(e.kneeling||e.knockedDown?0:2);
        const angle=Math.atan2(targetY-(p.y-14),Math.abs(targetX-(p.x-p.facing*4)))*180/Math.PI;
        const error=p.aimPitch-angle,tolerance=Math.max(1.2,Math.min(5,Math.atan2(4,distance)*180/Math.PI));
        if(p.aiming&&p.aimMode===0&&!p.aimTurnDelay&&p.weaponCooldown<=0&&Math.abs(error)<tolerance) {
          return {actions:[],reason:'Releasing an aligned shot',probabilities};
        }
        const combat=['shoot'];
        if(error>tolerance)combat.push('up');
        else if(error<-tolerance)combat.push('down');
        return {actions:combat,reason:'Learned positioning · tracking a clear shot',probabilities};
      }
      // The learned forest controls movement when there is no useful firing line.
      // Release old aiming/grenade inputs so walking can resume; pulse learned melee.
      const movement=selected.filter(a=>!['shoot','grenade','powerup','melee'].includes(a));
      if(selected.includes('melee')&&memory.tick%2===0)movement.push('melee');
      if(previous&&Math.abs(p.x-(actors(previous).me?.x??p.x))<.3&&!p.aiming)memory.stuck=(memory.stuck??0)+1;
      else memory.stuck=0;
      if(!movement.includes('left')&&!movement.includes('right')&&!p.aiming)movement.push(towards);
      if(memory.stuck>15&&p.onGround) {
        if(memory.tick%8<4)movement.push('jump');
        movement.push(towards);
      }
      if(gun&&(!p.weapon||p.ammo<=0)&&Math.abs(gun.x-p.x)<100) {
        for(const a of ['left','right'])if(movement.includes(a))movement.splice(movement.indexOf(a),1);
        movement.push(gun.x<p.x?'left':'right');
      }
      if(p.onGround&&p.terrain) {
        const movingRight=movement.includes('right')&&!movement.includes('left');
        const movingLeft=movement.includes('left')&&!movement.includes('right');
        const drop=movingRight?p.terrain.rightDrop:movingLeft?p.terrain.leftDrop:0;
        const landing=movingRight?p.terrain.rightLanding:p.terrain.leftLanding;
        if(drop>60) {
          for(const a of ['left','right','down','crouch'])if(movement.includes(a))movement.splice(movement.indexOf(a),1);
          if(landing<=40) {
            movement.push(movingRight?'right':'left');
            if(memory.tick%8<4)movement.push('jump');
          } else if((movingRight?p.terrain.leftDrop:p.terrain.rightDrop)<=30) {
            movement.push(movingRight?'left':'right');
          }
          return {actions:[...new Set(movement)],reason:'Keeping the learned route clear of a dangerous drop',probabilities};
        }
      }
      return {actions:[...new Set(movement)],reason:'Following learned routes and movement choices',probabilities};
    }
    return {actions:selected,reason:'Following your learned movement and combat patterns',probabilities};
  }
  return function guardedDecision(state,memory={}) {
    const result=decide(state,memory);
    const {me:p}=actors(state);
    if(!assist||!p||!p.terrain||p.hp<=0||state.roundOver||!state.ready)return result;
    // Check airborne steering as well as walking: a sprint jump can otherwise
    // carry the player past the edge of a platform into the arena's death pit.
    const t=p.terrain,moving=result.actions.includes('right')?1:result.actions.includes('left')?-1:0;
    const drift=!p.onGround&&p.vy>0?(p.vx>1?1:p.vx<-1?-1:0):0;
    const direction=moving||drift;
    if(!direction)return result;
    const drop=direction>0?t.rightDrop:t.leftDrop,back=direction>0?t.leftDrop:t.rightDrop;
    if(drop>60&&back<45&&(!p.onGround||((direction>0?t.rightLanding:t.leftLanding)>40))) {
      return {actions:[direction>0?'left':'right'],reason:'Steering back toward solid ground',probabilities:result.probabilities};
    }
    return result;
  };
}
