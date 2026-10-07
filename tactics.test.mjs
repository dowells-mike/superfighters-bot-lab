import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tacticalDecision,chooseWeapon} from './combat-tactics.mjs';
import {findRoute,safeMovement,navigate} from './navigation.mjs';

function situation(me={},enemy={},extra={}) {
  const terrain={leftDrop:0,rightDrop:0,leftLanding:0,rightLanding:0,leftWall:false,rightWall:false};
  const p={id:0,team:-1,bot:false,x:0,y:100,midY:92,midX:0,hp:100,facing:1,weapon:'PISTOL',ammo:12,damage:10,range:300,meleeRange:10,grenades:3,onGround:true,controllable:true,stamina:100,canRoll:true,canDive:true,canGrab:true,aimPitch:0,weaponCooldown:0,bulletSpeed:30,terrain,sight:[{id:1,directShot:true}],...me};
  const e={id:1,team:-2,bot:true,x:150,y:100,midX:150,midY:92,hp:100,facing:-1,...enemy};
  if(me.aimPitch===undefined)p.aimPitch=Math.atan2(e.midY-2-(p.y-14),Math.abs(e.midX-(p.x-p.facing*4)))*180/Math.PI;
  return {ready:true,roundOver:false,menuDemo:false,timeMs:1000,weapons:[],players:[p,e],...extra};
}
const clear={trace:()=>({clear:true})};

test('aligned shots are released, but recovery, rolls and dives hold ammunition',()=>{
  const state=situation({aiming:true,aimMode:0});
  assert.equal(tacticalDecision(state,{},[],clear).fire,true);
  for(const immunity of [{immune:true},{rolling:true},{diving:true}]) {
    const waiting=tacticalDecision(situation({aiming:true,aimMode:0},immunity),{},[],clear);
    assert.ok(waiting.actions.includes('shoot'));
    assert.ok(!waiting.fire);
  }
});

test('blocked aim is cancelled with melee before the held trigger is released',()=>{
  const state=situation({aiming:true,aimMode:0,sight:[{id:1,directShot:false}]});
  const decision=tacticalDecision(state,{},[],{trace:()=>({clear:false})});
  assert.equal(decision.cancelAim,true);
  assert.deepEqual(decision.actions,['shoot','melee']);
  const changesAtRelease=tacticalDecision(situation({aiming:true,aimMode:0}),{},[],{trace:()=>({clear:false})});
  assert.ok(changesAtRelease.actions.includes('shoot'));
  assert.ok(!changesAtRelease.fire,'A newly obstructed predicted impact point must prevent release');
});

test('nearby sniper, magnum and safe-distance bazooka replace a pistol',()=>{
  for(const type of ['SNIPER','MAGNUM','BAZOOKA']) {
    const state=situation({sight:[{id:1,directShot:false}]}, {},{weapons:[{id:20,x:2,y:96,type,ammo:6,pickupRadius:14}]});
    assert.equal(chooseWeapon(state,...state.players,{}).type,type);
    const memory={};
    assert.ok(tacticalDecision(state,memory,[],clear).actions.includes('crouch'));
    const pickup=tacticalDecision({...state,timeMs:1040},memory,[],clear);
    assert.deepEqual(pickup.actions,['crouch','melee']);
    assert.equal(pickup.pickup,type);
  }
  const close=situation({}, {x:50,midX:50},{weapons:[{id:20,x:2,y:96,type:'BAZOOKA',ammo:6,pickupRadius:14}]});
  assert.equal(chooseWeapon(close,...close.players,{}),null,'Avoid trading a usable pistol for a close-range rocket blast');
});

test('refills are collected between encounters instead of interrupting clear shots',()=>{
  const state=situation({ammo:4,aiming:true,aimMode:0}, {},{weapons:[{id:21,x:20,y:96,type:'PISTOL',ammo:12,pickupRadius:14}]});
  assert.equal(chooseWeapon(state,...state.players,{}).id,21);
  assert.equal(tacticalDecision(state,{},[],clear).fire,true);
  state.players[0].aiming=false;state.players[0].sight[0].directShot=false;
  assert.equal(tacticalDecision(state,{},[],clear).navigation.goal,'weapon');
});

