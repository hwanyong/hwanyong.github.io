#!/usr/bin/env node
/**
 * tools/check-collisions.mjs — 이 맥에서는 절대 재현되지 않는 충돌을 커밋 전에 잡는다.
 *
 * 왜 필요한가:
 *   astro.config.mjs 의 prerenderConflictBehavior:'error' 가 라우트 충돌과 콘텐츠
 *   슬러그 중복은 잡아 준다. 하지만 아래 세 가지는 그 사정권 밖이고, 셋 다
 *   "개발자의 맥에서는 멀쩡한데 ubuntu CI 나 배포본에서만 터지는" 종류다.
 *   그래서 사람 눈이 아니라 스크립트가 지켜야 한다.
 *
 * 이 파일이 도는 자리: package.json 의 ci 스크립트 맨 앞.
 *   astro check·build 보다 먼저 돌려 빨리 실패시킨다.
 *   .github/workflows/deploy.yml 이 build-cmd 로 `pnpm run ci` 를 쓰므로
 *   로컬과 CI 가 같은 검사를 통과한다.
 *
 * 검사 대상은 git 이 추적하는 파일 목록이다. CI 가 체크아웃하는 것이 정확히
 * 그 집합이므로, 작업트리에만 있는 임시 파일에 발목 잡히지 않는다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const PAGES_DIR = 'src/pages';
const PUBLIC_DIR = 'public';

/** 라우트를 만드는 파일 확장자. rss.xml.ts 처럼 이름에 점이 있어도 마지막 것만 벗긴다. */
const ROUTE_EXT = /\.(astro|ts|js|md|mdx|html)$/;

const tracked = () =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);

const problems = [];

const report = (title, why, fix, items) => {
  problems.push({ title, why, fix, items });
};

// ── 1. 유니코드 정규화 ────────────────────────────────────────────────
/*
 * 한글 파일명은 NFC 로 고정해야 한다.
 *
 * macOS 는 NFD("ᄀ"+"ᅡ" 처럼 자모를 분리한 형태)를 즐겨 쓰고, 같은 글자의 NFC/NFD
 * 두 판본을 한 디렉터리에 공존시키지 않는다. 그래서 이 맥에서는 문제가 안 보인다.
 * ext4 인 CI 에서는 둘이 서로 다른 파일이 되어 콘텐츠가 중복되거나 사라진다.
 *
 * 더 조용한 사고: github-slugger 는 정규화를 하지 않으므로 NFC/NFD 가 서로 다른
 * id 가 되고, canonical·sitemap 의 퍼센트 인코딩 문자열이 달라진다. 그러면
 * giscus mapping="pathname" 의 term 이 바뀌어 그 글의 댓글이 통째로 끊긴다.
 *
 * ★ 실측 메모(2026-08-21): 이 검사는 개발자의 맥에서는 발화시킬 수 없다.
 *   core.precomposeunicode 기본값이 true 라 macOS 의 git 이 NFD 를 index 에 넣기
 *   전에 NFC 로 바꿔버린다 — 파일을 add 하든 update-index 로 직접 주입하든 마찬가지다.
 *   그래서 위반을 만들어 잡히는지 확인하는 방식으로는 검증이 불가능했고,
 *   판정식만 합성 입력으로 따로 확인했다(NFD 2건 중 2건 검출).
 *
 *   즉 "여기서 안 걸린다"가 정상이다. 이 검사가 값을 하는 경우는 precompose 를
 *   하지 않는 리눅스에서 커밋이 들어오거나, 그 설정이 꺼진 기기가 섞일 때다.
 *   검사를 지우지 말 것 — 걸리지 않는다는 사실이 필요 없다는 뜻이 아니다.
 */
