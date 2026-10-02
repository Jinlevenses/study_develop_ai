// CR-72 대조군: testkit의 preload 밖 파일은 child_process를 import할 수 없다(경로 단위 허용).
import { spawn } from "node:child_process"; // EXPECT[boundary/builtin-restricted]

export const S = spawn;
