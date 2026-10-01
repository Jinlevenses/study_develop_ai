/** OKLCH 문자열 → 상대휘도·대비·hex (순수, 의존 0). DS-01 DN-D3. */
export type Oklch = { readonly l: number; readonly c: number; readonly h: number; readonly alpha: number };

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const OKLCH_RE = new RegExp(`^oklch\\(\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})(?:\\s*/\\s*(${NUM}))?\\s*\\)$`);

export function parseOklch(value: string): Oklch {
  const m = OKLCH_RE.exec(value.trim());
  if (m === null) {
    throw new TypeError(`지원하지 않는 색 형식: ${value}`);
  }
  const l = Number(m[1]);
  const c = Number(m[2]);
  const h = Number(m[3]);
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return { l, c, h, alpha };
}

export function oklchToLinearSrgb(color: Oklch): readonly [number, number, number] {
  const rad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(rad);
  const b = color.c * Math.sin(rad);
  const l = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function relativeLuminance(value: string): number {
  const [r, g, b] = oklchToLinearSrgb(parseOklch(value));
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function encode(v: number): number {
  const x = clamp01(v);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

function hex2(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function toHex(value: string): string {
  const parsed = parseOklch(value);
  const [r, g, b] = oklchToLinearSrgb(parsed);
  const base = `#${hex2(encode(r))}${hex2(encode(g))}${hex2(encode(b))}`;
  return parsed.alpha < 1 ? `${base}${hex2(parsed.alpha)}` : base;
}
