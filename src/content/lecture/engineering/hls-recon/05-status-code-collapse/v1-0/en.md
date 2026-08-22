---
title: "The Semantic Collapse of Status Codes"
description: "200 is not success"
date: 2026-05-29
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-05-status-code-collapse.svg
---
## 5.0 What this chapter answers

1. What exactly is `200 OK` the success of? What is it **not** the success of?
2. Why does a CDN with an expired token return 200 instead of 404 — accident or design?
3. If you decide not to trust self-reported metadata, what do you look at instead?
4. Why must a transport failure and a content failure be split into **different check items?**

---

## 5.1 The problem — full receipt success, and yet 6 seconds are gone

### 5.1.1 Reproduction

Make a 30-second HLS stream and change only one of the five segments into an error page. Leave the
filename as `.ts`.

```bash
mkdir -p plain
ffmpeg -v error -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset ultrafast -g 30 -c:a aac \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "plain/seg%03d.ts" plain/index.m3u8

cp -R plain expired
printf '<!DOCTYPE html><html><body><h1>403 Forbidden</h1><p>Link expired</p></body></html>\n' \
  > expired/seg002.ts

python3 -m http.server 8977 --bind 127.0.0.1 &
```

The headers the server attaches to this file are as follows.

```
$ curl -sI http://127.0.0.1:8977/expired/seg002.ts
HTTP/1.0 200 OK
Server: SimpleHTTP/0.6 Python/3.14.5
Content-type: video/mp2t
Content-Length: 83
```

**The status code is 200, the `Content-Type` is `video/mp2t`, and the file extension is `.ts`.** All three
self-reported values that state the resource's identity say "this is an MPEG-TS segment." Only the body does
not.

```
$ curl -s http://127.0.0.1:8977/expired/seg002.ts
<!DOCTYPE html><html><body><h1>403 Forbidden</h1><p>Link expired</p></body></html>
```

Inside the body it says `403 Forbidden`. **The server knew this was a refusal, wrote that fact in the body,
and did not carry it to the status line.** The whole phenomenon this chapter deals with is in this one line.

### 5.1.2 What is observed

A measurement with ffmpeg alone on the same stream (ffmpeg 8.1.1, macOS arm64).

```bash
ffmpeg -v error -y -i http://127.0.0.1:8977/expired/index.m3u8 -c copy naive.mp4
```

| Observed metric | Normal stream | Only seg002 an error page | Distinguishable? |
|---|---|---|---|
| ffmpeg exit code | 0 | **0** | ✗ |
| output total length | 30.023s | **30.023s** | ✗ (same value) |
| stderr (`-v error`) | none | **none** | ✗ |
| stderr (`-v warning`) | 1 unrelated warning line | same 1 line + 3 packet-corruption warning lines | △ appears but has no quantitative info |
| video frame count | 900 | 720 | ✓ 180 frames = 6 seconds lost |
| max PTS interval | 0.033s | 6.033s @ 11.99s | ✓ |

Of the six metrics, the first three are indistinguishable. And those three are the metrics an automation
pipeline actually watches — the exit code, the total length, the error log. **The response that created the
loss was 100% successful at the HTTP layer, and the loss is revealed only in the bottom three metrics.**

The fourth row needs to be recorded honestly. **ffmpeg is not completely silent.** At the default log level
it says this.

```
$ ffmpeg -hide_banner -v warning -i .../expired/index.m3u8 -c copy naive.mp4
mime type is not rfc8216 compliant
[mpegts @ 0x829018280] Packet corrupt (stream = 0, dts = 1205090).
[in#0/hls @ 0x829018000] Packet corrupt (stream = 0, dts = 1202090).
[in#0/hls @ 0x828c14000] corrupt input packet in stream 0
```

But there are three reasons this warning is hard to use as a verdict signal.

1. **It is WARNING level.** The moment you pass `-v error` it all disappears. `-v error` is a very common
   setting in scripts, and even this repository's control test runs that way (`tests/run.sh:515`).
2. **The exit code is still 0.** The fact that a warning occurred is not reflected in the process result, so
   a pipeline that branches on the exit code has no chance even to see the warning.
3. **There is no quantitative info.** "A packet is corrupt" is a different statement from "6.03 seconds are
   gone from 11.99." Moreover, even on a normal stream one unrelated warning line appears
   (`mime type is not rfc8216 compliant` — because `python3 -m http.server` attaches
   `application/x-mpegurl` to `.m3u8`). To use the presence of a warning as a signal you must classify the
   string, and **making that classifier is itself making a verifier.**

