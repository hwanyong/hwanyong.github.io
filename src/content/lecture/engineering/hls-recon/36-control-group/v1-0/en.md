---
title: "The Control Group"
description: "Fixing \"ffmpeg misses it\" as a test"
date: 2026-08-11
version: '1.0'
tags: ['streaming', 'verification']
thumbnail: /images/lecture/thumb/hls-recon-36-control-group.svg
---
## 36.0 What this chapter answers

1. The last item of this repository's regression test **runs not a single line of its own code.** So why is it in
   the regression test?
2. What is the difference between "our tool catches the loss" and "our tool catches the loss and the comparison
   target misses it"?
3. When only this item fails, why does it print a yellow dot instead of killing the script?
4. Why do performance-optimization·security-hardening claims need the same form?

The fourth is this chapter's destination. The first three are reading an 11-line shell script, and the fourth is
the problem of **what shape every claim of "we are better" must have to be verifiable.**

---

## 36.1 The problem — the reason for existing is not an absolute proposition

This repository's README states the tool's reason for existing in its first section.

```bash
# README.md:17-19
ffmpeg -i master.m3u8 -c copy out.mp4     # received. but —
```

> `README.md:21-23`
>
> This command, even if a segment drops with HTTP 404, **quietly skips it and ends with exit 0.** The total play
> length too is unchanged — because an MPEG-TS segment carries an absolute presentation time (PTS), so even if a
> middle piece vanishes the rear pieces' times stay as they were.

And it goes on to define the tool's scope.

> `README.md:32-34`
>
> hls-recon delegates the reassembly itself to ffmpeg and separately measures **only what ffmpeg does not tell
> you**: per-segment HTTP results and latency, the MPEG-TS continuity counter, and the reassembled copy's timeline
> loss.

Look at the sentence's logical form. **"only what ffmpeg does not tell you"** — this tool's value proposition is
not described by itself alone. **It includes another tool's behavior as a term.**

> **Term** — **value proposition**: a statement of what a product·tool provides the user that makes it worth
> using. Here it is "one line of ffmpeg is not enough."

This distinction holds up this whole chapter.

| Form of the proposition | Example | Measurement needed to verify |
|---|---|---|
| **absolute proposition** | "this tool catches a 6-second loss as FAIL" | this tool alone — run it on a defect-injection stream and done |
| **relative proposition** | "this tool catches a loss **ffmpeg misses**" | **both terms** — this tool and ffmpeg, on the same input |

The fault-injection tests through Chapter 35 all fix absolute propositions. Remove 12 packets and see whether `CC
discontinuity` appears (`tests/run.sh:483`). Delete a segment and see whether `segment receive` appears as a
failure (`tests/run.sh:482`). These are all statements about this repository's code.

**But the tool's reason for existing is not an absolute proposition.** "It catches the loss" alone does not yield
why you should use this instead of ffmpeg. The reason for existing is in the **difference**, and a difference does
not come from measuring only one side.

A test suite fixing only absolute propositions has one hole.

> If the upstream ffmpeg someday starts reporting the loss via the exit code, this repository's other 61 tests
> **all pass as-is.** Because the code changed nothing. But the tool's value proposition has collapsed that day.
> **And no one knows.**

The item blocking this hole is the last 11 lines of `tests/run.sh`.

---

## 36.2 The principle — the control group

### 36.2.1 Terms

> **Term** — **control group**: a comparison group in an experiment kept **without the treatment** and with the
> rest of the conditions the same as the treatment group. It becomes the baseline dividing whether the change
> observed in the treatment group is due to the treatment or to another factor.

> **Term** — **treatment group**: the group to which the treatment (intervention) to be verified is actually
> applied.

> **Term** — **confounding variable**: a factor that, though not the treatment, can make a difference in the two
> groups' results. Input data·run time·hardware·library version are all candidates. If there is even one
> uncontrolled confounding variable, the observed difference cannot be attributed to the treatment's effect.

