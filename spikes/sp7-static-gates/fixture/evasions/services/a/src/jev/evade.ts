export function destructure(candidates: string[]) {
  const [first] = candidates; // EVADES[jev/index-literal] positional destructuring
  return first;
}
export function callResult(units: Record<string, string>) {
  return Object.values(units)[0]; // EVADES[jev/index-literal] index on a call result
}
export function alias(candidates: string[]) {
  const c = candidates;
  return c[3]; // EVADES[jev/index-literal] alias with a name outside the candidate-name list
}
export function concatText(n: number) {
  return "Judge item " + (n + 1); // EVADES[jev/index-string] number added by concatenation
}
export function shifted(options: string[]) {
  return options.shift(); // EVADES[jev/index-literal] positional consume
}
export const ORD = "Explain why the 2nd option is wrong"; // DETECTS[jev/index-string] digit ordinal
