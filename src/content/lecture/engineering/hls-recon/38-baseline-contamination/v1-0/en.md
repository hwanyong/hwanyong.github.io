---
title: "Baseline Contamination and the Withheld Verdict"
description: "Distinguishing unknown from pass"
date: 2026-08-16
version: '1.0'
tags: ['streaming', 'verification']
thumbnail: /images/lecture/thumb/hls-recon-38-baseline-contamination.svg
---
## 38.0 What this chapter answers

1. What structure makes a check **never able to fail?**
2. Where must the baseline come from — what qualifies as a baseline?
3. What must be output on a run where the baseline does not hold?
4. What exactly should the symbol `PASS` mean?

Chapter 34 went as far as **"the PASS of a tool whose true-positive rate is unknown is not information."** This
chapter is the next two steps. One is a **check whose true-positive rate is structurally 0** — not unknown for
lack of measurement, but a check that in principle cannot fail because of how the code is arranged. The other is a
**condition where the very phrase "true-positive rate" does not hold** — a run whose premise has collapsed.

The prescriptions for the two problems look opposite, but their root is the same. The first is "make the check
able to fail," and the second is "if you cannot check, do not check." What joins them is one question — **what
does `PASS` assert as a symbol.**

---

## 38.1 The problem — a defect is put in and the check passes

### 38.1.1 Reproduction

Bring out fault injection #5 from Chapter 35 again. It is a stream whose subtitle track's `X-TIMESTAMP-MAP`
standard is knocked 60 seconds off. The video is 30 seconds and the subtitle cues sit at 0–29 seconds, but apply
the off mapping as-is and the subtitles push out to 60–89 seconds.

> **Term** — **`X-TIMESTAMP-MAP`**: an HLS extension header at the head of a WebVTT segment, giving the
> correspondence point that joins the subtitle's local time (`LOCAL:`) with the video's MPEG-TS presentation time
> (`MPEGTS:`, in 90 kHz units). The alignment offset comes out of this mapping (Chapter 27).

Receive this stream in the **way that embeds the subtitle into the container** and the tool reports as follows.
Below is the output actually run locally while writing this chapter.

```
  ✗ length consistency  measured 89.00s vs declared 30.00s (drift +59.00s / 196.67%)
  ✓ subtitle embed      1/1 track embedded (xx), codec subrip, X-TIMESTAMP-MAP alignment 1 track corrected
  ✗ subtitle timeline   embedded subtitle 60.0~89.0s vs video 30.0s — out of video range, X-TIMESTAMP-MAP alignment failure suspected
```

Measure the artifact's actual duration directly and it is this.

```
$ ffprobe -v error -show_entries format=duration -of csv=p=0 badembed.mkv
89.000000
```

**The video is 30 seconds but the file is 89 seconds.** The subtitle track's last cue ends at 89 seconds, so the
container's whole length stretched out to there.

### 38.1.2 Here one fork appears

To judge "did the subtitle go out of the video range" you need the **video's length.** Where will you get that
value. There are two candidates, and both are plausible.

| Candidate | Value | Why plausible |
|---|---|---|
| **A — the length the playlist declared** | `30.00s` | the value the spec set (the `#EXTINF` sum) |
| **B — the measured duration taken from the artifact** | `89.00s` | the real length of the actually-made file |

Intuitively B looks more accurate. A declaration is a self-reported value and a measurement is real (all the more
if you learned Chapter 5). **But the moment you pick B, this check dies.**

### 38.1.3 The result of changing only the baseline

Leaving the measured values as-is and swapping only the baseline A ↔ B, I called the verdict function
(`report.build`) twice. The run result.

```
playlist declared length 30.00s    → FAIL  | embedded subtitle 60.0~89.0s vs video 30.0s — out of video range, …
measured duration (baseline contaminated)  → PASS  | embedded subtitle 60.0~89.0s vs video 89.0s
```

**Same measured values, same verdict rule, same code.** Only the one line of where the baseline is taken from
differed, and `FAIL` flips to `PASS`.

![Baseline contamination — the subtitle drags the baseline itself](/images/lecture/hls-recon/38-baseline-contamination.svg)

*Figure 38-1 — baseline contamination — the subtitle drags the baseline itself*

---

## 38.2 The principle — self-referential verification

### 38.2.1 The algebra of contamination

Organize the symbols and why this happens ends in two lines of arithmetic.

- `V` — the time the video ends
- `S` — the time the subtitle's last cue ends
- `ε` — the verdict margin (`5.0` seconds in this code)

The container's measured duration must cover every stream inside it, so

```
D = max(V, S)
```

and the verdict rule is "did the subtitle end exceed the baseline by `ε` or more."

Put the baseline at **A (declared length = V)** and the verdict expression is `S > V + ε`. False when normal, true
when the subtitle is pushed out — the rule works as intended.

Put the baseline at **B (measured = D)** and the verdict expression becomes `S > max(V, S) + ε`. Split by case.

| Case | `max(V, S)` | Verdict expression | Result |
|---|---|---|---|
| `S ≤ V` (normal) | `V` | `S > V + ε` → false | PASS — correct |
| `S > V` (**defect**) | `S` | `S > S + ε` → **always false** | PASS — **wrong** |

