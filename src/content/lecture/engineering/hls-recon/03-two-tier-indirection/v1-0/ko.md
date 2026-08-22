---
title: "RFC 8216 의 2계층 간접 참조"
description: "마스터/미디어 분리가 만드는 것과 잃는 것"
date: 2026-08-15
version: '1.0'
tags: ['streaming', 'foundations']
thumbnail: /images/lecture/thumb/hls-recon-03-two-tier-indirection.svg
---
## 3.0 이 장에서 답할 것

1. 왜 하나의 문서로 끝내지 않고 마스터와 미디어로 나누었는가
2. 클라이언트는 자기가 받은 주소가 어느 쪽인지 어떻게 아는가
3. 간접이 한 단 늘어날 때마다 클라이언트가 새로 지는 의무는 무엇인가
4. `EXT-X-MEDIA` 의 그룹 참조는 왜 세 번째 간접이고, 왜 URI 가 아니라 **이름**으로 잇는가
5. 중첩 마스터를 거부하는 것은 게으름인가 설계인가

---

## 3.1 문제 — 주소가 무엇을 가리키는지는 받아봐야 안다

사용자가 도구에 주는 것은 주소 하나다.

```bash
hls-recon https://cdn.example/show/master.m3u8 -o out.mp4
```

이 주소가 **화질 후보 목록**인지 **세그먼트 목록**인지는 이름으로 알 수 없다. 둘 다
`.m3u8` 이고, 둘 다 `Content-Type: application/vnd.apple.mpegurl` 로 온다. RFC 8216 에는
`#EXT-X-MASTER` 같은 자기 서술 태그가 없다.

> **용어** — **마스터 플레이리스트(Master Playlist)**: 같은 콘텐츠의 여러 화질 후보와
> 부가 트랙의 **주소 목록**을 담은 M3U8 문서. 세그먼트를 직접 담지 않는다.
>
> **용어** — **미디어 플레이리스트(Media Playlist)**: 실제 미디어 세그먼트의 주소를
> 재생 순서대로 나열한 M3U8 문서. RFC 8216 은 한 문서가 둘 중 하나여야 하고 둘 다이면
> **무효**라고 규정한다(§4).

그래서 이 코드에서 종류 판정은 **파싱이 끝난 뒤에야** 가능하다.

```python
# cli.py:127-138
def _load(src: str, fetcher: Fetcher) -> tuple[playlist.Playlist, str]:
    """소스(URL 또는 로컬 .m3u8)를 파싱한다. 반환의 두 번째 값은 base URL."""
    if _is_url(src):
        res = fetcher.get(src)
        # 첫 응답에서 Referer 를 얻었다면, 그 때문에 막혔던 요청은 다시 해볼 값이 있다.
        if _adopt_origin(res, fetcher) and not res.ok:
            res = fetcher.get(src)
        if not res.ok:
            raise SystemExit(f"플레이리스트 요청 실패: {src}\n  {res.error}")
        text = res.body.decode("utf-8", errors="replace")
        try:
            return playlist.parse(text, base_url=src), src
```

`_load` 는 받은 것이 마스터인지 미디어인지 **판정하지 않는다.** 요청하고, 텍스트로
바꾸고, 파서에 넘길 뿐이다(가운데 Referer 재시도는 §3.9.1 에서 다룬다). 판정은 다음
함수의 첫 줄이다.

```python
# cli.py:176-177
    if not pl.is_master:
        return Source(media=pl, media_url=src)
```

이것은 제14장이 말한 **"이름과 선언은 아무것도 보증하지 않는다"** 의 다른 얼굴이다.
제14장에서는 세그먼트의 정체를 선두 바이트로 판별했다. 여기서는 문서의 정체를
**내용에 어떤 태그가 나타나는가**로 판별한다. 판별 근거가 메타데이터 바깥에 있다는
구조는 같다.

---

## 3.2 원리 — 왜 두 계층인가

### 3.2.1 하나로 합쳤다면

ABR(Adaptive Bitrate, 적응 비트레이트 — 클라이언트가 대역폭에 맞춰 화질을 바꿔가며
받는 방식)은 같은 콘텐츠를 N개 화질로 준비한다. 각 화질은 M개 세그먼트로 쪼개진다.
이 N×M 을 문서 하나에 담는 설계는 두 가지로 실패한다.

| 대안 | 무엇이 깨지는가 |
|---|---|
| **단일 문서** — 모든 화질의 세그먼트를 한 파일에 | LIVE 송출에서 세그먼트가 하나 늘 때마다 **N개 화질 전체가 담긴 문서**를 다시 내려보내야 한다. 갱신 트래픽이 N배가 되고, 캐시 무효화 단위도 하나뿐이라 화질 하나가 바뀌면 전부 무효가 된다 |
| **진입점 N개** — 화질마다 별도 URL 을 사용자가 안다 | 클라이언트가 후보 집합을 알 방법이 없다. ABR 의 전제인 "실행 중에 다른 화질로 갈아탄다"가 성립하지 않는다 |

2계층은 이 둘을 동시에 피한다. **진입점은 하나로 유지하면서, 갱신 단위와 캐시 수명을
층별로 분리한다.**

| 층 | 문서 | 무엇을 선언 | 언제 바뀌는가 | 캐시 수명 |
|---|---|---|---|---|
| ① | 마스터 | 후보 집합(variant · 부가 트랙 그룹) | 세션 중 사실상 불변 | 길게 |
| ② | 미디어 | 세그먼트의 **순서열** + 암호화 · 불연속 지점 | LIVE 면 `TARGETDURATION` 주기 | 짧게 |
| ③ | 세그먼트 | 바이트 | 절대 안 바뀜 | 영구 |

> **용어** — **간접 참조(indirection)**: 값을 그 자리에 두지 않고, 값을 찾을 수 있는
> 이름이나 주소를 대신 두는 것. 여기서는 "영상 바이트" 자리에 "세그먼트 목록의 주소"가
> 오고, 그 자리에 다시 "후보 목록의 주소"가 온다.

David Wheeler 의 격언이 이 장 전체를 요약한다.

> "컴퓨터 과학의 모든 문제는 간접을 한 겹 더 두면 풀린다 — 간접이 너무 많다는 문제만
> 빼고."

앞 절반이 §3.2.1 이고, 뒤 절반이 이 장의 나머지다.

### 3.2.2 간접이 사는 것과 파는 것

