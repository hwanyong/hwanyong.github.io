---
title: "Mimicking Streaming over HTTP"
description: "The invention of ABR and HLS"
date: 2026-05-22
version: '1.0'
tags: ['streaming', 'foundations']
thumbnail: /images/lecture/thumb/hls-recon-02-abr-and-hls.svg
---
## 2.0 What this chapter answers

1. There were dedicated streaming protocols, so why move to HTTP?
2. Why chop the video into pieces and point to those pieces with a **text list**?
3. What did ABR (adaptive bitrate) gain, and what did it pay for it?
4. As state moved from server to client, **what became impossible to verify?**

Chapter 1 showed that "it arrived" and "it arrived correctly" are different. This chapter answers **why a
structure was built in which those two can diverge**. To write the conclusion first — that gap is not a
bug but the consequence of a design decision.

---

## 2.1 The problem — what did dedicated streaming protocols get caught on?

Until the mid-2000s the mainstream of internet video delivery was the **dedicated streaming protocol**.

> **Term** — **RTMP (Real-Time Messaging Protocol)**: a streaming protocol made by Macromedia (later
> Adobe). It opens a persistent connection on default TCP port **1935** and streams audio·video messages
> over it.

> **Term** — **RTSP (Real Time Streaming Protocol)**: a **control** protocol specified by RFC 2326 (1998).
> On default TCP port 554 it exchanges only commands like `PLAY`·`PAUSE`·`TEARDOWN`, while the media data
> is carried separately, mainly over UDP, by **RTP** (RFC 3550). That is, the control channel and the data
> channel are separate.

Both protocols were technically precise tools. The server knows the playback position, pushes the next
frame to match the client's buffer state, and drops frames when needed to cut latency. And yet these got
caught, one after another, in the deployment environment.

| Where it got caught | What the problem was |
|---|---|
| **Firewalls** | The ports enterprise·school·public networks open are effectively just 80·443. 1935·554 and RTP's dynamic UDP ports cannot get out |
| **NAT** | RTP has the server send UDP to the client, so reaching a client behind NAT requires separate hole-punching |
| **Cache** | A session stream has **no unit (object) to cache.** One request does not correspond to one response, so a proxy cannot even create a target to store |
| **CDN** | By that time the CDN was already complete as an **HTTP object cache**. Using a dedicated protocol means rebuilding that infrastructure wholesale |
| **Scaling** | Since the server holds session state, the server count is proportional to the number of concurrent viewers. "Any server can respond," as with a stateless server, does not hold |
| **TLS** | HTTPS already passes everywhere. Layering encryption onto a dedicated protocol was a separate job |

Five of the six items **have nothing to do with the protocol's quality.** They are all questions of "what
was the already-deployed infrastructure built to carry." This is this chapter's first proposition.

> **A protocol is chosen not for technical excellence but for the ability to get through.**
> What the already-deployed infrastructure was built to carry determines the design space.

So between 2008 and 2010 the same answer appeared independently in three places — Microsoft Smooth
Streaming (2008), Apple **HLS** (2009, with iPhone OS 3.0), Adobe HDS (2010). MPEG-DASH (ISO/IEC 23009-1,
2012) then walked the standardization path. HLS itself was documented by RFC 8216 (2017), but it is an
**Informational document, not Standards Track** — the fact that the spec effectively describes a single
implementation after the fact comes back several times later.

---

## 2.2 The principle — reducing streaming to file transfer

To carry video over HTTP, two inventions were needed.

### 2.2.1 Invention ① — cut the timeline into files

Cut a continuous video stream into pieces of a few seconds and make **each an independent file.**

> **Term** — **media segment**: in HLS, an independent resource corresponding to one span of playback time.
> What this repository handles is two containers, MPEG-TS (`.ts`) and fMP4 (`.m4s`).

At this moment the streaming problem is **reduced to a file-download problem.** One piece is just a GET, a
GET is cached, and caching is something the CDN already does very well. The six rows of §2.1's table —
firewalls·NAT·cache·CDN·scaling·TLS — are solved **all at once.**

