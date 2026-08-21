// src/lib/privacy.ts — 개인정보처리방침 본문의 단일 출처(SSOT).
//
// 왜 콘텐츠 컬렉션(markdown)이 아니라 여기인가:
//   이 문서는 "글" 이 아니라 사이트의 현재 구성을 서술한 것이다. 광고를 켜고 끄면
//   서술도 함께 달라져야 하는데, markdown 에 적어두면 site.ts 의 플래그와 조용히
//   어긋난다. 여기서 ADSENSE.enabled 를 직접 읽어, 문서가 늘 실제 구성과 맞게 한다.
//
// 배치만 하는 화면은 src/pages/privacy/index.astro 다 — profile.ts ↔ about 과 같은 구조.

import { ADSENSE, ANALYTICS } from './site';

export const POLICY = {
  /** 이 방침의 시행일. 내용을 고치면 반드시 함께 올릴 것. */
  effective: '2026-08-21',
  /** 공개 문의처 */
  contact: 'yoo.hwanyong@gmail.com',
} as const;

export const INTRO: readonly string[] = [
  '이 블로그는 회원가입과 로그인 기능이 없으며, 운영자가 직접 수집하거나 보관하는 개인정보가 없습니다.',
  '아래에 적은 항목은 모두 이용자의 브라우저가 제3자 서비스와 직접 주고받는 것이며, 운영자는 그 결과를 집계된 형태로만 열람합니다.',
];

export interface StorageRow {
  /** 저장되는 값의 이름(키) */
  name: string;
  /** 쿠키인지 로컬 저장소인지 — 지우는 방법이 다르므로 구분해서 적는다 */
  kind: string;
  owner: string;
  purpose: string;
  retention: string;
}

/**
 * 이 사이트가 이용자의 브라우저에 남기는 값의 전부.
 *
 * 2026-08-21 기준 실측: 저장소 전체에서 localStorage·sessionStorage·document.cookie
 * 사용처는 public/theme-init.js 와 src/scripts/theme.ts 두 곳뿐이고, 둘 다 같은
 * 키('mode')를 읽고 쓴다. 즉 자체 쿠키는 0개다.
 * 저장 코드를 새로 추가하면 이 표에도 반드시 한 줄을 추가할 것.
 */
export const STORAGE: readonly StorageRow[] = [
  {
    name: 'mode',
    kind: '로컬 저장소',
    owner: '이 사이트',
    purpose: '화면 조명 상태(REFLECT / EMIT) 기억',
    retention: '이용자가 지울 때까지',
  },
];

export const STORAGE_NOTE: readonly string[] = [
  '이 사이트가 자체적으로 설정하는 쿠키는 없습니다. 위 값은 쿠키가 아니라 로컬 저장소(local storage — 브라우저가 사이트별로 보관하는 저장 공간)에 담기며, 개인을 식별하지 않고 서버로 전송되지도 않습니다.',
  '브라우저 설정의 "사이트 데이터 삭제"로 언제든 지울 수 있습니다. 지워도 열람에는 아무 지장이 없고 화면 조명 상태만 기본값으로 돌아갑니다.',
];

export interface ThirdParty {
  name: string;
  /** 무엇을 위해 쓰는가 */
  purpose: string;
  /** 실제로 무엇이 오가는가 */
  detail: string;
  /** 쿠키를 쓰는가 — 이용자가 가장 궁금해하는 한 줄이라 따로 뺀다 */
  cookies: string;
  /** 각 사업자의 정책 문서 */
  policyHref: string;
  /**
   * 지금 실제로 동작 중인가.
   * site.ts 의 플래그를 그대로 읽는다 — 방침이 실제 구성보다 앞서 나가거나
   * 뒤처지는 일을 막기 위해서다. false 면 화면에 "현재 사용하지 않음" 이 붙는다.
   */
  active: boolean;
}

export const THIRD_PARTIES: readonly ThirdParty[] = [
  {
    name: 'Cloudflare Web Analytics',
    purpose: '방문 통계',
    detail:
      '페이지 주소, 유입 경로, 대략적인 국가, 기기와 브라우저 종류를 집계 형태로만 처리합니다. 개인을 특정하는 식별자를 만들지 않으므로 같은 사람이 다시 방문했는지도 알 수 없습니다.',
    cookies: '사용하지 않음',
    policyHref: 'https://www.cloudflare.com/privacypolicy/',
    active: ANALYTICS.enabled,
  },
  {
    name: 'giscus · GitHub Discussions',
    purpose: '댓글',
    detail:
      '글을 읽기만 할 때는 계정이 필요 없습니다. 댓글이나 반응을 남기려면 GitHub 로그인이 필요하며, 이때 GitHub 계정의 공개 정보(사용자명·프로필 사진)와 작성한 내용이 이 블로그 저장소의 GitHub Discussions 에 공개로 저장됩니다. 수정과 삭제는 GitHub 에서 직접 하실 수 있습니다.',
    cookies: 'GitHub 로그인 시 GitHub 이 자사 도메인에 설정',
    policyHref: 'https://docs.github.com/site-policy/privacy-policies/github-privacy-statement',
    active: true,
  },
  {
    name: 'Google AdSense',
    purpose: '광고',
    detail:
      '게재할 경우 Google 과 협력사가 쿠키를 사용해, 이 사이트와 다른 사이트의 방문 기록을 바탕으로 광고를 보여줄 수 있습니다. 맞춤형 광고는 Google 광고 설정(adssettings.google.com)에서 끌 수 있으며, 끄더라도 광고 자체는 계속 표시됩니다.',
    cookies: '게재 시 사용',
    policyHref: 'https://policies.google.com/technologies/ads',
    active: ADSENSE.enabled,
  },
];

export const RETENTION: readonly string[] = [
  '운영자가 직접 보관하는 개인정보가 없으므로 별도의 보유 기간과 파기 절차를 두지 않습니다.',
  '댓글은 GitHub 에, 방문 통계는 Cloudflare 에 각 사업자의 정책에 따라 보관됩니다.',
];

export const RIGHTS: readonly string[] = [
  '이용자는 자신의 개인정보에 대해 열람·정정·삭제·처리정지를 요구할 수 있습니다.',
  '댓글은 이용자 본인의 GitHub 계정으로 직접 수정하거나 삭제할 수 있습니다. 그 밖의 요청은 아래 문의처로 연락 주시면 지체 없이 처리하겠습니다.',
];

export const CHANGES: readonly string[] = [
  '이 방침의 내용이 바뀌면 변경 사항과 시행일을 이 페이지에 알립니다.',
];
