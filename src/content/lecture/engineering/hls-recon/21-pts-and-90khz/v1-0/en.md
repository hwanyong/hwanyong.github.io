---
title: "PTS and 90kHz"
description: "Why the total length cannot catch loss"
date: 2026-07-06
version: '1.0'
tags: ['streaming', 'binary']
thumbnail: /images/lecture/thumb/hls-recon-21-pts-and-90khz.svg
---
## 21.0 What this chapter answers

1. Why **90kHz** exactly — where did this number come from and what was it chosen for?
2. Why is a 33-bit value scattered across 5 bytes — what is one bit blocking?
3. Why does the **absolute time** property become a trap in verification. And is that trap coincidence or
   principle?
4. So what must you observe instead? And what does that observation miss in turn?

Chapter 1 set this course's starting point in one sentence — **"the total length matches but the middle is
empty."** That chapter presented the conclusion, and this chapter **re-measures it at tick resolution.** Go down
to a single tick of the 90kHz clock and it is revealed that this is neither an ffmpeg bug nor an MPEG-TS defect
but **the inevitable consequence of the decision to express time in absolute coordinates.**

Every number in this chapter was measured directly, locally. It can be reproduced with no external server.

---

## 21.1 The problem — two files identical down to the tick

### 21.1.1 Reproduction

Make by hand a stream like the one `tests/run.sh` makes. 30 seconds, 30fps, five 6-second segments.

```bash
ffmpeg -v error -y -f lavfi -i "testsrc2=size=640x360:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset ultrafast -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p \
  -c:a aac -b:a 128k source.mp4

ffmpeg -v error -y -i source.mp4 -c copy -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "plain/seg%03d.ts" plain/index.m3u8

cp -R plain damaged && rm damaged/seg001.ts     # remove one middle piece
```

Reassemble the two playlists each. The playlist was untouched, so the `damaged` side tries to open `seg001.ts`,
fails, and skips that piece.

```
$ ffmpeg -v error -y -i plain/index.m3u8   -c copy ok.mp4    ; echo $?
0
$ ffmpeg -v error -y -i damaged/index.m3u8 -c copy hole.mp4  ; echo $?
0
```

**Both are exit code 0, and there is not a single line of error output.** Measure the outputs.

| | `ok.mp4` (normal) | `hole.mp4` (6-second loss) |
|---|---|---|
| `format.duration` | `30.023401` | `30.023401` |
| file size | 7,899,819 B | 6,319,406 B |
| video frame count | 900 | **720** |
| **sum of video-track durations** | **2,700,000 tick** | **2,700,000 tick** |

180 frames vanished and the file shrank by 1.58 MB, yet the play length is **identical to the sixth decimal
place.** The last row is especially important — it is not that second-level rounding hid it. The sum of the
integer tick values the MP4 actually holds does not differ by **a single tick.**

> **Term** — **tick**: one mark of the clock. MPEG-TS's presentation time is carried not in seconds but in the
> mark count of a 90kHz clock. 1 tick = 1/90,000 second ≈ 11.1 µs.

### 21.1.2 Precision is not sensitivity

Here one sentence of verification methodology comes first.

> For an observation metric `M` and a defect `D`, if `M(normal) = M(D)`, then `M` is not a verification for `D`.
> **However precisely you measure, so it is.**

The total length is a **complete invariant** for this loss. Measure to the nanosecond, measure in integer ticks,
the same value comes out. It is not a problem solved by improving the measuring instrument but a problem of
**choosing the wrong quantity.**

Why the total length exactly is invariant. That answer is all the rest of this chapter.

---

## 21.2 Principle ① — where did 90kHz come from

### 21.2.1 The 27MHz system clock and division by 300

> **Term** — **STC (System Time Clock)**: the reference clock the MPEG-2 systems spec sets. Its nominal frequency
> is **27MHz**, and the transmitter and receiver matching this clock is the premise of synchronized playback.

> **Term** — **PCR (Program Clock Reference)**: a field telling the receiver the transmitter's current STC value.
> It rides in the TS packet's adaptation field. With this value the receiver pulls its own clock into line.

PCR does not carry the 27MHz value in one lump. It **splits it into a 33-bit base and a 9-bit extension**, and
the original value is recovered by the following formula.

```
PCR = program_clock_reference_base × 300 + program_clock_reference_extension
```

The extension holds 0–299, so the base's mark is 27,000,000 ÷ 300 = **90,000 Hz.**

![The origin of the 90kHz mark](/images/lecture/hls-recon/21-clock-90khz.svg)

*Figure 21-1 — 90kHz is the mark of the 27MHz system clock divided by 300. PCR carries both pieces, but PTS·DTS use only the base-side mark*

> **Term** — **PTS (Presentation Time Stamp)** / **DTS (Decoding Time Stamp)**: values indicating, respectively,
> when this access unit must be put out on screen and when it must be fed to the decoder. **Both are 33-bit
> unsigned integers on the 90kHz mark.** With B-frames present the two values differ (covered again in Chapter
> 22).

