import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { reflectCode, emitCode } from './src/lib/shiki-themes.mjs';

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

  // Astro 7 기본값은 'jsx' 로, 인라인 요소를 줄바꿈으로 나눠 쓰면 사이 공백이
  // 사라진다(<span>안녕</span>\n<em>세상</em> → "안녕세상").
  // 한국어 본문에서 실제로 물리므로 이전 동작(true)으로 되돌린다.
  compressHTML: true,

  integrations: [sitemap()],

  // Astro 내장 fonts API. 폰트 파일을 빌드 시 다운로드해 자체 호스팅하므로
  // 외부 요청(fonts.googleapis.com)이 없다 — LCP 와 프라이버시 양쪽에 유리.
  // 실제 사용은 BaseLayout 의 <Font cssVariable=… preload /> 가 담당한다.
  fonts: [
    {
      // 제목·본문. NieR 계열 시안의 세리프 축.
      provider: fontProviders.google(),
      name: 'Noto Serif KR',
      cssVariable: '--font-serif',
      weights: [400, 600, 700],
      subsets: ['latin', 'korean'],
      fallbacks: ['Apple SD Gothic Neo', 'serif'],
    },
    {
      // 메타데이터·코드·UI 라벨. "기계가 아는 정보"는 전부 이쪽.
      provider: fontProviders.google(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-mono',
      weights: [400, 500, 600],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
  ],

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
      // 기성 테마(github-light 등)는 컬러 구문 강조라 이 사이트의 원칙
      // "페이지에서 컬러가 허용된 유일한 구역은 광고"와 충돌한다.
      // 같은 색조 안에서 명도만으로 구문을 구분하는 자체 테마를 쓴다.
      themes: {
        light: reflectCode,
        dark: emitCode,
      },
      // 'light' | 'dark' | string | false. 기본값은 'light'.
      // boolean true 는 스키마에 없는 값이라 넣으면 설정 검증에서 실패한다.
      // dual theme 를 CSS 변수로만 제어하려면 false.
      defaultColor: false,
      wrap: true,
    },
  },
});
