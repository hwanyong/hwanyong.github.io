---
title: "The Test-Oracle Problem"
description: "Verifying the verifier"
date: 2026-08-06
version: '1.0'
tags: ['streaming', 'verification']
thumbnail: /images/lecture/thumb/hls-recon-34-oracle-problem.svg
---
## 34.0 What this chapter answers

1. For some input, **on what basis** do you judge what the correct output is?
2. Why is that problem especially sharp in a verification tool?
3. What is the **difference between a tool that gives only PASS and no verification?**
4. How do you fix that difference with a regression test?

Part 8 asks what the checks made in the previous seven parts **actually catch.** This chapter is the one that
makes that very question hold.

---

## 34.1 The problem — a two-line script passes every normal case

`tests/run.sh`'s normal-case block consists of six verification runs (`tests/run.sh:173-178`). Plaintext TS,
AES-128 encryption, fMP4, master-playlist variant selection, remux delegation, structure probe — the
representative set of inputs this tool handles.

Now put the following script in that spot instead of `hls-recon`.

```bash
#!/usr/bin/env bash
exit 0                    # always PASS
```

The measured result. I moved `tests/run.sh`'s `expect_pass` definition (`tests/run.sh:162-170`) and the six calls
as-is and put them onto this stub.

```
[normal block — 6 expect_pass]
  PASS plaintextTS-segments
  PASS AES128-decrypt
  PASS fMP4-CMAF
  PASS master-variant-select
  PASS remux-delegate
  PASS structure-probe
```

**6/6 pass.** These two lines do not parse M3U8, send no HTTP request, and read not a single byte. And yet in a
test asking only "does a normal stream come out normal" it is indistinguishable from the 4,173-line real
implementation.

This repository wrote that fact at the script's head.

```bash
# tests/run.sh:1-8
#!/usr/bin/env bash
# hls-recon regression test.
#
# Makes 4 kinds of HLS stream locally, confirms the normal cases come out PASS,
# and injects 3 kinds of defect to confirm they are actually caught as FAIL.
# A verification tool that gives only PASS is the same as verifying nothing,
# so "does it catch the defect" is this script's core.
set -euo pipefail
```

The sixth line is this chapter's proposition. **"A verification tool that gives only PASS is the same as verifying
nothing."** The same sentence is in `README.md:355-356` too.

> A verification tool that gives only PASS is the same as verifying nothing. So the regression test fixes, along
> with "does it pass the normal," **"does it actually catch the defect."**

To be exact it is worse than "the same." No verification makes no claim. A tool that always gives PASS **leaves a
false claim in the CI log and the report JSON.** The next person, on the basis of that record, judges "this
pipeline is being verified."

| | Output | Effect on the following judgment |
|---|---|---|
| no tool | none | "not verified" — accurate |
| a tool that always gives PASS | `PASS`, exit 0, report JSON | "verified" — **false, and that falsehood is cited as a basis** |
| a tool that knows its true-positive rate | `PASS`, and a list of what it cannot catch | "defects this check cannot catch remain" — accurate |

---

## 34.2 The principle — the test-oracle problem

### 34.2.1 Definition

> **Term** — **test oracle**: an **independent basis** judging whether a program's output for a given input is
> correct. A specification document, a reference implementation, human judgment, a self-evident invariant serve as
> an oracle.

> **Term** — **test-oracle problem**: the problem that obtaining such an independent basis for a real target is
> generally hard or impossible. It arises from the asymmetry that making a test input is easy but **knowing that
> input's answer is hard.**

Rewrite the question this repository must answer and it is this.

> Is the MP4 made by receiving this HLS stream **intact?**

The answer to this question is written nowhere. The side with the original is the deliverer, and we have only the
text and byte string the server gave. As confirmed in Chapter 4, even the baseline N comes from the
server-given playlist.

### 34.2.2 Where you get an oracle

The sources of an oracle are classified into a few branches. Weighing whether each is usable in this repository
reveals why defect injection remains.

