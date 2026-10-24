import type {Input,RunConfig,Provider} from './domain';
import {hash,validateDecision} from './domain';
import type {Secrets} from './adapters';
import {adapter,retry} from './adapters';
import {evaluate,quantile,type Observation} from './evaluation';
export interface Env extends Secrets {DB:D1Database;RUN_WORKFLOW:Workflow<{run_id:string}>;ASSETS:Fetcher;ALLOW_PAID_MODELS?:string;MAX_LIVE_SAMPLE?:string}
export async function predictOne(input:Input,provider:Provider,env:Secrets){
  const model=adapter(provider,env),started=performance.now();let attempts=0;
  const meta={input_id:input.input_id,provider,model:model.model,model_version:model.version,kind:model.kind,prompt_version:'structured-evidence-v1',config_version:'precall-allowlist-v1'};
  try{
    const {value}=await retry(async()=>{attempts++;return model.predict(input);});
    const cost=attempts>1?null:value.cost_usd;
    const common={...meta,latency_ms:performance.now()-started,attempts,usage:value.usage,cost_usd:cost,cost_kind:attempts>1?'unknown':value.cost_kind};
    try{return {...common,status:'valid',decision:validateDecision(value.raw,input),error:null};}
    catch{return {...common,status:'invalid',decision:null,error:'Decision schema or evidence validation failed'};}
  }catch(e){return {...meta,latency_ms:performance.now()-started,attempts,usage:null,cost_usd:null,cost_kind:'unknown',status:e instanceof SyntaxError?'invalid':'error',decision:null,error:e instanceof SyntaxError?'Malformed provider JSON':e instanceof Error?e.message.slice(0,180):'Prediction failed'};}
}
export async function persist(db:D1Database,runId:string,input:Input,record:Awaited<ReturnType<typeof predictOne>>){
  await db.prepare('INSERT OR IGNORE INTO predictions(run_id,sample_id,provider,input_hash,snapshot_json,record_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(runId,input.input_id,record.provider,await hash(input),JSON.stringify(input),JSON.stringify(record),record.status,new Date().toISOString()).run();
}
export interface StoredPrediction {sample_id:string;provider:Provider;record_json:string;snapshot_json:string;input_hash:string;created_at:string;status:string;outcome?:number|null}
export async function scoreRun(db:D1Database,runId:string){
  const run=await db.prepare('SELECT * FROM runs WHERE id=?').bind(runId).first<{status:string;config_json:string;sample_ids_json:string}>();
  if(!run)throw new Error('Run not found');if(run.status!=='complete')throw new Error('Run is not complete');
  const config=JSON.parse(run.config_json) as RunConfig,ids=JSON.parse(run.sample_ids_json) as string[];
  const stored=(await db.prepare('SELECT * FROM predictions WHERE run_id=?').bind(runId).all<StoredPrediction>()).results;
  if(stored.length!==ids.length*config.providers.length)throw new Error('Incomplete prediction matrix');
  await db.prepare('INSERT OR IGNORE INTO outcomes(run_id,sample_id,outcome,revealed_at) SELECT ?,h.sample_id,h.outcome,? FROM hidden_labels h JOIN predictions p ON h.sample_id=p.sample_id WHERE p.run_id=? GROUP BY h.sample_id').bind(runId,new Date().toISOString(),runId).run();
  const labels=(await db.prepare('SELECT sample_id,outcome FROM outcomes WHERE run_id=?').bind(runId).all<{sample_id:string;outcome:number}>()).results;
  const outcomes=new Map(labels.map(r=>[r.sample_id,r.outcome]));
  const shared=ids.filter(id=>config.providers.every(provider=>stored.some(r=>r.sample_id===id&&r.provider===provider&&r.status==='valid')));
  return {threshold:config.threshold,requested:ids.length,shared_valid:shared.length,warning:shared.length<200?'Small shared sample: calibration estimates are unstable.':'Historical evaluation; temporal shift and LLM contamination remain possible.',models:config.providers.map(provider=>{
    const all=stored.filter(r=>r.provider===provider);const valid=all.filter(r=>r.status==='valid');
    const rows=valid.filter(r=>shared.includes(r.sample_id)).map(r=>{const v=JSON.parse(r.record_json);return {probability:v.decision.probability,outcome:outcomes.get(r.sample_id)!,latency_ms:v.latency_ms,cost_usd:v.cost_usd} as Observation;});
    const records=all.map(r=>JSON.parse(r.record_json));
    const latency=records.map(r=>r.latency_ms as number);
    const costs=records.every(r=>r.cost_usd!==null)?records.reduce((s,r)=>s+r.cost_usd,0):null;
    return {provider,kind:records[0]?.kind,invalid:all.filter(r=>r.status==='invalid').length,errors:all.filter(r=>r.status==='error').length,valid:valid.length,coverage:valid.length/ids.length,...evaluate(rows,config.threshold),median_ms:quantile(latency,.5),p95_ms:quantile(latency,.95),cost_per_valid:costs!==null&&valid.length?costs/valid.length:null,cost_note:provider==='mock'||provider==='constant'||provider==='baseline'?'API cost only; excludes local compute':'Estimated from configured rates when available; unknown after retries'};
  })};
}
