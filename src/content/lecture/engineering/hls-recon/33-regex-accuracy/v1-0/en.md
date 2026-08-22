---
title: "A Regex's Accuracy Is the Misclassification Rate"
description: "What one (?<!\\d) blocks"
date: 2026-08-04
version: '1.0'
tags: ['streaming', 'portability']
thumbnail: /images/lecture/thumb/hls-recon-33-regex-accuracy.svg
---
## 33.0 What this chapter answers

1. When is a number at the end of a file name an episode number and when is it not?
2. Without `(?<!\d)`, **exactly** what breaks and how?
3. What does each of the four groups (`stem`·`sep`·`ep`·`unit`) protect? Why must `.*?` be non-greedy?
4. When only the server knows the answer, what is the strategy for guessing the name?
5. Is this regex safe against ReDoS — is the basis for that judgment the pattern or the input?

The figures in this chapter were all obtained by running this repository's code as-is. The reproduction method is
written in each section. What could not be confirmed is gathered in §33.8.

---

## 33.1 The problem — when is a number at the end of a name an episode number

In one folder these files have piled up.

```
그렌라간01.mp4
그렌라간02.mp4
원피스 500회.mp4
영상010.mp4
Sky.Blue.2003.mkv
Blade Runner 2049.mkv
Apollo 13.mkv
```

A human splits them at once. But write down the basis for that judgment as a rule and it is not uniform.

| Name | Trailing number | Human judgment | Basis |
|---|---|---|---|
| `그렌라간01` | `01` | episode number | there is a same-stem neighbor (`02`) |
| `원피스 500회` | `500` | episode number | the unit `회` is attached |
| `영상010` | `010` | episode number | the leading `0` is digit padding |
| `Sky.Blue.2003` | `2003` | **year** | it is four digits |
| `Blade Runner 2049` | `2049` | **year** — or part of the title | it is four digits |
| `Apollo 13` | `13` | **part of the title** | by form alone it cannot be known |

The last two rows summarize this chapter's problem. **What can be split by form and what cannot are mixed.**
`2003` can be split by the formal basis of digit count, and `Apollo 13` cannot — because its character arrangement
is exactly the same as `그렌라간 13`.

Where this verdict is used sets the problem's weight. The module's head states it.

```python
# naming.py:1-7
"""Naming rules — the single source of episode notation and series name.

There are three places that must read the episode number: subtitle-filename candidates (`name_variants`),
neighbor-episode gathering (`episode_names`), series-folder placement (`series_of`). If the rule scatters,
somewhere `그렌라간1` and `그렌라간01` are seen as the same work and somewhere as different.
So the episode-number regex and range-notation interpretation are kept only in this module.
"""
```

**The decision to make it a single source of truth concentrates the accuracy in one place.** The advantage is
that the rule does not split, and the price is that that one place's misclassification rate becomes the three
features' misclassification rate. §33.4 measures this price.

---

## 33.2 The principle — a regex is a classifier

> **Term** — **regular expression**: a notation describing a set of strings with a finite grammar. It judges
> whether one string is in that set.

> **Term** — **classifier**: a procedure assigning input to one of predefined categories. `EPISODE_RE` is a binary
> classifier splitting a file name into "a name with an episode number" and "one without."

Seen this way, the measure of this regex's quality is set. A classifier's measure is the **misclassification
rate**, and misclassification has two directions.

> **Term** — **false positive**: the error of judging what is not so as so.
> **false negative**: the error of judging what is so as not so.

| Direction | Meaning in this code | The symptom that appears |
|---|---|---|
| **false positive** | reading a non-episode number as an episode number | a movie becomes an episode of a nonexistent series and goes to the wrong folder. the inventory counts that movie as "episode n present" and never receives the real episode n |
| **false negative** | seeing an episode number as not one | an episodic work is not tied into a series. the file **stays in place** |

The two directions' prices are not symmetric. **A false negative falls to "does nothing," and a false positive
falls to "does the wrong thing."** In a tool that moves files this asymmetry is decisive — an unmoved file a human
can move later, but a wrongly-moved and vanished file a human must go find.

So this code **consistently leans toward the false-negative side.** All three rules are in the same direction.

| Rule | Anchor | What it gives up |
|---|---|---|
| if the character before the episode number is a digit it is not an episode number | [`naming.py:20`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L20) `(?<!\d)` | an episode number written as four digits or more |
| the episode number is up to three digits | [`naming.py:20`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L20) `\d{1,3}` | episode 1000 or higher |
| group into a folder only when there are two or more of the same series | [`library.py:75-76`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L75-L76) | a lone episode |

