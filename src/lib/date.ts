// src/lib/date.ts — 날짜 표기의 단일 출처(SSOT).
//
// 왜 timeZone 을 고정하는가:
// frontmatter 의 `date: 2026-08-20` 은 z.coerce.date() 를 거치며
// 2026-08-20T00:00:00.000Z (UTC 자정) 으로 파싱된다.
// 여기에 toLocaleDateString() 을 옵션 없이 부르면 "빌드를 돌린 기계의 시간대"로
// 변환되므로, UTC 서쪽(America/* 등)에서 빌드하면 하루 앞선 날짜가 찍힌다.
// (실측: TZ=America/Vancouver → "2026. 8. 19.")
// GitHub Actions 러너는 UTC 라 우연히 맞지만 로컬 빌드에서 어긋난다.
const DISPLAY_TIME_ZONE = 'UTC';

/** 목록·본문에 쓰는 한국어 날짜 표기. 예: 2026. 8. 20. */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('ko-KR', { timeZone: DISPLAY_TIME_ZONE });
}

/** <time datetime="..."> 속성용 ISO 날짜(YYYY-MM-DD). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
