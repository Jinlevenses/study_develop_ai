/** Quote an SQL identifier (table/column). The only sanctioned way to interpolate into SQL text. */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad identifier: ${name}`);
  return `"${name}"`;
}