test('map routes reject blocked connections and prefer a detour around fire',()=>{
  const world={nodes:[{id:0,x:0,y:0},{id:1,x:50,y:0,fire:true},{id:2,x:50,y:40},{id:3,x:100,y:0}],edges:[{from:0,to:1,type:3,cost:50},{from:1,to:3,type:3,cost:50},{from:0,to:2,type:4,cost:65},{from:2,to:3,type:3,cost:65}],objects:[]};
  assert.deepEqual(findRoute(world,world.nodes[0],world.nodes[3]).steps.map(s=>s.node.id),[0,2,3]);
  world.edges[2].blocked=true;
  assert.deepEqual(findRoute(world,world.nodes[0],world.nodes[3]).steps.map(s=>s.node.id),[0,1,3]);
  world.edges[0].blocked=true;
  assert.equal(findRoute(world,world.nodes[0],world.nodes[3]),null);
});

test('escaping an explosive uses a jump route instead of walking into a wall',()=>{
  const world={nodes:[{id:0,x:0,y:92},{id:1,x:45,y:52},{id:2,x:100,y:52}],edges:[{from:0,to:1,type:4,cost:60},{from:1,to:2,type:3,cost:55}],objects:[{id:30,x:-30,y:95,hp:5,explosive:true}],traps:[]};
  const state=situation({terrain:{rightWall:true,rightDrop:0}}, {aiming:true,ammo:12},{world});
  const result=tacticalDecision(state,{},[],clear);
  assert.equal(result.navigation.goal,'escape');
  assert.equal(result.navigation.type,4);
  assert.ok(result.actions.includes('jump'));
  assert.ok(result.actions.includes('right'));
});

test('connector targeting uses a real observed linked crate and protects the player below it',async()=>{
  const world=JSON.parse(await readFile(new URL('./test-fixtures/native-arena1-traps.json',import.meta.url),'utf8'));
  const trap=world.traps[0];
  assert.ok(trap?.platform,'The native bridge must export the connector and its linked crate');
  const px=trap.x-100,py=trap.y+30;
  const pitch=Math.atan2(trap.y-Math.max(1,trap.height/2-1)-(py-14),trap.x-(px-4))*180/Math.PI;
  const state=situation({x:px,y:py,midY:py-8,aiming:true,aimMode:0,aimPitch:pitch,sight:[{id:1,directShot:false}]},{x:trap.platform.x,y:trap.platform.y+65,midX:trap.platform.x,midY:trap.platform.y+57},{world:{...world,objects:[],nodes:[],edges:[]},weapons:[]});
  const result=tacticalDecision(state,{},[],clear);
  assert.equal(result.fire,true);
  assert.equal(result.targetKind,'trap');
  state.players[0].x=trap.platform.x;
  assert.notEqual(tacticalDecision(state,{},[],clear).targetKind,'trap');
});

test('grenades and stale grenade retreats cannot take control from gun pressure',()=>{
  const memory={grenade:{initialAmmo:3,started:0,reserve:30,pitch:0}};
  memory.retreatUntil=9999;
  const state=situation({grenades:3,aiming:true,aimMode:0}, {},{timeMs:2500});
  const result=tacticalDecision(state,memory,[],clear);
  assert.equal(memory.grenade,undefined);
  assert.equal(memory.retreatUntil,undefined);
  assert.ok(!result.actions.includes('grenade'));
  assert.equal(result.fire,true);
  for(const me of [{weapon:null,ammo:0},{sight:[{id:1,directShot:false}]},{burn:1},{bulletThreat:true},{rocketThreat:true}])
    assert.ok(!tacticalDecision(situation(me),{},['grenade'],clear).actions.includes('grenade'));
});

