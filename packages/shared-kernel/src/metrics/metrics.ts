// IF-COM-003 / STD-NAM-81 — Prometheus text 0.0.4 레지스트리. 전역 대신 팩토리(Brief 결정).

export type Labels = Readonly<Record<string, string>>;
export interface Counter {
  inc(labels?: Labels, by?: number): void;
}
export interface Gauge {
  set(value: number, labels?: Labels): void;
}
export interface Histogram {
  observe(value: number, labels?: Labels): void;
}
export interface MetricsRegistry {
  counter(name: string, help: string, labelNames?: readonly string[]): Counter;
  gauge(name: string, help: string, labelNames?: readonly string[]): Gauge;
  histogram(name: string, help: string, buckets: readonly number[], labelNames?: readonly string[]): Histogram;
  render(): string;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type HistogramSeries = { readonly bucketCounts: number[]; sum: number; count: number };

type CounterEntry = {
  kind: 'counter';
  help: string;
  labelNames: readonly string[];
  series: Map<string, number>;
  api: Counter;
};
type GaugeEntry = {
  kind: 'gauge';
  help: string;
  labelNames: readonly string[];
  series: Map<string, number>;
  api: Gauge;
};
type HistogramEntry = {
  kind: 'histogram';
  help: string;
  labelNames: readonly string[];
  buckets: readonly number[];
  series: Map<string, HistogramSeries>;
  api: Histogram;
};
type Entry = CounterEntry | GaugeEntry | HistogramEntry;

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeHelp(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function formatNumber(n: number): string {
  if (Number.isNaN(n)) {
    return 'NaN';
  }
  if (n === Number.POSITIVE_INFINITY) {
    return '+Inf';
  }
  if (n === Number.NEGATIVE_INFINITY) {
    return '-Inf';
  }
  return String(n);
}

function sameList(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 라벨 문자열(`a="x",b="y"` — 선언 순서). 선언 안 된 키·누락 키는 던진다. */
function labelString(names: readonly string[], labels: Labels | undefined, metric: string): string {
  const given = labels ?? {};
  const keys = Object.keys(given);
  for (const key of keys) {
    if (!names.includes(key)) {
      throw new Error(`invariant: metric ${metric} undeclared label ${key}`);
    }
  }
  const parts: string[] = [];
  for (const name of names) {
    const value = given[name];
    if (value === undefined) {
      throw new Error(`invariant: metric ${metric} missing label ${name}`);
    }
    parts.push(`${name}="${escapeLabelValue(value)}"`);
  }
  return parts.join(',');
}

function braces(labels: string): string {
  return labels === '' ? '' : `{${labels}}`;
}

function checkRegistration(name: string, labelNames: readonly string[]): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`invariant: metric name invalid: ${name}`);
  }
  for (const label of labelNames) {
    if (!LABEL_NAME_PATTERN.test(label) || label.startsWith('__')) {
      throw new Error(`invariant: metric ${name} label name invalid: ${label}`);
    }
  }
  if (new Set(labelNames).size !== labelNames.length) {
    throw new Error(`invariant: metric ${name} duplicate label names`);
  }
}

function renderScalar(name: string, entry: CounterEntry | GaugeEntry): string[] {
  const rows = [...entry.series.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entry.labelNames.length === 0 && rows.length === 0) {
    rows.push(['', 0]);
  }
  return rows.map(([labels, value]) => `${name}${braces(labels)} ${formatNumber(value)}`);
}

function renderHistogram(name: string, entry: HistogramEntry): string[] {
  const rows = [...entry.series.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entry.labelNames.length === 0 && rows.length === 0) {
    rows.push(['', { bucketCounts: entry.buckets.map(() => 0), sum: 0, count: 0 }]);
  }
  const lines: string[] = [];
  for (const [labels, series] of rows) {
    const prefix = labels === '' ? '' : `${labels},`;
    let cumulative = 0;
    entry.buckets.forEach((upper, i) => {
      cumulative += series.bucketCounts[i] ?? 0;
      lines.push(`${name}_bucket{${prefix}le="${formatNumber(upper)}"} ${cumulative}`);
    });
    lines.push(`${name}_bucket{${prefix}le="+Inf"} ${series.count}`);
    lines.push(`${name}_sum${braces(labels)} ${formatNumber(series.sum)}`);
    lines.push(`${name}_count${braces(labels)} ${series.count}`);
  }
  return lines;
}

