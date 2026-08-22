# 강의 축

강의는 네 단계다 — **과목 / 코스 / 차시 / 개정**.
다른 두 축(log · project)보다 한 단계씩 깊고, 목록이 줄이 아니라 갤러리다.

```
/lecture/                                        전체. 과목 섹션마다 코스 갤러리
/lecture/math/                                   과목. 코스 갤러리(쪽 나눔)
/lecture/math/linear-algebra/                    코스. 개요 본문 + 차시 갤러리
/lecture/math/linear-algebra/01-vectors/         차시. 그 언어의 최신 개정본
/lecture/math/linear-algebra/01-vectors/v1-0/    차시. 구 개정본
```

```
src/content/lecture/math/linear-algebra/en.md                    ← 코스 표지
src/content/lecture/math/linear-algebra/ko.md
src/content/lecture/math/linear-algebra/01-vectors/v1-0/en.md    ← 차시 개정본
src/content/lecture/math/linear-algebra/01-vectors/v1-0/ko.md
                    │    │              │          │    └ 로케일 (파일 이름)
                    │    │              │          └ 개정
                    │    │              └ 차시
                    │    └ 코스
                    └ 과목
```

**정체성은 전부 경로에서 나온다.** 프론트매터에 `subject` 도 `course` 도 `series` 도
적지 않는다 — 디렉터리 이름과 같은 사실을 두 벌 가지면 어긋나도 조용하기 때문이다.
컬렉션이 둘로 갈리는 것도 깊이(세 단계 / 다섯 단계)뿐이다.

---

## ★ URL 은 과목을 담고, 정체성은 담지 않는다

```
URL         /lecture/math/linear-algebra/01-vectors/     과목 포함
giscus      lecture:linear-algebra:01-vectors            과목 없음
RSS guid    urn:…:lecture:linear-algebra:01-vectors:ko   과목 없음
```

분류는 정의상 나중에 손보는 축이다. 정체성이 과목을 담으면 *"이 강의는 수학보다
CS 가 맞겠다"* 는 판단 한 번이 **댓글을 끊고 전 구독자에게 같은 글을 새 글로 다시 띄운다.**
지금 구조에서 재분류의 대가는 그것이 아니라 **옛 주소가 404 가 되고 검색엔진이
다시 색인하는 것** 뿐이다.

그 대가로 **코스 이름이 과목을 가로질러 유일해야 한다.** 두 과목에 같은 이름의 코스가
있으면 서로 다른 강의가 같은 댓글 스레드를 쓰게 된다.
`src/lib/content.ts` 의 `getLectureCourses` 가 빌드에서 그것을 막는다.

---

## 새 강의를 쓸 때

### 1. 코스 표지부터

```
src/content/lecture/<과목>/<코스>/en.md   ko.md
```

```yaml
---
title: 선형대수학
description: 벡터공간에서 고윳값까지, 한 학기 분량.
date: 2026-08-01
tags: ["math"]
thumbnail: /images/lecture/linear-algebra.png
---

이 강의는 … (개요 본문. 무엇을 배우는지 · 선수 과목 · 참고서)
```

- `<과목>` 은 `src/lib/subjects.ts` 의 슬러그여야 한다. 아니면 빌드가 죽는다.
- `<코스>` 는 소문자·숫자·하이픈, 숫자만은 불가, **사이트 전체에서 유일**.
- **`thumbnail` 은 필수다.** 목록이 갤러리라 그림 빠진 카드 하나가 격자를 무너뜨린다.

### 2. 차시

```
src/content/lecture/<과목>/<코스>/<차시>/<개정>/en.md   ko.md
```

```yaml
---
title: 벡터공간
description: 공리부터 기저까지.
date: 2026-08-02
version: "1.0"
tags: ["math"]
thumbnail: /images/lecture/linear-algebra-01.png
---
```

- **차시 순서는 날짜가 아니라 디렉터리 이름 오름차순이다.** 3강을 2강보다 먼저 쓸 수
  있기 때문이다. `01-vectors` `02-maps` `03-eigen` 처럼 **0 을 채운 번호로 시작**할 것 —
  `9-…` 와 `10-…` 이 섞이면 코드포인트 순서가 뒤집힌다.
