// src/pages/robots.txt.ts — 크롤러 규칙.
//
// public/robots.txt 를 라우트로 바꾼 이유:
//   정적 파일은 TS 상수를 읽을 수 없어 Sitemap 줄의 도메인이 ORIGIN 과 따로 살았다.
//   도메인을 바꾸는 날 한쪽만 고치면 검색엔진이 죽은 주소의 sitemap 을 계속 물어본다.
//
// ★ public/google1af69c42d9e600f9.html 은 절대 같이 지우지 말 것 —
//   Search Console 소유권 확인 파일이고, 지우면 소유권이 풀린다.
import type { APIContext } from 'astro';
import { ORIGIN } from '../lib/i18n';

export const GET = (context: APIContext): Response =>
  new Response(
    'User-agent: *\nAllow: /\n\n' +
      // AdSense 크롤러. 광고를 끈 동안에도 남겨 둔다 — 켜는 날 심사가 이 줄을 본다.
      'User-agent: Mediapartners-Google\nAllow: /\n\n' +
      `Sitemap: ${new URL('sitemap-index.xml', context.site ?? ORIGIN).href}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