### 2.2.2 Invention ② — point to the pieces with a text list

Once a piece becomes an independent file, you need something to tell you "what the next piece is." That is
the manifest.

> **Term** — **manifest / playlist**: a list document holding the segments' addresses and playback lengths,
> plus the extra information needed for playback. In HLS it is **UTF-8 text** with the `.m3u8` extension,
> and by spec each line is either a URI line, a blank line, or a line starting with `#` (a tag·comment).

M3U8 is not a newly made format. It extends M3U, a 1990s audio-playlist format, to UTF-8. **The same logic
as choosing HTTP in §2.1** — reuse what already exists and the parser, the tools, and human understanding
come along with it.

Three things the choice of text incidentally created, noted here.

| Gained by being text | The price |
|---|---|
| A person can read and debug it by eye | The whole list is exposed in plaintext (→ §2.6) |
| GET the same URL again and it refreshes — **live works by polling alone, with no server push** | The refresh period becomes latency |
| It can be generated·processed with standard text tools | The parser is directly exposed to off-spec input |

### 2.2.3 So what moved?

The sum of the two inventions comes with one price attached. **The server no longer holds playback state.**

![Where the state lives](/images/lecture/hls-recon/02-where-state-lives.svg)

*Figure 2-1 — in a dedicated protocol the server holds the session·playback position·switching decision and pushes the media. Over HTTP the server becomes a file server independent per request, and all of that state moves to the client.*

> **Term** — **stateless**: the property that the server maintains no per-client state between requests.
> Each request must be interpretable on its own, and in exchange the request must carry the needed context
> itself.

Writing out what moved, item by item:

| What | Dedicated protocol | HTTP + HLS |
|---|---|---|
| Playback position | the server knows | **only the client knows** |
| What to send next | the server decides | **the client requests** |
| Quality-switch decision | the server does | **the client does** |
| Buffer state | reported to the server | only inside the client |
| Judging delivery completeness | the server knows when the session ends | **nobody knows** |

The last row is the starting point of this course. The server is not in a position to know the fact "this
client did not receive segment 5." The client too knows only that what it requested arrived, not whether
what arrived is **correct**, unless it checks separately. Chapter 1's measurement —

```
one 6s segment missing → ffmpeg exit code 0, output length 30.03s (identical to clean)
                       → in reality the 5.99s ~ 12.02s span is entirely empty
```

— is a result that follows logically from this structure. The party responsible for noticing the loss does
not, by design, exist.

---

## 2.3 ABR — what it gained and the price

### 2.3.1 The principle

Once segments became independent files, an unexpected possibility opened. **Make the same time span in
several qualities, and playback continues even if you pick a different quality per piece.**

> **Term** — **ABR (adaptive bitrate streaming)**: a method that encodes the same content at several
> bitrates and lets the client, according to the network conditions it measures, switch quality per segment
> as it receives.

> **Term** — **ladder / variant**: the set of quality candidates prepared for one piece of content is the
> ladder, and each candidate is a variant. In HLS one `#EXT-X-STREAM-INF` line in the master playlist
> declares one variant. Its formal name in RFC 8216 is **Variant Stream** — a distinct concept from a
> **rendition** declared with `#EXT-X-MEDIA` (an alternate audio·subtitle track of the same program), so
> the two are not used interchangeably.

**The deciding party is the client.** The server merely puts out a candidate list, and what to receive the
client decides by its own measurement. That the "quality-switch decision" row moved right in §2.2.3's table
is exactly this.

### 2.3.2 Price ① — the reaction is necessarily one piece late

