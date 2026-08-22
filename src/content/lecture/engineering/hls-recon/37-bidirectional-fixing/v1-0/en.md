---
title: "Bidirectional Fixing"
description: "Test the false positive and the false negative together"
date: 2026-08-13
version: '1.0'
tags: ['streaming', 'verification']
thumbnail: /images/lecture/thumb/hls-recon-37-bidirectional-fixing.svg
---
## 37.0 What this chapter answers

1. What **wrong implementation does a test fixing only true positives pass?**
2. When a verdict maker's two errors give **opposite symptoms**, what shape must the test have?
3. Why does `tests/run.sh`'s inventory block have nine assertions — are the two that catch the defect not enough?
4. When the safe rule "give up if ambiguous" hardens in the implementation into **"always give up,"** what dies,
   and why is that invisible in the test?
5. Why does a security tool with many false positives have a **practical recall of 0?**

Chapter 34 was the problem of excluding an "implementation that always gives PASS." This chapter covers its
**exact mirror image** — an implementation that always gives FAIL. The two chapters together pin down one verdict
maker.

---

## 37.1 The problem — one verdict, two opposite disasters

### 37.1.1 The verdict's spot

Inventory is the judgment of picking out **"episodes already present"** when receiving a 27-episode series a
second time. The spot where the verdict result is consumed is the middle of the download loop.

```python
# cli.py:872-879
        # look at the inventory before issuing the playback source — if it is an episode already fully received,
        # it ends here and not a single request goes out.
        have = stock.get(ep.number)
        stale = bool(have and not have.ok)
        if have and have.ok and not args.overwrite:
            _eprint(f"  · already have it — skipping ({have.video.name}). to re-receive use --overwrite")
            done.append((ep, "skipped"))
            continue
```

The one boolean `have.ok` decides **one episode's fate.** If `True`, not a single network request goes out for
that episode, and if `False`, it is re-received from the start.

Why this verdict looks at the number and not the name, and why an exact extension match will not do, the module
docstring wrote.

```python
# inventory.py:6-12
- **The file name cannot be known in advance.** The storage name comes from the player setting's `title`,
  and to read it you must issue a playback source per episode (`series.resolve`). Skipping after knowing the name
  means 27 issue requests still go out even when all 27 episodes are already received —
  three per episode (page·player·XHR), so over 80 travel in vain. So compare by the **episode number**
  instead of the name. The number is already known from the listing page so it is free.
- **The extension can differ from last time.** Run with `--container` changed and the name is the same and only
  the extension differs. Judge by exact match and everything becomes absent and the 27 episodes are re-received.
```

Both items speak of **the loss that arises when the verdict is too strict.** The third item ([`inventory.py:13-15`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L13-L15))
speaks of the opposite direction, and that direction was already dissected in Chapter 20 — the problem of a
truncated file passing as a finished copy.

### 37.1.2 The two directions' symptoms are opposite

Chapter 20 §20.1.2 organized this asymmetry from the cost view. Here we see it again from the **test-design
view.** What differs — weigh **from which code path** each error comes.

| Error direction | From which implementation defect it comes | What the user sees | Recovery |
|---|---|---|---|
| **false positive** (normal as defective) | box-order assumption, extension exact match, missing episode-notation normalization, giving up work-title matching | re-receives 27 fine episodes every time | automatic — the same file comes again |
| **false negative** (defect as normal) | no size lower bound, no box-boundary check, checking only existence | **nothing happens** | none — the tool never touches that episode again |

The right two columns are this chapter's starting point. **A false positive is noisy and a false negative is
quiet.** A false positive is billed immediately in bandwidth and time, but a false negative gives no signal until
the user plays episode 20.

### 37.1.3 And yet here there is no handle

In Chapter 22's threshold design the two errors hung **on the two ends of one handle.** Lower the threshold and
recall rises and precision falls. There was no way within the threshold to reduce both errors at once (§22.2.2).

Inventory is different. **There is no handle.** Because the two directions of error come from different code
pieces.

| Sample | The reacting code | Does fixing this piece worsen the opposite direction |
|---|---|---|
| 0-byte file | `MIN_BYTES` ([`inventory.py:35`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L35)) | no — a normal video exceeds 64 KB |
| an MP4 cut at 60% | box-boundary check ([`inventory.py:94-95`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L94-L95)) | no — an intact file has boundaries matching exactly |
| a normal file with `moov` after | the order-blind set judgment ([`inventory.py:96`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L96)) | no |
| `그렌라간3.mp4` | `episode_of`'s episode normalization | no |
| `그렌라간04.mkv` | `MEDIA_EXTS` · `_head_flaw` | no |

**Reducing both errors at once is possible in principle.** So the test has the right to demand both at once. It
could not be demanded in the threshold case — there, the demand itself was a contradiction.

This right is the basis for `tests/run.sh:341-417` putting nine assertions.

