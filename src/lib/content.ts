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
import { URL_KEY, courseHref, revisionHref, type RevisionCollection } from './routes';
import { SUBJECTS, isSubject, type Subject } from './subjects';

export type { RevisionCollection };

export type LogEntry = CollectionEntry<'log'>;
export type LectureEntry = CollectionEntry<'lecture'>;
export type LectureCourseEntry = CollectionEntry<'lectureCourse'>;
export type ProjectEntry = CollectionEntry<'project'>;

/** 개정축 항목. 두 컬렉션이 revisionFields 를 공유하므로 공통 필드는 항상 있다. */
export type RevisionEntry<C extends RevisionCollection = RevisionCollection> =
  CollectionEntry<C>;

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
  if (!URL_KEY.test(key))
    throw new Error(
      `groupKey 는 소문자·숫자·하이픈만 쓰되 숫자만으로 이루어질 수 없습니다` +
        `(숫자만인 이름은 목록의 쪽 번호와 같은 URL 을 주장한다). id=${id}, key=${key}`,
    );
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

/**
 * 개정 묶음의 키 = 버전 디렉터리 위의 ★경로 전부★.
 *
 *   project   analysis-video/v1-0/en          →  analysis-video
 *   lecture   math/linear-algebra/01-v/v1-0/en →  math/linear-algebra/01-v
 *
 * 프론트매터의 series 를 쓰지 않는 이유: 디렉터리 이름과 같은 사실을 두 벌 갖게 되고,
 * 어긋나면 URL 은 디렉터리를 따르고 묶음은 프론트매터를 따라 조용히 갈라진다.
 * 경로 하나만 보면 그 상태가 표현 불가능하다.
 *
 * 축마다 깊이가 다르지만 규칙은 하나다 — "마지막 둘(버전 · 로케일)을 뗀 나머지".
 * 그래서 이 함수도, revisionHref 도 축을 구분하지 않는다.
 */
const revisionKeyOf = (id: string): string => {
  const parts = id.split('/');
  if (parts.length < 3)
    throw new Error(`개정본 경로가 <키…>/<버전>/<로케일>.md 여야 합니다: ${id}`);
  const key = parts.slice(0, -2).join('/');
  for (const segment of parts.slice(0, -1)) {
    if (!URL_KEY.test(segment))
      throw new Error(
        `경로 세그먼트는 소문자·숫자·하이픈만 쓰되 숫자만으로 이루어질 수 없습니다.\n` +
          `  id=${id}, 문제 세그먼트=${segment}`,
      );
  }
  return key;
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
  /**
   * 개정 묶음의 키 = 버전 디렉터리 위의 경로(revisionKeyOf).
   * 한 세그먼트가 아니다 — lecture 는 `<과목>/<코스>/<차시>` 세 단계다.
   *
   * 이름이 key 가 아니라 path 인 이유: TimelineItem.key 는 렌더 키라 뜻이 다르다.
   */
  path: string;
  /** 최신 개정본. 계열 제목·설명의 대표값으로 쓴다. */
  latest: E;
  /** 최신순 정렬된 전체 개정본 */
  revisions: E[];
}

