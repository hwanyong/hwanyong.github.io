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
function isVisible(entry: { data: { draft: boolean } }): boolean {
  return import.meta.env.PROD ? entry.data.draft !== true : true;
}

/**
 * date 최신순 정렬.
 * getCollection() 의 반환 순서는 공식 문서가 "non-deterministic and
 * platform-dependent" 라고 명시한 값이다. 정렬을 빠뜨리면 로컬과 CI 에서
 * 글 순서가 달라진다.
 * 날짜가 같을 때를 대비해 id 역순 2차 정렬로 결정성을 보장한다.
 */
function byDateDesc<T extends { id: string; data: { date: Date } }>(a: T, b: T): number {
  const diff = b.data.date.valueOf() - a.data.date.valueOf();
  if (diff !== 0) return diff;
  return b.id.localeCompare(a.id);
}

/** 공개 대상 log 항목을 최신순으로 반환한다. */
export async function getLogEntries(): Promise<LogEntry[]> {
  const entries = await getCollection('log', isVisible);
  return entries.sort(byDateDesc);
}

/** 공개 대상 work 항목(개정본 단위)을 최신순으로 반환한다. */
export async function getWorkEntries(): Promise<WorkEntry[]> {
  const entries = await getCollection('work', isVisible);
  return entries.sort(byDateDesc);
}

/**
 * 항목 id 의 마지막 세그먼트 = 버전 URL 세그먼트.
 * id 는 glob() 로더가 파일 경로를 슬러그화해 만든 값이라 이미 URL 안전하다.
 * frontmatter 의 version 은 표시용이며 점을 포함할 수 있어 URL 로 쓰지 않는다.
 */
export function versionSlug(entry: WorkEntry): string {
  const last = entry.id.split('/').pop();
  if (!last) throw new Error(`work 항목의 id 가 비어 있습니다: ${entry.id}`);
  return last;
}

/** 한 프로젝트의 개정 이력. revisions 는 최신순으로 정렬되어 있다. */
export interface ProjectHistory {
  project: string;
  /** 최신 개정본. 프로젝트 제목·설명의 대표값으로 쓴다. */
  latest: WorkEntry;
  /** 최신순 정렬된 전체 개정본 */
  revisions: WorkEntry[];
}

/** project 값 기준으로 묶고, 각 묶음을 date 최신순으로 정렬한다. */
export async function getProjectHistories(): Promise<ProjectHistory[]> {
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
}
