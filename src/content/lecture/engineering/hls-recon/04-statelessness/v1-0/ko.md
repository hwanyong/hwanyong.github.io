---
title: "무상태성과 무결성 보증의 부재"
description: "HTTP 는 무엇을 보증하고 무엇을 보증하지 않는가"
date: 2026-05-27
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-04-statelessness.svg
---
## 4.0 이 장에서 답할 것

1. 세그먼트 다섯 개를 요청했는데 네 개만 왔을 때, **어느 계층이 오류를 내야 하는가**
2. TCP 체크섬은 정확히 무엇을 검사하고 무엇을 검사하지 않는가
3. HTTP 응답 하나가 "끝까지 왔다"는 것은 무엇으로 판정되는가 — 그리고 판정할 수
   **없는** 경우가 있는가
4. 아무 계층도 책임지지 않는 그 빈칸을 이 코드는 무엇으로 메우는가

---

## 4.1 문제 — 다섯 개를 요청했는데 네 개가 왔다

### 4.1.1 관찰

이 저장소의 회귀 테스트는 정상 HLS 스트림 하나를 만든 뒤 세그먼트 파일 하나를
지운다(`tests/run.sh:140`).

```python
(d / "seg001.ts").unlink()                                      # 결함 3: 세그먼트 404
```

플레이리스트는 여전히 세그먼트 5개를 선언하고 있다. 그중 하나를 요청하면 서버는
404 를 준다. 이 상태로 ffmpeg 에 통째로 넘기면 결과는 이렇다.

```
6초 세그먼트 1개 결손 → ffmpeg 종료 코드 0, 출력 길이 30.03s (정상과 동일)
                     → 실제로는 5.99s ~ 12.02s 구간이 통째로 비어 있음
```

`README.md:28-29` 가 기록한 실측이다. 종료 코드는 0 이고, 파일은 만들어졌고, 총
재생 길이까지 정상본과 같다. 중간 6초가 사라졌다는 사실을 알려주는 신호가 **어디에도
없다.**

여기서 흔한 오해 하나를 먼저 걷어내야 한다. 이것은 ffmpeg 의 버그가 아니다. ffmpeg 은
자기가 받은 조각들을 정확히 이어 붙였고, 각 조각은 손상 없이 도착했다. 문제는 **"몇
개를 받았어야 했는가"를 아무도 확인하지 않았다는 것**이다.

### 4.1.2 그 확인은 원래 누구 일이었는가

계층을 아래에서 위로 하나씩 짚어 물어보면 답이 전부 같다.

| 물어본 계층 | "5개가 다 왔는가?"에 대한 답 |
|---|---|
| 이더넷 | 나는 프레임 하나가 링크 한 구간을 무사히 건넜는지만 안다 |
| IP | 나는 헤더가 안 깨졌는지만 안다. 페이로드는 내 소관이 아니다 |
| TCP | 나는 **이 연결의 바이트 스트림**이 순서대로 빠짐없이 갔는지만 안다 |
| TLS | 나는 **레코드 하나**가 위·변조되지 않았는지만 안다 |
| HTTP | 나는 **요청 하나**에 대한 응답이 선언한 길이만큼 왔는지만 안다 |
| HLS(RFC 8216) | 나는 목록을 준다. 목록대로 받았는지는 규정하지 않는다 |

**어느 계층도 "N개"라는 말을 하지 않는다.** 각 계층의 검사 단위는 그 계층의 전송
단위 하나이고, "요청 다섯 건의 집합"은 어떤 계층의 전송 단위도 아니기 때문이다.
이것이 이 장의 전부이며, 나머지는 이 사실의 정밀화다.

---

## 4.2 원리 — 보증의 사다리

### 4.2.1 각 층은 "하나"만 본다

![계층별 무결성 검사의 범위](/images/lecture/hls-recon/04-guarantee-ladder.svg)

*그림 4-1 — 각 계층의 검사는 자기 전송 단위 하나의 완결성에만 답한다. 맨 위 칸은
비어 있고, 그 칸을 채울 규격이 없다.*

> **용어** — **무결성(integrity)**: 데이터가 만들어진 뒤 의도하지 않은 변경(잡음·
> 결손·위조)을 겪지 않았음. **기밀성(confidentiality, 내용을 못 보게 함)** 과 다르고,
> **가용성(availability, 받을 수 있음)** 과도 다르다.

각 층의 검사 수단을 정확히 적으면 다음과 같다.

| 계층 | 수단 | 검사 대상 | 검사 범위 |
|---|---|---|---|
| 이더넷 | CRC-32 (FCS) | 프레임 전체 | **한 홉(hop)**. 장비마다 다시 계산된다 |
| IPv4 | 16비트 헤더 체크섬 | **헤더만** (기본 20바이트) | 홉마다 재계산. IPv6 에는 아예 없다 |
| TCP | 16비트 1의 보수 합 | 의사 헤더 + 헤더 + 페이로드 | **종단 간**. 단, 연결 하나 안에서만 |
| TLS | AEAD 인증 태그 | 레코드 하나 | 종단 간. 레코드 순서·중복·삭제까지 |
| HTTP | `Content-Length` / chunked 프레이밍 | 메시지 본문 하나 | 메시지 하나 |
| HLS | — | — | **없음** |

> **용어** — **AEAD(Authenticated Encryption with Associated Data, 연관 데이터를 갖는
> 인증 암호)**: 암호화와 무결성 인증을 한 연산으로 처리하는 방식. AES-GCM·
> ChaCha20-Poly1305 가 대표적이며, 복호화 시 인증 태그가 맞지 않으면 평문을 내주지
> 않고 실패한다.

이 표에서 두 칸을 눈여겨봐야 한다.

- **이더넷과 IP 는 홉마다 재계산된다.** 그러므로 라우터 **안**에서 메모리가 뒤집히면
  그 라우터가 새 체크섬을 계산해 붙인다. 잘못된 데이터에 맞는 체크섬이 붙는다.
- **HLS 칸이 비어 있다.** RFC 8216 에는 세그먼트의 다이제스트를 담을 태그가 없다.
  `EXT-X-KEY` 는 암호화(기밀성)용이지 무결성용이 아니다.

### 4.2.2 TCP 체크섬이 보증하는 범위

