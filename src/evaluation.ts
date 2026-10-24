export interface Observation {probability:number;outcome:number;latency_ms:number;cost_usd:number|null}
export function quantile(values:number[],q:number){if(!values.length)return null;const a=[...values].sort((a,b)=>a-b);const p=(a.length-1)*q,l=Math.floor(p);return a[l]+(a[Math.ceil(p)]-a[l])*(p-l);}
export function evaluate(rows:Observation[],threshold:number){
  if(!rows.length)return {n:0,brier:null,accuracy:null,bins:[],median_ms:null,p95_ms:null,cost_per_valid:null};
  if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new Error('Invalid threshold');
  for(const r of rows)if(!Number.isFinite(r.probability)||r.probability<0||r.probability>1||![0,1].includes(r.outcome))throw new Error('Invalid observation');
  const bins=Array.from({length:10},(_,i)=>{const a=rows.filter(r=>Math.min(9,Math.floor(r.probability*10))===i);return {lower:i/10,upper:(i+1)/10,count:a.length,mean_probability:a.length?a.reduce((s,r)=>s+r.probability,0)/a.length:null,observed_rate:a.length?a.reduce((s,r)=>s+r.outcome,0)/a.length:null};});
  return {n:rows.length,brier:rows.reduce((s,r)=>s+(r.probability-r.outcome)**2,0)/rows.length,accuracy:rows.filter(r=>Number(r.probability>=threshold)===r.outcome).length/rows.length,bins,median_ms:quantile(rows.map(r=>r.latency_ms),.5),p95_ms:quantile(rows.map(r=>r.latency_ms),.95),cost_per_valid:rows.every(r=>r.cost_usd!==null)?rows.reduce((s,r)=>s+r.cost_usd!,0)/rows.length:null};
}
