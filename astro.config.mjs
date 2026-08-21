import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // GitHub Pages user site(hwanyong/hwanyong.github.io) 이므로
  // site 만 지정하고 base 는 절대 지정하지 않는다.
  // base 를 넣으면 모든 내부 링크에 접두사가 붙어 사이트가 통째로 깨지고
  // /ads.txt, /robots.txt 같은 루트 경로도 접근 불가가 된다.
  //
  // site 가 없으면 Astro.site 가 undefined 가 되어
  // new URL(path, Astro.site) 가 TypeError 로 빌드를 죽이고,
  // @astrojs/sitemap 도 동작하지 않는다. 반드시 필요하다.
  site: 'https://blog.hwanyong.com',

  // 'static' | 'server' — 기본값이 'static' 이라 생략 가능하지만 의도를 남긴다.
  output: 'static',
  // 'error' | 'warn'(기본) | 'ignore'. 두 라우트가 같은 정적 경로를 내면 빌드를 죽인다.
  //
  // 기본값 'warn' 은 경고 한 줄만 남기고 "마지막에 그려진 쪽"을 배포한다 —
  // 즉 한쪽 페이지가 조용히 사라진 채 빌드가 성공한다. 실측으로 확인했다:
  //   최상위 error → [PrerenderRouteConflict] 로 빌드 실패, 파일 생성 안 됨
  //   build 안 error → [WARN] 만 나오고 뒤에 그려진 쪽이 dist 에 남음
  //
  // ★ build 블록 안이 아니라 최상위다. 소비처가 config.prerenderConflictBehavior 를 읽는다
  //   (core/build/generate.js:125). build 안에 넣으면 조용히 무시된다.
  prerenderConflictBehavior: 'error',

  // 기본값. /log/foo/ 형태의 디렉터리 URL 이 생성된다.
  // giscus mapping="pathname" 의 term 이 이 값에 의존하므로
  // 사이트를 시작한 뒤에는 절대 바꾸지 말 것(댓글이 통째로 끊긴다).
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

  integrations: [sitemap()],

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
    //   → 이것들을 쓰려면 `pnpm add @astrojs/markdown-satteri` 후
    //     markdown.processor 를 satteri({ features: { math: true } }) 로 명시해야 한다.
    //   → remark/rehype 플러그인이 필요하면 `pnpm add @astrojs/markdown-remark` 후
    //     markdown.processor 를 unified() 로 되돌려야 한다(더 이상 기본 설치 아님).
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
    syntaxHighlight: 'prism',
  },
});
