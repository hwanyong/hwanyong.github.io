// src/lib/site.ts — 사이트 상수의 단일 출처(SSOT).
// 여기 값들은 여러 파일(BaseHead, rss.xml, Comments, AdSense)에서 참조되므로
// 문자열을 각 파일에 흩뿌리지 말고 반드시 여기서 import 한다.

export const SITE = {
  /** astro.config.mjs 의 site 와 반드시 같아야 한다. */
  origin: 'https://blog.hwanyong.com',
  title: 'Hwanyong Yoo 기술 블로그',
  description: 'Computer에 관한 모든 기록',
  lang: 'ko',
  locale: 'ko-KR',
  author: 'Hwanyong Yoo',
} as const;

/** giscus 설정. Discussions 활성화 후 categoryId 를 실제 값으로 교체할 것. */
export const GISCUS = {
  repo: 'hwanyong/hwanyong.github.io',
  /** GraphQL repository.id 로 실측 확인된 값 */
  repoId: 'R_kgDOJBJzTA',
  /**
   * Announcements 를 쓰는 이유: Discussion Format 이 Announcement 라
   * 유지관리자와 giscus 만 새 스레드를 만들 수 있다. Open-ended 카테고리로 두면
   * 누구나 빈 스레드를 만들어 댓글 스레드와 섞인다.
   */
  category: 'Announcements',
  /** GraphQL discussionCategories 로 실측 확인 (2026-08-20) */
  categoryId: 'DIC_kwDOJBJzTM4DD2Rq',
  origin: 'https://giscus.app',
  /** 커스텀 테마 CSS 의 배포 경로 (public/giscus/*.css) */
  themeBase: 'https://blog.hwanyong.com/giscus',
  /** dev 서버에서는 커스텀 CSS 가 CORS 로 막히므로 빌트인 테마를 쓴다 */
  devTheme: { reflect: 'light', emit: 'dark_dimmed' },
} as const;

/** AdSense 설정. 광고 코드는 ca-pub-…, ads.txt 는 pub-… 로 접두사가 다르다. */
export const ADSENSE = {
  /** AdSense 콘솔 URL(pub-5888836555193733)과 대조해 확인 (2026-08-20) */
  client: 'ca-pub-5888836555193733',

  /**
   * 광고 송출 여부.
   *
   * false 인 이유: 계정이 "활동 없음"으로 비활성화되어 광고 단위를 만들 수 없다.
   * 재활성화에 전화번호 확인과 결제 계정 검토가 필요하며, 그전에는 유효한
   * data-ad-slot 값이 존재하지 않는다. 존재하지 않는 슬롯으로 요청을 보내지
   * 않도록 로더와 슬롯을 통째로 끈다.
   *
   * 켜는 순서:
   *   1. AdSense 콘솔에서 계정 재활성화 (전화번호 확인 + 사이트 제출 + 심사)
   *   2. 광고 단위를 만들어 data-ad-slot 값 발급
   *   3. AD_SLOTS 의 자리표시자를 그 값으로 교체
   *   4. 이 값을 true 로
   */
  enabled: false,
} as const;

/**
 * 광고 단위별 slot ID.
 *
 * 페이지마다 문자열을 흩뿌리지 않고 여기서 이름으로 참조한다.
 * ADSENSE.enabled 가 false 인 동안에는 렌더되지 않으므로 자리표시자여도 무해하다.
 */
export const AD_SLOTS = {
  /** 목록 화면, 항목 몇 개 뒤 */
  inFeed: '1234567890',
  /** 글 본문이 끝난 뒤 */
  articleEnd: '1234567890',
} as const;
