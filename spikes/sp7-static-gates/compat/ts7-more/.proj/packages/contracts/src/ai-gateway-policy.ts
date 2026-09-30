/** NG-G7: the gateway must refuse generation tasks for a blank note before it is submitted. */
export const AI_GATEWAY_POLICY = {
  deny_before_submit: ["blank_note.generate", "blank_note.complete"],
  allow_after_submit: ["blank_note.feedback"],
} as const;
