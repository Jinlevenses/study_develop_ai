/** SQL 식별자 인용 — 템플릿에 보간할 수 있는 유일한 공인 방법 */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad identifier: ${name}`);
  return `"${name}"`;
}
