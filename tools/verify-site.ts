#!/usr/bin/env node
/**
 * tools/verify-site.ts — 빌드 산출물이 사양과 맞는지 검사한다.
 *
 * 여기서 잡는 것은 컴파일러도 astro check 도 못 잡는 부류다:
 *   · head 의 hreflang 과 sitemap 의 xhtml:link 가 서로 다른 코드 경로에서 나온다.
 *   · 뷰 어딘가에 남은 `href="/log/"` 같은 순수 문자열은 타입이 없어 잡히지 않는다.
 *   · 같은 본문이 두 URL 로 나가는 것은 라우트 충돌이 아니라 내용 중복이라
 *     prerenderConflictBehavior 의 사정권 밖이다.
 *
 * ★ 개수를 세는 검사(34 등)를 두지 않는다 — 글을 하나 쓸 때마다 CI 가 깨진다.
 *   대신 "구조적으로 성립해야 하는 불변식" 만 본다.
 *
 * 이 도구가 도는 자리: package.json 의 ci 스크립트, astro build 다음.
 */
import { readFileSync, globSync } from 'node:fs';
import { DEFAULT_LOCALE, LOCALE_CODES, LOCALES } from '../src/lib/i18n.ts';
import { NAV_SECTIONS } from '../src/lib/routes.ts';
import { SUBJECT_SLUGS } from '../src/lib/subjects.ts';

/**
 * Astro 가 만들지 않은 dist 안의 HTML. public/ 에서 그대로 복사된 것이라
 * <html lang>·canonical·hreflang 이 없는 것이 정상이다.
 *
 * ★ google…html 을 이 목록에서 지우면 CI 가 깨지고, 파일 자체를 지우면
 *   Search Console 소유권이 풀린다. 둘 다 하지 말 것.
 */
const NOT_A_PAGE = new Set(['dist/google1af69c42d9e600f9.html']);

/**
 * 404.html 은 페이지이되 언어축 밖이다.
 * sitemap 에 실리지 않고(@astrojs/sitemap 이 404·500 을 제외한다) canonical 도 없다.
 */
const OFF_AXIS = 'dist/404.html';

/** 로케일 접두사가 붙으면 ★안 되는★ 경로. public/ 자산과 루트 엔드포인트다. */
const ASSET =
  /^\/(favicon\.ico|icon\.png|apple-touch-icon\.png|og-default\.png|theme-init\.js|rss\.xml|robots\.txt|sitemap|images\/|resources\/|fonts\/|_astro\/|giscus\/)/;

const fail: string[] = [];

// sitemap-0.xml 을 하드코딩하지 않는다 — URL 이 45,000 을 넘으면 -1.xml 이 생겨
// 조용히 반쪽만 검사하게 된다.
const index = readFileSync('dist/sitemap-index.xml', 'utf8');
const parts = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (match) => 'dist/' + match[1]!.split('/').pop()!,
);
const sitemap = parts.map((part) => readFileSync(part, 'utf8')).join('');

/**
 * <link …> · <xhtml:link …> 한 태그에서 hreflang 과 href 를 함께 뽑아 `코드 주소` 로 만든다.
 *
 * ★ 코드만 비교하면 안 된다. 쪽이 나뉜 목록에서 head 의 hreflang 은 routes.ts 의
 *   pageHref 가 만들고 sitemap 의 xhtml:link 는 실제로 생성된 URL 에서 나온다 —
 *   두 출처가 다르므로, 한쪽이 /log/2/ 를 가리키고 다른 쪽이 /log/ 를 가리켜도
 *   코드 집합은 똑같이 [en, ko, x-default] 다. 값까지 비교해야 그것이 잡힌다.
 *
 * 속성 순서에 기대지 않는다 — 태그를 먼저 자르고 두 속성을 따로 읽는다.
 */
const hreflangPairs = (source: string, tag: RegExp): Set<string> => {
  const pairs = new Set<string>();
  for (const match of source.matchAll(tag)) {
    const element = match[0];
    const lang = element.match(/hreflang="([^"]+)"/)?.[1];
    const href = element.match(/href="([^"]+)"/)?.[1];
    if (lang && href) pairs.add(`${lang} ${href}`);
  }
  return pairs;
};

