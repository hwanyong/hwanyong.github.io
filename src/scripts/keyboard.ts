/**
 * 커맨드 바가 안내하는 단축키의 실제 구현.
 *
 * 어떤 키인지는 여기서 정하지 않는다 — src/lib/shortcuts.ts 의 BINDINGS 가 유일한 출처이고
 * 커맨드 바의 각인도 같은 표를 읽는다. 안내와 동작이 어긋날 자리가 없다.
 *
 * 매칭은 문자(event.key)가 아니라 물리 키(event.code)로 한다.
 * 한글 입력 상태에서는 J 를 눌러도 event.key 가 'j' 가 아니므로 문자 비교는 먹지 않는다.
 * 자세한 근거는 shortcuts.ts 의 KeyBinding 주석에 있다.
 *
 * ── J K 는 Tab · Shift+Tab, H L 은 그 차례의 양 끝 ──────────────────────────
 * 선택 상태를 따로 만들지 않는다. 브라우저의 ★포커스★ 를 한 칸씩 옮길 뿐이다.
 *
 * 그래서 이 파일은 "무엇을 고를 수 있는가" 를 모른다. 화면에 있는 링크·버튼이 곧
 * 대상이고, Enter 로 여는 것도 브라우저가 한다. 예전에는 목록 항목에 data-active 를
 * 붙이고 그 안의 첫 링크를 클릭해 주었는데, 그러면 고를 수 있는 것이 목록 항목뿐이라
 * 네비·쪽 이동·언어 칩·목차·개정 이력은 전부 키보드 밖에 있었다.
 * 선택 표시(행 반전·테두리)도 global.css 의 :focus-within 이 이미 그리고 있었다.
 */
import { toggleMode } from './theme';
import { cycleScan } from './scan';
import { BINDINGS, matches } from '../lib/shortcuts';

/**
 * 포커스를 받을 수 있는 것들.
 *
 * ★ iframe 은 일부러 뺀다. 댓글(giscus)은 교차 출처 iframe 이라 그 안으로 포커스가
 *   들어가면 이 리스너에 키가 오지 않는다 — J 로 들어갔다가 J 로 못 나오는 한쪽 문이
 *   된다. Tab 은 브라우저가 처리하므로 그대로 드나들 수 있고, 우리는 막지 않는다.
 *
 * ★ tabindex 가 양수인 요소는 실제 Tab 차례를 앞으로 끌어당기지만, 이 사이트는
 *   양수 tabindex 를 쓰지 않는다. 그래서 문서 순서가 곧 Tab 순서다.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex^="-"])',
].join(', ');

/**
 * 커맨드 바는 문서가 아니라 ★계기판★ 이다. 이 고리에서 뺀다.
 *
 * 바는 fixed 라 늘 화면에 떠 있다. 넣어 두면 문서의 끝이 "푸터의 Privacy" 가 아니라
 * "조명 칩" 이 되어, L(끝으로)이 화면을 내리지 않고 떠 있는 칩에 서 버린다 —
 * H(처음으로)가 화면을 맨 위로 올리는 것과 짝이 안 맞는다.
 *
 * 못 닿게 되는 것이 아니다: 칩에는 S·T 라는 직행 키가 있고(그 각인이 칩 바로 옆에
 * 적혀 있다), 브라우저의 Tab 은 여전히 그대로 들어간다.
 */
const CHROME = '.command-bar';

/** 입력 중에는 단축키가 글자를 가로채면 안 된다. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

/**
 * 지금 화면에서 포커스를 받을 수 있는 것들, 문서 순서로.
 *
 * getClientRects().length 로 거른다 — display:none 인 것(좁은 화면의 목차 등)을
 * 빼기 위해서다. 화면 밖으로 스크롤된 것은 빼면 안 되므로 화면 교차 여부는 보지 않는다.
 */
const ring = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && !el.closest(CHROME),
  );

