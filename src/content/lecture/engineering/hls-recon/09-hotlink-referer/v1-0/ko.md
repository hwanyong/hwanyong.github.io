---
title: "핫링크 차단의 해부"
description: "Referer 라는 자기 신고"
date: 2026-06-08
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-09-hotlink-referer.svg
---
## 9.0 이 장에서 답할 것

1. 브라우저에서는 열리는 주소가 도구에서는 왜 **404** 로 돌아오는가
2. 왜 요청 사슬의 단계마다 Referer 가 달라야 하는가 — 하나라도 비면 무엇이 깨지는가
3. 클라이언트가 보내는 값으로 접근을 통제할 수 있는가
4. 원리적으로 약한 통제가 왜 이렇게 널리 쓰이는가 — 무엇에 대해서는 실제로 강한가
5. 요청마다 헤더를 갈아 끼우는 코드는 어떤 구조를 요구하는가

---

## 9.1 문제 — 브라우저에서는 열리는데 도구로는 404

개발자도구 Network 탭에서 `.m3u8` 주소를 복사해 그대로 `curl` 에 넣으면 이렇게 된다.

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://cdn.example/hls/9f3a/master.m3u8
404
```

같은 주소를 브라우저 탭에 붙여넣으면 재생된다. **주소는 한 글자도 다르지 않다.**
달라진 것은 요청에 실린 헤더뿐이다.

여기서 진단을 어렵게 만드는 것은 차단 그 자체가 아니라 **차단이 입은 옷**이다.

| 상태 | 서버가 주장하는 것 | 받은 쪽이 다음에 하는 일 |
|---|---|---|
| `403 Forbidden` | 자원은 있고, 너에게 권한이 없다 | **자격 조건을 찾는다** — 헤더·쿠키·토큰 |
| `404 Not Found` | 그런 자원이 없다 | **주소를 의심한다** — 해시·경로·오타·만료 |

404 를 받은 사람은 존재하지 않는 문제를 찾는다. 해시를 다시 떠오고, 경로를 다시 세고,
토큰을 다시 발급받는다. 정작 빠진 것은 **보내지 않은 헤더 한 줄**이다.

이 저장소는 그 실측을 주석으로 박아 두었다.

```python
# series.py:104-105
    브라우저가 보내는 것과 같은 값을 보내야 한다. 하나라도 비면 서버가 404 로
    돌려보내는데, 없는 페이지처럼 보여서 원인을 짚기 어렵다.
```

제5장에서 다룬 **상태 코드의 의미론적 붕괴**가 여기서 방향만 바꿔 나타난다.
제5장의 사례는 "`200` 인데 실패"였고, 이 장의 사례는 "`404` 인데 자원은 멀쩡히 있다"다.
두 경우 모두 상태 코드가 **참이 아닌 이야기**를 하고 있으며, 판단의 근거로 쓸 수 없다.

그래서 이 도구의 실패 진단은 Referer 를 원인 후보의 **첫 줄**에 올린다.

```python
# cli.py:94-96
        "  흔한 원인:",
        "    · Referer/Origin 검증 — --referer 'https://원본페이지/' 를 붙일 것",
        "    · 쿠키·인증 필요 — 브라우저의 Cookie 헤더 값을 --cookie '...' 로 붙일 것",
```

그리고 그 안내가 사라지지 않도록 회귀 테스트로 고정해 두었다.

```bash
# tests/run.sh:205
grep -q 'Referer' "$DIAG" && ok "해결 방법 안내" || bad "해결 방법 미안내"
```

**진단 문구를 테스트로 고정한다**는 발상 자체가 이 문제의 성격을 말해 준다. 원인이
헤더인데 증상이 404 라면, 사람이 스스로 그 연결을 짓기를 기대할 수 없다. 도구가
말해 줘야 한다.

세그먼트 수신 단계에도 같은 판단이 들어 있다.

```python
# cli.py:471
        raise SystemExit("수신된 세그먼트가 없다 — 토큰 만료 또는 Referer 검증 실패 가능성")
```

"세그먼트가 없다"로 끝내지 않고 **두 가지 원인 후보를 함께 준다.** 관측 가능성
(observability)은 무엇이 실패했는지가 아니라 다음에 무엇을 해 볼지를 알려줄 때
비로소 쓸모가 있다.

---

## 9.2 원리 — Referer 를 쓰는 것은 누구인가

용어부터 고정한다.

> **용어** — **Referer(리퍼러)**: 이 요청을 유발한 문서의 주소를 담는 HTTP 요청
> 헤더(RFC 9110 §10.1.3). 철자가 틀린 것은 RFC 1945(1996)의 오타가 그대로 굳은
> 것이며, 나중에 생긴 정책 헤더는 바른 철자를 쓴다(`Referrer-Policy`).

> **용어** — **origin(오리진)**: scheme·host·port 세 값의 조합
> (`https://site.example:443`). 셋이 모두 같아야 same-origin 이다. `Origin` 요청
> 헤더는 Referer 에서 경로와 질의 문자열을 뗀 값에 해당한다.

> **용어** — **핫링크(hotlinking, 인라인 링크)**: 남의 서버에 있는 자원을 자기
> 페이지에서 직접 참조해, 대역폭 비용은 원본 서버가 지고 화면과 광고 수익은
> 참조하는 쪽이 가져가는 것. 이를 막는 서버 설정이 **핫링크 차단**이다.

이제 이 장 전체가 걸려 있는 사실 하나.

