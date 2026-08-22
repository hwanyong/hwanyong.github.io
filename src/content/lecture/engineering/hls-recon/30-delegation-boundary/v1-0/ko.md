---
title: "위임의 경계"
description: "라이브러리가 하지 않는 일을 아는 것"
date: 2026-07-28
version: '1.0'
tags: ['streaming', 'distributed-systems']
thumbnail: /images/lecture/thumb/hls-recon-30-delegation-boundary.svg
---
## 30.0 이 장에서 답할 것

1. 이 저장소는 무엇을 ffmpeg 에 맡겼고, 무엇은 맡길 수 없었는가
2. 맡긴 쪽이 **하지 않는 일**을 모르면 무엇이 조용히 틀리는가
3. 이미 완성된 것을 **다시 맡기지 않는** 판단은 무엇에 근거하는가
4. 위임이 상속시키는 것은 능력뿐인가

제6부를 닫는 장이다. 제27–29장은 자막 시각을 영상 시각에 맞추는 세 가지 문제
(아핀 대응 · 33비트 래핑 · 경계 중복 큐)를 각각 다뤘다. 이 장은 그 셋이 **왜 이쪽
코드에 있는가**를 묻는다. 세그먼트 병합도, 컨테이너 변환도 전부 ffmpeg 에 맡긴
저장소가 왜 저 셋만은 직접 하는가. 답은 하나의 원리로 모인다.

---

## 30.1 문제 — 자막이 60초 밀렸는데 아무도 실패하지 않는다

### 30.1.1 관찰

자막 트랙 하나를 받아 파일로 뽑는 실행을 생각하자. 이어붙이기는 ffmpeg 에 맡기고,
그 결과를 그대로 쓴다. 각 단계가 내는 신호는 이렇다.

```
자막 조각 5개 수신     → 전부 HTTP 200
ffmpeg 이어붙이기      → exit 0, stderr 비어 있음
생성된 파일            → 유효한 WebVTT, 큐가 들어 있다
재생기에 물림          → 오류 없이 열림
```

어느 단계도 실패하지 않았다. 그런데 이 자막은 **영상 타임라인에 맞춰지지 않았다.**
각 조각의 헤더에 실려 온 `X-TIMESTAMP-MAP` 이 "자막의 이 시각은 영상의 저 시각"이라고
지시하는데, **그 지시를 적용한 층이 하나도 없다.** 그래서 트랙 전체가 지시한 만큼
통째로 밀린 채로 남는다.

밀림의 크기는 송출마다 다르다. 이 저장소의 회귀 테스트는 그것을 **60초**로 못박아
재현한다 — 영상이 30초이므로 60초 밀린 자막은 화면에 **한 줄도 나오지 않고**, 밀림을
검사하는 쪽이 잡아내야 할 대상이 명확해진다.

![자막이 60초 밀린 실행에서 각 층이 내는 신호](/images/lecture/hls-recon/30-silent-pass.svg)

*그림 30-1 — 자막이 60초 밀렸는데 어느 층도 오류를 내지 않는다*

결함 주입의 형태는 이렇다.

```python
# tests/run.sh:89-92
# subbad 는 X-TIMESTAMP-MAP 기준을 60초 어긋나게 잡아 자막이 영상 범위를 벗어나게 만든다.
# 음수로 만들면 안 된다 — 33비트 부호 없는 PTS 에 음수는 무효라 timestamp_offset 이
# None 을 돌려주고(subtitles.py:208-210), 보정을 아예 걸지 않아 결함이 주입되지 않는다.
OFFSET = {"subko": 0, "suben": 0, "subbad": 60 * 90000}
```

주입의 형태에 주목할 것. 파일을 깨뜨리지 않았고, 응답을 실패시키지도 않았다.
**헤더에 적힌 숫자 하나를 바꿨을 뿐**인데 산출물이 쓸모없어진다. 그리고 그 사실을
알려주는 오류는 어디에도 없다.

> 두 번째 문장은 제28장의 소재다. 그리고 **무효값을 버리는 주체가 누구인지**를
> 짚어 둘 값어치가 있다 — ffmpeg 이 아니라 **이 저장소의 코드**다.
>
> ```python
> # subtitles.py:208-210
>     # 33비트 부호 없는 값이 규격이라 음수는 무효다 — 매핑 자체를 신뢰하지 않는다.
>     if mpegts < 0:
>         return None
> ```
>
> `timestamp_offset` 이 `None` 을 돌려주면 호출부는 보정을 걸지 않고, 자막은 원래
> 자리에 그대로 남는다. **결함이 주입되지 않는 것이다.** 이 주석이 원래
> "ffmpeg 가 무효로 보고 매핑 자체를 무시해서"라고 적혀 있었고, 이 절의 검증이 그
> 귀속 오류를 찾아 고쳤다. 위임을 다루는 장에서 **자기가 한 일을 수임자가 한 일로
> 적어 둔 것**보다 어울리는 사례는 없다.

### 30.1.2 이 형태를 이미 본 적이 있다

제0장 §0.1 의 출발점이 같은 형태였다.

```
6초 세그먼트 1개 결손 → ffmpeg 종료 코드 0, 출력 길이 30.03s (정상과 동일)
                     → 실제로는 5.99s ~ 12.02s 구간이 통째로 비어 있음
```

세그먼트 결손과 자막 밀림은 다루는 대상이 다르지만 **실패의 양식이 같다.**

| | 세그먼트 결손 | 자막 60초 밀림 |
|---|---|---|
| 종료 코드 | 0 | 0 |
| 표준 오류 출력 | 비어 있음 | 비어 있음 |
| 산출물의 형식 유효성 | 유효 | 유효 |
| 겉으로 보이는 지표 | 총 길이 정상 | 큐가 들어 있고 형식 유효 |
| 실제 상태 | 6초 구간이 비어 있음 | 자막이 한 줄도 안 보임 |

두 경우 모두 **관측 지표가 정상을 가리키는데 결과가 틀렸다.** 제0장은 이것을
"잘못된 관측 지표를 고르면 검증 전체가 무의미해진다"로 정리했다. 이 장은 한 걸음
더 들어가서 묻는다 — **애초에 왜 아무도 오류를 내지 않는가.**

답은 간단하고, 간단해서 놓치기 쉽다.

> **그 일을 맡은 층이 없었기 때문이다.**

ffmpeg 은 거짓말하지 않았다. 자기가 맡은 일(자막 조각을 순서대로 이어붙이기)은
정확히 해냈고, 그래서 exit 0 을 냈다. 문제는 **아무도 맡지 않은 일**이 하나 남아
있었다는 것이다. 그리고 아무도 맡지 않은 일은 **아무도 실패를 보고하지 않는다.**

---

## 30.2 원리 — 위임이 넘겨주는 세 가지

### 30.2.1 위임이란 무엇을 하는 결정인가

> **용어** — **위임(delegation)**: 어떤 책임을 자기가 구현하지 않고 다른 구성 요소에
> 넘기는 설계 결정. 넘기는 쪽을 위임자(delegator), 넘겨받는 쪽을 수임자(delegate)라
> 부른다. 함수 호출·라이브러리 사용·외부 프로세스 실행·SaaS 채택이 모두 같은 형태다.

이 저장소의 재조립 계층은 위임을 원칙으로 선언한다.

```python
# assemble.py:1-6
"""재조립 계층 — 실제 컨테이너 작업은 전부 ffmpeg 에 위임한다.

세그먼트 병합·복호화·타임스탬프 정규화는 ffmpeg 의 hls/mpegts demuxer 가
이미 규격대로 구현하고 있으므로 여기서 다시 만들지 않는다. 이 모듈의 책임은
"어떤 인자로 위임할지"와 "진행 상황을 어떻게 계측할지" 뿐이다.
"""
```

이 선언은 제19장에서 이미 인용했다. 거기서는 "그럼에도 `concat_segments` 만은 직접
한다"는 예외를 설명하는 근거였다. 여기서는 반대 방향으로 읽는다 — **위임한다는
결정이 무엇을 함께 결정하는가.**

### 30.2.2 세 가지가 함께 넘어온다

![위임이 넘겨주는 세 가지](/images/lecture/hls-recon/30-three-regions.svg)

*그림 30-2 — 위임은 능력만 넘겨받는 결정이 아니다*

| 영역 | 정체 | 언제 드러나는가 |
|---|---|---|
| **능력** | 수임자가 규격대로 구현해 둔 일 | 즉시 — 이것을 얻으려고 위임한다 |
| **제약** | 수임자가 정한 규칙·옵션 스키마·버전별 동작 | 특정 입력에서만 — 재현이 어렵다 |
| **침묵** | 수임자가 하지 않으면서, 하지 않는다고 말하지도 않는 일 | **드러나지 않는다** |

셋 중 능력만 보고 위임을 결정하는 것이 기본값이다. 문서와 예제가 능력만 설명하기
때문이다. 제약은 나중에 이상한 입력에서 튀어나오고, 침묵은 튀어나오지 않는다.

### 30.2.3 침묵의 세 형태

"하지 않는다"에도 등급이 있다. 이 구분이 이 장의 핵심 도구다.

| 형태 | 수임자의 반응 | 위임자가 알 수 있는가 | 예 |
|---|---|---|---|
| **거절** | 오류·예외·0 아닌 종료 코드 | **알 수 있다** | 지원하지 않는 확장자 → `Invalid data found` |
| **미구현 신고** | 경고 로그·기능 없음 표시 | 알 수 있다(로그를 읽으면) | `Codec not supported, ignoring` |
| **침묵** | 정상 종료, 정상 형식의 산출물 | **알 수 없다** | 자막을 이어붙였지만 영상에 맞추지는 않았다 |

