import {features,actors,actions,featureNames} from './learning-features.mjs';
import {tacticalDecision} from './combat-tactics.mjs';
export function predict(model,x) {
  const result=Array(model.actions.length).fill(0);
  for(const tree of model.trees) {
    let i=0;
    while(tree.left[i]!==-1)i=x[tree.feature[i]]<=tree.threshold[i]?tree.left[i]:tree.right[i];
    for(let j=0;j<result.length;j++)result[j]+=tree.value[i][j]/model.trees.length;
  }
  return result;
}
export function createLearnedPolicy(model,{assist=true,trace}={}) {
  if(model.schema!==1||JSON.stringify(model.featureNames)!==JSON.stringify(featureNames))throw new Error('Training model does not match this controller. Retrain the model.');
  return (state,memory={})=>{
    const {me:p,enemy:e}=actors(state);
    if(!p||!e||p.hp<=0||p.gone||state.roundOver||!state.ready||state.menuDemo)return {actions:[],reason:'Waiting for an active match'};
    const previous=memory.previous;
    const probabilities=predict(model,features(state,previous));
    memory.previous=state;
    const selected=actions.filter((action,i)=>action!=='grenade'&&probabilities[i]>=model.thresholds[i]);
    for(const [a,b] of [['left','right'],['up','down']])if(selected.includes(a)&&selected.includes(b))selected.splice(selected.indexOf(probabilities[actions.indexOf(a)]>=probabilities[actions.indexOf(b)]?b:a),1);
    if(!p.aiming) {
      if(selected.includes('up'))selected.push('jump');
      if(selected.includes('down'))selected.push('crouch');
    }
    if(p.grenades<=0&&selected.includes('grenade'))selected.splice(selected.indexOf('grenade'),1);
    if(!assist)return {actions:selected,reason:'Following your learned movement and combat patterns',probabilities};
    return {...tacticalDecision(state,memory,selected,{trace},previous),probabilities};
  };
}
