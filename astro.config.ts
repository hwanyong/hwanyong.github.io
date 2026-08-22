import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import { DEFAULT_LOCALE, LOCALES, ORIGIN, SITEMAP_LOCALES } from './src/lib/i18n';
import { katexMath } from './tools/katex-math';

export default defineConfig({
  // GitHub Pages user site(hwanyong/hwanyong.github.io) 이므로
  // site 만 지정하고 base 는 절대 지정하지 않는다.
  // base 를 넣으면 모든 내부 링크에 접두사가 붙어 사이트가 통째로 깨지고
  // /ads.txt, /robots.txt 같은 루트 경로도 접근 불가가 된다.
  //
  // site 가 없으면 Astro.site 가 undefined 가 되어
  // new URL(path, Astro.site) 가 TypeError 로 빌드를 죽이고,
  // @astrojs/sitemap 도 동작하지 않는다. 반드시 필요하다.
  site: ORIGIN,

  // 'static' | 'server' — 기본값이 'static' 이라 생략 가능하지만 의도를 남긴다.
  output: 'static',
  // 'error' | 'warn'(기본) | 'ignore'. 두 대상이 같은 경로를 낼 때의 동작이다.
  //
  // 기본값 'warn' 은 경고만 남기고 exit 0 으로 통과시킨다. 이때 진 쪽은 덮어써지는
  // 게 아니라 렌더 자체가 생략된다 — core/build/generate.js:105 의 builtPaths(Set)가
  // pathname 을 중복 제거해 처음 본 경로만 :147 로 보내고 나머지는 :143 의 continue 로
  // 버린다. 파일이 두 번 써지는 일이 없다. 결과는 같다: 한쪽 페이지가 사라진 채
  // 빌드가 성공한다. 게다가 [router] 경고가 "다음 버전에서는 hard error" 라고 이미
  // 예고했으므로, 어차피 깨질 상태를 지금 CI 에서 실패시키는 편이 낫다.
  //
  // ★ build 블록 안이 아니라 최상위다. 소비처가 config.prerenderConflictBehavior 를
  //   읽는다(core/build/generate.js:125). build 스키마는 zod v4 의 맨 z.object 라
  //   모르는 키를 에러 없이 잘라낸다(core/config/schemas/base.js:57 — .strict() 가
  //   붙은 같은 파일 :264 의 env 와 달리 방어가 없다). 실측: build 안에 넣으면 값이
  //   'NONSENSE' 여도 exit 0 이고, 최상위에 두어야 Invalid option 으로 걸린다.
  //   즉 최상위 배치는 동작뿐 아니라 오타 방어를 위해서도 필요하다.
  //
  // ★ 이 파일이 .mjs 가 아니라 .ts 인 이유가 바로 이것이다.
  //   .mjs 였을 때는 이 줄을 build 블록 안으로 잘못 옮겨도 조용히 무시되어
  //   [WARN] 만 나오고 충돌한 페이지 하나가 사라진 채 빌드가 성공했다.
  //   .ts 에서는 같은 실수가 astro check 에서 ts(2353) 로 죽는다
  //   (tsconfig 의 include: ["**/*"] 가 이 파일을 타입체크 대상에 넣는다).
  //   즉 위 주석들은 설명이고, 강제는 타입 시스템이 한다.
  //
  // ★ 이름은 prerender 지만 라우트 충돌 전용이 아니다. 설치본(astro@7.2.4)에서
  //   이 값을 읽는 런타임 분기는 셋이다:
  //     core/build/generate.js:125/135   PrerenderRouteConflict          build 에서만
  //     content/loaders/glob.js:118/123  DuplicateContentEntrySlugError  build·sync·dev
  //     content/loaders/file.js:65/70    같은 에러의 file() 로더 판본. 이 저장소는 미사용
  //   이 저장소의 컬렉션은 전부 glob() 이라 두 번째가 실제로 물린다. 콘텐츠 슬러그가
  //   겹치면 'error' 에서는 astro dev 조차 뜨지 않는데, 터미널에는
  //   "Dev server process exited before becoming ready." 한 줄만 나온다 —
  //   dev 가 이유 없이 안 뜨면 .astro/dev.log 에서 스택을 볼 것.
  //
  // ★ public/ 은 사정권 밖이다. core/build/generate.js:521 의 checkPublicConflict()
  //   는 이 값을 읽지 않고 무조건 [WARN] Skipping 후 그 라우트를 버린다 →
  //   'error' 여도 빌드는 성공하고 public/ 쪽이 이긴다. CI 가 못 막으므로
  //   tools/check-collisions.mjs 가 대신 지킨다.
  //
  // 경고문 읽는 법: [build] 쪽의 `higher priority route ...` 이름은 승자가 아닐 수
  // 있다. 그 값은 matchRoute(core/routing/match.js) 결과라 해당 경로를 하나도
  // 만들지 않는 제3의 라우트가 찍힐 수 있다(실측: 경고는 /[a], 실제 산출은 /[b]).
  // 범인 파일을 짚어주는 것은 [router] 경고 쪽이다
  // (core/routing/create-manifest.js 의 detectRouteCollision — 조건 없이 실행되어
  //  dev·build 양쪽 터미널에 모두 찍힌다).
  prerenderConflictBehavior: 'error',

  // 기본값. /log/foo/ 형태의 디렉터리 URL 이 생성된다.
  //
  // 예전에는 여기에 "giscus term 이 이 값에 의존하므로 절대 바꾸지 말 것" 이라는
  // 경고가 붙어 있었다. 그 제약은 사라졌다 — mapping 이 'specific' 이 되면서
  // 검색어가 URL 이 아니라 항목의 정체성('log:first-post')에서 나온다.
  // ★ URL 이 더 이상 댓글의 정체성을 소유하지 않는다.
  build: {
    format: 'directory',

    // 'always' | 'auto' | 'never'. 기본값 'auto' 는 작은 CSS 를 <style> 로 HTML 에
    // 인라인한다. 인라인 산출물을 금지하므로 'never' 로 못박는다.
    //
    // 아래 assetsInlineLimit 만으로도 'auto' 경로가 false 로 떨어지지만 함께 둔다 —
    // 스타일 외부화는 임계값 설정의 부수효과가 아니라 독립된 의도이고,
    // 나중에 누가 임계값을 올려도 이 규약이 깨지지 않아야 한다.
    inlineStylesheets: 'never',
  },

  vite: {
    build: {
      // Astro 7 에는 build.inlineScripts 같은 옵션이 없다(config.d.ts 확인).
      // 번들된 <script> 청크의 인라인 여부는 Astro 가 Vite 의 assetsInlineLimit 을
      // 그대로 빌려 판정한다:
      //   core/build/plugins/plugin-scripts.js:24  assetInlineLimit = config.build.assetsInlineLimit
      //   core/build/plugins/util.js:15            Buffer.byteLength(code) < Number(limit)
      //
      // 함수 형태는 undefined 를 반환하면 Vite 기본값(4096B)으로 폴백한다.
      // .js 에만 false 를 돌려주면 스크립트 인라인만 정확히 끄고, 이미지·폰트 등
      // 실제 asset 의 base64 인라인 기본 동작은 건드리지 않는다.
      // (금지 대상은 "HTML 안의 인라인"이지 CSS 안의 data: URI 가 아니다.)
      assetsInlineLimit: (filePath) => (filePath.endsWith('.js') ? false : undefined),
    },
  },

  // Astro 7 기본값은 'jsx' 로, 인라인 요소를 줄바꿈으로 나눠 쓰면 사이 공백이
  // 사라진다(<span>안녕</span>\n<em>세상</em> → "안녕세상").
  // 한국어 본문에서 실제로 물리므로 이전 동작(true)으로 되돌린다.
  compressHTML: true,

  integrations: [
    sitemap({
      i18n: { defaultLocale: DEFAULT_LOCALE, locales: SITEMAP_LOCALES },

      // x-default 는 @astrojs/sitemap 이 자동으로 붙이지 않는다. 여기서 주입한다.
      // ★ 캐시된 배열을 변형하지 않고 새 배열을 만든다.
      serialize(item) {
        if (!item.links || item.links.length < 2) return item;
        const fallback = item.links.find((link) => link.lang === LOCALES[DEFAULT_LOCALE].hreflang);
        if (fallback) item.links = [...item.links, { url: fallback.url, lang: 'x-default' }];
        return item;
      },
    }),
  ],

  // ★ Astro 의 i18n 설정 블록은 두지 않는다.
  //   @astrojs/sitemap 의 i18n 은 그 블록 없이 동작하고, astro:i18n 헬퍼·fallbackType·
  //   redirectToDefaultLocale 중 이 사이트가 쓰는 것이 하나도 없다(자동 감지·폴백을
  //   두지 않기로 했으므로). 두면 쓰이지 않는 설정이 남는다.
  //   로케일은 getStaticPaths 의 props 로 명시 전달한다 — URL 파싱보다 결정적이다.
  //   같은 이유로 Astro.currentLocale 도 쓰지 않는다(이 설계에서는 undefined 다).

  // Astro 내장 fonts API(<Font />)는 쓰지 않는다.
  // Font.astro 가 <style set:html> 로 하드코딩되어 @font-face 규칙(한글 서브셋
  // 포함 238KB)이 매 페이지 HTML 에 인라인되고, preload 옵션이 서브셋 121개를
  // 전부 preload 해 6.2MB 를 강제로 받게 한다. 둘 다 config 로 막을 수 없다.
  // → 폰트 파일은 public/fonts/, 선언은 src/styles/fonts.css 로 직접 관리한다.

  markdown: {
    // Astro 7 의 기본 마크다운 처리기는 Sätteri(Rust) 다.
    // 기본 활성: GFM(테이블/취소선/체크박스/각주), smart punctuation,
    //           heading ID 자동 생성, frontmatter 파싱.
    // 기본 비활성: math, wikilinks, directive, headingAttributes,
    //             superscript, subscript, definitionList, rawHtml.
    //   → remark/rehype 플러그인이 필요하면 `pnpm add @astrojs/markdown-remark` 후
    //     markdown.processor 를 unified() 로 되돌려야 한다(더 이상 기본 설치 아님).
    //
    // ★ math 를 켠 이유: 강의 축(수학 30차시)이 전부 LaTeX 다. 끄면 달러 기호가
    //   그대로 찍힌다. 단 `features.math` 는 ★표시일 뿐 렌더가 아니다★ —
    //   실제 조판은 katexMath() 가 빌드 때 MathML 로 한다(`tools/katex-math.ts`).
    //
    // ★ wikilinks 는 켜지 않는다. 소재가 옵시디언 볼트라 켜고 싶은 유혹이 있지만,
    //   볼트의 [[링크]] 대상 상당수가 블로그에 없는 노트(MOC·용어집·암기장)다.
    //   켜면 그것들이 조용히 죽은 링크가 된다. 링크는 옮길 때 손으로 고친다.
    processor: satteri({
      features: { math: true },
      mdastPlugins: [katexMath()],
    }),

    // 'shiki'(기본) | 'prism' | false
    //
    // Shiki 를 쓰지 않는 이유: dual theme(themes:{light,dark})는 구조상 토큰마다
    // style="--shiki-light:…;--shiki-dark:…" 를 인라인 속성으로 박는다.
    // markdown.shikiConfig 는 transformers 옵션을 받지 않으므로
    // (transformers 는 <Code /> 컴포넌트 전용) 이를 끌 방법이 없다.
    // 인라인 산출물을 금지하는 규약상 클래스 기반인 Prism 이 유일한 선택지다.
    //
    // Astro 는 Prism 테마 CSS 를 번들하지 않는다 → src/styles/code.css 에 직접 쓴다.
    // 어차피 "명도만으로 구문을 구분하는" 자체 팔레트가 필요했으므로 손해가 없다.
    //
    // 수식 때문에 excludeLangs 를 넣을 필요는 없다 — katexMath() 가 mdast 에서
    // 먼저 걷어내므로 highlight 는 수식과 마주치지 않는다. 이유는 그 파일 머리에.
    syntaxHighlight: 'prism',
  },
});