앞의 둘은 위임 관계의 정상 작동이다. 수임자가 자기 경계를 **말해 준다.** 문제는
셋째다 — 수임자가 자기 경계를 말하지 않는 이유는 대개 **그것을 자기 일이라고 여긴
적이 없기 때문**이다. 자기 일이 아닌 것을 안 했다고 보고하는 구성 요소는 없다.

> **위임의 위험은 수임자가 일을 못하는 데 있지 않다. 수임자가 그 일을 자기 일로
> 여기지 않는데 위임자는 맡겼다고 믿는 데 있다.**

### 30.2.4 왜 ffmpeg 은 X-TIMESTAMP-MAP 을 적용하지 않는가

§30.1 의 60초 밀림은 침묵의 전형이다. 그런데 이것을 ffmpeg 의 결함이라고 부르면
원리를 놓친다. 코드의 설명을 그대로 읽어 보자.

```python
# subtitles.py:194-197
    X-TIMESTAMP-MAP=LOCAL:<자막 시각>,MPEGTS:<90kHz 클럭> 은 '자막의 이 시각이
    영상 타임라인의 이 클럭값에 해당한다'는 대응표다. ffmpeg 8.1.1 은 입력 구성과
    무관하게 이 매핑을 적용하지 않으므로(실측: 마스터 입력으로 열어도 MPEGTS 를 바꾼
    결과가 같다) 직접 계산해 보정한다. 0 이 아니면 자막이 그만큼 밀려 있다는 뜻이다.
```

이 주석은 원래 다른 이유를 적고 있었다. **"ffmpeg 는 자막 플레이리스트를 단독 입력으로
열 때 이 매핑을 적용하지 않으므로 — 정렬 기준이 될 영상이 그 입력에 없다."** 그럴듯하다.
`X-TIMESTAMP-MAP` 은 두 시간축을 잇는 대응표이고(제27장), 대응표를 쓰려면 양쪽 축이
다 있어야 하니까. 그 설명대로라면 **마스터 플레이리스트로 열면 영상 축이 생기므로
demuxer 가 알아서 적용해야 한다.**

제27장 §27.4 가 이미 그 함의를 실험했고, 이 절에서 독립적으로 재현했다. 큐 내용이
완전히 같고 `MPEGTS` 값만 60초 다른 자막 플레이리스트 둘을, 같은 영상과 묶은 마스터
플레이리스트로 각각 열었다.

```text
$ ffmpeg -i master_s0.m3u8  -map 0:s:0 -c:s webvtt out_s0.vtt   # MPEGTS:0
$ ffmpeg -i master_s60.m3u8 -map 0:s:0 -c:s webvtt out_s60.vtt  # MPEGTS:5400000 (60초)

out_s0.vtt   첫 큐  00:01.467 --> 00:03.467
out_s60.vtt  첫 큐  00:01.467 --> 00:03.467      ← 같다
```

**MPEGTS 값을 60초 옮겼는데 출력이 한 밀리초도 달라지지 않았다.** 영상 축이 있는
구성인데도 매핑이 적용되지 않은 것이다(1.467초 밀림은 영상 첫 PTS 에 맞춘 결과이지
`X-TIMESTAMP-MAP` 을 읽은 결과가 아니다). 바이너리를 확인하면 이유가 분명해진다.

```text
$ strings -a libavformat.62.dylib | grep -c WEBVTT
15
$ strings -a libavformat.62.dylib | grep -c X-TIMESTAMP-MAP
0
```

`WEBVTT` 는 15번 나오는데 `X-TIMESTAMP-MAP` 은 **한 번도 나오지 않는다.** ffmpeg
8.1.1 의 libavformat 은 이 헤더를 파싱하는 코드를 갖고 있지 않다. 즉 정정된 사실은
이렇다.

| 입력 구성 | 영상 축이 있는가 | 매핑 적용 (ffmpeg 8.1.1 실측) |
|---|---|---|
| 자막 플레이리스트 **단독** (`-i subs.m3u8`) | 없음 | 적용하지 않는다 |
| 마스터 플레이리스트 전체 (`-i master.m3u8`) | 있음 | **적용하지 않는다** |

**"입력의 함수"가 아니었다.** 원래 주석은 관측된 침묵에 그럴듯한 이유를 붙인 것이고,
그 이유가 예측한 것(마스터로 열면 처리된다)은 실험에서 반증됐다. 주석은 위 인용처럼
고쳐졌다.

이것이 이 장에서 가장 값비싼 교훈이다.

> **수임자가 침묵할 때 위임자는 그 침묵에 이유를 붙이고 싶어진다. 그 이유는 검증되지
> 않은 채 코드 주석으로 굳고, 틀려도 아무 일이 일어나지 않는다 — 어차피 위임자는
> 그 일을 직접 하고 있기 때문이다.**

여기서 실무 규칙 하나가 따라 나온다. **수임자가 무엇을 하지 않는지에 대한 서술은
"왜 안 하는가"가 아니라 "어느 구성에서 안 하는가"로 적어야 한다.** 앞의 형태는
검증할 수 없고, 뒤의 형태는 위 실험처럼 30초면 반증된다.

이 저장소가 자막을 **따로** 뽑는 이유는 sidecar 파일(영상 옆에 놓는 별도 자막 파일)을
만들기 위해서다. 매핑 보정을 직접 하는 결정 자체는 — 이유가 틀렸어도 — 옳았다.
**옳은 결정이 틀린 이유 위에 서 있을 수 있다는 것**이 이 절이 남기는 불편한 사실이다.

---

## 30.3 코드 — 맡긴 것

### 30.3.1 맡긴 것의 목록

