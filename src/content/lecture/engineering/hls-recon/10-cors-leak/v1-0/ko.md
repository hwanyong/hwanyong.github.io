---
title: "CORS 헤더가 흘리는 것"
description: "ACAO 의 오독과 정보 누출"
date: 2026-08-16
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-10-cors-leak.svg
---
## 10.0 이 장에서 답할 것

1. `Access-Control-Allow-Origin` 은 규격상 무엇을 통제하는가 — 그리고 무엇을 통제하지 않는가
2. 왜 그 헤더가 **차단당한 403 응답에까지** 실려 오는가
3. 차단 응답이 우회 방법을 알려주는 구성은 어떻게 생기는가
4. `*` 는 왜 근거가 되지 못하는가
5. **방어자는 이것을 어떻게 고치는가. 고치면 실제로 무엇이 나아지고, 무엇은 나아지지 않는가**

다섯째 질문이 이 장의 정점이다. 결론을 미리 적어 두면 이렇다 — **누출을 막는 것은
통제를 복원하는 일이 아니다.** 그럼에도 막아야 하는 이유가 따로 있고, 그 구분을
세우는 것이 이 장의 목표다.

---

## 10.1 문제 — 도구가 알 수 없어야 할 것을 알아낸다

이 저장소의 도구를 URL 하나만 주고 돌리면 이런 줄이 뜬다.

```
  source: https://cdn.example/hls/9f3a…/master.m3u8
  Referer 자동 : https://site.example/ (서버가 알려준 허용 origin)
```

이상한 점을 짚어야 한다. 도구가 받은 입력은 **CDN 의 플레이리스트 주소 하나뿐**이다.
`site.example` 이라는 문자열은 입력 어디에도 없다. 사용자가 알려주지도 않았고, 도구가
그 사이트를 뒤진 것도 아니다. 그런데 첫 요청 한 번 만에 그 값을 알아냈고, 그것을
`Referer` 로 붙이자 막혀 있던 스트림이 열렸다.

정보의 출처는 하나뿐이다 — **거절당한 그 응답의 헤더.**

```
GET /hls/9f3a…/master.m3u8
  User-Agent: Mozilla/5.0 …
  (Referer 없음, Origin 없음)

→ 403 Forbidden
   Content-Type: text/html
   Access-Control-Allow-Origin: https://site.example
```

여기서 질문 셋이 갈라진다.

| 질문 | 다루는 절 |
|---|---|
| ACAO 는 원래 무엇을 하는 헤더인가 | §10.2 |
| 왜 거절 응답에까지 붙어 오는가 | §10.3 |
| 왜 그 값이 하필 "요구되는 Referer" 와 일치하는가 | §10.4 |

세 질문의 답이 모이면 마지막 문장이 나온다. **이것은 서버 한 대의 실수가 아니라,
두 메커니즘을 같은 구성값으로 운용할 때 반드시 생기는 구조다.**

---

## 10.2 원리 — ACAO 는 무엇을 통제하는가

### 10.2.1 용어부터

> **용어** — **출처(origin)**: 스킴·호스트·포트의 세 값으로 이루어진 조합.
> 직렬화 표기는 `https://site.example` 또는 `http://a.b:8080` 이며 **경로도 끝
> 슬래시도 없다.** `https://site.example/` 는 URL 이지 origin 이 아니다.

> **용어** — **동일 출처 정책(same-origin policy, SOP)**: 어떤 출처에서 온
> 문서·스크립트가 다른 출처의 응답 내용을 읽지 못하게 하는 **브라우저 내부의 규칙**.
> 요청을 보내는 것 자체를 막는 규칙이 아니라, 돌아온 응답을 스크립트에게 건네줄지를
> 정하는 규칙이다.

> **용어** — **CORS(Cross-Origin Resource Sharing, 교차 출처 자원 공유)**: 서버가
> 응답 헤더로 SOP 를 **완화**해 특정 출처의 스크립트에게 응답 읽기를 허용하는 규격
> (Fetch Standard). 접근을 제한하는 규격이 아니라 제한을 푸는 규격이다.

> **용어** — **ACAO(`Access-Control-Allow-Origin`)**: CORS 의 핵심 응답 헤더.
> "이 응답을 읽어도 되는 출처"를 하나 지정하거나 `*` 로 전부 허용한다.

> **용어** — **핫링크 차단(hotlink protection)**: 요청의 `Referer`(RFC 9110 의
> 요청 헤더 — 이 요청을 유발한 페이지의 주소) 또는 `Origin` 이 허용 목록에 없으면
> 자원을 내주지 않는 서버 측 규칙. 값 자체가 클라이언트가 스스로 써 보내는 것이므로
> 위조를 막지 못한다(제9장).

### 10.2.2 통제 지점의 위치

가장 흔한 오독은 "ACAO 로 막았다"는 문장이다. 무엇을 막았다는 것인지 따져 보면
그 문장은 대체로 성립하지 않는다.

![ACAO 가 작용하는 지점의 비교](/images/lecture/hls-recon/10-acao-scope.svg)

*그림 10-1 — ACAO 가 작용하는 지점의 비교*

단순 요청(preflight 를 유발하지 않는 GET·HEAD·일부 POST)에서 순서는 이렇다.

1. 스크립트가 요청을 만든다
2. **요청은 서버로 간다** — ACAO 는 아직 존재하지도 않는다
3. 서버가 판정하고 응답을 만든다
4. 응답이 브라우저에 도착한다
5. **브라우저가** ACAO 를 대조한다
6. 통과하면 스크립트에 응답을 넘기고, 아니면 네트워크 오류로 처리한다

> **용어** — **사전 요청(preflight request)**: 규격이 정한 "단순 요청" 범위를 벗어나는
> 요청(예: `PUT`, 커스텀 헤더 동반) 앞에 브라우저가 먼저 보내는 `OPTIONS` 요청.
> 이때는 본 요청이 아예 보류될 수 있다. HLS 플레이어가 매니페스트·세그먼트를 받는
> 요청은 평범한 `GET` 이므로 이 경우에 해당하지 않는다.

여기서 두 결론이 나온다.

