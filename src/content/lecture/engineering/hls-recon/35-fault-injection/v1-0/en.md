---
title: "Fault-Injection Design"
description: "The 8-way mapping table, and the precision of injection"
date: 2026-08-09
version: '1.0'
tags: ['streaming', 'verification']
thumbnail: /images/lecture/thumb/hls-recon-35-fault-injection.svg
---
## 35.0 What this chapter answers

1. What is fault injection, and what exactly does it prove?
2. Which check does each of the 8 defects target — why is that mapping table a **coverage proof?**
3. Why is each injection's number that value — why 12, why `seg000`, why **positive** 60 seconds?
4. Is this mapping table actually 1:1? If not, what remains unproven?

The fourth question is this chapter's summit. This chapter does not stop at introducing the mapping table but is
**a record of directly confirming whether that mapping table holds by measurement.** The result holds only
half.

---

## 35.1 The problem — PASS is not information

Rewrite in one line the problem confirmed in Chapter 34. It is the sentence right at the head of this
repository's regression test.

```bash
# tests/run.sh:4-6
# Makes 4 kinds of HLS stream locally, confirms the normal cases come out PASS,
# and injects 3 kinds of defect to confirm they are actually caught as FAIL.
# A verification tool that gives only PASS is the same as verifying nothing,
```

> **Term** — **test oracle**: the criterion judging whether some run's result is right or wrong. Without an
> oracle a test can say only up to "it ran," not "it was right."

`hls-recon` is itself a verdict tool. That is, **a program that professes to be an oracle.** Such a program has a
peculiar trap. Change the whole verdict logic to the one line `return PASS` and the test on a normal stream
**passes entirely.** A test putting in only normal input cannot distinguish an "implementation that always gives
a pass" from an "implementation that checks properly."

To distinguish, you need **an input for which a wrong answer must come out.** Making and feeding that input
deliberately instead of waiting for a human is fault injection.

> **Term** — **fault injection**: the technique of deliberately putting a **known defect** into the system to be
> verified and observing whether the system actually detects·handles that defect. Since the injecting side knows
> the answer (what defect was put in), that answer is itself the oracle.

### 35.1.1 Why unit tests are not enough

"Just call the check function directly" is a natural rebuttal. For instance, put a hand-made TS byte string into
`tsanalyze.analyze()` and confirm `cc_discontinuities == 1`. That is needed too, but by itself it does not verify
the following.

