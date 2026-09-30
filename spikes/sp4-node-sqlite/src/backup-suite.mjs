import { runBackupTests } from './concurrency.mjs';
process.stdout.write(JSON.stringify(await runBackupTests(process.argv[2])));
