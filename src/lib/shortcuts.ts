// src/lib/shortcuts.ts — 키보드 단축키의 단일 출처(SSOT).
//
// 커맨드 바에 찍히는 글자(BaseLayout)와 실제로 반응하는 키(scripts/keyboard.ts)가
// 같은 표를 읽는다. 예전에는 양쪽에 따로 하드코딩하고 "한쪽만 고치지 말 것" 이라는
// 주석으로 붙들었는데, 주석은 강제력이 없다. 여기 한 곳만 고치면 둘 다 따라온다.

/**
 * 키 하나의 바인딩.
 *
 * ★ code 가 1차 기준인 이유:
 *   KeyboardEvent.key 는 "입력된 문자" 다. 자판 배열과 IME(입력기, Input Method Editor —
 *   한글·일본어처럼 조합이 필요한 문자를 만드는 소프트웨어)에 따라 값이 바뀐다.
 *   한글 입력 상태에서 J 를 누르면 key 는 'j' 가 아니라 'ㅓ'(또는 'Process')다.
 *   → 문자로 비교하면 한/영 상태에 따라 단축키가 먹었다 안 먹었다 한다.
 *
 *   KeyboardEvent.code 는 "물리 키의 위치" 다(KeyJ, KeyK, Enter…).
 *   자판 배열도 IME 도 이 값을 바꾸지 못한다. 단축키가 묶여야 할 대상은 이쪽이다.
 *
 * ★ key 를 2차 기준으로 남기는 이유:
 *   Dvorak·Colemak 처럼 라틴 문자 배치가 다른 자판에서는 물리 위치와 각인이 어긋난다.
 *   그 사용자가 자기 키보드에 적힌 J 를 눌렀을 때도 동작하도록 문자 매칭을 함께 둔다.
 *   code 로 이미 IME 문제는 해결되므로, 이쪽은 순수하게 대체 배열용 보조다.
 */
export interface KeyBinding {
  /** KeyboardEvent.code. 물리 키 위치라 자판 배열·IME 와 무관하다. */
  code: string;
  /** KeyboardEvent.key. 라틴 대체 배열 사용자를 위한 2차 매칭. */
  key: string;
  /** 커맨드 바의 <kbd> 에 찍히는 글자 */
  cap: string;
}

/** 동작별 바인딩. 키를 바꾸려면 여기만 고친다. */
export const BINDINGS = {
  moveDown: { code: 'KeyJ', key: 'j', cap: 'J' },
  moveUp: { code: 'KeyK', key: 'k', cap: 'K' },
  open: { code: 'Enter', key: 'Enter', cap: '↵' },
  toggleMode: { code: 'KeyT', key: 't', cap: 'T' },
} as const satisfies Record<string, KeyBinding>;

/**
 * 이동·열기 단축키가 대상으로 삼는 목록 항목.
 * 이 선택자를 아는 곳은 여기 하나다 — 동작(keyboard.ts)과 안내 조건이 같은 값을 본다.
 */
export const ENTRY_SELECTOR = '.entry';

export interface Hint {
  keys: readonly KeyBinding[];
  label: string;
  /**
   * 이 안내가 성립하려면 페이지에 있어야 하는 요소의 선택자.
   * 없는 페이지에서는 커맨드 바가 이 항목을 감춘다 — 목록이 없는 상세 화면에서
   * "J K 이동" 을 계속 띄우면 눌러도 아무 일이 없어 UI 가 거짓말을 하게 된다.
   * 조건이 없는 항목(백라이트)은 모든 페이지에서 유효하다.
   */
  needs?: string;
}

/**
 * 커맨드 바 안내. 배열 순서가 곧 화면 순서다.
 * keys 는 BINDINGS 를 참조하므로 각인과 실제 키가 어긋날 수 없다.
 */
export const HINTS: readonly Hint[] = [
  { keys: [BINDINGS.moveDown, BINDINGS.moveUp], label: '이동', needs: ENTRY_SELECTOR },
  { keys: [BINDINGS.open], label: '열기', needs: ENTRY_SELECTOR },
  { keys: [BINDINGS.toggleMode], label: '백라이트' },
];

/**
 * 이 이벤트가 해당 바인딩인가.
 *
 * code 를 먼저 본다. Enter 는 숫자패드에서 code 가 'NumpadEnter' 로 오지만
 * key 는 양쪽 모두 'Enter' 이므로 2차 매칭이 그대로 받아낸다.
 */
export const matches = (event: KeyboardEvent, binding: KeyBinding): boolean =>
  event.code === binding.code || event.key.toLowerCase() === binding.key.toLowerCase();
