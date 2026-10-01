// Radix·cmdk가 happy-dom에서 요구하는 브라우저 API를 없을 때만 정의한다.
type PointerCaptureProto = {
  scrollIntoView?: unknown;
  hasPointerCapture?: unknown;
  releasePointerCapture?: unknown;
  setPointerCapture?: unknown;
};

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function installDomPolyfills(): void {
  const proto: PointerCaptureProto = Element.prototype;
  if (typeof proto.scrollIntoView !== 'function') {
    proto.scrollIntoView = (): void => undefined;
  }
  if (typeof proto.hasPointerCapture !== 'function') {
    proto.hasPointerCapture = (): boolean => false;
  }
  if (typeof proto.releasePointerCapture !== 'function') {
    proto.releasePointerCapture = (): void => undefined;
  }
  if (typeof proto.setPointerCapture !== 'function') {
    proto.setPointerCapture = (): void => undefined;
  }
  const g: { ResizeObserver?: unknown } = globalThis;
  if (typeof g.ResizeObserver !== 'function') {
    g.ResizeObserver = NoopResizeObserver;
  }
}
