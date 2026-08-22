---
title: "Verdict Synthesis"
description: "From threshold to exit code"
date: 2026-08-18
version: '1.0'
tags: ['streaming', 'verification']
thumbnail: /images/lecture/thumb/hls-recon-39-verdict-synthesis.svg
---
## 39.0 What this chapter answers

1. How do measured values of different units become **one verdict?**
2. Which item is FAIL and which is WARN — is there a principle to that assignment?
3. How does a verdict become **one byte of exit code**, and what did that mapping intend?
4. How does a check that was not performed look in the report — **is an absent item a pass?**
5. And finally: **what does exit code 0 guarantee and what does it not?**

The preceding 38 chapters each treated one observation. This chapter treats the layer where those observations
merge. As the last chapter of the course, it returns to Chapter 1's question and closes.

---

## 39.1 The problem — seven branches of measurement and one byte of answer

The measured values this tool gathers over one run are of different kinds and different units.

| Measurement source | Data type | Unit |
|---|---|---|
| segment receive | `list[FetchResult]` | count · millisecond · byte · SHA-256 |
| payload discrimination failure | `list[tuple[int, str, str]]` | count · MIME string · hex byte |
| MPEG-TS header | `TSReport` | packet count · PID set · discontinuity count |
| artifact measurement | `MediaInfo` | second · byte · codec name |
| timeline | `GapScan` | list of second-unit intervals |
| subtitle | `SubtitleReport` | track · cue count · second-unit offset |
| full decode | `tuple[int, list[str]]` | error line count |

But what the person wiring this tool into a CI pipeline wants is **one thing.**

```
May this artifact be passed to the next stage — yes / no
```

The process of folding milliseconds and SHA-256 and codec names into **one bit of yes/no** is this chapter's
subject. That fold has three reductions.

```
many kinds of measured values  →①→  many Check items  →②→  one verdict  →③→  exit code
```

① is **itemization**. It turns each measured value into three fields — "name·verdict·detail."
② is **aggregation**. It picks the single worst of the items' verdicts.
③ is **mapping**. It folds the three-value verdict into the two-value exit code.

![Measured values converge into one exit code](/images/lecture/hls-recon/39-convergence.svg)

*Figure 39-1 — measured values converge into one exit code*

A reduction is an operation that discards information, so **what you decided to discard** is the design. This
chapter looks, at each of the three stages, at what is discarded and what remains.

---

## 39.2 Principle ① — `Check`: the smallest unit of verdict

### 39.2.1 Three fields

```python
# report.py:64-72
@dataclass
class Check:
    name: str
    verdict: str
    detail: str

    def line(self) -> str:
        mark = {PASS: "✓", WARN: "!", FAIL: "✗"}[self.verdict]
        return f"  {mark} {_pad(self.name, 18)} {self.detail}"
```

> **Term** — **verdict**: the grade the checker gives to an observed value. In this code it is a string constant
> of three values `PASS`·`WARN`·`FAIL` ([`report.py:15`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L15)).

The three fields' roles differ.

| Field | Role | Consumer |
|---|---|---|
| `name` | which check it is — the name that points at this item in the report | people, the regression test's `grep` |
| `verdict` | the **only** value that enters aggregation | `Report.verdict` |
| `detail` | why it was judged so — the observed value and the threshold | people only |

Here the first reduction already happens. **Aggregation looks only at `verdict`.** The "drift `+0.03s` / `0.10%`"
carried in `detail` does not contribute to the verdict. The magnitude information of the measured value is
discarded at this boundary, and what remains is only one of three values.

### 39.2.2 `detail` is not decoration

That the discarded information is nonetheless **printed** is the core of this design. Chapter 22 §22.3.6 treated
"print the threshold together with the verdict," and this chapter sees that it is institutionalized as `Check`'s
third field.

```python
# report.py:319-324 — the detail when there is no loss
            rep.add(
                "timeline continuity",
                PASS,
                f"{gaps.frames:,} video frames continuous, 0 loss "
                f"(interval median {gaps.frame_interval * 1000:.1f}ms, threshold {gaps.threshold * 1000:.0f}ms)",
            )
```

Even on PASS it writes the frame count·median·threshold. **It is to make the reach of the PASS computable.** Not
knowing the threshold was 400 ms, you cannot know what this PASS excluded (Chapter 18·Chapter 22).

`_pad(self.name, 18)` is display-width alignment — Hangul takes two cells in the terminal, so filling by character
count misaligns the item names ([`report.py:27-30`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L27-L30)).

---

## 39.3 Principle ② — aggregation is one maximum

### 39.3.1 The code is six lines

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

Put in words, it is this.

> **If there is even one FAIL, FAIL. If none and there is even one WARN, WARN. Otherwise PASS.**

That `Report.verdict` is a `@property` and not a stored field also has intent. The verdict is **not a value kept
but a value computed on the spot from the item list.** There can be no path that forgets to update the verdict
after adding an item — there is no place at all for the two states to diverge.

### 39.3.2 Four algebraic properties

These six lines are the same as the following structure.

> Give the verdict values a total order `PASS < WARN < FAIL` and define aggregation as `max`.

From this view four properties follow.

| Property | Meaning | Practical corollary |
|---|---|---|
| **associativity·commutativity** | `max` is independent of order and grouping | the verdict is the same in whatever order you add checks |
| **identity `PASS`** | `max(x, PASS) = x` | a PASS item, however many you add, does not change the verdict |
| **absorbing `FAIL`** | `max(x, FAIL) = FAIL` | one FAIL nullifies all the rest |
| **monotonicity** | add an item and the verdict is the same or worse | a change that adds a check **cannot regress the verdict toward leniency** |

> **Term** — **identity element**: in a binary operation, the element that leaves the other unchanged whatever it
> combines with. Addition's `0` is an example (`x + 0 = x`). Here `PASS` is in that place.
>
> **absorbing element**: conversely, the element that becomes **itself** whatever it combines with. Multiplication's
> `0` is an example (`x × 0 = 0`). Here `FAIL` is in that place.

I confirmed the properties in practice. Without measurement, fill a `Report` with items differing only in verdict
and read the verdict and exit code — a measurement with only the aggregation layer peeled off.

```python
from hlsrecon import report
from hlsrecon.cli import _exit_code

def mk(*verdicts):
    r = report.Report()
    for i, v in enumerate(verdicts):
        r.add(f"check{i}", v, "")
    return r

r = mk("WARN", "FAIL")
print(r.verdict, _exit_code(r.verdict))     # → FAIL 2
```

| Items put in | `verdict` | `_exit_code` |
|---|---|---|
| 0 checks (empty report) | `PASS` | `0` |
| `PASS` | `PASS` | `0` |
| `PASS`, `WARN` | `WARN` | `0` |
| `WARN`, `FAIL` | `FAIL` | `2` |
| `FAIL`, `PASS` (reversed order) | `FAIL` | `2` |
| `PASS` × 12 | `PASS` | `0` |
| `PASS` × 11 + `FAIL` | `FAIL` | `2` |