| 맡긴 일 | 맡긴 이유 | 코드 앵커 |
|---|---|---|
| 세그먼트 병합(원격 경로) | hls demuxer 가 규격대로 구현 | [`assemble.py:69-90`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L69-L90) `remux_from_url` |
| 컨테이너 먹싱·변환 | 박스·PES 재작성을 다시 만들 이유가 없다 | [`assemble.py:108-130`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L108-L130) `remux_local` |
| 타임스탬프 정규화 | PTS/DTS 재기록은 컨테이너 지식이 필요 | [`assemble.py:121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L121) `-fflags +genpts` |
| AES-128 복호화(원격 경로) | `remux` 모드에서는 ffmpeg 가 키를 직접 받는다 | [`assemble.py:78`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L78) 독스트링 |
| 리다이렉션·세그먼트 재시도(원격 경로) | 위와 같다 | [`assemble.py:78`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L78) |
| 자막 조각 이어붙이기 | 조각 순서·형식 파싱을 다시 만들 이유가 없다 | [`subtitles.py:142-149`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L142-L149) |
| 자막 형식 변환(vtt↔srt) | 코덱 변환은 ffmpeg 의 일 | [`subtitles.py:432-441`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L432-L441) `_convert` |
| 컨테이너 자막 내장 | 매핑·메타데이터 먹싱 | [`subtitles.py:339-374`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L339-L374) `embed_args` |
| 스트림 정보·패킷 시각 실측 | ffprobe 가 컨테이너를 읽는다 | [`probe.py:124-162`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L124-L162), `191-233` |

여기에 공통점 하나를 붙이고 싶어진다 — "전부 컨테이너 내부 구조를 이해해야 하는
일"이라고. 대체로 맞지만 **이 표 자신이 그 일반화를 반증한다.** 리다이렉션과 세그먼트
재시도는 컨테이너가 아니라 전송 계층의 일이고, §30.4 에서 볼 "직접 한 것"에는 MPEG-TS
연속성 카운터 검사 — 188바이트 패킷 헤더를 직접 파싱하는, 가장 컨테이너 내부다운 일 —
이 들어 있다.

경계를 가르는 것은 **일의 소재가 아니라 수임자가 그것을 자기 일로 여기는가**다.
소재로 나누면 위 두 반례에서 곧바로 어긋난다. §30.2.3 의 3단계 침묵 등급이 기준인
이유가 이것이다.

### 30.3.2 `remux_local` — 바이트를 한 개도 만지지 않는 함수

위임의 형태가 가장 잘 드러나는 함수다.

```python
# assemble.py:108-130
def remux_local(
    raw: Path,
    out: Path,
    on_progress: Callable[[float], None] | None = None,
    subs: tuple[list[str], list[str], str] | None = None,
) -> list[str]:
    """이어붙인 원본을 최종 컨테이너로 무손실 먹싱한다.

    자막 입력은 subtitles.embed_args() 가 자기 입력 옵션까지 담아 돌려주므로
    여기서는 그대로 이어 붙이기만 한다.
    """
    cmd = [
        require("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
        "-fflags", "+genpts",  # 세그먼트 연결부의 PTS 결손을 보정
        "-i", str(raw),
    ]
    if subs:
        cmd += subs[0]
    cmd += _stream_args(subs)
    cmd += container_args(out)
    cmd += ["-progress", "pipe:1", str(out)]
    _run_with_progress(cmd, on_progress)
    return cmd
```

이 함수 전체가 하는 일은 **리스트를 만드는 것**이다. `raw` 를 열지도 않고, 바이트를
읽지도 쓰지도 않는다. 컨테이너 변환이라는 무거운 작업이 여기서는 문자열 조립으로
축소되어 있다. 이것이 "위임한다"의 구체적 모습이다.

> **용어** — **리먹싱(remuxing)**: 오디오·비디오 스트림을 **재인코딩하지 않고**
> 컨테이너만 바꿔 다시 쓰는 작업. 이 저장소는 어느 경로에서도 재인코딩하지 않는다
> (`-c copy`, [`assemble.py:16`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L16)).

그리고 마지막 줄 `return cmd` 가 위임 설계의 마감이다. 실행한 명령을 그대로 돌려주어
리포트에 남긴다([`cli.py:637`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L637) `mux_cmd=run.mux_cmd`). **위임한 일은 재현 가능해야
한다** — 무엇을 맡겼는지가 기록에 남지 않으면 결과를 검증할 수 없다.

### 30.3.3 `container_args` 도 위임의 일부다

위임은 "알아서 해 달라"가 아니다. 수임자가 어떤 조건에서 실패하는지를 **위임자가
알고 있어야** 한다.

```python
# assemble.py:16-31
# 컨테이너별 추가 인자. 재인코딩은 어느 경우에도 하지 않는다(-c copy).
_CONTAINER_ARGS: dict[str, list[str]] = {
    # ADTS 헤더가 붙은 AAC 를 MP4 의 ASC 형식으로 바꾸는 비트스트림 필터.
    #
    # 정직하게 적어 둔다. **ffmpeg 8.1.1 에서 실측하면 mov 먹서가 이 필터를 스스로
    # 끼워 넣는다** — verbose 로그에 "Automatically inserted bitstream filter
    # 'aac_adtstoasc'" 가 찍히고, 명시한 출력과 명시하지 않은 출력의 오디오
    # 페이로드 md5 가 같다. 즉 이 인자의 현재 이득은 측정되지 않는다.
    #
    # 그래도 남겨 두는 이유는 probe.py 의 확장자 열거와 같다 — 이 도구는 ffmpeg
    # 버전을 고정하지 않으므로 먹서의 자동 삽입에 기대고 싶지 않다.
    ".mp4": ["-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"],
    ".m4v": ["-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"],
    ".mkv": [],
    ".ts": [],
}
```

MPEG-TS 안의 AAC 는 ADTS 헤더가 붙어 있고 MP4 는 ASC 형식을 요구하므로, 비트스트림
필터로 헤더 형식을 바꿔야 한다 — 여기까지는 규격의 사실이다. 문제는 **누가 바꾸는가**다.

이 주석은 원래 이렇게 적혀 있었다.

```text
# ADTS 헤더가 붙은 AAC 를 MP4 의 ASC 형식으로 바꿔주지 않으면 mp4 먹싱이 실패한다.
```

이 교재를 집필하며 검증한 결과 **그 문장은 현재 환경에서 참이 아니었다.**

```text
$ ffmpeg -v verbose -i src.ts -c copy out_nobsf.mp4        # 필터를 주지 않았다
Automatically inserted bitstream filter 'aac_adtstoasc'; args=''
$ echo $?
0

$ ffmpeg -i out_nobsf.mp4 -map 0:a -c copy -f md5 -
MD5=c7be92a4449e31fa0b7f5a81a9bfd093
$ ffmpeg -i out_bsf.mp4   -map 0:a -c copy -f md5 -        # 필터를 명시했다
MD5=c7be92a4449e31fa0b7f5a81a9bfd093
```

**실패하지 않는다. 출력 오디오도 한 바이트가 같다.** mov 먹서가 필요한 필터를 스스로
끼워 넣기 때문이다(ffmpeg 8.1.1).

그래서 이 자리는 §30.2.3 의 **거절**이 아니라 **말 없는 대행**이다. 수임자가 위임자보다
먼저 알아서 처리했고, 그 사실을 기본 로그로는 알리지 않는다 — `-v verbose` 로 올려야
보인다. 위임자는 자기가 왜 그 인자를 넣었는지 확인할 길 없이 계속 넣는다.

제15장 §15.6 에서 `-allowed_extensions` 를 두고 만난 모양과 같다. **지금 이득이 측정되지
않는 인자를, 수임자 구현에 기대고 싶지 않다는 이유로 남긴다.** 다른 점은 하나뿐이다 —
제15장은 그 사실을 코드에 적어 두었고 이쪽은 적어 두지 않았다. 그래서 주석이 낡았고,
낡은 줄을 아무도 몰랐다. 이 절의 검증이 그것을 찾아냈고 주석은 위 인용처럼 고쳐졌다.

**`.mkv` 와 `.ts` 의 빈 리스트는 여전히 이 표가 실측의 산물이라는 증거다** — 필요 없는
컨테이너에는 아무것도 넣지 않았다. 다만 실측은 한 번 하고 끝나는 일이 아니다. **수임자가
판올림되면 위임자의 지식은 조용히 낡는다.** 위임의 진짜 비용은 맡기는 순간이 아니라
여기, 맡긴 뒤 상대가 변하는 데 있다.

---

## 30.4 코드 — 맡길 수 없어 직접 한 것

### 30.4.1 목록과 이유

| 직접 한 일 | 왜 맡길 수 없는가 | 코드 앵커 |
|---|---|---|
| `X-TIMESTAMP-MAP` 정렬 보정 | ffmpeg 은 어느 입력 구성에서도 적용하지 않는다(§30.2.4) | [`subtitles.py:191-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L191-L218), [`cli.py:237-289`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L237-L289) |
| 경계 중복 큐 제거 | ffmpeg 은 이어붙이기만 한다 — 규격이 허용한 중복이므로 오류도 아니다 | [`subtitles.py:259-322`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L259-L322) `dedupe` |
| 조각 헤더 정제 | 이어붙이기의 **부산물**이라 수임자에게는 정상 출력이다 | [`subtitles.py:172-181`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L172-L181) `_clean_body` |
| 전송 계층 계측 | ffmpeg 은 HTTP 상태·TTFB·회선 바이트를 보고하지 않는다(§30.7) | [`fetch.py:73-104`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L104), [`report.py:159-230`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L159-L230) |
| 페이로드 판별 | 헤더가 아니라 선두 바이트로 봐야 한다(제14·16장) | [`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37) `sniff` |
| MPEG-TS 연속성 카운터 검사 | demuxer 는 유실을 복구할 뿐 보고하지 않는다(제18장) | [`tsanalyze.py:71-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L71-L121) |
| 타임라인 결손 스캔 | 총 길이가 보존되므로 ffmpeg 에게는 정상이다(제21장) | [`probe.py:191-233`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L191-L233) `gap_scan` |

앞의 셋은 제6부의 주제(시간과 분산)이고, 뒤의 넷은 제2부·제3부·제4부의 주제다. 서로 다른
부에서 각각 다룬 것들이 **하나의 원리로 묶인다** — 전부 §30.2.3 의 **침묵** 영역이다.

### 30.4.2 `extract` — 한 함수 안에 두 세계가 있다

자막 추출 함수는 위임과 직접 처리가 맞닿는 이음매다. 독스트링이 경계를 먼저 선언한다.

```python
# subtitles.py:116-127
    """자막 트랙을 각각 별도 파일(sidecar)로 뽑는다.

    트랙 URI 가 자막 플레이리스트면 조각을 이어붙여야 하므로 ffmpeg 에 맡긴다.
    완성된 자막 파일을 URI 로 그대로 선언하는 송출도 있는데(규격은 플레이리스트를
    요구하지만 실제로 그렇게 나간다), 그쪽은 받아서 저장하면 끝이다 — 이어붙일
    조각이 없는데 ffmpeg 를 태우면 원본 바이트를 잃기만 하고 얻는 것이 없다.
    받는 방법은 이미 `fetch_sidecar` 가 알고 있으므로 그리로 넘긴다.

    offsets 는 트랙 URI → 정렬 오프셋(초). ffmpeg 가 적용하지 않는
    X-TIMESTAMP-MAP 보정을 추출 후에 직접 반영한다. 완성 파일에는 그 매핑이
    없으므로 대상이 아니다.
    """
```

세 문단이 각각 다른 결정을 담고 있다.

| 문단 | 결정 | 판단 근거 |
|---|---|---|
| 1 | 조각이면 ffmpeg 에 맡긴다 | 이어붙이기는 수임자의 능력 |
| 2 | 완성 파일이면 **맡기지 않는다** | 얻는 것 없이 원본 바이트만 잃는다(§30.5) |
| 3 | 맡긴 뒤에 보정을 직접 건다 | 수임자의 침묵 영역 |

그리고 본문이 그대로 그 순서다.

```python
# subtitles.py:138-164
        if not is_playlist_uri(track.uri or ""):
            results.append(fetch_sidecar([track.uri or ""], dest, fetcher, fmt, track))
            continue

        cmd = [require("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y"]
        cmd += input_args(fetcher.headers, track.uri or "")
        cmd += [
            "-i", track.uri or "",
            "-map", "0:s:0",
            "-c:s", codec,
            str(dest),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        res = SubtitleResult(track=track, path=dest)
        if proc.returncode != 0:
            res.error = proc.stderr.strip()[-300:] or f"ffmpeg exit {proc.returncode}"
        elif not dest.exists() or dest.stat().st_size == 0:
            res.error = "빈 파일이 생성됐다 — 자막 조각에 큐가 없다"
        else:
            res.ok = True
            res.duplicates, res.header_leaks = dedupe(dest, fmt)
            res.offset = (offsets or {}).get(track.uri or "", 0.0)
            shift(dest, fmt, res.offset)
            res.cues, res.first_cue, res.last_cue = measure(dest)
            if res.cues == 0:
                res.ok, res.error = False, "큐가 하나도 없다"
        results.append(res)
```

`proc.returncode != 0` 아래 세 갈래를 보라.

| 갈래 | 무엇을 잡는가 | §30.2.3 의 형태 |
|---|---|---|
| `returncode != 0` | 수임자가 **거절**했다 | 거절 |
| 파일 없음 / 0바이트 | 수임자가 성공을 보고했지만 산출물이 없다 | 거절과 침묵의 경계 |
| `else:` 아래 네 줄 | 수임자가 성공했고 산출물도 있다 — **여기서부터가 침묵 영역** | 침묵 |

`else` 블록의 네 줄이 이 장 전체의 축약이다. **위임이 성공한 지점에서 직접 처리가
시작된다.** 성공했으니 끝이 아니라, 성공했으므로 이제 수임자가 하지 않은 일을 해야
한다.

### 30.4.3 후처리에는 순서가 있다

`dedupe` → `shift` → `measure` 의 순서는 임의가 아니다.

| 순서 | 왜 이 자리인가 | 어기면 |
|---|---|---|
| 1 `dedupe` | 조각 헤더 정제와 중복 제거 | (아래 참조) |
| 2 `shift` | 큐 수가 확정된 뒤 시각을 옮긴다 | 중복 큐까지 옮겨 무의미한 작업이 늘고, 중복 판정 키가 이동 전후로 갈린다 |
| 3 `measure` | 최종 파일에서 큐 수·범위를 읽는다 | 리포트가 정리 전 상태를 보고한다 |

`dedupe` 안에도 순서가 하나 더 있고, 이것이 제29장의 주제였다.

```python
# subtitles.py:296-300
        # 헤더 정제를 중복 판정보다 먼저 한다. 오염된 쪽과 깨끗한 쪽의 본문이
        # 달라 보이면 같은 큐인데도 중복으로 잡히지 않는다.
        body = _clean_body(raw_body)
        if body != raw_body:
            leaked += 1
```

두 개의 후처리가 **서로 얽혀 있다**는 사실이 중요하다. 위임한 쪽이 남긴 부산물(조각
헤더)이 다른 후처리(중복 판정)의 입력을 오염시킨다. 위임 경계에서 흘러나온 문제는
하나로 오지 않는다.

### 30.4.4 실측 — 위임한 결과에 실제로 무엇이 남는가

앞의 주장들이 추상적이지 않다는 것을 로컬에서 확인할 수 있다. 외부 서버 없이
재현되며 필요한 것은 `ffmpeg` 와 `python3` 뿐이다.

**설정**: 30초 영상, 6초짜리 WebVTT 조각 5개. 고유한 큐는 **6개**이고, 구간 경계에
걸치는 큐는 규격이 허용하는 대로 양쪽 조각에 모두 넣었다(제29장). 따라서 조각들에
흩어져 있는 큐 **인스턴스**는 9개다.

```bash
$ grep -c -- '-->' subko/seg*.vtt
subko/seg000.vtt:2
subko/seg001.vtt:2
subko/seg002.vtt:2
subko/seg003.vtt:2
subko/seg004.vtt:1        # 합계 9 인스턴스 / 고유 6큐
```

이제 이어붙이기를 ffmpeg 에 맡긴다.

```bash
$ ffmpeg -v error -y -protocol_whitelist file,http,https,tcp,tls,crypto \
    -allowed_extensions ts,m4s,vtt,webvtt,m3u8 \
    -i subko/index.m3u8 -map 0:s:0 -c:s webvtt raw.vtt
$ echo $?
0
$ grep -c -- '-->' raw.vtt
9
```

**exit 0, 큐 9개.** 그리고 파일 앞부분은 이렇다.

```
WEBVTT

00:00.000 --> 00:04.000
line 1

00:05.000 --> 00:09.000
line 2
WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

00:05.000 --> 00:09.000
line 2
```

두 가지가 한꺼번에 보인다.

1. `line 2` 가 **두 번** 실려 있다 — 경계 중복 큐가 그대로 남았다
2. 두 번째 `line 2` 큐의 **본문 안에** `WEBVTT` 와 `X-TIMESTAMP-MAP=…` 이 들어갔다
   — 조각 헤더가 앞 큐의 본문으로 흡수됐다

그리고 §30.2.4 의 주장도 같은 방법으로 확인된다. 조각 헤더의 `MPEGTS` 값을 바꿔
**"자막 로컬 0초는 영상 60초 지점"** 이라고 선언한 뒤 같은 명령을 돌린다.

```bash
$ grep X-TIMESTAMP-MAP subshift/seg000.vtt
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:5400000     # 5400000 / 90000 = 60초

$ ffmpeg -v error -y -protocol_whitelist file,http,https,tcp,tls,crypto \
    -allowed_extensions ts,m4s,vtt,webvtt,m3u8 \
    -i subshift/index.m3u8 -map 0:s:0 -c:s webvtt shifted.vtt
$ grep -m1 -- '-->' shifted.vtt
00:00.000 --> 00:04.000
```

**첫 큐가 여전히 0초에서 시작한다.** 60초 지점이라고 선언했는데 옮겨지지 않았다 —
옮길 기준(영상 축)이 그 입력에 없기 때문이다. 오류도, 경고도 없다.

경계 중복과 헤더 흡수 쪽은 [`subtitles.py:172-181`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L172-L181) 의 주석이 이미 기록해 둔 현상이다.

```python
# subtitles.py:172-181
def _clean_body(body: str) -> str:
    """큐 본문에 섞여 들어온 조각 헤더를 걷어낸다.

    ffmpeg 가 자막 조각을 이어붙일 때 각 조각 선두의 `WEBVTT` 와
    `X-TIMESTAMP-MAP=` 줄을 직전 큐의 본문으로 흡수한다. 그대로 두면 그 문자열이
    자막으로 화면에 표시되므로 제거한다.
    """
    return "\n".join(
        ln for ln in _SEG_HEADER_RE.sub("", body).split("\n") if ln.strip()
    ).strip()
```

측정 결과를 표로 정리한다(ffmpeg 8.1.1, macOS arm64).

| 관측 항목 | 값 | 수임자의 판정 |
|---|---|---|
| 종료 코드 | 0 | 성공 |
| 표준 오류 출력 | 비어 있음 | 이상 없음 |
| 산출 파일의 형식 유효성 | 유효한 WebVTT | 이상 없음 |
| 큐 인스턴스 수 | **9** (고유 6) | — |
| 본문에 헤더가 섞인 큐 | **4** | — |
| `X-TIMESTAMP-MAP` 반영 여부 | **미반영**(60초 선언 → 0초 출력) | — |

**아래 세 줄에 대해 수임자는 아무 말도 하지 않는다.** 위 세 줄만 보는 도구는 이
파일을 "정상 추출"로 기록한다. 이것이 이 저장소가 `dedupe`·`shift` 를 직접 두는
이유이고, 그 결과를 회귀 테스트가 숫자로 못박아 둔 이유다.

```bash
# tests/run.sh:225-227
# 원본은 트랙당 6큐. 경계 중복이 남아 있으면 9큐가 된다.
kocues=$(grep -c -- '-->' "$WORK/out/subs.ko.vtt" || true)
[[ "$kocues" -eq 6 ]] && ok "경계 중복 제거 (6큐)" || bad "큐 수가 6이 아님: $kocues"
```

**"9큐가 된다"는 문장이 위 실측과 정확히 일치한다.** 주석에 적힌 숫자가 추정이
아니라 관측이라는 뜻이고, 그것이 이 저장소를 교재로 쓸 수 있는 이유다(제0장 §0.6).

---

## 30.5 다시 맡기지 않는 판단 — 완성된 자막은 ffmpeg 에 태우지 않는다

### 30.5.1 결정

§30.4.2 독스트링 둘째 문단이 이 절의 주제다.

> 이어붙일 조각이 없는데 ffmpeg 를 태우면 **원본 바이트를 잃기만 하고 얻는 것이
> 없다.**

같은 판단이 sidecar 수신 쪽에도 적혀 있다.

```python
# subtitles.py:451-455
    """자막 URL 후보를 앞에서부터 시도해 처음 성공한 것을 저장한다.

    받은 파일은 완성본이므로 dedupe/shift 를 걸지 않는다 — 그 둘은 조각을 이어붙인
    산물에서만 생기는 문제다. 원본 바이트를 그대로 두어야 같은 URL 을 손으로 받은
    결과와 대조할 수 있다. 요청 형식이 원본과 다를 때만 변환본을 따로 만든다.
```

> **용어** — **사이드카 자막(sidecar subtitle)**: 영상 컨테이너 안에 넣지 않고 영상
> 파일 옆에 같은 이름의 별도 파일(`영상.ko.srt` 등)로 두는 자막. 재생기가 파일명
> 규칙으로 짝을 찾는다.

### 30.5.2 무엇을 잃는가 — 실측

"원본 바이트를 잃는다"는 주장을 그대로 확인할 수 있다. 서버가 흔히 내보내는 형태의
SubRip 파일(BOM + CRLF 줄바꿈)을 만들어 ffmpeg 에 한 번 통과시킨다.

```bash
$ xxd -l 16 orig.srt
00000000: efbb bf31 0d0a 3030 3a30 303a 3031 2c30  ...1..00:00:01,0
          ^^^^^^^   ^^^^
          UTF-8 BOM CRLF

$ ffmpeg -v error -y -i orig.srt -c:s subrip round.srt
$ xxd -l 16 round.srt
00000000: 310a 3030 3a30 303a 3031 2c30 3030 202d  1.00:00:01,000 -
            ^^
            LF 단독 — BOM 이 사라졌다

$ wc -c orig.srt round.srt
     119 orig.srt
     110 round.srt
$ cmp orig.srt round.srt
orig.srt round.srt differ: char 1, line 1
```

측정 결과다.

| 항목 | 원본 | ffmpeg 통과 후 | 판정 |
|---|---|---|---|
| UTF-8 BOM | 있음 | **제거됨** | 손실 |
| 줄바꿈 | CRLF | **LF** | 손실 |
| 크기 | 119 B | 110 B | -9 B |
| 큐 시각 | 그대로 | 그대로 | 보존 |
| `<i>` 태그 | 있음 | 있음 | 보존 |
| `{\an8}` 위치 지정 | 있음 | 있음 | 보존 |
| 바이트 동일성 | — | **다름** | — |

이 실행에서 잃은 것은 9바이트이고, **얻은 것은 없다.** 이어붙일 조각이 없었으므로
ffmpeg 이 할 일 자체가 없었다.

> 정직하게 덧붙인다. 이 측정은 태그가 단순한 파일 하나에 대한 것이다. 복잡한 WebVTT
> 스타일 블록(`STYLE`·`REGION`)이나 위치 지정 속성이 통과에서 어떻게 되는지는 확인하지
> 않았다. **다만 "잃는 쪽으로만 갈 수 있다"는 방향성은 바뀌지 않는다** — 재작성은
> 정보를 늘리지 않는다.

### 30.5.3 이 판단을 회귀로 고정한다

```bash
# tests/run.sh:272-274
# 받은 파일은 완성본이라 손대지 않는다 — 서버 원본과 바이트가 같아야 한다.
cmp -s "$WORK/out/에피소드/에피소드01.srt" "$WORK/subtitles/old/에피소드01.srt" \
  && ok "원본 바이트 보존 (BOM·CRLF 포함)" || bad "받은 자막이 원본과 다름"
```

테스트가 만드는 원본 파일은 일부러 BOM 과 CRLF 를 넣는다(`tests/run.sh:255-257`).
**손실이 눈에 보이는 형태로 설계된 표본**이다. 만약 누군가 "일관성을 위해 모든
자막을 ffmpeg 로 정규화하자"고 리팩터링하면 이 한 줄이 즉시 실패한다.

### 30.5.4 위임 여부를 가르는 세 질문

이 저장소의 결정을 일반형으로 옮기면 이렇다.

| 질문 | 조각 자막 | 완성 자막 |
|---|---|---|
| 1. 수임자가 하는 일이 **지금 필요한 일인가** | 그렇다(이어붙이기) | **아니다**(할 일이 없다) |
| 2. 직접 만들면 **수임자만큼 정확한가** | 아니다(형식 파싱을 다시 만들어야) | 문제 없음(그대로 저장) |
| 3. 통과시키면서 **잃는 것이 있는가** | 있지만 대안이 없다 | **있고 대안이 있다** |

세 질문이 모두 같은 방향을 가리킬 때만 위임한다. 마지막 열은 1번에서 이미
"아니다"가 나왔으므로 나머지를 볼 것도 없다.

여기서 흔한 오해 하나를 짚어 둔다.

> **"이미 의존하고 있으니 이 일도 그쪽에 맡기는 편이 일관적이다"는 근거가 아니다.**

일관성은 **인터페이스**의 성질이지 **의존 횟수**의 성질이 아니다. 필요 없는 통과는
일관성을 만들지 않고 손실만 만든다.

---

## 30.6 위임은 제약도 상속한다

### 30.6.1 제14장의 정책 상속을 일반화한다

제14장 §14.5.4 에서 실측한 결과가 이랬다. 같은 `.txt` 위장 스트림을 놓고,

| 모드 | 결과 |
|---|---|
| `--mode segments`(직접 수신) | 성공 |
| `--mode remux`(ffmpeg 위임) | 실패 |

**같은 입력, 같은 도구, 다른 결과.** 갈라지는 지점은 하나뿐이다 — 후자는 ffmpeg 의
확장자 허용 정책까지 함께 상속한다. 그 정책은 이쪽 코드가 정한 것이 아니고, 이쪽이
바꿀 수도 없다(옵션으로 조정만 한다, 제15장).

이것을 §30.2.2 의 표에서 **제약** 영역이라 불렀다. 일반형은 이렇다.

> **위임한 순간, 수임자의 정책이 위임자의 동작 명세가 된다. 위임자의 문서에 적혀
> 있지 않아도 그렇다.**

### 30.6.2 위임 지점을 한 곳으로 모은 이유

제약을 상속한다면, **상속 지점이 여러 곳으로 흩어지면 안 된다.** 이 저장소는
ffmpeg 계열 도구를 세 곳(재조립·실측·자막 추출)에서 부르는데, 입력 인자는 한
함수에서만 만든다.

```python
# probe.py:56-63
    """ffmpeg/ffprobe 입력(`-i`) 앞에 붙일 공통 인자.

    세 도구(재조립·실측·자막 추출)가 같은 조건으로 원본에 접근해야 한다. 한 곳만
    빠지면 "받아지는데 실측만 실패" 같은 갈라진 증상이 난다.

    - headers      : UA·Referer·Cookie 를 세그먼트 요청까지 그대로 이어간다.
    - whitelist    : 로컬 .m3u8 이 원격 세그먼트를 참조하는 구조를 허용한다.
                     모든 demuxer 가 받는 옵션이라 입력을 가리지 않는다.
```

주석의 반례가 정확하다 — **"받아지는데 실측만 실패"**. 위임 조건이 경로마다 다르면
증상이 갈라지고, 갈라진 증상은 원인을 짚기 어렵다. 재조립은 되는데 검증만 실패하는
도구는 자기 산출물을 스스로 불신하는 셈이 된다.

호출 지점을 확인하면 실제로 한 곳으로 모여 있다.

| 호출자 | 앵커 | 무엇을 여는가 |
|---|---|---|
| `assemble.remux_from_url` | [`assemble.py:82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L82) | 플레이리스트 URL |
| `probe.probe` | [`probe.py:127`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L127) | 산출물 또는 URL |
| `probe.first_pts` | [`probe.py:239`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L239) | 첫 세그먼트 |
| `subtitles.extract` | [`subtitles.py:143`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L143) | 자막 플레이리스트 |
| `subtitles.embed_args` | [`subtitles.py:360`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L360) | 자막 플레이리스트(내장용) |

> **용어** — **SSOT(Single Source of Truth, 단일 출처)**: 같은 사실이 여러 곳에
> 중복 기록되지 않고 한 곳에만 있는 상태. 여기서는 "ffmpeg 에 어떤 조건으로
> 접근하는가"가 `input_args` 한 곳에만 있다.

### 30.6.3 위임자는 수임자의 옵션 스키마까지 알아야 한다

`input_args` 의 본문은 일곱 줄인데, 그중 두 줄이 조건부다.

```python
# probe.py:75-81
    args: list[str] = []
    if headers:
        args += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())]
    args += ["-protocol_whitelist", "file,http,https,tcp,tls,crypto"]
    if playlist.is_playlist_uri(target):
        args += ["-allowed_extensions", ALLOWED_SEGMENT_EXTS]
    return args
