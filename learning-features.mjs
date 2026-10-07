// Shared by dataset export and browser inference: no future information enters features.
export const actions = ['up','down','left','right','melee','shoot','grenade','powerup','sprint'];
export const bindingIndices = [0,1,2,3,4,5,6,7,10];
const weapons = ['PISTOL','SHOTGUN','UZI','RIFLE','BAZOOKA','FLAMETHROWER','SNIPER','MAGNUM'];
export const featureNames = [
  ...Array.from({length:6},(_,i)=>`arena${i+1}`),
  'x','y','enemyX','enemyY','dx','dy','distance','facingEnemy','hp','enemyHp','stamina','burn',
  'onGround','aiming','aimTurnDelay','kneeling','knockedDown','climbing','canGrab','ammo','grenades',
  'range','meleeRange','pitch','pitchError','cooldown','clearShot','alignment','vx','vy','enemyVx','enemyVy',
  'enemyFacingUs','enemyAiming','enemyOnGround','enemyKnockedDown','enemyBurn','enemyAmmo','enemyPitch',
  'observedVx','observedVy','observedEnemyVx','observedEnemyVy',
  'armed','enemyArmed',...weapons.map(w=>`weapon_${w}`)
];
const n = (value,fallback=0) => Number.isFinite(value)?value:fallback;
const b = value => value?1:0;
export function actors(state) {
  const me=state.players?.find(p=>!p.bot);
  const enemy=me&&state.players.filter(p=>p.id!==me.id&&p.hp>0&&!p.gone&&p.team!==me.team)
    .sort((a,b)=>Math.hypot(a.x-me.x,a.y-me.y)-Math.hypot(b.x-me.x,b.y-me.y))[0];
  return {me,enemy};
}
export function features(state,previous=null) {
  const {me:p,enemy:e}=actors(state);
  if(!p||!e)return null;
  const px=n(p.midX,p.x),py=n(p.midY,p.y-8),ex=n(e.midX,e.x),ey=n(e.midY,e.y-8);
  const dx=ex-px,dy=ey-py,dir=dx<0?-1:1;
  const angle=Math.atan2(ey-(p.y-14),Math.abs(ex-(p.x-p.facing*4)))*180/Math.PI;
  const sight=p.sight?.find(s=>s.id===e.id);
  const old=previous&&actors(previous),dt=previous?state.timeMs-previous.timeMs:0;
  const velocity=(key,who)=>dt>0&&dt<500&&old?.[who]?Math.max(-1000,Math.min(1000,(actors(state)[who][key]-old[who][key])*1000/dt)):0;
  return [
    ...Array.from({length:6},(_,i)=>b(state.map===i+2)),
    p.x,p.y,e.x,e.y,dx,dy,Math.hypot(dx,dy),b(p.facing===dir),p.hp,e.hp,p.stamina,p.burn,
    b(p.onGround),b(p.aiming),b(p.aimTurnDelay),b(p.kneeling),b(p.knockedDown),b(p.climbing),b(p.canGrab),p.ammo,p.grenades,
    p.range,p.meleeRange,p.aimPitch,p.aimPitch-angle,p.weaponCooldown,b(sight?.clearShot),n(sight?.aimAlignment),p.vx,p.vy,e.vx,e.vy,
    b(e.facing===-dir),b(e.aiming),b(e.onGround),b(e.knockedDown),e.burn,e.ammo,e.aimPitch,
    velocity('x','me'),velocity('y','me'),velocity('x','enemy'),velocity('y','enemy'),
    b(p.weapon&&p.ammo>0),b(e.weapon&&e.ammo>0),...weapons.map(w=>b(p.weapon===w))
  ].map(v=>n(v));
}
export function labels(state) {
  const held=new Set(state.playerInput??[]),keys=state.keys?.[0]??[];
  return bindingIndices.map((index,i)=>b(held.has(keys[index]) || (i===0&&held.has(keys[8])) || (i===1&&held.has(keys[9]))));
}
