// fixture authored for T-00-05 (no spike counterpart): domain 순수 정상형: 같은 BC·contracts·shared-kernel errors·승인 서드파티 es-hangul
import { disassemble } from "es-hangul";
import { ContentBody } from "@fathom/contracts/http/content";
import { fail } from "@fathom/shared-kernel/errors/errors";
import { helper } from "./y.ts";
import { shared } from "./shared/z.ts";

export const X = [disassemble, ContentBody, fail, helper, shared];
