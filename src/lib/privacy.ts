// src/lib/privacy.ts — 개인정보처리방침의 단일 출처(SSOT).
//
// 왜 마크다운이 아닌가:
//   이 문서는 "글" 이 아니라 사이트의 현재 구성을 서술한 것이다. 광고를 켜고 끄면
//   서술도 함께 달라져야 하는데, 마크다운에 적어두면 site.ts 의 플래그와 조용히
//   어긋난다. 여기서 플래그를 직접 읽어 문서가 늘 실제 구성과 맞게 한다.
//
// 배치만 하는 화면은 src/pages/privacy/index.astro 다 — profile.ts ↔ about 과 같은 구조.
//
// ★ 이 파일에는 폴백이 없다. POLICY_TEXT[locale] 직접 인덱싱만 허용하며
//   `?? POLICY_TEXT[DEFAULT_LOCALE]` 같은 식이 소비처에 등장하면 규약 위반이다.
//   본문(log/project)과 달리 방침은 모든 로케일에 URL 이 반드시 있고,
//   그래서 텍스트도 반드시 있어야 한다. 없으면 컴파일이 죽는 것이 맞다.
import type { Locale } from './i18n';
import { ADSENSE, ANALYTICS, GISCUS } from './site';

/* ─────────────────────────────────────────────────────────────────────────
   언어 불변부 — Record<Locale,…> 밖.
   두 언어가 같은 사실을 가리키게 만드는 축이다.
   ───────────────────────────────────────────────────────────────────────── */

export const VENDOR_IDS = ['cloudflare', 'giscus', 'adsense'] as const;
export type VendorId = (typeof VENDOR_IDS)[number];

export interface Vendor {
  /** 고유명사 — 번역 대상이 아니다. */
  name: string;
  policyHref: string;
  /**
   * site.ts 플래그. 여기 한 곳에만 있으므로 두 언어가 절대 어긋날 수 없다.
   * → "영어판은 광고 게재 중 / 한국어판은 현재 사용하지 않음" 같은 모순 고지가
   *   타입상 불가능하다.
   */
  active: boolean;
}

export const VENDORS: Record<VendorId, Vendor> = {
  cloudflare: {
    name: 'Cloudflare Web Analytics',
    policyHref: 'https://www.cloudflare.com/privacypolicy/',
    active: ANALYTICS.enabled,
  },
  giscus: {
    name: 'giscus · GitHub Discussions',
    policyHref: 'https://docs.github.com/site-policy/privacy-policies/github-privacy-statement',
    active: GISCUS.enabled,
  },
  adsense: {
    name: 'Google AdSense',
    policyHref: 'https://policies.google.com/technologies/ads',
    active: ADSENSE.enabled,
  },
};

/**
 * 이 사이트가 이용자의 브라우저에 남기는 값의 전부.
 *
 * 실측(2026-08-21): 저장소 전체에서 localStorage·sessionStorage·document.cookie
 * 사용처는 public/theme-init.js · src/scripts/theme.ts · src/scripts/scan.ts 뿐이고
 * 키는 'mode' 와 'scan' 둘이다. 즉 자체 쿠키는 0개다.
 *
 * 그리고 theme-init.js 는 읽기만 한다 — 쓰기는 토글을 누를 때만 일어난다.
 * 조명도 무늬도 바꾸지 않은 방문자의 브라우저에는 아무것도 남지 않는다.
 *
 * ★ 저장 코드를 새로 추가하면 이 배열에 키를 추가할 것.
 *   추가하는 순간 POLICY_TEXT 의 두 언어가 모두 컴파일 에러를 내므로,
 *   설명을 안 쓰고 넘어갈 수가 없다.
 */
export const STORAGE_KEYS = ['mode', 'scan'] as const;
export type StorageKey = (typeof STORAGE_KEYS)[number];

/**
 * 이 방침이 원용하는 관할. 로케일별 선택이 아니라 사이트 사실이다.
 *
 * ★ 왜 언어별로 가르지 않는가:
 *   GDPR 은 읽는 언어가 아니라 정보주체의 소재로 적용된다. 한국어를 읽는 EEA 거주자가
 *   있고, 영어를 읽는 한국 거주자가 있다. 언어별로 관할을 가르면 두 페이지가 서로의
 *   번역이 아니게 되는데, hreflang 은 그 둘을 등가라고 선언한다 — 선언과 내용이 어긋난다.
 *   운영자는 한국에 있으므로 PIPA 가 항상 적용되고, EEA 방문자에게는 GDPR 이 적용된다.
 *   그래서 두 관할을 모두, 두 언어 모두에 싣는다.
 */