export const getSeriesHistories = async <C extends RevisionCollection>(
  collection: C,
): Promise<SeriesHistory<RevisionEntry<C>>[]> => {
  const entries = (await getCollection(collection, isVisible)).sort(byDateDesc);

  // 버킷 키는 `${locale} ${경로키}` — 두 축을 한 번에 가른다.
  // 경로 세그먼트는 URL_KEY 가 공백을 금지하므로 이 구분자가 값과 충돌할 수 없다.
  const buckets = new Map<string, RevisionEntry<C>[]>();
  for (const entry of entries) {
    const bucket = `${localeOf(entry.id)} ${revisionKeyOf(entry.id)}`;
    const list = buckets.get(bucket) ?? [];
    list.push(entry);
    buckets.set(bucket, list);
  }

  const histories: SeriesHistory<RevisionEntry<C>>[] = [];
  for (const [bucket, list] of buckets) {
    // 그룹 안의 정렬을 반드시 유지한다 — 이것이 계열 루트가 어느 개정본을 내는지를 정한다.
    const revisions = list.sort(byDateDesc);
    const latest = revisions[0];
    if (!latest) continue;
    const [locale, path] = bucket.split(' ') as [Locale, string];
    histories.push({ collection, locale, path, latest, revisions });
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
   * 그 컬렉션 안에서의 ★주소 경로★.
   *   log       groupKey                          (first-post)
   *   project   계열 이름                          (analysis-video)
   *   lecture   과목/코스/차시                      (math/linear-algebra/01-vectors)
   * ★ 완성된 URL 이 아니다 — 뷰가 routes.ts 로 로케일 접두사를 붙인다.
   */
  slug: string;
  /**
   * 공개 후 절대 바뀌지 않아야 하는 ★정체성★. giscus 검색어와 RSS guid 가 이것을 쓴다.
   *
   * ★ slug 와 다를 수 있다. lecture 의 slug 에는 과목이 들어 있는데, 과목은 분류라
   *   나중에 바뀔 수 있다. 정체성이 과목을 담으면 재분류가 댓글을 끊고 피드를
   *   재발행한다. 그래서 lecture 의 정체성은 `<코스>:<차시>` 이고 과목이 없다.
   *   그 대가로 코스 이름이 과목을 가로질러 유일해야 하며 빌드가 그것을 강제한다.
   *   log·project 는 slug 가 곧 정체성이다.
   */
  identity: string;
  /**
   * 항목이 속한 더 큰 것의 이름. 지금은 강의 차시의 코스 이름뿐이다.
   * 홈의 통합 목록에서 "벡터공간" 만 있으면 어느 강의의 몇 강인지 알 수 없다.
   */
  context?: string;
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
  /** 강의 전용 — 과목. 카드와 줄의 칩이 이것을 읽는다. */
  subject?: Subject;
  /** 목록 썸네일(public 기준 경로). 없으면 뷰가 이름으로 플레이트를 그린다. */
  thumbnail?: string;
}

const toLogItem = (entry: LogEntry): TimelineItem => ({
  key: `log:${entry.id}`,
  kind: 'log',
  slug: groupKeyOf(entry.id),
  identity: groupKeyOf(entry.id),
  title: entry.data.title,
  description: entry.data.description,
  date: entry.data.date,
  tags: entry.data.tags,
  untranslated: entry.data.untranslated,
});

const toSeriesItem = ({
  collection,
  locale,
  path,
  latest,
  revisions,
}: SeriesHistory): TimelineItem => ({
  key: `${collection}:${locale}:${path}`,
  kind: collection,
  slug: path,
  identity: path,
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

/**
 * 목록 한 쪽에 싣는 항목 수. log 와 개정축이 함께 쓴다.
 *
 * 홈은 쪽을 나누지 않는다 — 세 축을 한 시간축에 섞어 "언제 무엇을 했는지" 를 한눈에
 * 보이려는 화면이라, 그 그림을 쪽으로 자르면 화면의 목적 자체가 사라진다.
 * 개수가 부담이 되는 날에는 쪽이 아니라 "최근 N개" 로 자르는 편이 맞다.
 */
export const PAGE_SIZE = 10;

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

/*
 * ★ 빈 축을 감추는 판정(hasSeries · liveNavSections)은 없다.
 *
 *   예전에는 항목이 0개인 개정축을 네비와 sitemap 에서 통째로 뺐다. 그러면 축이
 *   "아직 없는 것" 이 아니라 "존재하지 않는 것" 이 되어, 첫 항목을 넣기 전까지는
 *   그 자리를 화면에서 확인할 방법이 없었다. 지금은 축이 항상 있고, 비어 있다는
 *   사실은 목록이 UI[locale].emptyLecture 로 직접 말한다.
 *
 *   대신 지켜야 할 것이 하나 생긴다: 항목이 0개인 화면에는 광고를 싣지 않는다
 *   (publisher content 가 없는 화면의 광고는 Google Publisher Policies 위반).
 *   그 게이트는 목록 페이지의 ads={items.length > 0} 이다.
 */

/* 강의 축 (과목 / 코스 / 차시 / 개정) */

/**
 * 갤러리 카드 한 장. 강의 목록 화면들이 공유하는 표시용 형태다.
 *
 * TimelineItem 과 나누어 둔 이유: 갤러리에는 ★코스★ 도 올라오는데 코스에는 개정본이
 * 없다. 한 타입에 몰면 "코스에는 절대 없는 필드" 가 절반이 되고, 뷰가 그것을
 * 매번 다시 물어야 한다.
 */
export interface GalleryCard {
  /** 렌더 key */
  key: string;
  href: string;
  /** public/ 기준 절대 경로. 강의 축은 스키마가 필수로 강제한다. */
  thumbnail: string;
  title: string;
  description: string;
  date: Date;
  /** 카드 머리의 계기판 칩. 과목 코드(MATH) 또는 차시 번호. */
  code?: string;
  /** 개정본의 표시용 버전 문자열 */
  version?: string;
  /** 개정본 개수. 2 이상일 때만 눈금을 그린다. */
  revisionCount?: number;
  /** 원문 로케일. 아직 번역되지 않은 사본일 때만 값이 있다. */
  untranslated?: Locale;
}

/** 한 코스의 한 차시. history 가 그 차시의 개정 이력이다. */
export interface LectureSession {
  session: string;
  history: SeriesHistory<LectureEntry>;
}

/** 한 로케일에서의 코스 하나. */
export interface LectureCourse {
  locale: Locale;
  subject: Subject;
  course: string;
  /** 코스 표지. 제목·개요 본문·대표 이미지가 여기서 나온다. */
  cover: LectureCourseEntry;
  /** 차시. ★디렉터리 이름 오름차순★ 이다(01-… 02-… 03-…). */
  sessions: LectureSession[];
}

/**
 * 강의 경로를 과목·코스·(차시)로 가른다.
 *
 * 과목이 SUBJECTS 에 없으면 여기서 빌드를 죽인다. 모르는 과목을 통과시키면
 * /lecture/<모르는것>/ 이 만들어지고, 그 화면은 이름도 붙일 수 없다.
 */
const lecturePartsOf = (
  path: string,
  what: string,
): { subject: Subject; course: string; rest: string[] } => {
  const [subject, course, ...rest] = path.split('/');
  if (!subject || !isSubject(subject))
    throw new Error(
      `강의의 첫 디렉터리는 과목이어야 합니다.\n` +
        `  ${what}=${path}, 받은 값=${subject}\n` +
        `  쓸 수 있는 과목: ${Object.keys(SUBJECTS).join(' · ')}\n` +
        `  과목을 늘리려면 src/lib/subjects.ts 에 넣으세요(두 언어 이름이 함께 필요합니다).`,
    );
  if (!course) throw new Error(`강의 경로에 코스 디렉터리가 없습니다: ${what}=${path}`);
  return { subject, course, rest };
};

/**
 * 그 로케일의 코스 전부. 과목별로 나뉘어 있지 않은 평평한 목록이다.
 *
 * ★ 여기서 코스 이름의 유일성을 강제한다. giscus 검색어와 RSS guid 가
 *   `<코스>:<차시>` 라 과목을 담지 않기 때문이다 — 그 덕에 강의를 다른 과목으로
 *   옮겨도 댓글과 피드가 살아 있지만, 두 과목에 같은 이름의 코스가 있으면
 *   서로 다른 강의가 같은 댓글 스레드를 쓰게 된다.
 */
export const getLectureCourses = async (locale: Locale): Promise<LectureCourse[]> => {
  const covers = (await getCollection('lectureCourse', isVisible))
    .filter((entry) => localeOf(entry.id) === locale)
    .sort(byDateDesc);

  const histories = (await getSeriesHistories('lecture')).filter(
    (history) => history.locale === locale,
  );

  // 차시를 코스 경로(<과목>/<코스>)로 모은다.
  const byCourse = new Map<string, LectureSession[]>();
  for (const history of histories) {
    const { subject, course, rest } = lecturePartsOf(history.path, '차시 경로');
    const session = rest[0];
    if (!session || rest.length !== 1)
      throw new Error(
        `차시 경로는 <과목>/<코스>/<차시>/<버전>/<로케일>.md 여야 합니다: ${history.path}`,
      );
    const key = `${subject}/${course}`;
    byCourse.set(key, [...(byCourse.get(key) ?? []), { session, history }]);
  }

  const seenCourse = new Map<string, string>();
  const courses: LectureCourse[] = [];

  for (const cover of covers) {
    const path = cover.id.split('/').slice(0, -1).join('/');
    const { subject, course, rest } = lecturePartsOf(path, '코스 표지 경로');
    if (rest.length > 0)
      throw new Error(`코스 표지는 <과목>/<코스>/<로케일>.md 여야 합니다: ${cover.id}`);

    const previous = seenCourse.get(course);
    if (previous)
      throw new Error(
        `코스 이름이 과목을 가로질러 겹칩니다: "${course}"\n` +
          `  ${previous}  ↔  ${subject}\n` +
          `  댓글 검색어와 RSS guid 가 과목을 담지 않으므로(그래야 재분류가 안전하다)\n` +
          `  코스 이름은 사이트 전체에서 유일해야 합니다. 한쪽 이름을 바꾸세요.`,
      );
    seenCourse.set(course, subject);

    courses.push({
      locale,
      subject,
      course,
      cover,
      // 차시는 날짜가 아니라 이름 오름차순이다 — 3강을 2강보다 먼저 쓸 수도 있다.
      sessions: (byCourse.get(path) ?? []).sort((a, b) => byCodePoint(a.session, b.session)),
    });
  }

  // 표지 없는 차시가 남았으면 그 코스는 화면도 주소도 만들 수 없다.
  for (const key of byCourse.keys()) {
    if (!courses.some((c) => `${c.subject}/${c.course}` === key))
      throw new Error(
        `차시는 있는데 코스 표지가 없습니다: src/content/lecture/${key}/\n` +
          `  그 디렉터리에 ${LOCALE_CODES.map((c) => `${c}.md`).join(' · ')} 를 만드세요.\n` +
          `  표지가 코스의 제목·개요·대표 이미지를 갖습니다.`,
      );
  }

  return courses;
};

/** 과목별로 나눈 코스. SUBJECT_SLUGS 순서이며 빈 과목도 자리를 지킨다. */
export const getCoursesBySubject = async (
  locale: Locale,
): Promise<{ subject: Subject; courses: LectureCourse[] }[]> => {
  const all = await getLectureCourses(locale);
  return (Object.keys(SUBJECTS) as Subject[]).map((subject) => ({
    subject,
    courses: all.filter((course) => course.subject === subject),
  }));
};

/**
 * 코스 카드. 갤러리에서 코스 하나를 나타낸다.
 *
 * code 를 넣지 않는다 — 코스 카드는 언제나 자기 과목의 섹션 안에 놓이고,
 * 그 섹션 머리에 이미 같은 칩이 있다. 카드마다 한 번 더 적으면 같은 말이 두 벌이다.
 * (차시 카드의 code 는 차시 번호라 그런 문제가 없다.)
 */
export const courseCard = (course: LectureCourse): GalleryCard => ({
  key: `course:${course.locale}:${course.subject}/${course.course}`,
  href: courseHref(course.locale, course.subject, course.course),
  thumbnail: course.cover.data.thumbnail,
  title: course.cover.data.title,
  description: course.cover.data.description,
  date: course.cover.data.date,
  untranslated: course.cover.data.untranslated,
});

/** 차시 카드. 코스 화면의 갤러리가 이것을 그린다. */
export const sessionCard = (session: LectureSession): GalleryCard => {
  const { history } = session;
  const latest = history.latest;
  return {
    key: `session:${history.locale}:${history.path}`,
    href: revisionHref(history.locale, 'lecture', history.path, null),
    thumbnail: latest.data.thumbnail,
    title: latest.data.title,
    description: latest.data.description,
    date: latest.data.date,
    // 차시 번호는 디렉터리 이름 앞의 숫자다. 없으면 칩을 붙이지 않는다.
    code: /^\d+/.exec(session.session)?.[0],
    version: latest.data.version,
    revisionCount: history.revisions.length,
    untranslated: latest.data.untranslated,
  };
};

/** 홈·피드가 쓰는 강의 줄. 차시 단위다 — 발행되는 단위가 차시이기 때문이다. */
const getLectureTimeline = async (locale: Locale): Promise<TimelineItem[]> => {
  const courses = await getLectureCourses(locale);
  return courses.flatMap((course) =>
    course.sessions.map(({ session, history }): TimelineItem => {
      const latest = history.latest;
      return {
        key: `lecture:${history.locale}:${history.path}`,
        kind: 'lecture',
        slug: history.path,
        // ★ 과목이 빠진다. 이유는 TimelineItem.identity 주석에 있다.
        identity: `${course.course}:${session}`,
        context: course.cover.data.title,
        subject: course.subject,
        title: latest.data.title,
        description: latest.data.description,
        date: latest.data.date,
        tags: latest.data.tags,
        untranslated: latest.data.untranslated,
        revisionCount: history.revisions.length,
        version: latest.data.version,
        thumbnail: latest.data.thumbnail,
      };
    }),
  );
};

/**
 * 홈과 피드가 쓰는 통합 목록. 세 축을 하나의 시간축에 섞는다.
 *
 * 강의는 ★차시★ 단위로 한 줄이다 — 발행되는 단위가 차시이므로, 코스 단위로 묶으면
 * 새 차시가 나와도 구독자에게 아무 일도 일어나지 않는다.
 * project 는 계열 단위로 한 줄이며 대표 날짜는 최신 개정일이다.
 */
export const getTimeline = async (locale: Locale): Promise<TimelineItem[]> => {
  const parts = await Promise.all([
    getLogTimeline(locale),
    getLectureTimeline(locale),
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
  path: string,
  version: string | null,
  baseLocale: Locale,
): Alternate[] => {
  const base = histories.find((h) => h.locale === baseLocale && h.path === path);

  return LOCALE_CODES.flatMap((locale) => {
    const history = histories.find((h) => h.locale === locale && h.path === path);
    if (!history) return [];
    const collection = history.collection;

    if (version === null) {
      // 그 로케일의 최신본이 기준 언어의 개정 목록에서 몇 번째인가 = 뒤처진 개정 수.
      const latestSlug = versionSlug(history.revisions[0]!);
      const behind = base
        ? Math.max(0, base.revisions.findIndex((rev) => versionSlug(rev) === latestSlug))
        : 0;
      return [{ locale, href: revisionHref(locale, collection, path, null), behind }];
    }

    // 구버전: 같은 개정 세그먼트가 그 로케일에도 있고, 그 로케일에서 최신이 아닐 때만
    // 짝이 성립한다(그 로케일에서 최신이면 그 항목의 주소는 계열 루트이지 이 URL 이 아니다).
    const index = history.revisions.findIndex((rev) => versionSlug(rev) === version);
    return index > 0
      ? [{ locale, href: revisionHref(locale, collection, path, version), behind: 0 }]
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
