import {describe,it,expect,vi} from 'vitest';
import parity from '../artifacts/parity.json';
import pool from '../artifacts/pool.json';
import {InputSchema,validateDecision,sampleIds,RunSchema} from '../src/domain';
import {adapter,score,retry,TransientError,ClaudeAdapter,OpenModelAdapter} from '../src/adapters';
import {evaluate} from '../src/evaluation';
import {predictOne} from '../src/storage';
const input=InputSchema.parse({input_id:parity[0].input_id,features:parity[0].features});
const good={input_id:input.input_id,probability:.2,evidence:[{reason:'PRIOR_CAMPAIGN',attribute:'poutcome',value:input.features.poutcome}]};
describe('numerical and evidence boundary',()=>{
  it.each([-1,1.01,NaN,Infinity,-Infinity])('rejects invalid probability %s',probability=>expect(()=>validateDecision({...good,probability},input)).toThrow());
  it('rejects wrong input ID',()=>expect(()=>validateDecision({...good,input_id:'other'},input)).toThrow());
  it('rejects fabricated aggregate fields',()=>expect(()=>validateDecision({...good,conversion_rate:.8},input)).toThrow());
  it('rejects missing probability',()=>expect(()=>validateDecision({input_id:input.input_id,evidence:good.evidence},input)).toThrow());
  it('rejects fabricated evidence',()=>expect(()=>validateDecision({...good,evidence:[{reason:'PRIOR_CAMPAIGN',attribute:'poutcome',value:'invented'}]},input)).toThrow());
  it('rejects reason/attribute mismatch',()=>expect(()=>validateDecision({...good,evidence:[{reason:'PROFILE',attribute:'poutcome',value:input.features.poutcome}]},input)).toThrow());
  it('rejects unknown reason',()=>expect(()=>validateDecision({...good,evidence:[{...good.evidence[0],reason:'HIGH_CONVERSION'}]},input)).toThrow());
  it('accepts supported evidence',()=>expect(validateDecision(good,input).probability).toBe(.2));
  it('excludes target and duration',()=>{for(const key of ['y','duration','campaign'])expect(()=>InputSchema.parse({...input,features:{...input.features,[key]:1}})).toThrow();});
  it('compares exported scorer against 256 Python probabilities within 1e-12',()=>{for(const row of parity){const i=InputSchema.parse({input_id:row.input_id,features:row.features});expect(Math.abs(score(i)-row.expected)).toBeLessThan(1e-12);}});
});
describe('reproducible evaluation',()=>{
  it('hand-calculated Brier: ((.2-0)^2+(.8-1)^2)/2=.04',()=>{const r=evaluate([{probability:.2,outcome:0,latency_ms:1,cost_usd:0},{probability:.8,outcome:1,latency_ms:3,cost_usd:0}],.5);expect(r.brier).toBeCloseTo(.04,14);expect(r.accuracy).toBe(1);expect(r.median_ms).toBe(2);expect(r.p95_ms).toBeCloseTo(2.9);});
  it('explicit threshold changes accuracy',()=>expect(evaluate([{probability:.4,outcome:1,latency_ms:1,cost_usd:null}],.3).accuracy).toBe(1));
  it('unknown cost stays unknown',()=>expect(evaluate([{probability:.1,outcome:0,latency_ms:1,cost_usd:null}],.5).cost_per_valid).toBeNull());
  it('empty intersection is not a zero Brier',()=>expect(evaluate([],.5).brier).toBeNull());
  it('places 1.0 in final bin',()=>expect(evaluate([{probability:1,outcome:1,latency_ms:0,cost_usd:0}],.5).bins[9].count).toBe(1));
  it('rejects invalid observed outcome',()=>expect(()=>evaluate([{probability:.1,outcome:2,latency_ms:0,cost_usd:0}],.5)).toThrow());
  it('identical seed selects identical sample independently of providers',()=>{const a=sampleIds(pool,20,474);expect(sampleIds([...pool].reverse(),20,474)).toEqual(a);expect(new Set(a).size).toBe(20);expect(sampleIds(pool,20,475)).not.toEqual(a);});
  it('rejects sample beyond pool',()=>expect(()=>sampleIds(['one'],2,0)).toThrow());
  it('rejects duplicate providers and oversized requests',()=>{expect(()=>RunSchema.parse({providers:['mock','mock'],size:20,seed:474})).toThrow();expect(()=>RunSchema.parse({providers:['mock'],size:201,seed:474})).toThrow();});
});
describe('replaceable provider contracts',()=>{
  it('switches offline adapters without changing validation',async()=>{for(const p of ['constant','baseline','mock'] as const){const m=adapter(p);expect(validateDecision((await m.predict(input)).raw,input)).toBeDefined();}});
  it('mock results labeled and deterministic',async()=>{const a=await predictOne(input,'mock',{}),b=await predictOne(input,'mock',{});expect(a.kind).toBe('mock');expect(a.decision).toEqual(b.decision);expect(a.status).toBe('valid');});
  it('live adapters refuse missing credentials',()=>{expect(()=>adapter('claude')).toThrow();expect(()=>adapter('open')).toThrow();});
  it('bounded retries recover transient errors',async()=>{const op=vi.fn().mockRejectedValueOnce(new TransientError()).mockResolvedValue('ok');const result=await retry(op,async()=>{});expect(result.attempts).toBe(2);});
  it('retry exhaustion stops at three attempts',async()=>{const op=vi.fn().mockRejectedValue(new TransientError());await expect(retry(op,async()=>{})).rejects.toThrow();expect(op).toHaveBeenCalledTimes(3);});
  it('malformed output is not retried',async()=>{const op=vi.fn().mockRejectedValue(new SyntaxError('bad JSON'));await expect(retry(op,async()=>{})).rejects.toThrow();expect(op).toHaveBeenCalledTimes(1);});
  it('Claude request uses genuine endpoint and only allowlisted input',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({content:[{type:'text',text:JSON.stringify(good)}],usage:{input_tokens:12,output_tokens:22}}));
    const m=new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'configured-test-model'},fetcher);const r=await m.predict(input);expect(validateDecision(r.raw,input)).toEqual(good);expect(m.kind).toBe('real-api');expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain('duration');expect(r.cost_usd).toBeNull();
  });
  it('controlled injection: unsupported numeric claim rejected',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({content:[{type:'text',text:JSON.stringify({...good,customer_count:1000})}]}));
    const r=await new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test'},fetcher).predict(input);expect(()=>validateDecision(r.raw,input)).toThrow();
  });
  it('malformed provider JSON rejected',async()=>{const m=new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test'},vi.fn<typeof fetch>().mockResolvedValue(Response.json({content:[{type:'text',text:'not json'}]})));await expect(m.predict(input)).rejects.toThrow(SyntaxError);});
  it('HTTP timeout classified transient',async()=>{const m=new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test'},vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timeout','AbortError')));await expect(m.predict(input)).rejects.toThrow(TransientError);});
  it('429 classified transient but 401 is terminal',async()=>{for(const status of [429,401]){const m=new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test'},vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status})));try{await m.predict(input);throw new Error('Expected failure');}catch(e){expect(e instanceof TransientError).toBe(status===429);}}});
  it('open model adapter sends documented REST request (stubbed transport)',async()=>{const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json({success:true,result:{response:JSON.stringify(good)}}));const m=new OpenModelAdapter({CF_ACCOUNT_ID:'test-account',CF_AI_TOKEN:'test-only'},f);const r=await m.predict(input);expect(validateDecision(r.raw,input)).toBeDefined();expect(String(f.mock.calls[0][0])).toContain('/ai/run/@cf/meta/');expect(r.cost_usd).toBeNull();});
});
describe('failure records and observable cost',()=>{
  it('records injected malformed output as invalid without retries',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json({content:[{type:'text',text:JSON.stringify({...good,fabricated_rate:.99})}],usage:{input_tokens:3,output_tokens:4}}));
    vi.stubGlobal('fetch',f);
    try{const r=await predictOne(input,'claude',{ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test'});expect(r.status).toBe('invalid');expect(r.attempts).toBe(1);expect(r.usage?.input_tokens).toBe(3);}finally{vi.unstubAllGlobals();}
  });
  it('actual timeout aborts a stalled HTTP transport',async()=>{
    vi.useFakeTimers();
    const f=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));}));
    try{const promise=new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test'},f).predict(input);const failure=expect(promise).rejects.toThrow(TransientError);await vi.advanceTimersByTimeAsync(15001);await failure;}finally{vi.useRealTimers();}
  });
  it('provider-specific token rates produce explicitly estimated cost',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json({content:[{type:'text',text:JSON.stringify(good)}],usage:{input_tokens:10,output_tokens:20}}));
    const r=await new ClaudeAdapter({ANTHROPIC_API_KEY:'test-only',CLAUDE_MODEL:'test',CLAUDE_INPUT_USD_PER_MILLION:'2',CLAUDE_OUTPUT_USD_PER_MILLION:'8',OPEN_INPUT_USD_PER_MILLION:'99'},f).predict(input);expect(r.cost_usd).toBeCloseTo(.00018);expect(r.cost_kind).toBe('estimated');
  });
});