> **Term** — **internal validity**: the property of whether the observed difference was **really made by the
> treatment.** It rises the more confounding variables are controlled.

### 36.2.2 The correspondence in this test

`tests/run.sh`'s `[3/4]` and `[4/4]` stages form exactly a treatment-group·control-group pair.

| Element of experimental design | In `tests/run.sh` |
|---|---|
| observation target (population) | one HLS stream with 4 defects injected |
| **treatment** | **laying a measurement layer** over the reassembly |
| treatment group | `[3/4]` — the result of running `hls-recon` ([`run.sh:474-481`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L474-L481)) |
| control group | `[4/4]` — the result of running `ffmpeg` alone ([`run.sh:512-522`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L512-L522)) |
| observation metric | one **process exit code** |
| controlled confounding variables | same URL · same local HTTP server · same run · same ffmpeg binary |

![A controlled comparison — the only thing changed is the one measurement layer](/images/lecture/hls-recon/36-control-vs-treatment.svg)

*Figure 36-1 — a controlled comparison. What the two runs share and what they diverge on*

What to read in the figure is the fact that **the top box is identically in both sides.** This tool does not do
the reassembly itself.

```python
# assemble.py:1-6
"""Reassembly layer — all actual container work is delegated to ffmpeg.

Segment merging·decryption·timestamp normalization are already implemented per spec
by ffmpeg's hls/mpegts demuxer, so they are not rebuilt here. This module's responsibility
is only "with what arguments to delegate" and "how to measure progress."
"""
```

So the treatment is **not "us instead of ffmpeg" but "one measurement layer over ffmpeg."** Why saying this
exactly matters — because the claim's scope changes. "We are better than ffmpeg" is a baseless sentence, and "lay
measurement over the same ffmpeg reassembly and the loss becomes visible" is a measurement-backed sentence.

### 36.2.3 Using the same input is the whole of the design

The URL `[4/4]` uses is `"$BASE/damaged/index.m3u8"`, and this is **literally the same** as the URL `[3/4]` used
([`run.sh:477`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L477)). No separate control fixture was made.

What breaks if made separately.

- **The guarantee the defects are the same vanishes.** Fixture generation goes through `ffmpeg` encoding
  ([`run.sh:37-44`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L37-L44)) and Python byte manipulation ([`run.sh:131-146`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L131-L146)), and made twice the GOP boundary·packet count can
  differ. Then the possibility opens that "ffmpeg missed it" was **because the defect was smaller** — a typical
  confounding variable.
- **The condition of the same server·same time also vanishes.** A 404 comes because the server cannot find the
  file, so with a different server state it is a different experiment from the start.

The two runs happen in the same `$WORK` directory, the same `python3 -m http.server` ([`run.sh:149`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L149)), within the
same process lifetime. **It is a design paying 0 cost for internal validity.** Try to attach a control later and
you must recreate this condition, and then it costs.

---

## 36.3 The code — the dissection of eleven lines

```bash
# tests/run.sh:512-522
# Fix the very fact that ffmpeg alone misses the same loss.
head_ "[4/4] control — ffmpeg alone misses the loss"
set +e
ffmpeg -v error -y -i "$BASE/damaged/index.m3u8" -c copy "$WORK/out/naive.mp4" >/dev/null 2>&1
naive=$?
set -e
if [[ $naive -eq 0 ]]; then
  ok "ffmpeg alone exit 0 — does not report the loss (the reason the tool is needed)"
else
  printf '  \033[33m·\033[0m ffmpeg failed with exit %s — may differ by environment\n' "$naive"
fi
```

Each line has one decision in it.

