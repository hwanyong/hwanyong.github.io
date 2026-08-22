---
title: "The Two-Tier Indirection of RFC 8216"
description: "What the master/media split creates and loses"
date: 2026-05-25
version: '1.0'
tags: ['streaming', 'foundations']
thumbnail: /images/lecture/thumb/hls-recon-03-two-tier-indirection.svg
---
## 3.0 What this chapter answers

1. Why split into master and media instead of finishing with one document?
2. How does the client know which one the address it received is?
3. Each time indirection grows by one tier, what new obligation does the client take on?
4. Why is `EXT-X-MEDIA`'s group reference a third indirection, and why does it join by **name** rather than URI?
5. Is rejecting a nested master laziness or design?

---

## 3.1 The problem — what an address points to, you know only after fetching

What the user gives the tool is one address.

```bash
hls-recon https://cdn.example/show/master.m3u8 -o out.mp4
```

Whether this address is a **list of quality candidates** or a **list of segments** cannot be known from
the name. Both are `.m3u8`, and both come with `Content-Type: application/vnd.apple.mpegurl`. RFC 8216
has no self-describing tag like `#EXT-X-MASTER`.

> **Term** — **Master Playlist**: an M3U8 document holding an **address list** of the several quality
> candidates and extra tracks of the same content. It does not hold segments directly.
>
> **Term** — **Media Playlist**: an M3U8 document listing the addresses of actual media segments in
> playback order. RFC 8216 specifies that one document must be one of the two, and if both, it is
> **invalid** (§4).

So in this code the kind can be judged **only after parsing is done.**

```python
# cli.py:127-138
def _load(src: str, fetcher: Fetcher) -> tuple[playlist.Playlist, str]:
    """Parse a source (URL or local .m3u8). The second return value is the base URL."""
    if _is_url(src):
        res = fetcher.get(src)
        # if a Referer was obtained from the first response, the request it blocked is worth retrying.
        if _adopt_origin(res, fetcher) and not res.ok:
            res = fetcher.get(src)
        if not res.ok:
            raise SystemExit(f"playlist request failed: {src}\n  {res.error}")
        text = res.body.decode("utf-8", errors="replace")
        try:
            return playlist.parse(text, base_url=src), src
```

`_load` **does not judge** whether what it received is master or media. It requests, converts to text,
and hands it to the parser (the Referer retry in the middle is covered in §3.9.1). The judgment is the
first line of the next function.

```python
# cli.py:176-177
    if not pl.is_master:
        return Source(media=pl, media_url=src)
```

This is the other face of what Chapter 14 calls **"the name and the declaration guarantee nothing."** In
Chapter 14 a segment's identity is determined by its leading bytes. Here a document's identity is
determined by **which tags appear in its content.** The structure — that the basis for the judgment is
outside the metadata — is the same.

---

## 3.2 The principle — why two tiers?

### 3.2.1 If merged into one

ABR (Adaptive Bitrate — the method where the client switches quality as it receives, matching bandwidth)
prepares the same content in N qualities. Each quality is split into M segments. A design that puts this
N×M into one document fails in two ways.

| Alternative | What breaks |
|---|---|
| **Single document** — all qualities' segments in one file | in LIVE delivery, every time one segment is added you must resend a **document containing all N qualities.** the refresh traffic becomes N-fold, and since there is only one cache-invalidation unit, one quality changing invalidates everything |
| **N entry points** — the user knows a separate URL per quality | the client has no way to know the candidate set. ABR's premise, "switch to a different quality mid-run," does not hold |

Two tiers avoids both at once. **It keeps the entry point single while separating the refresh unit and
cache lifetime per tier.**

| Tier | Document | Declares what | When it changes | Cache lifetime |
|---|---|---|---|---|
| ① | master | candidate set (variant · extra-track group) | effectively immutable during the session | long |
| ② | media | the **ordered sequence** of segments + encryption · discontinuity points | for LIVE, at the `TARGETDURATION` period | short |
| ③ | segment | bytes | never changes | permanent |

> **Term** — **indirection**: instead of putting a value in place, putting a name or address by which the
> value can be found. Here, in place of "the video bytes" comes "the address of the segment list," and in
> that place again comes "the address of the candidate list."

David Wheeler's aphorism summarizes this whole chapter.

> "All problems in computer science can be solved by another level of indirection — except for the problem
> of too many levels of indirection."

The first half is §3.2.1, and the second half is the rest of this chapter.

### 3.2.2 What indirection buys and what it sells

| What is gained | What is lost |
|---|---|
| **late binding** — which quality to use is decided at playback time, not delivery time | **atomicity** — the two documents are received at different times. even if the server changed in between, you cannot know |
| **separation of concerns** — a change to the candidate set and a change to the segment list are mutually independent | **cannot enforce referential integrity** — the spec writes MUST, but there is no party anywhere to cross-check the two documents |
| **cache tiering** — a different TTL per tier | **failure to localize errors** — the server does not know which of the three tiers "it won't play" broke at |
| **more access-control points** — you can put authorization on each tier | **partial success** — passing one tier does not guarantee the next |

