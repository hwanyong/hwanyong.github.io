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
 * 선택 상태는 클래스가 아니라 data-active 속성으로 표현한다.
 * 클래스는 "이것이 무엇인가"(.entry), data-* 는 "지금 어떤 상태인가"를 나타낸다.
 * 둘을 섞으면 스타일 훅과 상태 플래그가 같은 네임스페이스에서 뒤섞인다.
 */
import { toggleMode } from './theme';
import { BINDINGS, ENTRY_SELECTOR, matches } from '../lib/shortcuts';

const ACTIVE_SELECTOR = `${ENTRY_SELECTOR}[data-active]`;

/** 입력 중에는 단축키가 글자를 가로채면 안 된다. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const entries = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(ENTRY_SELECTOR),
];

const isActive = (el: HTMLElement): boolean => el.dataset.active !== undefined;

/** delta 만큼 선택을 옮긴다. 목록 밖으로는 넘어가지 않는다. */
const move = (delta: number): boolean => {
  const list = entries();
  if (list.length === 0) return false;

  const current = list.findIndex(isActive);
  const next =
    current === -1 ? 0 : Math.min(Math.max(current + delta, 0), list.length - 1);

  const target = list[next];
  if (!target) return false;

  list.forEach((el) => delete el.dataset.active);
  target.dataset.active = '';
  target.scrollIntoView({ block: 'nearest' });
  return true;
};

/** 선택된 항목의 링크를 연다. 선택이 없으면 아무것도 하지 않는다. */
const openActive = (): boolean => {
  const active = document.querySelector<HTMLElement>(ACTIVE_SELECTOR);
  const link = active?.querySelector<HTMLAnchorElement>('a[href]');
  if (!link) return false;
  link.click();
  return true;
};

/**
 * 이 페이지에서 발화하지 않는 안내를 커맨드 바에서 감춘다.
 *
 * 서버에서 페이지마다 플래그를 넘기지 않는 이유: 새 페이지를 만들 때 플래그를
 * 빠뜨리면 안내가 다시 거짓말을 한다. 조건을 실제 DOM 에 물어보면 어긋날 수 없다.
 * 훅은 클래스가 아니라 data-needs 다 — 클래스는 "무엇인가", data-* 는 "어떤 상태인가".
 */
const syncHints = (): void => {
  document.querySelectorAll<HTMLElement>('[data-needs]').forEach((item) => {
    const selector = item.dataset.needs;
    item.hidden = !selector || !document.querySelector(selector);
  });
};

export const initKeyboard = (): void => {
  syncHints();

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;

    // IME 조합 중이어도 막지 않는다. 편집 대상 밖에서는 조합이 시작되지 않고,
    // 여기서 걸러 버리면 한글 입력 상태에서 단축키가 죽는다 — 고치려던 그 증상이다.
    if (matches(event, BINDINGS.toggleMode)) {
      toggleMode();
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.moveDown) && move(1)) {
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.moveUp) && move(-1)) {
      event.preventDefault();
      return;
    }

    if (matches(event, BINDINGS.open) && openActive()) {
      event.preventDefault();
    }
  });
};