> **Referer 값을 쓰는 것은 요청자다. 서버는 읽을 뿐이며, 무엇이 쓰일지 정할 수 없다.**

`Content-Type` 이나 URI 확장자(제14장)와 정확히 같은 구조다. 다만 방향이 반대다.
제14장에서는 **서버**가 자기 자신에 대해 신고했고, 여기서는 **클라이언트**가 자기
자신에 대해 신고한다. 어느 쪽이든 규격은 그 신고가 참임을 강제하지 않고, 강제할
방법도 없다.

### 9.2.1 그렇다면 왜 통제가 되는가 — 집행자의 존재

원리적으로 위조 가능한 값이 실무에서 통제로 기능하는 이유는 하나다. **대부분의
요청자에게는 값을 대신 써 주는 집행자가 있고, 요청자는 그 집행자를 우회할 수 없다.**

브라우저 안에서 도는 코드는 `Referer` 를 스스로 정할 수 없다. Fetch 규격이 이 헤더를
스크립트가 설정할 수 없는 목록에 올려 두었기 때문이다.

> **용어** — **forbidden header name(금지 헤더 이름)**: Fetch 규격이 스크립트로는
> 설정하지 못하도록 지정한 요청 헤더 이름의 목록. `Referer`·`Origin`·`Host`·`Cookie`
> 와 `Sec-` 접두어 등이 들어 있다. `fetch()` 나 `XMLHttpRequest.setRequestHeader()`
> 로 이 이름을 지정하면 요청은 실패하지 않고 **그 지정만 조용히 무시된다.**

즉 브라우저는 서버를 대신해 이 헤더의 진실성을 집행한다. 서버가 신뢰하는 것은
값이 아니라 **그 값을 쓴 주체**다.

![Referer 를 쓰는 주체가 누구인지에 따라 갈리는 통제의 효력](/images/lecture/hls-recon/09-enforcer-location.svg)

*그림 9-1 — 값을 쓰는 주체가 누구인지에 따라 갈리는 통제의 효력*

브라우저 밖에는 그 집행자가 없다. `curl` 도, 파이썬 `urllib` 도, `ffmpeg` 도 임의의
값을 쓴다. 그러므로 다음 명제가 성립한다.

> **자기 신고 값 기반 통제의 강도는 값이 아니라 집행자에 달려 있다. 집행자가 없는
> 요청자에 대해 이 통제의 효력은 0 이다.**

"약한 방어"라는 표현조차 정확하지 않다. 약한 것이 아니라 **해당 요청자에 대해서는
아예 통제가 아니다.** 대신 다른 요청자에 대해서는 거의 완전한 통제다. 어느 쪽인지는
값이 아니라 **위협 모델**이 정한다(§9.7).

---

## 9.3 코드 — 사슬의 단계마다 다른 값

### 9.3.1 `_from` — 이 요청에만 얹는 헤더

이 저장소가 다루는 사이트는 회차 하나를 열기까지 네 번 요청한다. 각 요청은 서로 다른
문맥에서 열리므로 브라우저가 싣는 Referer 도 매번 다르다. 그것을 만들어 주는 함수가
전부 열한 줄이다.

```python
# series.py:99-109
def _from(referer: str) -> dict[str, str]:
    """이 요청에만 얹을 Referer/Origin.

    사슬의 각 단계는 서로 다른 곳에서 열린다 — 회차 페이지는 사이트 안에서,
    플레이어는 회차 페이지 안의 iframe 으로, 재생 소스는 플레이어 안의 XHR 로.
    브라우저가 보내는 것과 같은 값을 보내야 한다. 하나라도 비면 서버가 404 로
    돌려보내는데, 없는 페이지처럼 보여서 원인을 짚기 어렵다.
    """
    # 헤더 값은 ASCII 로 쓰인다. 한글이 든 회차 주소를 그대로 Referer 에 넣으면
    # 요청이 만들어지는 순간 죽으므로, 주소와 같은 규칙으로 인코딩해서 싣는다.
    return {"Referer": normalize_url(referer), "Origin": _origin(referer)}
```

함수 이름이 `_from` 인 것이 이 함수의 전부를 말한다. 인자는 "어디**에서** 온
요청인가"이고, 반환은 그 사실을 서버에 신고하는 두 헤더다.

### 9.3.2 사슬 — 어느 단계가 어느 값을 받는가

```python
# series.py:271-284
    page_url = episode.page_url
    page = fetcher.get_text(page_url, _from(_origin(page_url) + "/"))
    player = _player_url(page, episode.page_url)
    origin = _origin(player)
    video_hash = _PLAYER_RE.match(player).group("hash")

    # 플레이어 HTML 은 설정만 들고 있다. 실제 재생 주소는 아래 XHR 이 발급한다.
    settings = unpack(fetcher.get_text(player, _from(page_url)))

    res = fetcher.post(
        f"{origin}/player/index.php?data={video_hash}&do=getVideo",
        {"hash": video_hash, "r": episode.page_url},
        _from(player),
    )
```

세 줄의 `_from(…)` 인자가 각각 다르다는 점만 보면 된다. `_origin(page_url) + "/"`,
`page_url`, `player` — **한 단계 앞의 문서 주소**가 다음 요청의 Referer 가 된다.

![회차 하나를 여는 요청 사슬 네 단계와 단계별 Referer](/images/lecture/hls-recon/09-referer-chain.svg)

*그림 9-2 — 회차 하나를 여는 요청 사슬 네 단계와 단계별 Referer*

앵커까지 붙여 표로 정리하면 다음과 같다.