```

`if playlist.is_playlist_uri(target)` 이 왜 필요한지는 주석이 실측으로 적어 두었다.

```python
# probe.py:70-73
                     **HLS demuxer 에만 있는 옵션**이라 플레이리스트가 아닌 입력에
                     붙이면 `Option allowed_extensions not found` 로 열기 자체가
                     실패한다 — 자막 트랙에 완성 `.srt` 를 넣는 송출에서 실제로
                     걸린다. 그래서 target 을 받아 플레이리스트일 때만 붙인다.
```

이 조건문이 드러내는 사실이 있다. **위임자가 "무엇을 원하는가"만 알아서는 부족하고,
수임자가 "그 요청을 어느 입력에서 받아들이는가"까지 알아야 한다.** ffmpeg 의 옵션은
전역이 아니라 demuxer 별로 존재하며, 존재하지 않는 옵션은 무시되지 않고 **열기 자체를
실패시킨다.**

세 층으로 나누면 이렇다.

| 층 | 위임자가 알아야 하는 것 | 모르면 |
|---|---|---|
| 능력 | 어떤 일을 해 주는가 | 위임 자체를 못 한다 |
| 인터페이스 | 어떤 인자로 요청하는가 | 원하는 동작이 안 나온다 |
| **적용 범위** | 그 인자가 **어느 입력에서 유효한가** | 정상 입력이 열리지 않는다 |

셋째 층이 이 절의 발견이다. 대부분의 문서는 첫째·둘째만 설명한다.

### 30.6.4 상속이 만드는 재현 곤란

제14장 §14.5.4 이 지적한 함정을 여기서 마저 정리한다. `auto` 모드가 언제
`remux` 로 내려가는지가 문제의 절반이다.

```python
# cli.py:391-402
def _decide_mode(args: argparse.Namespace, pl: playlist.Playlist) -> str:
    """auto 모드 결정 — 세그먼트 단위 계측이 불가능한 조건이면 ffmpeg 위임으로 내린다."""
    if args.mode != "auto":
        return args.mode
    unsupported = [s for s in pl.segments if s.key and s.key.is_encrypted and not s.key.is_supported]
    if unsupported:
        _eprint("  · SAMPLE-AES 등 세그먼트 단위 복호화 불가 → remux 모드로 전환")
        return "remux"
    if pl.is_live:
        _eprint("  · LIVE 플레이리스트 → remux 모드로 전환 (스냅샷 계측 불가)")
        return "remux"
    return "segments"
