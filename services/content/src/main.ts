import { fileURLToPath } from 'node:url';
import { createService } from '@fathom/shared-kernel/service/service';
import { createContentDefinition } from './config.js';

await createService(createContentDefinition({ entry: fileURLToPath(import.meta.url) }));
