/**
 * REFLECT / EMIT 상태를 첫 페인트 전에 확정한다 (FOUC 방지).
 *
 * 왜 public/ 에 두고 blocking 으로 로드하는가:
 *   Astro 가 번들한 스크립트는 type="module" = defer 라 문서 파싱이 끝난 뒤에야
 *   실행된다. 그러면 저장된 상태가 emit(어두운 화면)이어도 화면이 한 번
 *   reflect(밝은 베이지)로 그려진 뒤 뒤바뀌어 흰 섬광이 터진다.
 *   이 파일만 defer 없이 동기 실행되어야 한다.
 *
 * 이 값을 읽는 쪽:
 *   src/scripts/theme.ts, src/scripts/giscus.ts, src/styles/global.css
 *   상태 키('mode')와 값('reflect' | 'emit')을 바꾸면 저 세 곳도 함께 고칠 것.
 */
try {
  const saved = localStorage.getItem('mode');
  document.documentElement.dataset.mode =
    saved === 'emit' || saved === 'reflect' ? saved : 'reflect';
} catch {
  // 사파리 프라이빗 모드 등에서 localStorage 접근이 막혀도 화면은 떠야 한다.
  document.documentElement.dataset.mode = 'reflect';
}