```

전환 조건은 둘 다 **입력의 성질**이다. 사용자가 고르는 것이 아니라 스트림이
결정한다. 따라서 정책 상속에서 오는 실패는 다음 조합에서만 나타난다.

| 스트림 | 확장자 | 실행 모드 | 결과 |
|---|---|---|---|
| VOD | 정상 | `segments` | 성공 |
| VOD | 위장(`.txt` 등) | `segments` | **성공** — 확장자를 보지 않는다 |
| LIVE | 정상 | `remux` | 성공 |
| LIVE | 위장(`.txt` 등) | `remux` | **실패** — 정책을 상속한다 |

네 칸 중 한 칸에서만 실패한다. 그리고 그 칸은 **VOD 로 테스트하면 영원히 보이지
않는다.** 위임 경계에서 오는 결함이 재현하기 어려운 이유가 여기 있다 — 경계를 넘는
조건이 코드가 아니라 입력에 있기 때문이다.

---

## 30.7 위임하면 계측이 사라진다

### 30.7.1 두 관측창

`segments` 모드는 세그먼트를 직접 받고, `remux` 모드는 ffmpeg 이 받는다. 같은
스트림, 같은 산출물인데 **관측할 수 있는 것이 다르다.** 리포트가 그 사실을 한 줄
주석으로 적어 둔다.

```python
# report.py:159-160
    # 2) 전송 계층 — segments 모드에서만 수집된다
    if fetches:
