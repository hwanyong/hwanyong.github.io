---
title: "33-Bit Wrapping and Untrusted Input"
description: "Without a range check the computation is quietly wrong"
date: 2026-07-23
version: '1.0'
tags: ['streaming', 'distributed-systems']
thumbnail: /images/lecture/thumb/hls-recon-28-33bit-wrap.svg
---
## 28.0 What this chapter answers

1. How many hours does a 33-bit unsigned clock hold — and what happens at its end?
2. When meeting a negative MPEGTS, why **give up** instead of computing?
3. How far does this code's range check go, and from where is it absent?
4. In a stream exceeding 26.5 hours, what does this computation become?

Reduced to one line it is this. **How far to trust one integer that came from a remote.**

---

## 28.1 The problem — arithmetic has no concept of rejection

Chapter 27 derived the formula joining the subtitle time and the video clock. Write only the result again.

```
offset = mpegts / 90000 − video_pts0 − local_sec
```

Split the **sources** of the three terms in this formula and this chapter's problem is revealed at once.

| Term | Source | Trust grade |
|---|---|---|
| `mpegts` | the subtitle piece header's `X-TIMESTAMP-MAP=…,MPEGTS:<integer>` — **text a remote server sent** | untrusted |
| `local_sec` | the same header's `LOCAL:<time>` — **text a remote server sent** | untrusted |
| `video_pts0` | the value read with `ffprobe` from the received video first segment ([`probe.py:236-255`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L236-L255)) | local measurement |

Two of the three are strings the server gives. And this formula's result is immediately used to fix the file —
`shift()` **shifts every cue time of the subtitle file by that much** ([`subtitles.py:221-245`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L221-L245)). That is, **one number
that came from a remote sets the position of the whole subtitle.**

Here one property of arithmetic must be made clear.

> **Division and subtraction do not reject input.** Whatever number you put in, a result comes out. Even if the
> value is outside spec, even if it has no meaning, even if the sign is flipped, one real number comes out.

A parser can say "this is not a number." A computation cannot say so. So **if you do not put a check between
parsing and computation, an out-of-spec value flows just as smoothly as an in-spec value and makes a result.**
This chapter is about the three lines of code placed in that gap.

> **Term** — **bounds check**: confirming, before the computation, that a value is within the range allowed for
> that value. It differs from parsing, which sees whether the value's *form* is right, and from type checking,
> which sees whether the value's *type* is right. `-1` is an integer and an `int`, but is outside the range of a
> 33-bit unsigned value.

---

## 28.2 The principle — the time 33 bits holds

### 28.2.1 What the spec set

> **Term** — **PTS (Presentation Time Stamp)**: the time to put a decoded frame out on screen. In MPEG-TS it is a
> **33-bit unsigned integer** on the 90kHz mark (ISO/IEC 13818-1). The `MPEGTS:` value the subtitle's
> `X-TIMESTAMP-MAP` points at is also a value of the same mark·same width.

Where the 33 bits came from was covered in Chapter 21 §21.2.3 — the minimum width holding "a broadcast day +
margin" on the 90kHz mark is 33 bits. What is needed here is the **exact boundary** that decision made.

| Item | Value |
|---|---|
| number of representable values | 2³³ = 8,589,934,592 |
| max value | 2³³ − 1 = 8,589,934,591 tick |
| the max value in seconds | 8,589,934,591 ÷ 90,000 = **95,443.717678 seconds** |
| the same value in h:m:s | **26 hours 30 minutes 43.72 seconds** |
| wrapping period (0 to 0) | 2³³ ÷ 90,000 = 95,443.717689 seconds ≈ **26.5121 hours** ≈ 1.1047 days |
| one tick | 1 ÷ 90,000 = about 11.11 microseconds |

This table has no measurement. 90,000 and 2³³ are both fixed constants the spec set, so the table's values are
**arithmetic**, with no approximation other than rounding below the shown digits. The constant corresponding to
the denominator is in one place in the code.

```python
# subtitles.py:188
MPEGTS_HZ = 90000  # MPEG-TS system clock
```

### 28.2.2 Two things that follow