The right column gives rise to half the problems this course deals with. Chapter 4 (statelessness) and
Chapter 11 (signed URLs) take up the first row and the last row respectively.

---

## 3.3 Code ① — the parser does not judge the kind, it discovers it

`parse` in [`playlist.py:207-337`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L207-L337) takes master and media at the **same entry point.**

```python
# playlist.py:207-213
def parse(text: str, base_url: str = "") -> Playlist:
    """Convert M3U8 text to a Playlist. Every uri is an absolute URL relative to base_url."""
    lines = [ln.strip() for ln in text.splitlines()]
    if not lines or not lines[0].startswith("#EXTM3U"):
        raise ValueError("no #EXTM3U header — not an M3U8 playlist")

    pl = Playlist(base_url=base_url)
```

Inside one `Playlist` dataclass, `variants` and `segments` **coexist** ([`playlist.py:149-161`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L149-L161)). The
kind is not given as a field but is turned on as a side effect during parsing.

```python
# playlist.py:259-262 (excerpt)
        elif line.startswith("#EXT-X-STREAM-INF:"):
            a = _parse_attrs(line.split(":", 1)[1])
            pl.is_master = True
            pending_variant = Variant(
```

```python
# playlist.py:273-277 (excerpt)
        elif line.startswith("#EXT-X-MEDIA:"):
            a = _parse_attrs(line.split(":", 1)[1])
            pl.is_master = True
            uri = a.get("URI")
            pl.media.append(
```

**`EXT-X-MEDIA` alone is enough to judge it a master.** This is not a mistake but an inevitability —
`EXT-X-MEDIA` is a tag that cannot appear in a media playlist, so the mere fact that it was seen makes
this document a master.

### 3.3.1 A URI line is interpreted by state

In M3U8 a tag and a URI are **paired line by line.** When a non-tag line appears, it is the address the
preceding tag points to. Which tag it was, the parser must remember.

```python
# playlist.py:227-236 (excerpt)
        if not line.startswith("#"):
            # a non-tag line = the URI the preceding tag points to
            uri = _absolute(base_url, line)
            if pending_variant is not None:
                pending_variant.uri = uri
                pl.variants.append(pending_variant)
                pending_variant = None
            elif cur_inf is not None:
                dur, title = cur_inf
                pl.segments.append(
```

`pending_variant` and `cur_inf` are mutually exclusive states. In a master only the former branch is
reached, in a media only the latter. **The meaning of one line depends on what came before it** — a state
machine. The thing that shows this same property more extremely is the offset-omission rule of
`EXT-X-BYTERANGE` ([`playlist.py:327-329`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L327-L329)), covered in Chapter 6.

### 3.3.2 A counterexample — give it a hybrid document

RFC 8216 §4 specifies that one document cannot be a master and a media at once. But this parser **does not
reject** such a document. Put in a document with `#EXT-X-STREAM-INF` and `#EXTINF` mixed, and out comes a
`Playlist` with both `variants` and `segments` filled, and `is_master` is `True`. The next section's
`_resolve_media` enters the master branch and **throws away the segments in the same document wholesale.**
No exception, no warning.