```

직접 받으면 요청 한 건마다 이만큼을 남긴다.

```python
# fetch.py:77-92
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

위임하면 무엇이 돌아오는가. 진행 상황을 받는 통로는 `-progress` 파이프 하나뿐이고,
표준 오류는 **실패했을 때만** 읽는다([`assemble.py:56-58`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L56-L58)).

```python
# assemble.py:45-54
    """-progress 파이프로 out_time_ms 를 읽어 진행 초를 콜백한다."""
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        if on_progress and line.startswith("out_time_ms="):
            raw = line.strip().split("=", 1)[1]
            if raw.isdigit():
                on_progress(int(raw) / 1_000_000)
```

`-progress` 가 실제로 내보내는 필드를 전부 뽑아 보면 이렇다(ffmpeg 8.1.1 실측).

```bash
$ ffmpeg -hide_banner -loglevel error -y -i vid.mp4 -c copy \
    -progress pipe:1 -f mp4 /dev/null | cut -d= -f1 | sort -u
bitrate
drop_frames
dup_frames
fps
frame
out_time
out_time_ms
out_time_us
progress
speed
stream_0_0_q
total_size
```

**열두 개 전부가 출력(인코딩) 쪽 지표다.** 입력이 어디서 어떻게 왔는지에 대한 필드는
하나도 없다. `total_size` 조차 회선을 지나간 바이트가 아니라 **출력 파일에 쓴
바이트**다.

### 30.7.2 무엇이 사라지는가

| 관측 항목 | `segments`(직접) | `remux`(위임) | 사라지면 못 하는 검사 |
|---|---|---|---|
| 세그먼트별 HTTP 상태 | `status` | **없음** | 어느 조각이 404 였는지 |
| TTFB | `ttfb_ms` | **없음** | 응답 지연 p50·p95 판정(제8장) |
| 회선 바이트 / 압축 | `wire_size`, `encoding` | **없음** | 압축 협상 확인(제6장) |
| 재시도 횟수 | `attempts` | **없음** | 송출 불안정 WARN |
| 세그먼트 해시 | `sha256` | **없음** | 중복 세그먼트 검출 |
| 선언 Content-Type | `content_type` | **없음** | 위장·오류 페이지 사후 분석(제14장) |
| 선두 바이트 판별 | `sniff(data)` | **없음** | 200-오류페이지 검출(제5장) |
| TS 연속성 카운터 | `analyze(data)` | **없음** | 패킷 유실 검출(제18장) |
| 진행 시각 | 있음 | `out_time_ms` | — |
| 산출물 실측 | 있음 | 있음(산출물은 남으므로) | — |

마지막 두 줄이 중요하다. **위임해도 사라지지 않는 계측이 있다** — 산출물에 대한
사후 검사다. 파일은 어느 모드에서든 디스크에 남으므로 ffprobe 로 다시 열 수 있다.

```python
# cli.py:609-617
    # 내장하지 않는 경우에만 별도 파일로 뽑는다.
    if chosen_subs and not args.sub_embed:
        subrep.results = _extract_subs(chosen_subs, media, out, args, fetcher, headers)

    info = probe.probe(str(out))
    if subrep.embed_tracks:
        subrep.embed_span = probe.subtitle_span(str(out))
    gaps = None if args.no_gap_scan else probe.gap_scan(str(out))
    decode = None if args.no_decode_check else probe.decode_check(str(out))
```

이 네 줄은 `mode` 를 보지 않는다. **모드와 무관하게 산출물을 다시 연다.** 위임으로
전송 계층 관측을 잃어도 타임라인 결손·디코드 오류·자막 시각 범위는 여전히 잡힌다.

여기서 계측 설계의 원칙이 하나 나온다.

> **위임 경계를 넘어가는 계측은 잃는다. 그러나 경계 바깥의 산출물을 관측하는
> 계측은 잃지 않는다.** 관측 지점을 산출물 쪽으로 옮길 수 있다면 위임의 대가를
> 줄일 수 있다.

### 30.7.3 그래서 모드가 둘이다

`_decide_mode`(§30.6.4)가 `remux` 로 내리는 조건은 둘 다 **계측이 원리적으로
불가능한 경우**다.

| 조건 | 왜 계측이 불가능한가 |
|---|---|
| SAMPLE-AES 등 | 세그먼트 단위 복호화가 성립하지 않아 페이로드를 볼 수 없다(제26장) |
| LIVE | 플레이리스트가 계속 자라므로 스냅샷 시점의 세그먼트 목록이 전체가 아니다 |

즉 이 저장소는 **계측을 포기할 수밖에 없을 때만 위임으로 내려간다.** 반대로 말하면
기본값(`segments`)은 "느려도 관측한다"이고, 위임은 관측 불가라는 조건이 붙을 때의
차선이다.

> **용어** — **관측 가능성(observability)**: 시스템의 외부 출력만으로 내부 상태를
> 얼마나 알아낼 수 있는가. 위임은 편의를 얻고 관측 가능성을 지불하는 거래다.

README 가 이 거래를 한 문장으로 적어 둔다.

```
# README.md:32-34
hls-recon 은 재조립 자체는 ffmpeg 에 위임하고, **ffmpeg 가 알려주지 않는 것만**
따로 계측한다: 세그먼트별 HTTP 결과와 지연, MPEG-TS 연속성 카운터, 재조립본의
타임라인 결손.
```

**"ffmpeg 가 알려주지 않는 것만"** — 이 도구의 정의가 곧 위임 경계의 여집합이다.

---

## 30.8 일반화 — 위임 경계의 일반형

### 30.8.1 명제

이 장의 관찰을 세 문장으로 정리한다.

> **① 위임은 능력과 함께 제약도 상속한다.** 수임자의 정책이 위임자의 동작 명세가
> 된다.
>
> **② 수임자의 침묵은 오류로 나타나지 않는다.** 자기 일이 아니라고 여기는 것을
> 안 했다고 보고하는 구성 요소는 없다.
>
> **③ 그러므로 위임 경계는 아는 것으로 끝나지 않고, 적어 두고 고정해야 한다.**
> 경계가 문서에 없으면 다음 사람은 능력만 보고 침묵 영역을 맡겼다고 믿는다.

### 30.8.2 다른 도메인의 같은 구조

| 위임 | 능력 | 제약(상속) | 침묵(하지 않는 일) |
|---|---|---|---|
| **TLS 라이브러리** | 인증서 체인 검증 | 신뢰 루트 저장소·프로토콜 버전 | **호스트명 검증** — API 를 따로 켜지 않으면 하지 않는다 |
| **ORM** | SQL 생성·객체 매핑 | 방언별 타입·식별자 인용 규칙 | 트랜잭션 격리 수준 선택, N+1 질의 방지 |
| **HTTP 클라이언트** | 연결·리다이렉트 추적 | 리다이렉트 최대 횟수, 프록시 규칙 | 리다이렉트 시 자격증명이 다른 호스트로 새는지 판단 |
| **JSON 파서** | 파싱·타입 변환 | 숫자 정밀도 처리 | 중복 키 정책 — 규격이 미정의라 파서마다 다르다 |
| **컨테이너 런타임** | 프로세스·파일시스템 격리 | cgroup·seccomp 기본 프로필 | 커널 공유로 인한 취약점, 이미지 내용의 신뢰성 |
| **CI 캐시 액션** | 의존성 복원 | 캐시 키 규칙·용량 상한 | 복원된 것이 **정말 그 커밋의 산출물인지** |
| **클라우드 관리형 DB** | 백업·패치·가용성 | 파라미터 그룹 기본값 | 스키마 설계, 접근 통제 정책, 백업의 **복원 가능성** 검증 |
| **`ffmpeg`(이 장)** | 병합·정규화·먹싱 | 확장자 허용 정책·옵션 적용 범위 | 두 시간축 정렬, 경계 중복, 전송 계측 |

각 행의 오른쪽 열이 실제 사고가 난 지점이다. TLS 호스트명 검증 누락은 오랫동안
반복된 취약점 유형이고, 백업 복원을 한 번도 시험하지 않은 조직이 복구 시점에서야
그 사실을 아는 것도 같은 형태다. **오른쪽 열은 오류를 내지 않으므로 사고가 나기
전까지 조용하다.**

### 30.8.3 위임 경계를 적는 형식

이 교재가 권하는 형식은 세 열이다. 능력만 적는 문서는 위임 경계 문서가 아니다.

| 열 | 무엇을 적는가 | 검증 방법 |
|---|---|---|
| 맡긴 것 | 수임자가 해 주는 일 | 정상 경로 테스트 |
| **맡길 수 없어 직접 한 것** | 위임자가 채우는 일 | 결함 주입 — 직접 처리를 끄면 실패해야 한다 |
| **맡긴 쪽이 하지 않는 일** | 침묵 영역의 목록 | 회귀로 고정 — 상류가 바뀌면 알려야 한다 |

이 저장소는 세 열을 각 모듈의 독스트링에 나눠 적어 두었다.

