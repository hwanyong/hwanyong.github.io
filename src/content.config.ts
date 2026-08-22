// src/content.config.ts
//
// 경로가 고정이다. `src/content/config.ts` 가 아니다.
//   - 신규 경로 파일이 없고 구경로 파일만 있으면 LegacyContentConfigError 로 빌드가 죽는다.
//   - 두 파일이 공존하면 구경로 파일은 "아무 경고 없이" 무시된다.
//     → 마이그레이션 시 구경로 파일은 반드시 삭제할 것.
//
// z 는 'astro:content' 가 아니라 'astro/zod' 에서 import 한다(Zod 4 재수출).
// zod 를 별도로 설치하지 말 것.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { LOCALE_CODES } from './lib/i18n';

/**
 * 축이 셋이다.
 *   log     — 시간축. 날짜순으로 쌓이기만 한다.
 *   lecture — 과목 / 코스 / 차시 / 개정. 컬렉션이 둘이다(표지와 차시).
 *   project — 계열 / 개정.
 *
 * ★ 정체성은 전부 ★경로★ 에서 나온다. 프론트매터에 series 도 subject 도 course 도
 *   적지 않는다 — 디렉터리 이름과 같은 사실을 두 벌 갖게 되고, 어긋나도 조용하다.
 *   로케일도 같은 이유로 파일 이름이 유일한 출처다.
 *
 * 개정본을 갖는 둘(lecture 차시 · project)은 화면 골격이 같다. 같은 것을 두 번 쓰지
 * 않도록 공통 필드를 revisionFields 로 묶고, 축마다 다른 것만 각자 얹는다.
 */

// 세 컬렉션이 모두 공유하는 필드 (SSOT)
const baseFields = {
  title: z.string(),
  description: z.string(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  /**
   * 이 판본이 아직 번역되지 않은 사본임을 밝힌다. 값은 원문이 있는 로케일이다.
   *
   * ★ lang 필드가 아니다. 이 파일이 어느 언어인지는 파일 이름(en.md · ko.md)이
   *   유일하게 정한다 — 두 곳에 적으면 어긋날 수 있고, 어긋나면 hreflang 이 거짓말을 한다.
   *   이 필드가 말하는 것은 "무슨 언어인가" 가 아니라 "번역되었는가" 다.
   *
   * 넣고 지우는 것은 tools/i18n-fill.ts 와 사람이다. 번역을 마치면 이 줄을 지운다.
   * tools/i18n-verify.ts 가 이 값과 원문 본문의 동기 상태를 검사한다.
   */
  untranslated: z.enum(LOCALE_CODES).optional(),
};

// 개정본을 갖는 둘이 공유하는 필드
//
// ★ series 필드는 없다. 개정 묶음의 키는 ★버전 디렉터리 위의 경로 전부★ 이며
//   content.ts 의 revisionKeyOf 가 그것을 뽑는다. 축마다 깊이가 다르지만
//   (project=1단, lecture=3단) 규칙은 하나다.
const revisionFields = {
  ...baseFields,
  /**
   * 화면 표시용 버전 문자열. 점을 포함해도 된다. 예: "1.0", "1.1"
   * URL 세그먼트로는 쓰지 않는다(디렉터리 이름이 URL 을 결정한다).
   */
  version: z.string(),
};

/**
 * log — 개인 글·생각 (시간축)
 * 파일 경로: src/content/log/<groupKey>/<locale>.md
 * URL:      /log/<groupKey>/  ·  /ko/log/<groupKey>/
 *
 * 패턴을 `**\/*.md` 로 좁힌 이유: `.mdx` 를 포함시키면 @astrojs/mdx 통합 설치가
 * 필수가 되고, 미설치 상태에서 .mdx 파일이 들어오면 빌드가 깨진다.
 * MDX 가 필요해지면 `pnpm add @astrojs/mdx` 후 패턴을 넓힌다.
 */
const log = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/log' }),
  schema: z.object({
    ...baseFields,
  }),
});

/**
 * lectureCourse — 코스 표지 (강의 하나의 얼굴)
 * 파일 경로: src/content/lecture/<subject>/<course>/<locale>.md
 * URL:      /lecture/<subject>/<course>/
 *
 * 본문은 그 코스의 개요다 — 무엇을 배우는지 · 선수 과목 · 참고서.
 * 차시 갤러리가 이 본문 아래에 붙는다.
 *
 * ★ 패턴에 ** 를 쓰지 않는다. 별 하나는 / 를 넘지 않으므로 별 셋짜리 패턴은 정확히
 *   "과목 / 코스 / 로케일.md" 세 단계만 잡는다. 차시 파일은 다섯 단계라 걸리지 않는다.
 *   두 컬렉션이 같은 base 를 보면서 ★깊이로★ 갈리는 것이 이 설계의 전부다.
 */