| 결론 | 근거 |
|---|---|
| ACAO 는 **서버의 부하를 줄이지 않는다** | 요청은 이미 처리됐다. 5단계는 응답이 만들어진 뒤다 |
| ACAO 는 **비브라우저 클라이언트에게 아무 효력이 없다** | 5단계를 수행하는 주체가 브라우저다. `curl`·`python`·`ffmpeg` 에는 그 단계가 없다 |

**"이렇게 하지 않으면 무엇이 깨지는가"** — ACAO 를 접근 통제로 오해한 설계는
브라우저 사용자에게만 통제가 걸린다. 스크립트 한 줄이면 되는 우회를 사용자에게
요구하는 대신, 서버는 실제 인가를 어디에도 두지 않은 채로 남는다. **통제가 있다고
믿는 것이 통제가 없는 것보다 나쁜 전형적인 경우다.**

### 10.2.3 정리 — 오독과 규격

| 흔한 오독 | 규격이 실제로 말하는 것 |
|---|---|
| "ACAO 는 서버가 요구하는 Referer 다" | ACAO 는 **응답을 읽어도 되는 출처**다. 요청에 대한 요구 사항이 아니다 |
| "CORS 로 다른 사이트의 접근을 막는다" | CORS 는 SOP 를 **완화**한다. 막는 주체는 SOP 이고, 그것도 브라우저 안에서만이다 |
| "ACAO 가 없으면 요청이 안 간다" | 단순 요청은 그대로 간다. 브라우저가 **응답을 스크립트에 넘기지 않을** 뿐이다 |
| "ACAO 는 서버 보안 설정이다" | 서버가 자기 자원의 **공개 범위를 선언**하는 값이다. 선언은 통제가 아니다 |

이 저장소의 주석은 이 구분을 정확히 적어 두었다([`cli.py:112-114`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L112-L114)).

```python
`*` 는 아무 origin 이나 허용한다는 뜻이라 근거가 되지 못하므로 무시한다.
ACAO 는 "브라우저 JS 가 읽어도 되는 origin"이지 "서버가 요구하는 Referer"가
아니다 — 어디까지나 추정이고, 그래서 사용자 지정이 항상 우선한다.
```

**"추정"이라고 적혀 있다는 점이 중요하다.** 이 도구는 ACAO 를 규격적 근거로 쓰지
않는다. 규격상 둘은 다른 것이고, 다만 **현실의 구성에서 자주 일치한다**는 경험칙을
쓰는 것이다. 그 경험칙이 왜 성립하는지가 다음 두 절이다.

---

## 10.3 왜 403 에까지 붙어 오는가

세 층위의 이유가 겹친다. 셋 다 알아야 이것이 실수가 아니라는 것이 보인다.

### 이유 1 — 규격상 붙는 것이 맞다

CORS 검사는 **응답의 상태 코드와 무관하게** 수행된다. 브라우저는 `403` 이든 `200`
이든 같은 절차로 ACAO 를 대조하고, 통과하지 못하면 스크립트에게 **상태 코드조차
알려주지 않고** 네트워크 오류로 만든다.

따라서 플레이어가 "접근이 거부되었습니다"라는 화면을 띄우려면, 서버는 그 403 응답에
ACAO 를 **붙여야 한다.** 붙이지 않으면 스크립트는 403 이었다는 사실 자체를 알 수 없고
정체불명의 실패만 보게 된다.

> 오류 응답에 ACAO 를 붙이는 것은 규격 위반이 아니라 **오류를 오류로 보이게 하려는
> 정상적인 구성**이다. 이 장이 다루는 문제는 "붙였다"가 아니라 "무엇을 붙였는가"에서
> 생긴다.

### 이유 2 — 구현상 상태 코드를 가리지 않는다

ACAO 는 대개 애플리케이션 코드가 아니라 리버스 프록시·CDN 의 **응답 헤더 규칙**으로
주입된다. 그런 규칙은 기본적으로 성공 응답에만 적용되는 경우가 많아, 운영자는
오류에도 헤더가 붙게 만드는 옵션(널리 쓰이는 예로 nginx 의 `add_header … always`)을
켠다. 그러면 **인가 실패로 만들어진 403 에도 같은 헤더가 붙는다.**

여기서 중요한 것은, 이 옵션을 켜는 동기가 **이유 1** 이라는 점이다. 오류를 플레이어가
읽게 하려고 켠 설정이 곧 누출 경로가 된다.

### 이유 3 — 그 값이 정적 상수다

이것이 결정적이다. 그리고 **이 저장소의 코드로 증명할 수 있다.**

> **용어** — **출처 반사(origin reflection)**: 요청의 `Origin` 헤더 값을 그대로
> ACAO 에 되돌려 쓰는 구성. `ACAO: <요청이 보낸 Origin>` 이 된다.

만약 서버가 출처를 반사하는 구성이라면, **`Origin` 헤더를 보내지 않은 요청에는
되돌릴 값이 없다.** 그런데 이 도구의 첫 요청은 `Origin` 을 보내지 않는다.

```python
# fetch.py:115
self.headers = {"User-Agent": DEFAULT_UA, **(headers or {})}
```

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

기본 헤더는 `User-Agent` 하나뿐이고, `Origin` 은 사용자가 `--referer` 나 `--header`
로 넣었을 때만 생긴다. **아무 옵션 없이 URL 하나만 준 실행에서는 `Origin` 이 없다.**

그럼에도 응답에는 구체적인 origin 이 실려 온다. 결론은 하나다.

> **그 값은 반사된 것이 아니라 서버 구성에 박힌 상수다.**

즉 서버는 "누가 물어보든 관계없이 우리 플레이어는 `https://site.example` 에 있다"고
말하고 있다. 그것이 §10.1 에서 도구가 알아낸 값의 정체다.

---

## 10.4 누출의 구조 — 하나의 구성, 두 경로

이제 §10.1 의 셋째 질문에 답할 수 있다. 왜 ACAO 값이 하필 "요구되는 Referer" 와
일치하는가.

**운영자가 정한 값이 하나이기 때문이다.**

![구성값 하나가 검사와 선언을 동시에 낳는다](/images/lecture/hls-recon/10-one-config-two-paths.svg)