TCP 체크섬은 16비트 워드들의 **1의 보수 합의 1의 보수**다. 의사 헤더(출발지·목적지
주소, 프로토콜 번호, 길이)를 포함해 계산하므로 "다른 목적지로 갈 세그먼트가 잘못
배달된" 경우도 걸러낸다.

**보증하는 것**

- 무작위 단일 비트 반전의 대부분
- 짧은 버스트 오류의 대부분
- 잘못 배달된 세그먼트(의사 헤더 덕분)
- 순서·중복·유실 — 이건 체크섬이 아니라 **시퀀스 번호와 ACK** 가 한다

**보증하지 않는 것**

| 미검출 사례 | 이유 |
|---|---|
| 16비트 워드 단위 **순서 뒤바뀜** | 덧셈은 교환·결합법칙을 만족한다. 순서를 바꿔도 합이 같다 |
| `0x0000` 워드의 삽입·삭제 | 0 을 더해도 합이 변하지 않는다 |
| 두 오류가 서로 **상쇄**되는 경우 | 예: 한 워드가 `+k`, 다른 워드가 `−k` |
| 잔여 오류 확률 | 16비트이므로 무작위 오류 기준 약 1/65536 이 통과한다 |
| **연결 밖의 모든 것** | 다른 연결·다른 요청과의 관계는 개념 자체가 없다 |

Stone 과 Partridge 가 2000년에 실측한 결과가 널리 인용된다 — 링크 CRC 를 통과한 뒤에도
TCP 체크섬에서 걸리는 세그먼트가 대략 1100–32000개당 1개였고, 체크섬까지 통과하는
**미검출 오류**는 대략 1600만–100억 세그먼트당 1개로 추정됐다. 주된 원인은 회선
잡음이 아니라 **종단 호스트와 중간 장비의 소프트웨어·메모리 결함**이었다. 즉 CRC 가
지키는 구간(링크)과 오류가 생기는 지점(장비 내부)이 어긋나 있었다.

> 이 수치는 인용이며 이 저장소가 재현한 값이 아니다. 4.6 에 다시 적는다.

이 결과가 말하는 바는 "TCP 체크섬이 약하다"가 아니다. **하위 계층의 검사는 그 계층이
책임지는 구간만 지킨다**는 것이다. 구간 밖에서 생긴 오류를 하위 계층이 잡아 주기를
기대하는 설계는 그 기대만큼 틀린다.

### 4.2.3 HTTP 가 보증하는 것 — 메시지 하나의 프레이밍

> **용어** — **메시지 프레이밍(message framing)**: 바이트 스트림 위에서 "이 메시지의
> 본문은 여기서 시작해 여기서 끝난다"를 정하는 규칙. 스트림 프로토콜인 TCP 위에
> 메시지 경계를 다시 세우는 일이다.

HTTP/1.1 에서 응답 본문의 끝을 정하는 방법은 셋뿐이다.

| 방법 | 끝을 아는 근거 | 절단을 구별할 수 있는가 |
|---|---|---|
| `Content-Length: N` | 선언된 N 바이트 | **가능** — 모자라면 오류 |
| `Transfer-Encoding: chunked` | 길이 0 인 종결 청크 | **가능** — 종결 청크가 없으면 오류 |
| 둘 다 없음 → **연결 종료가 곧 끝** | 서버가 연결을 닫음 | **불가능** |

세 번째 경우가 이 장의 핵심 구멍이다. 서버가 본문 길이를 선언하지 않으면, "다 보내고
닫음"과 "보내다 말고 끊김"이 **회선 위에서 완전히 같은 모양**이 된다. 클라이언트가
구별할 수 있는 정보가 존재하지 않는다. 4.3.4 에서 이것을 직접 측정한다.

### 4.2.4 무상태성 — 집합을 아는 쪽은 클라이언트뿐이다

> **용어** — **무상태성(statelessness)**: RFC 9110 이 HTTP 를 규정하는 성질. 각 요청은
> 그 요청 안의 정보만으로 해석되며, 서버가 이전 요청과의 관계를 유지할 것을 프로토콜이
> 요구하지 않는다.

무상태성은 흔히 "확장성을 위한 설계"로 소개된다. 맞다. 그러나 이 장의 관점에서 보면
다른 귀결이 따라 나온다.

**서버는 당신이 몇 개를 요청할 예정인지 모른다.** 알 방법이 없는 것이 아니라 —
플레이리스트를 만든 것도 서버다 — **관측할 위치에 있지 않다.**

- 다섯 요청이 서로 다른 TCP 연결로 갈 수 있다
- 서로 다른 CDN 엣지로 갈 수 있다(그것이 CDN 의 목적이다)
- 요청 사이에 시간 간격이 있고, 중간에 그만둘 수도 있다
- HTTP/2 라 해도 다중화되는 것은 스트림이지 "작업 단위"가 아니다

반면 **클라이언트는 N 을 안다.** 플레이리스트를 파싱한 순간부터 알고 있다. 즉
집합의 완결성을 확인할 수 있는 위치에 있는 것은 이 구조에서 클라이언트 하나뿐이다.

여기에 예외처럼 보이는 것이 하나 있다.

```python
# playlist.py:164-166
    def is_live(self) -> bool:
        """ENDLIST 가 없으면 진행 중인 라이브 송출이다."""
        return not self.is_master and not self.has_endlist
```

`#EXT-X-ENDLIST` 는 HLS 전체를 통틀어 **"이 목록은 여기서 끝난다"고 말하는 유일한
표지**다. 그러나 이것도 목록의 끝을 말할 뿐 세그먼트가 도착했는지는 말하지 않고,
그 자체가 서버의 자기 신고 텍스트 한 줄이며 서명되지도 않는다. 뒤에서 보겠지만
이 표지가 이 저장소에 **우연한 방어** 하나를 제공한다(4.6).

### 4.2.5 무결성 다이제스트는 왜 없는가

"응답에 해시를 붙이면 되지 않는가"는 자연스러운 질문이고, 실제로 여러 번 시도됐다.

| 수단 | 상태 | 이 문제에 쓸 수 있는가 |
|---|---|---|
| `Content-MD5` | RFC 7231 에서 **삭제됨** (부분 응답과의 처리 불일치) | 없음 |
| `Digest` (RFC 3230) → `Content-Digest`·`Repr-Digest` (RFC 9530) | 표준화됨. 선택 사항 | 서버가 붙여야만 쓴다. CDN 기본값이 아니다 |
| Subresource Integrity(SRI) | 브라우저의 `<script>`·`<link>`, `fetch()` 의 `integrity` 옵션 | **다이제스트를 미리 알아야 한다.** HLS 매니페스트에 그것을 적을 자리가 없다 |
| HLS `EXT-X-KEY` | AES-128-CBC 암호화 | **기밀성만.** 인증 태그가 없다 |