And here is a point not to miss. The HTTP layer **did not lie.** The request was processed and the 83-byte
response was delivered intact. All of the transport layer's statements are true. What is wrong is the side
that read those statements as "I received the segment I requested."

> This chapter's problem is not the server sending a wrong value, but **reading a correct value as another
> layer's proposition.**

---

## 5.2 The principle — 200 is the success of what?

> **Term** — **status code**: a 3-digit integer on the first line of an HTTP response. A field where the
> server summarizes the result of request processing into one value and reports it.

What the HTTP spec (RFC 9110 §15.3.1) says about `200 OK` is two pieces.

- **the request has succeeded**
- for a GET, the body is **a representation of the target resource**

The first piece and the second are entirely different in nature. The first is an **observable fact** — that
the response arrived is itself the evidence. The second is **the server's claim.** The spec has no means to
verify this claim, nor to enforce it. That is, one value carries two propositions at once.

| Proposition | Who determines it | Can the client verify it? |
|---|---|---|
| P₁ — the request was processed and the response delivered | the transport layer | Yes. that the response arrived is the evidence |
| P₂ — the body is a representation of the resource I requested | the server's claim | **No.** impossible with the status code |

> **Term** — **semantic collapse**: the phenomenon where two propositions of different layers are expressed
> by one signal, leading the consumer to read the lower layer's truth as the upper layer's truth. It is not
> that the signal is wrong, but that **more was read out of it than the signal can carry.**

![The tiers of success and the collapse point](/images/lecture/hls-recon/05-success-layers.svg)

*Figure 5-1 — the four tiers that speak of success in one response. Each layer claims a different
proposition, and a front tier's truth does not entail a rear tier's truth. The leap of asserting ④ on the
basis of ② alone is semantic collapse.*

### 5.2.1 Why does 200 come instead of 404?

Sum it up as "the server made it wrong" and move on, and you design the client wrong. There are at least
six paths to a 200-error page, and several of them are **intended design.**

| # | Cause | Where it arises | Why it becomes 200 | Intended? |
|---|---|---|---|---|
| 1 | SPA·static-hosting fallback | object storage·static hosting's "missing path → `/index.html`" rewrite | the rewrite changes not just the body but the **status code** too | side effect |
| 2 | reverse-proxy error document | a config like nginx `error_page 403 =200 /deny.html;` | the practice of attaching `=200` is widespread | config choice |
| 3 | auth·consent interstitial | expired session → 302 to a login page | the login page at the end of the redirect is a **normal resource**, so 200 | design |
| 4 | WAF·bot challenge | JS challenge·CAPTCHA page | give a 403 and automation learns immediately. 200 delays detection | **design (security)** |
| 5 | enumeration prevention | not distinguishing "absent" and "unauthorized" by status code | the difference between 404/403 is a leak of resource existence | **design (security)** |
| 6 | CDN origin-error absorption | replacing an origin 5xx with an error document·stale response | a choice to protect the availability metric | design (operations) |

3·4·5 are not bugs. **There are cases where deliberately reducing the status code's information content is
correct design** (covered again in §5.5.2). So this problem is not "a problem that disappears if servers
follow the spec properly."

> The client must assume, as a **normal condition**, a world in which the status code is inaccurate. That
> may be not the other party's bug but the other party's policy.

### 5.2.2 The boundary with Chapter 14 — three layers lie in opposite directions

Chapter 14 covers the phenomenon of the **name and declaration** (URI extension·`Content-Type`) diverging
from the content. This chapter covers the **status code.** Why the two chapters are different faces of the
same principle is seen by placing the two cases side by side.

| | Chapter 14 — a disguised normal segment | This chapter — an expired-token error page |
|---|---|---|
| URI extension | `.html` | `.ts` |
| `Content-Type` | `text/html` | `video/mp2t` |
| status code | `200` | `200` |
| leading bytes | `47 40 11 10` | `3c 21 44 4f` (`<!DO`) |
| actual content | MPEG-TS | HTML |
| correct handling | **accept as normal** | **catch as FAIL** |

**In the two cases the self-reporting layer lies in opposite directions.** In Chapter 14 the name·declaration
say HTML and the content was TS; here the name·declaration say TS and the content is HTML. The verdict is
opposite, yet the only clue distinguishing that verdict, in both, is **a single leading byte.**

