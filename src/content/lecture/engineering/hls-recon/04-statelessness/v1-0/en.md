---
title: "Statelessness and the Absence of Integrity Guarantee"
description: "What HTTP guarantees and what it does not"
date: 2026-05-27
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-04-statelessness.svg
---
## 4.0 What this chapter answers

1. When you requested five segments and only four arrived, **which layer should raise the error?**
2. What exactly does the TCP checksum check and not check?
3. By what is one HTTP response judged to have "arrived to the end" — and is there a case where it
   **cannot** be judged?
4. That blank, which no layer takes responsibility for — with what does this code fill it?

---

## 4.1 The problem — you requested five and four arrived

### 4.1.1 Observation

This repository's regression test makes one normal HLS stream and then deletes one segment file
(`tests/run.sh:140`).

```python
(d / "seg001.ts").unlink()                                      # fault 3: segment 404
```

The playlist still declares 5 segments. Request one of them and the server gives a 404. Hand this state
wholesale to ffmpeg and the result is this.

```
one 6s segment missing → ffmpeg exit code 0, output length 30.03s (identical to clean)
                       → in reality the 5.99s ~ 12.02s span is entirely empty
```

It is a measurement `README.md:28-29` recorded. The exit code is 0, the file was made, and even the total
playback length matches the clean copy. There is **nowhere** a signal telling you the middle 6 seconds
disappeared.

Here a common misconception must be cleared away first. This is not a bug in ffmpeg. ffmpeg joined the
pieces it received exactly, and each piece arrived undamaged. The problem is that **no one checked "how
many should have been received."**

### 4.1.2 Whose job was that check, originally?

Probe each layer from bottom to top and the answer is all the same.

| Layer probed | Answer to "did all five arrive?" |
|---|---|
| Ethernet | I only know whether one frame crossed one link segment safely |
| IP | I only know whether the header is intact. the payload is not my concern |
| TCP | I only know whether **this connection's byte stream** went in order without gaps |
| TLS | I only know whether **one record** was un-tampered |
| HTTP | I only know whether the response to **one request** arrived by the declared length |
| HLS (RFC 8216) | I give you the list. whether you received per the list, I do not specify |

**No layer says the word "N."** Each layer's unit of checking is one of that layer's transmission units,
and "the set of five requests" is no layer's transmission unit. This is the whole of this chapter, and the
rest is the refinement of this fact.

---

## 4.2 The principle — the ladder of guarantees

### 4.2.1 Each layer sees only "one"

![The scope of integrity checking by layer](/images/lecture/hls-recon/04-guarantee-ladder.svg)

*Figure 4-1 — each layer's check answers only to the completeness of one of its own transmission units.
The top box is empty, and there is no spec to fill that box.*

> **Term** — **integrity**: that data, once made, has not undergone unintended change (noise·loss·forgery).
> Different from **confidentiality** (keeping the content unseen), and different from **availability**
> (being able to receive it).

Written precisely, each layer's means of checking is as follows.

| Layer | Means | Check target | Check scope |
|---|---|---|---|
| Ethernet | CRC-32 (FCS) | the whole frame | **one hop**. recomputed at each device |
| IPv4 | 16-bit header checksum | **the header only** (20 bytes by default) | recomputed per hop. absent entirely in IPv6 |
| TCP | 16-bit one's-complement sum | pseudo-header + header + payload | **end to end**. but only within one connection |
| TLS | AEAD authentication tag | one record | end to end. even record order·duplication·deletion |
| HTTP | `Content-Length` / chunked framing | one message body | one message |
| HLS | — | — | **none** |

> **Term** — **AEAD (Authenticated Encryption with Associated Data)**: a scheme that handles encryption and
> integrity authentication in one operation. AES-GCM·ChaCha20-Poly1305 are representative, and on
> decryption, if the authentication tag does not match, it fails without giving out the plaintext.

Two boxes in this table deserve attention.

- **Ethernet and IP are recomputed per hop.** So if memory flips **inside** a router, that router computes
  and attaches a new checksum. A checksum matching the wrong data is attached.
- **The HLS box is empty.** RFC 8216 has no tag to carry a segment's digest. `EXT-X-KEY` is for encryption
  (confidentiality), not for integrity.

### 4.2.2 The scope the TCP checksum guarantees

The TCP checksum is the **one's complement of the one's-complement sum** of 16-bit words. It is computed
including the pseudo-header (source·destination address, protocol number, length), so it also filters out
the case of "a segment meant for a different destination misdelivered."

**What it guarantees**

- most random single-bit flips
- most short burst errors
- misdelivered segments (thanks to the pseudo-header)
- order·duplication·loss — this is done not by the checksum but by **sequence numbers and ACKs**