| Kind of oracle | Definition | In this repository |
|---|---|---|
| **specified oracle** | the spec document directly stipulates the answer | what RFC 8216 stipulates is the **form**, not "is this stream intact." usable only partially for parser behavior |
| **pseudo-oracle** | compare against the output of **another implementation** solving the same problem. this style of test is differential testing | the only candidate is ffmpeg, and **the reason this tool exists is that ffmpeg misses loss** (`README.md:359-360`). unusable as an oracle |
| **metamorphic oracle** | judge by a **relation between input and output** that holds without knowing the answer. that relation is a metamorphic relation | usable. "delete one segment from a normal stream and the verdict should worsen" is such a relation |
| **implicit oracle** | something that must never happen on any input — a crash, an infinite wait, a stack-trace exposure | already used. `grep -q 'Traceback' "$DIAG" && bad "stack trace exposed"` (`tests/run.sh:202`) is exactly this |
| **constructed oracle** | **make an input whose answer you know.** defect injection belongs here | the center of this script. Chapter 35's subject |

> **Term** — **fault injection**: the technique of deliberately planting a defect into a target known to be normal
> and observing how the system reacts to that defect.

`tests/run.sh:130` is the first line of that construction.

```bash
# tests/run.sh:129-130
# defect-injected copy
cp -R plain damaged
```

`damaged` starts from a copy of `plain`. The fact that the two inputs' difference is **only the injected defect**
makes the oracle. `plain` must be PASS and `damaged` must be FAIL — this is not an absolute answer but a
**relation between two inputs**, and so it is both a metamorphic oracle and a constructed oracle.

### 34.2.3 In a verification tool the oracle is two-ply

In an ordinary program the oracle is one-ply. Test a sort function and there is an independent verdict basis "is
the output ascending." That basis is outside the sort function.

A verification tool is different.

| Layer | Question | Who answers |
|---|---|---|
| 1st | is this stream intact | **the tool itself** — the tool is the oracle |
| 2nd | is the tool's answer right | ??? |

**Since it was made to be used as an oracle, when testing that tool there is no higher oracle left to
reference.** This is why the oracle problem is especially sharp in a verification tool. A static analyzer·
vulnerability scanner·linter·monitoring alarm are all in the same spot.

There is one way out. **Make and feed in an input whose answer you know from below.** With no higher oracle, you
construct an oracle to fill it.

---

## 34.3 The principle — a verdict maker is a classifier

A verification tool's output is a discrete verdict PASS/WARN/FAIL. That is, this tool is a **classifier**, and a
classifier's performance is measured not on one axis but two.

> **Term** — **confusion matrix**: a table showing the combination of the actual state (defect present/absent) and
> the verdict (FAIL/PASS) in four cells. The counts of true positive·false positive·false negative·true negative
> go in.

| | Tool verdict = FAIL | Tool verdict = PASS |
|---|---|---|
| **actually has a defect** | true positive | **false negative** |
| **actually has no defect** | **false positive** | true negative |

A test fixing only normal cases fixes **only the bottom row** of this table. Since the top row is empty, an
implementation with 100% false negatives — i.e. §34.1's `exit 0` — passes. Conversely fix only defect cases and
only the top row is filled and the one line `exit 2` passes.

The result of passing three candidates through the two gates.

![One gate alone and a fake implementation passes](/images/lecture/hls-recon/34-two-gates.svg)

*Figure 34-1 — one gate alone and a fake implementation passes*

| Candidate implementation | Gate ① normal block | Gate ② defect block | Survives |
|---|---|---|---|
| `hls-recon` (real) | 6/6 | 6/6 | survives |
| `exit 0` (always PASS) | **6/6** | 0/6 | excluded |
| `exit 2` (always FAIL) | 0/6 | 1/6 | excluded |
| `exit 2` + output only one 404 line | 0/6 | 2/6 | excluded |