마지막 줄이 중요하다. **암호화되어 있어도 무결성은 보증되지 않는다.** AES-128-CBC 는
인증되지 않은(unauthenticated) 모드이며, HLS 는 MAC 을 함께 보내지 않는다. 이 사실의
공격적 귀결은 4.5.2 에서 다룬다.

### 4.2.6 종단 간 논증

지금까지의 관찰은 새로운 발견이 아니라 1984년에 이름이 붙은 원칙의 재확인이다.

> **용어** — **종단 간 논증(end-to-end argument)**: Saltzer·Reed·Clark(1984). 어떤
> 기능이 **응용의 관점에서 완전히 옳게** 수행되려면 그 응용의 양 끝에서 확인해야
> 하며, 하위 계층이 같은 일을 하더라도 그것은 **성능 최적화**일 뿐 정확성의 근거가
> 되지 못한다.

이 원칙을 이 장의 문제에 대입하면 이렇게 읽힌다.

- 이더넷 CRC·TCP 체크섬·TLS 태그는 **재전송을 줄여 주는 최적화**다. 유용하지만,
  "내가 원한 것을 전부 받았다"의 근거는 아니다.
- "전부 받았다"의 정의는 **응용만 안다.** 여기서 응용의 정의는 "플레이리스트가
  선언한 세그먼트 전부"다. 이 정의는 HLS 를 아는 코드에만 존재한다.
- 따라서 그 확인은 **반드시 응용 계층에 구현되어야 한다.** 다른 선택지가 없다.

이 장의 나머지는 "그래서 어떻게 구현했는가"다.

---

## 4.3 코드 — 빈칸을 계측으로 메우기

### 4.3.1 요청 하나의 결과를 예외가 아니라 값으로

![요청별 결과를 값으로 남기고 가로질러 세는 구조](/images/lecture/hls-recon/04-instrumented-gap.svg)

*그림 4-2 — HTTP 는 세로 방향(요청 하나)만 안다. 가로줄은 프로토콜이 그어 주지
않으므로 응용이 직접 긋는다.*

```python
# fetch.py:73-92
@dataclass
class FetchResult:
    """요청 한 건의 결과와 계측치."""

    url: str
    ok: bool
    status: int = 0
    body: bytes = b""  # 압축을 푼 뒤의 본문
    size: int = 0  # 해제 후 크기
    wire_size: int = 0  # 실제로 회선을 지나간 바이트 (압축된 상태)
    encoding: str = ""  # Content-Encoding 원문
    ttfb_ms: float = 0.0  # time to first byte — 서버 응답 개시까지
    total_ms: float = 0.0  # 본문 수신 완료까지
    attempts: int = 1
    error: str = ""
    content_type: str = ""
    sha256: str = ""
    # 핫링크 차단 CDN 은 플레이어 페이지의 origin 을 이 헤더로 되돌려준다.
    # 성공 응답에도, 403 에도 붙어 오므로 Referer 추론의 근거가 된다.
    allow_origin: str = ""
```

이 자료형에서 설계 결정 네 개를 읽을 수 있다.

**(1) 실패가 예외가 아니라 값이다.** `ok: bool` 이 있다는 것은 실패한 요청도
`FetchResult` 인스턴스로 **리스트에 남는다**는 뜻이다. 예외로 던졌다면 어떻게 되는가.

| 단계 | 실패를 **예외**로 던졌다면 | 실패를 **값**으로 남기면 (이 코드) |
|---|---|---|
| 요청 하나가 실패한 직후 | 호출 스택을 타고 올라간다 | `FetchResult(ok=False)` 가 리스트의 제자리를 차지한다 |
| 병렬 배치가 끝난 시점 | `try/except` 로 감싸면 그 자리에서 사라진다 | 성공·실패가 같은 리스트에 함께 있다 |
| 집계할 때 | **셀 대상이 없다** | `len(failed) / len(fetches)` 가 성립한다 |

집합의 완결성을 확인하려는 코드에서 **실패를 예외로 던지는 것은 셀 대상을 지우는
일**이다. 이 결정은 4.2.6 의 요구에서 직접 따라 나온다.

**(2) `ok` 와 `status` 를 분리했다.** `ok=False, status=404` 는 서버가 답했고
거부했다는 뜻이고, `ok=False, status=0` 은 서버에 닿지도 못했다는 뜻이다. 하나로
합치면 "네트워크가 끊긴 것"과 "토큰이 만료된 것"이 같은 값이 된다.

**(3) `size` 와 `wire_size` 를 분리했다.**

```python
# fetch.py:98-104
    @property
    def throughput_mbps(self) -> float:
        """회선 성능이므로 해제 후 크기가 아니라 실제 전송 바이트로 계산한다."""
        wire = self.wire_size or self.size
        if self.total_ms <= 0 or not wire:
            return 0.0
        return (wire * 8) / (self.total_ms / 1000) / 1_000_000
```

압축된 플레이리스트에서 해제 후 크기로 처리량을 계산하면 회선이 실제보다 빠른 것으로
나온다. 계측치는 무엇을 재는지가 이름과 일치해야 쓸모가 있다.

**(4) `ttfb_ms` 와 `total_ms` 를 분리했다.**

> **용어** — **TTFB(Time To First Byte, 최초 바이트 도달 시간)**: 요청을 보낸 뒤 응답의
> 첫 바이트가 도착하기까지의 시간. 서버의 처리 지연을 주로 반영한다. 본문 수신 완료
> 시간(`total_ms`)은 여기에 **본문 크기 ÷ 대역폭**이 더해진 값이다.

둘을 합치면 "서버가 느린 것"과 "파일이 큰 것"이 구별되지 않는다.

### 4.3.2 재시도 — 무엇이 다시 해 볼 만한가