| What a unit test misses | The actual example in this repository |
|---|---|
| whether the check **is even called** | in [`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464), if the `sniff()` result does not pile into `bogus` the check itself does not run |
| whether the check result **leads to a verdict** | in [`report.py:199-211`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L199-L211), if `bogus` is not promoted to FAIL it does not appear in the report |
| whether the verdict **leads to the exit code** | even with a FAIL, if exit 0, CI knows nothing |
| whether the **state passing** between checks is right | the CC check passes the `state` dict across segment boundaries ([`tsanalyze.py:71-83`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L71-L83)) |
| whether the actual input's **shape** matches the assumption | a hand-made TS has a different PAT/PMT layout from actual ffmpeg output |

Fault injection puts the defect at the **very front of the pipeline (the segment file on disk)** and observes at
the **very back (the console string and exit code).** It passes only if every link between is alive. This is why
this repository fixes its regression with one shell script instead of unit tests.

---

## 35.2 The principle — the mapping table is itself a coverage proof

### 35.2.1 Two kinds of coverage

The word "coverage" can point at two things, and in a verification tool the two differ greatly.

> **Term** — **code coverage**: the ratio of code lines·branches the test run passed through. **fault coverage**:
> the ratio of the assumed defect list the test actually detected.

Put in only normal streams and the code coverage comes out high. Because all check functions are called. But then
the **fault coverage is 0** — since not one defect was caught. The meaningful number in a verification tool is
the latter, and to make that number a **defect list** must exist first.

This repository nailed that list into the README as a table (`README.md:366-375`).

### 35.2.2 The 8-way mapping table

This chapter's central table. The left half is injection (what is broken), the right half is observation (where
and as what it appears).

| # | Injected defect | Injection anchor | Targeted check | Confirmed string | Confirm anchor | Verdict |
|---|---|---|---|---|---|---|
| 1 | remove 12 TS packets | `tests/run.sh:134-137` | TS integrity (continuity counter) | `CC discontinuit` | `tests/run.sh:483` | WARN |
| 2 | segment delivered duplicately | `tests/run.sh:138-139` | segment uniqueness (SHA-256) | `duplicate hash` | `tests/run.sh:484` | WARN |
| 3 | segment 404 | `tests/run.sh:140` | segment receive **+** timeline continuity | `segment receive.*failed` · `timeline continuity.*gap` | `tests/run.sh:482,485` | FAIL |
| 4 | HTML error page on a 200 response | `tests/run.sh:141-145` | payload validity | `payload validity.*not media` | `tests/run.sh:486-487` | FAIL |
| 5 | subtitle `X-TIMESTAMP-MAP` +60 seconds | `tests/run.sh:89-92` | subtitle timeline (separate file) | `subtitle timeline.*out of the video range` | `tests/run.sh:496-497` | FAIL |
| 5′ | the same defect, embed path | `tests/run.sh:125` | subtitle timeline (container embed) | `subtitle timeline.*out of video range` | `tests/run.sh:508-509` | FAIL |
| 6 | a subtitle URL is HTML on a 200 | `tests/run.sh:258-259` | sidecar receive (leading-content determination) | file absence **+** `all .* candidates failed` | `tests/run.sh:292-294` | — |
| 7 | an MP4 cut at 60% · a 0-byte file | `tests/run.sh:356-362` | inventory (intactness verdict) | `EP 5 .* ok=False` · `EP 6 .* ok=False` | `tests/run.sh:407-410` | — |
| 8 | an episode missing only the subtitle | `tests/run.sh:427-431` | subtitle filling | `FILLED 1 0` | `tests/run.sh:460-461` | — |

The last column's "—" means it is not a report-verdict item. Defects 6·7·8 target not the report but **a judgment
before the report** (what to admit as a subtitle, what to see as an already-received episode).

> **Term** — **assertion**: a statement a test makes that "this condition must be true." In this repository one
> `grep -q` line on the console output is one assertion.

### 35.2.3 That it spans layers

The 8's real property is not the count but the **distribution.** It is not one layer stabbed in eight directions
but six different layers each stabbed.

![A map of the 8 fault injections placed on six different layers of the pipeline](/images/lecture/hls-recon/35-injection-map.svg)

*Figure 35-1 — the defects are injected into different layers of the pipeline*

What is in the left parenthesis matters. **Each layer's defect is not invented but a model of an actually
observed failure.** On token expiry a 404 comes (layer 1) or an error page rides on a 200 (layer 2), on a CDN
origin misconfiguration the same piece is repeatedly delivered (layer 4), on a wrong reference clock in subtitle
packaging the time slips whole (layer 5). If the process dies mid-muxing a truncated file remains on disk (layer
6).

Without this correspondence, fault injection becomes **a game of putting in only what you can catch.** The
list's legitimacy comes not from the code but from the field.

### 35.2.4 The un-targeted checks

Write the opposite side honestly. The checks the README organized as a table are 12 items (`README.md:336-349`),
and what the above mapping table targets is 6 of them. The remaining six, and the two items not in the README
table but which the report gives, remain like this.

| Check item | Fault-injected | Reason |
|---|---|---|
| playlist | no | an info item so it has no verdict |
| response latency | no | to reproduce the threshold (p95 3s) you need a server that adds delay |
| length consistency | no | it moves as a byproduct of defect 3 but there is no targeted injection |
| stream composition | no | a stream with no video track is not made separately |
| subtitle extract | no | there is no injection making an extract **failure** (FAIL) — only the success path is fixed |
| subtitle batch collect | no | there is no injection making a total wipeout (WARN) |
| full decode | no | it goes FAIL as a byproduct of defects 1·3 but has no assertion |
| embedded caption | no | only a declaration, no verdict |

**The fault coverage is 6/12.** Not 12/12. Writing this number down is also the reason for having the mapping
table — you need a list for the empty cells to be visible.

---

## 35.3 The code — 15 lines make the stream

The injection body is short. Copy the normal stream `plain` whole, then touch four spots.

```bash
# tests/run.sh:129-147
# defect-injected copy
cp -R plain damaged
python3 - <<'PY'
import pathlib
d = pathlib.Path("damaged")
p = d / "seg002.ts"                       # defect 1: remove 12 TS packets → CC jump
raw = p.read_bytes()
cut = (len(raw) // 188 // 2) * 188
p.write_bytes(raw[:cut] + raw[cut + 188 * 12:])
# defect 2: duplicate delivery. use seg000, which the defects below do not touch, as the source.
(d / "seg004.ts").write_bytes((d / "seg000.ts").read_bytes())
(d / "seg001.ts").unlink()                                      # defect 3: segment 404
# defect 4: reproduce a CDN returning an error page as 200 on an expired token
(d / "seg003.ts").write_bytes(
    b"<!DOCTYPE html><html><body><h1>403 Forbidden</h1>"
    b"<p>Link expired</p></body></html>\n"
)
PY
echo "  defect injection: packet loss / segment duplicate / segment 404 / 200-error-page"
```

The original stream is a 30-second source cut with `-hls_time 6` so there are exactly 5 segments
(`tests/run.sh:43-44`). The shape after injection is this.

| Piece | Disk state | Playlist | Defect |
|---|---|---|---|
| `seg000.ts` | original as-is | referenced | none |
| `seg001.ts` | **deleted** | referenced → HTTP 404 | 3 |
| `seg002.ts` | 1,642,556 B → 1,640,300 B | referenced | 1 |
| `seg003.ts` | 83 B of HTML | referenced → HTTP 200 | 4 |
| `seg004.ts` | byte-identical to `seg000.ts` | referenced | 2 |

**The playlist is not touched.** `index.m3u8` still declares 5 and claims each is 6.000 seconds. This decides the
form of fault injection — the tool starts believing "5 must be received" and must find for itself the off-ness
between what was received and the declaration.

Here this repository's verification philosophy is already revealed. **Leave the declaration as-is and break only
the real thing.** Fix the declaration together and the very basis for the tool to discover the off-ness vanishes.

---

## 35.4 The precision of injection — why that value exactly

From here is this chapter's main argument. The above 15 lines have several arbitrary-looking numbers — `12`,
`seg000`, `// 2`, `188`, `60 * 90000`, `6 // 10`. Confirm them one by one and **any other value either does not
reproduce the defect, or reproduces it but measures something different.**

This section's measurements were all done by calling the repository's actual code (`hlsrecon/tsanalyze.py`, etc.)
as-is. The environment is macOS · ffmpeg 8.1.1.

### 35.4.1 Defect 1 — why 12

The continuity counter is 4 bits.

> **Term** — **continuity counter**: the low 4 bits of the last byte of the MPEG-TS packet header. On the same
> PID it increments by 1 **for each packet carrying payload** and cycles 0–15. A skipped value means a packet was
> lost in between.

From the fact that it is a 4-bit cycle, a conclusion follows immediately. **If a loss is a multiple of 16 the
counter returns to place and leaves no trace.** This repository's check is no exception ([`tsanalyze.py:112-119`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L112-L119)).

And measure it and the blind spot is not one but **two.**

The result of taking out n packets of the same PID from the middle of `plain/seg002.ts` and running `analyze()`.

| Removed count n | `cc_discontinuities` | The trace the counter left |
|---|---|---|
| 1 | 1 | expected 11 → actual 12 |
| **12** | **1** | expected 11 → actual 7 |
| **15** | **0** | expected 11 → actual **10** (same as the previous value) |
| **16** | **0** | expected 11 → actual **11** (the expected value as-is) |
| 17 | 1 | expected 11 → actual 12 |
| 32 | 0 | two laps |

That n = 16 is not caught is as expected. That n = 15 is not caught is because of **the spec's exception
clause.**

```python
# tsanalyze.py:112-116
        prev = last_cc.get(pid)
        if prev is not None:
            expected = (prev + 1) & 0x0F
            if cc != expected and cc != prev:  # cc == prev is a spec-permitted duplicate packet
                rep.cc_discontinuities += 1
```

Take out 15 and the next packet's counter becomes **the same** as the previous value. The MPEG-TS spec permits
sending the same packet twice (a duplicate packet), and then the counter does not increment. The checker, keeping
that exception, misses one real loss. It is a **textbook case of a clause reducing false positives making a false
negative**, and Chapter 18 treats this balance head-on.

![Whether CC detects by removed count, and the two blind spots](/images/lecture/hls-recon/35-cc-blindspot.svg)

*Figure 35-2 — the removed count sets whether it detects — the two blind spots of a 4-bit counter*

So it is 12. Not a multiple of 16, its remainder mod 16 not 15, and amply away from both. **Choose 1 or 2 and it
is detected but you end up testing the excessive claim "even a mere one-packet difference is caught," and choose
16 and the defect does not reproduce at all.**

Here a second constraint overlaps. 12 packets is 2,256 bytes, about 0.14% of the 1.6 MB 6-second segment, which
**converted to playtime is about 8 milliseconds.** The timeline-gap check's threshold is the larger of three
times the median frame interval or 0.4 second (`probe.py:191,227`), so a loss this size does not touch the
timeline check. **The size was suppressed so that defect 1 does not invade defect 3's observation region.**

### 35.4.2 Defect 1 — why the middle

`cut = (len(raw) // 188 // 2) * 188` is the halfway point of the packet count. The reason it is not the front or
tail was confirmed by measurement. The result of taking out the same 12 with only the position changed.

| Removal position | Within that segment | Across the whole 5-piece chain | Where it is caught |
|---|---|---|---|
| **the middle** | 1 CC | 1 CC | **`seg002` — the very piece with the defect** |
| the front 12 | **0** | 4 | `seg002` 3 + `seg003` 1 (spread) |
| the tail 12 | **0** | 1 | **`seg003`** — the next piece with no defect |

The front and tail **leave no evidence within that segment.** The reason is in the counter check's state rule.

- Cut the **front** and the first PID met in that segment has `prev` still `None` so the comparison itself does
  not happen. Moreover the front 12 have PID 17·0·4096 (the PAT/PMT family) and video PID 256 mixed in, so it
  **shakes four PIDs' states at once** — one defect spreads to several jumps.
- Cut the **tail** and the off-ness is revealed only at the **next segment's first packet.** The tail 12 are all
  audio PID 257 so a video loss is reported as an audio loss.

The middle 12 all belong to one PID 256 (video). So **the injection spot and the detection spot coincide, and the
jump appears as exactly one.**

> In fault injection the position matters as much as the size. **If the spot where the defect is reported and the
> spot with the defect differ, that test, even if it passes, sends a human to the wrong place.**

### 35.4.3 Defect 1 — why a multiple of 188

Both `cut` and the removal amount `188 * 12` are multiples of 188. I measured what differs if not.

| Removal amount | `sync_errors` | `cc_discontinuities` | Report verdict |
|---|---|---|---|
| `188 × 12` | 0 | **1** | TS integrity **WARN** (CC discontinuity) |
| `188 × 12 + 50` | **4,347** | **0** | TS integrity **FAIL** (sync loss) |
| `2000` | **4,344** | **0** | TS integrity **FAIL** (sync loss) |

Cut by a non-multiple of 188 and everything after goes off the packet grid so **the sync byte loses its place.**
Then what is caught is not "packet loss" but "stream-alignment collapse," and a CC discontinuity is **not reported
at all** (the grid is broken so the very position to read the counter is wrong).

That is, if the removal amount is not a multiple of 188 this test ends up testing **a different check than
intended.** The assertion string `CC discontinuit` fails to match and the test dies red — fortunately it is not
quietly wrong. But that is **because this repository designed the two defects to be reported with different
strings**, not a property automatically guaranteed.

One addition. That `cut` itself need not be a packet boundary was confirmed by measurement too — as long as the
removal amount is a multiple of 188 the grid is maintained and the CC jump is still 1. Even so, aligning the
boundary is right. **Break the boundary and a splice is made where the header is packet P's and the payload's
rear is packet P+12's, which is not a model of "12 lost."** Even with the same observed value, if the model
differs it is disqualified as fault injection.

### 35.4.4 Defect 2 — why `seg000` is the duplicate source

The comment wrote the reason directly.

```python
# tests/run.sh:138
# defect 2: duplicate delivery. use seg000, which the defects below do not touch, as the source.
```

There are five segments and four defects. `seg001` is deleted, `seg002` has packets removed, `seg003` becomes
HTML, and `seg004` is the duplicate target. **The only one left is `seg000`.** It looks like there is no choice,
but that fact itself is the result of the design.

Weigh what breaks if you use a damaged piece as the duplicate source and the reason is clear.

| Duplicate-source candidate | What gets mixed |
|---|---|
| `seg002` (packets removed) | defect 1's CC jump is counted in **two places**, so in the CC aggregate defect 1's share and defect 2's share cannot be separated |
| `seg003` (HTML) | payload validity reports not 1 but 2. an assertion verifying "how many are fake" cannot be added later |
| `seg001` (deleted) | the file is absent so the duplication itself is impossible |

This is exactly the same problem as a basic principle of experimental design.

> **Term** — **confounding**: a state where two or more factors vary together so the observed effect cannot be
> attributed to one factor.

**Placing the defects so they do not overlap is the work of reducing confounding.** Only, as §35.5 will show,
even this placement leaves confounding.

That the duplicate is placed on the **last** piece (`seg004`) is no coincidence either. The duplicated piece
keeps the original's presentation time (0–6 seconds) so it goes backward on the reassembled copy's time axis.
Place it in the middle and the timeline-gap check gets tangled, place it at the end and it **contributes almost
nothing to the total length** — measured, the output length was 24.04 seconds, shortened by only the lost 6
seconds. The very fact that a duplicate delivery does not appear in the length is "**the reason a uniqueness
check must be separate.**"

### 35.4.5 Defects 3·4 — why 404 and 200+HTML are placed as a pair

These two are ordinary seen separately but **placed as a pair they distinguish implementations.**

| Defect | HTTP status | What the server says | Reality |
|---|---|---|---|
| 3 | `404` | failure | failure — **an honest failure** |
| 4 | `200` | success | failure — **a false success** |

Put in defect 3 alone and an "implementation that looks at the status code" passes. Put in defect 4 together and
**only an "implementation that looks at the leading byte" passes.** The two defects are a complementary pair, and
that pair is the regression fixing of the proposition "200 is not success" covered in Chapters 5·14.

Defect 4's precision has one more layer. The test server is the Python standard `http.server`, and this server
sets the `Content-Type` by extension. Since the filename is `seg003.ts` the response header goes out as
**`Content-Type: video/mp2t`** — even though the content is HTML.

The result of actually running it.

```
✗ payload validity   1 is a 200 response but not media (video/mp2t) — seg#3 head 3c21444f43545950
```

`3c21444f` is `<!DO`. **The status code normal, the Content-Type media, and yet the content HTML.** A
determination relying on the header cannot catch this defect by any method. The README stated this point
(`README.md:382-384`).

> The "HTML on a 200 response" item is missed if you believe the header. In the test the server responds with
> `Content-Type: video/mp2t` but the body is `<!DOCTYPE html>` — so it judges by the leading byte, not the
> header.

That the injection **left the filename `.ts` instead of changing it to `.html`** is the core. Had it changed the
name, the server would have attached `text/html`, and then an "implementation that looks at the Content-Type"
would pass too. **It made the defect not more plausible but harder to catch.**

### 35.4.6 Defect 5 — why positive 60 seconds and not negative

The most subtle value in this chapter. The comment wrote the reason.

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

To confirm why the sign is decisive you must look at the code that uses the offset.

```python
# subtitles.py:208-210
    # a 33-bit unsigned value is the spec so a negative is invalid — do not trust the mapping itself.
    if mpegts < 0:
        return None
```

When `None` returns the caller **skips** the correction ([`cli.py:283-286`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L283-L286)). The subtitle stays at the originally
written time. And the originally written time is 0–29 seconds — **inside the 30-second video range.** The check
passes. The defect does not reproduce.

I made two copies of the same stream with only the sign changed and confirmed by running.

| Offset | Correction applied | Subtitle time range | Video length | Subtitle timeline | Exit code |
|---|---|---|---|---|---|
| **`+60 * 90000`** | applied (+60.00s) | **60.0 – 89.0s** | 30.0s | **FAIL** — a track out of the video range | **2** |
| `-60 * 90000` | **skipped** | 0.0 – 29.0s | 30.0s | PASS — all tracks within the video range | **0** |

**Make it negative and the test goes quietly green.** You injected a defect but the tool gives PASS, and seeing
that PASS you conclude "the subtitle-timeline check works." A test meant to verify the verifier makes the exact
opposite false confidence.

In addition, note that **there are two plies of reason the defect passes if you get the sign wrong.** First, the
above range check discards the mapping. Second, even had it not discarded and applied -60 seconds as-is, `shift()`
clamps a negative time to 0 ([`subtitles.py:227`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L227)) so the subtitle just bunches near 0 seconds and **does not stray out of
the video range.** Either way the defect is not observed.

> **Fault injection must be done within the detector's verdict rule.** If the detector looks for "outside the
> video range," the injection must necessarily go outside. A defect put in without knowing the rule is not a
> defect but noise.

The basis for the size 60 seconds is confirmed by calculation too. The check gives FAIL when `last_cue > video_len
+ 5.0` ([`report.py:432`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L432)). The last cue is 29 seconds and the video 30 seconds so the offset must exceed 6 seconds to
be detected. 60 seconds is 10 times that minimum, a value with margin **so as not to depend on a knife-edge pass
near the threshold.**

### 35.4.7 Defect 5′ — why fix the sidecar and embed separately

It is the only item where the same defect is put in twice. The reason is **the baseline differs per path.**

```bash
# tests/run.sh:500-501
# The same defect must be caught in embed mode too. Putting the subtitle in the container stretches the whole duration
# to the subtitle's end, so taking the baseline by measurement makes this check always pass.
```

Put the subtitle in `.mkv` and the output's duration stretches to the subtitle's end (89 seconds). Take the
measured length as the baseline and it becomes "subtitle 89s vs video 89s" — **the slipped subtitle drags its own
baseline.** So [`report.py:342`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L342) takes the baseline as the playlist's **declared length.** It is Chapter 38's subject, and
here only the fact that that design is fixed by regression is noted.

That the two paths give different sentences is worth confirming too.

| Path | Report sentence | Assertion |
|---|---|---|
| separate file | `a track out of the video range …` ([`report.py:444`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L444)) | `subtitle timeline.*out of the video range` |
| container embed | `… out of video range, X-TIMESTAMP-MAP …` ([`report.py:365`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L365)) | `subtitle timeline.*out of video range` |

`out of the video range` and `out of video range` — they differ by one word (`the`). Since the two assertions do
not match each other's sentence, **mix up the paths and the test dies.** This is both a safety device and a
vulnerability (§35.8).

### 35.4.8 Defect 6 — a subtitle that comes as a 200 but is not a subtitle

It is defect 4, put in a segment, moved as-is onto the subtitle path.

```python
# tests/run.sh:258-259
# a response that comes as 200 but is not a subtitle. this must not be stored as a subtitle.
(work / "함정01.srt").write_text("<!DOCTYPE html><html><body>404</body></html>\n", encoding="utf-8")
```

That the filename is `.srt` is the core. Since a sidecar subtitle is found by **assembling** the URL
([`subtitles.py:398-414`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L398-L414)), the server honestly returns the existing `.srt` as a 200. The extension·status code·path rule
all match and only the content differs. There is only one determination basis.

```python
# subtitles.py:417-422
def _sniff_format(body: bytes) -> str:
    """Determine a subtitle body's format by its leading content. Empty string if not a subtitle.

    Do not trust Content-Type — some servers give subtitles as `application/octet-stream`,
    and conversely an HTML error page arriving as 200 comes with the same header. Whether
    there is even one cue timecode is the only sure basis.
```

The injected HTML has neither `-->` nor `00:00:01,000`. So the cue-timecode regex does not catch and the
determination fails. The assertion looks at **two things together.**

```bash
# tests/run.sh:292-294
[[ ! -e "$WORK/out/함정/함정01.srt" ]] && ok "rejects a non-subtitle 200 response" || bad "stored HTML as a subtitle"
grep -q 'all .* candidates failed' "$WORK/out/sidecar3.log" \
  && ok "reports the failure with the candidate list" || bad "failure report missing"
```

It separately confirms **did it reject** (is the file absent) and **did it report** (does it say why it failed).
An implementation that discards quietly passes the first assertion but catches on the second. It is an assertion
distinguishing a tool that swallows the failure from a tool that speaks the failure.

### 35.4.9 Defect 7 — 60% and 0 bytes are different branches of the same check

```python
# tests/run.sh:356-362
python3 - "$STOCK" <<'PY'
import sys, pathlib
d = pathlib.Path(sys.argv[1])
whole = (d / "그렌라간02.mp4").read_bytes()
(d / "그렌라간05.mp4").write_bytes(whole[: len(whole) * 6 // 10])
(d / "그렌라간06.mp4").write_bytes(b"")
PY
```

The two files go through the same verdict function `inventory.flaw()` but **catch on different branches.** The
measured result.

| File | Size | Branch it catches | Reason string |
|---|---|---|---|
| 0 bytes | 0 B | [`inventory.py:135-136`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L135-L136) size lower bound | `only 0B — hard to call it video` |
| cut at 60% | 790,939 B | [`inventory.py:94-95`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L94-L95) box boundary | `the mdat box goes past the end of the file — a truncated file` |

`MIN_BYTES` is 64 KB ([`inventory.py:35`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L35)). 0 bytes catches at that lower bound immediately so **there is no need to even
look at the container structure.** Conversely the 60% cut easily exceeds the lower bound, the leading `ftyp` box
is fine, and the extension is `.mp4`. **It passes every cheap determination.** Only the fact that the sum of box
sizes does not match the file size remains.

The ratio need not be 60% — I confirmed 10%·30%·90%·99% all catch on the same reason. What matters is not the
ratio itself but **that the cut spot is in the middle of the `mdat` body.** The original file's box layout is
`ftyp` (32 B) → `free` (8 B) → `mdat` (1,312,583 B) → `moov` (5,610 B), and the 60% point is inside `mdat`. If the
cut spot happens to align with a box boundary the reason changes to `no moov box` — still detected but **it tests
a different branch.**

That a contrast item is placed together is more important. In the same folder are four normal episodes, and two
of them are a file with `moov` in front and one with it after (`tests/run.sh:349-351`). Fix only defect detection
and **an "implementation that always judges damaged" passes.** This bidirectional fixing is Chapter 37's subject.

One more. In the deep check attached by `--verify-existing`, `ffprobe` cannot open this file (`moov atom not
found`). But **before reaching the deep check the cheap structure check already catches it.** The verdict's cost
asymmetry — if the cheap check can settle it, do not call the expensive check — appears in this code as-is here.

### 35.4.10 Defect 8 — the detector's precondition must be satisfied

The quietest but the most design-tricky injection.

```bash
# tests/run.sh:425-431
FILL="$WORK/fill/메움"
rm -rf "$WORK/fill"; mkdir -p "$FILL"
for n in 01 02 03; do
  ffmpeg -v error -y -i source.mp4 -t 5 -c copy "$FILL/메움${n}.mp4"
done
# only 01·02 have subtitles → 03 is the 'subtitle-only-missing' episode.
for n in 01 02; do printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n기존\n' >"$FILL/메움${n}.ko.vtt"; done
```

2 of the 3 episodes have subtitles. This ratio is decisive.

```python
# inventory.py:272-275
    withsub = sum(1 for it in sound.values() if it.subs)
    if withsub * 2 < len(sound):
        return []
    return sorted(n for n, it in sound.items() if not it.subs)
```

**If fewer than half have subtitles it sees it as "a work originally without subtitles" and returns an empty
list.** Had you made only 1 of 3 have a subtitle, `1 × 2 < 3` is true so **not a single loss is reported.** You
injected a defect but the detector gives "no loss."

This is a trap of the same form as §35.4.6's sign problem. The detector has a **precondition where it starts
judging**, and fault injection must be done in a state satisfying that precondition. 2/3 is not an arbitrary
number but **the minimum configuration passing the majority condition.**

The injection's precision is also in the file placement. `메움03.mp4` is made the **same size** as the other
episodes, and the assertion confirms that size stays the same after the filling is done.

```bash
# tests/run.sh:469-470
[[ ! -f "$FILL/메움03.mp4.part" ]] && [[ $(wc -c <"$FILL/메움03.mp4") -eq $(wc -c <"$FILL/메움01.mp4") ]] \
  && ok "the video is not re-received" || bad "touched the video"
```

It confirms together not only **was the defect fixed** (did a subtitle appear) but **did fixing it not break
something else** (was the video not re-received). It is a rare example of a fault-injection test fixing not only
detection but **the side effect of the recovery.**

---

## 35.5 Is the mapping table 1:1 — measured

Up to here is the design intent. Now confirm whether that intent actually holds. The method is simple. Remove the
defects one by one, or put in only one, and run.

### 35.5.1 The result of putting the four together

The measurement of running the `damaged` stream as-is (ffmpeg 8.1.1).

| Check item | Verdict | Message | Whose share it is |
|---|---|---|---|
| playlist | PASS | 5 segments, declared length 30.00s | — |
| segment receive | **FAIL** | `1/5 failed (HTTP [404])` | defect 3 |
| response latency | PASS | TTFB p50 1ms / p95 1ms | — |
| payload validity | **FAIL** | `1 is a 200 response but not media (video/mp2t)` | defect 4 |
| segment uniqueness | WARN | `duplicate hash present` | defect 2 |
| TS integrity | WARN | `11 CC discontinuities (packet loss)` | defect 1 **+ 3 + 2** |
| length consistency | WARN | `measured 24.04s vs declared 30.00s (drift -5.96s)` | defect 3 |
| stream composition | PASS | h264 + aac | — |
| timeline continuity | **FAIL** | `1 gap / total 6.03s @ 5.99~12.02s` | defect 3 |
| full decode | **FAIL** | `6 errors — mb_type 644 in P slice too large` | defect 1 + 3 |

The exit code is 2. The five strings the mapping table promised all come out so the six assertions of
`tests/run.sh:481-487` pass. **On the surface it is perfect.** But the right column is already revealing the
problem.

### 35.5.2 Decomposing the 11 CC discontinuities

The CC jump defect 1 made is **1** (§35.4.1's measurement). And yet the report reports 11. I called the
repository's analysis code as-is and decomposed it per piece.

![How the CC observations get mixed when the four defects are injected together](/images/lecture/hls-recon/35-crosstalk.svg)

*Figure 35-3 — put the four together in one stream and the observations get mixed*

| Analysis order | Piece | CC contribution | Cause |
|---|---|---|---|
| 1 | `seg000` | 0 | first piece, no comparison target |
| — | `seg001` | (none) | not received due to 404, dropped from analysis |
| 2 | `seg002` | **6** | 5 = the boundary jump `seg001`'s loss made (5 PIDs) + **1 = defect 1** |
| — | `seg003` | (excluded) | not media so excluded from analysis |
| 3 | `seg004` | **5** | being a `seg000` duplicate the counter goes backward (5 PIDs) |

Total 11. **Defect 1's share is 1 of 11.** The other 10 are the trace defect 3 (segment loss) and defect 2
(duplicate) left in the CC observation.

Then the decisive question is this — **if you remove defect 1, does the assertion fail?**

I removed it and ran.

```
== remove only defect 1, keep the other three ==
exit=2
  ! segment uniqueness  duplicate hash present — the same segment is repeatedly delivered
  ! TS integrity        10 CC discontinuities (packet loss)
```

**`CC discontinuit` still comes out.** That is, `tests/run.sh:483`'s assertion **passes even without defect 1.**
Delete the packet-removal injection wholesale and this test stays green.

The mapping table's row 1 is **true as design intent but not confirmed by observation.**

### 35.5.3 Defects 1·2 do not contribute to the exit code

The second measurement. I made streams with each defect put in **alone** and ran.

| Stream | Report | Exit code |
|---|---|---|
| defect 1 only (12 packets removed) | `! TS integrity  1 CC discontinuity (packet loss)` | **0** |
| defect 2 only (segment duplicate) | `! segment uniqueness  duplicate hash present` + `! TS integrity  4 CC discontinuities` | **0** |

Both are WARN so the exit code is 0. That the `damaged` stream gives exit 2 is **entirely thanks to defects 3·4
and their derivatives (timeline loss, decode error).** `tests/run.sh:481`'s `[[ $code -eq 2 ]]` says nothing
about defects 1·2.

Here one more fact about defect 2 is revealed. **The duplicate injection does not target only the uniqueness
check** — put in alone it makes 4 CC discontinuities too. Because the duplicated piece's counter does not connect
with the previous piece. Mapping table row 2's "targeted check: segment uniqueness" is a half-truth.

### 35.5.4 And one knife-edge pass

Look again at the `length consistency` item.

```
! length consistency  measured 24.04s vs declared 30.00s (drift -5.96s / 19.88%)
```

The verdict rule is "if the absolute drift is at least TARGETDURATION, FAIL" ([`report.py:267`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L267)). TARGETDURATION is
6 seconds and the drift is 5.96 seconds. **By a 0.04-second difference it escaped FAIL.**

A whole 6-second segment vanished yet the length check is WARN. This is not a bug but a designed result — this
course's §0.1 starting point, "a total-length comparison cannot be a tool for loss detection," appears here as a
number. What catches the loss is not length consistency but timeline continuity, and that side actually pointed
down to the `5.99~12.02s` **hole position.**

Only, from the regression test's view it is an anxious spot. Had the segment length differed even slightly this
item's verdict flips. **An item with no assertion, even if it flips, no one knows.**

---

## 35.6 Generalization — chaos engineering, mutation testing

Fault injection is not a technique unique to this repository. The same skeleton is called by three names.

> **Term** — **chaos engineering**: the practice of deliberately injecting failures (instance termination, network
> delay, packet loss) into a running distributed system and observing whether the system withstands them.
>
> **Term** — **mutation testing**: the technique of automatically slightly mutating **not the tests but the code**
> (a mutant), then counting whether the existing test suite catches that mutation. An uncaught mutation is
> evidence that the tests do not substantively check that code path.

Organize the three's relation and it is this.

| | What it breaks | What it measures | Where the oracle is |
|---|---|---|---|
| **fault injection** (this chapter) | **input·data** — segment bytes, response, file | does the target system **detect·handle** the defect | the injector knows |
| **chaos engineering** | **environment** — nodes, network, dependent services | does the system **maintain normality** under failure | a steady-state metric |
| **mutation testing** | **code** — operators, constants, conditions | does the **test suite** catch the code mutation | the existing test suite |

All three have the same form.

> **Put in a known defect → observe → compare against expectation.**
> And all three have **"the side that knows what defect was put in" play the oracle role.**

### 35.6.1 Which exactly is this chapter's technique

What `tests/run.sh` does is fault injection, but **the target it means to measure is the same as mutation
testing.** If mutation testing asks "does the test suite catch a code mutation," this script asks "does the
verification tool catch a data defect." In both cases **the checking side is the check target.**

Seen this way, §35.5's result translates exactly into mutation-testing terms.

> **Term** — **equivalent mutant**: a mutation where, despite mutating the code, the observable behavior does not
> change at all so no test can catch it. It is a term to subtract from the denominator when computing the
> mutation score, and automatic detection is generally impossible.

§35.4.1's n = 16 and n = 15 are exactly that. **A stream with 16 taken out is indistinguishable from a normal
stream from the CC check's view** — it is an equivalent mutant for this check. Another check (timeline continuity)
might catch it, but that is **another check catching it**, not the CC check catching it.

This leads to the proposition covered in Chapter 18.

> **A checker's PASS is not "intact" but "not caught by this check."**
> A PASS from a checker whose miss rate is unknown carries information close to 0.

### 35.6.2 The same structure in other fields

| Field | The defect injected | What is verified |
|---|---|---|
| error-correcting code | flip bits deliberately | does the code work up to its correction·detection limit |
| backup·recovery | a restore drill | is the backup actually restorable — a backup-success log is not evidence |
| intrusion detection | test traffic for a detection rule | does the rule actually fire |
| fire alarm | test smoke | is the detector alive |
| static-analyzer benchmark | a codebase with known vulnerabilities planted | the tool's true-positive·false-positive rate |
| medical test | a positive control sample | does the test kit react |

The last two rows are the closest to this chapter. When choosing a static analyzer, the result "0
vulnerabilities" **can mean the tool is good, or that the tool sees nothing.** To distinguish you must feed it a
codebase whose answer you know. A medical test's positive control is the same logic — whether a negative result
means "no disease" or "the test is dead" can be known only if the positive control reacts.

**Fault injection is the positive control for a verification tool.**

---

## 35.7 Security — the defect list is the threat model

### 35.7.1 Defect and attack are two names for the same list

Read this chapter's 8 not as "failures" but as "attacks" and the list becomes the threat model as-is.

| Defect | If it happens by accident | If caused deliberately |
|---|---|---|
| segment 404 | a CDN origin failure | **selective censorship** picking and dropping a particular stretch |
| 200 + HTML | a token-expiry response | **arbitrary-payload injection** into an unverifying client, counted as receive success |
| segment duplicate | an origin misconfiguration | **content replacement** covering another stretch with the same piece |
| TS packet loss | a network loss | **localized tampering evading detection** by aligning to a multiple of 16 |
| subtitle time off | a packaging error | **context manipulation** attaching a subtitle to a different scene |
| a truncated file remains | a process interruption | **making a loss be mistaken for a finished copy** on re-run, permanently missing an episode |

The condition for the right column to hold is uniformly the same — **an unverifying receiver.** A client looking
only at the status code cannot block row 2, a client looking only at the total length cannot block rows 1·3, and
a re-run looking only at file existence cannot block row 6.

This chapter's defect list is therefore also **"the list of what this tool declared it would defend."** What is
not on the list is not a defense target, and stating that fact is the work of writing the threat model.

### 35.7.2 The boundary — what this chapter does not cover

This chapter covers **the checker's reliability**, not the procedure of piercing a particular service's
protection. §35.4.1's "a multiple of 16 is not detected" quantifies the checker's miss rate, and the reason that
fact must be public is the same as Kerckhoffs's principle — **hide the checker's limit and only the defender does
not know while the attacker learns it by experiment.**

### 35.7.3 The defender's view

| Role | What to do |
|---|---|
| **verification-tool author** | state the defect list in the document and leave a table of which check each defect corresponds to. write the un-targeted checks too — **a table where the empty cells are visible is a good table** |
| **tool user** | when you get a "PASS," confirm **what that tool tried putting in.** a PASS from a tool with no defect list is not a basis |
| **CI operator** | run the fault-injection tests **at the same frequency as the normal cases.** skip only the defect tests conditionally and you cannot know even if the verifier dies |
| **security-scanner adoption owner** | necessarily include **a benchmark with known vulnerabilities planted** in the adoption evaluation. a scanner report with no true-positive rate cannot distinguish "no vulnerability" from "no detection ability" |
| **auditor** | when you see a mapping table, ask **whether the 1:1 is measured or intended.** as §35.5 shows, the table is right but the assertion can be passed instead by a different defect |

The last row is the criterion this chapter applied to itself. Not ending at making the mapping table but
**removing the defects one by one** — that is the only way to verify the mapping table.

---

## 35.8 Limits and open questions

Written honestly.

- **The mapping table's 1:1 is only half measured.** As confirmed in §35.5.2, removing defect 1 still passes the
  `CC discontinuit` assertion. Defect 2 also contributes to the CC observation so it is not fully independent.
  **Unless you make a separate stream per defect and confirm one by one, the mapping table's 1:1 is a statement
  of design intent, not an observed fact.** To fix this you must run 8 separate single-defect streams, and the
  test time grows that much — this repository chose speed in that trade.
- **The fault coverage is 6/12.** The eight items left in §35.2.4's table (playlist, response latency, length
  consistency, stream composition, subtitle-extract failure, subtitle batch collect, full decode, embedded
  caption) have no targeted injection. Among these, response latency needs a server that adds delay, and
  subtitle-extract failure needs to fail ffmpeg, so the injection cost is high.
- **Side effects are outside the table.** `full decode FAIL` and `length consistency WARN` are derived results not
  in the mapping table. With no assertion, if they vanish one day no one knows. In particular length consistency
  is a spot where the verdict **splits by a 0.04-second difference** — drift 5.96 seconds against threshold 6
  seconds.
- **The assertions are coupled to the report strings.** `grep -q 'subtitle timeline.*out of the video range'`
  breaks if the message is changed by even one character. Conversely, **leave the message as-is and break only the
  verdict logic and it can pass** — for instance change FAIL to WARN and the string is the same so `grep`
  succeeds. The exit-code check fills that hole partly, but as seen in §35.5.3 it does not apply to defects 1·2.
- **The cause attribution of the negative offset could not be confirmed.** `tests/run.sh:90-91`'s comment writes
  the cause as "ffmpeg sees it as invalid and ignores the mapping." What was confirmed by measurement is the
  **result** (a negative offset means no correction is applied and the check ends PASS), and the actor discarding
  the mapping in this repository's pipeline is [`subtitles.py:209-210`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L209-L210) — **the repository's own range check.** Since the
  offset is computed by this function on every path and passed to ffmpeg via `-itsoffset` ([`subtitles.py:361-366`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L361-L366)),
  how ffmpeg handles the same value is not observed on this path. The comment's spec basis (33-bit unsigned) is
  right but **the actor may not be ffmpeg.**
- **The `n = 15` blind spot is this repository's implementation property.** It comes from the judgment of passing
  over `cc == prev` as a spec-permitted duplicate ([`tsanalyze.py:115`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L115)). Another implementation may handle it
  differently, so the existence of this blind spot is **not a property of the MPEG-TS spec but a property of this
  checker.** Only the n = 16 side is a universal blind spot coming from the 4-bit representation limit.
- **There is one measurement environment.** All measurements in this chapter were obtained on macOS · ffmpeg
  8.1.1 · Python standard `http.server`. On a stream made by an encoder with a different segment size·PID
  layout·PAT/PMT period, details like §35.4.2's "the front 12 span four PIDs" change. The conclusion (the injection
  position determines the detection position) stands but the numbers need re-measuring.

---

## 35.9 Summary

1. **A test putting in only normal input passes an "implementation that always gives PASS."** To verify the
   verifier you need an input for which a wrong answer must come out, and making and feeding it is fault
   injection. The injector knowing the answer is itself the oracle.
2. This repository injects **8 defects** and fixes each as an assertion on a report string. That mapping table is
   the declaration of fault coverage, and **making even the empty cells visible** is the reason for the table
   (currently 6/12).
3. The 8 are not crowded on one layer — they are placed, one or more each, on **six layers**: transport result·
   payload identity·bit level·piece identity·time axis·local-file state. Each defect is not an invention but **a
   model of an actually observed failure.**
4. **The numbers are not arbitrary.** 12 is a size avoiding the 4-bit counter's two blind spots (multiple of 16,
   remainder 15) while not touching the timeline check. It must be the middle for the injection spot and detection
   spot to coincide. It must be a multiple of 188 for it to be "loss" and not "sync collapse."
