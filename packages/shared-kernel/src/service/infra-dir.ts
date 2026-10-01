import { fileURLToPath } from 'node:url';

/** `_infra` 마이그레이션 번들 디렉터리(`packages/shared-kernel/infra-migrations/`). src·dist 어느 쪽에서든 같은 위치다. */
export function infraMigrationsDir(): string {
  return fileURLToPath(new URL('../../infra-migrations/', import.meta.url));
}