| 단계 | 요청 | Referer | Origin | 앵커 |
|---|---|---|---|---|
| 0 | 시리즈 목록 `/c/<제목>` | 사이트 루트 | 사이트 | [`series.py:157`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L157) [`series.py:160`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L160) |
| 1 | 회차 페이지 `/e/<제목> N화` | 사이트 루트 | 사이트 | [`series.py:272`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L272) |
| 2 | 플레이어 `<플레이어>/video/<해시>` (iframe) | **회차 페이지 전체 주소** | 사이트 | [`series.py:278`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L278) |
| 3 | `player/index.php?…&do=getVideo` (XHR·POST) | **플레이어 전체 주소** | 플레이어 | [`series.py:283`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L283) |
| 4 | m3u8 · 세그먼트 (CDN) | 플레이어 origin | 플레이어 | [`series.py:300`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L300) → [`cli.py:907-908`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L907-L908) |

단계 2·3 에서만 **경로까지 포함한 전체 주소**가 실린다. 나머지는 origin 뒤에 `/` 만
붙인 루트다. 이것은 브라우저의 관찰 결과를 옮긴 것이지 서버 규칙을 역설계한 것이
아니다(§9.8).

### 9.3.3 마지막 단계에서 경로를 버리는 이유

4단계로 넘어가는 값은 경로가 없다.

```python
# series.py:300
    return Play(playlist_url=link, name=_name_of(settings, episode, fallback_width), referer=origin + "/")
```

```python
# cli.py:905-908
        # 플레이어가 알려준 origin 을 Referer 로 쓴다. 사용자 지정이 있으면 그대로 둔다.
        ep_headers = dict(given)
        ep_headers.setdefault("Referer", play.referer)
        ep_headers.setdefault("Origin", play.referer.rstrip("/"))
```

플레이어(`player.example`)에서 CDN(`cdn.example`)으로 가는 요청은 **cross-origin**
이다. 주요 브라우저의 현재 기본 Referrer-Policy 는 `strict-origin-when-cross-origin`
이며, 이 정책에서 cross-origin 요청에는 **경로 없이 origin 만** 실린다. 즉 이 코드가
4단계에서 경로를 버리는 것은 브라우저가 실제로 보내는 것과 같은 값을 보내려는
선택이다.

> **용어** — **Referrer-Policy(리퍼러 정책)**: 문서가 유발한 요청에 Referer 를
> 얼마나 실을지 정하는 응답 헤더 겸 문서 메타데이터. `no-referrer`(아예 안 보냄) ·
> `origin`(origin 만) · `strict-origin-when-cross-origin`(같은 origin 이면 전체 주소,
> 다른 origin 이면 origin 만, HTTPS→HTTP 강등이면 안 보냄) 등의 값을 가진다.

여기서 방어자 쪽의 결론 하나가 미리 나온다. **경로를 검사하는 Referer 규칙은 이미
깨져 있다.** 브라우저 기본값이 cross-origin 요청에서 경로를 지우기 때문이다. 남는
검사는 사실상 호스트 검사뿐이고, 호스트 문자열은 위조하기에 가장 쉬운 부분이다.

### 9.3.4 왜 `normalize_url` 을 거치는가 — 인코딩하지 않으면 요청이 죽는다

`_from` 의 주석은 "요청이 만들어지는 순간 죽는다"고 적고 있다. 실제로 그런지 재보면
이렇다.

```
raw     : https://site.example/e/그렌라간 3화
norm    : https://site.example/e/%EA%B7%B8%EB%A0%8C%EB%9D%BC%EA%B0%84%203%ED%99%94

raw referer  : UnicodeEncodeError - 'latin-1' codec can't encode characters in
               position 23-26: ordinal not in range(256)
norm referer : 서버가 받은 값 = 'https://site.example/e/%EA%B7%B8…%ED%99%94'
```

**서버에 닿기 전에 클라이언트 안에서 죽는다.** 네트워크로 나가지도 못하므로 상태
코드조차 없다. 정확히는 ASCII 가 아니라 latin-1 이 경계다 — 파이썬 `http.client` 가
헤더를 latin-1 로 인코딩하기 때문이다. RFC 9110 은 필드 값을 US-ASCII 로 규정하고
그 밖의 바이트(`obs-text`)는 불투명하게 다루라고만 한다.

여기서 제7장(URL 정규화와 멱등성)이 다시 걸린다. Referer 는 **주소를 담는 헤더**이므로
주소와 **같은 규칙**으로 인코딩해야 한다. 따로 인코딩하면 같은 문서를 가리키는 두 개의
다른 문자열이 생기고, 서버가 어느 쪽과 비교하는지에 따라 통과 여부가 갈린다.
`_from` 이 `urllib.parse.quote` 를 직접 부르지 않고 `fetch.normalize_url` 을 재사용하는
이유가 그것이다 — **주소를 만드는 규칙은 저장소에 하나뿐이어야 한다.**

---

## 9.4 코드 — 왜 이 헤더를 인스턴스에 쓰지 않는가

### 9.4.1 요청 지역성

단계마다 값이 다르다는 사실은 페처(fetcher)의 구조를 결정한다. 이 저장소는 그것을
`_send` 의 첫 두 줄로 처리한다.

