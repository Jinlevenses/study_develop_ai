// fixture authored for T-00-05 (no spike counterpart): domain-impure: 내장·fastify·다른 BC domain
import { readFileSync } from "node:fs"; // EXPECT[boundary/domain-impure]
import Fastify from "fastify"; // EXPECT[boundary/domain-impure]
import { other } from "../itembank/x.ts"; // EXPECT[boundary/domain-impure] EXPECT[boundary/bc-cross]

export const D = [readFileSync, Fastify, other];