export function createMetrics(): MetricsRegistry {
  const entries = new Map<string, Entry>();

  function counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    checkRegistration(name, labelNames);
    if (!name.endsWith('_total')) {
      throw new Error(`invariant: counter ${name} must end with _total`);
    }
    const existing = entries.get(name);
    if (existing !== undefined) {
      if (existing.kind === 'counter' && sameList(existing.labelNames, labelNames)) {
        return existing.api;
      }
      throw new Error(`invariant: metric ${name} already registered differently`);
    }
    const series = new Map<string, number>();
    const api: Counter = {
      inc(labels?: Labels, by: number = 1): void {
        if (!Number.isFinite(by) || by < 0) {
          throw new Error(`invariant: counter ${name} increment must be finite and >= 0`);
        }
        const key = labelString(labelNames, labels, name);
        series.set(key, (series.get(key) ?? 0) + by);
      },
    };
    entries.set(name, { kind: 'counter', help, labelNames: [...labelNames], series, api });
    return api;
  }

  function gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    checkRegistration(name, labelNames);
    const existing = entries.get(name);
    if (existing !== undefined) {
      if (existing.kind === 'gauge' && sameList(existing.labelNames, labelNames)) {
        return existing.api;
      }
      throw new Error(`invariant: metric ${name} already registered differently`);
    }
    const series = new Map<string, number>();
    const api: Gauge = {
      set(value: number, labels?: Labels): void {
        series.set(labelString(labelNames, labels, name), value);
      },
    };
    entries.set(name, { kind: 'gauge', help, labelNames: [...labelNames], series, api });
    return api;
  }

  function histogram(
    name: string,
    help: string,
    buckets: readonly number[],
    labelNames: readonly string[] = [],
  ): Histogram {
    checkRegistration(name, labelNames);
    if (labelNames.includes('le')) {
      throw new Error(`invariant: histogram ${name} must not declare label le`);
    }
    const sorted = [...buckets].sort((a, b) => a - b);
    if (sorted.length === 0 || sorted.some((b, i) => !Number.isFinite(b) || (i > 0 && b === sorted[i - 1]))) {
      throw new Error(`invariant: histogram ${name} buckets must be non-empty, finite and distinct`);
    }
    const existing = entries.get(name);
    if (existing !== undefined) {
      if (
        existing.kind === 'histogram' &&
        sameList(existing.labelNames, labelNames) &&
        sameList(existing.buckets, sorted)
      ) {
        return existing.api;
      }
      throw new Error(`invariant: metric ${name} already registered differently`);
    }
    const series = new Map<string, HistogramSeries>();
    const api: Histogram = {
      observe(value: number, labels?: Labels): void {
        if (Number.isNaN(value)) {
          throw new Error(`invariant: histogram ${name} observed NaN`);
        }
        const key = labelString(labelNames, labels, name);
        let s = series.get(key);
        if (s === undefined) {
          s = { bucketCounts: sorted.map(() => 0), sum: 0, count: 0 };
          series.set(key, s);
        }
        const index = sorted.findIndex((upper) => value <= upper);
        if (index >= 0 && s.bucketCounts[index] !== undefined) {
          s.bucketCounts[index] += 1;
        }
        s.sum += value;
        s.count += 1;
      },
    };
    entries.set(name, { kind: 'histogram', help, labelNames: [...labelNames], buckets: sorted, series, api });
    return api;
  }

  function render(): string {
    const lines: string[] = [];
    const names = [...entries.keys()].sort();
    for (const name of names) {
      const entry = entries.get(name);
      if (entry === undefined) {
        continue;
      }
      lines.push(`# HELP ${name} ${escapeHelp(entry.help)}`, `# TYPE ${name} ${entry.kind}`);
      if (entry.kind === 'histogram') {
        lines.push(...renderHistogram(name, entry));
      } else {
        lines.push(...renderScalar(name, entry));
      }
    }
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  return { counter, gauge, histogram, render };
}
