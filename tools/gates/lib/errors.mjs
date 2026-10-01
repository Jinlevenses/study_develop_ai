// 게이트 엔진 고장(exit 2)을 나타내는 오류. code = engine/<사유> (STD-GATE-02).
export class GateEngineError extends Error {
  /**
   * @param {'engine/no-files'|'engine/missing-units'|'engine/no-root'|'engine/config'|'engine/tsgo'|'engine/input-missing'|'engine/usage'|'engine/git'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'GateEngineError';
    this.code = code;
  }
}
