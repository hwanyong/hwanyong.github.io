---
title: "ISO-BMFF: Recursive TLV Structure and the Structural-Completeness Check"
description: "How to judge intactness without reading the body"
date: 2026-07-04
version: '1.0'
tags: ['streaming', 'binary']
thumbnail: /images/lecture/thumb/hls-recon-20-isobmff-structural.svg
---
## 20.0 What this chapter answers

1. Can you judge whether a file was "written to the end" without opening it?
2. What container property makes that possible?
3. What breaks if you omit something when implementing that judgment?
4. What becomes a vulnerability when you point the same code at untrusted input?

The fourth question is this chapter's summit. This repository's checker was written targeting **accidents
(interrupted muxing)**, and yet that code happens to satisfy a good many of the conditions a parser targeting
**malice (a crafted file)** must keep. Sorting out how far it is coincidence and where design begins is this
chapter's work.

---

## 20.1 The problem — a truncated file passes as finished

### 20.1.1 Observation

While receiving a 27-episode series the laptop lost power in the middle of episode 20. Run it again. The tool
sweeps the folder and judges "skip episodes already present." Episode 20's file **is on disk.** It is even about
400 MB in size. But play it and the last 40% is missing.

This repository's module comment recorded this situation exactly.

```python
# inventory.py:13-15
- **A truncated file passes as finished.** `_discard` cleans up only the SystemExit·Ctrl-C paths.
  A fragment left by a forced kill·power cut·disk-full is read on the next run as
  'already present' and is **never recovered.** We look not just at whether it exists but whether it is intact.
```

"Never" is no exaggeration. `_discard` ([`cli.py:688`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L688)) is called only on the normal interruption paths (`cli.py:919,924`),
and never reaches a `SIGKILL`·power cut·disk-full. The leftover fragment is read as "present" on the next run,
and the run after that, and ever after. **No one knows until the user plays episode 20 themselves.**

### 20.1.2 The cost asymmetry of the verdict

This verdict's price differs entirely by the direction of the error.

| Error | What happens | Does the user notice | Recovery |
|---|---|---|---|
| **false positive** (normal as damaged) | re-receives 27 fine episodes every time | immediately — bandwidth and time are visible | automatic (re-receive gets the same file) |
| **false negative** (damaged as normal) | the broken episode stays there permanently | **not until they play it** | none — the tool never touches it again |

The two errors' costs are not symmetric. And yet there is a reason you must not tighten the check only in the
direction of reducing misses — because the cost of tightening is billed every run.

```python
# inventory.py:17-19
Whether it is intact, we check by default only what can be confirmed cheaply. Opening 27 files with ffprobe
every time makes the re-run slow, so the benefit of 'receive only what is missing' disappears. Actually
opening them is requested separately with `--verify-existing`.
```

Measure and the difference in cost is revealed. For one 20-second 5 MB MP4:

| Check | Time | What it does |
|---|---|---|
| structural check (default) | **0.06 ms** | opens the file and reads 4 box heads |
| `--verify-existing` (deep) | **29 ms** | spawns an `ffprobe` process and actually opens it |

**About 480×.** And this ratio widens as the file grows — the structural check's cost is independent of file
size (§20.2.4), and `ffprobe` is not.

### 20.1.3 So the question stands like this

> **Without reading a single byte of the file body, can you judge "was this file written to the end"?**

In general it is of course impossible. An arbitrary byte string has no information saying "here should be the
end." It becomes possible **only when the container explicitly wrote that information down.** ISO-BMFF writes it
down. This is the whole principle of this chapter.

---

## 20.2 The principle — length-prefixed framing and recursive TLV

### 20.2.1 Terms

Chapter 19 mentioned fMP4 segments only as `moof`+`mdat` **boxes** and passed on. That box is this, and this
chapter opens its structure. The subject is not a segment but a finished file after muxing, but **the form is
the same.**

> **Term** — **ISO-BMFF (ISO base media file format)**: the media container format ISO/IEC 14496-12 defines. MP4
> (`.mp4`·`.m4v`), fMP4 segments (`.m4s`), and HEIF images are all derivatives of this format, and QuickTime
> (`.mov`) is the archetype this format came from. The whole file consists of a sequence of a single unit called
> a **box.**

> **Term** — **box**: ISO-BMFF's sole structural unit. It consists of a head declaring the size and kind, and a
> body after it, and a box can go inside the body again. QuickTime-family documents call the same thing an
> **atom.** (This repository's own comments call it a box in Korean; they are rendered in English in the code
> quotations below.)

> **Term** — **TLV (Type-Length-Value)**: an encoding convention wrapping data into three cells «type · length ·
> value». If a TLV goes inside the value again it is **recursive TLV.** ISO-BMFF is a TLV variant whose order is
> «length · type · value».

