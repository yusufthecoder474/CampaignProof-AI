import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='http://127.0.0.1:8787/api';let assertions=0;
function check(value,message){assert(value,message);assertions++;}
async function call(path,options){const r=await fetch(base+path,options);return {status:r.status,body:await r.json()};}
const config={providers:['mock'],size:20,seed:474,threshold:.5};
const key='smoke-'+crypto.randomUUID();
const options={method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify(config)};
const health=await call('/health');check(health.body.status==='ready','D1 ready with data');
const paid=await call('/runs',{...options,headers:{...options.headers,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...config,providers:['claude'],confirm_paid:true})});check(paid.status===403,'Paid calls disabled');
const malformed=await call('/runs',{...options,body:'{'});check(malformed.status===400,'Malformed JSON rejected');
const a=await call('/runs',options);check(a.status===202,'Run accepted');const id=a.body.id;
const early=await call('/runs/'+'e'.repeat(32)+'/score',{method:'POST'});check(early.status===409,'Scoring queued fixture is blocked');
const b=await call('/runs',options);check(b.body.id===id&&b.body.reused===true,'Duplicate run reuses same ID');
const conflict=await call('/runs',{...options,body:JSON.stringify({...config,seed:1})});check(conflict.status===409,'Conflicting idempotency parameters rejected');
let state;
for(let i=0;i<100;i++){
 state=await call('/runs/'+id);if(['complete','failed'].includes(state.body.status))break;
 await new Promise(r=>setTimeout(r,500));
}
check(state.body.status==='complete','Cloudflare local Workflow complete');
const before=await call('/runs/'+id+'/results');check(before.body.records.length===60,'Exactly one record per sample/provider');check(before.body.records.every(r=>r.outcome===null),'Outcomes hidden before score');
check(before.body.records.filter(r=>r.provider==='mock').every(r=>r.record.kind==='mock'),'Mock labeled');
check(before.body.records.every(r=>r.record.status==='valid'),'Offline outputs validated');
const scored=await call('/runs/'+id+'/score',{method:'POST'});check(scored.status===200&&scored.body.shared_valid===20,'Shared valid intersection scored');
check(scored.body.models.length===3,'Both statistical baselines included');
const after=await call('/runs/'+id+'/results');check(after.body.records.every(r=>r.outcome===0||r.outcome===1),'Genuine historical outcomes revealed');
const twice=await call('/runs/'+id+'/score',{method:'POST'});check(JSON.stringify(twice.body)===JSON.stringify(scored.body),'Repeated scoring idempotent');
for(const m of scored.body.models){const rows=after.body.records.filter(r=>r.provider===m.provider);const hand=rows.reduce((s,r)=>s+(r.record.decision.probability-r.outcome)**2,0)/20;check(Math.abs(hand-m.brier)<1e-14,'API Brier matches independent computation');}
const again=await call('/runs',options);check(again.body.id===id,'Completed request still reused');
const final=await call('/runs/'+id+'/results');check(final.body.records.length===60,'Repeated request creates no duplicate writes');
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/local-smoke.json',JSON.stringify({executed_at:new Date().toISOString(),environment:'Wrangler local D1 + Workflows',assertions,run_id:id,report:scored.body},null,2));
console.log(JSON.stringify({assertions,report:scored.body},null,2));
