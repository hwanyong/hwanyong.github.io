---
title: "At-Least-Once and Idempotency"
description: "Boundary-duplicate cues, and the order of normalization and comparison"
date: 2026-07-25
version: '1.0'
tags: ['streaming', 'distributed-systems']
thumbnail: /images/lecture/thumb/hls-recon-29-at-least-once-idempotency.svg
---
## 29.0 What this chapter answers

1. Why does the same subtitle come twice — and why is that not the deliverer's bug?
2. What should the deduplication key be set as. Why can it be neither time alone nor body alone?
3. **Why must the cleaning be done before the verdict** — what breaks if you reverse the order?
4. Why is exactly-once delivery generally close to impossible?

The third is this chapter's core. The first two are preparation, and the fourth says why the first three are not
a problem only in this domain.

---

## 29.1 The problem — 6 cues become 9

### 29.1.1 Measured

This repository's regression test **makes the subtitle track itself.** Because ffmpeg's HLS muxer cannot chop
WebVTT into segments (`tests/run.sh:69-71`), and thanks to that what was put in remains in the code as-is.

```python
# tests/run.sh:99-108
    for i in range(COUNT):
        lo, hi = i * SEG, (i + 1) * SEG
        body = ["WEBVTT", f"X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:{base + OFFSET[name]}", ""]
        for s, e, text in cues:
            if e > lo and s < hi:                      # if it straddles the boundary, put it on both sides
                body += [f"{ts(s)} --> {ts(e)}", text, ""]
        (d / f"seg{i:03d}.vtt").write_text("\n".join(body), encoding="utf-8")
        pl += [f"#EXTINF:{SEG:.5f},", f"seg{i:03d}.vtt"]
    pl.append("#EXT-X-ENDLIST")
    (d / "index.m3u8").write_text("\n".join(pl) + "\n", encoding="utf-8")
```

The input is **6 cues** — `(0, 4)` `(5, 9)` `(10, 14)` `(15, 19)` `(20, 24)` `(25, 29)` (seconds). The pieces are
five 6-second ones. Run the same procedure by hand and count cues per piece and it is this.

```
$ python3 (identical to tests/run.sh's subtitle-generation procedure)
seg000: 2 cues
seg001: 2 cues
seg002: 2 cues
seg003: 2 cues
seg004: 1 cue
total piece cues: 9
```

**The unique cues are 6 but the cues carried in the pieces are 9.**

![Five subtitle pieces and six original cues placed on the same time axis](/images/lecture/hls-recon/29-boundary-cues.svg)

*Figure 29-1 — a boundary-straddling cue is carried on both of the two adjacent pieces*

There is one thing to note in the figure. **Cue 5 (20–24 seconds), even though its end exactly matches the piece
boundary (24 seconds), is not carried in the next piece.** Because the verdict condition `e > lo and s < hi` is a
**half-open interval** comparison. Since `e > lo`, `24 > 24` is false.

> **Term** — **half-open interval**: an interval including only one end. Here piece *i* covers `[lo, hi)`. It is
> the standard way of making a boundary time belong to exactly one piece, and take it as a closed interval and a
> cue ending at the boundary enters both sides, adding one more duplicate.

### 29.1.2 On concatenation a second contamination overlaps

Receiving and concatenating pieces is left to ffmpeg ([`subtitles.py:142-150`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L142-L150)). The measurement of opening that result
as-is (ffmpeg 8.1.1, local HTTP, `-c:s webvtt`).

```
WEBVTT

00:00.000 --> 00:04.000
한국어 자막 1번

00:05.000 --> 00:09.000
한국어 자막 2번
WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:126000

00:05.000 --> 00:09.000
한국어 자막 2번

00:10.000 --> 00:14.000
한국어 자막 3번
WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:126000
      ⋮
```

(The MPEGTS value is fixed in the fixture. In an actual delivery a different value comes per piece.)

Two things are seen at once.

| Observation | What it is |
|---|---|
| `00:05.000 --> 00:09.000` twice | a **boundary-duplicate cue** — what §29.1.1 foretold |
| `WEBVTT` · `X-TIMESTAMP-MAP=…` below cue 2's body | a **fragment header absorbed into the previous cue's body** |

Why the second arises is seen at once from WebVTT's block-separation rule. In WebVTT a cue **ends with a blank
line.** There is no blank line after a piece file's last cue, and the next piece's `WEBVTT` line joins right
after, so from the parser's view that is still the previous cue's body. Leave it and **the text `WEBVTT` appears
on screen as a subtitle.**

Whether this explanation is right can be confirmed separately. Make a file that **joins only the bytes of five
pieces with `cat`** and look into the boundary and it is this.

```
… --> 00:00:09.000\n한국어 자막 2번\nWEBVTT\nX-TIMESTAMP-MAP=…\n\n00:00:05.000 --> …
                                  ↑ there is no blank line — the cue does not end here
```

And feed this file to ffmpeg as-is and **the same result as received via the HLS playlist** comes out. That is,
the absorption is not a special behavior of HLS handling but **"the result of parsing WebVTT joined without a
blank line by the rules."**

The code comment wrote this fact as-is.

```python
# subtitles.py:168-181
# The WebVTT file header attached to each piece. Concatenate pieces and it is absorbed into the previous cue's body.
_SEG_HEADER_RE = re.compile(r"^[ \t]*(?:WEBVTT.*|X-TIMESTAMP-MAP=.*)$", re.MULTILINE)


def _clean_body(body: str) -> str:
    """Strip fragment headers that got mixed into a cue body.

    When ffmpeg concatenates subtitle pieces, it absorbs each piece's leading `WEBVTT` and
    `X-TIMESTAMP-MAP=` lines into the previous cue's body. Leave them and those strings are
    displayed on screen as subtitles, so remove them.
    """
    return "\n".join(
        ln for ln in _SEG_HEADER_RE.sub("", body).split("\n") if ln.strip()
    ).strip()
```

