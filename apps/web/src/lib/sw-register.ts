/** AQ-16: 서비스 워커는 후속 WP. 이 Task는 아무 것도 등록하지 않는다. */
export function registerServiceWorker(): Promise<'skipped'> {
  return Promise.resolve('skipped');
}
