// src/lib/content.ts — 컬렉션 조회/정렬/그룹핑의 단일 출처(SSOT).
//
// 페이지마다 getCollection + 필터 + 정렬을 inline 으로 재구현하지 말고
// 전부 여기서 import 한다. 특히 draft 필터는 목록 페이지와 상세 라우트의
// getStaticPaths() 양쪽에 "동일하게" 걸려야 한다. 한쪽만 걸면 초안 글의
// 상세 페이지가 URL 로 그대로 배포된다.
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

export type LogEntry = CollectionEntry<'log'>;
export type WorkEntry = CollectionEntry<'work'>;

/** 프로덕션 빌드에서만 draft 를 제외한다(dev 서버에서는 초안도 보인다). */
const isVisible = (entry: { data: { draft: boolean } }): boolean =>
  import.meta.env.PROD ? entry.data.draft !== true : true;

/**
 * date 최신순 정렬.
 * getCollection() 의 반환 순서는 공식 문서가 "non-deterministic and
 * platform-dependent" 라고 명시한 값이다. 정렬을 빠뜨리면 로컬과 CI 에서
 * 글 순서가 달라진다.
 * 날짜가 같을 때를 대비해 id 역순 2차 정렬로 결정성을 보장한다.
 */
const byDateDesc = <T extends { id: string; data: { date: Date } }>(a: T, b: T): number => {
  const diff = b.data.date.valueOf() - a.data.date.valueOf();
  return diff !== 0 ? diff : b.id.localeCompare(a.id);
};

/** 공개 대상 log 항목을 최신순으로 반환한다. */
export const getLogEntries = async (): Promise<LogEntry[]> =>
  (await getCollection('log', isVisible)).sort(byDateDesc);

/** 공개 대상 work 항목(개정본 단위)을 최신순으로 반환한다. */
export const getWorkEntries = async (): Promise<WorkEntry[]> =>
  (await getCollection('work', isVisible)).sort(byDateDesc);

/**
 * 항목 id 의 마지막 세그먼트 = 버전 URL 세그먼트.
 * id 는 glob() 로더가 파일 경로를 슬러그화해 만든 값이라 이미 URL 안전하다.
 * frontmatter 의 version 은 표시용이며 점을 포함할 수 있어 URL 로 쓰지 않는다.
 */
export const versionSlug = (entry: WorkEntry): string => {
  const last = entry.id.split('/').pop();
  if (!last) throw new Error(`work 항목의 id 가 비어 있습니다: ${entry.id}`);
  return last;
};

/** 한 프로젝트의 개정 이력. revisions 는 최신순으로 정렬되어 있다. */
export interface ProjectHistory {
  project: string;
  /** 최신 개정본. 프로젝트 제목·설명의 대표값으로 쓴다. */
  latest: WorkEntry;
  /** 최신순 정렬된 전체 개정본 */
  revisions: WorkEntry[];
}

/** project 값 기준으로 묶고, 각 묶음을 date 최신순으로 정렬한다. */
export const getProjectHistories = async (): Promise<ProjectHistory[]> => {
  const entries = await getWorkEntries();

  const byProject = new Map<string, WorkEntry[]>();
  for (const entry of entries) {
    const list = byProject.get(entry.data.project) ?? [];
    list.push(entry);
    byProject.set(entry.data.project, list);
  }

  const histories: ProjectHistory[] = [];
  for (const [project, list] of byProject) {
    const revisions = list.sort(byDateDesc);
    const latest = revisions[0];
    if (!latest) continue;
    histories.push({ project, latest, revisions });
  }

  // 프로젝트 목록 자체도 최신 개정일 기준 최신순
  return histories.sort((a, b) => byDateDesc(a.latest, b.latest));
};

/**
 * 목록 화면이 쓰는 표시용 항목.
 *
 * log(시간축)와 work(개정축)는 스키마가 다르지만 목록에서는 같은 줄로 보인다.
 * 뷰가 두 타입을 각각 분기하지 않도록 여기서 한 형태로 정규화한다.
 * revisionCount 가 있으면 개정 눈금을, 없으면 눈금 없이 렌더한다.
 */
export interface TimelineItem {
  /** 렌더 key. 컬렉션이 달라도 충돌하지 않게 접두사를 붙인다. */
  key: string;
  kind: 'log' | 'work';
  title: string;
  description: string;
  date: Date;
  href: string;
  tags: string[];
  /** work 전용 — 개정본 개수. 눈금 개수와 같다. */
  revisionCount?: number;
  /** work 전용 — 최신 개정본의 표시용 버전 문자열 */
  version?: string;
}

const toLogItem = (entry: LogEntry): TimelineItem => ({
  key: `log:${entry.id}`,
  kind: 'log',
  title: entry.data.title,
  description: entry.data.description,
  date: entry.data.date,
  href: `/log/${entry.id}/`,
  tags: entry.data.tags,
});

const toWorkItem = ({ project, latest, revisions }: ProjectHistory): TimelineItem => ({
  key: `work:${project}`,
  kind: 'work',
  title: latest.data.title,
  description: latest.data.description,
  date: latest.data.date,
  href: `/work/${project}/`,
  tags: latest.data.tags,
  revisionCount: revisions.length,
  version: latest.data.version,
});

export const getLogTimeline = async (): Promise<TimelineItem[]> =>
  (await getLogEntries()).map(toLogItem);

export const getWorkTimeline = async (): Promise<TimelineItem[]> =>
  (await getProjectHistories()).map(toWorkItem);

/**
 * 홈에 쓰는 통합 목록. 글과 작업물을 하나의 시간축에 섞는다.
 * work 는 프로젝트 단위로 한 줄이며, 대표 날짜는 최신 개정일이다.
 */
export const getTimeline = async (): Promise<TimelineItem[]> => {
  const [logs, works] = await Promise.all([getLogTimeline(), getWorkTimeline()]);
  return [...logs, ...works].sort((a, b) => {
    const diff = b.date.valueOf() - a.date.valueOf();
    return diff !== 0 ? diff : b.key.localeCompare(a.key);
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
