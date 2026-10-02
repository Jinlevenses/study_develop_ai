// base 픽스처(docker.dockerfile.yaml 22문항, 12형식)에 더하는 10개 형식의 문항 — 22형식 전부를 emit 매핑 표로 검증하는 데 쓴다.
export const EXTRA_ITEMS_YAML = `  i23:
    format: mcq_multi
    facet: mechanism
    response_mode: recognition
    level: 1
    bloom: understand
    ku_refs: [k02]
    stem_family: sf_extra_multi
    gate_status: authored
    explanation_md: "RUN·COPY·ADD는 레이어를 만들고 CMD·ENV는 설정만 기록한다."
    stem: "파일시스템 레이어를 만드는 명령을 모두 고르시오."
    options:
      opt_a: "RUN"
      opt_b: "CMD"
      opt_c: "COPY"
      opt_d: "ENV"
    answer: { opt_c: true, opt_a: true }
  i24:
    format: order
    facet: operation
    response_mode: recognition
    level: 1
    bloom: apply
    ku_refs: [k04]
    stem_family: sf_extra_order
    gate_status: authored
    explanation_md: "FROM으로 시작해 WORKDIR, COPY, RUN, CMD 순서로 적는다."
    stem: "Node 서버 Dockerfile을 작성 순서대로 배열하시오."
    steps:
      s_from: "FROM node:22-slim"
      s_dir: "WORKDIR /app"
      s_copy: "COPY . ."
      s_cmd: "CMD [\\"node\\", \\"server.js\\"]"
    answer: [s_from, s_dir, s_copy, s_cmd]
  i25:
    format: matching
    facet: contrast
    response_mode: recognition
    level: 1
    bloom: understand
    ku_refs: [k03]
    stem_family: sf_extra_match
    gate_status: authored
    explanation_md: "RUN은 빌드할 때, CMD는 컨테이너가 시작될 때 실행된다."
    stem: "명령과 실행 시점을 짝지으시오."
    left:
      l_run: "RUN"
      l_cmd: "CMD"
    right:
      r_build: "빌드할 때 한 번"
      r_start: "컨테이너가 시작될 때"
    answer: { l_run: r_build, l_cmd: r_start }
  i26:
    format: code_predict
    facet: code
    response_mode: production
    level: 1
    bloom: apply
    ku_refs: [k03]
    stem_family: sf_extra_predict
    gate_status: authored
    explanation_md: "console.log는 인자를 공백으로 이어 한 줄에 출력한다."
    stem: "다음 코드의 출력을 쓰시오."
    code: { lang: js, src: "console.log('RUN', 'CMD');" }
    answer: { stdout: "RUN CMD" }
  i27:
    format: parsons
    facet: code
    response_mode: production
    level: 1
    bloom: apply
    ku_refs: [k04]
    stem_family: sf_extra_parsons
    gate_status: authored
    explanation_md: "FROM이 먼저 오고 그 위에 WORKDIR와 CMD가 이어진다."
    stem: "줄을 올바른 순서로 배열하시오."
    lang: dockerfile
    lines:
      ln_a: "FROM node:22-slim"
      ln_b: "WORKDIR /app"
      ln_c: "CMD [\\"node\\", \\"server.js\\"]"
      ln_d: "EXPOSE 99999"
    answer: [ln_a, ln_b, ln_c]
    distractors: [ln_d]
  i28:
    format: log_read
    facet: operation
    response_mode: recognition
    level: 1
    bloom: analyze
    ku_refs: [k01]
    stem_family: sf_extra_log
    gate_status: authored
    explanation_md: "step 3에서 COPY 대상 파일이 없어 빌드가 실패했다."
    stem: "빌드 로그에서 실패 원인을 고르시오."
    log: { lang: text, src: "Step 3/6 : COPY pkg.json ./\\nCOPY failed: file not found in build context" }
    options:
      opt_a: "빌드 컨텍스트에 파일이 없다"
      opt_b: "베이스 이미지를 받지 못했다"
      opt_c: "CMD 형식이 틀렸다"
    answer: opt_a
    distractor_mc: { opt_b: m04 }
  i29:
    format: cond_reversal
    facet: tradeoff
    response_mode: recognition
    level: 1
    bloom: evaluate
    ku_refs: [k02]
    stem_family: sf_extra_cond
    gate_status: authored
    explanation_md: "조건이 바뀌면 캐시를 보존하는 순서도 바뀐다."
    scenario: "의존성은 거의 바뀌지 않고 소스는 자주 바뀌는 서비스를 빌드한다."
    conditions: { cond_a: "의존성이 자주 바뀐다", cond_b: "의존성이 거의 바뀌지 않는다" }
    options: { opt_a: "소스 복사를 먼저 둔다", opt_b: "의존성 설치를 먼저 둔다" }
    answer: { cond_a: opt_a, cond_b: opt_b }
    pivot_md: "자주 바뀌는 층을 뒤에 둔다는 원칙은 같고 기준만 바뀐다."
  i30:
    format: fermi
    facet: tradeoff
    response_mode: production
    level: 1
    bloom: apply
    ku_refs: [k02]
    stem_family: sf_extra_fermi
    gate_status: authored
    explanation_md: "레이어 수와 레이어당 평균 크기를 곱해 대략의 이미지 크기를 추정한다."
    stem: "레이어가 12개이고 평균 40MB일 때 이미지 크기를 추정하시오."
    answer: { value: 480, unit: MB, log10_tol: 0.3 }
  i31:
    format: audit
    facet: operation
    response_mode: recognition
    level: 1
    bloom: evaluate
    ku_refs: [k08]
    mc_refs: [m02]
    stem_family: sf_extra_audit
    gate_status: authored
    explanation_md: "명령 순서는 빌드 캐시 적중률에 영향을 준다."
    prompt: "다음 설명에서 잘못된 문장을 찾으시오."
    artifact_md: "Dockerfile의 명령 순서는 빌드 시간과 무관하다. 앞 레이어가 바뀌어도 뒤 레이어는 항상 캐시에서 재사용된다. 따라서 COPY . . 를 가장 앞에 두어도 문제가 없다. 이 설명은 팀 위키에 실려 있다."
    defect_manifest:
      df_order: { quote: "명령 순서는 빌드 시간과 무관하다", kind: factual, mc_ref: m02, correction: "앞 레이어가 바뀌면 뒤 레이어를 모두 다시 만든다." }
  i32:
    format: pr_review
    facet: operation
    response_mode: recognition
    level: 1
    bloom: evaluate
    ku_refs: [k05]
    stem_family: sf_extra_pr
    gate_status: authored
    explanation_md: "비밀을 ENV로 넣으면 레이어에 남아 누구나 꺼낼 수 있다."
    prompt: "이 변경에서 문제가 되는 줄을 지적하시오."
    diff: { lang: diff, src: "+ENV API_TOKEN=abcd1234\\n+CMD node server.js" }
    defect_manifest:
      df_secret: { file: Dockerfile, from: 1, to: 1, kind: security_weakness, cwe: CWE-798, note: "토큰을 ENV로 넣었다." }
`;
