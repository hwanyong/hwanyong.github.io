---
title: "Stream and File"
description: "Two ontologies"
date: 2026-05-20
version: '1.0'
tags: ['streaming', 'foundations']
thumbnail: /images/lecture/thumb/hls-recon-01-stream-vs-file.svg
---
## 1.0 What this chapter answers

1. When `ffmpeg -i master.m3u8 -c copy out.mp4` exits 0, what does that guarantee?
2. Six seconds are gone entirely, so why does the total playback length match a clean run?
3. What is different about a stream and a file, such that something is lost in the conversion?
4. Why are reassembly and verification different in difficulty — one a single command, the other ten checks?

---

## 1.1 The problem — a command that calls itself a success

The reason the tool this course studies (`hls-recon`) exists is stated by the first section of its README in a single command.

```bash
# README.md:17-19
ffmpeg -i master.m3u8 -c copy out.mp4     # it downloads. But —
```

> `README.md:21-30` — this command **silently skips** a segment that drops out with an HTTP 404 and
> **exits 0.** The total playback length is unchanged too — an MPEG-TS segment carries an absolute
> presentation timestamp (PTS), so even when a middle piece disappears, the timestamps of the pieces
> behind it stay where they were.
>
> ```
> one 6s segment missing → ffmpeg exit code 0, output length 30.03s (identical to clean)
>                        → in reality the 5.99s – 12.02s span is entirely empty
> ```

The claim is strong, so reproduce it directly. All you need is `ffmpeg` and `python3`; no external server.

> **Term** — **HLS (HTTP Live Streaming)**: a delivery method that splits video into pieces of a few
> seconds each, sends them over ordinary HTTP GETs, and points to the list of those pieces with a text
> file (an M3U8 playlist). Specified by RFC 8216.
>
> **Media segment**: one of those pieces. In this lab it is five 6-second MPEG-TS files.

### 1.1.1 Reproduction

```bash
# make a 30-second test pattern as 6s × 5-segment HLS (same approach as tests/run.sh:37-44)
ffmpeg -v error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset ultrafast -g 60 -keyint_min 60 -sc_threshold 0 \
  -pix_fmt yuv420p -c:a aac -b:a 128k source.mp4

ffmpeg -v error -y -i source.mp4 -c copy -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "plain/seg%03d.ts" plain/index.m3u8

# damaged copy — remove only the second segment. Leave the playlist untouched
cp -R plain damaged && rm damaged/seg001.ts

python3 -m http.server 8991 --bind 127.0.0.1 &
ffmpeg -v error -y -i "http://127.0.0.1:8991/plain/index.m3u8"   -c copy good.mp4
ffmpeg -v error -y -i "http://127.0.0.1:8991/damaged/index.m3u8" -c copy naive.mp4
```

Because the playlist was left as is, the request for `seg001.ts` receives an **HTTP 404**. And yet both
commands finish without a word.

```
plain   exit=0
damaged exit=0
```

Measurements (ffmpeg 8.1.1, macOS):

| Observed metric | clean `good.mp4` | damaged `naive.mp4` | Does it respond to the fault? |
|---|---|---|---|
| ffmpeg exit code | `0` | `0` | **No** |
| stderr output | none | none | **No** |
| `format=duration` | `30.023401` | `30.023401` | **No** — not one digit differs |
| Does the container open? | opens | opens | **No** |
| Does it decode to the end? | success | success | **No** |
| `avg_frame_rate` | `30/1` | `24/1` | Yes — but there is no baseline |
| `nb_frames` | `900` | `720` | Yes — but there is no baseline |
| `format=size` | `7,899,819` | `6,319,406` | Yes — but there is no baseline |

> **Term** — **exit status**: the integer a process leaves to its parent as it terminates. By POSIX
> convention `0` is success. A shell's `&&` and a CI pipeline's step progression turn on this one value.

### 1.1.2 "There is no baseline" is the crux

Size, frame count, and average frame rate clearly do change. And yet these three **cannot be used for
verification** — because there is nothing to compare them against.

Everything the HLS playlist declares as a quantity that could serve as a reference is the following.

