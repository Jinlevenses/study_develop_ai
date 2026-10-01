// ported-from: spikes/sp7-static-gates (audit-fixed: @types/node 해석에 의존하지 않는 로컬 선언)
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(p: string);
    prepare(sql: string): unknown;
    exec(sql: string): void;
  }
}
