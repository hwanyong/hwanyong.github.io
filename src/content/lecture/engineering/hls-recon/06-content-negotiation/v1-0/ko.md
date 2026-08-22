---
title: "콘텐츠 협상의 부작용"
description: "압축, 범위, 그리고 충돌"
date: 2026-06-01
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-06-content-negotiation.svg
---
## 6.0 이 장에서 답할 것

1. 요청하지도 않은 압축이 왜 오고, 풀지 않으면 무엇이 깨지는가
2. Range 와 Content-Encoding 이 겹치면 **무엇이 정의되지 않는가**
3. 처리량을 해제 후 크기로 재면 왜 틀리는가 — 무엇을 세는 숫자인가
4. 압축을 푸는 코드가 왜 그 자체로 공격면인가 — **이 저장소의 실제 미방어 지점**

네 질문은 하나의 뿌리를 공유한다. HTTP 는 "같은 주소에 여러 표현이 있을 수 있다"는
전제 위에 서 있고, 그 전제가 **"이 바이트열이 무엇의 바이트열인가"를 흔든다.**

---

## 6.1 문제 — 플레이리스트가 바이너리로 온다

이 저장소의 회귀 테스트는 압축 응답만 돌려주는 전용 서버를 따로 띄운다. 그 이유가
파일 첫머리에 적혀 있다.

```python
# tests/gzip_server.py:1-6
"""플레이리스트를 gzip 으로만 응답하는 테스트 서버.

Python 기본 http.server 는 압축을 전혀 하지 않아 이 경로를 재현하지 못한다.
실제 CDN 은 브라우저 User-Agent 를 보면 클라이언트가 무엇을 요청했든 압축해
돌려주는 경우가 있고, 그때 압축을 풀지 않으면 플레이리스트가 바이너리로 보여
'#EXTM3U 헤더가 없다'로 실패한다.
```

증상은 파서에서 나타나지만 원인은 전송 계층에 있다. 플레이리스트 파서는 첫 줄이
`#EXTM3U` 인지만 보는데, 받은 본문이 gzip 이면 첫 두 바이트가 `1f 8b` 다. 파서 입장에서
이것은 "M3U8 이 아닌 무언가"이고, 그 이상은 말할 수 없다.

