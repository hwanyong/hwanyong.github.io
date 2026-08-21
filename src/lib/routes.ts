// src/lib/routes.ts — URL 문자열의 단일 출처(SSOT).
//
// ★ astro:content 를 import 하지 않는다. 이 계층은 콘텐츠를 모른다.
//   의존 방향: i18n.ts → routes.ts → content.ts → 컴포넌트/페이지
//
// 왜 이 파일이 필요한가: 접두사(`/ko`)가 붙는 순간, 뷰에 흩어진 `/${collection}/` 같은
// 템플릿 리터럴은 전부 영어 트리를 가리키는 버그가 된다. 순수 문자열이라 어떤 타입
// 변경으로도 잡히지 않는다 — 그래서 URL 을 만드는 곳을 여기 하나로 못박는다.
// ★ 확장자를 붙여 import 한다(src/ 의 나머지는 붙이지 않는다).
//   tools/verify-site.ts 가 이 파일을 ★맨 node 로★ 읽기 때문이다 — Node 의 ESM
//   해석기는 확장자 없는 상대 경로를 찾지 못한다. i18n.ts 가 아무것도 import 하지
//   않는 것과 같은 이유의 제약이고, 이 파일은 그 다음 층까지가 도구에 열려 있다.
//   (astro check 는 allowImportingTsExtensions 로 이 형태를 허용한다.)
import { DEFAULT_LOCALE, LOCALE_CODES, type Alternate, type Locale } from './i18n.ts';

/** 헤더 네비에 나오는 축. 배열 순서가 곧 화면 순서다. */
export const NAV_SECTIONS = ['log', 'lecture', 'project', 'about'] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

/**
 * URL 첫 세그먼트가 고정이고 모든 로케일에 반드시 존재하는 화면 전부.
 *
 * 네비에 없는 privacy 를 포함한다 — 네비 노출과 "모든 로케일에 존재" 는 별개의 축이다.
 * 이 둘을 한 유니온으로 합치면 <a href="/privacy/" aria-current="page"> 라는
 * 존재하지 않는 상태가 타입상 표현 가능해진다.
 */
export type Section = NavSection | 'privacy';

/**
 * 개정축 컬렉션. 값이 곧 URL 첫 세그먼트다.
 *
 * 배열을 export 하지 않는다 — 타입을 파생시키는 것이 유일한 쓰임이다.
 * export 하면 "쓰는 곳이 있나" 를 묻게 되는 공개 표면이 하나 늘고, 답은 없음이다.
 * (축을 순회할 일이 생기면 그때 export 하면 된다.)
 */
const REVISION_COLLECTIONS = ['lecture', 'project'] as const;
export type RevisionCollection = (typeof REVISION_COLLECTIONS)[number];

/**
 * URL 세그먼트가 되는 콘텐츠 키의 규칙 — log 의 groupKey 와 개정축의 series 가 함께 쓴다.
 *
 * 소문자·숫자·하이픈만 쓰되 ★숫자만으로는 이루어질 수 없다★.
 * 목록의 쪽 번호가 정확히 같은 자리에 오기 때문이다:
 *
 *     /log/2/            ← 2쪽
 *     /log/<groupKey>/   ← 글
 *
 * groupKey 가 "2" 이면 두 라우트가 같은 URL 을 주장한다. 정적 빌드에서는
 * prerenderConflictBehavior 가 잡아 주지만, 그때는 이미 "왜 이 글이 목록 2쪽인가"를
 * 사람이 해석해야 한다. 애초에 그런 키를 만들 수 없게 한다.
 *
 * 이 규칙은 content.ts(디렉터리 이름)와 content.config.ts(series 프론트매터)가
 * 함께 읽는다 — 두 곳에 정규식을 따로 적으면 한쪽만 느슨해질 수 있다.
 */