*그림 10-2 — 구성값 하나가 검사와 선언을 동시에 낳는다*

CDN 설정 화면에서 운영자가 채우는 칸은 대개 하나다 — "우리 사이트 주소". 그 값이
두 곳으로 흘러간다.

| 경로 | 성격 | 방향 | 공개 여부에 대한 가정 |
|---|---|---|---|
| 핫링크 차단 목록 | 요청을 받아들일 **술어(predicate)** | 입력 검사 | **비밀이어야 작동한다고 암묵적으로 가정** |
| ACAO 헤더 값 | 읽기를 허용한다는 **선언(declaration)** | 출력 | **처음부터 공개가 목적** |

두 경로의 가정이 정반대인데 값은 같다. 그래서 다음 명제가 성립한다.

> **명제 1 — 공개를 목적으로 하는 선언과 비밀을 전제하는 술어를 같은 구성값에
> 묶으면, 남는 비밀은 없다.**

그리고 그 귀결이 이 장의 제목이다.

> **명제 2 — 거부 응답이 수용 조건을 서술하면, 그 거부는 통제가 아니라 안내다.**

`403 Forbidden` 이 실어 나르는 것은 두 가지다. **거절했다는 사실**과 **그 거절을
통과하는 값.** 우회에 필요한 왕복 횟수는 1 이다.

---

## 10.5 코드 — 이 저장소는 그것을 어떻게 이용하는가

### 10.5.1 계측 대상에 헤더 하나를 추가한다

```python
# fetch.py:90-92
# 핫링크 차단 CDN 은 플레이어 페이지의 origin 을 이 헤더로 되돌려준다.
# 성공 응답에도, 403 에도 붙어 오므로 Referer 추론의 근거가 된다.
allow_origin: str = ""
```

`FetchResult` 는 요청 한 건의 계측치를 담는 자료형이고([`fetch.py:73-104`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L104)), 상태·크기·
TTFB 와 나란히 이 필드가 있다. 본문을 해석하는 데 필요한 `Content-Type`·
`Content-Encoding` 을 빼면 **응답 헤더 중 이 하나만 따로 승격돼 있다**는 사실
자체가 설계 의도를 드러낸다 — 나머지 헤더는 버려지고 이것만 남는다.

### 10.5.2 성공 경로와 실패 경로 **둘 다**에서 읽는다

여기가 이 기능에서 가장 쉽게 틀리는 지점이다.

```python
# fetch.py:181-195 — 성공 경로
return FetchResult(
    url=url,
    ok=True,
    status=resp.status,
    …
    sha256=hashlib.sha256(body).hexdigest(),
    allow_origin=resp.headers.get("Access-Control-Allow-Origin", "") or "",
)
```

```python
# fetch.py:196-201 — 실패 경로
except urllib.error.HTTPError as e:
    last_status, last_err = e.code, f"HTTP {e.code} {e.reason}"
    last_origin = (e.headers or {}).get("Access-Control-Allow-Origin", "") or ""
    # 4xx 는 재시도해도 결과가 같다 (401/403/404 = 토큰 만료·핫링크 차단)
    if 400 <= e.code < 500 and e.code not in (408, 429):
        break
```

```python
# fetch.py:208-215 — 실패로 확정된 결과에도 실어 보낸다
return FetchResult(
    url=url,
    ok=False,
    status=last_status,
    attempts=self.retries,
    error=last_err,
    allow_origin=last_origin,
)
```

**"이렇게 하지 않으면 무엇이 깨지는가"** — 성공 경로(194행)에서만 읽었다면 이 기능은
**필요한 순간에 정확히 작동하지 않는다.** 플레이리스트가 200 으로 열렸다면 Referer 를
추론할 이유가 없기 때문이다. 이 값이 쓸모 있는 유일한 경우는 요청이 막혔을 때이고,
막힌 응답은 `urllib` 에서 반환값이 아니라 **예외**로 온다. 198행이 없으면 기능 전체가
"성공했을 때만 도와주는 도움"이 된다.

두 경로가 필요한 이유를 나누면 이렇다.

| 경로 | 무엇을 위한 것인가 |
|---|---|
| 194행 (성공) | **다음** 요청이 막힐 것에 대비한다. 마스터는 열렸는데 세그먼트가 막히는 송출이 있다 |
| 198행 (실패) | **지금** 요청이 막힌 것을 푼다 — 이 장이 다루는 경우 |

세부 하나. `(e.headers or {})` — `HTTPError` 의 `headers` 가 `None` 일 수 있는 경로를
막는다. 그리고 `or ""` 는 헤더 부재와 빈 값을 같은 것으로 만들어, 이후 코드가
`None` 을 마주치지 않게 한다. 이 정규화가 없으면 §10.5.3 의 `res.allow_origin.strip()`
이 `AttributeError` 로 죽는다 — **누출을 이용하려다 도구가 먼저 죽는다.**

### 10.5.3 채택 — `_adopt_origin`

```python
# cli.py:105-124
def _adopt_origin(res: FetchResult, fetcher: Fetcher) -> bool:
    """응답이 알려준 허용 origin 을 Referer/Origin 으로 채택한다.

    핫링크 차단 CDN 은 플레이어 페이지의 origin 을 Access-Control-Allow-Origin 으로
    되돌려준다 — 차단당한 403 응답에도 붙어 온다. 사용자가 --referer 를 주지 않은
    경우에만, 서버가 스스로 알려준 이 값을 근거로 삼는다.

    `*` 는 아무 origin 이나 허용한다는 뜻이라 근거가 되지 못하므로 무시한다.
    ACAO 는 "브라우저 JS 가 읽어도 되는 origin"이지 "서버가 요구하는 Referer"가
    아니다 — 어디까지나 추정이고, 그래서 사용자 지정이 항상 우선한다.
    """
    if "Referer" in fetcher.headers:
        return False
    u = urlparse(res.allow_origin.strip())
    if u.scheme not in ("http", "https") or not u.netloc:
        return False
    fetcher.headers["Referer"] = f"{u.scheme}://{u.netloc}/"
    fetcher.headers.setdefault("Origin", f"{u.scheme}://{u.netloc}")
    _eprint(f"  Referer 자동 : {u.scheme}://{u.netloc}/ (서버가 알려준 허용 origin)")
    return True
```

