#!/usr/bin/env node
/**
 * tools/i18n-fill.ts — 빠진 로케일 판본을 원문 사본으로 채운다.
 *
 * 불변식과 그 근거는 tools/i18n-verify.ts 의 머리 주석에 있다. 이 파일은 그 불변식을
 * ★만족시키는 쪽★ 이고, verify 는 ★확인하는 쪽★ 이다. 판독 규칙은 둘 다
 * i18n-content.ts 하나를 쓴다.
 *
 * 만들어지는 파일은 원문과 본문이 같고, 프론트매터에 한 줄이 더 붙는다:
 *
 *     untranslated: en
 *
 * 그 줄이 하는 일 셋:
 *   ① 화면이 "아직 번역되지 않았습니다" 안내와 <article lang="en"> 을 낸다 —
 *      한국어 골격 안에 영어 본문이 들어가는 것을 스크린리더에 정직하게 알린다.
 *   ② 목록에 [EN] 배지가 붙는다.
 *   ③ verify 가 원문과의 동기 상태를 검사할 대상을 안다.
 *
 * 번역을 마치면 그 줄을 지운다. 그것이 완료 신호이며, 지우는 순간 안내도 배지도
 * 사라진다. 지우지 않고 본문만 고치면 verify 가 잡아 준다.
 *
 * 사용법:
 *   pnpm run i18n:fill            빠진 판본만 만든다
 *   pnpm run i18n:fill --force    원문이 바뀐 사본의 본문도 다시 맞춘다
 *   pnpm run i18n:fill --dry      무엇을 할지만 출력하고 쓰지 않는다
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGroups, sourceOf, missingLocales, type Leaf } from './i18n-content.ts';

const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');

/**
 * 원문에서 사본 한 벌을 만든다.
 *
 * untranslated 줄을 프론트매터 ★맨 앞★ 에 넣는 이유: 파일을 열었을 때 제목보다
 * 먼저 보여야 "이건 아직 원문이다" 를 놓치지 않는다.
 * 원문에 그 줄이 있을 수는 없다(sourceOf 가 저작본만 고른다).
 */
const copyFrom = (source: Leaf): string =>
  `---\nuntranslated: ${source.locale}\n${source.frontmatter}\n---\n${source.body}`;

const created: string[] = [];
const resynced: string[] = [];
const drifted: string[] = [];

for (const group of readGroups()) {
  const source = sourceOf(group);
  if (!source) continue; // verify 가 잡는다 — 여기서 조용히 고치지 않는다.

  for (const locale of missingLocales(group)) {
    const path = join(group.dir, `${locale}.md`);
    if (!dry) writeFileSync(path, copyFrom(source), 'utf8');
    created.push(`${path}  ← ${source.locale}.md`);
  }

  for (const leaf of group.leaves) {
    if (leaf.untranslated !== source.locale) continue;
    if (leaf.body === source.body) continue;
    if (force) {
      if (!dry) writeFileSync(leaf.path, copyFrom(source), 'utf8');
      resynced.push(`${leaf.path}  ← ${source.locale}.md`);
    } else {
      drifted.push(leaf.path);
    }
  }
}

const report = (label: string, items: string[]): void => {
  if (items.length === 0) return;
  console.log(`\n${label} (${items.length})`);
  for (const item of items) console.log(`  ${item}`);
};

report(dry ? '만들 파일' : '만든 파일', created);
report(dry ? '다시 맞출 사본' : '다시 맞춘 사본', resynced);

if (drifted.length > 0) {
  console.log(`\n원문과 본문이 다른 사본 (${drifted.length})`);
  for (const path of drifted) console.log(`  ${path}`);
  console.log(
    '\n  번역을 시작한 것이라면 그 파일의 untranslated 줄을 지우세요.\n' +
      '  원문이 바뀐 것이라면 --force 로 다시 맞추세요.',
  );
}

if (created.length === 0 && resynced.length === 0 && drifted.length === 0) {
  console.log('✓ i18n-fill: 채울 것이 없습니다');
}
