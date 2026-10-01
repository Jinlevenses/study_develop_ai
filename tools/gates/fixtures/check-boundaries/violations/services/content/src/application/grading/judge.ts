// fixture authored for T-00-05 (no spike counterpart): grading-no-catalog: catalog BC 는 ports 포함 전부 금지
import { loadCatalog } from "../catalog/service.ts"; // EXPECT[boundary/bc-cross] EXPECT[boundary/grading-no-catalog]
import type { CatalogPort } from "../catalog/ports.ts"; // EXPECT[boundary/grading-no-catalog]

export const J: [typeof loadCatalog, CatalogPort?] = [loadCatalog];
