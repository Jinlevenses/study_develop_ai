// Replay-only process: rebuild projection from a ledger file and print its hash. Used for TZ / process-independence checks.
import { DatabaseSync } from 'node:sqlite';
import { Projector, projectionHash } from './projection.ts';
import { replayFromDb } from './ledger.ts';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const fuzz = process.argv[3] === 'fuzz';
const r = replayFromDb(db, new Projector({ fuzz, shortTerm: true, retention: 0.9 }));
console.log(JSON.stringify({ tz: process.env.TZ ?? '(unset)', offsetMin: new Date(2026, 6, 1).getTimezoneOffset(), hash: projectionHash(r.proj), events: r.events, ms: Math.round(r.ms) }));
