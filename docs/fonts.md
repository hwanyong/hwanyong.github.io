# 웹폰트 파이프라인

폰트 선언은 **생성물**이다. 손으로 고치는 파일은 `src/styles/fonts.css` 하나뿐이다.

```
src/styles/fonts/<slug>.lock.json   상류에서 온 사실     (기록 — 사람이 최소한만 손댄다)
src/styles/fonts/<slug>.css         그 사실에서 나온 선언 (생성물 — 절대 손대지 않는다)
src/styles/fonts/OFL-1.1.txt        라이선스 전문        (원문 그대로)
public/fonts/*.woff2                폰트 파일
public/fonts/OFL.txt                생성물 — 전문 + 패밀리별 저작권
src/styles/fonts.css                우리가 정한 것       (@import 와 --font-* 변수뿐)
```

## 명령

```bash
pnpm fonts:build          # 락 → CSS · OFL.txt 재생성
pnpm fonts:check          # ★ CI. 쓰지 않고 대조만 — 생성물이 락과 어긋나면 실패
pnpm fonts:fetch <slug>   # 상류를 다시 읽어 락 갱신 + 빠진 woff2 내려받기
```

`build` 는 네트워크를 치지 않는다. 상류 URL 이 언젠가 404 가 되어도 CI 가 죽지 않는다.

---

## ★ 가중치를 접는 규칙

같은 `(family, style, unicode-range)` 인데 `weight` 만 다른 선언이 **같은 파일**을 가리키면
가변 폰트를 여러 지점에 인스턴싱하는 것이므로 한 줄로 접는다:

```css
font-weight: 400 700;   /* 400 · 600 · 700 세 줄이 한 줄이 된다 */
```

**무조건 접으면 안 된다.** `weight` 마다 **다른 파일**이면 그것은 정적 인스턴스이고,
접으면 세 파일이 같은 범위를 주장해 마지막 선언이 이긴다 — 굵기가 통째로 사라진다.

실측(2026-08-21):

| 패밀리 | 가변 테이블 | 판정 |
|---|---|---|
| Noto Serif KR | `fvar` `gvar` `avar` `STAT` `HVAR` | 121 그룹이 모두 같은 파일 → **접는다** |
| IBM Plex Mono | 없음 | 400/500/600 이 각각 다른 파일 → **접지 않는다** |

생성기는 폰트를 안다고 가정하지 않는다. **파일이 같은가**로만 판정하므로
어떤 패밀리를 넣어도 옳게 갈린다.

이 접기는 네트워크를 아끼지 않는다(같은 URL 은 어차피 1회 fetch).
아끼는 것은 **CSS 크기**이고, 그 CSS 는 모든 페이지가 받는다 — gzip 72.8 KB → 26.0 KB.

---

## 화살표

`←` `→` `↵` `↩` 는 **언어 중립**이라 전용 페이스가 따로 있다.

- `←` 는 43.9 KB, `→` 는 42.3 KB 짜리 **한글 빈도 버킷** 안에 들어 있었다.
  화살표 하나 때문에 한글 조각을 받는 셈이었고 영어 페이지에서는 순수 낭비였다.
- `↵`(키캡)와 `↩`(각주 되돌아가기)는 **어느 서브셋에도 없어** 시스템 폰트로 폴백했다 —
  기기마다 모양이 달랐다.

Noto Sans Symbols 2 의 7.7 KB 서브셋 하나가 넷을 모두 덮는다.
`unicode-range` 를 `U+2190-21FF` 로 **좁혀서** 선언하므로(파일이 담는 것보다 좁게 선언하는
것은 안전하다) 화살표가 없는 페이지는 이 파일을 아예 받지 않는다.

패밀리를 바꿔도 같은 문제가 재발하므로 이 페이스는 유지한다.

---

## 패밀리를 하나 더 받을 때

1. `src/styles/fonts/<slug>.lock.json` 을 만든다. 처음에는 이만큼만 채운다:

```json
{
  "family": "Family Name",
  "slug": "family-name",
  "upstream": "https://fonts.googleapis.com/css2?family=Family+Name:wght@400..700&display=swap",
  "license": "SIL Open Font License 1.1",
  "copyright": "",
  "copyrightSource": "https://github.com/google/fonts/blob/main/ofl/familyname/OFL.txt",
  "subsets": []
}
```

