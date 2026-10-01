// fixture authored for T-00-05 (no spike counterpart): child_process 허용 위치
import { spawnSync } from "node:child_process";

export const run = spawnSync;