> **Term** — **muxing (multiplexing)**: the work of weaving separately encoded video·audio·subtitle streams into
> one container file. In this repository `ffmpeg -c copy` handles it (`assemble.py`).

### 20.2.2 The box head is 8 bytes, only there are two reserved values

The head is **4 bytes of size + 4 bytes of type.** The size is the byte count of the whole box including the
head, and the type is four ASCII letters (`ftyp`·`moov`·`mdat`·`free`, etc.). Only, the size field has two
reserved values used not as a value but as a **signal.**

![The three forms of an ISO-BMFF box head](/images/lecture/hls-recon/20-box-header.svg)

*Figure 20-1 — the three forms of an ISO-BMFF box head*

| Size-field value | Meaning | Actual head length | Why needed |
|---|---|---|---|
| `n ≥ 8` | this box is `n` bytes | 8 | the ordinary case |
| `1` | the next 8 bytes are the real size (64-bit largesize) | **16** | 32 bits cannot write an `mdat` exceeding 4 GiB |
| `0` | this box goes **to the end of the file** | 8 | when writing starts without knowing the size (streaming muxing) |

`0` and `1` are not sizes. And yet they sit in the value's slot. **Read these two as numbers without branching
and they become "a size smaller than 8," i.e. an impossible value, and a normal file is judged damaged.** This
is a spot this chapter returns to repeatedly.

> **Term** — **big-endian (network byte order)**: the way of storing a multi-byte number from the most
> significant byte first. Every multi-byte field of ISO-BMFF is in this order. Since x86·ARM's default order is
> the opposite (little-endian), it **must be specified explicitly** — read a 32-byte `ftyp` box as little-endian
> and it becomes `0x20000000` = 536,870,912 bytes, so from the very first box it runs past the file's end.

### 20.2.3 The core property — the top-level boxes cover the file exactly

Here the verdict basis comes out. **The file's top-level boxes cover the whole file with no gap and no overlap.**
There can be no undefined bytes between boxes (if there were, they too would have to be a box), and boxes cannot
overlap each other. That is, the following identity holds.

```
Σ(top-level box sizes) == file size
```

Start at the first box's offset 0 and repeat skipping by the declared size, and **in a normal file the cursor
arrives exactly at the file's end.** If it cannot arrive, or overruns, that file is not intact.

![The property that top-level boxes cover the file, and the detection of truncation](/images/lecture/hls-recon/20-boundary-sum.svg)

*Figure 20-2 — the property that top-level boxes cover the file, and the detection of truncation*

The reason this property holds is **that the length is declared before the body.**

> **Term** — **length-prefixed framing**: the way of marking boundaries by writing a data unit's length ahead of
> the data. On the other side there is the way of marking boundaries with a delimiter (text split by newlines),
> and the way of syncing at a fixed period with no boundary marker (MPEG-TS, Chapter 19).

A length declaration **tells you where its end is without reading the body.** Therefore whether the declared end
and the actual file end go off can also be known without reading the body. This is the answer to §20.1.3's
question.

### 20.2.4 The cost is proportional not to file size but to box count

Confirm by measurement. On a 514 MiB file (three boxes `ftyp` · `moov` · `mdat`), I measured this repository's
`_isobmff_flaw`.

| Item | Value |
|---|---|
| file size | 538,968,092 B (514 MiB) |
| `read()` calls | **3** |
| bytes actually read | **24 B** |
| ratio read from the file | 0.0000045 % |
| time (after warm-up) | **0.04 ms** |

Eight bytes of head per box, that is all. The rest is `seek`. An actual ffmpeg output file too has only four
top-level boxes.

```
$ (result of sweeping only the top level of the box list)
faststart : ftyp(32)  moov(18,306)  free(8)  mdat(5,050,513)
default   : ftyp(32)  free(8)  mdat(5,050,513)  moov(18,306)
```

**`mdat` is 99.6% of the file, and that 99.6% is not read by a single byte.** So this check's cost is nearly the
same whether the file is 5 MB or 5 GB. This is the basis for saying §20.1.2's 480× difference widens as the file
grows.

---

## 20.3 The code — the walk of `inventory.py`

### 20.3.1 Constants

```python
# inventory.py:34-45
# smaller than this and it cannot be video. cut off right as muxing starts and only a few KB of header remain.
MIN_BYTES = 64 * 1024

# ISO-BMFF box head = 4 bytes size + 4 bytes type.
_BOX_HEADER = 8

_ISOBMFF_EXTS = frozenset({".mp4", ".m4v", ".mov"})
_EBML_EXTS = frozenset({".mkv", ".webm"})

_EBML_MAGIC = b"\x1a\x45\xdf\xa3"
_TS_SYNC = 0x47
_TS_PACKET = 188
```

