// tools/i18n-content.ts — 콘텐츠 트리를 로케일 관점에서 읽는 공용 판독기.
//
// i18n-fill 과 i18n-verify 가 같은 눈으로 트리를 봐야 한다. 판독 규칙이 두 도구에
// 각자 있으면 "채웠는데 검사가 통과 못 하는" 상태가 만들어진다.
//
// ── 트리 규칙 ────────────────────────────────────────────────────────────────
//   src/content/log/<groupKey>/<locale>.md
//   src/content/<lecture|project>/<series>/<versionSlug>/<locale>.md
//
// 로케일을 디렉터리가 아니라 파일 이름으로 두는 이유: 축마다 경로 깊이가 다르다.
// 파일 이름으로 통일하면 로케일은 ★항상★ 마지막 세그먼트라, 축을 구분하는 분기가
// 어디에도 생기지 않는다.
//
// 컬렉션 목록을 여기 적지 않는다 — src/content/ 아래에 있는 것이 곧 컬렉션이다.
// 표를 두면 컬렉션을 추가할 때 두 곳을 고쳐야 한다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE_CODES, DEFAULT_LOCALE, type Locale } from '../src/lib/i18n.ts';

export const CONTENT_ROOT = 'src/content';

const isLocale = (value: string): value is Locale =>
  (LOCALE_CODES as readonly string[]).includes(value);

/** 한 항목의 한 언어 판본. */
export interface Leaf {
  locale: Locale;
  /** 저장소 루트 기준 경로 */
  path: string;
  /** 프론트매터 원문(--- 사이). 개행 포함, 바깥 --- 은 제외. */
  frontmatter: string;
  /** 닫는 --- 다음의 전부. 비교의 기준이 되는 값이다. */
  body: string;
  /**
   * 프론트매터의 untranslated 값.
   * 있으면 "이 파일은 그 로케일 원문의 사본이고 아직 번역되지 않았다" 는 뜻이다.
   */
  untranslated: string | null;
}

/**
 * 한 항목(글 하나)의 전 언어 판본.
 * dir 이 곧 항목의 정체성이다 — log 의 groupKey 도, 개정축의 개정본도 디렉터리다.
 */
export interface Group {
  /** 저장소 루트 기준 디렉터리 경로 */
  dir: string;
  leaves: Leaf[];
  /** 로케일 이름이 아닌 .md 파일. 있으면 규약 위반이다. */
  strays: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const readLeaf = (path: string, locale: Locale): Leaf => {
  const raw = readFileSync(path, 'utf8');
  const match = FRONTMATTER.exec(raw);
  if (!match) throw new Error(`프론트매터가 없습니다: ${path}`);
  const frontmatter = match[1]!;
  const body = raw.slice(match[0].length);
  // 최상위 스칼라 한 줄만 본다. 이 키는 중첩되지 않는다.
  const flag = /^untranslated:\s*(\S+)\s*$/m.exec(frontmatter);
  return { locale, path, frontmatter, body, untranslated: flag ? flag[1]! : null };
};

/**
 * 항목 디렉터리 전수.
 *
 * 판정: .md 를 ★직접★ 담고 있는 디렉터리가 항목이다.
 * 중간 디렉터리(project/analysis-video/)는 하위 디렉터리만 담으므로 걸리지 않는다.
 */
export const readGroups = (root = CONTENT_ROOT): Group[] => {
  const groups: Group[] = [];

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const leaves: Leaf[] = [];
    const strays: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const stem = entry.name.slice(0, -'.md'.length);
      if (isLocale(stem)) leaves.push(readLeaf(join(dir, entry.name), stem));
      else strays.push(join(dir, entry.name));
    }

    if (leaves.length > 0 || strays.length > 0) {
      leaves.sort((a, b) => LOCALE_CODES.indexOf(a.locale) - LOCALE_CODES.indexOf(b.locale));
      groups.push({ dir, leaves, strays });
    }
  };

  walk(root);
  return groups.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
};

/**
 * 이 항목의 원문은 어느 판본인가.
 *
 * 사본(untranslated) 이 아닌 것 중에서 고른다 — 사본의 사본을 만들면 원문이
 * 바뀌었을 때 어느 것을 따라가야 하는지가 사라진다.
 * 기본 로케일이 저작되어 있으면 그것, 아니면 LOCALE_CODES 순서로 첫 번째.
 */
export const sourceOf = (group: Group): Leaf | null => {
  const authored = group.leaves.filter((leaf) => leaf.untranslated === null);
  return authored.find((leaf) => leaf.locale === DEFAULT_LOCALE) ?? authored[0] ?? null;
};

export const missingLocales = (group: Group): Locale[] =>
  LOCALE_CODES.filter((code) => !group.leaves.some((leaf) => leaf.locale === code));

export { LOCALE_CODES, DEFAULT_LOCALE, type Locale };
