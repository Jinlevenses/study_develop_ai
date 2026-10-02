# Graph Report - study_develop_ai  (2026-10-02)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 5488 nodes · 13038 edges · 217 communities (210 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 150 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b787800d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- v1/ai.ts
- route.ts
- domain.ts
- learner.ts
- err
- learning/v1/sessions.ts
- @tanstack/react-router
- contract.ts
- ensure-running.ts
- public-auth.ts
- errors/errors.ts
- sqlite.ts
- static-route.ts
- gen.ts
- cn
- preflight.ts
- ops/src/config.ts
- serve.ts
- insight.ts
- badge-section.tsx
- service/types.ts
- scripts
- config/config.ts
- service.ts
- learning/v1/settings.ts
- lib/hotkeys.ts
- learning/v1/longtasks.ts
- bundle.ts
- lock-cli.ts
- eventing/inbox.ts
- client.ts
- api-client.ts
- iconProps
- ai-gateway/src/config.ts
- si-docs/src/cli.ts
- eventing.ts
- fake-cli/package.json
- panel.tsx
- check-boundaries.mjs
- hat.ts
- hub.ts
- rtm.ts
- ServiceDeps
- ref_react
- ref_node_path
- graph/src/cli.ts
- check-sql-template.mjs
- component-section.tsx
- dependencies
- ok
- testkit/package.json
- spawn-stack.ts
- nav-rail.tsx
- shared-kernel/package.json
- createLifecycle
- si-docs/src/ids.ts
- GateEngineError
- ai-gateway/src/infra/events/wiring.ts
- log-sink.ts
- web/package.json
- attempt-queue.ts
- generate
- supervisor.ts
- EpochMs
- check-security-scan.mjs
- v1/curation.ts
- shell-deps.tsx
- materials.ts
- http-client.ts
- metrics.ts
- check-ng-g.mjs
- itr.ts
- packc/package.json
- service/app.ts
- createSupervisor
- graph/package.json
- check-manifest.mjs
- button.tsx
- main.tsx
- sse.ts
- learning/package.json
- cli/package.json
- code-block.tsx
- log.ts
- contracts/package.json
- portable-schema.ts
- egress-sampler.ts
- ops/package.json
- vitest-preset.ts
- process-table.ts
- design-tokens/package.json
- ai-gateway/package.json
- gateway/package.json
- tasks
- ui/package.json
- error-registry.ts
- si-docs/package.json
- dod.ts
- proc.ts
- results.ts
- lib/args.ts
- control-ipc.ts
- lifecycle.ts
- check-hooks.mjs
- admin/admin-routes.ts
- ops/v1/errors.ts
- src/tokens.ts
- segmented-control.tsx
- stack-fixture.ts
- check-typo-ko.mjs
- run-gates.mjs
- package.json
- AGENTS.md — Fathom · 깊이 (Codex 계열 코딩 에이전트 지침, 요약)
- gateway/src/config.ts
- chaos.ts
- utr.ts
- compilerOptions
- devDependencies
- ops/src/infra/db/open.ts
- gateway-client.ts
- drawer.tsx
- supervisor/args.ts
- devDependencies
- header.tsx
- mermaid-figure.tsx
- runStop
- tabs.tsx
- launchStack
- pgm.ts
- ai-gateway/v1/errors.ts
- learning/v1/errors.ts
- exports
- registry.ts
- lib/idempotency.ts
- rules
- color.ts
- buildStack
- dependencies
- use-windowed-rows.ts
- child-env.ts
- ApiClient
- SupervisedService
- card.tsx
- Stack
- check-consumers.mjs
- common.mjs
- token-section.tsx
- biome.json
- style
- RuntimeFilesPort
- motion.ts
- gates/package.json
- devDependencies
- @fathom/app-cli
- @fathom/app-web
- @fathom/contracts
- shared-kernel/tsconfig.build.json
- compilerOptions
- compilerOptions
- compilerOptions
- cli/tsconfig.json
- cli/tsconfig.build.json
- choseong.ts
- web/tsconfig.build.json
- db-hooks.ts
- contracts/tsconfig.build.json
- design-tokens/tsconfig.build.json
- testkit/tsconfig.build.json
- ui/tsconfig.build.json
- ai-gateway/tsconfig.build.json
- gateway/tsconfig.build.json
- learning/tsconfig.build.json
- ops/tsconfig.build.json
- fake-cli/tsconfig.build.json
- gates/tsconfig.build.json
- graph/tsconfig.build.json
- packc/tsconfig.build.json
- si-docs/tsconfig.build.json
- @fathom/design-tokens
- suspicious
- contracts/tsconfig.json
- design-tokens/tsconfig.json
- shared-kernel/tsconfig.json
- testkit/tsconfig.json
- scripts
- ai-gateway/tsconfig.json
- gateway/tsconfig.json
- learning/tsconfig.json
- ops/tsconfig.json
- fake-cli/tsconfig.json
- graph/tsconfig.json
- packc/tsconfig.json
- si-docs/tsconfig.json
- formatter
- formatter
- prng.ts
- ime-safe-input.tsx
- gates/tsconfig.json
- nursery
- vcs
- @fathom/shared-kernel
- gates/vitest.config.ts
- @fathom/testkit
- ./components/*
- @fathom/ui
- @fathom/svc-ai-gateway
- @fathom/svc-gateway
- @fathom/svc-learning
- @fathom/svc-ops
- @fathom/tool-fake-cli
- @fathom/tool-gates
- @fathom/tool-graph
- @fathom/tool-packc
- @fathom/tool-si-docs
- README.md

## God Nodes (most connected - your core abstractions)
1. `S()` - 139 edges
2. `Ulid` - 89 edges
3. `cn()` - 83 edges
4. `ok()` - 81 edges
5. `err()` - 76 edges
6. `EpochMs` - 62 edges
7. `ServiceName` - 62 edges
8. `GateEngineError` - 59 edges
9. `ServiceDeps` - 56 edges
10. `ServiceApp` - 55 edges

## Surprising Connections (you probably didn't know these)
- `6. 핵심 규약 (STD-01 조항 ID를 커밋·보고에 인용)` --references--> `Result`  [INFERRED]
  AGENTS.md → packages/shared-kernel/src/errors/errors.ts
- `6. 핵심 규약 (STD-01 조항 ID를 커밋·보고에 인용)` --references--> `Clock`  [INFERRED]
  AGENTS.md → packages/shared-kernel/src/time/time.ts
- `5. 코딩 표준 핵심 20 (STD-01 — 조항 ID를 커밋·보고에 인용)` --references--> `Clock`  [INFERRED]
  CLAUDE.md → packages/shared-kernel/src/time/time.ts
- `6. 핵심 규약 (STD-01 조항 ID를 커밋·보고에 인용)` --references--> `openDb()`  [INFERRED]
  AGENTS.md → packages/shared-kernel/src/sqlite/sqlite.ts
- `5. 코딩 표준 핵심 20 (STD-01 — 조항 ID를 커밋·보고에 인용)` --references--> `resolveInside()`  [INFERRED]
  CLAUDE.md → packages/shared-kernel/src/config/config.ts

## Import Cycles
- None detected.

## Communities (217 total, 7 thin omitted)

### Community 0 - "v1/ai.ts"
Cohesion: 0.01
Nodes (190): ADR-0005, ADR-0016, ContextBlock, ContextRef, AiErrorClass, G01Input, G02Input, G03Input (+182 more)

### Community 1 - "route.ts"
Cohesion: 0.02
Nodes (143): defineRoute(), GoldImportResult, CliAutostartBody, CliAutostartRoute, CliBackupRoute, CliBlueprintImportRoute, CliCaptureRoute, CliDoctorRoute (+135 more)

### Community 2 - "domain.ts"
Cohesion: 0.03
Nodes (96): ADR-0011, AiMode, Facet, FormatId, GraderEngine, KnowledgeType, Level, Locale (+88 more)

### Community 3 - "learner.ts"
Cohesion: 0.03
Nodes (61): Page(), PageQuery, BlueprintsImportRoute, BlueprintsListRoute, ConceptPageView, ConceptsGetRoute, ConceptsNeighborsRoute, ConceptsOutdatedReportRoute (+53 more)

### Community 4 - "err"
Cohesion: 0.10
Nodes (30): classify(), call(), PolicyLock, err(), interpret(), failure(), CORE_TAGS, fail() (+22 more)

### Community 5 - "learning/v1/sessions.ts"
Cohesion: 0.03
Nodes (69): AttemptPhase, DialogKind, AppealsGetRoute, EvidenceConfirmRatingRoute, GW_PRACTICE_ITEMS_ROUTES, ItemsHintRoute, ItemsReportRoute, LabsPlatformRoute (+61 more)

### Community 6 - "@tanstack/react-router"
Cohesion: 0.07
Nodes (29): safeSearch(), AiSearch, Route, Route, Route, ConceptSearch, ONE, Route (+21 more)

### Community 7 - "contract.ts"
Cohesion: 0.05
Nodes (74): HttpMethod, assertSafeInteger(), createFakeClock(), FakeClock, FIXED_EPOCH_MS, build(), deriveMutations(), isNode() (+66 more)

### Community 8 - "ensure-running.ts"
Cohesion: 0.10
Nodes (51): DOWN_WAIT_MS, runDown(), ADR-0012, waitGone(), runOpen(), runStatus(), showHuman(), showPartial() (+43 more)

### Community 9 - "public-auth.ts"
Cohesion: 0.06
Nodes (60): ActivityView, InternalActivityRoute, SessionCsrfRoute, SessionExchangeRoute, SessionLogoutRoute, SessionStatusRoute, CliTokenReader, createCliTokenReader() (+52 more)

### Community 10 - "errors/errors.ts"
Cohesion: 0.06
Nodes (27): Problem, ErrorCodeString, ProblemExtras, Result, PeerFailure, createWriteGate(), armAuto(), clearAuto() (+19 more)

### Community 11 - "sqlite.ts"
Cohesion: 0.05
Nodes (37): 5. 코딩 표준 핵심 20 (STD-01 — 조항 ID를 커밋·보고에 인용), Counter, Histogram, ident(), placeholders(), sqlInt(), MigrateFailure, MigrateOptions (+29 more)

### Community 12 - "static-route.ts"
Cohesion: 0.13
Nodes (28): RFC-3986, isInside(), resolveInside(), DEFAULT_VITE_ORIGIN, classifyPathOf(), decodedPathOf(), GUARDED_PREFIXES, isEncodedBypass() (+20 more)

### Community 13 - "gen.ts"
Cohesion: 0.05
Nodes (81): OpsSearch, Route, Route, SessionSearch, Collected, ConsumerManifestT, DEFAULT_ROOT, ErrorEntry (+73 more)

### Community 14 - "cn"
Cohesion: 0.07
Nodes (39): Command(), CommandEmpty(), CommandGroup(), CommandInput(), CommandItem(), CommandItemProps, CommandList(), CommandProps (+31 more)

### Community 15 - "preflight.ts"
Cohesion: 0.07
Nodes (46): Profile, BrowserDeps, findOnPath(), openBrowser(), resolveCommand(), SafeSpawnFn, BASE_NAMES, baseEnv() (+38 more)

### Community 16 - "ops/src/config.ts"
Cohesion: 0.08
Nodes (31): registerApp(), AutostartDeps, AutostartPorts, registerAutostart(), BackupDeps, BackupPorts, registerBackup(), DoctorDeps (+23 more)

### Community 17 - "serve.ts"
Cohesion: 0.06
Nodes (57): BootstrapEnvelope, IpcSupervisorToService, AllowedEnvName, readAllowedEnv(), Logger, createIpcInbox(), FirstMessage, IpcInbox (+49 more)

### Community 18 - "insight.ts"
Cohesion: 0.05
Nodes (53): MapSearch, Route, DegradedPart, Energy, Lifecycle, MasteryStatus, SessionMinutes, BlueprintId (+45 more)

### Community 19 - "badge-section.tsx"
Cohesion: 0.06
Nodes (39): ConnectionChip(), ConnectionChipProps, DOT, BadgeSection(), DOTS, JUDGE, Row(), STATES (+31 more)

### Community 20 - "service/types.ts"
Cohesion: 0.05
Nodes (57): IpcJob, JobName, ALLOWED_ENV, ActiveJob, allowlistedEnv(), createJobRunner(), execute(), start() (+49 more)

### Community 21 - "scripts"
Cohesion: 0.04
Nodes (53): scripts, ai:eval, ai:eval:gates, ai:lint-prompts, ai:record, audit:graph, build, bundle (+45 more)

### Community 22 - "config/config.ts"
Cohesion: 0.11
Nodes (32): ALLOWED_ENV_SET, DIR_FSYNC_IGNORABLE, errnoCode(), FathomHomeDeps, fsyncDirectory(), HomeKind, homePath(), MISSING_CODES (+24 more)

### Community 23 - "service.ts"
Cohesion: 0.07
Nodes (40): createService(), CreateServiceOptions, ReqPart, ServiceDatabase, WriteGateOptions, OpenDbOptions, SqlitePort, registerApp() (+32 more)

### Community 24 - "learning/v1/settings.ts"
Cohesion: 0.06
Nodes (44): CardsListRoute, CardsResumeRoute, CardsRetireRoute, CardsSuspendRoute, GW_SETTINGS_ROUTES, SettingsDdayDeleteRoute, SettingsDdayPutRoute, SettingsDeclarationsRoute (+36 more)

### Community 25 - "lib/hotkeys.ts"
Cohesion: 0.08
Nodes (34): CodeEditor(), CodeEditorProps, editorKeyAction(), languageExtension(), RUN, SUBMIT, Combo, createHotkeyManager() (+26 more)

### Community 26 - "learning/v1/longtasks.ts"
Cohesion: 0.05
Nodes (45): Confidence, JudgeBadge, ArtifactId, ObjKey, ArtifactTemplateKind, AttemptResponse, DialogEndReason, DialogMove (+37 more)

### Community 27 - "bundle.ts"
Cohesion: 0.08
Nodes (35): RunModeArgs, canonicalJson(), encode(), fail(), FORBIDDEN_JSON_KEYS, isPlainObject(), sha256Hex(), policyContentHash() (+27 more)

### Community 28 - "lock-cli.ts"
Cohesion: 0.07
Nodes (38): AiPolicyV1, CbmParamsV1, ComposerPolicyV1, FsrsParamsV1, GamingParamsV1, Band, EvidencePolicy, GateThresholdsV1 (+30 more)

### Community 29 - "eventing/inbox.ts"
Cohesion: 0.11
Nodes (18): installExperimentalWarningFilter(), InboxDelivery, checkConfig(), errorDetail(), EventResult, inboxError(), inboxErrorCode(), inboxPlugin() (+10 more)

### Community 30 - "client.ts"
Cohesion: 0.12
Nodes (19): ackOf(), createRequester(), onMessage(), transmit(), wait(), createSupervisorControl(), DEFAULT_TIMEOUT_MS, Fail (+11 more)

### Community 31 - "api-client.ts"
Cohesion: 0.07
Nodes (37): ApiClientDeps, ApiError, ApiFailure, buildQuery(), buildRequest(), BuildResult, Built, CallOptions (+29 more)

### Community 32 - "iconProps"
Cohesion: 0.06
Nodes (38): CODE_LANG, SafeMarkdown(), SafeMarkdownProps, SANITIZE_SCHEMA, ICON, ReasonChip(), ReasonChipProps, AiOfflineNote() (+30 more)

### Community 33 - "ai-gateway/src/config.ts"
Cohesion: 0.09
Nodes (29): registerApp(), ControlDeps, ControlPorts, registerControl(), GenerateDeps, GeneratePorts, registerGenerate(), JudgeDeps (+21 more)

### Community 34 - "si-docs/src/cli.ts"
Cohesion: 0.10
Nodes (40): buildContext(), CliEnv, COMMANDS, Context, DEFAULT_ENV, headerLine(), idsCommand(), InputError (+32 more)

### Community 35 - "eventing.ts"
Cohesion: 0.05
Nodes (57): 6. 핵심 규약 (STD-01 조항 ID를 커밋·보고에 인용), AdminEventsView, InboxAck, defineInboxHandler(), InboxDeps, InboxFailureCode, InboxOutcome, appendEvent() (+49 more)

### Community 36 - "fake-cli/package.json"
Cohesion: 0.08
Nodes (23): dependencies, @fathom/contracts, @fathom/shared-kernel, zod, devDependencies, @fathom/testkit, @types/node, vitest (+15 more)

### Community 37 - "panel.tsx"
Cohesion: 0.25
Nodes (8): RouteStub(), RouteStubProps, NotYetRenderer(), NotYetRendererProps, EmptyState(), HEADING, Panel(), PanelProps

### Community 38 - "check-boundaries.mjs"
Cohesion: 0.08
Nodes (49): typescript, checkDatabaseSync(), checkFile(), ESCAPABLE_RULES, escapeRe(), evaluateImport(), relTarget(), runBoundaries() (+41 more)

### Community 39 - "hat.ts"
Cohesion: 0.24
Nodes (14): defaultStorage(), isAllowedKey(), readPref(), resolveStorage(), UI_PREF_KEYS, UI_PREF_MAX_LENGTH, UiPrefKey, writePref() (+6 more)

### Community 40 - "hub.ts"
Cohesion: 0.09
Nodes (28): SseHello, SseResync, dataFrame(), heartbeatFrame(), helloFrame(), resyncFrame(), retryFrame(), Attached (+20 more)

### Community 41 - "rtm.ts"
Cohesion: 0.09
Nodes (37): TestId, buildRtm(), cmp(), judge(), Mapped, renderRtm(), ReqStatus, resultCell() (+29 more)

### Community 42 - "ServiceDeps"
Cohesion: 0.21
Nodes (19): ServiceApp, ServiceDeps, registerBff(), GatewayContext, registerApiAiRoutes(), registerApiConceptsRoutes(), registerApiCurationRoutes(), registerApiDialogsRoutes() (+11 more)

### Community 43 - "ref_react"
Cohesion: 0.06
Nodes (23): AppShell(), BootGateProps, BootSignal, BootSignals, notifyNewVersion(), Phase, Ready, SCALE (+15 more)

### Community 44 - "ref_node_path"
Cohesion: 0.09
Nodes (20): childProcess, INSTALLED, listFiles(), TempHome, CASE_TOKEN, caseArgs(), checkOne(), HERE (+12 more)

### Community 45 - "graph/src/cli.ts"
Cohesion: 0.10
Nodes (30): CliDeps, COMMANDS, DEFAULT_DEPS, godNodesCommand(), loadGraph(), parse(), Parsed, run() (+22 more)

### Community 46 - "check-sql-template.mjs"
Cohesion: 0.14
Nodes (28): analyze(), checkFile(), escapeRe(), writeRegex(), analyze(), checkFile(), analyze(), checkFile() (+20 more)

### Community 47 - "component-section.tsx"
Cohesion: 0.08
Nodes (35): BootGate(), ComponentSection(), Group(), noop(), SELECT_OPTIONS, Banner(), Card(), Dialog (+27 more)

### Community 48 - "dependencies"
Cohesion: 0.06
Nodes (32): dependencies, cmdk, @codemirror/lang-javascript, @codemirror/lang-sql, @codemirror/lang-yaml, d2coding, es-hangul, @fathom/contracts (+24 more)

### Community 49 - "ok"
Cohesion: 0.17
Nodes (22): ok(), AppliedRow, applyOne(), compare(), Comparison, fail(), inProfile(), ANYWHERE_FORBIDDEN (+14 more)

### Community 50 - "testkit/package.json"
Cohesion: 0.06
Nodes (33): dependencies, fastify, @fathom/contracts, @fathom/shared-kernel, @playwright/test, undici, zod, devDependencies (+25 more)

### Community 51 - "spawn-stack.ts"
Cohesion: 0.07
Nodes (26): ALL_SERVICES, APP_ROOT, CLI_ENTRY, Ctx, EgressRecord, EgressScan, ENTRY_TABLE, ENV_KEYS (+18 more)

### Community 52 - "nav-rail.tsx"
Cohesion: 0.10
Nodes (21): PaletteTrigger(), ADMIN_GROUP, BottomTabs(), Group(), LEARN_GROUP, MAP_GROUP, NavRail(), RailEntry() (+13 more)

### Community 53 - "shared-kernel/package.json"
Cohesion: 0.06
Nodes (33): dependencies, fastify, @fathom/contracts, pino, ulidx, yaml, zod, devDependencies (+25 more)

### Community 54 - "createLifecycle"
Cohesion: 0.26
Nodes (14): createLifecycle(), applyExit(), failChild(), forkChild(), markReady(), maybeForkGateway(), onChildExit(), resetForFork() (+6 more)

### Community 55 - "si-docs/src/ids.ts"
Cohesion: 0.10
Nodes (28): readBriefs(), expandBraces(), formatRange(), globToRegExp(), has(), IdDiagnostic, IdRange, itBandProblem() (+20 more)

### Community 56 - "GateEngineError"
Cohesion: 0.11
Nodes (34): ADR-0000, analyze(), diffSchema(), esc(), isObject(), loadLock(), ADR-0008, NUMERIC_KEYS (+26 more)

### Community 57 - "ai-gateway/src/infra/events/wiring.ts"
Cohesion: 0.24
Nodes (6): ConsumerManifest, InboxConfig, InboxHandlerDef, INBOX_HANDLERS, INBOX_HANDLERS, INBOX_HANDLERS

### Community 58 - "log-sink.ts"
Cohesion: 0.10
Nodes (14): ChildSpec, createLineSplitter(), launch(), MAX_LINE_CHARS, realSpawnChild(), SpawnChild, ADR-0012, COLORS (+6 more)

### Community 59 - "web/package.json"
Cohesion: 0.05
Nodes (39): cmdk, @fathom/contracts, @fathom/design-tokens, @fathom/testkit, happy-dom, lucide-react, motion, react (+31 more)

### Community 60 - "attempt-queue.ts"
Cohesion: 0.12
Nodes (27): ApiResult, ATTEMPT_DB_NAME, ATTEMPT_STORE, AttemptQueueDeps, AttemptRecord, AttemptsDb, backoffMs(), byCreatedAt() (+19 more)

### Community 61 - "generate"
Cohesion: 0.12
Nodes (27): asJson(), buildRouting(), byCode(), collect(), contractsHash(), err(), fmtJson(), generate() (+19 more)

### Community 62 - "supervisor.ts"
Cohesion: 0.09
Nodes (27): LogLevel, appPath(), ChangeImpact, createDevWatcher(), DEV_DEBOUNCE_MS, DevWatcherOptions, DevWatchFactory, DevWatchHandle (+19 more)

### Community 63 - "EpochMs"
Cohesion: 0.03
Nodes (68): LedgerHead, ModuleSchemaVersions, EpochManifest, ServiceSnapshot, ADR-0013, H, Token, StreamDelta (+60 more)

### Community 64 - "check-security-scan.mjs"
Cohesion: 0.13
Nodes (25): analyze(), checkText(), INDEX_VARS, STRING_RULES, analyze(), CHILD_PROCESS, importClauses(), isId() (+17 more)

### Community 65 - "v1/curation.ts"
Cohesion: 0.08
Nodes (11): CurationConflictResolveRoute, CurationConflictsRoute, CurationItemHealthRoute, CurationItemQuarantineRoute, CurationPendingRoute, CurationReportResolveRoute, CurationReportsRoute, CurationStagingApproveRoute (+3 more)

### Community 66 - "shell-deps.tsx"
Cohesion: 0.09
Nodes (9): EMPTY_COUNTS, QueueCountsHandle, QueueCountsSource, QueueHostProps, ShellDeps, ShellDepsContext, AttemptQueue, SseConnection (+1 more)

### Community 67 - "materials.ts"
Cohesion: 0.11
Nodes (16): TierTagProps, AlertDialogProps, BodyProps, ConfirmBody(), ConfirmByName(), ConfirmByNameProps, HOVER_CARD_DELAY, HoverCardContent() (+8 more)

### Community 68 - "http-client.ts"
Cohesion: 0.10
Nodes (27): buildQuery(), CALL_BUCKETS_MS, checkInput(), CircuitState, createPeerClient(), admit(), call(), currentState() (+19 more)

### Community 69 - "metrics.ts"
Cohesion: 0.14
Nodes (21): braces(), checkRegistration(), CounterEntry, createMetrics(), counter(), gauge(), histogram(), render() (+13 more)

### Community 70 - "check-ng-g.mjs"
Cohesion: 0.16
Nodes (24): analyze(), checkCss(), checkPackageJson(), checkPolicy(), checkSource(), isObject(), loadNgConfig(), REGEX_KEYS (+16 more)

### Community 71 - "itr.ts"
Cohesion: 0.15
Nodes (24): describeValue(), GateRow, isObj(), ItrInput, kindOf(), parseGatesJson(), pick(), renderItr() (+16 more)

### Community 72 - "packc/package.json"
Cohesion: 0.07
Nodes (29): d3-force, @types/d3-force, dependencies, d3-force, @fathom/contracts, @fathom/shared-kernel, yaml, zod (+21 more)

### Community 73 - "service/app.ts"
Cohesion: 0.04
Nodes (88): RFC-9457, ErrorRegistry, CallerName, ServiceName, RouteDef, CallerAuth, CallerTokens, checkInternalAccess() (+80 more)

### Community 74 - "createSupervisor"
Cohesion: 0.25
Nodes (10): recentCrashes(), statusRowOf(), createRunModeRunner(), createSupervisor(), onDevImpact(), runShutdown(), shutdownAll(), start() (+2 more)

### Community 75 - "graph/package.json"
Cohesion: 0.08
Nodes (23): dependencies, @fathom/contracts, @fathom/shared-kernel, zod, devDependencies, @fathom/testkit, @types/node, vitest (+15 more)

### Community 76 - "check-manifest.mjs"
Cohesion: 0.17
Nodes (21): analyze(), BLOCK_KINDS, collectE2eTitles(), FAMILIES, isObject(), isP(), lineOfNeedle(), MODE_FIELDS (+13 more)

### Community 77 - "button.tsx"
Cohesion: 0.22
Nodes (7): AppOffShell(), AppOffShellProps, OPEN_COMMAND, ReconnectScreen(), Button(), ButtonProps, buttonVariants

### Community 78 - "main.tsx"
Cohesion: 0.07
Nodes (33): DesignSystemPage(), THEME_OPTIONS, readAttemptCounts(), registerServiceWorker(), applyDocAttrs(), currentDocTheme(), DocAttrs, MEDIA_CONTRAST (+25 more)

### Community 79 - "sse.ts"
Cohesion: 0.13
Nodes (26): Invalidation, invalidationsFor(), isSseEventType(), Rule, RULES_BY_VERSION, RULES_V1, SSE_EVENT_TYPES, SseEventType (+18 more)

### Community 80 - "learning/package.json"
Cohesion: 0.07
Nodes (28): ts-fsrs, dependencies, fastify, @fathom/contracts, @fathom/shared-kernel, ts-fsrs, zod, devDependencies (+20 more)

### Community 81 - "cli/package.json"
Cohesion: 0.07
Nodes (26): bin, fathom, dependencies, @fathom/contracts, @fathom/shared-kernel, zod, devDependencies, @fathom/testkit (+18 more)

### Community 82 - "code-block.tsx"
Cohesion: 0.10
Nodes (13): CodeBlock(), CodeBlockProps, CodeLang, getHighlighter(), highlight(), HighlightLang, LANG_LOADERS, loadedLangs (+5 more)

### Community 83 - "log.ts"
Cohesion: 0.08
Nodes (35): ADR-0015, REWIND_DELIVERY, purgeInfraOnce(), PurgeResult, PURGE_IDEM_REQUEST, PURGE_INBOX_DEAD, PURGE_INBOX_DEDUPE, PURGE_OUTBOX (+27 more)

### Community 84 - "contracts/package.json"
Cohesion: 0.08
Nodes (23): dependencies, zod, devDependencies, @fathom/testkit, @types/node, vitest, exports, ./events/__consumers__/*.json (+15 more)

### Community 85 - "portable-schema.ts"
Cohesion: 0.10
Nodes (22): ALLOWED_KEYS, assertPortable(), CodeExerciseV1, ExplanationV1, FeedbackV1, FORBIDDEN_KEYS, ImportDraftV1, IndependentSolveV1 (+14 more)

### Community 86 - "egress-sampler.ts"
Cohesion: 0.14
Nodes (20): childrenOf(), compressIpv6(), decodeAddress(), descendants(), EgressReport, EgressSampler, FAMILIES, isLoopback() (+12 more)

### Community 87 - "ops/package.json"
Cohesion: 0.07
Nodes (26): dependencies, fastify, @fathom/contracts, @fathom/shared-kernel, zod, devDependencies, @fathom/testkit, @types/node (+18 more)

### Community 89 - "process-table.ts"
Cohesion: 0.11
Nodes (23): BundleInfo, createCtx(), snapshot(), SupervisorState, ReadyInfo, ADR-0012, createRow(), isTarget() (+15 more)

### Community 90 - "design-tokens/package.json"
Cohesion: 0.09
Nodes (21): dependencies, devDependencies, @fathom/testkit, @types/node, vitest, exports, ./tokens.css, ./typography.css (+13 more)

### Community 91 - "ai-gateway/package.json"
Cohesion: 0.06
Nodes (34): @anthropic-ai/sdk, @google/genai, openai, @typesafe-ai/sdk, dependencies, @anthropic-ai/sdk, fastify, @fathom/contracts (+26 more)

### Community 92 - "gateway/package.json"
Cohesion: 0.06
Nodes (34): @fastify/cookie, @fastify/http-proxy, @fastify/rate-limit, @fastify/static, dependencies, fastify, @fastify/cookie, @fastify/http-proxy (+26 more)

### Community 93 - "tasks"
Cohesion: 0.09
Nodes (21): agentGuidance, dependsOn, outputs, concurrency, envMode, dependsOn, outputs, cache (+13 more)

### Community 94 - "ui/package.json"
Cohesion: 0.09
Nodes (21): cmdk, @fathom/design-tokens, @fathom/testkit, happy-dom, lucide-react, motion, react, react-dom (+13 more)

### Community 95 - "error-registry.ts"
Cohesion: 0.16
Nodes (14): COMMON_ERRORS, commonErrorCode(), CommonErrorSuffix, ErrorRegistryEntry, SVC_CODE_OF, SvcCode, ErrorCode, GW_ERRORS (+6 more)

### Community 96 - "si-docs/package.json"
Cohesion: 0.08
Nodes (23): dependencies, @fathom/contracts, @fathom/shared-kernel, zod, devDependencies, @fathom/testkit, @types/node, vitest (+15 more)

### Community 97 - "dod.ts"
Cohesion: 0.18
Nodes (18): DOD_ROWS, DodEvaluation, DodInput, DodRow, DodVerdict, evaluateDod(), expandItem(), renderDod() (+10 more)

### Community 98 - "proc.ts"
Cohesion: 0.19
Nodes (12): createTailRing(), errnoCode(), lastCapture(), messageOf(), parseWindowsShim(), resolveWindowsShim(), safeSpawn(), kill() (+4 more)

### Community 99 - "results.ts"
Cohesion: 0.23
Nodes (18): arr(), CaseStatus, collectResults(), firstLine(), idOfTitle(), isObj(), mergeById(), normalizeStatus() (+10 more)

### Community 100 - "lib/args.ts"
Cohesion: 0.16
Nodes (17): build(), collect(), Collected, CommandName, COMMANDS, Common, COMMON_FLAGS, COMMON_VALUED (+9 more)

### Community 101 - "control-ipc.ts"
Cohesion: 0.20
Nodes (9): IpcOpsToSupervisor, IpcSupervisorToOps, Ack, build(), ControlApi, dispatch(), handleOpsRequest(), IpcOpsToSupervisorSvc (+1 more)

### Community 102 - "lifecycle.ts"
Cohesion: 0.10
Nodes (26): IpcServiceToSupervisor, buildEnvelope(), EnvelopeContext, ADR-0012, ChildHandle, knownPorts(), Ctx, peersOf() (+18 more)

### Community 103 - "check-hooks.mjs"
Cohesion: 0.20
Nodes (17): analyze(), arrOf(), closeParen(), CONSTRAINT_WORDS, DB_DIRS, literalOnly(), normDef(), objOf() (+9 more)

### Community 104 - "admin/admin-routes.ts"
Cohesion: 0.08
Nodes (32): AdminEventsQuery, AdminEventsRoute, AdminIntegrityRoute, AdminQuiesceRoute, AdminResumeRoute, AdminShutdownRoute, AdminSnapshotRoute, COMMON_ADMIN_ROUTES (+24 more)

### Community 105 - "ops/v1/errors.ts"
Cohesion: 0.17
Nodes (9): OP_ERRORS, OpErrorCode, AUTOSTART_ERROR_MAP, BACKUP_ERROR_MAP, DOCTOR_ERROR_MAP, HEALTH_ERROR_MAP, HOST_ERROR_MAP, TELEMETRY_ERROR_MAP (+1 more)

### Community 106 - "src/tokens.ts"
Cohesion: 0.15
Nodes (11): CONTRAST_PAIRS, ContrastPair, fathomShikiTheme, FathomTokens, FONT_STACK, FORBIDDEN_PAIRS, HIGH_CONTRAST, Level (+3 more)

### Community 107 - "segmented-control.tsx"
Cohesion: 0.18
Nodes (11): HatSwitch(), OPTIONS, OpsAlertSlotProps, RANK, Hat, useHatStore, Banner, SegmentedControl() (+3 more)

### Community 108 - "stack-fixture.ts"
Cohesion: 0.15
Nodes (12): bootstrapRequest(), createRequestCounter(), createStackTest(), LOOPBACK_HOSTS, NETWORK_PROTOCOLS, RequestCounter, StackFixtures, StackHandle (+4 more)

### Community 109 - "check-typo-ko.mjs"
Cohesion: 0.26
Nodes (16): checkSource(), importsSdk(), analyze(), checkCss(), checkSource(), checkTypography(), classTokens(), cssBlocks() (+8 more)

### Community 110 - "run-gates.mjs"
Cohesion: 0.18
Nodes (15): CUMULATIVE, GATES, gatesForStage(), ADR-0010, extraArgs(), formatRun(), HERE, loadRegistry() (+7 more)

### Community 111 - "package.json"
Cohesion: 0.10
Nodes (19): engines, node, @fathom/contracts, @fathom/testkit, @playwright/test, @types/node, vite, vitest (+11 more)

### Community 112 - "AGENTS.md — Fathom · 깊이 (Codex 계열 코딩 에이전트 지침, 요약)"
Cohesion: 0.14
Nodes (12): 1. 읽기 순서 (STD-AGT-10), 2. 서비스 · 포트 (prod / dev), 3. 하지 않는 것, 4. 완료 명령 (G1, 전부 exit 0), 5. graphify 3단 질의 (코드 수정 전, 읽기만), AGENTS.md — Fathom · 깊이 (Codex 계열 코딩 에이전트 지침, 요약), 1. 먼저 읽을 것, 2. 동결 규칙 (ADR-000 Architecture Freeze Baseline v1.0) (+4 more)

### Community 113 - "gateway/src/config.ts"
Cohesion: 0.07
Nodes (36): CliBootstrapTokenRoute, CliShutdownRoute, CliStatusRoute, StreamOpenRoute, HealthBoardRoute, SystemShutdownRoute, assertDefined(), PublicAuthHook (+28 more)

### Community 114 - "chaos.ts"
Cohesion: 0.17
Nodes (12): assertSelectOnly(), defaultSignal(), delay(), errnoOf(), lockGate(), openReadOnly(), Params, readRows() (+4 more)

### Community 115 - "utr.ts"
Cohesion: 0.20
Nodes (15): BriefInfo, UNIT_DIR, UNIT_LABEL, formatDelta(), formatPct(), CoverageSummary, gateRow(), Lines (+7 more)

### Community 116 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, customConditions, declaration, erasableSyntaxOnly, isolatedModules, module, moduleResolution, noImplicitOverride (+7 more)

### Community 117 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, autocannon, @axe-core/playwright, @biomejs/biome, @fathom/contracts, @fathom/testkit, playwright-core, @playwright/test (+7 more)

### Community 118 - "ops/src/infra/db/open.ts"
Cohesion: 0.20
Nodes (8): PeerClientPort, aiGatewayClient(), contentClient(), gatewayClient(), learningClient(), openInfra(), IpcChannel, processIpcChannel()

### Community 119 - "gateway-client.ts"
Cohesion: 0.20
Nodes (7): GATEWAY_TIMEOUT_MS, GatewayClient, GatewayClientOptions, GatewayFailure, GatewayResponse, GatewayResult, ProblemSummary

### Community 120 - "drawer.tsx"
Cohesion: 0.33
Nodes (8): ContextPanel(), useRouteId(), useLayoutStore, Drawer, DrawerClose, DrawerContent(), DrawerContentProps, SIDE

### Community 121 - "supervisor/args.ts"
Cohesion: 0.18
Nodes (14): collect(), FLAG_KEYS, isAbsolute(), isLevel(), isProfile(), isRuntime(), LEVELS, ParseError (+6 more)

### Community 122 - "devDependencies"
Cohesion: 0.14
Nodes (14): devDependencies, fake-indexeddb, @fathom/testkit, happy-dom, @tailwindcss/vite, @tanstack/router-plugin, @testing-library/dom, @testing-library/react (+6 more)

### Community 123 - "header.tsx"
Cohesion: 0.13
Nodes (18): AiChip(), SENTENCE, AppHeader(), AppMark(), useHomeView(), useOpsBanners(), useQueueCounts(), useSseSnapshot() (+10 more)

### Community 124 - "mermaid-figure.tsx"
Cohesion: 0.21
Nodes (11): MERMAID_CONFIG, mermaidConfig, MermaidFigure(), MermaidFigureProps, FORBIDDEN_ELEMENTS, mountSvg(), sanitizeSvg(), scrub() (+3 more)

### Community 125 - "runStop"
Cohesion: 0.36
Nodes (9): killLeftovers(), parseLock(), parseRegistry(), parseWith(), poll(), readLockFile(), readRegistryFile(), runStop() (+1 more)

### Community 126 - "tabs.tsx"
Cohesion: 0.22
Nodes (4): ImeSafeTextareaProps, TabItem, TabsProps, TRIGGER

### Community 127 - "launchStack"
Cohesion: 0.18
Nodes (16): allReady(), bootstrapOpen(), cliInvocation(), ctxEnv(), fail(), inRoot(), lastLines(), launchStack() (+8 more)

### Community 128 - "pgm.ts"
Cohesion: 0.20
Nodes (13): document(), buildFileIndex(), exists(), FileIndex, parsePgmTables(), PgmResult, PgmRow, PgmState (+5 more)

### Community 129 - "ai-gateway/v1/errors.ts"
Cohesion: 0.22
Nodes (7): AI_ERRORS, AiErrorCode, CONTROL_ERROR_MAP, GENERATE_ERROR_MAP, JUDGE_ERROR_MAP, PRIVACY_ERROR_MAP, ROUTING_ERROR_MAP

### Community 130 - "learning/v1/errors.ts"
Cohesion: 0.22
Nodes (7): LR_ERRORS, LrErrorCode, CURRICULUM_REF_ERROR_MAP, INSIGHT_ERROR_MAP, LEARNER_MODEL_ERROR_MAP, LEDGER_ERROR_MAP, PRACTICE_ERROR_MAP

### Community 131 - "exports"
Cohesion: 0.22
Nodes (9): default, source, types, exports, ./badges/*, ./hooks/*, default, source (+1 more)

### Community 132 - "registry.ts"
Cohesion: 0.29
Nodes (6): RendererEntry, RendererKey, RendererProps, RENDERERS, HotkeyScope, BlockKind

### Community 133 - "lib/idempotency.ts"
Cohesion: 0.32
Nodes (10): assertTime(), bytesToDigits(), createUlidFactory(), digitsToString(), encodeTime(), freshDigits(), IDEMPOTENCY_HEADER, incrementDigits() (+2 more)

### Community 134 - "rules"
Cohesion: 0.17
Nodes (12): noUnusedImports, noUnusedVariables, linter, rules, noBarrelFile, noReExportAll, correctness, performance (+4 more)

### Community 135 - "color.ts"
Cohesion: 0.22
Nodes (15): clamp01(), contrastRatio(), encode(), hex2(), NUM, Oklch, OKLCH_RE, oklchToLinearSrgb() (+7 more)

### Community 136 - "buildStack"
Cohesion: 0.31
Nodes (8): createUlidSequence(), fixedUlid(), buildStack(), jsonLines(), parseObject(), scanEgress(), scanLogs(), scanLogText()

### Community 137 - "dependencies"
Cohesion: 0.17
Nodes (12): dependencies, class-variance-authority, clsx, cmdk, @fathom/design-tokens, lucide-react, motion, radix-ui (+4 more)

### Community 138 - "use-windowed-rows.ts"
Cohesion: 0.21
Nodes (9): DataTableColumn, DataTableProps, computeRowWindow(), isNonNegativeInt(), Metrics, RowWindow, RowWindowInput, useWindowedRows() (+1 more)

### Community 139 - "child-env.ts"
Cohesion: 0.29
Nodes (7): BASE_NAMES, childEnv(), ChildEnvDeps, mergeNodeOptions(), ADR-0012, WARNING_FLAG, WIN32_NAMES

### Community 140 - "ApiClient"
Cohesion: 0.18
Nodes (5): ApiClient, RouterContext, Register, @tanstack/react-router, Route

### Community 141 - "SupervisedService"
Cohesion: 0.31
Nodes (3): SupervisedService, Lifecycle, Row

### Community 142 - "card.tsx"
Cohesion: 0.33
Nodes (4): CardProps, CardVariant, STATUS, VARIANT

### Community 144 - "check-consumers.mjs"
Cohesion: 0.33
Nodes (10): analyze(), CONSUMERS, deref(), isObject(), lineOfNeedle(), MODES, pathExists(), POISON (+2 more)

### Community 145 - "common.mjs"
Cohesion: 0.32
Nodes (10): describe(), escapeRe(), finish(), lenientOutput(), normalize(), runGate(), SRC_EXT, count() (+2 more)

### Community 146 - "token-section.tsx"
Cohesion: 0.27
Nodes (8): ColorRow, colorRows(), MATERIAL_ROWS, MotionSection(), TokenSection(), ThemeMode, TOKENS, DataTable()

### Community 147 - "biome.json"
Cohesion: 0.20
Nodes (9): css, parser, files, includes, overrides, tailwindDirectives, plugins, root (+1 more)

### Community 148 - "style"
Cohesion: 0.20
Nodes (10): style, noCommonJs, noDefaultExport, noEnum, noNonNullAssertion, noParameterAssign, noProcessEnv, useBlockStatements (+2 more)

### Community 150 - "motion.ts"
Cohesion: 0.22
Nodes (7): EASE, MOTION_CONFIG_PROPS, MotionKind, prefersReducedMotion(), REDUCED_TRANSITION, springCard, useReducedMotionPreference()

### Community 151 - "gates/package.json"
Cohesion: 0.20
Nodes (9): dependencies, devDependencies, name, private, scripts, test, typecheck, type (+1 more)

### Community 152 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, @fathom/testkit, happy-dom, @testing-library/dom, @testing-library/react, @types/node, @types/react, @types/react-dom (+1 more)

### Community 153 - "@fathom/app-cli"
Cohesion: 0.50
Nodes (3): @fathom/app-cli, 관련 문서, 명령

### Community 154 - "@fathom/app-web"
Cohesion: 0.50
Nodes (3): @fathom/app-web, 관련 문서, 명령

### Community 155 - "@fathom/contracts"
Cohesion: 0.50
Nodes (3): @fathom/contracts, 관련 문서, 명령

### Community 156 - "shared-kernel/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 157 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, lib, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 158 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, lib, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 159 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, lib, noEmit, types, extends, include, ./tsconfig.base.json

### Community 160 - "cli/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 161 - "cli/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 162 - "choseong.ts"
Cohesion: 0.52
Nodes (6): commandFilter(), isChoseongQuery(), matchesQuery(), normalize(), stripSpaces(), es-hangul

### Community 163 - "web/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 164 - "db-hooks.ts"
Cohesion: 0.29
Nodes (6): DB_EXT_HOOKS, DB_EXT_TABLES, DB_NAME_HOOKS, DbExtHook, DbExtTable, DbNameHook

### Community 165 - "contracts/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 166 - "design-tokens/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 167 - "testkit/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 168 - "ui/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 169 - "ai-gateway/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 170 - "gateway/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 171 - "learning/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 172 - "ops/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 173 - "fake-cli/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 174 - "gates/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 175 - "graph/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 176 - "packc/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 177 - "si-docs/tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, ./tsconfig.json

### Community 178 - "@fathom/design-tokens"
Cohesion: 0.50
Nodes (3): @fathom/design-tokens, 관련 문서, 명령

### Community 179 - "suspicious"
Cohesion: 0.33
Nodes (6): suspicious, noConsole, noEvolvingTypes, noExplicitAny, noImportCycles, useAwait

### Community 180 - "contracts/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 181 - "design-tokens/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 182 - "shared-kernel/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 183 - "testkit/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 184 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, test, test:integration, test:security, typecheck

### Community 185 - "ai-gateway/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 186 - "gateway/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 187 - "learning/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 188 - "ops/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 189 - "fake-cli/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 190 - "graph/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 191 - "packc/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 192 - "si-docs/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../../tsconfig.base.json

### Community 193 - "formatter"
Cohesion: 0.40
Nodes (5): formatter, indentStyle, indentWidth, lineEnding, lineWidth

### Community 194 - "formatter"
Cohesion: 0.40
Nodes (5): quoteStyle, semicolons, trailingCommas, javascript, formatter

### Community 195 - "prng.ts"
Cohesion: 0.50
Nodes (3): createPrng(), mulberry32(), Prng

### Community 196 - "ime-safe-input.tsx"
Cohesion: 0.50
Nodes (3): ImeSafeInput(), ImeSafeInputProps, isImeComposing()

### Community 197 - "gates/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, noEmit, extends, include, ../../tsconfig.base.json

### Community 198 - "nursery"
Cohesion: 0.50
Nodes (4): noFloatingPromises, noMisusedPromises, useExhaustiveSwitchCases, nursery

### Community 199 - "vcs"
Cohesion: 0.50
Nodes (4): vcs, clientKind, enabled, useIgnoreFile

### Community 200 - "@fathom/shared-kernel"
Cohesion: 0.50
Nodes (3): @fathom/shared-kernel, 관련 문서, 명령

### Community 204 - "@fathom/testkit"
Cohesion: 0.50
Nodes (3): @fathom/testkit, 관련 문서, 명령

### Community 205 - "./components/*"
Cohesion: 0.50
Nodes (4): default, source, types, ./components/*

### Community 206 - "@fathom/ui"
Cohesion: 0.50
Nodes (3): @fathom/ui, 관련 문서, 명령

### Community 207 - "@fathom/svc-ai-gateway"
Cohesion: 0.50
Nodes (3): @fathom/svc-ai-gateway, 관련 문서, 명령

### Community 208 - "@fathom/svc-gateway"
Cohesion: 0.50
Nodes (3): @fathom/svc-gateway, 관련 문서, 명령

### Community 209 - "@fathom/svc-learning"
Cohesion: 0.50
Nodes (3): @fathom/svc-learning, 관련 문서, 명령

### Community 210 - "@fathom/svc-ops"
Cohesion: 0.50
Nodes (3): @fathom/svc-ops, 관련 문서, 명령

### Community 211 - "@fathom/tool-fake-cli"
Cohesion: 0.50
Nodes (3): @fathom/tool-fake-cli, 관련 문서, 명령

### Community 212 - "@fathom/tool-gates"
Cohesion: 0.50
Nodes (3): @fathom/tool-gates, 관련 문서, 명령

### Community 213 - "@fathom/tool-graph"
Cohesion: 0.50
Nodes (3): @fathom/tool-graph, 관련 문서, 명령

### Community 214 - "@fathom/tool-packc"
Cohesion: 0.50
Nodes (3): @fathom/tool-packc, 관련 문서, 명령

### Community 215 - "@fathom/tool-si-docs"
Cohesion: 0.50
Nodes (3): @fathom/tool-si-docs, 관련 문서, 명령

## Knowledge Gaps
- **2178 isolated node(s):** `G01Input`, `G02Input`, `G03Input`, `G04Input`, `G05Input` (+2173 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 2487 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `typescript` connect `check-boundaries.mjs` to `package.json`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `@tanstack/react-router` connect `@tanstack/react-router` to `panel.tsx`, `web/package.json`, `ref_react`, `ApiClient`, `gen.ts`, `main.tsx`, `insight.ts`, `nav-rail.tsx`, `drawer.tsx`, `header.tsx`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `openProject()` connect `check-boundaries.mjs` to `GateEngineError`, `check-sql-template.mjs`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `G01Input`, `G02Input`, `G03Input` to the rest of the system?**
  _2178 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `v1/ai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.014809751651856915 - nodes in this community are weakly interconnected._
- **Should `route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.017664449371766446 - nodes in this community are weakly interconnected._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.028103723018977258 - nodes in this community are weakly interconnected._