### 29.1.3 The two contaminations overlap but do not coincide

Here comes the fact deciding this whole chapter. Organize the measurement result and it is this.

| Cue | Copies | Header contamination |
|---|---|---|
| cue 1 (0–4) | 1 | none — the first piece's header becomes the file header |
| cue 2 (5–9) | 2 | **only one side** (the copy seg000 carried) |
| cue 3 (10–14) | 2 | **only one side** (the copy seg001 carried) |
| cue 4 (15–19) | 2 | **only one side** (the copy seg002 carried) |
| cue 5 (20–24) | 1 | **present** (being seg003's last cue it ate seg004's header) |
| cue 6 (25–29) | 1 | none |

- The duplicated cues are 3, the contaminated cues are 4. **The sets differ.**
- Cue 5 is contaminated but not a duplicate → deduplication alone and `WEBVTT` appears on screen.
- Cues 2·3·4 have **only one copy** contaminated → compare the body without cleaning and, being the same cue, the
  bodies look different.

The last line leads directly to §29.3.4's order problem. First, organize where this duplication comes from.

---

## 29.2 The principle — this is not a bug but the spec

### 29.2.1 A piece must be self-contained

An HLS segment **must hold up whichever one you start playback from.** The reasons are three.

| Situation | Why it starts from the middle |
|---|---|
| **seek** | the user moves the progress bar to 12 minutes and receives from the piece at that time |
| **bitrate switch** | ABR changes the quality and joins from another rendition's middle piece (Chapter 2) |
| **LIVE join** | a viewer entering the live stream now receives from the back pieces of the playlist |