The fourth row is §34.5's foretelling. An implementation giving exit code 2 and printing only one line `segment
receive … failed` passes two of the defect block's six assertions. **Fix only the verdict and such an
implementation survives.**

> **Term** — **mutation testing**: the technique of planting an artificial defect (a mutant) into a program and
> measuring whether the test suite catches that mutant. An uncaught mutant points at the suite's blind spot.

The above experiment is a coarse form of mutation testing that replaced the whole program with one extreme
mutant. It is not refined, but it answers the question **"what does this suite exclude."**

---

## 34.4 The code — the normal axis: why `expect_pass` looks at two signals together

```bash
# tests/run.sh:160-170
# ---------------------------------------------------------------- normal cases
# expect: exit code 0 + no FAIL item in the report
expect_pass() {
  local name="$1"; shift
  local log="$WORK/out/$name.log"
  if "$RECON" "$@" >"$log" 2>&1 && ! grep -q '✗' "$log"; then
    ok "$name"
  else
    bad "$name — $(grep -m1 '✗' "$log" || echo 'exit code abnormal')"
  fi
}
```

The pass condition is a **conjunction.** Exit code 0 **and** no `✗` in the log. It seems the exit code alone would
do, so why two.

### 34.4.1 The exit-code channel's blind spot

```python
# cli.py:651-652
def _exit_code(verdict: str) -> int:
    return {report.PASS: 0, report.WARN: 0, report.FAIL: 2}[verdict]
```

**WARN is folded into 0.** Exit code 0 means not "no defect" but "not FAIL." This folding is intended — halt CI on
WARN and the build breaks even on one retry. But at the price the exit code cannot distinguish PASS from WARN.

### 34.4.2 What the log channel sees more

`✗` comes from two places.

| Source | When it is printed | Reflected in the aggregate verdict |
|---|---|---|
| [`report.py:71`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L71) — `mark = {PASS: "✓", WARN: "!", FAIL: "✗"}[self.verdict]` | on report rendering, per FAIL check line | reflected (exit code 2) |
| `cli.py:335·358-360·387·454·463` — the `✗` output of the progress log | each time a **individual** segment·subtitle item fails | **not necessarily reflected** |

The second row is the core. There exists a path where an individual item's failure does not pull the aggregate
verdict up to FAIL. The clearest example is neighbor-episode gathering.

```python
# report.py:464-469 (excerpt)
rep.add(
    "subtitle batch collect",
    PASS if got else WARN,
    ...
)
```

Try three and even if only one is received the verdict is **PASS.** Meanwhile [`cli.py:358-360`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L358-L360) prints a `✗` for
each of the two failures. Exit code 0, verdict PASS, and yet two `✗` in the log — without `grep -q '✗'` the
normal-case test passes this state.

![One verdict, two observation channels — their blind spots do not overlap](/images/lecture/hls-recon/34-two-channels.svg)

*Figure 34-2 — one verdict, two observation channels — their blind spots do not overlap*

### 34.4.3 What breaks if you do not do this

| Channel configuration | What it passes |
|---|---|
| exit code only | a run where individual items failed but the aggregate ends WARN·PASS. the subtitle batch collect above is an actual case |
| log `✗` only | a run where the tool does not render the report at all and dies — no output so no `✗` either |
| both | excludes both of the above |

**The two channels' blind spots do not overlap.** This is why a conjunction is used, and it is also the general
principle of adding observation channels — not the redundancy of looking at the same thing twice, but **overlaying
two observations that miss different things** makes the worth.

---

## 34.5 The code — the defect axis: fix not the verdict but the response

```bash
# tests/run.sh:472-487
# ---------------------------------------------------------------- defect detection
# expect: exit code 2 + the relevant check item actually points at the defect
head_ "[3/4] defect-injected stream — must detect"
DLOG="$WORK/out/damaged.log"
set +e
"$RECON" "$BASE/damaged/index.m3u8" -o "$WORK/out/damaged.mp4" --report "$WORK/out/damaged.json" >"$DLOG" 2>&1
code=$?
set -e

