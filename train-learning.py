"""Train a compact forest locally; export ordinary JSON for offline browser use."""
import sys,json,hashlib,platform
from pathlib import Path
from datetime import datetime,timezone
root=Path(__file__).resolve().parent
sys.path.insert(0,str(root/'tools'/'learning'))
import numpy as np
import sklearn
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.metrics import f1_score,accuracy_score

dataset_path=root/'tools'/'training'/'dataset.json'
data=json.loads(dataset_path.read_text())
digest=hashlib.sha256(dataset_path.read_bytes()).hexdigest()
current_path=root/'models'/'human-model.json'
previous=json.loads(current_path.read_text()) if current_path.exists() else None
if previous and previous['report']['datasetSha256']==digest:
    print('No new human-play examples were found. Your existing trained model is already up to date.')
    sys.exit(0)
matches=sorted(data['matches'],key=lambda m:m['id'])
# Separate full matches within each arena, reproducibly. Never mix frames of one match.
validation=[]
known=set(previous['report']['trainingMatchIds']+previous['report']['validationMatchIds']) if previous else set()
if previous:validation.extend(previous['report']['validationMatchIds'])
for arena in sorted(set(m['arena'] for m in matches)):
    group=[m for m in matches if m['arena']==arena and m['rows'] and m['id'] not in known]
    group.sort(key=lambda m:hashlib.sha256(('split-v1'+m['id']).encode()).hexdigest())
    count=max(1,round(len(group)*.23)) if not previous and group else round(len(group)*.23)
    validation.extend(m['id'] for m in group[:count])
validation=set(validation)&set(m['id'] for m in matches if m['rows'])
X=np.array([r['x'] for r in data['rows']],dtype=np.float32)
Y=np.array([r['y'] for r in data['rows']],dtype=np.uint8)
weights=np.array([r['weight'] for r in data['rows']],dtype=np.float32)
test=np.array([r['match'] in validation for r in data['rows']])
model=ExtraTreesClassifier(n_estimators=48,max_depth=14,min_samples_leaf=5,max_features=.8,n_jobs=4,random_state=1701)
model.fit(X[~test],Y[~test],sample_weight=weights[~test])
def probabilities(x):
    result=model.predict_proba(x)
    return np.stack([p[:,list(c).index(1)] if 1 in c else np.zeros(len(x)) for p,c in zip(result,model.classes_)],axis=1)
p=probabilities(X[test])
# Fixed decision thresholds selected on training data only; report untouched validation.
train_p=probabilities(X[~test]);thresholds=[]
for i in range(Y.shape[1]):
    candidates=[.3,.4,.5,.6]
    scores=[f1_score(Y[~test,i],train_p[:,i]>=t,zero_division=0) for t in candidates]
    thresholds.append(candidates[int(np.argmax(scores))])
pred=p>=thresholds
per_action={action:{'f1':round(float(f1_score(Y[test,i],pred[:,i],zero_division=0)),4),'examples':int(Y[test,i].sum()),'threshold':thresholds[i]} for i,action in enumerate(data['actions'])}
report={'trainedAt':datetime.now(timezone.utc).isoformat(),'algorithm':'ExtraTreesClassifier','library':sklearn.__version__,
 'datasetSha256':digest,'target':'held game keys at next sample (15–250 ms ahead)',
 'matches':len(matches),'trainingMatches':len(matches)-len(validation),'validationMatches':len(validation),
 'trainingRows':int((~test).sum()),'validationRows':int(test.sum()),'arenas':sorted(set(m['arena'] for m in matches)),
 'validationMatchIds':sorted(validation),'trainingMatchIds':[m['id'] for m in matches if m['id'] not in validation],
 'validationMicroF1':float(f1_score(Y[test],pred,average='micro',zero_division=0)),
 'validationExactActionAccuracy':float(accuracy_score(Y[test],pred)),
 'idleBaselineExactActionAccuracy':float(np.mean(np.all(Y[test]==0,axis=1))),
 'perAction':per_action,'meaning':'Predicting demonstration actions does not establish match win rate.'}
trees=[]
for estimator in model.estimators_:
    t=estimator.tree_
    leaf=[]
    for node in range(t.node_count):
        if t.children_left[node]==-1:
            leaf.append([round(float(t.value[node,i,list(c).index(1)]/max(1e-12,t.value[node,i].sum())),5) if 1 in c else 0 for i,c in enumerate(model.classes_)])
        else:leaf.append(None)
    trees.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':t.feature.tolist(),'threshold':np.round(t.threshold,5).tolist(),'value':leaf})
artifact={'schema':1,'version':'human-'+digest[:8],'featureNames':data['featureNames'],'actions':data['actions'],'thresholds':thresholds,'trees':trees,'report':report}
out=root/'models'
out.mkdir(exist_ok=True)
# Keep old versions available when retraining, then atomically replace the current model.
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
encoded=json.dumps(artifact,separators=(',',':'))
(out/f'human-{stamp}.json').write_text(encoded)
if previous and previous['featureNames']==data['featureNames']:
    # Compare both forests on exactly the same untouched matches. Existing held-out
    # matches stay held out in later training runs; bot trajectories never enter data.
    old_prob=np.zeros((int(test.sum()),Y.shape[1]))
    test_x=X[test]
    for tree in previous['trees']:
        left=np.array(tree['left']);right=np.array(tree['right']);feat=np.array(tree['feature']);th=np.array(tree['threshold'])
        nodes=np.zeros(len(test_x),dtype=np.int32)
        active=left[nodes]!=-1
        while np.any(active):
            ix=np.flatnonzero(active);nd=nodes[ix]
            nodes[ix]=np.where(test_x[ix,feat[nd]]<=th[nd],left[nd],right[nd])
            active=left[nodes]!=-1
        values=np.array([v if v is not None else [0]*Y.shape[1] for v in tree['value']])
        old_prob+=values[nodes]/len(previous['trees'])
    old_f1=float(f1_score(Y[test],old_prob>=previous['thresholds'],average='micro',zero_division=0))
    attempt={'candidate':report,'previousModelF1OnSameMatches':old_f1,'promoted':report['validationMicroF1']>=old_f1,
             'gate':'Held-out action prediction only; live match evaluation is a separate check.'}
    (out/'latest-training-attempt.json').write_text(json.dumps(attempt,indent=2))
    if not attempt['promoted']:
        print(f"Candidate F1 {report['validationMicroF1']:.3f}; current model {old_f1:.3f} on the same held-out matches.")
        print('The current model performed better, so it was kept. The new candidate was saved separately.')
        sys.exit(0)
(out/'human-model.pending.json').write_text(encoded)
(out/'human-model.pending.json').replace(out/'human-model.json')
(out/'training-report.json').write_text(json.dumps(report,indent=2))
# Real held-out examples check parity between Python training and JavaScript inference.
indices=np.flatnonzero(test)[::max(1,int(test.sum())//24)][:24]
fixtures=[{'x':X[i].tolist(),'probabilities':probabilities(X[i:i+1])[0].tolist()} for i in indices]
(root/'tools'/'training'/'parity.json').write_text(json.dumps(fixtures))
print(json.dumps({k:report[k] for k in ['matches','trainingMatches','validationMatches','trainingRows','validationRows','validationMicroF1','validationExactActionAccuracy','idleBaselineExactActionAccuracy','perAction']},indent=2))