```python
# fetch.py:139-150
    def _send(
        self,
        url: str,
        byterange: tuple[int, int] | None = None,
        data: bytes | None = None,
        extra: dict[str, str] | None = None,
    ) -> FetchResult:
        # extra 는 이 요청에만 얹는 헤더다. 페이지를 타고 들어가는 동안 Referer 가
        # 단계마다 달라지는데(부모 페이지 → iframe → XHR), 그걸 인스턴스 헤더에
        # 써 버리면 다음 요청까지 오염된다. 사용자 지정 헤더는 그대로 이긴다.
        headers = {**self.headers, **{k: v for k, v in (extra or {}).items()
                                      if k not in self.headers}}
```

한 표현식에 성질 두 개가 들어 있다.

| 성질 | 구현 | 없으면 무엇이 깨지는가 |
|---|---|---|
| **요청 지역성** | `extra` 를 지역 `headers` 에만 합친다. `self.headers` 는 절대 쓰지 않는다 | 3단계의 Referer 가 4단계로, 나아가 다음 회차로 새어 나간다 |
| **우선순위** | `if k not in self.headers` — 인스턴스에 이미 있는 키는 `extra` 가 이기지 못한다 | 사용자가 `--referer` 로 지정한 값을 사슬의 추측이 덮어쓴다 |

### 9.4.2 오염이 회차 전체로 번지는 이유

`Fetcher` 는 요청마다 새로 만들어지지 않는다. 시리즈 모드는 **하나**를 만들어
목록 발견과 전 회차의 재생 소스 해석에 돌려 쓴다.

```python
# cli.py:787
    pages = Fetcher(headers=dict(given), timeout=args.timeout, retries=args.retries)
```

이 인스턴스가 `series.discover()`([`cli.py:790`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L790))와 `series.resolve()`
([`cli.py:884`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L884), [`cli.py:743`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L743))를 모두 처리한다. 따라서 `self.headers.update(extra)` 로
구현했다면 오염 범위는 **다음 요청 하나**가 아니다.

```
요청 3 (XHR)   Referer = https://player/video/9f3a…   ← 인스턴스에 기록
요청 4 (CDN)   Referer = https://player/video/9f3a…   ← 잘못된 값
1화 끝
2화 요청 1     Referer = https://player/video/9f3a…   ← 1화의 값이 살아 있다
…
27화까지 전부
```

그리고 이 실패는 **조용하다.** 서버는 404 를 돌려주고, 404 는 "없는 페이지"처럼
보인다(§9.1). 27화 중 1화만 성공하고 나머지가 전부 "없는 회차"로 보고되는 증상이
되며, 원인이 헤더라는 것을 알아낼 단서가 출력 어디에도 없다.

### 9.4.3 사용자 지정이 이기는 경로

`extra` 가 인스턴스 헤더를 이기지 못한다는 규칙은 사용자 지정 헤더를 위한 것이다.

```python
# cli.py:488-501
def _given_headers(args: argparse.Namespace) -> dict[str, str]:
    """사용자가 지정한 요청 헤더를 모은다. 자동 추론보다 언제나 우선한다."""
    given: dict[str, str] = {}
    for h in args.header:
        k, sep, v = h.partition(":")
        if not sep:
            raise SystemExit(f"--header 형식이 잘못됐다 (K:V 필요): {h}")
        given[k.strip()] = v.strip()
    if args.referer:
        given["Referer"] = args.referer
        given.setdefault("Origin", "{u.scheme}://{u.netloc}".format(u=urlparse(args.referer)))
    if args.cookie:
        given["Cookie"] = _normalize_cookie(args.cookie)
    return given
```

`--referer` 를 주면 `Origin` 까지 함께 정해진다(`setdefault` 이므로 `--header
'Origin: …'` 로 따로 준 값이 있으면 그쪽이 남는다). 이 dict 가 `Fetcher.headers` 의
초기값이 되고, 그 순간부터 사슬의 `_from` 은 Referer 에 대해 아무 힘이 없다.

**우선순위 규칙이 하나뿐이라는 점이 중요하다.** "사용자 지정 > 자동 추론"이라는 순서가
`_send` 의 한 줄에만 존재하므로, GET·POST·세그먼트 수신·ffmpeg 위임이 전부 같은 순서를
따른다. 이 규칙이 경로마다 따로 구현돼 있었다면 "받아지는데 실측만 실패" 같은
갈라진 증상이 난다 — [`probe.py:58-59`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L58-L59) 가 같은 취지를 적어 둔 지점이다.

---

## 9.5 실습 — 로컬 재현

외부 사이트 없이 전부 재현할 수 있다. 필요한 것은 `python3` 와 `curl` 뿐이다.

### 9.5.1 Referer 검사를 하는 서버 세우기

```python
# srv.py — Referer 가 맞지 않으면 404 를 내는 서버
import http.server
ALLOWED = "https://site.example/"
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        ref = self.headers.get("Referer", "")
        ok = ref.startswith(ALLOWED)
        body = b"MEDIA" if ok else b"<!DOCTYPE html><html>404</html>"
        self.send_response(200 if ok else 404)
        self.send_header("Content-Type", "video/mp2t" if ok else "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8982), H).serve_forever()
```

실측 결과:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8982/seg000.ts
404
$ curl -s -o /dev/null -w '%{http_code}\n' -e 'https://site.example/' http://127.0.0.1:8982/seg000.ts
200
$ curl -s -o /dev/null -w '%{http_code}\n' -H 'Referer: https://site.example/aaaaaa' http://127.0.0.1:8982/seg000.ts
200
```

| 보낸 Referer | 상태 |
|---|---|
| (없음) | `404` |
| `https://site.example/` | `200` |
| `https://site.example/aaaaaa` — **존재하지 않는 경로** | `200` |

