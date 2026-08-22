---
title: "Self-Synchronizing Formats and the Algebra of Concatenation"
description: "Why you can just join the bytes"
date: 2026-07-02
version: '1.0'
tags: ['streaming', 'binary']
thumbnail: /images/lecture/thumb/hls-recon-19-self-synchronizing.svg
---
## 19.0 What this chapter answers

1. When you merge dozens of downloaded segments into one file, why does just joining the bytes work?
2. What format property makes that "joining" produce a spec-valid result?
3. fMP4, which is not self-synchronizing, is handled the same way — what must you place in front?
4. What problem remains after aligning the bytes (the time axis), and how does the code fill it?

---

## 19.1 The problem — merging the pieces into one

The back half of the pipeline (Chapter 0 §0.2) sounds simple. Dozens·hundreds of segments were downloaded and
put on disk, so now merge them into one file. The merging code is `concat_segments` alone in this repository, and
in fact this is all of it.

```python
# assemble.py:93-105
def concat_segments(paths: Iterable[Path], raw_out: Path) -> int:
    """Join the downloaded segments byte by byte.

    MPEG-TS is a self-synchronizing format so a simple concatenation is spec-valid, and
    fMP4 holds the same if the caller puts the init segment (EXT-X-MAP) at the front of the list.
    """
    total = 0
    with raw_out.open("wb") as fh:
        for p in paths:
            data = p.read_bytes()
            fh.write(data)
            total += len(data)
    return total
```

It just opens the files in order and appends with `fh.write(data)`. In shell it is the one line `cat seg*.ts >
joined.ts`. **No parsing, no boundary adjustment, no header rewrite.**

Stop here and ask. Why does this work. Because it does not work in most file formats. `cat` two WAV files
together and only the first plays; join two MP4s and the second is treated as data and vanishes. Join two PNGs
and you do not get one bigger PNG. And yet MPEG-TS works. **The same `cat` produces a valid result in one format
and garbage in another.** That difference is this chapter's subject.

`concat_segments` being 13 lines is not because the code is well-written but **because the format does the work
instead.** Without that property, a merger that parses segments and re-weaves them would have to sit here. A
format's mathematical property determines the tool's complexity — this chapter is the cleanest case of that
proposition.

---

## 19.2 The principle — self-synchronization and closure under concatenation

### 19.2.1 What is a self-synchronizing format

> **Term** — **self-synchronizing format**: a format in which a receiver who started reading at an arbitrary
> point in the stream and lost the frame boundary can **recover the correct boundary by itself after consuming
> only a finite number of bytes.** For this property to hold, boundary information must be embedded locally
> throughout the stream, not in a global header at the stream's head.

MPEG-TS (MPEG-2 Transport Stream) gets this property from a **fixed-period sync byte.**

> **Term** — **sync byte**: the fixed value `0x47` that comes at the head of every 188-byte packet of MPEG-TS. In
> this repository it is nailed down as constants — `PACKET_SIZE = 188`, `SYNC_BYTE = 0x47` ([`tsanalyze.py:12-13`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L12-L13)).

Even if a receiver breaks into the middle of the stream, if it finds the position where `0x47` **repeats at
188-byte intervals**, that point is a packet boundary. Turning on broadcast TV mid-program and the picture still
locks, and even if a few packets are lost in transit what follows continues fine — all of this is this property.
TS is a broadcast-era format designed **to be joinable anywhere**, and HLS inherited that property as-is.

### 19.2.2 It is closed under concatenation

The consequence of self-synchronization is this chapter's core proposition. Let `V` be the set of valid TS
streams.

> **Proposition** — if `a ∈ V` and `b ∈ V`, then `a ++ b ∈ V`. (`++` is byte concatenation)
> That is, **`V` is closed under concatenation.**

The result of joining two valid TS is again a valid TS. This property is the whole justification of
`concat_segments`. If segments `s₁, s₂, …, sₙ` are each valid TS, then the joined `s₁ ++ s₂ ++ … ++ sₙ` is also
valid TS, so the loop's repeated `fh.write` makes exactly a spec-conforming stream.

![Join two valid TS and you get valid TS again](/images/lecture/hls-recon/19-concat-closure.svg)

