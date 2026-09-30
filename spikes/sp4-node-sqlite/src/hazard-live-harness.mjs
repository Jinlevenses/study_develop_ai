import { spawn, spawnSync } from 'node:child_process';
import { freshDb } from './concurrency.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Optional hazard harness: `node --disable-warning=ExperimentalWarning src/hazard-live-harness.mjs [attempts]`
// Tries to reproduce a SIGSEGV seen once when db.close() was called while a default-rate backup() was pending under a live writer.
import { DatabaseSync } from 'node:sqlite';
const root=join(dirname(fileURLToPath(import.meta.url)),'..')+'/';
const src=root+'.work/hz.src.db', dest=root+'.work/hz.dest.db';
const res=[];
for (let i=0;i<Number(process.argv[2]??8);i++){
  freshDb(src);
  const db=new DatabaseSync(src); const ins=db.prepare('INSERT INTO events(writer,batch_id,seq,ts,payload) VALUES (?,?,?,?,?)'); db.exec('BEGIN'); for(let b=1;b<=6000;b++)for(let k=0;k<5;k++)ins.run(0,b,k,1,'p'.repeat(200)); db.exec('COMMIT'); db.close();
  const s=Date.now()+300;
  const w=spawn(process.execPath,['--disable-warning=ExperimentalWarning',root+'src/writer.mjs',JSON.stringify({db:src,id:9,startAt:s,endAt:s+20000,busyTimeout:5000})],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,800));
  const r=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',root+'src/backup-hazard-live.mjs',src,dest],{encoding:'utf8',timeout:30000});
  w.kill('SIGKILL');
  res.push({i,exit:r.status,signal:r.signal,out:r.stdout.trim().replace(/\n/g,' / ').slice(0,120),err:r.stderr.trim().split('\n')[0]?.slice(0,80)});
  await new Promise(r=>setTimeout(r,300));
}
console.log(JSON.stringify(res,null,0));
