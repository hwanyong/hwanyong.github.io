// tools/sitemap-lastmod.ts — sitemap 의 <lastmod> 를 빌드 산출물에서 되읽는다.
//
// ★ 왜 콘텐츠가 아니라 산출물을 읽는가.
//
//   @astrojs/sitemap 의 serialize() 가 받는 것은 URL 하나뿐이다. 그 URL 이 어느 글이고
//   발행일이 언제인지는 통합이 알지 못한다.
//
//   그렇다고 astro.config.ts 가 콘텐츠를 직접 뒤질 수도 없다. 이 저장소의 정체성은 전부
//   ★경로★ 에서 나오고(content.config.ts), 그 경로를 슬러그·개정·로케일로 푸는 것은
//   content.ts 인데, content.ts 는 astro:content 를 import 하므로 설정 파일에서 부를 수
//   없다(의존 방향: i18n.ts → routes.ts → content.ts → 컴포넌트/페이지). 설정 파일이 그
//   해석을 다시 구현하면 라우팅 규칙이 두 벌이 되고, 둘이 어긋나도 아무도 모른다.
//
//   그래서 ★이미 답을 들고 있는 것★ 을 읽는다. BaseHead 는 발행일이 있는 화면마다
//   <meta property="article:published_time"> 를 이미 내고 있고, serialize 는
//   astro:build:done 안에서 돌므로 그 시점에 dist 의 HTML 은 전부 디스크에 있다.
//     → lastmod 와 published_time 이 ★같은 값을 같은 자리에서★ 나오므로 어긋날 수 없다.
//       날짜의 SSOT 는 여전히 프론트매터의 date 하나다.
//
//   배선이 실제로 성립하는지는 tools/verify-site.ts 의 ⑬ 이 확인한다.
import { readFileSync } from 'node:fs';

/**
 * 빌드 산출물 디렉터리.
 *
 * 상수를 export 해 astro.config 의 outDir 로 넘기지 않는다 — 이 저장소에서 dist 는
 * 설정값이 아니라 고정 관습이고(tools/verify-site.ts 도 상수 없이 같은 이름을 쓴다),
 * 여섯 자리 중 한 곳만 상수를 보게 만들면 오히려 출처가 늘어난다.
 *
 * 그래도 조용히 틀리지는 않는다: outDir 을 옮기면 아래 readFileSync 가 첫 URL 에서
 * 곧바로 죽는다. lastmod 만 전부 빠진 sitemap 이 배포되는 일은 일어나지 않는다.
 */
const OUT_DIR = 'dist';

/**
 * 산출물 HTML 의 발행일. 없으면 undefined —
 * 목록·소개·방침처럼 "발행일" 이라는 개념이 없는 화면이다. 없는 날짜를 지어내지 않는다.
 *
 * ★ 속성 순서에 기대지 않는다. 태그를 먼저 자르고 content 를 따로 읽는다
 *   (verify-site.ts 의 hreflangPairs 와 같은 이유 — 순서는 언제든 바뀔 수 있다).
 *
 * ★ 값을 자르지 않고 ISO 그대로 넘긴다. 날짜만 남기고 싶은 유혹이 있지만 두 번 진다:
 *     · 산출물이 달라지지 않는다. @astrojs/sitemap 은 받은 값을 sitemap 패키지의 XML
 *       작성기에 흘리고 그쪽이 어차피 ISO 전체로 정규화한다(패키지에 lastmodDateOnly
 *       옵션이 있지만 통합이 노출하지 않는다). 실측: '2026-06-22' 를 넘겨도
 *       <lastmod>2026-06-22T00:00:00.000Z</lastmod> 가 나온다.
 *     · 정보를 잃는다. 스키마의 date 는 z.coerce.date() 라 시각까지 적을 수 있다.
 *       그날이 오면 자르는 쪽은 실제로 가진 정밀도를 조용히 버린다.
 */
export const publishedTimeOf = (html: string): string | undefined => {
  const tag = html.match(/<meta\b[^>]*\bproperty="article:published_time"[^>]*>/)?.[0];
  const iso = tag?.match(/\bcontent="([^"]+)"/)?.[1];
  if (!iso) return undefined;

  if (Number.isNaN(Date.parse(iso)))
    throw new Error(`article:published_time 이 날짜로 읽히지 않는다: ${iso}`);
  return iso;
};

/**
 * 그 URL 화면의 발행일. @astrojs/sitemap 의 serialize 가 부른다.
 */
export const lastmodOf = (url: string): string | undefined => {
  const { pathname } = new URL(url);

  // build.format: 'directory' 의 계약이다. 깨지면 아래 경로가 통째로 어긋난다.
  if (!pathname.endsWith('/')) throw new Error(`sitemap URL 이 / 로 끝나지 않는다: ${url}`);

  const file = `${OUT_DIR}${pathname}index.html`;
  let html: string;
  try {
    html = readFileSync(file, 'utf8');
  } catch (cause) {
    // sitemap 에 있는데 산출물이 없다 = 둘이 어긋났다. 빈 값으로 넘기지 않는다.
    throw new Error(`sitemap 의 URL 에 해당하는 산출물이 없다: ${url} → ${file}`, { cause });
  }
  return publishedTimeOf(html);
};
