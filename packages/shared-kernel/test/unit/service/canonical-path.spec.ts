import { describe, expect, it } from 'vitest';
import {
  classOfUrl,
  decodedPathOf,
  isNonCanonicalTarget,
  rawPathOf,
  routeClassOf,
} from '../../../src/service/canonical-path.js';

describe('경로 정규형 검사 (canonical-path)', () => {
  it('UT-SK-208 isNonCanonicalTarget: 보호 경로로 해석되는 비정준·비 origin-form 대상은 true, 정규형·무관 경로·잘못된 인코딩은 false (gateway UT-GW-115 사례 동일) [NFR-SEC-003]', () => {
    const bypass = [
      '/%61pi/v1/cli/status',
      '/%69nternal/v1/activity?x=1',
      '/api%2Fv1/session',
      '/api/v1/%63li/status',
      '/api/v1/cli/%62ootstrap-token',
      '/api/v1/%2e%2e/cli/status',
      '/internal/v1/%6detrics',
      '/internal%2Fv1/metrics',
      '/%68ealthz',
      '/%72eadyz',
      'http://127.0.0.1:4747/api/v1/cli/status',
      'http://127.0.0.1:4747/internal/v1/activity',
      'HTTP://localhost/api/v1/cli/shutdown',
      '*',
      '',
    ];
    const fine = [
      '/api/v1/cli/status',
      '/internal/v1/activity',
      '/internal/v1/metrics?x=%6d',
      '/healthz',
      '/readyz?verbose=true',
      '/api/v1/concepts/%ED%95%9C',
      '/api/v1/things/a%20b',
      '/internal/v1/things/a%3Ab%2Fc',
      '/',
      '//x',
      '/assets/app-%41b.js',
      '/%61bout',
      '/api/v1/%E0%A4%A',
      '/internal/v1/%zz',
    ];
    for (const u of bypass) {
      expect(isNonCanonicalTarget(u), u).toBe(true);
    }
    for (const u of fine) {
      expect(isNonCanonicalTarget(u), u).toBe(false);
    }
  });

  it('UT-SK-209 routeClassOf·classOfUrl·rawPathOf·decodedPathOf: 접두·정확 일치 분류와 디코딩 규칙 [NFR-SEC-003]', () => {
    expect(routeClassOf('/internal/v1/metrics')).toBe('internal');
    expect(routeClassOf('/api/v1/cli/status')).toBe('api');
    expect(routeClassOf('/healthz')).toBe('health');
    expect(routeClassOf('/readyz')).toBe('health');
    expect(routeClassOf('/healthz/x')).toBe('other');
    expect(routeClassOf('/internal')).toBe('other');
    expect(routeClassOf('/apix/v1')).toBe('other');
    expect(routeClassOf('/')).toBe('other');
    expect(rawPathOf('/a/b?q=1?2')).toBe('/a/b');
    expect(rawPathOf('/a/b')).toBe('/a/b');
    expect(decodedPathOf('/%61pi/x?q=%62')).toBe('/api/x');
    expect(decodedPathOf('/%E0%A4%A')).toBeNull();
    // 라우트가 없는 요청의 등급은 디코딩 경로 기준(cache-control용), 디코딩 불가면 원문 경로
    expect(classOfUrl('/%69nternal/v1/x')).toBe('internal');
    expect(classOfUrl('/internal/v1/%zz')).toBe('internal');
    expect(classOfUrl('/nope')).toBe('other');
  });
});
