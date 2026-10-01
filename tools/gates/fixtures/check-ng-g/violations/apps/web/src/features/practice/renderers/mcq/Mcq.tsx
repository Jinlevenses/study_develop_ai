import type { AttemptResult } from '@fathom/contracts/http/practice/v1/post-submit/attempt-result'; // EXPECT[ng-g3/web-renderer-reveal]

export const leak = (r: AttemptResult) => r;
