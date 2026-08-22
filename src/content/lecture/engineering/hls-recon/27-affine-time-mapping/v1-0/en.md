---
title: "The Affine Correspondence of Two Time Axes"
description: "X-TIMESTAMP-MAP and the derivation of the offset formula"
date: 2026-07-21
version: '1.0'
tags: ['streaming', 'distributed-systems']
thumbnail: /images/lecture/thumb/hls-recon-27-affine-time-mapping.svg
---
## 27.0 What this chapter answers

1. Why does a subtitle piece have its own time. Why can you not place the subtitle by that time alone?
2. `offset = mpegts/90000 − video_pts0 − local_sec` — what is each of the three terms and why subtract two of
   them?
3. The general form joining two time axes is an **affine transform**, yet why is only a translation left here?
   If the scale is not 1, what more must there be?
4. Why does ffmpeg not apply this mapping for you?
5. Two paths apply the same offset by **mutually different methods**, so why is that not duplicate implementation?

Chapter 21 covered what the 90kHz clock and PTS are, and why it is an **absolute coordinate.** This chapter is the
problem of **joining that absolute coordinate with the coordinate system another file uses.** What was invisible
when there was one coordinate system is revealed the moment there are two — **which side's 0 to use.**

The figures in this chapter were all measured directly, locally (ffmpeg 8.1.1 / macOS arm64). The reproduction
procedure is written as-is in §27.1.1. What could not be measured is gathered separately in §27.7.

---

## 27.1 The problem — the subtitles slip 60 seconds whole

### 27.1.1 Reproduction

Make by hand a fixture like the one `tests/run.sh:69-108` makes. One 30-second video, and two subtitle tracks
holding the same cues — one normal, one with only the mapping set 60 seconds off.

```bash
ffmpeg -v error -y -f lavfi -i "testsrc2=size=640x360:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset ultrafast -g 60 -keyint_min 60 -sc_threshold 0 \
  -pix_fmt yuv420p -c:a aac -b:a 128k source.mp4

mkdir -p plain
ffmpeg -v error -y -i source.mp4 -c copy -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "plain/seg%03d.ts" plain/index.m3u8
```

Measure the video's first presentation time.

```
$ ffprobe -v error -select_streams v:0 -show_entries packet=pts,pts_time \
      -read_intervals "%+#1" -of csv=p=0 plain/seg000.ts
128090,1.423222
```

**The video timeline does not start at 0.** The first frame sits at 128,090 tick on the 90kHz mark, i.e.
1.423222 seconds. This is not damage but normal — an MPEG-TS packager chooses the start coordinate freely, and
ffmpeg's mpegts muxer starts near 1.4 seconds by default.

Now make the subtitle pieces. The cues sit from local time 0 to 29 seconds, and only the header's `MPEGTS` value
differs between the two tracks.

```
# normal track — the subtitle's 0 seconds corresponds to the video's first frame (128090 tick)
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:128090
# off track — claims it corresponds 60 seconds (5,400,000 tick) later
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:5528090
```

The result of putting the two tracks each into this repository's tool. The subtitle files' bytes are completely
the same down to the cue body, and only **one number in the header** differs.

```
$ hls-recon http://127.0.0.1:8993/master-ok.m3u8  -o out/ok.mp4  --subs all …
  ✓ subtitle extract   1 fully extracted (xx 6 cues) — 3 boundary-duplicate cues removed, 4 body-mixed fragment headers cleaned
  ✓ subtitle timeline  all tracks within video range (min coverage 97% — xx 0.0~29.0s)

$ hls-recon http://127.0.0.1:8993/master-bad.m3u8 -o out/bad.mp4 --subs all …
    · xx · bad [default] X-TIMESTAMP-MAP-based +60.00s correction
  ✓ subtitle extract   1 fully extracted (xx 6 cues) — …, X-TIMESTAMP-MAP alignment xx +60.00s
  ✗ subtitle timeline  track xx out of video range (60.0~89.0s vs video 30.0s) — suspect X-TIMESTAMP-MAP alignment failure
```

Subtitles starting at 60 seconds got attached to a 30-second video. **Not a line of the subtitle was damaged and
the cue times are the original as-is.** What went off is only the correspondence between subtitle and video.

Here this chapter's problem holds.

> **The subtitle file has its own time and the video has its own time. The two are different coordinate systems.
> Without a rule joining the two coordinate systems, merge an intact subtitle and an intact video and a wrong
> result comes out.**

### 27.1.2 What a subtitle piece carries

An HLS subtitle track is chopped up just like the video. Open one piece as-is and it is this.

```
WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:128090

00:00:00.000 --> 00:00:04.000
cue 1

00:00:05.000 --> 00:00:09.000
cue 2
```

> **Term** — **WebVTT (Web Video Text Tracks)**: a text format holding subtitles·captions. The file starts with
> `WEBVTT`, followed by **cues** — a chunk of start time·end time·body.

> **Term** — **X-TIMESTAMP-MAP**: a correspondence table HLS places in the WebVTT file header. The form is
> `X-TIMESTAMP-MAP=LOCAL:<subtitle time>,MPEGTS:<90kHz clock value>`, and it declares one pair of correspondence
> — **"this subtitle file's `LOCAL` time corresponds to the video timeline's `MPEGTS` clock value."**

> **Term** — **90kHz clock**: the mark of the MPEG-2 system clock 27MHz divided by 300. The PTS (presentation
> time) rides as a 33-bit unsigned integer on this mark (Chapter 21 §21.2).

The cue time `00:00:00.000` is the **subtitle file's own coordinate.** The video's first frame is at 128,090
tick. The two numbers are not on the same axis so they cannot be compared directly. One header line joins the
two.

### 27.1.3 Why the spec puts this header

Why doesn't the subtitle file just use the same coordinate as the video — you must answer this question to see the
header's reason for existing. There are three design alternatives, and HLS chose the third.