> **Term** — **self-contained segment**: a piece that can be decoded·displayed on its own without receiving prior
> segments. On the video side, making each segment start with a keyframe corresponds to this property
> (`tests/run.sh:40`'s `-g 60 -keyint_min 60 -sc_threshold 0` enforces it).

The same demand applies to subtitles. If playback started from the 12-minute point and the subtitle that should
be on screen at that instant is **a cue that started at 11 minutes 58 seconds**, that cue must be inside the
12-minute piece. If not, the user passes that line with no subtitle.

RFC 8216 §3.5 requires each WebVTT media segment to hold the cues that should be displayed in that segment's time
interval, and a boundary-straddling cue must be displayed in both intervals so **as a result it is carried on
both sides.** This repository's code wrote this as "permits."

```python
# subtitles.py:259-268
def dedupe(path: Path, fmt: str) -> tuple[int, int]:
    """Tidy the concatenated subtitle — remove fragment headers + remove boundary-duplicate cues.

    The HLS spec permits putting an interval-straddling cue on both adjacent segments,
    and actual deliveries go out that way. ffmpeg only concatenates the pieces, so leave it
    and the same subtitle is carried twice and even the fragment header mixes into the body.
    Delegate the merge but take responsibility for this post-processing here.

    Returns: (removed duplicate-cue count, count of cues that had a header mixed in)
    """
```

The difference of "permits" and "requires" is large in practice — permits means there are deliveries that do not
do it, requires means all deliveries do. **But the receiving code must be written the same either way.** Assume a
duplicate may come, and if it does not come do nothing. Conversely, code assuming "it does not come" gives a wrong
result the moment it comes. (That the spec's own text could not be cross-checked is written in §29.8.)

### 29.2.2 Why can the deliverer not remove it

There is a natural question — if the duplicate is a problem, can the deliverer not remove it.

**It cannot remove it.** Because the deliverer does not know from which piece the viewer will start playback.
Remove the cue from piece 001 and "a viewer who started from piece 001" does not see that subtitle, and remove it
from piece 000 and "a viewer who watched from the start" does not see it. Whichever you remove, it is wrong for
some viewer.

Here the structure is revealed.

> **The side that can remove the duplicate is only the side that has the whole, and the side that has the whole is
> only the receiver.**

The deliverer must make each piece **independently**, and at the price a duplicate arises at the boundary. Only
this repository's tool, which receives the whole and returns it to one file, is in a position to say "this cue is
the one seen earlier."

### 29.2.3 This is at-least-once delivery

The same structure is exactly in distributed systems' message delivery.

> **Term** — **at-most-once delivery**: a message is delivered 0 or 1 times. No duplicate but it can be lost. The
> fire-and-forget way belongs here.
>
> **Term** — **at-least-once delivery**: a message is delivered 1 or more times. No loss but a duplicate can
> arise. It is the way of resending if no acknowledgment (ack) comes.
>
> **Term** — **exactly-once delivery**: a message is delivered exactly 1 time. Neither loss nor duplicate.
>
> **Term** — **idempotency**: the property that performing the same operation two or more times gives the same
> result as performing it once. It applies to state change the same concept as Chapter 7 §7.2.4's `f(f(x)) =
> f(x)`.

The correspondence is no coincidence.

| Distributed system | This chapter's subtitle | Basis |
|---|---|---|
| producer | subtitle packager | makes and emits messages |
| message | one cue | the delivery unit |
| delivery channel | segment · HTTP | permits duplicates |
| consumer | `dedupe` | must filter duplicates itself |
| idempotency key | `(start, end, cleaned body)` | the basis for judging the same as the same |
| the "already-seen key" store | `seen: set[...]` | [`subtitles.py:276`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L276) |

The core proposition is the same too.

> **In at-least-once delivery the deliverer permits duplicates and the receiver secures idempotency itself.**

### 29.2.4 Why is exactly-once generally close to impossible

The question "if the duplicate is a problem, can you not send exactly once" has a well-known answer.

> **Term** — **Two Generals' Problem**: the impossibility result that two participants communicating only over an
> unreliable channel cannot reach **common knowledge** about some fact. Send a message and you need an ack to know
> the other received it, and to know that ack arrived you need another ack, and this chain does not end.

When the sender does not get a response, the choice it faces is only two.

| Choice | If what actually happened is "message loss" | If what actually happened is "response loss" |
|---|---|---|
| resend | right — it filled the loss | **a duplicate arises** |
| do not resend | **it ends lost** | right |

**The sender cannot distinguish the two situations.** What is observed is only "there is no response," and that is
compatible with both causes. So it becomes a problem of choosing one of loss and duplicate, and the two names
`at-most-once` and `at-least-once` are exactly that choice.

What systems written as "supports exactly-once" in practice actually provide is **not exactly-once delivery but an
exactly-once processing effect.** The composition is always the same.

```
at-least-once delivery  +  idempotency on the receiving side  =  exactly-once processing effect
```

The delivery itself still gives duplicates. The side that makes the duplicate **not affect the result** is the
receiver. Attaching a unique ID to a message and the receiver remembering the already-processed ID, that is
exactly the same device as `dedupe`'s `seen` set.

### 29.2.5 What form of at-least-once is HLS

There is one thing to distinguish precisely. A message queue's duplicate is **after the fact** — the result of
resending because no ack came. An HLS subtitle's duplicate is **preemptive** — it is put on both sides from the
start even with no failure.

| | Message queue | HLS subtitle piece |
|---|---|---|
| When the duplicate arises | after a failure (ack loss) | unconditionally at packaging time |
| Duplicate multiplier | variable by retry count | number of pieces the cue straddles = deterministic |
| Why it duplicates | to prevent loss | **because it does not know from which piece to start** |
| Receiver requirement | idempotency | **idempotency — identical** |

The mechanism differs and **the demand imposed on the receiver is the same.** So this chapter uses distributed-
system principles as-is while covering subtitle handling.

The duplicate multiplier grows the shorter the piece. With cue length *L*, piece length *S*, viewing the piece
boundary as placed independently of the cue, **the expected number of boundaries one cue crosses is about *L/S***,
and the number of pieces a cue is carried in is one more than that. If *L* exceeds *2S* one cue is **necessarily**
carried in three or more pieces. If a LIVE delivery sets pieces to 2 seconds and a subtitle cue is 4 seconds, the
same cue comes in **two or three copies.**

This code handles that case too — if the same key appears three times it removes two. The measurement of putting
in 3 copies and running.

```
3 copies → dedupe returns (removed=2, leaked=0),  1 cue left
```

(The *L/S* above is an estimate under the assumption that boundaries are placed uniformly. This repository's
fixture is a deterministic layout with cue interval fixed at 5 seconds, so in fact 3 of the 6 cues straddled.)

---

## 29.3 The code — the design of the deduplication key

### 29.3.1 The triple key

The whole verdict is one line.

```python
# subtitles.py:301
        key = (round(bounds[0], 3), round(bounds[1], 3), body)
```

A `(start time, end time, cleaned body)` triple key. Confirm the basis for choosing these three one by one.

### 29.3.2 Why can it be neither time alone nor body alone

Duplicate judgment is a classifier so there are two directions of error.

> **Term** — **false positive**: judging two different cues as the same. The result is **the subtitle vanishes.**
>
> **Term** — **false negative**: judging the same cue as different. The result is **the subtitle appears twice.**

It is the same balance problem as Chapter 22's threshold design, and here the two errors' costs are asymmetric —
a vanished subtitle cannot be recovered, and a subtitle appearing twice is just unsightly. So **the false positive
is weighed more heavily.**

Weigh the two errors per key candidate and the reason for adoption comes out. The table's **false-positive column
is confirmed with actual input** — the two measurements below are the basis (not implementing an alternative key,
but putting into the current code the cue pairs that would have merged had it been that key and confirming they
**do not merge**).

| Key candidate | False positive (the subtitle vanishes) | False negative (appears twice) |
|---|---|---|
| start time only | **occurs** — two speaker lines appearing at the same time merge into one | none |
| body only | **occurs** — repeated short lines (`네.`, `…`) all into one line | none |
| (start, end) | **occurs** — two different cues of the same interval merge | none |
| **(start, end, body)** ← adopted | only for different cues where the time and body are **both** the same | misses if the time is off even by 1ms |

Two measurements.

```
two simultaneous lines  00:00:01.000 --> 00:00:04.000 「— 안녕」
                        00:00:01.000 --> 00:00:04.000 「— 그래」
                        → dedupe (removed=0),  2 cues kept        ← had it been caught by time only, one vanishes

repeated line           00:00:01.000 --> 00:00:02.000 「네.」
                        00:00:09.000 --> 00:00:10.000 「네.」
                        → dedupe (removed=0),  2 cues kept        ← had it been caught by body only, one vanishes
```

All three fields are needed. Remove even one and a false positive arises, and a false positive is the subtitle's
loss.

### 29.3.3 Why round to 3 places — and the benefit could not be measured

The 3 in `round(bounds[0], 3)` is **milliseconds.** Since the time resolution WebVTT and SubRip express is exactly
milliseconds, it matched the key's precision to the original's precision.

The intent is clear — the same cue can come out with a subtly different time per piece, and use the floating-point
value as the key as-is and that difference becomes the key's difference as-is. The code parsing the time is this.

```python
# subtitles.py:248-256
def _cue_bounds(line: str) -> tuple[float, float] | None:
    m = _CUE_RE.search(line)
    if not m:
        return None
    sh, sm, ss, sms, eh, em, es, ems = m.groups()
    return (
        int(sh or 0) * 3600 + int(sm) * 60 + int(ss) + int(sms) / 1000,
        int(eh or 0) * 3600 + int(em) * 60 + int(es) + int(ems) / 1000,
    )
```

Here there is something to write honestly. **A case where this rounding actually rescued something could not be
measured in this repository.**

- `_CUE_RE` takes the time field as `(\d{3})` so **a value more precise than milliseconds cannot come in in the
  first place.** Parsing is deterministic so the same string becomes the same floating-point value.
- The case of different notation — `hh:mm:ss.mmm` and `mm:ss.mmm` are both valid and ffmpeg's webvtt muxer
  actually uses the latter (§29.1.2's `00:05.000`). Whether the parse result is bit-for-bit the same when the two
  notations point at the same time was cross-checked on 200,000 cases — **0 mismatches.**
- The case where the rounding changes the value does exist. `00:00:07.137` parses as `7.1370000000000005` (78 of
  324,000 cases have `round(v, 3) != v`). But **if both copies are the same string, both become the same value**
  so the verdict result does not change.

Then why keep it. The basis is of the same form as Chapter 15 §15.7.

1. **Match the key's precision to the original's precision.** A floating-point number carries 15 significant
   digits the original did not have. Comparing at that precision is **comparing with information the original
   does not have.**
2. **It is a defense against a future transform.** An actual delivery carries a different `X-TIMESTAMP-MAP` value
   per piece (§29.1.2's fixture fixed it to the same value). If the packager re-computes the cue time per-piece and
   emits, the same cue can become two values off by a millisecond. In that case the 3-place rounding is **still
   insufficient** (§29.8) but removes only the floating-point residue.

**Rounding does not make a tolerance.** This distinction matters. Measured.

```
00:00:05.000 --> 00:00:09.000  「same subtitle」
00:00:05.001 --> 00:00:09.000  「same subtitle」
→ dedupe (removed=0),  2 cues kept
```

**Off by 1ms and deduplication fails.** Rounding only fixes the precision and does not do an approximate
comparison. Change it to an approximate comparison and false positives rise — that is a design this code did not
choose, and why is generalized in §29.6.2.

### 29.3.4 The order — this chapter's core

Now the main argument. The inside of `dedupe`'s loop is this.

```python
# subtitles.py:282-306
    for block in blocks:
        lines = block.split("\n")
        # SubRip has a serial number as the block's first line — discard it since we renumber on rewrite.
        if fmt == "srt" and lines and lines[0].strip().isdigit():
            lines = lines[1:]
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            preserved.append(block)
            continue
        bounds = _cue_bounds(lines[idx])
        if bounds is None:
            preserved.append(block)
            continue
        raw_body = "\n".join(lines[idx + 1 :]).strip()
        # Clean the header before the duplicate judgment. If the contaminated side and the clean side's bodies
        # look different, the same cue is not caught as a duplicate.
        body = _clean_body(raw_body)
        if body != raw_body:
            leaked += 1
        key = (round(bounds[0], 3), round(bounds[1], 3), body)
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        kept.append((bounds[0], bounds[1], lines[idx].strip(), body))
```

The two comment lines ([`subtitles.py:296-297`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L296-L297)) already wrote this chapter's proposition into the code. **The cleaning is
before the verdict.**

§29.1.3's table gives the reason. Cue 2's two copies are contaminated **on only one side.** Compare the body
without cleaning and it is this.

```
copy A (seg000)  body = "한국어 자막 2번\nWEBVTT\nX-TIMESTAMP-MAP=LOCAL:…"
copy B (seg001)  body = "한국어 자막 2번"
                        ↑ the strings differ → a different key → not a duplicate
```

I made a version with only the order reversed and ran it on the same input. Nothing else was changed by a
character, only the key was set with `raw_body` and the cleaning moved to later.

| Version | `removed` | `leaked` | Result-file cue count | Does a header remain in the result file |
|---|---|---|---|---|
| **clean → judge** (current code) | **3** | 4 | **6** | none remains |
| judge → clean (reversed version) | **0** | 4 | **9** | none remains |

![A figure comparing the processing order with two copies of the same cue](/images/lecture/hls-recon/29-order-dependency.svg)

*Figure 29-2 — reverse the order of cleaning and judgment and the same cue gets a different key*

The last column tells this failure's nature. **The reversed version too cleans the header cleanly.** It just does
the cleaning later but does it. So open the result file and it looks fine, and only **the fact that there are 9
cues** is the signal that it is wrong.

> **A failure of the reversed order of normalization and comparison does not change the result's appearance.
> So it is not caught by the eye and caught only by a counting check.**

It is also worth noting that the cleaned body **is used both as the key and as the stored value**
(`kept.append(... , body)`). Since one cleaning serves both roles, whether the surviving copy is the contaminated
side or the clean side, the stored body is the same. Keep the order and there is not even a need to weigh "which
copy survives."

### 29.3.5 The preservation of non-cue blocks

A block with no `-->` or that fails time parsing is not discarded but moved to `preserved` ([`subtitles.py:288-294`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L288-L294)).
WebVTT's `NOTE` (comment)·`STYLE` (style rule)·`REGION` (region definition) blocks fall here.

On rewrite these blocks are placed **right after the header, before the first cue.**

```python
# subtitles.py:311-321
    kept.sort(key=lambda c: (c[0], c[1]))
    out: list[str] = []
    if fmt == "vtt":
        out.append(header or "WEBVTT")
        out += preserved
        for _, _, timing, body in kept:
            out.append(f"{timing}\n{body}")
    else:
        for n, (_, _, timing, body) in enumerate(kept, 1):
            out.append(f"{n}\n{timing}\n{body}")
    path.write_text("\n\n".join(out) + "\n", encoding="utf-8")
```

The position is no coincidence. The WebVTT spec requires `STYLE` and `REGION` blocks to come **before the first
cue.** Had it tried to preserve the original position as-is, it could rather have violated the spec. Measured.

```
input:  WEBVTT / NOTE block / STYLE block / (a cue with an id) / two duplicate cues
output: WEBVTT / NOTE block / STYLE block / cues              ← NOTE·STYLE preserved, 1 duplicate removed
```

The same measurement also confirmed **what is lost.** The cue identifier (a name tag placed right before the
timing line) vanishes. Because it writes nothing of the line before `lines[idx]`. On the other hand, cue settings
attached to the timing line (`line:90%`, etc.) are preserved since the whole line is moved as-is. `sort` too looks
at only `(start, end)` so it is a stable sort keeping the original order.

### 29.3.6 If there is nothing to change, do not write the file

```python
# subtitles.py:308-309
    if not (removed or leaked):
        return 0, 0
```

If there is neither duplicate nor contamination it **returns without rewriting the file.** Because a
harmless-looking rewrite actually changes the file — the blocks are sorted, the SubRip numbers are renumbered, the
`preserved` blocks move to the front, and the line endings are normalized.

This is a decision of the same lineage as §29.3.4. **Do not touch when there is no reason to touch, and a touched
file is always a file there was a reason to touch.** Then the "3 boundary-duplicate cues removed" printed in the
report ([`report.py:401-404`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L401-L404)) corresponds one-to-one with what actually happened.

### 29.3.7 Do not apply it to a finished file

The same principle is on the sidecar path too.

```python
# subtitles.py:453-455
    A received file is a finished copy so dedupe/shift are not applied — those two are problems that arise
    only in a product concatenated from pieces. The original bytes must be left as-is to compare with the result
    of fetching the same URL by hand. A converted copy is made separately only when the request format differs from the original.
```

A boundary duplicate is a **product of chopping**, not a property of the subtitle. When one finished `.srt` file
was received, there is no reason for a duplicate, and if there is one it is because the original is so, so removing
it makes it differ from the original. The regression test fixes this property by byte comparison
(`tests/run.sh:272-274`, including even the BOM and CRLF).

> **Idempotency-securing is applied only to a path where duplicates arise. Apply it to a path where they do not
> arise and it is not normalization but tampering.**

---

## 29.4 What breaks if you do not do this

Reverse each decision so far and you see what each was blocking.

| If you reverse | What breaks | How it surfaces |
|---|---|---|
| **move the cleaning after the verdict** | a one-sided-contaminated copy gets a different key → not a single duplicate is removed | the file looks clean and **only the cue count is 9** (measured) |
| **do not clean at all** | `WEBVTT` · `X-TIMESTAMP-MAP=…` appears on screen as subtitles | visible right away on playback — cue 5 is not even a duplicate so deduplication does not catch it |
| **do not deduplicate** | the same subtitle is displayed twice | cue count 9, two lines in the overlapping interval |
| **remove the body from the key** | two speaker lines of the same interval merge into one | **the subtitle vanishes** — unrecoverable |
| **remove the time from the key** | repeated short lines all merge into one line | same |
| **remove the rounding** | no difference in the current observed range | §29.3.3 — **not measured** in this repository |
| **half-open → closed interval** | a cue ending at the boundary is carried on both sides | one more duplicate (cue 5) — it is removed but the piece grows |
| **rewrite even with nothing to change** | a file that need not be touched is normalized | comparison with the original becomes impossible |
| **apply it to a finished file too** | the original bytes change | cannot compare with a hand-fetched result (`tests/run.sh:272-274`) |

The most dangerous is the **two rows removing a field from the key.** The rest are unsightly or noisy failures —
the subtitle appears twice or the text `WEBVTT` appears on screen — and you know right away on seeing. Those two,
by contrast, make **the subtitle quietly vanish, and a vanished subtitle is not recovered without the original.**

---

## 29.5 Verification — what the test fixes

### 29.5.1 Two independent checks

```bash
# tests/run.sh:225-229
# The original is 6 cues per track. If boundary duplicates remain it becomes 9 cues.
kocues=$(grep -c -- '-->' "$WORK/out/subs.ko.vtt" || true)
[[ "$kocues" -eq 6 ]] && ok "boundary duplicates removed (6 cues)" || bad "cue count is not 6: $kocues"
grep -q 'WEBVTT' <(tail -n +2 "$WORK/out/subs.ko.vtt") \
  && bad "fragment header remains in the body" || ok "fragment header cleaned"
```

Two lines look at different things.

| Check | What it looks at | In the order-reversed version |
|---|---|---|
| cue count `== 6` | were the duplicates removed | **fail (9)** |
| no `WEBVTT` after line 2 | was the header cleaned | pass |

**The reversed version breaks only one of the two checks.** Had there been only the header check, it would forever
have failed to catch the order error, and had there been only the cue-count check, it would have missed cue 5's
contamination (a contamination not caught by deduplication since it is not a duplicate). The two checks **cannot
be a proxy metric for each other.**

Skipping the first line with `tail -n +2` is essential too. A normal file's line 1 is the file header `WEBVTT`, so
without skipping this check **always fails.**

### 29.5.2 First fix whether the defect is actually injected

Chapter 34's oracle problem catches here too — if the duplicate was not made in the first place, "6 cues" proves
nothing. So a comment is attached to the fixture-generation code.

```bash
# tests/run.sh:69-71
# The subtitle track. Since ffmpeg's HLS muxer cannot segment WebVTT,
# make it directly in the exact form an actual CDN emits. You must reproduce even putting a straddling cue
# on both pieces for boundary-duplicate removal to actually be verified.
```

"You must reproduce even putting a straddling cue on both pieces" is the core. Had it only chopped and not put in
boundary duplicates, `dedupe`'s `removed` is always 0 and the code under `if key in seen` is **never executed.**
And yet the cue-count check passes, so that pass proves nothing about deduplication.

### 29.5.3 Also fix whether the two paths ride the same function

Subtitles are made by two paths — the normal path receiving with the video, and the `--refill-subs` path leaving
the video and filling only subtitles. Both go through `cli._extract_subs` into `subtitles.extract` → `dedupe`
([`cli.py:611`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L611), [`cli.py:765`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L765)).

The test fixes the same value on the filling path too.

```bash
# tests/run.sh:464-466
fillcues=$(grep -c -- '-->' "$FILL/메움03.ko.vtt" 2>/dev/null || true)
[[ "$fillcues" -eq 6 ]] \
  && ok "filled subtitle also has boundary duplicates cleaned (6 cues)" || bad "filled subtitle cue count is not 6: $fillcues"
```

Fixing the same number in two places is not duplication. **When a path diverges the post-processing tends to
diverge, and the moment it diverges only one side's subtitle quietly keeps duplicates.** The README wrote the same
reason — "the receiving path and the filling path use the same extraction function so the subtitle filled later is
never subtly off" (`README.md:135-136`).

### 29.5.4 The report emits the number outward

```python
# report.py:400-404
                fixes = []
                if (dups := sum(r.duplicates for r in good)):
                    fixes.append(f"{dups} boundary-duplicate cues removed")
                if (leaks := sum(r.header_leaks for r in good)):
                    fixes.append(f"{leaks} body-mixed fragment headers cleaned")
```

The reason `dedupe` returns two values `(removed, leaked)` is here. **How many the post-processing fixed must be
observable.** If a nonzero value keeps coming you can know what form that delivery has, and if it suddenly becomes
0, something in the pipeline changed. Post-processing that fixes quietly and passes quietly means **no one knows
even when it stops next time.**

---

## 29.6 Generalization — the design of the idempotency key determines the accuracy

### 29.6.1 Where the same structure appears

Spots where a duplicate arises and the receiver must filter it are everywhere. What is decisive in each row is one
thing — **what goes into the key.**

> **Term** — **idempotency key**: an identifier attached to a request to tie the retries of the same operation
> into one. If the receiver already processed the same key it does not perform it again and returns the earlier
> result.

| Domain | Why a duplicate arises | Key | If what is in the key is **too little** (false positive) | If it is **too much** (false negative) |
|---|---|---|---|---|
| message queue | redelivery after ack loss | message ID · sequence number | swallows a different message | processes the same message twice |
| payment API | client retry | `Idempotency-Key` header | a different payment is ignored | **double payment** |
| HTTP cache | — | normalized request URI + `Vary` | **cache poisoning** | cache miss (Chapter 7) |
| package install | re-run | (name, version, hash) | sees a different output as the same | re-fetches every time |
| inventory | re-run | (work title, episode) | skips someone else's episode | re-fetches 27 episodes every time (Chapter 37) |
| authentication nonce | replay attack | nonce · JWT `jti` | a normal request is rejected | **the replay attack holds** (§29.7) |
| **subtitle cue (this chapter)** | the spec permits (effectively requires) boundary duplicates | (start, end, cleaned body) | **the subtitle vanishes** | the subtitle appears twice |

That the two errors' costs flip oppositely per domain matters. In payment the false negative (double payment) is
fatal, and in subtitles the false positive (loss) is fatal. **Which way to lean is a domain judgment to make
before the key design**, not a technical optimization.

### 29.6.2 The strength of normalization is wrong in two directions

Before making the key you **normalize** the value. Its strength decides the error direction.

| Normalization strength | Example | Result |
|---|---|---|
| none | the original bytes as-is | even a trivial difference is a different key → duplicates remain |
| just right | remove fragment headers, fix milliseconds | this code's choice |
| excessive | remove whitespace·punctuation, approximate time comparison | different cues merge → loss |

Chapter 31 §31.7 shows the same axis in Unicode — NFC is just right and NFKC is excessive. NFKC flattens the
fullwidth solidus `／` to ASCII `/` and **makes a path separator that was not there.** The more strongly you
normalize, the wider the range judged "the same," and the wider it is, the more things that were originally
different get mixed.

This code's normalization targets **exactly one contamination source** (the fragment header). `_SEG_HEADER_RE`
deletes only lines starting with `WEBVTT` and lines starting with `X-TIMESTAMP-MAP=`, and otherwise does only
whitespace tidying (`strip`). If there is a line really written `WEBVTT` in the subtitle body it will be deleted,
but that is written in §29.8.

### 29.6.3 The third case — the same proposition as Chapters 7·31

This chapter's order dependency is the third appearance of the same form in this course.

| Chapter | Transform (normalization) | Comparison (verdict) | If you reverse the order |
|---|---|---|---|
| **Chapter 7** | percent encoding·decoding | path verification · cache-key comparison | a value that passed verification becomes a forbidden value after the transform → **CWE-180** |
| **Chapter 31** | Unicode normalization (NFC/NFKC) | file identification · name comparison | two names that look the same become different items, or different names the same item |
| **Chapter 29** (this chapter) | fragment-header cleaning | duplicate-cue judgment | the same cue gets a different key and the duplicate is not removed |

Write the proposition the three chapters share in one sentence and it is this.

> **A value that is the object of comparison must be normalized before comparison.
> If the order of normalization and comparison is off, even if the normalization itself is performed exactly, the
> comparison is wrong.**

The latter sentence is the core. §29.3.4's reversed version **performs the cleaning exactly.** Not a single header
remains in the result file. What is wrong is not the cleaning but the one fact **that the cleaning was later than
the comparison**, and that one thing collapses the whole verdict.

Chapter 7 calls this by the CWE name.

> **Term** — **CWE-180 (Incorrect Behavior Order: Validate Before Canonicalize)**: the wrong order performing
> validation before canonicalization. It points at the class of defects where a value validation passed becomes a
> forbidden value after canonicalization.

This chapter's case is a **non-security edition** of CWE-180. The verdict is duplicate-or-not, not access-allow,
but the structure is completely the same. And the moment the verdict target changes to access-allow, the same code
becomes a vulnerability — that is the next section.

Chapter 7 §7.5.5's prescription transfers as-is too.

> **Better to make the order impossible to get wrong than to require the order be kept.**

That this code sticks the cleaning and judgment together as four consecutive lines inside one function, `dedupe`
([`subtitles.py:298-301`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L298-L301)), is that form. Had the cleaning been split as a separate step and left to the caller, one of
the callers necessarily gets the order wrong.

---

## 29.7 Security — when the duplicate judgment is a security judgment

### 29.7.1 Replay attack — same structure, different verdict

This chapter's `seen` set is a device judging "have I seen this before." When the same judgment is used in
authentication the name changes.

> **Term** — **replay attack**: an attack where the attacker intercepts a normally-exchanged message and resends
> it as-is. There is no need to forge the message content and the signature is valid too, so the defense depends
> entirely on the judgment "have I seen this message before."

> **Term** — **nonce (number used once)**: a value set to be used only once. It blocks a replay attack by the
> receiver remembering the already-seen nonce and refusing reuse.

Set the correspondence side by side and it is astonishingly the same.

| | This chapter (`dedupe`) | Replay-attack defense |
|---|---|---|
| Judgment | have I already seen this cue | have I already seen this message |
| Key | (start, end, cleaned body) | nonce · JWT `jti` · (timestamp, signature) |
| Store | `seen: set[...]` | nonce store · used-token list |
| False positive | the subtitle vanishes | **a normal user is rejected** |
| False negative | the subtitle appears twice | **the attack holds** |

On the last two rows the cost flips. In subtitles the false positive is fatal, and in replay defense the false
negative is fatal. So a nonce store is designed to **normalize narrowly and reject widely** — reject if even
slightly suspicious.

**And §29.6.3's order proposition catches here as-is.** If the normalization when storing the nonce and when
looking it up differs, the replay defense is disabled. Store lowercased and look up with the original, and a nonce
with an uppercase mixed in is forever not found in the store. It means the same nonce can be reused infinitely.
This is not a hypothetical scenario but **the standard consequence when a normalization-comparison order defect is
placed on the authentication path**, of the same family as the double-encoding bypass Chapter 7 covered.

### 29.7.2 The reverse direction — when the key is too wide

Over-normalize the key and different things merge into one. In subtitles it is only one cue vanishing, but put the
same structure on an identifier and the result differs.

| Spot | Excessive normalization | Result |
|---|---|---|
| account identifier | Unicode compatibility normalization · case folding | a different user is judged the same account (Chapter 31 §31.7) |
| file path | verification omitted after path canonicalization | a different file is judged the same file (Chapter 7 §7.5) |
| duplicate-request judgment | field removed from the body hash | different requests are swallowed as a "retry" |

**A wide key erases data.** The reason this chapter's code does not do an approximate time comparison is here —
give a 1ms tolerance and you erase "two different cues starting 1ms apart." Whether such cues exist in reality
could not be confirmed in this repository, and the judgment here is **not to choose the data-erasing side on the
basis of the unconfirmed.**

### 29.7.3 This code's undefended spots

Written honestly.

**① There is no size cap.** `dedupe` loads the whole file into memory ([`subtitles.py:269`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L269)), makes all blocks a
list, and puts **every unique cue's body string** into the `seen` set. There is no cap anywhere. A maliciously
made subtitle track (millions of unique cues) eats that much memory. It is of the same class as Chapter 6's
unlimited `gzip.decompress`, and undefended for the same reason — the threat model stands on trusting "the URL the
user specified." Only, **"the user specified" is not "trusts that server."** If used to run a URL list in an
automation pipeline, this assumption does not hold.

**② It moves a remote `STYLE` block without checking.** As confirmed in §29.3.5, a `preserved` block enters the
output file as-is without looking at the content. A `STYLE` block is CSS, and that CSS is **set by the
deliverer.** This repository's threat model presupposes a local player (ffmpeg · mpv · VLC) so it did not view
this as a problem. But if the use is to feed the output `.vtt` to a web player as-is, it is **bringing remote CSS
inside the trust boundary**, and that judgment this code did not make. Compared with the principle Chapter 13 set
for packed JS — "parse but do not execute remote code" — here it neither parses nor executes and **moves it
as-is.** The tool itself does not execute the subtitle so it is safe within the tool, but the property that **what
was moved goes to the next consumer as-is** remains.

**③ If any line of the body starts with `WEBVTT` that line is deleted whole.** `_SEG_HEADER_RE` is
`^[ \t]*(?:WEBVTT.*|X-TIMESTAMP-MAP=.*)$` so it looks at only the **line head.** Measured.

```
'WEBVTT 규격이 뭐죠?'      → ''                    ← the line vanishes whole
'아니 WEBVTT 말이야'       → '아니 WEBVTT 말이야'   ← if not at the line head it remains
```

The probability is just low, not blocked in principle. This is a **residual false positive that always remains
when a filter judges by form and not content**, a cost this repository accepted. To remove it you would need a
context-seeing judgment like "attached to the end of the previous cue and immediately followed by an
`X-TIMESTAMP-MAP=` line," and then the rule is more strongly tied to ffmpeg's output form.

### 29.7.4 The defender's view

| Role | What to do |
|---|---|
| **API designer** | let the client set the idempotency key (`Idempotency-Key`), and the server stores·looks up **after normalizing.** state the normalization rule in the doc — do not and each client normalizes differently |
| **message-system operator** | put at-least-once as the default assumption and require idempotency of the consumer. the sentence "the broker gives exactly-once" is not a basis until you confirm **exactly-once of what** (delivery or processing) |
| **authentication implementer** | make the nonce · `jti` ride **the same function for the store-time and look-up-time transform.** put a normalization code at each of the two spots and one day they diverge — gather into one function and put a test that breaks when it diverges |
| **auditor** | at a spot where there is deduplication, ask the **key's field list.** a field not in the key is a declaration "I will treat it the same even if that field differs." confirm that declaration is intended |
| **library user** | if you left normalization to a library, confirm **when that library normalizes.** if it is not in the doc whether the comparison function normalizes internally or the caller must do it in advance, settle that first by experiment |
| **this tool's implementer** | leave the order of normalization and judgment **in a code comment** ([`subtitles.py:296-297`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L296-L297)), and put a check that breaks only when the order is reversed in the regression test. with only a comment and no test, the next refactoring changes the order |

The last row is this chapter's practical conclusion. **An order dependency cannot be kept by a comment.** Because
reversing the order makes the same-looking result, it is not caught in code review either. What catches it is
**only a counting check.**

---

## 29.8 Limits and open questions

Written honestly.

- **The spec's own text could not be cross-checked.** §29.2.1's RFC 8216 §3.5 narrative and §29.3.5's "`STYLE`·
  `REGION` must come before the first cue" WebVTT-spec narrative are both a transcription of the clause's gist, and
  the literal text was not cross-checked (this repository has no spec text). The difference between the code
  comment writing "permits" and the spec possibly being closer to "requires" could not be settled either. Only the
  point **that the receiving implementation does not change** is the buffer for this uncertainty.
- **The benefit of the 3-place rounding could not be measured.** In all three experiments of §29.3.3 the rounding
  did not change the verdict result. Whether the same cue goes off by a millisecond in an actual delivery carrying
  a different `X-TIMESTAMP-MAP` per piece **could not be confirmed** — this repository's fixture puts the same
  `MPEGTS` value in every piece (`tests/run.sh:101`). It is the same form as the state Chapter 15 calls "incidental
  defense," and the basis for keeping it nonetheless is written in §29.3.3.
- **Off by 1ms and deduplication fails (measured).** If the above item's scenario is real, this code does not
  catch that duplicate. Rounding only fixes the precision and gives no tolerance, so the real response is an
  approximate comparison and that births a false-positive cost. **Neither is free and currently the false-negative
  side is chosen.**
- **The cue identifier vanishes (measured).** The name tag before the timing line is discarded on rewrite. A
  subtitle styling an individual cue with WebVTT's `::cue(#id)` selector loses that link. Cue settings on the
  timing line are preserved so the practical impact is limited — **it was judged so but not measured.**
- **In SubRip non-cue blocks are discarded (measured).** The `fmt == "srt"` rewrite branch does not emit
  `preserved` ([`subtitles.py:318-320`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L318-L320)). SubRip has no `NOTE` concept so it is mostly right, but a non-cue block that was
  in the original quietly vanishes.
- **The `NOTE` block's original position vanishes.** All `preserved` blocks gather before the first cue. For
  `STYLE`·`REGION` it is a spec-correct position, but `NOTE` can originally come anywhere, so a comment placed
  beside a specific cue loses its context.
- **Different cues where both the time and body are the same merge into one.** Two cues differing only in the cue
  setting (like showing the same line in two regions at once) are so. I have never met such a configuration in an
  actual delivery, but **"never seen" is not "does not exist."**
- **Observed on one ffmpeg version.** §29.1.2's concatenation result is ffmpeg 8.1.1's behavior. If another version
  handles fragment headers differently (e.g. filters them itself), `leaked` becomes 0, and then §29.3.4's order
  problem itself is not observed. **The unobserved and the nonexistent are different** — code that keeps the order
  is right either way.
- **§29.2.5's *L/S* is an estimate.** It is a value under the assumption that piece boundaries are uniformly
  distributed independently of the cue, not measured on an actual subtitle track. The fixture is a deterministic
  layout so 3 of the 6 cues straddled.

---

## 29.9 Summary

1. In HLS subtitles **a boundary-straddling cue is carried on both of the two adjacent pieces.** Because that cue
   must be visible whichever piece you start playback from, it is not the deliverer's bug but a result the piece's
   self-containment requires. Measured: **6 unique cues become 9 cues in the piece total.**

2. **The side that can remove the duplicate is only the receiver that has the whole.** The deliverer cannot remove
   it since it does not know from which piece the viewer starts. This is the structure of **at-least-once
   delivery**, where the deliverer permits duplicates and the receiver secures **idempotency.**

3. **Exactly-once delivery is generally close to impossible.** When no response comes the sender cannot
   distinguish "message loss" from "response loss" (the Two Generals' Problem). Practical "exactly-once" is the
   composition `at-least-once delivery + receiver-side idempotency = exactly-once processing effect`.

4. The deduplication key is a **(start, end, cleaned body) triple key.** Remove even one of the three and a false
   positive arises, and in this domain a false positive is the **subtitle's loss.** Use time only and two speaker
   lines appearing at once merge, use body only and repeated short lines merge (both measured).

5. **The fragment-header cleaning must be done before the duplicate judgment.** Since only one copy is
   contaminated, reverse the order and the same cue gets a different key. Measured on a version with only the order
   reversed: **0 removed, 9 cues.** And yet the header is cleaned later so **the result file looks clean** — not
   caught by the eye, caught only by a counting check.

6. The regression test puts **two checks separately** (`tests/run.sh:225-229`). The order-reversed version breaks
   only the cue-count check and passes the header check. One cannot be a proxy metric for the other.

7. Generalized it is this — **the idempotency key's design determines the accuracy, and the order of normalization
   and comparison changes the result.** It is the third case of the same proposition as Chapter 7 (URL
   normalization)·Chapter 31 (Unicode normalization), and the moment the verdict target changes to access-allow it
   becomes CWE-180 as-is.

8. Put the same judgment on authentication and it becomes **replay-attack defense.** Only the error costs flip —
   in subtitles the false positive (loss) is fatal, and in replay defense the false negative (attack holds) is
   fatal. **Which way to lean is a domain judgment before the key design.**

9. This code has three undefended spots — no input size cap, moving a remote `STYLE` block without checking, and a
   body line starting with `WEBVTT` being deleted. All are written in §29.7.3.

---

**Next chapter** — this chapter's post-processing was code filling "what ffmpeg does not do." Where the division
of labor of delegating the merge and doing the deduplication itself came from, and how the same division repeats
in `X-TIMESTAMP-MAP` alignment — ffmpeg does not apply that mapping when opening a subtitle playlist as a
standalone input. Chapter 30 covers why **knowing what the delegated side does not do** is a harder problem than
the delegation itself.