export const REGIMES = ['PIPA', 'GDPR'] as const;
export type Regime = (typeof REGIMES)[number];

export const POLICY = {
  /**
   * ★ string 이 아니라 Date 다. 화면 표기는 date.ts 의 formatDate 가 맡아
   *   사이트의 다른 모든 날짜와 같은 2026.08.21 형식으로 찍힌다.
   * ★ POLICY_TEXT 를 고치면 이 날짜를 반드시 함께 올린다 —
   *   changes.weWillPost 가 "내용이 바뀌면 시행일을 알린다" 고 스스로 선언하고 있어,
   *   안 올리면 방침이 자기 규칙을 어긴다.
   */
  effective: new Date('2026-08-21T00:00:00Z'),
  contact: 'yoo.hwanyong@gmail.com',
} as const;

/* ─────────────────────────────────────────────────────────────────────────
   언어 가변부 (1) 공통 골격 — 전부 키 있는 레코드.
   문단 하나를 빠뜨리면 컴파일이 죽는다.
   ───────────────────────────────────────────────────────────────────────── */

export type IntroKey = 'noAccount' | 'thirdPartyOnly';
export type StorageNoteKey = 'notCookie' | 'onlyIfToggled' | 'howToDelete';
export type RetentionKey = 'nothingHeld' | 'whereItLives';
export type ChangesKey = 'weWillPost';

export interface StorageRowText {
  /** 쿠키인지 로컬 저장소인지 — 지우는 방법이 다르므로 구분해서 적는다. */
  kind: string;
  owner: string;
  purpose: string;
  retention: string;
}

export interface VendorText {
  /** 무엇을 위해 쓰는가 */
  purpose: string;
  /** 실제로 무엇이 오가는가 */
  detail: string;
  /** 쿠키를 쓰는가 — 이용자가 가장 궁금해하는 한 줄이라 따로 뺀다 */
  cookies: string;
}

/* ─────────────────────────────────────────────────────────────────────────
   언어 가변부 (2) 관할 고지.
   두 관할이 모두 필수다 — 관할을 늘리면 두 언어가 함께 컴파일 에러를 낸다.
   ───────────────────────────────────────────────────────────────────────── */

/** 제목 한 줄 + 문단 여럿. */
export interface Block {
  label: string;
  paragraphs: readonly string[];
}

export interface PolicyRights {
  heading: string;
  /** 관할과 무관하게 성립하는 문단. */
  paragraphs: readonly string[];
  /**
   * 개인정보보호법(PIPA).
   * 운영자가 한국에 있으므로 방문자의 소재와 무관하게 항상 적용된다.
   */
  pipa: {
    label: string;
    paragraphs: readonly string[];
    /**
     * 개인정보 보호책임자(제31조)의 ★라벨만★ 여기 있다.
     * 이름은 SITE.author, 연락처는 POLICY.contact 가 이미 갖고 있다 —
     * 두 언어에 복제하면 한쪽만 고치는 드리프트가 생긴다.
     */
    officerLabel: string;
  };
  /**
   * EU 일반개인정보보호규정(GDPR).
   * 제13조가 요구하는 넷 — 관리자 신원 · 법적 근거 · 감독기관 불복 · 제3국 이전 —
   * 이 전부 필수 필드다. 하나라도 빼면 컴파일이 죽는다.
   */
  gdpr: {
    label: string;
    paragraphs: readonly string[];
    /** 관리자(제13조 제1항 (a))의 라벨만. 이름·연락처는 officerLabel 과 같은 이유로 없다. */
    controllerLabel: string;
    legalBasis: Block;
    transfers: Block;
    supervisoryAuthority: { label: string; text: string };
  };
}

export interface PolicyText {
  /* 화면 문구 */
  title: string;
  lead: string;
  metaDescription: string;
  headings: Record<'storage' | 'thirdParty' | 'retention' | 'changes', string>;
  tableHead: Record<'name' | 'kind' | 'owner' | 'purpose' | 'retention', string>;
  inactiveNote: string;
  effectiveLabel: string;
  effectiveDateLabel: string;
  contactLabel: string;
  purposeLabel: string;
  cookiesLabel: string;
  vendorPolicyLink: (name: string) => string;

  /* 본문 공통 골격 */
  intro: Record<IntroKey, string>;
  storage: Record<StorageKey, StorageRowText>;
  storageNote: Record<StorageNoteKey, string>;
  vendors: Record<VendorId, VendorText>;
  retention: Record<RetentionKey, string>;
  changes: Record<ChangesKey, string>;

  /* 관할 고지 */
  rights: PolicyRights;
}