| Element | Decision | If omitted |
|---|---|---|
| `"$BASE/damaged/index.m3u8"` | the **same URL** as `[3/4]` | a confounding variable comes in and internal validity collapses (§36.2.3) |
| `-c copy` | **that command** the README cited, as-is | pick a deliberately weak command and it becomes a straw-man comparison (§36.6) |
| `-v error` | lower the log level to error | — to fix the observation metric to one exit code. there is an implication here (§36.6.2) |
| `>/dev/null 2>&1` | discard all output | the test log gets buried under ffmpeg's progress log |
| `set +e` … `set -e` | a failure-allowed stretch | the script's first line is `set -euo pipefail` ([`run.sh:8`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L8)), so without wrapping **the moment the control fails the script dies instantly** |
| `naive=$?` | store only the exit code | the sole basis for the later branch |
| `if [[ $naive -eq 0 ]]` | **the expected value is 0** | the sign is opposite an ordinary test |
| `ok` / `printf` asymmetry | success to the counter, failure to the log only | §36.4 |

### 36.3.1 That the expected value is 0

An ordinary test confirms "catches it if it fails." This item is the opposite — **it expects success, and that
success is itself the evidence of the defect.**

```
[3/4]  hls-recon  →  exit 2   ← expect: fail. must fail to pass
[4/4]  ffmpeg     →  exit 0   ← expect: succeed. must succeed to pass
```

For the same input, one side is expected to fail and the other to succeed. This asymmetry is **the result of
decomposing the one sentence "misses it" into two observations.**

![The two observations must combine for one sentence to hold](/images/lecture/hls-recon/36-two-observations.svg)

*Figure 36-2 — the two observations must combine for the conclusion to come*

### 36.3.2 Why the tool gives exit 2

The treatment-group side's exit code comes from one verdict.

```python
# cli.py:651-652
def _exit_code(verdict: str) -> int:
    return {report.PASS: 0, report.WARN: 0, report.FAIL: 2}[verdict]
```

And one of the checks making a FAIL in this defect combination is timeline continuity.

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

> This docstring is the control item's theoretical basis. **The reason "ffmpeg misses it" is written here, and
> `[4/4]` confirms every run whether that narrative is still true today.** It is a rare case where the claim
> written in a comment and the test point at the same proposition. The principle itself (why PTS is an absolute
> time) is covered in Chapter 21.

---

## 36.4 The yellow dot — a failure that does not fail

The most-misunderstood part of this item is the `else` branch.

```bash
else
  printf '  \033[33m·\033[0m ffmpeg failed with exit %s — may differ by environment\n' "$naive"
fi
```

It does not call `bad`. It directly prints a **yellow middle dot** with `printf` and ends. To see the difference
you must look at the helper at the script's top.

```bash
# tests/run.sh:16-19
pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
```

`bad` raises `fail`, and `fail` becomes the exit code on the last line.

```bash
# tests/run.sh:524-525
head_ "result: pass $pass / fail $fail"
[[ $fail -eq 0 ]] || exit 1
```

That is, call `bad` in the `else` branch and **the day the upstream ffmpeg improves, this repository's CI goes
red.** Even though there is no problem in this repository's code.

Weigh three implementations.

| Implementation | If the upstream ffmpeg comes to report the loss | Problem |
|---|---|---|
| `bad "…"` | `fail`+1 → `exit 1` → CI fails | **the signal is wrong.** if a red light appears while your own code is fine, the next person, instead of fixing the cause, **deletes this item.** then the monitoring itself vanishes |
| do not check at all | nothing happens | the value proposition's premise having collapsed, **no one knows** (§36.1's hole) |
| **yellow dot + no counter increment** | one line remains in the log and CI passes | **observe but withhold the verdict** |

The third is this repository's choice. And this is a precursor to a principle this course covers in Chapter 38 —
**unknown is neither pass nor fail.**

Here the phrase "may differ by environment" matters. The causes of the control failing are at least three, and of
them **only one is a change of the value proposition.**

| The reason the control did not give exit 0 | What it means |
|---|---|
| the upstream ffmpeg comes to report the loss via the exit code | **the value proposition changed** — the course and README must be fixed |
| a different ffmpeg build·version takes a different path | an environment difference. not a code problem |
| a run-environment problem like the local HTTP server·disk·port | flaky. not a code problem |

