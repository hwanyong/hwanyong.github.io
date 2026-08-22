---
title: "Threshold Design"
description: "Three times the median, and false positives"
date: 2026-07-09
version: '1.0'
tags: ['streaming', 'binary']
thumbnail: /images/lecture/thumb/hls-recon-22-threshold-design.svg
---
## 22.0 What this chapter answers

1. If you chose the observation metric right, what is the next decision — **where does the threshold come from?**
2. What does each of the three constants in `max(0.4, median × 3)` block, and what does each fail to block?
3. **What breaks under a variable frame rate.** And can it be fixed by adjusting the threshold?
4. On what basis do this repository's other thresholds stand — which have none?

If Chapter 21 answered **what to observe**, this chapter answers **where to cut the observed value.** The two
questions differ in nature. The former has a right answer (the total length is wrong and the frame interval is
right), and the latter has **only a trade-off.**

---

## 22.1 The problem — one and the same line makes both false positives and false negatives

Changing the observation metric alone does not finish it. Look at the measurement first. The result of making
four kinds of file locally and running this repository's `gap_scan()` as-is with no arguments (reproduction
procedure in §22.5.2).

| File | Actual loss | Detected | Verdict | Correct |
|---|---|---|---|---|
| 30fps normal, 900 frames | none | 0 | PASS | correct |
| 30fps, one 6-second segment lost | 6.00s | 1 / 6.03s @ 5.99–12.02s | FAIL | correct |
| VFR normal, includes a still | **none** | 4 / 6.00s | FAIL | **false positive** |
| 60fps, 5 frames lost | 0.083s | 0 | PASS | **false negative** |

The first two rows are this check's reason for existing. In fact the first two files have a **container length
identical to the sixth decimal place.**

```
$ ffprobe -v error -show_entries format=duration -of csv=p=0 full.mp4 damaged.mp4
30.023401
30.023401
```

6 seconds vanished whole and the length is the same. The `length consistency` check ([`report.py:263-278`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L263-L278)) gives the
two files the same verdict — drift `+0.02s / 0.08%`, both PASS. Only the gap scan Chapter 21 introduced splits
these two.

And yet on the last two rows that gap scan is wrong. **An undamaged file gets a FAIL, and a file that really is
missing five frames gets a PASS.** The metric is the same and what changed is only the input's nature.

![One 400ms threshold line splits the four cases](/images/lecture/hls-recon/22-threshold-line.svg)

*Figure 22-1 — one 400ms threshold line splits the four cases*

> **Term** — **false positive (type I error)**: judging a defect-free target as defective.
> **false negative (type II error)**: judging a defective target as normal.
> A checker's performance can be described only by the pair of these two error rates. A performance figure
> reporting one side alone is not performance — an implementation that always gives FAIL has a 0% false-negative
> rate.

---

## 22.2 The principle — there is only one handle

### 22.2.1 The confusion matrix and the cost in this tool

| | Actually has loss | Actually has no loss |
|---|---|---|
| **FAIL verdict** | true positive — the reason the tool exists | **false positive** — makes a fine file get re-received |
| **PASS verdict** | **false negative** — a broken file passes as finished | true negative |

The two errors' costs are not equal.

| Error | Immediate cost | Delayed cost |
|---|---|---|
| false positive | one re-download, a person's confirmation time | **makes the tool get turned off** |
| false negative | none — nothing happens | the inventory registers that file as finished so the episode is missing forever (Chapter 37) |

That the false negative's immediate cost is 0 is the trap. **A false negative leaves no signal.** A false
positive is noisy and a false negative is quiet, so in real use the pressure is always only in the direction of
"make it less sensitive."

### 22.2.2 Monotonicity — the way to reduce both errors at once is not in the threshold

Raise the threshold τ and the detection count decreases monotonically. So false positives fall and false
negatives rise. Lower it and the opposite. Figure 22-1's caption means that — move the threshold right and the
third row's false positive vanishes but the second row becomes endangered, move it left and the fourth row is
caught but the third row worsens.

> **The only way to reduce both errors at once is not to move the threshold but to change the metric.** The
> threshold merely picks a spot between the two already-drawn distributions, and the width by which the
> distributions overlap is determined by the metric.

> **Term** — **separability**: the degree to which the metric distributions of the normal group and the abnormal
> group do not overlap. In the overlap region no threshold can make both errors 0 at once. The trajectory of
> (false-positive rate, true-positive rate) pairs obtained by moving the threshold is the **ROC curve**, and this
> trajectory does not rise unless you change the metric.

Chapter 21 discarding the total length and choosing the frame interval was **a decision that changed the metric
to raise separability.** What this chapter treats is the handle left after that, which can only be moved.

### 22.2.3 A false positive eventually becomes a false negative

Treating a false positive as "a cheaper error than a false negative" in a verification tool is wrong.

Repeat false positives and the user turns off the check. The moment the check is off, that check's false-negative
rate **becomes 100%.** That is, a false positive is not a cheaper error than a false negative but a **delayed
false negative.** In security operations this is called **alert fatigue.**

> **Term** — **alert fatigue**: the phenomenon where responders grow numb to a frequently-false-positive alert
> and eventually ignore even the real alert or disable the alert itself. It is the most common path by which a
> detection system fails, and the cause of failure is not detection ability but threshold design.

