/**
 * REFLECT / EMIT 상태 전환.
 *
 * 다크모드가 아니라 "조명 상태"다 — 백라이트가 꺼진 반사면(reflect)과
 * 켜진 발광면(emit). 그래서 CSS 는 prefers-color-scheme 이 아니라 data-mode 로
 * 제어한다. 다만 초기값은 OS 취향(prefers-color-scheme)을 참고한다 —
 * 결정 순서는 public/theme-init.js 의 주석에 있다(저장된 선택 > OS > reflect).
 *
 * 선택 상태는 클래스가 아니라 data-mode 속성으로 표현한다.
 * giscus 쪽 MutationObserver 가 이 속성 변화를 보고 iframe 테마를 갱신한다.
 */

export type Mode = 'reflect' | 'emit';

const STORAGE_KEY = 'mode';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const root = (): HTMLElement => document.documentElement;

/** 사용자가 직접 고른 적이 있는가. 없으면 null. */
const storedMode = (): Mode | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'emit' || saved === 'reflect' ? saved : null;
  } catch {
    // 사파리 프라이빗 모드 등에서 읽기가 막히면 "고른 적 없음"으로 본다.
    return null;
  }
};

export const currentMode = (): Mode => (root().dataset.mode === 'emit' ? 'emit' : 'reflect');

export const setMode = (next: Mode): void => {
  root().dataset.mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 저장이 막혀도 전환 자체는 동작해야 한다.
  }
};

export const toggleMode = (): void => setMode(currentMode() === 'emit' ? 'reflect' : 'emit');

/**
 * OS 취향이 바뀌면 따라간다 — 단, 사용자가 직접 고른 적이 없을 때만.
 *
 * 저장된 선택이 있는데도 따라가면 사용자가 고른 상태를 시스템이 덮어쓰게 되어,
 * "직접 고르는 상태"라는 원칙이 깨진다. 그래서 매번 저장값을 다시 확인한다
 * (이 리스너가 붙은 뒤에 사용자가 토글할 수 있으므로 등록 시점 값을 캐시하면 안 된다).
 */
const followSystem = (): void => {
  let query: MediaQueryList;
  try {
    query = window.matchMedia(DARK_QUERY);
  } catch {
    return;
  }

  query.addEventListener('change', (event) => {
    if (storedMode() !== null) return;
    root().dataset.mode = event.matches ? 'emit' : 'reflect';
  });
};

export const initTheme = (): void => {
  document.getElementById('mode-toggle')?.addEventListener('click', () => toggleMode());
  followSystem();
};