**(1) A negative cannot exist.** Being a 33-bit *unsigned* value, by spec `MPEGTS:`'s codomain is `0 …
8,589,934,591`. If a negative is written, it is not "a slightly wrong value" but **a signal that the computation
of the side that made that header is already broken.** So the right reaction is not to rewrite the value but to
**distrust the whole mapping.**

**(2) The value cycles.** It returns to 0 every 26.5 hours. A cycling value is **not monotonically increasing**,
and if not monotonically increasing, the subtraction of two values does not mean the difference of two times.
This is §28.5's subject.

> **Term** — **wrap-around**: a counter returning to 0 at the end of its representable range. A 33-bit 90kHz clock
> wraps about every 26.5 hours. It is the same phenomenon as Chapter 18's 4-bit continuity counter (0–15 cycle),
> differing only in width.

---

## 28.3 The code — one check line and its reason

### 28.3.1 The full function

```python
# subtitles.py:191-218
def timestamp_offset(first_segment: bytes, video_pts0: float) -> float | None:
    """Compute the alignment offset (seconds) from the subtitle piece's X-TIMESTAMP-MAP and the video first PTS.

    X-TIMESTAMP-MAP=LOCAL:<subtitle time>,MPEGTS:<90kHz clock> is a correspondence table saying 'this
    subtitle time corresponds to this clock value on the video timeline'. ffmpeg 8.1.1 does not apply
    this mapping regardless of the input configuration (measured: opening via a master input, the result
    with MPEGTS changed is the same), so compute and correct directly. Nonzero means the subtitle is slipped that much.
    """
    head = first_segment[:2048].decode("utf-8", errors="replace")
    m = _TSMAP_RE.search(head)
    if not m:
        return None
    raw = m.group("mpegts")
    try:
        mpegts = int(raw)
    except ValueError:
        return None
    # a 33-bit unsigned value is the spec so a negative is invalid — do not trust the mapping itself.
    if mpegts < 0:
        return None

    local = m.group("local")
    parts = [float(p) for p in local.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    local_sec = parts[0] * 3600 + parts[1] * 60 + parts[2]

    return (mpegts / MPEGTS_HZ) - video_pts0 - local_sec
```

This function has **only one channel to express failure** — `None`. And that channel is used three times (no
mapping · integer conversion failure · negative). The three cases call the same result.

```python
# cli.py:283-286
        off = subtitles.timestamp_offset(first.body, pts0)
        if off is None:
            continue
        offsets[track.uri] = off
```

`continue` — that track **does not even go onto the offset table.** A track with no offset receives 0.0 in
`extract()` via `(offsets or {}).get(track.uri or "", 0.0)` ([`subtitles.py:159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L159)), and `shift()` returns
immediately at `abs(seconds) < 0.001` ([`subtitles.py:223-224`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L223-L224)). **It does not move a single character.**

### 28.3.2 Why give up instead of computing

Put in what actually happens if you just compute the negative, and the basis for this choice shows. Below are
values obtained by calling the function and `shift()` directly (the video first PTS is the 128,090 tick =
1.423222 seconds of `plain/seg000.ts` measured in Chapter 21 §21.3.1).

| `MPEGTS:` value | Meaning | Current code | Had there been no check |
|---|---|---|---|
| `128090` | same as the video first PTS | `0.0` — no correction | same |
| `5528090` | +60 seconds off | `+60.0` — 60-second shift | same |
| `-5271910` | −60 seconds worth (out of spec) | **`None`** — give up correction | `−60.0` → every cue 60 seconds forward |
| `-1` | an obvious error value | **`None`** — give up correction | `−1.4232` → the whole thing 1.4 seconds forward |

The third row's "had there been no check" column is this section's core. `shift()` cuts a negative time to 0.

```python
# subtitles.py:226-227
    def fmt_time(total: float) -> str:
        total = max(0.0, total)
```

So apply a −60-second correction for real and every cue within 60 seconds **bunches at `00:00:00.000`.** The
result confirmed directly with a file placing two cues at 10–14 and 20–24 seconds.

```
$ python3 -c "
from hlsrecon.subtitles import shift
from pathlib import Path
p = Path('t.vtt')
shift(p, 'vtt', -60.0)
print(p.read_text())"
WEBVTT

00:00:00.000 --> 00:00:00.000
A

00:00:00.000 --> 00:00:00.000
B
```

The file looks fine. The cue count is the same, the format is valid, and put into a player it opens. **What is
wrong is only the content.** This is the worst side of the failure grades this course repeatedly speaks of.

> **Better not to correct than to compute with a wrong value and put out a quietly slipped subtitle.**

An uncorrected subtitle is still off on a stream that actually needed `X-TIMESTAMP-MAP`. But that off-ness is **a
kind a downstream check can catch** — if the subtitle time strays out of the video range, [`report.py:431-451`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L431-L451)
gives a FAIL. Conversely the −60-second correction in the table above drives the cues to 0 seconds, keeping them
**inside the video range**, so it passes that check.

