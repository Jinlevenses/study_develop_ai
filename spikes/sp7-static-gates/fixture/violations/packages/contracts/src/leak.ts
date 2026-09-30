import { hello } from "../../../services/a/src/index.ts"; // EXPECT[boundary/cross-service-import]
export const LEAK = hello;
