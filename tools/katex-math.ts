// tools/katex-math.ts — 수식을 빌드 때 렌더하는 Sätteri mdast 플러그인.
//
// Sätteri 의 `features.math` 는 ★렌더가 아니라 표시★ 다. 켜기만 하면 수식이
//   인라인  <code class="language-math math-inline">\|v\|</code>
//   블록    <pre><code class="language-math math-display">…</code></pre>
// 로 나올 뿐, 화면에는 LaTeX 원문이 고정폭으로 찍힌다. 이 플러그인이 그 자리를
// 실제 수식으로 바꾼다. 즉 `math: true` 는 필요조건이고 충분조건이 아니다.
//
// ── ★ hast 가 아니라 mdast 인 이유 (실측으로 뒤집은 설계) ────────────────────
// 처음엔 hast 플러그인으로 `code.language-math` 를 찾아 갈아 끼웠다. 인라인은
// 됐지만 ★블록만 조용히 실패★ 했다. 원인: 사용자 hast 플러그인은 highlight
// 플러그인 ★뒤★ 에 등록되는데(satteri-processor.js), 블록 수식도 hast 에서는
// <pre><code> 라 highlight 가 먼저 집어 간다. 그때 math-display 표시가 지워진다.
// `syntaxHighlight.excludeLangs: ['math']` 로 피하려 했으나 이것도 안 먹는다 —
// highlight 는 className 이 아니라 `code.data.lang` 을 보는데 수식 블록에는 그
// 값이 없어 'plaintext' 로 잡히기 때문이다. 즉 hast 단계에서는 이미 늦다.
//
// mdast 는 그 위다. 사용자 mdast 플러그인이 먼저 돌고, 여기서 math 노드를
// 걷어내면 <pre> 자체가 생기지 않아 highlight 와 마주칠 일이 없다.
//
// ── ★ 출력이 MathML 인 이유 ────────────────────────────────────────────────
// KaTeX 의 기본 출력(htmlAndMathml)은 katex.css 와 전용 폰트 20여 개(≈300KB)를
// 요구한다. 이 저장소는 폰트를 서브셋해 영어 페이지 총량을 100.2KB 로 깎아 둔
// 곳이라(`docs/fonts.md`) 그 파이프라인에 300KB 를 얹을 수 없다.
// MathML 은 CSS 0 · 폰트 0 · 런타임 JS 0 이고 브라우저가 직접 그린다.
// 대가는 조판 품질이 브라우저마다 조금씩 다르다는 것 하나다.
//
// ── ★ throwOnError 를 켜 두는 이유 ────────────────────────────────────────
// 끄면 KaTeX 가 깨진 수식을 ★빨간 글씨로 렌더해 그대로 발행★ 한다. 오타 하나가
// exit 0 으로 통과해 독자에게 도달하는 형태다. 여기서는 빌드를 죽이고 어느
// 수식인지 그 자리에서 알려 준다.
import katex from 'katex';
import type { SatteriProcessorOptions } from '@astrojs/markdown-satteri';

type MdastPlugin = NonNullable<SatteriProcessorOptions['mdastPlugins']>[number];

/**
 * mdast 에서 원시 HTML 을 끼우는 노드는 `raw` 가 아니라 `html` 이다.
 * `raw` 로 두면 꺾쇠가 이스케이프되어 태그가 글자로 찍힌다(실측).
 */
const html = (value: string) => ({ type: 'html' as const, value });

const render = (tex: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(tex, {
      // 이 한 줄이 폰트 20여 개와 katex.css 를 없앤다. 파일 머리의 설명 참조.
      output: 'mathml',
      displayMode,
      strict: 'ignore',
      throwOnError: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `수식을 렌더하지 못했습니다.\n` +
        `  ${displayMode ? '블록' : '인라인'}: ${tex}\n` +
        `  KaTeX: ${reason}`,
    );
  }
};

/** `$…$` 와 `$$…$$` 를 렌더된 MathML 로 갈아 끼운다. */
export const katexMath = (): MdastPlugin => ({
  name: 'katex-math',
  math: (node) => html(render(node.value, true)),
  inlineMath: (node) => html(render(node.value, false)),
});