| 얻는 것 | 잃는 것 |
|---|---|
| **지연 바인딩(late binding)** — 어느 화질을 쓸지 송출 시각이 아니라 재생 시각에 정한다 | **원자성** — 두 문서를 서로 다른 시각에 받는다. 그 사이에 서버가 바뀌어도 알 수 없다 |
| **관심사 분리** — 후보 집합의 변경과 세그먼트 목록의 변경이 서로 독립 | **참조 무결성 강제 불가** — 규격은 MUST 를 쓰지만, 두 문서를 대조해 검사할 주체가 아무 데도 없다 |
| **캐시 계층화** — 층마다 다른 TTL | **오류 국소화 실패** — "재생이 안 된다"가 세 층 중 어디서 깨진 것인지 서버는 모른다 |
| **접근 통제 지점 증가** — 층마다 인가를 걸 수 있다 | **부분 성공** — 층 하나를 통과한 것이 다음 층을 보증하지 않는다 |

오른쪽 열이 이 교재가 다루는 문제의 절반을 낳는다. 제4장(무상태성)과 제11장(서명 URL)이
각각 첫 행과 마지막 행을 이어받는다.

---

## 3.3 코드 ① — 파서는 종류를 판정하지 않는다, 발견한다

[`playlist.py:207-337`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L207-L337) 의 `parse` 는 마스터와 미디어를 **같은 진입점에서** 받는다.

```python
# playlist.py:207-213
def parse(text: str, base_url: str = "") -> Playlist:
    """M3U8 텍스트를 Playlist 로 변환한다. 모든 uri 는 base_url 기준 절대 URL."""
    lines = [ln.strip() for ln in text.splitlines()]
    if not lines or not lines[0].startswith("#EXTM3U"):
        raise ValueError("#EXTM3U 헤더가 없다 — M3U8 플레이리스트가 아니다")

    pl = Playlist(base_url=base_url)
```

`Playlist` 하나의 dataclass 안에 `variants` 와 `segments` 가 **공존**한다
([`playlist.py:149-161`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L149-L161)). 종류는 필드로 주어지지 않고 파싱 도중 부수효과로 켜진다.

```python
# playlist.py:259-262 (발췌)
        elif line.startswith("#EXT-X-STREAM-INF:"):
            a = _parse_attrs(line.split(":", 1)[1])
            pl.is_master = True
            pending_variant = Variant(
```

```python
# playlist.py:273-277 (발췌)
        elif line.startswith("#EXT-X-MEDIA:"):
            a = _parse_attrs(line.split(":", 1)[1])
            pl.is_master = True
            uri = a.get("URI")
            pl.media.append(
```

**`EXT-X-MEDIA` 만 있어도 마스터로 판정된다.** 이것은 실수가 아니라 필연이다 —
`EXT-X-MEDIA` 는 미디어 플레이리스트에 나타날 수 없는 태그이므로, 그것이 보였다는
사실만으로 이 문서는 마스터다.

### 3.3.1 URI 줄은 상태로 해석된다

M3U8 에서 태그와 URI 는 **줄 단위로 짝지어진다**. 태그가 아닌 줄이 나오면 그것은 직전
태그가 가리키는 주소다. 어느 태그였는지는 파서가 기억하고 있어야 한다.

```python
# playlist.py:227-236 (발췌)
        if not line.startswith("#"):
            # 태그가 아닌 줄 = 직전 태그가 가리키는 URI
            uri = _absolute(base_url, line)
            if pending_variant is not None:
                pending_variant.uri = uri
                pl.variants.append(pending_variant)
                pending_variant = None
            elif cur_inf is not None:
                dur, title = cur_inf
                pl.segments.append(
```

`pending_variant` 와 `cur_inf` 는 서로 배타적인 상태다. 마스터에서는 앞의 가지만,
미디어에서는 뒤의 가지만 도달한다. **한 줄의 의미가 그 앞에 무엇이 있었는가에
의존한다** — 상태 기계다. 같은 성질을 더 극단적으로 보여주는 것이
`EXT-X-BYTERANGE` 의 오프셋 생략 규칙([`playlist.py:327-329`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L327-L329))이고, 제6장에서 다룬다.

### 3.3.2 반례 — 하이브리드 문서를 주면

RFC 8216 §4 는 한 문서가 마스터이면서 동시에 미디어일 수 없다고 규정한다. 그러나 이
파서는 그런 문서를 **거부하지 않는다.** `#EXT-X-STREAM-INF` 와 `#EXTINF` 가 섞인
문서를 넣으면 `variants` 와 `segments` 가 모두 채워진 `Playlist` 가 나오고,
`is_master` 는 `True` 다. 다음 절의 `_resolve_media` 는 마스터 가지로 들어가
**같은 문서 안의 세그먼트를 통째로 버린다.** 예외도 경고도 없다.

