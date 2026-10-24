import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
const env={...process.env,WRANGLER_SEND_METRICS:'false'};
const cli='node_modules/wrangler/wrangler-dist/cli.js';
async function command(args){await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{env,stdio:'inherit'});c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(new Error(`Command failed: ${code}`)));});}
await command([cli,'d1','execute','campaignproof','--local','--file','scripts/api-fixture.sql']);
const log=createWriteStream('artifacts/worker-integration.log');
const worker=spawn(process.execPath,[cli,'dev','--ip','127.0.0.1'],{env,stdio:['ignore','pipe','pipe']});worker.stdout.pipe(log);worker.stderr.pipe(log);
try{
 let ready=false;
 for(let n=0;n<60;n++){
   if(worker.exitCode!==null)throw new Error('Worker exited during startup; see artifacts/worker-integration.log');
   try{const r=await fetch('http://127.0.0.1:8787/api/health');if(r.ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,1000));
 }
 if(!ready)throw new Error('Worker startup timeout');
 await command(['scripts/smoke.mjs']);
}finally{worker.kill('SIGTERM');log.end();}
