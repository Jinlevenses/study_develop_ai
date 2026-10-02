// DS-01 §2.2 — resolveDocAttrs와 같은 규칙
(() => {
  const root = document.documentElement.dataset;
  const mq = (q) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false; // 미디어 질의 불가 — 기본값 유지
    }
  };
  let pref = 'dark';
  try {
    const v = localStorage.getItem('fathom.theme');
    if (v === 'light' || v === 'system') {
      pref = v;
    }
  } catch {
    // 저장소 차단 — 기본값 유지
  }
  try {
    root.theme = pref === 'system' ? (mq('(prefers-color-scheme: light)') ? 'light' : 'dark') : pref;
    root.contrast = mq('(prefers-contrast: more)') ? 'more' : 'standard';
    root.transparency = mq('(prefers-reduced-transparency: reduce)') ? 'reduce' : 'full';
    root.motion = mq('(prefers-reduced-motion: reduce)') ? 'reduce' : 'full';
    root.density = 'comfortable';
  } catch {
    // dataset 쓰기 불가 — 기본 속성 유지
  }
})();