The third rule is outside the regex. It is **a structure filtering the classifier's false positives once more on
the consumer side**, and this is why a single `Apollo 13` is not wrapped in a folder.

---

## 33.3 The code — dissecting `EPISODE_RE`

```python
# naming.py:14-21
# The episode number at the end of the name. The separator (space·underscore·dot·hyphen) and unit (화·회) may or may not be there.
#
# `(?<!\d)` is the core. Without it `Sky.Blue.2003` splits into the stem `Sky.Blue.2` + episode number
# `003` — mistaking a year for an episode number so one movie gets a nonsense series name.
# If the character before the episode number is another digit, that digit string is one whole number, not an episode number.
EPISODE_RE = re.compile(
    r"^(?P<stem>.*?)(?P<sep>[\s._-]*)(?<!\d)(?P<ep>\d{1,3})(?P<unit>\s*[화회])?$"
)
```

### 33.3.1 Four groups and one gate

| Piece | Name | What it grabs | Consume width |
|---|---|---|---|
| `^` | — | string-start anchor | 0 |
| `(?P<stem>.*?)` | stem | everything before the episode number — the raw material of the series name | variable, **non-greedy** |
| `(?P<sep>[\s._-]*)` | sep | the separator between the stem and the episode number | variable, greedy, allows 0 |
| `(?<!\d)` | — | reject this spot if the character just before is a digit | **0** |
| `(?P<ep>\d{1,3})` | ep | the episode-number body | 1–3 |
| `(?P<unit>\s*[화회])?` | unit | the end letter of `1화`·`500회` | 0, or variable (`\s*` has no upper bound) |
| `$` | — | string-end anchor | 0 |

Of the five lines in this table minus the anchors, only the fourth line has consume width 0. While the rest set
"what to take," that one alone sets **"is it OK to cut here."**

### 33.3.2 `(?<!\d)` — the width-0 gate

> **Term** — **negative lookbehind**: a **zero-width assertion** of the form `(?<!X)`. If the position **just
> before** the current one matches `X`, it rejects the match at that spot. Since it consumes no character, it
> changes no group's content.

![A negative lookbehind checks the character before the episode candidate and splits pass and block](/images/lecture/hls-recon/33-lookbehind-gate.svg)

*Figure 33-1 — `(?<!\d)` looks at only the one character just before the episode candidate*

The gate's basis is a basic rule of lexical analysis.

> **Term** — **maximal munch**: the rule in lexical analysis that one token is grabbed as long as possible. A
> consecutive digit string is one whole number, not two numbers that can be split.

The `2003` of `Sky.Blue.2003` is **one number** of four consecutive digits. Taking only the last three inside it
and calling it an episode number breaks the token boundary, and `(?<!\d)` enforces that boundary.

Measured. The result of putting the same name into four regexes.

| Regex | The decomposition of `Sky.Blue.2003` |
|---|---|
| **actual** (`.*?` + `(?<!\d)`) | **no match** — a name with no episode number |
| greedy `.*` + `(?<!\d)` | no match |
| `.*?`, gate removed | stem `Sky.Blue.2` · episode `003` |
| greedy `.*`, gate removed | stem `Sky.Blue.200` · episode `3` |

The third row is that failure the code comment foretold. The fourth row is worse — the same name becomes episode
3 of a series `Sky.Blue.200`.

### 33.3.3 `\d{1,3}` — the upper bound blocks something different from the gate

It is easy to think the gate and the upper bound do the same job, but measure and their roles split. I unwound
only the upper bound to `\d+` (leaving the gate).

| Name | Actual (`\d{1,3}`) | With `\d+` |
|---|---|---|
| `Sky.Blue.2003` | no match | stem `Sky.Blue` · episode `2003` |
| `Blade Runner 2049` | no match | stem `Blade Runner` · episode `2049` |
| `원피스1000` | no match | stem `원피스` · episode `1000` |

In `\d+` the character before `2003` is `.` so the gate passes it. That is, **the path reading a whole year as an
episode number is blocked not by the gate but by the upper bound.** Their division of labor is this.

| Device | What it blocks |
|---|---|
| `(?<!\d)` | a split cutting **inside** a digit string (`2003` → `2`+`003`) |
| `\d{1,3}` | a split reading a whole digit string of four or more digits as an episode number (`2003` → `2003`) |

Combine the two and this regex's actual meaning is organized in one sentence.

> **Only when the maximal digit string at the end of the name (minus the unit) is 1–3 digits is that whole digit
> string an episode number.**