*Figure 19-1 — closure under concatenation. Since each packet is a 188-byte self-contained unit, the seam lands exactly on a packet boundary and the decoder meets the next `0x47` right there.*

### 19.2.3 Why it holds — there is no global invariant

The reason closure holds is the flip side of self-synchronization. **TS has no global structure describing "the
whole stream."** Each 188-byte packet is an independent unit carrying its own header (PID·continuity counter·
payload-start flag), and **an invariant nailing down the whole at the head** — like "this stream's total length
is N" or "there is an index at offset K" — **does not exist.**

Formats where concatenation breaks are exactly the opposite — they have a global invariant that joining
violates.

| Format | Global invariant | If you join |
|---|---|---|
| WAV (RIFF) | bytes 4–7 declare the whole file size | the declared size covers only the first file so the second is wholly ignored (a lenient parser misreads the second's RIFF header as PCM samples) |
| single MP4 | the `moov` box describes all sample offsets | the second file's boxes are treated as data after the first file and vanish |
| PNG | the `IEND` chunk marks the end, each chunk has a CRC | everything after `IEND` is trailing garbage — not one bigger PNG |
| ZIP | the central directory at the file's end holds head-relative offsets | the offsets go off and the second directory breaks |
| **MPEG-TS** | **none — only 188-byte local framing** | **stays valid TS** |

Only the last row is closed. And the reason is exactly the same as what the four rows above lack (**the absence
of a global invariant**). In exchange for localizing boundaries to be self-synchronizing, TS gave up global
structure, and because it gave up global structure, concatenation can violate nothing.

One more thing. If a segment comes cut to a non-multiple of 188, alignment can go off at the seam. Even so,
**self-synchronization confines the damage locally** — the decoder re-finds the next `0x47` at the 188-period
and resyncs, so a cut segment does not wreck even the decoding of the segment **after** it. This alignment
breakage itself is measured separately (`tsanalyze.py`'s `sync_errors`, Chapter 17). Closure guarantees not a
"perfect seam" but "damage does not spread."

---

## 19.3 The code — why `concat_segments` is 13 lines

### 19.3.1 The only container work done directly, not delegated

This repository's reassembly layer has one principle.

```python
# assemble.py:1-6
"""Reassembly layer — all actual container work is delegated to ffmpeg.

Segment merging·decryption·timestamp normalization are already implemented per spec
by ffmpeg's hls/mpegts demuxer, so they are not rebuilt here. This module's responsibility
is only "with what arguments to delegate" and "how to measure progress."
"""
```

Everything that touches the container is handed to ffmpeg. And yet `concat_segments` alone does it **directly**,
as an exception. This is no contradiction — **byte concatenation is work that needs no understanding of the
container.** That it can just join with no parsing or rewriting is guaranteed by §19.2's closure. So this one
line alone has no reason to be delegated.

Had TS not been closed, what would have come here. A **merger** that parses each segment's header, renumbers
continuity counters, joins PES boundaries, and re-orders timestamps — that is, the delegation principle would
have broken and it would amount to reimplementing ffmpeg's mpegts muxer. One algebraic property, closure, ties
this function to 13 lines.

### 19.3.2 Operational evidence of closure — `sniff`'s period check

§19.2.1's property, "`0x47` repeats at the 188-period," is not an abstract claim but a condition the code
actually checks. The container-determination function looks at exactly this period.

```python
# tsanalyze.py:30-34
    # TS repeats a sync byte every 188 bytes, so check up to the second packet.
    if data[0] == SYNC_BYTE and (
        len(data) < PACKET_SIZE + 1 or data[PACKET_SIZE] == SYNC_BYTE
    ):
        return "mpegts"
```

If the leading byte is `0x47` **and `0x47` is 188 bytes later** too, it is judged TS. The reason it does not look
at just one byte is to exclude a chance match — the probability an arbitrary byte string starts with `0x47` is
1/256, but the probability it is also `0x47` 188 bytes later falls to 1/65536.

The "periodic sync byte" this check confirms is exactly the substance of self-synchronization and the premise of
§19.2.2's closure. That when two segments are joined the next segment's first `0x47` lands exactly on the
boundary — that is the same thing as the property `sniff` checks.

### 19.3.3 The joined result is passed to muxing

The raw (`joined.ts`) `concat_segments` made is immediately losslessly muxed into the final container.

```python
# cli.py:473-476
    _eprint(f"  [3/3] reassemble → {out}")
    raw = work / f"joined{ext}"
    assemble.concat_segments(paths, raw)
    mux_cmd = assemble.remux_local(raw, out, subs=embed)
```

Byte concatenation (`concat_segments`) and container muxing (`remux_local`) are two separate stages. The former
is done directly thanks to closure, the latter is delegated. Why this division of labor is needed is revealed in
§19.5 — because concatenation aligns the bytes but does not align the time axis too.

---

## 19.4 fMP4 — giving the same property to a non-self-synchronizing format

### 19.4.1 fMP4 is not closed

An HLS segment is not always MPEG-TS. A considerable share of recent streams use **fMP4 (fragmented MP4).**

> **Term** — **fMP4 (fragmented MP4)**: a form of ISO-BMFF (ISO Base Media File Format, the MP4 family) divided
> into fragments. Each media segment consists of a `moof` (movie fragment) box and an `mdat` (media data) box.
> This repository handles it with the extension `.m4s` ([`cli.py:450`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L450)).

An fMP4 segment has no sync byte. Instead of the 188-period `0x47` it is framed by box structure (TLV, Chapter
20), and `sniff` determines this by the box type at offset 4–8 ([`tsanalyze.py:16-17`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L16-L17)'s `_MP4_BOXES` =
`ftyp`·`styp`·`moof`·… ). **fMP4 is not self-synchronizing.** There is no local signal to recover the boundary at
an arbitrary point.

Moreover, **decoding itself is impossible** with the media segment (`moof`+`mdat`) alone. Because initialization
info like the codec configuration, track composition, and sample description is not in the segment but in **a
separate initialization segment.**

> **Term** — **init segment / `EXT-X-MAP`**: a segment holding the fMP4 stream's decoding context
> (`ftyp`+`moov`). It has no media data, only codec·track configuration. In an HLS playlist it is pointed to by
> the `#EXT-X-MAP:URI="init.mp4"` tag.

This repository's parser reads this tag as follows.

```python
# playlist.py:318-325
        elif line.startswith("#EXT-X-MAP:"):
            a = _parse_attrs(line.split(":", 1)[1])
            uri = a.get("URI", "")
            rng = None
            if "BYTERANGE" in a:
                n, _, o = a["BYTERANGE"].partition("@")
                rng = (int(n), int(o or 0))
            pl.init_map = (_absolute(base_url, uri), rng)
```

And if `init_map` exists, that playlist is judged fMP4.

```python
# playlist.py:168-170
    @property
    def is_fmp4(self) -> bool:
        return self.init_map is not None
```

### 19.4.2 Put init in front and closure is recovered

fMP4 itself is not closed, but with one operation §19.2's property can be revived. It is **placing the
initialization segment once at the very front.**

> `init ++ seg₁ ++ seg₂ ++ … ++ segₙ` is a valid fMP4 stream.

init sets up the decoding context, and when the `moof`+`mdat` fragments follow after it the whole becomes one
continuous fragmented MP4. This is exactly the design CMAF·DASH intended — segments are independently
transmittable·joinable, but **only with the context prefix called init.** This prefix is **not the identity** of
the algebraic structure seen in §19.6 — unlike the empty byte string, the identity, its absence makes the rest
invalid.

The code makes exactly this order. It receives init **before** the segment loop runs and puts it at the front of
`paths`.

```python
# cli.py:441-450
    if pl.init_map:
        init_uri, init_range = pl.init_map
        init = fetcher.get(init_uri, init_range)
        if not init.ok:
            raise SystemExit(f"init segment (EXT-X-MAP) receive failed: {init.error}")
        ipath = work / "init.mp4"
        ipath.write_bytes(init.body)
        paths.append(ipath)

    ext = ".m4s" if pl.is_fmp4 else ".ts"
```

Since `paths.append(ipath)` runs before the segment loop ([`cli.py:452-468`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L452-L468)), `init.mp4` becomes element 0 of
`paths` and `concat_segments` records it first. **The reason the code puts init at the front is exactly §19.4.2's
closure-recovery condition.**

![Put the init segment at the front and fMP4 too merges by concatenation](/images/lecture/hls-recon/19-fmp4-init-prefix.svg)

*Figure 19-2 — fMP4's closure recovery. The `moof`+`mdat` fragments alone have no decoding context so they do not merge, but put init holding `ftyp`+`moov` once at the front of `paths` and the whole becomes valid fMP4.*

### 19.4.3 If you omit init

What happens if you ignore `EXT-X-MAP` and join only the `.m4s` fragments. The result stream has no
`ftyp`·`moov` so **no decoder can compose the tracks** — `moof` has no `trak` to reference, and the samples have
no known codec. The bytes joined but it cannot play. Conversely, forcing init in front of a TS stream (there is
none anyway) means nothing. **The condition for closure to hold differs per format** — TS unconditionally, fMP4
conditionally on placing one prefix.

This is why this repository does not quietly pass over an `EXT-X-MAP` receive failure but aborts with
`SystemExit` ([`cli.py:444-445`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L444-L445)). Without init, no matter how well the rest is received the result does not hold,
so a partial success does not exist.

---

## 19.5 Concatenation aligns the bytes but not the time axis

### 19.5.1 The remaining problem — PTS gaps

§19.2's closure guarantees the **byte structure** is valid. But playback needs more than the byte structure —
the **presentation time (PTS)** must be continuous at the seam.

> **Term** — **PTS (Presentation Time Stamp)**: a time value specifying when to put a frame out on screen. In
> MPEG-TS it rides in the PES (Packetized Elementary Stream) header and attaches only to the head of an access
> unit (frame), not every packet. It is an absolute value on a 90kHz clock (detailed in Chapter 21).

The problem is **that PTS does not attach to every PES packet.** If near a seam, or at the stream head, the first
PES header has no PTS or only a DTS (decoding time), the joined raw cannot know that point's presentation time.
The bytes are valid but a hole opens in the timeline.

### 19.5.2 The code — `-fflags +genpts`

`remux_local` gives a flag to correct this gap when muxing the joined raw.

```python
# assemble.py:119-123
    cmd = [
        require("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
        "-fflags", "+genpts",  # correct the PTS gap at segment junctions
        "-i", str(raw),
    ]
```

> **Term** — **`genpts` (generate PTS)**: an ffmpeg input flag. Its documented behavior is "if there is a DTS,
> generate the missing PTS." That is, when the presentation time is empty and only the decoding time exists, it
> synthesizes and fills the PTS from the frame interval.

Without this flag, a muxer meeting a frame with no PTS at the junction can leave that stretch's time empty or
fill it with an off value, producing **jumping playback time.** `+genpts` fills that blank on a DTS basis and
smooths the seam. **Closure aligns the bytes, and `genpts` fills the time-axis gap left on top of it** — the
reason the two stages divide the labor (§19.3.3).

One thing to distinguish honestly. `remux_from_url` (the default path handing the playlist to ffmpeg directly)
has no `+genpts` ([`assemble.py:81-88`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L81-L88)). Because on that path ffmpeg's hls demuxer handles the segment boundaries and
timestamps per spec directly, so no separate correction is needed. `+genpts` is needed **only when we re-open a
raw we joined ourselves** — that is, the very existence of this flag is a marker that "direct concatenation comes
with time-axis correction as a cleanup step."

---

## 19.6 Generalization — a format's algebraic property determines the tool's complexity

### 19.6.1 Concatenation seen as a monoid

The whole of byte strings forms a **monoid** under the concatenation operation `++`.

> **Term** — **monoid**: an algebraic structure of a set and a binary operation satisfying (1) **associativity**
> `(a++b)++c = a++(b++c)` and (2) an **identity** `e` (here the empty byte string) with `e++a = a++e = a`.

The set `V` of "valid TS streams" is a **submonoid** of this monoid — it is closed under `++` (§19.2.2) and
contains the identity (the empty stream). These two properties actually work in the code.

| Monoid law | What it does in `concat_segments` |
|---|---|
| **closure** | the concatenation of valid segments is valid again — a spec-conforming result by `write` alone with no parsing |
| **associativity** | even appending **one at a time** as `((s₁++s₂)++s₃)…` equals joining the whole at once → streaming writes are justified |
| **identity** | even skipping an empty/missing segment (`e`) does not damage neighbors → a partial loss stays local |

Associativity is especially quietly important. The loop appends segments **one by one**, and what guarantees this
equals joining the whole at once is associativity. Had it been a format where the seam depends on the grouping,
streaming writes themselves would not have held.

### 19.6.2 Three classes of format and the merger's complexity

Divide formats by their concatenation property and what the tool must do is set.

| Class | Example | Merge method | Tool complexity |
|---|---|---|---|
| **unconditionally closed** | MPEG-TS, MP3 (sync word per frame), ADTS AAC | byte concatenation | one line of `cat` |
| **conditionally closed** | fMP4/CMAF (needs the init prefix) | one prefix + byte concatenation | a few lines putting the prefix at the front |
| **not closed** | WAV, single MP4, PNG, ZIP | reconstruct after parsing | a merger that understands the container |

`concat_segments` being 13 lines, the few lines attached to put `EXT-X-MAP` at the front, and the merger that
would have been needed had it been a non-closed format — the difference of these three comes entirely from **the
format's algebraic property.** From here comes this chapter's general proposition.

> **A format's (or data structure's) mathematical property determines the complexity of the tool that handles
> it. If the set of valid streams is closed under concatenation the merge is one line, and if not closed you must
> use a parser–reconstructor.**

This proposition repeats outside streaming too. When joining logs (a line-oriented append-only log is closed),
in chunked transfer, in append-only databases — the answer to the question **"is it valid after joining"** sets
the volume of that system's merge·replicate·recovery code.

---

## 19.7 Security — the flip side of closure: forgery·insertion·smuggling

Closure is both a convenience and an attack surface. **Because being closed under concatenation means that
inserting any valid fragment into any valid stream still yields "valid."** This property makes two sides of the
threat model.

### 19.7.1 The surrender of global integrity

The "absence of a global invariant" seen in §19.2.3 reads, from the verification view, like this — **TS has no
structure sealing the whole stream.** Since a declaration like "this stream is N packets and its hash is H" is
not inside the container, **the fact that the bytes are a valid TS alone cannot tell you a fragment was not
inserted·deleted·replaced.** Because an inserted fragment is also a valid TS.

This repository's only **in-band** integrity signal is the continuity counter.

> **Term** — **continuity counter**: a 4-bit field of the TS packet header. It cycles 0–15 per PID and increments
> by 1 for each packet carrying payload. A skipped value is a packet-loss signal (Chapters 17·18).

But this signal, being 4 bits, **cannot detect a loss·insertion of exactly a multiple of 16** (quantified in
Chapter 18). That is, the "structural validity" closure gave and the "content integrity" the continuity counter
gives are **claims at different layers**, and the latter is incomplete in principle. If you want real
tamper-proofing, integrity must come from a **layer above** the container — things like a signed manifest,
per-segment hashes, authenticated encryption. This course does not cover bypassing a particular protection system
(§0.1), and what is noted here is **the principle of the threat model** — do not mistake the container's
structural validity for authenticity.

### 19.7.2 Smuggling and polyglots

Self-synchronization + closure is also the soil for **data smuggling.** Since the decoder skips the leading bytes
until it finds the first `0x47` alignment, putting other data at the stream's front or in an unaligned gap keeps
playback intact.

> **Term** — **polyglot file**: a file where one byte string is simultaneously validly interpreted in two or more
> formats. For instance a file that is a valid TS and at the same time parses as something else. The very bytes a
> content checker judged "this is video" can be something entirely different to another parser.

This connects to Chapter 14 (segment extension masquerade) — there the name and declaration diverged from the
content, and here **one content is interpreted as two.** The commonality is that "what these bytes are" is not
determined uniquely. And what makes reaching this multi-interpretation possible is closure, "a valid fragment is
valid wherever you attach it."

### 19.7.3 The defender's view

| Role | What to do |
|---|---|
| **stream·CDN operator** | do not use "the bytes parse as valid TS" as an integrity check. secure segment integrity at a layer above the container with **per-segment hashes in a signed manifest** or authenticated encryption. structural validity ≠ authenticity |
| **player·decoder implementer** | self-synchronization is a **guarantee the decoder will eat arbitrary bytes.** treat mid-stream PMT/PAT changes, sudden PID shifts, and alignment breaks as suspect signals, and harden the parser to withstand malicious packets (the lesson of Chapter 15's CVE-2023-6602 — a demuxer is an attack surface) |
| **verification-tool author (this code)** | thanks to closure the concatenation is one line, but do not conclude "valid TS = complete·authentic." design the verdict presupposing the continuity counter is an **incomplete in-band signal** with a known miss (multiples of 16) |
| **security auditor** | audit self-synchronizing·concatenation-closed formats presupposing they have **no built-in tamper-proofing.** if a path needs integrity, confirm which layer outside the container it comes from, and if none, record that absence as a defect |

The core is one. **Closure surrenders the integrity guarantee by the very property that made the tool simple.**
The property that made `concat_segments` 13 lines and the property that makes it structurally unable to stop
insertion·smuggling are **one and the same.** That convenience and attack surface are not two separate facts but
two faces of one property is the gist of this chapter's security section.

---

## 19.8 Limits and open questions

Written honestly.

- **Did not measure `genpts`'s concrete firing condition.** §19.5 narrated on the basis of the code comment's
  stated intent ("correct the PTS gap at junctions") and ffmpeg's documented behavior ("generate PTS if there is
  a DTS"). Which seam in this repository actually makes a PTS gap was not separately measured by defect
  injection — I note that it is a narrative based on inference.
- **Could not verify the closure proposition's spec-strict condition by code.** "The concatenation of two valid
  TS is always valid" follows from the property of local framing, but whether **every** decoder plays a seam
  straddling a discontinuity·PCR reset·PMT version change identically depends on the format spec and decoder
  implementation, and here it was confirmed with only one implementation, ffmpeg.
- **`sniff` knows only two containers.** A segment format other than MPEG-TS and ISO-BMFF (e.g. packetized raw
  AAC audio) falls to `unknown`. Such a format's closure property is not handled by this code, so this chapter's
  classification table (§19.6.2) also lists it as general knowledge, not measurement.
- **The premise that segments are each valid.** Closure is a property about **valid** fragments. If cut·damaged
  segments are mixed in, seam alignment breaks (§19.2.3), and detecting that is the job not of closure but of a
  separate measurement (`sync_errors`·continuity counter). This chapter covers "can be merged" and does not
  guarantee "the merged thing is intact" — the latter is the subject of Chapters 17·18·21.

---

## 19.9 Summary

1. `concat_segments`, which merges segments into one, is **13 lines that just join the bytes.** In most formats
   this method produces garbage, but in MPEG-TS it produces a valid result.
2. That difference comes from **self-synchronization.** TS localized framing with the 188-period sync byte
   `0x47`, and in exchange gave up the global invariant. Since there is no global invariant, **concatenation can
   violate nothing** — the set of valid TS is **closed under concatenation.**
3. fMP4 is not self-synchronizing so it is not closed, but **put the init segment (`EXT-X-MAP`) once at the
   front** and the same property is recovered. This is why the code puts `init.mp4` at element 0 of `paths`
   ([`cli.py:441-448`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L441-L448)).
4. Concatenation aligns the **bytes** but does not align the **time axis** too. `remux_local` corrects the seam's
   PTS gap with `-fflags +genpts` — the division of labor of closure and time-axis correction.
5. The set of valid streams is a **submonoid** under the concatenation operation. Closure·associativity·identity
   each work in the code as "parsing-free merge," "the justification of streaming writes," and "the localization
   of partial loss." **A format's algebraic property determines the tool's complexity.**
6. Closure is both a convenience and an attack surface. **The very property that made `concat_segments` 13 lines
   makes it structurally unable to stop insertion·smuggling.** If you need integrity it must come from a layer
   above the container (signature·hash), and structural validity must not be mistaken for authenticity.

---

**Next chapter** — this chapter mentioned fMP4 segments only as `moof`+`mdat` boxes and passed on. That box
structure is a **recursive TLV (Type-Length-Value)**, and using that property you can judge whether a file is
structurally intact **without reading a single byte of the body (`mdat`).** Chapter 20 reads [`inventory.py:67-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L67-L102),
which checks completeness by whether the sum of box boundaries matches the file size, and covers "how to judge
intactness without reading the content."