| 모듈 | 경계 선언 |
|---|---|
| [`assemble.py:1-6`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L1-L6) | "컨테이너 작업은 전부 ffmpeg 에 위임한다 … 이 모듈의 책임은 어떤 인자로 위임할지와 어떻게 계측할지 뿐" |
| [`subtitles.py:1-11`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L1-L11) | "병합은 ffmpeg 에 위임하고 여기서는 '무엇을 받을지'와 '받은 결과가 영상과 맞는지'만 책임진다" |
| [`probe.py:1-4`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L1-L4) | "플레이리스트가 선언한 값과 실제 미디어의 값을 대조하기 위한 실측 계층" |

특히 `subtitles.py` 의 것이 세 열 형식에 가장 가깝다.

```python
# subtitles.py:1-11
"""자막 트랙 선택·추출·검증.

자막도 영상과 똑같이 조각나 있고, 각 WebVTT 조각은 헤더에 X-TIMESTAMP-MAP
(90kHz MPEG-TS 클럭과 자막 로컬 시각의 대응표)을 달고 온다. 이 매핑을 잘못
적용하면 자막 전체가 일정량 밀리므로, 병합은 ffmpeg 에 위임하고 여기서는
'무엇을 받을지'와 '받은 결과가 영상과 맞는지'만 책임진다.

자막이 플레이리스트 밖 별도 파일로 놓인 경우(sidecar)는 트랙 목록에 나타나지
않아 위 경로로는 발견되지 않는다. 그쪽은 URL 을 조립해 직접 받되, 받은 뒤의
검증은 같은 함수(measure)를 쓴다 — 출처가 달라도 '영상과 맞는가'의 기준은 하나다.
"""
```

**"이 매핑을 잘못 적용하면 자막 전체가 일정량 밀리므로"** — 위임 경계 선언 바로 앞에
그 경계를 모를 때 무엇이 깨지는지를 적었다. 이것이 이 교재가 권하는 서술 형식이다
(제0장 §0.5-3).

### 30.8.4 위임 경계는 인터페이스가 아니라 계약이다

마지막 일반화다. 인터페이스는 **호출 가능한 것**의 목록이고, 위임 경계는 **책임의
분할선**이다. 둘은 일치하지 않는다.

| | 인터페이스 | 위임 경계 |
|---|---|---|
| 무엇을 정의하는가 | 시그니처·인자·반환 | 누가 어떤 결과를 보증하는가 |
| 어디에 적혀 있는가 | 코드·타입·API 문서 | 대개 **어디에도 없다** |
| 어기면 | 컴파일·호출이 실패한다 | **조용히 틀린다** |
| 검사 방법 | 타입 검사기·린터 | 결함 주입·회귀 테스트 |

클라우드 업계는 이 분할선에 이름을 붙여 놓았다.

> **용어** — **공유 책임 모델(shared responsibility model)**: 제공자와 이용자가 각각
> 어느 계층의 보안·가용성을 책임지는지 명시한 표. "제공자는 인프라의 보안, 이용자는
> 인프라 **안**의 보안"이 전형적인 분할이다.

라이브러리에는 이런 표가 거의 없다. 그래서 위임자가 직접 만들어야 한다. **§30.8.3
의 세 열 표가 라이브러리판 공유 책임 모델이다.**

---

## 30.9 보안 — 의존성의 정책이 곧 이쪽의 동작

### 30.9.1 신뢰 경계와 위임 경계는 다르다

> **용어** — **신뢰 경계(trust boundary)**: 데이터나 제어권이 신뢰 수준이 다른 영역
> 사이를 넘어가는 지점. 넘어오는 값은 검증해야 한다.

두 경계를 겹쳐 놓으면 이 도구의 구조가 보인다.

| | 신뢰 경계 | 위임 경계 |
|---|---|---|
| 무엇을 가르는가 | 믿을 수 있는 데이터 / 없는 데이터 | 내가 하는 일 / 남이 하는 일 |
| 이 도구에서 | 원격 서버가 보낸 모든 것(플레이리스트·헤더·세그먼트) | ffmpeg / hlsrecon |
| 넘어올 때 해야 할 일 | 검증한다 | **무엇을 안 해 주는지 안다** |

**위임한다고 신뢰가 이전되지 않는다.** ffmpeg 에 플레이리스트를 넘겨도 그
플레이리스트는 여전히 원격 서버가 쓴 신뢰할 수 없는 입력이고, 이제는 **이쪽이 아니라
ffmpeg 이 그것을 파싱한다.** 제15장이 다룬 CVE-2023-6602 가 정확히 그 지점이다 —
공격자가 통제하는 텍스트 한 장이 수임자의 파서 수백 개 중 하나를 고른다.

즉 위임은 신뢰 경계를 **없애지 않고 옮긴다.** 옮긴 곳의 방어 상태는 이쪽이 정하지
않는다.

### 30.9.2 상류의 정책 변경이 이쪽의 동작 변경이다

제14장 §14.8 이 한계로 적어 둔 항목을 여기서 원리로 승격한다.

> FFmpeg 이 기본 허용 목록에서 `.html` 을 빼면 현재 동작이 바뀐다.

방향은 둘 다 가능하고, 둘 다 문제가 된다.

| 상류의 변경 | 이쪽에 나타나는 증상 | 성격 |
|---|---|---|
| 확장자 허용 목록에서 `.html` 제거(보안 강화) | 지금 되던 스트림이 갑자기 열리지 않는다 | **보안 강화가 기능을 깬다** |
| 자막 단독 입력에서 `X-TIMESTAMP-MAP` 적용 시작(개선) | 이쪽 보정이 **이중 적용**되어 자막이 반대로 밀린다 | **개선이 결함을 만든다** |
| 옵션 이름·적용 범위 변경 | `Option … not found` 로 열기 실패 | 인터페이스 변경 |
| 오류 메시지 문구 변경 | 진단 문자열 매칭이 어긋난다 | 관측 경로 파손 |

둘째 행이 이 장에서 가장 불편한 항목이다. **수임자가 침묵 영역을 채우기 시작하면,
그 영역을 대신 메워 두었던 위임자의 코드가 결함으로 바뀐다.** 위임 경계는 고정된
선이 아니라 **버전마다 움직이는 선**이다.