[[ $code -eq 2 ]] && ok "exit code 2 (FAIL)" || bad "exit code is not 2: $code"
grep -q 'segment receive.*failed'   "$DLOG" && ok "segment 404 detected"   || bad "segment 404 not detected"
grep -q 'CC discontinuit'           "$DLOG" && ok "packet loss detected"    || bad "packet loss not detected"
grep -q 'duplicate hash'            "$DLOG" && ok "duplicate segment detected" || bad "duplicate segment not detected"
grep -q 'timeline continuity.*gap'  "$DLOG" && ok "timeline loss detected"  || bad "timeline loss not detected"
grep -q 'payload validity.*not media' "$DLOG" \
  && ok "200-error-page detected" || bad "200-error-page not detected"
```

The first line fixes the verdict, and the remaining five fix **which check pointed at which defect.** The latter
five look like removable decoration. They are not.

### 34.5.1 Four defects are together in one stream

`damaged` has four injected defects (`tests/run.sh:131-146`) — 12 TS packets removed, a segment delivered
duplicately, a segment 404, an HTML error page on a 200 response. They are checked in **one run.** So exit code 2
comes even if **any one** of the four is caught. Fix only the exit code and an "implementation that catches only
the 404 and misses all the rest" passes — that is §34.3's table's fourth row, and it passed the defect block 2/6
by measurement.

### 34.5.2 And two defects leave no trace in the exit code

The measured report (`damaged.log`'s check lines).

```
  ✓ playlist            5 segments, declared length 30.00s, TARGETDURATION 6s, encryption none
  ✗ segment receive     1/5 failed (HTTP [404]) — a loss stretch arises in the reassembled copy
  ✓ response latency    TTFB p50 1ms / p95 2ms, throughput median 4626.2 Mbps
  ✗ payload validity    1 is a 200 response but not media (video/mp2t) — seg#3 head 3c21444f43545950
  ! segment uniqueness  duplicate hash present — the same segment is repeatedly delivered
  ! TS integrity        11 CC discontinuities (packet loss)
  ! length consistency  measured 24.04s vs declared 30.00s (drift -5.96s / 19.88%)
  ✓ stream composition  h264 Constrained Baseline 640x360 @22.5fps 1476kbps + aac 1ch 44100Hz 95kbps
  ✗ timeline continuity 1 gap / total 6.03s (max 6.03s) @ 5.99~12.02s
  ✗ full decode         6 errors — [h264 @ 0x984c29880] mb_type 644 in P slice too large at 31 20