This restatement was confirmed with 200,000 random strings (used again in §33.6.2).

### 33.3.4 `.*?` — what non-greedy protects is not the episode number but the separator

What differs when you change `.*?` to greedy `.*` is interesting. As long as the gate is there, **the episode
number is unchanged**, and what splits is the **boundary** of `stem` and `sep`.

| Name | `.*?` (actual) | greedy `.*` |
|---|---|---|
| `원피스 1화` | stem `원피스` · sep `' '` | stem `'원피스 '` · sep `''` |
| `작품-05` | stem `작품` · sep `'-'` | stem `'작품-'` · sep `''` |
| `천원돌파 그렌라간 27` | stem `천원돌파 그렌라간` · sep `' '` | stem `'천원돌파 그렌라간 '` · sep `''` |

The non-greedy `stem` grabs the minimum, so the following greedy `sep` takes **all** of the separator. The greedy
`stem` is the opposite so the separator is absorbed into the stem and `sep` becomes the empty string.

There is no effect on the series name — because `series_of` strips the separator at the stem's end again.

```python
# naming.py:41-51
def series_of(name: str) -> str:
    """Get the series name from the file name — strip the trailing episode number and the separator before it.

    `그렌라간01` → `그렌라간`. If there is no episode number (a movie, etc.) return the name as-is.
    If the stem is empty (the file name is all digits) there is no basis to group by series so use the original.
    """
    parts = split_episode(name)
    if not parts:
        return name
    stem = parts[0].rstrip(" ._-")
    return stem or name
```

`rstrip(" ._-")` absorbs the greedy·non-greedy difference. But **there is one consumer that uses `sep` itself** —
`name_variants`'s "separator-removed notation" candidate (§33.5). Change it to greedy and `sep` is always empty so
that candidate is not generated, and for a video `그렌라간 01` it cannot find the subtitle `그렌라간01`.

**What non-greedy protects is not the episode number's digit count but the preservation of the separator info.**

Remove **both** the gate and non-greedy and the result collapses. Measured.

| Name | Actual | greedy + gate removed |
|---|---|---|
| `그렌라간01` | stem `그렌라간` · episode `01` | stem `그렌라간0` · episode `1` |
| `천원돌파 그렌라간 27` | stem `천원돌파 그렌라간` · episode `27` | stem `천원돌파 그렌라간 2` · episode `7` |
| `영상010` | stem `영상` · episode `010` | stem `영상01` · episode `0` |

**Every episode comes to have its own series.** The series-folder feature becomes wholly meaningless.

### 33.3.5 `unit` — split so it can be re-joined

```python
# naming.py:29-38
def split_episode(name: str) -> tuple[str, str, str, str] | None:
    """Split the name into (stem, separator, episode number, unit). None if no episode number.

    The unit is the end letter of `1화`·`500회`. When reassembling the name it must be attached as-is
    so `원피스 1화` does not turn into `원피스 1`.
    """
    m = EPISODE_RE.match(name)
    if not m:
        return None
    return m.group("stem"), m.group("sep"), m.group("ep"), m.group("unit") or ""
```

This function's return is a **lossless decomposition.** Join the four pieces as-is and you get the original. Had
`unit` not been kept separate but discarded, making the neighbor episode number of `원피스 1화` gives `원피스 2` — a
name not on the server.

The same design applies to `sep`. **"Can you re-join after splitting" is the check formula of parser design**, and
a decomposition that does not give the original when joined is itself information loss.

`series_of`'s last line `return stem or name` is a defense of the same lineage. If the file name is all digits
(`01.mp4`) the stem becomes an empty string, and since you cannot make a folder with an empty name it uses the
original name.

---

## 33.4 Misclassification spreads by the number of consumers

![One misclassification spreads to three consumers](/images/lecture/hls-recon/33-misclassification-spread.svg)

*Figure 33-2 — a single source's misclassification is amplified by the number of consumers*

Move the places using `split_episode` exhaustively and it is this.

