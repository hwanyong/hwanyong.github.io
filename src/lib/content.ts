// src/lib/content.ts — 컬렉션 조회/정렬/그룹핑의 단일 출처(SSOT).
//
// 페이지마다 getCollection + 필터 + 정렬을 inline 으로 재구현하지 말고
// 전부 여기서 import 한다. 특히 draft 필터는 목록 페이지와 상세 라우트의
// getStaticPaths() 양쪽에 "동일하게" 걸려야 한다. 한쪽만 걸면 초안 글의
// 상세 페이지가 URL 로 그대로 배포된다.
//
// 개정축(lecture·project)은 조회 로직이 완전히 같다. 컬렉션 이름을 인자로 받는
// 제네릭 함수 한 벌로 처리하고, 축마다 복사하지 않는다.
//
// 로케일
//   항목 id 의 마지막 세그먼트가 로케일이다(파일 이름이 en.md · ko.md 이므로).
//   축마다 경로 깊이가 달라도 이 규칙 하나로 통일되어, 축을 구분하는 분기가 없다.
//
// ★ 금지 규약: LOCALE_CODES.flatMap(l => getX(l)) 형태로 경로를 만들지 말 것.
//   로케일은 항상 "존재하는 콘텐츠" 에서 나와야 한다. 콘텐츠 없이 URL 을 만들면
//   sitemap 은 hreflang 쌍을 내고 head 는 못 내는 불일치가 생긴다.
//   이 저장소는 tools/i18n-verify.ts 가 "모든 항목이 모든 로케일 판본을 갖는다" 를
//   강제하므로 결과적으로 전 항목이 전 로케일에 나오지만, 그것은 ★콘텐츠가 실제로
//   있기 때문★ 이지 로케일을 곱해서가 아니다. 이 구분이 중요하다.
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { LOCALE_CODES, isLocale, type Alternate, type Locale } from './i18n';
import {
  NAV_SECTIONS,
  REVISION_COLLECTIONS,
  revisionHref,
  type NavSection,
  type RevisionCollection,
} from './routes';

export type { RevisionCollection };

export type LogEntry = CollectionEntry<'log'>;
export type LectureEntry = CollectionEntry<'lecture'>;
export type ProjectEntry = CollectionEntry<'project'>;

/** 개정축 항목. 두 컬렉션이 revisionFields 를 공유하므로 공통 필드는 항상 있다. */
export type RevisionEntry<C extends RevisionCollection = RevisionCollection> =
  CollectionEntry<C>;

/** URL 세그먼트로 쓰이는 키의 규칙. series 와 log 의 groupKey 가 같은 규칙을 쓴다. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 세 축 공통: 항목 id 의 마지막 세그먼트가 로케일이다. */
const localeOf = (id: string): Locale => {
  const last = id.split('/').at(-1);
  if (!last || !isLocale(last))
    throw new Error(
      `콘텐츠 파일 이름이 로케일이어야 합니다(${LOCALE_CODES.join('.md | ')}.md). id=${id}`,
    );
  return last;
};

/** log 의 그룹 키 = 로케일 파일이 담긴 디렉터리 이름. */
const groupKeyOf = (id: string): string => {
  const key = id.split('/').slice(0, -1).join('/');
  if (!SLUG.test(key))
    throw new Error(`groupKey 는 소문자·숫자·하이픈만 사용할 수 있습니다. id=${id}, key=${key}`);
  return key;
};

/**
 * 개정 URL 세그먼트 = 로케일 파일의 부모 디렉터리 이름.
 * frontmatter 의 version 은 표시용이며 점을 포함할 수 있어 URL 로 쓰지 않는다.
 */
export const versionSlug = (entry: RevisionEntry): string => {
  const slug = entry.id.split('/').at(-2);
  if (!slug) throw new Error(`개정축 항목의 id 에 개정 세그먼트가 없습니다: ${entry.id}`);
  return slug;
};

/** 프로덕션 빌드에서만 draft 를 제외한다(dev 서버에서는 초안도 보인다). */
const isVisible = (entry: { data: { draft: boolean } }): boolean =>
  import.meta.env.PROD ? entry.data.draft !== true : true;