다섯 가지가 각각 다른 것을 지킨다.

**① `if "Referer" in fetcher.headers: return False`** — 사용자 지정이 이긴다.
이것이 없으면 서버가 알려준 값이 사용자가 명시한 값을 조용히 덮는다. 사용자는
`--referer` 를 줬다고 믿는데 실제로는 다른 값이 나가고, **stderr 에는 아무 경고도
없다.** 디버깅이 불가능해지는 형태의 버그다.

**② `*` 는 별도 분기로 걸러지지 않는다.** `urlparse("*")` 는 스킴도 netloc 도 빈
문자열을 내므로 origin 문법 검사에서 함께 떨어진다. 값별 판정은 다음과 같다.

| ACAO 값 | `u.scheme` | `u.netloc` | 채택 | 이유 |
|---|---|---|---|---|
| `https://site.example` | `https` | `site.example` | **○** | 정상 origin |
| `https://site.example/` | `https` | `site.example` | ○ | 끝 슬래시는 무시된다 |
| `http://a.b:8080` | `http` | `a.b:8080` | ○ | 포트 포함 origin |
| `*` | `""` | `""` | ✗ | 어떤 출처도 지목하지 않는다 |
| `null` | `""` | `""` | ✗ | 불투명 출처 — 주소가 아니다 |
| `site.example` | `""` | `""` | ✗ | origin 직렬화 형식이 아니다 |
| (헤더 없음) | `""` | `""` | ✗ | 근거 없음 |

`*` 를 배제하는 이유는 두 겹이다. **의미론적으로** 그것은 "아무나 읽어도 된다"는
뜻이라 어떤 특정 출처도 지목하지 않는다 — 애초에 "어떤 Referer 를 보내야 하는가"라는
질문의 답이 아니다. **구문론적으로** 그것은 URL 이 아니라서 URL 로 조립할 수 없다.

**"이렇게 하지 않으면 무엇이 깨지는가"** — `*` 를 걸러내지 않으면
`f"{u.scheme}://{u.netloc}/"` 가 `":///"` 라는 문자열을 만든다. 그 값이 `Referer` 로
나가고, 함수는 `True` 를 돌려주며, §10.5.4 의 재시도가 발동하고, 화면에는
`Referer 자동 : :/// (서버가 알려준 허용 origin)` 이 찍힌다. 결과는 똑같은 403 이다.
**틀린 값을 보내는 것보다 나쁜 것은, 성공한 것처럼 보이는 진단 출력을 남기는 것이다.**

**③ `Referer` 에는 끝 슬래시가 있고 `Origin` 에는 없다.** 우연이 아니다. §10.2.1 의
정의대로 origin 직렬화에는 경로가 없고, `Referer` 는 URL 이므로 최소한 `/` 가 온다.
`Origin` 을 문자열 그대로 비교하는 서버에 `https://site.example/` 을 보내면 **일치
실패**한다. 두 헤더의 표기가 다르다는 사실을 모르면 여기서 한 번 걸린다.

**④ `Origin` 만 `setdefault` 다.** ①의 검사가 보는 키는 `Referer` 하나이므로,
사용자가 `--header 'Origin: …'` 만 준 상태에서도 채택이 진행된다. 그때 사용자의
`Origin` 은 유지되고 `Referer` 만 새로 붙는다.

**⑤ 채택 사실을 stderr 로 출력한다.** 추정으로 얻은 값을 조용히 쓰지 않는다.
사용자는 그 줄을 보고 "아, 이 스트림은 Referer 검증이 걸려 있구나"를 알게 되고,
값이 틀렸다면 `--referer` 로 덮을 수 있다. **추정을 숨기지 않는 것이 추정을 쓰는
조건이다.**

### 10.5.4 상태를 바꾼 뒤의 재시도

```python
# cli.py:127-135
def _load(src: str, fetcher: Fetcher) -> tuple[playlist.Playlist, str]:
    """소스(URL 또는 로컬 .m3u8)를 파싱한다. 반환의 두 번째 값은 base URL."""
    if _is_url(src):
        res = fetcher.get(src)
        # 첫 응답에서 Referer 를 얻었다면, 그 때문에 막혔던 요청은 다시 해볼 값이 있다.
        if _adopt_origin(res, fetcher) and not res.ok:
            res = fetcher.get(src)
        if not res.ok:
            raise SystemExit(f"플레이리스트 요청 실패: {src}\n  {res.error}")
```

[`fetch.py:200-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200-L201) 은 4xx 에서 재시도 루프를 즉시 끊는다. 그런데 [`cli.py:133`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L133) 은
바로 그 4xx 를 한 번 더 요청한다. 모순이 아니다 — **두 재시도는 다른 것이다.**

![두 종류의 재시도](/images/lecture/hls-recon/10-two-retries.svg)

*그림 10-3 — 두 종류의 재시도*

| | 전송 계층 재시도 ([`fetch.py:205-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L205-L206)) | 상태 변경 후 재시도 ([`cli.py:132-133`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L132-L133)) |
|---|---|---|
| 요청 내용 | **완전히 같다** | **달라졌다** (헤더 두 개가 붙었다) |
| 4xx 에서 | 무의미 — 즉시 중단 | 유의미 — 판정 근거가 바뀌었다 |
| 발동 조건 | 5xx·타임아웃·408·429 | `_adopt_origin` 이 `True` 를 돌려주고 `not res.ok` |
| 횟수 | `retries` 만큼, 지수 백오프 | **정확히 한 번** |

조건 두 개를 모두 검사하는 이유도 각각 있다.

- `_adopt_origin(...)` 이 `False` 인데 재시도하면 **똑같은 요청의 반복**이 되어
  [`fetch.py:200`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200) 이 이미 무의미하다고 판정한 일을 다시 한다.