2. `pnpm fonts:fetch family-name` — 상류를 읽어 `subsets` 를 채우고 woff2 를 내려받는다.
3. `copyright` 을 채운다. **Google 의 CSS 응답에는 저작권 줄이 없다**(실측) —
   `copyrightSource` 의 `OFL.txt` 첫 줄을 그대로 옮긴다.
4. `src/styles/fonts.css` 에 `@import './fonts/family-name.css';` 한 줄을 더한다.
5. `pnpm run ci`.

**393줄짜리 파일을 편집할 일이 없다.** 패밀리 추가 = 락 1개 + `@import` 1줄.

### 선택 필드

| 필드 | 쓰임 |
|---|---|
| `keepCovering` | 상류 서브셋 중 여기 적은 코드포인트를 담는 것만 받는다. 심볼 페이스처럼 "글리프 몇 개 때문에 받는" 경우 나머지는 순수 낭비다. |
| `declareRange` | 선언할 `unicode-range` 를 이것으로 좁힌다. 파일이 담는 것보다 좁게 선언하는 것은 안전하다. |
| `why` | 이 패밀리가 왜 있는지 한 문장. 다음 사람이 지워도 되는지 판단할 근거다. |

### 파일 이름 규칙

파일 이름은 **파일 바이트가 아니라 gstatic URL 의 xxhash64** 다.
`public/fonts` 의 기존 127개가 그렇게 지어져 있어 규칙을 유지한다 —
바꾸면 기존 파일이 전부 이름이 달라져 캐시가 통째로 무효화된다.

★ **상류 URL 은 폰트 버전이 오르면 바뀐다.** 실측: IBM Plex Mono 의 현재 상류 15개 URL 중
우리 파일과 이름이 맞는 것은 3개뿐이었다. 그래서 `fetch` 는 "같은 것을 다시 받는" 도구가
아니라 **"지금 상류가 주는 것을 받는"** 도구다. 돌리면 파일이 늘어날 수 있고,
`build` 가 어떤 락도 참조하지 않는 woff2 를 잡아 준다.

---

## ★ 3번째 언어의 본문 폰트

CJK 는 **코드포인트를 공유하지만 자형이 다르다.** 한국어 본문에 일본어·중국어를 그대로
같은 폰트로 그리면 그 언어 독자에게는 틀린 글자로 보인다. 그래서 언어별 패밀리가 필요하다.

**`--font-serif` 를 `:lang()` 으로 갈아끼우는 것만으로는 동작하지 않는다.**
`font-family` 선언이 `body` 한 곳에 있어, 커스텀 속성이 **그 자리에서** 계산값으로
치환되기 때문이다. 나중에 `:lang(ja)` 에서 변수를 바꿔도 이미 치환이 끝나 있다.

반드시 `font-family` 선언을 `:lang()` 규칙에 **함께** 둔다:

```css
/* 이렇게 하면 안 된다 — body 에서 이미 치환이 끝난다 */
:lang(ja) { --font-serif: 'Noto Serif JP'; }

/* 이렇게 한다 */
:lang(ja) {
  --font-serif: 'Noto Serif JP';
  font-family: var(--font-serif), serif;
}
```

`:root:lang(ja)` 가 아니라 맨 `:lang(ja)` 여야 한다 — `:root:lang()` 은 부분 `lang` 속성
(번역 없는 글의 `<article lang="ja">` 같은 것)에 매칭되지 않는다.
한 페이지 안에 두 언어가 섞이는 경우가 실제로 있으므로 이쪽이어야 한다.

화살표 페이스는 언어 중립이라 그대로 둔다.

---

## Astro 의 fonts API 를 쓰지 않는 이유

1. `Font.astro` 가 `<style set:html>` 로 하드코딩되어 `@font-face` 규칙이
   **매 페이지 HTML 에 인라인**된다. 한글 서브셋 때문에 그 CSS 가 238 KB 였다.
2. `preload` 옵션이 서브셋 121개를 **전부** preload 해 6.2 MB 를 강제로 받게 한다.

둘 다 config 로 막을 수 없다.

`preload` 는 우리도 하지 않는다. 어느 조각이 필요한지는 문서의 글자에 달려 있어
빌드 시점에 알 수 없고, 전부 preload 하면 2)번이 재발한다.
`unicode-range` 가 붙어 있어 브라우저가 실제로 쓰이는 조각만 내려받는다.
