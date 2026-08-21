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

export interface CareerEntry {
  /** 예: "2021.03 – 2024.02", "2024.03 – 재직 중" */
  period: string;
  company: string;
  role: string;
  /** 한 줄 설명. 무엇을 맡아 무엇을 남겼는가. */
  summary: string;
  /** 아직 실제 내용이 아니다. 화면에 자리표시자 표시가 붙는다. */
  draft?: boolean;
}

export interface Account {
  /** 서비스 이름. 예: YouTube, GitHub */
  platform: string;
  /** 화면에 그대로 찍히는 계정 표기. 예: @uhd_kr */
  handle: string;
  href: string;
  /** 이 계정이 무엇을 올리는 곳인지 한 줄. */
  note: string;
  /** public/ 기준 아바타 경로. 없으면 플랫폼 첫 글자로 플레이트를 그린다. */
  avatar?: string;
}

/** 직함. LinkedIn 헤드라인과 같은 값. */
export const ROLE = 'Software Engineer';

/** 소개 문단. paragraphs 를 실제 문장으로 바꾸고 draft 를 지울 것. */
export const INTRO = {
  draft: true,
  paragraphs: [
    '여기에 무엇을 하는 사람인지 두세 문장으로 적는다. 지금 문장은 자리표시자다.',
    '여기에 무엇에 관심이 있고 무엇을 만들어 왔는지 적는다. 지금 문장은 자리표시자다.',
  ],
} as const;

/**
 * 근무 이력. 최신순으로 적는다(화면은 배열 순서를 그대로 쓴다).
 * 전부 자리표시자이므로 실제 이력으로 통째로 교체할 것.
 */
export const CAREER: CareerEntry[] = [
  {
    period: '20XX.XX – 재직 중',
    company: '회사 이름',
    role: '직함',
    summary: '무엇을 맡아 무엇을 남겼는지 한 줄.',
    draft: true,
  },
  {
    period: '20XX.XX – 20XX.XX',
    company: '회사 이름',
    role: '직함',
    summary: '무엇을 맡아 무엇을 남겼는지 한 줄.',
    draft: true,
  },
  {
    period: '20XX.XX – 20XX.XX',
    company: '회사 이름',
    role: '직함',
    summary: '무엇을 맡아 무엇을 남겼는지 한 줄.',
    draft: true,
  },
];

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
    note: 'uhd_tech 에 올리는 것 말고 전부.',
    avatar: '/icon.png',
  },
  {
    platform: 'YouTube',
    handle: '@uhd_tech',
    href: 'https://www.youtube.com/@uhd_tech',
    note: '만든 것의 결과물 영상.',
    avatar: '/images/users/uhd.jpg',
  },
  {
    platform: 'GitHub',
    handle: 'hwanyong',
    href: 'https://github.com/hwanyong',
    note: '코드는 전부 여기.',
  },
  {
    platform: 'LinkedIn',
    handle: 'hwanyong',
    href: 'https://www.linkedin.com/in/hwanyong/',
    note: '경력과 프로젝트 이력.',
  },
];

/** 푸터가 쓰는 GitHub 계정. 목록에서 찾아 쓰므로 주소가 한 곳에만 있다. */
export const GITHUB = ACCOUNTS.find((account) => account.platform === 'GitHub')!;
