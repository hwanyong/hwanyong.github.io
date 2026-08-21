/**
 * 커맨드 바가 안내하는 단축키의 실제 구현.
 *
 * 화면 하단 커맨드 바(BaseLayout)에 적힌 키와 여기 구현이 반드시 일치해야 한다.
 * 안내와 동작이 어긋나면 UI 가 거짓말을 하는 셈이므로, 한쪽만 고치지 말 것.
 */
import { toggleMode } from './theme';

const ENTRY_SELECTOR = '.entry';
const ACTIVE_CLASS = 'is-active';

/** 입력 중에는 단축키가 글자를 가로채면 안 된다. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const entries = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(ENTRY_SELECTOR),
];

/** delta 만큼 선택을 옮긴다. 목록 밖으로는 넘어가지 않는다. */
const move = (delta: number): boolean => {
  const list = entries();
  if (list.length === 0) return false;

  const current = list.findIndex((el) => el.classList.contains(ACTIVE_CLASS));
  const next =
    current === -1
      ? 0
      : Math.min(Math.max(current + delta, 0), list.length - 1);

  list.forEach((el) => el.classList.remove(ACTIVE_CLASS));

  const target = list[next];
  if (!target) return false;

  target.classList.add(ACTIVE_CLASS);
  target.scrollIntoView({ block: 'nearest' });
  return true;
};

/** 선택된 항목의 링크를 연다. 선택이 없으면 아무것도 하지 않는다. */
const openActive = (): boolean => {
  const active = document.querySelector<HTMLElement>(
    `${ENTRY_SELECTOR}.${ACTIVE_CLASS}`,
  );
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
