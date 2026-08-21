/**
 * giscus 댓글 위젯 임베드 + 테마 동기화.
 *
 * 설정은 Comments.astro 가 컨테이너의 data-giscus 속성에 JSON 으로 실어 보낸다.
 * 인라인 스크립트에 define:vars 로 값을 주입하지 않는 이유는, 그렇게 하면
 * 코드가 번들·타입체크 밖으로 빠지기 때문이다.
 */
import { currentMode, type Mode } from './theme';

interface GiscusConfig {
  origin: string;
  repo: string;
  repoId: string;
  category: string;
  categoryId: string;
  /**
   * 항상 'specific' 이다. term 이 URL 이 아니라 항목의 정체성에서 나오므로,
   * 같은 글의 언어별 URL 이 한 Discussion 을 공유한다.
   */
  mapping: 'specific';
  /** 언어 무관 통합 키. 예: 'log:first-post', 'project:analysis-video' */
  term: string;
  /**
   * 위젯 UI 언어. LOCALES[locale].giscusLang 에서 온다.
   * ★ 이것은 위젯 UI 의 언어일 뿐이고 스레드는 언어 무관 통합이다. 두 축은 독립이다.
   */
  lang: string;
  /** REFLECT/EMIT 각각에 넘길 data-theme 값 (URL 또는 빌트인 테마명) */
  theme: Record<Mode, string>;
}

const CONTAINER_SELECTOR = '.giscus';
const FRAME_SELECTOR = 'iframe.giscus-frame';

const readConfig = (container: HTMLElement): GiscusConfig | null => {
  const raw = container.dataset.giscus;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GiscusConfig;
  } catch {
    console.warn('[giscus] data-giscus 파싱 실패');
    return null;
  }
};

const buildScript = (config: GiscusConfig): HTMLScriptElement => {
  const script = document.createElement('script');
  script.src = `${config.origin}/client.js`;
  script.async = true;
  script.crossOrigin = 'anonymous';

  // dataset 의 camelCase 는 data-kebab-case 로 정확히 변환된다.
  script.dataset.repo = config.repo; // data-repo
  script.dataset.repoId = config.repoId; // data-repo-id
  script.dataset.category = config.category; // data-category (카테고리 한정 검색)
  script.dataset.categoryId = config.categoryId; // data-category-id
  script.dataset.mapping = config.mapping;
  script.dataset.strict = '1'; // 퍼지 검색 오매칭 방지
  script.dataset.reactionsEnabled = '1';
  script.dataset.emitMetadata = '0';
  script.dataset.inputPosition = 'bottom';
  script.dataset.theme = config.theme[currentMode()]; // data-theme 은 기본값이 없다. 필수.
  script.dataset.lang = config.lang;
  script.dataset.loading = 'lazy';
  script.dataset.term = config.term;

  return script;
};

/** iframe 리로드 없이 테마만 교체한다. */
const pushTheme = (config: GiscusConfig, mode: Mode): void => {
  const frame = document.querySelector<HTMLIFrameElement>(FRAME_SELECTOR);
  frame?.contentWindow?.postMessage(
    { giscus: { setConfig: { theme: config.theme[mode] } } },
    config.origin,
  );
};

export const initGiscus = (): void => {
  const container = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);
  if (!container) return;

  const config = readConfig(container);
  if (!config) return;

  let injected = false;
  const inject = (): void => {
    if (injected) return;
    injected = true;

    // ★ container.appendChild 로 넣으면 안 된다.
    //   client.js 는 .giscus 컨테이너를 찾은 뒤 firstChild 를 전부 제거하므로
    //   방금 넣은 <script> 자신이 DOM 에서 사라진다. 형제로 붙인다.
    container.insertAdjacentElement('afterend', buildScript(config));
  };

  let observer: IntersectionObserver | null = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (records) => {
        if (!records.some((record) => record.isIntersecting)) return;
        observer?.disconnect();
        inject();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(container);
  } else {
    inject();
  }

  const modeWatcher = new MutationObserver(() => pushTheme(config, currentMode()));
  modeWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mode'],
  });

  // ClientRouter 를 켤 경우 옵저버가 페이지마다 누적되는 것을 막는다.
  // ClientRouter 가 없으면 이 이벤트는 발화하지 않으므로 무해하다.
  document.addEventListener(
    'astro:before-swap',
    () => {
      modeWatcher.disconnect();
      observer?.disconnect();
    },
    { once: true },
  );
};