**The three cannot be distinguished by the exit code alone.** Kill CI with an indistinguishable signal and that
signal is soon ignored. So the script **hands it to a human** — leaves a yellow dot in the log, and the reader
makes the verdict.

> **Honestly** — this choice has a price. **If no one reads the CI log, this signal is lost.** The yellow dot is
> a signal that works only if a human reads it, not an automated gate. This repository accepted that risk, and the
> reason is that the above table's left column is three.

---

## 36.5 What this item does not test

To not overrate the control item, draw a boundary.

**First, it does not inspect the output.** `$WORK/out/naive.mp4` is made but no one opens it afterward. It
confirms neither the length, nor the frame count, nor the loss stretch. **The observation metric is only one exit
code.**

**Second, so alone it draws no conclusion.** From the fact "ffmpeg gave exit 0" alone you cannot know whether that
input had a loss. Run it on a normal stream and exit 0 comes just the same. The conclusion holds only after
`[3/4]` **independently confirmed a loss really exists in the same input** (Figure 36-2).

**Third, that dependency is not expressed in the code.** The script joins the two stages **by order only.** Even
if `[3/4]` fails, `[4/4]` runs as-is and calmly prints `ok`. The overall exit code becomes 1 because of `fail>0`
so there is no practical problem, but **a baseless green check remains in the log.** To improve it you must gate
`[4/4]` on `[3/4]`'s result.

**Fourth, the defects are not separated.** The `damaged` stream has 4 defects at once ([`run.sh:131-147`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L131-L147)) — 12 TS
packets removed·segment duplicate·404·200 error page. So what this item fixes is **"ffmpeg gives exit 0 for this
combination,"** and "exit 0 with only a single 404" is not fixed. To have a per-defect control you must split the
stream per defect. This repository did not do so.

---

## 36.6 Is the comparison target fair

The spot most easily collapsed in control-group design.

> **Term** — **straw-man comparison**: the error of setting the comparison target in a form weaker than reality,
> beating it, then saying you beat the strong form too. Compose the control deliberately unfavorably and, with the
> measurement the same, the conclusion becomes meaningless.

Is `-c copy` a straw man. No — it is the command the README's first section cited (`README.md:17-19`) and the
command people actually type. **The comparison target must be "the form actually used," not "the strongest
form"** is this repository's choice.

But that choice narrows the claim. Let us confirm.

### 36.6.1 Reproduction — what and how much vanishes

