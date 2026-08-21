// src/lib/i18n.ts — 로케일과 오리진의 단일 출처(SSOT).
//
// ★ 이 파일은 아무것도 import 하지 않는다.
//   astro.config.ts 와 tools/ 의 검증기가 이 파일을 직접 읽기 때문이다.
//   여기서 astro:content 나 브라우저 API 를 import 하면 설정 로드 자체가 죽는다.
//   의존 방향은 아래로만 흐른다:
//     i18n.ts → routes.ts → content.ts → 컴포넌트/페이지

/**
 * 사이트 오리진.
 * astro.config 의 site · robots.txt · giscus 테마 경로가 전부 여기서 나온다.
 *
 * 여기서 파생되지 않는 도메인 문자열이 세 곳 남아 있고, 셋 다 파생할 수 없는 이유가 있다:
 *   giscus.json            giscus.app 이 GitHub API 로 직접 읽는다 — 빌드가 개입할 수 없다.
 *   public/giscus/*.css    주석 안의 배포 주소. 코드가 아니라 사람용 안내다.
 *   RSS guid 네임스페이스   도메인을 바꿔도 ★바뀌면 안 되는★ 값이다(구독자 리더가 전 글을
 *                          새 글로 다시 띄운다). S3 에서 FEED_URN_NS 로 별도 동결한다.
 */
export const ORIGIN = 'https://blog.hwanyong.com';

/**
 * 활성 로케일. 이 배열의 순서가 사이트 전체의 정렬 순서다(hreflang · 스위처 · sitemap).
 *
 * 여기에 코드를 하나 추가하면 다음이 전부 컴파일 에러가 되어 "번역 없이 로케일을 켜는 것"
 * 자체가 불가능해진다: UI · POLICY_TEXT · LocalizedText · languageNames.
 */
export const LOCALE_CODES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALE_CODES)[number];

/** 기본 로케일 = 접두사 없는 정문. '/' 가 영어다. */
export const DEFAULT_LOCALE: Locale = 'en';

export interface LocaleMeta {
  /** <html lang> */
  htmlLang: string;
  /** og:locale. Open Graph 는 language_TERRITORY 형식만 받으므로 여기만 지역이 붙는다. */
  ogLocale: string;
  /**
   * <link hreflang> · sitemap · RSS <language>.
   * ★ 지역 서브태그를 붙이지 않는다(en-US 가 아니라 en). 이 사이트의 영어판은
   *   지역 변형이 아니라 유일한 영어판이고 독자는 전 세계다. en-US 로 쓰면 영국·인도·
   *   싱가포르 독자에 대한 매칭이 약해져 x-default 폴백으로 떠밀린다.
   */
  hreflang: string;
  /** giscus 위젯 UI 언어. 스레드는 언어 무관 통합이다 — 두 축은 독립이다. */
  giscusLang: string;
  /** 언어 스위처에 찍히는 글자. 계기판 표기라 번역하지 않는다. */
  label: string;
  /** 자기 언어로 쓴 언어 이름. 스위처의 접근성 이름에 쓴다. */
  endonym: string;
}

export const LOCALES: Record<Locale, LocaleMeta> = {
  en: { htmlLang: 'en', ogLocale: 'en_US', hreflang: 'en', giscusLang: 'en', label: 'EN', endonym: 'English' },
  ko: { htmlLang: 'ko', ogLocale: 'ko_KR', hreflang: 'ko', giscusLang: 'ko', label: 'KO', endonym: '한국어' },
};