> **용어** — **Hyrum의 법칙(Hyrum's Law)**: 어떤 API 든 이용자가 충분히 많으면
> 명세에 적힌 것과 무관하게 **관측 가능한 모든 동작**에 누군가 의존하게 된다. 여기서는
> "ffmpeg 이 매핑을 적용하지 **않는다**"는 관측 동작에 이쪽 보정 코드가 의존한다.

### 30.9.3 그래서 회귀로 고정한다

경계가 움직인다면, 움직였을 때 **알려주는 장치**가 필요하다. 이 저장소의 방식은
회귀 테스트다.

| 고정한 사실 | 테스트 | 상류가 바뀌면 |
|---|---|---|
| 위임만으로는 자막이 밀린다 | `tests/run.sh:492-498` 어긋난 자막 트랙이 FAIL·exit 2 | 통과 여부가 바뀌어 드러난다 |
| 위임만으로는 중복 큐가 남는다 | `tests/run.sh:225-227` 6큐 고정 | 숫자가 어긋나 드러난다 |
| 위임만으로는 조각 헤더가 남는다 | `tests/run.sh:228-229` 본문에 `WEBVTT` 없음 | 정제가 빠지면 즉시 실패 |
| 완성 파일은 통과시키지 않는다 | `tests/run.sh:272-274` 바이트 동일성 | 리팩터링 즉시 실패 |
| **ffmpeg 단독은 결손을 놓친다** | `tests/run.sh:512-522` 대조군 | 노란 점으로 알려준다 |

마지막 항목이 제36장의 주제이고, 이 장의 관점에서 다시 읽을 값어치가 있다.

```bash
# tests/run.sh:513-519
head_ "[4/4] 대조군 — ffmpeg 단독은 결손을 놓친다"
set +e
ffmpeg -v error -y -i "$BASE/damaged/index.m3u8" -c copy "$WORK/out/naive.mp4" >/dev/null 2>&1
naive=$?
set -e
if [[ $naive -eq 0 ]]; then
  ok "ffmpeg 단독 exit 0 — 결손을 보고하지 않음 (도구가 필요한 이유)"
```

이 일곱 줄이 검사하는 것은 이 저장소의 코드가 아니다. **수임자의 침묵을 검사한다.**
"ffmpeg 은 이 결손을 보고하지 않는다"는 사실 자체를 테스트로 못박아 두었고, 상류가
언젠가 보고하기 시작하면 이 항목이 노란 점으로 바뀌어 알려준다.

> **위임 경계를 문서에만 적으면 낡는다. 테스트로 적으면 낡을 때 알려준다.**

### 30.9.4 방어자·설계자 관점

| 역할 | 해야 할 일 |
|---|---|
| **라이브러리 이용자** | 의존성 문서에서 "할 수 있는 것"만 읽지 말고 **"이 입력 구성에서는 하지 않는 것"**을 찾는다. 찾지 못하면 실험해서 알아낸다 — §30.4.4·§30.5.2 의 형태로 |
| **라이브러리 관리자** | 하지 않는 일을 **문서에 명시**하고, 가능하면 **로그로 말한다.** "이 입력에는 X 를 적용하지 않았다"는 한 줄이 이용자의 침묵 영역을 거절 영역으로 바꾼다 |
| **보안 검토자** | 위임 경계를 위협 모델 다이어그램의 **신뢰 경계와 함께** 그린다. 파싱을 어디로 넘겼는지가 곧 공격면이 어디로 옮겨갔는지다(제15장) |
| **의존성 업그레이드 담당** | 릴리스 노트에서 "버그 수정"이 이쪽의 우회 코드를 무효화하는지 본다. **개선이 이중 적용을 만들 수 있다**(§30.9.2 둘째 행) |
| **감사자** | "이 부분은 라이브러리가 처리한다"는 서술을 볼 때 **어느 입력 구성에서 그러한지** 묻는다. 입력이 바뀌면 답이 바뀐다(§30.2.4) |
| **아키텍트** | 위임 경계를 §30.8.3 의 세 열로 적고, 각 행에 **그 경계를 고정하는 테스트**를 매단다 |

### 30.9.5 공급망 관점 — 경계가 없으면 영향 범위를 못 낸다

> **용어** — **소프트웨어 공급망(software supply chain)**: 최종 산출물에 들어가는
> 모든 의존성과 그 의존성이 만들어지고 배포되는 경로 전체.

취약점 공지가 나왔을 때 첫 질문은 언제나 같다 — **"우리가 영향을 받는가."** 이
질문에 답하려면 세 가지를 알아야 한다.

1. 그 의존성을 **쓰는가**
2. 취약한 **기능 경로**를 쓰는가
3. 그 경로에 **신뢰할 수 없는 입력**이 도달하는가

1번은 자동으로 답할 수 있다(의존성 목록). **2·3번은 위임 경계 문서가 없으면 답할 수
없다.** 이 저장소가 §30.6.2 처럼 위임 지점을 한 함수로 모아 둔 것이, 보안 관점에서
보면 "어떤 조건으로 무엇을 넘기는지"를 한 곳에서 답할 수 있게 만든 것이다.

반대로 위임이 열 군데에 흩어져 있고 각 지점의 인자가 제각각이면, CVE 공지 하나에
대해 **전수 조사를 다시 해야 한다.** 그리고 급할 때 하는 전수 조사는 빠뜨린다.

---

## 30.10 한계와 미해결

정직하게 적어 둔다.

- **ffmpeg 소스를 읽어 확인하지 않았다.** §30.2.4 의 근거는 두 가지 — 마스터 입력에서
  `MPEGTS` 를 60초 옮겨도 출력이 같다는 **행동 관측**과, `libavformat` 바이너리에
  `X-TIMESTAMP-MAP` 문자열이 없다는 **정황 증거**다. 후자는 문자열 상수를 쓰지 않는
  구현(문자 단위 비교, 매크로 조립)을 배제하지 못한다. 소스를 읽으면 더 강한 근거가
  된다. 다만 어느 쪽이든 **"영상 축이 없어서"라는 원래 설명은 반증됐다** — 영상 축이
  있는 구성에서도 적용되지 않았기 때문이다.

- **이중 적용을 감지하는 검사가 없다.** §30.9.2 둘째 행의 위험은 실재한다.
  `timestamp_offset` 은 자막 조각의 헤더와 영상 첫 PTS 만 보고 오프셋을 계산하므로([`subtitles.py:191-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L191-L218)),
  **ffmpeg 이 매핑을 적용하기 시작해도 같은 값을 낸다.** 그러면 보정이 두 번 걸린다.
  사후 검사([`report.py:421-460`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L421-L460) 자막 타임라인)가 "영상 범위를 벗어남"으로 잡을
  가능성은 있지만, 그것은 **증상**이지 원인이 아니고, 오프셋이 작으면 범위 안에
  머물러 잡히지 않는다. 이 저장소에 원인을 짚어 주는 검사는 없다.

- **`--sub-embed` 경로에는 `dedupe` 가 걸리지 않는다.** 코드 경로를 전수 확인한
  결과 `dedupe`(와 그 안에서 부르는 `_clean_body`)의 호출 지점은 `subtitles.extract` 한 곳뿐이고
  ([`subtitles.py:158`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L158)), 자막을 컨테이너에 내장하는 경로는 [`cli.py:610`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L610) 의
  `not args.sub_embed` 조건 때문에 그 함수를 지나지 않는다. 내장 경로는
  `embed_args` 가 만든 인자로 ffmpeg 이 직접 먹싱하며, 정렬만 `-itsoffset` 으로
  넘긴다([`subtitles.py:361-365`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L361-L365)).

  §30.4.4 와 같은 조건으로 내장 산출물을 실측한 결과는 다음과 같다.

  ```bash
  $ ffmpeg -v error -y -i vid.mp4 -i subko/index.m3u8 \
      -map 0 -map 1:s:0 -c copy -c:s srt embed.mkv
  $ ffprobe -v error -select_streams s:0 -show_entries packet=pts_time \
      -of csv=p=0 embed.mkv | grep -c .
  9                      # 고유 6큐인데 자막 패킷은 9개
  ```

  되뽑아 보면 본문에 흡수된 `WEBVTT` / `X-TIMESTAMP-MAP=` 줄도 그대로 남아 있다.
  **즉 이 저장소 자신이 한 경로에서 위임 경계를 다 메우지 못하고 있다.** 회귀
  테스트의 내장 항목은 트랙 수와 언어 메타데이터만 확인하고 큐 수는 세지 않는다
  (`tests/run.sh:238-244`) — 제37장이 다루는 "양방향 고정"이 이 항목에는 적용되지
  않은 셈이다. 이 장의 원리를 이 장의 저장소에 적용한 결과이므로 그대로 남긴다.

- **§30.4.4·§30.5.2 의 실측은 한 환경이다.** ffmpeg 8.1.1 / macOS arm64 / Homebrew
  빌드에서 잰 값이다. 다른 버전·빌드에서 같은 결과가 나오는지는 확인하지 않았다.
  특히 `-progress` 필드 목록은 버전에 따라 늘어날 수 있다.

- **"침묵 / 거절 / 미구현 신고"의 3분류는 이 교재의 정리다.** 널리 쓰이는 표준
  분류가 아니다. 실무에서 통용되는 이름을 발견하면 그쪽으로 바꾸는 것이 옳다.

- **위임 경계 목록이 한 곳에 모여 있지 않다.** §30.8.3 의 표는 이 장을 쓰면서
  여러 모듈의 독스트링에서 모은 것이고, 저장소 안에 그런 문서는 없다. §30.8.3 이
  권하는 형식을 이 저장소 자신은 아직 갖추지 않았다.

---

## 30.11 요약

1. **위임은 능력만 넘겨받는 결정이 아니다.** 능력·**제약**·**침묵** 세 가지가 함께
   넘어온다. 문서는 대개 능력만 설명한다.
2. **침묵은 오류로 나타나지 않는다.** 거절(오류 발생)과 미구현 신고(로그)는 위임자가
   알 수 있지만, 수임자가 자기 일로 여긴 적 없는 일은 성공 코드와 정상 형식의
   산출물 뒤에 숨는다. 자막이 60초 밀려도 exit 0 이 나온다.
3. **침묵에 붙인 이유는 검증되지 않은 채 굳는다.** "영상 축이 없어서 적용하지 않는다"는
   설명은 그럴듯했고 코드 주석에까지 들어가 있었지만, 마스터 입력 실험에서 반증됐다
   (§30.2.4). 옳은 결정이 틀린 이유 위에 서 있어도 아무 일이 일어나지 않는다.
4. **실측으로 확인했다.** 조각 이어붙이기를 ffmpeg 에 맡기면 exit 0 과 함께 고유
   6큐가 **9큐**로, 그중 **4큐**의 본문에 조각 헤더가 섞여 나온다. 이 셋에 대해
   수임자는 아무 말도 하지 않는다.
5. **필요 없는 위임은 손실만 만든다.** 완성된 자막 파일을 ffmpeg 에 한 번
   통과시키면 BOM 과 CRLF 를 잃고(119→110 바이트) 얻는 것은 없다. "이미 의존하고
   있으니 일관되게"는 위임의 근거가 아니다.
6. **위임은 정책도 상속한다**(제14장의 일반화). `remux` 모드는 ffmpeg 의 확장자
   허용 정책을 물려받아, **LIVE + 위장 확장자** 조합에서만 실패한다 — 재현 곤란은
   경계를 넘는 조건이 코드가 아니라 입력에 있기 때문이다.
7. **위임하면 계측을 잃는다.** `-progress` 가 내보내는 12개 필드는 전부 출력 쪽
   지표이고 HTTP 상태·TTFB·회선 바이트는 하나도 없다. 다만 **산출물에 대한 사후
   검사는 잃지 않는다** — 관측 지점을 산출물 쪽으로 옮기면 대가를 줄일 수 있다.
8. **위임 경계는 인터페이스가 아니라 계약이다.** 인터페이스를 어기면 호출이
   실패하지만, 위임 경계를 오해하면 조용히 틀린다. 그러므로 세 열(맡긴 것 / 직접
   한 것 / **맡긴 쪽이 하지 않는 일**)로 적고 회귀로 고정해야 한다.
9. **경계는 버전마다 움직인다.** 상류의 보안 강화가 이쪽 기능을 깨고, 상류의 개선이
   이쪽 보정을 이중 적용으로 바꾼다. **문서에만 적은 경계는 낡고, 테스트로 적은
   경계는 낡을 때 알려준다.**

---

**다음 장** — 제6부는 시간축을 맞추는 문제로 시작해 "누가 무엇을 맞추기로 되어
있는가"라는 책임의 문제로 끝났다. 제7부는 좌표를 바꾼다. 시간이 아니라 **이름**이
문제가 되는 영역이다. 눈에 똑같이 보이는 두 문자열이 파일 시스템에서는 다른 두
폴더가 되고, 그 어긋남 역시 아무 오류도 내지 않는다. 제31장은 유니코드 정규화가
만드는 그 조용한 분기를 다룬다.
