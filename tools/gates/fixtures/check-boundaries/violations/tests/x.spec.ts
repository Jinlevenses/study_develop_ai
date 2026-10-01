// fixture authored for T-00-05 (no spike counterpart): tests 단위: 서비스 import 는 위반, contracts·shared-kernel·testkit 는 허용
import { ContentBody } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { fixedClock } from "@fathom/testkit/clock";
import { hello } from "@fathom/svc-a"; // EXPECT[boundary/cross-service-import]

export const T = [ContentBody, ident, fixedClock, hello];
