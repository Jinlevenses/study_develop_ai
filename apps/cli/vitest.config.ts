import { fathomVitestPreset } from '@fathom/testkit/vitest-preset';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(fathomVitestPreset, defineConfig({}));