- `not res.ok` 를 빼면 **성공한 요청까지 한 번 더 보낸다.** ACAO 는 200 응답에도
  붙어 오므로(§10.5.2), 조건이 없으면 정상 스트림에서 매 실행마다 플레이리스트
  요청이 두 배가 된다. 서버 입장에서는 이상 트래픽이고, 계측 리포트의 TTFB 표본도
  오염된다.

여기서 일반 원리 하나가 나온다.

> **재시도가 뜻을 가지는 조건은 횟수가 아니라 "요청이 달라졌는가"다.** HTTP 는
> 무상태이므로(제4장), 같은 요청에 대한 판정은 서버 상태가 바뀌지 않는 한 같다.
> 재시도 로직을 한 계층에 몰아 넣으면 이 구분이 사라진다.

### 10.5.5 채택된 값은 어디까지 가는가

`_adopt_origin` 은 `fetcher.headers` 를 직접 고친다. 그 딕셔너리가 이 도구의 요청
헤더 **단일 출처(single source of truth)** 다.

```python
# cli.py:525-529
fetcher = Fetcher(headers=dict(given), timeout=args.timeout, retries=args.retries)
# 이후 요청 헤더의 단일 출처는 fetcher.headers 다. 기본 User-Agent 와 자동 채택한
# Referer 가 그 안에만 반영되므로, ffmpeg/ffprobe 에도 같은 dict 를 그대로 넘긴다.
# 따로 만든 사본을 넘기면 세그먼트 수신과 재조립이 서로 다른 헤더로 요청하게 된다.
headers = fetcher.headers
```

그래서 한 번 채택된 값이 네 경로에 동시에 반영된다 — 세그먼트 수신, `remux` 모드의
ffmpeg, ffprobe 실측, 자막 트랙 추출(`README.md:228-233`, [`probe.py:61`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L61)).

**"이렇게 하지 않으면 무엇이 깨지는가"** — 사본을 넘기면 세그먼트는 받아지는데
ffprobe 실측만 403 으로 실패하는, 원인을 짚기 극도로 어려운 상태가 된다. 같은
스트림을 같은 도구가 절반만 열 수 있게 된다.

부수 효과 하나가 더 있다. 자막 사이드카 탐색은 이 값을 **재사용**한다.

```python
# cli.py:292-301
def _sidecar_origin(args: argparse.Namespace, fetcher: Fetcher) -> str:
    """사이드카 자막을 찾을 호스트를 정한다.

    사용자 지정이 우선이고, 없으면 영상 요청에서 이미 확보한 origin 을 쓴다 —
    `_adopt_origin` 이 서버가 알려준 허용 origin 을 Referer 에 넣어 두었다면
    자막도 같은 곳에 있다. 그래서 호스트를 알아내려고 따로 요청하지 않는다.
    """
    if args.sub_origin:
        return args.sub_origin
    return fetcher.headers.get("Referer", "")
```

```python
# subtitles.py:384-386
#   호스트   영상 응답의 Access-Control-Allow-Origin 이 플레이어 origin 을 알려준다.
#            자막도 같은 origin 에 놓이므로 그대로 쓴다 (cli._adopt_origin 이 이미
#            이 값을 Referer 로 채택해 두므로, 새로 요청하지 않고 재사용한다).
```

한 번 흘러나온 값이 **인가 우회에만 쓰이는 것이 아니라 사이트 구조 탐색의 시작점이
된다**는 뜻이다. 누출된 정보의 용도는 누출시킨 쪽이 정하지 못한다. 값이 없으면
도구는 추측하지 않고 물러선다([`cli.py:319-322`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L319-L322)) — 짐작으로 만든 URL 은 헛요청이
되기 때문이다.

---

## 10.6 일반화 — 거부가 수용 조건을 말할 때

이 장의 구조는 CORS 에 한정되지 않는다. 형태를 추상화하면 이렇다.

> **어떤 통제가 거절할 때, 그 거절 응답이 "무엇이었다면 통과했는지"를 담고 있으면,
> 그 통제는 한 번의 시도로 무력화된다.**

이 성질을 가진 응답을 **오라클(oracle)** 이라 부른다.

> **용어** — **오라클(oracle)**: 공격자가 임의로 질의할 수 있고, 그 응답이 비밀에
> 관한 정보를 조금씩(또는 통째로) 흘리는 인터페이스. 응답이 흘리는 정보량이
> 필요한 질의 횟수를 결정한다.

| 사례 | 거부 응답이 흘리는 것 | 필요한 질의 횟수 |
|---|---|---|
| **403 + ACAO** (이 장) | 요구되는 Referer/Origin **전체 값** | **1** |
| 로그인 오류 문구 분리<br>("없는 아이디" ≠ "비밀번호 틀림") | 계정의 존재 여부 (user enumeration) | 계정당 1 |
| 패딩 오라클 (제24장) | 복호문의 패딩 유효성 1비트 | 바이트당 평균 128 |
| 비밀 비교의 타이밍 차이 | 일치한 접두사의 길이 | 바이트당 수십 |
| WAF 의 "차단된 패턴: …" | 필터 규칙 자체 | 규칙당 1 |
| 오브젝트 스토리지<br>(`AccessDenied` ≠ `NoSuchBucket`) | 버킷의 존재 여부 | 이름당 1 |
| 상세 스택 트레이스 | 프레임워크·버전·경로 구조 | 1 |

가장 위 행이 **최악**이라는 점을 보아야 한다. 다른 오라클들은 비밀을 한 조각씩
흘리므로 공격에 반복이 필요하고, 그래서 속도 제한·로그 감시 같은 대응이 의미를
가진다. **ACAO 누출은 값 전체를 한 번에 준다.** 반복이 없으니 이상 탐지에 걸리지도
않는다. 요청 한 건은 정상 트래픽과 구별되지 않는다.

두 번째 일반화는 §10.4 의 명제 1 이다.

