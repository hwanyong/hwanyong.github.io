#!/usr/bin/env node
/**
 * tools/i18n-verify.ts — 완전쌍 불변식을 지킨다.
 *
 * ── 불변식 ───────────────────────────────────────────────────────────────────
 *   모든 항목은 모든 로케일의 판본을 갖는다.
 *
 * 왜 이 불변식인가:
 *   이 불변식이 없으면 "그 언어의 본문이 있는 것만 싣는" 배타적 목록에서
 *   /ko/project/ 가 빈 화면이 된다. 있으면 배타적 목록의 단순한 코드를 그대로 쓰면서
 *   화면에는 빈 목록이 하나도 없다 — 두 정책의 좋은 쪽만 남는다.
 *
 *   부수 효과가 둘 더 있다:
 *     · hreflang 쌍이 전 URL 에서 성립한다(짝 없는 <loc> 가 0개).
 *     · 로케일별 RSS 가 절대 비지 않는다.
 *
 * 아직 번역하지 않은 판본은 원문의 사본이고, 프론트매터의 untranslated 가
 * 그 사실을 밝힌다. 화면은 그 값을 읽어 안내와 <article lang> 을 낸다.
 * 번역을 마치면 그 줄을 지우는 것이 완료 신호다.
 *
 * ── 이 도구가 도는 자리 ──────────────────────────────────────────────────────
 *   package.json 의 ci 스크립트. astro build 보다 먼저 돌려 빨리 실패시킨다.
 *   .github/workflows/deploy.yml 이 build-cmd 로 `pnpm run ci` 를 쓰므로
 *   로컬과 CI 가 같은 검사를 통과한다.
 *
 * ★ 채우기는 CI 가 하지 않는다. CI 가 사본을 만들어 커밋하면 main 에 봇 푸시가
 *   생기고, 그 푸시가 다시 빌드를 띄우는 고리가 된다. 저장소 내용은 사람이 저작한
 *   상태로 두고, CI 는 "빠졌다 + 이 명령을 돌려라" 까지만 말한다.
 *   강제력은 같다 — 어느 쪽이든 불변식이 깨진 채로는 배포가 안 된다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGroups, sourceOf, missingLocales, LOCALE_CODES } from './i18n-content.ts';

const FILL = 'pnpm run i18n:fill';
const problems: string[] = [];

for (const group of readGroups()) {
  for (const stray of group.strays) {
    problems.push(
      `${stray}\n` +
        `    파일 이름이 로케일이어야 합니다(${LOCALE_CODES.map((c) => `${c}.md`).join(' | ')}).\n` +
        `    로케일은 디렉터리가 아니라 파일 이름이다 — 축마다 경로 깊이가 달라도\n` +
        `    로케일이 항상 마지막 세그먼트이게 하려는 규칙이다.`,
    );
  }

  // 로케일 판본이 하나도 없으면 원인은 위의 stray 하나다.
  // 여기서 "저작본이 없다" 를 덧붙이면 원인 하나에 메시지가 둘이 되어,
  // 무엇을 고쳐야 하는지가 흐려진다.
  if (group.leaves.length === 0) continue;

  const source = sourceOf(group);
  if (!source) {
    problems.push(
      `${group.dir}\n` +
        `    저작된 판본이 하나도 없습니다 — 전부 untranslated 사본입니다.\n` +
        `    사본의 사본은 원문이 바뀌었을 때 무엇을 따라가야 할지가 사라집니다.\n` +
        `    최소 한 언어의 untranslated 줄을 지우고 그 판본을 원문으로 삼으세요.`,
    );
    continue;
  }

  const missing = missingLocales(group);
  if (missing.length > 0) {
    problems.push(
      `${group.dir}\n` +
        `    빠진 판본: ${missing.map((c) => `${c}.md`).join(', ')}\n` +
        `    고치는 법: ${FILL}   (원문 ${source.locale}.md 의 사본을 만들어 채웁니다)`,
    );
  }

  for (const leaf of group.leaves) {
    const from = leaf.untranslated;
    if (from === null) continue;

    if (from === leaf.locale) {
      problems.push(`${leaf.path}\n    untranslated 가 자기 자신(${from})을 가리킵니다.`);
      continue;
    }
    const origin = group.leaves.find((other) => other.locale === from);
    if (!origin) {
      problems.push(
        `${leaf.path}\n    untranslated: ${from} 이지만 ${from}.md 가 없습니다.`,
      );
      continue;
    }
    if (origin.untranslated !== null) {
      problems.push(
        `${leaf.path}\n    원문으로 가리킨 ${from}.md 도 사본입니다(사본의 사본).`,
      );
      continue;
    }
    if (leaf.body !== origin.body) {
      problems.push(
        `${leaf.path}\n` +
          `    사본이라고 표시되어 있는데 본문이 원문(${from}.md)과 다릅니다. 둘 중 하나입니다:\n` +
          `      · 번역을 시작했다  → 프론트매터의 "untranslated: ${from}" 줄을 지우세요.\n` +
          `      · 원문이 바뀌었다  → ${FILL} --force  로 사본을 다시 맞추세요.`,
      );
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   화면 문구가 UI 사전 밖에 있지 않은가.

   src/lib/ui.ts 는 Record<Locale, …> 라 "번역을 빠뜨리는" 실수는 타입이 막는다.
   막지 못하는 것은 ★사전을 아예 거치지 않고 한 언어를 직접 박는★ 실수다.

   실제로 그렇게 샜다: src/styles/global.css 의 --scan-label 에 '세로줄' 이 박혀 있어
   영어 화면 하단 칩이 한국어로 나갔다. CSS 는 타입 시스템이 닿지 않고, content: 로
   들어가는 값이라 산출 HTML 에도 나타나지 않는다 — 소스에서 볼 수밖에 없다.

   src/lib 은 검사하지 않는다. 사전 자신(ui.ts)과 양어 데이터(privacy.ts·profile.ts)가
   거기 있고, 그것들은 한국어를 갖고 있는 것이 정상이다.
   ───────────────────────────────────────────────────────────────────────── */