/**
 * 동점 시 tie-break.
 *
 * ★ localeCompare 를 쓰지 않는다. 인자 없는 localeCompare 는 런타임 기본 로케일에
 *   의존해서, "어느 기계에서나 같은 순서" 라는 이 함수의 목적과 정면으로 어긋난다.
 *   필요한 것은 사람이 읽을 순서가 아니라 결정적인 순서이고, 코드포인트 비교가 그 도구다.
 */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * date 최신순 정렬.
 *
 * getCollection() 의 반환 순서는 공식 문서가 "non-deterministic and
 * platform-dependent" 라고 명시한 값이다. 정렬을 빠뜨리면 로컬과 CI 에서
 * 글 순서가 달라진다 — 개정축에서는 계열 루트가 기계마다 다른 개정본을 내는데,
 * 경로 충돌이 아니라 내용 차이라서 prerenderConflictBehavior 가 잡지 못한다.
 */
const byDateDesc = <T extends { id: string; data: { date: Date } }>(a: T, b: T): number => {
  const diff = b.data.date.valueOf() - a.data.date.valueOf();
  return diff !== 0 ? diff : byCodePoint(b.id, a.id);
};

/* 시간축 (log) */

/** 한 글의 한 언어 판본. */
export interface Translation {
  locale: Locale;
  entry: LogEntry;
}

/** 한 글의 언어별 판본 전부. translations 는 LOCALE_CODES 순서다. */
export interface LogGroup {
  groupKey: string;
  translations: Translation[];
}

/** 공개 대상 log 판본을 groupKey 로 묶어 최신순으로 반환한다. */
export const getLogGroups = async (): Promise<LogGroup[]> => {
  const entries = (await getCollection('log', isVisible)).sort(byDateDesc);

  const byKey = new Map<string, Translation[]>();
  for (const entry of entries) {
    const key = groupKeyOf(entry.id);
    const list = byKey.get(key) ?? [];
    list.push({ locale: localeOf(entry.id), entry });
    byKey.set(key, list);
  }

  return [...byKey].map(([groupKey, translations]) => ({
    groupKey,
    translations: translations.sort(
      (a, b) => LOCALE_CODES.indexOf(a.locale) - LOCALE_CODES.indexOf(b.locale),
    ),
  }));
};

/** 그 로케일의 log 판본만, 최신순. */
export const getLogEntries = async (locale: Locale): Promise<LogEntry[]> =>
  (await getCollection('log', isVisible))
    .filter((entry) => localeOf(entry.id) === locale)
    .sort(byDateDesc);

/* 개정축 (lecture · project) */

/**
 * 한 계열의, ★한 로케일에서의★ 개정 이력. 최신순.
 *
 * 로케일로 먼저 가르고 그 안에서 계열로 묶는 이유:
 * "그 언어의 최신 개정본" 이 "그 언어의 계열 루트 URL" 을 가져야 하기 때문이다.
 * 계열로 먼저 묶으면 두 언어의 개정본이 한 목록에 섞여 그 규칙이 성립하지 않는다.
 */
export interface SeriesHistory<E extends RevisionEntry = RevisionEntry> {
  collection: RevisionCollection;
  locale: Locale;
  series: string;
  /** 최신 개정본. 계열 제목·설명의 대표값으로 쓴다. */
  latest: E;
  /** 최신순 정렬된 전체 개정본 */
  revisions: E[];
}

export const getSeriesHistories = async <C extends RevisionCollection>(
  collection: C,
): Promise<SeriesHistory<RevisionEntry<C>>[]> => {
  const entries = (await getCollection(collection, isVisible)).sort(byDateDesc);

  // 키는 `${locale} ${series}` — 두 축을 한 번에 가른다.
  // series 는 SLUG 정규식이 공백을 금지하므로 이 구분자가 값과 충돌할 수 없다.
  const buckets = new Map<string, RevisionEntry<C>[]>();
  for (const entry of entries) {
    const key = `${localeOf(entry.id)} ${entry.data.series}`;
    const list = buckets.get(key) ?? [];
    list.push(entry);
    buckets.set(key, list);
  }

  const histories: SeriesHistory<RevisionEntry<C>>[] = [];
  for (const [key, list] of buckets) {
    // 그룹 안의 정렬을 반드시 유지한다 — 이것이 계열 루트가 어느 개정본을 내는지를 정한다.
    const revisions = list.sort(byDateDesc);
    const latest = revisions[0];
    if (!latest) continue;
    const [locale, series] = key.split(' ') as [Locale, string];
    histories.push({ collection, locale, series, latest, revisions });
  }

  return histories.sort((a, b) => byDateDesc(a.latest, b.latest));
};

