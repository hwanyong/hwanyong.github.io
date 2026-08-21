/**
 * 커맨드 바가 안내하는 단축키의 실제 구현.
 *
 * 화면 하단 커맨드 바(BaseLayout)에 적힌 키와 여기 구현이 반드시 일치해야 한다.
 * 안내와 동작이 어긋나면 UI 가 거짓말을 하는 셈이므로, 한쪽만 고치지 말 것.
 *
 * 선택 상태는 클래스가 아니라 data-active 속성으로 표현한다.
 * 클래스는 "이것이 무엇인가"(.entry), data-* 는 "지금 어떤 상태인가"를 나타낸다.
 * 둘을 섞으면 스타일 훅과 상태 플래그가 같은 네임스페이스에서 뒤섞인다.
 */
import { toggleMode } from './theme';

const ENTRY_SELECTOR = '.entry';
const ACTIVE_SELECTOR = '.entry[data-active]';

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

export const initKeyboard = (): void => {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;

    const key = event.key.toLowerCase();

    if (key === 't') {
      toggleMode();
      event.preventDefault();
      return;
    }

    if (key === 'j' && move(1)) {
      event.preventDefault();
      return;
    }

    if (key === 'k' && move(-1)) {
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter' && openActive()) {
      event.preventDefault();
    }
  });
};