| Consumer | Anchor | The function it goes through | Symptom on misclassification |
|---|---|---|---|
| series-folder placement (new) | [`library.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L33) | `series_of` | a newly received file is put in the wrong folder |
| series-folder re-gathering | [`library.py:69-71`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L69-L71) | `split_episode` `series_of` | unrelated files are grouped into one folder |
| inventory | `inventory.py:187,196` | `episode_of` `series_of` | a movie is counted as "episode n present" and the real episode n is forever missing |
| subtitle URL candidates | [`subtitles.py:405`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L405) | `name_variants` | assembles addresses with nonexistent names so every candidate is a wasted request |
| neighbor-episode gathering | [`cli.py:346`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L346) | `episode_names` | the whole range is assembled with wrong names |
| output-file placement | [`cli.py:663-665`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L663-L665) | `split_episode` `series_of` | the output is put in the wrong folder |

I removed the one gate line and actually ran it. The result of giving `library.plan_tidy` a file list and
comparing the plans returned.

```
A. the tests/run.sh fixture as-is
   [actual regex]     모아모아01·02(+.srt) → 모아모아/
   [(?<!\d) removed]  same — no difference

B. put in two movies ending in a year
   (Sky.Blue.2003.mkv, Sky.Blue.2010.mkv)
   [actual regex]     both movies stay in place
   [(?<!\d) removed]  Sky.Blue.2003.mkv → Sky.Blue.2/
                      Sky.Blue.2010.mkv → Sky.Blue.2/
```

Put what happened in B into words. **Two unrelated movies are grouped as episode 3 and episode 10 of a
nonexistent series `Sky.Blue.2` and go into a new folder.** The folder name is a string that was nowhere in the
originals.

A is the most important observation in this chapter. **The repository's regression-test fixture does not reveal
this defect.** The reason is covered in §33.8.

---

## 33.5 Only the server knows the answer — making candidates and adopting

### 33.5.1 The problem — same work, different notation

The video file name and the subtitle file name are decided by different actors. So they point at the same episode
while the notation goes off.

```python
# naming.py:60-70
def name_variants(name: str) -> list[str]:
    """Name candidates. The original first, then the episode-number-normalized form.

    The video filename and the subtitle filename frequently point at the same work while the episode
    notation goes off — `그렌라간1` and `그렌라간01`, `그렌라간 01` and `그렌라간01`. Which is right
    only the server knows, so make the candidates and adopt the one that exists.
    """
    out = [name]
    parts = split_episode(name)
    if not parts:
        return out
```

The last sentence holds the strategy's name.

> **Term** — **generate and test**: a strategy for when you cannot compute the answer directly — enumerate
> candidates and ask a judge about each, adopting the one that matches. Here the judge is the **server** —
> request a candidate address and if a subtitle comes, that notation is the answer.

The client cannot know the server's naming rules. Assume it can and you end up hardcoding rules per site, and the
moment a rule changes it quietly fails. It chose **the side that leaves the unknown as unknown and decides by
observation.**

### 33.5.2 The candidate-generation rules

```python
# naming.py:71-86
    stem, sep, ep, unit = parts

    cands = []
    if sep:  # the separator-removed notation
        cands.append(f"{stem}{ep}{unit}")
    # apply the digit-count variation only to 1~2 digits. 3 digits may be not an episode number
    # but a year ('… 2026'), and touching it makes a name unrelated to the original.
    if len(ep) == 1:
        cands.append(f"{stem}{sep}{ep.zfill(2)}{unit}")
    elif len(ep) == 2 and ep[0] == "0":
        cands.append(f"{stem}{sep}{ep[1]}{unit}")

    for c in cands:
        if c not in out:
            out.append(c)
    return out
```

The actual output.

| Input | Candidate list | The axis applied |
|---|---|---|
| `그렌라간01` | `그렌라간01`, `그렌라간1` | digit count (2→1) |
| `그렌라간1` | `그렌라간1`, `그렌라간01` | digit count (1→2) |
| `원피스 1화` | `원피스 1화`, `원피스1화`, `원피스 01화` | separator + digit count |
| `작품-05` | `작품-05`, `작품05`, `작품-5` | separator + digit count |
| `영상010` | `영상010` | none — 3 digits |
| `Sky.Blue.2003` | `Sky.Blue.2003` | none — not an episode number |

**The original is always the first candidate.** The order is itself the policy — the caller tries from the front
and stops at the first success ([`subtitles.py:392-393`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L392-L393)). Do not put the original first and, when a variant candidate
happens to get a 200, it adopts the wrong subtitle without even trying the original.

### 33.5.3 Why the digit-count variation is applied only to 1–2 digits

The basis the comment gives is the year. But as confirmed in §33.3.3, **a four-digit year does not reach the `ep`
group in the first place** — `(?<!\d)` and `\d{1,3}` block it earlier. In the measured range no name ending in the
`… 2026` shape matched.

So this restriction is more accurately read as a **second defense line.** What this restriction actually governs
now is 3-digit episode numbers (`500회`·`010`·`003`), and the basis for the judgment here is elsewhere.

| Axis | Is it a measured notation difference | Put in the candidates |
|---|---|---|
| separator presence (`그렌라간 01` ↔ `그렌라간01`) | yes — the comment records a measurement | put in |
| 1↔2 digit zero padding (`1` ↔ `01`) | yes — the regression test fixes it (`tests/run.sh:277-284`) | put in |
| a 3-digit's digit-count variation (`010` ↔ `10`) | **never observed** | do not put in |

Widening the candidates has two prices. One is that **each candidate adds one HTTP request**
([`subtitles.py:392-393`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L392-L393) writes the same thesis "a path put in by guessing is a wasted request each time it fails"),
and the other is heavier — **if a wrong candidate happens to get a 200, it adopts the wrong subtitle as the
answer.** In the generate-and-test strategy, widening the candidate set is not raising accuracy but **raising the
false-positive probability.**

### 33.5.4 `episode_names` — inherit the width from the input

```python
# naming.py:107-117
def episode_names(name: str, spec: str, what: str = "--sub-range") -> list[str]:
    """Apply a range notation to the name to make a per-episode name list.

    The digit count follows the input name's episode notation — `그렌라간01` keeps 2 digits.
    """
    parts = split_episode(name)
    if not parts:
        raise ValueError(f"could not find an episode number at the end of the name: {name!r} (e.g. 그렌라간01)")
    stem, sep, ep, unit = parts
    lo, hi = parse_range(spec, what)
    return [f"{stem}{sep}{str(n).zfill(len(ep))}{unit}" for n in range(lo, hi + 1)]
```

The one `zfill(len(ep))` is the whole policy. **It does not set the digit count but inherits it from the input** —
it does not guess the server's notation rule but follows one already-confirmed sample as-is.

| Input name | Range | Generated names |
|---|---|---|
| `그렌라간01` | `01-03` | `그렌라간01` `그렌라간02` `그렌라간03` |
| `그렌라간1` | `1-3` | `그렌라간1` `그렌라간2` `그렌라간3` |
| `원피스 500회` | `500-502` | `원피스 500회` `원피스 501회` `원피스 502회` |
| `비디오_003` | `3-5` | `비디오_003` `비디오_004` `비디오_005` |

Here the failure handling splits from the other consumers. Compare the four consumers' false-negative responses.

| Function | When it cannot find an episode number | Why so |
|---|---|---|
| `series_of` | return the name as-is | an automatic-inference path — retreat quietly and the file stays in place |
| `episode_of` | `None` | the caller skips that file |
| `name_variants` | a list holding only the original | just one candidate, the behavior continues |
| `episode_names` | **`ValueError`** | it is a feature the user **explicitly requested** with `--sub-range` |

**Only in a user-requested feature does it raise the failure as an exception.** That an automatic inference
retreats quietly is design, and that an explicit request fails quietly is a defect — the latter leaves the user no
way to know what they wrote wrong. [`cli.py:347-348`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L347-L348) raises this exception straight to `SystemExit`.

---

## 33.6 Generalization — accuracy is the misclassification rate

### 33.6.1 The moment you use a regex, its misclassification rate becomes the feature's misclassification rate

Write this chapter's proposition in one line and it is this.

> **If a feature makes a verdict with a regex, that feature's misclassification rate cannot be better than the
> regex's misclassification rate.** You can filter it lower downstream (§33.2's "two or more" rule), but downstream
> cannot revive what the regex missed.

List where the same structure appears.

| Domain | What the regex judges | The price of a false positive | The price of a false negative |
|---|---|---|---|
| file-name episode number (this chapter) | is this number an episode number | file into the wrong folder | not grouped into a series |
| log parsing·detection rule | is this line a compromise indicator | alert fatigue — the rule is turned off | a missed compromise |
| spam filter·WAF rule | is this request malicious | a normal user blocked | bypass |
| input validation | is this value an allowed form | a normal signup fails | injection |
| routing·permission matching | is this path a protected target | a normal access denied | **access without authentication** |
| PII masking | is this piece a sensitive value | hides even needed info | **plaintext leak** |

On the lower two rows the false negative's price is bold. **If the same kind of mistake is on an
authentication·permission path, it is not a misclassification but a vulnerability.** In this chapter's code only
one file goes to the wrong folder, but the structure is exactly the same.

Here also make clear the limit of a regex itself.

> **Term** — **regular language**: a string set recognized by a finite automaton. A nested·recursive structure
> (matching parentheses, an HTML tree) is not a regular language so it cannot be recognized by a regex.

This chapter's problem is fortunately expressed as a regular language — "a digit string at the end of a name" is
recognized by a finite automaton. But **"is this number an episode number" is not a problem of form but of
meaning.** A regex looks only at form. As long as `Apollo 13` and `그렌라간 13` have the same character arrangement,
no regex can split them. **Knowing the fact that you are using a regex on a question a regex cannot answer** is why
this code put the downstream rule "group only when there are two or more."

### 33.6.2 Portability — the same regex does not even compile in another engine

Return to Part 7's subject. This regex does not port.

| Engine | Lookbehind | This regex |
|---|---|---|
| Python `re` | fixed-width only | works — `\d` is width 1 |
| Python `regex` (external package) | variable-width | works |
| JavaScript (ES2018+) | variable-width | the lookbehind works — only the named group is `(?<…>)` so `(?P<…>)` must be fixed |
| Go `regexp`, Rust `regex` (RE2 family) | **none** | **compile fails** |
| POSIX ERE (`grep -E`) | none | unusable |

I confirmed Python's fixed-width constraint directly. `(?<!\d)` compiles, and `(?<![0-9]{1,2})` is rejected with
`PatternError: look-behind requires fixed-width pattern` (Python 3.14.5).

That the RE2 family **intentionally omitted** lookbehind matters. Support backreferences and lookaround and
backtracking becomes needed, and then worst-case time cannot be guaranteed. RE2 guarantees worst-case linear time
and in exchange reduced expressiveness. **§33.7.3's ReDoS safety and this section's accuracy devices are at the
two ends of the same axis.**

If you must move to RE2, take the gate outside the regex. After matching with a lookbehind-free regex, reject if
the last character of `stem + sep` is a digit. Whether this alternative is equivalent was confirmed with 200,000
random strings (length 0–9 strings made of `a b 0 1 . _ - space 화 회`), with **0 mismatches.** The reason it is
equivalent is in §33.3.3's restatement — `ep` is always the digit string at the end of the name, so if the longest
candidate is blocked by the gate a shorter candidate is necessarily blocked too.

---

## 33.7 Security — when the same mistake is on an authentication·permission path

### 33.7.1 `$` is not the end of the string

Python's `$` matches **the string end, or just before a trailing newline.** The absolute end is `\Z`. Measured.

| Input | `EPISODE_RE.match` | `EPISODE_RE.fullmatch` |
|---|---|---|
| `'그렌라간01'` | match | match |
| `'그렌라간01\n'` | **match** | no match |
| `'그렌라간01\n악성'` | no match | no match |

In this code it is close to harmless. The name comes from `Path.stem`, a filename with a newline is itself a
separate problem, and `sanitize` changes `\x00-\x1f` to `_` (`naming.py:26,128`). Only, **`sanitize` is applied at
write time and `EPISODE_RE` runs before that** — in order, this regex sees an unsanitized string.

On an access-control path the story differs. In code judging an auth-exception path with `^/(login|static)/.*$`,
put in `"/login/x\n"` and it **matches.** Then if that string is passed to another parser (proxy·logger·backend),
that side interprets the newline differently. The moment two layers read the same input differently is the spot
where a bypass holds.

> **Principle** — for anchors use `\A` and `\Z` or use `re.fullmatch`. `^`·`$` have a context where they mean
> something else, "line-wise," and in a regex used for a verdict that ambiguity is a cost.

### 33.7.2 `\d` is not `[0-9]`

Python's `\d` matches all Unicode decimal digits. Measured.

| Name | `EPISODE_RE` | `episode_of` |
|---|---|---|
| `그렌라간01` (ASCII) | match | 1 |
| `그렌라간０１` (fullwidth) | **match** | **1** |
| `그렌라간٠١` (Arabic-Indic digits) | **match** | **1** |
| `그렌라간೦೧` (Kannada digits) | **match** | **1** |

`int()` also accepts these digits. The consequence in this code is that **two files claiming the same episode
number** arise, and the inventory keeps only one of them ([`inventory.py:197-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L197-L201)).