Note in advance that `_BOX_HEADER = 8` serves two roles in this file — the **number of bytes to read** and the
**smallest possible box size.** Later this second role comes to guarantee the loop's termination (§20.3.4).

### 20.3.2 The full text of the walk

```python
# inventory.py:67-102
def _isobmff_flaw(path: Path, size: int) -> str:
    """Check whether an MP4-family file was written to the end by sweeping only the top-level boxes.

    Made with `-movflags +faststart`, so a normal file has `moov` after `ftyp`.
    Cut off mid-muxing and `moov` is absent entirely, or the declared size runs past the file's end.
    The body (`mdat`) is skipped, not read, so it is fast however big the file — a seek per box is all.
    """
    seen: set[bytes] = set()
    with path.open("rb") as fh:
        offset = 0
        while offset < size:
            fh.seek(offset)
            head = fh.read(_BOX_HEADER)
            if len(head) < _BOX_HEADER:
                return "the box head is truncated — cut off before muxing finished"
            box_size, kind = struct.unpack(">I4s", head)
            if box_size == 1:  # a 64-bit largesize follows
                ext = fh.read(8)
                if len(ext) < 8:
                    return "the 64-bit box size is truncated — cut off before muxing finished"
                box_size = struct.unpack(">Q", ext)[0]
            elif box_size == 0:  # this box goes to the end of the file
                box_size = size - offset
            name = kind.decode("ascii", errors="replace")
            if box_size < _BOX_HEADER:
                return f"the box size is abnormal ({name}: {box_size})"
            if offset + box_size > size:
                return f"the {name} box goes past the end of the file — a truncated file"
            seen.add(kind)
            offset += box_size
    if b"moov" not in seen:
        return "no moov box — cut off before muxing finished"
    if b"mdat" not in seen:
        return "no mdat box — the content is empty"
    return ""
```

Thirty-six lines, and six checks.

| # | Check | What it catches |
|---|---|---|
| 1 | were all 8 head bytes read | fewer than 8 bytes left at the file's end |
| 2 | were all 8 `largesize` bytes read | cut off in the middle of a 64-bit head |
| 3 | is the size at least 8 | an impossible size — and the **loop's termination guarantee** (§20.3.4) |
| 4 | is the declared end inside the file | **a truncated file** — this chapter's main target |
| 5 | did we see `moov` | cut off before the metadata box was written |
| 6 | did we see `mdat` | the body is absent |

> **Term** — **`ftyp` · `moov` · `mdat`**: `ftyp` (File Type Box) declares which spec this file derives from.
> `moov` (Movie Box) holds the **whole metadata** — stream composition·timescale·sample position table, etc.
> `mdat` (Media Data Box) holds only the encoded **body byte string.** Without `moov` there is no way to
> interpret `mdat` — that is why check 5 holds.

### 20.3.3 The order of the checks is itself the correctness

The `box_size == 1` · `== 0` branch (lines 84–90) must come **before** the size-lower-bound check (lines 92–93).
Reverse the order and a normal file is judged damaged. Because the value meets the "less than 8" check while
still literally 0 or 1.

The result of synthesizing eight inputs and actually running them (all direct calls to `_isobmff_flaw`).

| Input | Verdict |
|---|---|
| normal · faststart (`ftyp` `moov` `mdat`) | **OK (intact)** |
| normal · default (`ftyp` `mdat` `moov`) | **OK (intact)** |
| `mdat` written with `size == 1` + largesize | **OK (intact)** |
| `mdat` written with `size == 0` (to end of file) | **OK (intact)** |
| `mdat` body cut by 4,000 B | `the mdat box goes past the end of the file — a truncated file` |
| `moov` removed entirely | `no moov box — cut off before muxing finished` |
| 5 bytes appended at the end | `the box head is truncated — cut off before muxing finished` |
| largesize tampered to `0` | `the box size is abnormal (mdat: 0)` |

The third·fourth rows are §20.2.2's two reserved values. **An implementation that omitted the branch gives on
these two rows «the box size is abnormal (mdat: 1)» and «(mdat: 0)».** Every normal video exceeding 4 GiB is
judged damaged, and the inventory says to re-receive everything on every run.

### 20.3.4 What guarantees termination is the size-lower-bound check

The table's last row is quietly important. On a file that wrote `largesize` as `0`, what happens if the
`box_size < _BOX_HEADER` check on lines 92–93 is absent.

```
box_size = 0  →  offset += 0  →  offset unchanged  →  it re-reads the same spot forever
```

**An infinite loop.** One file can halt the process permanently. The `elif box_size == 0` branch on line 89
fires **only when the original size field is 0**, so when a `largesize` was read and came out 0, that branch has
already been passed. That is, the last gate to filter this value out is line 92.

