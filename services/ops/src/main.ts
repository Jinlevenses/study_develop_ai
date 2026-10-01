import { fileURLToPath } from 'node:url';
import { createService } from '@fathom/shared-kernel/service/service';
import { serviceDefinition } from './config.js';

await createService(serviceDefinition(fileURLToPath(import.meta.url)));