That is, the difference of the two choices is not "right or wrong" but **"whether it is observed when wrong."**
Give up the computation and the error stays in a form visible downstream; compute wrong and the error changes to a
form invisible downstream.

This attitude is of the same lineage as Chapter 38's **verdict withheld.** Only the layer differs.

| | Chapter 38 — verdict withheld | This chapter — correction given up |
|---|---|---|
| What is deferred | the **verdict** (PASS/FAIL) | the **action** (file modification) |
| Basis | the baseline does not hold | the input is out of spec |
| Why the alternative is bad | disguising unknown as passing | disguising a wrong result as normal |
| What remains | the "verdict withheld" sentence | the original times as-is |

### 28.3.3 Why the regex admits a minus

To check a negative you must first be able to **read** the negative. So the regex takes the sign.

```python
# subtitles.py:184-188
_TSMAP_RE = re.compile(
    r"X-TIMESTAMP-MAP\s*=\s*(?=.*LOCAL:(?P<local>[\d:.]+))(?=.*MPEGTS:(?P<mpegts>-?\d+))",
    re.IGNORECASE,
)
MPEGTS_HZ = 90000  # MPEG-TS system clock
```

What happens if you remove `-?`. `MPEGTS:-14271910` **fails to match at all** and the function returns the same
`None`. The result is the same. And yet the reason keeping the sign is right is that **the same return value does
not mean the same thing.**

| Case | Without `-?` | With `-?` |
|---|---|---|
| there is no mapping in the header | match fail → `None` | match fail → `None` |
| there is a mapping and it is negative | match fail → `None` | match success → **explicit rejection** → `None` |

In the left column "a stream with no mapping" and "a stream with a broken mapping" are **indistinguishable** in
the code. In the right column they are distinguishable — now both end quietly with `continue`, but when you want
to leave a warning or record it in statistics, the spot to touch is already open. Half the worth of writing the
check explicitly is here. **Being incidentally rejected and being checked-and-rejected are the same now and
different later.**

This contrast is physically present within the same function. The `LOCAL:` side's character class is `[\d:.]+`
so it cannot take the sign.

```
LOCAL:-00:00:01.000,MPEGTS:900000   →  None   (match fail — incidental rejection)
```

`LOCAL`'s negative time is also out of spec and actually rejected, but the code rejecting it is nowhere. **The
character class is blocking it instead.** Using the name given in Chapter 15 as-is, it is an **incidental
defense** — the day someone puts `-` into the character class to widen the time format, this defense vanishes
without a sound.

### 28.3.4 The boundary of what is admitted as a value

Before the range check there is first **what will be admitted as a value.** The result measured by putting into
the actual parser (`local` is `00:00:00.000`, `video_pts0` is 0).

| The value written in the header | The part the regex catches | Return | Evaluation |
|---|---|---|---|
| `900000` | `900000` | `10.0` | normal |
| `-900000` | `-900000` | `None` | **explicit rejection** |
| `+900000` | (match fail) | `None` | incidental rejection — `-?` does not take `+` |
| a space + `900000` after `MPEGTS:` | (match fail) | `None` | incidental rejection — does not allow a space after the colon |
| `900000.0` | `900000` | `10.0` | **partial match** — discards below the decimal |
| `9_000` | `9` | `0.0001` | **partial match** — the value shrinks to 1/1,000 |
| `0x1` | `0` | `0.0` | **partial match** — read as 0 |
| `１２３４５６` (fullwidth) | `１２３４５６` | `1.3717` | `\d` takes Unicode decimal digits |

The table's lower four rows are the point.

> **A partial match is not a rejection.** If the regex does not fix the value's end (no boundary condition after
> `\d+`), even a strange value is read as **a plausible small value.**

`9_000` becoming `0.0001 second` is especially bad. Neither rejected nor greatly wrong, it becomes an **offset in
the near-0 normal range** and is indistinguishable from "there was nothing to correct." The value harder to handle
than an obvious error value like `-900000` is always this kind.

Unicode digit matching is of the same lineage. `\d` takes not ASCII `0-9` but the whole Unicode decimal-digit
category (Nd), and Python's `int()` also accepts the same category, so a fullwidth digit becomes a value as-is.
The actual risk on this stream was not confirmed, but the principle **if ASCII is intended, write `[0-9]`** holds
as-is. A character class is itself part of the trust boundary (Chapter 33).

---

## 28.4 A half range check — there is no upper bound

The comment reads "a 33-bit unsigned value is the spec." And yet what the code checks is only `mpegts < 0`. **It
does not check the upper end.**