/* 목록 표시용 정규화 */

/**
 * 목록 화면이 쓰는 표시용 항목.
 *
 * 시간축(log)과 개정축(lecture·project)은 스키마가 다르지만 목록에서는 같은 줄로
 * 보인다. 뷰가 세 타입을 각각 분기하지 않도록 여기서 한 형태로 정규화한다.
 * revisionCount 가 있으면 개정 눈금을, 없으면 눈금 없이 렌더한다.
 */
export interface TimelineItem {
  /** 렌더 key. 컬렉션이 달라도 충돌하지 않게 접두사를 붙인다. */
  key: string;
  kind: 'log' | RevisionCollection;
  /**
   * log 이면 groupKey, 개정축이면 series.
   * ★ URL 이 아니다 — 뷰가 routes.ts 로 로케일에 맞는 주소를 만든다.
   */
  slug: string;
  title: string;
  description: string;
  date: Date;
  tags: string[];
  /** 원문 로케일. 아직 번역되지 않은 사본일 때만 값이 있다. 목록이 배지를 붙인다. */
  untranslated?: Locale;
  /** 개정축 전용 — 개정본 개수. 눈금 개수와 같다. */
  revisionCount?: number;
  /** 개정축 전용 — 최신 개정본의 표시용 버전 문자열 */
  version?: string;
  /** 목록 썸네일(public 기준 경로). 없으면 뷰가 이름으로 플레이트를 그린다. */
  thumbnail?: string;
}

const toLogItem = (entry: LogEntry): TimelineItem => ({
  key: `log:${entry.id}`,
  kind: 'log',
  slug: groupKeyOf(entry.id),
  title: entry.data.title,
  description: entry.data.description,
  date: entry.data.date,
  tags: entry.data.tags,
  untranslated: entry.data.untranslated,
});

const toSeriesItem = ({
  collection,
  locale,
  series,
  latest,
  revisions,
}: SeriesHistory): TimelineItem => ({
  key: `${collection}:${locale}:${series}`,
  kind: collection,
  slug: series,
  title: latest.data.title,
  description: latest.data.description,
  date: latest.data.date,
  tags: latest.data.tags,
  untranslated: latest.data.untranslated,
  revisionCount: revisions.length,
  version: latest.data.version,
  // thumbnail 은 project 축에만 있는 필드다. lecture 항목에는 없으므로 존재를 먼저 묻는다.
  thumbnail: 'thumbnail' in latest.data ? latest.data.thumbnail : undefined,
});

export const getLogTimeline = async (locale: Locale): Promise<TimelineItem[]> =>
  (await getLogEntries(locale)).map(toLogItem);

/** 그 로케일의 본문이 있는 계열만. 언어를 섞지 않는다. */
export const getSeriesTimeline = async (
  collection: RevisionCollection,
  locale: Locale,
): Promise<TimelineItem[]> =>
  (await getSeriesHistories(collection))
    .filter((history) => history.locale === locale)
    .map(toSeriesItem);

/**
 * 그 축에 계열이 하나라도 있는가.
 *
 * 로케일을 묻지 않는다 — tools/i18n-verify.ts 가 "모든 항목이 모든 로케일 판본을 갖는다"를
 * 강제하므로 한 로케일에만 존재하는 축은 만들어질 수 없다.
 */
export const hasSeries = async (collection: RevisionCollection): Promise<boolean> =>
  (await getSeriesHistories(collection)).length > 0;

/**
 * 헤더 네비에 실제로 내보낼 축.
 *
 * 항목이 0개인 개정축을 네비에 남기면 누른 사람이 "아직 없습니다" 한 줄만 보고 돌아간다.
 * 목록 라우트의 getStaticPaths 도 같은 hasSeries 를 쓴다 — 안내에서는 뺐는데 sitemap 에는
 * 남는 불일치를 만들지 않기 위해서다. 축을 지우는 게 아니라 비어 있는 동안만 감추는 것이고,
 * 첫 항목이 들어오면 네비와 URL 이 함께 되살아난다.
 *
 * log·about 은 개정축이 아니므로 이 판정의 대상이 아니다.
 */
let navCache: NavSection[] | null = null;

