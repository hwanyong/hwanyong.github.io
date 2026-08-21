// src/lib/site.ts — 사이트 상수의 단일 출처(SSOT).
// 여기 값들은 여러 파일(BaseHead, rss.xml, Comments, AdSense)에서 참조되므로
// 문자열을 각 파일에 흩뿌리지 말고 반드시 여기서 import 한다.

export const SITE = {
  /** astro.config.mjs 의 site 와 반드시 같아야 한다. */
  origin: 'https://hwanyong.github.io',
  title: '유환용 기술 블로그',
  description: '프론트엔드와 AI 에이전트에 관한 기록',
  lang: 'ko',
  locale: 'ko-KR',
  author: '유환용',
} as const;

/** giscus 설정. Discussions 활성화 후 categoryId 를 실제 값으로 교체할 것. */
export const GISCUS = {
  repo: 'hwanyong/hwanyong.github.io',
  /** GraphQL repository.id 로 실측 확인된 값 */
  repoId: 'R_kgDOJBJzTA',
  category: 'Announcements',
  /** TODO: Discussions 를 켠 뒤 GraphQL 로 조회해 DIC_kwDO... 로 교체 */
  categoryId: 'DIC_kwDO__REPLACE_ME__',
  origin: 'https://giscus.app',
  /** 커스텀 테마 CSS 의 배포 경로 (public/giscus/*.css) */
  themeBase: 'https://hwanyong.github.io/giscus',
  /** dev 서버에서는 커스텀 CSS 가 CORS 로 막히므로 빌트인 테마를 쓴다 */
  devTheme: { reflect: 'light', emit: 'dark_dimmed' },
} as const;

/** AdSense 설정. 광고 코드는 ca-pub-…, ads.txt 는 pub-… 로 접두사가 다르다. */
export const ADSENSE = {
  /** TODO: 본인 계정의 게시자 ID 인지 반드시 확인할 것 */
  client: 'ca-pub-5888836555193733',
} as const;