![The three regions of the MPEGTS value and the gates](/images/lecture/hls-recon/28-half-range-check.svg)

*Figure 28-1 — the range check is on only one side. The lower bound is explicitly blocked, the upper bound is open*

The result confirmed by measurement.

| `MPEGTS:` value | Within spec | Return |
|---|---|---|
| `8589934591` (2³³ − 1, the max legal value) | yes | `+95,442.294` |
| `8589934592` (2³³, out of spec) | **no** | `+95,442.294` |
| `99999999999999999999` (20 digits) | **no** | `+1.11e+15` |

Even exceeding 2³³ it is computed as-is. Here let us split into three.

### 28.4.1 Ending ① — a 26.5-hour offset

A value near 2³³ makes an offset corresponding to 26.5 hours. Shift the subtitle by that value and the cues go
much further back than the video length, and a downstream check necessarily reacts.

```python
# report.py:431-433
            elif good and video_len > 0:
                strayed = [r for r in good if r.last_cue > video_len + 5.0 or r.first_cue < -0.5]
                if strayed:
```

On a 30-second video, if the subtitle goes into the 90,000-second range, `last_cue > video_len + 5.0` becomes
true and it is **FAIL.** That is, even without an upper-bound check, **this failure is not quiet.** It is a form
where what was not caught upstream is caught downstream, and the fact itself that there are two layers is a good
property (defense in depth).

Only, **being filtered and being caught are different.** Had it been rejected upstream, the report could have said
"could not trust the mapping so did not correct." Now it says "the subtitle strayed out of the video range." The
latter tells the user **a symptom, not a cause.**

### 28.4.2 Ending ② — at 314 digits an exception arises

Measure increasing the value's digit count and one more boundary appears.

| `MPEGTS:` digit count | Result |
|---|---|
| 300 digits | `1.1111e+295` (computed) |
| 313 digits | `1.1111e+308` (computed — just below the double-precision max) |
| **314 digits** | **`OverflowError: integer division result too large for a float`** |

Python integers are arbitrary precision so `int(raw)` succeeds however many digits. But on the last line, the
moment `mpegts / MPEGTS_HZ` tries to make the result a `float` (double-precision floating point, max about
1.8×10³⁰⁸), it fails. And this exception is not caught — the `try/except` wraps only `int()`, and the exception
type caught is `ValueError`.

```python
    try:
        mpegts = int(raw)
    except ValueError:
        return None
```

Neither the caller ([`cli.py:283`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L283)) nor `main()` ([`cli.py:1117-1128`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L1117-L1128)) has a spot to receive this exception. **One
subtitle piece ends the whole tool with a traceback.**

This is reproduced by putting values directly into the function, and I did not run end-to-end the situation of a
server actually sending such a header. But the reproduction condition is clear — if `MPEGTS:` and a number of 314
or more digits are within the first 2048 bytes of the first subtitle piece, it happens.

### 28.4.3 One incidental upper bound — the 2048-byte truncation

You cannot make the value infinitely large. Because the first line reading the header cuts the input.

```python
    head = first_segment[:2048].decode("utf-8", errors="replace")
```

This truncation is an **upper bound on length**, not on value. So it has two properties at once.

| Property | Content |
|---|---|
| What it blocks | it does **not reach** Python's integer-string-conversion limit (the `int()` `ValueError`) that arises past 4,300 digits. that many digits cannot fit in 2048 bytes |
| What it does not block | 314 digits fit amply → §28.4.2's `OverflowError` remains wide open |
| What is worse | if a number is cut at the 2048-byte boundary, **it is not rejected and only the leading digits become the value** — a value other than the one sent enters the computation |

The third row is exactly the same form as §28.3.4's "a partial match is not a rejection." The length limit is
safe, but **a length limit does not substitute for a value check.**

### 28.4.4 If you put in an upper bound

One line closes endings ①②.

```python
    if not 0 <= mpegts < 2**33:      # example — not the current code of this repository
        return None
```

Weigh putting it in against not, and write.

| | No upper bound (current) | With upper bound |
|---|---|---|
| a value ≥ 2³³ | compute → FAIL downstream (symptom reported) | reject → correction given up (cause reported) |
| a 314-digit value | **`OverflowError` — the tool dies** | reject |
| record of an out-of-spec value | none left | the rejection point gathers into one |
| what is lost | — | if there is a delivery accumulating wraps and sending a **wrap-free value ≥ 2³³**, that stream cannot receive correction |