```bash
# tests/run.sh:341-344
# ------------------------------------------------------------------- inventory
# The judgment that picks only the 'missing episodes' on the second run. Get it wrong here and the symptom
# splits the opposite way — too lenient and a broken file passes as finished so the episode is missing forever,
# too strict and 27 fine episodes are re-received every time. Fix both sides together.
```

The same sentence is in the README too.

> `README.md:377-380`
>
> The inventory is fixed **in both directions.** Too lenient and a broken file passes as finished so the episode
> is missing forever, too strict and 27 fine episodes are re-received every time. So along with the items catching
> the defect, it puts whether it sees a normal file (`moov` placed both before·after) as intact, and whether it
> reads different episode notation and extension as the same episode.

---

## 37.2 The principle — a verdict maker is measured on two axes

### 37.2.1 Fix the positive class first

The confusion matrix was already introduced in Chapter 34 §34.3. Only, before using that table there is one
thing that must be set, and say "false positive"·"false negative" without setting it and the conversation flips.

> **Term** — **positive class**: the side designated as the "detection target" in the confusion matrix. The words
> true positive·false positive·false negative are all relative to this designation. Depending on which side you
> set as positive, the same error becomes a false positive or a false negative.

This course, following the verification-tool convention, fixes **positive = "has a defect" = the FAIL side.** In
inventory, **"this episode must be re-received"** is positive.

| | Tool verdict = re-receive (positive) | Tool verdict = skip (negative) |
|---|---|---|
| **actually damaged** | true positive | **false negative** — the episode is missing forever |
| **actually intact** | **false positive** — 27 episodes re-received | true negative |

### 37.2.2 The two metrics are measured only by different samples

> **Term** — **recall (sensitivity, true-positive rate)**: the ratio of inputs actually having a defect that the
> tool judged positive. `TP / (TP + FN)`. The same value as introduced as the true-positive rate in Chapter 34
> §34.7.

> **Term** — **precision**: the ratio of what the tool judged positive that actually had a defect. `TP / (TP +
> FP)`. Unlike recall, the core is that the **denominator is the tool's output.**

Here the test-design conclusion comes out immediately.

| Metric | Denominator | The sample necessarily needed to measure it |
|---|---|---|
| recall | the count of actual defects | **defect samples** — with only normal files the denominator is 0 and it is undefined |
| precision | the count of positive verdicts | **normal samples** — with no normal at all there is no place for a false positive to arise |

**A test suite with no normal samples cannot measure precision, and a suite with no defect samples cannot measure
recall.** What cannot be measured is not fixed either.

### 37.2.3 Measured — the two metrics of four implementations

The values measured, swapping the verdict maker, for the six samples `tests/run.sh:349-362` makes (four normal,
two damaged). The measurement procedure is written in §37.3.3.

| Implementation | TP | FP | FN | TN | Recall | Precision |
|---|---|---|---|---|---|---|
| **`inventory.flaw` (real)** | 2 | 0 | 0 | 4 | **1.00** | **1.00** |
| always answers damaged | 2 | 4 | 0 | 0 | **1.00** | 0.33 |
| always answers intact | 0 | 0 | 2 | 4 | 0.00 | **undefined** |
| checks box order | 2 | 2 | 0 | 2 | **1.00** | 0.50 |

The second row is this chapter's target. **The recall of a one-line implementation that answers "always damaged"
is 1.00.** Same as the real one. A test looking at recall only cannot distinguish this implementation from the
real one.