This repository acknowledged that switch in code — `--no-gap-scan` ([`cli.py:1067`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L1067)). §22.5.4 looks separately at
that design's worth and price.

---

## 22.3 The code — six steps, three constants

The verdict's entrance is the function signature. Two of the three constants are here.

```python
# probe.py:191-198
def gap_scan(path: str, factor: float = 3.0, floor: float = 0.4) -> GapScan:
    """Sweep the video track's presentation times to find loss stretches.

    A total-length comparison cannot catch a middle-segment loss. Because an MPEG-TS segment
    carries an absolute PTS (presentation time), so even if one piece is dropped the rear pieces'
    times stay as they were and the total length is unchanged. Loss appears not as a total but
    as a hole in the timeline, so look directly at the adjacent frame intervals.
    """
```

That `factor` and `floor` are exposed as **arguments with defaults** is itself a design decision. Since the
constants are not buried inside the function the caller can change them, and above all **they are named.** Had
`3.0` and `0.4` been naked numbers in the code body, the next person could not know what they are 3 times of and
0.4 of what.

The verdict body is fifteen lines.

```python
# probe.py:219-233
    if len(times) < 3:
        return GapScan(ok=False, error="too few video packets with a presentation time")

    # with B-frames the packet order differs from the presentation order, so sort by time.
    times.sort()
    deltas = [b - a for a, b in zip(times, times[1:])]
    ordered = sorted(deltas)
    median = ordered[len(ordered) // 2]
    threshold = max(floor, median * factor)

    scan = GapScan(ok=True, frames=len(times), frame_interval=median, threshold=threshold)
    for (a, b), d in zip(zip(times, times[1:]), deltas):
        if d > threshold:
            scan.gaps.append(Gap(start=a, end=b))
    return scan
```

