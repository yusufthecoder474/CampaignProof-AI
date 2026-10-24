import { z } from 'zod';
export const categorical = ['job','education','housing','loan','contact','month','day_of_week','poutcome'] as const;
export const numeric = ['previous','pdays'] as const;
const category=z.string().min(1).max(40).regex(/^[a-zA-Z0-9. -]+$/);
export const FeaturesSchema=z.object({job:category,education:category,housing:category,loan:category,contact:category,month:category,day_of_week:category,poutcome:category,previous:z.number().int().min(0).max(1000),pdays:z.number().int().min(0).max(10000)}).strict();
export const InputSchema=z.object({input_id:z.string().regex(/^uci-\d{5}$/),features:FeaturesSchema}).strict();
export type Input=z.infer<typeof InputSchema>;
export const providers=['constant','baseline','mock','claude','open'] as const;
export type Provider=typeof providers[number];
export const EvidenceSchema=z.object({reason:z.enum(['PROFILE','CONTACT_CONTEXT','PRIOR_CAMPAIGN']),attribute:z.enum([...categorical,...numeric]),value:z.union([z.string(),z.number().finite()])}).strict();
export const DecisionSchema=z.object({input_id:z.string(),probability:z.number().finite().min(0).max(1),evidence:z.array(EvidenceSchema).min(1).max(4)}).strict();
export type Decision=z.infer<typeof DecisionSchema>;
const reasonAttributes:Record<string,readonly string[]>={PROFILE:['job','education','housing','loan'],CONTACT_CONTEXT:['contact','month','day_of_week'],PRIOR_CAMPAIGN:['previous','pdays','poutcome']};
export function validateDecision(raw:unknown,input:Input):Decision {
  const d=DecisionSchema.parse(raw);
  if(d.input_id!==input.input_id) throw new Error('Input ID mismatch');
  for(const e of d.evidence){
    if(input.features[e.attribute]!==e.value || !reasonAttributes[e.reason].includes(e.attribute)) throw new Error('Unsupported evidence');
  }
  return d;
}
export interface Usage {input_tokens:number;output_tokens:number}
export interface ModelOutput {raw:unknown;usage:Usage|null;cost_usd:number|null;cost_kind:'local-zero-api-cost'|'estimated'|'unknown'}
export interface DecisionModel {provider:Provider;model:string;version:string;kind:'mock'|'statistical'|'real-api';predict(input:Input):Promise<ModelOutput>}
export const RunSchema=z.object({providers:z.array(z.enum(providers)).min(1).max(5).refine(a=>new Set(a).size===a.length,'Duplicate provider'),size:z.number().int().min(1).max(100),seed:z.number().int().min(0).max(2147483647),threshold:z.number().min(0).max(1).default(.5),confirm_paid:z.boolean().default(false)}).strict();
export type RunConfig=z.infer<typeof RunSchema>;
export function sampleIds(ids:string[],size:number,seed:number):string[]{
  if(size>ids.length) throw new Error('Sample exceeds available records');
  const a=[...ids].sort();let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a.slice(0,size);
}
export async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