A frame's presentation time needs no 27MHz (37 nanosecond) resolution. So PTS·DTS use only the 300-divided 90kHz
side. **PCR is a value that matches the clock so it must be precise, and PTS is a value that places frames so it
need not be** — a design drawing two resolutions from the same clock.

### 21.2.2 Why 300 — the frame rate must fall to an integer

The result of choosing the division ratio 300 is the value 90,000, and this value's property is decisive.

| Frame rate | Frame interval (sec) | 90kHz tick | Integer |
|---|---|---|---|
| 24 | 1/24 | **3750** | yes |
| 25 | 1/25 | **3600** | yes |
| 30 | 1/30 | **3000** | yes |
| 48 | 1/48 | **1875** | yes |
| 50 | 1/50 | **1800** | yes |
| 60 | 1/60 | **1500** | yes |
| 30000/1001 (29.97) | 1001/30000 | **3003** | yes |
| 24000/1001 (23.976) | 1001/24000 | 15015/4 = 3753.75 | **no** |
| 60000/1001 (59.94) | 1001/60000 | 3003/2 = 1501.5 | **no** |

24·25·30 and their multiples all fall to integers. Even among the NTSC-family 1001-denominator frame rates,
**29.97fps is exactly 3003 tick** (because 90000/30000 = 3 is an integer). Audio is the same.

| Audio frame | tick | Integer |
|---|---|---|
| AAC 1024 samples @ 48kHz | **1920** | yes |
| AAC 1024 samples @ 32kHz | **2880** | yes |
| AAC 1024 samples @ 44.1kHz | 102400/49 ≈ 2089.8 | **no** |

**This is the reason 90kHz was chosen.** If the frame interval falls to an integer tick, no rounding error
accumulates however long you keep adding time. If it does not, a decimal is cut off every frame, and that error
piles up over hours of broadcast.

**But the last two rows of the frame-rate table are exceptions.** 23.976fps and 59.94fps are not exactly
representable in 90kHz. This fact meets threshold design later — if the frame interval oscillates between 3753
and 3754, that jitter is **indistinguishable from a variable frame rate** (Chapter 22).

### 21.2.3 Why 33 bits

Count time in the 90kHz mark and the bit count sets the representable time.

| Bit count | Representable tick count | Time | Does a day fit |
|---|---|---|---|
| 32 | 4,294,967,296 | **13.26 hours** | no |
| **33** | **8,589,934,592** | **26.51 hours** | yes |
| 34 | 17,179,869,184 | 53.02 hours | yes (excessive) |

32 bits does not fit a day and 34 is left over. **33 bits is the minimum fit to "a broadcast day + margin."** And
that decision immediately makes the next section's headache — 33 is not a multiple of 8.

> **Term** — **wraparound**: a counter returning to 0 at the end of its representable range. A 33-bit 90kHz PTS
> wraps about **every 26.5 hours.** It does not occur at the episode lengths this repository handles, but in a
> 24-hour continuous delivery it necessarily occurs.

---

## 21.3 Principle ② — why 33 bits scatter across 5 bytes

### 21.3.1 The PES header's PTS field

> **Term** — **PES (Packetized Elementary Stream)**: the layer wrapping a compressed video·audio stream together
> with time information. The content MPEG-TS's 188-byte packets carry is PES packets, and PTS·DTS go into this
> PES's optional header.

PTS uses 5 bytes, i.e. 40 bits. The value is only 33 bits so 7 bits are left. How those 7 bits are used is this
section's subject.

Pull the first video PES header directly from the `plain/seg000.ts` made in the previous section and it is this.

```
$ python3 -c "
d=open('plain/seg000.ts','rb').read(); i=d.find(b'\x00\x00\x01\xe0')
print(d[i:i+14].hex(' '))"
00 00 01 e0 00 00 80 80 05 21 00 07 e8 b5
                           ^^^^^^^^^^^^^^ PTS 5 bytes
```

The leading `00 00 01 e0` is the PES start-code prefix and the video stream_id. The last 5 bytes `21 00 07 E8
B5` are the PTS. Unfold into bits and the layout shows.