**What it does not guarantee**

| Undetected case | Reason |
|---|---|
| 16-bit-word-level **reordering** | addition satisfies commutativity·associativity. reorder and the sum is the same |
| insertion·deletion of a `0x0000` word | adding 0 does not change the sum |
| two errors that **cancel** each other | e.g., one word `+k`, another word `−k` |
| residual error probability | being 16-bit, about 1/65536 of random errors pass |
| **everything outside the connection** | there is no concept of the relationship with another connection·another request |

The result Stone and Partridge measured in 2000 is widely cited — even after passing the link CRC, about 1
in 1100–32000 segments was caught by the TCP checksum, and the **undetected errors** that also pass the
checksum were estimated at about 1 in 16 million–10 billion segments. The main cause was not line noise but
**software·memory faults in end hosts and intermediate devices.** That is, the span the CRC protects (the
link) and the point where errors occur (inside devices) were misaligned.

> These figures are a citation, not a value this repository reproduced. Noted again in 4.6.

What this result says is not "the TCP checksum is weak." It is that **a lower layer's check protects only
the span that layer is responsible for.** A design that expects a lower layer to catch errors that arose
outside its span is wrong by exactly that much.

### 4.2.3 What HTTP guarantees — the framing of one message

> **Term** — **message framing**: the rule that determines, over a byte stream, "this message's body starts
> here and ends here." It is the work of re-establishing message boundaries over TCP, a stream protocol.

In HTTP/1.1 there are only three ways to determine the end of a response body.

| Method | Basis for knowing the end | Can it distinguish truncation? |
|---|---|---|
| `Content-Length: N` | the declared N bytes | **Yes** — short is an error |
| `Transfer-Encoding: chunked` | a terminating chunk of length 0 | **Yes** — no terminating chunk is an error |
| Neither → **connection close is the end** | the server closes the connection | **No** |

The third case is the core hole of this chapter. If the server does not declare the body length, "sent it
all and closed" and "cut off mid-send" become **exactly the same shape on the wire.** No information exists
by which the client can distinguish them. We measure this directly in 4.3.4.

### 4.2.4 Statelessness — only the client knows the set

> **Term** — **statelessness**: the property by which RFC 9110 specifies HTTP. Each request is interpreted
> only by the information within that request, and the protocol does not require the server to maintain a
> relationship with a previous request.

Statelessness is usually introduced as "a design for scalability." True. But from this chapter's viewpoint
a different consequence follows.

**The server does not know how many you intend to request.** Not that there is no way to know — the server
also made the playlist — but **it is not in a position to observe it.**

- the five requests may go over different TCP connections
- they may go to different CDN edges (that is the purpose of a CDN)
- there is a time gap between requests, and you may stop midway
- even with HTTP/2, what is multiplexed is streams, not "the unit of work"

By contrast **the client knows N.** It has known since the moment it parsed the playlist. That is, the only
one in a position to check the set's completeness, in this structure, is the client.

Here is one thing that looks like an exception.

```python
# playlist.py:164-166
    def is_live(self) -> bool:
        """No ENDLIST means an in-progress live delivery."""
        return not self.is_master and not self.has_endlist
```

`#EXT-X-ENDLIST` is, across all of HLS, the **only marker that says "this list ends here."** But this too
only says the end of the list, not whether the segments arrived, and it is itself one line of the server's
self-reported text, unsigned. As we will see later, this marker provides this repository one **accidental
defense** (4.6).

### 4.2.5 Why is there no integrity digest?

"Can't you just attach a hash to the response" is a natural question, and it has actually been tried several
times.

| Means | Status | Usable for this problem? |
|---|---|---|
| `Content-MD5` | **removed** in RFC 7231 (inconsistent handling with partial responses) | none |
| `Digest` (RFC 3230) → `Content-Digest`·`Repr-Digest` (RFC 9530) | standardized. optional | usable only if the server attaches it. not a CDN default |
| Subresource Integrity (SRI) | the browser's `<script>`·`<link>`, `fetch()`'s `integrity` option | **you must know the digest in advance.** there is nowhere in the HLS manifest to write it |
| HLS `EXT-X-KEY` | AES-128-CBC encryption | **confidentiality only.** no authentication tag |

The last row is important. **Even encrypted, integrity is not guaranteed.** AES-128-CBC is an
unauthenticated mode, and HLS does not send a MAC along with it. The offensive consequence of this fact is
covered in 4.5.2.

### 4.2.6 The end-to-end argument

The observations so far are not a new discovery but a reaffirmation of a principle named in 1984.

