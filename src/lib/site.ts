// src/lib/site.ts — 사이트 상수의 단일 출처(SSOT).
// 여기 값들은 여러 파일(BaseHead, rss.xml, Comments, AdSense)에서 참조되므로
// 문자열을 각 파일에 흩뿌리지 말고 반드시 여기서 import 한다.

import { ORIGIN } from './i18n';

export const SITE = {
  // origin 은 여기 없다 — i18n.ts 의 ORIGIN 이 유일한 출처다.
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
  themeBase: `${ORIGIN}/giscus`,
  /** dev 서버에서는 커스텀 CSS 가 CORS 로 막히므로 빌트인 테마를 쓴다 */
  devTheme: { reflect: 'light', emit: 'dark_dimmed' },
  /**
   * 댓글 위젯 게재 여부.
   * privacy.ts 의 벤더 표가 이 값을 읽는다 — 나머지 두 벤더(ANALYTICS·ADSENSE)와
   * 형태를 맞춰, 방침 문서가 실제 구성보다 앞서 나가거나 뒤처지지 않게 한다.
   */
  enabled: true,
} as const;

// ★ 도메인을 바꾸면 손으로 고쳐야 하는 곳이 정확히 하나 남는다: 저장소 루트의 giscus.json.
//   giscus.app 이 그 파일을 GitHub API 로 직접 읽으므로 빌드가 값을 주입할 방법이 없다.

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

/**
 * Cloudflare Web Analytics.
 *
 * GA 대신 이것을 기본 분석 도구로 두는 이유:
 *   쿠키를 하나도 심지 않고 개인을 식별하는 값도 만들지 않는다. 그래서 EU 방문자에게
 *   사전 동의 배너(consent banner)를 띄울 의무가 생기지 않는다 — 배너는 액센트 0
 *   미니멀 규약과 정면으로 충돌하므로, 안 만들어도 되는 쪽을 기본선으로 삼는다.
 *
 * ★ 반드시 "수동 설치(JS 스니펫)" 여야 한다.
 *   Cloudflare 의 자동 주입은 프록시를 거치는 트래픽에만 비콘을 끼워 넣는다.
 *   blog.hwanyong.com 은 GitHub Pages 인증서 때문에 DNS only(회색 구름)라
 *   프록시를 거치지 않으므로, 자동 설치를 믿으면 데이터가 한 건도 들어오지 않는다.
 *   대시보드에서도 "does not belong to Cloudflare websites" 로 잡힌다.
 *
 * token 은 비밀이 아니다 — 모든 방문자의 HTML 에 그대로 실려 나가는 공개 식별자다.
 * 저장소에 두어도 무방하며, 오히려 여기 없으면 빌드마다 손으로 넣어야 한다.
 */
export const ANALYTICS = {
  /** Cloudflare 대시보드 → Web Analytics → blog.hwanyong.com 에서 발급 (2026-08-21) */
  cfToken: 'd10ef3756f0a47f48b7896721f153bfa',
  /** Cloudflare 가 준 스니펫의 src 원형 */
  beaconSrc: 'https://static.cloudflareinsights.com/beacon.min.js',
  enabled: true,
} as const;