The third row's "undefined" is not a spot to pass over. Since there is not a single positive verdict, `TP + FP =
0` and the denominator is 0. What Chapter 34 §34.7 said with information theory — **PASS carries 0 bits** — appears
here in the form of **precision being undefined.** A tool that points at nothing has no target to ask accuracy
of.

### 37.2.4 The core proposition — the exact mirror image of Chapter 34

| Axis fixed | That axis's assertion | The surviving wrong implementation |
|---|---|---|
| **normal axis only** (false-positive prevention) | "call a normal file normal" | **an implementation that always answers intact** — Chapter 34 §34.1's `exit 0` |
| **defect axis only** (false-negative prevention) | "call a broken file broken" | **an implementation that always answers damaged** — `exit 2` |
| **both** | both | both excluded |

The two failure modes are **symmetric** but not **symmetrically dangerous.** A tool that always gives PASS makes
false reassurance, and a tool that always gives FAIL is **ignored.** An ignored tool has a recall of 1.00 on paper
while practically 0 — that is §37.6's subject.

---

## 37.3 The code — the dissection of nine assertions

### 37.3.1 The samples — four normal, two damaged, two groups

```bash
# tests/run.sh:347-363
STOCK="$WORK/stock/그렌라간"
rm -rf "$WORK/stock"; mkdir -p "$STOCK"
# Two intact episodes — one faststart (moov in front), one default (moov after). both are normal.
ffmpeg -v error -y -i source.mp4 -t 5 -c copy -movflags +faststart "$STOCK/그렌라간01.mp4"
ffmpeg -v error -y -i source.mp4 -t 5 -c copy "$STOCK/그렌라간02.mp4"
# An episode with a different episode-number notation (`3` vs `03`) and one with a different container (.mkv) — must be the same episode.
ffmpeg -v error -y -i source.mp4 -t 5 -c copy "$STOCK/그렌라간3.mp4"
ffmpeg -v error -y -i source.mp4 -t 5 -c copy "$STOCK/그렌라간04.mkv"
# An episode cut off mid-muxing — present but not intact.
python3 - "$STOCK" <<'PY'
import sys, pathlib
d = pathlib.Path(sys.argv[1])
whole = (d / "그렌라간02.mp4").read_bytes()
(d / "그렌라간05.mp4").write_bytes(whole[: len(whole) * 6 // 10])
(d / "그렌라간06.mp4").write_bytes(b"")
PY
for n in 01 02 3 04; do : >"$STOCK/그렌라간${n}.ko.srt"; done
```

The three comment lines each point at one direction. The first line and second line are **"both are normal"** and
**"must be the same episode"** — samples blocking false positives. Only the third line is a defect sample.

Here one more sample for `stock_for` attaches. The difference is that the judgment target is not a file but a
**file group.**

```bash
# tests/run.sh:380-396
# The case where several works are mixed in one folder via --flat. If the work title matches both groups,
# by number alone you cannot know which side is your episode — skipping on the basis of someone else's episode
# quietly misses the episode, so when you cannot disambiguate it is right not to skip.
mixed = folder.parent / "mixed"
mixed.mkdir(exist_ok=True)
whole = (folder / "그렌라간01.mp4").read_bytes()
for stem in ("다른작품", "또다른작품"):
    for n in ("01", "02"):
        (mixed / f"{stem}{n}.mp4").write_bytes(whole)
# The title matches no stem and is contained in both stems — there is no superiority.
picked, why = inventory.stock_for(inventory.scan(mixed), "작품")
print(f"MIXED {len(picked)} {why}")

# Conversely, when there is superiority it must disambiguate. If the rule "give up when ambiguous"
# hardens into 'always give up', the inventory becomes wholly dead code under --flat.
alone, _ = inventory.stock_for(inventory.scan(mixed), "또다른작품 시즌2")
print(f"ALONE {len(alone)}")
```

The second comment is the most important sentence in this chapter. It is covered separately in §37.4.

> **Term** — **dead code**: code that affects the result on no execution path. Here it means the state where a
> function is called but **always returns the same value** (an empty stock), so replacing that function with a
> constant does not change the program's behavior.

### 37.3.2 The nine assertions and their axes

```bash
# tests/run.sh:399-417
grep -q 'EP 1 그렌라간01.mp4 ok=True' "$INV" \
  && ok "sees a normal episode as intact (faststart)" || bad "mistook a normal file for damaged (faststart)"
grep -q 'EP 2 그렌라간02.mp4 ok=True' "$INV" \
  && ok "sees a normal episode as intact (moov after)" || bad "mistook a normal file for damaged (moov after)"
grep -q 'EP 3 그렌라간3.mp4 ok=True' "$INV" \
  && ok "reads an episode-notation difference as the same episode (3 = 03)" || bad "cannot recognize a different episode notation"
grep -q 'EP 4 그렌라간04.mkv ok=True' "$INV" \
  && ok "reads a different container as the same episode (.mkv)" || bad "cannot recognize a different extension"
grep -q 'EP 5 .* ok=False' "$INV" \
  && ok "detects a truncated file as damaged" || bad "mistook a truncated file for finished"
grep -q 'EP 6 .* ok=False' "$INV" \
  && ok "detects a 0-byte file as damaged" || bad "mistook 0 bytes for finished"
grep -q "NOTE '그렌라간'" "$INV" \
  && ok "finds the file group even with a different title (천원돌파 그렌라간 → 그렌라간)" \
  || bad "cannot join the title and the file stem"
grep -q 'MIXED 0' "$INV" \
  && ok "does not skip by number when the title matches several groups" || bad "skipped on the basis of someone else's episode"
grep -q 'ALONE 2' "$INV" \
  && ok "disambiguates when caught by only one group (works with --flat too)" || bad "gave up when it could disambiguate"
```

Organize each assertion with a name. Note that the `bad` side's phrase speaks exactly of the failure that
assertion blocks — **the assertion's name is the name of what is excluded.**

| # | Assertion | Axis | Sensitive component | The implementation that passes without this assertion |
|---|---|---|---|---|
| A1 | `EP 1 … ok=True` | true negative | `_isobmff_flaw` overall | (a control together with A2) |
| A2 | `EP 2 … ok=True` | **true negative** | the judgment seeing boxes as a **set** | an implementation seeing `moov` must be in front |
| A3 | `EP 3 그렌라간3.mp4 ok=True` | **true negative** | `episode_of` episode normalization | an implementation reading only two-digit notation as an episode |
| A4 | `EP 4 그렌라간04.mkv ok=True` | **true negative** | `MEDIA_EXTS` · `_head_flaw` | an implementation seeing only an exact extension match |
| A5 | `EP 5 … ok=False` | **true positive** | box-boundary check | an implementation checking only file existence |
| A6 | `EP 6 … ok=False` | **true positive** | `MIN_BYTES` | an implementation with no size lower bound |
| A7 | `NOTE '그렌라간'` | default behavior | `stock_for` return path | (§37.4.4 — fixes less than expected) |
| A8 | `MIXED 0` | **true positive** | the give-up-on-tie branch | an implementation adopting even when ambiguous |
| A9 | `ALONE 2` | **true negative** | 3-stage + longest stem | **an implementation that always gives up** |

The axes are balanced — five true negatives, three true positives. That the defect samples are only two while the
normal samples are four is not waste. **Because normal is not one shape.** Damage is the one property "not
finished," but normal can differ entirely in `moov` position·episode notation·container, and each opens a
different false-positive path.

### 37.3.3 The mutation experiment — what each assertion actually excludes

The same method by which Chapter 34 §34.3 replaced the whole program with an `exit 0`/`exit 2` stub, this time run
at the **module level.**

> **Measurement environment and procedure** — ffmpeg 8.1.1 (macOS, Apple clang 21), Python 3.14.5. I made the
> samples with the **same commands** as `tests/run.sh:347-363` (`source.mp4` with the same arguments too,
> 640×360·30 seconds), and moved the Python block of `tests/run.sh:366-397` and the nine assertions of
> `tests/run.sh:399-417` as-is. The mutations were put in by importing the `inventory` module functions and
> replacing them. I first confirmed 9/9 reproduces on the original. **This experiment is not in the repository** —
> a one-off measurement while writing.

| Mutation implementation | What was changed | Passing | Dead assertions |
|---|---|---|---|
| (original) | — | **9/9** | — |
| **always damaged** | `flaw()` always returns a reason | 5/9 | A1 A2 A3 A4 |
| **always intact** | `flaw()` always returns an empty string | 7/9 | A5 A6 |
| box-order check | `moov` must be before `mdat` | 7/9 | A2 A3 |
| exact extension match | only `.mp4` admitted as an episode | 8/9 | A4 |
| two-digit episode only | does not see `그렌라간3` as an episode | 8/9 | A3 |
| **always adopt** | pick the longest stem even when ambiguous | 8/9 | A8 |
| **remove the ladder** | answer only when there is one group | 8/9 | A9 |
| **remove only stage 2** | drop only the partial-containment stage (`inside`) | 8/9 | A9 |

Here §37.2.4's proposition is confirmed as numbers.

| Assumed test | That axis's assertions | Always damaged | Always intact |
|---|---|---|---|
| **fix true-positive axis only** | A5 A6 A8 | **3/3 pass — not excluded** | 1/3 |
| **fix true-negative axis only** | A1 A2 A3 A4 A7 A9 | 2/6 | **6/6 pass — not excluded** |
| all nine | A1–A9 | 5/9 | 7/9 |

> **A test fixing only true positives passes an "implementation that always gives FAIL."**
> A test fixing only normal passes an "implementation that always gives PASS" (Chapter 34).
> The two sentences are two rows of the same table, and **a table with only one row filled is not a table.**

### 37.3.4 Samples can overlap — what the box-order mutation revealed

The box-order-checking mutation was expected to kill A2, but **A3 died together too.** The reason is in the
sample-generation command.

| Sample | `-movflags +faststart` | `moov` position |
|---|---|---|
| `그렌라간01.mp4` | present | front |
| `그렌라간02.mp4` | absent | **after** |
| `그렌라간3.mp4` | absent | **after** |
| `그렌라간04.mkv` | (EBML — N/A) | — |

`그렌라간3.mp4` is a sample made to test episode notation, but by the way it is made it also tests the `moov`
placement. **If one sample carries two properties at once, when one assertion dies you cannot know from the log
alone which property broke.**

This is the normal-sample edition of "one defect touches several checks" measured in Chapter 35 §35.5. The
practical impact is small — since A2 dies together the diagnosis is not hard. But the fact that **the sample's
property is not limited to the one intended** is worth recording. Reduce the samples and this overlap grows, and
with overlap the resolution of the failure cause drops.

---

## 37.4 The code — when the give-up rule hardens

The six assertions on the `flaw()` side were already covered in Chapter 20. What this chapter newly opens is the
other three — the `stock_for` side. Here is a textbook case of **a defect never caught without bidirectional
fixing.**

### 37.4.1 The three-stage ladder and the give-up at its end

```python
# inventory.py:214-231 (docstring)
def stock_for(groups: dict[str, dict[int, Item]], title: str) -> tuple[dict[int, Item], str]:
    """Pick the stock for the work title. Returns: (episode number → item, a reason to show a human)

    The file name's stem (`그렌라간`) and the work title the site told (`천원돌파 그렌라간`) often go off —
    because the file name is set by the player and the work title by the listing page. So it does not see
    only an exact match but narrows in three stages.

        1. exact match                  `작품`      ← `작품`
        2. the work title contains the stem     `그렌라간`   ← `천원돌파 그렌라간`
        3. the stem contains the work title     `천원돌파 그렌라간` ← `그렌라간`

    If several catch at stage 2, pick the **longest stem.** `다른작품 시즌2` contains both
    `작품` and `다른작품` but the one overlapping more is that work. If the lengths are equal with no
    superiority, give up.

    If it cannot disambiguate it **gives an empty stock.** Skipping by a wrong guess quietly misses the episode,
    but an empty stock only falls back to the existing filename-match check so the loss is small.
    """
```

The last paragraph is a **fail-safe** design. Since the two errors' costs differ, when unsure it falls to the
lower-cost side. That "fallback spot" is present in the code too.

```python
# cli.py:892-897
        # A backstop for when it could not disambiguate by number (a folder mixing several works via --flat).
        # An episode decided to be re-received because it is damaged must not be filtered out again here.
        if out.exists() and not args.overwrite and not stale:
            _eprint(f"  · already have it — skipping ({out.name}). to re-receive use --overwrite")
            done.append((ep, "skipped"))
            continue
```

Even with an empty stock, if the file name matches exactly it skips. Only, this backstop works only **after
issuing the playback source** — because you must know the storage name to make `out`. That is, the 80-odd requests
have already gone out ([`inventory.py:6-10`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L6-L10)). **The loss is small, not absent.**

### 37.4.2 A fail-safe degenerates easily

Here is this chapter's second proposition.

> **The rule "give up if unsure," even hardening in the implementation into "always give up," throws no
> exception.**

Giving up is always the **safe** answer. It does not adopt someone else's episode, nor read a broken file as
finished. So a degenerated implementation gives not a single dangerous error — it just **does nothing.**

![The path by which a fail-safe degenerates and the assertion that separates it](/images/lecture/hls-recon/37-degenerate-rule.svg)

*Figure 37-1 — a fail-safe degenerates easily. A rule that lost its condition is the same as a constant function*

This course calls this state a **degenerate implementation** — a state where the conditional branch effectively
flows to only one side, so replacing that function with a constant does not change behavior. It is a concept
paired with Chapter 15's **incidental defense.** An incidental defense is "looks effective but made by another
layer," and a degenerate implementation is "looks like a rule but the condition is already dead." Both are
**indistinguishable without measuring.**

The paths by which degeneration actually happens are not only bugs.

| Path | How it arises |
|---|---|
| condition lost during refactoring | delete one rung of the ladder and the rest all flow to the final `return {}` |
| response to a false-positive report | when a "you guessed wrong" report comes it is easy to fix toward narrowing the condition. narrow and nothing passes |
| defensive exception handling | wrap the matching logic in `try/except` and return an empty stock on failure, and even if the inside always throws it is quiet |
| a normalization change | exactly as Chapter 31 §31.5.1 measured — remove one NFC-normalization piece from `_key` and 27 episodes become a wholly empty stock |

The last row matters. **This degeneration happens without even touching `stock_for`.** Change one function making
the comparison key and the ladder stays intact while every rung spins uselessly.

### 37.4.3 A8 and A9 cannot substitute for each other

I split by mutation what the two assertions exclude.

| Mutation | `MIXED` | `ALONE` | A8 | A9 |
|---|---|---|---|---|
| original | `0` | `2` | pass | pass |
| **always give up** (remove ladder) | `0` | **`0`** | pass | **dead** |
| **remove only stage 2** | `0` | **`0`** | pass | **dead** |
| **always adopt** (longest stem even if ambiguous) | **`2`** | `2` | **dead** | pass |

Two things to read.

**First, the "always give up" mutation passes A8.** Of course — because what A8 demands is exactly "give up in
this case." An assertion demanding a give-up cannot catch a give-up overuse. The conclusion of §37.2.2 that an
assertion demanding a true positive cannot catch a false positive appears here most sharply.

**Second, removing only stage 2 gives the same result.** The `inside` branch is one of the three ladder stages,
and `stock_for` still tries the exact match and stage 3. That is, this is not the extreme mutation "replaced the
function with a constant" but a **realistic mutation dropping one branch.** And yet exactly one of the nine
assertions reacts.

```python
# inventory.py:245-247
    inside = sorted((s for s, k in keys.items() if k and k in want), key=lambda s: -len(keys[s]))
    if inside and (len(inside) == 1 or len(keys[inside[0]]) > len(keys[inside[1]])):
        return groups[inside[0]], f"'{inside[0]}'"
```

These three lines **hang on the single A9.** Delete `ALONE 2` and these three lines can vanish from the
repository and the regression test stays green. It is exactly the same structure as saying in Chapter 34 §34.5.2
that deleting `grep -q 'CC discontinuity'` lets the whole CC-analysis module vanish while staying green, and the
difference is that **what vanishes here is not a detection feature but a normal-verdict feature.**

### 37.4.4 Honestly — A7 does not ride the ladder

A7's phrase reads as if testing the ladder.

```
ok "finds the file group even with a different title (천원돌파 그렌라간 → 그렌라간)"
```

Actually it does not. The `$STOCK` folder has only **one** stem, `그렌라간`, and `stock_for` in that case answers
before entering the ladder.

```python
# inventory.py:232-236
    if not groups:
        return {}, ""
    if len(groups) == 1:
        stem, only = next(iter(groups.items()))
        return only, f"'{stem}'"
```

Confirmed by measurement. **A7 passes even in the mutation replacing the whole ladder with "always give up"**
(that mutation's only dead assertion was A9). I also directly counted the number of groups `inventory.scan()`
returns for this folder and confirmed it is 1.

So the exact sentence is this.

| What A7 fixes | What A7 reads as fixing but does not |
|---|---|
| when there is one group, return that group and put the stem name in the reason string | **the ability to join by partial containment** when the title and stem differ |

The latter is fixed by A9. **An assertion's name does not tell the code that assertion actually executes.** This
off-ness grows as the test grows, and there is only one way to find it — delete or break the relevant code and
count which assertion dies. This is why mutation testing is more accurate than coverage measurement (Chapter 34
§34.3).

---

## 37.5 Generalization — quiet errors and loud errors

### 37.5.1 Where the same structure appears

A verdict whose two error directions give opposite symptoms is everywhere. In each row the last column is **the
side the test collapses first** — a quiet error gets no reports so samples do not gather, and with no samples no
assertion arises.

| Verdict | Positive (=takes action) | Cost of a false positive | Cost of a false negative | Which is quiet |
|---|---|---|---|---|
| **inventory** (this chapter) | re-receive | re-receive 27 episodes | the episode is missing forever | **false negative** |
| retry verdict (Chapter 8) | retry | amplification toward the server | give up on a recoverable failure | false positive — visible only on someone else's server |
| subtitle dedup (Chapter 29) | it is a duplicate | erases different cues | the same subtitle appears twice | **false positive** — the erased is not visible |
| timeline loss (Chapter 22) | it is a loss | false alarm on a variable frame rate | misses the loss | false negative |
| spam filter | it is spam | legit mail vanishes | spam comes in | **false positive** — the mail that never came is unknown |
| intrusion detection (IDS) | it is an intrusion | alert fatigue | the compromise proceeds | false negative |
| vulnerability scanner | it is vulnerable | the whole result is thrown away | the vulnerability remains | false negative |
| antivirus·EDR | it is malicious | a normal file isolated·work halted | infection | false negative |
| linter·static analyzer | it is a violation | the habit of ignoring sets in | the defect passes | false negative |
| cache invalidation | it is invalid | the cache benefit is lost | serving stale data | **false negative** |
| screening (medical) | positive | needless workup | diagnosis delayed | false negative |

That there are three cases where the false positive is quiet matters. **"A false positive is always loud" is a
property of this domain, not a general law.** An erased subtitle cue and a blocked legit mail are counted by no
one. Which is quiet must be judged separately per domain.

### 37.5.2 Five test-design rules

Organize the executable rules from this chapter.

1. **Write the positive class in the document.** Do not and the word "false positive" is used in two meanings
   within the team. This repository solved it by nailing the direction into the `bad` phrase — `"mistook a normal
   file for damaged"` and `"mistook a truncated file for finished"`.
2. **Put both axes' samples in the same fixture.** Four normal and two damaged are in the same folder and judged
   in the same run. Put them separately and one of the two quietly ages.
3. **Split normal samples by shape.** "Normal" is not one thing. `moov` before·after, episode `3`·`03`, `.mp4`·
   `.mkv` each open a different false-positive path.
4. **Always attach the opposite assertion to a branch that "gives up"·"withholds"·"uses a default."** Fix only
   the case where a give-up is right and that branch survives degenerating to a constant.
5. **Confirm what an assertion actually executes by mutation.** The name and the execution path go off (§37.4.4).

### 37.5.3 A limit — this rule does not always hold

As seen in §37.1.3, being able to demand both axes at once is a property of a **handle-less verdict maker.** In a
verdict maker adjusted by one threshold (Chapter 22) an implementation satisfying both axes at once may not exist,
and then a test demanding both makes an **impassable suite.** In that case what must be fixed is not the verdict
but the **chosen point** — nail down "at this threshold this sample is caught and that sample is not" as-is.

---

## 37.6 Security — a tool with many false positives ends up turned off

### 37.6.1 Three tools, the same structure

Intrusion detection·spam filter·vulnerability scanner are all in the same spot as this chapter's verdict maker.
What happens when the three tools are not evaluated bidirectionally is the same too.

| Tool | The extreme implementation when only true positives are fixed | If that implementation is actually deployed |
|---|---|---|
| **IDS·IPS** | calls all traffic an intrusion | the rule is turned off or the exception list grows infinitely |
| **spam filter** | calls all mail spam | the user digs through the spam box daily → turns off the filter |
| **vulnerability scanner** | calls all dependencies vulnerable | the development team ignores the whole report |

In all three the **recall is 1.00.** The vendor's material can write it so, and that number is not a lie. It is
worthless while not a lie.

### 37.6.2 Practical recall — what a false positive gnaws is not precision

> **Term** — **alert fatigue**: the state where an alert fires too often, or too often wrongly, so the responder
> stops reacting to alerts. Regardless of an individual alert's accuracy it lowers the whole system's detection
> effect.

![The feedback loop by which false positives collapse the practical recall to 0](/images/lecture/hls-recon/37-fpr-collapse.svg)

*Figure 37-2 — a false positive looks like a precision problem, but what collapses is recall*

The core is the **separation of nominal and practical.**

| | Definition | Who measures it |
|---|---|---|
| **nominal recall** | the ratio of the test environment's defect samples the tool pointed at | the tool maker — the samples are fixed so the value does not change |
| **practical recall** | the ratio of actual events during operation that **led to a human action** | **no one measures** |

The act of turning off an alert or widening the exceptions does not change the nominal recall by a single digit.
The tool is still catching, and the rule is still there. Only, that output reaches nowhere.

> **When the false-positive rate exceeds a threshold the tool is ignored, and an ignored tool's practical recall
> is 0.**
> And this collapse appears in no metric the tool reports.

### 37.6.3 The base rate dominates precision

Why a false positive so easily exceeds a threshold is explained by arithmetic.

> **Term** — **base rate**: the ratio of actual positives in the population. The **base rate fallacy** is the
> error of estimating a verdict's reliability from the tool's recall·false-positive rate alone while ignoring this
> value.

Compute with assumed numbers. **Not a measurement but arithmetic.**

| Situation | Population | Actual positives | Recall | False-positive rate | TP | FP | Precision |
|---|---|---|---|---|---|---|---|
| intrusion detection (base rate 0.1%) | 100,000 events | 100 | 0.99 | 1% | 99 | 999 | **9.0%** |
| inventory (base rate 3.7%) | 27 episodes | 1 | 1.00 | 10% | 1 | 2.6 | **27.8%** |

The first row means this. **10 of 11 alerts are false.** A false-positive rate of 1% looks very good on a tool
spec sheet, and with a low base rate even that value brings precision down to a single digit.

The second row applies the same arithmetic to this repository. If one of 27 episodes broke by a forced kill, a
verdict maker with a 10% false-positive rate has precision 27.8% — **three of every four "re-receive" verdicts are
fine files.** And what the user sees is not precision but the phenomenon "27 episodes are re-downloaded every
time," and what they do next is to distrust the inventory.

**This is why false-positive samples matter as much as defect samples.** In a low-base-rate area precision is the
tool's lifespan.

### 37.6.4 The defender's view

| Role | What to do |
|---|---|
| **detection engineering** | for each rule pair **an input that necessarily fires** (Chapter 34) with **a normal input that must necessarily not fire.** a rule with no latter is tightened with no one knowing, and the tightened result comes back as alert fatigue |
| **SOC operations** | leave the alert-handling result (true/false positive) as a label and **actually compute precision during operation.** without computing it only the feeling "too noisy" remains, and by feeling you cannot fix the rule |
| **security-tool adoption owner** | the vendor's detection list is a recall claim. put in **your environment's base rate** to estimate precision, and predict the operational burden by that value. a tool adopted on recall alone is buried under an exception list in six months |
| **vulnerability management** | do not turn scanner results directly into tickets. delivered to the dev team with false positives mixed in, **the whole report's trust drops**, and what vanishes then is not the false positives but the true positives |
| **the person turning off a rule** | turning it off is not itself wrong (Chapter 15 — when defense must be turned off, at the narrowest scope). the wrong is **that the fact of turning it off is recorded nowhere.** an exception list carries an expiry and a basis together |
| **auditor** | do not accept "99% detection rate" as a basis. require together the **false-positive rate·base rate·operational precision·exception-list size.** missing even one of the four and that 99% is a verification target, not a basis |
| **tool maker** | document the **false-positive conditions** along with the miss conditions. like Chapter 22 §22.5's variable frame rate, a tool that wrote "this check is wrong on this normal input" is used longer than one that did not |

This section does not cover how to evade a particular detection product. What it covers is the defender's problem
**"is the detector I turned on still reaching a human."** If Chapter 34 asked "is the detector dead," this chapter
asks **"the path by which a detector, alive, comes to be heard by no one."**

---

## 37.7 Limits and open questions

Written honestly.

- **The mutation experiment is not in the repository.** §37.3.3·§37.4.3's tables are a one-off measurement while
  writing and not fixed by a regression test. That is, **the very property "these nine assertions exclude these
  mutations" is not kept.** It is the same open item as Chapter 34 §34.9.
- **Precision 1.00 is a value for four samples.** §37.2.3's table is a calculation for the four normal samples the
  regression test makes, not the false-positive rate in real use. To know the real false-positive rate you need
  the distribution of wild files, and this repository has no such sample.
- **A7 does not fix what its name says** (§37.4.4, measured). The phrase must be fixed or a sample with two or
  more groups added for the name and the execution to match. Currently it is off.
- **`GAPS` is output but not asserted.** `tests/run.sh:378` prints `inventory.subtitle_gaps(stock)` but none of
  this block's nine assertions looks at it (confirmed). The subtitle-loss verdict is only indirectly fixed by the
  later subtitle-filling block as `FILLED 1 0` (`tests/run.sh:460`).
- **The `--verify-existing` (deep) path is not fixed.** The branch where `flaw(path, deep=True)` spawns `ffprobe`
  ([`inventory.py:153-159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L153-L159)) is passed by none of this block's assertions. A file that passes the structure check but does
  not actually open — the remaining region of the false-negative axis.
- **Some extensions in `MEDIA_EXTS` have no verdict at all.** `.avi` becomes an inventory target but catches on
  none of `flaw()`'s branches so if only the size lower bound is exceeded it is read as intact (Chapter 20
  §20.3.6·§20.7). **A real hole in the false-negative direction, and this block has no corresponding sample.**
- **The nine are nine a human imagined.** What distribution false positives·false negatives actually occur in was
  never measured. Bidirectional fixing fixes only the **two imagined directions**, and for failure modes not
  imagined Chapter 34 §34.9's limit remains as-is.
- **§37.6's "an ignored tool's practical recall is 0" was not measured in this repository.** Alert fatigue is a
  widely-reported phenomenon in security operations, but this chapter cited that phenomenon, not measured it.
  §37.6.3's two tables are, as stated, **arithmetic of assumed numbers.**
- **Whether a degenerate implementation actually happened in this repository could not be confirmed.** §37.4.2's
  four paths are **inferred as possible** from the code structure, and I did not dig through the commit history to
  confirm an actual case.

---

## 37.8 Summary

1. The inventory verdict has **opposite symptoms by the direction of the error.** Too strict and 27 fine episodes
   are re-received every time, too lenient and a broken file passes as finished so **that episode is never
   recovered.** The former is loud and the latter quiet.
2. **The positive class must be fixed before using the confusion matrix.** This course, following the
   verification-tool convention, sets "has a defect = FAIL" as positive.
3. **Recall is measured only by defect samples, precision only by normal samples.** In a test suite missing one
   sample side that metric is undefined, and what is undefined is not fixed either.
4. Measured: **the recall of an implementation answering "always damaged" is 1.00, same as the real one.** Fix
   only the three true-positive-axis assertions (A5·A6·A8) and this implementation **passes 3/3.**
5. The symmetric proposition: **a test fixing only true positives passes an "implementation that always gives
   FAIL."** It is two rows of the same table as Chapter 34's "a test fixing only normal passes an implementation
   that always gives PASS." A table with only one row filled is not a table.
6. That the normal samples are four is not waste. **Normal is not one shape** — `moov` before·after, episode
   `3`·`03`, `.mp4`·`.mkv` each open a different false-positive path.
7. **The safe rule "give up if ambiguous," even hardening into "always give up," throws no exception.** Then the
   inventory becomes dead code under `--flat`. An assertion demanding a give-up (A8) cannot catch this
   degeneration, and **only the assertion fixing the disambiguatable case (A9)** catches it. In the measurement
   the assertion hanging on [`inventory.py:245-247`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L245-L247)'s three lines was the single A9.
8. An assertion's **name does not tell the code it executes.** A7 reads as testing the work-title-matching ladder
   but actually answers via the single-group shortcut (measured). The only way to find out is mutation.
9. Security generalization: intrusion detection·spam filter·vulnerability scanner are all the same structure, and
   **a tool whose false positives crossed a threshold is ignored, and an ignored tool's practical recall is 0.**
   Meanwhile the nominal recall does not move a single digit. In a low-base-rate area **precision is the tool's
   lifespan.**

---

**Next chapter** — Part 8 so far handled a verdict as the two values PASS and FAIL. But Chapter 36's yellow dot
already showed a third value — a spot that observed but did not judge. Chapter 38 faces that spot head-on. What
must the tool output when the baseline does not hold, and why does a check always pass when **the measurement
target drags the measurement standard** — the trap of self-referential verification.
