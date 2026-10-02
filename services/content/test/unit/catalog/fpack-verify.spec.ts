import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBundledPacks, selectBundledPacks } from '../../../src/infra/packs/bundled-packs.js';
import { MAX_FPACK_BYTES, readFpack } from '../../../src/infra/packs/fpack-reader.js';
import { merkleRoot } from '../../../src/infra/packs/merkle.js';
import { parseFpackTar } from '../../../src/infra/packs/ustar.js';
import type { PackSpec, Tamper } from './support/fpack-writer.js';
import {
  buildFpack,
  gateResultRecord,
  itemRecord,
  merkleOf,
  ustar,
  withHash,
  writeFpack,
} from './support/fpack-writer.js';

const SPEC: PackSpec = {
  concepts: [
    { slug: 'pod', level: 1 },
    { slug: 'service', level: 2, prereqs: ['pod'], mcs: 1 },
  ],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fathom-ct-fpack-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function faultOf(spec: PackSpec, tamper: Tamper, opts?: Parameters<typeof readFpack>[1]): string | null {
  const { file } = writeFpack(dir, spec, tamper);
  const res = readFpack(file, opts);
  return res.ok ? null : res.error.reason;
}

describe('catalog .fpack 검증 (infra/packs)', () => {
  it('UT-CT-020 merkle 검증 벡터 3개와 입력 순서 무관·작성기 독립 구현 일치 [FR-CUR-002][CR-46]', () => {
    // Arrange / Act / Assert
    expect(merkleRoot(['a'])).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    expect(merkleRoot(['a', 'b', 'c'])).toBe('535ad6d3811dc338ec7f974ee523fcc19a0fb7d68204c21818a93b0d572c4a21');
    expect(merkleRoot(['c', 'a', 'b'])).toBe('535ad6d3811dc338ec7f974ee523fcc19a0fb7d68204c21818a93b0d572c4a21');
    expect(merkleRoot(['{"kind":"edge"}', '{"kind":"track"}'])).toBe(
      '516a314758a680455f4dfaba37495f4586cd17278bdc32826f807ed012c8eab3',
    );
    expect(merkleRoot([Buffer.from('a')])).toBe(merkleRoot(['a']));
    expect(merkleOf(['a', 'b', 'c'])).toBe(merkleRoot(['a', 'b', 'c']));
    expect(merkleOf(['a'])).toBe(merkleRoot(['a']));
  });

  it('UT-CT-020 올바른 .fpack은 통과하고 manifest_hash·source_sha256·해시 맵이 채워진다 [FR-CUR-002]', () => {
    // Arrange
    const { file, built } = writeFpack(dir, SPEC);
    // Act
    const res = readFpack(file);
    // Assert
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.source_sha256).toBe(built.sha256);
    expect(res.value.manifest_hash).toBe(built.manifest_hash);
    expect(res.value.manifest.pack_id).toBe('k8s');
    expect([...res.value.concept_ids]).toEqual(['k8s.pod', 'k8s.service']);
    expect([...res.value.ku_hashes.keys()]).toEqual(['k8s.pod.k01', 'k8s.service.k01']);
    expect(res.value.records).toHaveLength(built.records.length);
    expect(JSON.parse(res.value.report_canonical)).toMatchObject({ schema_v: 1, tier_counts: { A: 2, B: 0, C: 0 } });
  });

  describe('UT-CT-021 ustar 엄격 검사', () => {
    const ok = buildFpack(SPEC).bytes;

    it('올바른 tar는 통과하고 끝 0 패딩이 더 붙어도 통과한다 [FR-CUR-002]', () => {
      expect(parseFpackTar(ok).ok).toBe(true);
      expect(parseFpackTar(Buffer.concat([ok, Buffer.alloc(1024)])).ok).toBe(true);
    });

    it('항목 순서가 다르면 tar_invalid [FR-CUR-002]', () => {
      expect(faultOf(SPEC, { entries: (e) => [e[1] as never, e[0] as never, ...e.slice(2)] })).toBe('tar_invalid');
    });

    it('checksum이 틀리면 tar_invalid [FR-CUR-002]', () => {
      expect(faultOf(SPEC, { entries: (e) => e.map((x, i) => (i === 2 ? { ...x, badChecksum: true } : x)) })).toBe(
        'tar_invalid',
      );
    });

    it('typeflag가 일반 파일이 아니면 tar_invalid [FR-CUR-002]', () => {
      expect(faultOf(SPEC, { entries: (e) => e.map((x, i) => (i === 0 ? { ...x, typeflag: '5' } : x)) })).toBe(
        'tar_invalid',
      );
    });

    it('절단된 아카이브(헤더·데이터·끝 블록 중간)는 tar_invalid [FR-CUR-002]', () => {
      for (const cut of [100, 512, 1000, ok.length - 1024 - 10, ok.length - 600, ok.length - 512]) {
        expect(parseFpackTar(ok.subarray(0, cut)).ok, `cut=${cut}`).toBe(false);
      }
    });

    it('5번째 항목은 tar_invalid [FR-CUR-002]', () => {
      const extra = (e: { name: string; bytes: Buffer }[]): { name: string; bytes: Buffer }[] => [
        ...e,
        { name: 'extra.txt', bytes: Buffer.from('x') },
      ];
      expect(faultOf(SPEC, { entries: extra })).toBe('tar_invalid');
    });

    it('항목이 4개 미만이면 tar_invalid [FR-CUR-002]', () => {
      expect(faultOf(SPEC, { entries: (e) => e.slice(0, 3) })).toBe('tar_invalid');
    });

    it('끝 0블록이 1개뿐이거나 그 뒤에 0이 아닌 바이트가 있으면 tar_invalid [FR-CUR-002]', () => {
      expect(faultOf(SPEC, { tar: { endBlocks: 1 } })).toBe('tar_invalid');
      expect(faultOf(SPEC, { tar: { trailing: Buffer.from('junk') } })).toBe('tar_invalid');
    });

    it('데이터 패딩이 0이 아니면 tar_invalid [FR-CUR-002]', () => {
      const bytes = Buffer.from(ok);
      // 첫 항목(manifest.json) 데이터 바로 뒤 첫 패딩 바이트를 오염시킨다.
      const size = Number.parseInt(bytes.toString('latin1', 124, 135), 8);
      expect(size % 512).not.toBe(0);
      bytes[512 + size] = 0x41;
      expect(parseFpackTar(bytes).ok).toBe(false);
    });
  });

  it('UT-CT-022 manifest files[]의 sha256·bytes가 실제 항목과 다르면 file_hash_mismatch [FR-CUR-002]', () => {
    const shaOff: Tamper = {
      refreshFiles: false,
      parts: (p) => {
        p.manifest.files = [
          { path: 'bundle.jsonl', sha256: '0'.repeat(64), bytes: 1 },
          { path: 'report.json', sha256: '0'.repeat(64), bytes: 1 },
          { path: 'layout.json', sha256: '0'.repeat(64), bytes: 1 },
        ];
      },
    };
    expect(faultOf(SPEC, shaOff)).toBe('file_hash_mismatch');
    // bytes만 다르고 sha256은 맞는 경우도 거부한다.
    const { file, built } = writeFpack(dir, SPEC);
    expect(readFpack(file).ok).toBe(true);
    const fixed = buildFpack(SPEC, {
      refreshFiles: false,
      parts: (p) => {
        p.manifest.files = built.parts.manifest.files.map((f, i) => (i === 1 ? { ...f, bytes: f.bytes + 1 } : f));
      },
    });
    writeFileSync(file, fixed.bytes);
    const res = readFpack(file);
    expect(res.ok ? null : res.error.reason).toBe('file_hash_mismatch');
  });

  it('UT-CT-022 manifest가 계약 위반이거나 files[]에 같은 파일이 두 번이면 manifest_invalid [FR-CUR-002]', () => {
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.manifest.version = 'one';
        },
      }),
    ).toBe('manifest_invalid');
    expect(
      faultOf(SPEC, {
        refreshFiles: false,
        parts: (p) => {
          p.manifest.files = [
            { path: 'bundle.jsonl', sha256: '0'.repeat(64), bytes: 1 },
            { path: 'bundle.jsonl', sha256: '0'.repeat(64), bytes: 1 },
            { path: 'report.json', sha256: '0'.repeat(64), bytes: 1 },
          ];
        },
      }),
    ).toBe('manifest_invalid');
    expect(
      faultOf(SPEC, { entries: (e) => e.map((x, i) => (i === 0 ? { ...x, bytes: Buffer.from('not json') } : x)) }),
    ).toBe('manifest_invalid');
  });

  it('UT-CT-023 레코드 content_hash가 정준형과 다르면 record_hash_mismatch:<줄>, gate_result는 예외 [FR-CUR-002][CR-46]', () => {
    // Arrange: 4번째 줄(track·source·rubric·concept 순)의 요약을 바꾸되 content_hash는 그대로 둔다.
    const tampered: Tamper = {
      parts: (p) => {
        const rec = JSON.parse(p.lines[3] as string) as Record<string, unknown>;
        rec.summary_ko = '바뀐 요약';
        p.lines[3] = JSON.stringify(rec);
      },
    };
    expect(faultOf(SPEC, tampered)).toBe('record_hash_mismatch:4');
    // gate_result의 content_hash는 검사 대상 리비전이라 레코드 해시 규칙을 적용하지 않는다.
    const item = withHash(itemRecord('k8s', 'pod', 1));
    const gate = gateResultRecord(String(item.item_id), 'f'.repeat(64));
    const withGate: PackSpec = {
      concepts: [{ slug: 'pod', items: 1 }],
      extra_records: [gate],
    };
    expect(faultOf(withGate, {})).toBeNull();
  });

  it('UT-CT-023 merkle 루트가 manifest와 다르면 merkle_mismatch [FR-CUR-002][FR-SET-014]', () => {
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.manifest.merkle_root = 'a'.repeat(64);
        },
      }),
    ).toBe('merkle_mismatch');
  });

  it('UT-CT-024 counts·track가 번들과 다르면 manifest_inconsistent [FR-CUR-002]', () => {
    const counts: Tamper = {
      parts: (p) => {
        (p.manifest.counts as { kus: number }).kus += 1;
      },
    };
    expect(faultOf(SPEC, counts)).toBe('manifest_inconsistent');
    for (const key of ['concepts', 'misconceptions', 'items', 'cases'] as const) {
      expect(
        faultOf(SPEC, {
          parts: (p) => {
            (p.manifest.counts as Record<string, number>)[key] = 99;
          },
        }),
        key,
      ).toBe('manifest_inconsistent');
    }
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.manifest.track = 'db';
        },
      }),
    ).toBe('manifest_inconsistent');
  });

  it('UT-CT-024 track 레코드가 0개·2개이거나 개념의 track_id가 다르면 manifest_inconsistent [FR-CUR-002]', () => {
    const dropTrack: Tamper = {
      parts: (p) => {
        p.lines.splice(0, 1);
        p.manifest.merkle_root = merkleOf(p.lines);
      },
    };
    expect(faultOf(SPEC, dropTrack)).toBe('manifest_inconsistent');
    const twoTracks: PackSpec = {
      ...SPEC,
      extra_records: [
        withHash({
          kind: 'track',
          track_id: 'db',
          name_ko: '데이터베이스',
          name_en: 'DB',
          track_group: 'infra',
          sort_order: 2,
          offline_cap_level: 1,
          oracle_cap_level: 1,
          summary_ko: '',
          ext: {},
        }),
      ],
    };
    expect(faultOf(twoTracks, {})).toBe('manifest_inconsistent');
    const foreignConcept: PackSpec = {
      ...SPEC,
      extra_records: [
        withHash({
          kind: 'concept',
          concept_id: 'db.index',
          track_id: 'db',
          level: 1,
          knowledge_type: 'C',
          tier: 'A',
          title_ko: '인덱스',
          title_en: 'Index',
          summary_ko: '요약',
          aliases: [],
          tags: [],
          volatility: 'stable',
          required_for_level: null,
          deprecated_by: null,
          theory_md: '',
          code_md: '',
          core_md: '',
          diagrams: {},
          sources: [],
          ext: {},
        }),
      ],
    };
    expect(faultOf(foreignConcept, {})).toBe('manifest_inconsistent');
  });

  it('UT-CT-025 BundleRecord 위반 줄은 record_invalid:<줄>, 끝 개행 없음·빈 줄·미지 키도 거부 [FR-CUR-002]', () => {
    // 줄 번호는 1부터 센다.
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.lines[4] = '{"kind":"nope"}';
        },
      }),
    ).toBe('record_invalid:5');
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          const rec = JSON.parse(p.lines[2] as string) as Record<string, unknown>;
          rec.surprise = 1;
          p.lines[2] = JSON.stringify(rec);
        },
      }),
    ).toBe('record_invalid:3');
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.lines.splice(1, 0, '');
        },
      }),
    ).toBe('record_invalid:2');
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.lines[1] = '{not json';
        },
      }),
    ).toBe('record_invalid:2');
    expect(faultOf(SPEC, { bundleBytes: (b) => b.subarray(0, b.length - 1) })).toMatch(/^record_invalid:/);
  });

  it('UT-CT-025 report.json에 kpi·tier_counts·cap_blockers가 없거나 layout이 객체가 아니면 report_invalid [FR-CUR-002]', () => {
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          delete p.report.kpi;
        },
      }),
    ).toBe('report_invalid');
    expect(
      faultOf(SPEC, {
        parts: (p) => {
          p.layout = [] as never;
        },
      }),
    ).toBe('report_invalid');
  });

  it('UT-CT-026 파일 64 MiB 초과·확장자·일반 파일 아님은 거부하고 줄 1 MiB 초과는 record_invalid [FR-CUR-002][CR-46]', () => {
    // 64 MiB + 1 바이트(희소 파일 — 읽기 전에 크기로 거부한다)
    const big = path.join(dir, 'big@1.0.0.fpack');
    const fd = openSync(big, 'w');
    closeSync(fd);
    truncateSync(big, MAX_FPACK_BYTES + 1);
    const tooLarge = readFpack(big);
    expect(tooLarge.ok ? null : tooLarge.error.reason).toBe('too_large');
    const edge = path.join(dir, 'edge@1.0.0.fpack');
    writeFileSync(edge, 'x');
    const small = readFpack(edge, { maxBytes: 0 });
    expect(small.ok ? null : small.error.reason).toBe('too_large');
    // 확장자·디렉터리·없는 파일
    const wrongExt = path.join(dir, 'k8s@1.0.0.tar');
    writeFileSync(wrongExt, 'x');
    expect(readFpack(wrongExt)).toMatchObject({ ok: false, error: { reason: 'file_invalid' } });
    const asDir = path.join(dir, 'dir.fpack');
    mkdirSync(asDir);
    expect(readFpack(asDir)).toMatchObject({ ok: false, error: { reason: 'file_invalid' } });
    expect(readFpack(path.join(dir, 'missing.fpack'))).toMatchObject({ ok: false, error: { reason: 'file_invalid' } });
    // 줄 상한: 1 MiB를 넘는 문항 본문
    const hugeItem = withHash({
      ...itemRecord('k8s', 'pod', 1),
      stem: { md: 'x'.repeat(1024 * 1024 + 10) },
    } as Record<string, unknown>);
    // content_hash는 stem을 바꾼 뒤 다시 계산해야 한다(위 withHash가 이미 새 본문 기준으로 계산).
    const hugeSpec: PackSpec = { concepts: [{ slug: 'pod', items: 0 }], extra_records: [hugeItem] };
    expect(faultOf(hugeSpec, {})).toMatch(/^record_invalid:\d+$/);
    // 옵션으로 낮춘 상한
    expect(faultOf(SPEC, {}, { maxLineBytes: 50 })).toMatch(/^record_invalid:\d+$/);
  });

  it('UT-CT-027 bundled 목록은 semver 최댓값 1개·track 필터·0개 처리 [FR-CUR-002][CR-46]', () => {
    // Arrange
    for (const name of [
      'k8s@1.0.0.fpack',
      'k8s@1.2.0.fpack',
      'k8s@1.10.0.fpack',
      'k8s@1.10.0-rc.1.fpack',
      'db@2.0.0.fpack',
      'junk.fpack',
      'k8s@bad.fpack',
      'readme.txt',
      'nope@1.0.0.fpack',
    ]) {
      writeFileSync(path.join(dir, name), '');
    }
    // Act
    const all = listBundledPacks(dir);
    const picked = selectBundledPacks(all, null);
    // Assert
    expect(all.map((p) => `${p.pack_id}@${p.version}`)).toEqual([
      'db@2.0.0',
      'k8s@1.0.0',
      'k8s@1.2.0',
      'k8s@1.10.0-rc.1',
      'k8s@1.10.0',
    ]);
    expect(picked.map((p) => `${p.pack_id}@${p.version}`)).toEqual(['db@2.0.0', 'k8s@1.10.0']);
    expect(selectBundledPacks(all, 'k8s').map((p) => p.version)).toEqual(['1.10.0']);
    expect(selectBundledPacks(all, 'net')).toEqual([]);
    expect(listBundledPacks(path.join(dir, 'does-not-exist'))).toEqual([]);
    expect(ustar([]).length).toBe(1024);
  });
});
