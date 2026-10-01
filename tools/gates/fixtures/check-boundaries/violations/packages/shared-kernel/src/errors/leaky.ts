// fixture authored for T-00-05 (no spike counterpart): sk-pure: errors 모듈이 모듈 밖·내장·서드파티·@fathom 을 import
import { openDb } from "../sqlite/open.ts"; // EXPECT[boundary/sk-pure]
import { join } from "node:path"; // EXPECT[boundary/sk-pure]
import { z } from "zod"; // EXPECT[boundary/sk-pure]
import type { ItemViewPreSubmitResponse } from "@fathom/contracts"; // EXPECT[boundary/sk-pure]

export const L = [openDb, join, z] as unknown as ItemViewPreSubmitResponse[];
