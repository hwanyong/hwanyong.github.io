/**
 * REFLECT / EMIT 상태 전환.
 *
 * 다크모드가 아니라 "조명 상태"다 — 백라이트가 꺼진 반사면(reflect)과
 * 켜진 발광면(emit). OS 설정이 아니라 사용자가 직접 고르므로
 * prefers-color-scheme 이 아닌 data-mode 속성으로 제어한다.
 */

export type Mode = 'reflect' | 'emit';

const STORAGE_KEY = 'mode';

const root = (): HTMLElement => document.documentElement;

export const currentMode = (): Mode => (root().dataset.mode === 'emit' ? 'emit' : 'reflect');

export const setMode = (next: Mode): void => {
  // giscus 쪽 MutationObserver 가 이 속성 변화를 보고 iframe 테마를 갱신한다.
  root().dataset.mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 사파리 프라이빗 모드 등에서 저장이 막혀도 전환 자체는 동작해야 한다.
  }
};

export const toggleMode = (): void => setMode(currentMode() === 'emit' ? 'reflect' : 'emit');

export const initTheme = (): void => {
  document.getElementById('mode-toggle')?.addEventListener('click', () => toggleMode());
};
