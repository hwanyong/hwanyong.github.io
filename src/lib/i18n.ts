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