const locs: string[] = [];
const links = new Map<string, Set<string>>(); // loc → Set(`hreflang href`)
for (const block of sitemap.split('<url>').slice(1)) {
  const loc = block.match(/<loc>([^<]+)<\/loc>/)![1]!;
  locs.push(loc);
  links.set(loc, hreflangPairs(block, /<xhtml:link\b[^>]*\/?>/g));
}

const all = globSync('dist/**/*.html').filter((file) => !NOT_A_PAGE.has(file));
const pages = all.filter((file) => file !== OFF_AXIS);

// ① sitemap ↔ 언어축 위의 HTML 이 1:1
if (pages.length !== locs.length)
  fail.push(`sitemap ${locs.length} 개 vs 언어축 HTML ${pages.length} 개`);

// ② head hreflang ↔ sitemap xhtml:link 양방향 일치
// ③ <html lang> ↔ og:locale ↔ URL 접두사
// ④ 접두사 로케일 산출물의 내부 링크가 자기 트리를 벗어나지 않는가
for (const file of pages) {
  const src = readFileSync(file, 'utf8');

  const canonical = src.match(/rel="canonical" href="([^"]+)"/)?.[1];
  if (!canonical) {
    fail.push(`canonical 없음: ${file}`);
    continue;
  }

  // 피드 링크도 rel="alternate" 지만 hreflang 이 없어 hreflangPairs 가 걸러낸다.
  const head = hreflangPairs(src, /<link\b[^>]*rel="alternate"[^>]*\/?>/g);
  const map = links.get(canonical) ?? new Set<string>();
  const missing = [...head].filter((pair) => !map.has(pair));
  const extra = [...map].filter((pair) => !head.has(pair));
  if (missing.length > 0 || extra.length > 0)
    fail.push(
      `hreflang 불일치 ${canonical}\n` +
        `      head 에만: ${missing.join(' | ') || '없음'}\n` +
        `      sitemap 에만: ${extra.join(' | ') || '없음'}`,
    );

  const lang = src.match(/<html lang="([^"]+)"/)?.[1];
  const og = src.match(/og:locale" content="([^"]+)"/)?.[1];
  const locale = LOCALE_CODES.find((code) => LOCALES[code].htmlLang === lang);
  if (!locale) {
    fail.push(`알 수 없는 lang "${lang}": ${file}`);
    continue;
  }

  if (og !== LOCALES[locale].ogLocale)
    fail.push(`og:locale 불일치 ${file}: lang=${lang} og=${og}`);

  const prefixed = file.startsWith(`dist/${locale}/`);
  if (prefixed !== (locale !== DEFAULT_LOCALE)) fail.push(`경로 ↔ lang 불일치: ${file}`);

  if (locale !== DEFAULT_LOCALE) {
    /*
      언어 스위처는 검사 대상에서 뺀다.

      다른 로케일을 가리키는 것이 그 컴포넌트의 ★존재 이유★ 다 — 여기서 걸리면
      "스위처가 작동한다" 를 위반으로 읽는 셈이 된다. 대신 예외를 그 한 요소로만
      좁혀 두어, 스위처 밖 어디에서든 로케일을 벗어나는 링크는 그대로 걸린다.
      (head 의 hreflang 은 절대 URL 이라 이 정규식에 애초에 걸리지 않는다.)
    */
    const body = src.replace(/<nav class="lang-switch"[\s\S]*?<\/nav>/, '');
    for (const match of body.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const href = match[1]!;
      if (!ASSET.test(href) && !href.startsWith(`/${locale}/`))
        fail.push(`언어 누수 ${file}: ${href}`);
    }
  }
}

/*
 ⑤ 개정축 불변식 — 같은 본문이 ★같은 로케일 안에서★ 두 URL 로 나가면 안 된다.

 ★ 로케일마다 따로 센다. 아직 번역되지 않은 판본은 원문의 사본이라 제목도 날짜도
   원문과 같다 — 로케일을 섞어 세면 완전쌍 불변식이 만든 정상 상태가 전부 위반으로
   잡힌다. 여기서 막으려는 것은 "계열 루트와 버전 페이지가 같은 개정본을 두 번 낸다"
   이고, 그것은 언제나 한 로케일 안에서 일어난다.
*/
const fingerprint = (file: string): string => {
  const src = readFileSync(file, 'utf8');
  const h1 = src.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] ?? '';
  const time = src.match(/datetime="([^"]+)"/)?.[1] ?? '';
  const lang = src.match(/<html lang="([^"]+)"/)?.[1] ?? '';
  return `${lang}|${h1}|${time}`;
};

