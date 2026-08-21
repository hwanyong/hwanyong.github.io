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

// 두 컬렉션이 공유하는 공통 필드 (SSOT)
const baseFields = {
  title: z.string(),
  description: z.string(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
};

/**
 * log — 일반 글 (시간축)
 * 파일 경로: src/content/log/<파일명>.md
 * URL:      /log/<id>/
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
 * work — 작업물 (개정축)
 * 파일 경로: src/content/work/<project>/<version-slug>.md
 * URL:      /work/<project>/ (개정 이력)  /work/<project>/<version-slug>/ (개정 상세)
 *
 * 같은 project 값을 가진 항목이 여러 version 으로 존재한다.
 */
const work = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
  schema: z.object({
    ...baseFields,
    // URL 세그먼트로 그대로 쓰이므로 소문자/숫자/하이픈만 허용해 강제한다.
    // 잘못된 값이 런타임이 아니라 빌드 시점에 걸린다.
    project: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      // Zod 4 의 커스텀 메시지 키는 message 가 아니라 error 다.
      error: 'project 는 소문자·숫자·하이픈만 사용할 수 있습니다. 예: orca-cli',
    }),
    // 화면 표시용 버전 문자열. 점을 포함해도 된다. 예: "1.0", "1.1"
    // URL 세그먼트로는 쓰지 않는다(파일명이 URL 을 결정한다).
    version: z.string(),
  }),
});

export const collections = { log, work };
