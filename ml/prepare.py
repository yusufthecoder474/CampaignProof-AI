"""Download original UCI data, validate, split in original row order, export scorer."""
from pathlib import Path
import hashlib, io, json, zipfile, urllib.request
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, accuracy_score

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'bank-additional-full.csv'
CATS = ['job','education','housing','loan','contact','month','day_of_week','poutcome']
NUMS = ['previous','pdays']
FEATURES = CATS + NUMS
SOURCE = 'https://archive.ics.uci.edu/static/public/222/bank+marketing.zip'

def download():
    if DATA.exists(): return
    DATA.parent.mkdir(exist_ok=True)
    outer = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(SOURCE, timeout=60).read()))
    inner = zipfile.ZipFile(io.BytesIO(outer.read('bank-additional.zip')))
    for n in inner.namelist():
        if n.endswith(('bank-additional-full.csv','bank-additional-names.txt')):
            (DATA.parent / Path(n).name).write_bytes(inner.read(n))

def parse(path):
    df = pd.read_csv(path, sep=';')
    if not set(FEATURES + ['y','duration']).issubset(df.columns): raise ValueError('Missing required columns')
    if not df.y.isin(['yes','no']).all() or df[FEATURES].isna().any().any(): raise ValueError('Invalid data')
    for col in NUMS:
        if not np.isfinite(df[col]).all() or (df[col] < 0).any(): raise ValueError('Invalid numeric feature')
    for col in CATS:
        if not df[col].map(lambda x: isinstance(x,str) and 0 < len(x) <= 40).all(): raise ValueError('Invalid category')
    return df

def split(df):
    a,b = int(len(df)*.6), int(len(df)*.8)
    return df.iloc[:a], df.iloc[a:b], df.iloc[b:]

def score_export(artifact, row):
    z = artifact['intercept']
    for f, cats, weights in zip(CATS,artifact['categories'],artifact['categorical_weights']):
        z += weights[cats.index(row[f])] if row[f] in cats else 0
    for i,f in enumerate(NUMS): z += ((float(row[f])-artifact['means'][i])/artifact['scales'][i])*artifact['numeric_weights'][i]
    return float(1/(1+np.exp(-z)))

def main():
    download(); df=parse(DATA)
    if len(df)!=41188: raise ValueError('Expected original full 41,188-row dataset')
    train,validation,test=split(df)
    prep=ColumnTransformer([('cats',OneHotEncoder(handle_unknown='ignore'),CATS),('nums',StandardScaler(),NUMS)])
    # Fixed configuration selected before viewing test scores. No class weights distort probabilities.
    model=Pipeline([('features',prep),('lr',LogisticRegression(C=1,max_iter=2000,random_state=474))])
    model.fit(train[FEATURES],(train.y=='yes').astype(int))
    enc=model['features'].named_transformers_['cats']; scaler=model['features'].named_transformers_['nums']
    co=model['lr'].coef_[0]; pos=0; weights=[]
    for cats in enc.categories_: weights.append(co[pos:pos+len(cats)].tolist()); pos+=len(cats)
    sha=hashlib.sha256(DATA.read_bytes()).hexdigest()
    artifact={'version':'logreg-v1-'+sha[:12],'dataset_sha256':sha,'intercept':float(model['lr'].intercept_[0]),'categories':[x.tolist() for x in enc.categories_], 'categorical_weights':weights,'means':scaler.mean_.tolist(),'scales':scaler.scale_.tolist(),'numeric_weights':co[pos:].tolist(),'base_rate':float((train.y=='yes').mean())}
    out=ROOT/'artifacts';out.mkdir(exist_ok=True)
    (out/'baseline.json').write_text(json.dumps(artifact,indent=2))
    predictions=model.predict_proba(test[FEATURES])[:,1]; y=(test.y=='yes').astype(int).to_numpy()
    exported=np.array([score_export(artifact,row) for row in test[FEATURES].to_dict('records')])
    error=float(abs(predictions-exported).max()); assert error<1e-12
    report={'dataset':'UCI Bank Marketing / bank-additional-full.csv','data_kind':'historical','sha256':sha,'rows':len(df),'train':len(train),'validation':len(validation),'test':len(test),'threshold':.5,'features':FEATURES,'excluded':['duration','campaign','age','marital','default','emp.var.rate','cons.price.idx','cons.conf.idx','euribor3m','nr.employed'],'train_base_rate':artifact['base_rate'],'test_observed_rate':float(y.mean()),'logistic_brier':float(brier_score_loss(y,predictions)),'constant_brier':float(brier_score_loss(y,np.full(len(y),artifact['base_rate']))),'logistic_accuracy':float(accuracy_score(y,predictions>=.5)),'constant_accuracy':float(accuracy_score(y,np.full(len(y),artifact['base_rate'])>=.5)),'python_export_max_error':error,'validation_brier':float(brier_score_loss((validation.y=='yes').astype(int),model.predict_proba(validation[FEATURES])[:,1])),'live_llm_evaluation':'not run'}
    (out/'evaluation.json').write_text(json.dumps(report,indent=2))
    # Fixed pool sampled without labels from the held-out tail; every provider uses this same pool.
    pool=test.sample(n=500,random_state=474).sort_index()
    sql=[]
    def q(s): return "'"+str(s).replace("'","''")+"'"
    for idx,row in pool.iterrows():
        sid=f'uci-{idx+1:05d}'; features={f:row[f] for f in FEATURES}; text=json.dumps(features,sort_keys=True)
        sql.append(f'INSERT OR IGNORE INTO samples(id,features_json,data_kind) VALUES({q(sid)},{q(text)},\'historical\');')
        sql.append(f'INSERT OR IGNORE INTO hidden_labels(sample_id,outcome) VALUES({q(sid)},{int(row.y=="yes")});')
    (out/'seed.sql').write_text('\n'.join(sql)+'\n')
    parity=[{'input_id':f'uci-{i+1:05d}','features':{f:row[f] for f in FEATURES},'expected':float(p)} for (i,row),p in zip(test.iloc[:256].iterrows(),predictions[:256])]
    (out/'parity.json').write_text(json.dumps(parity))
    (out/'pool.json').write_text(json.dumps([f'uci-{i+1:05d}' for i in pool.index]))
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