The same Unicode width applies to `\s` too. `그렌라간\xa001` (non-breaking space, NBSP) has `sep` caught as `'\xa0'`
so it is handled normally, but `그렌라간​01` (zero-width space) is not `\s` so it is absorbed into the stem — one
invisible character splits the series. It is the same axis as Chapter 31's Unicode-normalization problem.

On a security path this property is a classic bypass vector. Verify with `\d` and compare·store in ASCII and the
two layers see the same string differently. **The defense is simple — use `[0-9]` in the verdict regex or give the
`re.ASCII` flag.**

### 33.7.3 ReDoS — why this pattern does not explode

> **Term** — **ReDoS (Regular expression Denial of Service)**: an attack where, in a backtracking-based regex
> engine, a particular input causes an abnormally long matching time and exhausts the CPU.

> **Term** — **catastrophic backtracking**: the phenomenon where the number of ways to split the same string
> grows exponentially with input length and the matching time explodes.

Measured. The left is this regex, the right the textbook catastrophic pattern `^(a+)+$`.

| `EPISODE_RE` — only separators, ending in non-digit | | `^(a+)+$` — `aaa…b` |
|---|---|---|
| length 1000 → 12.6 ms | | length 18 → 9.4 ms |
| length 2000 → 53.1 ms | | length 20 → 36.6 ms |
| length 4000 → 219.6 ms | | length 22 → 148.4 ms |
| length 8000 → 813.4 ms | | length 24 → 596.0 ms |
| length 16000 → 3557.4 ms | | length 26 → 2581.9 ms |