그래서 이 저장소는 진단을 전송 계층까지 끌고 내려간다([`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)). 그 함수를
실제로 호출해 얻은 출력이다.

```
플레이리스트로 해석할 수 없는 응답이다: http://cdn/index.m3u8

  HTTP 상태      : 200
  Content-Type   : application/vnd.apple.mpegurl
  Content-Encoding: (없음)
  본문 크기      : 770 B
  선두 바이트    : 1f8b08000000000002ff7dd64d4a9c51
  선두 문자      : ..........}.MJ.Q.....p..T....`'.I...n@....b..Q.;

  → gzip 인데 Content-Encoding 이 선언되지 않았다. 서버 설정 문제다.
```

이 진단이 나온 상황에는 세 값이 겹쳐 있다 — 상태 200, Content-Type 은 정상, 그런데
본문 선두가 `1f 8b`. 이 중 선두 두 바이트를 보고 갈라내는 분기가 코드에 명시적으로 있다.

```python
# cli.py:80-81
elif res.body[:2] == b"\x1f\x8b":
    lines.append("  → gzip 인데 Content-Encoding 이 선언되지 않았다. 서버 설정 문제다.")
```

여기서 실패의 모양이 둘로 갈린다. 둘은 책임 소재가 다르고, 고치는 쪽도 다르다.

| 경우 | 서버가 보낸 것 | 클라이언트가 해야 할 것 | 책임 |
|---|---|---|---|
| **(a) 선언된 압축** | `Content-Encoding: gzip` + gzip 본문 | 선언대로 해제한다 | 클라이언트 — 안 풀면 자기 잘못 |
| **(b) 선언되지 않은 압축** | 헤더 없음 + gzip 본문 | 규격상 할 일이 없다. 진단만 낸다 | **서버** — 규격 위반 |

(b) 를 자동으로 풀어 주는 클라이언트를 만들 수도 있다. 그러나 그것은 제14장에서 본
콘텐츠 스니핑을 **판별이 아니라 처리 결정**에 쓰는 일이 되고, 그 순간 "선두 두 바이트가
우연히 `1f 8b` 인 정상 세그먼트"라는 오탐 경로가 열린다. 이 저장소는 (b) 를 고치지 않고
**보고만 한다.**

그리고 이 장의 두 번째 문제가 있다. 플레이리스트가 이렇게 적혀 있을 때다.

```
#EXT-X-BYTERANGE:500000@1500000
segment.ts
```

세그먼트가 파일 전체가 아니라 **한 파일 안의 바이트 구간**이다. 이때 압축이 겹치면
무엇이 되는가 — 이것이 §6.3 의 주제다.

---

## 6.2 원리 — 콘텐츠 협상이란 무엇인가

> **용어** — **콘텐츠 협상(content negotiation)**: 같은 URI 가 여러 표현을 가질 때,
> 그중 어떤 표현을 보낼지 클라이언트의 선호와 서버의 판단으로 정하는 절차.

> **용어** — **표현(representation)**: 어떤 자원의 특정 시점·특정 형식의 바이트열과 그
> 메타데이터. 하나의 자원(resource)에 여러 표현이 있을 수 있다 — 한국어판과 영어판,
> gzip 판과 무압축판이 모두 같은 자원의 서로 다른 표현이다.

> **용어** — **콘텐츠 코딩(content coding)**: 표현의 바이트열에 적용된 변환(주로 압축).
> `Content-Encoding` 이 이것을 선언한다. **표현의 일부**이며 종단 간(end-to-end)이다.

이 정의에서 이미 이 장의 결론이 나온다. **압축은 전송 방식이 아니라 표현의 성질이다.**
gzip 으로 압축된 플레이리스트는 "같은 것을 다르게 보낸 것"이 아니라 **다른 표현**이다.

### 6.2.1 협상 축은 여럿이고, 축마다 성질이 다르다

| 요청 헤더 | 협상하는 것 | 실패했을 때 |
|---|---|---|
| `Accept` | 미디어 타입 | 406 또는 서버가 임의 선택 |
| `Accept-Language` | 자연어 | 기본 언어 |
| `Accept-Encoding` | **콘텐츠 코딩(압축)** | **클라이언트가 본문을 못 읽는다** |
| `User-Agent` | 규격 밖 축 — 실무에서 압축·레이아웃 분기의 근거로 쓰인다 | 예측 불가 |

`Accept-Encoding` 만 성질이 다르다. 다른 축은 "덜 좋은 것"을 받는 데서 끝나지만, 이 축이
어긋나면 **본문이 아예 해독 불가능한 바이트열이 된다.** §6.1 의 증상이 그것이다.

`User-Agent` 가 표에 들어가 있는 것이 이 코드의 관찰이다.

```python
# fetch.py:24-27
# 브라우저 UA 로 요청하면 서버가 압축 응답을 돌려주는 경우가 흔하다. 요청해두고
# 직접 해제한다 — 텍스트인 플레이리스트에서 전송량이 크게 준다.
# brotli(br)는 표준 라이브러리로 풀 수 없으므로 요청하지 않는다.
ACCEPT_ENCODING = "gzip, deflate"
```

브라우저 UA 를 쓰면([`fetch.py:20-23`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L20-L23)) 서버가 압축을 돌려줄 확률이 올라간다. 즉 **한 축의
위장이 다른 축의 결과를 바꾼다.** 협상 축들은 독립이 아니다.

### 6.2.2 협상은 명령이 아니라 선호다

`Accept-Encoding: identity` 는 "압축하지 마라"가 아니라 "압축하지 않은 표현이 내가 받을
수 있는 것"이라는 **진술**이다. 규격은 서버에게 이를 존중하라고 SHOULD 수준으로 요구할
뿐, 강제할 수단이 없다. 이 저장소의 테스트 서버가 바로 그 반례다.

```python
# tests/gzip_server.py:31-38
self.send_response(200)
self.send_header("Content-Type", _content_type(target.suffix))
if compress:
    # 클라이언트가 Accept-Encoding 으로 무엇을 보냈든 압축해 보낸다.
    self.send_header("Content-Encoding", "gzip")
self.send_header("Content-Length", str(len(body)))
self.end_headers()
self.wfile.write(body)
```

그리고 회귀 테스트는 **그 무시가 실제로 일어나는지를 따로 검증한다.**

```bash
# tests/run.sh:189-192
# 압축을 요청조차 하지 않으면 이 경로는 애초에 검증되지 않는다.
curl -s -H 'Accept-Encoding: identity' -o /dev/null -D - \
  "http://127.0.0.1:$GZIP_PORT/plain/index.m3u8" | grep -qi 'content-encoding: gzip' \
  && ok "테스트 서버가 실제로 압축 응답" || bad "테스트 서버가 압축하지 않음"
```

이것은 제8부의 **테스트 오라클 문제**(제34장)가 전송 계층에 나타난 형태다. "압축 해제
경로가 통과했다"는 사실은, **서버가 실제로 압축을 보냈을 때만** 정보가 된다. 서버가
압축을 안 보내면 해제 코드는 한 줄도 실행되지 않은 채 테스트가 초록으로 뜬다.
그래서 테스트는 도구가 아니라 **환경을 먼저 검사한다.**

직접 확인한 응답이다.

```
$ curl -s -D - -o /dev/null -H 'Accept-Encoding: identity' http://127.0.0.1:8991/index.m3u8
HTTP/1.0 200 OK
Content-Type: application/vnd.apple.mpegurl
Content-Encoding: gzip
Content-Length: 770
```

`identity` 를 달라고 했는데 `gzip` 이 왔다. **클라이언트가 요청 헤더로 얻은 보장은 0 이다.**

### 6.2.3 콘텐츠 코딩과 전송 코딩은 다른 층이다

> **용어** — **전송 코딩(transfer coding)**: 한 홉(hop) 구간에서만 적용되는 인코딩.
> `Transfer-Encoding: chunked` 가 대표적이다. 다음 홉으로 넘어갈 때 벗겨질 수 있다.

이 구분이 이 장에 필요한 이유는 하나다. **범위 요청은 콘텐츠 코딩에는 걸리고 전송
코딩에는 걸리지 않는다.** `chunked` 로 잘려 온 본문은 프록시가 이어붙이면 원래 표현이
되지만, `gzip` 은 벗겨지지 않고 표현의 일부로 남는다. 그래서 "몇 번째 바이트"라는
질문의 답이 콘텐츠 코딩에서만 갈린다.

---

## 6.3 규격은 무엇을 정하는가 — 그리고 무엇을 정하지 않는가

### 6.3.1 두 규격이 서로 다른 원점을 쓴다

HTTP(RFC 9110)에서 바이트 범위는 **선택된 표현(selected representation)** 위에서 센다.
표현에는 콘텐츠 코딩이 이미 적용돼 있으므로, `Range: bytes=0-99` 는 **압축된 바이트의
0–99** 를 뜻한다.

HLS(RFC 8216 §4.3.2.2)의 `EXT-X-BYTERANGE` 는 `n@o` 표기로 **"URI 가 가리키는 자원의
부분 구간"** 을 뜻한다. 여기서 오프셋은 디스크에 놓인 파일, 즉 **압축되지 않은 바이트**
기준이다. 세그먼트를 만든 도구(패키저)가 그 오프셋을 계산할 때 gzip 은 존재하지도
않았다.

이 저장소의 파서는 그 표기를 그대로 옮긴다.

```python
# playlist.py:327-329
elif line.startswith("#EXT-X-BYTERANGE:"):
    n, _, o = line.split(":", 1)[1].partition("@")
    cur_range = (int(n), int(o) if o else prev_range_end)
```

그리고 페처가 그것을 HTTP 헤더로 번역한다.

```python
# fetch.py:155-161
if byterange:
    length, offset = byterange
    headers["Range"] = f"bytes={offset}-{offset + length - 1}"
    # 부분 요청에 압축이 걸리면 바이트 범위의 의미가 깨진다.
    headers.setdefault("Accept-Encoding", "identity")
else:
    headers.setdefault("Accept-Encoding", ACCEPT_ENCODING)
```

**번역이 성립하려면 두 규격의 원점이 같아야 한다.** 압축이 걸리면 같지 않다.

![같은 범위 요청이 가리키는 두 좌표계](/images/lecture/hls-recon/06-range-vs-encoding.svg)

*그림 6-1 — 같은 `bytes=` 숫자가 자원 좌표계와 표현 좌표계에서 서로 다른 곳을 가리킨다. 압축된 표현에서는 그 위치가 아예 존재하지 않을 수도 있다.*

### 6.3.2 서버가 취할 수 있는 선택지가 넷인데, 규격이 하나로 좁혀 주지 않는다

같은 요청(`Range: bytes=1500000-1999999`)에 대해 구현이 갈릴 수 있는 지점을 정리하면
이렇다.

| 서버 구현 | 돌려주는 것 | 클라이언트가 얻는 것 |
|---|---|---|
| **압축 → 절단** | 압축된 표현의 1.5M–2.0M 구간 | 압축 스트림의 중간 토막. **단독으로 풀 수 없다** |
| **절단 → 압축** | 자원의 1.5M–2.0M 을 압축 | 풀면 원하는 구간. 그러나 이때 `Content-Range` 의 숫자는 자원 좌표계다 |
| **Range 무시** | 200 + 전체 표현 | 요청한 500 KB 대신 자원 전부 |
| **범위 불가 판정** | 416 | 실패. 그나마 정직하다 |

첫 두 행이 문제의 핵심이다. **둘 다 규격 문장을 인용해 자기를 정당화할 수 있다.**
클라이언트는 받은 바이트만 보고 어느 쪽인지 알아낼 방법이 없다 — 두 경우 모두
`206` + `Content-Encoding: gzip` + `Content-Range: bytes 1500000-1999999/…` 로 올 수 있다.

### 6.3.3 애초에 압축 스트림은 임의 구간만 떼어 풀 수 없다

구현 분기를 다 제쳐 두더라도, "압축 후 절단" 쪽은 원리적으로 막혀 있다.

| 이유 | 내용 |
|---|---|
| **역참조 윈도** | DEFLATE(RFC 1951)는 앞선 최대 32 KiB 의 출력을 참조해 길이·거리 쌍으로 인코딩한다. 중간부터 시작하면 참조 대상이 없다 |
| **비트 정렬** | 심볼이 바이트 경계에 맞지 않는다. 임의 바이트 오프셋은 심볼 경계도 아니다 |
| **허프만 표** | 동적 허프만 블록의 코드 표는 블록 머리에 있다. 중간 토막에는 표가 없다 |
| **트레일러** | gzip 은 끝에 CRC32 와 ISIZE, zlib 은 Adler-32 가 붙는다. 토막에는 검증자가 없다 |

즉 "압축된 표현의 부분"은 규격상 말이 되지만 **쓸모가 없다.** 그래서 [`fetch.py:159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L159) 는
답을 고르는 대신 **질문을 없앤다** — 범위 요청에서는 협상을 포기하고 `identity` 를
요구한다. 두 좌표계를 하나로 만드는 유일한 방법이다.

> **이렇게 하지 않으면** — 범위 요청에 `gzip, deflate` 를 그대로 실어 보내면, 압축을
> 해 주는 CDN 을 만났을 때 세그먼트마다 다른 실패가 난다. 어떤 것은 `zlib.error` 로
> 죽고, 어떤 것은 조용히 엉뚱한 구간을 돌려주며, 어떤 것은 전체 파일을 돌려준다.
> **원인이 요청 헤더 한 줄인데 증상은 세 가지로 나타난다.**

---

## 6.4 코드 — 다섯 개의 결정

### 6.4.1 무엇을 요청하는가

`ACCEPT_ENCODING = "gzip, deflate"` 에는 두 개의 부재가 있다.

| 코딩 | 형식 | 파이썬 표준 라이브러리 | 이 코드 |
|---|---|---|---|
| `gzip` · `x-gzip` | RFC 1952 (deflate + 헤더/트레일러) | `gzip` | 요청·해제 |
| `deflate` | RFC 1950(zlib 래퍼) **또는** RFC 1951(raw) | `zlib` | 요청·해제(양쪽 시도) |
| `br` | RFC 7932 (Brotli) | **없음** | 요청하지 않음 |
| `zstd` | RFC 8878 (Zstandard) | 3.14 부터 `compression.zstd` | 요청하지 않음 |
| `identity` | 무변환 | — | 범위 요청에서 강제 |

brotli 를 요청하지 않는 이유는 성능 판단이 아니라 **의존성 판단**이다. 이 저장소가
`pyproject.toml:10` 에서 선언한 것은 `requires-python = ">=3.10"` 이고, 서드파티 의존은
복호화용 `cryptography` 하나뿐이라(`pyproject.toml:25`) 압축 경로는 표준 라이브러리만
쓴다. `br` 을 요청해 놓고 풀 수 없으면 §6.1 의 (a) 를 자초하는 셈이 된다.

**요청하지 않은 코딩은 오지 않는다** — 는 것도 §6.2.2 에서 봤듯 보장이 아니다. 그래서
해제기는 모르는 코딩을 만나면 조용히 넘기지 않고 예외를 던진다([`fetch.py:70`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L70)).

zstd 는 Python 3.14 에서 표준 라이브러리에 들어왔다(PEP 784). 그러나 이 저장소가
선언한 하한이 3.10 이므로 지금 채택하면 **하한을 3.14 로 끌어올리는 것**과 같다.
압축률을 얻는 대가로 실행 가능한 환경을 잃는 교환이며, 이 코드는 그 교환을 하지 않았다.

### 6.4.2 무엇을 해제하는가

```python
# fetch.py:57-70
def _decompress(body: bytes, encoding: str) -> bytes:
    """Content-Encoding 에 따라 본문을 해제한다."""
    enc = encoding.lower().strip()
    if not body or enc in ("", "identity"):
        return body
    if enc in ("gzip", "x-gzip"):
        return gzip.decompress(body)
    if enc == "deflate":
        # zlib 래퍼를 붙이는 서버와 raw deflate 를 보내는 서버가 섞여 있다.
        try:
            return zlib.decompress(body)
        except zlib.error:
            return zlib.decompress(body, -zlib.MAX_WBITS)
    raise ValueError(f"해제할 수 없는 Content-Encoding: {encoding}")
```

`deflate` 의 이중 시도가 이 함수의 전부라 해도 좋다. **`deflate` 라는 이름 하나가 두
형식을 가리킨다.**

- 규격이 뜻하는 것: RFC 1950 의 **zlib 래퍼**(2바이트 헤더 + DEFLATE + Adler-32)
- 실제로 오는 것 중 일부: RFC 1951 의 **raw DEFLATE**(래퍼 없음)

같은 입력을 두 방식으로 압축해 선두 2바이트를 비교하면 차이가 보인다.

```
zlib 래퍼:   78 9c …
raw deflate: bd da …        ← 압축 데이터가 바로 시작한다
```

파이썬에서 둘을 가르는 것은 `wbits` 인자 하나다. `zlib.decompress(body)` 는 래퍼를
기대하고, `zlib.decompress(body, -zlib.MAX_WBITS)` 는 음수 `wbits` 로 "래퍼 없음"을
지시한다. 실제 실패 메시지는 이렇다.

```
raw 를 zlib 로 풀면 → zlib.error: Error -3 while decompressing data: incorrect header check
```

순서도 의미가 있다. **규격 준수 형식을 먼저 시도하고, 실패하면 관행 형식으로 내려간다.**
반대로 하면 규격을 따르는 서버가 관행 경로에서 우연히 통과할 여지를 먼저 열게 된다.

> **이렇게 하지 않으면** — `zlib.decompress` 한 번만 호출하는 구현은 raw deflate 를
> 보내는 서버에서 100% 실패한다. 그런데 그 실패는 "플레이리스트에 `#EXTM3U` 가 없다"로
> 표면화된다. 원인과 증상이 두 계층 떨어져 있어서, 로그만 보면 서버가 잘못된 파일을
> 보낸 것처럼 보인다.

### 6.4.3 해제 실패는 재시도하지 않는다

호출부의 처리가 이 함수만큼 중요하다.

```python
# fetch.py:170-180
with urllib.request.urlopen(req, timeout=self.timeout) as resp:
    ttfb = (time.perf_counter() - t0) * 1000
    raw = resp.read()
    total = (time.perf_counter() - t0) * 1000
    encoding = resp.headers.get("Content-Encoding", "") or ""
    try:
        body = _decompress(raw, encoding)
    except Exception as e:  # noqa: BLE001 — 해제 실패는 응답 손상으로 다룬다
        last_err = f"Content-Encoding={encoding} 해제 실패: {e}"
        last_status = resp.status
        break
```

`break` 다 — 재시도 루프를 **빠져나간다.** 이것은 [`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201) 의 "4xx 는
재시도해도 결과가 같다"와 같은 논리다.

| 실패 종류 | 재시도 | 근거 |
|---|---|---|
| 연결 오류·타임아웃 | **한다** | 다음 시도에서 달라질 수 있다 |
| 4xx (408·429 제외) | 안 한다 | 같은 요청에 같은 답 |
| **해제 실패** | **안 한다** | 본문 전체가 도착했는데도 풀리지 않았다면 재요청해도 같은 바이트다 |

본문이 중간에 끊겼다면 `resp.read()` 자체가 예외를 내고 일반 예외 경로([`fetch.py:202`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L202))로
가서 **재시도된다.** 즉 이 코드는 "전송 중 끊김"과 "도착했는데 해석 불가"를 다른
사건으로 구별한다. 압축 해제기가 사실상 **응답 무결성 검사기** 역할을 하는 셈이다 —
gzip 의 CRC32 가 실패하면 그것은 본문이 손상됐다는 뜻이다.

### 6.4.4 언제 협상을 포기하는가 — `setdefault` 의 의미

[`fetch.py:159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L159) 의 `identity` 강제는 `headers["…"] = …` 가 아니라 `setdefault` 다. 사용자가
직접 지정한 헤더가 이긴다는 뜻이다([`fetch.py:146-150`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L146-L150)의 원칙). **이 방어는 기본값이지
불변식이 아니다.** 직접 확인한 결과다.

| 사용자 입력 | 실제로 나가는 값(범위 요청) | 이유 |
|---|---|---|
| 없음 | `identity` | `setdefault` 가 채운다 |
| `--header 'Accept-Encoding: gzip, deflate, br'` | `gzip, deflate, br` | 이미 키가 있어 `setdefault` 가 덮지 않는다 |
| `--header 'accept-encoding: br'` | **`identity`** | urllib 이 헤더 이름을 `capitalize()` 로 정규화해 두 키가 `Accept-encoding` 하나로 합쳐지고, 나중에 추가된 쪽이 이긴다 |

셋째 행은 실측이다. `urllib.request.Request` 는 `add_header` 에서 이름을 `capitalize()`
하므로 `Accept-Encoding` 과 `accept-encoding` 이 **같은 키가 된다.** HTTP 헤더 이름은
대소문자를 구별하지 않는데 파이썬 딕셔너리는 구별하므로, 병합 결과가 **입력의 대소문자에
따라 달라진다.** 사용자가 개발자도구에서 헤더를 통째로 복사해 붙이는 흔한 사용 방식에서
이 차이가 그대로 드러난다.

그나마 다행인 것은 `br` 이 실제로 왔을 때의 동작이다. `_decompress` 가 `ValueError` 를
던지고 요청이 실패한다 — **조용히 틀리지 않고 시끄럽게 실패한다.** 이 저장소가 여러 곳에서
반복하는 선택이다(제24장의 패딩 처리와 정반대 방향처럼 보이지만, 두 결정 모두 "손상을
그 자리에서 드러낸다"는 같은 목표를 향한다).

### 6.4.5 무엇을 계측하는가 — 두 개의 크기

`FetchResult` 는 크기를 **두 개** 들고 다닌다.

```python
# fetch.py:80-83
body: bytes = b""  # 압축을 푼 뒤의 본문
size: int = 0  # 해제 후 크기
wire_size: int = 0  # 실제로 회선을 지나간 바이트 (압축된 상태)
encoding: str = ""  # Content-Encoding 원문
```

```python
# fetch.py:94-104
@property
def compressed(self) -> bool:
    return bool(self.encoding) and self.encoding.lower().strip() != "identity"

@property
def throughput_mbps(self) -> float:
    """회선 성능이므로 해제 후 크기가 아니라 실제 전송 바이트로 계산한다."""
    wire = self.wire_size or self.size
    if self.total_ms <= 0 or not wire:
        return 0.0
    return (wire * 8) / (self.total_ms / 1000) / 1_000_000
```

왜 이 구분이 필요한지는 실측이 답한다. 300 세그먼트짜리 VOD 플레이리스트를 gzip 으로
압축한 결과다.

| 플레이리스트 | 원본 | gzip | 비율 |
|---|---|---|---|
| 상대 URI (`seg000.ts`) | 8,464 B | 770 B | **11.0배** |
| 서명된 절대 URL (`https://cdn…?md5=…&expires=…`) | 30,988 B | 1,018 B | **30.4배** |

둘째 행이 실제 송출에 가깝다. 서명 URL(제11장)은 세그먼트마다 거의 같은 문자열이
반복되므로 압축률이 극단적으로 좋다.

**해제 후 크기로 처리량을 계산하면 이 회선은 30배 빠른 것으로 보고된다.** 100 Mbps
링크에서 3 Gbps 가 나오는 리포트가 만들어진다. 물리적으로 불가능한 숫자를 리포트가
당당히 출력하는 순간, 그 리포트의 다른 숫자도 믿을 수 없게 된다.

정리하면 **무엇을 재느냐에 따라 써야 할 크기가 다르다.**

| 지표 | 써야 할 크기 | 이유 |
|---|---|---|
| 처리량(Mbps) | `wire_size` | 회선을 지나간 것은 압축된 바이트다 |
| 대역 과금·전송량 | `wire_size` | 과금 대상은 전송량이다 |
| 디스크·메모리 용량 | `size` | 저장되는 것은 해제된 바이트다 |
| 무결성 해시 | `size` 쪽(해제 후 본문) | 아래 참조 |

해시가 해제 후 본문에 대해 계산된다는 점([`fetch.py:193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L193))은 별도로 짚을 만하다.

```python
sha256=hashlib.sha256(body).hexdigest(),
```

`raw` 가 아니라 `body` 다. 그래야 **같은 세그먼트가 압축 여부에 따라 다른 해시를 갖지
않는다.** 리포트의 세그먼트 중복 검사([`report.py:213`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L213))는 해시 집합의 크기를 비교하는데,
압축된 응답과 압축되지 않은 응답이 섞이면 같은 내용이 다른 해시로 보여 중복을 놓친다.
**해시는 표현이 아니라 자원에 대해 계산해야 한다** — 이 장의 좌표계 문제가 해시에도
그대로 나타난 것이다.

리포트는 두 크기를 함께 보여 준다.

```python
# report.py:183-196
compressed = [f for f in fetches if f.ok and f.compressed]
wire_bytes = sum(f.wire_size or f.size for f in fetches if f.ok)
rep.add(
    "응답 지연",
    WARN if _quantile(ttfb, 0.95) > 3000 else PASS,
    f"TTFB p50 {_quantile(ttfb, 0.5):.0f}ms / p95 {_quantile(ttfb, 0.95):.0f}ms, "
    f"처리량 중앙값 {_quantile(tput, 0.5):.1f} Mbps"
    + (
        f", {len(compressed)}개 압축 전송 "
        f"({wire_bytes / 1e6:.1f}→{total_bytes / 1e6:.1f}MB)"
        if compressed
        else ""
    ),
)
```

`(회선 → 해제 후)` 를 나란히 적는다. 사후 분석에서 "이 CDN 이 세그먼트까지 압축하고
있었다"를 발견할 수 있는 유일한 기록이다. 참고로 **이미 압축된 미디어를 다시 압축하는
것은 CPU 만 쓰고 크기는 거의 줄지 않는다** — 이 두 숫자가 비슷하면 서버 설정을 의심할
근거가 된다.

---

## 6.5 실습 — 무시된 범위 요청을 직접 재현하기

이 저장소의 테스트 서버는 `Range` 를 아예 구현하지 않는다(`tests/gzip_server.py:21-29`
— 파일 전체를 읽어 그대로 보낸다). 그래서 §6.3.2 표의 셋째 행 "Range 무시"를
그대로 재현할 수 있다.

```bash
python3 tests/gzip_server.py 8992 <플레이리스트가_있는_디렉터리> &
```

`Fetcher` 를 그대로 써서 100바이트 구간을 요청했다.

```python
from hlsrecon.fetch import Fetcher
f = Fetcher(retries=1)
# 세그먼트가 자원의 100~199 바이트라고 선언된 상황: (length, offset) = (100, 100)
r = f.get("http://127.0.0.1:8992/index.m3u8", byterange=(100, 100))
```

결과다.

```
요청 Range: bytes=100-199,  Accept-Encoding: identity 강제
ok=True status=200 encoding='gzip'
wire_size=770  size=8464   (요청한 길이=100)
본문 선두 24바이트: b'#EXTM3U\n#EXT-X-VERSION:3'
```

**네 가지가 한꺼번에 어긋났다.**

| 요청 | 응답 | 코드의 반응 |
|---|---|---|
| `Range: bytes=100-199` | `200` (206 아님) | 확인하지 않는다 |
| 100 바이트 | 8,464 바이트 (84.6배) | 확인하지 않는다 |
| `Accept-Encoding: identity` | `Content-Encoding: gzip` | **해제해서 받아들인다** |
| 자원의 100–199 구간 | 자원 전체 | `ok=True` |

세그먼트로 쓰였다면 그 파일에는 "자원의 100바이트 구간" 대신 **자원 전체**가 들어간다.
자원이 진짜 미디어 파일이었다면 `sniff()`(제14장)도 이것을 잡지 못한다 — 내용은 여전히
정상적인 MPEG-TS 이기 때문이다. **틀린 것은 내용이 아니라 경계다.**

이것이 이 장의 정직한 결론 중 하나다. **`identity` 강제는 문제를 예방하지만, 예방이
실패했는지는 검사하지 않는다.** 요청은 했고, 확인은 안 했다.

---

## 6.6 일반화 — 부분을 지목하려면 전체가 하나로 고정돼야 한다

이 장의 충돌은 스트리밍 고유의 문제가 아니다. 일반형은 이렇다.

> **어떤 대상의 "부분"을 좌표로 지목하는 기능과, 그 대상 자체를 변형하는 기능이
> 겹치면, 좌표의 원점이 정의되지 않는다.**

같은 구조가 나타나는 곳들이다.

| 겹침 | 흔들리는 좌표 | 나타나는 증상 |
|---|---|---|
| `Range` × `Content-Encoding` | 바이트 오프셋의 원점 | 이 장 |
| `Range` × 여러 표현(`Vary`) | 어느 표현의 오프셋인가 | 이어받기가 서로 다른 표현을 이어붙인다 |
| `Content-Length` × 압축 | 어느 크기인가 | 진행률 표시가 100% 를 넘거나 못 채운다 |
| `ETag` × 압축 | 표현의 동일성 | 압축판과 무압축판이 같은 ETag 를 쓰면 캐시가 섞는다 |
| 문자열 오프셋 × 인코딩 | 바이트인가 코드포인트인가 | 이모지 하나에 잘림·인덱스 어긋남 (제31장) |
| URL 오프셋 × 퍼센트 인코딩 | 인코딩 전인가 후인가 | `%20` 과 `%2520` (제7장) |
| DB `LIMIT/OFFSET` × 불안정 정렬 | 행의 순서 | 페이지 경계에서 행이 중복·누락 |

마지막 행까지 같은 형태다. 페이지 2 를 요청하는 순간 정렬 기준이 흔들려 있으면
"21–40번째 행"이라는 지목 자체가 뜻을 잃는다.

**해법의 형태도 언제나 같다.** 셋 중 하나다.

1. **좌표계를 고정한다** — 변형을 끈다. `Accept-Encoding: identity` 가 이것이다
2. **좌표를 내용에 붙인다** — 오프셋 대신 커서·키를 쓴다(키셋 페이지네이션)
3. **동일성을 검증한다** — 강한 검증자(ETag)를 함께 보내 다른 표현이면 거부한다

HTTP 는 3번 장치를 갖고 있지만(`If-Range`), 이 코드는 1번을 골랐다. **가장 단순하고,
클라이언트 혼자 결정할 수 있는 유일한 방법**이기 때문이다. 2·3번은 서버의 협조가 필요하고,
협조는 §6.2.2 에서 보았듯 요청할 수는 있어도 확보할 수는 없다.

---

## 6.7 보안

### 6.7.1 압축 폭탄 — 이 저장소의 실제 미방어 지점

> **용어** — **압축 폭탄(decompression bomb / zip bomb)**: 압축된 상태에서는 작지만
> 해제하면 방어자의 메모리·디스크를 고갈시키도록 만들어진 데이터. 자원 소진(DoS)
> 공격의 한 형태다.

`_decompress` 는 `gzip.decompress(body)` 를 부른다. **이 API 에는 크기 상한 인자가 없다.**
저장소의 `_decompress` 를 그대로 불러 실측했다.

| 항목 | 값 |
|---|---|
| 회선을 지나간 바이트 | 1,019,197 B (995 KiB) |
| 해제 결과 | 1,048,576,000 B (1,000 MiB) |
| 팽창률 | **1,029배** |
| 해제 시간 | 1.01 s |
| 프로세스 피크 RSS | **2,110 MB** |

피크 메모리가 결과의 두 배인 것은 `gzip.decompress` 가 조각을 모았다가 한 번에 잇기
때문이다. **1 MB 를 보내면 2 GB 를 쓴다.** 1,029배는 단일 DEFLATE 스트림의 이론적 상한
(약 1,032:1)에 거의 닿아 있다.

![압축 해제 증폭 경로](/images/lecture/hls-recon/06-decompression-amplification.svg)

*그림 6-2 — 회선에서 메모리까지의 경로와, 상한을 걸 수 있는 유일한 지점.*

**중요한 것은 이것이 압축이 만든 취약점이 아니라는 점이다.** `raw = resp.read()`
([`fetch.py:172`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L172)) 에도 상한이 없다. 압축 없이도 서버는 무한히 큰 본문을 흘려보내 같은
결과를 만들 수 있다. 압축이 바꾸는 것은 하나다.

> **공격자의 비용이 1/1,029 로 떨어진다.** 취약점의 존재가 아니라 **증폭률**이 압축의
> 기여분이다.

그리고 해제 후 크기를 미리 알 방법이 없다.

| 후보 | 왜 못 쓰는가 |
|---|---|
| `Content-Length` | 압축된 크기다. 팽창 후 크기와 무관하다 |
| gzip 트레일러의 ISIZE | **공격자가 쓴 값**이고 2³² 로 나눈 나머지다. 4 GB 이상은 표현조차 못 한다 |
| `deflate`(zlib) | 크기 필드가 아예 없다(Adler-32 만 있다) |

**해제 전에 알 수 있는 방법은 없다.** 그러므로 방어는 "얼마인지 확인하고 거부"가 아니라
**"해제하면서 상한에서 끊기"** 여야 한다.

#### 위협 모델 — 누가 서버인가

이 도구는 클라이언트다. 압축 폭탄을 보내려면 **서버가 적대적**이어야 한다. 그래서 위협의
성립 조건을 정확히 적어 둘 필요가 있다.

| 사용 방식 | 위협 성립 | 근거 |
|---|---|---|
| 사람이 아는 사이트 주소 하나를 넣고 실행 | 낮다 | 이미 그 서버를 신뢰해 영상을 본다 |
| CI·크롤러가 목록을 받아 자동 실행 | **높다** | 주소의 출처가 통제되지 않는다 |
| 플레이리스트만 받아 처리 | **높다** | 아래 |

셋째 행이 핵심이다. **플레이리스트는 그 자체가 URL 목록이다.** 세그먼트 URI, 키 URI
(`EXT-X-KEY`), 자막 트랙 URI 가 모두 플레이리스트 안에 적혀 있고, 이 코드는 그것들을
같은 `Fetcher` 로 받는다. 즉 **신뢰가 전이된다** — 첫 서버를 믿는 순간, 그 서버가
지목하는 임의의 호스트까지 같은 해제기에 물린다. 신뢰 경계(제13장)가 플레이리스트
파싱 지점에서 한 번 더 그어져야 한다는 뜻이다.

#### 우연히 막혀 있는 것

두 가지가 우연히 방어로 작동한다. **의도된 방어가 아니므로 방어로 세지 않는 것이 옳다.**

| 우연한 방어 | 내용 | 왜 우연인가 |
|---|---|---|
| 다층 인코딩 거부 | `Content-Encoding: gzip, gzip` 은 토큰 비교에 걸리지 않아 `ValueError` 로 거절된다. 2단이면 팽창률이 1,029² ≈ 100만 배가 됐을 것이다 | 목록형 값 파싱을 구현하지 않았기 때문이지, 폭탄을 막으려던 것이 아니다 |
| 범위 요청의 `identity` | 압축 자체가 오지 않으면 폭탄도 없다 | §6.3 의 좌표계 문제 때문에 넣은 것이다. `setdefault` 라 사용자 헤더로 꺼진다 |

#### 방어 — 상한을 어디에 두는가

상한은 **해제 호출 안**에 있어야 한다. 해제 후 `len()` 을 재는 것은 이미 늦다 —
그 시점에 메모리는 이미 할당됐다. 파이썬 표준 라이브러리에 필요한 도구가 있다.

```python
MAX_BODY = 64 << 20  # 64 MiB

def decompress_capped(body: bytes, encoding: str, limit: int = MAX_BODY) -> bytes:
    enc = encoding.lower().strip()
    if not body or enc in ("", "identity"):
        return body
    if enc in ("gzip", "x-gzip"):
        wbits = 16 + zlib.MAX_WBITS       # gzip 래퍼
    elif enc == "deflate":
        wbits = zlib.MAX_WBITS            # zlib 래퍼 (실패 시 -MAX_WBITS 재시도)
    else:
        raise ValueError(f"해제할 수 없는 Content-Encoding: {encoding}")
    d = zlib.decompressobj(wbits)
    out = d.decompress(body, limit + 1)   # ← 상한을 인자로 넘긴다
    if len(out) > limit or d.unconsumed_tail:
        raise ValueError(f"본문이 상한 {limit}B 를 넘었다 (압축 폭탄 의심)")
    return out
```

위 표와 **같은 폭탄**을 그대로 넣어 확인했다.

```
wire: 1019197 B
→ 본문이 상한 67108864B 를 넘었다 (압축 폭탄 의심)  (0.03s)
peak RSS: 153 MB
```

| | 현재 코드 (`gzip.decompress`) | 상한을 건 경우 |
|---|---|---|
| 결과 | 1,048,576,000 B 반환 | 상한 초과로 거절 |
| 소요 시간 | 1.01 s | **0.03 s** |
| 피크 RSS | 2,110 MB | **153 MB** |

`decompressobj().decompress(data, max_length)` 의 둘째 인자가 **한 번에 만들어 낼 출력의
상한**이고, 남은 입력은 `unconsumed_tail` 에 남는다. 즉 "더 나올 것이 있는가"를 상한을
넘기지 않고 알 수 있다. 시간이 1.01 s 에서 0.03 s 로 함께 떨어지는 것도 우연이 아니다 —
**거절은 해제보다 싸다.** 상한을 거는 방어는 성능 비용이 아니라 성능 이득이다.

던지는 예외가 `ValueError` 인 것도 의도적이다. [`fetch.py:177`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177) 의 `except Exception` 이
그대로 받아 **응답 손상**으로 처리하고, §6.4.3 의 규칙에 따라 재시도 없이 실패한다.
새 실패 경로를 만들지 않고 기존 경로에 얹는 것이 변경의 위험을 가장 줄인다.

**주의**: 이 대체 구현은 다중 멤버 gzip(여러 gzip 스트림을 이어붙인 것)을 한 번에 풀지
못한다. `gzip.decompress` 는 푼다. 상한을 얻는 대가로 잃는 것이 있다는 뜻이며, 실제로
채택하려면 멤버 반복 처리를 붙여야 한다.

#### 역할별로 무엇을 해야 하는가

| 역할 | 해야 할 일 |
|---|---|
| **이 도구(클라이언트)** | 해제에 상한을 건다. 상한 초과는 손상으로 처리해 재시도하지 않는다. 상한값은 플레이리스트(수 MB)와 세그먼트(수십 MB)에 따라 달리 잡는다 |
| **서버·CDN 운영자** | 이미 압축된 미디어(TS·mp4·이미지)를 다시 압축하지 않는다. `Vary: Accept-Encoding` 을 반드시 붙인다. **범위 응답에는 콘텐츠 코딩을 적용하지 않는다** |
| **캐시·리버스 프록시** | `Accept-Encoding` 을 정규화해 캐시 키에 넣는다. 인코딩된 표현을 잘라 206 을 만들지 않는다 |
| **라이브러리 설계자** | 한 방(one-shot) 해제 API 에 상한 인자를 둔다. **상한 없는 API 가 기본값인 것이 이 취약점 부류의 구조적 원인**이다 |
| **감사자** | "해제 코드에 상한이 있는가"를 점검 항목으로 둔다. 찾는 법은 단순하다 — `decompress(` 호출을 전수 조사해 상한 인자 유무를 본다 |
| **서버 개발자(방향 반전)** | 같은 문제가 **업로드 수신**에서 그대로 재현된다. 요청 본문의 `Content-Encoding: gzip` 을 무제한 해제하는 엔드포인트는 같은 취약점이다 |

마지막 행이 중요하다. 이 장은 클라이언트 코드를 읽고 있지만, **압축 폭탄의 다수는
서버 쪽에서 터진다.** 방향만 뒤집으면 같은 코드다.

### 6.7.2 범위 × 압축과 캐시 오염

중간 캐시가 이 충돌에 얽히면 정확성 문제가 **다른 사용자에게 번진다.**

| 잘못된 구성 | 결과 |
|---|---|
| `Vary: Accept-Encoding` 누락 | gzip 을 이해하는 클라이언트가 채운 캐시 항목이, `identity` 만 받는 클라이언트에게 그대로 나간다 — §6.1 (b) 가 서버 설정이 아니라 **캐시** 때문에 발생한다 |
| 압축판·무압축판이 같은 강한 ETag | `If-Range` 로 이어받기를 하면 서로 다른 표현의 조각이 이어붙는다 |
| 캐시가 인코딩된 표현을 잘라 206 을 만든다 | 조각을 재조립한 본문이 어느 표현에도 속하지 않는다 |

셋 다 뿌리는 하나다 — **표현을 구별하지 않는 캐시.** 캐시의 임무는 "같은 것을 다시 주는
것"인데, 콘텐츠 협상은 **"같은 URI 가 여러 개"** 를 도입한다. 그래서 캐시 키는 URI 가
아니라 `(URI, 협상 축의 값들)` 이어야 하고, 그 사실을 서버가 캐시에 알리는 유일한
수단이 `Vary` 다. `Vary` 를 빠뜨리는 것이 이 부류 사고의 가장 흔한 시작이다.

> 이 절은 원리에서 유도한 것이며, **이 저장소에서 재현하지 않았다.** 이 도구는
> 캐시를 두지 않고 매 요청을 직접 보낸다.

### 6.7.3 압축률은 평문에 대한 정보 채널이다

한 줄 정의만 남겨 둔다.

> **용어** — **CRIME(2012) · BREACH(2013)**: 압축된 데이터의 **크기**를 관찰해 그 안에
> 든 비밀(세션 토큰 등)을 한 글자씩 알아내는 공격. 압축은 반복되는 문자열을 짧게 만들기
> 때문에, 공격자가 넣은 추측 문자열이 비밀과 일치할수록 결과가 짧아진다.

이 도구는 이 공격의 무대가 아니다 — 요청 본문을 압축하지 않고, 공격자가 응답에 문자열을
주입해 크기 변화를 반복 관측할 구조도 없다. 그러나 원리는 기억할 값이 있다.

> **압축률은 내용에 의존한다. 따라서 압축된 크기는 내용에 대한 정보다.**

§6.4.5 에서 본 30.4배라는 압축률 자체가 "이 플레이리스트에는 거의 같은 URL 이 300개
있다"는 정보였다는 점을 떠올리면 된다. 같은 성질이 비밀을 담은 응답에서는 누출이 된다.

### 6.7.4 검사되지 않는 것 — 206 을 확인하지 않는다

§6.5 의 실측이 보여 준 그대로다. 이 저장소 전체에서 `206` 이나 `Content-Range` 를
참조하는 코드는 없다(전수 확인). 범위 요청이 무시되어 200 + 전체 본문이 와도
`ok=True` 이며, 그 본문이 세그먼트로 저장된다.

이 실패가 **다른 검사에 우연히 걸릴 가능성**은 있다.

| 검사 | 걸리는가 | 근거 |
|---|---|---|
| `sniff()` 페이로드 판별 | 안 걸린다 | 내용이 진짜 미디어다 |
| 세그먼트 고유성(SHA-256) | **걸릴 수 있다** — WARN | 모든 세그먼트가 같은 전체 파일이면 해시가 전부 같다([`report.py:213-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L213-L218)) |
| TS 연속성 카운터 | **걸릴 수 있다** — FAIL | 같은 구간이 반복되면 CC 가 뒤로 뛴다 |

> 이 표의 뒤 두 행은 **코드를 읽고 추론한 것이지 실행해 확인한 것이 아니다.**
> `EXT-X-BYTERANGE` 를 쓰는 픽스처가 회귀 테스트에 없어서 확인할 대조군이 없다.

정직한 결론은 이렇다. **범위 요청이 존중됐는지를 확인하는 검사는 이 코드에 없고, 다른
검사가 우연히 잡아 줄 뿐이다.** 우연한 방어를 방어로 세지 않는다는 제15장의 원칙을
여기에도 적용해야 한다. 필요한 것은 한 줄이다 — 범위를 요청했으면 `status == 206` 과
`len(body) == length` 를 확인하고, 아니면 실패로 처리한다.

---

## 6.8 한계와 미해결

정직하게 적어 둔다.

- **압축 폭탄 방어가 없다.** 이 장이 제시한 `decompress_capped` 는 **제안이지 이
  저장소의 코드가 아니다.** 채택하려면 상한값 결정(플레이리스트와 세그먼트가 다르다)과
  다중 멤버 gzip 처리가 함께 필요하다.
- **Range × 압축 충돌을 이 저장소에서 재현하지 못했다.** `identity` 강제는 규격 독해와
  원리에서 나온 **선제적 방어**이며, 이 방어가 없을 때 실제로 어떤 CDN 에서 무엇이
  깨지는지는 확인하지 않았다. §6.3.2 표의 "압축 → 절단 / 절단 → 압축" 분기는
  **원리에서 유도한 것이지 특정 서버 제품의 동작을 측정한 것이 아니다.**
- **`EXT-X-BYTERANGE` 경로 자체가 회귀 테스트에 없다.** `tests/run.sh` 는 이 태그를 쓰는
  스트림을 만들지 않는다(전수 확인). 파싱([`playlist.py:327-329`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L327-L329))과 요청 조립
  ([`fetch.py:155-161`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L161))은 코드로만 존재하고 실행으로 고정돼 있지 않다.
- **206 미검사는 이 장에서 발견했으나 고치지 않았다.** 수정은 코드 변경이므로 별도
  결정 사항으로 남긴다.
- **`deflate` 이중 시도의 오탐 가능성을 배제하지 못했다.** raw DEFLATE 가 "비최종
  저장(stored) 블록"으로 시작하고 둘째 바이트가 zlib 체크섬 조건을 우연히 만족하면
  래퍼로 오인될 수 있다. 확률은 매우 낮지만 0 이 아니며, 실제 사례는 확인하지 못했다.
- **brotli·zstd 를 요청하지 않아 잃는 전송량을 측정하지 않았다.** 텍스트에서 brotli 가
  gzip 보다 유리하다는 것은 알려져 있으나, 이 워크로드(반복이 극심한 URL 목록)에서
  실제로 얼마나 차이 나는지는 재 보지 않았다.
- **헤더 이름 대소문자 문제는 측정했으나 이 장의 범위 밖이다.** 근본 해법은 대소문자를
  구별하지 않는 헤더 매핑을 쓰는 것이고, 그것은 `Fetcher` 전체에 걸친 변경이다.

---

## 6.9 요약

1. **압축은 전송 방식이 아니라 표현의 성질이다.** gzip 판과 무압축판은 같은 자원의 다른
   표현이며, 이 사실이 "몇 번째 바이트"라는 질문의 답을 갈라 놓는다.
2. **협상은 명령이 아니라 선호다.** `Accept-Encoding: identity` 를 보내도 gzip 이 온다 —
   이 저장소의 테스트 서버가 그 반례이고, 회귀 테스트는 **서버가 실제로 압축을
   보내는지부터 검사한다.**
3. **Range 와 Content-Encoding 이 겹치면 좌표계가 둘이 된다.** HTTP 는 인코딩된 표현을,
   HLS 는 자원 원본을 기준으로 센다. 게다가 압축 스트림의 임의 구간은 애초에 단독으로
   풀 수 없다. 그래서 이 코드는 답을 고르는 대신 **질문을 없앤다**(`identity` 강제).
4. **크기는 하나가 아니다.** 처리량은 `wire_size`, 저장은 `size`, 해시는 해제 후 본문.
   해제 후 크기로 처리량을 재면 실측 30.4배 압축률만큼 회선이 빨라 보인다.
5. **`gzip.decompress` 에는 크기 상한이 없다 — 이 저장소의 실제 미방어 지점이다.**
   실측 995 KiB → 1,000 MiB(1,029배), 피크 RSS 2,110 MB. 압축이 새로 만든 것은 취약점이
   아니라 **증폭률**이며, 상한을 걸 수 있는 유일한 지점은 해제 호출 그 자체다.
6. **예방했다고 검사한 것은 아니다.** 범위 요청이 무시되고 전체 본문이 와도 이 코드는
   `ok=True` 를 낸다(실측). `identity` 를 요청은 했지만 존중됐는지는 확인하지 않는다.

---

**다음 장** — 이 장에서 좌표계를 흔든 것은 압축이었다. 다음 장에서는 **주소 자체**가
같은 문제를 일으킨다. `%20` 을 한 번 더 인코딩하면 `%2520` 이 되어 다른 자원을 가리키고,
그 변환이 여러 계층에서 각자 일어나면 "이 주소가 무엇을 가리키는가"가 계층마다 달라진다.
제7장은 정규화가 왜 경계에서 **정확히 한 번만** 일어나야 하는지, 그리고 그 규율이
깨졌을 때 생기는 이중 인코딩 우회를 다룬다.
