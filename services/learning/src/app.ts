import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import { registerCurriculumRef } from './application/curriculum-ref/register.js';
import { registerInsight } from './application/insight/register.js';
import { registerLearnerModel } from './application/learner-model/register.js';
import { registerLedger } from './application/ledger/register.js';
import { registerPractice } from './application/practice/register.js';
import type { LearningDeps } from './config.js';

export function registerApp(app: ServiceApp, deps: LearningDeps): void {
  registerPractice(app, deps);
  registerLedger(app, deps);
  registerLearnerModel(app, deps);
  registerInsight(app, deps);
  registerCurriculumRef(app, deps);
}
