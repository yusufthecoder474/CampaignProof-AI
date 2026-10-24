import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from 'cloudflare:workers';
import {InputSchema,RunSchema,hash,sampleIds,type RunConfig} from './domain';
import {adapter} from './adapters';
import {persist,predictOne,scoreRun,type Env} from './storage';

export class PredictionWorkflow extends WorkflowEntrypoint<Env,{run_id:string}> {
  async run(event:WorkflowEvent<{run_id:string}>,step:WorkflowStep){
    const id=event.payload.run_id;
    try{
      const run=await step.do('load run',async()=>{
        await this.env.DB.prepare("UPDATE runs SET status='running' WHERE id=? AND status='queued'").bind(id).run();
        const row=await this.env.DB.prepare('SELECT config_json,sample_ids_json FROM runs WHERE id=?').bind(id).first<{config_json:string;sample_ids_json:string}>();
        if(!row)throw new Error('Missing run');return row;
      });
      const config=JSON.parse(run.config_json) as RunConfig,ids=JSON.parse(run.sample_ids_json) as string[];
      for(const sid of ids){
        const input=await step.do(`input ${sid}`,async()=>{
          const row=await this.env.DB.prepare('SELECT features_json FROM samples WHERE id=?').bind(sid).first<{features_json:string}>();
          if(!row)throw new Error('Missing sample');return InputSchema.parse({input_id:sid,features:JSON.parse(row.features_json)});
        });
        for(const provider of config.providers){
          // Provider helper owns bounded retries. Schema errors return terminal records.
          const record=await step.do(`predict ${sid} ${provider}`,{retries:{limit:0,delay:'1 second'},timeout:'1 minute'},()=>predictOne(input,provider,this.env));
          await step.do(`store ${sid} ${provider}`,{retries:{limit:2,delay:'1 second',backoff:'exponential'}},()=>persist(this.env.DB,id,input,record));
        }
      }
      await step.do('complete',async()=>{await this.env.DB.prepare("UPDATE runs SET status='complete' WHERE id=?").bind(id).run();});
    }catch{
      await step.do('record workflow failure',{retries:{limit:2,delay:'1 second'}},async()=>{await this.env.DB.prepare("UPDATE runs SET status='failed',error='Workflow execution failed; inspect local Wrangler logs' WHERE id=?").bind(id).run();});
      throw new Error('Workflow execution failed');
    }
  }
}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    try{
      if(request.method==='GET'&&path==='/api/health'){
        const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM samples').first<{n:number}>();
        return json({status:count&&count.n>0?'ready':'data-not-seeded',data_kind:'historical',sample_pool:count?.n??0,live_enabled:env.ALLOW_PAID_MODELS==='true'});
      }
      if(request.method==='POST'){
        const origin=request.headers.get('Origin');if(origin&&new URL(origin).host!==url.host)return json({error:'Cross-origin writes forbidden'},403);
      }
      if(path==='/api/runs'&&request.method==='POST'){
        const length=Number(request.headers.get('content-length'));if(length>4096)return json({error:'Request too large'},413);
        const body=await request.text();if(body.length>4096)return json({error:'Request too large'},413);
        const config=RunSchema.parse(JSON.parse(body));
        config.providers=[...new Set(['constant' as const,'baseline' as const,...config.providers])].sort();
        const live=config.providers.some(p=>p==='claude'||p==='open');
        if(live&&(env.ALLOW_PAID_MODELS!=='true'||!config.confirm_paid))return json({error:'Live providers require server opt-in and explicit per-run cost confirmation'},403);
        if(live&&config.size>Math.min(200,Number(env.MAX_LIVE_SAMPLE)||20))return json({error:'Live sample limit exceeded'},400);
        for(const p of config.providers)adapter(p,env); // fail before creating runs if credentials absent
        const key=request.headers.get('Idempotency-Key');
        if(!key||!/^[-a-zA-Z0-9_]{8,80}$/.test(key))return json({error:'Idempotency-Key (8–80 safe characters) required'},400);
        const id=(await hash(key)).slice(0,32),requestHash=await hash(config);
        const old=await env.DB.prepare('SELECT request_hash,status FROM runs WHERE id=?').bind(id).first<{request_hash:string;status:string}>();
        if(old&&old.request_hash!==requestHash)return json({error:'Idempotency key reused with different parameters'},409);
        const pool=(await env.DB.prepare('SELECT id FROM samples ORDER BY id').all<{id:string}>()).results.map(r=>r.id);
        const ids=sampleIds(pool,config.size,config.seed);
        await env.DB.prepare("INSERT OR IGNORE INTO runs(id,request_hash,config_json,sample_ids_json,status,created_at) VALUES(?,?,?,?,'queued',?)").bind(id,requestHash,JSON.stringify(config),JSON.stringify(ids),new Date().toISOString()).run();
        const current=await env.DB.prepare('SELECT request_hash FROM runs WHERE id=?').bind(id).first<{request_hash:string}>();
        if(current?.request_hash!==requestHash)return json({error:'Idempotency conflict'},409);
        // Deterministic workflow ID also prevents duplicate scheduling on repeated requests.
        if(!old||old.status==='queued'){
          try{await env.RUN_WORKFLOW.create({id,params:{run_id:id}});}
          catch{
            try{const instance=await env.RUN_WORKFLOW.get(id);await instance.status();}
            catch{return json({id,error:'Scheduling unavailable; retry with the same idempotency key'},503);}
          }
        }
        return json({id,reused:!!old},old?200:202);
      }
      const match=path.match(/^\/api\/runs\/([a-f0-9]{32})(?:\/(results|score))?$/);
      if(match){
        const [,id,action]=match;
        const run=await env.DB.prepare('SELECT id,config_json,sample_ids_json,status,created_at,error FROM runs WHERE id=?').bind(id).first();
        if(!run)return json({error:'Run not found'},404);
        if(!action&&request.method==='GET')return json({...run,config:JSON.parse(String(run.config_json)),sample_ids:JSON.parse(String(run.sample_ids_json))});
        if(action==='score'&&request.method==='POST'){
          if(run.status!=='complete')return json({error:'Wait for all predictions before revealing outcomes'},409);
          return json(await scoreRun(env.DB,id));
        }
        if(action==='results'&&request.method==='GET'){
          const records=await env.DB.prepare('SELECT p.sample_id,p.provider,p.record_json,p.snapshot_json,p.input_hash,p.created_at,o.outcome,o.revealed_at FROM predictions p LEFT JOIN outcomes o ON o.run_id=p.run_id AND o.sample_id=p.sample_id WHERE p.run_id=? ORDER BY p.sample_id,p.provider').bind(id).all();
          return json({records:records.results.map(r=>({...r,record:JSON.parse(String(r.record_json)),input:JSON.parse(String(r.snapshot_json)),record_json:undefined,snapshot_json:undefined}))});
        }
      }
      return json({error:'Route not found'},404);
    }catch(e){
      if(e instanceof SyntaxError)return json({error:'Malformed JSON'},400);
      if(e instanceof Error&&('issues' in e||/Sample exceeds|not configured/.test(e.message)))return json({error:e.message},400);
      console.error('API operation failed',e instanceof Error?e.message:'unknown');return json({error:'Internal operation failed'},500);
    }
  }
} satisfies ExportedHandler<Env>;