![ABR's reaction lag](/images/lecture/hls-recon/02-abr-lag.svg)

*Figure 2-2 — even if bandwidth drops during the receipt of segment N, the throughput measurement is not complete until N is fully received. So the first piece to which the new quality applies is N+1, and the lower bound of the reaction lag is one segment length.*

This lower bound is not something you can remove by writing a good implementation. It is because **the
moment the observation completes is structurally tied to the piece boundary.** So the segment length becomes
a value pulled in two directions at once.

| Short segment | Long segment |
|---|---|
| fast reaction | slow reaction |
| lower live latency | higher live latency |
| more requests (header·connection·TLS-resumption overhead) | fewer requests |
| worse encoding efficiency — each piece needs a keyframe | better encoding efficiency |
| longer manifest | shorter manifest |

The HLS spec has you declare the upper bound of this value with `#EXT-X-TARGETDURATION`, and this repository
keeps it as is ([`playlist.py:156`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L156), [`playlist.py:297-298`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L297-L298)). It is used in the verdict too — if the difference
between measured and declared length is at least `TARGETDURATION`, at least one segment is entirely off, so
it is judged **FAIL** ([`report.py:264-272`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L264-L272)).

### 2.3.3 Price ② — the candidates' boundaries must be aligned

To switch quality, **the segment boundaries must sit at the same time in every candidate**, and at each
boundary there must be an independently decodable frame.

> **Term** — **IDR frame (Instantaneous Decoder Refresh)**: an H.264/H.265 independent frame from which you
> may start decoding. Since it references no previous frame, this is the only point where you can cut a
> piece. The group between IDRs is called a GOP (Group of Pictures).

This constraint shows up directly in the encoding settings. This repository's test-stream generation does so.

```bash
# tests/run.sh:40
  -c:v libx264 -preset ultrafast -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p \
```

`-g 60 -keyint_min 60` **fixes** the GOP length to 60 frames, and `-sc_threshold 0` turns off the encoder
arbitrarily inserting a keyframe at a scene change. At 30fps an IDR lands exactly every 2 seconds, and
cutting with `-hls_time 6` always makes the boundary fall on an IDR.

**What breaks if you do not do this** — if the encoder freely inserts a keyframe at every scene change, the
segment-boundary time differs per candidate. Then overlapping or empty spans appear at switch points, and
from the verification tool's standpoint **the very baseline for distinguishing normal delivery from loss
disappears.** This is why this repository's regression tests require deterministic boundaries.

### 2.3.4 Price ③ — encoding·storage·cache grow by the number of candidates

A 5-rung ladder is 5 encodes, 5 stores, 5 caches. And this multiplier is **multiplied by the subtitle·
multilingual audio tracks.** At service scale this is not a trivial cost, and it is why ladder design itself
became an engineering discipline.

---

## 2.4 The code — two data structures holding two axes

This repository's parser moved the structure of §2.2–2.3 almost directly into data structures. The module
docstring declares that distinction first.

```python
# playlist.py:1-5
"""M3U8 playlist parser (RFC 8216).

Parses the master playlist (the list of quality candidates) and the media playlist
(the list of segments) at the same entry point, distinguishing which by
`Playlist.is_master`.
"""
```

The two kinds of playlist come in through **the same `parse()`** into one `Playlist`. Inside it, two
different lists are filled — `variants` and `segments`.

### 2.4.1 `Variant` — the quality axis

```python
# playlist.py:102-113
@dataclass
class Variant:
    """#EXT-X-STREAM-INF — one quality candidate of the master playlist."""

    uri: str
    bandwidth: int = 0
    resolution: str = ""
    codecs: str = ""
    frame_rate: float = 0.0
    name: str = ""
    subtitles_group: str = ""  # SUBTITLES="..." — the subtitle group attached to this candidate
    audio_group: str = ""  # AUDIO="..."
```

What to read is the **field that is not here.** `Variant` has neither `duration` nor `seq`. It means there
is not a single piece of timeline information. The one question this data structure answers is — **"how fat
a pipe do I need, and what do I get in return."**

And there is a more important fact. **All eight of these fields are self-reported values from the server.**
Even if `BANDWIDTH` says 1.4Mbps, there is no guarantee the bytes that actually arrive are that much, and
even if `RESOLUTION=640x360` is written, there is no guarantee the video inside the segment is that
resolution. The spec has no way to force these values to be true — because there is no party to force them
(§2.2.3). This repository does not cross-check them either (see §2.7).

Only `height` is a computed value ([`playlist.py:115-122`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L115-L122)). It reads what follows `x` in the `RESOLUTION`
string as an integer, but on failure silently returns `0` — **a parse failure is absorbed into the same
state as "resolution not stated," not raised as an exception.** It means a delivery with no notation and one
with broken notation are not distinguished, and that judgment shows up directly in the later `pick_variant`
error message.

### 2.4.2 `Segment` — the time axis

```python
# playlist.py:135-146
@dataclass
class Segment:
    """One segment piece of the media playlist."""

    uri: str
    duration: float
    seq: int  # media sequence number — used to derive the default AES-128 IV
    index: int  # 0-based order within the playlist
    key: Key | None = None
    byterange: tuple[int, int] | None = None  # (length, offset)
    discontinuity: bool = False
    title: str = ""
```

Here there is neither `bandwidth` nor `resolution`. It is symmetric — **the two data structures hold two
orthogonal axes, and that is precisely the reason the master/media two-tier structure exists** (details in
Chapter 3).

That `seq` and `index` are **both** present is the crux of this dataclass.

> **Term** — **media sequence number**: a serial number attached to a segment globally across the playlist.
> The start value is set by `#EXT-X-MEDIA-SEQUENCE`, and it increments by 1 per segment thereafter. In live,
> when the window slides forward, the same segment moves forward in the list but this number does not change.

| Field | number of what | where it comes from | what breaks if wrong |
|---|---|---|---|
| `seq` | position across the whole delivery | `#EXT-X-MEDIA-SEQUENCE` + accumulation ([`playlist.py:300-302`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L300-L302), `248`) | **AES-128 decryption breaks.** with no IV attribute, this number becomes the 128-bit IV |
| `index` | 0-based order within this list | `len(pl.segments)` ([`playlist.py:241`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L241)) | reporting·diagnostic references go off |

VOD usually has `#EXT-X-MEDIA-SEQUENCE` at 0, so the two become the same value, and so **they look like they
could be merged into one.** They diverge the moment the window slides in live. An implementation that merged
them passes all the VOD tests and then decryption breaks in live — the kind of failure whose reproduction
condition is so narrow it is hard to find the cause.

### 2.4.3 The parser cannot help being a state machine

M3U8 has the structure "a tag line modifies the **URI line that comes next**." One line cannot be
interpreted independently, so the parser inevitably has state. That state is all declared at the head of the
function.

```python
# playlist.py:215-221
    cur_key: Key | None = None
    cur_inf: tuple[float, str] | None = None
    cur_range: tuple[int, int] | None = None
    pending_disc = False
    prev_range_end = 0
    seq = 0
    pending_variant: Variant | None = None
```

And when it meets a URI line, it consumes the accumulated state.

```python
# playlist.py:227-234
        if not line.startswith("#"):
            # a non-tag line = the URI the preceding tag points to
            uri = _absolute(base_url, line)
            if pending_variant is not None:
                pending_variant.uri = uri
                pl.variants.append(pending_variant)
                pending_variant = None
            elif cur_inf is not None:
```

That the post-consumption handling differs per tag is decisive.

```python
# playlist.py:248-253
                seq += 1
                cur_inf = None
                if cur_range:
                    prev_range_end = cur_range[1] + cur_range[0]
                cur_range = None
                pending_disc = False
```

**`cur_key` is not in this list.** That is deliberate. Organizing the effective scope of each tag into a
table shows why.

| Tag | effective scope | expression in code | if you reset it wrong |
|---|---|---|---|
| `#EXTINF` | the very next URI, **one** | `cur_inf = None` (249) | not clearing it makes a URI line with no `EXTINF` be mistaken for a segment |
| `#EXT-X-DISCONTINUITY` | the very next segment, **one** | `pending_disc = False` (253) | not clearing it marks every subsequent segment as discontinuous |
| `#EXT-X-BYTERANGE` | the next URI, one. but with offset omitted, **inherits the end of the previous range** | after updating `prev_range_end`, `cur_range = None` (250-252) | not inheriting makes every offset-omitted segment point to the file's start |
| `#EXT-X-KEY` | **every subsequent segment** — until the next `EXT-X-KEY` | not reset | clearing it makes **decryption fail from the second segment on** |

Within the same file, some state must be used once and thrown away, some must be maintained, and some must
**carry over** to the next value. Write it as "just clear everything" without drawing the state machine and
it silently goes wrong at the last line — no exception even, the decryption result becoming garbage that
flows all the way to the container-identification step.

### 2.4.4 The client chooses — and leaves the basis

ABR's "the decision rests with the client" shows up in code like this.

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

Three things can be read.

1. **`height` is strict.** If there is no exactly matching candidate, it does not silently substitute a near
   one but **raises an exception and puts the available list in the error message.** Because silently
   receiving 1080p when you requested 720p is the worst behavior in a verification tool — every measurement
   afterward becomes that of a different target.
2. **`max_bandwidth` is lenient.** If there is not a single candidate under the cap, it leaves `pool` as is
   and picks the maximum (`201-203`). That is, **it can exceed the cap.** It reads as the judgment "exceeding
   is better than unplayable," but this asymmetry of the two arguments is undocumented (§2.7).
3. **The default is the highest quality.** As a verification tool, "look at the heaviest path" is reasonable.
   A real player would be the opposite — it usually starts low and climbs.

And the selection does not happen quietly.

```python
# cli.py:179-184
    _eprint(f"  master playlist — {len(pl.variants)} quality candidates")
    for v in sorted(pl.variants, key=lambda x: -x.bandwidth):
        _eprint(f"    · {v.label()}")

    chosen = pl.pick_variant(height=args.height, max_bandwidth=args.max_bandwidth)
    _eprint(f"  chosen: {chosen.label()}")
```

**It lists all candidates first, then prints the selection.** Automatic selection gives convenience but hides
"among what was what chosen." In a tool that produces measurements, that hiding means irreproducibility, so
it flushes the basis to standard error.

The ladder used for local reproduction looks like this.

```
# tests/run.sh:60-65 — a 2-rung ladder
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1400000,RESOLUTION=640x360,NAME="360p",CODECS="avc1.42c01e,mp4a.40.2"
high.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=480000,RESOLUTION=320x180,NAME="180p",CODECS="avc1.42c00f,mp4a.40.2"
low.m3u8
```

The regression test **explicitly selects the low side** with `--height 180` (`tests/run.sh:176`). It must
pick the opposite of the default (maximum bandwidth) so that `pick_variant`'s selection path actually runs —
test with the default and an "implementation that ignores the argument" also passes.

### 2.4.5 This tool does not do ABR

It is an important point, so state it clearly. `pick_variant` **chooses once and is done.** There is no code
in this repository that measures bandwidth mid-receipt and switches candidates. It is a **deliberate discard
of ABR's A (adaptive).**

The reason comes from the nature of a verification tool. If the quality changes during a run, the
measurement target differs per run and **the results cannot be compared.** Per-segment TTFB p95, total bytes,
resolution — all become values dependent on "which candidate it was." Reproducibility and adaptivity collide
head-on here, and this tool chose reproducibility.

The same judgment appears once more in live.

```python
# playlist.py:163-166
    @property
    def is_live(self) -> bool:
        """No ENDLIST means an in-progress live delivery."""
        return not self.is_master and not self.has_endlist
```

```python
# cli.py:399-401
    if pl.is_live:
        _eprint("  · LIVE playlist → switching to remux mode (snapshot measurement impossible)")
        return "remux"
```

The **absence** of `#EXT-X-ENDLIST` is the basis for the live verdict — the signal is not presence but
absence. In live, the list differs each time you GET the manifest again, so "the whole set that should be
received" is not defined in the first place. The very premise of per-segment measurement does not hold, so
this tool gives up measuring and delegates to ffmpeg. **Not pretending to measure a condition that cannot be
measured** is the content of the judgment.

---

## 2.5 Generalization — pieces and a list, and the missing field

### 2.5.1 The general form of "push state to the client"

What HLS did is not special. The same trade repeats at several layers.

| System | state the server put down | what the client received instead | the price |
|---|---|---|---|
| REST / stateless HTTP | the session | a token carried in every request | per-request authentication cost, immediate privilege on token leak |
| JWT | the session store | signed claims | **revocation is hard** — because the server chose to hold no state |
| Cursor-based pagination | "how far you have read" | a cursor string | the server cannot distinguish a request with a manipulated cursor |
| DNS | change notification | TTL + re-query | a refresh delay of up to the TTL |
| **HLS** | playback position·quality decision | the manifest | **nobody knows whether delivery completed** |

The common structure is summarized like this.

> **Push state to the client and the server gains scalability and loses the authority to judge that state.
> What cannot be judged cannot be guaranteed.**

### 2.5.2 The general form of "chop up something big and point with a list" — and the one thing HLS omitted

The piece + list structure is not HLS's invention either. But set it side by side with other systems and
**the field HLS alone lacks** stands out.

| System | list (manifest) | piece | basis for the piece's integrity |
|---|---|---|---|
| BitTorrent | `.torrent` / magnet | piece | **a per-piece hash is in the list** |
| Git | tree · commit object | blob | **content-addressed — the name is the hash** |
| OCI container image | image manifest | layer | **a per-layer digest is in the manifest** |
| Debian APT | `Packages` · `Release` | `.deb` | **a per-file hash + a signature on `Release`** |
| **HLS** | `.m3u8` | media segment | **none** — just the URI and playback length |

RFC 8216 has no attribute holding a media segment's hash·digest. The objection "isn't there `#EXT-X-KEY`"
does not hold.

> **Term** — **unauthenticated encryption**: encryption that provides only confidentiality, not integrity·
> origin authentication. HLS's AES-128-CBC is one of these — with no authentication tag, even if the
> ciphertext is tampered with, decryption simply produces "a different plaintext."

That is, **even in an encrypted HLS stream you cannot know whether a piece was changed or is missing.**
Encryption does not give integrity.

The last row of this table is the reason this whole course exists. For the other four, the list itself
answers "is what was received correct." HLS does not answer, so there must be a separate **tool that opens the
bytes directly and checks.** That is what this repository does — the MPEG-TS continuity counter
([`tsanalyze.py:71-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L71-L121)), container identification ([`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37)), the timeline gap
scan ([`probe.py:191-233`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L191-L233)) are all **the work of recovering directly from the bytes the questions the manifest
does not answer.**

---

## 2.6 Security — what stateless transport left to access control

### 2.6.1 With no session, control is pushed onto the request itself

Since the server chose to hold no session, "is this person allowed to receive this segment" must be judged
**by what is inside the request alone.** There are only three materials for judgment.

| Material | actual implementation | fundamental nature | this course's chapter |
|---|---|---|---|
| URL string | signed URL — `?md5=<signature>&expires=<unix>` | the capability is carried in a string. **if the URL leaks, the privilege leaks** | Chapter 11 |
| Request header | `Referer`, `Origin`, `User-Agent` | **entirely the client's self-report** — a request, not a control | Chapters 9·10 |
| Cookie·token | session cookie, Bearer token | ambient privilege — left in process lists·shell history·CI artifacts | Chapter 12 |

All three are weak for the same reason. **Because the server discarded state, the request must prove itself,
and all the proof material is written by the client.** All of Part 3 is the unfolding of this one sentence.

### 2.6.2 The CDN adds one more layer on top

In §2.1 the reason for choosing HTTP was reusing CDN infrastructure. That reuse comes with a structural
consequence.

> **The place that judges authorization (origin) and the place that hands out bytes (edge) are separated.**

If the edge responds with a cache hit, **the origin's authorization logic does not run at all.** So access
control has no choice but to be carried in the URL itself (signed URL), and here an unavoidable trade arises.

| Put a user identifier in the cache key | Result |
|---|---|
| **Yes** | the cache splits per user and the CDN's benefit disappears |
| **No** | authorization is possible only by URL signing, and a signed URL is **valid for anyone until expiry** |

This is why a signed URL's expiry time gets short, and at the same time why that short expiry creates a
constraint (late resolution) on the client implementation (Chapter 11).

### 2.6.3 The manifest gives the whole map in plaintext

Receive one `.m3u8` and the following are revealed at once.

- the absolute URIs of **all** segments and each one's playback length
- the whole quality ladder — every quality that exists and its bandwidth
- all the subtitle·multilingual audio tracks and their addresses
- whether it is encrypted and the **key-distribution URI** (`#EXT-X-KEY:URI=...`)

In a setup where access control is put on the manifest only and not on the segments — a common failure —
**one manifest leak is a whole leak.** The skeleton of what this repository does is exactly an exploitation
of that structure. It gets the whole list with one `parse()` ([`playlist.py:207-337`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L207-L337)), and receives it in
parallel with `fetch.get_many` ([`fetch.py:223-243`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L223-L243)). What in a dedicated protocol you could get only by
dragging a session sequentially is here a single sheet of text.

### 2.6.4 The segment-size sequence is not hidden by TLS

A side effect ABR created. When segments are variable-bitrate encoded, each piece has a different byte size,
and **that size sequence differs per content.** HTTPS hides the content but the response's size and timing
are observable, so room remains for a passive observer to infer "what is being watched." Identifying
encrypted video traffic is a known subject with several results in the literature.

What is interesting is that this repository is **already recording** the raw material of that fingerprint.

```python
# fetch.py:82-89 (excerpt)
    wire_size: int = 0  # bytes that actually crossed the wire (compressed state)
    ...
    sha256: str = ""
```

The fact that a measurement kept for verification can also be a value usable for identification is the kind
of symmetry to reflect on when building an observation tool. Only, **this repository has never measured that
identifiability** (§2.7).

### 2.6.5 The server does not know about viewing

With no session, all the server knows is "some URI was requested." Whether it was played, whether a human
watched, how many times — it does not know. So viewership measurement·billing·concurrency limits all come to
depend on a **separate reporting channel the client sends**, and since the client sends it, that channel
inherits the "self-report" problem of §2.6.1 as is. Even if you try to substitute segment-request logs,
prefetch and cache hits make the request count and the viewing time not match.

### 2.6.6 The defender's view — what to do, by role

| Role | what to do |
|---|---|
| **Delivery platform operator** | do not put access control on the **manifest only.** the segment URIs must be under the same policy. a setup where one manifest leak becomes a whole leak is the most common failure |
| **CDN designer** | design **on the premise** that authorization judgment and cache response are separate. the trade in §2.6.2 cannot be avoided, so document explicitly which side you chose to avoid misunderstanding in operation |
| **Security reviewer** | do not accept "it is HTTPS so it is safe" at face value. segment size·timing sequences are not hidden by TLS. and **AES-128-CBC does not give integrity** — whether it is encrypted and whether tampering is detected must be reviewed as separate items |
| **Client·player implementer** | the manifest is **untrusted input.** since the parser is a state machine (§2.4.3), you need bounds for out-of-order tags, out-of-range integers, and an abnormally large segment count. you must also check whether a segment URI leaves the expected host |
| **Verification-tool author** | the fact that the manifest has no integrity field (§2.5.2) is the tool's reason for existing. what the list does not answer you must recover **directly from the bytes**, and document that check's miss rate along with it |
| **Network operator** | segment delivery is an ordinary HTTP GET, so a separate "streaming traffic" classification does not hold. port·protocol-based policy has no effect on this traffic |

---

## 2.7 Limits and open questions

Noted here: what this chapter could not back up with code, and what this code does not do.

- **The historical motivation is an organization, not a measurement.** The six items of §2.1 are an
  organization based on the literature and common understanding, and the situations where RTMP·RTSP actually
  get blocked were not reproduced in this repository. The real basis for a particular operator's move to HLS
  is known only to that operator.
- **`BANDWIDTH`·`RESOLUTION`·`CODECS` are not cross-checked.** [`probe.py:154-155`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L154-L155) reads the measured
  `width`/`height`, but `report.py` has no code comparing that value against `Variant.resolution`. **Declare
  1080p and send 360p and this tool passes it.** It is a place where one check item is empty.
- **The `max_bandwidth` cap is not enforced** ([`playlist.py:200-203`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L200-L203)). If there is no candidate under it, it
  picks an over-cap candidate. It looks intentional, but appears in neither the docs nor the error message,
  so a user may believe the cap was honored. It is asymmetric with `height`'s strictness.
- **A missing `BANDWIDTH` is not rejected** ([`playlist.py:264`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L264)). It is a required attribute in RFC 8216,
  yet the parser gives a default of 0. If every candidate is 0, `max(...)`'s selection is effectively
  determined by list order.
- **A mixed master/media document is not rejected.** `parse()` fills both lists even if
  `#EXT-X-STREAM-INF` and `#EXTINF` are mixed in the same document. The rejection looks only at
  `media.is_master` upstream ([`cli.py:192-193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L192-L193)).
- **This tool does not implement ABR's adaptive behavior** (§2.4.5). Therefore a real player's switch
  timing·buffer policy·bandwidth-estimation algorithm cannot be backed by code in this course. The
  reaction-lag lower bound of §2.3.2 is an argument that follows from the structure, not a measurement of
  this repository.
- **Live's temporal nature was observed only with a single snapshot.** There is no code that re-fetches the
  manifest at the `TARGETDURATION` period to follow the window sliding ([`cli.py:399-401`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L399-L401), the README's
  known limits).
- **The segment-size fingerprint (§2.6.4) was not measured in this repository.** It records `wire_size` and
  `sha256`, but has never evaluated content identifiability with them. What was cited is a known result from
  outside literature.

---

## 2.8 Summary

1. **HTTP was chosen not for technical superiority but for the ability to get through.** Five of the six
   constraints — firewall·NAT·cache·CDN·scaling·TLS — have nothing to do with protocol quality, and the
   already-deployed infrastructure determined the design space.
2. There are two inventions — **cutting the timeline into independent files**, and **pointing to those pieces
   with a text list.** At this moment streaming is reduced to file download and the six constraints of §2.1
   are solved all at once.
3. In exchange, **all the playback state moved from server to client.** Playback position·next request·
   quality decision, and even **the place to judge whether delivery completed**, moved. The server can no
   longer know it — Chapter 1's "the total length matches but the middle is empty" is the logical consequence
   of this structure.
4. **ABR's reaction is necessarily one piece late.** Because the throughput measurement is not complete until
   segment receipt finishes, and it is not a delay removable by implementation. Segment length is a trade
   between reaction speed and overhead·encoding efficiency.
5. `Variant` ([`playlist.py:102-132`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L102-L132)) and `Segment` ([`playlist.py:135-146`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L135-L146)) hold **two orthogonal
   axes** — quality and time. All of `Variant`'s fields are the server's self-report, and this repository
   does not cross-check them against measurement.
6. **An M3U8 parser cannot help being a state machine.** Each tag has a different scope, so some state is
   thrown away after consumption (`cur_inf`), some maintained (`cur_key`), some carried to the next
   (`prev_range_end`). Clear `cur_key` along with the rest and **decryption breaks from the second segment on.**
7. **An HLS manifest has no piece-integrity information.** BitTorrent·Git·OCI·APT all put a hash or signature
   in the list. HLS has only the URI and playback length, and AES-128-CBC is unauthenticated encryption that
   gives only confidentiality. **This blank is why a verification tool like this repository exists.**
8. Stateless transport pushes access control onto three things — **the URL string·self-reported headers·
   ambient credentials** — and the CDN cache separates authorization judgment from byte delivery. All of
   Part 3 is the unfolding of this structure.

---

**Next chapter** — this chapter used only as a premise the fact that the manifest is not one layer but two.
The two-tier indirection where the master playlist points to the media playlist and the media playlist points
to the segments enables ABR but in exchange **changes the URL-resolution reference point twice and creates
one more point of failure.** Chapter 3 reads what that structure gains and loses in
[`playlist.py:185-204`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L185-L204) and [`cli.py:172-196`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L172-L196).
