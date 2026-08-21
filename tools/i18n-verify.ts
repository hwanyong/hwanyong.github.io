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

if (problems.length > 0) {
  console.error('\n✗ i18n 완전쌍 불변식 위반\n');
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(`  ${problems.length}건.\n`);
  process.exit(1);
}

console.log('✓ i18n-verify: 모든 항목이 모든 로케일 판본을 갖습니다');