> **Term** — **progress guarantee**: the property that a loop necessarily advances its state forward each
> iteration. In a parser sweeping input by moving a cursor, «the cursor increases by at least 1 each iteration»
> is it, and without it you cannot prove termination.

Thanks to line 92, this code guarantees `box_size ≥ 8`, so the cursor increases by **at least 8** each
iteration. Therefore the iteration count is at most `file size / 8` and the loop necessarily ends. **The
size-lower-bound check looks like a value-validity check but is actually a termination proof.**

This is the first case in this chapter of "a condition satisfied by coincidence." The comment explains this
check only as «the box size is abnormal». The second role, the termination guarantee, is not written in the
code.

### 20.3.5 A set, not a list — what passes both faststart and default

`seen` is a `set[bytes]` (line 75). It records only the **presence** of a kind, not the **order.** This is
decisive.

> **Term** — **faststart**: an MP4 layout that moves the `moov` box in front of `mdat`. The player can get the
> metadata before receiving the whole file, enabling HTTP progressive playback. Since the size cannot be known
> in advance, a muxer usually writes `mdat` first and appends `moov` after, and `-movflags +faststart`
> **passes the file once more after muxing finishes and rearranges it.**

This repository turns on faststart when making `.mp4`·`.m4v`.

```python
# assemble.py:27-28
    ".mp4": ["-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"],
    ".m4v": ["-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"],
```

And `_isobmff_flaw`'s docstring wrote that premise — "a normal file has `moov` after `ftyp`" (line 70). **But the
code does not lean on that premise.** Because it does not check the order. The two measured layouts are these.

```
faststart : ftyp  moov  free  mdat      ← -movflags +faststart
default   : ftyp  free  mdat  moov      ← muxed without the option
```

Had the comment's sentence been transcribed into code as a check of «`moov` must be after `ftyp`», **every
normal MP4 the user made with another tool and put in the same folder would be judged damaged.** The inventory
re-receives that episode every time. And this false positive appears in the run log only as "n damaged," so no
one points to the order check as the cause.

**The comment wrote «what the files we make look like», and the code checks «what the spec permits».** The two
look off but they are not off — the code is wider on the correct side. And a test fixes that width (§20.4).

### 20.3.6 The verdict is layered — from the cheap check first

`_isobmff_flaw` is not used alone. Above it is `flaw()`, and it sets the order.

```python
# inventory.py:131-160 (excerpt)
    try:
        size = path.stat().st_size
    except OSError as e:
        return f"cannot read: {e}"
    if size < MIN_BYTES:
        return f"only {size:,}B — hard to call it video"

    ext = path.suffix.lower()
    try:
        if ext in _ISOBMFF_EXTS:
            why = _isobmff_flaw(path, size)
        elif ext in _EBML_EXTS:
            why = _head_flaw(path, _EBML_MAGIC, "EBML")
        elif ext == ".ts":
            why = _ts_flaw(path)
        else:
            why = ""
    except OSError as e:
        return f"failed while reading: {e}"
    if why:
        return why

    if deep:
        info = probe.probe(str(path))
        if not info.ok:
            tail = info.error.strip().splitlines()[-1][:120] if info.error else ""
            return f"ffprobe could not open it: {tail}"
        if info.duration <= 0:
            return "the play length is 0"
    return ""
```

| Layer | Cost | What it opens | What it catches |
|---|---|---|---|
| ① size lower bound (`MIN_BYTES`) | one `stat()` | opens nothing | 0-byte·few-KB fragments |
| ② structural check | box count × 8 B | the file heads only | **a truncated file** |
| ③ `deep` (`ffprobe`) | process spawn | actually attaches a decoder | structurally right but unplayable |

Cheapest first, and **when one layer gives a reason it stops there.** The regression test's 0-byte file
(`tests/run.sh:361`) does not even reach ② and is caught at ①.

There is one thing to note here. `flaw()` **picks the checker by the extension.** It is the very extension of
which Chapter 14 said "the extension guarantees nothing." Is it a contradiction?

No. **What the extension decides** is different (the criterion of Chapter 14 §14.7.2 and matrix M5). Here the
extension is a hint deciding **which check to run**, not the **verdict result**, and the consequence when wrong
differs too.

| Situation | Result | Direction |
|---|---|---|
| an MKV file named `.mp4` | the size goes off from the first box → «a truncated file» | **false positive** — re-receive (recoverable) |
| a normal MP4 named `.avi` | `else: why = ""` — no structural check | **false negative** — passes if only the size exceeds |

The second row is the actual hole. `.avi` is in `library.MEDIA_EXTS` so it becomes an inventory target but is in
none of `_ISOBMFF_EXTS`·`_EBML_EXTS`·`.ts`. Written again in §20.7.