The second row is everything. Whether `ε` is 0 or 5 or 1000, `S > S + ε` cannot become true. **This check does not
fail on any defect.**

### 38.2.2 The size of the defect and the size of the contamination are exactly equal

The inequality does not just narrowly miss. Push the subtitle 60 seconds and the baseline shifts exactly 60
seconds; push 600 seconds and the baseline shifts 600 seconds. **The signal and the noise come from the same
source and cancel completely.**

Here a nastier property comes out. Contamination **arises only when the detection target exists.** In a normal
case with `S ≤ V`, `D = V` so baselines B and A are the same value. That is,

> **This defect can never be found with a normal input.**

Run a normal stream however many times and A and B give the same value, so neither code review nor integration
test reveals the difference. The only input where the difference appears is a **defective input**, and on exactly
that input the check falls silent. The values confirmed by measurement are these.

| Stream | Video end `V` | Subtitle end `S` | Container measured `D` | Difference of A and B |
|---|---|---|---|---|
| normal subtitle · embedded | 30.02s | 29.0s | **30.02s** | none |
| misaligned subtitle · embedded | 30.02s | 89.0s | **89.00s** | **59s** |

### 38.2.3 The name — self-referential verification

> **Term** — **baseline**: the reference value the verdict rule weighs the observed value against. The value that
> answers "against what do we call it abnormal."

> **Term** — **baseline contamination**: a state where the target the check tries to measure influences the
> baseline's value, so the baseline moves along with the observed value.

A check in this state this course calls **self-referential verification** — a form where the observed value and
the baseline come from the same source, so the check in effect compares itself with itself. It is not a widely
agreed name, so I note it is this course's naming. The adjacent concept that has a settled name is statistics'
**circular analysis** — the error of choosing a hypothesis from the same data and testing that hypothesis on it.

Here comes this chapter's first proposition.

> **If the measurement target influences the measurement standard, that verification is void.**

The word void matters. Not "accuracy drops" but **the true-positive rate is 0.** The check item prints in the
report as-is, a green `✓` is stamped, and 1 is added to the pass count. On the surface it looks like one more
check exists while in reality there is **a line that checks nothing.**

### 38.2.4 What differs from Chapter 34

Chapter 34 §34.7 organized with information theory that the output of a tool whose true-positive rate is 0 carries
0 bits. This chapter treats **another path** that reaches that state. The difference of the two matters in
practice.

| | Chapter 34 | Chapter 38 §38.1–38.3 |
|---|---|---|
| Why the true-positive rate is 0 | the tool has no ability to see that defect | the check sees the defect but **the verdict expression cannot become true** |
| Is it visible in the code | there is no check item at all — conspicuous | the check item exists and looks to work fine |
| How to find it | inject a defect and count misses | inject a defect + **trace the baseline's origin** |
| The honest expression | "this defect is outside the detection range" | there is no way to express it — **it makes a wrong assertion** |

The last row is this section's point. A check with no ability can just say it has none, but a contaminated check
**says it has one while it has none.** The document, report, and regression test all count that check as "present,"
so the next person believes there is a control at that spot.

### 38.2.5 The qualifications of a baseline

To avoid contamination the conditions a baseline must meet can be made explicit.

| Requirement | Meaning | In this code |
|---|---|---|
| **independence** | even if the measurement target changes, the baseline does not | the declared length comes from the playlist and is unrelated to the artifact |
| **antecedence** | it is fixed before the measurement | `#EXTINF` is parsed before download |
| **observability** | it is actually in hand at the moment of verdict | [`playlist.py:172-175`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L172-L175) has computed it |
| **expressibility** | when it does not hold, it can say "none" | the sample run knows it does not hold → §38.4 |

One caution here. **Independence is not reliability.** The declared length is also in the end a value the server
gave, and if the server lies the baseline is wrong (Chapter 5). What independence guarantees is only that "the
measurement target cannot move the baseline." This limit is revisited in §38.9.

---

## 38.3 The code — where the baseline is taken from

### 38.3.1 The decision is on one line with a comment

```python
# report.py:337-343
    # 6) subtitle — extraction success and consistency with the video timeline
    #
    # The baseline is the playlist declared length, not the measured duration. Embedding the subtitle
    # into the container stretches the whole duration to the subtitle's end, so taking the measured value
    # as the standard lets a pushed-out subtitle drag the standard itself and the check always passes.
    video_len = declared_duration or (media.duration if media and media.ok else 0.0)
    if subs and (subs.results or subs.embedded or subs.embed_tracks or subs.extra):
```

The three-line comment holds all of §38.2. That this repository's comments are a **record of a measured failure**
shows best right here — not "do it this way" but written as a counterexample, **"take the measured value as
standard and the check always passes."**

`declared_duration`'s origin is the playlist.

```python
# playlist.py:172-175
    @property
    def declared_duration(self) -> float:
        """The sum of EXTINF declared values — the baseline to compare against the measured duration."""
        return sum(s.duration for s in self.segments)
```

`#EXTINF` is a playback-length declaration attached per segment, and its sum is fixed **before the artifact is
made.** §38.2.5's independence·antecedence hold here.

### 38.3.2 What the `or` fallback left

