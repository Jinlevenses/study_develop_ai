// content/ 트리 스캔 — 인식 경로 → 파일 종류(Brief T-01-03 §4.2). 그 밖 = V1 error `unknown-path`,
// IT-01 밖 자산 = `unsupported-in-it01`. README.md(루트)·.schemas/**·.source-cache/**·packs/<t>/CHANGELOG.md는 무시한다.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TrackId } from '@fathom/contracts/common/ids';

export type FileKind =
  | 'pack'
  | 'concept'
  | 'kus'
  | 'misconceptions'
  | 'items'
  | 'item-models'
  | 'rubrics'
  | 'templates-t2'
  | 'templates-dig'
  | 'sources-registry'
  | 'sources-requests'
  | 'review-v7';

export type DiscoveredFile = {
  readonly type: 'file';
  /** content 디렉터리 기준 posix 상대 경로. */
  readonly rel: string;
  readonly kind: FileKind;
  /** 팩 디렉터리 이름(packs/<t>/…) 또는 null. */
  readonly track: string | null;
  /** 확장자를 뺀 파일 이름(개념 id·slug·batch_id 등). pack.yaml = 'pack'. */
  readonly name: string;
  /** 확장자 포함 파일 이름. */
  readonly base: string;
  /** rubrics: templates/rubrics 공용 여부. */
  readonly common: boolean;
  /** review-v7: 디렉터리 = pack_id. */
  readonly packDir: string | null;
};

export type DiscoveredProblem = {
  readonly type: 'problem';
  readonly rel: string;
  readonly code: 'unsupported-in-it01' | 'unknown-path';
  readonly message: string;
};

export type Discovered = DiscoveredFile | DiscoveredProblem;

const TRACKS: ReadonlySet<string> = new Set<string>(TrackId.options);
const PACK_SUBDIR_KIND: Readonly<Record<string, FileKind>> = {
  concepts: 'concept',
  kus: 'kus',
  misconceptions: 'misconceptions',
  items: 'items',
  'item-models': 'item-models',
  rubrics: 'rubrics',
};

function byCode(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** 확장자를 뺀 이름. */
function stem(base: string): string {
  const i = base.lastIndexOf('.');
  return i <= 0 ? base : base.slice(0, i);
}

function unknown(rel: string): DiscoveredProblem {
  return { type: 'problem', rel, code: 'unknown-path', message: 'unknown-path: path is not part of the content tree' };
}

function unsupported(rel: string, what: string, wp: string): DiscoveredProblem {
  return {
    type: 'problem',
    rel,
    code: 'unsupported-in-it01',
    message: `unsupported-in-it01: ${what} is not supported in IT-01 (owner ${wp})`,
  };
}

function file(
  rel: string,
  kind: FileKind,
  track: string | null,
  base: string,
  extra: { common?: boolean; packDir?: string | null } = {},
): DiscoveredFile {
  return {
    type: 'file',
    rel,
    kind,
    track,
    name: stem(base),
    base,
    common: extra.common ?? false,
    packDir: extra.packDir ?? null,
  };
}

/** 한 경로를 분류한다. null = 무시. */
export function classify(rel: string): Discovered | null {
  const seg = rel.split('/');
  const base = seg[seg.length - 1] ?? '';
  const top = seg[0] ?? '';
  if (seg.length === 1 && base === 'README.md') {
    return null;
  }
  if (top === '.schemas' || top === '.source-cache') {
    return null;
  }
  if (top === 'blueprints') {
    return unsupported(rel, 'blueprints', 'WP-BP');
  }
  if (top === 'oracles') {
    return unsupported(rel, 'oracles', 'WP-05-12/.L');
  }
  if (top === 'packs') {
    const t = seg[1] ?? '';
    if (seg.length < 3) {
      return unknown(rel);
    }
    if (t.startsWith('x.')) {
      return unsupported(rel, `pack ${t}`, t === 'x.paths' ? 'WP-T-paths' : 'WP-BP');
    }
    if (!TRACKS.has(t)) {
      return unknown(rel);
    }
    if (seg.length === 3) {
      if (base === 'pack.yaml') {
        return file(rel, 'pack', t, base);
      }
      if (base === 'CHANGELOG.md') {
        return null;
      }
      if (base === 'corrections.yaml') {
        return unsupported(rel, 'corrections.yaml', 'release WP');
      }
      return unknown(rel);
    }
    const dir = seg[2] ?? '';
    if (dir === 'labs') {
      return unsupported(rel, 'labs', 'WP-05-12/.L');
    }
    if (dir === 'cases' || dir === 'artifacts') {
      return unsupported(rel, dir, `track ${t} .A WP`);
    }
    const kind = PACK_SUBDIR_KIND[dir];
    if (kind !== undefined && seg.length === 4) {
      if (kind === 'concept') {
        return file(rel, kind, t, base);
      }
      return base.endsWith('.yaml') ? file(rel, kind, t, base, { common: false }) : unknown(rel);
    }
    return unknown(rel);
  }
  if (top === 'templates' && seg.length === 3 && base.endsWith('.yaml')) {
    const sub = seg[1];
    if (sub === 't2') {
      return file(rel, 'templates-t2', null, base);
    }
    if (sub === 'dig') {
      return file(rel, 'templates-dig', null, base);
    }
    if (sub === 'rubrics') {
      return file(rel, 'rubrics', null, base, { common: true });
    }
    return unknown(rel);
  }
  if (top === 'sources') {
    if (seg.length === 2 && base === 'registry.yaml') {
      return file(rel, 'sources-registry', null, base);
    }
    if (seg.length === 3 && seg[1] === 'requests' && base.endsWith('.yaml')) {
      return file(rel, 'sources-requests', null, base);
    }
    return unknown(rel);
  }
  if (top === 'review' && seg[1] === 'V7' && seg.length === 4 && base.endsWith('.yaml')) {
    return file(rel, 'review-v7', null, base, { packDir: seg[2] ?? null });
  }
  return unknown(rel);
}

function walk(dir: string, relDir: string, out: Discovered[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCode(a.name, b.name));
  for (const e of entries) {
    const rel = relDir === '' ? e.name : `${relDir}/${e.name}`;
    if (e.isDirectory()) {
      if (relDir === '' && (e.name === '.schemas' || e.name === '.source-cache')) {
        continue;
      }
      walk(join(dir, e.name), rel, out);
    } else if (e.isFile()) {
      const c = classify(rel);
      if (c !== null) {
        out.push(c);
      }
    } else {
      out.push(unknown(rel));
    }
  }
}

/** content 디렉터리를 재귀 스캔한다(경로 코드 단위 사전순). */
export function discover(contentDir: string): Discovered[] {
  const out: Discovered[] = [];
  walk(contentDir, '', out);
  return out;
}