/** 한글·가나·한자. 라틴만으로 된 화면 골격에 이것이 있으면 사전을 거치지 않은 것이다. */
const NON_LATIN = /[\u3131-\uD79D\u3040-\u30FF\u4E00-\u9FFF]/;

/**
 * 개발자 진단은 검사 대상이 아니다.
 * console 로 나가는 글은 화면에 렌더되지 않고 읽는 사람이 정해져 있다.
 */
const isDiagnostic = (line: string): boolean => /\bconsole\.\w+\(/.test(line);

/** 문구가 아니라 설명인 부분. 주석은 무엇으로 쓰든 자유다. */
const stripComments = (source: string): string =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<![:'"`])\/\/.*$/gm, '');

const walkFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, out);
    else if (/\.(astro|css|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
};

for (const dir of ['src/components', 'src/layouts', 'src/pages', 'src/styles', 'src/scripts']) {
  for (const path of walkFiles(dir)) {
    const lines = stripComments(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!NON_LATIN.test(line) || isDiagnostic(line)) return;
      problems.push(
        `${path}:${i + 1}\n` +
          `    화면 문구를 여기 직접 적었습니다: ${line.trim().slice(0, 70)}\n` +
          `    src/lib/ui.ts 의 UI 사전에 넣고 UI[locale] 로 읽으세요.\n` +
          `    CSS 라면 그 자리가 계기판 어휘인지 먼저 보세요 — REFLECT/EMIT 처럼\n` +
          `    로케일 불변으로 두는 편이 맞을 수 있습니다.`,
      );
    });
  }
}

if (problems.length > 0) {
  console.error('\n✗ i18n 규약 위반\n');
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(`  ${problems.length}건.\n`);
  process.exit(1);
}

console.log(
  '✓ i18n-verify: 모든 항목이 모든 로케일 판본을 갖고, 화면 문구가 전부 UI 사전에서 나옵니다',
);
