// fixture authored for T-00-05 (no spike counterpart): builtin-restricted: child_process·worker_threads
import { spawn } from "node:child_process"; // EXPECT[boundary/builtin-restricted]
import { Worker } from "node:worker_threads"; // EXPECT[boundary/builtin-restricted]

export const S = [spawn, Worker];