/*
  대상은 ★개정본 상세 화면★ 뿐이다.

  경로로 고르면 안 된다 — /lecture/ · /lecture/math/ 같은 목록 화면도 같은 경로 아래
  있고, 그 화면들은 h1 이 없어 지문이 전부 `lang||` 로 같아진다(실측: 이 검사가
  강의 목록 둘을 중복으로 신고했다). 개정 이력 패널은 RevisionPage 만 그리므로
  그 존재가 "이 화면이 개정본이다" 의 정확한 표시다.
*/
const isRevisionPage = (file: string): boolean =>
  readFileSync(file, 'utf8').includes('<nav id="revisions"');

const seen = new Map<string, string>();
for (const file of pages.filter(isRevisionPage)) {
  const print = fingerprint(file);
  const previous = seen.get(print);
  if (previous) fail.push(`같은 본문이 두 URL 로: ${previous} / ${file}`);
  else seen.set(print, file);
}

// ⑥ 규약 — body 안에 <script> 0개 (404 포함해서 전부)
for (const file of all) {
  const body = readFileSync(file, 'utf8').split('<body')[1] ?? '';
  const count = [...body.matchAll(/<script/g)].length;
  if (count > 0) fail.push(`body 스크립트 ${count}개: ${file}`);
}

// ⑦ 로케일마다 피드가 하나씩, 비어 있지 않고, self 링크와 urn guid 를 갖는다
for (const code of LOCALE_CODES) {
  const path = code === DEFAULT_LOCALE ? 'dist/rss.xml' : `dist/${code}/rss.xml`;
  const xml = readFileSync(path, 'utf8');
  if ([...xml.matchAll(/<item>/g)].length < 1) fail.push(`${path} 항목 0개`);
  if (!xml.includes('rel="self"')) fail.push(`${path} atom:link rel=self 없음`);
  if (!xml.includes('isPermaLink="false"')) fail.push(`${path} guid 가 URL 이다`);
}

// ⑧ 콘텐츠와 무관하게 모든 로케일에 반드시 있어야 하는 화면.
//    ★ 개정축(lecture·project)도 포함된다 — 항목이 0개여도 화면을 만든다.
//      목록이 "아직 없습니다" 를 말하는 것과 축이 사라지는 것은 전혀 다른 일이다.
//    목록은 NAV_SECTIONS 에서 파생한다. 여기 이름을 다시 적으면 축을 늘렸을 때
//    검사만 예전 목록에 머무른다.
for (const code of LOCALE_CODES) {
  const base = code === DEFAULT_LOCALE ? 'dist' : `dist/${code}`;
  for (const section of ['', ...NAV_SECTIONS, 'privacy']) {
    const path = `${base}${section ? '/' + section : ''}/index.html`;
    if (!pages.includes(path)) fail.push(`필수 화면 없음: ${path}`);
  }
}

// ⑨ 네비는 NAV_SECTIONS 를 순서 그대로 낸다 — 빠지는 축도 더해지는 축도 없다.
//    예전에는 항목이 0개인 개정축을 네비에서 빼고 화면도 만들지 않았다. 그 규칙이
//    사라졌으므로 검사도 "둘이 함께 참/거짓" 이 아니라 "항상 전부" 가 된다.
//    ⑧ 이 그 링크의 목적지가 실제로 있는지를 따로 본다.
for (const code of LOCALE_CODES) {
  const base = code === DEFAULT_LOCALE ? 'dist' : `dist/${code}`;
  const prefix = code === DEFAULT_LOCALE ? '' : `/${code}`;
  const nav = readFileSync(`${base}/index.html`, 'utf8').match(
    /<nav class="site-nav">(.*?)<\/nav>/s,
  )?.[1];

  // 네비를 못 읽으면 아래 비교가 "링크 없음" 으로 조용히 통과해 버린다. 그 침묵을 막는다.
  if (!nav) {
    fail.push(`${base}/index.html 에서 .site-nav 를 찾지 못했다 — 아래 축 검사가 무의미해진다`);
    continue;
  }

  const found = [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);
  const want = NAV_SECTIONS.map((section) => `${prefix}/${section}/`);
  if (found.join(' ') !== want.join(' '))
    fail.push(`네비 링크 불일치 ${base}: [${found.join(' ')}] ≠ [${want.join(' ')}]`);
}