세 번째 줄이 이 절의 요점이다. 서버는 그 페이지가 실재하는지 확인하지 않는다.
확인할 방법이 없다 — 자기 서버가 아니고, 확인하러 가는 것 자체가 비용이며, 그
페이지가 정말 그 요청을 유발했는지는 어차피 알 수 없다. **검사할 수 있는 것은
문자열의 앞부분뿐이다.**

### 9.5.2 사슬 — 단계마다 다른 값을 요구하는 서버

이번에는 경로마다 요구하는 Referer 가 다른 서버를 세우고 이 저장소의 `Fetcher` 로
밟는다(`series._from` 과 같은 방식).

```python
EXPECT = {
    "/e/ep3":        "http://127.0.0.1:8981/",                # 사이트 안에서
    "/video/abc123": "http://127.0.0.1:8981/e/ep3",            # 회차 페이지의 iframe
    "/player/get":   "http://127.0.0.1:8981/video/abc123",     # 플레이어 안의 XHR
}
```

```text
── 1. Referer 없이 사슬을 밟는다
   GET /e/ep3           → 404  HTTP 404 Not Found
   GET /video/abc123    → 404  HTTP 404 Not Found
   GET /player/get      → 404  HTTP 404 Not Found

── 2. 단계마다 브라우저와 같은 Referer 를 싣는다 (series._from 방식)
   GET /e/ep3           Referer=http://127.0.0.1:8981/                → 200
   GET /video/abc123    Referer=http://127.0.0.1:8981/e/ep3           → 200
   GET /player/get      Referer=http://127.0.0.1:8981/video/abc123    → 200
```

**같은 주소, 같은 도구, 같은 순서다.** 갈린 것은 헤더 하나뿐이다.

### 9.5.3 인스턴스에 써 버렸을 때 — 반례

`extra` 를 `self.headers` 에 기록했다고 가정하고, 3단계의 값이 남은 상태에서 1단계를
다시 요청한다.

```text
── 3. extra 는 인스턴스에 남는가
   fetcher.headers 의 키: ['User-Agent']

── 4. 마지막 단계의 값을 인스턴스에 써 버렸다면
   GET /e/ep3       extra 로 올바른 값을 줘도 → 404 HTTP 404 Not Found
   서버가 실제로 받은 Referer: http://127.0.0.1:8981/video/abc123
```

두 줄이 각각 하나씩 확인해 준다.

- **3번** — 세 요청을 `extra` 로 처리한 뒤에도 `fetcher.headers` 에는 `User-Agent`
  하나뿐이다. 요청 지역성이 실제로 지켜진다.
- **4번** — 인스턴스가 한번 오염되면 **`extra` 로 올바른 값을 줘도 소용이 없다.**
  `if k not in self.headers` 때문에 `extra` 가 지기 때문이다. 우선순위 규칙과
  오염이 겹치면 복구 경로가 없다.

4번은 두 성질이 각각은 옳으면서 **함께 어겨졌을 때만** 나타나는 실패다. 요청 지역성만
지키면 4번은 일어나지 않고, 오염이 있더라도 우선순위가 반대였다면 `extra` 로 덮을 수
있다. 이런 실패는 단위 테스트로 잡기 어렵다 — 각 함수는 자기 명세를 만족하기 때문이다.

---

## 9.6 일반화 — 집행자 없는 통제

### 9.6.1 같은 구조를 가진 헤더들

| 헤더 | 통제 용도 | 브라우저 안에서의 집행자 | 브라우저 밖에서 |
|---|---|---|---|
| `Referer` | 핫링크 차단 | 브라우저 (금지 헤더) | 한 줄로 임의 값 |
| `Origin` | CSRF 방어 | 브라우저 (금지 헤더) | 한 줄로 임의 값 |
| `Sec-Fetch-Site` · `-Mode` · `-Dest` | fetch metadata 기반 격리 | 브라우저 (금지 헤더) | 한 줄로 임의 값 |
| `Cookie` | 세션 인증 | 브라우저 (금지 헤더 · SameSite) | 값을 알면 그대로 재사용 |
| `User-Agent` | 봇 차단·콘텐츠 협상 | 없음 | 한 줄로 임의 값 |
| `X-Forwarded-For` | IP 기반 접근 통제 | 없음 (중간 프록시가 씀) | 한 줄로 임의 값 |

`Cookie` 만 성질이 다르다. 값이 **추측 불가능한 비밀**이라 위조가 아니라 탈취를
요구한다. 나머지는 전부 값을 아는 것이 곧 만드는 것이다.

> **용어** — **fetch metadata(페치 메타데이터)**: 브라우저가 요청마다 자동으로 붙이는
> `Sec-Fetch-*` 헤더 묶음. 요청이 같은 사이트에서 왔는지(`Site`), 어떤 방식인지
> (`Mode`), 무엇을 위한 것인지(`Dest`)를 서버에 알린다. 이름의 `Sec-` 접두어가 곧
> 금지 헤더 표시다.

### 9.6.2 같은 헤더, 정반대 효력

`Origin` 검사는 CSRF 방어의 정석으로 권장되고, `Referer` 검사는 접근 통제로는 못
쓴다고 한다. **같은 성질의 값인데 평가가 반대다.** 갈라지는 지점은 값이 아니라
위협 모델이다.

| 요청자 | 집행자 | 검사의 효력 |
|---|---|---|
| 피해자의 브라우저에서 도는 **공격자 페이지** | 브라우저 | **유효** — 값을 고칠 수 없다. CSRF 방어가 성립하는 근거 |
| 공격자의 **서버·스크립트·다운로더** | 없음 | **무효** — 값을 마음대로 쓴다 |
| 중간 **프록시·기업 게이트웨이** | 프록시 | 값이 지워지거나 덧붙는다 → **오탐** |

