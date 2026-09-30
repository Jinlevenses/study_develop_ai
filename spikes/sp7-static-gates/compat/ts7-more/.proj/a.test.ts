import { test, expect } from "vitest";
import { ident } from "./packages/shared-kernel/src/sql.ts";
test("ident", () => { expect(ident("cards")).toBe('"cards"'); });
