// src/lib/date.ts — 날짜 표기의 단일 출처(SSOT).
//
// frontmatter 의 `date: 2026-08-20` 은 z.coerce.date() 를 거치며
// 2026-08-20T00:00:00.000Z (UTC 자정) 으로 파싱된다.
// 여기에 지역 getter 나 옵션 없는 toLocaleDateString() 을 쓰면
// "빌드를 돌린 기계의 시간대"로 변환되므로, UTC 서쪽(America/* 등)에서
// 빌드하면 하루 앞선 날짜가 찍힌다(실측: TZ=America/Vancouver → 2026.08.19).
// GitHub Actions 러너는 UTC 라 우연히 맞지만 로컬 빌드에서 어긋난다.
// → 이 파일의 모든 함수는 getUTC* 만 쓴다.

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * 목록·본문에 쓰는 날짜 표기. 예: 2026.08.20
 *
 * toLocaleDateString('ko-KR') 의 "2026. 8. 20." 대신 자리수를 고정한 이유:
 * 날짜는 모노스페이스로 찍히는 메타데이터라 목록에서 세로로 줄이 맞아야 한다.
 * 월·일이 한 자리일 때 폭이 달라지면 눈금처럼 읽히던 열이 흐트러진다.
 */
export const formatDate = (date: Date): string =>
  `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;

/** <time datetime="..."> 속성용 ISO 날짜(YYYY-MM-DD). */
export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
