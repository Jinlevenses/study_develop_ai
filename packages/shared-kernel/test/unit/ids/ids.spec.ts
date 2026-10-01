import { createFakeClock } from '@fathom/testkit/clock';
import { describe, expect, it } from 'vitest';
import { createUlid, isUlid, ulid } from '../../../src/ids/ids.js';

describe('ids', () => {
  it('UT-SK-027 ulid()는 대문자 26자 형식이다 [FR-PRG-027]', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('UT-SK-028 ulid() 1만 개가 엄격히 단조 증가한다 [FR-PRG-027][IR-017]', () => {
    // Arrange / Act
    const ids = Array.from({ length: 10_000 }, () => ulid());
    // Assert
    for (let i = 1; i < ids.length; i += 1) {
      expect((ids[i] ?? '') > (ids[i - 1] ?? '')).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('UT-SK-029 createUlid(clock)는 같은 ms 안에서 단조 증가한다 [FR-PRG-027]', () => {
    // Arrange
    const gen = createUlid(createFakeClock());
    // Act
    const ids = Array.from({ length: 100 }, () => gen());
    // Assert
    for (let i = 1; i < ids.length; i += 1) {
      expect((ids[i] ?? '') > (ids[i - 1] ?? '')).toBe(true);
    }
    expect(new Set(ids.map((id) => id.slice(0, 10))).size).toBe(1);
  });

  it('UT-SK-030 createUlid(clock)는 시계 진행을 시간 성분에 반영한다 [IR-017]', () => {
    // Arrange
    const clock = createFakeClock();
    const gen = createUlid(clock);
    const first = gen();
    // Act
    clock.advance(5000);
    const second = gen();
    // Assert
    expect(second.slice(0, 10) > first.slice(0, 10)).toBe(true);
    expect(isUlid(second)).toBe(true);
  });

  it('UT-SK-031 isUlid는 형식을 검사한다 [IR-017]', () => {
    expect(isUlid(ulid())).toBe(true);
    expect(isUlid('01HZX3Y5K7M9N2P4Q6R8S0T1V2')).toBe(true);
    expect(isUlid('01hzx3y5k7m9n2p4q6r8s0t1v2')).toBe(false);
    expect(isUlid('01HZX3Y5K7M9N2P4Q6R8S0T1VI')).toBe(false); // I 불허
    expect(isUlid('01HZX3Y5K7M9N2P4Q6R8S0T1V')).toBe(false);
    expect(isUlid(123)).toBe(false);
    expect(isUlid(null)).toBe(false);
  });
});
