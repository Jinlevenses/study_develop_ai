import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/metrics/metrics.js';

describe('metrics', () => {
  it('UT-SK-064 counter는 _total 접미사와 이름 규칙을 강제한다 [NFR-AVL-006]', () => {
    const m = createMetrics();
    expect(() => m.counter('requests', 'h')).toThrow(/_total/);
    expect(() => m.counter('Bad_total', 'h')).toThrow(/invalid/);
    expect(() => m.gauge('1gauge', 'h')).toThrow(/invalid/);
    const c = m.counter('requests_total', 'Requests');
    c.inc();
    c.inc(undefined, 2);
    expect(m.render()).toContain('requests_total 3\n');
    expect(() => c.inc(undefined, -1)).toThrow(/>= 0/);
  });

  it('UT-SK-065 라벨 검증과 재등록 규칙 [NFR-AVL-006][IF-COM-003]', () => {
    // Arrange
    const m = createMetrics();
    const c = m.counter('http_total', 'h', ['route', 'status']);
    // Assert
    expect(() => c.inc({ route: 'a' })).toThrow(/missing label status/);
    expect(() => c.inc({ route: 'a', status: '200', extra: 'x' })).toThrow(/undeclared label extra/);
    expect(m.counter('http_total', 'other help', ['route', 'status'])).toBe(c);
    expect(() => m.counter('http_total', 'h', ['route'])).toThrow(/already registered/);
    expect(() => m.gauge('http_total', 'h', ['route', 'status'])).toThrow(/already registered/);
    expect(() => m.histogram('lat', 'h', [1], ['le'])).toThrow(/le/);
  });

  it('UT-SK-066 histogram은 누적 버킷·+Inf·sum·count를 낸다 [NFR-AVL-006][IF-COM-003]', () => {
    // Arrange
    const m = createMetrics();
    const h = m.histogram('latency_ms', 'Latency', [10, 100, 1]);
    // Act
    for (const v of [0.5, 5, 5, 50, 500]) {
      h.observe(v);
    }
    // Assert
    expect(m.render()).toBe(
      [
        '# HELP latency_ms Latency',
        '# TYPE latency_ms histogram',
        'latency_ms_bucket{le="1"} 1',
        'latency_ms_bucket{le="10"} 3',
        'latency_ms_bucket{le="100"} 4',
        'latency_ms_bucket{le="+Inf"} 5',
        'latency_ms_sum 560.5',
        'latency_ms_count 5',
        '',
      ].join('\n'),
    );
  });

  it('UT-SK-067 라벨이 있는 histogram은 le를 마지막 라벨로 낸다 [IF-COM-003]', () => {
    // Arrange
    const m = createMetrics();
    const h = m.histogram('dur_ms', 'D', [5], ['route']);
    // Act
    h.observe(3, { route: 'b' });
    h.observe(9, { route: 'a' });
    // Assert
    const text = m.render();
    expect(text).toContain('dur_ms_bucket{route="a",le="5"} 0\n');
    expect(text).toContain('dur_ms_bucket{route="a",le="+Inf"} 1\n');
    expect(text).toContain('dur_ms_bucket{route="b",le="5"} 1\n');
    expect(text.indexOf('route="a"')).toBeLessThan(text.indexOf('route="b"'));
  });

  it('UT-SK-068 gauge는 마지막 값을 덮어쓴다 [NFR-AVL-006]', () => {
    const m = createMetrics();
    const g = m.gauge('queue_depth', 'Depth', ['q']);
    g.set(5, { q: 'a' });
    g.set(2, { q: 'a' });
    g.set(-1.5, { q: 'b' });
    expect(m.render()).toBe(
      [
        '# HELP queue_depth Depth',
        '# TYPE queue_depth gauge',
        'queue_depth{q="a"} 2',
        'queue_depth{q="b"} -1.5',
        '',
      ].join('\n'),
    );
  });

  it('UT-SK-069 출력은 이름·시계열 정렬, 라벨 이스케이프, 호출 순서와 무관한 결정성을 가진다 [NFR-AVL-006][IF-COM-003]', () => {
    // Arrange
    const build = (reverse: boolean): string => {
      const m = createMetrics();
      const steps: Array<() => void> = [
        () => m.counter('zeta_total', 'Z').inc(),
        () => m.counter('alpha_total', 'A "quoted"\nline', ['v']).inc({ v: 'x\\y"z\nw' }),
        () => m.counter('alpha_total', 'A', ['v']).inc({ v: 'a' }),
      ];
      for (const step of reverse ? [...steps].reverse() : steps) {
        step();
      }
      return m.render();
    };
    // Act
    const forward = build(false);
    const backward = build(true);
    // Assert
    expect(forward.indexOf('alpha_total')).toBeLessThan(forward.indexOf('zeta_total'));
    expect(forward).toContain('alpha_total{v="a"} 1\nalpha_total{v="x\\\\y\\"z\\nw"} 1\n');
    expect(forward).toContain('# HELP alpha_total A "quoted"\\nline');
    expect(forward.endsWith('zeta_total 1\n')).toBe(true);
    expect(forward.endsWith('\n\n')).toBe(false);
    expect(createMetrics().render()).toBe('');
    // 같은 연산 집합 → 같은 텍스트(help는 첫 등록 기준이므로 순서가 뒤바뀌면 help만 다르다)
    expect(forward.split('\n').filter((l) => !l.startsWith('# HELP'))).toEqual(
      backward.split('\n').filter((l) => !l.startsWith('# HELP')),
    );
  });
});
