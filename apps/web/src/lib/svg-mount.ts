// SMIL 요소는 마운트 뒤 `<a>`의 href를 `javascript:`로 바꿔 칠 수 있어 통째로 제거한다(CSP는 2차 방어).
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'animate',
  'set',
  'animatemotion',
  'animatetransform',
]);

/** `<style>` 텍스트에서 `@import`와 외부 `url(...)`을 제거한다(`url(#frag)`는 유지). */
function scrubStyleText(text: string): string {
  return text.replace(/@import\b[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?\s*#)[^)]*\)/gi, 'none');
}

function scrub(el: Element): void {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    const local = (attr.localName || name).toLowerCase();
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
    } else if ((name === 'href' || name === 'xlink:href' || local === 'href') && !attr.value.trim().startsWith('#')) {
      el.removeAttribute(attr.name);
    } else if (name === 'style' && /url\s*\(/i.test(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
}

/**
 * 외부 SVG 텍스트를 DOM으로 파싱해 위험 요소·속성을 제거한다(NFR-SEC-009, STD-SEC-05).
 * 루트가 svg가 아니거나 XML 오류면 null. `<style>` 요소는 유지한다(mermaid 테마).
 */
export function sanitizeSvg(text: string, parser?: DOMParser): SVGSVGElement | null {
  const doc = (parser ?? new DOMParser()).parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    return null;
  }
  for (const el of [...root.querySelectorAll('*')]) {
    if (FORBIDDEN_ELEMENTS.has(el.localName.toLowerCase())) {
      el.remove();
    }
  }
  scrub(root);
  for (const el of root.querySelectorAll('*')) {
    scrub(el);
  }
  for (const style of root.querySelectorAll('style')) {
    style.textContent = scrubStyleText(style.textContent ?? '');
  }
  return root instanceof SVGSVGElement ? root : null;
}

/** sanitize 후 컨테이너 내용을 교체한다. 실패하면 컨테이너를 건드리지 않고 false. */
export function mountSvg(container: Element, text: string): boolean {
  const svg = sanitizeSvg(text);
  if (svg === null) {
    return false;
  }
  container.replaceChildren(document.importNode(svg, true));
  return true;
}