| 영역 | 공개 목적의 선언 | 비밀 전제의 술어 | 둘을 묶으면 |
|---|---|---|---|
| CORS + 핫링크 차단 | ACAO | 허용 Referer 목록 | **이 장** |
| DNS + 내부망 접근 통제 | 공개 DNS 레코드 | "내부 호스트명은 모를 것" | 서브도메인 열거로 내부 구조 노출 |
| 인증서 투명성 로그 | 발급된 인증서 목록 | "이 스테이징 도메인은 비공개" | CT 로그 조회로 전량 노출 |
| 오류 페이지의 버전 표기 | 진단 편의 | "어떤 버전인지 모를 것" | 알려진 CVE 대조가 즉시 가능 |
| `robots.txt` | 크롤러 안내 | "이 경로는 숨겨져 있다" | 숨기려던 경로의 목록이 됨 |

각 행의 오른쪽 열이 같은 형태다. **비밀을 전제한 통제를, 공개를 전제한 채널과 같은
값으로 운용했다.**

---

## 10.7 보안 — 방어자 관점

우회 경로만 설명하고 끝내면 이 장은 절반이다. 고치는 쪽을 쓴다.

### 10.7.1 먼저 — 무엇이 실제 결함인가

결함 목록을 심각도 순으로 놓으면 이렇다.

| # | 결함 | 성격 |
|---|---|---|
| **A** | `Referer`/`Origin` 을 **인가 수단으로 쓴다** | 근본 결함. 클라이언트 자기 신고 값이므로 위조를 막지 못한다(제9장) |
| **B** | 그 술어의 값을 **모든 응답에 정적 상수로 선언한다** | 누출. A 를 뚫는 비용을 0 으로 만든다 |
| **C** | 거부 응답에까지 선언이 붙는다 | B 의 발현 조건 |

**B 와 C 만 고치고 A 를 남기면 아무것도 고쳐지지 않는다.** 이 순서를 뒤집는 것이
이 절에서 가장 중요한 주장이다. 그럼에도 B·C 를 고쳐야 하는 이유는 §10.7.3 에서
따로 적는다.

### 10.7.2 B·C 를 고치는 법 — 정적 상수를 조건부 반사로

원칙은 하나다. **ACAO 는 요청이 `Origin` 을 보냈을 때만, 그 값을 허용 목록과 대조한
뒤, 대조에 성공한 그 값만 되돌린다.** 목록에 없으면 헤더를 아예 붙이지 않는다.

| 요청이 보낸 `Origin` | 지금 구성 (정적 상수) | 고친 구성 (조건부 반사) |
|---|---|---|
| 없음 — `curl`·`hls-recon`·서버 간 호출 | `ACAO: https://site.example` ← **누출** | (헤더 없음) |
| `https://site.example` — 정상 플레이어 | `ACAO: https://site.example` | `ACAO: https://site.example`<br>`Vary: Origin` |
| `https://evil.example` — 도용 사이트 | `ACAO: https://site.example` ← **누출** | (헤더 없음) |
| `null` — 샌드박스 iframe·`file://` | `ACAO: https://site.example` ← **누출** | (헤더 없음) |

오른쪽 열의 성질을 한 문장으로 쓰면 이렇다.

> **고친 구성에서 ACAO 를 받는 유일한 요청은 이미 정답을 보낸 요청이다.**
> 즉 그 헤더는 새 정보를 전달하지 않는다.

`Vary: Origin` 이 함께 있어야 하는 이유가 있다.

> **용어** — **`Vary` 응답 헤더**: 이 응답이 어떤 **요청 헤더**에 따라 달라지는지를
> 캐시에게 알리는 헤더. 캐시는 그 헤더를 캐시 키에 포함해야 한다.

**"이렇게 하지 않으면 무엇이 깨지는가"** — `Vary: Origin` 없이 반사 구성을 쓰면,
중간 캐시가 `site.example` 용으로 계산된 `ACAO: https://site.example` 응답을 다른
출처의 요청에도 그대로 내준다. 반대 방향도 성립한다. 이것이 **CORS 캐시 오염(CORS
cache poisoning)** 의 고전적 형태이고, 반사 구성을 도입하면서 가장 자주 빠뜨리는
칸이다. 정적 상수 구성에는 이 문제가 없었으므로, **B 를 고치면서 새 결함을 들여올
수 있다**는 점을 기록해 둔다.

### 10.7.3 고치면 무엇이 나아지는가 — 정직하게

나아지지 **않는** 것부터 쓴다.

**플레이어 페이지의 주소는 원래 공개돼 있다.** 생각해 보면 당연하다. 그 m3u8 주소를
어디서 얻었는가 — 그 페이지에서 얻었다. 개발자도구를 연 사람은 이미 주소창을 보고
있다. 따라서 ACAO 누출을 막아도 공격자가 올바른 `Referer` 를 위조하는 데 드는 비용은
**0 에서 1 로** 오를 뿐이다. 수작업 한 단계가 늘어난다.

| 관점 | ACAO 누출을 막으면 |
|---|---|
| 개별 공격자 | **거의 나아지지 않는다.** 페이지를 열어 주소를 보면 된다 |
| 자동화 도구 | **나아진다.** 임의 CDN 주소만으로 플레이어 origin 을 알아내는 **일반화된** 경로가 사라진다 |
| 대량 스캔 | **나아진다.** 값을 얻으려면 사이트별 수작업이 필요해 규모의 경제가 깨진다 |
| 감사 | **나아진다.** 4xx 응답이 인가 술어를 서술하지 않는다는 것은 검사 가능한 불변식이다 |

즉 이 수정의 정확한 성과는 **"우회를 막았다"가 아니라 "우회의 자동화·일반화를
막았다"** 이고, 그것도 A 를 고치지 않는 한 임시적이다. 이 저장소가 하는 일이 바로
그 자동화라는 점이 방증이 된다 — **`_adopt_origin` 은 20줄이다.**

> 제15장의 표현을 빌리면, B 만 고치고 "핫링크 차단을 강화했다"고 기록하는 것은
> 보안 극장이다. 측정한 것(자동화 비용 상승)과 측정하지 못한 것(실제 우회 가능성)을
> 구분해 적어야 한다.

### 10.7.4 A 를 고치는 법

`Referer` 기반 통제를 대체하는 것은 **요청에 실린 자기 신고 값이 아니라 서버가
검증할 수 있는 값**이다.