So this repository puts no code at all that branches on the header. To branch on the header you must set a
rule distinguishing the two rows above, but the two rows' header sets are not mutually exclusive — the
`.html` + `text/html` + `200` combination could be normal or a failure.

---

## 5.3 The code — the boundary of `ok` and the second gate

### 5.3.1 What exactly does `FetchResult.ok` mean?

```python
# fetch.py:73-79
@dataclass
class FetchResult:
    """One request's result and measurements."""

    url: str
    ok: bool
    status: int = 0
```

The place `ok` stands is the exception boundary of `_send`.

```python
# fetch.py:196-201
except urllib.error.HTTPError as e:
    last_status, last_err = e.code, f"HTTP {e.code} {e.reason}"
    last_origin = (e.headers or {}).get("Access-Control-Allow-Origin", "") or ""
    # 4xx gives the same result on retry (401/403/404 = token expiry·hotlink block)
    if 400 <= e.code < 500 and e.code not in (408, 429):
        break
```

urllib throws an `HTTPError` if the final status is not 2xx (`HTTPErrorProcessor.http_response` judges by
`if not (200 <= code < 300)`). A redirect is followed before that by `HTTPRedirectHandler`. Therefore
`ok=True` means exactly the following.

> **The final status was 2xx, and the body decompression succeeded.** Nothing more.

Spread the boundary into a table and it is this.

| Response | `ok` | Basis |
|---|---|---|
| 200 + normal TS | `True` | normal |
| **200 + HTML error page** | **`True`** | this chapter's problem. being 2xx, no exception |
| **204 No Content** (0-byte body) | **`True`** | 204 is also 2xx |
| **302 → login page → 200** | **`True`** | the 200 after urllib followed the redirect |
| 206 Partial Content | `True` | normal on the `EXT-X-BYTERANGE` path |
| 403 · 404 | `False` | `HTTPError` — being 4xx, halt without retry |
| 500 · 502 | `False` | `HTTPError` — 5xx is a retry target |
| 200 + gzip decompress failure | `False` | [`fetch.py:175-180`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L175-L180) promotes it to a response corruption |

The three bold rows are the point. `ok` is an honest name — it answers only "did the request succeed," not
"did what I wanted arrive." **Not using this field for the final verdict** is how this code keeps that
distinction.

