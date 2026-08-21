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

const locs: string[] = [];
const links = new Map<string, Set<string>>(); // loc → Set(hreflang)
for (const block of sitemap.split('<url>').slice(1)) {
  const loc = block.match(/<loc>([^<]+)<\/loc>/)![1]!;
  locs.push(loc);
  links.set(loc, new Set([...block.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]!)));
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

  const head = new Set(
    [...src.matchAll(/rel="alternate" hreflang="([^"]+)"/g)].map((m) => m[1]!),
  );
  const map = links.get(canonical) ?? new Set<string>();
  if ([...head].sort().join() !== [...map].sort().join())
    fail.push(`hreflang 불일치 ${canonical}: head=[${[...head]}] sitemap=[${[...map]}]`);

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

const seen = new Map<string, string>();
for (const file of pages.filter((f) => /\/(lecture|project)\//.test(f))) {
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
//    개정축(lecture·project)은 여기 없다 — 항목이 0개면 화면을 만들지 않기 때문이다(⑨).
for (const code of LOCALE_CODES) {
  const base = code === DEFAULT_LOCALE ? 'dist' : `dist/${code}`;
  for (const section of ['', 'log', 'about', 'privacy']) {
    const path = `${base}${section ? '/' + section : ''}/index.html`;
    if (!pages.includes(path)) fail.push(`필수 화면 없음: ${path}`);
  }
}

// ⑨ 개정축은 "네비에 링크가 있다" 와 "목록 화면이 있다" 가 반드시 함께 참이거나 함께 거짓이다.
//    한쪽만 참이면 네비가 404 를 가리키거나(전자), 네비에서 닿을 수 없는 화면이 sitemap 에
//    남는다(후자). 둘 다 src/lib/content.ts 의 hasSeries 하나에서 나오지만, 그 사실을
//    믿지 않고 산출물에서만 읽어 확인한다 — 소스를 다시 읽으면 같은 버그를 두 번 믿게 된다.
for (const code of LOCALE_CODES) {
  const base = code === DEFAULT_LOCALE ? 'dist' : `dist/${code}`;
  const prefix = code === DEFAULT_LOCALE ? '' : `/${code}`;
  const nav = readFileSync(`${base}/index.html`, 'utf8').match(
    /<nav class="site-nav">(.*?)<\/nav>/s,
  )?.[1];

  // 네비를 못 읽으면 아래 비교가 전부 "링크 없음" 으로 통과해 버린다. 그 침묵을 막는다.
  if (!nav) {
    fail.push(`${base}/index.html 에서 .site-nav 를 찾지 못했다 — 아래 축 검사가 무의미해진다`);
    continue;
  }

  for (const axis of ['lecture', 'project']) {
    const linked = nav.includes(`href="${prefix}/${axis}/"`);
    const path = `${base}/${axis}/index.html`;
    const built = pages.includes(path);
    if (linked === built) continue;
    fail.push(
      linked
        ? `네비에 ${axis} 링크가 있는데 목록 화면이 없다: ${path}`
        : `네비에 ${axis} 링크가 없는데 목록 화면이 있다: ${path}`,
    );
  }
}

// ⑩ 404 는 언어축 밖이다 — canonical 이 없고 noindex 여야 한다.
const notFound = readFileSync(OFF_AXIS, 'utf8');
if (notFound.includes('rel="canonical"'))
  fail.push('404.html 에 canonical 이 있다 — 존재하지 않는 모든 경로에 서빙되므로 항상 거짓이다');
if (!notFound.includes('name="robots" content="noindex"'))
  fail.push('404.html 에 noindex 가 없다');

if (fail.length > 0) {
  console.error('\n✗ verify-site\n');
  for (const problem of fail) console.error(`  ✗ ${problem}`);
  console.error(`\n  ${fail.length}건.\n`);
  process.exit(1);
}

console.log(`✓ verify-site: 통과 (언어축 페이지 ${pages.length} · sitemap ${locs.length})`);