// ⑩ 404 는 언어축 밖이다 — canonical 이 없고 noindex 여야 한다.
const notFound = readFileSync(OFF_AXIS, 'utf8');
if (notFound.includes('rel="canonical"'))
  fail.push('404.html 에 canonical 이 있다 — 존재하지 않는 모든 경로에 서빙되므로 항상 거짓이다');
if (!notFound.includes('name="robots" content="noindex"'))
  fail.push('404.html 에 noindex 가 없다');

/*
 ⑪ 내부 링크는 정본 주소여야 한다.

 build.format 이 'directory' 이므로 페이지의 정본 주소는 끝 슬래시가 붙은 쪽이다.
 붙지 않은 주소를 써도 GitHub Pages 가 리다이렉트로 살려 주기 때문에 ★화면에서는
 아무 문제가 없어 보인다★ — 대신 링크마다 왕복이 한 번 늘고, 사이트 안에 두 가지
 주소 표기가 섞인다. 사람 눈으로는 남는 종류라 검사로 막는다.

 실제로 걸렸다: Astro 의 paginate() 가 만드는 page.url.next 는 /log/2 였다
 (config.trailingSlash 기본값 'ignore' 에서는 슬래시를 붙이지 않는다).
 그래서 쪽 이동 주소는 routes.ts 의 pageHref 에서 받는다.
*/
/*
  면제 대상은 ASSET 이 아니라 "파일 이름으로 끝나는 경로" 다.
  ASSET 은 ★로케일 접두사가 붙으면 안 되는 경로★ 의 목록이라 /ko/rss.xml 을 담지 않는다.
  여기서 묻는 것은 "페이지인가 엔드포인트인가" 이고, 그 판정은 마지막 세그먼트에
  확장자가 있는지다.
*/
const ENDPOINT = /\/[^/]*\.[^/]*$/;

for (const file of all) {
  const src = readFileSync(file, 'utf8');
  for (const match of src.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
    const href = match[1]!;
    if (href.endsWith('/') || ENDPOINT.test(href)) continue;
    fail.push(`끝 슬래시 없는 내부 링크 ${file}: ${href}`);
  }
}

/*
 ⑫ 과목 화면은 비어 있을 수 없다.

 코스가 0개인 과목은 ★URL 을 만들지 않는다★(강의 전체 화면에는 섹션 줄로 남는다).
 만들면 sitemap 에 내용 없는 화면이 과목 수 × 로케일 수만큼 늘고, 검색엔진에는
 소프트 404 로 읽힌다. 그 판정은 페이지의 getStaticPaths 에 있고, 여기서는
 ★산출물에서만★ 확인한다 — 소스를 다시 읽으면 같은 버그를 두 번 믿게 된다.

 코스 화면(차시 갤러리)은 이 검사의 대상이 아니다. 표지만 먼저 쓰고 차시를 나중에
 올리는 것은 정상이고, 그 화면에는 표지 본문이라는 실체가 있다.
*/
const PREFIXES = LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE);
const SUBJECT_PAGE = new RegExp(
  `^dist(?:/(?:${PREFIXES.join('|')}))?/lecture/(?:${SUBJECT_SLUGS.join('|')})/(?:\\d+/)?index\\.html$`,
);

for (const file of pages) {
  if (!SUBJECT_PAGE.test(file)) continue;
  if (!readFileSync(file, 'utf8').includes('class="card"'))
    fail.push(
      `카드가 하나도 없는 과목 화면: ${file}\n` +
        `      코스가 0개인 과목은 URL 을 갖지 않아야 한다(getStaticPaths 의 courses.length 판정).`,
    );
}

if (fail.length > 0) {
  console.error('\n✗ verify-site\n');
  for (const problem of fail) console.error(`  ✗ ${problem}`);
  console.error(`\n  ${fail.length}건.\n`);
  process.exit(1);
}

console.log(`✓ verify-site: 통과 (언어축 페이지 ${pages.length} · sitemap ${locs.length})`);