> **Term** — **the end-to-end argument**: Saltzer·Reed·Clark (1984). For a function to be performed
> **completely correctly from the application's viewpoint**, it must be confirmed at both ends of that
> application, and even if a lower layer does the same thing, that is only a **performance optimization**,
> not a basis for correctness.

Applying this principle to this chapter's problem, it reads like this.

- The Ethernet CRC·TCP checksum·TLS tag are **optimizations that reduce retransmission.** Useful, but not a
  basis for "I received everything I wanted."
- The definition of "received everything" **is known only to the application.** Here the application's
  definition is "all the segments the playlist declared." This definition exists only in code that knows
  HLS.
- Therefore that check **must be implemented at the application layer.** There is no other option.

The rest of this chapter is "so how was it implemented."

---

## 4.3 The code — filling the blank with instrumentation

### 4.3.1 One request's result as a value, not an exception

![A structure that leaves each request's result as a value and counts across them](/images/lecture/hls-recon/04-instrumented-gap.svg)

*Figure 4-2 — HTTP knows only the vertical direction (one request). The horizontal line is not drawn by
the protocol, so the application draws it itself.*

```python
# fetch.py:73-92
@dataclass
class FetchResult:
    """One request's result and measurements."""

    url: str
    ok: bool
    status: int = 0
    body: bytes = b""  # the body after decompression
    size: int = 0  # size after decompression
    wire_size: int = 0  # bytes that actually crossed the wire (compressed state)
    encoding: str = ""  # the Content-Encoding as received
    ttfb_ms: float = 0.0  # time to first byte — until the server begins responding
    total_ms: float = 0.0  # until body receipt completes
    attempts: int = 1
    error: str = ""
    content_type: str = ""
    sha256: str = ""
    # a hotlink-blocking CDN returns the player page's origin in this header.
    # it comes attached to both success and 403 responses, so it is the basis for Referer inference.
    allow_origin: str = ""
```

Four design decisions can be read from this data type.

**(1) Failure is a value, not an exception.** That there is an `ok: bool` means a failed request too
**remains in the list** as a `FetchResult` instance. What if it had been thrown as an exception?

| Stage | If failure were thrown as an **exception** | If failure is left as a **value** (this code) |
|---|---|---|
| right after one request fails | it climbs the call stack | `FetchResult(ok=False)` takes its place in the list |
| when the parallel batch finishes | wrap it in `try/except` and it vanishes at that spot | success·failure are together in the same list |
| when aggregating | **there is nothing to count** | `len(failed) / len(fetches)` holds |

In code trying to check a set's completeness, **throwing failure as an exception is erasing what you would
count.** This decision follows directly from the requirement of 4.2.6.

**(2) `ok` and `status` are separated.** `ok=False, status=404` means the server answered and refused, and
`ok=False, status=0` means it did not even reach the server. Merge them into one and "the network cut out"
and "the token expired" become the same value.

**(3) `size` and `wire_size` are separated.**

```python
# fetch.py:98-104
    @property
    def throughput_mbps(self) -> float:
        """It is line performance, so compute from actual transferred bytes, not the decompressed size."""
        wire = self.wire_size or self.size
        if self.total_ms <= 0 or not wire:
            return 0.0
        return (wire * 8) / (self.total_ms / 1000) / 1_000_000
```

Compute throughput from the decompressed size on a compressed playlist and the line comes out faster than
it is. A measurement is useful only when what it measures matches its name.

**(4) `ttfb_ms` and `total_ms` are separated.**

> **Term** — **TTFB (Time To First Byte)**: the time from sending a request until the response's first byte
> arrives. It mainly reflects the server's processing delay. The body-receipt-completion time (`total_ms`)
> is that plus **body size ÷ bandwidth.**

Merge the two and "the server is slow" and "the file is big" are not distinguished.

### 4.3.2 Retry — what is worth trying again

```python
# fetch.py:196-206
            except urllib.error.HTTPError as e:
                last_status, last_err = e.code, f"HTTP {e.code} {e.reason}"
                last_origin = (e.headers or {}).get("Access-Control-Allow-Origin", "") or ""
                # 4xx gives the same result on retry (401/403/404 = token expiry·hotlink block)
                if 400 <= e.code < 500 and e.code not in (408, 429):
                    break
            except Exception as e:  # noqa: BLE001 — take all network exceptions as measurement targets
                last_err = f"{type(e).__name__}: {e}"

            if attempt < self.retries:
                time.sleep(self.backoff * (2 ** (attempt - 1)))
```

The criterion for a retry decision is not "did it fail" but **"could it come out different if done again."**

| Response | Retry | Basis |
|---|---|---|
| 4xx (except 408·429) | **No** | the request itself was refused. the same request gets the same answer |
| 408 (Request Timeout) | Yes | a timing issue, so doing it again may differ |
| 429 (Too Many Requests) | Yes | a rate issue. retry after backoff is the behavior the spec intended |
| 5xx | Yes | could be a server-side transient fault |
| network exception | Yes | connection·timeout may not reproduce |
| decompression failure | **No** (`break`, [`fetch.py:177-180`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177-L180)) | the same server gives the same corrupted body again |

What breaks if you do not do this. Retry a 404 three times and the requests per lost segment triple, and in
a 27-episode batch it becomes, from the server's standpoint, **amplification traffic toward itself.** Ignore
a 429 and retry and that is exactly the behavior the server said not to do. The exponential backoff
`backoff * 2^(attempt-1)` is the minimum device to keep the retry itself from growing the fault.

And the end of the failure path is this.

```python
# fetch.py:208-215
        return FetchResult(
            url=url,
            ok=False,
            status=last_status,
            attempts=self.retries,
            error=last_err,
            allow_origin=last_origin,
        )
```

**It never throws an exception to the end.** Failure too is a result value.

### 4.3.3 A failed request holds its place too

```python
# fetch.py:229-243
        """Parallel GET. The return order preserves the input order."""
        results: list[FetchResult | None] = [None] * len(items)
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            futures = {
                pool.submit(self.get, url, rng): i for i, (url, rng) in enumerate(items)
            }
            done = 0
            for fut in as_completed(futures):
                i = futures[fut]
                res = fut.result()
                results[i] = res
                done += 1
                if on_done:
                    on_done(done, res)
        return [r for r in results if r is not None]
```

`as_completed` returns in **completion order.** A fast segment finishes first, so pile them up as is and the
order gets scrambled. So it makes the slots in advance with `[None] * len(items)` and puts each into its
original position by index.

What breaks if this order preservation collapses. It is because the consuming side looks like this.

```python
# cli.py:452-455
    for seg, res in zip(segs, results):
        if not res.ok:
            _eprint(f"    ✗ seg#{seg.index} receive failed: {res.error}")
            continue
```

`zip` pairs by position. Push the result list by even one slot and **seg#3's failure is reported as seg#4's
failure, and everything after is off.** Moreover `zip` stops quietly at the shorter side, so if the length
shrinks the rear segments vanish without checking. A wrong report comes out with not a single error.

### 4.3.4 Measurement — when is truncation detected?

We measure how the third row of §4.2.3's table ("connection close is the end") actually appears. Make four
kinds of response with a raw socket server and receive them with this repository's `Fetcher`.

```python
# run from the repository root.
import socket, threading
from hlsrecon.fetch import Fetcher

BODY = b"\x47" + b"A" * 999          # a 1000-byte fake segment
CUT = 400                            # send only 400 bytes and cut
H = "HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\n"

def handle(conn):
    path = conn.recv(65536).decode("latin1").split(" ")[1]
    if path == "/full":                                  # normal
        conn.sendall((H + "Content-Length: 1000\r\n\r\n").encode() + BODY)
    elif path == "/short-cl":                            # length declared, body truncated
        conn.sendall((H + "Content-Length: 1000\r\n\r\n").encode() + BODY[:CUT])
    elif path == "/no-cl":                               # length not declared, body truncated
        conn.sendall((H + "Connection: close\r\n\r\n").encode() + BODY[:CUT])
    elif path == "/chunked-cut":                         # truncated mid-chunk
        conn.sendall((H + "Transfer-Encoding: chunked\r\n\r\n").encode()
                     + b"190\r\n" + BODY[:CUT] + b"\r\n")
    conn.close()

srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0)); srv.listen(8)
port = srv.getsockname()[1]
threading.Thread(target=lambda: [threading.Thread(
    target=handle, args=(srv.accept()[0],), daemon=True).start() for _ in iter(int, 1)],
    daemon=True).start()

f = Fetcher(retries=1)
for p in ("full", "short-cl", "no-cl", "chunked-cut"):
    r = f.get(f"http://127.0.0.1:{port}/{p}")
    print(f"{p:12s} ok={str(r.ok):5s} size={r.size:5d}  {r.error}")
```

Run result (Python 3.14.5, plain HTTP, local loopback):

```
full         ok=True  size= 1000
short-cl     ok=False size=    0  IncompleteRead: IncompleteRead(400 bytes read, 600 more expected)
no-cl        ok=True  size=  400
chunked-cut  ok=False size=    0  IncompleteRead: IncompleteRead(400 bytes read)
```

| Response | Actually sent | Result | Verdict |
|---|---|---|---|
| `full` | 1000 / 1000 | `ok=True`, 1000 bytes | correct |
| `short-cl` | 400 / 1000 | `ok=False`, `IncompleteRead` | **detected** |
| `no-cl` | 400 / (not declared) | `ok=True`, **400 bytes** | **undetected** |
| `chunked-cut` | 400 / no terminating chunk | `ok=False`, `IncompleteRead` | **detected** |

The third row is the most important measurement in this chapter. **It is reported as a success.** Status
code 200, `ok=True`, no error string. A cut-off, half-sized segment moves to the next pipeline stage with no
indication.

This is not a fault of Python or of this code. **If the server does not declare the body length, "end" and
"cutoff" are the same shape on the wire, and there exists no information for the client to reference.** It is
the third row of §4.2.3's table appearing exactly.

There is one thing to add. `IncompleteRead` falls into the broad `except Exception` at
[`fetch.py:202`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L202), so it becomes a **retry target** (the measurement above fixed `retries=1` to simplify the
comparison). Run with the default of 3 and it becomes `ok=False` only after requesting three times. If the
truncation was transient, this retry is itself the recovery.

**One accidental defense** — a compressed response escapes this hole.

```
$ python3 -c "import gzip; gzip.decompress(gzip.compress(b'x'*400)[:20])" 2>&1 | tail -1
EOFError: Compressed file ended before the end-of-stream marker was reached
```

A gzip stream has its own end-of-stream marker and a **CRC-32 + original-size trailer.** Truncated, it gives
`EOFError`; content-changed, `BadGzipFile: CRC check failed`, and both lead to `ok=False` at
[`fetch.py:177-180`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177-L180). That is, in this code a response with **`Content-Encoding: gzip` has stronger integrity
guarantee than an `identity` one.** It is not designed but a side effect of the compression format, and so
the Range-request path (where [`fetch.py:155-159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L159) forces `Accept-Encoding: identity`) does not receive this
protection.

### 4.3.5 Aggregation — where the horizontal line is drawn

Here is the **only place** in this repository that asks "did all N arrive."

```python
# report.py:160-173
    if fetches:
        failed = [f for f in fetches if not f.ok]
        retried = [f for f in fetches if f.ok and f.attempts > 1]
        ttfb = [f.ttfb_ms for f in fetches if f.ok]
        tput = [f.throughput_mbps for f in fetches if f.ok and f.throughput_mbps]
        total_bytes = sum(f.size for f in fetches)

        if failed:
            codes = sorted({f.status or 0 for f in failed})
            rep.add(
                "segment receipt",
                FAIL,
                f"{len(failed)}/{len(fetches)} failed (HTTP {codes}) — loss interval in the reassembled output",
            )
```

`len(failed)` and `len(fetches)` — this one line comparing two numbers is the whole of the end-to-end check
4.2.6 required. The protocol does not give it, so the code makes it.

What is notable is that the **verdict is three-tier.**

| State | Verdict | Meaning |
|---|---|---|
| there is a failure | `FAIL` | there is loss in the reassembled output |
| all succeeded, some after retry | `WARN` | the result is intact but **the delivery side was unstable** |
| all succeeded on the first try | `PASS` | — |

The middle row is the worth of an instrumented fetcher. A failure recovered by retry leaves no trace in the
final output. Leave no measurement and that very fact disappears, and when you receive the same stream again
there is no way to know why it fails.

`_run_segments` skips a failed segment but does not halt ([`cli.py:452-455`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L452-L455)). **Because you must receive to
the end to count how many failed.** Had it `raise`d on the first failure, "1 failed" and "40 failed" become
the same result. Only when all failed is there nothing to count, so only then does it halt.

```python
# cli.py:470-471
    if not paths:
        raise SystemExit("no segments received — possibly token expiry or Referer-verification failure")
```

And the whole transport-layer statistics remain in the report.

```python
# report.py:220-230
        rep.stats["transport"] = {
            "segments": len(fetches),
            "failed": len(failed),
            "retried": len(retried),
            "bytes": total_bytes,
            "wire_bytes": wire_bytes,
            "compressed_responses": len(compressed),
            "ttfb_ms_p50": round(_quantile(ttfb, 0.5), 1),
            "ttfb_ms_p95": round(_quantile(ttfb, 0.95), 1),
            "throughput_mbps_p50": round(_quantile(tput, 0.5), 2),
        }
```

Why TTFB is left as p50·p95 rather than the mean is covered in Chapter 8. Here it is enough to confirm that
**a set-level fact (how many of how many) is preserved along with the output.**

### 4.3.6 What sha256 does and does not do

Read `FetchResult.sha256` and think "ah, there is an integrity check" and you are wrong.

```python
# report.py:213-218
        dup = len({f.sha256 for f in fetches if f.ok}) != len([f for f in fetches if f.ok])
        rep.add(
            "segment uniqueness",
            WARN if dup else PASS,
            "duplicate hash present — the same segment delivered repeatedly" if dup else "all SHA-256 distinct",
        )
```

The question this hash answers is **"are the received ones the same as each other"**, not **"is what was
received correct."** To ask the latter you need a reference digest to compare against — and as seen in 4.2.5,
**HLS has nowhere to carry it.**

| What the hash can answer | What it cannot |
|---|---|
| are seg003 and seg004 the same bytes (duplicate delivery) | is seg003 the original seg003 |
| did a re-run receive the same thing (on direct comparison) | was it changed in between |

A hash without a reference value is an **identity-judgment tool**, not an integrity check. Blurring this
distinction is a common misreading in security documents.

---

## 4.4 Generalization — only the side that knows the set can confirm the set's completeness

Writing this chapter's principle in one sentence:

> **Each layer guarantees only the completeness of its own transmission unit. The completeness of a set
> spanning several units is counted by no one unless the layer that defined the set counts it directly.**

Listing where the same structure appears shows this principle is not limited to streaming.

| Domain | What the lower layer guarantees | The set-level blank | The practice that fills it |
|---|---|---|---|
| file download | one response's length | did all several files arrive | a `SHA256SUMS` file + signature |
| package install | one archive's compression CRC | is the whole dependency tree that version | the lockfile's (`package-lock.json` etc.) integrity hash |
| S3 multipart upload | one part's ETag | were all parts uploaded | specify the part list·order in `CompleteMultipartUpload` |
| backup | one file's write success | is everything there on restore | a **restore rehearsal**. a backup-success log is not a basis |
| message queue | one message's ACK | is N published N consumed | produce·consume counter comparison, sequence number |
| log collection | one transmission batch's 200 | did all come in without loss | per-source ordinal + gap detection |
| distributed tracing | one span's record | is the trace complete | root-span end marker + orphan-span aggregation |

In each row, a **system where the right column is empty fails, without exception, in the same way** —
"there are reports of success all around, but the result is empty." And that failure is invisible no matter
how carefully you read the reports. What was not counted is not in the report.

There is one practical rule derived here.

> **The logical AND of "each stage succeeded" is not "the whole succeeded."** Unless you separately confirm
> that the list of stages itself is correct.

4.1.1's ffmpeg is exactly this. The pieces it received were all correct. Only the **count** of pieces was
wrong.

---

## 4.5 Security

### 4.5.1 The truncation attack

> **Term** — **truncation attack**: an attack where a path-based attacker cuts the communication in the
> middle to look like a normal termination, making the receiving side **accept partial data as complete.**

The `no-cl` result of 4.3.4 is the condition of this attack holding, itself.

| Condition | Holds? |
|---|---|
| the server uses neither `Content-Length` nor chunked | required |
| the attacker can cut the connection (RST injection, a path device) | required |
| the client does not verify the authenticity of the termination signal | required |

TLS is aware of this problem and specifies the `close_notify` alert as the normal-termination marker. If the
connection is cut without it, it should be regarded as a truncation. The problem is that **many HTTP clients
leniently accept a termination without `close_notify`** (for compatibility with poorly implemented servers).
In that case the same hole remains even over HTTPS.

The practical conclusion is simple. **Explicit framing is an integrity feature.** `Content-Length` is not a
header for performance or convenience but the only device that makes truncation and completion
distinguishable.

### 4.5.2 Encryption without integrity — encryption is not integrity

HLS's AES-128 is CBC mode with no MAC. The CBC decryption formula is as follows.

```
P_i = D_K(C_i) XOR C_(i-1)
```

Flip some bit of `C_(i-1)` and **the same-position bit of `P_i` flips exactly** (at the cost of `P_(i-1)`
being garbled like random). That is, even an attacker who does not know the key can make a **controlled
change** to the plaintext. This is called **malleability.**

And the decrypting side has no means to notice it.

```python
# decrypt.py:54-55
    # if the padding is broken (a truncated segment, etc.), do not trim and pass the original.
    # throwing an exception here would bury corruption detection in the decryption stage.
```

The probability that a random byte sequence passes the PKCS#7 padding check ([`decrypt.py:56`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L56)) is about
1/256 — because it holds with `n=1` as long as the last byte is `0x01`. Moreover this code decided in the
first place not to fail on a padding error — that decision itself is correct and the reason is covered in
Chapter 24. What to confirm here is the fact that **the crypto layer provides no integrity check at all, so
corruption detection all moves upward (TS-packet traversal·timeline check).**

> **The sentence "it is encrypted" says nothing about integrity.** If it is not AEAD, a separate MAC is
> needed, and HLS's `EXT-X-KEY` has nowhere to carry a MAC.

### 4.5.3 Selective loss — censorship with the same total length

The most interesting attack is neither truncation nor forgery. It is **making only a particular segment
disappear.**

| Capability | Result | Detection |
|---|---|---|
| block everything | playback failure | revealed immediately |
| random corruption | TS sync loss·decode error | caught by an upper check |
| **404 only a particular span's segment** | only that span disappears and the rest plays normally, **total length identical** | **cannot be caught by total-length comparison** |

The third row is the same phenomenon as 4.1.1's measurement. One 6-second segment was removed yet the output
length was 30.03 seconds, the same as normal. Because an MPEG-TS segment carries an **absolute presentation
timestamp (PTS)**, so even when a front piece disappears the timestamps of the pieces behind are preserved
(Chapter 21). It means the manipulation of deleting a particular few seconds from a news video·evidence
video·sports broadcast **passes the length check.**

The checks this repository has for this attack surface are two layers.

| Layer | Check | Scope it catches |
|---|---|---|
| transport | `len(failed)/len(fetches)` ([`report.py:167-173`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L167-L173)) | loss where the request failed |
| output | PTS gap scan ([`report.py:303-324`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L303-L324), Chapter 21) | the case where the request succeeded but a hole opened in the timeline |

The reason two layers are needed is that they catch different failures. The transport check is relative to
the request list, the gap scan relative to the output. We meet again in Chapter 21.

### 4.5.4 The defender's view

This chapter's principle appears far more often in **configuration** than in attacks. What to do differs by
role.

| Role | What to do | What breaks if you do not |
|---|---|---|
| **origin server·CDN operator** | attach `Content-Length` or chunked framing to every response. do not use a response that signals the body end by connection close | truncation and completion become indistinguishable (4.3.4's `no-cl`). there is no way for the client to fix it |
| **packager·delivery provider** | always put `#EXT-X-ENDLIST` in a VOD playlist. if possible attach `Repr-Digest` (RFC 9530) | the end of the list cannot be known, so a truncated manifest looks complete |
| **player·client implementer** | **count the number of request successes.** do not swallow buffer loss but expose it as an event | `fetch()` knows only one request. count it not and no one counts it |
| **verification-tool maker** | make explicit that PASS is not "intact" but "this check can't catch it" | a PASS whose miss rate you do not know is not information (Chapter 34) |
| **auditor** | trace back **where the report's N came from** | if the baseline itself is contaminated, a self-consistent lie passes (4.6) |
| **network operator** | do not carry media over plain HTTP | anyone on the path can quietly delete a particular segment (4.5.3) |
| **spec author** | put a place in the spec to carry set-level integrity | RFC 8216 has no such place, so every client makes its own |

The last row is this chapter's structural conclusion. **Leave a blank in the spec and every client fills it
differently, and most do not fill it.** ffmpeg exiting 0 is not laziness but not doing what the spec does
not require.

### 4.5.5 The exposure the instrumentation itself creates

The measurement records made to fill the blank become an asset themselves.

```python
# report.py:36-41
def _redact_headers(cmd: list[str]) -> list[str]:
    """Make a copy of the ffmpeg command with credentials hidden in the -headers block.

    The report JSON remains as a CI artifact or is attached and passed around as is. If the session
    cookie is carried in plaintext, one file becomes account access.
    """
```

A record kept for integrity verification creates a confidentiality problem — a point where two security
properties collide head-on. `FetchResult.url` contains the signature and expiry of a signed URL as is, and
`mux_command` contains the whole request header. Whether the redaction-target list is complete is the
subject of Chapter 12.

---

## 4.6 Limits and open questions

Noted honestly.

**What was not measured**

- **The Stone·Partridge figures are a citation.** A 2000 measurement, not reproduced in this repository.
  Whether that ratio applies as is to today's environment, where most traffic is wrapped in TLS (AEAD),
  could not be confirmed.
- **4.3.4's truncation measurement was done only over plain HTTP.** A client that does not verify
  `close_notify` over HTTPS would give the same result, I **infer**, but did not measure. 4.5.1's "many HTTP
  clients leniently accept a termination without `close_notify`" is likewise received wisdom and not a fact
  this document verified. **The two claims that stopped at inference in this chapter are these.**
- **The frequency with which real CDNs respond without `Content-Length` was not surveyed.** Modern CDNs are
  known to almost always use explicit framing, but this is not a fact this repository confirmed. That is,
  the `no-cl` hole **exists in principle but its actual exposure is unmeasured.**

**What this code cannot do**

- **It does not check the completeness of the request list itself.** The baseline N comes from the parsed
  playlist, and the declared length comes from the same place ([`cli.py:414-415`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L414-L415)).

  ```python
      segs = pl.segments[: args.limit] if args.limit else pl.segments
      declared = sum(s.duration for s in segs)
  ```

  If the playlist was truncated so only 3 segments were parsed, it requests 3, receives 3, and a `PASS`
  comes out. The declared length shrinks along with it, becoming a **self-consistent lie.** What saves this
  tool here is not an integrity check but one **accidental structural signal** — if `#EXT-X-ENDLIST` is cut
  off, `is_live` becomes true ([`playlist.py:164-166`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L164-L166)) so it is reported as LIVE and the processing path changes.
  It is not a device designed for integrity, so do not rely on it here. (The general form of this problem,
  where the measurement target drags the measuring standard along, is covered in Chapter 38.)
- **The `attempts` measurement is inaccurate on failure cases.** [`fetch.py:212`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L212) puts in
  `attempts=self.retries` as a fixed value, so even a request that `break`s on the first try with a 404 is
  recorded as "3 attempts." It is only not surfaced because the current report uses this value only on
  success cases ([`report.py:162`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L162)'s `f.ok and f.attempts > 1`). It is an **unsurfaced inaccurate
  measurement**, and the moment the report starts using this field on failure cases, a wrong number goes out.
- **`Fetcher.get` can throw an exception.** `normalize_url` is **outside** the retry loop
  ([`fetch.py:151`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L151)), so a malformed URL does not become a `FetchResult`. Measured:

  ```
  $ python3 -c "from hlsrecon.fetch import Fetcher; Fetcher(retries=1).get('http://[::1/x.ts')" 2>&1 | tail -1
  ValueError: Invalid IPv6 URL
  ```

  Occur inside `get_many` and `fut.result()` rethrows and the whole batch halts. It does not go off quietly,
  but it is **a hole in this module's contract that "failure too is a value."**
- **No check verifies whether the content is correct.** As seen in 4.3.6, there exists no reference digest
  to compare against. What this tool answers is "did it arrive as declared," not "is it the same as the
  original." The latter is a **question that cannot be answered** over this protocol.
- **The compressed path is accidentally stronger than the uncompressed one.** Thanks to gzip's CRC-32
  trailer, which is not a designed guarantee but a side effect. A Range request forces `Accept-Encoding:
  identity` ([`fetch.py:155-159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L159)) so it loses that protection. On a delivery with many `EXT-X-BYTERANGE`
  segments, truncation detection depends solely on `Content-Length`.

---

## 4.7 Summary

1. **No layer answers "did all N arrive."** The Ethernet CRC·IP header checksum·TCP checksum·TLS
   authentication tag·HTTP framing all check only the completeness of **one of their own transmission
   units.** The set is no layer's transmission unit.
2. **The TCP checksum is a 16-bit one's-complement sum.** It catches most random bit errors but not
   word reordering·`0x0000` insertion·canceling errors, and above all it does not concern itself with
   anything outside **one connection.** A lower layer's check is an optimization, not a basis for
   correctness (the end-to-end argument).
3. **HTTP guarantees only one message's framing, and even that conditionally.** With neither
   `Content-Length` nor chunked, truncation and completion are indistinguishable — confirmed by measurement
   (`no-cl` → `ok=True`, 400/1000 bytes).
4. **The consequence of statelessness**: the server is not in a position to observe how many the client will
   request. **Only the client, which parsed the playlist, knows N.** Therefore that check is necessarily done
   by the client.
5. **Encryption is not integrity.** HLS's AES-128-CBC has no MAC and so has malleability. There is no place
   at all in the HLS spec to carry an integrity digest.
6. **The blank is filled not by the protocol but by a data structure.** It makes one request into one
   `FetchResult` ([`fetch.py:73-104`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L104)), leaves failure too as a value in the list, and counts across that
   list ([`report.py:160-173`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L160-L173)). **Had failure been thrown as an exception, what you would count
   vanishes.**
7. **But the baseline N still comes from text the server gave.** This tool answers "did it arrive as
   declared," not "is the declaration correct."

---

**Next chapter** — this chapter made "did the request succeed" countable. But the definition of success
itself wobbles. A response that received an HTTP `200 OK` while the body is an error page really exists, and
by the header alone it is indistinguishable from a normal segment. Chapter 5 covers where the status code, a
self-reported metadata, loses its meaning, and what to base the judgment on then.