export const URL_KEY = /^(?!\d+$)[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 화면 라벨.
 * 축 이름(Log/Lecture/Project/About/Privacy)은 계기판 어휘라 번역하지 않는다.
 * 그래서 표를 따로 두지 않고 값에서 파생한다 — 표가 없으면 어긋날 수도 없다.
 */
export const sectionLabel = (section: Section | RevisionCollection): string =>
  section[0]!.toUpperCase() + section.slice(1);

/** '' | '/ko' — 기본 로케일은 접두사가 없다. */
const prefix = (locale: Locale): string => (locale === DEFAULT_LOCALE ? '' : `/${locale}`);

export const homeHref = (locale: Locale): string => `${prefix(locale)}/`;

export const sectionHref = (locale: Locale, section: Section): string =>
  `${prefix(locale)}/${section}/`;

/**
 * 목록의 n쪽 주소.
 *
 * ★ 1쪽은 쪽 세그먼트를 갖지 않는다 — 목록 자신의 주소가 1쪽이다.
 *   붙이면 /log/ 와 /log/1/ 이 같은 내용을 두 URL 로 내게 된다.
 *   Astro 의 paginate() 도 [...page] rest 파라미터에 같은 규칙을 쓴다(1쪽이면 undefined).
 *
 * ★ 끝 슬래시는 여기서 붙인다. paginate() 가 만드는 page.url.next 에는 슬래시가 없어
 *   (config.trailingSlash 기본값 'ignore') 화면의 이동 링크를 그쪽에서 받으면
 *   내부 링크마다 리다이렉트가 한 번씩 낀다. 그래서 쪽 주소의 출처는 이 함수 하나다 —
 *   head 의 hreflang 과 화면의 PREV/NEXT 가 같은 함수에서 나온다.
 *   그 함수가 옳은지는 tools/verify-site.ts 가 sitemap 과 값까지 대조해 확인한다.
 */
export const pageHref = (locale: Locale, section: NavSection, page: number): string =>
  page === 1 ? sectionHref(locale, section) : `${prefix(locale)}/${section}/${page}/`;

/** 확장자가 붙은 엔드포인트라 trailing slash 가 없다. */
export const feedHref = (locale: Locale): string => `${prefix(locale)}/rss.xml`;

export const logHref = (locale: Locale, groupKey: string): string =>
  `${prefix(locale)}/log/${groupKey}/`;

/**
 * 개정본의 URL.
 *
 * 최신 개정본은 version === null 이며 계열 루트가 곧 그 개정본의 주소다 —
 * 버전을 고르기만 하는 중간 페이지를 두지 않는다. 구버전만 버전 세그먼트를 갖는다.
 */
export const revisionHref = (
  locale: Locale,
  collection: RevisionCollection,
  series: string,
  version: string | null,
): string =>
  version === null
    ? `${prefix(locale)}/${collection}/${series}/`
    : `${prefix(locale)}/${collection}/${series}/${version}/`;

/**
 * [...lang] 라우트의 params.lang.
 * 기본 로케일은 세그먼트가 없어야 하므로 undefined 를 낸다 —
 * rest 파라미터에 undefined 를 주면 그 세그먼트가 URL 에서 통째로 사라진다.
 */
export const langParam = (locale: Locale): string | undefined =>
  locale === DEFAULT_LOCALE ? undefined : locale;

/**
 * 로케일마다 같은 화면의 주소를 만들어 alternates 로 묶는다.
 *
 * Alternate 의 모양을 만드는 곳을 하나로 둔다 — behind: 0 을 여기저기서 따로 적으면
 * 한 곳만 다른 값을 쓰기 시작해도 아무도 모른다.
 */
const alternatesOf = (href: (locale: Locale) => string): Alternate[] =>
  LOCALE_CODES.map((locale) => ({ locale, href: href(locale), behind: 0 }));

/**
 * 홈 · about · privacy · 쪽이 나뉘지 않는 목록의 alternates.
 *
 * section === null 이면 홈이다. 이 함수가 다루는 화면은 정의상 모든 로케일에
 * 존재하므로 항상 LOCALE_CODES.length 개를 내며 behind 는 항상 0 이다.
 */
export const staticAlternates = (section: Section | null): Alternate[] =>
  alternatesOf((locale) => (section === null ? homeHref(locale) : sectionHref(locale, section)));

/**
 * 쪽이 나뉜 목록의 alternates.
 *
 * n쪽의 짝은 다른 언어의 ★같은 n쪽★ 이다. 1쪽으로 보내면 hreflang 이
 * 서로 다른 내용을 등가로 선언하게 된다.
 *
 * 모든 로케일에 같은 수의 항목이 있으므로(완전쌍 불변식) n쪽은 전 로케일에 존재한다 —
 * 그 불변식이 깨지면 tools/i18n-verify.ts 가 먼저 막는다.
 */
export const pagedAlternates = (section: NavSection, page: number): Alternate[] =>
  alternatesOf((locale) => pageHref(locale, section, page));
