// fixture authored for T-00-05 (no spike counterpart): test 디렉터리의 new DatabaseSync·node:sqlite·testkit 는 정상(intra 규칙은 test/에 미적용)
import { DatabaseSync } from "node:sqlite";
import { fixedClock } from "@fathom/testkit/clock";

export const db = new DatabaseSync(":memory:");
export const clock = fixedClock;
