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
  site: 'https://hwanyong.github.io',

  // 'static' | 'server' — 기본값이 'static' 이라 생략 가능하지만 의도를 남긴다.
  output: 'static',

  // 기본값. /log/foo/ 형태의 디렉터리 URL 이 생성된다.
  // giscus mapping="pathname" 의 term 이 이 값에 의존하므로
  // 사이트를 시작한 뒤에는 절대 바꾸지 말 것(댓글이 통째로 끊긴다).
  build: {
    format: 'directory',
  },

  integrations: [sitemap()],

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
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      // 'light' | 'dark' | string | false. 기본값은 'light'.
      // boolean true 는 스키마에 없는 값이라 넣으면 설정 검증에서 실패한다.
      // dual theme 를 CSS 변수로만 제어하려면 false.
      defaultColor: false,
      wrap: true,
    },
  },
});