- **CSRF 의 위협 모델**은 "피해자 브라우저 안에서 도는 공격자 페이지"다. 그 요청자에게
  집행자가 있으므로 `Origin` 검사는 실제 방어다.
- **핫링크 차단의 위협 모델**을 "콘텐츠를 가져가려는 모든 요청자"로 잡으면 그 안에는
  집행자 없는 요청자가 들어 있고, 그 순간 검사는 방어가 아니다.

제14장이 "같은 코드가 역할에 따라 취약점이 되기도 미덕이 되기도 한다"를 보였다면,
이 장은 **같은 메커니즘이 위협 모델에 따라 유효한 방어이기도 빈 껍데기이기도 하다**를
보인다. 판단을 가르는 것은 언제나 메커니즘이 아니라 **누구로부터 무엇을 지키는가**다.

### 9.6.3 "값이 없는 요청"이라는 구멍

nginx 의 표준 관용구를 보자.

```nginx
valid_referers none blocked site.example *.site.example;
if ($invalid_referer) { return 403; }
```

첫 낱말 `none` 은 **Referer 가 아예 없는 요청을 허용한다**는 뜻이다. 이 한 낱말이
통제 전체를 무력화한다 — 위조할 필요도 없이 **헤더를 빼기만 하면** 통과하기 때문이다.

그렇다고 `none` 을 빼면 정상 사용자가 막힌다.

| `none` 을 넣으면 | `none` 을 빼면 |
|---|---|
| 헤더를 생략한 요청이 전부 통과 (우회 비용 0) | `Referrer-Policy: no-referrer` 인 페이지에서 온 정상 요청이 막힘 |
| 프라이버시 설정·확장을 쓰는 사용자가 정상 이용 | 프라이버시 확장·일부 기업 프록시 사용자가 막힘 |
| | HTTPS → HTTP 강등 요청이 막힘 (규격상 Referer 를 안 보낸다) |

**어느 쪽을 골라도 대가가 있고, 그 대가는 통제의 성질에서 온다.** "값이 있으면
검사하고 없으면 통과"는 자기 신고 값 기반 통제 전체가 공유하는 구멍이다.
`X-Forwarded-For` 도, `User-Agent` 기반 차단도 같은 자리에서 같은 방식으로 뚫린다.

---

## 9.7 보안 — 원리적으로 약한 통제가 왜 널리 쓰이는가

### 9.7.1 이 통제가 실제로 겨냥한 위협

핫링크 차단은 콘텐츠 보호를 위해 만들어진 것이 아니다. **대역폭 도둑질**을 막기 위해
만들어졌다. 남의 블로그가 `<video src="https://cdn.example/…">` 로 내 영상을 자기
페이지에 붙이면, 전송 비용은 내가 내고 광고 수익은 그쪽이 가져간다.

그 위협의 요청자는 **방문자의 브라우저**다. 집행자가 있다. 그러므로 —

> **Referer 검사는 실패한 방어가 아니다. 자기 위협 모델 안에서는 거의 완전한 방어다.**

문제는 그것을 **다른 위협 모델의 통제로 계상**할 때 생긴다. 회계 항목이 틀린 것이지
메커니즘이 틀린 것이 아니다. 제25장의 "AES-128 은 DRM 이 아니다"와 정확히 같은 형태의
오류다.

### 9.7.2 비용 대비 효과

| 항목 | Referer 검사 | 서명 URL (제11장) | 세션 인증 |
|---|---|---|---|
| 서버 쪽 도입 비용 | 설정 두 줄 · CDN 콘솔 체크박스 | HMAC 키 관리 · 시계 동기 · 만료 설계 | 사용자 DB · 세션 저장소 |
| 클라이언트 변경 | **없음** | 없음 (발급 쪽만 바뀐다) | 로그인 흐름 필요 |
| 캐시 친화성 | 높음 — URL 이 그대로다 | 낮음 — 발급마다 URL 이 다르다 | 낮음 |
| 실제로 막는 것 | 남의 페이지의 임베드 | 링크 유출 후의 재사용 (만료까지) | 무자격 사용자 |
| 못 막는 것 | **헤더를 쓸 줄 아는 모든 요청자** | 만료 전 재배포 | 자격증명 공유 |
| 오탐 원인 | Referrer-Policy · 프라이버시 설정 · 프록시 | 클라이언트 시계 어긋남 | 세션 만료 |

도입 비용이 사실상 0 이고 클라이언트를 하나도 바꾸지 않으면서 실제 위협의 대부분을
막는다. **그래서 널리 쓰인다.** 이것을 "무지" 로 설명할 필요가 없다 — 대부분의 경우
합리적인 선택이다. 잘못은 이 통제를 **유일한** 통제로 두거나, 유료 콘텐츠 보호로
계상할 때 생긴다.

### 9.7.3 404 라는 선택 — 무엇을 얻고 무엇을 잃는가

차단을 404 로 내는 것은 의도적 설계일 수 있다. 자원의 **존재 자체를 숨기려는**
것이다. 그러나 이 이득은 거의 없다.