![The PES header's PTS 5-byte layout](/images/lecture/hls-recon/21-pts-bitfield.svg)

*Figure 21-2 — the 33 bits split into 4+3+1 / 15+1 / 15+1 and ride in 5 bytes. Recover `21 00 07 E8 B5` and it is 128090 tick = 1.423222 seconds*

The recovery calculation is just aligning the three pieces by place and summing.

```python
pts = (b[0] >> 1 & 0x07) << 30 | b[1] << 22 | (b[2] >> 1 & 0x7f) << 15 \
    | b[3] << 7 | (b[4] >> 1 & 0x7f)
# 128090  →  128090 / 90000 = 1.423222 s
```

It matches exactly the value `ffprobe` reports.

```
$ ffprobe -v error -select_streams v:0 -show_entries packet=pts,pts_time \
    -read_intervals "%+#1" -of csv=p=0 plain/seg000.ts
128090,1.423222
```

### 21.3.2 The leftover three bits — what the marker_bit blocks

The `1` interposed once every 15 bits is the **marker_bit.** The spec sets this position always to `1`. It is a
bit there for a **pattern**, not a value.

> **Term** — **start code prefix**: the fixed byte string `00 00 01` for finding packet boundaries in an
> MPEG-family stream. When a parser sweeping the byte string meets this pattern it judges a new structure starts
> from there.

`00 00 01` is **23 consecutive 0s then a 1.** If this pattern appears by chance inside the data, the parser
catches the wrong spot as a packet boundary. When PTS is a small value is exactly the dangerous case — because
its high bits are all 0.

The marker_bit blocks this. Encode `PTS = 0` and it becomes this.

```
21 00 01 00 01
0010 0001  0000 0000  0000 0001  0000 0000  0000 0001
        ↑                     ↑                     ↑
      marker                marker                marker
```

**The longest 0-run is 15.** Since a 1 is forced every 15 bits, whatever value these 5 bytes hold, a 0-run of 23
cannot be made. That is, **a timestamp cannot imitate a start code.**

| Design | If you do not do this |
|---|---|
| split 33 bits into 4+3+1 / 15+1 / 15+1 | put 33 bits in one lump and a small time with high bits 0 makes a long 0-run, and that imitates a start code so **the parser mistakes mid-stream for a packet boundary** |
| set the marker_bit always to 1 | the upper bound of the 0-run disappears. it becomes a bug that breaks playback only at certain PTS values, extremely hard to find the reproduction condition for |
| put a 4-bit prefix (`0010`) | you cannot tell whether there is only PTS or both PTS·DTS. not knowing whether the header is 5 or 10 bytes, everything from the next byte on goes off |

This repository does not parse the PES header directly (it delegates to `ffprobe`). Why it must nonetheless know
this layout is the next section — **the fact that these 5 bytes are absolute coordinates determines the whole
verification strategy.**

---

## 21.4 Principle ③ — absolute coordinates preserve the total

### 21.4.1 Measured — the rear piece's coordinate is not pulled forward

Pull the first video PTS of the five segments as-is and it is this.

```
$ for f in plain/seg00*.ts; do
    echo -n "$f "
    ffprobe -v error -select_streams v:0 -show_entries packet=pts,pts_time \
      -read_intervals "%+#1" -of csv=p=0 "$f"
  done
plain/seg000.ts  128090,1.423222
plain/seg001.ts  668090,7.423222
plain/seg002.ts  1208090,13.423222
plain/seg003.ts  1748090,19.423222
plain/seg004.ts  2288090,25.423222
```

The difference between neighboring values is exactly **540,000 tick = 6.000000 seconds.** There is no rounding
error — §21.2.2's integer division is visible here.

The core is that each value **is already embedded inside that segment.** `seg002.ts` says of itself that it
starts at 1208090 tick. It does so regardless of what came before, or how many came. **Delete `seg001.ts` and
`seg002.ts`'s bytes do not change by a single bit.**

### 21.4.2 Why this preserves the total — the telescoping sum

Here comes a one-line proof. Let the presentation times be `t₀ < t₁ < … < tₙ`, and the adjacent interval
`Δᵢ = tᵢ₊₁ − tᵢ`.

> **Term** — **telescoping sum**: a sum where neighboring terms cancel each other, leaving only the two ends.
> `Σ(tᵢ₊₁ − tᵢ) = tₙ − t₀`.

```
Σ Δᵢ  =  (t₁−t₀) + (t₂−t₁) + … + (tₙ−tₙ₋₁)  =  tₙ − t₀
```

**The total length is a function of only the timeline's two ends.** However many points you delete inside, if
`t₀` and `tₙ` stay the same the sum does not change. At the deleted spot two intervals merely merge into one, and
the merged interval's length equals the sum of the original two.

From here two corollaries come immediately.

| Corollary | Content |
|---|---|
| **an internal loss does not appear in the total length in principle** | it is not ffmpeg's implementation problem. it is the same measured by any tool |
| **a boundary loss necessarily appears in the total length** | drop the first piece and `t₀` changes, the last and `tₙ` changes. Chapter 1 §1.3.1's measurement table matches this prediction exactly |

And **what quantity is detectable** also follows. If the total `Σ Δ` is invariant, the information remains in the
**distribution** of `Δ`. What must be observed is not the sum but **the distribution of the differences.**

### 21.4.3 It survives a change of representation — MP4's relative duration

Here comes a common objection. "MP4 does not use absolute coordinates. It is a relative representation writing
each sample's duration. Then doesn't the hole vanish during reassembly?"

> **Term** — **`stts` (Decoding Time to Sample Box)**: one of ISO-BMFF's boxes, writing for each sample the
> **duration to the next sample (sample_delta).** Not absolute coordinates but a sequence of relative durations.

Actually count all of `hole.mp4`'s sample durations and it is this.

```
$ ffprobe -v error -select_streams v:0 -show_entries packet=duration \
    -of csv=p=0 hole.mp4 | sort | uniq -c
 719 3000
   1 543000
```

**One sample's duration is 543,000 tick.** 3000 + 540,000 — a value where the vanished segment's 6 seconds is
added whole onto the normal frame interval.

![The path by which loss survives a representation change](/images/lecture/hls-recon/21-hole-survives-remux.svg)

*Figure 21-3 — even changing absolute coordinates to relative duration, the hole is merely absorbed into one sample's duration. Both representations sum to 2,700,000 tick, same as the normal copy*

Confirm the sums.

| | Calculation | Sum |
|---|---|---|
| `ok.mp4` | 3000 × 900 | **2,700,000 tick** |
| `hole.mp4` | 3000 × 179 + 543,000 + 3000 × 540 | **2,700,000 tick** |

**Exactly as the telescoping sum predicted.** Moving to a relative representation is writing `Δᵢ` as-is, and its
sum is still `tₙ − t₀`. Change the representation and the invariant is still the invariant.

> That loss does not appear in the total is neither MPEG-TS's property nor MP4's property.
> It is **the arithmetic property that "if the two ends are the same the sum is the same"**, and it follows into
> whatever container you move to.

---

## 21.5 The code — what to observe instead

### 21.5.1 The observation target is the distribution of differences

`probe.gap_scan`'s docstring wrote §21.4's conclusion as-is.

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

Measurement starts by asking `ffprobe` for only the presentation times.

```python
# probe.py:199-209
    proc = subprocess.run(
        [
            require("ffprobe"), "-v", "error", "-hide_banner",
            "-select_streams", "v:0",
            "-show_entries", "packet=pts_time",
            "-of", "csv=p=0",
            path,
        ],
        capture_output=True,
        text=True,
    )
```

Four arguments, each a decision.

| Argument | The decision | If you do not do this |
|---|---|---|
| `-select_streams v:0` | look at only the first video track | mix in audio packets and the interval distribution splits into two kinds so the median becomes meaningless |
| `packet=pts_time` | read at the **packet** level | `frame=` requires decoding. tens of times slower even on a 30-second video, and detecting loss needs no decode result |
| `pts_time` (seconds) | receive not ticks but seconds | ticks need `time_base` to interpret. it differs per container (TS is 1/90000, MP4 depends on codec·muxer) so receive seconds and normalize |
| `csv=p=0` | only the values, no header | the parsing code becomes fragile to format changes |

The third row shows where this repository places the delegation boundary. **Dividing 90kHz by seconds is
`ffprobe`'s job, and this code handles only floats in seconds.** The left of the `128090,1.423222` confirmed
above is `ffprobe`'s input and the right is this code's input.

### 21.5.2 The parsing does not swallow failure

```python
# probe.py:213-220
    times: list[float] = []
    for tok in proc.stdout.replace(",", "\n").split():
        try:
            times.append(float(tok))
        except ValueError:
            continue  # a packet with no time, e.g. N/A
    if len(times) < 3:
        return GapScan(ok=False, error="too few video packets with a presentation time")
```

Skipping `N/A` is leniency, but **if the sample is fewer than 3 it does not return success.** `ok=False` is not
"no loss" but "cannot judge." Without this distinction a stream with no times automatically becomes PASS —
Chapter 38's "distinguishing unknown from passing" is here in an early form. Only, whether this return value is
properly conveyed to the report is revisited in §21.9.

### 21.5.3 The core computation

```python
# probe.py:222-233
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

Run it on this lab stream and it comes out like this.

```
ok.mp4    frames=900  median=0.033333  threshold=0.4000  gaps=[]
hole.mp4  frames=720  median=0.033333  threshold=0.4000  gaps=[(5.99, 12.023, 6.033)]
```

`median=0.033333` is exactly **3000 tick**, and the threshold 0.4 second is **36,000 tick.** The 30fps row of
§21.2.2's table is observed as-is.

Read the three decisions as "if you do not do it, what breaks."

| Decision | If you do not |
|---|---|
| `times.sort()` | `ffprobe` puts out packets in **storage order.** with B-frames it differs from presentation order so `deltas` gets **negatives mixed in**, and those negatives shake the median and threshold together. a hole that does not exist in presentation order is made |
| `median` (median, not average) | the loss stretch itself is in the sample. use the average and one 6.033-second value pulls up the baseline, and the threshold grows with it so **the loss makes itself normal** |
| `max(floor, median * factor)` | at 30fps three times the median is 0.1 second. with no floor value, a missing frame or two or the normal jitter of a variable frame rate all become loss. in fact the value adopted in this lab too was not `median × 3 = 0.1s` but the **floor value 0.4s** |

How the threshold constants `3.0` and `0.4` are chosen, and what false positive that makes, is Chapter 22's
subject.

### 21.5.4 The data structure — what is left as a result

```python
# probe.py:165-174
@dataclass
class Gap:
    """A stretch in the playback timeline where no frame exists."""

    start: float
    end: float

    @property
    def length(self) -> float:
        return self.end - self.start
```

```python
# probe.py:177-188
@dataclass
class GapScan:
    ok: bool = False
    gaps: list[Gap] = field(default_factory=list)
    frames: int = 0
    frame_interval: float = 0.0  # median frame interval
    threshold: float = 0.0
    error: str = ""

    @property
    def lost(self) -> float:
        return sum(g.length for g in self.gaps)
```

There is one thing to read exactly here. **`Gap` is not the vanished stretch but the interval between the two
remaining frames.** `start` is the presentation time of the frame just before the loss and `end` is that of the
frame just after.

The measured value shows it — a 6.000-second segment vanished and the reported length is **6.033 seconds.**

```
6.033 = 6.000 (the vanished segment) + 0.033 (the one frame slot that would have been there anyway)
```

That is, `lost` **over-reports by one frame interval per loss.** 33ms at 30fps, 3.3 seconds for 100 losses. No
effect on the verdict (present/absent) but **using `lost` as a quantitative metric carries a systematic error.**
Since the report outputs this value as a "total," it needs noting.

The reason it also keeps `frames` · `frame_interval` · `threshold` is clear too. Keep only the verdict and **you
cannot reconstruct after the fact why that verdict came.** Not knowing whether the threshold was 0.4 second or
0.1 second, the conclusion differs when reading the same report twice.

### 21.5.5 Another use of absolute coordinates — `first_pts`

There is one more spot where the same property is used not for verification but for **alignment.**

```python
# probe.py:236-246
def first_pts(target: str, headers: dict[str, str] | None = None) -> float | None:
    """The video track's first presentation time (seconds). Used as the subtitle-alignment baseline."""
    cmd = [require("ffprobe"), "-v", "error", "-hide_banner"]
    cmd += input_args(headers, target)
    cmd += [
        "-select_streams", "v:0",
        "-show_entries", "packet=pts_time",
        "-read_intervals", "%+#1",
        "-of", "csv=p=0",
        target,
    ]
```

The reason this function exists is exactly the property of absolute coordinates. **The timeline's origin is not
0.** In this lab stream the first PTS was 128090 tick = **1.423222 seconds.** It differs per delivery, and the
only way to know is to measure.

The subtitle-alignment formula demands this value.

```python
# subtitles.py:188
MPEGTS_HZ = 90000  # MPEG-TS system clock

# subtitles.py:218
    return (mpegts / MPEGTS_HZ) - video_pts0 - local_sec
```

The value `X-TIMESTAMP-MAP` gives is 90kHz ticks, and the subtitle time is seconds. In the affine correspondence
joining the two, `video_pts0` is **the origin's position.** Assume it is 0 and in this lab the subtitles slip by
1.42 seconds (the whole formula is derived in Chapter 27).

That the two functions take arguments differently is no coincidence either.

| | `gap_scan(path, …)` | `first_pts(target, headers)` |
|---|---|---|
| Target | **the reassembled local output** ([`cli.py:616`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L616)) | **the remote segment original** ([`cli.py:266`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L266)) |
| Attaches `input_args` | no — a local file, so it needs no header·extension policy | yes — remote, so it needs auth headers. the extension allowlist (Chapter 14) attaches only to playlist input so it is absent for segments |
| Range read | all packets | `-read_intervals "%+#1"` — **the first packet only** |
| Use | loss detection | fixing the time-axis origin |

Why `first_pts` looks at the original segment and not the output is confirmed by measurement. The reassembled
copy's first PTS is **2070 tick = 0.023 second** — ffmpeg re-set the timeline near 0. **The origin information
vanishes during reassembly.** So if you need the origin you must look at the original.

---

## 21.6 The code — turning into a verdict

A measurement is not yet a verdict. `report.py` applies the rules.

```python
# report.py:303-317
    # 5) timeline continuity — the total length can match while the middle is empty
    if gaps is not None and gaps.ok:
        if gaps.gaps:
            worst = max(gaps.gaps, key=lambda g: g.length)
            where = ", ".join(f"{g.start:.2f}~{g.end:.2f}s" for g in gaps.gaps[:3])
            more = f" +{len(gaps.gaps) - 3} more" if len(gaps.gaps) > 3 else ""
            # if it is a discontinuity the playlist announced with EXT-X-DISCONTINUITY, it may be an intended seam.
            intended = discontinuities >= len(gaps.gaps)
            rep.add(
                "timeline continuity",
                WARN if intended else FAIL,
                f"{len(gaps.gaps)} gaps / total {gaps.lost:.2f}s (max {worst.length:.2f}s) "
                f"@ {where}{more}"
                + (" — count matches the EXT-X-DISCONTINUITY-declared regions (possibly intended seams)" if intended else ""),
            )
```

### 21.6.1 The spec-permitted exception — EXT-X-DISCONTINUITY

> **Term** — **`EXT-X-DISCONTINUITY`**: an HLS playlist tag. It declares in advance that **timestamp continuity
> breaks** at the next segment. Ad insertion, splicing of another source, and encoder restart are actual cases.
> It is a normal state RFC 8216 defines, not an error.

The parsing is one line.

```python
# playlist.py:331-332
        elif line == "#EXT-X-DISCONTINUITY":
            pending_disc = True
```

The counting is one line too.

```python
# cli.py:635
        discontinuities=sum(1 for s in media.segments if s.discontinuity),
```

**If there is a declared discontinuity, the hole the gap scan found may be that seam.** So it lowers to WARN
instead of FAIL.

> **A checker not knowing the spec's exceptions pours out false positives, and a checker that pours out false
> positives is not used.**

In a 30-minute episode with two ad insertions, without this exception a normal delivery is FAIL every time. Such
a tool has `--no-gap-scan` become the default in a few days, and at that moment the check becomes nonexistent.
**A checker's usefulness is determined not by the true-positive rate but by the false-positive rate.**

### 21.6.2 How coarse this relaxation is

At the same time, this rule **compares only the count.**

```python
intended = discontinuities >= len(gaps.gaps)
```

`Gap` has positions `start`·`end` and `Segment` too knows its own place, but position does not enter this
comparison. The result is this.

| Situation | Declared discontinuities | Gaps found | Verdict | Correct |
|---|---|---|---|---|
| 1 ad insertion, no loss | 1 | 1 (same spot) | WARN | yes |
| 1 ad insertion, **1 real loss at a different spot** | 1 | 1 (different spot) | **WARN** | **no — should be FAIL** |
| 1 ad insertion, 2 losses | 1 | 3 | FAIL | yes |
| 3 ad insertions, only 1 gap found | 3 | 1 | WARN | verdict withheld — the one gap could be a loss |

The second row is a **false negative.** It is a false negative removable by comparing positions, and the needed
information is already all in the two data structures. It just does not do it now.

The reason for writing this down as-is rather than calling it a "bug" is the same as Chapter 15. **Knowing the
checker's limit is the condition for using the checker.** WARN must be read as "not distinguished by this check,"
not "it is fine."

### 21.6.3 Leaving the measurement as a record

```python
# report.py:325-335
        rep.stats["timeline"] = {
            "frames": gaps.frames,
            "frame_interval_sec": round(gaps.frame_interval, 6),
            "threshold_sec": round(gaps.threshold, 4),
            "gap_count": len(gaps.gaps),
            "gap_total_sec": round(gaps.lost, 3),
            "gaps": [
                {"start": round(g.start, 3), "end": round(g.end, 3), "length": round(g.length, 3)}
                for g in gaps.gaps[:50]
            ],
        }
```

It leaves the verdict (`FAIL`) and the basis (`threshold_sec`, `frame_interval_sec`) **together.** Keep only the
verdict and you cannot compare with a past report when you change the threshold later.

`gaps[:50]` is an intended cut. It keeps the count and total whole and cuts only the list — it prevents the JSON
exploding in a stream with thousands of losses while **not losing the numbers used in the verdict.**

---

## 21.7 Generalization — a conserved quantity cannot be a detection quantity

Move this chapter's structure outside the domain and it becomes this.

> **A quantity invariant under some defect cannot be that defect's detection metric.**
> Choosing a verification metric is not raising precision but **finding a quantity that responds to the defect.**

List where the same structure repeats and it is the following. The left column is all **aggregate (total)** and
the right column is all **difference (order·interval·boundary).**

| Domain | Total metric — insensitive to internal loss | Difference metric — sensitive |
|---|---|---|
| **this chapter** | total play length | **the distribution of adjacent PTS intervals** |
| log collection | total count of collected events | continuity of the sender-side sequence number |
| message queue | count of processed items | continuity of the offset |
| DB replication | matching row counts on both sides | continuity of the LSN·binlog position |
| file transfer | total byte count | missing chunk index |
| backup | total capacity | per-file listing·hash comparison |
| time-series sensor | total sample count | the distribution of timestamp intervals |
| accounting | balance total | continuity of the voucher serial number |
| MPEG-TS packet layer | total packet count | **continuity of the continuity counter** (Chapter 18) |

The last row is interesting. This repository uses **the same principle at two layers, twice** — at the packet
layer it looks at the difference of a 4-bit cyclic counter ([`tsanalyze.py:112-119`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L112-L119)), and at the presentation-time
layer it looks at the difference of PTS. The two checks catch different things.

| | CC discontinuity check | timeline gap scan |
|---|---|---|
| Observation target | segment original bytes | the reassembled output |
| What it catches | packet loss **inside** a segment | **segment-unit** loss |
| What it misses | loss of exactly a multiple of 16 | loss below the frame-interval threshold |
| Post-hoc reproduction | **impossible** — the output has no TS header | possible — only the file is needed |

**Neither alone is enough, and neither replaces the other.** Coverage is not adding verification items but
**choosing items with mutually different blind spots.**

One more thing. It does not mean the total metric is useless. Per §21.4.2's second corollary, **a boundary loss
appears only in the total.** [`report.py:262-278`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L262-L278)'s length-consistency check sees what the gap scan cannot. The two
checks are complementary.

---

## 21.8 Security — what absolute time makes and what it leaves

### 21.8.1 Why the tampering becomes an omission, not an edit

Read the property of absolute coordinates from the attacker's view again and it becomes this.

> **The deleter needs to recompute nothing.**

Had it been a relative time representation, after taking out the middle you would have to rewrite all the rear
times. Absolute coordinates need none of that — the remaining pieces already hold their own coordinates. So this
tampering is **an omission, not an edit**, and there is simply no step that leaves a trace.

Here the limit of per-segment signing·hashing is revealed.

| Defense | What it guarantees | Does it catch this tampering |
|---|---|---|
| TLS | each response's integrity·authenticity | **no** — deleting a response is not a protocol violation |
| per-segment hash·signature | the received piece is genuine | **no** — the remaining pieces' signatures are all valid |
| total-play-length comparison | the two ends are intact | **no** — §21.4.2 |
| full decode | the file opens to the end | **no** — the hole decodes normally |
| **adjacent PTS interval distribution** | the timeline's continuity | **yes** |

The first four rows all ask **each piece's authenticity**, and only the last asks **the set's completeness.**
Completeness is a different axis, and without a separate check measuring this axis, however many signatures you
attach it is empty.

### 21.8.2 But the same property is also the only lever

At the same time, do not miss this chapter's symmetry. **Because it is absolute coordinates, loss can be computed
from the output alone.**

Since the remaining pieces say of themselves "I start at 1208090 tick," even someone who received only the file
can know where it is empty. Had the time been renumbered as relative intervals during reassembly and the hole
filled (had the rear been pulled forward), **loss would become completely unobservable in the output.** Then the
only check left is the HTTP result at receipt time, and that cannot be reproduced after the fact (Chapter 1).

> **The trap and the lever come from the same property.** Absolute coordinates disable the total-length check
> while at the same time enabling the timeline check. Which it becomes is set by **what you decided to observe.**

### 21.8.3 The threat model by the attacker's range of control

To draw a verification tool's limit honestly you must split "how far the attacker controls."

| Control range | Possible tampering | This tool's reaction |
|---|---|---|
| on-path — response blocking only | make a certain segment 404·timeout | **catches** — timeline-continuity FAIL (+ receive failure) |
| segment-body rewrite | pull the remaining pieces' PTS to fill the hole | **partial** — the timeline passes but the total length shrinks by 6 seconds so **length consistency** FAILs |
| body rewrite + fill insertion | fill the hole with forged content | **cannot catch** — both checks pass. only, it must generate 6 seconds of video so the cost is a different dimension |
| up to the playlist | shrink the declared length·segment count itself | **cannot catch** — **the baseline is contaminated** |

The second row is this section's point. **With length consistency and timeline continuity together, tampering
that evades only one catches on the other.** Two complementary checks raise the attacker's required workload one
level.

The fourth row is this tool's principled limit. The proposition this tool verifies is **"does what the playlist
declared match what was actually received"**, not **"is the playlist truthful."** If the oracle comes over the
same channel there is no means to verify the oracle (Chapters 34·38).

> This course does not cover content-protection (DRM) bypass. What is covered here is **the threat model of
> completeness verification**, and its opposite, the procedure of "unauthorized acquisition," is outside this
> course's scope (`00-curriculum.md` §0.1).

### 21.8.4 The defender's view — what to do by role

| Role | What to do |
|---|---|
| **archive·evidence-custody operator** | do not use "total length matches" as an intake criterion. measure **timeline continuity** at intake time and keep its numbers (frame count·interval median·threshold) together. some values cannot be re-measured later |
| **delivery operator** | always declare `EXT-X-DISCONTINUITY` for intended seams. do not declare it and a normal delivery looks like loss in the verification tool, and once those false positives pile up **the check is turned off** — as a result real loss passes too |
| **CDN operator** | do not treat a per-segment 5xx·404 as "a transient error absorbed by retry." it is not absorbed and becomes a hole in the output. measure the error rate **per segment** |
| **verification-tool implementer** | keep **both** the total metric and the difference metric. one's blind spot is the other's true-positive area. and the relaxation rule (WARN downgrade) must leave in the report **on what basis it relaxed** |
| **auditor** | when you see the sentence "verification passed," ask **what quantity was measured.** a verification comparing only the total length gives no information about internal loss |

The last row connects to §21.1.2's proposition. **PASS is not "intact" but "not caught by this metric."** A PASS
that does not state its metric is not information.

---

## 21.9 Limits and open questions

Written honestly.

- **`ok=False` does not appear in the report.** [`report.py:304`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L304)'s condition is `if gaps is not None and gaps.ok:`, so
  if the gap scan fails (fewer than 3 video packets, an `ffprobe` error) **the item itself disappears from the
  report and `gaps.error` is thrown away too.** The person reading the report cannot tell "did the check pass or
  did it not run at all." It is the spot where the "cannot judge" state the code took pains to make in §21.5.2 is
  lost at the output layer. It violates Chapter 38's "distinguishing unknown from passing" principle.
- **`lost` over-reports by one frame interval per loss** (§21.5.4). No effect on the verdict but a systematic
  error in quantitative comparison.
- **The discontinuity relaxation does not compare positions** (§21.6.2). Comparing only the count, it lowers "1
  declared seam + 1 real loss at a different spot" to WARN. The needed information is already in the data
  structures so it is a fixable false negative.
- **The gap scan runs only on the output** ([`cli.py:616`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L616)). It does not run on the original segments, so it **cannot
  distinguish a hole the delivery made from a hole the reassembly made.** You must compare against the receive
  layer's failure record to split the cause.
- **It looks at only one video track.** With `-select_streams v:0`, an audio-only delivery is not a verdict
  target, and when video has several tracks only the first is checked. An audio-only loss does not catch on this
  check.
- **It does not handle 33-bit wrapping.** In a stream exceeding 26.5 hours, when PTS returns to 0 a single huge
  interval would **presumably** be made after `times.sort()`, but it was not measured. Whether `ffprobe`
  internally corrects the wrapping was not confirmed either. It does not occur at the episode lengths this
  repository handles so it is left unverified.
- **Non-integer frame rates were not measured.** Per §21.2.2's table, 23.976·59.94fps do not fall exactly to
  90kHz. What effect the rounding jitter has on the `median` and threshold was not measured in this chapter — it
  is Chapter 22's task.
- **The reason for the value 27MHz itself is knowledge outside this repository.** The explanation that it is
  twice ITU-R BT.601's luma sampling frequency 13.5MHz is widely cited, but it was not confirmed against the
  spec's own basis narrative. What this chapter backs with code and measurement is up to the relationship
  **27,000,000 ÷ 300 = 90,000** and the frame-rate integer-division property.
- **The PES-header measurement is one sample.** `21 00 07 E8 B5` was read from one file ffmpeg 8.1.1 + libx264
  made. The case where another encoder carries both PTS·DTS (prefix `0011`/`0001`, 10 bytes) was not confirmed.

---

## 21.10 Summary

1. **90kHz is the mark of the 27MHz system clock divided by 300.** PCR recovers 27MHz with a 33-bit base and a
   9-bit extension, but PTS·DTS use only the base-side mark. The reason this value was chosen is **that the frame
   intervals of 24·25·30·50·60fps and 29.97fps all fall to integer ticks** — 23.976·59.94 do not.
2. **33 bits is the minimum of "a broadcast day + margin"** (26.5 hours). Not a multiple of 8, it scatters across
   5 bytes as 4+3+1 / 15+1 / 15+1, and the **marker_bit** forced every 15 bits caps the longest 0-run at 15,
   keeping **a timestamp from imitating the start code `00 00 01`.**
3. **That the total length is invariant under internal loss is an arithmetic property.** It is the telescoping
   sum `Σ Δᵢ = tₙ − t₀`, so if the two ends stay the same, whatever vanishes inside the sum is the same. In the
   measurement, the video-duration sum of the normal copy and the loss copy were **both exactly 2,700,000
   tick.**
4. **It follows even under a change of representation.** MP4 uses relative duration, but the vanished 6 seconds
   is merely absorbed into one sample's duration `543,000 tick`. Changing the container does not solve it.
5. **The detectable information is in the distribution of differences.** `gap_scan` sweeps all adjacent
   presentation-time intervals and finds spots exceeding `max(0.4s, median×3)`. Omit even one of median·sort·
   floor and the check disables itself.
6. **Know the spec-permitted exception.** A discontinuity announced by `EXT-X-DISCONTINUITY` is lowered to WARN
   — a checker pouring out false positives gets turned off, and a turned-off check is a nonexistent check. Only,
   this relaxation **compares only the count and does not compare positions** (one kind of false negative).
7. General rule: **a conserved quantity cannot be a detection quantity.** A quantity invariant under a defect is
   not a verification however precisely you measure. Verification design is not raising precision but **choosing
   a quantity that responds to the defect.**

---

**Next chapter** — this chapter came up to "look at the distribution of differences," and what in that
distribution to call loss is set by two constants — `factor=3.0` and `floor=0.4`. Where did these numbers come
from. What breaks under a variable frame rate, and under the non-integer frame rates §21.2.2 left. Chapter 22
treats threshold design as a balance problem of false positives·false negatives.