I confirmed that for every verdict array of length 1–3 (3 + 9 + 27 = 39 cases) **the verdict is identical even
reversing the order.** Commutativity holds at the code level.

Note the first row. **The verdict of a report with 0 checks is `PASS`.** A natural result by the identity's
definition, and there is no separate guard code in `verdict`. This fact becomes §39.5's starting point.

### 39.3.3 Why monotonicity matters

Monotonicity earns its keep when you **extend** the checker. A change that adds a new check guarantees the
following.

- A run that was previously `FAIL` **never** becomes `PASS` because of the new check
- A run that was previously `PASS` **can** turn to `WARN`·`FAIL`

That is, the risk of extension is open **only toward more false positives** and closed toward more false
negatives. Why Chapter 37's bidirectional fixing is needed shows again here — in this structure what the
regression test must guard is "is the normal stream still PASS," not only "is the defect still FAIL." The latter
the structure guards to a degree, but the former it does not.

Had aggregation been **majority vote** or **weighted average** rather than `max`, all these properties break. Add
one check and an existing FAIL can be diluted and flip to PASS. Choosing the verdict algebra as `max` is not taste
but **a choice that locks the regression direction to one side.**

### 39.3.4 There is an item that is always `PASS`

The first item is added as `PASS` with no condition.

```python
# report.py:151-157
    # 1) playlist structure
    rep.add(
        "playlist",
        PASS,
        f"{segment_count} segments, declared length {declared_duration:.2f}s, "
        f"TARGETDURATION {target_duration:g}s, encryption {'AES-128' if encrypted else 'none'}",
    )
```

The README's verification-item table also writes "info" in this row's verdict column (`README.md:338`). This is
not a check but a **context record** — to read all the following verdicts you must know how many segments there
are and what the declared length is.

The reason there is no cost to loading an info channel onto the verdict channel is §39.3.2's identity. `PASS` does
not contribute to aggregation, so an info item does not contaminate the verdict. **A case where an algebraic
property created design freedom.**

---

## 39.4 The code — by what are FAIL and WARN divided

### 39.4.1 The exhaustive table

This transcribes every `rep.add` call inside `build()` as-is ([`report.py:123-511`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L123-L511)).

| # | Item | Anchor | `FAIL` condition | `WARN` condition | Otherwise |
|---|---|---|---|---|---|
| 1 | playlist | 152-157 | — | — | always `PASS` |
| 2 | segment receive | 167-181 | 1+ receive failures | received all but a retry occurred | `PASS` |
| 3 | response latency | 185-196 | — | TTFB p95 > 3000ms | `PASS` |
| 4 | payload validity | 199-211 | 1+ non-media responses | — | `PASS` |
| 5 | segment uniqueness | 213-218 | — | SHA-256 duplicate present | `PASS` |
| 6 | TS integrity | 243-249 | sync loss or undecrypted packet | CC discontinuity or TEI | `PASS` |
| 7 | length consistency | 266-278 | `abs(drift) ≥ TARGETDURATION` | drift > 0.5% | `PASS` |
| 8 | stream composition | 287-291 | — | no video track | `PASS` |
| 9 | subtitle embed | 349-356 | embedded track count ≠ requested count | — | `PASS` |
| 10 | subtitle timeline (embedded) | 358-366 | subtitle interval outside video range | — | `PASS` |
| 11 | embedded caption | 383-388 | — | — | always `PASS` |
| 12 | subtitle extract | 389-419 | 1+ failed tracks | — | `PASS` |
| 13 | subtitle timeline | 424-460 | a track out of video range exists | minimum coverage < 20% | `PASS` (sample run withholds the verdict) |
| 14 | subtitle batch collection | 462-469 | — | 0 secured | `PASS` |
| 15 | full decode | 502-509 | 1+ decode errors | — | `PASS` |

**Items that can give `FAIL` are 9, items that can give `WARN` are 8, items that can give both are 4 (2·6·7·13),
and info items that can give neither are 2 (1·11).**

There are 15 rows but the item **names** are 14 kinds — because `subtitle timeline` is added at two places, the
embed path (10) and the separate-file path (13), and depending on the run both can arise (§39.10).

### 39.4.2 The principle of assignment — two axes

Read the table vertically and one rule comes out.

> **Certain damage is `FAIL`; what could be damage or could be a normal seam is `WARN`.**

Written more precisely, there are two conditions. **Only when both conditions are met is `FAIL` given.**

| Axis | Question | Violate it and |
|---|---|---|
| **① certainty of observation** | is there a normal explanation other than damage for this observation | if yes, `WARN` |
| **② basis of the verdict line** | does the verdict line come from a spec·structure, or is it an arbitrary constant | if arbitrary, `WARN` |

② is the rule Chapter 22 §22.7.5 already made explicit — "do not put FAIL on a baseless constant." This chapter
confirms whether that rule runs through the **whole** verdict assignment.

Reread the exhaustive table by the two axes and it is this.

| Item | ① other normal explanation | ② origin of the verdict line | Result |
|---|---|---|---|
| segment receive failure | none — an HTTP failure confirms a loss | none (discrete event) | `FAIL` |
| success after retry | the artifact is intact — the observation target is delivery stability, not the artifact | none | `WARN` |
| TTFB p95 > 3s | the artifact is intact | **arbitrary constant 3000ms** | `WARN` |
| payload invalid | none — there is no normal delivery where HTML comes in a segment's place | none (head byte) | `FAIL` |
| SHA-256 duplicate | **yes** — a playlist pointing at the same URI twice is possible by spec | none | `WARN` |
| sync loss·undecrypted | none — §39.4.4 | none | `FAIL` |
| CC discontinuity·TEI | **yes** — §39.4.4 | none | `WARN` |
| drift ≥ TARGETDURATION | none — a whole segment's worth is off | **the value the playlist declared** | `FAIL` |
| drift > 0.5% | explainable by encoder rounding·container overhead | **arbitrary constant 0.5%** | `WARN` |
| no video track | **yes** — an audio-only rendition | none | `WARN` |
| subtitle coverage < 20% | **yes** — a forced track with only the opening | **arbitrary constant 20%** | `WARN` |
| subtitle batch collection failure | **not a verdict target** — neighbor episodes are unrelated to this artifact | none | `WARN` |
| decode error | none | none (whether an error line exists) | `FAIL` |

Except the one subtitle-batch-collection row, everything is explained by the two axes. The spot where the
principle is not kept is treated separately in §39.4.6.

The third type is also worth noting. **Subtitle batch collection** is neither ① nor ② but `WARN` for a third
reason — "it is not the target of this verdict in the first place." The `detail` string writes that reason
directly.

```python
# report.py:462-469
        if subs.extra:
            got = [r for r in subs.extra if r.ok]
            rep.add(
                "subtitle batch collection",
                PASS if got else WARN,
                f"neighbor episodes {len(got)}/{len(subs.extra)} secured "
                f"— not paired with the current video so not a timeline-check target",
            )
```