```
#EXT-X-TARGETDURATION:6      ← maximum segment length
#EXTINF:6.000000,            ← per-segment length. sum of 5 = 30.00s
#EXT-X-ENDLIST               ← marks the list as complete
```

**Neither frame count nor a hash is in the spec.** A byte count is declared only when `EXT-X-BYTERANGE`
is used, which addresses a segment as a byte range within one file. In this stream, where each segment
is a separate file, the only quantity the receiver can know in advance is **length**. And length is the
one quantity this fault does not touch.

> The single baseline the manifest declares happens to be the quantity completely insensitive to the fault.

`avg_frame_rate` is worse off. The clean copy reads `30/1`, the damaged copy `24/1` — because ffprobe
**recomputes** the average **from the file's own frame count and length** (720 ÷ 30.023401 ≈ 23.98 →
`24/1`). That is, frame count and average frame rate are not independent; one is derived from the other,
and when loss occurs **the two move together** and cancel each other out.

> **When the thing being measured drags its own measuring standard along, that check always passes.**

That is exactly why this repository explicitly avoids the same trap in its subtitle check — embedding
subtitles into the container stretches the total duration out to the end of the subtitles, so if you
take the measured length as the baseline, a shifted subtitle drags the baseline itself along and the
check always passes ([`report.py:339-342`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L339-L342)).
So the baseline is the **playlist's declared length**. That is the subject of Chapter 38.

---

## 1.2 The principle — a stream and a file are different beings

The root of the problem is not a defect in ffmpeg. It is that **a stream and a file are different kinds
of object.**

| | Stream | File |
|---|---|---|
| Identity | a **sequence of events** with a temporal order | a **single state** at one instant |
| Count | `n` HTTP transactions (5 in this example) | 1 |
| End | not inside it — a **separate declaration**, `#EXT-X-ENDLIST`, announces it | the size is the end |
| Completeness | undefined. there is only "what has arrived so far" | decidable from file size and structure |
| Failure | happens per event (one 404, one delay) | visible only per file |
| Reproducibility | impossible — a second request may get a different response | possible — reread the same bytes |
| Observability | only while it flows | at any time |

The last row is the whole of this chapter.

![From stream to file — what the conversion throws away](/images/lecture/hls-recon/01-stream-to-file.svg)

*Figure 1-1 — a stream is five receive events, a file is one state. The status code, latency, and hash
observed at each receipt are nowhere in the output the moment they pass through concatenation and muxing.*

`-c copy` is **lossless** — with no re-encoding, not one bit of the video bytes changes. And yet this
conversion is lossy. Because **what is lost is not the video but the observation information.**

- the fact that the request for `seg001` was a 404
- the fact that the request was retried
- each segment's arrival time and SHA-256

These three have nowhere to be represented inside the output `naive.mp4`. There is no standard box in the
MP4 container to write "this file was made from four of five pieces," and even if there were, the party
writing it would be the very tool that knew about the loss.

> **A file does not record how it was made.** Therefore an attempt to recover the facts of the receive
> layer from the file after the fact fails in principle. To record them, you must do it **at the very
> place the conversion happens.**

This is why `hls-recon` delegates the reassembly itself to ffmpeg ([`assemble.py:1-6`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L1-L6)) yet does the receiving
itself. The README summarizes this design in one line.

> `README.md:32-34` — hls-recon delegates the reassembly itself to ffmpeg, and separately instruments
> **only what ffmpeg does not report**: per-segment HTTP outcome and latency, the MPEG-TS continuity
> counter, and timeline gaps in the reassembled output.

---

## 1.3 Why the total length hides the loss

Suppose we missed the receive layer. With only the file left, can you see the 6-second hole? Here the
second principle, **the absolute timestamp**, comes in.

> **Term** — **PTS (Presentation Time Stamp)**: a value indicating when this frame should be presented
> on screen. In MPEG-TS it is carried as a **33-bit unsigned integer on a 90kHz clock**. What matters is
> that this is **not an interval from the previous frame but an absolute coordinate on the timeline.**

Comparing two designs makes the difference clear.

| Time representation | when one piece disappears |
|---|---|
| **relative interval** (+Δ from the previous frame) | everything behind is pulled forward → **the total length shrinks by 6 seconds** |
| **absolute coordinate** (PTS, the MPEG-TS way) | the coordinates of the pieces behind stay put → **the total length does not change** |