### 20.3.7 Why do other containers not get the same check

```python
# inventory.py:105-121
def _head_flaw(path: Path, magic: bytes, what: str) -> str:
    """Look only at whether the leading few bytes match that container's signature."""
    with path.open("rb") as fh:
        if fh.read(len(magic)) != magic:
            return f"no {what} signature — the content is not that container"
    return ""


def _ts_flaw(path: Path) -> str:
    """MPEG-TS has a sync byte (0x47) every 188 bytes. Compare the two."""
    with path.open("rb") as fh:
        head = fh.read(_TS_PACKET + 1)
    if len(head) < _TS_PACKET + 1:
        return "could not fill even one packet"
    if head[0] != _TS_SYNC or head[_TS_PACKET] != _TS_SYNC:
        return "the MPEG-TS sync byte does not match"
    return ""
```

Both functions **look only at the head.** Only ISO-BMFF is walked; the rest just confirm the signature. Why so
asymmetric. The reason differs per container.

| Container | Framing | Can truncation be caught by structure | What this code does |
|---|---|---|---|
| **ISO-BMFF** | length-prefixed | **possible** — the sum of boundaries must match the file size | walk all top-level boxes |
| **EBML** (MKV·WebM) | length-prefixed (variable-length integer) | possible in principle | only the leading 4-byte signature |
| **MPEG-TS** | self-synchronizing (no length declaration) | **impossible** | only the first two packets' sync bytes |

MPEG-TS's «impossible» is interesting. TS is just a sequence of 188-byte fixed packets, so **a file cut at a
packet boundary is still structurally a complete TS stream.** There is simply no spot that says "here should be
the end." That self-synchronization Chapter 19 explained as the property that "you can just join the bytes"
returns here as the price of "cannot know it is cut." **Being closed under concatenation means being closed
under truncation too.**

EBML's case is different — it is possible in principle and this code just did not do it. That price is measured.

```
real.mkv (original)  → OK
cut real.mkv at 60%  → OK          ← not detected
                     → OK even with --verify-existing
```

The reason it passes even `--verify-existing` is interesting enough to write in §20.7. `ffprobe` reports for a
truncated MKV **exactly the same 20.023 seconds** as an intact file. Because it reads the declared length in the
header as-is. And `flaw()`'s deep check looks only at `duration <= 0`.

**The total length does not catch loss** — this course's starting point (Chapter 0 §0.1) appears once more at
the container-check layer.

---

## 20.4 What the test fixes

This verdict is nailed down **in both directions** by the regression test. The test's own comment writes the
reason.

```bash
# tests/run.sh:341-344
# ------------------------------------------------------------------- inventory
# The judgment that picks only the 'missing episodes' on the second run. Get it wrong here and the symptom
# splits the opposite way — too lenient and a broken file passes as finished so the episode is missing forever,
# too strict and 27 fine episodes are re-received every time. Fix both sides together.
```

The sample-generation part is this.

```bash
# tests/run.sh:349-362
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
```

And the assertion part (`tests/run.sh:399-410`) fixes six of them, each.

| Sample | How it is made | Expected | The wrong implementation this assertion would pass without it |
|---|---|---|---|
| `01.mp4` | `+faststart` | `ok=True` | — (control) |
| `02.mp4` | no option (`moov` after) | **`ok=True`** | **an implementation that checks box order** (§20.3.5) |
| `3.mp4` | episode notation `3` | `ok=True` | an implementation missing episode-number normalization |
| `04.mkv` | a different container | `ok=True` | an implementation seeing only an exact extension match |
| `05.mp4` | the front 60% of an intact file | **`ok=False`** | **an implementation with no structural check** (seeing only existence) |
| `06.mp4` | 0 bytes | **`ok=False`** | an implementation with no size lower bound |

The two bold rows correspond exactly to the two directions of §20.1.2's table. `02.mp4` prevents a **false
positive**, and `05.mp4` prevents a **false negative.** With only one side the test is powerless — a test fixing
only true positives passes «an implementation that always answers damaged», and a test fixing only false
positives passes «an implementation that always answers intact».

One added decision is in `scan()`. It is when the same episode exists twice with only the extension differing.

```python
# inventory.py:198-201
        # if the same episode exists twice with only the extension differing (received as .mp4 then re-received as .mkv)
        # keep the intact one. so as not to judge 'already present' on the basis of a damaged copy.
        if prev is None or (prev.flaw and not item.flaw):
            slot[number] = item
```

The structural verdict **is also used as an aggregation priority.** It is the spot where the verdict does not
end at a single boolean but flows into a higher decision, and so the verdict's accuracy is billed twice.

---

## 20.5 Generalization — framing determines verifiability

Write this chapter's principle in one sentence and it is this.