**A side task's failure is not mixed into the main verdict.** Mix it and the answer to "is this artifact intact"
is contaminated by "did the next episode's subtitle you meant to grab as a bonus arrive."

### 39.4.3 Contrast ① — segment duplicate is `WARN`, payload invalid is `FAIL`

Both are segment-unit observations and both are discrete events. What splits the verdict is axis ①.

```python
# report.py:213-218
        dup = len({f.sha256 for f in fetches if f.ok}) != len([f for f in fetches if f.ok])
        rep.add(
            "segment uniqueness",
            WARN if dup else PASS,
            "duplicate hash present — the same segment is sent repeatedly" if dup else "SHA-256 all distinct",
        )
```

The observation is a **duplicate of the content hash.** Enumerate what it can mean and there are three.

| Possible cause | Is it damage |
|---|---|
| a segment-URL assembly bug received the same piece repeatedly | **damage** |
| the delivery side uploaded the same piece by mistake | **damage** |
| the playlist intentionally points at the same segment twice (a still interval·repeated slate) | **normal** |

As long as the third exists, a duplicate hash **cannot confirm** damage. Moreover this check looks at content, not
URI, so it **has no means to distinguish intended repetition from a mistake.** Hence `WARN`.

Payload validity is different.

```python
# report.py:198-206
        # Even with HTTP 200 the content may not be media (an error page for an expired token, etc.).
        if bogus:
            types = sorted({ct or "no Content-Type" for _, ct, _ in bogus})
            rep.add(
                "payload validity",
                FAIL,
                f"{len(bogus)} were 200 responses but not media ({', '.join(types)}) "
                f"— seg#{bogus[0][0]} head {bogus[0][2][:16]}",
            )
```

