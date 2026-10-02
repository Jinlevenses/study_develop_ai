import { fileURLToPath } from 'node:url';
import { createService } from '@fathom/shared-kernel/service/service';
import { createGatewayDefinition } from './config.js';

await createService(createGatewayDefinition({ entry: fileURLToPath(import.meta.url) }));