One counterexample attaches here. A 200-error page does **not** trigger a retry. The retry policy judges by
the status code alone ([`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201)) and, being 200, it never even reaches the retry condition. And
that behavior is correct — request the same URL again and the same error page comes for the expired token.
**The problem is not that it does not retry, but that it is counted as a success while not retrying.**

### 5.3.2 The second gate — determination by bytes, not status

```python
# tsanalyze.py:20-37
def sniff(data: bytes) -> str:
    """Determine the segment bytes' container kind: mpegts | fmp4 | unknown.

    Responding with HTTP 200 does not mean media arrived. It is common for a CDN with an
    expired token to return an HTML error page as 200 instead of 404, and if that is counted
    as 'receive success' the verification itself becomes meaningless. Determine by the leading
    bytes, not the status code.
    """
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

That this function's signature is `sniff(data: bytes)` is design. It **does not take the status code as an
argument, so it cannot reference it** (Chapter 14 §14.4.1 tells the same story about `Content-Type`). The
docstring is a measurement record that explicitly wrote down that reason for the status code.

Let us follow how §5.1's error page passes through this function.

| Step | Value | Result |
|---|---|---|
| `len(data) < 8` | 83 | pass |
| `data[0] == 0x47` | `0x3c` (`<`) | mismatch |
| `data[4:8] in _MP4_BOXES` | `b"CTYP"` (the 5th–8th bytes of `<!DOCTYPE`) | mismatch |
| return | | `"unknown"` |

The `len(data) < 8` guard, as a side effect, **also catches empty responses.** 204 No Content, a
proxy-truncated 0-byte response, a 200 with `Content-Length: 0` all fall to `unknown` here. The same gate
handles them without a separate branch.

### 5.3.3 The two failures are reported as different items

```python
# cli.py:452-468
for seg, res in zip(segs, results):
    if not res.ok:
        _eprint(f"    ✗ seg#{seg.index} receive failed: {res.error}")
        continue
    data = res.body
    if seg.key and seg.key.is_encrypted:
        data = keys.decrypt(data, seg.key, seg.seq)
    kind = sniff(data)
    if kind == "unknown":
        # received a 200 but it is not media — an error page came carried instead.
        bogus.append((seg.index, res.content_type, data[:16].hex()))
        _eprint(f"    ✗ seg#{seg.index} not media (Content-Type: {res.content_type or 'none'})")
        continue
    ts_total.merge(analyze(data, cc_state))
    p = work / f"seg{seg.index:06d}{ext}"
    p.write_bytes(data)
    paths.append(p)
```

There are two gates, and the two gates' failures go to **different lists.** A `res.ok` failure remains in
`results`, and a `sniff` failure piles into `bogus`. In the report the two become separate check items.

```python
# report.py:167-173
if failed:
    codes = sorted({f.status or 0 for f in failed})
    rep.add(
        "segment receipt",
        FAIL,
        f"{len(failed)}/{len(fetches)} failed (HTTP {codes}) — loss interval in the reassembled output",
    )
```

```python
# report.py:198-211
# even with HTTP 200 the content may not be media (an error page for an expired token, etc.).
if bogus:
    types = sorted({ct or "no Content-Type" for _, ct, _ in bogus})
    rep.add(
        "payload validity",
        FAIL,
        f"{len(bogus)} are 200 responses but not media ({', '.join(types)}) "
        f"— seg#{bogus[0][0]} head {bogus[0][2][:16]}",
    )
    rep.stats["bogus_payloads"] = [
        {"segment": i, "content_type": ct, "head_hex": h} for i, ct, h in bogus
    ]
else:
    rep.add("payload validity", PASS, "all confirmed as media containers (leading-byte check)")
```

![Two gates](/images/lecture/hls-recon/05-two-gates.svg)

*Figure 5-2 — the two gates one segment response passes through. It asks separately about the success of
transport and the validity of content, and reports the two failures as different report items.*

### 5.3.4 Why split the items — merge them and the report lies

A measurement feeding §5.1's stream straight into this repository's tool.

```
  [2/3] Decryption · transport integrity analysis
    ✗ seg#2 not media (Content-Type: video/mp2t)

  ✓ Playlist            5 segments, declared length 30.00s, TARGETDURATION 6s, no encryption
  ✓ Segment receipt     all 5 received on the first try, 2.7 MB
  ✓ Response latency    TTFB p50 1ms / p95 2ms, throughput median 2021.9 Mbps
  ✗ Payload validity    1 is a 200 response but not media (video/mp2t) — seg#2 head 3c21444f43545950
  ✓ Segment uniqueness  all SHA-256 distinct
  ! TS integrity        5 CC discontinuities (packet loss)
  ✓ Length consistency  measured 30.02s vs declared 30.00s (drift +0.02s / 0.08%)
  ✗ Timeline continuity 1 loss / total 6.03s (max 6.03s) @ 11.99~18.02s
  ✓ Full decode         decoded to the end with no errors
```

The exit code is 2 ([`cli.py:651-652`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L651-L652) maps FAIL to 2). What to read here is not the two FAILs but the
**PASSes.**

| Item | Verdict | Is this verdict correct? |
|---|---|---|
| Segment receipt | ✓ PASS | **correct.** all 5 were actually received on the first try. HTTP failed at nothing |
| Response latency | ✓ PASS | correct. there was no problem with latency |
| Length consistency | ✓ PASS | **correct.** the measured 30.02s is effectively the same as the declared 30.00s |
| Segment uniqueness | ✓ PASS | correct. the hashes are all different |
| TS integrity | ! WARN | correct. only, this is not the error page **itself** but the **result** of skipping it — as seg003 is joined after seg001, the CC jumps in 5 PIDs (Chapter 18) |
| Payload validity | ✗ FAIL | points at the error page |
| Timeline continuity | ✗ FAIL | points at the 11.99–18.02s hole |

**A design that makes a transport-layer item FAIL just to get the conclusion right ruins the report.** Write
that the transport failed and the user comes to suspect the network·authentication·URL, whereas in this case
all of those are normal. Because the cause and the remedy differ, the item must differ.

| | Transport failure (`res.ok == False`) | Content failure (`sniff == "unknown"`) |
|---|---|---|
| representative cause | network cut, 404 link expiry, 403 hotlink block | token-expiry interstitial, WAF challenge, origin-error absorption |
| meaning of retry | may exist (5xx·408·429) | none — the same error page comes again |
| user action | `--referer`·`--cookie`·re-acquire the URL | re-acquire the link (almost always expired) |
| report item | segment receipt | payload validity |
| evidence left | the set of HTTP status codes | `Content-Type` + leading 16 bytes ([`report.py:207-209`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L207-L209)) |

Leaving `Content-Type` with `bogus` is not a basis for the verdict but for after-the-fact analysis. The
verdict was already finished by the leading bytes, and the header is a record to keep "which CDN declared it
as what."

There is also a last defense for the case where all are error pages.

```python
# cli.py:470-471
if not paths:
    raise SystemExit("no segments received — possibly token expiry or Referer-verification failure")
```

It blocks the path where every segment is 200 yet the output is made as a 0-byte file. **Making an empty file
and returning PASS** here is the worst ending this chapter targets.

### 5.3.5 Observability — `_diagnose` shows what arrived

If the same thing happens at the playlist stage, it does not even reach the segment loop. The parser dies
first.

```python
# playlist.py:210-211
if not lines or not lines[0].startswith("#EXTM3U"):
    raise ValueError("no #EXTM3U header — not an M3U8 playlist")
```

Throw only this exception at the user and the user cannot know what to do next. So there is `_diagnose`.

```python
# cli.py:57-75
def _diagnose(res, url: str) -> str:
    """Explain what a response that did not parse as a playlist actually was.

    Throwing only 'no #EXTM3U header' leaves the user not knowing what to do next.
    Show what arrived (status·type·leading bytes) and point at common causes.
    """
    head = res.body[:64]
    printable = "".join(chr(b) if 32 <= b < 127 else "." for b in head)
    lines = [
        f"a response that cannot be interpreted as a playlist: {url}",
        "",
        f"  HTTP status     : {res.status}",
        f"  Content-Type    : {res.content_type or '(none)'}",
        f"  Content-Encoding: {res.encoding or '(none)'}",
        f"  body size       : {res.size:,} B",
        f"  leading bytes   : {head[:16].hex()}",
        f"  leading chars   : {printable[:48]}",
        "",
    ]
```

Of the six lines, the top three are **what the server said** and the bottom three are **what actually
arrived.** `_diagnose` stands the two side by side and makes the mismatch visible to the user. It does not
render a verdict — it only shows what is needed for one. `res.status` is printed but **is used in no branch
condition.**

The branch is done by the body alone.

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

The comment on the fourth branch restates this chapter's conclusion. **The information the status code lost
remains in the body.** The server knew the refusal reason and wrote it in the body. The only thing not
carried over is the status code, so the way to recover it is to show the body as is.

There is one asymmetry here. **The information content of an error message and information leakage are in
tension.** This code is a client tool, so information content wins. Had the same code been on the server, it
should be the opposite — a detailed diagnosis is equally detailed for an attacker. There is one more place in
this repository where a reversal of the same form appears (Chapter 24, the padding oracle).

### 5.3.6 A second application of the same principle — the handling differs for subtitles

```python
# subtitles.py:417-423
def _sniff_format(body: bytes) -> str:
    """Determine a subtitle body's format by its leading content. Empty string if not a subtitle.

    Do not trust Content-Type — some servers give subtitles as `application/octet-stream`,
    and conversely an HTML error page arriving as 200 comes with the same header. Whether
    there is even one cue timecode is the only sure basis.
    """
```

The logic of determination is the same. And yet **the handling of a determination failure differs.**

```python
# subtitles.py:466-473
for url in urls:
    got = fetcher.get(url)
    if not got.ok:
        continue
    found = _sniff_format(got.body)
    if not found:
        # a 200 but not a subtitle — do not save an error page as a subtitle.
        continue
```

For segments it piles into `bogus` and becomes FAIL, whereas for subtitles it `continue`s and tries the next
candidate. The reason is that the two URLs have different provenance.

| | Segment URI | Sidecar subtitle URI |
|---|---|---|
| where it came from | the only address the playlist **specified** | a candidate list **guessed** by name rule |
| when a non-thing arrives | it is a fault — what should be there is not | it is a normal search miss — the candidate was just wrong |
| handling | `bogus` → payload-validity FAIL | `continue` → next candidate |
| if all fail | no output ([`cli.py:470-471`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L470-L471)) | [`subtitles.py:492`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L492) reports it as an error |

**The same determination becomes a fault in one context and a search signal in another.** The determination
itself is a factual statement, and what to see it as is the call site's decision. Had the determination
function rendered the verdict too, one of the two paths would necessarily be wrong.

### 5.3.7 What the regression test fixes down

```python
# tests/run.sh:141-145
# fault 4: reproduce a CDN returning an error page as 200 for an expired token
(d / "seg003.ts").write_bytes(
    b"<!DOCTYPE html><html><body><h1>403 Forbidden</h1>"
    b"<p>Link expired</p></body></html>\n"
)
```

The most important decision in this injection is **leaving the filename as `.ts`.** Had it been changed to
`.html`, `python3 -m http.server` would attach `Content-Type: text/html` and it would be caught by the
header alone. Leave it `.ts` and `mimetypes` returns `video/mp2t` (confirmed on Python 3.14.5), so the worst
combination — where all three self-reporting layers say normal — is reproduced. README:382-384 states this
intent.

> The `HTML in a 200 response` item is missed if you trust the header. In the test the server responds with
> `Content-Type: video/mp2t` but the body is `<!DOCTYPE html>` — so the verdict is by the leading bytes, not
> the header.

The detection is nailed down by regression.

```bash
# tests/run.sh:486-487
grep -q '페이로드 유효성.*미디어가 아님' "$DLOG" \
  && ok "200-error-page detected" || bad "200-error-page missed"
```

And a control follows.

```bash
# tests/run.sh:512-519
# fix down the very fact that ffmpeg alone misses the same loss.
head_ "[4/4] Control — ffmpeg alone misses the loss"
set +e
ffmpeg -v error -y -i "$BASE/damaged/index.m3u8" -c copy "$WORK/out/naive.mp4" >/dev/null 2>&1
naive=$?
set -e
if [[ $naive -eq 0 ]]; then
  ok "ffmpeg alone exit 0 — does not report the loss (the reason the tool is needed)"
```

§5.1's measurement reaffirmed this control **under the condition of leaving only one fault.** The
repository's `damaged` stream has four faults together (`tests/run.sh:129-147`), so which fault triggered
what is not separated. And here is one uncomfortable fact.

> **The two tools' outputs are effectively the same.** Both ffmpeg alone and this repository's tool made a
> 720-frame file, and the same place (11.99–18.02s) is empty. The only difference is the exit code (0 vs 2)
> and the report.

Verification does not fix the output. **It fixes the statement about the output.** Blur this distinction and
a wrong expectation arises — "attach a verification tool and the result gets better."

---

## 5.4 Generalization — reading a layer's success as an endpoint's success

> **Term** — **the end-to-end argument**: a design principle of Saltzer·Reed·Clark (1984). If a function's
> correctness depends on the endpoints' (both ends') knowledge, that function must be implemented at the
> endpoints, and a guarantee provided by an intermediate layer has no meaning beyond a performance
> optimization.

A status code is an intermediate layer's success signal. And a signal of the same form is everywhere in
systems.

| Signal | What it actually guarantees | What it is often read as | The form the collapse takes |
|---|---|---|---|
| HTTP `200 OK` | the request was processed and the response delivered | I received the resource I wanted | saving an error page as data |
| process `exit 0` | the process **declared** its own success | the work was completed | ffmpeg skipping a loss (§5.1) |
| SMTP `250 OK` | the next hop **accepted** the message | it was delivered to the recipient | a later bounce·spam quarantine |
| DNS `NOERROR` + empty ANSWER | the query was processed normally | the name was resolved | failing to distinguish NODATA from "no IP" |
| TCP ACK | the peer **kernel** received the bytes | the application processed it | loss on a receiver crash |
| message-queue ack | the broker stored it | the consumer processed it | at-least-once redelivery (Chapter 29) |
| DB `COMMIT` success | the transaction committed | the intended data went in | quiet truncation of a loose schema |
| a green CI light | all the checks that **ran** passed | the code is correct | what was not checked (Chapter 34) |
| `Content-Length: 0` + 200 | the response arrived | the resource is empty | mistaking a proxy truncation for normal |

The misreading of all nine rows has the same structure.

> **What a signal can guarantee is only what the party that made the signal can observe.**

The next hop that sent SMTP 250 cannot observe the final recipient's mailbox. The ffmpeg that returned
`exit 0` **does not define** the "missing 6 seconds" as a loss — by its own standard, a normal termination is
correct. The proxy that sent HTTP 200 does not know the origin's authorization decision.

Therefore verification must always be done **at the endpoint, by a different observation that did not make
that signal.** The reason this repository has three layers of independent observation is entirely here.

| Observation | What it substitutes for | Anchor |
|---|---|---|
| payload leading bytes | substitutes for the status code·`Content-Type` | [`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37) |
| continuity counter | substitutes for "full receipt" | [`tsanalyze.py:112-119`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L112-L119) (Chapter 18) |
| PTS timeline gap | substitutes for total-length comparison | [`probe.py:191-233`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L191-L233) (Chapter 21) |
| the SHA-256 set | substitutes for "different pieces arrived" | [`report.py:213-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L213-L218) |

Each row's left is an observation not involved in the process by which the right is made. That independence
is what makes verification worthy of the name.

---

## 5.5 Security

### 5.5.1 What a 200-error page creates

| Consequence | Mechanism | Who gets hurt |
|---|---|---|
| **cache poisoning** | 200 is in the list of status codes the HTTP spec defines as "heuristically cacheable" and **403 is not** (RFC 9110 §15.1 · RFC 9111 §3). issue a permission refusal as 403 and it does not stay in a shared cache, but issue it as 200 and it can — one user's expired-token error page is served to a normal user through the cache | normal users |
| **monitoring silence** | it is standard practice to set SLO alarms on the 4xx·5xx ratio. if the error goes out as 200, the error rate is observed as 0% | operators |
| **storage poisoning** | an automatic collector saves the error page as content. if a later inventory judges that file "already present," that episode is **permanently** missing (Chapters 20·37) | pipeline |
| **parser exposure** | an HTML error page becomes the input to a media parser·subtitle parser. input crossing a trust boundary arriving in an unexpected format is the standard premise of a parser vulnerability | client |
| **soft 404** | a search engine indexes the error page as a normal document | site operator |

The third is the scenario this repository actually guards against. So the inventory looks not at a file's
**existence** but at its **structural completeness** ([`inventory.py:67-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L67-L102), Chapter 20). Because if an error
page hardens into an artifact and that is judged "present," no re-run afterward can fill that episode.

> **The real cost of a 200-error page is not that failed request, but that a state recording the failure as
> a success is made permanent.**

### 5.5.2 And yet 200 is also a defense

Explain only bypass paths and stop, and it is half done. **There are cases where reducing the status code's
information content is correct security design.**

| Defense technique | Why 200 | Representative case |
|---|---|---|
| resource-existence hiding | the difference between 403 (exists but no permission) and 404 (absent) is a leak of existence | a code-hosting service that gives 404 for a private repository |
| account-enumeration prevention | not distinguishing success/failure by status code in login·password reset | a standard recommendation of authentication design |
| bot challenge | give a 403 and automation learns immediately and tries to bypass. 200 + a challenge page slows that learning | a WAF·CDN's JS challenge |

It is the same form as Chapter 14 concluding "the disguise did not create a new vulnerability but revealed an
assumption that never held," except here **the side breaking the assumption is the defender.** A client that
takes the status code as a trustworthy basis for a verdict breaks every time the server improves its
security.

There is a resolution to this tension. **Information hiding and distinguishability can coexist** — unify the
status code but leave the body as a machine-readable error representation (RFC 9457
`application/problem+json`). The information the status code lost is moved to the body, and the correct
compromise is making that body have a standardized structure rather than human-facing HTML.

### 5.5.3 The defender's view, by role

| Role | What to do | What not to do |
|---|---|---|
| **CDN·reverse-proxy operator** | if you must send an error body as 200, attach `Cache-Control: no-store` along with it. check whether the origin-error-absorption rule rewrites even the status code | do not use `error_page … =200` out of inertia |
| **API·service designer** | if you decide to unify status codes, put a **machine-readable** error representation in the body (RFC 9457). keep an error response's `Content-Type` different from a success response's | do not, while giving 200, give even the body only as human-facing HTML |
| **SRE·monitoring** | do not set SLOs by status-code distribution alone. also set the response body's format conformance or an end-to-end synthetic check | do not take "5xx 0%" as the definition of normal |
| **client·collector author** | put **one more content-verification gate** behind the status-code gate. report the two failures as different items | `if resp.status == 200: save(resp.body)` |
| **pipeline operator** | put format determination **before** the storage stage. separate the download success rate and the completeness metric | do not use the success rate as a proxy for completeness |
| **security reviewer** | see whether the status code and the body say different things on auth·authorization failure paths. it is common for the body to leak more than the status code | do not verify access-control behavior by the status code alone |

`if resp.status == 200: save(resp.body)` — reduced to one line, this is the code this chapter targets. The
way to fix it is one line too. **Before saving, confirm what it is.**

---

## 5.6 Limits and open questions

Noted honestly.

- **`sniff` catches not "a 200-error page" but "a non-media thing."** If the response happens to be valid
  MPEG-TS — a segment of another channel left in the cache, a substitution to an ad stream — it passes this
  gate as is. There is a possibility that a following CC check or timeline check filters it indirectly, but
  **I could not confirm it.** What is certain is the fact that this repository has no check that asks
  **directly** "is this segment the very one I requested," and to ask that the playlist would have to declare
  a segment digest, which RFC 8216 has no tag for. It is not an implementation limit but **a spec limit.**
- **A 200 after following a redirect leaves no trace.** `fetch.py` uses urllib's default redirect handling
  as is. Get a 200 after a 302 to a login page and `FetchResult.status` is 200, and `FetchResult.url`
  ([`fetch.py:181-182`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L181-L182)) contains the **request URL** put through `normalize_url()`, not the final URL. The very
  fact that there was a redirect is not recorded. A regrettable point as diagnostic info, and an unimproved
  item confirmed while writing this chapter.
- **`_diagnose` attaches only to the playlist path.** The call sites are only two, [`cli.py:140`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L140) and
  [`cli.py:191`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L191). When a segment is an error page, only the `Content-Type` and leading 16 bytes remain, and no
  detailed explanation that thorough comes out. The judgment is that per-item diagnosis is impractical since
  segments can be hundreds, but for **the case where all are error pages** ([`cli.py:470-471`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L470-L471)) there is room
  to attach at least one diagnosis.
- **It does not check the consistency of range requests.** On the `EXT-X-BYTERANGE` path it sends a `Range`
  header ([`fetch.py:155-159`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L155-L159)), but there is no code that checks the response's `Content-Range` or whether the
  status is 206. Even if the server ignores the range and returns the whole thing as 200, it is received and
  used as is. The exposure surface is narrow, but it is a fact that there is no check.
- **The weights of §5.2.1's six causes were not measured.** Each mechanism is confirmed to be real, but which
  cause is what percentage of the 200-error pages actually observed cannot be answered by this repository's
  data. In particular, the share 4·5 (intended 200s for security purposes) take of the whole is an estimate.
- **The measurement is a local reproduction.** The figures of §5.1 and §5.3.4 were obtained on
  `python3 -m http.server` + ffmpeg 8.1.1 (macOS arm64). A real CDN can behave differently by its cache·
  rewrite rules, and in particular a config that changes `Content-Type` to `text/html` to match the error
  page is common — that case is caught by the header alone. What this code guards against is the **worse
  side, where the header is not changed.**

---

## 5.7 Summary

1. **`200 OK` carries two propositions in one value.** "The request was processed and the response
   delivered" is an observable fact, and "the body is a representation of the requested resource" is the
   server's claim. The spec has neither a means to verify the latter nor to enforce it.
2. **Semantic collapse does not arise because the signal is wrong.** It arises from reading more out of the
   signal than it can carry. In §5.1's measurement the HTTP layer said exactly the correct thing.
3. **Total length·exit code·error log do not distinguish this loss.** 30.023s vs 30.023s, exit 0 vs exit 0.
   The warning-level log shows `Packet corrupt` but it disappears with `-v error`, is not reflected in the
   exit code, and does not say how much was lost. What is distinguishable is the frame count (900→720) and
   the PTS gap (6.03s @ 11.99s).
4. **The only basis for determination is the payload's leading bytes.** `sniff(data: bytes)` does not take
   the status code as an argument — cannot take it, so cannot reference it.
5. **A transport failure and a content failure are different events, so they are reported as different
   items.** In the measured report "segment receipt PASS" and "payload validity FAIL" are simultaneously
   true, and both are correct. Make the transport item FAIL just to get the conclusion right and you send the
   user to the wrong cause.
6. **A 200-error page is not only a server bug.** Resource-existence hiding·account-enumeration prevention·
   bot challenge are security designs that **deliberately** reduced the status code's information content.
   The client must assume, as a normal condition, a world in which the status code is inaccurate.
7. **Verification does not fix the output but fixes the statement about the output.** The output files of
   ffmpeg alone and of this tool were both 720 frames, the same. The only difference is the exit code and the
   report.

---

**Next chapter** — this chapter covered that the status code does not guarantee the content. Chapter 6 sees
what is left undefined when the features by which server and client **negotiate the way content is
represented** (compression·range requests) overlap. When `Range` and `Content-Encoding` are engaged at once,
the spec does not answer what "the byte range" is the range of, and that gap becomes a classic cause of cache
poisoning.
