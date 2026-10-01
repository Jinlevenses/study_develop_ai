import type { ServiceDeps } from '@fathom/shared-kernel/service/service';

export type GeneratePorts = { readonly assetsDir: string };
export type GenerateDeps = ServiceDeps<null> & { readonly infra: GeneratePorts };
