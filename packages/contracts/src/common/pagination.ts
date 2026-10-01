import { z } from 'zod';
import { S } from './schema.js';

export const Cursor = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/); // opaque base64url
export type Cursor = z.infer<typeof Cursor>;
export const PageQuery = S({ cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export type PageQuery = z.infer<typeof PageQuery>;
export const Page = <T extends z.ZodType>(item: T) => S({ items: z.array(item), next_cursor: Cursor.nullable() });
