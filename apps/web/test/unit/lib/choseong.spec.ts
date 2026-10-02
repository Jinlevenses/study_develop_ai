import { describe, expect, it } from 'vitest';
import { commandFilter, isChoseongQuery, matchesQuery } from '../../../src/lib/choseong.js';

describe('choseong', () => {
  it('UT-WEB-007 ㄷㅋ는 도커에 통과·쿠버네티스에 실패하고 dock은 Docker, keywords 매치, 빈 질의는 전부, commandFilter는 1/0이다 [FR-UX-005]', () => {
    expect(matchesQuery('도커', 'ㄷㅋ')).toBe(true);
    expect(matchesQuery('쿠버네티스', 'ㄷㅋ')).toBe(false);
    expect(matchesQuery('Docker', 'dock')).toBe(true);
    expect(matchesQuery('Docker', 'DOCK')).toBe(true);
    expect(matchesQuery('컨테이너 런타임', 'ㅋㅌㅇㄴ')).toBe(true);
    expect(matchesQuery('개념', 'k8s', ['kubernetes', 'k8s'])).toBe(true);
    expect(matchesQuery('개념', 'ㅋㅂ', ['쿠버네티스'])).toBe(true);
    expect(matchesQuery('아무거나', '')).toBe(true);
    expect(matchesQuery('아무거나', '   ')).toBe(true);
    expect(matchesQuery('도커', '쿠')).toBe(false);
    expect(commandFilter('도커', 'ㄷㅋ')).toBe(1);
    expect(commandFilter('쿠버네티스', 'ㄷㅋ')).toBe(0);
    expect(commandFilter('Docker', 'doc', ['컨테이너'])).toBe(1);
    expect(commandFilter('Docker', '컨', ['컨테이너'])).toBe(1);
  });

  it('UT-WEB-034 혼합 질의 ㄷ커는 부분 문자열 규칙이고 NFD 입력은 NFC로 비교하며 공백은 무시한다 [FR-UX-005]', () => {
    expect(isChoseongQuery('ㄷㅋ')).toBe(true);
    expect(isChoseongQuery('ㄷ ㅋ')).toBe(true);
    expect(isChoseongQuery('ㄷ커')).toBe(false);
    expect(isChoseongQuery('')).toBe(false);
    expect(isChoseongQuery('dock')).toBe(false);
    expect(matchesQuery('도커', 'ㄷ커')).toBe(false); // 혼합 = 부분 문자열
    expect(matchesQuery('ㄷ커 컨테이너', 'ㄷ커')).toBe(true);
    const nfd = '도커'.normalize('NFD');
    expect(nfd).not.toBe('도커');
    expect(matchesQuery('도커', nfd)).toBe(true);
    expect(matchesQuery(nfd, '도커')).toBe(true);
    expect(matchesQuery('도커 컴포즈', 'ㄷㅋ ㅋㅍㅈ')).toBe(true);
    expect(matchesQuery('도커 컴포즈', 'ㄷㅋㅋㅍㅈ')).toBe(true);
  });
});
