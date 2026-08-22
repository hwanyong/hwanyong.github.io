---
title: "The Two Faces of Content Sniffing"
description: "When it is a virtue and when a vulnerability"
date: 2026-06-25
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-16-sniffing-two-faces.svg
---
## 16.0 What this chapter answers

1. Why did the browser come to distrust the server's declaration, and how did that become an XSS vector?
2. What exactly does `X-Content-Type-Options: nosniff` turn off, and **what can it not turn off?**
3. Why is the same "do not trust the declaration, look at the content" a basis for correctness in this tool —
   can the criterion dividing the two be set as a proposition?
4. This repository implemented the same principle in **three places independently.** What the three share and
   what differs.
5. What must a server receiving uploads use together? Use only one and where does it get pierced?

---

## 16.1 The problem — the same sentence is a defense on one side and a vulnerability on the other

Chapters 14·15 stood on one sentence.

> **Do not trust the declaration, look at the content.**

A segment coming as `.html` was actually MPEG-TS (Chapter 14 §14.1), and the only basis for determining it was
the payload's leading bytes. The extension and `Content-Type` were only the server's self-report.

And yet open the web-security literature and you read exactly the opposite sentence.

> **Follow the declaration as is and do not guess by the content.**

This is why the response header `X-Content-Type-Options: nosniff` exists. This header demands of the browser
"process it exactly as the type I declared, and do not look into the body and judge differently." Place the two
sentences side by side and it is this.

| | This tool | Browser |
|---|---|---|
| Principle | ignore the declaration and look at the content | do not look at the content and follow the declaration |
| Implementation | `tsanalyze.sniff()` | `X-Content-Type-Options: nosniff` |
| If you do not do it | save the error page as a segment and report "full receipt success" | a text file the user uploaded is executed as a script |

**Both are correct.** Then it means the principle statement is missing a condition. This chapter finds that
missing condition and sets it as a proposition, and confirms how this repository's code satisfies that
condition.

> **Term** — **content sniffing** / **MIME sniffing**: the procedure of deciding a resource's media type not by
> the declared value (the `Content-Type` header·the file extension) but by **inspecting the body bytes.** This
> course uses the two synonymously.

---

## 16.2 The principle — the history of browser MIME sniffing

### 16.2.1 Why did the browser come to distrust the declaration?

Sniffing did not arise from browser makers being lazy. It arose because **servers giving the wrong type was too
common.** Listing the causes, it is this.

| Cause | The declaration that results |
|---|---|
| the web server's extension→type table is stale or has no entry | `application/octet-stream` (the default) |
| the admin serves a new extension without touching the type table | a wrong type or the default |
| a file store returns the declaration from upload time as is | the value the client gave = an untrustworthy value |
| a script writes the header directly and omits the type | no header |
| a CGI·framework's default response type is `text/plain` | `text/plain` |

To this is added market pressure. **If the same page is shown by browser A but not by browser B, the user
abandons B.** That the server config is wrong is invisible to the user; only "it does not show in this browser"
is visible. So the browser chose "the side that works," and that choice was sniffing.

The result hardened in two stages.

1. Each browser came to have a **different** heuristic — a state where the same byte sequence is interpreted as
   a different type per browser
2. That difference itself created security problems, so eventually **the sniffing algorithm itself was
   standardized** (the WHATWG *MIME Sniffing* standard)

The second matters. **Standardization did not approve sniffing but acknowledged it cannot be removed and at
least aligned the behavior into one.** Erase it from the spec and implementations continue and the web splits —
better, the judgment goes, to write it in the spec and make it identical without exception.

### 16.2.2 Where it becomes a vulnerability — the chain from determination to execution

The problem surfaces when sniffing is applied to **a file the user uploaded.** The typical chain is this.

| Step | What happens |
|---|---|
| 1 | the user uploads a file. the extension is `.txt`, the content is `<script>…</script>` |
| 2 | the server declares it `text/plain` and returns it — the server did per spec |
| 3 | the browser looks into the body and judges "looks like HTML" |
| 4 | the HTML parser boots — **a parser different from the declaration is selected** |
| 5 | there is a script in the parse output so it is executed |
| 6 | that script gets **the authority of the origin that served that file** |

> **Term** — **same-origin policy**: the browser's default isolation rule that only documents with the same
> scheme·host·port can access each other's DOM·cookies·storage. In what origin a piece of code executed is that
> code's authority.

> **Term** — **stored cross-site scripting**: a vulnerability where a script an attacker planted is stored on
> the server and, when another user opens that resource, is executed **in the victim's browser with that site's
> origin authority.**

Step 6 is the whole. The first five steps are not dangerous in themselves. The danger is that the chain — **the
determination result changes the parser selection, the parser selection changes whether it executes, and the
execution gets the origin's authority** — runs to the end.