This section's table is a **value measured separately for this chapter**, not what `tests/run.sh` measures. The
environment is ffmpeg 8.1.1 (macOS, Apple clang 21), local `python3 -m http.server`, `127.0.0.1`. The fixture was
made by the same procedure as the repository ([`run.sh:37-44`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/tests/run.sh#L37-L44)) but with only the resolution lowered to 320×180 to
reduce encoding (the repository is 640×360). 30 seconds · five 6-second segments.

The case where only one segment is made 404.

| Observation | Normal copy | `seg001` 404 |
|---|---|---|
| ffmpeg exit code | 0 | **0** |
| `ffprobe format=duration` | 30.023401 | **30.023401** |
| video packet count (`v:0`) | 900 | **720** |

**The total length is the same to the sixth decimal place yet 180 frames are missing.** 180 frames ÷ 30fps =
6.0 seconds — the amount of one whole segment vanished. The property `README.md:21-23` and [`probe.py:191-198`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L191-L198)
narrated is reproduced as-is.

In the same combination as the repository fixture where all 4 defects are in, the length went off too (30.02s →
24.04s). **The length metric shakes by defect combination, but the exit code was 0 on both sides.** That the
control chose the exit code as the metric is right on this point.

### 36.6.2 The exact meaning of "quietly"

You must confirm whether specifying `-v error` changes the conclusion. The result of running the same input with
only the log level changed.

| `-v` level | stderr | Exit code |
|---|---|---|
| `error` | **no output** | 0 |
| `warning` | 7 lines including `Segment 1 of playlist 0 failed too many times, skipping` | 0 |
| `info` (default) | the 7 lines above + tens of progress-log lines | 0 |

Two things to read.

1. **ffmpeg knows, and it even says so.** It detects that one whole segment vanished and writes `skipping`. It is
   not that there is no information.
2. **But that message's severity is `warning`.** In ffmpeg's own classification, "one whole segment lost" is not
   an error. So under `-v error` not a letter comes out, and **at any level the exit code is 0.**

So the README's "quietly" is **accurate from the automation view and loose from the human-viewing view.** Written
exactly it is this.

> ffmpeg does **not report the loss via the exit code.** It remains in the log as a warning, but the pipeline does
> not read the log; it reads the exit code.

This distinction makes the tool's value proposition more accurate. The treatment is not "the addition of detection
ability" but closer to **"promoting an already-existing signal to a verdict."**

### 36.6.3 If you give ffmpeg favorable conditions

What happens if you attach `-xerror` (stop at the first error). The result measured on the same input, same
environment.

| Command | Exit code | Output length | Video packets |
|---|---|---|---|
| `-c copy` (same as the control) | 0 | 30.023401 | 720 |
| `-c copy -xerror` | **183** | **6.037188** | **178** |
| `-c copy -xerror` (normal stream) | 0 | — | — |

**You can make the exit code non-zero.** But see the price.

- The output is **6.04 seconds.** It threw away 24 of the 30 seconds. `-xerror` is not verification but a **stop.**
- The spot it caught is not the loss itself but a `corrupt input packet` at a junction. **How many losses·where·
  how many seconds in total** appears nowhere.
- So you cannot say "it reported the loss." What was reported is only "something is wrong."

Organized, the exact form of the claim is this.

| Statement | True |
|---|---|
| "ffmpeg cannot detect this loss" | **false** — it writes it as a warning, and with `-xerror` can even change the exit code |
| "ffmpeg on the default call does not report the loss via the exit code" | true (measured) |
| "the option that changes the exit code does not tell the loss's position·scale and throws away the output" | true (measured) |

**Set up a control and your own claim narrows.** The narrowed sentence is the true sentence. This is the control's
second use — not to make you win but **to keep you from exaggerating.**

> **Honestly** — the three rows above are each a one-off run's observation. That `-xerror` gives no false positive
> on a normal stream is also a one-off observation, not a false-positive-rate measurement. And this measurement is
> **not in `tests/run.sh`** — the repository's control measures only the one option-less line.

---

## 36.7 Generalization — a relative proposition needs a control group

This chapter's form repeats independently of streaming. The common form is one.

> **A claim of "we are better" is verifiable only if you measure the comparison target together.**
> Measure only one side and it is not a measurement but an observation record.

| Claim | Treatment-group measurement | **The control easily omitted** | What happens if used without a control |
|---|---|---|---|
| "this tool catches a loss ffmpeg misses" | FAIL on the defect-injection stream | ffmpeg alone on the same stream·same time | the reason for existing remains only in the doc, unverified |
| "this optimization made it 2× faster" | benchmark after the optimization | before the optimization on the **same hardware·same input·same load** | cache warming·a different machine·a different input size are all confounding variables |
| "this patch reduced the attack surface" | the block list after the patch | the behavior on the same input before the patch | Chapter 15 — an unmeasured improvement |
| "the new classifier is 5pp more accurate" | the new model's score | the existing model's score on the **same test set** | change the test set and the two numbers are not comparable |
| "the cache reduced DB load" | QPS with the cache on | the cache off on the same traffic pattern | the traffic itself dropping mistaken for the cache's effect |
| "this static analyzer found N bugs" | the alerts the new tool gave | **what the existing pipeline already caught** | even with 0 net increase, N is still reported |

The last row is exactly the same structure as Chapter 15. Chapter 15 §15.5.2, after narrowing `-allowed_extensions`
from `ALL` to an enumeration, measured **both before (`ALL`) and after (enumeration) for the same 9 extensions.**
The result was identical on every item — the attack-surface reduction was **not measured.**

Had you measured only the treatment group, the table would have been "7 of 9 rejected," and the conclusion would
have been "reduced the attack surface." **Not a false sentence but a sentence with no true basis.** What blocked
that sentence was the control.

Here comes this chapter's proposition.

> **The control's main use is not to prove an improvement but to keep what is not an improvement from being called
> one.**

### 36.7.1 What it means to put a control in the regression test

Measuring once and writing it in a document, and putting it in the regression test, are different.

| | Measure once and document | Fix by regression test |
|---|---|---|
| Measurement time | once, then | **every run** |
| If the comparison target improves | the doc quietly ages | **a signal appears on the next run** |
| If the environment changes | unknown | revealed by a yellow dot |
| Maintenance cost | 0 | must keep maintaining the fixture |

What the last 11 lines of `tests/run.sh` do is **make the value proposition a living assumption.** In software, "a
comparison with a competing tool" is usually put in a presentation deck once and ages. This repository put it into
the code in an executable form.

---

## 36.8 Security — a defense claim needs the same form

### 36.8.1 The question asking the net increase

A security tool's·security patch's value proposition is also a relative proposition. The sentence "this WAF rule
blocked N attacks" has no control.

| To ask | Answerable without a control |
|---|---|
| of those N, how many would have been rejected by the application **even without the rule** | no |
| of those N, how many were **already blocked at another layer (auth·input validation·ORM)** | no |
| by introducing the rule, **how many normal requests were blocked together** | no — look at the treatment group only and false positives are invisible |

All three questions demand the control "the same traffic flowed with no rule." The N that came out without it is
**a block count, not an improvement amount.**

This is the same structure as Chapter 15's **incidental defense.** The reason the effect of narrowing layer ②
(extension allowlist) was measured as 0 was that layer ③ was already blocking in front. The net increase comes out
**only if you measure together what the other layers are doing.**

### 36.8.2 Publishing the limit is beneficial to the defender

This repository's control item is written in a public repository like this — **"ffmpeg alone misses this loss."**
This is the information **"a collection·archiving pipeline that looks only at the ffmpeg exit code is blind to this
defect."** Should it be hidden.

No. The reason is the same logic as the **Kerckhoffs's principle** covered in Chapter 25.

- This fact is already observable by anyone from the upstream ffmpeg's behavior. Hide it and it is not hidden.
- The side that does not know this fact is **not the attacker but the defender.** Someone running an archive not
  knowing what their pipeline cannot see is the one in danger.
- Documenting the checker's limit is the same attitude as Chapter 18 (the 4-bit counter's miss rate). You must
  know that **"PASS = intact" is not it but "PASS = not caught by this check"** to use that PASS.

### 36.8.3 The defender's view

| Role | What to do |
|---|---|
| **tool developer** | if the value proposition is a relative proposition, **put the comparison target in the regression test.** if the comparison target improves, fix the doc and update the value proposition. a comparison put in a deck once ages |
| **security-tool adoption owner** | require not "this tool catches X" but **"the current pipeline misses X and this tool catches it."** the former the tool vendor measures, the latter the adopter must measure |
| **auditor** | require a **control measurement** for a change written as a "security improvement." a claim of improvement with no measurement is a verification target, not a basis (same as Chapter 15 §15.9) |
| **CI operator** | **an item monitoring an external premise rather than your own code must not fail the build.** instead leave it visibly in a spot a human reads. a wrong red light makes them delete the item itself |
| **document author** | distinguish what was measured and what could not be measured, sentence by sentence. "cannot detect" and "does not report via the exit code on the default call" are different sentences (§36.6.3) |

---

## 36.9 Limits and open questions

Written honestly.

- **There is only one control.** It measures only `ffmpeg`. Other reassembly tools like `yt-dlp`·`streamlink`·
  `N_m3u8DL-RE` were not measured. So the fixed proposition is up to "ffmpeg misses it," and "there is no other
  tool that reports this loss" was **neither claimed nor verified.**
- **The defects are not separated.** Since 4 defects are mixed in one stream, which defect made exit 0 is not
  decomposed (§36.5). With a per-defect control it can be matched 1:1 with the coverage mapping table (Chapter 35).
- **The logical dependency of `[3/4]` and `[4/4]` is not in the code.** They are joined by order only, so even if
  the prior stage fails the control prints a baseless `ok`.
- **The ffmpeg option space was not exhaustively investigated.** What §36.6.3 measured is one option, `-xerror`.
  Whether there is a combination of the `-err_detect`·`-fflags` family that reports the loss more accurately could
  not be confirmed. If there is, §36.6's premise "the comparison target is the form actually used" must be
  re-reviewed.
- **What `-xerror` caught was not confirmed from the source.** That a `corrupt input packet` appeared at a
  junction was **inferred** to be due to a continuity-counter discontinuity, not confirmed by reading
  `libavformat`. If that inference is right, this workaround would not work under Chapter 18's miss condition
  (packet loss of exactly a multiple of 16) either — this too is **inference and not measured.**
- **The environment is not pinned.** This repository does not pin the ffmpeg version and requires only "be on the
  PATH." It is the same condition as Chapter 15 §15.7, and so the `else` branch's phrase is "may differ by
  environment." The control's reproducibility is principled-ly limited at this point.
- **The yellow dot works only if a human reads it.** As written in §36.4 it is not an automated gate. In a team
  where no one looks at the CI log, this design becomes the same as "does not check at all."

---

## 36.10 Summary

1. The tool's reason for existing is a **relative proposition** — "measure only what ffmpeg does not tell you"
   (`README.md:32-34`). A relative proposition is verified only by **measuring the two terms under the same
   conditions.**
2. `tests/run.sh:512-522` is **a regression-test item that runs not a single line of its own code.** Because the
   monitoring target is not this repository's code but **the value proposition's premise.**
3. The treatment is not "us instead of ffmpeg" but **"one measurement layer over the same ffmpeg reassembly"**
   ([`assemble.py:1-6`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L1-L6)). That the control and treatment groups share the same URL·same server·same run is the whole
   internal validity of this comparison.
4. **The expected value is 0.** The control must succeed to pass, and that success is the evidence of the defect.
   `[3/4]`'s exit 2 and `[4/4]`'s exit 0 must be **together** for one sentence to hold.
5. The reason the `else` branch does not call `bad` is that **the control's failure is not a defect of its own
   code.** Make it a red light and the next person deletes the item. The yellow dot is a third state that
   **observes but withholds the verdict** (Chapter 38).
6. Measure and the claim narrows — ffmpeg writes the loss as a **warning and does not report it via the exit
   code.** With `-xerror` you can change the exit code but that is not verification but a stop and throws away 80%
   of the output. **The narrowed sentence is the true sentence.**
7. Generalization: **a claim of "we are better" is verifiable only by measuring the comparison target together.**
   The control's main use is not to prove an improvement but **to keep what is not an improvement from being called
   one** (the same structure as Chapter 15's incidental defense).

---

**Next chapter** — this chapter's control fixed "the comparison target misses it." But the same kind of asymmetry
remains for this repository's own checker too. A test fixing only catching the defect passes an **"implementation
that always gives FAIL"** as-is. Chapter 37, with the inventory verdict maker as an example, covers what quietly
breaks if you do not fix the false positive and false negative **together** — too strict and you re-receive 27
fine episodes every time, too lenient and a broken file passes as a finished copy so that episode is missing
forever.