/* ─────────────────────────────────────────────────────────────────────────
   한국어 판본
   ───────────────────────────────────────────────────────────────────────── */

const ko: PolicyText = {
  title: '개인정보처리방침',
  lead: '이 블로그가 어떤 정보를 어떻게 다루는지 적어둔 문서입니다.',
  metaDescription: '이 블로그가 어떤 정보를 어떻게 다루는지에 대한 안내',

  headings: {
    storage: '브라우저에 남는 값',
    thirdParty: '제3자 서비스',
    retention: '보유와 파기',
    changes: '변경',
  },
  tableHead: { name: '이름', kind: '종류', owner: '주체', purpose: '목적', retention: '보관' },
  inactiveNote: '현재 사용하지 않음',
  effectiveLabel: '시행',
  effectiveDateLabel: '시행일',
  contactLabel: '문의',
  purposeLabel: '용도',
  cookiesLabel: '쿠키',
  vendorPolicyLink: (name) => `${name} 개인정보 정책`,

  intro: {
    noAccount:
      '이 블로그는 회원가입과 로그인 기능이 없으며, 운영자가 직접 수집하거나 보관하는 개인정보가 없습니다.',
    thirdPartyOnly:
      '아래에 적은 항목은 모두 이용자의 브라우저가 제3자 서비스와 직접 주고받는 것이며, 운영자는 그 결과를 집계된 형태로만 열람합니다.',
  },

  storage: {
    mode: {
      kind: '로컬 저장소',
      owner: '이 사이트',
      purpose: '화면 조명 상태(REFLECT / EMIT) 기억',
      retention: '이용자가 지울 때까지',
    },
    scan: {
      kind: '로컬 저장소',
      owner: '이 사이트',
      purpose: '화면 무늬(주사선) 선택 기억',
      retention: '이용자가 지울 때까지',
    },
  },
  storageNote: {
    notCookie:
      '이 사이트가 자체적으로 설정하는 쿠키는 없습니다. 위 값은 쿠키가 아니라 로컬 저장소(local storage — 브라우저가 사이트별로 보관하는 저장 공간)에 담기며, 개인을 식별하지 않고 서버로 전송되지도 않습니다.',
    onlyIfToggled:
      '그나마도 이용자가 화면 조명이나 무늬를 직접 바꿨을 때만 기록됩니다. 바꾸지 않고 읽기만 하면 브라우저에 아무것도 남지 않습니다.',
    howToDelete:
      '브라우저 설정의 "사이트 데이터 삭제"로 언제든 지울 수 있습니다. 지워도 열람에는 아무 지장이 없고 화면 설정만 기본값으로 돌아갑니다.',
  },

  vendors: {
    cloudflare: {
      purpose: '방문 통계',
      detail:
        '페이지 주소, 유입 경로, 대략적인 국가, 기기와 브라우저 종류를 집계 형태로만 처리합니다. 개인을 특정하는 식별자를 만들지 않으므로 같은 사람이 다시 방문했는지도 알 수 없습니다.',
      cookies: '사용하지 않음',
    },
    giscus: {
      purpose: '댓글',
      detail:
        '글을 읽기만 할 때는 계정이 필요 없습니다. 댓글이나 반응을 남기려면 GitHub 로그인이 필요하며, 이때 GitHub 계정의 공개 정보(사용자명·프로필 사진)와 작성한 내용이 이 블로그 저장소의 GitHub Discussions 에 공개로 저장됩니다. 수정과 삭제는 GitHub 에서 직접 하실 수 있습니다.',
      cookies: 'GitHub 로그인 시 GitHub 이 자사 도메인에 설정',
    },
    adsense: {
      purpose: '광고',
      detail:
        '게재할 경우 Google 과 협력사가 쿠키를 사용해, 이 사이트와 다른 사이트의 방문 기록을 바탕으로 광고를 보여줄 수 있습니다. 맞춤형 광고는 Google 광고 설정(adssettings.google.com)에서 끌 수 있고, 미국 소재 사업자의 맞춤형 광고는 www.aboutads.info 에서도 끌 수 있습니다. 끄더라도 광고 자체는 계속 표시됩니다.',
      cookies: '게재 시 사용',
    },
  },

  retention: {
    nothingHeld:
      '운영자가 직접 보관하는 개인정보가 없으므로 별도의 보유 기간과 파기 절차를 두지 않습니다.',
    whereItLives: '댓글은 GitHub 에, 방문 통계는 Cloudflare 에 각 사업자의 정책에 따라 보관됩니다.',
  },

  changes: {
    weWillPost: '이 방침의 내용이 바뀌면 변경 사항과 시행일을 이 페이지에 알립니다.',
  },

  rights: {
    heading: '이용자의 권리와 문의',
    paragraphs: [
      '댓글은 이용자 본인의 GitHub 계정으로 직접 수정하거나 삭제할 수 있습니다. 그 밖의 요청은 아래 문의처로 연락 주시면 지체 없이 처리하겠습니다.',
    ],
    pipa: {
      label: '개인정보보호법 (대한민국)',
      paragraphs: [
        '운영자가 대한민국에 있으므로 이 사이트에는 개인정보보호법이 적용됩니다.',
        '이용자는 자신의 개인정보에 대해 열람·정정·삭제·처리정지를 요구할 수 있습니다.',
      ],
      officerLabel: '개인정보 보호책임자',
    },
    gdpr: {
      label: 'EU 일반개인정보보호규정 (GDPR)',
      paragraphs: [
        '유럽경제지역(EEA)에 계신 방문자에게는 GDPR 이 적용됩니다. 이 경우 열람·정정·삭제·처리 제한에 더해 데이터 이동권과 처리에 대한 반대권을 갖습니다.',
        '동의를 근거로 처리되는 항목은 언제든 동의를 철회할 수 있으며, 철회는 그 전까지 이루어진 처리의 적법성에 영향을 주지 않습니다.',
      ],
      controllerLabel: '관리자 (controller)',
      legalBasis: {
        label: '처리의 법적 근거',
        paragraphs: [
          '댓글 — 이용자가 GitHub 로 로그인해 직접 남길 때만 처리됩니다. 근거는 동의(제6조 제1항 (a))입니다.',
          '방문 통계 — 개인을 식별하지 않는 집계 통계입니다. 근거는 사이트의 운영 현황을 파악하려는 정당한 이익(제6조 제1항 (f))입니다.',
          '광고 — 현재 게재하지 않습니다. 게재하게 되면 근거는 동의(제6조 제1항 (a))이며, 동의를 받는 절차를 그때 이 페이지에 함께 안내합니다.',
        ],
      },
      transfers: {
        label: '유럽경제지역 밖으로의 이전',
        paragraphs: [
          '위에 적은 제3자 서비스는 모두 유럽경제지역 밖(미국)에 설립된 사업자가 운영합니다. 따라서 해당 처리가 일어나는 경우 개인정보가 유럽경제지역 밖으로 이전됩니다.',
          '각 사업자는 자사 개인정보 정책에서 그 이전의 근거를 밝히고 있습니다. 위 제3자 서비스 절의 링크에서 확인하실 수 있습니다.',
        ],
      },
      supervisoryAuthority: {
        label: '감독기관에 대한 이의 제기',
        text: '이용자는 거주하거나 근무하는 회원국의 감독기관, 또는 침해가 발생했다고 보는 곳의 감독기관에 이의를 제기할 수 있습니다.',
      },
    },
  },
};