export const liveNavSections = async (): Promise<NavSection[]> => {
  if (navCache) return navCache;

  const empty = new Set<string>();
  for (const collection of REVISION_COLLECTIONS) {
    if (!(await hasSeries(collection))) empty.add(collection);
  }
  const sections = NAV_SECTIONS.filter((section) => !empty.has(section));

  // 빌드 1회분 메모. BaseLayout 은 모든 페이지에서 이걸 부르는데, 빈 컬렉션을 조회할 때마다
  // Astro 가 [glob-loader] 경고를 한 줄씩 찍는다. 메모가 없으면 페이지 수만큼 경고가 쌓여
  // 진짜 경고가 그 속에 묻힌다. dev 는 콘텐츠가 바뀌면 모듈을 다시 평가하므로 안전하다.
  navCache = sections;
  return sections;
};

/**
 * 홈과 피드가 쓰는 통합 목록. 세 축을 하나의 시간축에 섞는다.
 * 개정축은 계열 단위로 한 줄이며, 대표 날짜는 최신 개정일이다.
 */
export const getTimeline = async (locale: Locale): Promise<TimelineItem[]> => {
  const parts = await Promise.all([
    getLogTimeline(locale),
    getSeriesTimeline('lecture', locale),
    getSeriesTimeline('project', locale),
  ]);

  return parts.flat().sort((a, b) => {
    const diff = b.date.valueOf() - a.date.valueOf();
    return diff !== 0 ? diff : byCodePoint(b.key, a.key);
  });
};

/**
 * 개정축 화면의 alternates.
 *
 * 최신 개정본은 그 로케일의 계열 루트다(version === null).
 * behind 는 기준 언어보다 몇 개정 뒤처졌는가이며 0 이면 동기다.
 *
 * ★ 지금 이 값은 항상 0 이다(모든 계열이 개정 1개뿐). 그런데도 지금 만드는 이유:
 *   본문 저작이 영어이고 한국어가 번역이므로, 개정이 날 때마다 반드시 "ko 가 한
 *   개정 뒤처진 채 ko 의 계열 루트인" 상태를 지난다. 그때 stale 배너는 뜨지 않는다 —
 *   ko 로케일 안에서는 그것이 최신이기 때문이다. hreflang 은 그 둘을 등가로 선언하고
 *   화면 어디에도 그 사실이 없게 된다. 나중에 만들면 hreflang·스위처·배너 세 곳을
 *   동시에 고쳐야 하고, 그때는 이미 잘못된 등가 선언이 색인돼 있다.
 */
export const revisionAlternates = (
  histories: SeriesHistory[],
  series: string,
  version: string | null,
  baseLocale: Locale,
): Alternate[] => {
  const base = histories.find((h) => h.locale === baseLocale && h.series === series);

  return LOCALE_CODES.flatMap((locale) => {
    const history = histories.find((h) => h.locale === locale && h.series === series);
    if (!history) return [];
    const collection = history.collection;

    if (version === null) {
      // 그 로케일의 최신본이 기준 언어의 개정 목록에서 몇 번째인가 = 뒤처진 개정 수.
      const latestSlug = versionSlug(history.revisions[0]!);
      const behind = base
        ? Math.max(0, base.revisions.findIndex((rev) => versionSlug(rev) === latestSlug))
        : 0;
      return [{ locale, href: revisionHref(locale, collection, series, null), behind }];
    }

    // 구버전: 같은 개정 세그먼트가 그 로케일에도 있고, 그 로케일에서 최신이 아닐 때만
    // 짝이 성립한다(그 로케일에서 최신이면 그 항목의 주소는 계열 루트이지 이 URL 이 아니다).
    const index = history.revisions.findIndex((rev) => versionSlug(rev) === version);
    return index > 0
      ? [{ locale, href: revisionHref(locale, collection, series, version), behind: 0 }]
      : [];
  });
};

export interface YearGroup {
  year: number;
  items: TimelineItem[];
}

/**
 * 연도별 그룹핑. 입력은 이미 최신순으로 정렬되어 있어야 한다.
 *
 * 연도는 반드시 UTC 기준으로 뽑는다. 스키마의 z.coerce.date() 는 날짜 문자열을
 * UTC 자정으로 파싱하므로, 로컬 시간대로 읽으면 1월 1일 글이 전년도로 밀린다.
 */
export const groupByYear = (items: TimelineItem[]): YearGroup[] => {
  const groups: YearGroup[] = [];

  for (const item of items) {
    const year = item.date.getUTCFullYear();
    const last = groups.at(-1);
    if (last?.year === year) last.items.push(item);
    else groups.push({ year, items: [item] });
  }

  return groups;
};