The last row is inference. I have never observed such a delivery, and it is a spec violation so rejecting is
consistent, but **you cannot write the unobserved as if observed.** This course did not reflect this change in the
code. It writes only the fact — **the comment speaks of the 33-bit range, and the code checks only half of it.**

---

## 28.5 Beyond 26.5 hours — this code's unhandled limit

### 28.5.1 What subtraction loses

`offset = mpegts/90000 − video_pts0 − local_sec` is the **subtraction** of two times. For subtraction to mean the
difference of two times, the two values must be monotonically increasing coordinates measured from the same
origin. A 33-bit clock returns to 0 every 26.5 hours so that premise breaks.

![On a 33-bit clock the subtraction does not see the wrap](/images/lecture/hls-recon/28-wrap-difference.svg)

*Figure 28-2 — if the two values are in different cycles, the subtraction gives an answer 26.5 hours wrong*

I reproduced two scenarios by putting values directly into the function. They assume a state where the video has
run nearly 26.5 hours.

| Scenario | `video_pts0` | `MPEGTS:` | True value | Function's answer | Error |
|---|---|---|---|---|---|
| **A** — only the subtitle piece passed the wrap | 95,440.0 sec | `45000` (= 0.5 sec) | +4.22 sec | **−95,439.5 sec** | −95,443.72 sec |
| **B** — only the video passed the wrap | 0.5 sec | `8589600000` (= 95,440.0 sec) | −4.22 sec | **+95,439.5 sec** | +95,443.72 sec |

In both cases the error's absolute value is exactly the wrapping period (95,443.72 sec). **This is not a
coincidence but a definition** — since 2³³ was subtracted from only one value, the difference is off by
2³³/90,000.

### 28.5.2 The ending splits by direction

Since the error's size is 26.5 hours the result cannot be quiet. Only, **the report's grade differs by sign.**
Because of `shift()`'s 0 clamp seen earlier.

| Scenario | Correction amount | Times left in the subtitle file | Subtitle-timeline verdict | Basis |
|---|---|---|---|---|
| A (negative direction) | −95,439.5 sec | **every cue `00:00:00.000`** | **WARN** — "min coverage 0%" | [`report.py:452-460`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L452-L460) |
| B (positive direction) | +95,439.5 sec | 95,449.5 – 95,463.5 sec | **FAIL** — "track out of video range" | [`report.py:431-451`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L431-L451) |

The table's times were actually obtained by applying each correction amount to two cues placed at 10–14 and 20–24
seconds. The verdict grades were derived from the two verdict-code spots above — not confirmed by end-to-end
execution (§28.9).

An error from the same cause of the same size, yet one is FAIL and one is WARN. The reason A stops at WARN is that
the clamp **drags the value into the range the check sees.** The clamp keeps the file syntactically valid, but at
the same time **moves the error into the detector's blind spot.**

One more thing attaches here. [`report.py:432`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L432)'s `r.first_cue < -0.5` condition cannot hold on the separate-file
path — because `shift()` does not use a negative time, and the cue-time regex ([`subtitles.py:27-29`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L27-L29)) does not
read a sign either. Where that condition actually works is the container-embed path ([`report.py:358-366`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L358-L366)), and
there the time is re-read with `ffprobe` so a negative can arise. The embed path's behavior when it receives a
large negative in `-itsoffset` was not measured (§28.9).

### 28.5.3 What is needed to fix it

Written in one line it is this. **Detect the wrap by the difference from the previous value, and change the
subtraction to modular arithmetic.**

```
d = ((a − b + 2³²) mod 2³³) − 2³²
```

This formula returns the difference of two values to the smallest magnitude within the `[−2³², +2³²)` range, i.e.
within **±13.26 hours.** Apply it to scenario A and −95,439.5 + 95,443.72 = **+4.22 seconds** — the true value
comes out (confirmed by direct computation).

The holding condition is clear too.

| Condition | Content |
|---|---|
| valid range | correct only when the true offset's absolute value is **under 13.26 hours.** there is no way, from this info alone, to distinguish a real offset larger than that from a wrap |
| required state | when viewing pieces in sequence, you must hold the **previous value.** if the value jumps far back, view it as a wrap and raise an accumulation counter by one |
| why it is absent in this code | `timestamp_offset` is a stateless function seeing **only the first piece.** the very concept of a previous value does not exist |

The third row matters. Wrap handling is not a one-line check but **a change to the function's state model.** To
keep it a stateless function you must state the premise "does not handle a stream exceeding 26.5 hours," and to
handle it you must traverse the pieces carrying state.

### 28.5.4 Why it is not a problem now

