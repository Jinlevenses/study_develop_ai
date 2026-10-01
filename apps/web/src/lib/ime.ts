export interface ImeEventLike {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly nativeEvent?: { readonly isComposing?: boolean };
}

/** IME 조합 중 여부 — FR-UX-004, STD-WEB-31. 네이티브·React 합성 이벤트 모두. */
export function isImeComposing(e: ImeEventLike): boolean {
  return e.isComposing === true || e.nativeEvent?.isComposing === true || e.keyCode === 229;
}