관대한 파서(Postel's law, "받을 때는 너그럽게")가 조용한 오작동을 만드는 전형이다.
§3.10 에 한계로 남긴다.

### 3.3.3 한 타입이 두 문서를 겸하면 모든 속성이 두 답을 내야 한다

`Playlist` 하나가 마스터와 미디어를 겸하는 대가는 파싱이 아니라 **속성** 쪽에서 나온다.

```python
# playlist.py:163-166
    @property
    def is_live(self) -> bool:
        """ENDLIST 가 없으면 진행 중인 라이브 송출이다."""
        return not self.is_master and not self.has_endlist
```

마스터 플레이리스트에는 `#EXT-X-ENDLIST` 가 **원래 없다.** 그 태그는 미디어
플레이리스트의 종료 표식이기 때문이다. 따라서 `not self.is_master` 를 빼면 **모든
마스터가 LIVE 로 판정된다.**

**다만 지금 이 저장소에서 그 오판이 실제로 일어나지는 않는다.** `is_live` 의 호출부는
둘뿐이고([`cli.py:208`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L208) · [`cli.py:399`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L399)), 둘 다 `_resolve_media` 가 이미 풀어낸 **미디어**
플레이리스트를 받는다([`cli.py:535`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L535) · [`cli.py:583`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L583)). `is_master` 가 `True` 인 객체가
이 속성에 도달하는 경로가 현재는 없다.

그러면 저 조건은 죽은 코드인가. 아니다 — **합타입(sum type)을 한 dataclass 로 표현한
설계에서 속성은 두 경우 모두에 답할 수 있어야 한다.** 지금 호출부가 좁다는 사실은
호출부의 성질이지 속성의 성질이 아니다. 누군가 마스터 단계에서 모드를 미리 정하는
빠른 경로를 넣는 순간(`_decide_mode(args, pl)`) 모든 VOD 마스터가 `remux` 로 내려가고,
**세그먼트 단위 검증이 통째로 사라진다.** 그때 이 한 낱말이 유일한 방어다.

같은 성질이 `pick_variant` 의 첫 두 줄에도 있다 — `EXT-X-MEDIA` 만 있고
`EXT-X-STREAM-INF` 가 없는 마스터는 `is_master=True` 이면서 `variants` 가 비어 있어,
`ValueError("마스터 플레이리스트에 variant 가 없다")` 로 떨어진다([`playlist.py:190`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L190)).
합타입을 하나로 접으면 **성립하지 않는 조합을 코드가 직접 막아야 한다.**

---

## 3.4 코드 ② — base 는 층마다 갱신된다

플레이리스트의 URI 는 상대 주소로 적히는 것이 보통이다. 그것을 절대 주소로 바꾸는
지점은 이 코드에 **하나뿐**이다.

```python
# playlist.py:30-38
def _absolute(base_url: str, uri: str | None) -> str | None:
    """플레이리스트에 적힌 URI 를 절대 주소로 만든다 — 여기가 URI 를 낳는 유일한 지점이다.

    절대화와 함께 퍼센트 인코딩까지 끝낸다. 이후 이 값은 요청에도, ffmpeg 입력에도
    그대로 쓰이므로 어느 한쪽에서만 정규화하면 다른 쪽이 열지 못한다.
    """
    if not uri:
        return uri
    return normalize_url(urljoin(base_url, uri) if base_url else uri)
```

문제는 `base_url` 에 무엇을 넣느냐다. 층마다 다르다.

![2단 간접과 base URL 승계](/images/lecture/hls-recon/03-two-tier.svg)

*그림 3-1 — 상대 URI 는 그것이 적힌 문서의 주소로 절대화된다. ①이 낳은 주소가 ②를 파싱할 때의 base 가 된다.*

| 층 | 호출 지점 | `base_url` |
|---|---|---|
| ① 마스터 | [`cli.py:138`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L138) | 사용자가 준 소스 주소 |
| ① 마스터(로컬 파일) | [`cli.py:145`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L145) | `p.as_uri()` — `file://` 스킴 |
| ② variant | [`cli.py:189`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L189) | `chosen.uri` — **①이 낳은 주소** |
| ③ 자막 트랙 | [`cli.py:274`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L274) | `track.uri` — **①이 낳은 또 다른 주소** |

### 3.4.1 반례 — base 를 갱신하지 않으면

회귀 테스트의 자막 픽스처가 이 실패를 정확히 재현할 수 있는 형태로 놓여 있다
(`tests/run.sh:110-124`).

```
$BASE/master-subs.m3u8          ← 마스터. 트랙 URI 는 "subko/index.m3u8"
$BASE/subko/index.m3u8          ← 자막 플레이리스트. 세그먼트는 "seg000.vtt"
$BASE/subko/seg000.vtt          ← 실제 자막 조각
```

`subko/index.m3u8` 을 파싱할 때 base 를 **마스터의 주소**로 두면 `seg000.vtt` 는
`$BASE/seg000.vtt` 로 풀린다. 그 자리에는 파일이 없다. 자막 5조각이 전량 404 로
떨어지고, 영상은 정상 재생된다 — **부분 실패가 조용히 성립하는 자리**다.

같은 이유로 [`cli.py:189`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L189) 의 `base_url=chosen.uri` 도 필수다. variant 가 마스터와 다른
디렉터리에 있는 송출(`/master.m3u8` 과 `/hd/index.m3u8`)에서 마스터 주소를 base 로
쓰면 세그먼트 전량이 어긋난다. 이 저장소의 `multi/` 픽스처는 마스터와 variant 가 같은
디렉터리에 있어 **이 실수를 잡아내지 못한다**(`tests/run.sh:59-66`). §3.10 에 적는다.

---

## 3.5 코드 ③ — 후보 선택과 중첩 마스터 거부

### 3.5.1 `pick_variant` — 왜 대역폭이 기본 정렬 키인가

```python
# playlist.py:185-204
    def pick_variant(
        self, height: int | None = None, max_bandwidth: int | None = None
    ) -> Variant:
        """화질 후보 선택. 지정이 없으면 대역폭 최댓값."""
        if not self.variants:
            raise ValueError("마스터 플레이리스트에 variant 가 없다")
        pool = self.variants
        if height is not None:
            matched = [v for v in pool if v.height == height]
            if not matched:
                avail = sorted({v.height for v in pool if v.height}, reverse=True)
                raise ValueError(
                    f"{height}p 후보가 없다. 사용 가능: {avail or '해상도 미표기'}"
                )
            pool = matched
        if max_bandwidth is not None:
            under = [v for v in pool if v.bandwidth <= max_bandwidth]
            if under:
                pool = under
        return max(pool, key=lambda v: v.bandwidth)
```

기본 정렬 키가 `RESOLUTION` 이 아니라 `BANDWIDTH` 인 것은 규격에서 나온다. RFC 8216
§4.3.4.2 에서 `EXT-X-STREAM-INF` 의 **`BANDWIDTH` 는 REQUIRED, `RESOLUTION` 은
OPTIONAL** 이다. `Variant.height` 가 해상도 미표기 시 `0` 을 돌려주도록 만든 것
([`playlist.py:115-122`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L115-L122))도 같은 사실의 귀결이다 — **항상 존재하는 정렬 키는 대역폭뿐이다.**

`height` 를 지정했는데 후보가 없으면 **가장 가까운 것으로 대체하지 않고 예외를 던진다.**
그리고 가용 목록을 메시지에 담는다. 검증 도구에서 이것은 타협 대상이 아니다 — 720p 를
요청한 사용자에게 조용히 1080p 를 주면 리포트의 `variant` 필드와 실제 산출물이 어긋나고,
그 리포트를 근거로 한 모든 비교가 무효가 된다.

> **그런데 이 `ValueError` 는 어디서도 `SystemExit` 으로 바뀌지 않는다.** 이 저장소의
> 다른 실패 경로는 예외 없이 `SystemExit` 으로 바꿔 깔끔한 메시지만
> 남긴다([`cli.py:135`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L135) · `140` · `147` · `187` · `191`). 그런데 `pick_variant` 를 부르는
> 자리([`cli.py:183`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L183))에는 `try` 가 없고, `_run_one` 에도 `main` 에도 없다. 결과적으로
> `--height 720` 을 잘못 준 사용자는 공들여 만든 "사용 가능: [1080, 480]" 메시지를
> **파이썬 스택 트레이스에 실려서** 본다. 시리즈 경로는 더 나쁘다 — [`cli.py:757`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L757) 의
> `except SystemExit` 이 `ValueError` 를 잡지 못하므로, 한 회차의 후보 불일치가
> **27화 전체 실행을 중단시킨다.** 실측으로 확인한 결함이며 §3.10 에 남긴다.

**그런데 `max_bandwidth` 는 같은 규율을 따르지 않는다.** `under` 가 비면 `pool` 을
그대로 두므로, 상한 아래 후보가 하나도 없을 때 이 함수는 **전체에서 최댓값**을
돌려준다. 사용자가 "5Mbps 이하"를 요구했는데 8Mbps 후보 하나만 있는 마스터에서 8Mbps 를
받는다. 실패도 아니고 경고도 없다. `height` 의 엄격함과 `max_bandwidth` 의 관대함이
**한 함수 안에서 비대칭**이다. §3.10 에 적는다.

### 3.5.2 `_resolve_media` — 깊이 1 고정

```python
# cli.py:172-196
def _resolve_media(
    pl: playlist.Playlist, src: str, fetcher: Fetcher, args: argparse.Namespace
) -> Source:
    """마스터면 variant 를 골라 미디어 플레이리스트까지 내려간다."""
    if not pl.is_master:
        return Source(media=pl, media_url=src)

    _eprint(f"  마스터 플레이리스트 — 화질 후보 {len(pl.variants)}개")
    for v in sorted(pl.variants, key=lambda x: -x.bandwidth):
        _eprint(f"    · {v.label()}")

    chosen = pl.pick_variant(height=args.height, max_bandwidth=args.max_bandwidth)
    _eprint(f"  선택: {chosen.label()}")
    res = fetcher.get(chosen.uri)
    if not res.ok:
        raise SystemExit(f"variant 플레이리스트 요청 실패: {chosen.uri}\n  {res.error}")
    try:
        media = playlist.parse(res.body.decode("utf-8", errors="replace"), base_url=chosen.uri)
    except ValueError:
        raise SystemExit(_diagnose(res, chosen.uri)) from None
    if media.is_master:
        raise SystemExit("variant URL 이 또 마스터 플레이리스트다 — 중첩 구조는 지원하지 않는다")
    return Source(
        media=media, media_url=chosen.uri, master=pl, variant=chosen, label=chosen.label()
    )
```

**재귀가 없다.** 이 함수는 정확히 한 번 내려가고, 내려간 곳이 또 마스터면 중단한다
([`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193)). 자기 자신을 다시 부르는 두 줄만 쓰면 중첩을 "지원"할 수 있는데,
그렇게 하지 않은 근거가 셋이다.

| # | 근거 | 지원했다면 무엇이 깨지는가 |
|---|---|---|
| 1 | **규격** — RFC 8216 §4.3.4.2 는 `EXT-X-STREAM-INF` 다음 줄의 URI 가 **미디어 플레이리스트**를 가리킨다고 규정한다. 중첩은 규격 밖이다 | 규격 밖 입력에 맞춘 코드가 규격 안 입력의 동작을 바꾼다 |
| 2 | **종료 보장** — 참조 그래프를 만드는 쪽은 원격 서버다. `A → A` 인 마스터 하나로 무한 루프에 빠진다 | 깊이 제한을 두려면 상수를 정해야 하는데, 그 상수의 근거가 어디에도 없다 |
| 3 | **의미의 부재** — 리포트의 `variant` 필드는 "무엇을 받았는가"의 유일한 기록이다. 중첩되면 어느 층의 후보를 적어야 하는지 정의되지 않는다 | 검증 결과의 해석 자체가 성립하지 않는다 |

세 번째가 가장 무겁다. 중첩 마스터는 **파싱이 어려운 것이 아니라 의미가 없는** 구조다.
지원 가능한 것과 지원해야 하는 것은 다르다. `README.md:416` 이 이 결정을 알려진 한계로
명시해 두었다 — **거부는 감추지 않는다.**

> 근거 2 는 이 저장소의 다른 파일에도 같은 형태로 나타난다. 도식 검사기가 SVG 를
> 파싱하기 **전에** DTD·엔티티 선언을 거부하는 것(`tools/check_svg.py:36-39`)이 같은
> 판단이다. **원격이 만든 참조 그래프를 무제한 순회하지 않는다.**

### 3.5.3 variant 폴백이 없다는 것

[`cli.py:186-187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L186-L187) 은 선택한 variant 를 받지 못하면 즉시 `SystemExit` 다. 다음 후보로
내려가지 않는다. 브라우저의 ABR 플레이어라면 반드시 폴백하는 지점이다.

여기서는 폴백하지 않는 것이 옳다. **검증 도구는 "요청한 것"을 받아야 하고, 받지 못한
사실 자체가 결과다.** 조용히 낮은 화질로 내려가면 리포트는 PASS 를 내지만 그 PASS 가
무엇에 대한 PASS 인지 알 수 없다. 다만 "최고 화질만 깨진 CDN"에서는 전체가 실패하고
사용자가 `--height` 로 직접 내려가야 한다 — 대가가 없는 결정이 아니다.

---

## 3.6 세 번째 간접 — `EXT-X-MEDIA` 의 그룹 참조

지금까지의 두 간접은 **주소**로 이어졌다. 세 번째는 다르다.

```
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="한국어",URI="subko/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1400000,SUBTITLES="subs"
plain/index.m3u8
```

`SUBTITLES="subs"` 는 URL 이 아니다. **같은 문서 안 다른 태그의 `GROUP-ID` 값과 문자열이
같다**는 것이 전부다. 관계형 데이터베이스의 외래 키(foreign key)와 같은 구조이고,
차이는 **무결성 제약을 검사하는 주체가 없다**는 것이다.

![그룹 참조 — 이름으로 잇는 세 번째 간접](/images/lecture/hls-recon/03-group-ref.svg)

*그림 3-2 — 같은 문서 안에서 이름으로 잇는 참조. 어긋나면 빈 목록이 나오고 예외도 경고도 없다.*

코드에 그대로 반영돼 있다. 참조하는 쪽과 참조되는 쪽이 각각 필드 하나다.

```python
# playlist.py:112 (Variant)
    subtitles_group: str = ""  # SUBTITLES="..." — 이 후보에 딸린 자막 그룹
```

```python
# playlist.py:76 (Media)
    group_id: str
```

이름을 푸는 함수는 이것뿐이다.

```python
# playlist.py:177-183
    def tracks(self, kind: str, group: str = "") -> list[Media]:
        """부가 트랙 조회. group 을 주면 해당 그룹으로 한정한다."""
        return [
            m
            for m in self.media
            if m.type == kind and (not group or m.group_id == group)
        ]
```

### 3.6.1 세 종류의 참조를 나란히 놓으면

| 참조 | 형식 | 대상 | 해석 시점 | 어긋나면 |
|---|---|---|---|---|
| `EXT-X-STREAM-INF` → 미디어 | URI(다음 줄) | 다른 문서 | HTTP 요청 시 | `SystemExit` — 즉시 중단 ([`cli.py:186-187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L186-L187)) |
| `EXT-X-MEDIA` → 자막 플레이리스트 | URI(속성) | 다른 문서 | 자막 단계 | 그 트랙만 실패, 영상은 진행 ([`cli.py:275-277`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L275-L277)) |
| `EXT-X-STREAM-INF` → 그룹 | **이름(문자열)** | **같은 문서** | 파싱 후 메모리 | **빈 목록. 예외도 경고도 없다** |

세 번째 행만 네트워크에 나가지 않는다. 네트워크에 나가지 않는다는 것은 **실패를 알려줄
상태 코드가 없다**는 뜻이기도 하다. RFC 8216 §4.3.4.2 는 `SUBTITLES` 값이 그 문서
어딘가의 `TYPE=SUBTITLES` 인 `EXT-X-MEDIA` 의 `GROUP-ID` 와 **MUST match** 라고 쓰지만,
그것을 검사하는 주체는 어디에도 없다. 규격의 MUST 는 검사기가 있을 때만 효력이 있다.

### 3.6.2 그룹이 비었을 때만 폴백한다

```python
# cli.py:160-165
    def subtitle_tracks(self) -> list[playlist.Media]:
        """선택된 화질 후보에 딸린 자막 그룹. 그룹 참조가 없으면 전체를 본다."""
        if not self.master:
            return []
        group = self.variant.subtitles_group if self.variant else ""
        return self.master.tracks("SUBTITLES", group)
```

세 갈래로 갈린다.

| 상황 | `group` | 결과 | 판단 |
|---|---|---|---|
| variant 에 `SUBTITLES` 속성이 없다 | `""` | `tracks()` 의 `not group` 가지 → **전체 반환** | 그룹 개념을 쓰지 않는 송출이다. 문서 안 자막이 곧 이 영상의 자막 |
| 이름이 일치한다 | `"subs"` | 그 그룹만 | 정상 |
| 이름이 어긋난다 | `"subs-v2"` | **`[]`** | 조용히 사라진다 |

세 번째에서 전체로 폴백하지 **않는** 것은 의도된 것이다. 어긋난 이름을 무시하고 전체를
주면 **다른 화질 후보에 딸린 자막**을 이 영상에 붙이게 된다. 다국어 송출에서 이것은
"틀린 자막이 붙은 파일"을 만들고, 그 파일은 재생되므로 아무도 눈치채지 못한다.
**없는 자막이 틀린 자막보다 낫다.**

다만 침묵이 대가다. 사용자에게 알리는 코드는 이 조건 뒤에 있다.

```python
# cli.py:557-559
    if args.subs != "none" and all_subs and not chosen_subs:
        _eprint(f"  · --subs {args.subs} 에 해당하는 자막이 없다 "
                f"(가용: {', '.join(m.language or '?' for m in all_subs)})")
```

`all_subs` 가 이미 비어 있으면 이 경고는 나오지 않는다. **그룹 참조가 어긋난 경우가
정확히 그 경우다.** §3.10 에 적는다.

### 3.6.3 참조 끝에 자원이 없는 경우 — CLOSED-CAPTIONS

```python
# playlist.py:86-89
    @property
    def is_embedded(self) -> bool:
        """영상 스트림에 실려 오는 트랙 — 따로 내려받을 대상이 아니다."""
        return self.uri is None
```

`TYPE=CLOSED-CAPTIONS`(CEA-608/708 — 영상 기본 스트림 안에 실려 전송되는 캡션)는
RFC 8216 §4.3.4.1 에서 `URI` 속성을 **가질 수 없다**. 선언은 마스터에 있는데 자원은
영상 안에 있다. 간접의 끝에 주소가 없는 유일한 경우다.

```python
# cli.py:167-169
    def closed_captions(self) -> list[playlist.Media]:
        """영상 스트림에 실려 오는 캡션(CEA-608/708). 별도 내려받을 수 없어 안내만 한다."""
        return self.master.tracks("CLOSED-CAPTIONS") if self.master else []
```

여기서는 그룹으로 한정하지 않는다. 받을 수 없는 것의 목록을 좁힐 이유가 없기 때문이다 —
**용도가 다르면 같은 조회 함수도 다르게 쓴다.** 실제 필터는 다운로드 단계에서 걸린다
([`subtitles.py:82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L82) 의 `external = [t for t in tracks if not t.is_embedded]`).

---

## 3.7 `Source` — 내려가면서 상위 문맥을 버리지 않는다

```python
# cli.py:150-169
@dataclass
class Source:
    """소스 해석 결과. 자막·다국어 오디오 선언은 마스터에만 있으므로 함께 들고 다닌다."""

    media: playlist.Playlist
    media_url: str
    master: playlist.Playlist | None = None
    variant: playlist.Variant | None = None
    label: str = ""

    def subtitle_tracks(self) -> list[playlist.Media]:
        """선택된 화질 후보에 딸린 자막 그룹. 그룹 참조가 없으면 전체를 본다."""
        if not self.master:
            return []
        group = self.variant.subtitles_group if self.variant else ""
        return self.master.tracks("SUBTITLES", group)

    def closed_captions(self) -> list[playlist.Media]:
        """영상 스트림에 실려 오는 캡션(CEA-608/708). 별도 내려받을 수 없어 안내만 한다."""
        return self.master.tracks("CLOSED-CAPTIONS") if self.master else []
```

docstring 한 줄이 이유를 다 말한다. 그 한 줄을 풀어 쓰면 이렇다.

### 3.7.1 정보는 층마다 다른 곳에만 있다

| 정보 | 마스터에만 | 미디어에만 |
|---|---|---|
| 화질 후보 목록 (`EXT-X-STREAM-INF`) | ● | |
| 자막·다국어 오디오 선언 (`EXT-X-MEDIA`) | ● | |
| 세그먼트 순서열 (`EXTINF` + URI) | | ● |
| 암호화 키 (`EXT-X-KEY`) | | ● |
| 초기화 세그먼트 (`EXT-X-MAP`) | | ● |
| `TARGETDURATION` · `MEDIA-SEQUENCE` · `ENDLIST` | | ● |
| 선언 길이(`declared_duration`) — 검증의 기준선 | | ● |

**내려가면 잃는다.** `_resolve_media` 가 `media` 만 돌려주었다면, 그 뒤로는 자막이
존재한다는 사실 자체를 알 방법이 없다. 미디어 플레이리스트에는 `EXT-X-MEDIA` 가 없기
때문이다.

그래서 `Source` 는 **다섯 개**를 함께 든다.

| 필드 | 왜 필요한가 |
|---|---|
| `media` | 세그먼트·키·길이 — 실제 작업 대상 |
| `media_url` | ffmpeg 위임 경로(`remux`)의 입력이자, ③층 URI 의 base |
| `master` | 자막·오디오 **선언**의 유일한 출처 |
| `variant` | 그룹 참조를 푸는 데 필요 — "어느 후보를 골랐는가"를 모르면 `subtitles_group` 을 읽을 수 없다 |
| `label` | 리포트에 남길 "무엇을 받았는가"의 기록 |

`master` 와 `variant` 가 `None` 을 허용하는 이유도 여기 있다. 사용자가 **미디어
플레이리스트 URL 을 직접** 준 경우([`cli.py:176-177`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L176-L177))에는 마스터가 존재하지 않는다.
그러면 `subtitle_tracks()` 는 `[]` 를 돌려준다([`cli.py:162-163`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L162-L163)).

> **미디어 URL 만 가진 사용자는 자막을 얻을 원리적 방법이 없다.** 자막 선언이 있는
> 문서를 본 적이 없기 때문이다. 이것이 `--sub-guess`/`--sub-url` 이라는 별도 경로가
> 존재하는 이유다(`README.md:275-287`) — 규칙으로 URL 을 조립해 본다. 간접의 상위
> 층을 잃으면 그 층에만 있던 정보는 **추측으로만** 복구된다.

### 3.7.2 `Source` 는 파싱 결과가 아니라 해석 결과다

`playlist.Playlist` 는 **문서 하나**의 표현이다. `Source` 는 **2계층을 하나로 접은 뒤의
상태**다. 두 타입을 구분해 둔 덕분에 소비자 코드는 층 구조를 다시 풀 필요가 없다.

```python
# cli.py:533-536
    src = _resolve_media(pl, src_url, fetcher, args)
    media, media_url, label = src.media, src.media_url, src.label
    _print_structure(media, label)
    _print_tracks(src)
```

`_print_structure` 는 `Playlist` 를 받고, `_print_tracks` 는 `Source` 를 받는다. 전자는
한 문서의 사실만 쓰고, 후자는 **두 문서를 대조해야만 나오는 사실**을 쓴다. 타입이
그 차이를 강제한다.

같은 `Source` 가 자막 메우기 경로([`cli.py:756-766`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L756-L766))에서도 그대로 쓰인다. 2계층 해석을
한 곳에만 두었기 때문에 진입점이 늘어도 규칙이 갈라지지 않는다.

---

## 3.8 일반화 — 카탈로그와 내용의 분리

이 구조는 스트리밍의 발명이 아니다.

| 영역 | ① 카탈로그 층 | ② 내용 층 | 두 층이 어긋나면 |
|---|---|---|---|
| **HLS** | 마스터 플레이리스트 | 미디어 플레이리스트 | variant 404 · 그룹 dangling |
| **MPEG-DASH** | MPD 의 `AdaptationSet` | `Representation` 의 세그먼트 템플릿 | 같은 문제. 다만 한 문서 안이라 원자성은 있다 |
| **패키지 저장소** | 인덱스(PyPI simple, npm registry) | 배포 파일(`.whl`, tarball) | 인덱스는 갱신됐는데 파일이 아직 없다 → 설치 실패 |
| **DNS** | NS 위임 레코드 | 권한 서버의 A 레코드 | lame delegation — 위임은 있는데 응답할 서버가 없다 |
| **컨테이너 이미지** | manifest list(태그) | 레이어 blob(다이제스트) | 태그는 있는데 blob 이 GC 됐다 |
| **HTML** | 문서 | `<script>` · `<img>` 하위 자원 | 404, 혹은 **다른 내용이 온다** |
| **동적 링크** | 심볼 테이블 | 공유 라이브러리의 실제 주소 | 심볼 해석 실패 |

일곱 행이 공유하는 성질은 셋이다.

**1. 원자성이 없다.** 두 층을 서로 다른 시각에 받는다. 그 사이의 변경을 클라이언트가
알 방법이 없다. 이것이 **TOCTOU(Time-Of-Check to Time-Of-Use)** 의 일반형이고, 보안
문맥에서는 취약점의 이름이 된다.

> **용어** — **TOCTOU(Time-Of-Check to Time-Of-Use)**: 검사한 시점의 상태와 사용하는
> 시점의 상태가 다를 수 있는 구조. 두 시점 사이에 대상이 바뀌면 검사 결과가 무효가 된다.

**2. 참조 무결성을 강제할 주체가 없다.** 규격은 MUST 를 쓸 수 있지만, 두 층을 함께 보고
검사하는 컴포넌트가 없으면 그 MUST 는 문서에만 존재한다. 데이터베이스의 외래 키가
효력을 갖는 이유는 **같은 트랜잭션 안에서 강제하는 엔진이 있기 때문**이다. 여기에는
그 엔진이 없다.

**3. 오류가 국소화되지 않는다.** "재생이 안 된다"를 받은 서버는 어느 층이 깨졌는지
모른다. 그래서 이 코드는 진단을 클라이언트에 둔다 — `_diagnose`([`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102))가
①층([`cli.py:140`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L140))과 ②층([`cli.py:191`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L191)) **양쪽에서** 불린다. 층마다 실패 모드가 달라도
사용자가 보는 메시지 형식은 하나여야 하기 때문이다.

---

## 3.9 보안 — 간접 하나가 신뢰 결정 지점 하나다

**간접이 한 단 늘 때마다 "이것을 믿을 것인가"를 결정해야 하는 자리가 하나 늘어난다.**
이 절은 그 자리들을 센다.

### 3.9.1 층마다 독립된 인가 판정을 받는다

`_resolve_media` 의 `fetcher.get(chosen.uri)`([`cli.py:185`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L185))는 마스터를 받은 요청과
**완전히 별개의 HTTP 요청**이다. 서버는 이 요청이 앞 요청의 후속임을 알 방법이 없다 —
제4장이 다룰 무상태성이다. 결과적으로 다음이 모두 가능하다.

| 마스터 | variant | 세그먼트 | 실제로 일어나는 일 |
|---|---|---|---|
| 200 | 200 | 200 | 정상 |
| 200 | 403 | — | 목록은 보이는데 아무것도 못 받는다 |
| 200 | 200 | 403(중간부터) | **앞부분만 받아지고 나머지가 빠진다** |
| 200 | 200 | 200 + 오류 페이지 | 제14장 — 헤더만으로는 구별 불가 |

세 번째 행이 제0장의 출발점("총 길이가 맞는데 중간이 비어 있다")과 직접 닿는다.
**층 하나의 성공은 다음 층을 보증하지 않는다.**

이 코드가 그 사실을 인정하는 지점이 `_adopt_origin` 재시도다.

```python
# cli.py:131-133
        # 첫 응답에서 Referer 를 얻었다면, 그 때문에 막혔던 요청은 다시 해볼 값이 있다.
        if _adopt_origin(res, fetcher) and not res.ok:
            res = fetcher.get(src)
```

이 재시도는 ①층에만 있다. ②층 요청([`cli.py:185`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L185))에는 없다 — 그때는 이미 `fetcher.headers`
에 Referer 가 들어 있으므로 필요가 없다는 판단이다. **헤더 상태가 층을 가로질러
승계되기 때문에 성립하는 최적화**이고, `fetcher.headers` 를 단일 출처로 유지하겠다는
결정([`cli.py:526-529`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L526-L529))이 그 전제다. 사본을 넘기면 층마다 다른 헤더로 요청하게 된다.

### 3.9.2 서명 URL 은 층마다 따로 만료된다

서명 URL(제11장)에서 마스터와 variant 는 각자의 서명·만료를 갖는다. 마스터가 캐시된
채로 유효한데 그 안의 variant 서명은 이미 죽어 있는 조합이 실재한다. 증상은
"**재생 목록은 열리는데 재생이 안 된다**"이고, 사용자 눈에는 원인이 보이지 않는다.

`series.py` 가 27화분 주소를 미리 모아두지 않고 **회차 직전에 해석하는**(지연 해석)
이유가 이것이다. 간접 층이 늘어난 만큼 "언제 해석하는가"가 정확성의 문제가 된다.

### 3.9.3 재귀 깊이는 원격이 정하게 두면 안 된다

[`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193) 의 중첩 마스터 거부는 기능 결정이자 **보안 결정**이다. 참조 그래프를
만드는 쪽이 원격이면, 그 그래프를 무제한 순회하는 클라이언트는 자신의 제어 흐름을 원격에
넘긴 것이다. 같은 형태의 취약점 목록은 길다.

| 이름 | 원격이 주는 것 | 무제한 순회의 결과 |
|---|---|---|
| XXE / billion laughs | XML 엔티티 정의 | 메모리 폭발 |
| zip bomb | 중첩 압축 | 디스크·CPU 고갈 |
| 리다이렉트 루프 | `Location` 헤더 | 무한 요청 |
| 심볼릭 링크 루프 | 파일 시스템 링크 | 경로 해석 무한 |
| **중첩 마스터** | `EXT-X-STREAM-INF` URI | 무한 요청 + 무한 파싱 |

방어의 형태도 같다 — **깊이를 상수로 고정하거나, 순회 자체를 거부한다.** 이 코드는 후자를
골랐고, 그것이 가장 단순하고 가장 확실한 종료 보장이다. 근거 2 에서 말했듯 깊이 제한을
두려 해도 그 상수를 정당화할 근거가 없다.

### 3.9.4 원격 문자열이 닿는 곳

그룹 이름(`GROUP-ID`)은 **원격이 정하는 임의 문자열**이다. 이 코드에서 그 문자열이 하는
일은 `tracks()` 안의 `==` 비교뿐이므로 위험이 없다. 그러나 같은 문서에서 온 다른 원격
문자열은 파일 경로에 닿는다 — `Media.language` 가 출력 파일명이 된다. 그래서 그 자리에는
거름망이 있다.

```python
# subtitles.py:104
    lang = re.sub(r"[^A-Za-z0-9-]", "", track.language)
```

**원격 문자열이 비교에만 쓰이는가, 이름이 되는가**가 검토의 기준선이다. 제32장에서
다시 다룬다.

### 3.9.5 방어자 관점

| 역할 | 무엇을 해야 하는가 |
|---|---|
| **CDN·송출 운영자** | 마스터와 variant 의 서명 수명을 같게 두지 말 것. 마스터가 캐시되어 살아 있는 동안 variant 서명이 먼저 죽으면 "열리는데 재생 안 됨"이 된다. 상위 층의 TTL ≤ 하위 층의 잔여 수명이어야 한다 |
| **접근 통제 설계자** | **층 하나만 지키는 것은 층을 안 지키는 것이다.** 마스터에만 인가를 걸고 variant·세그먼트를 공개해 두면, 마스터 한 번만 얻으면 나머지는 전부 열린다. 각 층이 독립적으로 인가돼야 한다 |
| **클라이언트 구현자** | 원격이 만든 참조 그래프의 깊이를 **상수로 고정**하고, 상수를 정할 근거가 없으면 순회를 거부할 것. 층마다 base URL 을 갱신할 것 — 갱신하지 않으면 하위 경로가 통째로 어긋난다 |
| **파서 구현자** | 그룹 참조 실패를 **빈 목록으로 조용히 넘기지 말 것.** 최소한 "선언된 그룹과 참조된 그룹이 다르다"를 경고로 낼 것. 하이브리드 문서는 규격상 무효이므로 거부가 옳다 |
| **감사자** | "재생됨"은 층 하나의 성공일 뿐이다. **자막 그룹이 어긋나 있어도 영상은 정상 재생된다.** 부가 트랙의 존재 여부는 마스터 원문을 직접 봐야 확인된다 |
| **검증 도구 작성자** | 요청한 후보와 받은 후보가 같은지 리포트에 남길 것(`Source.label`). 조용한 폴백은 리포트 전체의 의미를 지운다 |

---

## 3.10 한계와 미해결

정직하게 적어 둔다.

- **`pick_variant` 의 `ValueError` 가 `SystemExit` 으로 변환되지 않는다.** [`cli.py:183`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L183) 에
  `try` 가 없어 후보 불일치가 스택 트레이스로 새어 나오고, 시리즈 경로의
  `except SystemExit`([`cli.py:757`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L757))은 이것을 잡지 못해 **한 회차의 실패가 전체 실행을
  중단시킨다.** 다른 모든 실패 경로가 지키는 규율을 이 한 곳만 지키지 않는다.
  이 장을 쓰면서 발견했고, 고치지는 않았다.
- **`max_bandwidth` 의 비대칭.** `pick_variant`([`playlist.py:200-203`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L200-L203))는 상한 아래 후보가
  없을 때 상한을 조용히 무시하고 전체 최댓값을 돌려준다. `height` 는 같은 경우 예외를
  던진다. 두 인자가 한 함수 안에서 다른 규율을 따르며, 어느 쪽이 옳은지에 대한 근거가
  코드에도 주석에도 없다.
- **하이브리드 문서를 거부하지 않는다.** `#EXT-X-STREAM-INF` 와 `#EXTINF` 가 섞인 문서는
  RFC 8216 §4 상 무효인데, 이 파서는 받아들이고 `_resolve_media` 는 세그먼트를 조용히
  버린다. 실물 송출에서 이런 문서를 본 적은 없다 — **가능성일 뿐 관측이 아니다.**
- **그룹 dangling 이 무음이다.** §3.6.2 의 세 번째 경우에서 자막이 사라지는데 아무
  메시지도 나오지 않는다. [`cli.py:557`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L557) 의 경고는 `all_subs` 가 비면 도달하지 않는다.
  고치려면 `Source.subtitle_tracks()` 가 "그룹은 지정됐는데 매칭이 0"인 경우를 구별해
  돌려주어야 한다.
- **base 승계를 검증하는 테스트가 없다.** `tests/run.sh:59-66` 의 `multi/` 픽스처는
  마스터와 variant 가 **같은 디렉터리**에 있어, [`cli.py:189`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L189) 의 `base_url=chosen.uri` 를
  마스터 주소로 바꿔도 테스트가 통과한다. 자막 픽스처(`tests/run.sh:110-124`)만이
  하위 디렉터리 구조를 갖는다. **회귀로 고정되지 않은 결정**이다.
- **중첩 마스터의 실제 빈도는 모른다.** 지원하지 않기로 한 결정의 비용은 "그런 송출을
  만나면 실패한다"인데, 그런 송출을 실측한 적이 없다. 근거는 규격 해석이지 관측이 아니다.
- **마스터–variant 사이의 TOCTOU 를 검사하지 않는다.** 두 요청 사이에 서버가 후보 집합을
  바꿔도 알 수 없다. LIVE 송출에서 실제로 일어날 수 있는 일이고, 이 코드는 그 창을 재지도
  좁히지도 않는다.
- **`TYPE=AUDIO` 는 표시만 한다.** 그룹 참조를 읽어 목록에 출력하지만([`cli.py:219`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L219)) 별도
  오디오 트랙을 받아 먹싱하는 경로가 없다(`README.md:417-419`). 기본 오디오가 영상
  variant 안에 들어 있는 송출만 다룬다 — **다국어 오디오가 분리된 송출에서는 기본 언어만
  받는다.**
- **`EXT-X-I-FRAME-STREAM-INF` 를 읽지 않는다.** 트릭 플레이(빨리감기 썸네일)용 후보
  선언이다. 파서가 무시하므로 그런 마스터에서도 동작하지만, 그 존재는 리포트에 남지 않는다.

---

## 3.11 요약

1. **문서의 종류는 자기 서술되지 않는다.** 마스터와 미디어는 확장자도 Content-Type 도
   같고, 구분은 `#EXT-X-STREAM-INF`/`#EXT-X-MEDIA` 가 나타나는가로만 이루어진다
   (`playlist.py:261,275`). 파서는 종류를 판정하는 것이 아니라 **파싱 도중 발견한다**.
2. **2계층은 갱신 단위와 캐시 수명을 층별로 분리하기 위한 것**이고, 그 대가로 원자성과
   참조 무결성을 잃는다. 이 교재가 다루는 문제의 절반이 그 대가에서 나온다.
3. **base URL 은 층마다 갱신되어야 한다.** 상대 URI 는 그것이 적힌 문서의 주소로 푼다
   (`cli.py:138,189,274`). 갱신하지 않으면 하위 디렉터리에 놓인 트랙이 전량 404 가 된다.
4. **`EXT-X-MEDIA` 의 그룹 참조는 URI 가 아니라 이름으로 잇는 세 번째 간접**이고, 유일하게
   네트워크에 나가지 않는다. 그래서 실패를 알려줄 상태 코드가 없고, 어긋나면
   `tracks()` 가 **빈 목록을 조용히** 돌려준다([`playlist.py:177-183`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L177-L183)).
5. **중첩 마스터 거부는 세 겹의 근거를 갖는다** — 규격 위반, 종료 보장, 의미의 부재
   ([`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193)). 세 번째가 가장 무겁다. 지원 가능한 것과 지원해야 하는 것은 다르다.
6. **`Source` 는 내려가면서 상위 문맥을 버리지 않기 위해 존재한다**([`cli.py:150-169`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L150-L169)).
   자막·오디오 선언은 마스터에만 있으므로, variant 를 고른 뒤 마스터를 버리면 그 정보는
   **추측으로만** 복구된다.
7. **간접 하나가 신뢰 결정 지점 하나다.** 층마다 별개의 인가 판정·별개의 서명 만료·별개의
   실패 모드가 있다. 층 하나만 지키는 접근 통제는 지키지 않는 것과 같다.

---

**다음 장** — 이 장은 세 층의 요청이 서로 독립임을 전제로 이야기했다. 그 독립성은
설계 선택이 아니라 HTTP 의 성질이다. 제4장은 무상태 프로토콜이 무엇을 보증하고 무엇을
보증하지 않는지를 [`fetch.py:107-215`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L107-L215) 에서 읽고, "받아졌다"가 왜 "옳게 받아졌다"가 아닌지를
전송 계층에서 확정한다.