![The six steps of the gap verdict and the error each step's removal makes](/images/lecture/hls-recon/22-gap-pipeline.svg)

*Figure 22-2 — the six steps of the gap verdict and the error each step's removal makes*

Look at each step one by one, with the measurement of **what breaks if you remove it.**

### 22.3.1 Sorting — the fake interval B-frames make

> **Term** — **B-frame (bidirectionally predicted frame)**: a frame encoded by referencing frames in both
> directions, forward and back. Since it references a later frame, **its decode order must precede the
> presentation order.** As a result the packet order stored in the container (DTS order) differs from the order
> appearing on screen (PTS order).

The `packet=pts_time` `ffprobe` puts out comes in **packet order.** With B-frames this value does not increase
monotonically. Measured (30fps, `-bf 3`).

```
packet order (first 12) pts_time: [0.0, 0.1333, 0.0667, 0.0333, 0.1, 0.2667, 0.2, 0.1667, ...]
```

Take adjacent differences without sorting and negatives and over-large values mix in.

| Condition | Interval range | "loss" detected without sorting | After sorting |
|---|---|---|---|
| 30fps, `-bf 3` | −66.7ms – +166.7ms | 0 | 0 |
| 5fps, `-bf 3` | −400ms – +1000ms | **9** | 0 |

Here comes, for the first time, an observation running through this whole chapter.

> **An implementation that omitted the sort shows no symptom at 30fps.** Because the maximum jump reordering
> makes (166.7ms) is smaller than the threshold 400ms. Test only under common conditions and this defect passes.
> Drop to 5fps and the jump becomes 1000ms, exceeding the threshold 600ms, and only then does it surface as 9
> false positives.

There is no side effect. A negative interval cannot pass `d > threshold` so it is not put in `Gap(start=a,
end=b)`, so an item with `a > b` or a negative value of the `length` property ([`probe.py:172-174`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L172-L174)) does not arise
even without sorting. The only symptom the missing sort leaves is the false positive an over-large jump makes.

### 22.3.2 The median — breakdown point 50%

> **Term** — **median**: the middle value when the sample is sorted.
> **breakdown point**: the minimum fraction of the sample that must be contaminated for a statistic to be
> arbitrarily corrupted. The median is 50%, the mean is **0%** — send one sample to infinity and the mean too
> becomes infinity.

In the frame-interval distribution a loss is itself a **contaminated sample.** Use the mean and that
contamination pulls up the threshold itself. Measured: judging the same four kinds of file by the median basis
and the mean basis each.

| File | Interval median | Interval mean | Median-basis threshold → detected | Mean-basis threshold → detected |
|---|---|---|---|---|
| 30fps normal | 33.33ms | 33.33ms | 400.0ms → 0 | 400.0ms → 0 |
| 30fps, 6-second loss | 33.33ms | 41.68ms | 400.0ms → 1 | 400.0ms → 1 |
| VFR normal | 33.33ms | 71.43ms | 400.0ms → 4 | 400.0ms → 4 |
| **5fps, 15 holes** | **200.00ms** | **505.08ms** | **600.0ms → 15** | **1515.3ms → 0** |

There is no difference on the first three rows. But on the last row the mean-basis check **passes a file with 21
seconds missing as 0 losses.** Complete blindness.

Why do they split only on the last row. Even if the mean pulls up the threshold, if that rise is smaller than the
loss interval, detection is kept. A single loss's contribution to the mean is `loss length / sample count`, so
with many samples it is diluted. The splitting condition is **when losses are many and samples are few** — the
file above has 15 of 59 intervals (25.4%) being losses, and those 15 pushed the mean up 2.5×.

The median is not infinitely strong either. Since the breakdown point is 50%, **if the loss intervals exceed the
majority of all intervals, the median itself becomes a loss value.** In the file above, had losses exceeded 30,
the median would become 1400ms and the threshold rise to 4200ms and it too would be 0. That is, this check stands
on the assumption "most is normal." There is no statistic that does not state its assumption.

Reading the code exactly, there is one more detail.

```python
median = ordered[len(ordered) // 2]
```

When the sample count is even, this takes **not the average of the two middle values but the larger** (the upper
median). It differs from the textbook definition but the direction is the safe side — the threshold grows
minutely, so it is conservative about false positives.

Finally, this value is not used only for the verdict.

```python
# report.py:319-324
            rep.add(
                "timeline continuity",
                PASS,
                f"{gaps.frames:,} video frames continuous, 0 missing "
                f"(interval median {gaps.frame_interval * 1000:.1f}ms, threshold {gaps.threshold * 1000:.0f}ms)",
            )
```

The "interval median" the user reads is exactly the statistic used in the verdict. Had it been the mean, in the
5fps file above it would print `interval median 505.1ms`, reporting **a value 2.5× off from the actual frame
interval 200ms.** **Since the verdict statistic and the display statistic are the same value, it must be correct
as descriptive statistics too.**

### 22.3.3 factor 3.0 — 3 times of what

`median * factor` is a **relative threshold.** Since the basis is not a constant but the value the target itself
revealed, it adapts automatically to the frame rate.

The value 3.0 is derivable. If N consecutive frames vanish, the interval between the surviving neighbors becomes
`(N+1) × frame interval`. The detection condition is `(N+1) × interval > 3 × interval`, i.e. **N ≥ 3.**

> **factor 3.0 = the declaration "I will catch a consecutive loss of 3 or more frames."**

The reason for excluding a 1–2 frame loss is not written in the code, but considering that an encoder's normal
operation (frame drop, editing seam, timestamp rounding) can make a gap of that size, it is a reasonable lower
bound. Only, **this is a post-hoc reconstruction and there is no evidence it was the design intent.**

### 22.3.4 floor 0.4 — what the absolute constant does and takes away

`max(floor, median * factor)` takes **the more lenient** of the two thresholds. How the two values compete by
frame rate is the most important table in this code.

| fps | Interval | median×3 | Actual threshold | Winner | Min detected consecutive loss |
|---|---|---|---|---|---|
| 120 | 8.33ms | 25.0ms | 400ms | floor | 48 frames (400.0ms) |
| 60 | 16.67ms | 50.0ms | 400ms | floor | 24 frames (400.0ms) |
| 30 | 33.33ms | 100.0ms | 400ms | floor | 12 frames (400.0ms) |
| 25 | 40.00ms | 120.0ms | 400ms | floor | 10 frames (400.0ms) |
| 24 | 41.67ms | 125.0ms | 400ms | floor | 9 frames (375.0ms) |
| 15 | 66.67ms | 200.0ms | 400ms | floor | 6 frames (400.0ms) |
| 10 | 100.0ms | 300.0ms | 400ms | floor | 4 frames (400.0ms) |
| **7.5** | 133.3ms | **400.0ms** | 400ms | tie | 3 frames (400.0ms) |
| 5 | 200.0ms | 600.0ms | 600ms | **factor** | 3 frames (600.0ms) |
| 1 | 1000ms | 3000ms | 3000ms | **factor** | 3 frames (3000ms) |

Write what the two constants do in one sentence and it is this.

> **floor fixes a time, "0.4 second," and factor fixes a count, "3 frames."**
> `max()` takes whichever of the two is looser.

Here the crossover appears. `median × 3 > 0.4` holds as `median > 0.1333`, i.e. only **below 7.5fps.** Real-world
video is almost all 24fps or above, so

> **In every stream above 7.5fps, `factor` does not participate in the verdict.** The value that actually gives
> the verdict is the one `0.4`.

The README wrote them in parallel as "the larger of three times the median frame interval or 0.4 second"
(`README.md:426`), but in practice the two terms are not equal. `factor` comes alive only in low-frame-rate
delivery (timelapse, surveillance camera, slide·screen share).

I measured what breaks if you remove floor too.

| File | `floor=0.4` (default) | `floor=0` |
|---|---|---|
| 60fps normal | threshold 400ms → 0 | threshold 50ms → 0 |
| 60fps, 5-frame (100ms) loss | threshold 400ms → **0 (miss)** | threshold 50ms → **1 (detected)** |

Without floor the threshold drops to 50ms at 60fps. This stream is perfect CFR so no false positive arose, but in
real delivery 50ms is 3 frames' worth and **a size indistinguishable from the jitter an encoder normally makes.**
floor blocks that false positive. And at the price it **gives up every real loss below 0.4 second.** At 60fps it
says nothing up to 23 frames, at 120fps up to 47.

The origin of `0.4` is in neither code·comment·README. The interpretation that it corresponds to 12 frames at
30fps can be attached after the fact, but there is no basis it was the design intent. **Written honestly, this
constant's basis is weak.** And that this weakly-based constant is effectively replacing §22.3.3's derivable
constant is this section's conclusion.

### 22.3.5 The strict inequality and the boundary

`if d > threshold` is a strict inequality. An interval exactly equal to the threshold is not a loss. The boundary
measured by increasing the consecutive lost-frame count one at a time at 30fps.

| Frames deleted | Interval between neighbors | Threshold | Verdict |
|---|---|---|---|
| 10 | 366.667ms | 400.0ms | miss |
| **11** | **400.000ms** | 400.0ms | **miss** (equal so it passes) |
| 12 | 433.333ms | 400.0ms | detected |
| 13 | 466.667ms | 400.0ms | detected |

This table becomes §22.7's starting point. **What this check guarantees at 30fps is only "there is no hole
exceeding 0.4 second," and about anything below that it says nothing.**

One precision problem is revealed here too. Since the interval is the value **between frames**, the reported loss
length is exactly **one frame longer** than the content that actually vanished. That the report gave `6.03s` for a
file where a 6.000-second segment vanished is because of that, and that the interval of a file with 11 frames
(366.7ms) deleted is 400.0ms is the same reason. The loss total (`gaps.lost`) is systematically over-estimated by
the number of loss events.

### 22.3.6 It prints the threshold together with the verdict

[`report.py:319-324`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L319-L324) cited in §22.3.2 prints the `interval median` and `threshold` together even when it gives a PASS.
This is not decoration.

> **A checker's PASS that hides the threshold is not information.** Someone who read only "0 missing" cannot tell
> whether it means "there is no hole" or "there is no hole exceeding 0.4 second." Print the threshold together and
> the reader can compute that PASS's range themselves.

The same value is left in the JSON too ([`report.py:325-335`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L325-L335), `threshold_sec` · `frame_interval_sec`). It means you can ask
in post-hoc analysis "what was the threshold then," and it means you can compare with a past report after
changing the threshold.

---

## 22.4 The other thresholds — the grade of the basis

The gap threshold is not the only threshold. This repository's verdict rules gather in one place, `report.build()`
([`report.py:123-511`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L123-L511)), and sweep the constants in it exhaustively and **the grade of the basis splits sharply.**

### 22.4.1 Length drift — the model of a relative threshold and the hole next to it

```python
# report.py:263-278
    if media and media.ok:
        drift = media.duration - declared_duration
        drift_pct = abs(_pct(drift, declared_duration))
        # off by a segment or more → treat as a stretch loss.
        if target_duration and abs(drift) >= target_duration:
            verdict = FAIL
        elif drift_pct > 0.5:
            verdict = WARN
        else:
            verdict = PASS
        rep.add(
            "length consistency",
            verdict,
            f"measured {media.duration:.2f}s vs declared {declared_duration:.2f}s "
            f"(drift {drift:+.2f}s / {drift_pct:.2f}%)",
        )
```

That the FAIL basis is `TARGETDURATION` is the **best-designed threshold** in this file.

> **Term** — **EXT-X-TARGETDURATION**: the maximum segment play length (seconds, integer) a media playlist
> declares. RFC 8216 requires it of a media playlist.

This value is not a constant but **a value the stream itself declared.** The comment wrote its meaning exactly —
"off by a segment or more → treat as a stretch loss" ([`report.py:266`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L266)). That is, the threshold has a **physical
meaning**, "did the drift exceed one unit of loss." It automatically becomes a different value on a 6-second
segment stream and a 10-second segment stream.

The `0.5%` next to it is different. It is an absolute-ratio constant with no basis. And when the two rules overlap
a structural anomaly arises. For a WARN, two conditions must hold at once.

```
|drift| > declared length / 200        (exceeds 0.5%)
|drift| < TARGETDURATION                (not a FAIL)
```

For this band to be non-empty, `declared length < 200 × TARGETDURATION` must hold.

| TARGETDURATION | Length at which the WARN band vanishes |
|---|---|
| 2s | 400s (about 7 minutes) and up |
| 4s | 800s (about 13 minutes) and up |
| 6s | 1200s (20 minutes) and up |
| 10s | 2000s (about 33 minutes) and up |

That is, **in a single 45-minute drama delivered in 6-second segments, the WARN band does not exist.** The
three-level verdict effectively collapses to two levels. Conversely, in a 30-second test stream a WARN appears
from 0.15-second drift — a size that commonly appears when the last segment is cut at a frame boundary or audio
priming samples are attached.

One more condition. `if target_duration and ...` skips the entire FAIL rule if `target_duration` is 0. Since the
default is `0.0` ([`playlist.py:156`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L156)) and it is filled only on the `#EXT-X-TARGETDURATION` line ([`playlist.py:298`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L298)), in
a nonstandard playlist without that tag **the strong verdict quietly disappears and only the baseless 0.5% rule
remains.** A good relative threshold comes with this dependency — no declared value to base on, no rule.

### 22.4.2 TTFB p95 3 seconds — a verdict strength fitting a baseless constant

```python
# report.py:185-187
        rep.add(
            "response latency",
            WARN if _quantile(ttfb, 0.95) > 3000 else PASS,
```

> **Term** — **TTFB (time to first byte)**: the time from sending the request to the first byte of the response
> body arriving. It views the server's processing delay separated from the transfer volume ([`fetch.py:84`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L84)).
> **p95 (95th percentile)**: the value at the lower-95% point when the sample is sorted. It is a metric for
> viewing the tail latency, since the mean hides outliers (Chapter 8).

The basis of `3000` is not in the code. But the verdict this threshold makes is WARN, and

```python
# cli.py:651-652
def _exit_code(verdict: str) -> int:
    return {report.PASS: 0, report.WARN: 0, report.FAIL: 2}[verdict]
```

**WARN is exit code 0.** That is, the baseless threshold is placed where it cannot stop an automation pipeline.
This can be set as a rule.

> **Match the basis strength of the threshold and the verdict strength it induces.** A derivable threshold may
> give a FAIL. An empirically chosen constant goes up to WARN.

Meanwhile the metric p95 itself has a trap.

```python
# report.py:56-61
def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, int(round(q * (len(s) - 1))))
    return s[idx]
```

It is nearest-rank and has no interpolation. Compute the index directly and it is this.

| Segment count | p95 index | Max index | p95 = max? |
|---|---|---|---|
| 5 | 4 | 4 | **yes** |
| 10 | 9 | 9 | **yes** |
| 11 | 10 | 10 | **yes** |
| 12 | 10 | 11 | no |
| 20 | 18 | 19 | no |

**If there are 11 segments or fewer, "p95" is not a percentile but the maximum.** In a short stream or a
`--limit` sample run this metric becomes "the single slowest time," and if the server exceeds 3 seconds just
once a WARN appears. **A metric meant to view the tail turns into an outlier metric when the sample is small.**
Using a percentile alone does not escape the mean's problem, and the sample count must be reported together.

### 22.4.3 Some checks have no threshold at all

| Check | Anchor | Threshold | When 1 |
|---|---|---|---|
| segment receive failure | [`report.py:167-172`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L167-L172) | none | FAIL |
| payload validity (leading byte) | [`report.py:199-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L199-L206) | none | FAIL |
| CC discontinuity | [`report.py:235-236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L235-L236) | none | WARN |
| segment hash duplicate | [`report.py:213-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L213-L218) | none | WARN |
| full decode error | [`report.py:502-508`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L502-L508) | none | FAIL |

Why do some checks need a threshold and some do not. The answer is in the nature of the observed quantity.

> **If the observed quantity is discrete and its normal value is exactly 0, no threshold is needed.** An HTTP
> request succeeds or fails, and a normal stream's failure count is 0. A frame interval, by contrast, is a
> continuous quantity whose normal value is not 0 — someone must set "how big is abnormal." At that moment a
> threshold arises, and the false-positive·false-negative trade comes in with it.

This distinction becomes §22.7's basis for defense design.

### 22.4.4 The basis-grade table — exhaustive

| Threshold | Anchor | Form | Basis | Verdict |
|---|---|---|---|---|
| gap `factor` 3.0 | `probe.py:191,227` | relative (own median) | derivable — consecutive loss of 3+ frames | FAIL |
| gap `floor` 0.4s | `probe.py:191,227` | **absolute** | **none** | FAIL |
| drift FAIL | [`report.py:267`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L267) | relative (TARGETDURATION) | derivable — one segment's worth | FAIL |
| drift WARN 0.5% | [`report.py:269`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L269) | relative ratio | **none** | WARN |
| TTFB p95 3000ms | [`report.py:187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L187) | **absolute** | **none** | WARN |
| subtitle drift +5.0s / −0.5s | `report.py:360,432` | **absolute** | **none** | **FAIL** |
| subtitle coverage 20% | [`report.py:457`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L457) | absolute ratio | **none** | WARN |
| subtitle-alignment display 0.5s | `report.py:348,405` | absolute | for display — not a verdict | — |
| CC discontinuity·receive failure, etc. | §22.4.3 | no threshold | not applicable | FAIL/WARN |

One row departs from the rule. **The subtitle-drift threshold `+5.0s` is a baseless absolute constant, yet it
gives a FAIL.** It is the only spot where the verdict strength and the basis strength are mismatched. Only, an
interpretation is possible that what this check measures is the almost-discrete property "did the subtitle go
outside the video range" and 5 seconds is a margin — the basis for that interpretation is not in the code either.

---

## 22.5 What breaks under a variable frame rate

### 22.5.1 What VFR is and why it arises

> **Term** — **CFR (constant frame rate)**: the way where every frame is displayed at the same time interval.
> **VFR (variable frame rate)**: the way where each frame's display interval can differ. The container carries
> each frame's presentation time (PTS) individually so it can express both, and **at the container level the two
> are indistinguishable.**

The last sentence is the seed of this whole section. VFR sources are not rare in practice.

| Cause | What happens | Interval that appears |
|---|---|---|
| screen recording·screen share | makes a frame only when the screen changes | several seconds in a still stretch |
| animation (on-2s·on-3s shooting) | holds the same drawing for 2–3 frames | 66ms · 100ms mixed |
| duplicate removal like `mpdecimate` | throws away identical frames to cut size | several seconds in a still scene |
| 3:2 pulldown (telecine) inverse | 24fps material put in a 30fps container then undone | 41.7ms and 33.3ms mixed |
| live camera·low-latency capture | interval varies by exposure time and buffer state | irregular |

### 22.5.2 Lab — local reproduction

Reproducible with no external site. All you need is `ffmpeg` and `python3`.

```bash
# 1) a CFR 30fps original repeating 1s of motion + 1.5s of still 5 times
for i in 0 1 2 3 4; do
  ffmpeg -v error -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=1" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p m$i.mp4
  ffmpeg -v error -y -f lavfi -i "color=c=blue:size=320x180:rate=30:duration=1.5" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p s$i.mp4
done
: > list.txt
for i in 0 1 2 3 4; do printf 'file m%s.mp4\nfile s%s.mp4\n' $i $i >> list.txt; done
ffmpeg -v error -y -f concat -safe 0 -i list.txt \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -r 30 anime_cfr.mp4

# 2) the same content as VFR — throw away duplicate frames (not data loss)
ffmpeg -v error -y -i anime_cfr.mp4 -vf mpdecimate -fps_mode vfr \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p anime_vfr.mp4

# 3) put both into this repository's gap scan
python3 -c "
from hlsrecon import probe
for f in ('anime_cfr.mp4', 'anime_vfr.mp4'):
    s = probe.gap_scan(f)
    print(f, s.frames, len(s.gaps), round(s.lost, 2), round(s.threshold, 3))
"
```

The result.

```
anime_cfr.mp4 375 0 0 0.4
anime_vfr.mp4 155 4 6.0 0.4
```

**The content looks completely the same and the data loss is 0, yet the second file is reported as "4 losses,
total 6.00 seconds."** Since `discontinuities` is 0, `intended` becomes false ([`report.py:309-310`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L309-L310)) so the verdict
is **FAIL**, not even WARN, and the exit code is 2.

Look at the interval histogram and the situation is clear.

| File | Interval distribution |
|---|---|
| `anime_cfr.mp4` | 33.33ms × 374 |
| `anime_vfr.mp4` | 33.33ms × 150, **1500.00ms × 4** |
| `damaged.mp4` (real loss) | 33.33ms × 718, **6033.33ms × 1** |

The second row and the third row are **distributions of the same shape.** The mere fact that a few big intervals
are mixed in cannot split the two.

### 22.5.3 Why the threshold cannot fix it

Raise the threshold somewhere between 1.5 and 6.0 seconds and this example's false positive vanishes. But that is
an adjustment fit to the example. A screen recording with a 7-second still comes and it catches again. The root
reason is the absence of information.

> **PTS says only "when is this frame displayed." It does not say "should there have been a frame here."** A
> vanished frame and a frame never made in the first place leave a **completely identical trace** on the
> timeline.

So this is not a threshold problem but a **metric-separability problem** (§22.2.2). As long as the two
distributions overlap, no threshold can remove both errors at once. What is needed is **a different information
source.**

| Information source | Can it split VFR-normal from a real loss | Does this code use it |
|---|---|---|
| `EXT-X-DISCONTINUITY` declared count | explains only editing seams — cannot explain VFR | **partly used** ([`report.py:309-310`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L309-L310)) |
| segment receive-failure record | splits if it is an in-transit loss | used ([`report.py:167-172`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L167-L172)) |
| MPEG-TS continuity counter | splits if it is a packet loss (multiple-of-16 miss, Chapter 18) | used ([`report.py:235-236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L235-L236)) |
| the container's declared frame rate (`r_frame_rate`) | **meaningless under VFR** | not used (reason stated in Chapter 1) |
| per-segment `EXTINF` × frame rate vs actual frame count | **meaningless under VFR** | unimplemented |

The last two rows are this chapter's irony. **The auxiliary metric usable for distinguishing VFR false positives
collapses precisely under VFR.** What is left is only the transport layer's evidence, and that says nothing about
a stream the origin already made with frames missing.

### 22.5.4 `--no-gap-scan` — a design acknowledging the limit as an option

```python
# cli.py:616
    gaps = None if args.no_gap_scan else probe.gap_scan(str(out))
```

```python
# cli.py:1067
    ap.add_argument("--no-gap-scan", action="store_true", help="skip the timeline loss scan")
```

And the README put this limit on its list of known limits.

```
# README.md:426-427
- **timeline gap threshold**: the larger of three times the median frame interval or 0.4 second. A variable
  frame rate source can false-positive — turn it off with `--no-gap-scan`.
```

It is a **design that documented the limit without hiding it and handed control to the user.** It is more honest
than forcing false positives down by adjusting the threshold and increasing false negatives. But there are three
prices.

**First, turn it off and the false-negative rate becomes 100%.** The transition mentioned in §22.2.3 actually
occurs.

**Second, the fact of turning it off is not left in the report.** If `gaps` is `None` the conditional
([`report.py:304`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L304)) is skipped whole and **the `timeline continuity` item itself disappears.** There is no
`stats["timeline"]` in the JSON either. Within the same file, a `--limit` sample run explicitly outputs "verdict
withheld" for the subtitle-timeline check ([`report.py:424-430`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L424-L430)), but the gap scan is silent. It is a state where
**"not checked" and "passed" are indistinguishable in the report**, and this violates the principle Chapter 38
will set.

**Third, it is already a habit.** In this repository's regression test, `--no-gap-scan` is attached in 9 places
(`tests/run.sh:234,239,266,281,290,300,311,493,505`). They are runs focusing on the subtitle check and it is for
speed so it is justified, but **the form is the same as alert fatigue.** The path where turning it off becomes
the default starts like this.

---

## 22.6 Generalization — the six rules of threshold design

List where the same structure appears and it becomes clear this problem is not a streaming-verification problem.

| Domain | Observed quantity | Threshold | Cost of false positive | Cost of false negative |
|---|---|---|---|---|
| spam filter | score | spam-verdict line | legit mail lost | spam received |
| intrusion detection (IDS) | request rate·pattern score | alert line | alert fatigue → rule disabled | intrusion undetected |
| static analyzer | rule violation | severity grade | developers turn off the tool | vulnerability remains |
| health check | response latency | timeout | a normal instance isolated → cascade failure | traffic to a dead instance |
| medical screening | marker concentration | positive criterion | needless workup·anxiety | diagnosis delayed |
| fraud detection | transaction feature score | block line | normal transaction blocked | fraud approved |

In each row the person who set the threshold usually left no derivation of the value. Organize the rules obtained
in this chapter's lab.

1. **Prefer relative thresholds.** Base them on a value the target itself declared or itself revealed.
   `TARGETDURATION` and `median × 3` are the examples. A constant is wrong when the environment changes, and a
   relative threshold moves along.
2. **If you must use an absolute constant, write down the fact that it has no basis.** A baseless constant itself
   is no sin. Leaving a baseless constant looking based is the problem.
3. **Match the basis strength of the threshold and the verdict strength.** A derivable threshold gives a FAIL, an
   empirical constant a WARN. That TTFB 3 seconds is WARN in this repository is right, and that subtitle drift 5
   seconds is FAIL is mismatched.
4. **Expose the threshold and the statistic used to compute it in the output.** A PASS that hid the threshold is
   a PASS whose range cannot be known.
5. **Put a threshold-free check next to a threshold check.** A discrete observed quantity (request-failure
   count, magic-number match) needs no threshold, and such a check is strong against evasion too (§22.7.3).
6. **Let it be turned off, but let the fact of turning it off remain in the result.** Without an off switch the
   user throws away the whole tool. Without a trace of the switch, "not checked" reads as "passed."

---

## 22.7 Security — a threshold is a published attack surface

### 22.7.1 The threat model first

This tool is a client-side verifier. Here the adversarial actor is **the side wanting to pass a delivery with
loss as normal** — an operation hiding a transcoder malfunction, an ad-insertion pipeline's seam, a delivery
network that must meet a quality standard (SLA). It is a **problem on a different axis** from content protection
or key management, and this chapter does not treat that side.

The core property is this. **This tool prints the threshold in the report** (§22.3.6). That is, the coordinates
needed for evasion are public.

### 22.7.2 Threshold evasion

> **Term** — **threshold evasion**: the technique where an actor who knows a detection rule's threshold splits
> each action finely below the threshold to avoid detection. Scanning that crawls below a rate limit, and data
> exfiltration distributed below an anomaly-detection baseline, are the same form.

§22.3.5's measured boundary becomes an evasion parameter as-is. At 30fps, up to **11 frames (0.367 second)** at a
time is not detected. And this check has **no count limit** — it judges each interval independently and does not
look at the total.

| 30fps 45-minute (2700-second) video | Value |
|---|---|
| remove 11 frames every 10 seconds | 269 spots |
| total time vanished | about 98.6 seconds |
| gap scan detection count | **0** |
| `length consistency` verdict | drift 98.6 seconds ≥ TARGETDURATION 6 seconds → **FAIL** |

The last row is important. **The gap scan alone is pierced, but the length check remains.** Because the two
checks' blind spots differ — the gap scan does not look at the total and the length check does not look at
positions. To hide even the total you must grow elsewhere by the amount vanished, and then the interval widens
again.

**One threshold is pierced, and two thresholds with mutually different blind spots are hard to pierce together.**
This is the basis for §22.6's fifth rule.

### 22.7.3 Defense — overlap a threshold check and a threshold-free check

Organize which check catches each spot where loss arises, and the remaining hole is revealed exactly.

| Where the loss arose | The catching check | Threshold | Evasion difficulty |
|---|---|---|---|
| HTTP request failure | segment receive ([`report.py:167-172`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L167-L172)) | none | very high — a discrete event |
| a 200 response but not media | payload validity ([`report.py:199-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L199-L206)) | none | very high — leading byte |
| TS packet loss in transit | CC check ([`report.py:235-236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L235-L236)) | none | medium — a miss if exactly a multiple of 16 (Chapter 18) |
| the reassembled result's total length anomaly | length consistency ([`report.py:267`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L267)) | TARGETDURATION | medium — looks only at the total |
| **a frame loss the origin made** | **the gap scan only** | 0.4 second | **low — §22.7.2** |

The last row is the hole this repository cannot fill. A stream where every segment arrived, the packets are
intact, and the total length matches but only the frames are thinly missing **depends on a single threshold
check.**

There is a reinforcement candidate but it hits §22.5.3's wall again — a check comparing per-segment `EXTINF` and
the actual frame count holds only under CFR and is meaningless under VFR. That **the same absence of information
is both the cause of the false positive and the obstacle to the defense reinforcement** is this chapter's final
symmetry.

### 22.7.4 The two faces of publishing the threshold

| View | If you publish the threshold |
|---|---|
| auditor | can compute a PASS's range — makes the verdict verifiable |
| evader | gains coordinates to hide below |

This repository chose publication, and that judgment comes from the role. **This is a client-side verification
tool so information content beats information leakage** — the same decision as `cli._diagnose` (Chapter 5)
printing the failure cause in detail. Had it been a server-side anomaly-detection system, the opposite is right.
A system that sends the detection threshold in the response amounts to distributing its own evasion manual.

> **Publishing the same value becomes a virtue or a vulnerability depending on the role.** It is context
> dependence of exactly the same form as Chapter 24's padding oracle and Chapter 16's content sniffing.

### 22.7.5 What to do by role

| Role | What to do |
|---|---|
| **verification-tool author** | output the threshold and the statistic used to compute it. write in a comment that a baseless constant has no basis, and do not attach a FAIL to such a constant. do not pile the verdict onto a single threshold check |
| **CI operator** | leave in a comment why for a flag turning off a check (`--no-gap-scan`, etc.) and re-review periodically. require the turned-off check to remain in the report as "not checked" — an item disappearing and passing are different |
| **auditor** | ask the threshold's origin. "chosen empirically" can be a valid answer, but it is valid only if it is **recorded.** when you see a PASS, ask for that check's threshold and sample count together |
| **detection-rule designer** | first make a check expressible with a discrete observed quantity. if you must put a threshold on a continuous quantity, place a check with a different blind spot next to it |
| **delivery·transport operator** | the fact that the counterpart's verification tool cannot see loss below the threshold is a hole in your own quality standard. passing ≠ intact |

---

## 22.8 Limits and open questions

Written honestly.

- **Could not confirm the origin of `factor 3.0` and `floor 0.4`.** §22.3.3·§22.3.4's derivations are
  reconstructed backward from the values, and there is no evidence it was the design intent in code·comment·
  README. Post-hoc justification and design basis are different.
- **The measurement was done with six kinds of synthetic stream.** They are files made with `testsrc2` and
  `color`, so there is no guarantee the same numbers come out on real broadcast material (3:2 pulldown, variable
  GOP, ad-insertion seams, live footage with frequent scene changes). In particular §22.3.1's "at 30fps the
  reordering jump is 166.7ms" is a value for one condition, `-bf 3`, and it grows with hierarchical B-frames
  (B-pyramid) or a longer reordering delay.
- **Did not try alternative statistics.** Whether a median absolute deviation (MAD) or quartile-based threshold
  reduces VFR false positives was not measured. A guess that it likely would is no basis.
- **The p95 sample-count dependency was computed in the code and not confirmed with an actual TTFB
  distribution.** The index computation is certain, but how often that property becomes a problem in real
  delivery is unknown.
- **§22.7.2's evasion scenario is only partly measured.** That an 11-frame single loss passes was confirmed by
  making a file. The case scattered across 269 spots and the length check's reaction then are arithmetic and I
  did not actually make and run such a file.
- **The point that `--no-gap-scan` leaves no trace in the report comes from reading the code.** The side effect
  of the improvement (adding the check item as "not checked") — for instance whether a test or JSON consumer
  depending on the item count breaks — was not reviewed.
- **Could not find the basis for the subtitle thresholds 5.0s · 0.5s · 20%.** This chapter classified these as
  "no basis," but the possibility that the basis was outside the code (measured during development) cannot be
  excluded. Nonexistent and unrecorded are different, and to the reader they are the same.

---

## 22.9 Summary

1. **Choosing the observation metric right does not finish the verdict.** The moment you put a threshold on the
   metric, the false-positive·false-negative trade begins, and the threshold can only pick a spot between the
   two. To reduce both errors at once you must change not the threshold but the **metric.**
2. **In a verification tool a false positive is not a cheaper error than a false negative but a delayed false
   negative.** With frequent false positives the user turns off the check, and at that moment the false-negative
   rate becomes 100%. `--no-gap-scan` is a switch acknowledging that transition in code.
3. **In `max(0.4, median × 3)` factor fixes a count, "3 frames," and floor a time, "0.4 second."** The two
   values' crossover is 7.5fps, and real-world frame rates are all above it, so **the value that actually gives
   the verdict is the one weakly-based `0.4`.**
4. **The three decisions sort·median·floor all make a difference only in the same corner: low frame rate and
   variable frame rate.** Test only with a 30fps normal stream and you can omit all three decisions with no
   symptom. The test condition hides the value of the design decisions.
5. **A VFR false positive is not a threshold problem.** PTS says only "when is it displayed" and not "should
   there have been a frame here." A vanished frame and a frame never there leave the same trace on the timeline,
   so no threshold can split the two. Measured: a VFR file with 0 data loss gets a FAIL with 4 losses·6.00
   seconds.
6. **The basis strength of the threshold and the verdict strength must be matched.** That TTFB 3 seconds is WARN
   (exit code 0) is right, and that a baseless subtitle drift of 5 seconds is FAIL is mismatched. And a relative
   threshold (`TARGETDURATION`, own median) is always better than an absolute constant — only, if the declared
   value to base on is absent, the rule vanishes wholesale.
7. **A threshold is a published attack surface.** At 30fps up to 11 frames at a time is not detected and there is
   no count limit either. Defense is not tightening the threshold but **overlapping checks with different blind
   spots** — threshold-free discrete checks (receive failure, leading byte, CC) play that role.

---

**Next chapter** — Part 4 ends here. Every check so far stood on the premise that **you can see what the bytes
are.** If the segment is encrypted, that premise breaks first. Part 5 begins with the AES-128-CBC decryption
`EXT-X-KEY` specifies. Chapter 23 covers what the rule "**use the media sequence number as the IV**" means when
the IV (initialization vector) is not stated, and when a predictable IV is a problem and why it is less of one
here.
