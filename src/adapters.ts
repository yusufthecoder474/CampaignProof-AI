import artifact from '../artifacts/baseline.json';
import {categorical,numeric,type Input,type DecisionModel,type ModelOutput,type Provider,type Usage} from './domain';
export class TransientError extends Error {}
export async function retry<T>(operation:()=>Promise<T>,sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms)),attempts=3):Promise<{value:T;attempts:number}>{
  for(let n=1;;n++){try{return {value:await operation(),attempts:n};}catch(e){if(!(e instanceof TransientError)||n>=attempts)throw e;await sleep(100*2**(n-1));}}
}
export function score(input:Input):number{
  let logit=artifact.intercept;
  categorical.forEach((key,i)=>{const j=artifact.categories[i].indexOf(input.features[key]);if(j>=0) logit+=artifact.categorical_weights[i][j];});
  numeric.forEach((key,i)=>{logit+=((input.features[key]-artifact.means[i])/artifact.scales[i])*artifact.numeric_weights[i];});
  return 1/(1+Math.exp(-logit));
}
const evidence=(input:Input)=>[{reason:'PRIOR_CAMPAIGN',attribute:'poutcome',value:input.features.poutcome}];
export class StatisticalBaselineAdapter implements DecisionModel {
  provider:Provider='baseline';model='logistic-regression';version=artifact.version;kind:'mock'|'statistical'|'real-api'='statistical';
  async predict(input:Input):Promise<ModelOutput>{return {raw:{input_id:input.input_id,probability:score(input),evidence:evidence(input)},usage:null,cost_usd:0,cost_kind:'local-zero-api-cost'};}
}
export class ConstantAdapter extends StatisticalBaselineAdapter {
  override provider:Provider='constant';override model='training-base-rate';
  override async predict(input:Input){const o=await super.predict(input);return {...o,raw:{input_id:input.input_id,probability:artifact.base_rate,evidence:evidence(input)}};}
}
export class MockAdapter extends StatisticalBaselineAdapter {
  override provider:Provider='mock';override model='deterministic-fixture';override version='mock-v1';override kind='mock' as const;
  override async predict(input:Input){let n=0;for(const c of input.input_id)n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;return {raw:{input_id:input.input_id,probability:.05+(n%400)/1000,evidence:evidence(input)},usage:null,cost_usd:0,cost_kind:'local-zero-api-cost' as const};}
}
export interface Secrets {ANTHROPIC_API_KEY?:string;CLAUDE_MODEL?:string;CF_ACCOUNT_ID?:string;CF_AI_TOKEN?:string;OPEN_MODEL?:string;CLAUDE_INPUT_USD_PER_MILLION?:string;CLAUDE_OUTPUT_USD_PER_MILLION?:string;OPEN_INPUT_USD_PER_MILLION?:string;OPEN_OUTPUT_USD_PER_MILLION?:string}
const system=`Estimate the probability that this Portuguese bank customer subscribes to a term deposit, before a planned call. This is a historical backtest. Probability is a model estimate, never a fact. Return only JSON: {"input_id":"copied ID","probability":0.1,"evidence":[{"reason":"PRIOR_CAMPAIGN","attribute":"poutcome","value":"copy exact input value"}]}. Use 1-4 evidence items. Allowed reasons and attributes: PROFILE(job,education,housing,loan), CONTACT_CONTEXT(contact,month,day_of_week), PRIOR_CAMPAIGN(previous,pdays,poutcome). Copy exact attribute values. No other fields, prose, counts, aggregate rates, invented numbers, or outcomes.`;
async function requestJson(url:string,init:RequestInit,fetcher:typeof fetch){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetcher(url,{...init,signal:controller.signal});
    if(r.status===429||r.status>=500)throw new TransientError(`Provider HTTP ${r.status}`);
    if(!r.ok)throw new Error(`Provider HTTP ${r.status}`);
    const text=await r.text();if(text.length>32768)throw new Error('Provider response too large');
    return JSON.parse(text) as Record<string,unknown>;
  }catch(e){if(e instanceof Error&&(e.name==='AbortError'||e instanceof TypeError))throw new TransientError('Provider timeout or network failure');throw e;}
  finally{clearTimeout(timeout);}
}
function usageOf(value:unknown):Usage|null{
  if(typeof value!=='object'||!value)return null;const u=value as Record<string,unknown>;
  return typeof u.input_tokens==='number'&&Number.isInteger(u.input_tokens)&&u.input_tokens>=0&&typeof u.output_tokens==='number'&&Number.isInteger(u.output_tokens)&&u.output_tokens>=0?{input_tokens:u.input_tokens,output_tokens:u.output_tokens}:null;
}
function estimated(usage:Usage|null,env:Secrets,provider:'CLAUDE'|'OPEN'){
  const input=env[`${provider}_INPUT_USD_PER_MILLION`],output=env[`${provider}_OUTPUT_USD_PER_MILLION`];
  const a=Number(input),b=Number(output);
  if(!usage||!input||!output||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)return null;
  return (usage.input_tokens*a+usage.output_tokens*b)/1e6;
}
export class ClaudeAdapter implements DecisionModel {
  provider:Provider='claude';model:string;version:string;kind='real-api' as const;
  constructor(private env:Secrets,private fetcher:typeof fetch=fetch){if(!env.ANTHROPIC_API_KEY||!env.CLAUDE_MODEL)throw new Error('Claude credentials/model not configured');this.model=env.CLAUDE_MODEL;this.version=this.model;}
  async predict(input:Input):Promise<ModelOutput>{
    const data=await requestJson('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':this.env.ANTHROPIC_API_KEY!,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:this.model,max_tokens:350,system,messages:[{role:'user',content:JSON.stringify(input)}]})},this.fetcher);
    const content=data.content as {type:string;text?:string}[];const text=content?.filter(x=>x.type==='text').map(x=>x.text??'').join('');
    if(!text)throw new Error('Missing model text');
    const usage=usageOf(data.usage),cost=estimated(usage,this.env,'CLAUDE');
    return {raw:JSON.parse(text),usage,cost_usd:cost,cost_kind:cost===null?'unknown':'estimated'};
  }
}
export class OpenModelAdapter implements DecisionModel {
  provider:Provider='open';model:string;version:string;kind='real-api' as const;
  constructor(private env:Secrets,private fetcher:typeof fetch=fetch){if(!env.CF_ACCOUNT_ID||!env.CF_AI_TOKEN)throw new Error('Workers AI credentials not configured');this.model=env.OPEN_MODEL||'@cf/meta/llama-3.3-70b-instruct-fp8-fast';this.version=this.model;}
  async predict(input:Input):Promise<ModelOutput>{
    const data=await requestJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.env.CF_ACCOUNT_ID!)}/ai/run/${this.model}`,{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${this.env.CF_AI_TOKEN}`},body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],max_tokens:350})},this.fetcher);
    if(data.success!==true)throw new Error('Workers AI unsuccessful response');
    const result=data.result as Record<string,unknown>;if(typeof result?.response!=='string')throw new Error('Missing model text');
    const usage=usageOf(result.usage)||usageOf(typeof result.usage==='object'&&result.usage?{input_tokens:(result.usage as Record<string,unknown>).prompt_tokens,output_tokens:(result.usage as Record<string,unknown>).completion_tokens}:null),cost=estimated(usage,this.env,'OPEN');
    return {raw:JSON.parse(result.response),usage,cost_usd:cost,cost_kind:cost===null?'unknown':'estimated'};
  }
}
export function adapter(provider:Provider,env:Secrets={}):DecisionModel{
  switch(provider){case 'constant':return new ConstantAdapter();case 'baseline':return new StatisticalBaselineAdapter();case 'mock':return new MockAdapter();case 'claude':return new ClaudeAdapter(env);case 'open':return new OpenModelAdapter(env);}
}
