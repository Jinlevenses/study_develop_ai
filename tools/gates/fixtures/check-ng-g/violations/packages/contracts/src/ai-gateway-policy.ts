// 같은 이름의 다른 위치 파일은 양성 단언으로 인정하지 않는다(고정 경로: packages/contracts/src/ai/ai-gateway-policy.ts)
export const DECOY = { deny_before_submit: ['blank_note.generate'] } as const;
