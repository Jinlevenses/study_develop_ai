import { z } from 'zod';

// gateway CSP는 script-src 'self'(eval 금지)다. zod 4의 JIT 탐침(`new Function('')`)은 CSP 위반 보고를 남기므로
// 계약 모듈이 스키마를 만들기 전에 jitless를 켠다 — main.tsx의 첫 import여야 한다(INT-1a 통합 수정, E2E-506).
z.config({ jitless: true });