> **What you can judge without reading the body is already set by how the format decided to mark boundaries.**

The moment the format designer picks the framing method, **every** tool that handles that format has it decided
what it can confirm cheaply and what it cannot. A verification tool's ability is not set by the verification
tool.

| Framing | Example | Cheaply obtained | Not obtained |
|---|---|---|---|
| **length-prefixed** | ISO-BMFF, EBML, protobuf, ASN.1 BER, PNG chunks, TCP segment | truncation·boundary-mismatch detection, body skipping | the body's semantic validity |
| **delimiter** | CSV, HTTP header, JSON, m3u8 | human-readable, partial parsing | **collapses if the delimiter appears in the body** (needs escaping) |
| **self-synchronizing** | MPEG-TS, MP3 frame | resync at an arbitrary point, concatenation is validity | **cannot know where the end is** — truncation undetectable |
| **tail index** | ZIP (central directory), PDF (xref) | the whole listing without sweeping the body | **if the tail is cut nothing can be read** |

The last row is an interesting contrast. ZIP has its listing at the file's **end**, so even if the front is fine
it is completely powerless if the tail is cut. ISO-BMFF's default layout (`moov` after) has exactly the same
property, and `faststart` inverted that property. **And that inversion did not make this chapter's check easier**
— either layout, the sum of boundaries is checked the same way.

Other spots where the same structure appears.

| Domain | The equivalent of the length declaration | The consequence of its absence |
|---|---|---|
| HTTP | `Content-Length` / `Transfer-Encoding: chunked` | cannot distinguish a dropped-connection response from a completed one |
| an application protocol over TCP | the message length prefix | message boundaries vanish, becoming the foundation for **request smuggling** |
| archive | the tar header's size field | a truncated tar ends quietly at the last entry |
| database WAL | record length + checksum | a partially written record cannot be identified at recovery time |
| filesystem journal | the transaction commit record | a half-written state cannot be undone on power cut |

The last two rows solve the same problem as this chapter's (§20.1.1 power cut) one layer down. **«Was it written
to the end» is a problem the filesystem and the database re-solve every time, and the answer is always «write
down something marking the end in advance».**

From here comes a proposition one step further.

> **To verify without reading the body, the metadata must be redundant with the body.**
> ISO-BMFF wrote «the body's length» once more outside the body, and the checker looks only at whether the two
> agree. No redundancy, no verification.

---

## 20.6 Security — what it means to parse untrusted input

Up to here we dealt with «accidents». Now switch to «malice» and read the same code. A recursive TLV parser is
one of the code types producing the most CVEs across media·network·serialization. That reason is all inside
these thirty-six lines.

### 20.6.1 The shape of the boundary check — integer overflow

The line in question is line 94.

```python
            if offset + box_size > size:
```

In Python this line is safe. Python's integers are arbitrary precision so `offset + box_size` cannot overflow.
And yet **move the same line to C and it is a vulnerability.**

```c
/* vulnerable — offset + box_size wraps around */
if (offset + box_size > size) return ERR;
/* box_size = 0xFFFFFFFFFFFFFFF0, offset = 0x20  →  sum wraps to 0x10  →  check passes */

/* safe — write it as subtraction. size >= offset is guaranteed by the loop condition so this does not wrap either */
if (box_size > size - offset) return ERR;
```

> **Term** — **integer overflow**: the phenomenon where an operation result exceeding a fixed-width integer
> type's representable range wraps back into that width. In unsigned integers it is defined as modular arithmetic
> so it happens **silently, with no warning.**

If this wrap passes, the following `seek`·`read`·memory allocation are performed at **a length the attacker
set.** The fact that `largesize` is 64 bits is decisive here — the attacker can write the full 64-bit range into
the size field, and it need not actually exist in the file. **By writing just 8 bytes, an arbitrary large number
is injected into the parser.**

Written honestly. **This code is safe not because the author wrote it in subtraction form but because they used
Python.** If you do not write down the distinction between what the language blocked and what the code blocked,
that difference vanishes when the same logic is moved to another language.

### 20.6.2 Progress-guarantee failure — a DoS from one file

The infinite loop seen in §20.3.4 is, from the security view, a **denial of service (DoS).** It has two traits.

- **The input is small.** One largesize filled with 8 zero bytes suffices. The amplification ratio is
  effectively infinite.
- **Detection is hard.** The process does not die but stays alive burning CPU. No crash report, no exception log
  is left.

In recursive TLV parsers this mistake is common. When the length field is 0 or smaller than the header length,
if you have not fixed an answer to «how far to move the cursor», it becomes an infinite loop right there. The
rule is simple.

> **You must be able to prove the cursor strictly increases in every iteration.**
> If you cannot prove it, that parser does not terminate.

### 20.6.3 Recursion depth — why this code is not exposed to it