| 방법 | 원리 | 다루는 장 |
|---|---|---|
| 서명 URL | 자원 경로·만료 시각에 서버 비밀로 HMAC 서명. 위조하려면 키가 필요하다 | 제11장 |
| 세션 토큰 + 자원 인가 | 요청자 신원을 확인하고 그 신원이 이 자원을 볼 권한이 있는지 판정 | 제12장 |
| 짧은 만료 | 유출되어도 유효 시간이 짧다. 대신 클라이언트 구현이 어려워진다(지연 해석) | 제11장 |

`Referer` 검사는 이들과 **함께** 두면 의미가 있다 — 대역 절약이나 캐주얼한 임베드
차단 같은 용도다. 그러나 그것을 **유일한** 관문으로 두는 순간, 통제의 강도는 "값을
알아내는 비용"과 같아지고, 이 장이 보인 대로 그 비용은 종종 0 이다.

### 10.7.5 감사 절차 — 두 번의 요청으로 확인한다

이 결함이 있는지는 두 요청으로 판별된다. 응답 헤더만 보므로 본문은 받지 않는다.

```bash
# ① Origin 을 보내지 않고
curl -sS -o /dev/null -D - 'https://cdn.example/hls/…/master.m3u8'

# ② 아무 값이나 Origin 으로 보내고
curl -sS -o /dev/null -D - -H 'Origin: https://audit.invalid' \
     'https://cdn.example/hls/…/master.m3u8'
```

판정표는 다음과 같다.

| ①의 ACAO | ②의 ACAO | 구성 | 판정 |
|---|---|---|---|
| 없음 | 없음 | CORS 미사용 또는 조건부 반사 | **양호** |
| 없음 | `https://audit.invalid` | **무조건 반사** | 위험 — 누구든 읽기 허용. 자격증명 동반 시 심각 |
| `https://site.example` | `https://site.example` | **정적 상수** | 이 장의 누출 |
| `*` | `*` | 전체 공개 | 누출은 아니나 통제도 아니다 |

②에서 보낸 값이 그대로 돌아오는 구성(무조건 반사)은 이 장의 누출보다 더 나쁘다.
`Access-Control-Allow-Credentials: true` 가 함께 있으면 임의 사이트가 사용자의
쿠키를 실은 요청 결과를 읽을 수 있다.

여기서 이 누출이 **구조적으로 발생하는 경로** 하나를 짚어야 한다. CORS 규격은
자격증명을 포함하는 요청에 대해 `ACAO: *` 를 금지한다 — 반드시 **구체적인 출처를
명시**해야 한다.

> **용어** — **자격증명 포함 요청(credentialed request)**: 쿠키·HTTP 인증·클라이언트
> 인증서를 실어 보내는 교차 출처 요청(`fetch(..., {credentials: 'include'})`).
> 이 경우 응답은 `ACAO` 에 정확한 출처를 명시하고
> `Access-Control-Allow-Credentials: true` 를 함께 보내야 한다.

즉 **세션 쿠키로 접근을 통제하는 사이트일수록 규격이 정확한 출처를 적도록 요구한다.**
그리고 그 값을 조건부로 계산하는 것보다 상수로 박는 편이 구성이 간단하다. 이 누출이
"부주의한 운영자의 실수"가 아니라 **규격 요구와 구성 편의가 만나는 지점에서 반복
생산되는 결함**인 이유다.

### 10.7.6 역할별로 해야 할 일

| 역할 | 해야 할 일 |
|---|---|
| **CDN·인프라 운영자** | ACAO 를 정적 상수로 무조건 붙이지 않는다. `Origin` 이 있을 때만 허용 목록과 대조해 그 값을 되돌리고 `Vary: Origin` 을 붙인다. `Origin` 없는 요청에 ACAO 를 붙일 이유는 없다 — 읽을 주체가 없다 |
| **서비스 설계자** | `Referer`/`Origin` 을 **유일한** 인가 수단으로 두지 않는다. 인가는 서명 URL 이나 세션 토큰으로 하고, Referer 검사는 보조 수단으로만 남긴다 |
| **보안 감사자** | 감사 범위에 **4xx 응답의 헤더 전량**을 넣는다. "차단되더라"에서 멈추지 말고 **차단 응답이 무엇을 말하는지** 읽는다. §10.7.5 의 2요청 절차를 회귀 검사로 고정한다 |
| **프런트엔드 개발자** | `*` 를 기본값으로 두지 않는다. 자격증명 요청에서는 규격상 `*` 를 못 쓰므로 정확한 출처를 상수로 박게 되는데, **그 상수가 어디까지 노출되는지**를 함께 검토한다 |
| **도구 구현자** | 추정으로 얻은 값과 사용자가 확정한 값을 구분해 다룬다. 추정은 화면에 밝히고([`cli.py:123`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L123)), 사용자 지정이 언제나 이긴다([`cli.py:116`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L116)) |
| **감사 대상 조직** | "CORS 를 설정했다"를 접근 통제 항목에 적지 않는다. CORS 는 통제 항목이 아니라 **공개 범위 선언** 항목이다 |

---

## 10.8 한계와 미해결

정직하게 적어 둔다.