MPEG-TS uses absolute coordinates. Multiple receivers joining the stream at arbitrary points must still
arrive at the same interpretation of time (a requirement of a format born in broadcast). That property
is a virtue for playback and a trap for verification.

![The total length is the same and the middle is empty](/images/lecture/hls-recon/01-timeline-hole.svg)

*Figure 1-2 — even in the damaged copy, `seg002`'s PTS is still 12.02s. Because the pieces behind are
not pulled forward, the total length is exactly the same as the clean copy, and the loss shows up only
as a hole on the timeline.*

### 1.3.1 But it is not always so

This proposition is limited to a **middle loss**. Move the same experiment to the first or last segment
and the result changes.

| Missing segment | ffmpeg exit code | output length | caught by total length? |
|---|---|---|---|
| none (clean) | `0` | `30.023401` | — |
| `seg001` (middle) | `0` | `30.023401` | **No** |
| `seg000` (first) | `0` | `24.000000` | Yes |
| `seg004` (last) | `0` | `24.032653` | Yes |

Boundary loss cuts off one end of the timeline, so it appears directly in the length, and this
repository's **length-consistency** check catches it — if the drift from the declared 30.00s is at least
`TARGETDURATION` (6s), it is a FAIL ([`report.py:262-278`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L262-L278)).

```python
# report.py:264-272
        drift = media.duration - declared_duration
        drift_pct = abs(_pct(drift, declared_duration))
        # if off by at least one segment, treat it as an interval loss.
        if target_duration and abs(drift) >= target_duration:
            verdict = FAIL
        elif drift_pct > 0.5:
            verdict = WARN
        else:
            verdict = PASS
```

**In other words, what the total-length check catches is the loss that is easy to spot, and what it
misses is the loss that is invisible.** The check's blind spot coincides with exactly the hardest case
to find.

---

## 1.4 The code — what to observe instead

If the total length is powerless, there is one alternative. **Look at the distribution, not the total.**
Sweep through all the presentation-time intervals of adjacent frames and find where they open up
abnormally.

```python
# probe.py:191-198
def gap_scan(path: str, factor: float = 3.0, floor: float = 0.4) -> GapScan:
    """Sweep the presentation times of the video track to find loss intervals.

    A total-length comparison cannot catch a lost middle segment. An MPEG-TS segment
    carries an absolute PTS (presentation time), so even when a piece is missing the
    timestamps of the pieces behind it stay put and the total length is unchanged.
    Loss shows up not as a total but as a hole in the timeline, so look at adjacent
    frame intervals directly.
    """
```

The core computation is ten lines.