ISO-BMFF is **recursive** TLV. `trak` inside `moov`, `mdia` inside that, `minf`, `stbl` inside that … it
descends. There is no spec upper bound on depth, and what sets the depth is **the side that made the file.** So a
recursively implemented parser can exhaust the stack with one crafted file.

`_isobmff_flaw` is not exposed to this attack surface. **Because it does not descend.** It sweeps only the
top-level boxes and does not open inside them. Exactly as the function name is `_isobmff_flaw` and the
docstring's first line is "sweeping only the top-level boxes."

This is not free but a **trade.**

| Gained by not descending | Lost by not descending |
|---|---|
| immunity to a recursion-depth bomb | even if `moov`'s inside is damaged, it is seen as «present» |
| cost proportional only to the top-level box count | cannot confirm stream composition·timescale |
| the bytes parsed fixed at 8–16 B per box | does not judge spec conformance |

**The attack surface and the check ability are on the same axis.** The deeper you look the more you catch, but
the more you parse the more you are exposed. This code chose the shallow side, and the deep check is handed to
**`ffprobe`, a separate process** via `--verify-existing` — a layout where, coincidentally, the process boundary
becomes an isolation boundary.

### 20.6.4 It does not pre-allocate by the declared length

This code does not grab a buffer of `box_size`. It only `seek`s. A common parser, by contrast, writes this.

```c
buf = malloc(box_size);          /* box_size is set by the attacker */
fread(buf, 1, box_size, fp);
```

Even if the file is 100 bytes, write `0xFFFFFFFF` into `box_size` and a 4 GiB allocation is attempted. Fail and
it is a null dereference, succeed and it is memory exhaustion.

> **Principle** — **the declared length is «a value to verify» not «an order to obey».**
> Before using it as the size of an allocation·copy·read, always compare it against the actual bytes remaining.

In this code that comparison is line 94, and even after passing the comparison it does not allocate.

### 20.6.5 What was this code's threat model

Organize it honestly. The file `_isobmff_flaw` receives is **one this tool made itself and put in a local
folder.** If an attacker can put a file in this folder there is already a bigger problem. That is, this code's
threat model is not «adversarial input» but «an interrupted self».

And yet it satisfies §20.6.1–20.6.4's conditions mostly. The reasons are three, and different in nature.

| Condition | Why satisfied | Design or coincidence |
|---|---|---|
| no integer overflow | Python's arbitrary-precision integers | **language** — not the code's merit |
| termination guarantee | the size-lower-bound check doubles as it | **coincidence** — the comment writes a different reason |
| recursion-depth immunity | sweeps only the top level | **design** — chosen for speed, safe as a side effect |
| no pre-allocation | only `seek` | **design** — same reason |

**Three decisions made for speed led to attack-surface reduction.** It holds in the reverse direction too — the
optimization "do not read the body" birthed the property "whatever is in the body, it is not a target of a
parsing vulnerability." But you must not, on that basis, say «this code is safe against untrusted input».
**Promoting an unverified property to a guarantee is the same error as Chapter 15 §15.6's incidental defense.**

### 20.6.6 The defender's view

| Role | What to do |
|---|---|
| **parser implementer** | ① write the boundary check as **subtraction**, not addition (`box_size > size - offset`). ② prove the cursor strictly increases each iteration — if you cannot, put an iteration cap. ③ put an upper bound on recursion depth. ④ do not pre-allocate by the declared length. ⑤ verify these four with **fuzzing** — a TLV parser is the best target for a coverage-based fuzzer |
| **media-service operator** | run container parsing of user-uploaded files in a **separate process**, with CPU·memory·time caps. parsing is not «reading data» but «executing code in an order untrusted input set» |
| **auditor** | trace exhaustively **where the declared length flows** in the code — is it a `seek`, a `read`, a `malloc`, a loop cap. the last three are all review targets. confirm only «there is a boundary check» and not look at its **form** and you miss the overflow |
| **tool user** | this check's PASS is «not caught by this check», not «intact». `.mkv` truncation passes (§20.3.7), and `.avi` is not even checked (§20.3.6). knowing what is checked is the condition for using the check |
| **format designer** | put reserved values (`0`·`1`) in a length field and **every implementation must handle that branch exactly.** omit even one and it is a false positive or a vulnerability. the convenience of reserved values and the implementation error rate are a trade |

---

## 20.7 Limits and open questions

Written honestly.