```python
# fetch.py:196-206
            except urllib.error.HTTPError as e:
                last_status, last_err = e.code, f"HTTP {e.code} {e.reason}"
                last_origin = (e.headers or {}).get("Access-Control-Allow-Origin", "") or ""
                # 4xx 는 재시도해도 결과가 같다 (401/403/404 = 토큰 만료·핫링크 차단)
                if 400 <= e.code < 500 and e.code not in (408, 429):
                    break
            except Exception as e:  # noqa: BLE001 — 네트워크 예외 전종을 계측 대상으로 삼는다
                last_err = f"{type(e).__name__}: {e}"

            if attempt < self.retries:
                time.sleep(self.backoff * (2 ** (attempt - 1)))
```

재시도 판단의 기준은 "실패했는가"가 아니라 **"다시 하면 달라질 수 있는가"** 다.

| 응답 | 재시도 | 근거 |
|---|---|---|
| 4xx (408·429 제외) | **안 함** | 요청 자체가 거부됐다. 같은 요청은 같은 답을 받는다 |
| 408 (Request Timeout) | 함 | 시간 문제이므로 다시 하면 달라질 수 있다 |
| 429 (Too Many Requests) | 함 | 속도 문제. 백오프 후 재시도가 규격이 의도한 동작이다 |
| 5xx | 함 | 서버 측 일시 장애일 수 있다 |
| 네트워크 예외 | 함 | 연결·타임아웃은 재현되지 않을 수 있다 |
| 압축 해제 실패 | **안 함** (`break`, [`fetch.py:177-180`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177-L180)) | 같은 서버가 같은 손상된 본문을 다시 준다 |

이렇게 하지 않으면 무엇이 깨지는가. 404 를 3회 재시도하면 결손 세그먼트 하나당
요청이 3배가 되고, 27화 배치에서는 서버 입장에서 **자기 자신을 향한 증폭 트래픽**이
된다. 429 를 무시하고 재시도하면 그것이 정확히 서버가 하지 말라고 말한 행동이다.
지수 백오프 `backoff * 2^(attempt-1)` 는 재시도 자체가 장애를 키우지 않게 하는 최소
장치다.

그리고 실패 경로의 마지막이 이렇다.

```python
# fetch.py:208-215
        return FetchResult(
            url=url,
            ok=False,
            status=last_status,
            attempts=self.retries,
            error=last_err,
            allow_origin=last_origin,
        )
```

**끝까지 예외를 던지지 않는다.** 실패도 결과값이다.

### 4.3.3 실패한 요청도 자리를 지킨다

```python
# fetch.py:229-243
        """병렬 GET. 반환 순서는 입력 순서를 유지한다."""
        results: list[FetchResult | None] = [None] * len(items)
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            futures = {
                pool.submit(self.get, url, rng): i for i, (url, rng) in enumerate(items)
            }
            done = 0
            for fut in as_completed(futures):
                i = futures[fut]
                res = fut.result()
                results[i] = res
                done += 1
                if on_done:
                    on_done(done, res)
        return [r for r in results if r is not None]
```

`as_completed` 는 **완료 순서**로 돌려준다. 빠른 세그먼트가 먼저 끝나므로 그대로
쌓으면 순서가 뒤섞인다. 그래서 미리 `[None] * len(items)` 로 자리를 만들어 두고
인덱스로 원위치에 넣는다.

이 순서 보존이 무너지면 무엇이 깨지는가. 소비 측이 이렇게 생겼기 때문이다.

```python
# cli.py:452-455
    for seg, res in zip(segs, results):
        if not res.ok:
            _eprint(f"    ✗ seg#{seg.index} 수신 실패: {res.error}")
            continue
```

`zip` 은 위치로 짝짓는다. 결과 리스트가 한 칸이라도 밀리면 **seg#3 의 실패가 seg#4 의
실패로 보고되고, 그 뒤 전부가 어긋난다.** 게다가 `zip` 은 짧은 쪽에서 조용히 멈추므로
길이가 줄면 뒤쪽 세그먼트가 검사 없이 사라진다. 오류 하나 없이 틀린 리포트가 나온다.

### 4.3.4 실측 — 절단은 언제 검출되는가

4.2.3 의 표에서 세 번째 줄("연결 종료가 곧 끝")이 실제로 어떻게 나타나는지 측정한다.
원시 소켓 서버로 네 가지 응답을 만들고 이 저장소의 `Fetcher` 로 받는다.

```python
# 저장소 루트에서 실행한다.
import socket, threading
from hlsrecon.fetch import Fetcher

BODY = b"\x47" + b"A" * 999          # 1000 바이트짜리 가짜 세그먼트
CUT = 400                            # 400 바이트만 보내고 끊는다
H = "HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\n"

def handle(conn):
    path = conn.recv(65536).decode("latin1").split(" ")[1]
    if path == "/full":                                  # 정상
        conn.sendall((H + "Content-Length: 1000\r\n\r\n").encode() + BODY)
    elif path == "/short-cl":                            # 길이 선언 O, 본문 절단
        conn.sendall((H + "Content-Length: 1000\r\n\r\n").encode() + BODY[:CUT])
    elif path == "/no-cl":                               # 길이 선언 X, 본문 절단
        conn.sendall((H + "Connection: close\r\n\r\n").encode() + BODY[:CUT])
    elif path == "/chunked-cut":                         # 청크 중간에 절단
        conn.sendall((H + "Transfer-Encoding: chunked\r\n\r\n").encode()
                     + b"190\r\n" + BODY[:CUT] + b"\r\n")
    conn.close()

srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0)); srv.listen(8)
port = srv.getsockname()[1]
threading.Thread(target=lambda: [threading.Thread(
    target=handle, args=(srv.accept()[0],), daemon=True).start() for _ in iter(int, 1)],
    daemon=True).start()

f = Fetcher(retries=1)
for p in ("full", "short-cl", "no-cl", "chunked-cut"):
    r = f.get(f"http://127.0.0.1:{port}/{p}")
    print(f"{p:12s} ok={str(r.ok):5s} size={r.size:5d}  {r.error}")
```

실행 결과(Python 3.14.5, 평문 HTTP, 로컬 루프백):

```
full         ok=True  size= 1000
short-cl     ok=False size=    0  IncompleteRead: IncompleteRead(400 bytes read, 600 more expected)
no-cl        ok=True  size=  400
chunked-cut  ok=False size=    0  IncompleteRead: IncompleteRead(400 bytes read)
```