The growth rates differ. The left is **4× the time when the length is 2×** — O(n²) polynomial. The right is **4×
the time each time the length grows by 2** — exponential.

Weigh why it does not explode by each explosion condition.

| Typical condition for catastrophe | This pattern |
|---|---|
| nested quantifier `(X+)+` | none — quantifiers do not stack overlapping |
| overlapping alternation `(a\|a)*` | there is no alternation at all |
| unbounded repetition + a fallible trailing part | `\d{1,3}` has an upper bound and `[화회]` is a single character class |
| two adjacent quantifiers can eat the same character | **there is** — `.*?` and `[\s._-]*` fight over the separator |

The last row is the cause of O(n²). **This pattern is not linear.** Written honestly.

Then what is the basis for safety. Not the pattern but **the product of the pattern's order and the input's upper
bound.** This regex's input is a file name, and most filesystems set 255 bytes as the cap. The value measured at
that cap.

| Input | Time per call |
|---|---|
| `그렌라간01` | 0.41 µs |
| `천원돌파 그렌라간 27` | 0.70 µs |
| 250 chars + episode number (match success) | 11.7 µs |
| 255 chars all non-separator (match fail) | 11.7 µs |
| **255 chars all separator (worst)** | **816 µs** |

The worst is 0.8 ms. It is a function running once per file so it is no problem in real use.

