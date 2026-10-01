#!/usr/bin/env node
import { installExperimentalWarningFilter } from './warning-filter.mjs';

installExperimentalWarningFilter(process);
await import('../dist/main.js');
