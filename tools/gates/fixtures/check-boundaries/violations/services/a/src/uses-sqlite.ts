// fixture authored for T-00-05 (no spike counterpart): sqlite-direct: node:sqlite import·new DatabaseSync (src, 허용 위치 밖)
import { DatabaseSync } from "node:sqlite"; // EXPECT[boundary/sqlite-direct]

export const open = () => new DatabaseSync(":memory:"); // EXPECT[boundary/sqlite-direct]
