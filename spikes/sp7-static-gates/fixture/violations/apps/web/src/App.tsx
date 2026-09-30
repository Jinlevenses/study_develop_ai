import type { CSSProperties } from "react";

const style: CSSProperties = {
  color: "#ff0000", // EXPECT[design/raw-color]
  background: "rgb(12, 34, 56)", // EXPECT[design/raw-color]
  borderColor: "#abc", // EXPECT[design/raw-color]
};
const BRAND = "#3366ff"; // EXPECT[design/raw-color]
const HREF = "#face"; // legal: anchor id, not a colour

export function DueCount({ n }: { n: number }) {
  return (
    <p style={style} className="overdue text-red-500">{n}일 연체</p> // EXPECT[ng-g5/danger-due] EXPECT[ng-g5/loss-copy]
  );
}
export const OVERDUE_CLASS = "overdue-badge bg-destructive text-white"; // EXPECT[ng-g5/danger-due]
export const STREAK_MSG = "스트릭이 끊겼어요! 지금 돌아오지 않으면 잃게 됩니다"; // EXPECT[ng-g5/loss-copy]
export const XP_GAIN = 120; // EXPECT[ng-g1/reward-vocab]
export function launchConfetti(): void {} // EXPECT[ng-g1/reward-vocab]
export const Board = { leaderboard: [] as string[] }; // EXPECT[ng-g2/social-vocab]
export const FRIENDS: string[] = []; // EXPECT[ng-g2/social-vocab]
export async function share(): Promise<void> {
  await navigator.share({ title: "x" }); // EXPECT[ng-g2/network-share]
}
export async function notifyDue(): Promise<void> {
  await Notification.requestPermission(); // EXPECT[ng-g5/push-api]
  new Notification("복습할 시간이에요"); // EXPECT[ng-g5/push-api]
}
function cn(...a: (string | false)[]): string { return a.filter(Boolean).join(" "); }
export function LateBadge({ late }: { late: boolean }) {
  return <span className={cn("due-count", late && "text-red-500")}>늦음</span>; {/* EXPECT[ng-g5/danger-due] */}
}
export function Player() {
  return <video src="/lecture.mp4" controls />; // EXPECT[ng-g6/video]
}
export const _ = [BRAND, HREF];