| Design | The time a piece carries | Can you align seeing one piece alone | Price |
|---|---|---|---|
| (a) piece-relative time | 0 from the piece's start | **cannot** — you must separately know which piece it is and the lengths of the prior pieces | on mid-stream join you must receive all prior pieces |
| (b) video-absolute time | the 90kHz clock converted to seconds | possible | you must rewrite the original subtitle per stream. if the clock wraps (Chapter 28) the notation collapses |
| (c) file-local time + a correspondence table | the original subtitle file's time as-is | **possible** — because the header carries the correspondence point | the work rises for the side reading and applying the table |

(c)'s benefit becomes clear in a **LIVE mid-stream join.** Say the player entered mid-broadcast and received one
subtitle piece. With (a) there is no way to know where in the timeline that piece is, so you must trace back the
prior pieces. With (c) **the correspondence point is carried in that one piece so it aligns immediately.** HLS's
principle that a segment must be independently interpretable is applied to subtitles too.

At the same time (c) **does not touch the original subtitle file.** A subtitle is made once and reused across
several qualities·several packagings, and nail the video-absolute time into the cues and you must rewrite the
subtitle per packaging. The correspondence table keeps that reusability while adding only the alignment info.

> (a)·(b) are not alternatives the spec document enumerated but a reconstruction this course made by tracing back
> the design space. On what basis the RFC chose (c) is not written in the original.

---

## 27.2 The principle — one correspondence point ties two axes

### 27.2.1 Two axes, three origins

First separate the coordinate systems appearing in the alignment problem.

| Symbol | Axis | Unit | Where 0 sits | Who sets it |
|---|---|---|---|---|
| `S` | subtitle-local axis | seconds | the start point the original subtitle file set | the subtitle maker |
| `V` | MPEG-TS 90kHz axis | tick (convertible to seconds) | the absolute coordinate the packager chose | the video packager |
| `O` | output-file axis | seconds | **the video's first frame** | the reassembly tool |

`S` and `V` are two axes two different people each set. `O` is the axis of the file we make, and its 0 is by
convention the video's start. **That there are two axes but three origins is why this chapter's formula has three
terms.**

### 27.2.2 The general form — the affine transform

The correspondence joining two time axes is generally of the following form.

```
V = a · S + b
```

> **Term** — **affine transformation**: a transform adding a translation (`b`) to a linear transform (scale
> `a`). It sends a line to a line and equal intervals to equal intervals. On a 1-D time axis, `a` corresponds to
> the **ratio of clock speeds** and `b` to the **difference of origins.**

Since there are two unknowns (`a`, `b`), **two** correspondence points must exist to determine it. And yet
`X-TIMESTAMP-MAP` gives **only one** correspondence point. The only reason that is enough is one — because it is
assumed `a` is already known.

### 27.2.3 Why the scale is 1

`S`'s unit is seconds and `V`'s unit is 1/90,000 second. Divide by 90,000 to match to seconds and the two axes
**count the same physical second.** The speed ratio between two axes counting the same second is 1.

```
a = 1        →        V = S + b        (only translation is left)
```

This is this chapter's first point.

> **It is an affine correspondence but the scale is 1 so only translation is left. So one correspondence point is
> enough, and "alignment" reduces to "one addition."**

And this assumption is **nailed into the header's form itself.** `X-TIMESTAMP-MAP` is a syntax that can hold only
one correspondence point, and there is no slot to write a second correspondence point or a clock-speed ratio.
**What a form cannot express is what the side that set the form assumed does not happen.**

### 27.2.4 The three origins — derivation of the formula

Now set up the terms one by one. Say the header declared `LOCAL:<local_sec>,MPEGTS:<mpegts>`.

**Step 1 — convert the correspondence point to seconds.** `mpegts` is tick so divide by 90,000. This value is the
correspondence point's `V` coordinate.

```
V_anchor = mpegts / 90000
S_anchor = local_sec
```

**Step 2 — find the translation amount.** Since `a = 1`, `b = V_anchor − S_anchor`. This is **"how far the video
axis is ahead of the subtitle axis."**

```
b = mpegts / 90000 − local_sec
V(t) = t + b                    (the video-axis coordinate of subtitle-local time t)
```

**Step 3 — move to the output axis.** The output's 0 is the video's first frame. That is, the video-axis
coordinate `V` appears in the output file at `V − video_pts0`.

```
O(t) = V(t) − video_pts0 = t + (mpegts / 90000 − local_sec − video_pts0)
```

Leave the subtitle file's cues as-is and they sit at `t` on the output axis. The spot we want is `O(t)`, so shift
every cue by the following.

```
offset = mpegts / 90000 − video_pts0 − local_sec
```

