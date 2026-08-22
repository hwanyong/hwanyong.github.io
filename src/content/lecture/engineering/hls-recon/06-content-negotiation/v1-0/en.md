---
title: "The Side Effects of Content Negotiation"
description: "Compression, ranges, and the collision"
date: 2026-06-01
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-06-content-negotiation.svg
---
## 6.0 What this chapter answers

1. Why does compression you did not even request arrive, and what breaks if you do not decompress it?
2. When Range and Content-Encoding overlap, **what is left undefined?**
3. Why is it wrong to measure throughput by the decompressed size — a number counting what?
4. Why is the code that decompresses itself an attack surface — **this repository's actual unguarded point?**

The four questions share one root. HTTP stands on the premise "one address may have several
representations," and that premise **shakes "what is this byte sequence a byte sequence of."**

---

## 6.1 The problem — the playlist arrives as binary

This repository's regression test spins up a dedicated server that returns only compressed responses. The
reason is written at the head of the file.

```python
# tests/gzip_server.py:1-6
"""A test server that responds to playlists only in gzip.

Python's built-in http.server does no compression at all and cannot reproduce this path.
A real CDN sometimes, seeing the browser User-Agent, compresses regardless of what the
client requested, and if you do not decompress then the playlist looks like binary and
fails as 'no #EXTM3U header'.
"""
```

The symptom appears in the parser but the cause is in the transport layer. The playlist parser looks only at
whether the first line is `#EXTM3U`, but if the received body is gzip, its first two bytes are `1f 8b`. To
the parser this is "something that is not M3U8," and it can say no more.

