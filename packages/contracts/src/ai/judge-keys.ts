
export declare function keyedFromList<T>(prefix: string, items: readonly T[], idOf: (item: T) => string):
  { map: Record<string, T>; keymap: Record<string, string> };   // prefix 'kp'·'mc'·'opt' → 키 '<prefix>01'…(ObjKey 정규식 충족), keymap = 키 → 원 ID
