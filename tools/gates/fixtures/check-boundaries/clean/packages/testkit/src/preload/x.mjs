// CR-72: testkit preload는 child_process를 감싸는(spawn 하지 않는) 기록기라 정적 import가 허용된다.
import childProcess from "node:child_process";

export const wrapped = childProcess.spawn;