| Basis | Content |
|---|---|
| target length | this tool's unit is one episode (tens of minutes). for a wrap to occur within one stream you need a timeline continuous for 26.5 hours or more |
| LIVE handling | a 24-hour continuous delivery is a LIVE with no `ENDLIST`, and this tool handles LIVE **only up to the snapshot moment** (`README.md:414`) |
| value's source | most VOD deliveries start the clock near 0 at encoding time — this is a common belief, not an observation, so it is written again in §28.9 |

Even so, this is an **unhandled limit, not a solved problem.** The README's "known limits" list
(`README.md:409-441`) has two sidecar-subtitle items (sidecar-subtitle alignment, sidecar-subtitle name) but no
wrapping. This chapter fills that spot.

---

## 28.6 What the test left as measurement — the check blocks the defect injection

The range check has one more side effect besides protecting the value. The regression test recorded it as
measurement.

```python
# tests/run.sh:84-92
CUES = {
    "subko":  [(i * 5, i * 5 + 4, f"한국어 자막 {i+1}번") for i in range(6)],
    "suben":  [(i * 5, i * 5 + 4, f"English subtitle line {i+1}") for i in range(6)],
    "subbad": [(i * 5, i * 5 + 4, f"어긋난 자막 {i+1}번") for i in range(6)],
}
# subbad sets the X-TIMESTAMP-MAP reference 60 seconds off so the subtitle strays out of the video range.
# must not make it negative — a negative is invalid for a 33-bit unsigned PTS so timestamp_offset returns
# None (subtitles.py:208-210), no correction is applied at all, and the defect is not injected.
OFFSET = {"subko": 0, "suben": 0, "subbad": 60 * 90000}
```

What the comment says is a record of a failure — **the defect was injected but the defect did not reproduce.** The
same property is in two places.