| 응답 | 실제로 보낸 양 | 결과 | 판정 |
|---|---|---|---|
| `full` | 1000 / 1000 | `ok=True`, 1000바이트 | 옳다 |
| `short-cl` | 400 / 1000 | `ok=False`, `IncompleteRead` | **검출** |
| `no-cl` | 400 / (선언 없음) | `ok=True`, **400바이트** | **미검출** |
| `chunked-cut` | 400 / 종결 청크 없음 | `ok=False`, `IncompleteRead` | **검출** |

세 번째 줄이 이 장에서 가장 중요한 실측이다. **성공으로 보고된다.** 상태 코드 200,
`ok=True`, 오류 문자열 없음. 잘린 절반짜리 세그먼트가 아무 표시 없이 파이프라인
다음 단계로 넘어간다.

이것은 Python 이나 이 코드의 결함이 아니다. **서버가 본문 길이를 선언하지 않으면
"끝"과 "끊김"이 회선 위에서 같은 모양이고, 클라이언트가 참조할 정보가 존재하지
않는다.** 4.2.3 표의 세 번째 줄이 그대로 나타난 것이다.

한 가지 덧붙일 것이 있다. `IncompleteRead` 는 [`fetch.py:202`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L202) 의 광범위한
`except Exception` 으로 떨어지므로 **재시도 대상**이 된다(위 측정은 비교를 단순하게
하려고 `retries=1` 로 고정했다). 기본값 3회로 돌리면 세 번 요청한 뒤에야
`ok=False` 가 된다. 절단이 일시적이었다면 이 재시도가 그대로 복구다.

**우연한 방어 하나** — 압축된 응답은 이 구멍에서 벗어난다.

```
$ python3 -c "import gzip; gzip.decompress(gzip.compress(b'x'*400)[:20])" 2>&1 | tail -1
EOFError: Compressed file ended before the end-of-stream marker was reached
```