```python
# probe.py:222-233
    # if there are B-frames, packet order differs from display order, so sort by time.
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

Here are three decisions to note. Read all three as "what breaks if you do not do this."

| Decision | if you do not |
|---|---|
| `times.sort()` — sort by time | `ffprobe` emits packets in **storage order**. With B-frames that differs from display order, so **negative values mix into** the intervals, and that noise distorts both the median and the threshold. It can even fabricate holes that do not exist in display order |
| `median` — median, not mean | the loss interval itself is in the sample. Using the mean lets a 6-second outlier pull the baseline up so the threshold grows with it, and **the loss makes itself look normal** (the same structure as the trap in §1.1.2) |
| `max(floor, median * factor)` — a floor of 0.4s | at 30fps, three times the median is 0.1s. Without a floor, a one- or two-frame dropout or the normal jitter of a variable frame rate all get reported as loss. In fact the threshold adopted in this lab was not `median × 3 = 100ms` but the **floor of 400ms** |

The verdict is `report.py`'s job. It does not raise the loss count straight to FAIL; it makes one
exception.

```python
# report.py:303-313
    # 5) timeline continuity — even if the total length matches, the middle can be empty
    if gaps is not None and gaps.ok:
        if gaps.gaps:
            worst = max(gaps.gaps, key=lambda g: g.length)
            where = ", ".join(f"{g.start:.2f}~{g.end:.2f}s" for g in gaps.gaps[:3])
            more = f" and {len(gaps.gaps) - 3} more" if len(gaps.gaps) > 3 else ""
            # if the playlist announced the discontinuity with EXT-X-DISCONTINUITY, it may be an intended seam.
            intended = discontinuities >= len(gaps.gaps)
            rep.add(
                "timeline continuity",
                WARN if intended else FAIL,
```

If it is a discontinuity the playlist itself announced with `EXT-X-DISCONTINUITY` (ad insertion, etc.),
it may be an intended seam, so it is lowered to WARN. **A checker ignorant of the exceptions the spec
allows pours out false positives, and a checker that pours out false positives goes unused.**

### 1.4.1 Two tools' verdicts on the same loss

Feed the earlier damaged copy straight into `hls-recon` and it comes out like this.

```
  [2/3] Decryption · transport integrity analysis
    ✗ seg#1 receive failed: HTTP 404 File not found

  Verification result: FAIL — fault detected

  ✓ Playlist            5 segments, declared length 30.00s, TARGETDURATION 6s, no encryption
  ✗ Segment receipt     1/5 failed (HTTP [404]) — loss interval in the reassembled output
  ✓ Response latency    TTFB p50 2ms / p95 2ms, throughput median 4320.7 Mbps
  ✓ Payload validity    all confirmed as media containers (leading-byte check)
  ✓ Segment uniqueness  all SHA-256 distinct
  ! TS integrity        5 CC discontinuities (packet loss)
  ✓ Length consistency  measured 30.02s vs declared 30.00s (drift +0.02s / 0.08%)
  ✓ Stream composition  h264 Constrained Baseline 640x360 @24fps 1577kbps + aac 1ch 44100Hz 102kbps
  ✗ Timeline continuity 1 loss / total 6.03s (max 6.03s) @ 5.99~12.02s
  ✓ Full decode         decoded to the end with no errors
```

The exit code is `2`.

```python
# cli.py:651-652
def _exit_code(verdict: str) -> int:
    return {report.PASS: 0, report.WARN: 0, report.FAIL: 2}[verdict]
```

Of the ten checks the output above produced, **three** responded to this fault, and **two** returned
FAIL. What each item catches is in the README's verification table (`README.md:336-350`).

| Check | verdict on this loss | observed where |
|---|---|---|
| Playlist | info | the manifest |
| **Segment receipt** | **FAIL** | **only during receipt — no trace in the file** |
| Response latency | PASS | only during receipt |
| Payload validity | PASS | only during receipt |
| Segment uniqueness | PASS | only during receipt |
| TS integrity | WARN (5 CC discontinuities) | only during receipt |
| Length consistency | **PASS** ← powerless | the output |
| Stream composition | PASS | the output |
| **Timeline continuity** | **FAIL** | **the output — observable even after the fact** |
| Full decode | **PASS** ← powerless | the output |

> **Term** — **continuity counter**: a 4-bit field in the MPEG-TS packet header that, per PID, cycles
> 0–15 and increments by 1 on each packet carrying payload. If the value skips, it means a packet in
> between was lost ([`tsanalyze.py:104-119`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L104-L119)). Being only 4 bits, a loss of exactly a multiple of 16 goes
> undetected — the subject of Chapter 18.

Three things to read from this table.

1. **Seven checks returned the same verdict as on the clean copy.** Verification is not having many
   checks but having checks sensitive to the fault. The number of checks is not coverage.
2. **One of the two that caught the loss as FAIL cannot be reproduced after the fact.** `Segment receipt`
   can only be known by the process that saw the 404 at that instant, and `TS integrity` too needs the
   segment's original bytes — the output is MP4, so no TS packet header remains. The information loss
   Figure 1-1 described appears exactly. **The only thing usable by someone handed only the file is
   `Timeline continuity`.**
3. **That `Full decode` is PASS is especially important.** The reassembled copy decodes from start to
   finish with no error. "It opens" and "it is correct" are different propositions.

### 1.4.2 Nail this very fact down as a test

That "ffmpeg alone misses it" is the reason this tool exists, so rather than leave it as a claim, it is
fixed as a regression test.

```bash
# tests/run.sh:512-522
# fix down the very fact that ffmpeg alone misses the same loss.
head_ "[4/4] Control — ffmpeg alone misses the loss"
set +e
ffmpeg -v error -y -i "$BASE/damaged/index.m3u8" -c copy "$WORK/out/naive.mp4" >/dev/null 2>&1
naive=$?
set -e
if [[ $naive -eq 0 ]]; then
  ok "ffmpeg alone exit 0 — does not report the loss (the reason the tool is needed)"
else
  printf '  \033[33m·\033[0m ffmpeg failed with exit %s — may vary by environment\n' "$naive"
fi
```

The `else` branch is the most honest part of this code. **If the comparison target improves, this test
tells you** — if upstream ffmpeg one day starts reporting the loss, part of this tool's reason for
existing disappears, and that fact surfaces immediately. Control-group design is revisited in Chapter 36.

---

## 1.5 Generalization — why reassembly and verification differ in difficulty

The problem statement at the head of the course was two sentences (`00-curriculum.md:15-16`).

> Can you turn the video a web server sends out in pieces back into a single file on local disk?
> If you did, how do you know it is the same as the original?

We can now write formally why the two sentences differ in difficulty.

| | reassembly | verification |
|---|---|---|
| Logical form of the proposition | an **existential** — "these bytes can be joined" | a **universal negative** — "not one thing is missing" |
| Evidence of success | the output itself is the evidence | the output is not evidence. it must be produced separately |
| Required input | the bytes received | the bytes received + **an independent statement of what should have been received** |
| When observable | possible even after the fact | largely **only during receipt** |
| Mode of failure | loud — the file does not open | quiet — the file opens |
| Cost of judging failure | one pass | a separate pass per check (the gap scan reruns `ffprobe`) |
| Delegability | possible — ffmpeg does it | delegate and you **inherit the silence of the delegate too** |
| Termination condition | done once the file is made | there is no end — "this check can't catch it" is the best conclusion |

The third row is decisive. **Verification does not hold with "what was received" alone.** A statement of
what should have been received must come from somewhere, and that statement must be **independent** of
what was received. In HLS that statement is the playlist — the number of segments and the length of each.
That is all.

> **Term** — **test oracle**: an independent basis that decides whether a given execution result is right
> or wrong. Without an oracle, "I ran a test" does not mean "I verified." That is the sentence this
> repository wrote down — "if the verification tool only ever produces PASS, it is the same as verifying
> nothing" (`README.md:355`, same intent in `tests/run.sh:6-7`). The subject of Chapter 34.

### 1.5.1 The same structure outside this domain

The structure "the operation called itself a success but the result is incomplete" is not unique to
streaming.

| Domain | signal that calls itself success | what that signal does **not** guarantee | the real basis |
|---|---|---|---|
| File copy (`cp`·`rsync`) | exit code 0 | byte-identical to the original | checksum comparison (`rsync -c`) |
| Database replication | replication lag 0 | row-level identity | table checksum comparison |
| Log collection | collector no-error | no event loss | sequence number · sender counter comparison |
| Backup | "backup job complete" | restorable | an actual restore rehearsal |
| Package install | `exit 0` | the artifact is genuine | signature · hash verification |
| CI cache restore | cache hit | completeness of the cache contents | manifest comparison |
| Message queue consume | ack complete | all messages processed | offset continuity |
| **This chapter** | ffmpeg `exit 0` + total length matches | **timeline continuity** | **PTS gap scan** |

The left column of every row is a **statement the operation makes about itself.** The right column is
every **comparison against a baseline that came from outside the operation.** This distinction is close
to the definition of verification.

Written as a general rule:

> For an observed metric `M` and a fault `D`, if `M(clean) = M(result with D)`, then `M` is not a
> verification of `D`. **However precisely you measure.** The total length matched to the sixth decimal.

Precision and sensitivity are different axes. Measuring eight digits is not verification; **choosing a
quantity that responds to the fault** is.

---

## 1.6 Security — what a quiet success creates

> **Term** — **silent failure**: a state in which part of an operation failed yet is reported to the
> upper layer as a success, so the failure never reaches the observation point.

Silent failure is not a convenience issue but a security issue. We look in turn at why, and at what a
defender can do.

### 1.6.1 Partial delivery becomes a primitive

If the receive pipeline does not report the loss, the manipulation of **"remove only a particular span
of the video"** becomes possible outside the pipeline. **A point that terminates TLS** (a CDN edge, a
corporate proxy, any layer in front of the origin) need only return 404·403 for a chosen segment request,
and an attacker on a path that does not terminate TLS can reach the same result by repeatedly cutting
just that request's connection so every retry fails. No re-encoding, no signature forgery, no decryption.
**It ends with removing one response.**

| Situation | manipulation | what silent failure creates |
|---|---|---|
| Evidence · audit video retention | fail only a particular span's segment | the total length matches, so it is accepted as an intact copy |
| Surveillance camera archiving | some pieces lost during storage | "30 minutes recorded" — 6 minutes are actually empty |
| Regulatory records (broadcast · financial calls) | remove a particular utterance span | a per-file check leaves no trace |
| Ad playback verification | only the ad span is lost | the playback log shows normal delivery |
| CDN cache poisoning | an error page is cached for some segments | `200` + normal headers → total length preserved (Chapters 5 · 14) |

The common thread is one. **The cost of manipulation is low and the cost of detection is high.**
Manipulation is removing one response; detection is sweeping the whole timeline.

### 1.6.2 HTTPS does not solve this — it is a different category

Cut off a common misconception first. TLS guarantees **the integrity of each response.** If one byte of
a response body is tampered with, it is detected on that connection. But there is what TLS does **not**
guarantee.

| Axis | precise name | does TLS guarantee it? |
|---|---|---|
| Are this response's bytes exactly as the server sent them | integrity | **Yes** |
| Did this response come from that server | authenticity | **Yes** |
| Is the **set** of responses complete — you asked for `n`, did all `n` arrive | completeness | **No** |
| Did the request itself arrive | availability | **No** — blocking a request is not a protocol violation |

**Integrity at the transport layer and completeness of the application output are different axes.** HTTP
is stateless (Chapter 4) and each request knows nothing of the others. "Only four of five arrived" is
represented in no individual transaction. That judgment is possible only in the **layer that knows there
are five** — the application that read the playlist.

### 1.6.3 The defender's view — what to do

We do not just list bypass paths and stop. What each role can actually do differs.

| Role | what to do | what not to do |
|---|---|---|
| **Streaming service operator** | keep per-segment access logs and compare against playback logs. it is the only place you can reconcile the count the server sent against the count the client received | conclude delivery quality from total length · playback-completion rate alone |
| **Pipeline author** | read the docs for **what the tool guarantees** and attach a separate check per axis it does not guarantee. an exit code is the tool's self-report | join a pipeline with `cmd && next` and consider it verified |
| **CI · release owner** | record on the artifact not "it PASSed" but "a check **capable of catching some fault** was run." fix the checker's true-positive rate first with fault injection (Chapter 35) | take the fact that the checker has never once FAILed as evidence of quality |
| **Evidence · archive manager** | a file hash catches only **tampering after acquisition.** completeness at acquisition time can be recorded only at acquisition time — keep receive logs alongside the output | take a hash after the fact and consider integrity secured |
| **Security tool user** | read a scanner's PASS as "**this scanner can't catch it.**" a PASS from a tool whose miss rate you do not know carries zero information | report a PASS as evidence of safety |

The fourth row is the most direct transfer of this chapter's principle. **A hash taken of a file after
the fact says only "this file is that file from back then." It does not say "that file back then was
correct."** The information loss in Figure 1-1 is not filled in by cryptography.

---

## 1.7 Limits and open questions

Written down honestly.

- **The reproduced value differs from the README at the second decimal.** The README is `30.03s`, this
  chapter's reproduction is `30.023401s`. It appears to be an encoder-version difference, and the point
  (that the clean and damaged copies equal **each other**) is unaffected. Still, the very fact that the
  measured value the course cites wobbles by environment is recorded.
- **ffmpeg exiting `exit 0` is version- and option-dependent.** Confirmed on 8.1.1. It can change with
  an option like `-xerror` or a different version, and `tests/run.sh:518-522` leaves that possibility
  open and only warns on failure. Read it not as "ffmpeg is flimsy" but as **"a player's default is
  robustness, not strictness."** A player that halts on one piece would be its own unusable tool.
- **`r_frame_rate` was not used.** In this reproduction `r_frame_rate` stayed `30/1` even in the damaged
  copy, so comparing `30 × 30.02 ≈ 900` against the measured `720` could have revealed the loss. But this
  value is ffprobe's heuristic, meaningless on variable-frame-rate sources, and **it cannot tell you the
  loss location.** This repository does not use it. How robust this metric is on other streams was not
  measured.
- **These are results from one fault type, one stream.** Only the case of one 6-second segment missing
  entirely was reproduced. A case where only part of a segment's interior is cut, where several segments
  are lost scattered, or where only audio is missing, was not measured in this chapter.
- **A loss below `gap_scan`'s threshold is not caught.** The threshold is `max(0.4, median frame
  interval × 3)`, so on a 30fps stream a hole under 0.4 seconds is not detected. A loss on the order of a
  few frames is this check's blind spot — the transport-layer continuity-counter check covers part of
  that region, but it has its own miss interval too (Chapter 18).
- **"A file does not record how it was made" is a statement limited to this pipeline.** In principle a
  format that carries such a record can be made (e.g., enclosing a receive manifest with the output).
  Only, since the party making that record is the very tool that knew about the loss, **the
  self-reporting property remains.** It is a shift of trust, not its removal.
- **The attack path in §1.6.1 is inference, not measurement.** What this chapter actually measured is
  only "what happens when you delete one file on a local server." How easy selective blocking on a TLS
  path is in a real CDN environment, and how much the retry policy ([`fetch.py:196-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L196-L206)) absorbs it,
  was not reproduced.
