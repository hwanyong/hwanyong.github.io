/**
 * 모노크롬 코드 하이라이팅 테마 (REFLECT / EMIT).
 *
 * 왜 자체 테마인가:
 *   이 사이트의 색 원칙은 "액센트 컬러 0 — 페이지에서 컬러가 허용된 유일한 구역은 광고"다.
 *   github-light 같은 기성 테마는 키워드/문자열/숫자를 서로 다른 색상(hue)으로 칠하므로
 *   본문 옆에 컬러 블록이 생겨 그 원칙이 깨진다.
 *   여기서는 색상(hue)을 팔레트 하나로 고정하고 **명도만으로** 구문을 구분한다.
 *
 * 배경/전경은 global.css 의 --bg-2 / --ink-2 와 같은 값이어야 한다.
 * 한쪽만 고치면 코드블록만 색이 어긋나므로 반드시 함께 바꿀 것.
 *
 * 대비 (배경 대비 실측):
 *   REFLECT  본문 5.9:1 · 키워드 9.0:1 · 주석 3.6:1
 *   EMIT     본문 8.1:1 · 키워드 13.2:1 · 주석 4.9:1
 */

/** 명도 단계만 받아서 TextMate 테마를 조립한다. 두 테마의 구조를 한 곳에 고정한다. */
const monoTheme = ({ name, type, bg, base, dim, mid, strong }) => ({
  name,
  type,
  colors: {
    'editor.background': bg,
    'editor.foreground': base,
  },
  settings: [
      // 기본값. scope 없는 항목이 fallback 이 된다.
      { settings: { background: bg, foreground: base } },

      // 가장 흐림 — 읽지 않아도 되는 것
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: dim, fontStyle: 'italic' },
      },
      {
        scope: [
          'punctuation',
          'punctuation.separator',
          'punctuation.terminator',
          'punctuation.definition.string',
          'meta.brace',
        ],
        settings: { foreground: dim },
      },

      // 중간 — 값
      {
        scope: ['string', 'string.quoted', 'string.template', 'constant.character.escape'],
        settings: { foreground: mid },
      },
      {
        scope: ['variable', 'variable.other', 'variable.parameter', 'meta.object-literal.key'],
        settings: { foreground: base },
      },

      // 가장 진함 — 구조를 만드는 것
      {
        scope: [
          'keyword',
          'keyword.control',
          'keyword.operator.new',
          'storage',
          'storage.type',
          'storage.modifier',
          'entity.name.tag',
        ],
        settings: { foreground: strong, fontStyle: 'bold' },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'entity.name.type',
          'entity.name.class',
          'support.type',
          'support.class',
          'entity.other.attribute-name',
        ],
        settings: { foreground: strong },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'support.constant'],
        settings: { foreground: strong },
      },

      // diff — 색 대신 굵기/기울기로 구분한다
      { scope: ['markup.inserted'], settings: { foreground: strong, fontStyle: 'bold' } },
      { scope: ['markup.deleted'], settings: { foreground: dim, fontStyle: 'italic' } },
      { scope: ['markup.bold'], settings: { foreground: strong, fontStyle: 'bold' } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
      { scope: ['invalid'], settings: { foreground: strong, fontStyle: 'underline' } },
  ],
});

/** 백라이트 꺼짐 — 반사광으로 읽는 면 */
export const reflectCode = monoTheme({
  name: 'reflect-mono',
  type: 'light',
  bg: '#bfb8a0', // --bg-2
  base: '#3d3630', // --ink-2
  dim: '#5f564a',
  mid: '#4f463c',
  strong: '#1a1613', // --ink
});

/** 백라이트 켜짐 — 발광하는 면 */
export const emitCode = monoTheme({
  name: 'emit-mono',
  type: 'dark',
  bg: '#1c2016', // --bg-2
  base: '#a9bd7c', // --ink-2
  dim: '#6f7d58', // --ink-3
  mid: '#8fa269',
  strong: '#dcefa8', // --ink
});
