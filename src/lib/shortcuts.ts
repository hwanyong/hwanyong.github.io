// src/lib/shortcuts.ts — 키보드 단축키의 단일 출처(SSOT).
//
// 커맨드 바에 찍히는 글자(BaseLayout)와 실제로 반응하는 키(scripts/keyboard.ts)가
// 같은 표를 읽는다. 예전에는 양쪽에 따로 하드코딩하고 "한쪽만 고치지 말 것" 이라는
// 주석으로 붙들었는데, 주석은 강제력이 없다. 여기 한 곳만 고치면 둘 다 따라온다.
//
// ── 키 지도 ────────────────────────────────────────────────────────────────
// J K 는 ★Tab · Shift+Tab★ 이다. 브라우저의 포커스 차례를 그대로 한 칸씩 움직인다.
// H L 은 그 차례의 양 끝으로 한 번에 간다 — vim 의 H(igh) L(ow)가 화면 맨 위·맨 아래라
// 뜻이 그대로 맞고, J K 옆자리라 같은 손가락으로 닿는다.
//
// ★ 브라우저에는 "탭 순서의 처음/마지막으로" 가 없다. 스크롤에는 Home·End 가 있는데
//   포커스에는 Tab 한 칸씩뿐이다(F6 은 브라우저 구역 순환, F7 캐럿 브라우징은 포커스가
//   아니라 캐럿, 스크린리더 빠른 탐색은 보조기술 기능이다). 그 비대칭을 여기서 메운다.
//
// 그래서 "무엇을 조작할 수 있는가" 를 이 파일이 알지 않는다. 화면에 있는 링크·버튼이
// 곧 조작 대상이고, 새 화면을 만들어도 목록을 갱신할 일이 없다. 축 목록·쪽 이동·
// 언어 칩·목차·개정 이력·푸터가 전부 자동으로 손에 들어온다.
//
//   ↵  열기 — 우리가 구현하지 않는다. 포커스된 링크·버튼을 브라우저가 이미 연다.
//              가로채면 폼·버튼의 기본 동작까지 망가진다. 각인만 싣는다.
//   B  뒤로 — 유일하게 화면에 요소가 없는 동작이다(브라우저 이력).
//   S T  무늬·조명 — 커맨드 바 칩과 같은 동작. 바는 계기판이라 J K H L 의 고리에서
//              빠져 있으므로(scripts/keyboard.ts 의 CHROME), 이 둘이 칩에 닿는 길이다.

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

/**
 * 동작별 바인딩. 키를 바꾸려면 여기만 고친다.
 *
 * open 은 핸들러가 없다 — 브라우저가 하는 일이라 각인만 필요하다.
 * code·key 를 채워 두는 것은 그 키가 무엇인지가 사실이기 때문이고,
 * 언젠가 가로채야 할 이유가 생기면 이미 여기 있다.
 */
export const BINDINGS = {
  focusNext: { code: 'KeyJ', key: 'j', cap: 'J' },
  focusPrev: { code: 'KeyK', key: 'k', cap: 'K' },
  focusFirst: { code: 'KeyH', key: 'h', cap: 'H' },
  focusLast: { code: 'KeyL', key: 'l', cap: 'L' },
  open: { code: 'Enter', key: 'Enter', cap: '↵' },
  back: { code: 'KeyB', key: 'b', cap: 'B' },
  scan: { code: 'KeyS', key: 's', cap: 'S' },
  toggleMode: { code: 'KeyT', key: 't', cap: 'T' },
} as const satisfies Record<string, KeyBinding>;

/**
 * UI[locale].hints 의 키.
 * ★ 문구가 아니라 키다 — 이 파일은 로케일을 모른다. 여기 완성된 문자열을 두면
 *   단축키 표가 언어를 하나 알게 되어, 언어를 늘릴 때 이 파일까지 따라 늘어난다.
 *   ui.ts 가 이 타입으로 Record 를 만드므로 안내를 하나 더하면 두 언어가 함께 막힌다.
 */
export type HintLabel = 'move' | 'ends' | 'open' | 'back' | 'pattern' | 'backlight';

export interface Hint {
  keys: readonly KeyBinding[];
  labelKey: HintLabel;
}

/**
 * 커맨드 바 안내. 배열 순서가 곧 화면 순서다.
 * keys 는 BINDINGS 를 참조하므로 각인과 실제 키가 어긋날 수 없다.
 *
 * ★ 조건부 안내가 없다. 여섯 줄이 전부 어느 화면에서나 그대로 발화한다 —
 *   포커스 차례는 어느 화면에나 있고, 뒤로·무늬·조명은 화면과 무관하다.
 *   (예전에는 "목록이 없는 화면에서는 J K 를 감춘다" 는 장치가 있었다.
 *    J K 가 목록이 아니라 포커스를 움직이게 된 순간 감출 이유가 사라졌다.)
 */
export const HINTS: readonly Hint[] = [
  { keys: [BINDINGS.focusNext, BINDINGS.focusPrev], labelKey: 'move' },
  { keys: [BINDINGS.focusFirst, BINDINGS.focusLast], labelKey: 'ends' },
  { keys: [BINDINGS.open], labelKey: 'open' },
  { keys: [BINDINGS.back], labelKey: 'back' },
  { keys: [BINDINGS.scan], labelKey: 'pattern' },
  { keys: [BINDINGS.toggleMode], labelKey: 'backlight' },
];

/**
 * 이 이벤트가 해당 바인딩인가.
 *
 * code 를 먼저 본다. Enter 는 숫자패드에서 code 가 'NumpadEnter' 로 오지만
 * key 는 양쪽 모두 'Enter' 이므로 2차 매칭이 그대로 받아낸다.
 */
export const matches = (event: KeyboardEvent, binding: KeyBinding): boolean =>
  event.code === binding.code || event.key.toLowerCase() === binding.key.toLowerCase();