Tear apart one more line.

```python
video_len = declared_duration or (media.duration if media and media.ok else 0.0)
```

If `declared_duration` is 0 it descends to the measured value. That is, **the contaminated baseline lives on
through the fallback path.** There is a basis both to defend and to criticize this design.

| | Basis |
|---|---|
| **defense** | even in a playlist with declared length 0 (`#EXTINF` missing·parse failure) the check is not lost entirely. In such an input the subtitle is likely not embedded, so contamination does not actually happen |
| **criticism** | that judgment is written nowhere in the code. The condition under which the fallback fires and whether there is contamination risk then **the reader must reconstruct.** Per §38.2.2 this defect does not reveal itself with a normal input, so the fallback path is not fixed by a regression either |

This course's judgment is the **criticism side.** That `0.0` doubles as "no value" is the root of the problem.
Expressing no-value as `None` and descending in that case to §38.5's withheld verdict fits §38.2.5's
**expressibility** requirement. Only, this repository does not do so, and I record that fact here.

### 38.3.3 Contamination does not come only to the baseline

Pull two values from the same artifact and **which side is contaminated depends on the check's arrangement.** The
"length consistency" check right above is the opposite case.

```python
# report.py:262-278 (excerpt)
    if media and media.ok:
        drift = media.duration - declared_duration
```

Here the declared length is the baseline and **the measured value is the measurement target.** The direction is
correct. But embed the subtitle and that measurement-target side is contaminated. Put the three measured runs side
by side and it is this.

| Run | length-consistency result | actual state | nature of the verdict |
|---|---|---|---|
| normal subtitle · embedded | `PASS` measured 30.02s vs declared 30.00s | normal | correct |
| misaligned subtitle · embedded | `FAIL` measured 89.00s vs declared 30.00s | subtitle is defective | **conclusion right, diagnosis wrong** — it says the video length is off but the video is fine |
| sample run · embedded | `FAIL` measured 29.00s vs declared 6.00s | **normal** | **false positive** |

Do not pass over the second row as "caught by luck." That FAIL **asserts the video length is off** while the video
is exactly 30.02 seconds. The person reading the report goes hunting for a segment loss, and there is nothing
there. **A verdict that reaches a right conclusion for a wrong reason spends the next person's time.**

Generalized, it is this.

> **Pull the measurement target and the measurement standard from the same artifact, and chance decides which is
> contaminated.**
> The fundamental prescription is not to choose the value but to **separate the paths.**

### 38.3.4 Contamination differs by path

Depending on how the subtitle is produced, contamination happens or does not. Measured.

| Subtitle handling | Artifact | Container measured duration | Contamination |
|---|---|---|---|
| separate file (sidecar) — pulled as `.srt` | `badsub.mp4` | **30.02s** | none — the subtitle is outside the container |
| container embed — `--sub-embed` | `badembed.mkv` | **89.00s** | **present** |

**Same defect, same check, different contamination.** On the separate-file path, even taking the baseline
wrongly as the measured value catches the defect (89.0 > 30.02 + 5.0). So this bug **reveals itself on only one
path.**

### 38.3.5 So the regression test puts it in twice

```bash
# tests/run.sh:500-510
# In embed mode too the same defect must be caught. Putting the subtitle into the container stretches the whole
# duration to the subtitle's end, so taking the baseline as the measured value makes this check always pass.
ELOG="$WORK/out/badembed.log"
set +e
"$RECON" "$BASE/master-badsub.m3u8" -o "$WORK/out/badembed.mkv" --subs all --sub-embed \
  --no-decode-check --no-gap-scan >"$ELOG" 2>&1
ecode=$?
set -e
grep -q 'subtitle timeline.*out of video range' "$ELOG" \
  && ok "detects a subtitle timestamp mismatch (embedded)" || bad "missed a subtitle timestamp mismatch (embedded)"
[[ $ecode -eq 2 ]] && ok "embedded subtitle defect exit code 2" || bad "embedded subtitle defect exit code: $ecode"
```

This is the spot Chapter 35 §35.4.7 introduced as "the only item that puts the same defect in twice." Now why
twice becomes exact — **the separate-file case right before it (`tests/run.sh:489-498`) passes even with the
baseline contaminated.** The regression that detects contamination is only the embed case, and remove it and
reverting §38.3.1's one line to the measured value leaves every test green.

Here a general principle of regression-test design comes out.

> **A regression that guards a design decision must be an input that actually goes red when that decision is
> wrong.**
> Guard the decision with only a comment and the next person fixes it to "but the measured value is more
> accurate," and all 62 tests pass.

---

## 38.4 Problem two — a run where the baseline does not hold at all

### 38.4.1 The `--limit` sample run

This tool has an option to receive only the first N segments and check quickly.

```bash
# README.md:62-63
# Quickly sample-verify only the first 20 segments
hls-recon https://cdn.example/master.m3u8 -o sample.mp4 --limit 20
```

The cut point is the segment list, and the baseline is recomputed from the cut list.

```python
# cli.py:414-415
    segs = pl.segments[: args.limit] if args.limit else pl.segments
    declared = sum(s.duration for s in segs)
```

**Up to here it is consistent.** The video is cut and the baseline is cut along with it. The problem is the
subtitle.

