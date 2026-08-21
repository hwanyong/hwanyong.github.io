// src/lib/profile.ts — About 화면이 쓰는 프로필 데이터의 단일 출처(SSOT).
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ ⚠ INTRO 와 CAREER 는 아직 자리표시자다.                                 │
// │   draft: true 인 항목은 화면에 "TBD" 표시와 점선 테두리가 붙는다 —        │
// │   실제 내용으로 착각할 수 없게 만들기 위해서다.                            │
// │   내용을 채운 뒤 그 항목의 draft 를 지우면 표시가 사라진다.                 │
// │   ACCOUNTS 는 자리표시자가 아니라 실제 값이다.                            │
// └──────────────────────────────────────────────────────────────────────┘
//
// 이름은 여기 적지 않는다 — site.ts 의 SITE.author 가 이미 갖고 있다.
import type { Locale } from './i18n';

/** 언어마다 다른 한 줄. 로케일을 추가하면 이 타입을 쓰는 모든 값이 컴파일 에러가 된다. */
export type LocalizedText = Record<Locale, string>;

/**
 * 직함.
 *
 * 언어 불변인 이유가 둘이다:
 *   ① LinkedIn 헤드라인과 글자 그대로 같은 값이다(외부 프로필과의 SSOT).
 *   ② 소비처 하나가 헤더 상태 칸의 ROLE.toUpperCase() 인데, 그 칸은
 *      REFLECT/EMIT · N ENTRIES 와 같은 계기판 어휘군이라 번역하지 않는다.
 */
export const ROLE = 'Software Engineer';

/** 소개 문단. paragraphs 를 실제 문장으로 바꾸고 draft 를 지울 것. */
export const INTRO: {
  draft: boolean;
  paragraphs: Record<Locale, readonly string[]>;
} = {
  draft: true,
  paragraphs: {
    en: [
      'Two or three sentences on what you do. This text is a placeholder.',
      'What you care about and what you have built. This text is a placeholder.',
    ],
    ko: [
      '여기에 무엇을 하는 사람인지 두세 문장으로 적는다. 지금 문장은 자리표시자다.',
      '여기에 무엇에 관심이 있고 무엇을 만들어 왔는지 적는다. 지금 문장은 자리표시자다.',
    ],
  },
};

export interface CareerEntry {
  /** 'YYYY.MM'. 숫자 표기라 언어 불변이다. */
  from: string;
  /**
   * 'YYYY.MM' 또는 null(재직 중). null 이면 화면이 UI[locale].about.present 를 찍는다.
   *
   * ★ 예전의 '2021.03 – 2024.02' 처럼 기간 전체를 한 문자열로 두고 그것을
   *   LocalizedText 로 올리면, 번역 대상이 아닌 숫자까지 두 언어에 복제되어
   *   한쪽만 고치는 드리프트가 생긴다. EN DASH 는 조판이므로 뷰가 넣는다.
   */
  to: string | null;
  /** 한국 회사는 공식 영문명이 따로 있다 — 자동 변환이 불가능해 양쪽을 적는다. */
  company: LocalizedText;
  role: LocalizedText;
  /** 한 줄 설명. 무엇을 맡아 무엇을 남겼는가. */
  summary: LocalizedText;
  /** 아직 실제 내용이 아니다. 화면에 자리표시자 표시가 붙는다. */
  draft?: boolean;
}

/**
 * 근무 이력. 최신순으로 적는다(화면은 배열 순서를 그대로 쓴다).
 * 전부 자리표시자이므로 실제 이력으로 통째로 교체할 것.
 */
export const CAREER: CareerEntry[] = [
  {
    from: '20XX.XX',
    to: null,
    company: { en: 'Company name', ko: '회사 이름' },
    role: { en: 'Job title', ko: '직함' },
    summary: {
      en: 'One line on what you owned and what you left behind.',
      ko: '무엇을 맡아 무엇을 남겼는지 한 줄.',
    },
    draft: true,
  },
  {
    from: '20XX.XX',
    to: '20XX.XX',
    company: { en: 'Company name', ko: '회사 이름' },
    role: { en: 'Job title', ko: '직함' },
    summary: {
      en: 'One line on what you owned and what you left behind.',
      ko: '무엇을 맡아 무엇을 남겼는지 한 줄.',
    },
    draft: true,
  },
  {
    from: '20XX.XX',
    to: '20XX.XX',
    company: { en: 'Company name', ko: '회사 이름' },
    role: { en: 'Job title', ko: '직함' },
    summary: {
      en: 'One line on what you owned and what you left behind.',
      ko: '무엇을 맡아 무엇을 남겼는지 한 줄.',
    },
    draft: true,
  },
];

export interface Account {
  /** 서비스 이름. 고유명사라 언어 불변. 예: YouTube, GitHub */
  platform: string;
  /** 화면에 그대로 찍히는 계정 표기. 식별자라 언어 불변. 예: @uhd_kr */
  handle: string;
  href: string;
  /** public/ 기준 아바타 경로. 없으면 플랫폼 첫 글자로 플레이트를 그린다. */
  avatar?: string;
  /** 이 인터페이스의 유일한 언어별 필드 — 이 계정이 무엇을 올리는 곳인지 한 줄. */
  note: LocalizedText;
}

/**
 * 계정. 여기 있는 값은 전부 실제 확인된 것이다.
 *
 * 푸터의 GitHub 링크도 이 목록에서 읽는다 — 주소를 두 곳에 적지 않는다.
 */
export const ACCOUNTS: Account[] = [
  {
    platform: 'YouTube',
    handle: '@uhd_kr',
    href: 'https://www.youtube.com/@uhd_kr',
    avatar: '/icon.png',
    note: {
      en: 'Everything except what goes to uhd_tech.',
      ko: 'uhd_tech 에 올리는 것 말고 전부.',
    },
  },
  {
    platform: 'YouTube',
    handle: '@uhd_tech',
    href: 'https://www.youtube.com/@uhd_tech',
    avatar: '/images/users/uhd.jpg',
    note: {
      en: 'Footage of the things I build.',
      ko: '만든 것의 결과물 영상.',
    },
  },
  {
    platform: 'GitHub',
    handle: 'hwanyong',
    href: 'https://github.com/hwanyong',
    note: { en: 'All of the code.', ko: '코드는 전부 여기.' },
  },
  {
    platform: 'LinkedIn',
    handle: 'hwanyong',
    href: 'https://www.linkedin.com/in/hwanyong/',
    note: { en: 'Career and project history.', ko: '경력과 프로젝트 이력.' },
  },
];

/** 푸터가 쓰는 GitHub 계정. platform 이 언어 불변이라 조회가 그대로 성립한다. */
export const GITHUB = ACCOUNTS.find((account) => account.platform === 'GitHub')!;