- 차시 이름도 숫자만일 수 없다(`01` 불가, `01-vectors` 가능).
  URL 규칙 하나를 모든 세그먼트가 공유한다(`src/lib/routes.ts` 의 `URL_KEY`).
- `<개정>` 은 `v1-0` 처럼. 표시용 문자열은 프론트매터의 `version` 이 따로 갖는다.
- **그 언어의 최신 개정본이 그 차시의 루트 URL 을 갖는다.** 구버전만 세그먼트가 붙는다.

### 3. 두 언어

`pnpm run i18n:fill` 이 빠진 언어를 원문 사본으로 채운다(완전쌍 불변식).
표지도 차시도 같은 규칙이다 — 자세한 것은 `docs/i18n.md`.

### 4. 확인

```bash
pnpm run ci
```

---

## 빌드가 막는 것

| 상태 | 메시지가 가리키는 곳 |
|---|---|
| 과목 목록에 없는 디렉터리 | `강의의 첫 디렉터리는 과목이어야 합니다` + 쓸 수 있는 과목 목록 |
| 코스 이름이 과목을 가로질러 겹침 | `코스 이름이 과목을 가로질러 겹칩니다` + 겹친 두 과목 |
| 차시는 있는데 코스 표지가 없음 | `차시는 있는데 코스 표지가 없습니다` + 만들 경로 |
| 세그먼트가 숫자만 | `숫자만으로 이루어질 수 없습니다` |
| 코스가 0개인 과목에 URL 이 생김 | `카드가 하나도 없는 과목 화면` (tools/verify-site.ts) |

---

## 과목

| 슬러그 | 코드 | en | ko |
|---|---|---|---|
| `math` | `MATH` | Mathematics | 수학 |
| `computer-science` | `CS` | Computer Science | 컴퓨터과학 |
| `artificial-intelligence` | `AI` | Artificial Intelligence | 인공지능 |
| `earth-science` | `EARTH` | Earth Science | 지구과학 |
| `chemistry` | `CHEM` | Chemistry | 화학 |
| `physics` | `PHYS` | Physics | 물리 |
| `biology` | `BIO` | Biology | 생물 |

**코드는 번역하지 않는다.** 카드의 칩과 섹션 머리에 들어가는 계기판 어휘이고,
언어에 따라 폭이 달라지면 격자가 흐트러진다. 이름은 두 언어를 모두 갖는다.

### 과목을 하나 더 켤 때

`src/lib/subjects.ts` 의 `SUBJECT_SLUGS` 에 슬러그를 넣으면 `SUBJECTS` 가
**컴파일 에러**가 된다 — 코드와 두 언어 이름을 채우지 않으면 통과할 수 없다.
`Record<Subject, …>` 와 `Record<Locale, …>` 두 겹이 그것을 강제한다.

**과목 슬러그는 URL 이므로 공개 후 바꾸지 않는다.**

### 코스가 0개인 과목

**URL 을 만들지 않는다.** 전체 화면(`/lecture/`)에는 섹션 줄로 남아
`MATH  Mathematics  아직 공개한 강의가 없습니다 ————` 처럼 한 줄로 보인다.

빈 분류에 주소를 주면 sitemap 에 내용 없는 화면이 과목 수 × 로케일 수만큼 늘고
검색엔진에는 소프트 404 로 읽힌다. **축(lecture)을 감추지 않는 것과 다른 판단이다** —
축은 사이트의 뼈대이고 과목은 그 안의 분류다.

---

## 화면 규칙

| | |
|---|---|
| `/lecture/` | 쪽을 나누지 않는다. 과목이 이미 나눔의 축이라, 쪽까지 자르면 과목 섹션이 쪽 경계를 넘는다 |
| `/lecture/<과목>/` | 쪽을 나눈다(`PAGE_SIZE`). 한 축만 흐르는 화면이라 자를 수 있다 |
| 코스 화면 | 댓글이 없다. 질문은 차시에 붙는 것이 맞다 — 어느 차시 이야기인지가 드러나고 스레드가 갈라지지 않는다 |
| 홈·RSS | **차시** 단위로 한 줄. 발행되는 단위가 차시라 코스로 묶으면 새 차시가 나와도 구독자에게 아무 일도 일어나지 않는다 |
| 홈의 줄 | 제목 위에 코스 이름이 한 줄 붙는다(`.entry__context`). "벡터공간" 만 있으면 어느 강의인지 알 수 없다 |
