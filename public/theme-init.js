/**
 * REFLECT / EMIT 상태를 첫 페인트 전에 확정한다 (FOUC 방지).
 *
 * 왜 public/ 에 두고 blocking 으로 로드하는가:
 *   Astro 가 번들한 스크립트는 type="module" = defer 라 문서 파싱이 끝난 뒤에야
 *   실행된다. 그러면 저장된 상태가 emit(어두운 화면)이어도 화면이 한 번
 *   reflect(밝은 베이지)로 그려진 뒤 뒤바뀌어 흰 섬광이 터진다.
 *   이 파일만 defer 없이 동기 실행되어야 한다.
 *
 * 결정 순서 (앞이 이긴다):
 *   1. 저장된 선택 — 사용자가 직접 고른 적이 있으면 그 의사가 최우선이다.
 *   2. OS 취향 prefers-color-scheme — 고른 적이 없는 첫 방문에 쓴다.
 *   3. reflect — 둘 다 못 읽을 때의 최후 기본값.
 *
 *   OS 취향을 읽는 이유: 어두운 환경을 이미 시스템에 설정해 둔 사람에게
 *   첫 화면을 밝은 베이지로 때리는 것은 그 설정을 무시하는 것이다.
 *   한 번이라도 직접 고르면 그 뒤로는 1번이 항상 이기므로 "사용자가 고르는 상태"
 *   라는 원칙은 그대로다.
 *
 * 이 값을 읽는 쪽:
 *   src/scripts/theme.ts, src/scripts/giscus.ts, src/styles/global.css
 *   상태 키('mode')와 값('reflect' | 'emit')을 바꾸면 저 세 곳도 함께 고칠 것.
 */
const prefersEmit = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

const saved = (() => {
  try {
    // 사파리 프라이빗 모드 등에서 접근이 막혀도 화면은 떠야 한다.
    return localStorage.getItem('mode');
  } catch {
    return null;
  }
})();

document.documentElement.dataset.mode =
  saved === 'emit' || saved === 'reflect' ? saved : prefersEmit() ? 'emit' : 'reflect';