- **`.mkv`·`.webm` truncation is not caught.** Measured. Cut an intact MKV at 60% and `flaw()` answers «intact»,
  and the same with `--verify-existing` on. Because `ffprobe` reports for the truncated file too **the same
  20.023 seconds as the original** (it returns the header's declared length as-is). EBML is also length-prefixed
  framing so the same walk as ISO-BMFF is possible in principle, but this code looks at only the 4-byte
  signature. **And this hole is not even tested** — `tests/run.sh:354` makes only an intact `.mkv` and not a
  truncated `.mkv`.
- **`.avi` gets no structural check at all.** It is in `library.MEDIA_EXTS` so it becomes an inventory target,
  but it catches on none of `flaw()`'s branches and falls to `else: why = ""`. If only it exceeds 64 KB it is
  seen as intact. (Measured: an AVI cut to 60% judged «intact». `ffprobe` reports a shortened 12.03 seconds in
  this case, but the deep check looks only at `duration <= 0` so this passes too.)
- **`.ts` truncation is not caught either.** `_ts_flaw` looks at only the first 189 bytes. It does not even
  confirm whether the file size is a multiple of 188. Adding that check would **presumably** catch a file cut in
  the middle of a packet, but it might false-positive on a stream with a leading offset or a 192-byte packet
  (M2TS), so this course could not confirm it.
- **`largesize`'s lower bound is loose.** The line-92 check is `box_size < 8`. But on the `size == 1` path the
  head is actually **16 bytes**, so a file with largesize 8–15 passes the check and the cursor falls inside the
  head. Progress is guaranteed (at least 8) so it is not an infinite loop and it will read a misaligned position
  afterward and eventually give a reason, but **the reason may not be accurate.** This value would never arise in
  a real file so it was not measured.
- **It does not handle the `uuid` extension type.** ISO-BMFF has a 16-byte user-defined type follow when the kind
  is `uuid`. This code does not know that. Only, those 16 bytes are also included in the box size, so **the
  boundary walk is unaffected** — the kind name is just lumped as `uuid`. That a walk-style check is insensitive
  to fine structure works here as a benefit.
- **It sees only `moov`·`mdat` presence, not the content.** Even if `moov` is an empty shell with a 0-byte body,
  it counts as «present». Real ffmpeg would never make such a file, but the range this check guarantees is up to
  «structure», not «valid metadata».
- **The threat model is not stated in the code.** §20.6.5's classification (language/coincidence/design) is one
  this course attached after the fact. The original code has no mention of «does this function receive
  adversarial input». Reuse the same function on a remote file or a user upload and the threat model changes at
  that moment, and there is no device in the code to prevent that.

---

## 20.8 Summary

1. **ISO-BMFF is recursive TLV.** The whole file is a sequence of boxes of «4 bytes size + 4 bytes type + body»,
   and a box goes inside the body again.
2. **The size field has two reserved values.** `1` and a 64-bit largesize of 8 bytes follows (head 16 bytes), `0`
   and that box goes to the end of the file. **Omit the two branches and it is read as an «abnormal size» smaller
   than 8 and a normal file is judged damaged** — every video exceeding 4 GiB and every streaming-muxing result
   becomes a false positive.
3. **The top-level boxes cover the file with no gap and no overlap.** So looking only at «does the sum of
   boundaries match the file size» you can judge completeness without reading a single byte of the body.
   Measured: on a 514 MiB file, 3 `read()`s, 24 bytes, 0.04 ms. **The cost is proportional not to file size but
   to box count.**
4. **The verdict does not look at the order.** Since `seen` is a set, both faststart (`moov` in front) and
   default (`moov` after) pass. The code is wider than the comment's premise, and the regression test fixes that
   width with `그렌라간02.mp4`. An implementation that checks the order makes every normal file another tool made
   get re-received.
5. **The size-lower-bound check is a termination proof.** Remove `box_size < 8` and one tampered `largesize ==
   0` makes an infinite loop. This loop ends only if the cursor is guaranteed to increase by at least 8 each
   iteration.
6. **Framing determines verifiability.** Only a length-prefixed format can catch truncation by structure.
   MPEG-TS is self-synchronizing so even cut it is still a valid stream, and so this check is impossible in
   principle. **Being closed under concatenation means being closed under truncation.**
7. **The same code meeting untrusted input becomes a textbook of parser vulnerabilities.** Write the boundary
   check as addition and it is integer overflow, with no progress guarantee it is DoS, descend recursively and it
   is stack exhaustion, allocate by the declared length and it is memory exhaustion. The reason this code avoided
   those four is **one language · one coincidence · two designs**, and if you do not write down that distinction
   the next person mistakes it for a guarantee.

---

**Next chapter** — this chapter judged «was the file written to the end» by structure alone. But even if the
structure is intact, **the middle of the content can be empty.** A file joined with one segment missing has its
box boundaries perfectly matching, `ffprobe` opens it as normal, and even the total play length equals the
original. Chapter 21 covers why the total length hides that loss — how it follows from the fact that PTS on a
90kHz clock is an **absolute presentation time.**
