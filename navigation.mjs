const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function riskAt(point,world) {
  let risk=0;
  for(const o of world?.objects??[]) {
    if(!o.explosive&&!o.burning&&!o.active)continue;
    const d=distance(point,o),radius=o.active?95:o.burning?65:65;
    if(d<radius)risk+=(radius-d)*(o.active?8:o.burning?5:2);
  }
  return risk;
}
// Own route planner over read-only map connections; no CPU controls are reused.
export function findRoute(world,from,to) {
  if(!world?.nodes?.length)return null;
  const valid=world.nodes.filter(n=>!n.locked&&!n.blocked);
  const nearest=point=>valid.reduce((best,n)=>!best||Math.hypot(n.x-point.x,(n.y-point.y)*1.7)<Math.hypot(best.x-point.x,(best.y-point.y)*1.7)?n:best,null);
  const start=nearest(from),finish=nearest(to);
  if(!start||!finish)return null;
  const nodes=new Map(world.nodes.map(n=>[n.id,n]));
  const adjacent=new Map();
  for(const edge of world.edges) {
    if(edge.blocked||nodes.get(edge.to)?.blocked||nodes.get(edge.to)?.locked)continue;
    if(!adjacent.has(edge.from))adjacent.set(edge.from,[]);
    adjacent.get(edge.from).push(edge);
  }
  const costs=new Map([[start.id,0]]),previous=new Map(),open=new Set([start.id]);
  while(open.size) {
    let id;for(const candidate of open)if(id===undefined||costs.get(candidate)<costs.get(id))id=candidate;
    open.delete(id);if(id===finish.id)break;
    for(const edge of adjacent.get(id)??[]) {
      const target=nodes.get(edge.to);if(!target)continue;
      const cost=costs.get(id)+Math.max(3,edge.cost)+(target.fire?1500:0)+(target.hazard?800:0)+riskAt(target,world)+(edge.type===7?20:0);
      if(cost<(costs.get(edge.to)??Infinity)) {costs.set(edge.to,cost);previous.set(edge.to,{from:id,edge});open.add(edge.to);}
    }
  }
  if(!costs.has(finish.id))return null;
  const steps=[];let id=finish.id;
  while(id!==start.id) {const step=previous.get(id);if(!step)return null;steps.unshift({node:nodes.get(id),edge:step.edge});id=step.from;}
  steps.unshift({node:start,edge:null});
  return {steps,cost:costs.get(finish.id)+distance(from,start)+distance(to,finish)};
}
export function navigate(state,p,goal,memory,learned=[]) {
  const world=state.world??memory.world;
  const point={x:p.x,y:p.midY??p.y-8},time=state.timeMs;
  const goalKey=goal.id??`${goal.kind}:${Math.round(goal.x/25)},${Math.round(goal.y/25)}`;
  if(!memory.route||memory.route.goalKey!==goalKey||time-memory.route.at>450) {
    const plan=findRoute(world,point,goal);
    memory.route={goalKey,at:time,plan,index:0};
  }
  const cached=memory.route,plan=cached.plan;
  let target=goal,edge=null;
  // Nodes are authored a few pixels below the player's centre. Standing on a
  // movable crate can lift that centre by another 15px without blocking travel.
  const reached=node=>Math.abs(point.x-node.x)<9&&point.y-node.y>=-22&&point.y-node.y<=9;
  if(plan?.steps.length) {
    while(cached.index<plan.steps.length-1&&reached(plan.steps[cached.index].node))cached.index++;
    const step=plan.steps[cached.index];target=step.node;edge=step.edge;
    if(cached.index===plan.steps.length-1&&reached(target))target=goal;
  }
  const dx=target.x-p.x,dy=target.y-point.y,direction=dx<0?'left':'right';
  let actions=Math.abs(dx)>4?[direction]:[];
  const wall=dx<0?p.terrain?.leftWall:p.terrain?.rightWall;
  const pulse=Math.floor(time/120)%2===0;
  const type=edge?.type;
  if(type===8) {actions=Math.abs(dx)>7?[direction]:[];actions.push(dy<0?'up':'down');}
  else if(type===6&&p.onGround) {if(pulse)actions.push('down');}
  else if(type===7&&p.onGround) {actions.push('sprint');if(p.sprinting&&p.canDive)actions.push('crouch');}
  else if(type===10)actions.push('crouch');
  else if((type===4||type===5||dy<-20||wall)&&p.onGround&&!p.jumping) {
    if(type===5)actions.push('sprint');
    if(pulse&&(type!==5||p.sprinting||!p.canDive))actions.push('jump');
  }
  if(!edge&&learned.includes('sprint')&&p.stamina>30&&Math.abs(dx)>35)actions.push('sprint');
  return {actions,reason:goal.kind==='weapon'?'Following a route to a useful weapon':'Following map connections around obstructions',navigation:{goal:goal.kind,type:type??null,targetX:target.x,targetY:target.y,planned:Boolean(plan)}};
}
export function safeMovement(p,result,world) {
  const t=p.terrain;if(!t)return result;
  const moving=result.actions.includes('right')?1:result.actions.includes('left')?-1:0;
  const drift=!p.onGround&&p.vy>0?(p.vx>1?1:p.vx<-1?-1:0):0,direction=moving||drift;
  if(!direction)return result;
  const drop=direction>0?t.rightDrop:t.leftDrop,back=direction>0?t.leftDrop:t.rightDrop;
  const plannedJump=[4,5,7,6,9].includes(result.navigation?.type);
  const plannedFlight=plannedJump&&(p.onGround||p.vy<=0||(p.midY??p.y-8)<result.navigation.targetY+18);
  if(drop>60&&back<45&&!plannedFlight&&(!p.onGround||(direction>0?t.rightLanding:t.leftLanding)>40)) {
    return {...result,actions:[direction>0?'left':'right'],reason:'Steering back toward solid ground'};
  }
  if((direction>0?t.fireRight:t.fireLeft)&&!(direction>0?t.fireLeft:t.fireRight)) {
    return {...result,actions:[direction>0?'left':'right'],reason:'Moving away from spreading fire'};
  }
  return result;
}