const lectureCourse = defineCollection({
  loader: glob({ pattern: '*/*/*.md', base: './src/content/lecture' }),
  schema: z.object({
    ...baseFields,
    /**
     * 갤러리 카드의 그림. public/ 기준 절대 경로. ★필수★ 다.
     * 강의 목록은 갤러리라 그림이 빠진 카드가 하나만 있어도 격자가 무너진다.
     * (project 의 thumbnail 이 선택인 것과 다르다 — 그쪽은 줄 목록이라
     *  Thumb 의 이름 플레이트로 자리를 지킬 수 있다.)
     */
    thumbnail: z.string().startsWith('/'),
    /**
     * 이 강의가 파생된 project 축 계열의 슬러그. 선택.
     *
     * ★ 정체성이 아니라 ★관계★ 다. 프론트매터 한 곳(강의 표지)에만 적고,
     *   content.ts 의 getLectureCourses 가 그 계열이 실재하는지 빌드에서 강제한다
     *   (없으면 죽는다 — 끊긴 링크를 배포하지 않는다). 링크는 양방향으로 렌더된다:
     *   표지에 "바탕 프로젝트 →", 프로젝트 상세에 "딸림 강의 →".
     *   역방향은 프로젝트 쪽에 아무것도 적지 않고 이 필드를 되짚어 만든다.
     */
    project: z.string().optional(),
  }),
});

/**
 * lecture — 차시의 개정본
 * 파일 경로: src/content/lecture/<subject>/<course>/<session>/<version-slug>/<locale>.md
 * URL:      /lecture/<subject>/<course>/<session>/            (최신 개정본)
 *           /lecture/<subject>/<course>/<session>/<version-slug>/  (구 개정본)
 *
 * 차시 순서는 날짜가 아니라 ★디렉터리 이름 오름차순★ 이다(01-… 02-… 03-…).
 * 강의는 나중에 쓴 차시가 먼저 오는 것이 아니기 때문이다.
 */
const lecture = defineCollection({
  loader: glob({ pattern: '*/*/*/*/*.md', base: './src/content/lecture' }),
  schema: z.object({
    ...revisionFields,
    /** 갤러리 카드의 그림. 코스 표지와 같은 이유로 필수다. */
    thumbnail: z.string().startsWith('/'),
  }),
});

/**
 * project — 개인 프로젝트 (개정축)
 * 파일 경로: src/content/project/<series>/<version-slug>/<locale>.md
 *           (series 는 디렉터리 이름이다. 프론트매터에 적지 않는다.)
 * URL:      /project/<series>/ (최신)  /project/<series>/<version-slug>/ (구버전)
 *           ko 는 앞에 /ko 가 붙는다.
 *
 * stack·links 는 이 축에만 있다. 강의에는 기술 스택도 저장소 링크도 없다.
 * 두 필드 모두 상세 화면에 실제로 렌더된다 — 화면에 나오지 않는 필드는 두지 않는다.
 */
const project = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/project' }),
  schema: z.object({
    ...revisionFields,
    /** 사용 기술. 상세 화면 머리에 나열된다. */
    stack: z.array(z.string()).default([]),
    /**
     * 대표 이미지. public/ 기준 절대 경로.
     * 목록의 썸네일이자 영상이 있을 때는 재생 전 포스터로도 쓰인다.
     * 비워 두면 목록이 이름으로 플레이트를 그린다 — 없는 그림을 지어내지 않는다.
     */
    thumbnail: z.string().startsWith('/').optional(),
    /**
     * YouTube 영상. 링크가 아니라 상세 화면에서 재생되는 대상이라 links 와 분리한다.
     * 재생 전에는 thumbnail 만 그리고, 누를 때 iframe 을 만든다(src/scripts/video.ts).
     */
    video: z
      .object({
        /** YouTube video id. 전체 URL 이 아니다. 임베드 주소를 코드가 만든다. */
        id: z.string().regex(/^[A-Za-z0-9_-]{11}$/, {
          error: 'YouTube video id 는 11자여야 합니다. 예: 0lE4-jZ9hTQ',
        }),
        title: z.string(),
      })
      .optional(),
    /** 외부 링크. 있는 것만 채우면 있는 것만 렌더된다. */
    // Zod 4 에서 문자열 포맷 검사는 z.string().url() 이 아니라 최상위 z.url() 이다
    // (전자는 deprecated). astro/zod 가 Zod 4 를 재수출하므로 그대로 쓸 수 있다.
    links: z
      .object({
        repo: z.url().optional(),
        demo: z.url().optional(),
        package: z.url().optional(),
      })
      .default({}),
  }),
});

export const collections = { log, lectureCourse, lecture, project };
