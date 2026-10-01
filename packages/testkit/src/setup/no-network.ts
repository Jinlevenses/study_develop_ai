import { MockAgent, setGlobalDispatcher } from 'undici';

// 무네트워크 setup(STD-TST-04, TST-01 §3.2): 루프백 외 모든 외부 연결을 DNS·소켓 시도 전에 거부한다.
// vitest setupFiles로만 로드되는 진입 파일이므로 최상위 부작용을 허용한다(STD-TS-15 진입점 예외).
const agent = new MockAgent();
agent.disableNetConnect();
agent.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
setGlobalDispatcher(agent);
