// E2E 제목: `E2E-nnn ` 으로 시작하는 문자열만 수집한다
declare function test(title: string, fn: () => void): void;

test('E2E-301 3단 레슨 [FR-STD-033]', () => {});
test('E2E-001 SCN-01 첫 학습 시나리오', () => {});
test('E2E-303 OX 스프린트', () => {});
test(`E2E-304 문제 믹스`, () => {});
test('E2E-310 코드 과제', () => {});
test('E2E-313 백지노트', () => {});
test('E2E-314 개념 디깅', () => {});
test('not an e2e title E2E-999', () => {});