> **Principle** — **ReDoS safety cannot be judged by the pattern alone.** The judgment formula is "the pattern's
> worst-case order × the input length cap." Use the same pattern on an input with no length cap (an HTTP header
> value, a request body, a log line, a user-submitted string) and the same order becomes the cost as-is.

### 33.7.4 The defender's view

| Role | What to do |
|---|---|
| **a developer using a regex** | for anchors `\A`·`\Z` or `fullmatch`. for digits `[0-9]` or `re.ASCII`. gather the verdict rules in one place and test that one place **in both directions** (§33.8) |
| **detection-rule author** | a rule's false negative is a bypass. before distributing the rule, **write first "what this rule cannot catch."** a rule with only true-positive cases is not a verified rule |
| **code reviewer** | look at whether two adjacent quantifiers can eat the same character. that is the signal of polynomial explosion. a nested quantifier `(X+)+` is the signal of exponential explosion |
| **platform·library maintainer** | for untrusted input enforce a linear-time engine (RE2 family) or a matching timeout, and **set an input-length cap as a spec** |
| **auditor** | for a regex on an authentication·permission·masking path, a misclassification is a vulnerability. require that regex's false-positive·false-negative cases be fixed by tests |

---

## 33.8 Limits and open questions

Written honestly.

- **The regression test cannot fix `(?<!\d)`.** The heaviest finding in this chapter. The fixture looks like this.

  ```bash
  # tests/run.sh:318-331 (excerpt)
  : >"$TIDY/외톨이01.mp4"                 # a lone episode — not wrapped in a folder
  : >"$TIDY/Sky.Blue.2003.1080p.mkv"      # ends in year·resolution — not an episode number
  : >"$TIDY/목록.m3u8"                    # not media
  …
  [[ -f "$TIDY/외톨이01.mp4" && -f "$TIDY/Sky.Blue.2003.1080p.mkv" && -f "$TIDY/목록.m3u8" ]] \
    && ok "does not touch a lone episode·movie·non-media" || bad "moved something that should not move"
  ```

  `Sky.Blue.2003.1080p` **ends in `p` so it does not match regardless of the gate.** That is, this check passes
  even with `(?<!\d)` removed. Passing all 77 names appearing in the test script through the actual regex and the
  gate-removed regex and comparing, the names whose verdict split were **0.** The cause is that the counterexample
  the comment gives (`Sky.Blue.2003`) and the name the test uses (`Sky.Blue.2003.1080p`) differ, and it is fixed by
  adding to the fixture one name with `.1080p` stripped (and a second file that would group with it under the same
  stem). **But I did not actually remove the gate and re-run the whole suite to reconfirm 62/62** — I reproduced
  only at the `library.plan_tidy` unit, and the rest is a static comparison of 77 names.