So this repository drags the diagnosis down to the transport layer ([`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)). Output obtained by
actually calling that function.

```
a response that cannot be interpreted as a playlist: http://cdn/index.m3u8

  HTTP status     : 200
  Content-Type    : application/vnd.apple.mpegurl
  Content-Encoding: (none)
  body size       : 770 B
  leading bytes   : 1f8b08000000000002ff7dd64d4a9c51
  leading chars   : ..........}.MJ.Q.....p..T....`'.I...n@....b..Q.;

  → it is gzip but Content-Encoding was not declared. a server-config problem.
```

The situation in which this diagnosis came out has three values overlapping — status 200, Content-Type
normal, and yet the body's leading bytes are `1f 8b`. There is a branch, explicit in the code, that splits it
off by looking at those leading two bytes.

```python
# cli.py:80-81
elif res.body[:2] == b"\x1f\x8b":
    lines.append("  → it is gzip but Content-Encoding was not declared. a server-config problem.")
```

Here the shape of the failure splits in two. The two differ in who is responsible, and which side fixes it.

| Case | What the server sent | What the client should do | Responsibility |
|---|---|---|---|
| **(a) declared compression** | `Content-Encoding: gzip` + gzip body | decompress as declared | client — do not, and it is your fault |
| **(b) undeclared compression** | no header + gzip body | there is nothing to do by spec. only diagnose | **server** — a spec violation |

You could make a client that auto-decompresses (b). But that is using the content sniffing seen in Chapter 14
for a **processing decision, not a determination**, and the moment you do, a false-positive path opens: "a
normal segment whose leading two bytes happen to be `1f 8b`." This repository does not fix (b) but **only
reports** it.

And there is this chapter's second problem. It is when the playlist is written like this.

```
#EXT-X-BYTERANGE:500000@1500000
segment.ts
```

The segment is not a whole file but **a byte span within one file.** When compression overlaps here, what
does it become — that is §6.3's subject.

---

## 6.2 The principle — what is content negotiation?

> **Term** — **content negotiation**: when one URI has several representations, the procedure of deciding
> which to send by the client's preference and the server's judgment.

> **Term** — **representation**: a resource's byte sequence at a specific time·in a specific format plus its
> metadata. One resource can have several representations — the Korean edition and the English edition, the
> gzip edition and the uncompressed edition are all different representations of the same resource.

> **Term** — **content coding**: a transformation (mainly compression) applied to a representation's byte
> sequence. `Content-Encoding` declares this. It is **part of the representation** and is end-to-end.

This chapter's conclusion already follows from these definitions. **Compression is not a transport method
but a property of the representation.** A gzip-compressed playlist is not "the same thing sent differently"
but **a different representation.**

### 6.2.1 There are several negotiation axes, and each differs in nature

| Request header | What it negotiates | On failure |
|---|---|---|
| `Accept` | media type | 406, or the server picks arbitrarily |
| `Accept-Language` | natural language | the default language |
| `Accept-Encoding` | **content coding (compression)** | **the client cannot read the body** |
| `User-Agent` | an off-spec axis — used in practice as the basis for compression·layout branching | unpredictable |

Only `Accept-Encoding` differs in nature. The other axes end at receiving "something less good," but go off
on this axis and **the body becomes an undecodable byte sequence entirely.** §6.1's symptom is that.

That `User-Agent` is in the table is this code's observation.

```python
# fetch.py:24-27
# requesting with a browser UA, servers commonly return a compressed response. request it up front and
# decompress it ourselves — for a text playlist the transfer volume drops greatly.
# brotli(br) cannot be decompressed with the standard library, so we do not request it.
ACCEPT_ENCODING = "gzip, deflate"
```

Use a browser UA ([`fetch.py:20-23`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L20-L23)) and the chance the server returns compression rises. That is, **a
disguise on one axis changes the result on another axis.** The negotiation axes are not independent.

### 6.2.2 Negotiation is a preference, not a command

`Accept-Encoding: identity` is not "do not compress" but the **statement** "the uncompressed representation
is what I can receive." The spec asks the server to respect this only at the SHOULD level, with no means to
enforce it. This repository's test server is precisely that counterexample.

```python
# tests/gzip_server.py:31-38
self.send_response(200)
self.send_header("Content-Type", _content_type(target.suffix))
if compress:
    # compress and send regardless of what the client sent in Accept-Encoding.
    self.send_header("Content-Encoding", "gzip")
self.send_header("Content-Length", str(len(body)))
self.end_headers()
self.wfile.write(body)
```

And the regression test **separately verifies whether that ignoring actually happens.**

```bash
# tests/run.sh:189-192
# if you do not even request compression, this path is not verified in the first place.
curl -s -H 'Accept-Encoding: identity' -o /dev/null -D - \
  "http://127.0.0.1:$GZIP_PORT/plain/index.m3u8" | grep -qi 'content-encoding: gzip' \
  && ok "the test server actually compresses the response" || bad "the test server does not compress"
```

This is the **test oracle problem** of Part 8 (Chapter 34) appearing at the transport layer. The fact that
"the decompression path passed" is information **only when the server actually sent compression.** If the
server does not send compression, the decompression code runs not a single line while the test lights up
green. So the test checks not the tool but **the environment first.**

A response confirmed directly.

```
$ curl -s -D - -o /dev/null -H 'Accept-Encoding: identity' http://127.0.0.1:8991/index.m3u8
HTTP/1.0 200 OK
Content-Type: application/vnd.apple.mpegurl
Content-Encoding: gzip
Content-Length: 770
```

Asked for `identity`, got `gzip`. **The guarantee the client got from the request header is 0.**

### 6.2.3 Content coding and transfer coding are different layers

> **Term** — **transfer coding**: an encoding applied only over one hop's span. `Transfer-Encoding: chunked`
> is representative. It can be stripped when moving to the next hop.

The reason this distinction is needed in this chapter is one. **A range request applies to content coding
but not to transfer coding.** A body arriving cut by `chunked` becomes the original representation once a
proxy rejoins it, but `gzip` is not stripped and remains part of the representation. So the answer to the
question "which byte" splits only for content coding.

---

## 6.3 What the spec determines — and what it does not

### 6.3.1 Two specs use different origins

In HTTP (RFC 9110) a byte range is counted over the **selected representation.** A content coding is already
applied to the representation, so `Range: bytes=0-99` means **the 0–99 of the compressed bytes.**

HLS's (RFC 8216 §4.3.2.2) `EXT-X-BYTERANGE`, in `n@o` notation, means **"a sub-span of the resource the URI
points to."** Here the offset is relative to the file on disk, i.e., the **uncompressed bytes.** When the
tool that made the segment (the packager) computed that offset, gzip did not even exist.

This repository's parser moves that notation over as is.

```python
# playlist.py:327-329
elif line.startswith("#EXT-X-BYTERANGE:"):
    n, _, o = line.split(":", 1)[1].partition("@")
    cur_range = (int(n), int(o) if o else prev_range_end)
```

And the fetcher translates it into an HTTP header.

```python
# fetch.py:155-161
if byterange:
    length, offset = byterange
    headers["Range"] = f"bytes={offset}-{offset + length - 1}"
    # if compression applies to a partial request, the meaning of the byte range breaks.
    headers.setdefault("Accept-Encoding", "identity")
else:
    headers.setdefault("Accept-Encoding", ACCEPT_ENCODING)
```

**For the translation to hold, the two specs' origins must be the same.** With compression applied, they are
not.

![The two coordinate systems the same range request points to](/images/lecture/hls-recon/06-range-vs-encoding.svg)

*Figure 6-1 — the same `bytes=` number points to different places in the resource coordinate system and the representation coordinate system. In a compressed representation that position may not even exist.*

### 6.3.2 The server has four options, and the spec does not narrow it to one

Organizing where implementations can diverge on the same request (`Range: bytes=1500000-1999999`) is this.

| Server implementation | What it returns | What the client gets |
|---|---|---|
| **compress → truncate** | the 1.5M–2.0M span of the compressed representation | a middle fragment of the compressed stream. **cannot be decompressed on its own** |
| **truncate → compress** | compresses the resource's 1.5M–2.0M | decompress and it is the wanted span. but then `Content-Range`'s numbers are the resource coordinate system |
| **ignore Range** | 200 + the whole representation | the whole resource instead of the requested 500 KB |
| **judge range unsatisfiable** | 416 | failure. at least honest |

The first two rows are the crux. **Both can justify themselves by citing spec sentences.** The client has no
way to tell which from the received bytes alone — both cases can come as
`206` + `Content-Encoding: gzip` + `Content-Range: bytes 1500000-1999999/…`.

### 6.3.3 An arbitrary span of a compressed stream cannot be extracted and decompressed in the first place

Set aside all implementation branches and the "compress then truncate" side is blocked in principle.

| Reason | Content |
|---|---|
| **back-reference window** | DEFLATE (RFC 1951) encodes with length·distance pairs referencing up to the previous 32 KiB of output. start from the middle and there is no reference target |
| **bit alignment** | symbols do not align to byte boundaries. an arbitrary byte offset is not a symbol boundary either |
| **Huffman tables** | a dynamic Huffman block's code table is at the head of the block. a middle fragment has no table |
| **trailer** | gzip has a CRC32 and ISIZE at the end, zlib an Adler-32. a fragment has no verifier |

That is, "a part of the compressed representation" makes sense by spec but is **useless.** So [`fetch.py:159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L159)
does not pick an answer but **removes the question** — on a range request it gives up negotiation and demands
`identity`. It is the only way to make the two coordinate systems one.

> **If you do not do this** — send `gzip, deflate` as is on a range request and, when you meet a CDN that
> compresses, a different failure occurs per segment. Some die with `zlib.error`, some quietly return the
> wrong span, some return the whole file. **The cause is one line of a request header but the symptom appears
> in three forms.**

---

## 6.4 The code — five decisions

### 6.4.1 What to request

`ACCEPT_ENCODING = "gzip, deflate"` has two absences.

| Coding | Format | Python standard library | This code |
|---|---|---|---|
| `gzip` · `x-gzip` | RFC 1952 (deflate + header/trailer) | `gzip` | request·decompress |
| `deflate` | RFC 1950 (zlib wrapper) **or** RFC 1951 (raw) | `zlib` | request·decompress (try both) |
| `br` | RFC 7932 (Brotli) | **none** | not requested |
| `zstd` | RFC 8878 (Zstandard) | `compression.zstd` from 3.14 | not requested |
| `identity` | no transform | — | forced on range requests |

The reason it does not request brotli is not a performance judgment but a **dependency judgment.** What this
repository declared in `pyproject.toml:10` is `requires-python = ">=3.10"`, and the only third-party
dependency is `cryptography` for decryption (`pyproject.toml:25`), so the compression path uses only the
standard library. Request `br` and be unable to decompress it and you bring §6.1's (a) on yourself.

**"A coding you did not request does not come"** is, as seen in §6.2.2, not a guarantee either. So on meeting
an unknown coding the decompressor does not pass it quietly but throws an exception ([`fetch.py:70`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L70)).

zstd entered the standard library in Python 3.14 (PEP 784). But the lower bound this repository declared is
3.10, so adopting it now is the same as **raising the lower bound to 3.14.** It is a trade of an executable
environment for a compression ratio, and this code did not make that trade.

### 6.4.2 What to decompress

```python
# fetch.py:57-70
def _decompress(body: bytes, encoding: str) -> bytes:
    """Decompress the body according to Content-Encoding."""
    enc = encoding.lower().strip()
    if not body or enc in ("", "identity"):
        return body
    if enc in ("gzip", "x-gzip"):
        return gzip.decompress(body)
    if enc == "deflate":
        # some servers attach a zlib wrapper and some send raw deflate, mixed.
        try:
            return zlib.decompress(body)
        except zlib.error:
            return zlib.decompress(body, -zlib.MAX_WBITS)
    raise ValueError(f"cannot decompress Content-Encoding: {encoding}")
```

You could say the double attempt of `deflate` is the whole of this function. **The single name `deflate`
points to two formats.**

- what the spec means: RFC 1950's **zlib wrapper** (2-byte header + DEFLATE + Adler-32)
- part of what actually comes: RFC 1951's **raw DEFLATE** (no wrapper)

Compress the same input in the two ways and compare the leading two bytes and the difference shows.

```
zlib wrapper:  78 9c …
raw deflate:   bd da …        ← the compressed data begins right away
```

In Python what splits the two is a single `wbits` argument. `zlib.decompress(body)` expects a wrapper, and
`zlib.decompress(body, -zlib.MAX_WBITS)` instructs "no wrapper" with a negative `wbits`. The actual failure
message is this.

```
decompress raw with zlib → zlib.error: Error -3 while decompressing data: incorrect header check
```

The order has meaning too. **Try the spec-conformant format first, and drop to the practice format on
failure.** Do it the other way and you first open room for a spec-following server to pass by chance on the
practice path.

> **If you do not do this** — an implementation calling `zlib.decompress` only once fails 100% on a server
> that sends raw deflate. And that failure surfaces as "the playlist has no `#EXTM3U`." The cause and the
> symptom are two layers apart, so looking at the log alone it seems the server sent the wrong file.

### 6.4.3 A decompression failure is not retried

The call site's handling is as important as this function.

```python
# fetch.py:170-180
with urllib.request.urlopen(req, timeout=self.timeout) as resp:
    ttfb = (time.perf_counter() - t0) * 1000
    raw = resp.read()
    total = (time.perf_counter() - t0) * 1000
    encoding = resp.headers.get("Content-Encoding", "") or ""
    try:
        body = _decompress(raw, encoding)
    except Exception as e:  # noqa: BLE001 — treat a decompression failure as a response corruption
        last_err = f"Content-Encoding={encoding} decompression failed: {e}"
        last_status = resp.status
        break
```

It is `break` — it **exits** the retry loop. This is the same logic as [`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201)'s "a 4xx gives
the same result on retry."

| Failure kind | Retry | Basis |
|---|---|---|
| connection error·timeout | **Yes** | the next attempt may differ |
| 4xx (except 408·429) | No | same request, same answer |
| **decompression failure** | **No** | if it would not decompress even though the whole body arrived, a re-request gives the same bytes |

If the body was cut off midway, `resp.read()` itself raises and goes to the general exception path
([`fetch.py:202`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L202)) and **is retried.** That is, this code distinguishes "cut off during transfer" and
"arrived but uninterpretable" as different events. The decompressor effectively acts as a **response-integrity
checker** — if gzip's CRC32 fails, it means the body is corrupt.

### 6.4.4 When to give up negotiation — the meaning of `setdefault`

The `identity` forcing at [`fetch.py:159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L159) is not `headers["…"] = …` but `setdefault`. It means a header the
user specified directly wins (the principle at [`fetch.py:146-150`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L146-L150)). **This defense is a default, not an
invariant.** A result confirmed directly.

| User input | Value actually sent (range request) | Reason |
|---|---|---|
| none | `identity` | `setdefault` fills it |
| `--header 'Accept-Encoding: gzip, deflate, br'` | `gzip, deflate, br` | the key already exists, so `setdefault` does not overwrite |
| `--header 'accept-encoding: br'` | **`identity`** | urllib normalizes the header name with `capitalize()`, so the two keys merge into one `Accept-encoding`, and the later-added side wins |

The third row is a measurement. `urllib.request.Request` does `capitalize()` on the name in `add_header`, so
`Accept-Encoding` and `accept-encoding` **become the same key.** HTTP header names are case-insensitive but a
Python dict is case-sensitive, so the merge result **differs by the input's case.** In the common usage where
a user copy-pastes a whole header block from devtools, this difference shows up directly.

The one fortunate thing is the behavior when `br` actually comes. `_decompress` throws a `ValueError` and the
request fails — **it does not go quietly wrong but fails loudly.** It is a choice this repository repeats in
several places (it looks opposite in direction to Chapter 24's padding handling, but both decisions aim at
the same goal: "reveal corruption at the spot").

### 6.4.5 What to measure — two sizes

`FetchResult` carries **two** sizes.

```python
# fetch.py:80-83
body: bytes = b""  # the body after decompression
size: int = 0  # size after decompression
wire_size: int = 0  # bytes that actually crossed the wire (compressed state)
encoding: str = ""  # the Content-Encoding as received
```

```python
# fetch.py:94-104
@property
def compressed(self) -> bool:
    return bool(self.encoding) and self.encoding.lower().strip() != "identity"

@property
def throughput_mbps(self) -> float:
    """It is line performance, so compute from actual transferred bytes, not the decompressed size."""
    wire = self.wire_size or self.size
    if self.total_ms <= 0 or not wire:
        return 0.0
    return (wire * 8) / (self.total_ms / 1000) / 1_000_000
```

Why this distinction is needed is answered by a measurement. The result of gzip-compressing a 300-segment VOD
playlist.

| Playlist | Original | gzip | Ratio |
|---|---|---|---|
| relative URIs (`seg000.ts`) | 8,464 B | 770 B | **11.0×** |
| signed absolute URLs (`https://cdn…?md5=…&expires=…`) | 30,988 B | 1,018 B | **30.4×** |

The second row is closer to real delivery. A signed URL (Chapter 11) repeats an almost identical string per
segment, so the compression ratio is extremely good.

**Compute throughput by the decompressed size and this line is reported as 30× faster.** A report is made
showing 3 Gbps on a 100 Mbps link. The moment a report proudly prints a physically impossible number, the
report's other numbers become untrustworthy too.

In sum, **the size to use differs by what you measure.**

| Metric | Size to use | Reason |
|---|---|---|
| throughput (Mbps) | `wire_size` | what crossed the wire is the compressed bytes |
| bandwidth billing·transfer volume | `wire_size` | what is billed is the transfer volume |
| disk·memory capacity | `size` | what is stored is the decompressed bytes |
| integrity hash | the `size` side (decompressed body) | see below |

That the hash is computed over the decompressed body ([`fetch.py:193`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L193)) is worth noting separately.

```python
sha256=hashlib.sha256(body).hexdigest(),
```

It is `body`, not `raw`. That way **the same segment does not have a different hash depending on whether it
was compressed.** The report's segment-duplication check ([`report.py:213`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L213)) compares the size of the hash
set, and if compressed and uncompressed responses are mixed, the same content shows as different hashes and
duplicates are missed. **The hash must be computed over the resource, not the representation** — this
chapter's coordinate-system problem appearing in the hash too.

The report shows the two sizes together.

```python
# report.py:183-196
compressed = [f for f in fetches if f.ok and f.compressed]
wire_bytes = sum(f.wire_size or f.size for f in fetches if f.ok)
rep.add(
    "response latency",
    WARN if _quantile(ttfb, 0.95) > 3000 else PASS,
    f"TTFB p50 {_quantile(ttfb, 0.5):.0f}ms / p95 {_quantile(ttfb, 0.95):.0f}ms, "
    f"throughput median {_quantile(tput, 0.5):.1f} Mbps"
    + (
        f", {len(compressed)} compressed transfers "
        f"({wire_bytes / 1e6:.1f}→{total_bytes / 1e6:.1f}MB)"
        if compressed
        else ""
    ),
)
```

It writes `(wire → decompressed)` side by side. It is the only record by which, in after-the-fact analysis,
you can discover "this CDN was compressing even the segments." For reference, **recompressing already-compressed
media only uses CPU and barely shrinks the size** — if these two numbers are similar, it is a basis to suspect
the server config.

---

## 6.5 Lab — reproducing an ignored range request yourself

This repository's test server does not implement `Range` at all (`tests/gzip_server.py:21-29` — it reads the
whole file and sends it as is). So you can reproduce the third row of §6.3.2's table, "ignore Range," as is.

```bash
python3 tests/gzip_server.py 8992 <directory_with_the_playlist> &
```

Using `Fetcher` as is, requested a 100-byte span.

```python
from hlsrecon.fetch import Fetcher
f = Fetcher(retries=1)
# a situation where the segment is declared as bytes 100-199 of the resource: (length, offset) = (100, 100)
r = f.get("http://127.0.0.1:8992/index.m3u8", byterange=(100, 100))
```

The result.

```
requested Range: bytes=100-199,  Accept-Encoding: identity forced
ok=True status=200 encoding='gzip'
wire_size=770  size=8464   (requested length=100)
body leading 24 bytes: b'#EXTM3U\n#EXT-X-VERSION:3'
```

**Four things went off at once.**

| Requested | Response | The code's reaction |
|---|---|---|
| `Range: bytes=100-199` | `200` (not 206) | does not check |
| 100 bytes | 8,464 bytes (84.6×) | does not check |
| `Accept-Encoding: identity` | `Content-Encoding: gzip` | **decompresses and accepts** |
| the resource's 100–199 span | the whole resource | `ok=True` |

Had it been used as a segment, that file contains **the whole resource** instead of "the resource's 100-byte
span." Had the resource been genuine media, `sniff()` (Chapter 14) would not catch it either — the content is
still normal MPEG-TS. **What is wrong is not the content but the boundary.**

This is one of the chapter's honest conclusions. **Forcing `identity` prevents the problem, but does not
check whether the prevention failed.** The request was made; the confirmation was not.

---

## 6.6 Generalization — to point at a part, the whole must be fixed to one

This chapter's collision is not streaming-specific. The general form is this.

> **When a feature that points at a "part" of some target by coordinates overlaps with a feature that
> transforms that target itself, the origin of the coordinates is left undefined.**

Places the same structure appears.

| Overlap | The wobbling coordinate | The symptom that appears |
|---|---|---|
| `Range` × `Content-Encoding` | the origin of the byte offset | this chapter |
| `Range` × several representations (`Vary`) | whose representation's offset | a resume joins fragments of different representations |
| `Content-Length` × compression | which size | a progress bar exceeds 100% or cannot fill it |
| `ETag` × compression | representation identity | if the compressed and uncompressed editions use the same ETag, the cache mixes them |
| string offset × encoding | byte or codepoint | truncation·index-off on a single emoji (Chapter 31) |
| URL offset × percent-encoding | before or after encoding | `%20` and `%2520` (Chapter 7) |
| DB `LIMIT/OFFSET` × unstable sort | row order | rows duplicate·drop at the page boundary |

The last row is the same form. The moment you request page 2, if the sort key has wobbled, the very pointing
"rows 21–40" loses its meaning.

**The form of the solution is always the same too.** One of three.

1. **Fix the coordinate system** — turn off the transform. `Accept-Encoding: identity` is this
2. **Attach the coordinate to the content** — use a cursor·key instead of an offset (keyset pagination)
3. **Verify identity** — send a strong validator (ETag) along and refuse if it is a different representation

HTTP has device 3 (`If-Range`), but this code chose 1. Because it is **the simplest and the only method the
client can decide alone.** 2·3 need the server's cooperation, and cooperation, as seen in §6.2.2, can be
requested but not secured.

---

## 6.7 Security

### 6.7.1 The decompression bomb — this repository's actual unguarded point

> **Term** — **decompression bomb / zip bomb**: data made small in its compressed state but that, when
> decompressed, exhausts the defender's memory·disk. A form of resource-exhaustion (DoS) attack.

`_decompress` calls `gzip.decompress(body)`. **This API has no size-cap argument.** Measured by calling the
repository's `_decompress` as is.

| Item | Value |
|---|---|
| bytes crossing the wire | 1,019,197 B (995 KiB) |
| decompression result | 1,048,576,000 B (1,000 MiB) |
| expansion ratio | **1,029×** |
| decompression time | 1.01 s |
| process peak RSS | **2,110 MB** |

Peak memory being double the result is because `gzip.decompress` gathers fragments and joins them at once.
**Send 1 MB and it uses 2 GB.** 1,029× is almost at the theoretical upper bound of a single DEFLATE stream
(about 1,032:1).

![The decompression-amplification path](/images/lecture/hls-recon/06-decompression-amplification.svg)

*Figure 6-2 — the path from wire to memory, and the only point where a cap can be applied.*

**What matters is that this is not a vulnerability compression created.** `raw = resp.read()`
([`fetch.py:172`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L172)) has no cap either. Even without compression the server can stream an infinitely large body
to make the same result. What compression changes is one thing.

> **The attacker's cost drops to 1/1,029.** Compression's contribution is not the existence of the
> vulnerability but the **amplification ratio.**

And there is no way to know the decompressed size in advance.

| Candidate | Why it cannot be used |
|---|---|
| `Content-Length` | it is the compressed size. unrelated to the size after expansion |
| gzip trailer's ISIZE | it is **a value the attacker wrote** and the remainder mod 2³². it cannot even represent 4 GB or more |
| `deflate` (zlib) | it has no size field at all (only an Adler-32) |

**There is no way to know before decompressing.** Therefore the defense must be not "check how much and
refuse" but **"cut at the cap while decompressing."**

#### Threat model — who is the server?

This tool is a client. To send a decompression bomb, **the server must be adversarial.** So the conditions
for the threat to hold need to be written precisely.

| Usage | Threat holds | Basis |
|---|---|---|
| a person enters one known site address and runs it | low | they already trust that server to watch the video |
| CI·crawler receives a list and runs it automatically | **high** | the address's provenance is not controlled |
| processing only a playlist that was received | **high** | below |

The third row is the crux. **A playlist is itself a list of URLs.** The segment URIs, key URIs
(`EXT-X-KEY`), and subtitle-track URIs are all written in the playlist, and this code receives them with the
same `Fetcher`. That is, **trust is transitive** — the moment you trust the first server, an arbitrary host
it points at is fed to the same decompressor too. It means the trust boundary (Chapter 13) must be drawn once
more at the playlist-parsing point.

#### What is accidentally blocked

Two things accidentally work as a defense. **They are not intended defenses, so it is correct not to count
them as defenses.**

| Accidental defense | Content | Why it is accidental |
|---|---|---|
| multi-layer encoding rejection | `Content-Encoding: gzip, gzip` does not match the token comparison and is refused with a `ValueError`. two layers would have made the expansion ratio 1,029² ≈ a million× | it is because list-form value parsing was not implemented, not to block a bomb |
| the range request's `identity` | if compression itself does not come, neither does a bomb | it was put in for §6.3's coordinate-system problem. being `setdefault`, it is turned off by a user header |

#### Defense — where to put the cap

The cap must be **inside the decompression call.** Measuring `len()` after decompressing is already too late
— by that point the memory is already allocated. Python's standard library has the needed tool.

```python
MAX_BODY = 64 << 20  # 64 MiB

def decompress_capped(body: bytes, encoding: str, limit: int = MAX_BODY) -> bytes:
    enc = encoding.lower().strip()
    if not body or enc in ("", "identity"):
        return body
    if enc in ("gzip", "x-gzip"):
        wbits = 16 + zlib.MAX_WBITS       # gzip wrapper
    elif enc == "deflate":
        wbits = zlib.MAX_WBITS            # zlib wrapper (on failure, retry with -MAX_WBITS)
    else:
        raise ValueError(f"cannot decompress Content-Encoding: {encoding}")
    d = zlib.decompressobj(wbits)
    out = d.decompress(body, limit + 1)   # ← pass the cap as an argument
    if len(out) > limit or d.unconsumed_tail:
        raise ValueError(f"body exceeded the cap {limit}B (suspected decompression bomb)")
    return out
```

Confirmed by feeding **the same bomb** from the table above as is.

```
wire: 1019197 B
→ body exceeded the cap 67108864B (suspected decompression bomb)  (0.03s)
peak RSS: 153 MB
```

| | Current code (`gzip.decompress`) | With a cap |
|---|---|---|
| result | returns 1,048,576,000 B | refused for exceeding the cap |
| time taken | 1.01 s | **0.03 s** |
| peak RSS | 2,110 MB | **153 MB** |

The second argument of `decompressobj().decompress(data, max_length)` is **the cap on the output produced at
once**, and the remaining input stays in `unconsumed_tail`. That is, you can know "is there more to come"
without exceeding the cap. That the time also drops from 1.01 s to 0.03 s is no coincidence — **refusing is
cheaper than decompressing.** A cap-applying defense is not a performance cost but a performance gain.

That the thrown exception is a `ValueError` is deliberate too. [`fetch.py:177`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177)'s `except Exception`
catches it as is and handles it as a **response corruption**, failing without retry per §6.4.3's rule.
Layering onto an existing path rather than making a new failure path most reduces the risk of change.

**Note**: this replacement implementation cannot decompress a multi-member gzip (several gzip streams joined)
at once. `gzip.decompress` does. It means there is something lost in exchange for the cap, and to actually
adopt it you must attach member-repeat handling.

#### What to do, by role

| Role | What to do |
|---|---|
| **this tool (client)** | put a cap on decompression. handle a cap exceedance as corruption and do not retry. set the cap value differently for playlists (a few MB) and segments (tens of MB) |
| **server·CDN operator** | do not recompress already-compressed media (TS·mp4·image). always attach `Vary: Accept-Encoding`. **do not apply a content coding to a range response** |
| **cache·reverse proxy** | normalize `Accept-Encoding` and put it in the cache key. do not truncate an encoded representation to make a 206 |
| **library designer** | give the one-shot decompression API a cap argument. **that a cap-less API is the default is the structural cause of this class of vulnerability** |
| **auditor** | make "does the decompression code have a cap" a review item. the way to find it is simple — enumerate `decompress(` calls and see whether there is a cap argument |
| **server developer (direction reversed)** | the same problem reproduces as is in **upload receipt.** an endpoint that decompresses a request body's `Content-Encoding: gzip` without limit is the same vulnerability |

The last row matters. This chapter is reading client code, but **the majority of decompression bombs go off
on the server side.** Reverse only the direction and it is the same code.

### 6.7.2 Range × compression and cache poisoning

When an intermediate cache gets tangled in this collision, the correctness problem **spreads to other
users.**

| Misconfiguration | Result |
|---|---|
| missing `Vary: Accept-Encoding` | a cache entry filled by a gzip-understanding client goes out as is to a client that receives only `identity` — §6.1's (b) arises not from a server config but from the **cache** |
| the compressed and uncompressed editions share a strong ETag | resume with `If-Range` and fragments of different representations get joined |
| the cache truncates an encoded representation to make a 206 | the body reassembled from fragments belongs to no representation |

All three have one root — **a cache that does not distinguish representations.** A cache's mission is "give
the same thing again," but content negotiation introduces **"one URI is several."** So the cache key must be
not the URI but `(URI, the values of the negotiation axes)`, and the server's only means to tell the cache
that fact is `Vary`. Missing `Vary` is the most common start of this class of accident.

> This section is derived from principle and **was not reproduced in this repository.** This tool keeps no
> cache and sends every request directly.

### 6.7.3 A compression ratio is an information channel about the plaintext

Only a one-line definition is left here.

> **Term** — **CRIME (2012) · BREACH (2013)**: attacks that observe the **size** of compressed data to learn,
> one character at a time, a secret inside it (a session token, etc.). Because compression shortens repeated
> strings, the closer the attacker's inserted guess string is to the secret, the shorter the result.

This tool is not the stage for this attack — it does not compress the request body, and there is no structure
for an attacker to inject a string into the response and repeatedly observe the size change. But the principle
is worth remembering.

> **A compression ratio depends on the content. Therefore the compressed size is information about the
> content.**

Recall that the 30.4× compression ratio seen in §6.4.5 was itself the information "this playlist has 300
almost-identical URLs." The same property, in a response holding a secret, becomes a leak.

### 6.7.4 What is not checked — it does not confirm the 206

Exactly as §6.5's measurement showed. In all of this repository there is no code referencing `206` or
`Content-Range` (confirmed exhaustively). Even if the range request is ignored and 200 + the whole body
comes, `ok=True`, and that body is saved as a segment.

There is a **possibility** this failure is caught incidentally by another check.

| Check | Caught? | Basis |
|---|---|---|
| `sniff()` payload determination | not caught | the content is genuine media |
| segment uniqueness (SHA-256) | **may be caught** — WARN | if every segment is the same whole file, the hashes are all the same ([`report.py:213-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L213-L218)) |
| TS continuity counter | **may be caught** — FAIL | if the same span repeats, the CC jumps backward |

> The bottom two rows of this table are **inferred from reading the code, not confirmed by running it.**
> There is no fixture using `EXT-X-BYTERANGE` in the regression tests, so there is no control to confirm
> against.

The honest conclusion is this. **There is no check in this code confirming whether the range request was
respected; another check only catches it incidentally.** The principle of Chapter 15, not to count an
accidental defense as a defense, should be applied here too. What is needed is one line — if you requested a
range, confirm `status == 206` and `len(body) == length`, and otherwise handle it as a failure.

---

## 6.8 Limits and open questions

Noted honestly.

- **There is no decompression-bomb defense.** The `decompress_capped` this chapter presented is **a proposal,
  not this repository's code.** To adopt it you also need cap-value decisions (playlist and segment differ)
  and multi-member gzip handling.
- **The Range × compression collision could not be reproduced in this repository.** The `identity` forcing is
  a **preemptive defense** from spec reading and principle, and what actually breaks on which CDN when this
  defense is absent was not confirmed. The "compress → truncate / truncate → compress" branches of §6.3.2's
  table are **derived from principle, not a measurement of a specific server product's behavior.**
- **The `EXT-X-BYTERANGE` path itself is not in the regression tests.** `tests/run.sh` does not make a stream
  using this tag (confirmed exhaustively). The parsing ([`playlist.py:327-329`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L327-L329)) and request assembly
  ([`fetch.py:155-161`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L161)) exist only as code and are not fixed by execution.
- **The unchecked 206 was found in this chapter but not fixed.** The fix is a code change, so it is left as a
  separate decision item.
- **The false-positive possibility of the `deflate` double attempt could not be ruled out.** If a raw DEFLATE
  starts with a "non-final stored block" and its second byte happens to satisfy the zlib checksum condition,
  it could be mistaken for a wrapper. The probability is very low but not 0, and an actual case was not
  confirmed.
- **The transfer volume lost by not requesting brotli·zstd was not measured.** It is known that brotli is more
  favorable than gzip for text, but how much difference it actually makes on this workload (a URL list with
  extreme repetition) was not measured.
- **The header-name case problem was measured but is outside this chapter's scope.** The fundamental fix is to
  use a case-insensitive header mapping, and that is a change spanning the whole of `Fetcher`.

---

## 6.9 Summary

1. **Compression is not a transport method but a property of the representation.** The gzip edition and the
   uncompressed edition are different representations of the same resource, and this fact splits the answer to
   the question "which byte."
2. **Negotiation is a preference, not a command.** Send `Accept-Encoding: identity` and gzip still comes —
   this repository's test server is that counterexample, and the regression test **first checks whether the
   server actually sends compression.**
3. **When Range and Content-Encoding overlap the coordinate systems become two.** HTTP counts over the encoded
   representation, HLS over the resource original. Moreover an arbitrary span of a compressed stream cannot be
   decompressed on its own in the first place. So this code does not pick an answer but **removes the
   question** (`identity` forcing).
4. **Size is not one thing.** Throughput is `wire_size`, storage is `size`, the hash is the decompressed body.
   Measure throughput by the decompressed size and the line looks faster by the measured 30.4× compression
   ratio.
5. **`gzip.decompress` has no size cap — this repository's actual unguarded point.** Measured 995 KiB → 1,000
   MiB (1,029×), peak RSS 2,110 MB. What compression newly created is not the vulnerability but the
   **amplification ratio**, and the only point where a cap can be applied is the decompression call itself.
6. **Prevented is not the same as checked.** Even if the range request is ignored and the whole body comes,
   this code returns `ok=True` (measured). It requested `identity` but does not confirm whether it was
   respected.

---

**Next chapter** — what shook the coordinate system in this chapter was compression. In the next chapter the
**address itself** causes the same problem. Encode `%20` once more and it becomes `%2520`, pointing at a
different resource, and when that transformation happens separately at several layers, "what this address
points to" differs per layer. Chapter 7 covers why normalization must happen **exactly once** at the boundary,
and the double-encoding bypass that arises when that discipline is broken.
