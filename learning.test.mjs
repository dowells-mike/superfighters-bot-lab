import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {features,labels,featureNames} from './learning-features.mjs';
import {predict,createLearnedPolicy} from './learned-policy.mjs';
const model=JSON.parse(await readFile(new URL('./models/example-model.json',import.meta.url),'utf8'));
test('browser probabilities agree with Python on real held-out observations',async()=>{
  const fixtures=JSON.parse(await readFile(new URL('./test-fixtures/inference-parity.json',import.meta.url),'utf8'));
  for(const example of fixtures) {
    const probabilities=predict(model,example.x);
    probabilities.forEach((p,i)=>assert.ok(Math.abs(p-example.probabilities[i])<.00002));
  }
});
test('whole-match holdout is separate from training and uses recorded arenas',()=>{
  const r=model.report;
  assert.ok(r.validationRows>1000&&r.trainingRows>1000);
  assert.equal(r.trainingMatchIds.filter(id=>r.validationMatchIds.includes(id)).length,0);
  assert.ok(r.arenas.length>=5&&r.arenas.every(arena=>arena>=1&&arena<=6));
  assert.ok(r.validationExactActionAccuracy>r.idleBaselineExactActionAccuracy);
});
test('learned controller handles real observations and releases all keys after a round',async()=>{
  const sample=JSON.parse(await readFile(new URL('./test-fixtures/active-match.json',import.meta.url),'utf8'));
  assert.equal(features(sample).length,featureNames.length);
  assert.ok(features(sample).every(Number.isFinite));
  assert.equal(labels(sample).length,9);
  const policy=createLearnedPolicy(model),memory={};
  assert.ok(Array.isArray(policy(sample,memory).actions));
  assert.deepEqual(policy({...sample,roundOver:true},memory).actions,[]);
});