### 16.2.3 What exactly does `nosniff` turn off?

`X-Content-Type-Options: nosniff` cuts **step 3** of this chain. Internet Explorer 8 introduced it, other
browsers followed, and now it is specified in the Fetch standard. What the browser does is two things.

| Action | Content |
|---|---|
| **type-inference ban** | do not change the declared media type by looking at the body |
| **type-mismatch block** | if the type of a resource requested by `<script>` is not a JavaScript MIME type, or a resource requested by `<link rel=stylesheet>` is not `text/css`, **refuse the load itself** |

The second is often forgotten. `nosniff` does not stop at a passive "do not guess" but does an **active block.**
An attack pulling an image·JSON in as a script (e.g., an attempt to read cross-origin data with `<script>`) is
blocked here.

**But there is something `nosniff` cannot do, and that is the most common misunderstanding of this header.**

> `nosniff` **only enforces the declaration; it does not make the declaration correct.**

If a server declares a user upload as `Content-Type: text/html` and attaches `nosniff`, the browser
**faithfully executes it as HTML, per the declaration.** The header did its whole job and the result is XSS. So
`nosniff` must necessarily pair with a **correct declaration**, and that even that is insufficient is §16.5's
content.

### 16.2.4 The proposition — execution or classification

Now we can fill the blank §16.1 left.

![Where the determination result flows in the browser path and this tool's path](/images/lecture/hls-recon/16-verdict-destination.svg)

*Figure 16-1 — where the same determination flows. The left leads determination → parser selection → execution → origin authority, and the right stops at determination → classification value → report item.*

> **If the sniffing result decides execution it is a vulnerability, and if it decides classification it is a
> virtue.**

Organized on three axes, it is as follows.

| | The browser's document render | This tool's segment verdict |
|---|---|---|
| What the determination result decides | **which parser to boot** | **which list to put it in** |
| What that parser does | executes the output | nothing — there is no parser after determination |
| Worst outcome of a misjudgment | arbitrary code execution in the victim's origin | the verification verdict is wrong |
| Who controls the determination target | may be an attacker (the uploader) | the remote server — also outside the trust boundary |
| Does the determination result open authority | **it does** | it does not |
| The correct policy | follow the declaration (`nosniff`) | look at the content (`sniff`) |

There is a value to note in the fourth row. **That the determination target is untrustworthy input is the same
for both sides.** This tool too determines bytes a remote CDN gave. So what divides the two is not "is the
input safe." It is **what the determination result opens.**

The last row is this chapter's formal conclusion. The same technique — on one side turning it off is correct
and on the other turning it on is correct — **a security principle is not true without context.** This
repository has two more of the same form of context-dependence. Chapter 24's padding oracle (the same code is a
vulnerability on the server, a virtue in a verification tool) and Chapter 22's threshold disclosure (the same
value's disclosure is a virtue for the auditor, a map for the evader).

---

## 16.3 The code — three independent implementations of the same principle

This repository implemented "do not trust the declaration, look at the content" in **three separate places.**
The target differs, the basis differs, the cost differs. Place the three side by side and the design space of
the task called determination shows.

### 16.3.1 Container determination — periodicity is the basis

```python
# tsanalyze.py:28-37
    if len(data) < 8:
        return "unknown"
    # TS repeats a sync byte every 188 bytes, so check up to the second packet.
    if data[0] == SYNC_BYTE and (
        len(data) < PACKET_SIZE + 1 or data[PACKET_SIZE] == SYNC_BYTE
    ):
        return "mpegts"
    if data[4:8] in _MP4_BOXES:
        return "fmp4"
    return "unknown"
```

A function already cited in Chapter 5 §5.3.2 and Chapter 14 §14.4.1. What is new to see here is **the kind of
determination basis.**

MPEG-TS has no unique magic number marking the file head. `0x47` is one byte and the probability an arbitrary
byte sequence starts with it is 1/256. What this determination relies on is not a value but **periodicity** —
the structure that the same value comes again 188 bytes later. Look at two points and the chance-match
probability drops to 1/65536.

The ISO-BMFF side differs. The 4-byte box type at offset 4–8 effectively serves as a magic number, and if it is
one of `_MP4_BOXES`'s ([`tsanalyze.py:17`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L17)) 8-set it passes.

> **Term** — **magic number**: a byte sequence placed at a fixed position to identify a file format. Defined in
> Chapter 14 §14.2. There are also formats that must be determined by a **periodic structure** instead of a
> magic number, like MPEG-TS.

