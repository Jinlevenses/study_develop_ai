// Trusted entry of a pre-warmed spare: boots node + guard, then waits for a single "go" line and imports the learner file.
import { pathToFileURL } from 'node:url';
const file = process.argv[2];
process.stdin.setEncoding('utf8');
process.stdin.once('data', async () => {
  process.stdin.pause();
  await import(pathToFileURL(file).href);
});
