import { describe, expect, it } from 'vitest';
import {
  ArtifactId,
  BlueprintId,
  CallerName,
  CardId,
  CaseId,
  ConceptId,
  DeviceId,
  GoldId,
  ItemId,
  ItemModelId,
  KuId,
  LabId,
  MisconceptionId,
  ObjKey,
  ObjPath,
  PackId,
  PathId,
  PolicyRef,
  PolicySetId,
  ProviderId,
  RubricId,
  SemVer,
  ServiceName,
  Sha256Hex,
  SourceId,
  TrackId,
  Ulid,
} from '../../../src/common/ids.js';

const ULID = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, ...values: unknown[]) => {
  for (const v of values) {
    expect(schema.safeParse(v).success, `accept ${String(v)}`).toBe(true);
  }
};
const rejects = (schema: { safeParse: (v: unknown) => { success: boolean } }, ...values: unknown[]) => {
  for (const v of values) {
    expect(schema.safeParse(v).success, `reject ${String(v)}`).toBe(false);
  }
};

describe('common/ids', () => {
  it('UT-CON-002 ObjKey는 소문자 시작 2~32자만 받는다 [FR-AI-005]', () => {
    accepts(ObjKey, 'kp01', 'ab', 'a_b9', `a${'b'.repeat(31)}`);
    rejects(ObjKey, '0a', 'A', 'a', 'a'.repeat(33), 'Kp01', 'k-p', '');
  });

  it('UT-CON-010 Ulid·Sha256Hex·SemVer·ObjPath 경계 [IR-015]', () => {
    accepts(Ulid, ULID, '0'.repeat(26), '7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    rejects(
      Ulid,
      ULID.toLowerCase(),
      ULID.slice(1),
      `${ULID}0`,
      `U${ULID.slice(1)}`,
      `I${ULID.slice(1)}`,
      `O${ULID.slice(1)}`,
    );
    accepts(Sha256Hex, 'a'.repeat(64), '0123456789abcdef'.repeat(4));
    rejects(Sha256Hex, 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65));
    accepts(SemVer, '1.2.3', '0.0.0', '1.2.3-rc.1', '10.20.30-beta-2');
    rejects(SemVer, '1.2', 'v1.2.3', '1.2.3.4', '1.2.3-');
    accepts(ObjPath, 'key_points.kp01', 'ab', 'a_b.c_d.e_f.g_h');
    rejects(ObjPath, 'a.b.c.d.e', 'key_points.0a', 'Key.kp01', 'a.');
  });

  it('UT-CON-011 ServiceName·CallerName·DeviceId·PolicySetId·PolicyRef·TrackId는 닫힌 집합/고정 형식이다 [IR-015]', () => {
    expect(ServiceName.options).toEqual(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api']);
    expect(CallerName.options).toEqual(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api', 'browser', 'cli']);
    accepts(DeviceId, ULID);
    rejects(DeviceId, 'device-1');
    rejects(ServiceName, 'browser', 'ops');
    accepts(PolicySetId, 'ps_0123456789abcdef');
    rejects(PolicySetId, 'ps_0123456789abcde', 'ps_0123456789ABCDEF', 'PS_0123456789abcdef');
    accepts(PolicyRef, 'mastery_rules@v1', 'fsrs_params@v12', 'ai_policy@v1234');
    rejects(PolicyRef, 'Mastery@v1', 'mastery_rules@v', 'mastery_rules@1', 'mastery_rules@v12345', 'ab@v1');
    expect(TrackId.options).toHaveLength(20);
    expect(new Set(TrackId.options).size).toBe(20);
    accepts(TrackId, 'k8s', 'alg', 'data');
    rejects(TrackId, 'K8S', 'kubernetes', 'x');
  });

  it('UT-CON-012 ConceptId는 시드(점 1개)·사용자(u.<ns>.<slug>) 두 형식을 받고 접두 충돌을 거부한다 [IR-015]', () => {
    accepts(ConceptId, 'k8s.probes', 'docker.dockerfile', 'u.acme.vpn-setup', 'be.rest-api-2');
    rejects(
      ConceptId,
      'K8S.probes',
      'k8s',
      'k8s.',
      'k8s.Probes',
      'k8s.probes.k03',
      'foo.bar',
      'u.acme',
      'k8s.case.liveness-restart-storm',
      'docker.lab.dockerfile-faded',
      `k8s.${'a'.repeat(64)}`,
    );
    // 시드 slug가 case·art·lab인 개념은 정규식으로는 통과한다 — 금지는 packc R-ID lint의 몫이다(IF-01 §2.4 주석).
    accepts(ConceptId, 'k8s.case', 'k8s.lab', 'k8s.art');
  });

  it('UT-CON-013 KuId·MisconceptionId·CaseId·ArtifactId·LabId·SourceId·RubricId·PathId·BlueprintId 형식 [IR-015]', () => {
    accepts(KuId, 'k8s.probes.k03', 'u.acme.vpn-setup.k01', `k8s.probes.uk${'0a'.repeat(13)}`);
    rejects(
      KuId,
      'k8s.probes.k3',
      'k8s.probes.k003',
      'k8s.probes',
      `k8s.probes.uk${'0A'.repeat(13)}`,
      `k8s.probes.uk${'a'.repeat(25)}`,
    );
    accepts(MisconceptionId, 'k8s.probes.m01', 'u.acme.vpn-setup.m12');
    rejects(MisconceptionId, 'k8s.probes.m1', 'k8s.probes.k01', 'k8s.probes.m001');
    accepts(CaseId, 'k8s.case.liveness-restart-storm');
    rejects(CaseId, 'case.liveness', 'k8s.art.liveness', 'u.acme.case.x', 'xx.case.x');
    accepts(ArtifactId, 'sre.art.postmortem-cascading-latency');
    rejects(ArtifactId, 'sre.case.x', 'sre.art.', 'sre.art.Bad');
    accepts(LabId, 'docker.lab.dockerfile-faded');
    rejects(LabId, 'docker.dockerfile-faded', 'docker.lab.a_b');
    accepts(SourceId, 'src.docker-docs');
    rejects(SourceId, 'docker-docs', 'src.', 'src.Docker');
    accepts(RubricId, 'rb.feynman-teach');
    rejects(RubricId, 'rb.', 'rubric.x');
    accepts(PathId, 'path.backend-core');
    rejects(PathId, 'path.', 'paths.x');
    accepts(BlueprintId, 'cert-cka@2026');
    rejects(BlueprintId, 'cert-cka@26', 'cka@2026', 'cert-cka@20266');
  });

  it('UT-CON-014 ItemModelId·ItemId는 4형식(저작·T2 인스턴스·랩·ULID)을 받는다 [IR-015]', () => {
    accepts(ItemModelId, 'docker.dockerfile.im01', 'docker.dockerfile.imx-ku-cloze');
    rejects(ItemModelId, 'docker.dockerfile.im1', 'docker.dockerfile.i01');
    accepts(
      ItemId,
      'docker.dockerfile.i05', // 저작
      'docker.dockerfile.i123',
      'docker.dockerfile.im01.x0123456789ab', // T2 인스턴스
      'docker.dockerfile.imx-ku-cloze.xabcdefabcdef',
      'docker.lab.dockerfile-faded', // 랩 기반
      ULID, // 런타임
    );
    rejects(
      ItemId,
      'docker.dockerfile.i5',
      'docker.dockerfile.i1234',
      'docker.dockerfile.im01.x0123456789a',
      'docker.dockerfile.im01.xABCDEFABCDEF',
      ULID.toLowerCase(),
      'docker.dockerfile',
    );
  });

  it('UT-CON-015 PackId·CardId·GoldId·ProviderId 형식과 경계 [IR-015]', () => {
    accepts(PackId, 'k8s', 'x.blueprints', 'x.paths', 'u.local');
    rejects(PackId, 'k8s.extra', 'u.local.x', 'x', 'u', 'kubernetes', 'x.Blueprints');
    accepts(CardId, 'k8s.probes:definition:p', 'k8s.probes:concept:r', 'u.acme.vpn-setup:ops:r');
    rejects(CardId, 'k8s.probes:definition:x', 'k8s.probes:Definition:p', 'k8s.probes:definition', 'k8s.probes::p');
    accepts(GoldId, ULID, 'gold.AI-J03.017');
    rejects(GoldId, 'gold.AI-J3.017', 'gold.AI-J03.17', 'gold.ai-j03.017', ULID.toLowerCase());
    accepts(
      ProviderId,
      'jev',
      'anthropic-api',
      'openai-api',
      'gemini-api',
      'ollama',
      'claude-cli',
      'codex-cli',
      'gemini-cli',
      'gcli-aider',
      `gcli-${'a'.repeat(24)}`,
    );
    rejects(ProviderId, 'gcli-a', `gcli-${'a'.repeat(25)}`, 'gcli-Aider', 'openai', 'unknown-api');
  });
});