5. **The subtitle offset must be positive.** Negative and the 33-bit-unsigned check discards the mapping so no
   correction is applied and the subtitle stays at its original time (inside the video range) and **the check ends
   PASS** — confirmed by measurement (exit 2 vs exit 0). Fault injection must be done within the detector's
   verdict rule.
6. The same principle applies to defect 8. **2** of the 3 episodes must have subtitles, and with 1 it is
   classified as "a work originally without subtitles" and no loss is reported. **An injection not satisfying the
   detector's precondition is not a defect but noise.**
7. **But the mapping table's 1:1 is not measured.** Put the four together in one stream and the observations are
   confounded — of the 11 CC discontinuities defect 1's share is 1, and **remove defect 1 and 10 remain so the
   assertion still passes.** Defects 1·2 are WARN so they do not contribute to the exit code either.
8. Fault injection shares the same skeleton as chaos engineering·mutation testing. What this repository measures
   is the same question as mutation testing — **checking the checking side.** A defect indistinguishable by any
   check, like removing 16, is an **equivalent mutant** for that check, and so **PASS is not "intact" but "not
   caught by this check."**
9. Read the defect list as an attack list and it becomes the **threat model** as-is. What is not on the list is
   not a defense target, and stating that is the tool author's duty.

---

**Next chapter** — this chapter fixed "does our tool catch the defect." But that alone does not say **why** the
tool is needed. `tests/run.sh`'s last section feeds the same defect stream to ffmpeg alone and **nails the very
fact that exit code 0 comes out as a test.** Chapter 36 covers control-group design — what you gain by fixing the
comparison target's failure in a regression test, and what happens to that test when the comparison target
improves.
