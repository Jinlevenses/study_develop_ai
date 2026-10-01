// fixture authored for T-00-05 (no spike counterpart): contracts-builtin: contracts src 에서 내장 모듈
import { readFileSync } from "node:fs"; // EXPECT[boundary/contracts-builtin]

export const R = readFileSync;
