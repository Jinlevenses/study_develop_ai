// fixture authored for T-00-05 (no spike counterpart): bc-cross: 값 import 한 ports.ts·일반 파일·type import 한 일반 파일은 위반, ports.ts 의 import type 은 예외(clean)
import { loadCatalog } from "../catalog/service.ts"; // EXPECT[boundary/bc-cross]
import { PORT } from "../catalog/ports.ts"; // EXPECT[boundary/bc-cross]
import type { Svc } from "../catalog/service.ts"; // EXPECT[boundary/bc-cross]
import type { CatalogPort } from "../catalog/ports.ts";

export const B: [typeof loadCatalog, typeof PORT, Svc?, CatalogPort?] = [loadCatalog, PORT];