const notNfc = tracked().filter((file) => file !== file.normalize('NFC'));
if (notNfc.length > 0) {
  report(
    '유니코드 정규화(NFC)를 벗어난 파일명',
    'macOS 에서는 안 보이지만 ext4 인 CI 에서는 다른 파일이 된다. ' +
      'giscus term 이 바뀌어 그 글의 댓글이 끊길 수도 있다.',
    "git mv 로 같은 이름을 NFC 로 다시 붙일 것. 확인: node -e \"console.log(s === s.normalize('NFC'))\"",
    notNfc,
  );
}

// ── 2. 대소문자만 다른 경로 ───────────────────────────────────────────
/*
 * 이 볼륨(APFS 기본 설정)은 대소문자를 접으므로 Foo.md 와 foo.md 가 공존하지
 * 못한다. 하지만 git index 에는 둘 다 들어갈 수 있고(다른 기기에서 만들었거나
 * git mv 로 이름만 바꿨을 때), 그 상태로 ubuntu CI 가 체크아웃하면 두 파일이
 * 나란히 존재한다 → 콘텐츠 컬렉션에서 같은 슬러그로 수렴해 빌드가 죽는다.
 */
const byLower = new Map();
for (const file of tracked()) {
  const key = file.toLowerCase();
  const group = byLower.get(key);
  if (group) group.push(file);
  else byLower.set(key, [file]);
}
const caseClashes = [...byLower.values()].filter((group) => group.length > 1);
if (caseClashes.length > 0) {
  report(
    '대소문자만 다른 경로가 함께 추적되고 있다',
    '이 맥은 대소문자를 접어서 한쪽만 보이지만, ubuntu CI 는 둘 다 체크아웃한다.',
    'git rm --cached 로 한쪽을 index 에서 빼고 이름을 확정할 것.',
    caseClashes.map((group) => group.join('  ↔  ')),
  );
}

// ── 3. public/ 이 라우트를 가리는 경우 ────────────────────────────────
/*
 * prerenderConflictBehavior 가 잡아 주지 않는 유일한 충돌이다.
 *
 * core/build/generate.js:521 의 checkPublicConflict() 는 그 설정을 읽지 않고
 * 무조건 "[WARN] Skipping …" 을 찍은 뒤 해당 라우트를 버린다. 경고는 나오지만
 * 종료 코드가 0 이라 CI 가 통과시킨다 → 페이지 하나가 조용히 사라진 채 배포된다.
 *
 * 그래서 여기서 직접 막는다. public/ 최상위 이름이 라우트 첫 세그먼트와 겹치면 안 된다.
 */
const routeNames = new Set();
for (const entry of readdirSync(PAGES_DIR, { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue;
  if (entry.isDirectory()) {
    routeNames.add(entry.name);
    continue;
  }
  // rss.xml.ts → rss.xml (마지막 확장자만 벗긴다), index.astro → 루트라 이름 없음
  const base = entry.name.replace(ROUTE_EXT, '');
  if (base !== 'index') routeNames.add(base);
}

if (existsSync(PUBLIC_DIR)) {
  const shadowed = readdirSync(PUBLIC_DIR).filter((name) => routeNames.has(name));
  if (shadowed.length > 0) {
    report(
      'public/ 의 파일이 라우트를 가리고 있다',
      'Astro 는 경고만 남기고 그 페이지를 통째로 버린다. 종료 코드가 0 이라 CI 가 못 잡는다.',
      `public/ 쪽 이름을 바꾸거나 옮길 것. 지금 라우트가 쓰는 최상위 이름: ${[...routeNames].sort().join(', ')}`,
      shadowed.map((name) => `public/${name}  ↔  /${name}`),
    );
  }
}

// ── 결과 ──────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log('[check-collisions] 통과 — NFC · 대소문자 · public 가림 이상 없음');
  process.exit(0);
}

for (const { title, why, fix, items } of problems) {
  console.error(`\n✗ ${title}`);
  console.error(`  왜: ${why}`);
  console.error(`  고치기: ${fix}`);
  for (const item of items) console.error(`    - ${item}`);
}
console.error('');
process.exit(1);
