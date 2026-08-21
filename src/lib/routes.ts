// src/lib/routes.ts — URL 문자열의 단일 출처(SSOT).
//
// ★ astro:content 를 import 하지 않는다. 이 계층은 콘텐츠를 모른다.
//   의존 방향: i18n.ts → routes.ts → content.ts → 컴포넌트/페이지
//
// 왜 이 파일이 필요한가: 접두사(`/ko`)가 붙는 순간, 뷰에 흩어진 `/${collection}/` 같은
// 템플릿 리터럴은 전부 영어 트리를 가리키는 버그가 된다. 순수 문자열이라 어떤 타입
// 변경으로도 잡히지 않는다 — 그래서 URL 을 만드는 곳을 여기 하나로 못박는다.
import { DEFAULT_LOCALE, LOCALE_CODES, type Alternate, type Locale } from './i18n';

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

/** 개정축 컬렉션. 값이 곧 URL 첫 세그먼트다. */
export type RevisionCollection = 'lecture' | 'project';

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
 * 홈 · 목록 3개 · about · privacy 의 alternates.
 *
 * section === null 이면 홈이다. 이 함수가 다루는 화면은 정의상 모든 로케일에
 * 존재하므로 항상 LOCALE_CODES.length 개를 내며 behind 는 항상 0 이다.
 */
export const staticAlternates = (section: Section | null): Alternate[] =>
  LOCALE_CODES.map((locale) => ({
    locale,
    href: section === null ? homeHref(locale) : sectionHref(locale, section),
    behind: 0,
  }));