/* ─────────────────────────────────────────────────────────────────────────
   영어 판본 — 한국어판과 같은 사실을 말한다. 조항 수도 같다.

   ★ 이것은 운영자가 방문자에게 하는 법적 고지다. 배포 전에 반드시 통독하고,
     사실과 다른 문장이 있으면 고칠 것. 특히 vendors.*.detail 세 문단은
     "실제로 무엇이 오가는가" 를 서술하므로 구성이 바뀌면 함께 바뀌어야 한다.
   ───────────────────────────────────────────────────────────────────────── */

const en: PolicyText = {
  title: 'Privacy',
  lead: 'What this blog does and does not do with your data.',
  metaDescription: 'What information this blog handles, and how.',

  headings: {
    storage: 'What is stored in your browser',
    thirdParty: 'Third-party services',
    retention: 'Retention and deletion',
    changes: 'Changes',
  },
  tableHead: {
    name: 'Name',
    kind: 'Kind',
    owner: 'Set by',
    purpose: 'Purpose',
    retention: 'Kept for',
  },
  inactiveNote: 'not currently in use',
  effectiveLabel: 'Effective',
  effectiveDateLabel: 'Effective from',
  contactLabel: 'Contact',
  purposeLabel: 'Purpose',
  cookiesLabel: 'Cookies',
  vendorPolicyLink: (name) => `${name} privacy policy`,

  intro: {
    noAccount:
      'This blog has no sign-up and no log-in. There is no personal data that the operator collects or holds directly.',
    thirdPartyOnly:
      'Everything listed below is exchanged directly between your browser and a third-party service. The operator only ever sees the aggregate result.',
  },

  storage: {
    mode: {
      kind: 'Local storage',
      owner: 'This site',
      purpose: 'Remembers the screen lighting state (REFLECT / EMIT)',
      retention: 'Until you delete it',
    },
    scan: {
      kind: 'Local storage',
      owner: 'This site',
      purpose: 'Remembers the screen pattern (scanlines) you chose',
      retention: 'Until you delete it',
    },
  },
  storageNote: {
    notCookie:
      'This site sets no cookies of its own. The values above are held in local storage — the space a browser keeps per site — not in cookies. They identify no one and are never sent to a server.',
    onlyIfToggled:
      'Even those are written only if you change the lighting or the pattern yourself. If you just read, nothing is left in your browser at all.',
    howToDelete:
      'You can clear them at any time through your browser’s "delete site data" setting. Nothing about reading the site changes; only the screen settings return to their defaults.',
  },

  vendors: {
    cloudflare: {
      purpose: 'Visit statistics',
      detail:
        'Processes the page address, referrer, approximate country, and device and browser type, in aggregate form only. It builds no identifier that singles anyone out, so it cannot tell whether the same person has visited before.',
      cookies: 'None',
    },
    giscus: {
      purpose: 'Comments',
      detail:
        'No account is needed to read. Leaving a comment or a reaction requires a GitHub log-in, and at that point the public information on your GitHub account (username and profile picture) and what you wrote are stored publicly in this blog’s GitHub Discussions. You can edit or delete them yourself on GitHub.',
      cookies: 'Set by GitHub on its own domain when you log in',
    },
    adsense: {
      purpose: 'Advertising',
      detail:
        'If ads are served, Google and its partners may use cookies to show ads based on your visits to this and other sites. You can turn off personalised advertising in Google Ad Settings (adssettings.google.com), and personalised advertising from US-based vendors at www.aboutads.info. Turning it off does not remove the ads themselves.',
      cookies: 'Used when ads are served',
    },
  },

  retention: {
    nothingHeld:
      'The operator holds no personal data directly, so there is no separate retention period or deletion procedure to state.',
    whereItLives:
      'Comments live at GitHub and visit statistics at Cloudflare, each kept under that company’s own policy.',
  },

  changes: {
    weWillPost:
      'If this policy changes, the change and the date it takes effect will be posted on this page.',
  },

  rights: {
    heading: 'Your rights and how to reach us',
    paragraphs: [
      'You can edit or delete your own comments directly with your GitHub account. For anything else, write to the address below and it will be handled without delay.',
    ],
    pipa: {
      label: 'Personal Information Protection Act (Republic of Korea)',
      paragraphs: [
        'The operator is based in the Republic of Korea, so the Personal Information Protection Act applies to this site.',
        'You may request access to your personal information, and its correction, deletion, or the suspension of its processing.',
      ],
      officerLabel: 'Privacy officer',
    },
    gdpr: {
      label: 'General Data Protection Regulation (EU)',
      paragraphs: [
        'If you are in the European Economic Area, the GDPR applies to you. Alongside access, rectification, erasure, and restriction of processing, you have the right to data portability and the right to object to processing.',
        'Where processing rests on consent you may withdraw it at any time, and doing so does not affect the lawfulness of processing carried out before the withdrawal.',
      ],
      controllerLabel: 'Controller',
      legalBasis: {
        label: 'Legal basis for processing',
        paragraphs: [
          'Comments — processed only when you log in with GitHub and write one yourself. The basis is consent, Article 6(1)(a).',
          'Visit statistics — aggregate figures that identify no one. The basis is the legitimate interest of understanding how the site is used, Article 6(1)(f).',
          'Advertising — not currently served. If it is, the basis will be consent, Article 6(1)(a), and how that consent is obtained will be described on this page at the same time.',
        ],
      },
      transfers: {
        label: 'Transfers outside the European Economic Area',
        paragraphs: [
          'Every third-party service listed above is operated by a company established outside the European Economic Area, in the United States. Where that processing takes place, personal data is transferred out of the EEA.',
          'Each company states the basis for that transfer in its own privacy policy. The links in the third-party services section above lead to them.',
        ],
      },
      supervisoryAuthority: {
        label: 'Lodging a complaint',
        text: 'You may lodge a complaint with the supervisory authority of the member state where you live or work, or where you believe an infringement took place.',
      },
    },
  },
};

/**
 * ★ Partial 이 아니다. 로케일을 늘리면 두 언어가 아니라 세 언어를 요구한다 —
 *   즉 번역 없이는 로케일을 켤 수 없다.
 */
export const POLICY_TEXT: Record<Locale, PolicyText> = { en, ko };