It is a textbook case of a lenient parser (Postel's law, "be liberal in what you accept") creating a quiet
malfunction. Left as a limit in §3.10.

### 3.3.3 When one type doubles as two documents, every property must give two answers

The price of one `Playlist` doubling as master and media comes not from parsing but from the **properties.**

```python
# playlist.py:163-166
    @property
    def is_live(self) -> bool:
        """No ENDLIST means an in-progress live delivery."""
        return not self.is_master and not self.has_endlist
```

A master playlist **originally has no** `#EXT-X-ENDLIST`. That tag is the media playlist's end marker.
Therefore, remove `not self.is_master` and **every master is judged LIVE.**

**However, in this repository right now that misjudgment does not actually happen.** `is_live` has only two
call sites ([`cli.py:208`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L208) · [`cli.py:399`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L399)), and both receive the **media** playlist `_resolve_media` has
already unwound ([`cli.py:535`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L535) · [`cli.py:583`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L583)). There is currently no path by which an object with
`is_master` `True` reaches this property.

So is that condition dead code? No — **in a design that expresses a sum type as one dataclass, a property
must be able to answer in both cases.** That the call sites are narrow right now is a property of the call
sites, not of the property. The moment someone adds a fast path deciding the mode early at the master stage
(`_decide_mode(args, pl)`), every VOD master drops to `remux` and **per-segment verification disappears
wholesale.** Then this one word is the only defense.

The same property is in the first two lines of `pick_variant` too — a master with only `EXT-X-MEDIA` and
no `EXT-X-STREAM-INF` has `is_master=True` while `variants` is empty, so it falls into
`ValueError("no variants in the master playlist")` ([`playlist.py:190`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L190)). Fold a sum type into one and
**the code must itself block the impossible combinations.**

---

## 3.4 Code ② — base is renewed at each tier

A playlist's URIs are usually written as relative addresses. The point that turns them into absolute
addresses is **the only one** in this code.

```python
# playlist.py:30-38
def _absolute(base_url: str, uri: str | None) -> str | None:
    """Make a URI written in the playlist into an absolute address — this is the only point that births a URI.

    Along with absolutization, it finishes percent-encoding too. Afterward this value is used as is in
    both the request and the ffmpeg input, so normalize on only one side and the other cannot open it.
    """
    if not uri:
        return uri
    return normalize_url(urljoin(base_url, uri) if base_url else uri)
```

The issue is what to put in `base_url`. It differs per tier.

![Two-tier indirection and base-URL inheritance](/images/lecture/hls-recon/03-two-tier.svg)

*Figure 3-1 — a relative URI is absolutized against the address of the document it is written in. The address ① birthed becomes the base when parsing ②.*

| Tier | Call site | `base_url` |
|---|---|---|
| ① master | [`cli.py:138`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L138) | the source address the user gave |
| ① master (local file) | [`cli.py:145`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L145) | `p.as_uri()` — the `file://` scheme |
| ② variant | [`cli.py:189`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L189) | `chosen.uri` — **the address ① birthed** |
| ③ subtitle track | [`cli.py:274`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L274) | `track.uri` — **another address ① birthed** |

### 3.4.1 A counterexample — if base is not renewed

The regression test's subtitle fixture is laid out in a form that can reproduce this failure precisely
(`tests/run.sh:110-124`).

```
$BASE/master-subs.m3u8          ← master. the track URI is "subko/index.m3u8"
$BASE/subko/index.m3u8          ← subtitle playlist. the segment is "seg000.vtt"
$BASE/subko/seg000.vtt          ← the actual subtitle piece
```

When parsing `subko/index.m3u8`, if you set base to the **master's address**, `seg000.vtt` resolves to
`$BASE/seg000.vtt`. There is no file there. All 5 subtitle pieces drop to 404, and the video plays
normally — **a place where partial failure holds quietly.**

For the same reason, `base_url=chosen.uri` in [`cli.py:189`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L189) is essential too. In a delivery where the
variant is in a different directory from the master (`/master.m3u8` and `/hd/index.m3u8`), use the master
address as base and all the segments go off. This repository's `multi/` fixture has master and variant in
the **same directory**, so **it cannot catch this mistake** (`tests/run.sh:59-66`). Noted in §3.10.

---

## 3.5 Code ③ — candidate selection and nested-master rejection

### 3.5.1 `pick_variant` — why is bandwidth the default sort key?

```python
# playlist.py:185-204
    def pick_variant(
        self, height: int | None = None, max_bandwidth: int | None = None
    ) -> Variant:
        """Quality-candidate selection. With none specified, the maximum bandwidth."""
        if not self.variants:
            raise ValueError("no variants in the master playlist")
        pool = self.variants
        if height is not None:
            matched = [v for v in pool if v.height == height]
            if not matched:
                avail = sorted({v.height for v in pool if v.height}, reverse=True)
                raise ValueError(
                    f"no {height}p candidate. available: {avail or 'resolution not stated'}"
                )
            pool = matched
        if max_bandwidth is not None:
            under = [v for v in pool if v.bandwidth <= max_bandwidth]
            if under:
                pool = under
        return max(pool, key=lambda v: v.bandwidth)
```

That the default sort key is `BANDWIDTH`, not `RESOLUTION`, comes from the spec. In RFC 8216 §4.3.4.2,
`EXT-X-STREAM-INF`'s **`BANDWIDTH` is REQUIRED and `RESOLUTION` is OPTIONAL.** Making `Variant.height`
return `0` when resolution is unstated ([`playlist.py:115-122`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L115-L122)) is a consequence of the same fact — **the
only sort key that always exists is bandwidth.**

If you specify `height` and there is no candidate, it **does not substitute the nearest but raises an
exception.** And it puts the available list in the message. In a verification tool this is not something to
compromise on — give a user who requested 720p a silent 1080p and the report's `variant` field and the
actual output diverge, and every comparison based on that report becomes invalid.

> **And yet this `ValueError` is nowhere converted to `SystemExit`.** This repository's other failure paths
> convert exceptions to `SystemExit` without exception, leaving only a clean message
> ([`cli.py:135`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L135) · `140` · `147` · `187` · `191`). And yet the site that calls `pick_variant`
> ([`cli.py:183`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L183)) has no `try`, and neither does `_run_one` nor `main`. As a result a user who wrongly gave
> `--height 720` sees the painstakingly built "available: [1080, 480]" message **carried on a Python stack
> trace.** The series path is worse — the `except SystemExit` at [`cli.py:757`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L757) cannot catch a `ValueError`,
> so one episode's candidate mismatch **aborts the whole 27-episode run.** A fault confirmed by measurement,
> left in §3.10.

**And yet `max_bandwidth` does not follow the same discipline.** If `under` is empty it leaves `pool` as
is, so when there is not a single candidate under the cap this function returns the **overall maximum.** A
user who required "5Mbps or under" receives 8Mbps from a master with only one 8Mbps candidate. Not a
failure, no warning. `height`'s strictness and `max_bandwidth`'s leniency are **asymmetric within one
function.** Noted in §3.10.

### 3.5.2 `_resolve_media` — fixed at depth 1

```python
# cli.py:172-196
def _resolve_media(
    pl: playlist.Playlist, src: str, fetcher: Fetcher, args: argparse.Namespace
) -> Source:
    """If master, pick a variant and go down to the media playlist."""
    if not pl.is_master:
        return Source(media=pl, media_url=src)

    _eprint(f"  master playlist — {len(pl.variants)} quality candidates")
    for v in sorted(pl.variants, key=lambda x: -x.bandwidth):
        _eprint(f"    · {v.label()}")

    chosen = pl.pick_variant(height=args.height, max_bandwidth=args.max_bandwidth)
    _eprint(f"  chosen: {chosen.label()}")
    res = fetcher.get(chosen.uri)
    if not res.ok:
        raise SystemExit(f"variant playlist request failed: {chosen.uri}\n  {res.error}")
    try:
        media = playlist.parse(res.body.decode("utf-8", errors="replace"), base_url=chosen.uri)
    except ValueError:
        raise SystemExit(_diagnose(res, chosen.uri)) from None
    if media.is_master:
        raise SystemExit("the variant URL is another master playlist — nested structure is not supported")
    return Source(
        media=media, media_url=chosen.uri, master=pl, variant=chosen, label=chosen.label()
    )
```

**There is no recursion.** This function goes down exactly once, and if where it went is another master it
halts ([`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193)). With just two lines calling itself again you could "support" nesting, and the
grounds for not doing so are three.

| # | Basis | What breaks if supported |
|---|---|---|
| 1 | **the spec** — RFC 8216 §4.3.4.2 specifies that the URI on the line after `EXT-X-STREAM-INF` points to a **media playlist**. nesting is out of spec | code fitted to out-of-spec input changes the behavior for in-spec input |
| 2 | **termination guarantee** — the side that makes the reference graph is the remote server. one master with `A → A` falls into an infinite loop | to bound the depth you must set a constant, and the basis for that constant is nowhere |
| 3 | **absence of meaning** — the report's `variant` field is the only record of "what was received." nested, which tier's candidate to write is undefined | the very interpretation of the verification result does not hold |

The third is heaviest. A nested master is a structure that is **not hard to parse but meaningless.** What
can be supported and what should be supported are different. `README.md:416` makes this decision explicit
as a known limit — **the rejection is not hidden.**

> Basis 2 appears in the same form in another file of this repository. The diagram checker rejecting
> DTD·entity declarations **before** parsing the SVG (`tools/check_svg.py:36-39`) is the same judgment.
> **It does not traverse a remote-made reference graph without limit.**

### 3.5.3 That there is no variant fallback

[`cli.py:186-187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L186-L187) is an immediate `SystemExit` if the chosen variant cannot be received. It does not go
down to the next candidate. A browser's ABR player would necessarily fall back here.

Not falling back is correct here. **A verification tool must receive "what was requested," and the very
fact that it was not received is the result.** Silently drop to a lower quality and the report gives a PASS,
but what that PASS is a PASS of cannot be known. Only, on "a CDN where only the top quality is broken" the
whole thing fails and the user must go down manually with `--height` — not a decision without a price.

---

## 3.6 The third indirection — `EXT-X-MEDIA`'s group reference

The two indirections so far joined by **address.** The third is different.

```
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="한국어",URI="subko/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1400000,SUBTITLES="subs"
plain/index.m3u8
```

`SUBTITLES="subs"` is not a URL. That its string equals the `GROUP-ID` value of another tag **in the same
document** is all. It is the same structure as a foreign key in a relational database, and the difference
is that **there is no party checking the integrity constraint.**

![Group reference — the third indirection, joined by name](/images/lecture/hls-recon/03-group-ref.svg)

*Figure 3-2 — a reference joined by name within the same document. Go off and out comes an empty list, with no exception or warning.*

It is reflected directly in the code. The referencing side and the referenced side are one field each.

```python
# playlist.py:112 (Variant)
    subtitles_group: str = ""  # SUBTITLES="..." — the subtitle group attached to this candidate
```

```python
# playlist.py:76 (Media)
    group_id: str
```

The only function that resolves the name is this.

```python
# playlist.py:177-183
    def tracks(self, kind: str, group: str = "") -> list[Media]:
        """Extra-track lookup. Given group, restrict to that group."""
        return [
            m
            for m in self.media
            if m.type == kind and (not group or m.group_id == group)
        ]
```

### 3.6.1 Put the three kinds of reference side by side

| Reference | Form | Target | When resolved | If it goes off |
|---|---|---|---|---|
| `EXT-X-STREAM-INF` → media | URI (next line) | another document | at HTTP request | `SystemExit` — immediate halt ([`cli.py:186-187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L186-L187)) |
| `EXT-X-MEDIA` → subtitle playlist | URI (attribute) | another document | at the subtitle stage | only that track fails, video proceeds ([`cli.py:275-277`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L275-L277)) |
| `EXT-X-STREAM-INF` → group | **name (string)** | **same document** | in memory after parsing | **empty list. no exception or warning** |

Only the third row does not go out to the network. Not going out to the network also means **there is no
status code to report the failure.** RFC 8216 §4.3.4.2 writes that a `SUBTITLES` value **MUST match** the
`GROUP-ID` of a `TYPE=SUBTITLES` `EXT-X-MEDIA` somewhere in that document, but the party that checks it is
nowhere. The spec's MUST has force only when there is a checker.

### 3.6.2 Fall back only when the group is empty

```python
# cli.py:160-165
    def subtitle_tracks(self) -> list[playlist.Media]:
        """The subtitle group attached to the chosen quality candidate. If no group reference, look at all."""
        if not self.master:
            return []
        group = self.variant.subtitles_group if self.variant else ""
        return self.master.tracks("SUBTITLES", group)
```

It branches three ways.

| Situation | `group` | Result | Judgment |
|---|---|---|---|
| the variant has no `SUBTITLES` attribute | `""` | the `not group` branch of `tracks()` → **return all** | a delivery not using the group concept. the document's subtitles are this video's subtitles |
| the name matches | `"subs"` | only that group | normal |
| the name goes off | `"subs-v2"` | **`[]`** | disappears quietly |

That the third does **not** fall back to all is intentional. Ignore the mismatched name and give all, and
you attach **subtitles belonging to a different quality candidate** to this video. In a multilingual
delivery this makes "a file with the wrong subtitles attached," and that file plays, so no one notices.
**No subtitles is better than wrong subtitles.**

Only, silence is the price. The code that tells the user is behind this condition.

```python
# cli.py:557-559
    if args.subs != "none" and all_subs and not chosen_subs:
        _eprint(f"  · no subtitles matching --subs {args.subs} "
                f"(available: {', '.join(m.language or '?' for m in all_subs)})")
```

If `all_subs` is already empty this warning does not appear. **The case where the group reference goes off
is exactly that case.** Noted in §3.10.

### 3.6.3 When there is no resource at the end of the reference — CLOSED-CAPTIONS

```python
# playlist.py:86-89
    @property
    def is_embedded(self) -> bool:
        """A track carried inside the video stream — not a target to download separately."""
        return self.uri is None
```

`TYPE=CLOSED-CAPTIONS` (CEA-608/708 — captions carried inside the video elementary stream) **cannot have**
a `URI` attribute in RFC 8216 §4.3.4.1. The declaration is in the master while the resource is inside the
video. It is the only case where there is no address at the end of the indirection.

```python
# cli.py:167-169
    def closed_captions(self) -> list[playlist.Media]:
        """Captions carried inside the video stream (CEA-608/708). Cannot be downloaded separately, so only announced."""
        return self.master.tracks("CLOSED-CAPTIONS") if self.master else []
```

Here it does not restrict to a group. There is no reason to narrow a list of things that cannot be
received — **when the use differs, even the same lookup function is used differently.** The actual filter
is applied at the download stage ([`subtitles.py:82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L82)'s `external = [t for t in tracks if not t.is_embedded]`).

---

## 3.7 `Source` — going down without discarding the upper context

```python
# cli.py:150-169
@dataclass
class Source:
    """The result of source resolution. Subtitle·multilingual-audio declarations are only in the master, so carry them along."""

    media: playlist.Playlist
    media_url: str
    master: playlist.Playlist | None = None
    variant: playlist.Variant | None = None
    label: str = ""

    def subtitle_tracks(self) -> list[playlist.Media]:
        """The subtitle group attached to the chosen quality candidate. If no group reference, look at all."""
        if not self.master:
            return []
        group = self.variant.subtitles_group if self.variant else ""
        return self.master.tracks("SUBTITLES", group)

    def closed_captions(self) -> list[playlist.Media]:
        """Captions carried inside the video stream (CEA-608/708). Cannot be downloaded separately, so only announced."""
        return self.master.tracks("CLOSED-CAPTIONS") if self.master else []
```

The one-line docstring says the whole reason. Unfolding that one line:

### 3.7.1 Information exists only at a different place per tier

| Information | Master only | Media only |
|---|---|---|
| quality-candidate list (`EXT-X-STREAM-INF`) | ● | |
| subtitle·multilingual-audio declaration (`EXT-X-MEDIA`) | ● | |
| segment sequence (`EXTINF` + URI) | | ● |
| encryption key (`EXT-X-KEY`) | | ● |
| initialization segment (`EXT-X-MAP`) | | ● |
| `TARGETDURATION` · `MEDIA-SEQUENCE` · `ENDLIST` | | ● |
| declared length (`declared_duration`) — the baseline for verification | | ● |

**Go down and you lose it.** Had `_resolve_media` returned only `media`, there would be no way afterward
even to know that subtitles exist. The media playlist has no `EXT-X-MEDIA`.

So `Source` carries **five** things together.

| Field | Why it's needed |
|---|---|
| `media` | segments·keys·length — the actual work target |
| `media_url` | the input to the ffmpeg-delegation path (`remux`) and the base for tier ③ URIs |
| `master` | the only source of subtitle·audio **declarations** |
| `variant` | needed to resolve the group reference — without knowing "which candidate was chosen" you cannot read `subtitles_group` |
| `label` | the record of "what was received" to leave in the report |

The reason `master` and `variant` allow `None` is also here. When the user gave the **media playlist URL
directly** ([`cli.py:176-177`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L176-L177)) there is no master. Then `subtitle_tracks()` returns `[]`
([`cli.py:162-163`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L162-L163)).

> **A user with only the media URL has no principled way to obtain subtitles.** They have never seen a
> document with subtitle declarations. This is why a separate path, `--sub-guess`/`--sub-url`, exists
> (`README.md:275-287`) — it assembles a URL by rule and tries. Lose the upper tier of the indirection and
> information that existed only in that tier is recovered **only by guessing.**

### 3.7.2 `Source` is not a parse result but an interpretation result

`playlist.Playlist` is the representation of **one document.** `Source` is the **state after folding two
tiers into one.** Thanks to keeping the two types distinct, consumer code need not unwind the tier
structure again.

```python
# cli.py:533-536
    src = _resolve_media(pl, src_url, fetcher, args)
    media, media_url, label = src.media, src.media_url, src.label
    _print_structure(media, label)
    _print_tracks(src)
```

`_print_structure` takes a `Playlist`, and `_print_tracks` takes a `Source`. The former uses only facts of
one document; the latter uses **facts that come out only from cross-checking two documents.** The type
enforces that difference.

The same `Source` is used as is in the subtitle-filling path ([`cli.py:756-766`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L756-L766)) too. Because the two-tier
interpretation is kept in one place, even as entry points grow the rules do not diverge.

---

## 3.8 Generalization — separating catalog from content

This structure is not streaming's invention.

| Domain | ① catalog tier | ② content tier | If the two tiers go off |
|---|---|---|---|
| **HLS** | master playlist | media playlist | variant 404 · dangling group |
| **MPEG-DASH** | the MPD's `AdaptationSet` | `Representation`'s segment template | same problem. only, being in one document, there is atomicity |
| **package repository** | index (PyPI simple, npm registry) | distribution file (`.whl`, tarball) | the index is updated but the file is not there yet → install failure |
| **DNS** | NS delegation record | the authoritative server's A record | lame delegation — the delegation exists but there is no server to answer |
| **container image** | manifest list (tag) | layer blob (digest) | the tag exists but the blob was GC'd |
| **HTML** | the document | `<script>` · `<img>` sub-resources | 404, or **different content comes** |
| **dynamic linking** | the symbol table | the shared library's actual address | symbol-resolution failure |

The seven rows share three properties.

**1. No atomicity.** The two tiers are received at different times. The client has no way to know a change
in between. This is the general form of **TOCTOU (Time-Of-Check to Time-Of-Use)**, and in a security context
it becomes the name of a vulnerability.

> **Term** — **TOCTOU (Time-Of-Check to Time-Of-Use)**: a structure where the state at the moment of
> checking and the state at the moment of use can differ. If the target changes between the two moments,
> the check result becomes invalid.

**2. There is no party to enforce referential integrity.** The spec can write MUST, but with no component
that sees and checks the two tiers together, that MUST exists only in the document. A database's foreign
key has force because **there is an engine enforcing it within the same transaction.** Here there is no
such engine.

**3. Errors are not localized.** The server that received "it won't play" does not know which tier broke.
So this code puts the diagnosis in the client — `_diagnose` ([`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)) is called from **both** tier ①
([`cli.py:140`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L140)) and tier ② ([`cli.py:191`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L191)). Because even if the failure mode differs per tier, the message
form the user sees must be one.

---

## 3.9 Security — one indirection is one trust-decision point

**Each time indirection grows by one tier, a place where you must decide "will I trust this" grows by one.**
This section counts those places.

### 3.9.1 Each tier receives an independent authorization judgment

`_resolve_media`'s `fetcher.get(chosen.uri)` ([`cli.py:185`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L185)) is an HTTP request **completely separate** from
the request that received the master. The server has no way to know this request is a follow-up to the
previous one — the statelessness Chapter 4 covers. As a result, all of the following are possible.

| Master | variant | Segment | What actually happens |
|---|---|---|---|
| 200 | 200 | 200 | normal |
| 200 | 403 | — | the list is visible but you can receive nothing |
| 200 | 200 | 403 (from the middle) | **only the front part is received and the rest is missing** |
| 200 | 200 | 200 + error page | Chapter 14 — indistinguishable from the header alone |

The third row touches directly Chapter 0's starting point ("the total length matches but the middle is
empty"). **One tier's success does not guarantee the next tier.**

The point where this code acknowledges that fact is the `_adopt_origin` retry.

```python
# cli.py:131-133
        # if a Referer was obtained from the first response, the request it blocked is worth retrying.
        if _adopt_origin(res, fetcher) and not res.ok:
            res = fetcher.get(src)
```

This retry is only on tier ①. It is not on the tier ② request ([`cli.py:185`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L185)) — the judgment being that
by then Referer is already in `fetcher.headers` so it is unnecessary. It is **an optimization that holds
because the header state is inherited across tiers**, and the decision to keep `fetcher.headers` as a
single source ([`cli.py:526-529`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L526-L529)) is its premise. Hand over a copy and you request each tier with
different headers.

### 3.9.2 A signed URL expires separately per tier

In signed URLs (Chapter 11) master and variant each have their own signature·expiry. A combination where
the master is cached and valid while the variant signature inside it is already dead really exists. The
symptom is "**the playlist opens but it won't play**," and to the user's eye the cause is invisible.

This is why `series.py` does not gather 27 episodes' addresses in advance but **resolves right before each
episode** (late resolution). As the indirection tiers grow, "when to resolve" becomes a question of
correctness.

### 3.9.3 Recursion depth must not be left for the remote to set

The nested-master rejection at [`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193) is a feature decision and a **security decision.** If the
side that makes the reference graph is remote, a client that traverses that graph without limit has handed
its control flow to the remote. The list of vulnerabilities of the same form is long.

| Name | What the remote gives | Result of unbounded traversal |
|---|---|---|
| XXE / billion laughs | XML entity definition | memory explosion |
| zip bomb | nested compression | disk·CPU exhaustion |
| redirect loop | `Location` header | infinite requests |
| symlink loop | filesystem link | infinite path resolution |
| **nested master** | `EXT-X-STREAM-INF` URI | infinite requests + infinite parsing |

The form of defense is the same too — **fix the depth as a constant, or reject the traversal itself.** This
code chose the latter, and that is the simplest and surest termination guarantee. As said in basis 2, even
if you wanted to bound the depth, there is no basis to justify that constant.

### 3.9.4 Where a remote string reaches

The group name (`GROUP-ID`) is **an arbitrary string the remote sets.** In this code all that string does
is a `==` comparison inside `tracks()`, so there is no danger. But another remote string from the same
document reaches a file path — `Media.language` becomes the output filename. So there is a filter at that
place.

```python
# subtitles.py:104
    lang = re.sub(r"[^A-Za-z0-9-]", "", track.language)
```

**Whether a remote string is used only for comparison or becomes a name** is the baseline for review.
Revisited in Chapter 32.

### 3.9.5 The defender's view

| Role | What to do |
|---|---|
| **CDN·delivery operator** | do not make the master's and variant's signature lifetimes the same. if the variant signature dies first while the master is cached and alive, it becomes "opens but won't play." the upper tier's TTL ≤ the lower tier's remaining lifetime |
| **access-control designer** | **guarding only one tier is guarding no tier.** put authorization only on the master and leave variant·segments public, and get the master once and the rest is all open. each tier must be authorized independently |
| **client implementer** | **fix the depth of a remote-made reference graph as a constant**, and if there is no basis to set the constant, reject the traversal. renew the base URL per tier — do not renew and a lower path goes off wholesale |
| **parser implementer** | do not pass a group-reference failure **quietly as an empty list.** at minimum warn "the declared group and the referenced group differ." a hybrid document is invalid by spec, so rejection is correct |
| **auditor** | "it played" is only one tier's success. **even if the subtitle group is off, the video plays normally.** whether an extra track exists is confirmed only by looking at the master source directly |
| **verification-tool author** | leave in the report whether the requested candidate and the received candidate are the same (`Source.label`). a quiet fallback erases the meaning of the whole report |

---

## 3.10 Limits and open questions

Noted honestly.

- **`pick_variant`'s `ValueError` is not converted to `SystemExit`.** [`cli.py:183`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L183) has no `try`, so a
  candidate mismatch leaks out as a stack trace, and the series path's `except SystemExit`
  ([`cli.py:757`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L757)) cannot catch it, so **one episode's failure aborts the whole run.** This one place alone
  does not keep the discipline every other failure path keeps. Found while writing this chapter, and not
  fixed.
- **The asymmetry of `max_bandwidth`.** `pick_variant` ([`playlist.py:200-203`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L200-L203)) silently ignores the cap and
  returns the overall maximum when there is no candidate under it. `height` raises an exception in the same
  case. The two arguments follow different disciplines within one function, and there is no basis — in code
  or comment — for which is correct.
- **A hybrid document is not rejected.** A document with `#EXT-X-STREAM-INF` and `#EXTINF` mixed is invalid
  under RFC 8216 §4, yet this parser accepts it and `_resolve_media` quietly discards the segments. I have
  never seen such a document in real delivery — **a possibility, not an observation.**
- **A dangling group is silent.** In the third case of §3.6.2 the subtitles disappear yet no message
  appears. The warning at [`cli.py:557`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L557) is not reached if `all_subs` is empty. To fix it,
  `Source.subtitle_tracks()` would have to distinguish and return the case "the group was specified but the
  match is 0."
- **There is no test verifying base inheritance.** The `multi/` fixture at `tests/run.sh:59-66` has master
  and variant in the **same directory**, so the test passes even if you change `base_url=chosen.uri` at
  [`cli.py:189`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L189) to the master address. Only the subtitle fixture (`tests/run.sh:110-124`) has a
  subdirectory structure. **A decision not fixed by regression.**
- **The actual frequency of nested masters is unknown.** The cost of the decision not to support it is "if
  you meet such a delivery it fails," and I have never measured such a delivery. The basis is spec
  interpretation, not observation.
- **TOCTOU between master and variant is not checked.** Even if the server changes the candidate set
  between the two requests, it cannot be known. It is something that can actually happen in LIVE delivery,
  and this code neither measures nor narrows that window.
- **`TYPE=AUDIO` is only displayed.** It reads the group reference and prints it in the list
  ([`cli.py:219`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L219)) but there is no path to receive and mux a separate audio track (`README.md:417-419`). It
  handles only deliveries where the default audio is inside the video variant — **on a delivery where the
  multilingual audio is separated, only the default language is received.**
- **It does not read `EXT-X-I-FRAME-STREAM-INF`.** It is a candidate declaration for trick play
  (fast-forward thumbnails). The parser ignores it, so it works even on such a master, but its existence
  does not remain in the report.

---

## 3.11 Summary

1. **A document's kind is not self-described.** Master and media have the same extension and Content-Type,
   and the distinction is made only by whether `#EXT-X-STREAM-INF`/`#EXT-X-MEDIA` appears
   (`playlist.py:261,275`). The parser does not judge the kind but **discovers it during parsing.**
2. **Two tiers is for separating the refresh unit and cache lifetime per tier**, and in exchange it loses
   atomicity and referential integrity. Half the problems this course deals with come from that price.
3. **The base URL must be renewed per tier.** A relative URI is resolved against the address of the
   document it is written in (`cli.py:138,189,274`). Not renew it and a track placed in a lower directory
   all goes 404.
4. **`EXT-X-MEDIA`'s group reference is a third indirection joined by name, not URI**, and is the only one
   that does not go out to the network. So there is no status code to report the failure, and if it goes
   off, `tracks()` returns **an empty list quietly** ([`playlist.py:177-183`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L177-L183)).
5. **The nested-master rejection has three layers of basis** — spec violation, termination guarantee,
   absence of meaning ([`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193)). The third is heaviest. What can be supported and what should
   be supported are different.
6. **`Source` exists to not discard the upper context while going down** ([`cli.py:150-169`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L150-L169)). Subtitle·
   audio declarations are only in the master, so discard the master after choosing a variant and that
   information is recovered **only by guessing.**
7. **One indirection is one trust-decision point.** Each tier has a separate authorization judgment,
   a separate signature expiry, a separate failure mode. Access control that guards only one tier is the
   same as guarding none.

---

**Next chapter** — this chapter spoke on the premise that the three tiers' requests are mutually
independent. That independence is not a design choice but a property of HTTP. Chapter 4 reads what a
stateless protocol guarantees and does not guarantee in [`fetch.py:107-215`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L107-L215), and settles at the transport
layer why "it arrived" is not "it arrived correctly."
