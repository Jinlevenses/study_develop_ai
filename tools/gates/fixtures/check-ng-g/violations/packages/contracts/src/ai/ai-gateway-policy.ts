export const AI_GATEWAY_POLICY = {
  deny_before_submit: ["quiz.generate"], // EXPECT[ng-g7/policy-missing-deny]
  allow_after_submit: ["blank_note.feedback"],
} as const;