The observation is that **the head byte is neither MPEG-TS nor ISO-BMFF** (Chapter 14·16's `sniff()`). There is
no interpretation here of "it might be normal." There is no normal delivery where a non-media thing comes in a
segment's place, and the bytes that came there become a loss in the reassembly as-is. Axis ① passes and axis ②
passes because there is no threshold at all → `FAIL`.

### 39.4.4 Contrast ② — CC discontinuity is `WARN`, sync loss·undecrypted is `FAIL`

Four values inside the same `TSReport` split into two grades. That rule fits on one line.

```python
# report.py:243-249
        rep.add(
            "TS integrity",
            FAIL if (ts.sync_errors or ts.scrambled_packets) else (WARN if problems else PASS),
            ", ".join(problems)
            if problems
            else f"{ts.packets:,} packets / {len(ts.pids)} PIDs, 0 loss",
        )
```

First distinguish what the four values observe ([`tsanalyze.py:44-47`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L44-L47)).

| Value | Observation | Is there a normal explanation | Verdict |
|---|---|---|---|
| `cc_discontinuities` | a per-PID 4-bit counter departed from the expected value | **yes** (below) | `WARN` |
| `transport_errors` | packets with the TEI bit set to 1 | **yes** — a self-report of the upstream transport layer, and there are misconfiguration cases | `WARN` |
| `sync_errors` | there is no `0x47` at the 188-byte grid position | **none** | `FAIL` |
| `scrambled_packets` | the scrambling control bit is not 0 | **none** | `FAIL` |

**The reason a CC discontinuity has a normal explanation** is exactly as Chapter 18 organized. The counter
increments only on packets carrying a payload, `cc == prev` is a duplicate packet the spec permits, and the state
continues across segment boundaries ([`tsanalyze.py:104-119`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L104-L119)). On top of this, at a point announced with
`EXT-X-DISCONTINUITY` the encoder starts anew so the counter restarts from an arbitrary value — and **the CC check
does not take that tag into account** (Chapter 18 §18.9). That is, in a normal episode with an ad inserted, a CC
discontinuity is observed normally. It is not confirmed damage.

**Sync loss has no such explanation.** MPEG-TS is a self-synchronizing format with a 188-byte period (Chapter
17·19), so a non-`0x47` value at a grid position means the byte alignment itself is broken. The file was cut, or
other bytes were mixed in the middle, or it was never TS to begin with. Either way the reassembly does not hold.

**An undecrypted packet is the same.** This tool analyzes after finishing AES-128 decryption, so a remaining
scramble bit means the key was wrong or it is SAMPLE-AES (Chapter 26). Either way the artifact does not play.

Organized, it is this.

> **A CC discontinuity is "a packet may have been dropped," a sync loss is "this byte stream is not TS," and
> undecrypted is "this byte stream is still ciphertext."** The first one speaks of possibility and the latter two
> speak of fact.

### 39.4.5 The only item where context changes the verdict strength

Timeline continuity alone has **the same observation splitting into two grades by context.**

```python
# report.py:309-317
            # If it is a discontinuity the playlist announced with EXT-X-DISCONTINUITY, it may be an intended seam.
            intended = discontinuities >= len(gaps.gaps)
            rep.add(
                "timeline continuity",
                WARN if intended else FAIL,
                f"{len(gaps.gaps)} losses / total {gaps.lost:.2f}s (max {worst.length:.2f}s) "
                f"@ {where}{more}"
                + (" — count matches the EXT-X-DISCONTINUITY declared intervals (intended seam possible)" if intended else ""),
            )
```

The observed hole is identical. What differs is only **whether the playlist announced that hole.** That is, axis
①'s "other normal explanation" is not inherent to the observation but **supplied from an external declaration.**

Chapter 21 §21.6 treated the need for this leniency (false positives pile up and the check gets turned off) and
its coarseness (it does not match the position, only compares counts). What this chapter adds is one thing — **the
basis for lowering the verdict is left in `detail`.** The trailing `+ (...)` is that. The fact of the grade
leniency and its reason are printed together in the report, so a person reading can review whether the leniency is
justified.

> **When you lower a grade, leave the very fact of lowering it in the artifact.** Lower it quietly and the person
> reading the report thinks that item was a `WARN`-worthy one to begin with.

### 39.4.6 The spot where the principle is not kept

Written honestly. There is one `FAIL` that violates axis ②.

```python
# report.py:431-432
            elif good and video_len > 0:
                strayed = [r for r in good if r.last_cue > video_len + 5.0 or r.first_cue < -0.5]
```

`5.0` and `-0.5` are constants whose basis is not written in the code, yet this condition gives `FAIL`, not `WARN`
([`report.py:441-451`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L441-L451)). The same constant pair is on the embed path too
([`report.py:358-366`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L358-L366)). It is a spot that conflicts with Chapter 22's rule — do not put `FAIL` on a
baseless constant.

There is a mitigating factor. The mismatch the regression test injects is on the **60-second** scale
(`README.md:372`), and a real `X-TIMESTAMP-MAP` alignment failure tends to be off by minutes rather than seconds
(Chapter 27). That is, near-boundary cases are rare. But **rare is a mitigating factor, not a basis.** If in a
delivery this repository has not met there is a normal track whose subtitle end is 6 seconds longer than the video
end, it becomes a false positive, and a false positive is `FAIL` so it immediately stops the pipeline.

And this is not a hypothesis. Chapter 38 §38.9.1 **measured a combination that gives exit code 2 on a defect-free
stream** — put `--limit 1 --sub-embed` and the `subtitle timeline` caught by this constant pair and the `length
consistency` contaminated by the sample run give `FAIL` together. It is because the embed path
([`report.py:358-366`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L358-L366)) has no premise condition corresponding to §39.5.3's withheld verdict. **A spot where the
cost of violating axis ② was observed as a real false positive**, and the regression test has no such combination.

---

## 39.5 The code — conditional checks: an absent item is not a pass

### 39.5.1 Which items can vanish

Every item addition in `build()` is under a condition. Enumerate the conditions and it is this.

| Conditional | Anchor | The items that vanish if this conditional is false |
|---|---|---|
| `if fetches:` | [`report.py:160`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L160) | segment receive · response latency · payload validity · segment uniqueness (**4**) |
| `if ts and ts.parsed:` | [`report.py:233`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L233) | TS integrity |
| `if media and media.ok:` | [`report.py:263`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L263) | length consistency · stream composition (**2**) |
| `if gaps is not None and gaps.ok:` | [`report.py:304`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L304) | timeline continuity |
| `if subs and (...)` | [`report.py:343`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L343) | everything subtitle-related (**up to 6**) |
| `if decode_errors is not None:` | [`report.py:502`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L502) | full decode |

And what makes that conditional false is the caller.

```python
# cli.py:616-617
    gaps = None if args.no_gap_scan else probe.gap_scan(str(out))
    decode = None if args.no_decode_check else probe.decode_check(str(out))
```

```python
# cli.py:630-632
        fetches=run.fetches or None,
        bogus=run.bogus,
        ts=run.ts if mode == "segments" else None,
```

Note the `or None` in `fetches=run.fetches or None`. An empty list becomes `None`, so on a path that does not
receive segments directly like `remux` mode, the four transport-layer items vanish wholesale. `ts` is also passed
explicitly only in `segments` mode, and for an fMP4 segment `TSReport.parsed` is `False`
([`tsanalyze.py:78-82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L78-L82)) so it is caught again by the second conditional.

Split the cause by nature and it is the following.

| Reason it vanishes | Example | Does the user know |
|---|---|---|
| **the user turned it off** | `--no-gap-scan`, `--no-decode-check`, `--subs none` | knows |
| **the mode decided** | `--mode remux` → no transport-layer·TS items | mostly knows |
| **the input decided** | fMP4 segment → no TS integrity | may not know |
| **the measurement failed** | `gap_scan` gave `ok=False`, ffprobe could not open the artifact | **does not know** |

The last row is the worst. In this case the tool **knows the fact that it failed and discards it.** `MediaInfo.error`
and `GapScan.error` are filled with a value ([`probe.py:131-137`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L131-L137), [`probe.py:210-220`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L210-L220)) but are read nowhere in
`report.py` — on the normal execution path they are not even printed to the console
([`cli.py:545`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L545)'s output is `--probe-only` only). A fact confirmed by reading the code, not reproduced by running.

### 39.5.2 The worst combination

I confirmed directly what remains when you make every conditional false. This is the result of calling
`report.build()` with no optional argument.

```
check item count: 1
    PASS | playlist | 300 segments, declared length 1800.00s, TARGETDURATION 6s, no encryption
verdict = PASS / exit = 0
```

```
==================================================================
  verification result: PASS — delivery data normal
==================================================================

  ✓ playlist            300 segments, declared length 1800.00s, TARGETDURATION 6s, no encryption
```

**It prints "delivery data normal" and gives exit code 0.** Yet this run did not check a single byte of the
artifact. The only remaining item is §39.3.4's info item, and that is by definition always `PASS`.

To reach exactly this state in a real run through the CLI, on top of `--mode remux --no-gap-scan --no-decode-check
--subs none` you need **ffprobe to fail to open the artifact.** If ffprobe is fine, length consistency·stream
composition (2) remain for a total of 3, of which length consistency can give `FAIL`. In other words options alone
do not reach complete silence, but **for the four layers of transport·packet·timeline·decode to vanish wholesale,
two options suffice.**

![An absent item is not a pass](/images/lecture/hls-recon/39-absent-is-not-pass.svg)

*Figure 39-2 — an absent item is not a pass*

Chapter 38 §38.6 already treated half of this problem.

> **A result vocabulary that cannot distinguish unknown from pass loses the distinction in the end even if there
> is code trying to keep it.** (Chapter 38 §38.6.3)

What Chapter 38 treated was the problem of **a withholding shipping out as `PASS`** — the item exists but there is
no "did not judge" in the verdict value. What this chapter adds is the other half. **The case where the item
itself is absent has not even a `detail` string.** A withholding is distinguished at least on the human-read
channel, but silence is distinguished on no channel.

### 39.5.3 This repository uses both ways together

Yet there is one spot that **handled the same problem differently.** It is the withheld verdict Chapter 38
treated.

```python
# report.py:424-430
            if good and sampled:
                rep.add(
                    "subtitle timeline",
                    PASS,
                    f"verdict withheld — the video is a sample with only the first {video_len:.1f}s received "
                    f"so there is no baseline to compare against the subtitle's whole length ({max(r.last_cue for r in good):.1f}s)",
                )
```

That there is no baseline so it cannot check is the same as §39.5.1's last row. But here it **makes the item
rather than removing it.** The verdict value is `PASS` so the aggregation result is identical to removing the
item, but the "verdict withheld" and its reason remain in `detail`.

Put the two ways side by side and the difference is clear.

| Way | Effect on aggregation | What is left in the report | Where used |
|---|---|---|---|
| **silence** — do not make the item | none | **none** | `--no-gap-scan`, `remux` mode, measurement failure |
| **withholding** — write the reason in a `PASS` item | none | item name + reason | the subtitle timeline of a `--limit` sample run |

**Withholding is better.** The exit code is the same anyway, but at least the person reading the report can know
"this check was not performed." Silence makes that information on **no channel.** It is the state where even the
"person (terminal)" row of Chapter 38 §38.6.3's table cannot distinguish.

At the same time, that withholding too has a limit was Chapter 38's conclusion — the verdict value is `PASS` so to
a consumer reading only `verdict` it is the same as a pass. Overlay the two problems and the table becomes this.

| | Human-read channel | `verdict` field | Item existence |
|---|---|---|---|
| pass | `✓` | `PASS` | present |
| **withholding** | distinguished (`verdict withheld — …`) | **not distinguished** | present |
| **silence** | **not distinguished** | **not distinguished** | **absent** |

Let me write the unimplemented improvement direction (**it is not implemented in this repository**).

1. Add `SKIP` to `Check.verdict` and place it as the identity in aggregation — the exit code stays the same
   (the direction Chapter 38 §38.6 proposed)
2. **Make the silent spots make items too** — leave a turned-off check·a mode-excluded check·a measurement-failed
   check each as a `SKIP` item. Only then does the table's last row disappear
3. Have `render()` and `to_json()` give **"performed n / defined N"** together
4. Have CI put a lower bound on that coverage figure along with the exit code

#4 is the core. That coverage cannot be expressed by one exit code is this design's structural limit, so that
information must go out on a **channel outside the exit code.**

---

## 39.6 The code — the exit code

### 39.6.1 The mapping is one line

```python
# cli.py:651-652
def _exit_code(verdict: str) -> int:
    return {report.PASS: 0, report.WARN: 0, report.FAIL: 2}[verdict]
```

Three values fold into two. Here **the distinction of `WARN` and `PASS` vanishes** — the third and last reduction.

This one line has one more small but important property. It is a **default-less dictionary lookup.** It is not
`dict.get(verdict, 0)`, so if an unregistered verdict value comes in it does not quietly give 0 but dies with an
exception. I confirmed it.

```
unregistered verdict value → KeyError: 'SKIP'
```

It means that to introduce §39.5.3's `SKIP` you must fix this line together, and **forget to fix it and the build
breaks and tells you.** The failure mode where a new grade is quietly absorbed as a pass is structurally blocked.

> **Giving a safe default when you meet an unknown value is not always right.** In a verdict mapping a "safe
> default" is exactly "treat a new grade as a pass," so here dying is better.

### 39.6.2 Why `2` — `1` is already taken

The reason `FAIL` maps to `2` and not `1` is not written in the code. But enumerate the exit codes this tool
actually gives and the answer narrows to one.

`cli.py`'s failure paths are all `raise SystemExit(string)` ([`cli.py:135`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L135) `:140` `:143` `:187` `:191` `:193`
`:445` `:471` `:506` `:675` etc.). In Python, throw a `SystemExit` carrying a string and it prints that string to
stderr and ends with **exit code 1.** I confirmed it.

```
$ python3 -c "raise SystemExit('test message')"
test message
exit=1
```

Therefore the actual exit-code space is not two values but **three.**

| Code | Meaning | The path it comes from | What CI should do |
|---|---|---|---|
| `0` | **the verdict held and there is no defect** (`PASS`·`WARN`) | `_exit_code` | to the next stage |
| `1` | **the verdict itself did not hold** — a problem of tool·environment·input | `SystemExit(...)` | retry or check the environment. Withhold artifact judgment |
| `2` | **the verdict held and a defect was detected** | `_exit_code` | discard the artifact |

What divides `1` and `2` is not the presence of a defect but **whether a verdict exists.** A run that died unable
to receive the playlist and a run that detected a loss are handled differently in CI — the former is worth
retrying and the latter is not. If the two give the same value, the retry logic keeps remaking a defective
artifact.

> **I note that the basis for this assignment is not made explicit in the code.** The above explanation is an
> inference built backward from observed behavior. Conventionally too `1` is the place for "general error," so
> choosing `2` is natural, but there is no evidence that was the author's intent.

Contrasting with the conventions of other tools in the same place shows where this choice sits.

| Tool | `0` | `1` | `2` |
|---|---|---|---|
| `diff` | same | different | error |
| `grep` | found | not found | error |
| **`hls-recon`** | **no defect** | **cannot judge (error)** | **defect detected** |

`diff`·`grep` use `1` for a "normal negative result" and `2` for an error. This tool swapped the two. **Neither is
the standard, so either way it must be documented** — the README does that job in one line at `README.md:351`.

### 39.6.3 Why `WARN` is `0`

Mapping `WARN` to `0` is the most contested choice in this design, and the basis comes straight from §39.4.2's
axis ①.

> **Term** — **quality gate**: a gate that, at one stage of a pipeline, blocks progress to the next stage if a set
> condition is not met. In CI it is usually implemented as stopping the job if a command's exit code is not 0.
> Hereafter "gate" means this.

A `WARN` item's definition was **"it could be damage or could be normal."** What happens if you stop a pipeline on
such an observation, Chapter 21 and Chapter 22 already treated from different angles.

- In a normal episode with an ad inserted twice, a CC discontinuity is observed normally → red light every episode
- In a normal episode with a still interval, a segment duplicate is observed normally → red light every episode
- In a busy-line time slot, TTFB p95 exceeds 3 seconds → red light depending on the time slot

And the fate of a pipeline that repeatedly gives a red light on normal runs is decided.

> **A false positive becomes a false negative in the end.** A gate that is always red is ignored, and once it
> begins to be ignored, `FAIL` is ignored along with it (Chapter 22 §22.2.3).

Putting `WARN` at `0` is **a choice to preserve the signal value of `FAIL`.** The gate is hung only on the
confirmed, and the unconfirmed is sent to the human-read channel.

But this choice has a cost, and the standard way to reduce that cost this tool **lacks** — a switch to promote
`WARN` to `FAIL`. C compilers' `-Werror`, ESLint's `--max-warnings 0` are the feature in that place, and a strict
pipeline tightens the gate with it. This tool has no such option, so to operate strictly you must parse the report
JSON directly.

### 39.6.4 The series layer — the same algebra repeats one layer up

On the path that receives 27 episodes at once rather than one, the same form appears.

```python
# cli.py:926-928
        done.append((ep, rep.verdict if rep else "?"))
        if rep and rep.verdict == report.FAIL:
            failed += 1
```

```python
# cli.py:943
    return 2 if failed or refill_failed else 0
```

**If even one episode is `FAIL`, the whole is `2`.** §39.3.2's absorbing property repeats as-is over the episode
set. And here too `WARN` does not contribute to the exit code — an episode whose `rep.verdict` is `WARN` is
printed as `WARN` in the summary list ([`cli.py:938-939`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L938-L939)) but does not raise `failed`. The two layers' policies
are consistent.

Meanwhile the episode layer counts two more things besides `FAIL` as failures — a playback-source resolution
failure ([`cli.py:888`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L888)) and a `SystemExit` during episode processing ([`cli.py:921`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L921)). That is, **"cannot
judge," which went out as `1` in a single run, is absorbed into `2` in a series run.** That the address issuance
for one of 27 episodes failed and that a loss was detected in one episode become the same exit code. The per-episode
verdicts remain in the summary list and the per-episode report JSON so information does not vanish, but **by exit
code alone the two cases are not distinguished.**

### 39.6.5 The regression test fixes the exit code

The exit code is this tool's **public contract.** Being a contract, it is nailed down by tests.

```bash
# tests/run.sh:481
[[ $code -eq 2 ]] && ok "exit code 2 (FAIL)" || bad "exit code is not 2: $code"
```

The normal-stream side looks at the exit code and the report content **together.**

```bash
# tests/run.sh:162-170
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

`&& ! grep -q '✗'` matters. It judged that **exit code 0 alone is not enough.** Since the exit code is 0 even with
a `WARN` mixed in, a test looking only at the exit code passes even if the normal stream quietly begins giving
`WARN`. Only by confirming the absence of `✗` together is "no defect" fixed.

For the same reason the defect side does not look at the exit code alone — `tests/run.sh:482-487` `grep`s the item
name and the `detail` string too. **"It gave exit 2" and "it gave exit 2 for the right reason" are different
propositions**, and not fixing the latter lets an implementation that gives FAIL on any item pass (Chapter
34·37).

And the failure-path exit code is fixed separately too.

```bash
# tests/run.sh:206
[[ $dcode -ne 0 ]] && ok "nonzero exit code on failure" || bad "failure but exit code 0"
```

Note the loose condition `-ne 0`. It does not fix whether it is `1` or `2`. §39.6.2's three-value distinction is
**documented but not fixed by a test.**

---

## 39.7 The report JSON — reproducibility and credentials

Apart from the verdict folding into the exit code, the measured values before folding remain as JSON
([`report.py:95-108`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L95-L108), [`cli.py:643-646`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L643-L646)). Here Chapter 12's subject reappears.

```python
# report.py:146-149
    # Leave the actually-run muxing command so the same artifact can be remade from the report alone.
    # But mask cookie·auth headers — preventing credential leakage comes before reproducibility.
    if mux_cmd:
        rep.stats["mux_command"] = _redact_headers(mux_cmd)
```

The two-line comment puts two conflicting demands side by side and ranks them.

| Demand | Basis | Rank |
|---|---|---|
| **reproducibility** — the same artifact must be remakeable from the report alone | to verify a verdict you must be able to reproduce its target | 2 |
| **leak prevention** — if a session cookie is loaded in plaintext, one file is account access | the report JSON stays as a CI artifact and is attached and passed around as-is | **1** |

The redaction targets are four header names ([`report.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L33)). Chapter 12 §12.6 treated this list's reach, so
without repeating it I write only **what is newly seen at the verdict layer.**

`_redact_headers` touches only the token after `-headers` ([`report.py:42-46`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L42-L46)). But `mux_cmd` contains, besides the
headers, **the media URL as-is.** The signed URL seen in Chapter 11 (`?md5=<signature>&expires=<unix>`) is itself
a time-limited credential, so if this JSON leaks before expiry it is reused as-is. A value of the same nature
remains elsewhere too.

| JSON key | Anchor | The value left | Is it redacted |
|---|---|---|---|
| `stats.mux_command`'s `-headers` | [`report.py:45`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L45) | request headers | **masked** (4 kinds) |
| `stats.mux_command`'s input URL | [`report.py:149`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L149) | a media URL with a signature·token | as-is |
| `stats.subtitles.tracks[].url` | [`report.py:486`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L486) | subtitle track URL | as-is |
| `stats.subtitles.extra[].url` | [`report.py:475`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L475) | neighbor-episode subtitle URL | as-is |
| `stats.bogus_payloads[].head_hex` | [`report.py:207-209`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L207-L209) | the first 16 bytes of an error response | as-is |

The last row has low leak risk (the head bytes of an HTML error page), but the other three are **outside the
redaction's reach.** It is an asymmetry that masks the credential carried in a header and does not mask the
credential carried in a URL, and that asymmetry arises because the redaction function picks its target by **token
position** — not by the credential's **meaning.**

> **Pick the redaction target by position and you miss the same secret when it appears in a different place.**
> The point where Chapter 12's conclusion is confirmed again in a verdict artifact.

---

## 39.8 Generalization — grade systems and gates

This chapter's structure is unrelated to streaming. Leave only the form and it is this.

> **Convert several observations into grades, aggregate the grades over an ordered set, and map the aggregate to
> one value the gate reads.**

Put systems using the same structure side by side and where each design diverges shows.

| System | Grades | The value that raises the gate | The value that does not | Promotion switch |
|---|---|---|---|---|
| C compiler | error / warning / note | error | warning | `-Werror` |
| ESLint | error / warn / off | error → exit 1 | warn → exit 0 | `--max-warnings 0` |
| pytest | failed / passed / skipped / xfail | failed | skipped, xfail | `-W error`, `--strict-markers` |
| SAST scanner | critical / high / medium / low | usually high and above | medium and below | severity threshold option |
| HTTP client (`curl`) | status code | 4xx·5xx only when given `--fail` | default: even 404 is exit 0 | `--fail` |
| **`hls-recon`** | PASS / WARN / FAIL | FAIL → exit 2 | WARN → exit 0 | **none** |

> **Term** — **SAST (Static Application Security Testing)**: a class of tools that analyze source code without
> running the program to find vulnerability candidates. It grades each find by severity, and from which grade to
> stop the build is set by the user.

Here four rules come out.

**Rule 1 — a grade with no gate is just a color.**
`curl`'s default behavior is the example. Even on receiving a 404 the exit code is 0, so to use the status code as
a grade you must specify `--fail`. Defining a grade and defining what that grade decides are separate jobs.

**Rule 2 — the grade that raises the gate must have a low false-positive rate.**
A false positive of the grade caught by the gate is a pipeline stop, and a repeated stop turns the gate off. So
**hang only the confirmed on the gate.** This tool's `FAIL`/`WARN` assignment principle (§39.4.2) is the concrete
form of this rule.

**Rule 3 — provide a promotion switch nonetheless.**
There is no guarantee that a grade not hung on the gate is forever harmless. The demand to tighten only in release
builds is everywhere, and so the `-Werror` family exists. **Loose by default, provide a means to tighten** — the
part this tool lacks.

**Rule 4 — fix the aggregation operation as `max` and the regression direction locks to one side.**
Majority vote or average can flip an existing verdict just by adding a check. Without the monotonicity seen in
§39.3.3, "I added more checks and defects began to pass" becomes possible.

And there is one more, a fifth rule obtained in this chapter. It is violated in practice more often than the
first four.

**Rule 5 — the gate value cannot express "what was checked."**
The exit code carries the verdict, not the coverage. Coverage must go out on **another channel** (the report body,
an artifact, a separate figure), and the side operating the gate **must put a condition on that channel too.** Do
not and §39.5.2's run — a run that checks nothing and gives 0 — is not distinguished from a normal pass.

---

## 39.9 Security — a threat model aimed at the verdict

### 39.9.1 Start from the threat model

The same model Chapter 22 §22.7.1 set. The adversarial actor is **the side that wants to pass a delivery with a
loss as normal.** But since this chapter's target is not measurement but **verdict**, the attack surface grows by
one.

> Not deceiving the measurement but **bypassing the verdict pipeline** is cheaper.

To deceive the measurement you must, as in §22.7.2, split the loss finely under the threshold. To bypass the
verdict, one flag suffices.

### 39.9.2 Inducing silence — the cheapest attack

One line in a CI config file makes a whole verification layer vanish.

```
hls-recon "$URL" -o out.mp4 --no-gap-scan --no-decode-check
```

And **no trace is left in the report** (§39.5.1). The exit code is 0, and the console prints "PASS — delivery data
normal." Whether to call this an attack or an accident is only a matter of intent; the result is the same.

Realistically this flag is turned on for a **legitimate reason** more than malice — the gap scan gives false
positives on a variable-frame-rate source (Chapter 22 §22.5.4), or the full decode takes too long on a long video.
And a flag turned on for a legitimate reason **is forgotten turned on.**

| Defense | Who | How |
|---|---|---|
| give coverage together with the verdict | tool implementer | §39.5.3's `SKIP` + "performed n / defined N" |
| leave a turned-off check in the report | tool implementer | a withheld item instead of silence |
| put a lower bound on the item count too | CI operator | a condition on `jq '.checks \| length'` |
| leave the reason for turning it off as a comment and re-review | CI operator | Chapter 22 §22.7.5 |

### 39.9.3 Inducing grade lowering — a self-report lowers the verdict

§39.4.5's leniency rule has one more property. **The delivery side supplies the basis for the leniency.**

```python
intended = discontinuities >= len(gaps.gaps)
```

`discontinuities` is the count of the playlist's `EXT-X-DISCONTINUITY` tags ([`cli.py:635`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L635)). That is, **write
that tag into the playlist at least as many times as the gap count and the timeline-continuity item's verdict
drops from `FAIL` to `WARN`, and the exit code goes from 2 to 0.** The comparison looks at count only, so it holds
even if the tag positions are utterly different from the real holes.

The point where the principle Chapters 5·14 set repeats at the verdict layer.

> **Self-reported metadata is for convenience, not a basis for judgment.**

But as seen in §39.4.5 this leniency has a legitimate reason — without it a normal episode with ads becomes FAIL
every time, and false positives pile up and the check gets turned off. That is, it sits in a trade-off — **not
take the self-report into account and it is a false positive, take it into account and it is grade-lowering
induction.**

Here comes one of this chapter's conclusions.

> **If you must take a self-report into account, leave the fact that you took it into account in the artifact.**

What the code actually does is that. It lowers the verdict and at the same time writes the reason for lowering it
in `detail` ([`report.py:316`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L316)). If the leniency itself cannot be removed, at least **make the leniency
visible.** The automatic gate is fooled, but a person reading the report sees the sentence "declared count matches
the gap count."

The direction to raise accuracy is also clear — **match the position too.** `Gap` has `start`·`end` and a segment
knows its own place (Chapter 21 §21.6.2), so the information is already there. The current implementation just does
not use it. But this repository has **no fault-injection test that manipulates the declaration** (the 8 defects in
`tests/run.sh` have no such item), so the above lowering path is confirmed by reading the code, not measured.

### 39.9.4 Artifact leakage

§39.7's content is a threat as-is. The verdict pipeline makes the report JSON, CI keeps it as an artifact, and an
artifact's access permission is usually looser than the source code's. A signed URL has a short expiry so its risk
is time-limited (Chapter 11), but **a cookie is not** — which is why it is at the top of the redaction list.

### 39.9.5 The self-destruction a false positive makes

The last threat does not come from outside. Tighten the grade assignment — say, raise a segment duplicate or a CC
discontinuity to `FAIL` — and exit code 2 comes out repeatedly on a normal stream. That pipeline's next stage is
decided.

```
repeated red light  →  gate ignored  →  gate removed or --no-* flags made permanent  →  no checks
```

**A false negative misses one defect; a false positive loses the entire checker.** What Chapter 22 §22.2.3 said at
the threshold level holds at the grade-assignment level too. This tool mapping `WARN` to `0` is a choice to block
this self-destruction path (§39.6.3).

But this tool already has one such path open. Chapter 38 §38.9.1's measurement — in the `--limit 1 --sub-embed`
combination **a defect-free stream gives exit code 2** (§39.4.6). Not something an attacker made but a false
positive this repository's own grade assignment made, and the regression test has no such combination so it goes
unnoticed. **A self-destruction path usually starts like this — in an untested option combination.**

### 39.9.6 The defender's view

| Role | What to do |
|---|---|
| **CI operator** | do not look at the exit code alone. Put conditions on the report's **item count** and **which items exist** too. For a flag that turns off a check, record the reason it was turned on and the re-review point together. Handle `1` (cannot judge) and `2` (defect detected) differently — retry only the former |
| **verification-tool implementer** | limit the grade hung on the gate to the confirmed. Do not **silence** a check that was not performed — leave it as a withheld item. If you lowered a grade, write the leniency fact and basis in the artifact. Provide a `WARN` promotion switch. Do not put a default in the verdict mapping |
| **delivery provider** | always declare `EXT-X-DISCONTINUITY` at intended seams (Chapter 21). At the same time, know that **that declaration lowers the verification tool's verdict** — overuse the declaration and your own delivery's losses are hidden too, and the first to lose from it is yourself |
| **auditor** | when you see `PASS`, require **which checks were performed** together. An exit code 0 with no item list is not a basis. Find items whose grade was lowered in the report and review their basis |
| **security staff** | treat the report JSON as a credential. The redaction list is by header name, so **a token carried in a URL is not caught** (§39.7) |

---

## 39.10 Limits and open questions

I separate what I could not confirm among this chapter's claims from the open questions of the code itself.

### What I could not confirm

- **The basis for choosing exit code `2` is inference.** That `SystemExit` uses `1` I confirmed by measurement,
  but there is no evidence anywhere in code·comment·README that the author chose `2` for that reason.
- **The grade lowering using `EXT-X-DISCONTINUITY` (§39.9.3) was confirmed by reading the code, not reproduced.**
  A fault injection manipulating the declaration count is not in `tests/run.sh`.
- **The explanation that an audio-only rendition is the basis for the `stream composition` WARN is inference.**
  There is no basis comment in the code, and I did not confirm whether this repository actually handles audio-only
  variants.
- **The basis for putting `TEI` at `WARN` is also not in the code.** The explanation "a self-report of the
  upstream transport layer, and there are misconfiguration cases" is an interpretation this chapter attached.
- **The "1 check" report of §39.5.2 was made by calling `report.build()` directly**, not reproduced by a run
  through the CLI. To reach that state on the CLI path an ffprobe failure must overlap.

### Open questions of the code

- **A measurement failure is not reflected in the verdict.** `MediaInfo.error` and `GapScan.error` are filled with
  a value but are not read in `report.py`. A run that could not open the artifact and a run that opened it and is
  normal are not distinguished in the report — the worst form among §39.5.1's fourth row.
- **There is no `SKIP` verdict value.** There is no place to express a check that was not performed, so silence and
  pass take the same shape (§39.5.3).
- **There is no `WARN` promotion switch.** With no `-Werror` equivalent, strict operation is hard.
- **If `target_duration` is 0 the `FAIL` branch of length consistency does not hold.** It is because of the first
  condition of `if target_duration and abs(drift) >= target_duration` ([`report.py:267`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L267)), and in that case
  however large the drift it is at most `WARN`.
- **The subtitle-timeline `FAIL` constants `5.0`·`-0.5` have no basis** (§39.4.6). It is the only spot that puts
  `FAIL` on a baseless constant, and its cost was measured in Chapter 38 §38.9.1 as **exit code 2 on a defect-free
  stream.** The regression test has no such option combination.
- **Two `Check`s of the same name can arise.** In a run that embeds a sidecar subtitle, both
  [`report.py:361`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L361) and [`report.py:441`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L441) (or `:455`) add a `subtitle timeline` item. Aggregation does not
  look at the name so the verdict is correct, but a consumer querying the report by item name cannot know which it
  gets.
- **Part of the subtitle statistics in the report JSON is always overwritten.** [`report.py:367-381`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L367-L381) puts
  embed-only statistics (`mode`·`streams_in_output`·`span`) into `rep.stats["subtitles"]`, but the same key is
  unconditionally reassigned at [`report.py:471-499`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L471-L499). A run using only `--sub-embed` has an empty `subs.results`
  ([`cli.py:610`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L610)) so the final JSON's `tracks` becomes an empty array and the embedded-track info does not
  remain. **A case where the verdict is right and the record is wrong**, confirmed by reading the code, not
  reproduced by running. To fix it you must update rather than assign, or split the key.
- **`stats` does not participate in the verdict.** All the magnitude information of the measured values remains in
  `stats` but has no effect on the exit code. It is intended design, but as a result **a consumer that does not
  parse the report cannot access the basis of the verdict.**

---

## 39.11 Closing the course — the total length is right but the middle is empty

Chapter 1 set out from one command line.

```bash
# README.md:18
ffmpeg -i master.m3u8 -c copy out.mp4     # it downloads. But —
```

The result of that run was this.

```
# README.md:28-29
1 six-second segment lost → ffmpeg exit code 0, output length 30.03s (same as normal)
                          → actually the 5.99s ~ 12.02s interval is entirely empty
```

Pass through 38 chapters and put the same stream into this tool and the exit code changes to `2`
(`tests/run.sh:481`). **The difference of the two exit codes is not the tool's ability but the scope of
observation.**

ffmpeg did not lie. About what it observed — "I opened the requested input, copied the packets I obtained, closed
the file" — it gave an exactly true answer. The loss was simply outside that observation scope. A loss appears not
as a total but as **a hole in the timeline**, and an observation that looks only at the total does not see the
hole (Chapter 21).

Reduce what the whole course did to one sentence and it is this.

> **We widened the scope of observation, clarified what each added observation can and cannot see, and set the
> rule that folds them into one verdict.**

So we can write exactly what the last one byte means.

**What exit code `2` guarantees**

- At least one of the checks **performed** in this run pointed at **confirmed damage**
- Which item judged so and why remains in the console and the report

**What exit code `2` does not guarantee**

- That the damage is **only one** — aggregation leaves only the single worst and discards the rest of the count
- The **size** of the damage — `Check.verdict` is a grade and the size is only in `detail` and `stats`

**What exit code `0` guarantees**

- The checks **performed** in this run did not point at confirmed damage

**What exit code `0` does not guarantee**

- That the artifact is intact — no check sees its own blind spot (if the lost-packet count is a multiple of 16 or
  one less it is invisible to the CC check (Chapter 18 §18.4), and a loss split finely under the threshold is
  invisible to the gap scan (Chapter 22 §22.7.2))
- **That a check was performed** — even if items vanish wholesale by flag·mode·measurement failure it is 0 (§39.5)
- That there was no `WARN` — `WARN` too is 0

The most important are the last two lines of the last list. Organized, it is this.

> **The exit code is not an absolute statement about integrity but a relative statement about the set of checks
> that run performed.**

What Chapter 18 said about one check — **"PASS is not integrity but not-caught-by-this-check"** — repeats as-is at
the whole-verdict level. One thing differs. An individual check's blind spot comes from that check's nature and
cannot be changed, but **the whole verdict's blind spot comes from which checks were performed and can be
changed.** So there remains one question the person reading the exit code must always ask together.

> **This 0 — after checking what is it a 0?**

Answer this question and the exit code becomes a trustworthy contract. Cannot answer it and it is the same as
Chapter 1's `exit 0` — one byte that is honest but says nothing.

---

## 39.12 Summary

1. A measured value is reduced three times — **itemization** (measurement → `Check`), **aggregation** (`Check`
   list → `verdict`), **mapping** (`verdict` → exit code). What is discarded at each stage is the design.
2. A `Check` is three — name·verdict·detail. **Aggregation looks only at the verdict** and the detail goes to the
   human only. Nonetheless writing the observed value and the threshold in the detail makes the reach of `PASS`
   computable.
3. Aggregation is `max` — the maximum over `PASS < WARN < FAIL`. **`PASS` is the identity, `FAIL` the absorbing
   element**, so order and count do not change the verdict, and **a change that adds a check cannot regress the
   verdict toward leniency.**
4. `FAIL` is given only when both conditions are met — **the observation has no other normal explanation, and the
   verdict line is not an arbitrary constant.** So segment duplicate·CC discontinuity·TTFB exceedance are `WARN`
   and payload invalid·sync loss·undecrypted·decode error are `FAIL`.
5. Timeline continuity alone **has its grade move by context.** If the `EXT-X-DISCONTINUITY` declarations are at
   least the gap count, `FAIL` drops to `WARN`. Since the delivery side supplies the basis for the leniency,
   lowering induction is possible, and so **leaving the leniency fact in the report** is the minimum defense.
6. `PASS`·`WARN` → `0`, `FAIL` → `2`. `1` is `SystemExit`'s place so the actual exit-code space is three, and
   **`1` (cannot judge) and `2` (defect detected) are handled differently in CI.** Putting `WARN` at `0` is **a
   choice to preserve the signal value of `FAIL`** — a false positive becomes a false negative in the end.
7. **An absent item is not a pass.** A check item can vanish wholesale by option·mode·input·measurement failure,
   and a vanished item leaves no trace. Make every conditional false and **only one info item that is always
   `PASS` remains, printing "delivery data normal."**
8. If Chapter 38 treated "a withholding ships out as `PASS`," what this chapter adds is the other half — **silence
   is distinguished on no channel.** A withholding at least remains in a human-read sentence — so **withholding is
   better than silence, and both arise from the lack of a `SKIP` value.**
9. The report JSON leaves the muxing command for reproducibility but **puts credential-leak prevention before
   reproducibility.** Only, the redaction is by header name so **a signature·token carried in a URL is not
   caught.**
10. **The exit code is not proof of integrity but a relative statement about the set of checks performed.** The
    person reading a `0` must always ask together — **this 0, after checking what is it a 0?**

---

**Closing the course** — this course began at the scene where one command line gives `exit 0`. That `0` was not
wrong. It was honest about the scope it observed, and simply did not say what that scope was. Where we arrived
after 39 chapters is not a better tool but **a more precise sentence** — what was observed, what that observation
can see, and what it can never see. Turning a stream back into a file was in the end the work of folding that
sentence into one byte, and of leaving the basis behind so it can be unfolded again after folding. Whatever
verification tool you build next, please write that sentence beside the exit code it gives. **A verdict does not
hold without observation, and an observation does not become a verdict unless it states its limit.**