| | 403 으로 냈을 때 | 404 로 냈을 때 |
|---|---|---|
| 주소를 이미 가진 요청자 | 자원이 있다는 것을 안다 | **여전히 안다** — 브라우저로 열어 보면 되니까 |
| 주소를 모르는 요청자 | 애초에 요청하지 못한다 | 애초에 요청하지 못한다 |
| 정상 사용자·자사 도구 | 원인을 헤더로 좁힌다 | **주소를 의심하며 시간을 쓴다** |
| 운영 비용 | — | 지원 문의·오진단 비용 증가 |

**숨김의 이득은 이미 주소를 가진 쪽에는 성립하지 않고, 비용은 전부 자기 쪽으로
돌아온다.** 게다가 404 는 정직하지 않은 상태 코드이며, 정직하지 않은 상태 코드는
클라이언트의 재시도 정책까지 오염시킨다 — [`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201) 은 `408`·`429` 를 뺀 4xx 를
재시도하지 않고 끊는데, 그 판단은 "4xx 는 다시 해도 같다"는 전제 위에 있다. Referer 만
붙이면 같지 않은데도.

### 9.7.4 방어자 관점 — 역할별로 무엇을 해야 하는가

| 역할 | 무엇을 해야 하는가 |
|---|---|
| **CDN · 송출 운영자** | Referer 검사는 **대역폭 도둑질 억제**로만 계상한다. 유료 콘텐츠 접근 통제로 계상하면 장부가 틀린다. 실제 통제는 서명 URL(제11장)과 세션에 둔다 |
| 〃 | 차단은 **403 으로 낸다.** 404 는 숨기지 못하면서 자기 지원 비용만 늘린다(§9.7.3) |
| 〃 | 차단 응답에 **허용 origin 을 실어 보내지 않는다.** `Access-Control-Allow-Origin` 은 성공 응답에만 붙인다 — 403 에 붙이면 "어떤 값을 보내야 하는지"를 알려주는 것이다(제10장) |
| 〃 | `valid_referers` 에서 `none` 을 넣을지 말지를 **명시적으로 결정하고 기록한다.** 기본값을 그대로 둔 채 "Referer 검사함"이라고 적으면 통제가 없는 것과 같다(§9.6.3) |
| **애플리케이션 개발자** | CSRF 방어로 `Origin`·`Sec-Fetch-Site` 를 쓰는 것은 **유효하다** — 위협 모델이 브라우저 안이기 때문. 다만 헤더가 **없는** 요청을 통과시키면 그 순간 무효가 된다 |
| 〃 | Referer 를 로그·감사 기록의 **사실**로 다루지 않는다. 그것은 요청자의 진술이다. 진술로 기록하려면 필드 이름에 그렇게 적는다 |
| **보안 감사자** | 통제 목록에 "Referer 검증"을 올릴 때 **집행자가 누구인지 함께 적게 한다.** 집행자가 클라이언트라면 그것은 통제가 아니라 관례다 |
| 〃 | 위협 모델을 문서로 요구한다. 같은 메커니즘이 모델에 따라 유효·무효로 갈리므로, 모델 없는 통제 평가는 성립하지 않는다(§9.6.2) |
| **네트워크·프록시 관리자** | Referer 를 지우거나 덮어쓰는 중간 장비는 사용자 쪽 **오탐**을 만든다. 정책상 지워야 한다면 그 사실을 사용자 지원 절차에 반영한다 |
| **클라이언트 도구 작성자** | 실패 진단에 Referer 를 **첫 후보로** 넣는다([`cli.py:95`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L95)). 404 를 액면대로 믿게 두면 사용자가 존재하지 않는 문제를 찾는다 |
| 〃 | 단계마다 다른 값을 보내야 한다면 **요청 지역 헤더**로 구현한다([`fetch.py:146-150`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L146-L150)). 인스턴스에 쓰면 오염이 조용히 번진다(§9.5.3) |

### 9.7.5 이 장이 다음 장으로 넘기는 것

여기까지는 "요청자가 값을 알고 있다"를 전제했다. 그런데 그 값을 **서버가 직접
알려주는** 구성이 실재한다.

```python
# fetch.py:90-92
    # 핫링크 차단 CDN 은 플레이어 페이지의 origin 을 이 헤더로 되돌려준다.
    # 성공 응답에도, 403 에도 붙어 오므로 Referer 추론의 근거가 된다.
    allow_origin: str = ""
```

차단 응답에 `Access-Control-Allow-Origin` 을 실어 보내면, 그 헤더가 곧 "어떤 Referer
를 보내야 통과하는가"의 답이다. [`cli.py:105-124`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L105-L124) 의 `_adopt_origin` 이 정확히 그
누출을 이용한다. 제10장의 주제다.

---

## 9.8 한계와 미해결

정직하게 적어 둔다.

- **대상 서버가 무엇을 검사하는지 확인하지 못했다.** 전체 주소인지, origin 인지,
  호스트 부분 문자열인지 알 수 없다. `_from` 이 단계마다 다른 값을 싣는 것은
  **브라우저 동작을 모사한 결과**이지 서버 규칙을 역설계한 결과가 아니다. 표(§9.3.2)의
  "단계 2·3 만 전체 주소"도 같은 성격의 관찰이다.
- **"하나라도 비면 404" 는 코드 주석의 실측 기록이고, 이 장에서 재현한 것이 아니다.**
  §9.5 의 404 는 그 조건을 모사한 **로컬 서버**의 응답이다. 실제 서버에서 어느 단계를
  비웠을 때 404 가 오는지, 단계마다 다른지는 회귀 테스트로 고정돼 있지 않다.
  회귀 테스트가 고정하는 것은 **진단 문구에 Referer 가 등장하는지**뿐이다
  (`tests/run.sh:205`).
- **`--referer` 는 사슬 전 단계를 하나의 값으로 덮는다.** `if k not in self.headers`
  때문에 사용자 지정이 있으면 `_from` 의 단계별 값이 전혀 나가지 않는다. 단계별로 다른
  값을 요구하는 서버에서는 `--referer` 를 주는 쪽이 오히려 실패하며, **도구는 그
  사실을 알리지 않는다.** 의도된 정책(README:199-200)이지만 대가가 문서화돼 있지 않다.
- **`_origin()` 은 인코딩하지 않는다.** `"{u.scheme}://{u.netloc}"` 을 그대로 쓰므로
  호스트가 비ASCII(IDN)면 §9.3.4 와 같은 자리에서 죽는다. `normalize_url` 도 netloc
  은 건드리지 않는다. 실측하지 않았고, 이 저장소가 다루는 범위에서는 나타나지 않았다.
- **Referrer-Policy 를 고려하지 않는다.** 대상 사이트가 `no-referrer` 를 걸어 두었다면
  브라우저는 아예 보내지 않는데 이 코드는 보낸다 — **브라우저보다 더 많이 보내는
  상태**다. 서버가 정확 일치를 요구한다면 이쪽이 실패한다. 반대로 대부분의 서버가
  접두어·호스트 비교를 하므로 더 보내는 편이 안전하다는 것이 이 코드의 (검증되지 않은)
  가정이다.
- **세그먼트 요청에는 `_from` 이 관여하지 않는다.** 4단계 이후는 `Fetcher.headers` 에
  들어간 값 하나로 전부 나간다([`cli.py:907-908`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L907-L908)). 세그먼트마다 다른 Referer 를 요구하는
  송출은 이 구조로 다루지 못한다. 그런 송출을 만난 적은 없다.
- **브라우저 정책의 버전별 이력은 확인하지 않았다.** `strict-origin-when-cross-origin`
  이 현재 주요 브라우저의 기본값이라는 것까지만 근거로 삼았고, 언제부터인지·모든
  브라우저가 같은지는 이 장에서 검증하지 않았다.

---

## 9.9 요약

1. **Referer 는 요청자가 쓰고 서버는 읽을 뿐이다.** `Content-Type`·URI 확장자(제14장)와
   같은 자기 신고 값이며, 방향만 반대다(서버 신고 ↔ 클라이언트 신고).
2. **자기 신고 값 기반 통제의 강도는 값이 아니라 집행자에 달려 있다.** 브라우저 안의
   요청자는 이 헤더를 고칠 수 없고(금지 헤더 이름), 브라우저 밖의 요청자는 한 줄로 쓴다.
   실측: 헤더 없이 `404`, `-e 'https://site.example/'` 한 줄로 `200`. 존재하지 않는
   경로를 써도 `200`.
3. **같은 메커니즘이 위협 모델에 따라 유효한 방어이기도 빈 껍데기이기도 하다.**
   CSRF 방어로서의 `Origin` 검사는 유효하고(위협이 브라우저 안), 콘텐츠 접근 통제로서의
   `Referer` 검사는 무효다(위협이 브라우저 밖). 메커니즘이 아니라 **누구로부터 무엇을
   지키는가**가 판단을 가른다.
4. **그럼에도 널리 쓰이는 것은 합리적이다.** 도입 비용이 사실상 0 이고 클라이언트를
   바꾸지 않으면서, 원래 겨냥한 위협(대역폭 도둑질)의 요청자는 전부 브라우저다. 잘못은
   메커니즘이 아니라 **회계**에서 생긴다 — 이것을 유일한 통제로 두거나 콘텐츠 보호로
   계상할 때.
5. **차단을 404 로 내면 아무것도 숨기지 못하면서 진단만 무너진다.** 주소를 가진 쪽에는
   존재가 이미 드러나 있고, 비용은 자사 사용자와 지원 조직으로 돌아온다. 그래서 이
   도구는 진단 문구에 Referer 를 첫 후보로 올리고 그것을 테스트로 고정한다.
6. **단계마다 값이 다르면 헤더는 요청 지역(request-local)이어야 한다.** 인스턴스에 쓰면
   오염이 다음 요청이 아니라 **다음 회차 전체**로 번지고, 증상은 27화가 전부 "없는
   페이지"로 보이는 것이다. 실측으로 확인: `extra` 로 올바른 값을 줘도 오염된
   인스턴스를 이기지 못한다.
7. **Referer 는 주소이므로 주소와 같은 규칙으로 인코딩해야 한다.** 한글이 든 주소를
   그대로 실으면 요청은 서버에 닿기 전에 클라이언트 안에서 죽는다
   (`UnicodeEncodeError: 'latin-1' codec …`). 정규화 규칙이 저장소에 하나뿐이어야 하는
   이유이며, 제7장의 원칙이 헤더에서 되풀이되는 지점이다.

---

**다음 장** — 이 장의 통제는 "요청자가 올바른 값을 알고 있는가"에 기대고 있었다.
그런데 어떤 서버는 **차단 응답에 그 답을 실어 보낸다.** `Access-Control-Allow-Origin`
은 규격상 "브라우저 JS 가 응답을 읽어도 되는 origin"이지 "서버가 요구하는 Referer"가
아닌데, 둘이 일치하는 구성이 흔하다. 제10장은 CORS 헤더의 오독이 어떻게 정보 누출이
되는지, 그리고 그 누출을 이용하는 `_adopt_origin` 이 왜 **추정**으로만 남아야 하는지를
다룬다.