test('incoming projectiles and burn damage do not cancel a damaging shot to roll',()=>{
  for(const threat of [{bulletThreat:true},{rocketThreat:true},{burn:2}]) {
    const decision=tacticalDecision(situation({aiming:true,aimMode:0,...threat}),{},[],clear);
    assert.equal(decision.fire,true);
    assert.ok(!decision.dodge);
    assert.ok(!decision.actions.includes('crouch')&&!decision.actions.includes('jump'));
  }
  const cooling=tacticalDecision(situation({aiming:true,aimMode:0,weaponCooldown:2,bulletThreat:true}),{},[],clear);
  assert.deepEqual(cooling.actions,['shoot'],'Keep the aim held during cooldown instead of retreating');
  const available=tacticalDecision(situation({aiming:true,aimMode:0}),{lastFireAt:960},[],clear);
  assert.equal(available.fire,true,'Native cooldown, not an extra controller timer, sets the firing pace');
});

test('a rejected trigger release is re-armed without leaving an idle aiming loop',()=>{
  const state=situation({aiming:true,aimMode:0}, {},{keys:[[82,70,68,71,83,65,81,87,82,70,90]],inputHeld:[]});
  assert.deepEqual(tacticalDecision(state,{},[],clear).actions,['shoot']);
  state.inputHeld=[65];
  assert.equal(tacticalDecision(state,{},[],clear).fire,true);
  state.inputHeld=[];
  assert.deepEqual(tacticalDecision(state,{},[],clear).actions,['shoot']);
});

test('shared aim/jump keys do not create an airborne shooting loop',()=>{
  const state=situation({onGround:false,jumping:true}, {y:50,midY:42});
  assert.ok(!tacticalDecision(state,{},[],clear).actions.includes('shoot'));
  const grounded=situation({}, {y:50,midY:42});
  assert.deepEqual(tacticalDecision(grounded,{},[],clear).actions,['shoot'],'Enter aiming before pressing the shared aim-up key');
});

test('movement guards protect pits without issuing reactive dodge commands',()=>{
  const state=situation({bulletThreat:true,terrain:{leftDrop:1000,leftLanding:1000,rightDrop:0,rightLanding:0}});
  assert.deepEqual(tacticalDecision(state,{},[],clear).actions,['shoot']);
  const result=safeMovement(state.players[0],{actions:['left']},{});
  assert.deepEqual(result.actions,['right']);
  const planned=safeMovement({...state.players[0],terrain:{rightDrop:1000,rightLanding:60,leftDrop:0}},{actions:['right','jump'],navigation:{type:5}},{});
  assert.ok(planned.actions.includes('jump'),'A real planned gap jump must survive the ground guard');
  const flight=safeMovement({...state.players[0],onGround:false,vy:-4,terrain:{rightDrop:1000,leftDrop:6}},{actions:['right'],navigation:{type:5,targetY:110}},{});
  assert.deepEqual(flight.actions,['right'],'Do not reverse a planned jump immediately after takeoff');
});

test('standing on a small crate does not stall acquisition of the route source',()=>{
  const world={nodes:[{id:0,x:452,y:170},{id:1,x:500,y:170}],edges:[{from:0,to:1,type:3,cost:48}],objects:[]};
  const state=situation({x:455.65,y:158.65,midY:150.69}, {},{world});
  const result=navigate(state,state.players[0],{x:510,y:170,kind:'opponent'},{});
  assert.ok(result.actions.includes('right'));
  assert.equal(result.navigation.targetX,500);
});

test('unarmed close combat uses dive momentum and queues jump kicks',()=>{
  const state=situation({weapon:null,ammo:0,grenades:0,sprinting:true},{x:45,midX:45});
  assert.deepEqual(tacticalDecision(state,{},[],clear).actions,['right','sprint','crouch']);
  state.players[0].jumping=true;state.players[0].onGround=false;state.players[1].x=25;
  const memory={tick:1};
  assert.ok(tacticalDecision(state,memory,[],clear).actions.includes('melee'));
});
