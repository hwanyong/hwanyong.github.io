// src/lib/ui.ts — 화면 골격 문구의 단일 출처(SSOT).
//
// 여기 오는 것: "어느 글에서나 같은 자리에 같은 뜻으로 나오는 문구".
//
// 여기 오지 않는 것:
//   글 본문                    콘텐츠 컬렉션
//   About 프로필               profile.ts
//   개인정보처리방침 본문       privacy.ts — 방침 한 벌이 두 파일로 흩어지면 안 된다
//   네비 라벨                  routes.ts 의 sectionLabel — 계기판 어휘라 비번역
//   AdUnit 의 "Advertisements"  AdUnit.astro 참조 — 정책상 번역이 곧 위반이다
//
// 번역하지 않는 어휘군(계기판 표기): Log/Lecture/Project/About/Privacy ·
//   N ENTRIES · REV n/m · v1.0 · REFLECT/EMIT · 키캡(J K ↵ T) · 날짜 YYYY.MM.DD.
//   목록에서 세로로 줄이 맞아야 하는 값들이라 언어에 따라 폭이 달라지면 안 된다.
//
// Record<Locale, UIStrings> 이므로 LOCALE_CODES 에 언어를 추가하는 순간
// 이 표가 TypeScript 에러로 막는다 — 번역 없이는 로케일을 켤 수 없다.
import type { Locale } from './i18n';

export interface UIStrings {
  site: { title: string; description: string };
  lists: Record<'log' | 'lecture' | 'project', { description: string }>;
  emptyList: string;
  emptyLecture: string;

  toc: string;
  comments: string;
  postNav: string;
  backlightToggle: string;
  scanToggle: string;
  videoPlay: (title: string) => string;

  revision: {
    current: string;
    jump: string;
    stale: string;
    seeLatest: string;
    history: string;
    viewing: string;
    view: string;
    /**
     * 목록의 개정 개수 문구.
     * v{version} · REV n/m 은 계기판 표기라 번역하지 않지만, 이 줄은 설명문이다.
     */
    count: (n: number) => string;
  };

  /** 커맨드 바 각인 옆 설명. 키캡 자체는 번역하지 않는다. */
  hints: Record<'move' | 'open' | 'backlight', string>;

  about: { career: string; accounts: string; tbdNote: string; present: string };

  /**
   * 이 언어가 각 언어를 부르는 이름.
   * 영어 화면에서는 'Korean', 한국어 화면에서는 '영어' 여야 한다 — endonym(자기 언어로
   * 쓴 이름)과 다른 축이다. Record<Locale,…> 라 로케일을 늘리면 두 표가 함께 에러를 낸다.
   */
  languageNames: Record<Locale, string>;

  /** 언어 스위처의 접근성 이름. */
  languageNav: string;
  /** 그 언어판이 이전 개정본의 번역일 때 스위처 링크에 붙는 설명. */
  languageBehind: (languageName: string) => string;

  /**
   * 아직 번역되지 않아 원문을 그대로 싣고 있는 글의 본문 위 안내.
   * 이 상태는 tools/i18n-verify.ts 가 강제하는 완전쌍 불변식의 결과다 —
   * 판본이 없는 대신 원문 사본이 있고, 그 사실을 화면이 숨기지 않는다.
   */
  untranslatedNotice: (languageName: string) => string;

  notFound: { title: string; description: string; goHome: (endonym: string) => string };
}

const en: UIStrings = {
  site: {
    title: 'Hwanyong Yoo Tech Blog',
    description: 'Everything about computers, written down.',
  },
  lists: {
    log: { description: 'Notes and write-ups.' },
    lecture: { description: 'Teaching material, revised as I teach it.' },
    project: { description: 'Personal projects, built and revised.' },
  },
  emptyList: 'Nothing here yet.',
  emptyLecture: 'No lectures published yet.',

  toc: 'Contents',
  comments: 'Comments',
  postNav: 'Post navigation',
  backlightToggle: 'Toggle backlight',
  scanToggle: 'Change screen pattern',
  videoPlay: (title) => `Play ${title}`,

  revision: {
    current: 'current',
    jump: 'Revisions ↓',
    stale: 'This is not the latest revision.',
    seeLatest: 'See the latest revision →',
    history: 'Revisions',
    viewing: 'viewing',
    view: 'view',
    count: (n) => ` · ${n} revisions`,
  },

  hints: { move: 'move', open: 'open', backlight: 'backlight' },

  about: {
    career: 'Career',
    accounts: 'Accounts',
    tbdNote: 'This paragraph is a placeholder and has not been written yet.',
    present: 'Present',
  },

  languageNames: { en: 'English', ko: 'Korean' },
  languageNav: 'Language',
  languageBehind: (name) => `${name} — translation of an earlier revision`,

  untranslatedNotice: (name) =>
    `Not translated yet. The text below is the ${name} original.`,

  notFound: {
    title: 'Not found',
    description: 'There is no page at this address.',
    goHome: (endonym) => `Go to the ${endonym} home page →`,
  },
};

const ko: UIStrings = {
  site: {
    title: 'Hwanyong Yoo 기술 블로그',
    description: 'Computer에 관한 모든 기록',
  },
  lists: {
    log: { description: '기술 글 목록' },
    lecture: { description: '가르치며 고쳐 나가는 자료' },
    project: { description: '만들고 고쳐 온 개인 프로젝트' },
  },
  emptyList: '아직 없습니다.',
  emptyLecture: '아직 공개한 강의가 없습니다.',

  toc: '목차',
  comments: '댓글',
  postNav: '글 이동',
  backlightToggle: '백라이트 전환',
  scanToggle: '화면 무늬 전환',
  videoPlay: (title) => `${title} 재생`,

  revision: {
    current: '현재',
    jump: '개정 이력 ↓',
    stale: '이 문서는 최신 개정본이 아닙니다.',
    seeLatest: '최신 개정본 보기 →',
    history: '개정 이력',
    viewing: '보는 중',
    view: '보기',
    count: (n) => ` · 개정 ${n}`,
  },

  hints: { move: '이동', open: '열기', backlight: '백라이트' },

  about: {
    career: '근무 이력',
    accounts: '계정',
    tbdNote: '아직 채우지 않은 자리표시자 문단입니다.',
    present: '재직 중',
  },

  languageNames: { en: '영어', ko: '한국어' },
  languageNav: '언어',
  languageBehind: (name) => `${name} — 이전 개정본의 번역입니다`,

  untranslatedNotice: (name) => `아직 번역되지 않았습니다. 아래는 ${name} 원문입니다.`,

  notFound: {
    title: '페이지 없음',
    description: '이 주소에는 페이지가 없습니다.',
    goHome: (endonym) => `${endonym} 홈으로 →`,
  },
};

export const UI: Record<Locale, UIStrings> = { en, ko };