gzip 스트림은 자체 종결 표지와 **CRC-32 + 원본 크기 트레일러**를 갖는다. 잘리면
`EOFError`, 내용이 바뀌면 `BadGzipFile: CRC check failed` 가 나고, 둘 다
[`fetch.py:177-180`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177-L180) 에서 `ok=False` 로 이어진다. 즉 이 코드에서 **`Content-Encoding:
gzip` 인 응답은 `identity` 인 응답보다 무결성 보증이 강하다.** 설계된 것이 아니라
압축 포맷의 부수 효과이며, 그래서 Range 요청 경로([`fetch.py:155-159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L159) 가
`Accept-Encoding: identity` 를 강제한다)는 이 보호를 받지 못한다.

### 4.3.5 집계 — 가로줄을 긋는 곳

여기가 이 저장소에서 "N개가 모두 왔는가"를 묻는 **유일한 지점**이다.

```python
# report.py:160-173
    if fetches:
        failed = [f for f in fetches if not f.ok]
        retried = [f for f in fetches if f.ok and f.attempts > 1]
        ttfb = [f.ttfb_ms for f in fetches if f.ok]
        tput = [f.throughput_mbps for f in fetches if f.ok and f.throughput_mbps]
        total_bytes = sum(f.size for f in fetches)

        if failed:
            codes = sorted({f.status or 0 for f in failed})
            rep.add(
                "세그먼트 수신",
                FAIL,
                f"{len(failed)}/{len(fetches)}개 실패 (HTTP {codes}) — 재조립본에 결손 구간 발생",
            )
```

`len(failed)` 와 `len(fetches)` — 두 숫자를 비교하는 이 한 줄이 4.2.6 이 요구한
종단 간 확인의 전부다. 프로토콜이 주지 않으므로 코드가 만든다.

주목할 점은 **판정이 3단계**라는 것이다.

| 상태 | 판정 | 의미 |
|---|---|---|
| 실패 있음 | `FAIL` | 재조립본에 결손이 있다 |
| 전량 성공, 일부는 재시도 후 | `WARN` | 결과물은 온전하지만 **송출 측이 불안정**했다 |
| 전량 1회 성공 | `PASS` | — |

가운데 줄이 계측형 페처의 값어치다. 재시도로 복구된 실패는 최종 산출물에는 흔적이
남지 않는다. 계측치를 남기지 않으면 그 사실 자체가 사라지고, 같은 스트림을 다시
받았을 때 왜 실패하는지 알 길이 없다.

`_run_segments` 는 실패한 세그먼트를 건너뛸 뿐 중단하지 않는다([`cli.py:452-455`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L452-L455)).
**끝까지 받아 봐야 몇 개가 실패했는지 셀 수 있기 때문이다.** 첫 실패에서
`raise` 했다면 "1개 실패"와 "40개 실패"가 같은 결과가 된다. 다만 전부 실패한
경우에는 셀 것이 없으므로 그때만 중단한다.

```python
# cli.py:470-471
    if not paths:
        raise SystemExit("수신된 세그먼트가 없다 — 토큰 만료 또는 Referer 검증 실패 가능성")
```

그리고 전송 계층 통계 전체가 리포트에 남는다.

```python
# report.py:220-230
        rep.stats["transport"] = {
            "segments": len(fetches),
            "failed": len(failed),
            "retried": len(retried),
            "bytes": total_bytes,
            "wire_bytes": wire_bytes,
            "compressed_responses": len(compressed),
            "ttfb_ms_p50": round(_quantile(ttfb, 0.5), 1),
            "ttfb_ms_p95": round(_quantile(ttfb, 0.95), 1),
            "throughput_mbps_p50": round(_quantile(tput, 0.5), 2),
        }
```

TTFB 를 평균이 아니라 p50·p95 로 남기는 이유는 제8장에서 다룬다. 여기서는 **집합
수준의 사실(몇 개 중 몇 개)이 산출물과 함께 보존된다**는 점만 확인하면 된다.

### 4.3.6 sha256 이 하는 일과 하지 않는 일

`FetchResult.sha256` 을 보고 "무결성 검사가 있구나"라고 읽으면 틀린다.

```python
# report.py:213-218
        dup = len({f.sha256 for f in fetches if f.ok}) != len([f for f in fetches if f.ok])
        rep.add(
            "세그먼트 고유성",
            WARN if dup else PASS,
            "중복 해시 존재 — 동일 세그먼트가 반복 송출됨" if dup else "SHA-256 전량 상이",
        )
```

이 해시가 답하는 질문은 **"받은 것들끼리 같은가"** 이지 **"받은 것이 옳은가"** 가
아니다. 후자를 물으려면 비교할 기준 다이제스트가 있어야 하는데 — 4.2.5 에서 봤듯이
**HLS 에는 그것을 담을 자리가 없다.**

| 해시로 답할 수 있는 것 | 답할 수 없는 것 |
|---|---|
| seg003 과 seg004 가 같은 바이트인가 (중복 송출) | seg003 이 원본 seg003 인가 |
| 재실행에서 같은 것을 받았는가 (직접 비교 시) | 중간에서 바뀌었는가 |

기준값 없는 해시는 **동일성 판정 도구**이지 무결성 검사가 아니다. 이 구별을 흐리는
것이 보안 문서에서 흔한 오독이다.

---

## 4.4 일반화 — 집합의 완결성은 집합을 아는 쪽만 확인할 수 있다

이 장의 원리를 한 문장으로 쓰면 이렇다.

> **각 계층은 자기 전송 단위의 완결성만 보증한다. 여러 단위에 걸친 집합의 완결성은
> 그 집합을 정의한 계층이 직접 세지 않으면 아무도 세지 않는다.**

같은 구조가 나타나는 곳을 나열하면 이 원리가 스트리밍에 한정되지 않음이 보인다.

| 영역 | 하위 계층이 보증하는 것 | 집합 수준의 빈칸 | 그 빈칸을 메우는 관행 |
|---|---|---|---|
| 파일 다운로드 | 응답 하나의 길이 | 여러 파일이 다 받아졌는가 | `SHA256SUMS` 파일 + 서명 |
| 패키지 설치 | 아카이브 하나의 압축 CRC | 의존성 트리 전체가 그 버전인가 | 락파일(`package-lock.json` 등)의 무결성 해시 |
| S3 멀티파트 업로드 | 파트 하나의 ETag | 파트 전부가 올라갔는가 | `CompleteMultipartUpload` 에 파트 목록·순서를 명시 |
| 백업 | 파일 하나의 쓰기 성공 | 복원했을 때 전부 있는가 | **복원 리허설**. 백업 성공 로그는 근거가 아니다 |
| 메시지 큐 | 메시지 하나의 ACK | 발행 N건이 소비 N건인가 | 생산·소비 카운터 대조, 시퀀스 번호 |
| 로그 수집 | 전송 배치 하나의 200 | 유실 없이 다 들어왔는가 | 소스별 순번 + 결번 검출 |
| 분산 트레이싱 | 스팬 하나의 기록 | 트레이스가 완결됐는가 | 루트 스팬 종료 표시 + 고아 스팬 집계 |

각 행에서 오른쪽 열이 **비어 있는 시스템은 예외 없이 같은 방식으로 실패한다** —
"성공했다는 보고가 전부 있는데 결과가 비어 있다". 그리고 그 실패는 보고를 아무리
자세히 읽어도 보이지 않는다. 세지 않은 것은 보고서에 없기 때문이다.

여기서 파생되는 실무 규칙 하나가 있다.

> **"각 단계가 성공했다"의 논리곱은 "전체가 성공했다"가 아니다.** 단계의 목록 자체가
> 옳다는 것을 따로 확인하지 않는 한.

4.1.1 의 ffmpeg 이 정확히 이것이다. 받은 조각은 전부 옳았다. 조각의 **개수**만 틀렸다.

---

## 4.5 보안

### 4.5.1 절단 공격

> **용어** — **절단 공격(truncation attack)**: 경로상의 공격자가 통신을 정상 종료처럼
> 보이게 중간에서 끊어, 수신 측이 **부분 데이터를 완전한 것으로 받아들이게** 만드는
> 공격.

4.3.4 의 `no-cl` 결과가 이 공격의 성립 조건 그 자체다.

| 조건 | 성립 여부 |
|---|---|
| 서버가 `Content-Length` 도 chunked 도 쓰지 않는다 | 필요 |
| 공격자가 연결을 끊을 수 있다(RST 주입, 경로상 장비) | 필요 |
| 클라이언트가 종료 신호의 진위를 확인하지 않는다 | 필요 |

TLS 는 이 문제를 알고 있어서 `close_notify` 경보를 정상 종료 표지로 규정한다. 그것이
없이 연결이 끊기면 절단으로 간주해야 한다. 문제는 **많은 HTTP 클라이언트가
`close_notify` 없는 종료를 관대하게 넘긴다**는 것이다(구현이 미흡한 서버와의 호환을
위해). 그 경우 HTTPS 위에서도 같은 구멍이 남는다.

실무적 결론은 단순하다. **명시적 프레이밍이 무결성 기능이다.** `Content-Length` 는
성능이나 편의를 위한 헤더가 아니라, 절단과 완료를 구별 가능하게 만드는 유일한 장치다.

### 4.5.2 무결성 없는 암호화 — 암호화는 무결성이 아니다

HLS 의 AES-128 은 CBC 모드이고 MAC 이 없다. CBC 복호화 식은 다음과 같다.

```
P_i = D_K(C_i) XOR C_(i-1)
```

`C_(i-1)` 의 어떤 비트를 뒤집으면 `P_i` 의 **같은 위치 비트가 그대로 뒤집힌다**
(대가로 `P_(i-1)` 은 난수처럼 망가진다). 즉 키를 모르는 공격자도 평문에 **제어된
변경**을 가할 수 있다. 이것을 **가단성(malleability)** 이라 한다.

그리고 복호화하는 쪽에는 그것을 알아챌 수단이 없다.

```python
# decrypt.py:54-55
    # 패딩이 깨졌으면(잘린 세그먼트 등) 자르지 않고 원본을 넘긴다.
    # 여기서 예외를 던지면 손상 검출이 복호화 단계에 묻혀버린다.
```

무작위 바이트열이 PKCS#7 패딩 검사([`decrypt.py:56`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L56))를 통과할 확률은 약 1/256 이다 —
마지막 바이트가 `0x01` 이기만 하면 `n=1` 로 성립하기 때문이다. 게다가 이 코드는 애초에
패딩 오류로 실패하지 않기로 결정했다 — 그 결정 자체는 옳으며 이유는 제24장에서
다룬다. 여기서 확인할 것은 **암호 계층이 무결성 검사를 전혀
제공하지 않으므로, 손상 검출은 전부 상위(TS 패킷 순회·타임라인 검사)로 넘어간다**는
사실이다.

> **"암호화되어 있다"는 문장은 무결성에 대해 아무것도 말하지 않는다.** AEAD 가 아니면
> 별도의 MAC 이 필요하고, HLS 의 `EXT-X-KEY` 에는 MAC 을 담을 자리가 없다.

### 4.5.3 선택적 결손 — 총 길이가 같은 검열

가장 흥미로운 공격은 절단도 위조도 아니다. **특정 세그먼트만 사라지게 하는 것**이다.

| 능력 | 결과 | 검출 |
|---|---|---|
| 전부 차단 | 재생 실패 | 즉시 드러난다 |
| 무작위 손상 | TS 동기 이탈·디코드 오류 | 상위 검사에서 잡힌다 |
| **특정 구간 세그먼트만 404** | 그 구간만 사라지고 나머지는 정상 재생, **총 길이 동일** | **총 길이 비교로는 못 잡는다** |

세 번째 줄이 4.1.1 의 실측과 같은 현상이다. 6초 세그먼트 하나를 없앴는데 출력 길이가
30.03초로 정상과 같았다. MPEG-TS 세그먼트가 **절대 표시 시각(PTS)** 을 품고 있어 앞
조각이 사라져도 뒤 조각의 시각이 유지되기 때문이다(제21장). 뉴스 영상·증거 영상·
스포츠 중계에서 특정 몇 초를 지우는 조작이 **길이 검사를 통과한다**는 뜻이다.

이 저장소가 이 공격면에 대해 갖는 검사는 두 층이다.

| 층 | 검사 | 잡는 범위 |
|---|---|---|
| 전송 | `len(failed)/len(fetches)` ([`report.py:167-173`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L167-L173)) | 요청이 실패한 결손 |
| 산출물 | PTS 갭 스캔 ([`report.py:303-324`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L303-L324), 제21장) | 요청은 성공했으나 타임라인에 구멍이 난 경우 |

두 층이 필요한 이유는 서로 다른 실패를 잡기 때문이다. 전송 검사는 요청 목록 기준이고,
갭 스캔은 결과물 기준이다. 제21장에서 다시 만난다.

### 4.5.4 방어자 관점

이 장의 원리는 공격보다 **구성(configuration)** 에 훨씬 자주 나타난다. 역할별로 해야
할 일이 다르다.

| 역할 | 해야 하는 것 | 하지 않으면 무엇이 깨지는가 |
|---|---|---|
| **원본 서버·CDN 운영자** | 모든 응답에 `Content-Length` 또는 chunked 프레이밍을 붙인다. 연결 종료로 본문 끝을 알리는 응답을 쓰지 않는다 | 절단과 완료가 구별 불가능해진다(4.3.4 의 `no-cl`). 클라이언트에 고칠 방법이 없다 |
| **패키저·송출 사업자** | VOD 플레이리스트에 `#EXT-X-ENDLIST` 를 반드시 넣는다. 가능하면 `Repr-Digest`(RFC 9530)를 붙인다 | 목록의 끝을 알 수 없어 잘린 매니페스트가 완전한 것으로 보인다 |
| **플레이어·클라이언트 구현자** | **요청 성공 수를 센다.** 버퍼 결손을 삼키지 말고 이벤트로 노출한다 | `fetch()` 는 요청 하나만 안다. 세지 않으면 아무도 세지 않는다 |
| **검증 도구 제작자** | PASS 가 "무결"이 아니라 "이 검사로는 못 잡음"임을 명시한다 | 도구의 미탐률을 모르는 PASS 는 정보가 아니다(제34장) |
| **감사자** | 리포트의 N 이 **어디서 온 숫자인지** 역추적한다 | 기준 자체가 오염되면 자기 일관된 거짓이 통과한다(4.6) |
| **네트워크 운영자** | 평문 HTTP 로 미디어를 나르지 않는다 | 경로상 누구든 특정 세그먼트만 조용히 삭제할 수 있다(4.5.3) |
| **규격 작성자** | 집합 수준 무결성을 담을 자리를 규격에 둔다 | RFC 8216 에는 그 자리가 없고, 그래서 모든 클라이언트가 각자 만든다 |

마지막 줄이 이 장의 구조적 결론이다. **빈칸을 규격이 남겨 두면 클라이언트마다 다르게
메우고, 대부분은 메우지 않는다.** ffmpeg 이 exit 0 을 내는 것은 게으름이 아니라
규격이 요구하지 않는 일을 하지 않는 것이다.

### 4.5.5 계측 자체가 만드는 노출

빈칸을 메우려고 만든 계측 기록은 그 자체가 자산이 된다.

```python
# report.py:36-41
def _redact_headers(cmd: list[str]) -> list[str]:
    """ffmpeg 명령의 -headers 블록에서 자격증명을 가린 사본을 만든다.

    리포트 JSON 은 CI 아티팩트로 남거나 그대로 첨부돼 오간다. 세션 쿠키가 평문으로
    실리면 파일 하나가 곧 계정 접근권이 된다.
    """
```

무결성 검증을 위해 남기는 기록이 기밀성 문제를 만든다 — 두 보안 속성이 정면으로
충돌하는 지점이다. `FetchResult.url` 에는 서명 URL 의 서명과 만료 시각이 그대로 들어
있고, `mux_command` 에는 요청 헤더가 통째로 들어간다. 편집(redaction) 대상 목록이
완전한가는 제12장의 주제다.

---

## 4.6 한계와 미해결

정직하게 적어 둔다.

**측정하지 않은 것**

- **Stone·Partridge 의 수치는 인용이다.** 2000년 측정이고 이 저장소에서 재현하지
  않았다. 오늘날처럼 대부분의 트래픽이 TLS(AEAD)로 감싸인 환경에 그 비율이 그대로
  적용되는지 확인하지 못했다.
- **4.3.4 의 절단 실측은 평문 HTTP 로만 했다.** HTTPS 에서 `close_notify` 를 검증하지
  않는 클라이언트는 같은 결과가 날 것이라고 **추론**하지만, 측정하지 않았다.
  4.5.1 의 "많은 HTTP 클라이언트가 `close_notify` 없는 종료를 관대하게 넘긴다"도
  마찬가지로 통설이며 이 문서가 검증한 사실이 아니다. **이 장에서 추론에 그친 주장은
  이 둘이다.**
- **실제 CDN 이 `Content-Length` 없이 응답하는 빈도를 조사하지 않았다.** 현대 CDN 은
  거의 항상 명시적 프레이밍을 쓴다고 알려져 있으나, 이 저장소가 확인한 사실이 아니다.
  즉 `no-cl` 구멍은 **원리적으로 존재하지만 실제 노출도는 미측정**이다.

**이 코드가 못 하는 것**

- **요청 목록 자체의 완결성은 검사하지 않는다.** 기준선 N 이 파싱된 플레이리스트에서
  나오고, 선언 길이도 같은 곳에서 나온다([`cli.py:414-415`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L414-L415)).

  ```python
      segs = pl.segments[: args.limit] if args.limit else pl.segments
      declared = sum(s.duration for s in segs)
  ```

  플레이리스트가 잘려 세그먼트 3개만 파싱됐다면 3개를 요청해 3개를 받고 `PASS` 가
  난다. 선언 길이도 함께 줄어 **자기 일관된 거짓**이 된다. 여기서 이 도구를 구하는
  것은 무결성 검사가 아니라 **우연한 구조적 신호** 하나다 — `#EXT-X-ENDLIST` 가
  잘려 나가면 `is_live` 가 참이 되어([`playlist.py:164-166`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L164-L166)) LIVE 로 보고되고 처리
  경로가 달라진다. 무결성을 위해 설계된 장치가 아니므로 여기에 기대면 안 된다.
  (측정 대상이 측정 기준을 끌고 가는 이 문제의 일반형은 제38장에서 다룬다.)
- **`attempts` 계측이 실패 건에서 부정확하다.** [`fetch.py:212`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L212) 가 `attempts=self.retries`
  를 고정으로 넣으므로, 404 로 첫 시도에서 `break` 한 요청도 "3회 시도"로 기록된다.
  현재 리포트가 이 값을 성공 건에만 쓰기 때문에([`report.py:162`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L162) 의 `f.ok and
  f.attempts > 1`) 드러나지 않을 뿐이다. **드러나지 않는 부정확한 계측치**이며,
  리포트가 이 필드를 실패 건에 쓰기 시작하는 순간 틀린 숫자가 나간다.
- **`Fetcher.get` 은 예외를 던질 수 있다.** `normalize_url` 이 재시도 루프 **밖**에
  있어([`fetch.py:151`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L151)) 잘못된 형태의 URL 은 `FetchResult` 가 되지 못한다. 실측:

  ```
  $ python3 -c "from hlsrecon.fetch import Fetcher; Fetcher(retries=1).get('http://[::1/x.ts')" 2>&1 | tail -1
  ValueError: Invalid IPv6 URL
  ```

  `get_many` 안에서 발생하면 `fut.result()` 가 다시 던져 배치 전체가 중단된다.
  조용히 어긋나지는 않지만, **"실패도 값이다"라는 이 모듈의 계약에 난 구멍**이다.
- **내용이 옳은지는 어떤 검사도 하지 않는다.** 4.3.6 에서 본 대로 비교할 기준
  다이제스트가 존재하지 않는다. 이 도구가 답하는 것은 "선언된 만큼 왔는가"이지
  "원본과 같은가"가 아니다. 후자는 이 프로토콜 위에서 **답할 수 없는 질문**이다.
- **압축 경로가 비압축 경로보다 우연히 강하다.** gzip 의 CRC-32 트레일러 덕분인데,
  이는 설계된 보증이 아니라 부수 효과다. Range 요청은 `Accept-Encoding: identity` 를
  강제하므로([`fetch.py:155-159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L159)) 그 보호를 잃는다. `EXT-X-BYTERANGE` 세그먼트가 많은
  송출에서는 절단 검출이 오직 `Content-Length` 에만 의존한다.

---

## 4.7 요약

1. **어느 계층도 "N개가 다 왔는가"에 답하지 않는다.** 이더넷 CRC·IP 헤더 체크섬·
   TCP 체크섬·TLS 인증 태그·HTTP 프레이밍은 전부 **자기 전송 단위 하나**의
   완결성만 검사한다. 집합은 어떤 계층의 전송 단위도 아니다.
2. **TCP 체크섬은 16비트 1의 보수 합이다.** 무작위 비트 오류 대부분을 잡지만
   워드 순서 뒤바뀜·`0x0000` 삽입·상쇄 오류를 못 잡고, 무엇보다 **연결 하나** 밖의
   일에는 관여하지 않는다. 하위 계층의 검사는 최적화이지 정확성의 근거가 아니다
   (종단 간 논증).
3. **HTTP 는 메시지 하나의 프레이밍만 보증하고, 그마저도 조건부다.** `Content-Length`
   도 chunked 도 없으면 절단과 완료가 구별 불가능하다 — 실측으로 확인했다
   (`no-cl` → `ok=True`, 400/1000 바이트).
4. **무상태성의 귀결**: 서버는 클라이언트가 몇 개를 요청할지 관측할 위치에 없다.
   플레이리스트를 파싱한 **클라이언트만이 N 을 안다.** 그러므로 그 확인은 반드시
   클라이언트가 한다.
5. **암호화는 무결성이 아니다.** HLS 의 AES-128-CBC 는 MAC 이 없어 가단성을 갖는다.
   무결성 다이제스트를 담을 자리가 HLS 규격에 아예 없다.
6. **빈칸은 프로토콜이 아니라 자료구조로 메워진다.** 요청 하나를 `FetchResult` 한
   건으로 만들고([`fetch.py:73-104`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L104)), 실패도 값으로 리스트에 남기고, 그 리스트를
   가로질러 센다([`report.py:160-173`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L160-L173)). **실패를 예외로 던졌다면 셀 대상 자체가
   사라진다.**
7. **그러나 기준선 N 은 여전히 서버가 준 텍스트에서 나온다.** 이 도구는 "선언된
   만큼 왔는가"에 답하지, "선언이 옳은가"에는 답하지 않는다.

---

**다음 장** — 이 장은 "요청이 성공했는가"를 셀 수 있게 만들었다. 그런데 성공의 정의
자체가 흔들린다. HTTP `200 OK` 를 받았는데 본문이 오류 페이지인 응답이 실재하고,
헤더만 봐서는 정상 세그먼트와 구별되지 않는다. 제5장은 상태 코드라는 자기 신고
메타데이터가 어디에서 의미를 잃는지, 그리고 그때 무엇을 근거로 삼아야 하는지를 다룬다.