```

`!` is WARN. And WARN is exit code 0 ([`cli.py:652`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L652)).

| Injected defect | The check pointing at it | That check's verdict | Basis | Contributes to the exit code |
|---|---|---|---|---|
| segment 404 | segment receive | FAIL | [`report.py:167-173`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L167-L173) | yes |
| segment 404 (second-order effect) | timeline continuity | FAIL | [`report.py:311-317`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L311-L317) | yes |
| 200 + HTML error page | payload validity | FAIL | [`report.py:199-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L199-L206) | yes |
| 12 TS packets removed | TS integrity | **WARN** | [`report.py:243-249`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L243-L249) | **no** |
| segment delivered duplicately | segment uniqueness | **WARN** | [`report.py:214-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L214-L218) | **no** |

The lower two leave no trace in the exit code. **Remove `grep -q 'CC discontinuit'` and `grep -q 'duplicate
hash'`, and even if the CC-analysis module and the SHA-256 duplicate check vanish wholesale from the code, this
suite stays green.**

That they are WARN is a design decision. A CC discontinuity appears even at a delivery-side encoder's normal seam
so raising it straight to FAIL pours out false positives (Chapter 18). A duplicate segment also appears
legitimately in ad insertion, etc. Lowering the verdict and **fixing the detection itself are separate**, and
these five lines keep that separateness.

### 34.5.3 What happens if you hang the verdict on one threshold

There is one more line to note in the report above.

```
  ! length consistency  measured 24.04s vs declared 30.00s (drift -5.96s / 19.88%)
```

A whole 6-second segment is missing yet this check is WARN. Because the threshold formula is this.

```python
# report.py:266-272
# off by a segment or more → treat as a stretch loss.
if target_duration and abs(drift) >= target_duration:
    verdict = FAIL
elif drift_pct > 0.5:
    verdict = WARN
else:
    verdict = PASS
```

`abs(-5.96) = 5.96` and `target_duration = 6`. **By a 0.04-second difference it failed to cross the FAIL
threshold.** What caught the loss as FAIL was the timeline-continuity check (the `5.99~12.02s` stretch).

Had this tool depended on length consistency alone, a stream with a whole segment missing would go out as WARN and
the exit code would be 0. Chapter 0's starting point — "the total length matches but the middle is empty" —
appears again in the form of a 0.04-second threshold. **It is why there are several checks, and why each check's
detection must be fixed individually.**

---

## 34.6 The code — why the control is not a hard assertion

```bash
# tests/run.sh:512-522 (excerpt)
# Fix the very fact that ffmpeg alone misses the same loss.
head_ "[4/4] control — ffmpeg alone misses the loss"
...
if [[ $naive -eq 0 ]]; then
  ok "ffmpeg alone exit 0 — does not report the loss (the reason the tool is needed)"
else
  printf '  \033[33m·\033[0m ffmpeg failed with exit %s — may differ by environment\n' "$naive"
fi
```

The `else` branch does not call `bad`. Since it does not raise the failure count, the suite stays green. It is
different from every other assertion.

The reason is that **this assertion's oracle is the behavior of an external tool I do not control.** The
proposition "ffmpeg misses this loss" depends on ffmpeg's version·build options, and if the upstream fixes this
behavior the proposition becomes false. For my suite to go red then is wrong — **the comparison target being
improved must not be reported by my regression.**

So this line remains not an assertion but a **record of observation.** Since a `·` mark and the exit code are
printed together, the next person seeing the log can know the control's premise changed. The control design itself
is Chapter 36's subject.

---

## 34.7 Generalization — without knowing the true-positive rate, that PASS is not information

> **Term** — **true-positive rate (recall · sensitivity)**: the ratio of inputs actually having a defect that the
> tool judged as a defect.

Think of a tool with true-positive rate 0. That tool gives PASS whether there is a defect or not. That is,

```
P(output = PASS | defect present) = P(output = PASS | defect absent) = 1
```

Since the two conditional distributions are the same, observing PASS does not update the belief about
defect-or-not.

> **Term** — **mutual information**: the amount by which the uncertainty about one random variable decreases when
> the other is observed. If 0, the observation tells you nothing.

It means the mutual information between the output and the actual state is 0, and then **PASS carries 0 bits.** The
"difference from no verification" this chapter's title speaks of quantitatively vanishes here.

Note that **it is not that the true-positive rate must be 1.** As covered in Chapter 18, a 4-bit continuity
counter cannot detect a loss of exactly a multiple of 16 in principle. Yet that check carries information —
**because the miss condition is stated.** What is a problem is not a tool with a low true-positive rate but **a
tool that does not know its true-positive rate.**

> **PASS is not "intact" but "not caught by this check."**
> For that sentence to hold you must first know "what this check catches."

List where the same structure appears. Each row's middle column is the failure mode corresponding to §34.1's `exit
0` — what matters is that it is **not a bug but something that commonly happens in operations.**

| Tool | The path where it quietly becomes "no anomaly" | How to confirm the true-positive rate |
|---|---|---|
| vulnerability scanner | fails auth so does not see behind login, scan scope unset, plugins not updated | run it against a target with a known vulnerable version planted and see whether it detects |
| static analyzer | rule set not loaded, 0 targets analyzed due to build failure, parser dies on new syntax | measure the detection rate with a defect-marked benchmark corpus (Juliet/SARD, etc.) |
| linter | 0 rules applied due to a config-file path error | keep a rule-violating file resident in the repository |
| antivirus·EDR | signature not updated, real-time scan off, too many exclusion paths | **the EICAR standard test string** — a file the industry agreed must be detected while being non-malicious |
| fuzzer | seeds rejected before entering the parser, coverage instrumentation not working | confirm by coverage increase and rediscovery of known crashes |
| monitoring alarm | metric pipeline severed → no data → below threshold → silence | synthetic fault injection (canary · gameday) |
| backup | the backup job reports success but the restore does not work | periodic restore rehearsal |
| CI test suite | tests not collected so 0 run then green | mutation testing, **fix the executed-assertion count itself** |

The last row is the method this repository uses. `tests/run.sh` prints the count at the end, and the README
records that number.

```bash
./tests/run.sh        # pass 62 / fail 0     (README.md:362-364)
```

62 is not an arbitrary number. Of the 57 `ok` call sites one is inside `expect_pass`, and `expect_pass` is called
6 times, so the assertions run are `56 + 6 = 62`. The run result and the calculation match — **that a test passed
and that a test ran are different claims, and both must be confirmed.**

---

## 34.8 Security — the silent detector

### 34.8.1 The threat model

The cheapest path to neutralize a defense tool is not to pierce the tool's detection logic. It is **to make the
tool go silent.**

| Neutralization path | Required capability | Trace left |
|---|---|---|
| develop a new technique bypassing the detection rule | high | the attempt itself can be logged |
| make a target asset dropped from the scan scope | low — one infrastructure change | **none. the scan keeps going green** |
| expand the exception·exclusion list | low — comes as an operational-convenience request | only in the config history |
| sever the metric-collection path | low | the alarm going silent is itself a trace, but if you do not watch the silence it is not a trace |

The lower three lines **arise by themselves in operations** even if an attacker does not make them. Configuration
drift, asset-list omission, pipeline failure produce the same result. So this is a daily failure mode before it
is an attack scenario.

Here comes this chapter's security proposition.

> **A detector's silence means two things — there was no event, or the detector died.**
> Without a device to distinguish these two, silence is not information.

It is the same as §34.7's information-theoretic narrative. The distinguishing device is **an input that
necessarily fires.**

### 34.8.2 The defender's view

| Role | What to do |
|---|---|
| **security engineer** | for each tool adopted, **measure the true-positive rate with a known vulnerable sample.** the detection list the vendor presents is a claim, not a measurement. the measurement must be done in your own environment·your own configuration — the tool being able to catch it but not catching it in your config means it does not catch it |
| **detection engineering** | for each detection rule, **put an input that necessarily fires that rule in the same change.** separate the rule and the rule's oracle and only the rule remains while the oracle is lost |
| **SOC operations** | do not report 0 alerts as an achievement. periodically flow a canary event proving the pipeline is alive, and treat **not seeing the canary** as an incident |
| **auditor** | do not accept "scan passed" as a basis. require together the scan scope, rule version, exclusion list, last true-positive record. Chapter 15's principle as-is — a claim of improvement with no measurement is a verification target, not a basis |
| **development team** | CI green is "the tests passed," not "the tests ran." fix together the executed-assertion count or a coverage lower bound |
| **tool maker** | **document your own tool's miss conditions.** a tool that stated what it cannot catch is safer than one that did not — because the user can fill the rest with another control |

This chapter does not cover the procedure of evading a particular product's or service's detection. What it covers
is the defender's problem **"how do I know the detector I turned on is actually on."** Not a list of evasion
techniques but the absence of a verification procedure is this section's target.

---

## 34.9 Limits and open questions

Written honestly.

- **Defect injection fixes only the defects I imagined.** What `damaged` holds is four, and widened to the whole
  suite it is eight (`README.md:366-375`). **The true-positive rate for defects I could not imagine is still
  unknown.** It is the principled limit of the oracle-construction way, and means defect injection does not
  **solve** the oracle problem but **bypasses part** of it.
- **The head comment itself is off from the code.** `tests/run.sh:4-5` writes "4 kinds of HLS stream," "3 kinds of
  defect," but the same file's `tests/run.sh:147` output already lists four defects and the README's mapping table
  is eight lines. The streams too are five with the subtitle track added (`README.md:358-359`). **The sentence
  declaring the oracle principle has drifted from the code that is the principle's target** — a case of the fact
  that a document is not executed so it is not fixed by a regression test.
- **Of the 7 checks pointing at a defect, 5 are fixed.** In §34.5.2's report, `length consistency` (WARN) and
  `full decode` (FAIL) also pointed at a defect but have no corresponding `grep` in `tests/run.sh` (confirmed —
  the two strings are nowhere in the script). **Even if the full-decode check vanishes from the code, the exit
  code is 2 because of the other three FAILs and the suite stays green.**
- **`grep -q '✗'` is a string proxy for the verdict.** [`cli.py:964`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L964)'s `--tidy` preview prints `✗` as **normal
  behavior** (marking files to skip). Currently that path does not go through `expect_pass` so there is no problem,
  but this is not a structural guarantee but an **incidental placement.** The brittleness of observing the verdict
  channel by a string remains.
- **62 is the assertion count, not coverage.** Which code paths were never executed was not measured. Coverage
  instrumentation is not attached, so which parts of the code this suite does not touch is **unknown.**
- **The mapping table's own accuracy is not verified.** "This defect should be caught by this check"
  (`README.md:366-375`) is human judgment. If that mapping is wrong the suite **faithfully fixes the wrong thing.**
  The regression that the person constructing the oracle is the oracle's final basis cannot be fully removed.
- **This chapter's stub experiment does not remain in the repository.** Making the `exit 0` · `exit 2` stubs and
  running the two blocks was a one-off measurement done while writing, not fixed by a regression test. That is,
  **the very property "this suite excludes an always-PASS implementation" is not kept by regression.** To keep this
  property mutation testing must be made permanent — unresolved.

---

## 34.10 Summary

1. **The test-oracle problem** is "the problem of obtaining an independent basis to judge what the correct output
   of some input is." It arises from the asymmetry that **knowing the answer is harder than making the input.**
2. **In a verification tool the oracle is two-ply.** Since the tool itself is the 1st oracle, there is no higher
   oracle left to test that tool. A static analyzer·scanner·linter·alarm are all in the same spot.
3. The way out is **to make and feed in an input whose answer you know.** The one line `cp -R plain damaged` is
   that construction, and the two inputs' difference is the oracle.
4. **A two-line implementation always giving PASS passes normal cases 6/6** (measured). It is worse than no
   verification — because a false claim remains as a record and becomes the next person's basis.
5. Since the verdict maker is a classifier, **both rows of the confusion matrix must be fixed** for the
   implementation to be pinned down. Fix only one row and the one line `exit 0` or `exit 2` survives.
6. The reason `expect_pass` looks at the exit code and the log `✗` **together** is that the two channels' blind
   spots differ. WARN is folded into exit code 0 ([`cli.py:651-652`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L651-L652)), and an individual item's failure may not reach
   the aggregate verdict ([`report.py:464-469`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L464-L469)).
7. The reason the defect block `grep`s **per check name** is that fixing only the verdict is not enough. Four
   defects are in one run so exit code 2 comes even if only one is caught, and two of them (TS integrity·segment
   uniqueness) are WARN so they **leave no trace in the exit code.**
8. **A PASS from a tool that does not know its true-positive rate carries 0 bits.** It is not a low true-positive
   rate but not knowing it that is the problem — a check whose miss condition is stated gives information even with
   a low true-positive rate.
9. The defender's proposition: **a detector's silence means both "no event" and "detector dead."** To distinguish
   them you must periodically flow an input that necessarily fires.

---

**Next chapter** — this chapter showed up to the need to fix "does it catch the defect" together. Then what defect
to inject. A randomly broken file cannot be interpreted for what was detected so it does not become an oracle.
Chapter 35 covers which check each of the eight defects this repository injected targets, why that mapping table
is itself the proof of coverage, and what to be careful of when one defect touches two or more checks.
