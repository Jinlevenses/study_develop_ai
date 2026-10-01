// fixture authored for T-00-05 (no spike counterpart): tests 단위: contracts·shared-kernel·testkit 허용
import { ContentBody } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { fixedClock } from "@fathom/testkit/clock";

export const T = [ContentBody, ident, fixedClock];
