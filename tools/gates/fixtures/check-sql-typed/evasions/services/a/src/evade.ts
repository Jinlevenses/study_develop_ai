import { DatabaseSync } from 'node:sqlite';

export function bound(db: DatabaseSync, x: string) {
  const p = db.prepare.bind(db);
  return p(`SELECT ${x}`); // DETECTS[sql/template-interp] bind()로 만든 함수도 타입 엔진은 잡는다(토큰 엔진은 EVADES)
}
export function aliased(db: DatabaseSync, x: string) {
  const { prepare } = db;
  return prepare.call(db, `SELECT ${x}`); // EVADES[sql/template-interp] 구조 분해한 메서드
}