| Rejecting actor | Basis | Result |
|---|---|---|
| ffmpeg | the 33-bit unsigned spec (the test comment's measurement) | ignores the mapping → the subtitle comes out at its original time |
| this code ([`subtitles.py:209-210`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L209-L210)) | the same spec | `None` → skips correction |

Whichever rejects first, the ending is the same. The injected −60 seconds **reaches nowhere**, and the subtitle
stays at 0–29 seconds, inside the 30-second video range, and the check gives a PASS. A test that injected a defect
turns on a green light.

Here comes one general proposition.

> **Input validation reduces the attack surface and at the same time reduces the testability.** A value caught by
> a check cannot reach the code behind the check, so it cannot be used for a defect injection targeting that code.

So defect injection must be done **inside the detector's verdict rule, and with a value that passes the input
check.** Why exactly `+60 * 90000` — the basis for the size and the measurements of alternative values are in
Chapter 35 §35.4.6. This chapter's share is the step before that. **The reason the sign is decisive is this
chapter's 33-bit spec.**

---

## 28.7 Generalization — the three endings when there is no range check

When an untrusted value enters a computation without a check, the result is one of three.

| Ending | What happens | This chapter's case |
|---|---|---|
| **rejection** | the value falls outside the form itself and is caught at the parsing stage | `+900000`, `LOCAL:-00:00:01` (both incidental rejections) |
| **loudly wrong** | it computes but the result is absurd so a downstream check·exception reacts | ≥ 2³³ → downstream FAIL / 314 digits → `OverflowError` |
| **quietly wrong** | the computation gives a plausible value and no one reacts | `9_000` → 0.0001 sec / after a negative correction the 0-second clamp → WARN |

The third is the worst. And **the default when there is no range check is the third** — because the computation
always gives an answer, and that answer carries no mark saying "this value has no basis."

List where the same structure appears and it is this.

| Domain | The value entering the computation without a check | Result when quietly wrong |
|---|---|---|
| subtitle alignment (this chapter) | the 90kHz value of `X-TIMESTAMP-MAP` | the whole subtitle slips or bunches at 0 seconds |
| container parsing | ISO-BMFF's `box_size` (Chapter 20) | out-of-boundary reading, parser termination failure |
| decompression | the declared original size | memory exhaustion (Chapter 6's compression bomb) |
| pagination·range requests | `offset`, `limit`, `Range` header | another resource's bytes mix into the response |
| retry·timeout | the `Retry-After` the server gave | a negative·huge value turns into infinite wait or a runaway retry (Chapter 8) |
| sequence·counter | media sequence number, continuity counter (Chapter 18) | a comparison ignoring the cycle makes a normal stream an error, an error normal |

Fold into three principles.

1. **A type check is not a range check.** `-1` is an `int` and `2³³` is an `int` too. A type says only whether the
   value is *representable*, not whether it is *meaningful*. The domain's range must be written separately.
2. **Check once, at the trust boundary, at the spot where the value enters.** Check later and the already-computed
   value has spread everywhere. It is a rule of the same form as Chapter 7's "convert once at the boundary."
3. **The answer for a caught value is not `0` but "unknown."** Meet an out-of-spec value and replace it with 0 and
   that 0 is indistinguishable from "there was nothing to correct." That is why this code returns `None`, not
   `0.0` — **the type must be able to express "unknown."**

---

## 28.8 Security — when the same omission is in length·offset

### 28.8.1 Here the subtitle just slips

This chapter's result is a wrongly aligned subtitle file. A human seeing it notices, and a tool seeing it mostly
gives a FAIL. **The damage stays in the data's meaning.**

If the same omission is in a **length and offset** computation, the damage crosses into memory. It is a form
already seen in Chapter 20 §20.6.1 — add ISO-BMFF's `box_size` without a check and, as the declared length is
larger than the remaining bytes or the addition wraps, an **offset pointing outside the file boundary** is made.

The difference of the two cases is only the value's use.

| | This chapter (`MPEGTS`) | Chapter 20 (`box_size`) |
|---|---|---|
| Value's use | time offset | **byte offset·length** |
| Result of a check failure | a wrongly aligned subtitle | out-of-boundary read, infinite loop, over-allocation |
| Worst ending | false positive·false negative | **memory-safety violation** |

### 28.8.2 Signed/unsigned confusion

The very path by which a 33-bit unsigned value appears as a negative is itself one vulnerability type.

> **Term** — **signed/unsigned confusion**: a defect where an unsigned value is read as a signed integer type or
> vice versa, so a large positive is interpreted as a negative (or a negative as a huge positive). If this
> confusion happens before a length check, a check like `if (len > max)` passes as-is.

A negative written in `MPEGTS:` is usually a trace of this confusion — a 33-bit value held in a 32-bit signed
integer, or a subtraction result after passing a wrap printed as-is. So it becomes clear why the approach "just
flip the sign and use it" is wrong when meeting a negative. **The sign is not wrong; the computation that made
that value is already wrong.**

### 28.8.3 The language changes the ending

The ending differs by where the same omission is.

| Environment | An out-of-range integer operation | Mapped to this chapter's code |
|---|---|---|
| Python | integers are arbitrary precision — no overflow. instead an `OverflowError` at `float` conversion | the exception that actually arose in §28.4.2 |
| C/C++ | signed overflow is **undefined behavior (UB)**, an unsigned value wraps silently | an uncheck addition is an out-of-boundary access right away |
| Rust | a debug build panics on overflow, a release build turns off the check and wraps (state it with `wrapping_*` if you intend wrapping) | caught in tests and quietly wrong in the release |

It is not that this code is safe because it is Python. **It is only that being Python, the failure form tilted to
the dying side (an exception)**, and even that exception, if uncaught, remains an availability problem.

### 28.8.4 The defender's view

| Role | What to do |
|---|---|
| **client implementer** | check an integer from a remote **against the domain range** right after parsing. write the upper and lower bounds together — a check with only one side written **makes you mistake** the other half as present. this chapter's code is exactly that state |
| **parser author** | fix not only the value's start but its **end.** a partial match is not a rejection but a quiet misread. a character class is part of the trust boundary so write `[0-9]` if ASCII is intended |
| **delivery operator** | `X-TIMESTAMP-MAP` is the **basis on which a client moves the whole subtitle position.** if this value is wrong the whole accessibility track becomes unusable. you must confirm how the encoder uses this value after passing a wrap, and in a delivery continuous for 26.5 hours or more it is necessarily a verification target |
| **verification-tool author** | if a downstream check covers the absence of an upstream check, that is **luck, not design** (Chapter 15's incidental defense). without writing which layer is responsible for what, the moment you touch one layer the defense vanishes |
| **auditor** | when you see a comment reading "an N-bit unsigned value by spec," confirm **whether the code sees both ends.** the asymmetry of comment and code is itself a finding |

Finally, note one defense this code is already doing. The correction amount **is necessarily left as a record.**

```python
# cli.py:287-288
        if abs(off) >= 0.5:
            _eprint(f"    · {track.label()} X-TIMESTAMP-MAP-based {off:+.2f}s correction")
```

It also remains in the report JSON as `timestamp_offset_sec` — the separate-file path is [`report.py:492`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L492), the
container-embed path is [`report.py:375`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L375). **If the tool fixed the file it must say how much it fixed.** A tool
that fixes quietly is wrong quietly.

---

## 28.9 Limits and open questions

Written honestly.

- **A 26.5-hour stream was not actually made and verified.** §28.5's scenarios A·B are **function-level
  measurements** obtained by putting values directly into `timestamp_offset`. The end-to-end run (making an HLS
  with an actual 26.5-hour timeline and putting it into the tool) was not done.
- **Whether the `pts_time` `ffprobe` returns is already a wrap-corrected value was not confirmed.** FFmpeg has
  processing that recognizes 33-bit wrapping for MPEG-TS, so `probe.first_pts` might return a value exceeding 26.5
  hours or a negative. If so, §28.5's scenarios change shape. **It is inference and unverified.**
- **The `OverflowError` was not reproduced end-to-end.** §28.4.2 was obtained by calling the function directly.
  The situation of a server sending a 314-digit `MPEGTS:` was not flowed through the actual pipeline, so the
  possibility of failing first for a different reason somewhere in the middle remains.
- **The embed mode's (`-itsoffset`) negative·huge-value handling was not measured.** §28.5.2's table is for the
  separate-file path. How ffmpeg handles an out-of-range offset on the container-embed path (drops the cue, leaves
  a negative time) was not confirmed.
- **The frequency of actual CDNs sending values ≥ 2³³ or negatives was not observed.** What the test comment
  recorded is the result of an artificial injection "make it negative and ffmpeg ignores it," not an observation
  that such a value comes out of a wild delivery.
- **§28.5.4's statement "most VOD deliveries start the clock near 0" is a common belief.** Only that the first PTS
  is 128,090 tick (1.42 seconds) in this repository's test stream is measured. The distribution of actual
  deliveries was not surveyed.
- **The real risk of Unicode digit matching was not confirmed.** That a fullwidth digit is read as a value was
  measured, but a path by which that becomes something was not found.

---

## 28.10 Summary

1. MPEG-TS's PTS is a **33-bit unsigned value** (ISO/IEC 13818-1). Divide the max value 2³³−1 = 8,589,934,591 tick
   by 90kHz and it is **95,443.717678 seconds = 26 hours 30 minutes 43.72 seconds**, and after that it wraps to 0
   (wrapping period about 26.5121 hours).
2. Two things follow. **A negative is invalid by spec** so the mapping itself must be distrusted, and since the
   value **cycles** a region arises where subtraction does not mean the difference of two times.
3. [`subtitles.py:209-210`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L209-L210) returns `None` on meeting a negative and **gives up correction.** Better than
   computing with a wrong value and putting out a quietly slipped subtitle — give up the computation and the error
   stays in a **visible form** downstream, compute wrong and it catches on the clamp and moves into the check's
   blind spot. It is the same attitude as Chapter 38's verdict withheld.
4. But **the range check is half.** With no upper bound, a value ≥ 2³³ is computed as-is, and at a 314-digit value
   an uncaught `OverflowError` arises. The 2048-byte truncation is an upper bound on length only, not on value,
   and a number cut at the boundary is not rejected and **only its leading digits become the value.**
5. **In a stream exceeding 26.5 hours the offset computation breaks** — this code's unhandled limit. The error is
   exactly the wrapping period, and the grade splits as WARN in the negative direction and FAIL in the positive.
   To fix it you must detect the wrap by the difference from the previous value and change the subtraction to
   modular arithmetic (`((a−b+2³²) mod 2³³) − 2³²`), and that is changing a stateless function into a stateful
   traversal.
6. What the test left as measurement: **inject the defect as a negative and the defect does not reproduce.**
   Because ffmpeg and this code both discard the mapping on the basis of the spec. Input validation reduces, along
   with the attack surface, the **testability.**
7. Generalized, **the default ending when there is no range check is "quietly wrong."** Arithmetic does not reject
   input, so an out-of-spec value makes an answer just as smoothly as an in-spec value. If the same omission is in
   a **length·offset** computation and not a time, it becomes integer overflow and a memory-safety problem
   (Chapter 20).

---

**Next chapter** — this chapter asked whether one value the server sent can be trusted. Chapter 29 covers when the
server sends **the same thing twice.** The HLS spec permits putting a boundary-straddling subtitle cue on both
sides of adjacent segments, and actual deliveries go out that way too — the phenomenon of 6 cues becoming 9. The
subject is what face distributed systems' at-least-once delivery and idempotency take on in streaming, and what
the deduplication key should be set as.