- **The completeness of the `EXT-X-DISCONTINUITY` exception was not verified.** [`report.py:310`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L310) lowers to
  WARN if the number of declared discontinuities is at least the number of detected losses. This rule
  **compares only the count, not the position** — if there is one declared seam and one real loss at an
  entirely different position, it drops to WARN. This repository's regression tests do not cover this
  combination.

---

## 1.8 Summary

1. `ffmpeg -c copy` returns **exit code 0** even when a segment drops out with a 404, and the output's
   total playback length is **identical to the sixth decimal** to the clean copy. The container opens and
   it decodes to the end. There is not a single signal that responds to the fault.
2. The reason is that **PTS is an absolute coordinate.** Even when a middle piece disappears, the
   timestamps of the pieces behind are not pulled forward, so the total length is preserved. Loss appears
   **not as a total but only as a hole in the timeline.**
3. **The only baseline HLS declares is length**, and that happens to be the quantity insensitive to this
   fault. Frame count and hash are not in the spec, and a byte count is declared only for
   `EXT-X-BYTERANGE` segments.
4. A stream is a **sequence of events**, a file is a **single state**. `-c copy` is lossless for the
   video but **lossy for the observation information.** Status codes, latency, and hashes have nowhere to
   remain in the output.
5. That is why **reassembly and verification differ in difficulty.** Reassembly is an existential and the
   output is the evidence. Verification is a universal negative, needs a separate **baseline independent**
   of what was received, and is largely observable only during receipt.
6. Of the ten checks, three responded to this loss (two FAIL · one WARN), and the other seven returned
   the same verdict as on the clean copy. One of the two FAILs (`Segment receipt`) **cannot be reproduced
   after the fact.** The only thing usable by someone handed only the file is the timeline gap scan.
7. From a security view, silent failure **turns "deleting one response" into the manipulation of removing
   a particular span.** TLS guarantees the integrity of each response but not the **completeness of the
   set of responses** — a different axis.
8. The minimum condition for verification is not precision but **sensitivity.** A metric where
   `M(clean) = M(loss)` is not verification, however precise.

---

**Next chapter** — then why chop the video into pieces and point to them with a text list in the first
place? The "sequence of events" structure this chapter revealed is the product of a compromise for
mimicking real-time playback over HTTP, a protocol meant for file transfer. Chapter 2 follows the
invention of ABR (adaptive bitrate) and HLS, and sees what this structure gained and what it gave up.