### 38.4.2 The subtitle is not cut

The subtitle track is a separate playlist, and `--limit` applies only to the video segment list. The subtitle
comes whole. So in the sample run this arrangement is made.

| | full run | `--limit 1` sample run |
|---|---|---|
| video | 0.0 – 30.0s | **0.0 – 6.0s** |
| subtitle | 0.0 – 29.0s | 0.0 – 29.0s (unchanged) |
| verdict expr `S > V + 5` | `29.0 > 35.0` → false | `29.0 > 11.0` → **true** |
| judged as-is | PASS | **FAIL** |

**It is a normal stream but FAIL comes out.** And this is not a false positive that happens by chance. As long as
the subtitle length is longer than the sample length it **necessarily** goes out, so in the sample run this check
is in a state exactly symmetric to §38.2 — this time **the true-positive rate is not 0 but the true-positive rate
is meaningless.** Because the verdict expression measures the run option, not the input's property.

> **Term** — **sample run**: a run that processes not the whole target but only part of it. Here it refers to the
> `--limit` run that receives only the first N segments of the playlist.

### 38.4.3 There are three choices

| Choice | Result | Problem |
|---|---|---|
| ① judge as-is | FAIL on a normal stream | false positive. Use `--limit` and it is always red, so people come to ignore the check itself (Chapter 22's alert fatigue) |
| ② if sampled, cut the subtitle length too and compare | plausible but wrong | where to cut the subtitle is itself the assumption "the alignment is right." **Putting what you want to check into the assumption** — the same circle as §38.2 |
| ③ do not check and **output that fact** | this code's choice | the result vocabulary needs one more value |

② is dangerous because it is attractive. The handling "since it is a sample, look at only the first 6 seconds of
the subtitle too" holds only if you **presuppose the subtitle is aligned with the video**, and that presupposition
is exactly what this check was going to confirm. The circle is the same kind of error as §38.2's contamination,
differing only in form.

---

## 38.5 The code — the withheld verdict

### 38.5.1 The premise check comes before the verdict rule

```python
# report.py:421-430
            # If the subtitle time goes out of the video length, the X-TIMESTAMP-MAP alignment is off.
            # A run that took only the front part via --limit is the exception — only the video is cut and
            # the subtitle comes whole so it necessarily goes out. A check whose baseline does not hold is not done.
            if good and sampled:
                rep.add(
                    "subtitle timeline",
                    PASS,
                    f"verdict withheld — the video is a sample with only the first {video_len:.1f}s received "
                    f"so there is no baseline to compare against the subtitle's whole length ({max(r.last_cue for r in good):.1f}s)",
                )
```

The comment's last sentence is all of this section — **"a check whose baseline does not hold is not done."**

What to note in the structure is the **order of the conditions.** The `sampled` branch is in the `if`, and the
actual verdict rule is in the `elif` after it ([`report.py:431`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L431)).

```python
# report.py:431-432
            elif good and video_len > 0:
                strayed = [r for r in good if r.last_cue > video_len + 5.0 or r.first_cue < -0.5]
```

The premise check and the verdict rule are **in the same `if/elif` chain and the premise is in front.** This is
the design. Put the premise inside the verdict rule (e.g. compute `strayed` then "if sampled, ignore") and the
computation has already happened, and when later someone starts using that value elsewhere the premise leaks out.

![The premise gate that comes before the verdict rule](/images/lecture/hls-recon/38-unknown-vs-pass.svg)

*Figure 38-2 — the premise gate that comes before the verdict rule*

### 38.5.2 Where `sampled` comes from

The premise's truth comes not from measurement but from the **run condition.** So the verdict function cannot find
it out on its own, and the caller tells it.

```python
# cli.py:639
        sampled=bool(args.limit and mode == "segments"),
```

The reason the `mode == "segments"` condition is attached is that `--limit` actually applies only in that mode. In
the `remux` mode that delegates wholesale to ffmpeg it is ignored, and the user is told that fact
([`cli.py:589-590`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L589-L590)). **That an option was specified and that an option took effect are different facts, and the
premise must look at the latter.**

### 38.5.3 The measured output

The result of running a normal stream with `--limit 1`.

```
  ✓ playlist            1 segment, declared length 6.00s, TARGETDURATION 6s, no encryption
  ✓ segment receive     1 all received once, 1.6 MB
  ✓ TS integrity        8,663 packets / 5 PIDs, 0 loss
  ! length consistency  measured 6.04s vs declared 6.00s (drift +0.04s / 0.62%)
  ✓ subtitle extract    1 all extracted (ko 6 cues) — 3 boundary-duplicate cues removed, 4 fragment headers mixed in the body cleaned
  ✓ subtitle timeline   verdict withheld — the video is a sample with only the first 6.0s received so there is no baseline to compare against the subtitle's whole length (29.0s)
```

The sentence **says together why it is withheld and what is missing.** It is different from stamping only "verdict
withheld." The reader knows from this line alone as far as "run it again as a full run and it is judged."

One side branch shows too — "length consistency" is `!` (WARN). The relative drift of 6.04 vs 6.00 is 0.62%,
exceeding the 0.5% threshold. It is Chapter 22's point that the smaller the sample, the more a relative metric
shakes, and it is also **a signal that the sample run shakes not only the one subtitle check.**

### 38.5.4 Fixed by regression

```bash
# tests/run.sh:296-303
# A --limit sample cuts only the video, so the subtitle-timeline check's baseline does not hold.
set +e
"$RECON" "$BASE/plain/index.m3u8" -o "$WORK/out/sample01.mp4" --limit 1 \
  --sub-guess --sub-origin "$BASE" --sub-name episode01 --sub-format srt \
  --no-decode-check --no-gap-scan >"$WORK/out/sidecar4.log" 2>&1
set -e
grep -q 'subtitle timeline.*verdict withheld' "$WORK/out/sidecar4.log" \
  && ok "withholds the timeline verdict in a sample run" || bad "judged the timeline though it is a sample"
```

That the failure message is `bad "judged the timeline though it is a sample"` matters. This assertion **confirms
not "a FAIL did not come out" but "it did not judge."** Even if `PASS` comes out, if it is a judged PASS this test
goes red.

If Chapter 37's bidirectional fixing pinned the false positive and the false negative together, this assertion
pins a **third direction** — whether the verdict itself did not happen.

### 38.5.5 What breaks if this is not done

Remove the premise gate and, per §38.4.2's table, a normal stream gives FAIL. That result does not end at one line
of the report.

| Layer | When there is no gate |
|---|---|
| report | `✗ subtitle timeline` on a normal stream |
| exit code | `FAIL` → `exit 2` ([`cli.py:651-652`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L651-L652)) |
| CI | the fast-verify job that uses `--limit` **always fails** |
| people | the knowledge "run a sample and the normal subtitle goes red" piles up in the team — from then no one looks at that line |

The last row is the real cost. A false positive does not end at losing one check but **wrecks the reading habit**
(Chapter 22's alert fatigue). And once the habit is wrecked, a real FAIL is ignored on the same line too.

---

## 38.6 Three values are not enough — a withholding that ships out as `PASS`

### 38.6.1 The result vocabulary

This tool's verdict vocabulary is three.

```python
# report.py:15
PASS, WARN, FAIL = "PASS", "WARN", "FAIL"
```

And the per-item verdict folds into the whole-report verdict.

```python
# report.py:84-90
    @property
    def verdict(self) -> str:
        if any(c.verdict == FAIL for c in self.checks):
            return FAIL
        if any(c.verdict == WARN for c in self.checks):
            return WARN
        return PASS
```

**There is no value here for "did not judge."** So §38.5.1's code ships the withholding as `PASS`, and writes
"verdict withheld" only in the human-read string.

### 38.6.2 On the machine-read side the distinction vanishes

The report also goes out as JSON (`--report`). Pull the sample run's JSON for real and it is this.

```json
{
  "name": "subtitle timeline",
  "verdict": "PASS",
  "detail": "verdict withheld — the video is a sample with only the first 6.0s received so there is no baseline to compare against the subtitle's whole length (29.0s)"
}
```

To the consumer that reads only the `verdict` field — a dashboard, an aggregation script, an upper pipeline — this
line is **completely the same as a judged PASS.** To distinguish it you must match the `detail` string, and that
is the same fragility as §35.4.7's "an assertion depending on a one-character difference."

### 38.6.3 So what breaks

| Consumer | The value it sees | What it misreads |
|---|---|---|
| person (terminal) | `✓ … verdict withheld — …` | distinguished — the sentence tells |
| aggregation script | `verdict == "PASS"` | **"the subtitle-timeline check passed"** |
| dashboard pass rate | 1 PASS | check coverage is counted higher than real |
| next person's decision | "the sample run does the subtitle check too" | uses the sample run as a substitute for the full run |

The last row is this section's conclusion. **Fold a withholding into a pass and that fold does not end at the
report but flows into the next person's decision.** This tool kept the distinction on the human-read channel and
failed to keep it on the machine-read channel. A distinction kept only halfway.

Here comes this chapter's second proposition.

> **A result vocabulary that cannot distinguish unknown from pass loses the distinction in the end even if there
> is code trying to keep it.**
> A distinction is kept **only where it can be expressed.**

---

## 38.7 Generalization

### 38.7.1 Self-referential verification is everywhere

§38.2's form — **the measurement target moves the baseline** — does not pick a domain.

| Case | Measurement target | Contaminated baseline | Why the check passes |
|---|---|---|---|
| **this chapter** | subtitle end time | container measured duration | duration is `max(video, subtitle)` so pushing the subtitle pushes it too |
| **snapshot test auto-update** | current output | the golden file updated to the previous run's output | the regression becomes the new standard and passes forever |
| **static-analysis baseline file** | new warnings | the baseline holding existing warnings | add a new warning to the baseline and it is always green |
| **performance budget "vs last deploy"** | bundle size·response time | the previous deploy's value | worsen 1% each deploy and it passes forever. With no absolute budget you cannot catch the drift |
| **anomaly detection's moving average** | current traffic | the last N-day average (including anomalous traffic) | raise it slowly and the baseline rises along, never reaching the threshold |
| **LLM self-evaluation** | model output | a score given by the same model | the output's bias comes from the same source as the scoring's bias |
| **inventory count** | the actual quantity in the warehouse | counting while looking at the book quantity | if the counter knows the expected value the observation is pulled toward the expectation |

The middle three rows are especially common. All three have the convenience feature **"auto-update the baseline"**
as the channel of contamination. Auto-update reduces noise but erases the signal along with it.

The prescription is common too.

> **The baseline comes from a different path than the measurement, before the measurement.**
> If auto-update is needed, block the update with **human approval**, or place an absolute standard alongside.

This repository's choice is that form — the baseline comes from the playlist (a different path), before download
(antecedent).

### 38.7.2 `unknown` is not `pass`

The second proposition is a result-vocabulary problem. Mature specs put this distinction **into the type.**

| System | pass | **unknown / not applicable** | fail |
|---|---|---|---|
| **SARIF 2.1.0** (static-analysis result exchange format) | `pass` | `notApplicable`, `open`, `review`, `informational` | `fail` |
| **TAP** (Test Anything Protocol) | `ok` | `# SKIP` · `# TODO` directives | `not ok` |
| **JUnit XML · pytest** | success | `skipped`, `xfail` | `failure`, `error` |
| **OCSP** (certificate revocation status query) | `good` | **`unknown`** | `revoked` |
| **DNSSEC validation** | `secure` | `insecure`, `indeterminate` | `bogus` |
| **SQL three-valued logic** | `TRUE` | **`UNKNOWN`** (NULL comparison) | `FALSE` |
| **compliance audit** | effective | **`N/A`**, not tested | exception |
| **medical test** | negative | inconclusive · unsuitable specimen | positive |
| **HTTP status codes** | 2xx | — **none** | 4xx·5xx |

The last row was Chapter 5's subject. HTTP has no code to say "the request was processed but the result is not
guaranteed," and so the one 200 takes on all sorts of meanings.

> **Term** — **three-valued logic**: a logic system that, on top of true·false, places **undetermined (unknown)**
> as a third value. SQL's `NULL` comparison is representative, and `NULL = NULL` is neither true nor false but
> `UNKNOWN`.

The core is not that there is one more value but that it **forces the fold rule to be made explicit.** When folding
three values into two, which side to send `UNKNOWN` is a decision that must be made, and that decision is exactly
**fail-open or fail-closed.**

| Fold direction | Name | Where appropriate | Where inappropriate |
|---|---|---|---|
| `UNKNOWN → pass` | **fail-open** | where availability matters more than safety | access control, revocation check, vulnerability verdict |
| `UNKNOWN → fail` | **fail-closed** | access control, integrity verification | an observation tool where a false positive is very costly |
| keep unfolded | — | report·audit artifacts | an execution path that needs an immediate binary decision |

This tool is at the spot that should choose the third row — a report is an artifact a human reads and decides on,
so there is no reason to fold. Yet as seen in §38.6 the machine channel folds to the first row. **A spot where the
intended design and the actual expression are off.**

---

## 38.8 Security — "not checked" and "no vulnerability"

### 38.8.1 The 0 findings of a scan report

The path to "0 findings" in a vulnerability scan is not one.

| What actually happened | What is left in the report | The right expression |
|---|---|---|
| authentication failed, could not see past login | 0 findings | **not checked** — auth-required area coverage 0% |
| the target host did not respond | no vulnerability | **unreachable** |
| the plugin does not know that product·version | 0 findings | **no applicable rule** |
| the parser died on new syntax, 0 analysis targets | 0 results → green | **analysis failure** |
| the server is missing from the asset list | that server is not in the report | **out of scope** |
| the scan timed out, swept only half | the result of the swept half | **partial check** |
| genuinely checked and there is no vulnerability | 0 findings | pass |

**Seven lines come out as the same sentence in the report.** Only the last line is "pass" and the other six are all
`UNKNOWN`, but with no `UNKNOWN` in the vocabulary the six fold into one.

If Chapter 34 §34.8 treated **the detector's silence**, this section treats the stage where that silence is
**translated into an affirmative sentence** in the report. Silence is a state of no information, but "no
vulnerability" is an active assertion. **The translation that turns absent information into a present assertion
happens here.**

### 38.8.2 Threat model — aiming at the fold

From an attacker's stance, breaking the check logic and making the check `UNKNOWN` differ in cost.

| Goal | Ability needed | Trace left |
|---|---|---|
| a new technique to bypass the detection rule | high | the attempt may be left in a log |
| **making the check `UNKNOWN`** | **low — cut the response or slow it** | **none. The report is green** |

The best-known case is **OCSP soft-fail.**

> **Term** — **OCSP (Online Certificate Status Protocol)**: a protocol that asks the issuing authority in real
> time whether the presented TLS certificate has been revoked. The response is one of `good` · `revoked` ·
> `unknown`.

> **Term** — **soft-fail**: a policy that, when the revocation status could not be confirmed, does not block the
> connection but proceeds. The opposite is hard-fail.

Look at the structure and this chapter's two propositions come out as-is. No response arriving is `UNKNOWN`, and
soft-fail folds it to `good`. Then **the side whose certificate was revoked neutralizes the revocation just by
blocking the OCSP response path.** The control called revocation check exists, the code runs, the result comes out
`good`, and yet nothing was actually confirmed.

This course does not treat how to execute that path. What it treats is **why that policy came to be and what the
defender changed.** The direction browsers went was not to re-choose which way to fold `UNKNOWN` but **to move to a
structure where `UNKNOWN` does not arise** — OCSP stapling where the server pre-attaches the response, distributing
the revocation list to the client in advance, and so on. The best solution to a three-value problem is often **to
change the design so the third value does not occur.**

### 38.8.3 Why compliance separates `N/A` and `PASS`

Audit systems put this distinction into the type long ago. A control item's result is at minimum four.

| Result | Meaning | If this item vanishes |
|---|---|---|
| **effective** | the control exists and its operation was confirmed | — |
| **N/A** | there is no target for the control at all (e.g. does not store card data) | it comes to claim it blocked a risk that does not exist |
| **not tested** | the target exists but was out of this audit's scope | **the unchecked is counted as pass** |
| **exception** | the control is absent or did not work | — |

Why `N/A` and not-tested are separated is especially important. Both are "no check result," but the **follow-up is
opposite.** `N/A` needs nothing done, and not-tested must be looked at in the next cycle. Merge them into one and
the basis for the follow-up vanishes.

This repository's report also has a spot that needs the same distinction. The absence of "subtitle timeline" means
different things by case.

| Situation | Nature | Current report |
|---|---|---|
| subtitle not requested | **N/A** — there is no check target | the item is absent entirely |
| sample run | **not tested** — the target exists but there is no baseline | `PASS` + "verdict withheld" |
| full run, subtitle normal | pass | `PASS` |

Only the middle line is distinguished by a sentence, and the first line is expressed as the **item's absence.** How
to read an absent item is Chapter 39's subject.

### 38.8.4 The security edition of baseline contamination

§38.2's contamination is used as an attack technique too. The target is a **detector using an adaptive baseline.**

> **Term** — **adaptive baseline**: a way of continually updating the normal range with recent observations.
> Instead of absorbing seasonality·trend automatically, an outlier that entered the update window moves the
> baseline itself.

Keep the attack traffic under the threshold while raising it slowly and the baseline rises to follow it. No
observation at any moment exceeds that moment's baseline, so no alert fires. It is exactly this chapter's structure
of **the measurement target dragging the baseline.**

The defense is the same as §38.7.1's prescription.

- **Exclude the intervals judged anomalous** from the baseline update window (block contamination)
- Place an **absolute threshold** alongside the adaptive baseline (a drift ceiling)
- **Watch the baseline's change itself** — if the baseline tripled within a month, that is the signal

### 38.8.5 The defender's view

| Role | What to do |
|---|---|
| **tool maker** | put `UNKNOWN`·`N/A` into the result vocabulary. Hold it in the human-read string only and do not fold it to `PASS` in the machine field — the fold necessarily leaks out to the consumer side |
| **scanner operator** | put **coverage** on page 1 of the report. Auth success, the list of unreachable hosts, the applied rule version, the timeout count. "0 findings" gains meaning only with these four alongside |
| **auditor** | require **what was checked** next to "pass." Same as Chapter 15's principle — an assertion without measurement is a verification target, not a basis. Here go one step further: **a pass without scope is not even an assertion** |
| **detection engineer** | document the adaptive baseline's update rule, and exclude anomalous intervals from the update window. Watch the baseline itself as a metric |
| **PKI·client implementer** | if you adopted soft-fail, make explicit that it is the **intended threat model.** If possible, move to a structure where `UNKNOWN` does not arise (stapling·pre-distribution) |
| **development team** | **forbid auto-update of snapshot·baseline files in CI.** An update must be a change a human approves |
| **the person receiving the report** | every time you see "no anomaly," first ask **"was it checked."** A report that cannot answer this question holds no conclusion |

---

## 38.9 Limits and open questions

Written honestly. The first two items of this section are **defects confirmed by measurement** while writing this
chapter.

### 38.9.1 The embed path has no premise gate — measured

§38.5's withheld verdict is on **the separate-file path only.** The path that embeds the subtitle into the
container ([`report.py:358-366`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L358-L366)) has no `sampled` condition.

```python
# report.py:358-360
            if subs.embed_span and video_len > 0:
                lo, hi = subs.embed_span
                strayed = hi > video_len + 5.0 or lo < -0.5
```

The result of actually running a normal stream with `--limit 1 --sub-embed`.

```
  ✗ length consistency  measured 29.00s vs declared 6.00s (drift +23.00s / 383.33%)
  ✓ subtitle embed      1/1 track embedded (ko), codec subrip
  ✗ subtitle timeline   embedded subtitle 0.0~29.0s vs video 6.0s — out of video range, X-TIMESTAMP-MAP alignment failure suspected
```

Exit code `2`. **Two FAILs came out on a defect-free stream.** That the two false positives have different causes
is also this chapter's summary — "subtitle timeline" is because there is no premise gate, and "length consistency"
is because the **measurement target is contaminated** per §38.3.3.

The regression test has no such combination (`--limit` + `--sub-embed`). The principle stated in §38.3.5 was not
kept here.

### 38.9.2 The withholding ships out as `PASS` on the machine channel

This is §38.6's content. It is a change that adds a value to the schema, so compatibility with JSON consumers must
be decided together. This course writes only the direction — add `UNKNOWN` (or `N/A`) to `verdict`, and make
explicit the rule when folding into the whole verdict (`UNKNOWN` folds to neither `PASS` nor `FAIL` but is
aggregated separately). **This change was not implemented in this chapter, nor measured.**

### 38.9.3 `sampled` looks at `--limit` only

There may be another path where the premise collapses. If the last segment drops with a 404 the video shortens,
and then the baseline (declared length) does not shrink, so the subtitle may look relatively long. But **this
scenario was not confirmed.** As seen in Chapter 21, a middle loss keeps the total length because PTS is an
absolute time, so it likely has no effect, and only an end loss would be a problem — in which case "segment
receive" gives a FAIL first, so the practical effect is likely small. **This is inference, not measurement.**

### 38.9.4 If the baseline is 0 the check vanishes item and all

In a non-sample run, if `video_len == 0` then `elif good and video_len > 0` does not hold, so **the "subtitle
timeline" item itself does not appear in the report.** A withheld verdict at least says "did not check," but this
case has not even that word. How to read an absent item — it leads into Chapter 39's "an absent item is not a
pass."

### 38.9.5 The code does not check for contamination

The baseline's independence is **something a human chose**, not something the structure enforces. `report.build`
takes both `declared_duration` and `media` as arguments, and which check takes which as baseline is scattered
across each branch's code. If the person adding a new check does not read §38.3.1's comment the same mistake
recurs, and per §38.2.2 **it does not reveal itself with a normal input.** There is a way to separate by type
(placing the baseline value and the observed value in different types so swapping them is caught at the
compile·check stage), but this repository does not use it.

### 38.9.6 The basis for the `5.0`-second margin is outside this chapter's scope

§38.2's argument holds regardless of `ε`'s value, so this chapter did not treat it. The design of the threshold
itself is Chapter 22. Still, that on a contaminated baseline **the check does not come back to life however much
you shrink `ε`** is worth remembering — there is a kind of defect that cannot be fixed by threshold adjustment.

### 38.9.7 A baseline's independence does not mean reliability

`declared_duration` is independent of the artifact but **is still a value the server gave** (Chapter 5). If the
sending side writes `#EXTINF` wrong the baseline is wrong wholesale, and then this check quietly gives a wrong
verdict. What independence blocks is **contamination by the measurement target**, not **inaccuracy of the origin.**
This tool cross-checks the latter with "length consistency," but that check too is contaminated on the embed path
per §38.3.3.

---

## 38.10 Summary

1. **Baseline contamination** — if the target the check tries to measure influences the baseline's value, the
   baseline moves along with the observed value and the verdict expression cannot become true. Embed the subtitle
   into the container and the whole duration becomes `max(video end, subtitle end)`, so taking the measured value
   as baseline lets **a pushed-out subtitle drag the baseline itself.**
2. Confirmed by measurement — change only the baseline on the same measured values and the verdict flipped `FAIL`
   ↔ `PASS`. So this code's baseline is **the length the playlist declared**
   ([`report.py:337-343`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L337-L343)).
3. **Contamination arises only when there is a defect.** On a normal input the two baselines are the same value,
   so this kind of defect **never reveals itself with a normal case.**
4. General proposition: **if the measurement target influences the measurement standard, that verification is
   void.** Not that accuracy drops but that the true-positive rate is 0. Snapshot auto-update, static-analysis
   baseline files, "vs last deploy" performance budgets, and adaptive anomaly detection are all the same form.
5. **The withheld verdict** — in a `--limit` sample run only the video is cut and the subtitle comes whole, so the
   subtitle **necessarily** goes out of the video range. It is a condition where the baseline does not hold, so it
   does not check and outputs that fact ([`report.py:421-430`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L421-L430)). The premise gate comes **before** the verdict
   rule.
6. With no gate a normal stream gives FAIL and the CI job that uses `--limit` always fails. The bigger cost is that
   people come to not read that line.
7. **A tool that cannot distinguish unknown from pass cannot be trusted.** Report what could not be checked as a
   pass and the meaning of the symbol `PASS` collapses. It is why SARIF·TAP·OCSP·compliance audits all put this
   distinction into the type.
8. In security the collapse of this distinction is itself a vulnerability — a scan's "not checked" folds into "no
   vulnerability," and OCSP's `unknown` folds into `good`. **Deciding the fold direction is fail-open or
   fail-closed, and the best solution is often to move to a structure where the third value does not occur.**
9. This tool kept the distinction on the human-read channel and **lost it on the machine-read channel**
   (`verdict: "PASS"`). And the embed path has no premise gate at all, so putting `--limit 1 --sub-embed` on a
   normal stream gives two FAILs and exit code 2 — measured.

---

**Next chapter** — come this far and what each check asserts as a symbol is organized. What remains is the rule
that **folds those symbols into one decision.** How the per-item verdicts are gathered to make the whole report's
verdict, by what exit code it is sent out, and how the "withholding" and "absent item" this chapter left are
handled in that fold. Chapter 39 treats the last stage where a measured value becomes a decision, and closes this
course.