- **Semantics cannot be judged.** `Apollo 13`·`Toy Story 3` have the same character arrangement as an episodic
  work. `plan_tidy`'s "two or more of the same series" rule blocks folder creation, but `episode_of` still returns
  13. How this false positive appears on the inventory path was not measured.
- **Episode 1000 or higher is not read as an episode number.** Measured: `원피스1000` does not match so it is
  treated as a movie. It is a limit that can actually catch in a long-running serial, and raising the cap to 4
  revives the year misjudgment — **one cap adjusts two error directions at once.**
- **It does not know season notation.** Measured: `Show.S01E05` → stem `Show.S01E`, episode `05`. The episode
  number is right but the series name is contaminated. To handle the Western notation (`SxxExx`) one more rule is
  needed, and that rule brings in new false positives.
- **`\d`'s Unicode width and `ep[0] == "0"`'s ASCII comparison go off.** Fullwidth `０１` matches but `ep[0]` is not
  `'0'` (U+0030) so the digit-count variation candidate is not generated. It is using two character sets inside one
  function, and no problem was observed in current real use.
- **`$`'s trailing-newline allowance was judged harmless in this code but not verified.** By what path a filename
  with a newline actually comes in was not traced.
- **`name_variants`'s separator axis is not fixed by regression.** What `tests/run.sh:277-284` fixes is only the
  1↔01 digit-count axis. Change `.*?` to greedy and the separator candidate vanishes but the test passes — the same
  kind of gap as the first item above.
- **O(n²) leans on the filesystem's length cap.** A string the user gives directly like `--sub-name` has no length
  check. Being a value the user themselves gives it is no problem in the threat model, but it is a spot needing
  re-review if this code is moved to a server context.

---

## 33.9 Summary

1. **`EPISODE_RE` is a binary classifier.** The quality measure is the misclassification rate, and the prices of a
   false positive (year as episode number) and a false negative (fails to read the episode number) are not
   symmetric. A false negative is "does nothing" and a false positive is "does the wrong thing," so this code
   consistently leans toward the false-negative side.
2. **`(?<!\d)` is a width-0 gate** enforcing maximal munch — a consecutive digit string is one whole number.
   Without it `Sky.Blue.2003` splits into the stem `Sky.Blue.2` + episode `003`, and two unrelated movies are
   grouped into a nonexistent series folder (measured).
3. **The gate and the upper bound `\d{1,3}` block different things.** The gate blocks a split cutting inside a
   digit string, the upper bound blocks reading a whole four-digit string as an episode number. Combine them and
   it becomes "only when the maximal digit string at the end of the name is 1–3 digits is it an episode number."
4. **What `.*?` protects is not the episode number but the separator info.** Change it to greedy and the episode
   number is the same but `sep` empties and one name candidate dies. Remove both the gate and non-greedy and every
   episode comes to have its own series.
5. **When you do not know the answer, make candidates and let the server pick** (generate and test). The original
   is always the first candidate, and widening the candidate set raises not accuracy but **the false-positive
   probability and the request count.** So the digit-count variation is applied only to the measured axis (1↔2
   digits).
6. **A single source's misclassification rate is amplified by the number of consumers.** Gathering the rule in one
   place is right, but at the price that that one place decides the accuracy of six paths at once.
7. **This pattern is O(n²), not linear.** The reason it is safe is not the pattern but the input-length cap
   (filename 255 bytes). ReDoS safety's judgment formula is "the pattern's worst-case order × the input cap."
8. **Here only one file goes to the wrong folder but the structure is the same.** If the same kind of
   misclassification is on an authentication·permission·masking path, it is not a misclassification but a
   vulnerability. `$`'s trailing-newline allowance and `\d`'s Unicode width are the properties actually used for
   bypass on that path.

---

**Next chapter** — this chapter, while verifying code, found one **gap in the test.** The regression test cannot
fix `(?<!\d)`, and it seems the 62 checks would pass as-is even with that gate removed. What is this state where a
passing test guarantees nothing called, and how is it noticed — Chapter 34, the first of Part 8, faces that
question head-on. What do you verify the verification tool with, i.e. the **test-oracle problem.**
