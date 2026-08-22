// src/lib/subjects.ts — 강의 과목 분류의 단일 출처(SSOT).
//
// ★ 이 파일도 tools 에서 맨 node 로 읽힌다(verify-site). 그래서 import 에 확장자를
//   붙이고, astro:content 를 절대 import 하지 않는다.
//   의존 방향: i18n.ts → subjects.ts · routes.ts → content.ts → 컴포넌트/페이지
//
// ── 과목은 URL 의 첫 세그먼트다 ──────────────────────────────────────────────
//   /lecture/math/linear-algebra/01-vectors/
//            ^^^^
// 그래서 슬러그는 공개 후 바꿀 수 없다. 반면 ★정체성★(giscus 검색어 · RSS guid)에는
// 과목이 들어가지 않는다 — 강의를 다른 과목으로 옮겨도 댓글과 피드 항목은 살아 있고
// 주소만 바뀐다. 그 대가로 코스 이름이 과목을 가로질러 유일해야 하며,
// content.ts 가 빌드 때 그것을 강제한다.
//
// Record<Subject, …> 와 Record<Locale, …> 두 겹이라, 과목을 늘리거나 로케일을 늘리면
// 이름을 빠뜨리는 것이 타입 에러로 막힌다.
import type { Locale } from './i18n.ts';

/**
 * 과목. 배열 순서가 곧 화면 순서다(전체 목록의 섹션 차례).
 *
 * 슬러그는 URL 세그먼트이므로 routes.ts 의 URL_KEY 규칙을 따른다 —
 * 소문자·숫자·하이픈, 숫자만은 불가.
 */
export const SUBJECT_SLUGS = [
  'math',
  'computer-science',
  'earth-science',
  'chemistry',
  'physics',
  'biology',
] as const;

export type Subject = (typeof SUBJECT_SLUGS)[number];

export interface SubjectMeta {
  /**
   * 계기판 표기. 갤러리 카드의 칩과 목록의 좁은 자리에 쓰인다.
   * 로케일 불변이다 — REFLECT/EMIT · REV n/m 과 같은 어휘군이고,
   * 카드마다 폭이 달라지면 격자가 흐트러진다.
   */
  code: string;
  /** 사람이 읽는 이름. 과목 화면의 제목과 섹션 머리에 쓰인다. */
  name: Record<Locale, string>;
}

export const SUBJECTS: Record<Subject, SubjectMeta> = {
  math: { code: 'MATH', name: { en: 'Mathematics', ko: '수학' } },
  'computer-science': { code: 'CS', name: { en: 'Computer Science', ko: '컴퓨터과학' } },
  'earth-science': { code: 'EARTH', name: { en: 'Earth Science', ko: '지구과학' } },
  chemistry: { code: 'CHEM', name: { en: 'Chemistry', ko: '화학' } },
  physics: { code: 'PHYS', name: { en: 'Physics', ko: '물리' } },
  biology: { code: 'BIO', name: { en: 'Biology', ko: '생물' } },
};

export const isSubject = (value: string): value is Subject =>
  (SUBJECT_SLUGS as readonly string[]).includes(value);