Where the determination result flows is the `bogus` list at [`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464), and from there it becomes the
"payload validity" check item at [`report.py:198-211`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L198-L211). **There is no parser between determination and verdict.**
This is Figure 16-1's right path.

### 16.3.2 Subtitle-format determination — when there is no magic number

```python
# subtitles.py:417-429
def _sniff_format(body: bytes) -> str:
    """Determine a subtitle body's format by its leading content. Empty string if not a subtitle.

    Do not trust Content-Type — some servers give subtitles as `application/octet-stream`,
    and conversely an HTML error page arriving as 200 comes with the same header. Whether
    there is even one cue timecode is the only sure basis.
    """
    head = body[:4096].decode("utf-8-sig", errors="replace")
    if not _CUE_RE.search(head) and not _CUE_RE.search(
        body.decode("utf-8-sig", errors="replace")
    ):
        return ""
    return "vtt" if head.lstrip().upper().startswith("WEBVTT") else "srt"
```

Here there is no magic number to rely on at all. SubRip (`.srt`) has no signature, and WebVTT must start with
`WEBVTT` but that signature is used **only for format distinction** and not for the "is it a subtitle"
determination. The only basis for determination is the cue timecode.

```python
# subtitles.py:26-29
# accept both WebVTT (00:00:01.000) and SubRip (00:00:01,000) cue times.
_CUE_RE = re.compile(
    r"(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})"
)
```

Two times with `-->` between them — this is not a magic number but a **grammar fragment.** The basis for
determination moved from "the leading few bytes" to "does this grammar hold somewhere in the body," and its
price is the following two.

**First, it reads twice.** It searches in `body[:4096]` first, and if not found it decodes **the whole** and
searches again. Because subtitles with a BOM·a long comment·a `NOTE` block prepended really exist. It is a
**cost-asymmetric** design where the common case ends at 4 KB and only the rare case sweeps the whole thing.

**Second, it does not throw an exception.** It absorbs decode failures with `errors="replace"`. Even if binary
garbage comes, it falls to "not a subtitle" (empty string) with no exception. If the determination function
threw an exception, the call site could not distinguish **a determination failure** from **a negative
determination result**, and at that moment verdict logic gets mixed into a `try/except`.

Where the determination result flows is this.

```python
# subtitles.py:466-476
    for url in urls:
        got = fetcher.get(url)
        if not got.ok:
            continue
        found = _sniff_format(got.body)
        if not found:
            # a 200 but not a subtitle — do not save an error page as a subtitle.
            continue
        res.track.uri = url
        dest = out.with_suffix(f".{found}")
        dest.write_bytes(got.body)
```

It is `continue`. In segments the same determination failure becomes FAIL (§16.3.1), whereas here it is a
signal to move to the next candidate URL. The reason is that the two URLs have different provenance, and that
contrast is in Chapter 5 §5.3.6.

What is new to see in this chapter is **line 475.** The determination result `found` **decides the extension of
the file to be written to disk.** It looks the same in form as saying "the determination result decides the
parser selection" on Figure 16-1's left path — the determination result goes outside the control flow and
becomes **a resource's name.**

The one reason this is nonetheless safe is: **`_sniff_format`'s codomain is a closed set.** The return value is
only `""` · `"vtt"` · `"srt"`, and there is no path where a string derived from the input bytes comes out as is.
Had this function been written to return the `Content-Type`'s subtype or the URL's extension as is, it would be
a **path-injection** point where a remote-controlled string goes into `with_suffix()`.

> **Is the determination function's codomain closed** — the property to confirm first when a determination
> result becomes more than a value (a path·command·type).

There is a spot where the regression test fixes this determination too. It places a file with a `.srt` extension
but HTML content on the server (`tests/run.sh:258-259`) and checks that it is not saved as a subtitle
(`tests/run.sh:292`). **It fixed the situation where extension·header·content diverge on the subtitle path
separately too.**

### 16.3.3 Structural completeness — the sum of boundaries is the basis

The third implementation differs in nature from the first two. It checks not the leading bytes but **an
invariant spanning the whole file.**

```python
# inventory.py:75-102
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

The structure is dissected in Chapter 20. What to see here is three **properties as a determination.**

**First, the strength of the conclusion differs.** A leading-byte determination says only "this byte sequence
starts like this format." That the sum of box boundaries matches the file size exactly says "this file has a
consistent structure to the end." The latter is a much stronger statement.

**Second, and yet the cost is not proportional to the size.** It does not read the `mdat` body but skips it with
`seek`. The cost is O(box count), and the box count is on the order of tens regardless of file size.

**Third, there are boundary checks in three places.** `box_size < _BOX_HEADER`, `offset + box_size > size`, and
`len(ext) < 8` when reading largesize. Without these checks — if `box_size` is near 0, `offset` does not
increase so it becomes an **infinite loop**, and if the declared size goes past the end of the file it cannot
distinguish a normal file from a truncated one. This is the standard requirement of parser robustness.

Where the determination result flows is this.

```python
# cli.py:874-881
        have = stock.get(ep.number)
        stale = bool(have and not have.ok)
        if have and have.ok and not args.overwrite:
            _eprint(f"  · already have it — skipping ({have.video.name}). to re-receive use --overwrite")
            done.append((ep, "skipped"))
            continue
        if stale and not args.overwrite:
            _eprint(f"  · re-receiving — {have.flaw} ({have.video.name})")
```

It is a **work-schedule decision.** Not execution, not parsing. The result of a misjudgment is one of two —
see a fine file as damaged and re-receive 27 episodes (cost), or see a damaged file as intact and that episode
is never recovered (missing). Both are substantial damage but **there is no privilege escalation.** Why the
regression test fixes this verdict's false positives·false negatives in both directions is covered in Chapter 37.

### 16.3.4 The spot that trusts the extension — is it a contradiction?

`flaw()` chooses which of the above three checkers to call **by the extension.**

```python
# inventory.py:138-151
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
```

Chapter 14 said "the extension guarantees nothing." Here it branches on the basis of the extension. A
contradiction? No. There are three grounds.

| Ground | Content |
|---|---|
| **the trust boundary differs** | these files are not remote-given but **written by this tool with its own hand just now.** the extension comes from the `--container` option |
| **the extension gives no authority** | what the extension chooses is "which check to run," not "what to execute" |
| **the direction when wrong is safe** | if the extension goes off from the actual content, that container's check fails and it is caught as a `flaw`. the worst is failing to check (a false negative), not wrongly executing |

Only, the last ground carries an honest caveat. It is the `else: why = ""` branch. An extension in `MEDIA_EXTS`
([`library.py:17`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L17)) but not in the above three branches — currently just `.avi` — **receives no structural check at
all.** Pass only the `MIN_BYTES` (64 KB) size check and it is treated as intact.

This is **fail-open.**

> **Term** — **fail-open** / **fail-closed**: if a checker leans toward passing when it meets an input it cannot
> judge, it is fail-open; toward blocking, fail-closed. Access control is fail-closed in principle, and a
> processing path where availability matters sometimes chooses fail-open.

That the two directions split within the same repository is interesting.

| Determination | Return when unknown | Direction | Ground |
|---|---|---|---|
| `tsanalyze.sniff` | `"unknown"` → `bogus` → **FAIL** | fail-closed | a segment **must** be media. otherwise that is the fault |
| `inventory.flaw` | `""` → **intact** | fail-open | a file this tool did not make can be in the folder. declaring the unknown as damaged means proposing to delete someone else's file |

**The same repository, using the same principle, set the failure direction oppositely, and both have grounds.**
What sets the direction is not the technique but **what that verdict induces** — the spot where this chapter's
proposition applies to failure-direction design too.

### 16.3.5 The fourth determination that decides nothing

There is one more spot showing the lower bound of determination risk.

```python
# cli.py:77-90
    lowered = res.body[:512].lstrip().lower()
    if lowered.startswith((b"<!doctype", b"<html", b"<?xml")):
        lines.append("  → a web page came, not video. the server is returning an error page as 200.")
    elif res.body[:2] == b"\x1f\x8b":
        lines.append("  → it is gzip but Content-Encoding was not declared. a server-config problem.")
    elif not res.body.strip():
        lines.append("  → the body is empty.")
    elif res.size <= 200 and all(9 <= b < 127 for b in res.body):
        # there is a defense that returns just a one-line string instead of an error page (e.g., "security error").
        # the body is the refusal reason the server stated, so showing it as is is more accurate than any summary.
        lines.append(f'  → the server returned a short error string as 200: "{res.body.decode().strip()}"')
        lines.append("     the playlist URL itself was refused — check the following in order.")
    else:
        lines.append("  → not M3U8 text.")
```

`_diagnose` ([`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)) determines the content four ways, but what it does as a result is only **choose one
output sentence.** The control flow does not branch, no file is made, no parser boots. The function's return
value is one string and the call site prints it to screen.

**When the determination result touches only a human-readable sentence, the risk of sniffing is 0.** What is at
issue in this function is not sniffing but **the tension between an error message's information content and
information leakage**, and that was covered in Chapter 5 §5.3.5 (being a client tool, information content wins.
Had it been a server, the opposite).

### 16.3.6 A comparison table — what the three share and what differs

![What range of the file the three determination implementations read](/images/lecture/hls-recon/16-scope-of-inspection.svg)

*Figure 16-2 — the range seen sets the strength of the conclusion. A leading determination can say up to "it starts like this," and the sum of boundaries up to "it is consistent to the end."*

| | `tsanalyze.sniff` | `subtitles._sniff_format` | `inventory._isobmff_flaw` | `cli._diagnose` |
|---|---|---|---|---|
| **Determination basis** | `0x47` at a 188-byte period / the box type at offset 4–8 | a cue-timecode regex | sum of box boundaries == file size | 4 leading-byte patterns |
| **Kind of basis** | periodic structure · magic number | grammar fragment | global invariant | magic number |
| **Range seen** | leading 189 B | leading 4 KB, whole on failure | the box heads of the whole file | leading 512 B |
| **Cost** | O(1) | O(1) or O(n) | O(box count) | O(1) |
| **Input source** | remote (outside the boundary) | remote (outside the boundary) | local (a file this tool wrote) | remote (outside the boundary) |
| **Declaration reference** | none — not taken as an argument | none | only for checker selection (§16.3.4) | display only |
| **What the result decides** | a report item (`bogus`) | try the next candidate / save name | whether to re-receive | an output sentence |
| **Direction when unknown** | fail-closed (FAIL) | fail-closed (discard the candidate) | fail-open (intact) | — |
| **Worst misjudgment** | the verification verdict is wrong | a missing subtitle or saving an error page | re-receive cost or a missing episode | a wrong guidance message |
| **Does it open execution authority** | **No** | **No** | **No** | **No** |

**Four things the three share.**

1. **They do not use the declaration for the verdict.** `sniff(data: bytes)` takes neither the status code nor
   `Content-Type` as an argument — cannot receive them, cannot reference them by mistake. `_sniff_format(body:
   bytes)` is the same. **The API signature is itself the policy's enforcement means.**
2. **They separate determination from verdict.** All three functions return only a factual statement (a value),
   and whether to see it as a fault or a search signal is set by the call site. If a determination function
   rendered the verdict too, one of §16.3.2's `continue` path and §16.3.1's FAIL path is necessarily wrong.
3. **They do not throw an exception.** A determination failure is expressed as a value (`"unknown"`, `""`). An
   exception is used only for a failure unrelated to determination, like `OSError` ([`inventory.py:148-149`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L148-L149)).
4. **There is no parser after determination.** None of the three functions' results chooses an executable
   component. Figure 16-1's right path repeats three times.

**Three things that differ.**

1. **The strength of the conclusion** — a leading determination says only "the start," the sum of boundaries
   says "to the end" (Figure 16-2).
2. **The location of the trust boundary** — only one of the three looks at a local file. So only that one gets
   room to use the extension as a basis (§16.3.4).
3. **The failure direction** — two fail-closed, one fail-open. The direction is decided by the action the
   verdict induces.

---

## 16.4 Generalization — three questions that make a determination safe

### 16.4.1 The proposition in an operable form

§16.2.4's proposition is correct but does not become a review tool as is. Because the boundary of "execution"
and "classification" is not always sharp in practice. Turned into an operable form, it is three questions.

| # | Question | If yes |
|---|---|---|
| 1 | Does the determination result choose an **executable component** (parser·decoder·interpreter·plugin) | that component's vulnerability is this determination's attack surface |
| 2 | With **what origin·authority** is the determined resource processed | everything that origin has is the dividend of a misjudgment |
| 3 | **Who controls** the input that could make the determination wrong | if the controller is outside the trust boundary, a misjudgment is not a coincidence but a choice |

If all three are "no," sniffing is a safe convenience feature. If even one is "yes," sniffing is a control
point, and that point must have another layer's defense with it.

### 16.4.2 The same spot in other domains

| Spot | What the determination result decides | Q1 | Verdict |
|---|---|---|---|
| the browser's document render | parser selection → execution | yes | **dangerous** — turn off with `nosniff` |
| `file(1)` · libmagic's type display | a human-readable string | no | safe |
| this repository's `sniff` · `_sniff_format` | a classification value | no | safe |
| an image library's automatic format detection | **decoder selection** | yes | medium — if the decoder is not memory-safe it is an attack surface as is |
| an archive tool's compression-format detection | **decompressor selection** | yes | medium — the zip bomb·path traversal is on the decompressor side |
| an antivirus's file-type determination | **scan-engine selection** | yes | medium — the checker itself becomes the attack target |
| FFmpeg's format auto-detection | **demuxer selection** | yes | **dangerous** — Chapter 15's CVE-2023-6602 is exactly this |
| an upload server's stored-type decision | the `Content-Type` to serve later | indirect | **dangerous** — §16.4.4 |

**It belatedly reveals that Chapter 15 was one row of this table.** The structure where the HLS playlist's
segment-URI extension chooses the demuxer is a precise case of "the determination result chooses an executable
component." Only, there the determination basis was not the content but the **name**, and so the defense too was
placed not as a content check but as a name allowlist.

### 16.4.3 Polyglots — the upper bound when determination is the sole basis

> **Term** — **polyglot file**: one file parsed **validly and simultaneously** as two or more different formats.
> A file that is a GIF and a JAR, a file that is a PDF and a ZIP, etc., are known.

The upper bound of content-based determination is here. **When a determination asks "is this file X," an answer
of yes does not mean "it is not Y."** If two formats' grammars have an overlapping region, one byte sequence
satisfies both.

Examining how this upper bound applies to this repository's determinations, it is this.

| Question | Answer |
|---|---|
| Is a file possible that is MPEG-TS passing `sniff()` while the browser renders it as HTML | **it seems possible.** a TS packet's payload takes arbitrary bytes, and an HTML parser ignores leading garbage and finds tags. But **this course did not actually make one and confirm** — it is inference |
| Is that a problem for this tool | **it is not.** this tool does not render by the determination result. all three questions (§16.4.1) are "no" |
| Then who is it a problem for | **the next consumer who opens that file with a browser.** the moment this tool's output is placed on a web server, the risk is transferred |

The third row leads to §16.4.4.

### 16.4.4 Transferred risk — when the determination result is stored

Determination is a point-in-time job but its result lives long. When the result is **stored and becomes the
input to another decision**, the risk is set not at determination time but at **consumption time.**

The typical form is an upload server.

```
at upload:   sniff the file content → "this is image/svg+xml" → record in the DB
at serving:  carry the DB value as Content-Type → the browser renders the SVG
                                                → the <script> inside the SVG executes
```

The determination itself was correct. That file really was SVG. **The problem is that a consumer that trusts the
determination result as is was behind it**, and that consumer is not the code that performed the determination
but the serving code written months later.

The spot where the same form appears in this repository was §16.3.2's `dest = out.with_suffix(f".{found}")`, and
there it was safe because the codomain is a closed set. **Even if the structure is the same, an open codomain
changes the result** — finding the spot where a determination result becomes more than a value (a name·type·path)
and confirming the codomain is the knack of the review.

---

## 16.5 Security — the defender's view

### 16.5.1 What a server receiving uploads must use together

Turn Chapter 14 §14.7.1's conclusion — "the extension cannot be a control point" — around to the upload
direction and it becomes this section. **No control is sufficient alone.** You must place side by side what each
layer blocks and does not block to see the combination.

| Control | What it blocks | What it does not block |
|---|---|---|
| **extension allowlist** | a naive executable upload (`.php`·`.jsp`) | content masquerade — Chapter 14's conclusion as is. the extension does not guarantee the content |
| **content determination (magic number)** | a file with only the extension changed | a polyglot (§16.4.3), the determiner's own false positive |
| **correct `Content-Type` re-declaration** | the mistake of returning the client's upload-time declaration as is | meaningless if the declaration is still an executable type (`text/html`·`image/svg+xml`) |
| **`X-Content-Type-Options: nosniff`** | the browser's type inference, a type-mismatch script·style load | **blocks nothing if the declaration itself is `text/html`** |
| **`Content-Disposition: attachment`** | inline render — forces a download | the user downloading and opening it, a non-browser consumer that does not look at this header |
| **separate-origin isolation** | even if executed it cannot reach the main service's cookies·DOM | an attack targeting that origin itself, a user-to-user cross attack (if isolation is not per user) |
| **`Content-Security-Policy: sandbox`** | pushes the response into an opaque sandbox origin, blocking script·form | an old client that ignores the header |
| **re-encode·regenerate** | a polyglot, a payload hidden in metadata | the decoder's own vulnerability — re-encoding **necessarily runs the decoder** |

> **Term** — **`Content-Disposition: attachment`**: an HTTP response header instructing to download the response
> as a file rather than render it as a document.

> **Term** — **separate-origin isolation (sandbox domain / user-content origin)**: a placement that serves
> user-uploaded resources from a **different host** than the main service, so even if executed they cannot reach
> the main service's credentials·DOM by the same-origin policy. To block even user-to-user attacks you must
> split the origin further per user·upload.

### 16.5.2 What breaks if you use only one

Reading the table again as combinations, it is this. **The form is not "do this and it is done" but "do only
this and what remains."**

| Use only this | The remaining hole |
|---|---|
| extension check only | HTML uploaded as `.jpg` passes. if the server sets the type by extension it is safe then, but if there is even one sniffing consumer it goes off at that consumer |
| magic-number check only | a polyglot passes. and **what type the passed file is served as** is still undecided |
| `nosniff` only | if the declaration is `text/html` the browser faithfully executes. **`nosniff` only enforces the declaration, does not make it correct** |
| `Content-Disposition` only | the browser does not render, but consumers that do not respect this header remain — a document-preview service·mail client·old plugin |
| separate origin only | the main service is protected, but within that origin **user A's script reads user B's resource** |
| re-encode only | valid for images but inapplicable to documents·archives. and re-encoding itself runs the decoder so §16.4.2's "decoder selection" row survives as is |

Writing the recommended combination in one line, it is this.

> **Determine by the content, declare not by the determination result but by a safe type the server sets,
> enforce that declaration with `nosniff`, block the render with `Content-Disposition`, and cage the damage of
> execution with a separate origin.**

The point is that the five each take a different layer. A placement where the next layer remains even if one is
pierced is **defense in depth**, and as confirmed in Chapter 15 §15.7 it holds only when each layer works
**independently.**

### 16.5.3 The client·tool side that uses determination

This is the spot this repository stands at. Moving §16.3.6's "four things they share" into rules, it is this.

| Rule | If you do not do it |
|---|---|
| **do not give the declaration (status code·`Content-Type`·extension) as an argument** to the determination function | someone puts in a branch "let's reference the header only in this case." that branch revives the second row of §16.1's table |
| separate determination and verdict — determination returns a value, the verdict is the call site's | one of the two paths that must use the same determination as a fault and as a search signal is wrong (§16.3.2) |
| return a determination failure **as a value, not an exception** | the call site cannot distinguish a determination failure from a negative determination, and verdict logic mixes into an `except` block |
| where a determination result becomes more than a value (a **name·path·type**), confirm the codomain is closed | a remote-controlled string goes into a file path (§16.3.2, §16.4.4) |
| set the unknown direction (open/closed) by **the action the verdict induces** and write the ground | the direction is set by taste, and the next person changes it the opposite way (§16.3.4) |

### 16.5.4 What to do, by role

| Role | What to do |
|---|---|
| **platform · upload-service operator** | apply §16.5.2's five layers together. do not end with an extension check only. serve user content from a **different host** than the main service |
| **web framework · library author** | make the file-response API's default `nosniff` + `Content-Disposition: attachment`. with no safe default, the user writes the simplest code, and that code usually has no header |
| **browser · runtime implementer** | if sniffing cannot be removed, **specify it**, provide a switch to turn it off, and set the behavior when the switch is absent conservatively. what WHATWG did is exactly this |
| **verification tool · collector author** | §16.5.3's five rules. and write in the docs **how your tool's output flows to the next consumer** (§16.4.3's third row) |
| **security reviewer** | do not ask "does it use sniffing." ask **"with what authority does the determination result flow"** (§16.4.1's three questions). using sniffing is not itself a fault |
| **delivery provider** | extension·type masquerade **forces** the receiving side to sniff. recognize that this demand does not distinguish a safe consumer (a verification tool) from a dangerous one (a browser) |

The last row binds the three chapters of Part 3 into one.

---

## 16.6 Closing Part 3 — the one argument the three chapters made

Chapters 14·15·16 each dealt with a different target but are one argument.

| Chapter | Proposition | The problem it left |
|---|---|---|
| **14** | the name and declaration do not guarantee the content. what cannot be forged is only the payload | then you must look at the payload, but on the delegating path you cannot |
| **15** | to play that masquerade you must relax the other side's security defense. evasion and defense fight over the same control point | with what do you make up for the relaxation |
| **16** | look at the content directly. **but only insofar as you do not attach execution authority to the result** | — |

Chapter 16's caveat clause makes the previous two hold. **"Look at the content" is not an unconditional
command.** With a condition attached, the fact that it is a vulnerability in the browser and a virtue here is
explained without contradiction.

What runs through all of Part 3 was the **self-reporting nature** of access control. Referer (Chapter 9)·CORS
header (Chapter 10)·signed URL (Chapter 11)·cookie (Chapter 12)·obfuscation (Chapter 13)·extension and MIME
(Chapters 14–16) — all were "what the client or server said themselves," and how far to trust that word was
each chapter's question. The answer was the same each time. **Do not trust the word but verify what can be
verified. Do not put authority on what cannot be verified.**

---

## 16.7 Limits and open questions

Noted honestly.

- **§16.2's historical account was not verified with this repository.** The browser MIME-sniffing introduction
  history, `nosniff`'s introduction time and standardization path, and the concrete form of sniffing-based XSS
  are based on public standard documents and security literature, and this course did no reproduction
  experiment targeting a browser. **Per-browser·per-version behavior differences were not confirmed.**
- **The polyglot possibility is inference.** §16.4.3's "a file that is MPEG-TS yet renders as HTML" is inference
  derived from the two formats' properties and was **not actually made and confirmed.** To confirm it you would
  make a file carrying markup in a TS packet payload and put it into both `sniff()` and a browser. Within this
  course's scope it does not affect the conclusion (this tool does not render).
- **The same determination is implemented separately in two places.** The MPEG-TS determination rule (`0x47` at
  a 188-byte period) is in `tsanalyze.sniff` ([`tsanalyze.py:31-34`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L31-L34)) and `inventory._ts_flaw` ([`inventory.py:113-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L113-L121))
  separately. The former takes `bytes` in memory, the latter a `Path` on disk, so the signatures differ and it
  cannot be reused as is, but **the determination rule itself is a duplication.** Support a variant like 192-byte
  M2TS and you must fix both places, and fix only one and a mismatch arises where "it passes on receipt but is
  caught as damaged on inventory." It has not caused a problem now but is structural debt.
- **`.avi` receives no structural check.** It is the `else: why = ""` branch of §16.3.4. It is the only extension
  in `MEDIA_EXTS` ([`library.py:17`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L17)) in none of the three branches, and pass only the 64 KB size check and it is
  treated as intact. This tool does not make `.avi` so it does not appear on the actual path, but it can appear
  when sweeping a folder mixed with another tool's output via `--flat`. **Whether it was left fail-open
  knowingly or missed cannot be judged from the code.**
- **`_sniff_format`'s whole re-check has no size cap.** If it does not find a cue in the leading 4 KB it decodes
  the whole body as UTF-8 ([`subtitles.py:425-427`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L425-L427)). `body` is already in memory so it is not a new exposure
  surface, but the decode cost and the memory the decode result takes are proportional to the body size. Meet a
  server responding a large file as a subtitle-candidate URL and this path becomes a resource-consumption point.
  **Not measured** — read from the code structure.
- **`sniff()` knows only two containers.** A segment format that is not MPEG-TS·ISO-BMFF, like packetized audio,
  falls to `unknown` and becomes a false positive (the same limit is written in Chapter 14 §14.8 and Chapter 19
  §19.8 too). Being fail-closed it does not go quietly wrong, but for a tool with a wide support range it is a
  limit.
- **§16.5.1's control list is not guaranteed complete.** The eight layers are a gathering of widely recommended
  ones, and what more is needed in a particular placement is set by that service's threat model. This table is
  **a review starting point, not a checklist.**

---

## 16.8 Summary

1. **Browser MIME sniffing arose because servers giving the wrong type was common.** And the moment it is
   applied to user uploads it becomes a stored-XSS vector — because of the chain where determination decides
   the parser selection, the parser selection decides execution, and execution decides the origin's authority.
2. **`X-Content-Type-Options: nosniff` cuts the determination stage of that chain.** It blocks type inference
   and blocks a type-mismatch script·style load. But it **only enforces the declaration, does not make the
   declaration correct** — if the declaration is `text/html` it faithfully executes.
3. **The dividing criterion can be set as a proposition. If the sniffing result decides execution it is a
   vulnerability, and if it decides classification it is a virtue.** That the input is untrustworthy is the same
   for both. What differs is the authority the determination result opens.
4. The operable form is three questions — does the determination result **choose an executable component**, with
   **what origin's authority** is the determined resource processed, **who controls** the input that could make
   the determination wrong.
5. **This repository implemented the same principle in three places independently.** The bases are, respectively,
   `0x47` at a 188-byte period, cue-timecode grammar, and the sum of box boundaries. They share four — they do
   not take the declaration as an argument, they separate determination and verdict, they return a value instead
   of an exception, and **there is no parser after determination.**
6. **What differs is the strength of the conclusion·the trust boundary·the failure direction.** A leading
   determination says only "the start" and the sum of boundaries says "to the end." `sniff` is fail-closed,
   `flaw` is fail-open, and **both have grounds** — the direction comes from the action that verdict induces.
7. **When the determination result is stored and becomes the input to another decision, the risk is set at
   consumption time.** The spot where a determination value becomes a file extension ([`subtitles.py:475`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L475)) is safe
   because **the codomain is a closed set.**
8. **A server receiving uploads cannot end with one layer.** Apply content determination + a safe type the
   server sets + `nosniff` + `Content-Disposition` + separate-origin isolation together. An extension check alone
   is insufficient (Chapter 14), and `nosniff` alone is insufficient too.

---

**Next chapter** — Part 3 asked "what can be trusted," and the answer was always the payload. Now we open that
payload itself. Part 4 covers, bit by bit, what is in the 187 bytes after `0x47`, how one 4-bit field becomes
evidence of packet loss, and **what that evidence cannot catch.** Chapter 17 begins with the dissection of the
MPEG-TS packet header's 4 bytes.
