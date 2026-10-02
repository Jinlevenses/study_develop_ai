// 테스트용 UTC 시각 → epoch ms(정수 civil-day 산술 — `Date` 미사용).
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return ((daysFromCivil(year, month, day) * 24 + hour) * 60 + minute) * 60_000 + second * 1000;
}
