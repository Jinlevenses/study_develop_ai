import { z } from 'zod';

export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export type Ulid = z.infer<typeof Ulid>;
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export type Sha256Hex = z.infer<typeof Sha256Hex>;
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
export type SemVer = z.infer<typeof SemVer>;
export const ObjKey = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/); // 선택지·빈칸·KP·Jev 키 — 배열 인덱스 대체(UR-16)
export type ObjKey = z.infer<typeof ObjKey>;
export const ObjPath = z.string().regex(/^[a-z][a-z0-9_]{1,31}(\.[a-z][a-z0-9_]{1,31}){0,3}$/); // 'key_points.kp01'
export type ObjPath = z.infer<typeof ObjPath>;
export const ServiceName = z.enum(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api']);
export type ServiceName = z.infer<typeof ServiceName>;
export const CallerName = z.enum(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api', 'browser', 'cli']);
export type CallerName = z.infer<typeof CallerName>;
export const DeviceId = Ulid;
export type DeviceId = z.infer<typeof DeviceId>;
export const PolicySetId = z.string().regex(/^ps_[0-9a-f]{16}$/); // 정책 세트 콘텐츠 주소(ADR-004 §9)
export type PolicySetId = z.infer<typeof PolicySetId>;
export const PolicyRef = z.string().regex(/^[a-z][a-z0-9_]{2,40}@v\d{1,4}$/); // 'mastery_rules@v1'
export type PolicyRef = z.infer<typeof PolicyRef>;

// 커리큘럼 ID — packc R-ID 문법(DCP-01 §5.2 = DB-01 §3.3 = 이 블록이 단일 정본, CR-35). 조각 문자열은 이 파일 안에서만 쓰는 상수다.
export const TrackId = z.enum([
  'alg',
  'cs',
  'net',
  'lang',
  'fe',
  'be',
  'db',
  'linux',
  'docker',
  'k8s',
  'cicd',
  'sre',
  'cloud',
  'sec',
  'ml',
  'llm',
  'arch',
  'eng',
  'lead',
  'data',
]);
export type TrackId = z.infer<typeof TrackId>;
const T = '(?:alg|cs|net|lang|fe|be|db|linux|docker|k8s|cicd|sre|cloud|sec|ml|llm|arch|eng|lead|data)';
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const C = `(?:u\\.[a-z0-9]+\\.${SLUG}|${T}\\.${SLUG})`; // 개념 ID 몸통: 시드 '<track>.<slug>'(점 1개) · 사용자 'u.<ns>.<slug>'(점 2개)
const re = (body: string) => new RegExp(`^(?:${body})$`);
export const ConceptId = z.string().max(64).regex(re(C)); // 'k8s.probes', 'u.acme.vpn-setup'
export type ConceptId = z.infer<typeof ConceptId>;
export const KuId = z
  .string()
  .max(96)
  .regex(re(`${C}\\.(?:k\\d{2}|uk[0-9a-z]{26})`)); // 'k8s.probes.k03' · 사용자 KU 'k8s.probes.uk<ulid 소문자 26>'
export type KuId = z.infer<typeof KuId>;
export const MisconceptionId = z
  .string()
  .max(80)
  .regex(re(`${C}\\.m\\d{2}`)); // 'k8s.probes.m01'
export type MisconceptionId = z.infer<typeof MisconceptionId>;
export const CaseId = z
  .string()
  .max(96)
  .regex(re(`${T}\\.case\\.${SLUG}`)); // 'k8s.case.liveness-restart-storm'(주 트랙 접두어)
export type CaseId = z.infer<typeof CaseId>;
export const ArtifactId = z
  .string()
  .max(96)
  .regex(re(`${T}\\.art\\.${SLUG}`)); // 'sre.art.postmortem-cascading-latency'
export type ArtifactId = z.infer<typeof ArtifactId>;
export const LabId = z
  .string()
  .max(96)
  .regex(re(`${T}\\.lab\\.${SLUG}`)); // 'docker.lab.dockerfile-faded'
export type LabId = z.infer<typeof LabId>;
export const SourceId = z
  .string()
  .max(96)
  .regex(re(`src\\.${SLUG}`)); // 'src.docker-docs'
export type SourceId = z.infer<typeof SourceId>;
export const RubricId = z
  .string()
  .max(96)
  .regex(re(`rb\\.${SLUG}`)); // 'rb.feynman-teach'
export type RubricId = z.infer<typeof RubricId>;
export const PathId = z
  .string()
  .max(96)
  .regex(re(`path\\.${SLUG}`)); // 'path.backend-core'
export type PathId = z.infer<typeof PathId>;
export const BlueprintId = z
  .string()
  .max(64)
  .regex(re(`cert-${SLUG}@\\d{4}`)); // 'cert-cka@2026'
export type BlueprintId = z.infer<typeof BlueprintId>;
export const ItemModelId = z
  .string()
  .max(120)
  .regex(re(`${C}\\.(?:im\\d{2}|imx-${SLUG})`)); // 'docker.dockerfile.im01' · 템플릿 사본 'docker.dockerfile.imx-ku-cloze'
export type ItemModelId = z.infer<typeof ItemModelId>;
export const ItemId = z
  .string()
  .max(140)
  .regex(
    re(
      `${C}\\.i\\d{2,3}` + // 저작 'docker.dockerfile.i05'
        `|${C}\\.(?:im\\d{2}|imx-${SLUG})\\.x[0-9a-f]{12}` + // T2 인스턴스 '<model_id>.x<sha256 앞 12>'
        `|${T}\\.lab\\.${SLUG}` + // 랩 기반 문항 = lab_id(DCP DN-38)
        `|[0-9A-HJKMNP-TV-Z]{26}`,
    ),
  ); // 런타임(T3·T4·가져오기·사용자 저작) ULID
export type ItemId = z.infer<typeof ItemId>;
export const PackId = z
  .string()
  .max(48)
  .regex(re(`${T}|x\\.${SLUG}|u\\.[a-z0-9]+`)); // 트랙 팩 'k8s' · 공용 'x.blueprints'·'x.paths' · 사용자 'u.local'
export type PackId = z.infer<typeof PackId>;
export const CardId = z
  .string()
  .max(120)
  .regex(re(`${C}:[a-z][a-z_]{0,31}:(?:r|p)`)); // '<concept_id>:<facet>:r|p'(r = recognition, p = production) — 원장 키 'card:<card_id>'
export type CardId = z.infer<typeof CardId>;
export const GoldId = z.union([Ulid, z.string().regex(/^gold\.AI-J\d{2}\.\d{3}$/)]); // 시드 골드 'gold.AI-J03.017' · 런타임 ULID(DCP-01 §5.2, DB ai_gold_item)
export type GoldId = z.infer<typeof GoldId>;
// packc 추가 lint(R-ID): 시드 개념 slug ∈ {case, art, lab}는 금지(LabId·CaseId·ArtifactId와의 접두 충돌 방지)
export const ProviderId = z
  .string()
  .regex(/^(jev|anthropic-api|openai-api|gemini-api|ollama|claude-cli|codex-cli|gemini-cli|gcli-[a-z0-9-]{2,24})$/);
export type ProviderId = z.infer<typeof ProviderId>;