- **채택 지점은 한 곳뿐이다.** `_adopt_origin` 은 `_load` 에서만 호출된다
  ([`cli.py:132`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L132)). 마스터 플레이리스트가 200 으로 열린 뒤 **variant 요청이 403** 인
  경우([`cli.py:185-187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L185-L187))나 세그먼트 병렬 수신이 막히는 경우에는 채택이 일어나지
  않는다. 후자는 [`cli.py:471`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L471) 에서 "토큰 만료 또는 Referer 검증 실패 가능성"이라는
  안내로만 끝난다. 자동 복구가 되는 범위는 **첫 요청이 막힌 경우**로 한정된다.
- **이 동작을 고정하는 회귀 테스트가 없다.** `tests/run.sh` 에는
  `Access-Control-Allow-Origin` 을 다루는 항목이 없다. 로컬 시험 서버
  (`tests/gzip_server.py`)가 이 헤더를 붙이지 않기 때문이다. 즉 §10.5.3 의 값별
  판정표는 **함수를 읽고 `urlparse` 동작을 확인해 도출한 것**이지 이 저장소의 테스트가
  보증하는 것이 아니다. 채택 실패 경로(`*`·`null`·헤더 없음)는 결함 주입 대상으로
  추가할 만하다.
- **ACAO 와 요구 Referer 의 일치는 경험칙이다.** 이 장은 §10.4 에서 그 일치의
  발생 구조를 설명했지만, **어떤 비율의 CDN 에서 실제로 일치하는지는 측정하지
  않았다.** 코드 주석도 "어디까지나 추정"이라고만 적는다([`cli.py:113-114`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L113-L114)). 불일치
  시의 동작(잘못된 Referer 로 한 번 더 실패)은 정의돼 있으나 그 빈도는 모른다.
- **§10.3 의 이유 2 는 이 저장소 밖의 지식이다.** 리버스 프록시가 오류 응답에 헤더를
  붙이는 옵션의 동작은 일반적으로 알려진 것을 서술한 것이고, 특정 CDN 의 실제 구성을
  확인한 것이 아니다. 관측된 사실은 "403 에 ACAO 가 붙어 왔다"까지이며, 그 원인이
  프록시 설정인지 애플리케이션 코드인지는 외부에서 구별되지 않는다.
- **자격증명 포함 요청이 관여했는지 확인하지 못했다.** §10.7.5 는 "그런 사이트일수록
  구체적 출처를 적게 된다"는 구조적 경향을 지적하지만, 문제의 CDN 이 실제로
  `Access-Control-Allow-Credentials: true` 를 보냈는지는 이 저장소에 기록이 없다.
  `FetchResult` 가 남기는 응답 헤더는 ACAO 와 `Content-Type`·`Content-Encoding` 뿐이고
  나머지는 버린다([`fetch.py:73-92`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L92)).
- **채택된 `Referer` 는 리포트에서 가려지지 않는다.** 편집 대상은
  `SENSITIVE_HEADERS = frozenset({"cookie", "authorization", "proxy-authorization",
  "x-api-key"})` 뿐이다([`report.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L33)). `Referer` 는 자격증명이 아니므로 이 판단은
  타당하지만, **결과적으로 리포트 JSON 에 "어느 사이트에서 받았는지"가 남는다.**
  자격증명 유출은 아니고 출처 기록이다 — 그 구분이 필요한 환경이라면 별도 검토
  대상이다(제12장).
- **`_adopt_origin` 이 보는 키는 `Referer` 하나다.** 사용자가 `--header 'Origin: …'`
  만 주고 `Referer` 를 주지 않은 상태에서는 자동 채택이 진행된다. 의도된 동작으로
  보이지만 주석에 명시돼 있지는 않다.

---

## 10.9 요약

1. **ACAO 는 "브라우저 JS 가 응답을 읽어도 되는 출처"이지 "서버가 요구하는 Referer"가
   아니다.** CORS 는 동일 출처 정책을 **완화**하는 규격이며, 접근을 제한하는 규격이
   아니다. 비브라우저 클라이언트에는 아무 효력이 없다.
2. **요청은 이미 서버에 도달했다.** ACAO 가 관여하는 유일한 지점은 응답이 만들어진
   뒤, 브라우저가 스크립트에게 그것을 넘길지 정하는 순간이다.
3. **그 헤더는 403 응답에도 붙는다.** 붙어야 플레이어가 "거부되었다"를 표시할 수
   있기 때문이며, 이는 규격 위반이 아니다. 문제는 "붙였다"가 아니라 **"무엇을
   붙였는가"** 에서 생긴다.
4. 도구가 `Origin` 을 보내지 않았는데도 구체적 출처가 돌아온다는 사실이,
   **그 값이 반사가 아니라 서버 구성의 정적 상수**임을 증명한다([`fetch.py:115`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L115),
   [`cli.py:488-501`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L488-L501)).
5. **누출은 하나의 구성값이 두 경로로 갈라지면서 생긴다** — 비밀을 전제한 입력 검사
   (핫링크 차단)와 공개를 전제한 출력 선언(ACAO). 그래서 **거부 응답이 수용 조건을
   서술하게 되고, 그 거부는 통제가 아니라 안내가 된다.**
6. `*` 는 근거가 되지 못한다. **의미론적으로** 어떤 출처도 지목하지 않고,
   **구문론적으로** URL 로 조립할 수 없다. 코드는 별도 분기 없이 origin 문법 검사로
   함께 걸러낸다([`cli.py:118-120`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L118-L120)).
7. **성공 경로와 실패 경로 양쪽에서 헤더를 읽어야 한다.** 성공에서만 읽으면 이 기능은
   필요한 순간에 작동하지 않는다 — 값이 쓸모 있는 유일한 경우가 요청이 막혔을 때이고,
   막힌 응답은 예외로 오기 때문이다([`fetch.py:194`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L194) ↔ [`fetch.py:198`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L198)).
8. **재시도가 뜻을 가지는 조건은 횟수가 아니라 "요청이 달라졌는가"다.** 4xx 에서 같은
   요청을 반복하는 것은 무의미하고([`fetch.py:200-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200-L201)), 헤더를 바꾼 뒤의 한 번은
   의미가 있다([`cli.py:132-133`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L132-L133)).
9. 방어의 순서는 **A(Referer 를 인가로 쓰는 것) → B(정적 상수 선언) → C(오류 응답
   주입)** 이다. B·C 만 고치면 **우회의 자동화·일반화는 막히지만 우회 자체는 막히지
   않는다.** 플레이어 주소는 원래 공개돼 있기 때문이다. 그 사실을 적지 않고 "강화했다"고
   기록하면 보안 극장이 된다.

---

**다음 장** — A 를 고치는 방법이 남았다. 클라이언트가 자기 신고하는 값 대신 서버가
검증할 수 있는 값으로 접근을 통제하려면 서명과 만료가 필요하고, 만료 시각이 URL 에
박히는 순간 **클라이언트 구현에 작업 순서 제약**이 생긴다. 27화 분량의 주소를 미리
모아 두면 뒤쪽이 반드시 깨지는 이유, 그리고 그것이 강제하는 지연 해석(late
resolution)을 제11장에서 다룬다.
