/**
 * 화면 무늬(주사선) 전환.
 *
 * 조명 상태(theme.ts)와 같은 방식이다 — 클래스가 아니라 data-scan 속성으로
 * 상태를 표현하고, 값은 localStorage 에 남긴다.
 *
 * 라벨과 아이콘은 여기서 만들지 않는다. global.css 의 [data-scan] 블록이
 * --scan-label 과 --scan-icon 을 함께 정의하고, 실제 격자(body::before)도 같은
 * 블록에서 나온다. 세 가지가 한 자리에 있으므로 버튼이 거짓말을 할 수 없다.
 * 여기서 텍스트를 갱신하면 그 SSOT 가 둘로 쪼개진다.
 */

export type Scan = 'vertical' | 'horizontal' | 'grid' | 'none';

/** 버튼을 누를 때 도는 차례. 이 배열이 순서의 유일한 출처다. */
const ORDER: readonly Scan[] = ['vertical', 'horizontal', 'grid', 'none'];

const STORAGE_KEY = 'scan';

const root = (): HTMLElement => document.documentElement;

const isScan = (value: string | null | undefined): value is Scan =>
  value !== null && value !== undefined && (ORDER as readonly string[]).includes(value);

/** 기본값. public/theme-init.js 의 폴백과 반드시 같아야 한다. */
export const DEFAULT_SCAN: Scan = 'vertical';

export const currentScan = (): Scan => {
  const value = root().dataset.scan;
  return isScan(value) ? value : DEFAULT_SCAN;
};

export const setScan = (next: Scan): void => {
  root().dataset.scan = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 사파리 프라이빗 모드 등에서 저장이 막혀도 전환 자체는 동작해야 한다.
  }
};

/** 차례대로 다음 무늬로. 끝에서 처음으로 돌아온다. */
export const cycleScan = (): void => {
  const index = ORDER.indexOf(currentScan());
  setScan(ORDER[(index + 1) % ORDER.length]);
};

export const initScan = (): void => {
  document.getElementById('scan-toggle')?.addEventListener('click', () => cycleScan());
};