/**
 * 포커스가 없을 때 어디서부터 셀 것인가.
 *
 * ★ 0번(문서 맨 처음)에서 시작하면 안 된다. 글 중간을 읽다가 J 를 누른 사람이
 *   화면 맨 위 브랜드 로고로 튄다.
 *
 * 브라우저는 이 문제를 ★순차 포커스 탐색 시작점★(sequential focus navigation
 * starting point, HTML 표준)으로 푼다 — 페이지를 클릭하거나 #앵커로 이동하면
 * 그 지점부터 Tab 이 이어진다. 읽어 낼 API 가 없는 값이라 같은 뜻을 화면으로 만든다:
 * ★지금 화면에 들어와 있는 첫 요소★.
 *
 * 표준의 시작점보다 오히려 넓다 — 휠 스크롤은 시작점을 설정하지 않지만,
 * 화면 기준은 그렇게 내려온 자리까지 덮는다.
 *
 * 화면 위로 지나간 것(top < 0)은 건너뛴다. 그래서 J 는 "화면에 보이는 첫 것",
 * K 는 "그 바로 앞 것 = 화면 위로 방금 지나간 것" 이 되어 한 기준에서 둘이 나온다.
 */
const seed = (list: HTMLElement[], delta: number): number => {
  const first = list.findIndex((el) => el.getBoundingClientRect().top >= 0);
  // 화면 안에 아무것도 없으면 양끝으로 떨어진다(-1 은 아래 모듈러가 마지막으로 돌린다).
  if (first === -1) return delta > 0 ? 0 : -1;
  return delta > 0 ? first : first - 1;
};

/**
 * 고리의 양 끝으로 한 번에. index 는 0(처음) 또는 -1(마지막)이다.
 *
 * 고리라서 브랜드에서 K 한 번이면 이미 맨 끝이고 그 반대도 된다 — 없던 것은
 * ★중간에서 한 번에★ 가는 길이다. 긴 글을 읽다 헤더로, 또는 조명 칩으로 갈 때
 * J 를 열 몇 번 누르는 대신 한 번이면 된다.
 */
const jump = (index: number): boolean => {
  const list = ring();
  const target = list.at(index);
  if (!target) return false;
  target.focus();
  return true;
};

/**
 * 포커스를 delta 만큼 옮긴다. 끝에서는 반대편으로 돌아온다.
 *
 * 목록 이동과 달리 끝에서 멈추지 않는 이유: 이 고리에는 헤더와 푸터가 함께 있어
 * "끝" 이 화면의 끝이 아니라 문서의 끝이다. 멈추면 아래에서 헤더로 돌아갈 방법이
 * 없어져 K 를 수십 번 눌러 거슬러 올라가야 한다.
 */
const step = (delta: number): boolean => {
  const list = ring();
  if (list.length === 0) return false;

  const here = list.indexOf(document.activeElement as HTMLElement);
  const next = here === -1 ? seed(list, delta) : here + delta;

  list[(next + list.length) % list.length]!.focus();
  return true;
};

export const initKeyboard = (): void => {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;

    // IME 조합 중이어도 막지 않는다. 편집 대상 밖에서는 조합이 시작되지 않고,
    // 여기서 걸러 버리면 한글 입력 상태에서 단축키가 죽는다 — 고치려던 그 증상이다.
    if (matches(event, BINDINGS.focusNext) && step(1)) {
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.focusPrev) && step(-1)) {
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.focusFirst) && jump(0)) {
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.focusLast) && jump(-1)) {
      event.preventDefault();
      return;
    }

    // 이력이 없는 첫 화면(주소를 직접 열었거나 검색에서 바로 들어온 경우)에서는
    // 아무 일도 일어나지 않는다 — 브라우저의 뒤로 버튼과 정확히 같은 상태다.
    if (matches(event, BINDINGS.back)) {
      history.back();
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.scan)) {
      cycleScan();
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.toggleMode)) {
      toggleMode();
      event.preventDefault();
    }

    // BINDINGS.open(↵)은 여기 없다. 포커스된 링크·버튼을 브라우저가 이미 연다.
  });
};
