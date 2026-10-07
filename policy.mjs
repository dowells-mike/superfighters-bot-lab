// Initial policy for validating normal keyboard control. It uses read-only observations.
export function decide(state, memory = {}) {
  const player = state.players.find(p => !p.bot);
  if (!player || player.hp <= 0 || player.gone || state.menuDemo || state.roundOver || !state.ready)
    return { actions: [], reason: state.roundOver ? 'Round finished' : 'Waiting for an active match' };
  const enemies = state.players.filter(p => p.id !== player.id && p.hp > 0 && !p.gone && (player.team === 0 || p.team !== player.team));
  enemies.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
  const enemy = enemies[0];
  if (!enemy) return { actions: [], reason: 'No opponent left' };
  const dx = enemy.midX - player.midX;
  const dy = enemy.midY - player.midY;
  const distance = Math.hypot(dx, dy);
  const direction = dx < 0 ? -1 : 1;
  const actions = [];
  const time = state.timeMs;
  const pulse = time % 400 < 140;
  if (player.burn > 0) {
    actions.push('crouch');
    if (pulse) actions.push(direction < 0 ? 'left' : 'right');
    return { actions, reason: 'Trying to extinguish fire' };
  }
  if (distance < Math.max(24, player.meleeRange + 5) && Math.abs(dy) < 24) {
    if (player.facing !== direction) actions.push(direction < 0 ? 'left' : 'right');
    if (pulse) actions.push('melee');
    return { actions, reason: 'Close-range melee' };
  }
  const clearShot = player.sight?.find(s => s.id === enemy.id)?.clearShot;
  if (player.weapon && player.ammo > 0 && distance < player.range * .85 && clearShot) {
    if (player.facing !== direction) {
      actions.push(direction < 0 ? 'left' : 'right');
      return { actions, reason: 'Turning toward opponent' };
    }
    const angle = Math.atan2(enemy.midY-(player.y-14), Math.abs(enemy.midX-(player.x-player.facing*4))) * 180 / Math.PI;
    // This game fires on release of the shooting key after aiming.
    if (player.aiming && memory.wasShooting && !player.aimTurnDelay && player.weaponCooldown <= 0 && Math.abs(player.aimPitch-angle)<5) {
      memory.wasShooting=false;
      return {actions:[],reason:'Releasing the trigger to fire'};
    }
    actions.push('shoot');
    memory.wasShooting=true;
    if (player.aimPitch > angle + 3) actions.push('up');
    else if (player.aimPitch < angle - 3) actions.push('down');
    return { actions, reason: 'Aiming at opponent' };
  }
  memory.wasShooting=false;
  actions.push(direction < 0 ? 'left' : 'right');
  if (memory.lastX !== undefined && Math.abs(player.x - memory.lastX) < 1) memory.stuck = (memory.stuck ?? 0) + 1;
  else memory.stuck = 0;
  memory.lastX = player.x;
  if ((dy < -25 || memory.stuck > 10) && player.onGround && pulse) actions.push('jump');
  return { actions, reason: 'Approaching opponent' };
}