Exactly the formula the code computes ([`subtitles.py:218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L218)). Organize the terms and it is this.

| Term | What it is | Sign | Why that sign |
|---|---|---|---|
| `mpegts / 90000` | the correspondence point's **video-axis coordinate** (seconds) | `+` | the reference position itself |
| `video_pts0` | where the output axis's 0 sits on the video axis | `−` | to move a video-axis coordinate to an output-axis coordinate, subtract the origin difference |
| `local_sec` | the correspondence point's **subtitle-axis coordinate** (seconds) | `−` | the correspondence point has already progressed `local_sec` on the subtitle axis, so the cue's own time already holds that much |

The three terms correspond to the three origins, one each. Seen as a figure, this is **interval subtraction.**

![The offset formula seen as three origins and interval subtraction](/images/lecture/hls-recon/27-three-origins.svg)

*Figure 27-1 — the same one instant is read as a different number on the three axes. The offset is the distance between the subtitle axis's 0 and the output axis's 0, and that distance is obtained by subtracting the figure's three intervals*

The figure's example assumes `video_pts0 = 1.423s` (measured) and a header `LOCAL:00:00:06.000,MPEGTS:900000`.

```
offset = 900000/90000 − 1.423 − 6.000 = 10.000 − 1.423 − 6.000 = +2.577
```

### 27.2.5 Verification — put it into the actual function

Whether the formula is right can be confirmed by running the code directly. The result of fixing the measured
`video_pts0 = 1.423222` and changing only the header.

```python
from hlsrecon.subtitles import timestamp_offset
timestamp_offset(b"WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:128090\n\n", 1.423222)
```

| Header | Hand calculation | Function return | Interpretation |
|---|---|---|---|
| `LOCAL:00:00:00.000,MPEGTS:128090` | `1.423222 − 1.423222 − 0` | `2.2e-07` | no alignment needed |
| `LOCAL:00:00:00.000,MPEGTS:5528090` | `61.423 − 1.423 − 0` | `60.0000002` | must shift 60 seconds |
| `LOCAL:00:00:06.000,MPEGTS:668090` | `7.423 − 1.423 − 6` | `2.2e-07` | **the same answer even with a mid-piece header** |
| `MPEGTS:128090,LOCAL:00:00:00.000` | same as above | `2.2e-07` | the same even with the attribute order swapped |
| `LOCAL:00:00:00.000,MPEGTS:-128090` | — | `None` | a negative clock is invalid (Chapter 28) |
| no header | — | `None` | with no basis, do not compute |

`2.2e-07` is not 0 but floating-point residue. Because instead of the exact value `128090/90000 = 1.4232222…` I
put in `1.423222` cut to six decimals, and the value the code actually uses is the `ffprobe` output string read
as a `float` so even this residue does not arise.

The third row matters. **Use a mid-stream piece's header and the same offset comes out.** Since `local_sec` and
`mpegts` progressed 6 seconds together, the difference is preserved. This is the measured evidence for "one
correspondence point is enough," and the confirmation that the assumption the scale is 1 holds — had the two axes
not flowed at the same speed, a different answer would come out per piece.

### 27.2.6 If the scale is not 1, what more is needed

If the two axes' clock frequencies differ, `a ≠ 1` and it is not determined by one correspondence point. What is
needed rises.

| When `a = 1` | When `a ≠ 1` |
|---|---|
| **one** correspondence point | **two or more** correspondence points (or a declared frequency ratio) |
| alignment = one addition | alignment = multiply every cue by `a` and add `b` |
| error does not grow over time | error **accumulates in proportion to elapsed time** |
| compute once and done | periodic re-estimation may be needed |

The size of accumulation is computed immediately. A clock error of 100ppm (parts per million) is
`100e-6 × 7200 = 0.72 second` over 2 hours' worth. A subtitle perfectly matched at the start slips 0.7 second at
the end — **a kind of off-ness that translation alone never catches.**

This repository does not handle `a ≠ 1`. It stands on the premise that HLS's subtitles and video are **packaged
against the same 90kHz system clock**, and that premise is guaranteed by the spec. The case where the premise
breaks is covered in §27.5.2.

---

## 27.3 The code — compute once, use in two places

### 27.3.1 Header parsing — do not lean on the attribute order

```python
# subtitles.py:184-188
_TSMAP_RE = re.compile(
    r"X-TIMESTAMP-MAP\s*=\s*(?=.*LOCAL:(?P<local>[\d:.]+))(?=.*MPEGTS:(?P<mpegts>-?\d+))",
    re.IGNORECASE,
)
MPEGTS_HZ = 90000  # MPEG-TS system clock
```

The regex is made of two **lookaheads (`(?=…)`)**. A lookahead does not consume the position so the two patterns
each independently sweep behind from the same spot. As a result `LOCAL` and `MPEGTS` are caught **in whatever
order they are written.**

Had you not done this and written `LOCAL:…,MPEGTS:…` joined in order, matching would fail on a delivery that
emits them in swapped order and **the offset quietly becomes 0** — the subtitle is received and the tool reports
success but only the subtitle is slipped, the hardest-to-notice failure form. §27.2.5's fourth row fixes this
property by measurement.

That the `MPEGTS` pattern **receives even a negative** as `-?\d+` for now is intentional too. It receives it here
without filtering and then judges by value — because if the regex quietly fails to match, "no header" and "invalid
header" are indistinguishable.

### 27.3.2 The formula itself

```python
# subtitles.py:199-218
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

There are four things to read.

| Spot | Decision | If you do not do this |
|---|---|---|
| `first_segment[:2048]` | decode only the leading 2KB of the piece | pay the cost of turning the whole subtitle piece into a string per track. the header is only at the file's front |
| `errors="replace"` | do not throw an exception even on decode failure | if the subtitle body has broken bytes, **the whole thing stops at the header-parsing stage.** you only need the header but it fails because of the body |
| `if mpegts < 0: return None` | distrust the whole mapping on a negative | the negative offset is applied as-is and the subtitle is pushed forward (§27.6.4) |
| `while len(parts) < 3` | fill a short notation like `MM:SS.mmm` into the hour slot | the `06` of `00:06.000` (6 seconds) catches on `parts[1]*60` and is read as **6 minutes** |

A return of `None` and a return of `0.0` are different. `None` is "no basis," `0.0` is "there is a basis and
nothing to correct." When the caller meets `None` it does not put that track in the offset table ([`cli.py:284-285`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L284-L285)),
and a track not in the table is later looked up as `0.0` — **the same behavior in result but a different record.**

### 27.3.3 The reference point — read only one packet

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

`-read_intervals "%+#1"` means "read only **one** packet from the start point." Whether the file is 30 seconds or
2 hours, the amount read is the same.

What happens without this argument — `first_pts` receives the whole packet list and uses only the first line.
Chapter 21's `gap_scan` is exactly that way (there it needs everything), and here it is unneeded cost. **Even
calling the same tool, read only as much as needed** — that distinction is explicitly in the argument.

The target the caller passes is worth noting too.

```python
# cli.py:266-269
    pts0 = probe.first_pts(media.segments[0].uri, headers)
    if pts0 is None:
        _eprint("    · could not read the video first presentation time, skipping subtitle-alignment correction")
        return {}
```

It passes not the playlist but the **first segment URI** directly. Since only one segment need be received there
is no need to receive the whole video — this is the basis for `--refill-subs` (fill only subtitles) being able to
align without re-receiving hundreds of MB ([`cli.py:714-717`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L714-L717)).

And if the reference point cannot be read, **it gives up correction and goes on.** Offset 0 is "an uncorrected
state," not "a wrong value," so the price of failure is not subtitle loss but only non-correction.

### 27.3.4 The computation in one place

```python
# cli.py:271-289
    offsets: dict[str, float] = {}
    for track in segmented:
        try:
            sub_pl = playlist.parse(fetcher.get_text(track.uri), base_url=track.uri)
        except (RuntimeError, ValueError) as e:
            _eprint(f"    · {track.label()} could not read the playlist: {e}")
            continue
        if not sub_pl.segments:
            continue
        first = fetcher.get(sub_pl.segments[0].uri, sub_pl.segments[0].byterange)
        if not first.ok:
            continue
        off = subtitles.timestamp_offset(first.body, pts0)
        if off is None:
            continue
        offsets[track.uri] = off
        if abs(off) >= 0.5:
            _eprint(f"    · {track.label()} X-TIMESTAMP-MAP-based {off:+.2f}s correction")
    return offsets
```

`_subtitle_offsets` ([`cli.py:237-289`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L237-L289))'s return type is a dict of **track URI → offset (seconds).** The reason it returns
a table and not a value is that the packaging time can differ per track — if the Korean subtitle and the English
subtitle were made in different batches, their `MPEGTS` values differ.

Note that the four `continue`s in the loop are all **quiet failures.** Even if the subtitle playlist cannot be
read, even if the first piece fails to receive, even if there is no header, only that track drops from the table
and the rest goes on. Alignment correction is a **nice-to-have**, not a precondition of subtitle extraction.

`abs(off) >= 0.5` is only a line dividing whether to report on screen and does not participate in the
computation. A correction below 0.5 second happens but does not clutter the log. The discussion of the threshold's
basis grade is the same context as Chapter 22 §22.4 — this value is not measured but a convention for
readability.

### 27.3.5 What is excluded from the computation

```python
# cli.py:252-262
    # some deliveries put a finished file (.srt) in the subtitle track URI instead of a subtitle playlist.
    # such a file has no X-TIMESTAMP-MAP so there is no basis to compute an offset at all, so
    # exclude it from correction — believe the written times as-is (treated the same as a sidecar subtitle).
    segmented: list[playlist.Media] = []
    for track in tracks:
        if not track.uri:
            continue
        if playlist.is_playlist_uri(track.uri):
            segmented.append(track)
        else:
            _eprint(f"    · {track.label()} is a finished subtitle file so there is no alignment reference — use it without correction")
```

> **Term** — **sidecar**: a subtitle placed as a **separate file** rather than inside the video container. In
> this repository, a subtitle not declared in the playlist but existing separately as a static file is called
> this specifically ([`subtitles.py:377-395`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L377-L395)).

An unchopped finished subtitle has no correspondence table. It does not guess and fill the absent, but sets it as
**"believe the written times as-is"** and outputs that decision to screen. Why this matters — when that subtitle
later turns out to be off, whether the correction was not done or was done wrong must be in the log to narrow the
cause.

The embed path keeps the same distinction.

```python
# cli.py:573-575
    if embed_tracks and args.sub_embed:
        # the offset applies only to HLS tracks. a sidecar is a finished file so it has no X-TIMESTAMP-MAP.
        offsets = _subtitle_offsets(chosen_subs, media, fetcher, headers)
```

`embed_tracks` includes even local files received as sidecar, but only `chosen_subs` (HLS tracks) is passed to
the offset computation. A track not in the table becomes `0.0` on lookup so a sidecar automatically drops from
correction.

### 27.3.6 Application ① sidecar path — fix the file

```python
# subtitles.py:157-161
            res.ok = True
            res.duplicates, res.header_leaks = dedupe(dest, fmt)
            res.offset = (offsets or {}).get(track.uri or "", 0.0)
            shift(dest, fmt, res.offset)
            res.cues, res.first_cue, res.last_cue = measure(dest)
```

The order of all three has meaning.

| Order | Why that spot |
|---|---|
| `dedupe` first | boundary-duplicate removal deletes cues with the **same time and body.** doing it after the shift gives the same result, but the time used for duplicate judgment must be the original value for the log's numbers to compare with the delivered values (Chapter 29) |
| `shift` in the middle | actually rewrites the file's cue times |
| `measure` last | you must measure the times **after the shift** for the report's `60.0~89.0s` to be the output's actual value. reverse the order and the report reports normal while only the file is slipped |

`shift` itself is one regex substitution.

```python
# subtitles.py:221-231
def shift(path: Path, fmt: str, seconds: float) -> int:
    """Shift all cue times in the subtitle file by seconds. Returns: number of cues shifted."""
    if abs(seconds) < 0.001:
        return 0

    def fmt_time(total: float) -> str:
        total = max(0.0, total)
        h, r = divmod(total, 3600)
        m, s = divmod(r, 60)
        sep = "." if fmt == "vtt" else ","
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d}{sep}{int(round((s % 1) * 1000)):03d}"
```

`abs(seconds) < 0.001` is a **1-millisecond deadzone.** It blocks rewriting the whole file over floating-point
residue (§27.2.5's `2.2e-07`). The `sep` branch is because WebVTT uses `.` for the decimal and SubRip uses `,` —
change the format and the player does not recognize that line as a cue.

`total = max(0.0, total)` cuts a negative time to 0. This one line makes an observable result in §27.6.4.

### 27.3.7 Application ② embed path — hand it to ffmpeg

```python
# subtitles.py:359-366
    for i, track in enumerate(tracks, start=1):
        inputs += input_args(headers, track.uri or "")
        # ffmpeg does not apply a subtitle input's X-TIMESTAMP-MAP itself, so
        # give the precomputed alignment offset directly as an input option.
        off = (offsets or {}).get(track.uri or "", 0.0)
        if abs(off) >= 0.001:
            inputs += ["-itsoffset", f"{off:.3f}"]
        inputs += ["-i", track.uri or ""]
```

> **Term** — **`-itsoffset`**: ffmpeg's **input** option. It shifts all timestamps of the immediately following
> `-i` input by the specified seconds. Being an input option, not an output option, it must be placed before `-i`,
> and it is specified per input.

The reason it does not fix the file here is **because there is no file to fix.** On the embed path the subtitle is
a remote playlist URL, and ffmpeg receives it and puts it straight into the container. Making an intermediate
output, fixing it, and re-inserting it only adds one more round-trip.

`abs(off) >= 0.001` — the same value as `shift`'s deadzone. Since the two paths judge "no correction" by the same
criterion, no off-ness arises where one side attaches the argument and the other does not. (That the same constant
is written literally in two places is noted in §27.7.)

That `embed_args` ([`subtitles.py:339-374`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L339-L374)) places the argument **before** `-i` is essential too. ffmpeg's input options
have positional meaning, so place it after and it is interpreted as an output option or ignored.

### 27.3.8 One computation, two application points

![The structure where two application paths share one offset computation](/images/lecture/hls-recon/27-one-offset-two-paths.svg)

*Figure 27-2 — the offset computation is in `_subtitle_offsets` alone, and the sidecar path and the embed path only apply that result by different methods*

This structure is this chapter's second point.

> **What the two paths differ in is the "application method," not the "computation." Since the computation is in
> one place, if the formula is wrong the two paths are wrong together — there is no one path quietly going off.**

Had the two paths been implemented separately, what failure is possible. A change fixing only the sidecar side and
forgetting the embed side, a mistake flipping the sign on only one side, a change altering the deadzone on only
one side — all **surface on only one path so a test not using that path passes.** It is also why this repository
puts a defect-injection test for each of the two paths separately (`tests/run.sh:489-510`).

The same principle is one layer up too. Subtitle extraction is shared by the "extract while receiving" path and
the "fill only subtitles" path (`--refill-subs`), and the reason is stated in the function docstring.

```python
# cli.py:373-378
    """Extract the chosen subtitle tracks as separate files beside the video.

    The extract-while-receiving path (`_run_one`) and the fill-only-subtitles path (`--refill-subs`)
    share this. If the alignment correction and the file-name rule diverge in the two paths, the
    subtitle filled later is subtly off and the cause is hard to point to.
    """
```

### 27.3.9 Do the two paths land at the same spot — measured

I put the same off stream (a track with `MPEGTS` set to +60 seconds) into the two paths each.

| Path | Application method | The output's first subtitle time | Cue count |
|---|---|---|---|
| sidecar (`.vtt` file) | rewrite the file with `shift()` | **60.000s** | 6 |
| embed (`.mkv`) | `-itsoffset 60.000` | **60.000s** | 9 |

The times match exactly. **The cue counts differ** — the sidecar path deletes 3 boundary-duplicate cues with
`dedupe` but the embed path does not. Even though the offset computation is shared, **the post-processing is not
shared.** Honestly, the statement "the two paths give the same result" is true **for alignment only.** This
asymmetry is written again in §27.7.

---

## 27.4 Why does ffmpeg not do it for you

The basis for this repository's code computing the offset itself is in one comment line.

```python
# subtitles.py:194-197
    X-TIMESTAMP-MAP=LOCAL:<subtitle time>,MPEGTS:<90kHz clock> is a correspondence table saying 'this
    subtitle time corresponds to this clock value on the video timeline'. ffmpeg 8.1.1 does not apply
    this mapping regardless of the input configuration (measured: opening via a master input, the result
    with MPEGTS changed is the same), so compute and correct directly. Nonzero means the subtitle is slipped that much.
```

I confirmed this claim by measurement. Extract by opening each of two subtitle playlists with completely the same
cue content and only the `MPEGTS` value differing by 60 seconds, as standalone inputs.

```bash
ffmpeg -v error -y -i subok/index.m3u8  -map 0:s:0 -c:s webvtt subok.vtt
ffmpeg -v error -y -i subbad/index.m3u8 -map 0:s:0 -c:s webvtt subbad.vtt
diff subok.vtt subbad.vtt
```

The result — **the cue times were completely the same for the two files.** The difference `diff` caught was only
the four lines of `X-TIMESTAMP-MAP=…` strings mixed into the cue body. That is, ffmpeg **did not use that header
for alignment** and rather **flowed it into the body** (this is the header leak Chapter 29 covers).

I went one step further. If the reason were "because the video is not in that input," opening a master playlist
holding both video and subtitles should apply it.

```bash
ffmpeg -v error -y -allowed_extensions ALL -i master-ok.m3u8  -map 0:s:0 -c:s webvtt m-ok.vtt
ffmpeg -v error -y -allowed_extensions ALL -i master-bad.m3u8 -map 0:s:0 -c:s webvtt m-bad.vtt
```

**The two outputs were byte-for-byte identical.** The mapping was not applied here either. Instead something else
happened — every cue was pulled forward by 1.4 seconds and the first cue vanished. As the whole input was
rearranged by the container's start time (audio first PTS = 1.400000 seconds), a cue that came to sit before that
was cut off.

Organized it is this.

| Input | X-TIMESTAMP-MAP applied | What actually happened |
|---|---|---|
| subtitle playlist standalone | no | the header leaked into the cue body |
| video+subtitle master | no | the whole input was pulled by the container start time |

**"Because the video is absent" was the code comment's explanation, and what the measurement shows is broader** —
in this version it was not applied even with the video present. On the basis of this result the comment was fixed
as quoted above. The circumstances are written in Chapter 30 §30.2.4.

There is one more piece of circumstantial evidence. Pull strings from this version's `libavformat` binary and
`WEBVTT` appears 15 times but `X-TIMESTAMP-MAP` appears **not once.** It reads as meaning there is simply no code
parsing the header.

Only, two things could not be confirmed. This second experiment is an abnormal use pulling only the subtitle
stream with `-map 0:s:0` so **whether it is the same on the playback path is unknown**, and the string absence
does not exclude a case implemented with character-unit comparison or macro assembly (§27.7).

Here comes one general principle. Said in advance of Chapter 30's subject, it is this.

> **If you do not know what the delegated tool does not do, you come to report as success a result where the
> undone work is quietly missing.** The delegation boundary must be confirmed by measurement, not a document.

---

## 27.5 Generalization — the problem of matching different clocks

### 27.5.1 NTP — why offset and delay must be separated

The same problem is at the center of distributed systems. To match two machines' clocks you must know the
translation amount between the two clocks.

> **Term** — **NTP (Network Time Protocol)**: a protocol matching a local clock to a reference clock beyond the
> network. It estimates the clock difference by a round-trip measurement.

NTP measures four times — client send `T1`, server receive `T2`, server send `T3`, client receive `T4`. From
these it pulls two values.

```
offset θ = ((T2 − T1) + (T3 − T4)) / 2
round-trip delay δ = (T4 − T1) − (T3 − T2)
```

Set beside `X-TIMESTAMP-MAP` and the difference is sharp.

| | X-TIMESTAMP-MAP | NTP |
|---|---|---|
| How the correspondence point is obtained | the packager **declares** it (in-band delivery) | **measured** by round-trip |
| Delay term | none — the correspondence is already fixed at packaging time | required — because the measurement itself passes through the channel |
| Unknowns | one, `b` | two, `θ`, `δ` |
| Holding condition | the two axes' clocks are the same (`a = 1`) | the round-trip path's **delay is symmetric** |
| If that condition breaks | the subtitle slips in proportion to time | the offset estimate is biased by half the asymmetry |

The last two rows are the point. **Both systems reduce the unknowns at the price of one unverifiable assumption.**
NTP has no way to measure the path asymmetry, and `X-TIMESTAMP-MAP` has no slot to write the clock-speed ratio. To
remove the assumption you need more correspondence points or measurements, and that makes the protocol heavier.

### 27.5.2 Real cases where the scale is not 1

`a ≠ 1` is not a theoretical possibility but a common reality.

| Case | The two axes | Scale `a` | How it is handled |
|---|---|---|---|
| NTSC video | real-time seconds vs 29.97fps timecode | `1000/1001 ≈ 0.999001` | **drop-frame timecode** — skip not frames but **frame numbers** to hold the notation onto real time |
| audio clock drift | a capture card's 48kHz vs the system clock | 1 ± tens of ppm | absorb by resampling or re-sync periodically |
| server-log correlation | two machines' local clocks | 1 ± 20–100ppm (a crystal oscillator) | NTP estimates the offset and **frequency** together and corrects |
| embedded sensor fusion | sensor clock vs host clock | 1 ± hundreds of ppm | keep gathering correspondence points and update `a`, `b` by linear regression |

Attach the size sense of the third row. 100ppm is **8.64 seconds a day** (`100e-6 × 86400`). Someone trying to
align two servers' logs by time to reconstruct an event order comes, without NTP, to make an 8-second
misunderstanding after a day. And 8 seconds is **large enough to reverse the order** in most event correlations.

The first row is especially instructive. Drop-frame timecode solves `a ≠ 1` not by **throwing away frames** — what
it throws away is numbers and the video is intact. It is an attempt to return a scale problem to a translation
problem, and at the price it left the lifelong confusion "the timecode value and the frame count are not
one-to-one."

### 27.5.3 The path of giving up a common clock

Joining two axes by an affine correspondence is not the only answer. There is a path that does not use a physical
clock at all and handles only **causal order.**

> **Term** — **logical clock**: a counter recording only the **before-after relationship** of events instead of
> physical time. Lamport clocks, vector clocks are representative.

| Approach | What it answers | What it cannot do |
|---|---|---|
| affine correspondence (this chapter·NTP) | "at what time did this event happen" | quietly wrong if the clock assumption breaks |
| logical clock | "is this event before that event" | cannot tell the actual elapsed time |
| hybrid (hybrid logical clock) | both, approximately | must know the upper bound of the physical clock error |

In subtitle alignment a logical clock cannot be used. **Because "the subtitle is before the line" alone cannot
set when to put it on screen.** Dividing a problem that essentially needs physical time from one that needs only
order is a judgment to make first in distributed-system design.

### 27.5.4 A list of the same structure

| Domain | Axis A | Axis B | What gives the correspondence point | Is `a = 1` |
|---|---|---|---|---|
| HLS subtitle | WebVTT local time | MPEG-TS 90kHz | `X-TIMESTAMP-MAP` | yes (the spec presupposes) |
| container multiplexing | audio sample number | video PTS | each stream's time_base | yes (same STC reference) |
| distributed tracing | service A's span time | service B's span time | the wall clock matched by NTP | mostly (error exists) |
| forensic log correlation | firewall log time | endpoint log time | a reference clock (if any) | often not |
| financial-transaction audit | exchange time | participant time | a synchronization regulation requires (e.g. a max-deviation cap) | enforced |
| subtitle reuse | original subtitle time | a different edition's video | none — **a human matches it** | may not be (per-edition editing differences) |

The last row reflects this chapter's problem in reverse. Attach a subtitle to a different edition's video
(director's cut·broadcast cut) and **even translation does not match** — if there is a scene cut out in the
middle, the correspondence becomes a **per-segment different affine transform**, i.e. a chopped correspondence.
This repository does not handle such a case and does not claim it can.

---

## 27.6 Security — the time mapping is a value outside the trust boundary

### 27.6.1 Who writes this header

`X-TIMESTAMP-MAP` is **text inside a subtitle piece's body.** That is, whatever emits the subtitle segment can
write it, and there is no higher authority to verify that value. The same structure as seen in Chapter 14 —
**self-reported metadata**, and HLS has no signature or integrity binding tying the subtitle track and the video
track.

Enumerate the actors who can control the value and it is this.

| Actor | Why they can change the value |
|---|---|
| the origin server·packager | it is the side making the value. mistake or intent |
| CDN·intermediate cache | it is in a position to rewrite the response body |
| a man-in-the-middle on a plaintext HTTP path | a subtitle segment is usually small and text so it is easy to modify |
| the side swapping the subtitle file | swap only the track URI for a different subtitle and the same result comes |

### 27.6.2 What a wrong mapping makes

From the byte-integrity view **nothing happened.** The subtitle file is intact, the video is intact, and the
hashes all match. What went off is only the relationship between the two.

| Manipulation | Observed result | Caught by a byte check |
|---|---|---|
| a small offset (a few seconds) | the subtitle goes off from the scene — **the line attaches to a different character** | no |
| a large offset (exceeding the video length) | the same as the subtitle vanishing whole | no |
| a large negative offset | the cues are pushed forward and cut or mashed | no |
| header removal | no correction happens — **a non-correction that looks normal** | no |

The first row is the hardest to handle. **A manipulation that changes the meaning without changing a single
character of the text**, and in a context where the subtitle is used for interpretation·court records·educational
material, that itself amounts to content forgery. And however much you verify the subtitle file's signature it is
not caught — because the signature target is the **file**, not the **relationship between the file and the
video.**

> **An integrity check protects only what is designated as the check target. The relationship between two
> resources is in neither one's hash.**

### 27.6.3 The defense the code does and does not do

| Defense | Location | What it blocks |
|---|---|---|
| reject a negative `MPEGTS` | [`subtitles.py:208-210`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L208-L210) | input made to be interpreted as a signed value. by spec it is a 33-bit unsigned value so a negative is invalid |
| `None` on integer-parse failure | [`subtitles.py:205-207`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L205-L207) | a value not readable as an integer. only, since the regex captures only `-?\d+`, this branch is currently unreached — `MPEGTS:1e9` is cut to `1` and matched (measured) |
| `None` if no header | [`subtitles.py:200-202`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L200-L202) | a baseless guess. degenerates to the non-correcting side |
| cross-validate the result | [`report.py:431-440`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L431-L440) | whether the applied offset **makes sense**, against the video length |
| baseline from the declared value, not the measurement | [`report.py:339-342`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L339-L342) | self-reference where a slipped subtitle drags its own reference (Chapter 38) |

The first three are **input hygiene**, and the last two are the real defense. If the value is formally normal —
`MPEGTS:5528090` is a perfectly normal 33-bit value — an input check cannot filter it. The spot it is caught is
only **where you see whether the result makes sense.**

```python
# report.py:431-440
            elif good and video_len > 0:
                strayed = [r for r in good if r.last_cue > video_len + 5.0 or r.first_cue < -0.5]
                if strayed:
                    # the cause differs by source. an HLS track applied the alignment mapping wrong,
                    # a sidecar picked up a subtitle of a different video in the first place.
                    cause = (
                        "possibly a subtitle for a differently-named video — check --sub-name"
                        if all(r.sidecar for r in strayed)
                        else "suspect X-TIMESTAMP-MAP alignment failure"
                    )
```

**Since one value can point at two causes, the cause is split and written by source.** For the same symptom (the
subtitle out of the video range), if it is an HLS track it says suspect a mapping failure, and if a sidecar,
suspect a subtitle of a different video. It is the spot where the diagnostic message changes the investigation
direction.

### 27.6.4 Detection is not symmetric — measured

Here I write the asymmetry confirmed by measurement. I made §27.6.2's third row, i.e. **the case where the offset
is negative.** Keep `MPEGTS` in the normal range and set only `LOCAL` large.

```
X-TIMESTAMP-MAP=LOCAL:00:01:00.000,MPEGTS:128090
→ offset = 1.423222 − 1.423222 − 60 = −60.000
```

The two paths' results **differed from each other.**

| Path | The output's subtitle time | Report verdict | Exit code |
|---|---|---|---|
| sidecar | every cue `00:00:00.000 --> 00:00:00.000` | **WARN** — "min coverage 0% — xx 0.0–0.0s" | 0 |
| embed (`.mkv`) | subtitle 0.0–29.0s, **the video moved to 60.023s** | **PASS** — "embedded subtitle 0.0–29.0s vs video 30.0s" | 0 |

Both paths **failed to give a FAIL.** The reasons differ.

- **sidecar** — `shift`'s `total = max(0.0, total)` ([`subtitles.py:227`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L227)) cuts a negative time to 0. So the
  report's `first_cue < -0.5` condition **cannot hold in principle.** The result of every cue being mashed to 0
  only catches on a different check, coverage 0%, as WARN.
- **embed** — ffmpeg applied `-itsoffset -60.000` and the subtitle timestamps went negative, so at the muxing
  stage it **moved the whole file by +60 seconds.** The output's video first frame sat at 60.023 seconds and the
  container length became 90.023 seconds. The **relative relationship** of subtitle and video is as requested but
  the whole file slipped. And since the report compares the subtitle's absolute time (0.0–29.0s) with the
  **playlist-declared length** (30.0s), it does not see this anomaly and gives a PASS.

The second item is **another face of the baseline problem** Chapter 38 covers. The decision to take the declared
length as the baseline was right for blocking self-reference contamination, but **the case where the output's
start time is not 0** is not caught by that baseline. One baseline does not cover every kind of straying.

Organized it is this.

> **A subtitle slipped backward is caught as FAIL, and a subtitle slipped forward is not caught.**
> This is not a designed asymmetry but an incidental result two implementation details made (the 0 clamp, the
> muxer's negative avoidance).

Chapter 28 §28.5.2 derives the same asymmetry from the verdict code, from a **much larger cause** (33-bit
wrapping, error 26.5 hours). What is written here is the **end-to-end execution confirmation** of that derivation,
and the embed-path behavior that chapter left as "not measured" is the part filled in by this measurement — a
large negative `-itsoffset` appeared as **moving the whole file** instead of cutting the subtitle.

### 27.6.5 The defender's view

| Role | What to do |
|---|---|
| **delivery operator** | carry `X-TIMESTAMP-MAP` accurately in every subtitle piece. omit it and the client guesses on its own, and that guess differs per player. make the subtitle and video come from the **same packaging batch** to match the two axes' references |
| **player·client implementer** | treat the mapping value as input outside the trust boundary. after a range check, always cross-validate **whether the result falls within the video length.** on validation failure do not throw away the subtitle but **display it uncorrected and notify that fact** — a quiet correction becomes a quiet error |
| **verification-tool maker** | take the baseline independently of the measurement target (Chapter 38). and **test in both directions** — like §27.6.4's negative direction, a test fixing only one side passes the hole in the opposite direction (Chapter 37) |
| **forensic·auditor** | presuppose the time mapping itself is a manipulation target. in log correlation, timestomping does not erase evidence but **changes the order.** you must preserve the original time and the normalized time together to undo it |
| **content reviewer** | subtitle consistency **is not confirmed by a file-integrity check.** there is a domain where a check by playing and seeing with the eye is still needed |

### 27.6.6 The reverse direction — what this computation leaks

The offset value is recorded in the report JSON as `timestamp_offset_sec` ([`report.py:375`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L375), [`report.py:492`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L492)). This
value contains `video_pts0`, and that is the **start coordinate the packager chose.** In this measurement that
value was video 1.423222 seconds / audio 1.400000 seconds, and the 1.4-second start point is ffmpeg's mpegts
muxer default. That is, this number becomes a **weak fingerprint of which tool was used to package.**

The risk is low. But the principle is the same as Chapter 12 — **what information follows a value left for
diagnosis is worth weighing once before leaving it.** Here the diagnostic worth is much greater so leaving it is
judged right.

---

## 27.7 Limits and open questions

Written honestly.

- **The reference point is slightly off.** The code takes `first_pts` (the first-packet PTS of video v:0) as the
  reference, but what ffmpeg uses when rearranging the input is the **container start time** (the earliest of all
  streams). In the measured fixture it was video 1.423222 seconds / audio 1.400000 seconds, a **23.2ms**
  difference, and the subtitle sits that much early. It is confirmed by the output's video first frame sitting at
  0.023 second. It is small so it is not a problem in real use, but **it is a systematic error, not noise.** It
  grows if the packager sets a large gap between audio and video start.
- **The correspondence point is read only from the first piece.** [`cli.py:280`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L280) receives only the subtitle
  playlist's first segment, reads the header, and applies that offset to the whole track. If the timeline breaks
  with `EXT-X-DISCONTINUITY` or the 90kHz clock wraps (Chapter 28), the correspondence becomes a **per-segment
  different affine transform** and the later part is wrong with one offset. **I could not reproduce and confirm
  this case** — there is no discontinuity-stream fixture with subtitles.
- **`a ≠ 1` is not even detected.** Meet a stream where the two axes' clock speeds differ and this code makes a
  subtitle that matches only at the start and widens toward the end. Gathering correspondence points per piece and
  regressing could detect it, but there is no such code now. That it must not happen by spec is the only basis.
- **A negative offset is not caught as FAIL.** §27.6.4's measurement. The `first_cue < -0.5` condition can never
  be true on the sidecar path because of `shift`'s 0 clamp, and the embed path dodges the check because the whole
  file moves. There are two directions to fix — have `shift` report the result instead of cutting the negative
  time, or have the report include even the **output's start time** in the baseline. Neither is done yet.
- **What the two paths share is only the offset.** Only the sidecar path goes through `dedupe` so boundary-
  duplicate cues remain in the embedded subtitle (measured: 6 cues vs 9). The statement "the two paths give the
  same result" is true **for alignment only.**
- **The 1-millisecond deadzone is written in two places each.** [`subtitles.py:223`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L223) and [`subtitles.py:364`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L364)
  have the same `0.001` as a literal. They match now but change one and the two paths diverge — the offset
  computation was shared but the **criterion of whether to use that computation** was not shared.
- **ffmpeg's non-application of the mapping was confirmed on one version only.** It was measured only on 8.1.1,
  and the master-input experiment is a use pulling only the subtitle with `-map 0:s:0` so it cannot be asserted the
  same as the general playback path. If the upstream changes this behavior, this repository's correction becomes a
  **double application** and the subtitle is slipped twice as much — what to notice that by is not set.
- **The spec's own clause numbers were not cross-checked.** `X-TIMESTAMP-MAP`'s form and meaning were confirmed by
  code and measurement, but the relevant RFC 8216 clause number was not matched against the original in this
  chapter so it is not attached. It is a matter to settle in Appendix B (the spec cross-reference table).

---

## 27.8 Summary

1. A subtitle file and video have **each their own time axis.** A subtitle piece starts at its own time 0, and the
   video timeline starts at an arbitrary PTS the packager chose (measured 128,090 tick = 1.423222 seconds).
   Without a rule joining the two, merge an intact subtitle and an intact video and a wrong result comes out.
2. `X-TIMESTAMP-MAP=LOCAL:…,MPEGTS:…` is a correspondence table declaring **one correspondence point.** The reason
   HLS chose this form is that alignment must be possible with one piece alone (LIVE mid-stream join), and at the
   same time that the original subtitle file need not be rewritten.
3. The general form joining two time axes is the **affine transform** `V = a·S + b`. Since the two axes count the
   same physical second, `a = 1` and **only translation is left.** So one correspondence point is enough — and the
   fact itself that only one correspondence point fits the header form is the declaration of that assumption.
4. The three terms of `offset = mpegts/90000 − video_pts0 − local_sec` correspond to the **three origins**, one
   each. `mpegts/90000` is the correspondence point's video-axis coordinate, `video_pts0` is where the output
   axis's origin sits, and `local_sec` is the share the cue itself already holds.
5. **ffmpeg does not apply this mapping** (measured: the extraction results of two tracks differing only by
   `MPEGTS` 60 seconds are identical down to the cue times). So the sidecar path fixes the file with `shift` after
   extraction, and the embed path hands it to ffmpeg with `-itsoffset`.
6. **What the two paths differ in is the application method, not the computation.** Since it is computed in one
   place, `_subtitle_offsets`, and handed over as a per-track table, if the formula is wrong the two paths are
   wrong together — there is no one path quietly going off. This is the spot dividing duplicate implementation
   from sharing.
7. The time mapping is a **value outside the trust boundary.** A wrong mapping changes the meaning without
   changing a single character of the subtitle text, and **is caught by neither file's hash.** The spot it is
   caught is only the cross-validation against the video length, and even that validation is asymmetric by
   direction as seen in §27.6.4.
8. The same problem structure is throughout distributed systems. NTP must **measure** the correspondence point so
   it additionally needs a delay term, and both systems reduce the unknowns at the price of **one unverifiable
   assumption** (clock sameness / delay symmetry).

---

**Next chapter** — this chapter's code has three lines passed over without explanation. That is `if mpegts < 0:
return None` and the comment above it, "a 33-bit unsigned value is the spec so a negative is invalid." The width
of 33 bits means the clock returns to 0 about every 26.5 hours, and that return collapses the affine
correspondence this chapter set up at one spot. Chapter 28 covers that wrapping, and what collapses if you do not
put a range check on untrusted input — it is also why this repository's test left the comment **"must not make it
negative"** in the defect-injection code.
