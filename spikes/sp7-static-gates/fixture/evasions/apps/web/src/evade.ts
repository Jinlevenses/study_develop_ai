export const NAMED = { color: "red" }; // EVADES[design/raw-color] named colour keyword
export const HEX = (h: string) => `#${h}`; // EVADES[design/raw-color] computed hex
export const JOINED = ["#", "ff", "00", "00"].join(""); // EVADES[design/raw-color] assembled at runtime
export const KEY = "level_up_confetti"; // EVADES[ng-g1/reward-vocab] reward mechanic hidden in a string key
export function ns(): unknown { return (window as unknown as Record<string, unknown>)["Notification"]; } // EVADES[ng-g5/push-api] bracket access
export const SW = (r: { showNotification: (t: string) => void }) => r.showNotification("x"); // EVADES[ng-g5/push-api] service-worker notification
export const OK = { color: "var(--color-fg)" };
