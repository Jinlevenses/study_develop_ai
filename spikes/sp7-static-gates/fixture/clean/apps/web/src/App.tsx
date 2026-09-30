import type { CSSProperties } from "react";

// Colours come from tokens (CSS variables) only -- no raw hex in components.
const style: CSSProperties = { color: "var(--color-fg)", background: "var(--color-bg)" };
const HREF = "#face"; // anchor id that merely looks like hex: must not be flagged

export function DueCount({ n }: { n: number }) {
  return (
    <p style={style} className="due-count text-muted">
      오늘 할 만큼 {n}분 <a href={HREF}>휴식 토큰</a>
    </p>
  );
}

function cn(...a: (string | false)[]): string { return a.filter(Boolean).join(" "); }
export function Quiet({ late }: { late: boolean }) {
  return <span className={cn("due-count", late && "text-muted")}>조금 남음</span>;
}
