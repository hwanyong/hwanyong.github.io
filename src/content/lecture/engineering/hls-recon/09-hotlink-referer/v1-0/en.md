---
title: "Dissecting Hotlink Blocking"
description: "Referer, a self-report"
date: 2026-06-08
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-09-hotlink-referer.svg
---
## 9.0 What this chapter answers

1. Why does an address that opens in a browser come back as **404** from a tool?
2. Why must the Referer differ at each stage of the request chain — if even one is empty, what breaks?
3. Can access be controlled by a value the client sends?
4. Why is a control weak in principle so widely used — against what is it actually strong?
5. What structure does code that swaps headers per request require?

---

## 9.1 The problem — it opens in a browser but 404s from a tool

Copy a `.m3u8` address from the devtools Network tab and put it into `curl` as is, and it goes like this.

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://cdn.example/hls/9f3a/master.m3u8
404
```

Paste the same address into a browser tab and it plays. **The address does not differ by a single
character.** What changed is only the headers carried in the request.

What makes the diagnosis hard here is not the block itself but **the clothes the block wears.**

| State | What the server claims | What the receiving side does next |
|---|---|---|
| `403 Forbidden` | the resource exists, and you have no permission | **look for the credential condition** — header·cookie·token |
| `404 Not Found` | there is no such resource | **suspect the address** — hash·path·typo·expiry |

Someone who received a 404 looks for a non-existent problem. They re-fetch the hash, recount the path,
reissue the token. What is actually missing is **one header line not sent.**

This repository nailed that measurement into a comment.

```python
# series.py:104-105
    You must send the same values a browser sends. Leave even one empty and the server
    returns a 404 that looks like a missing page, making the cause hard to pin.
```

The **semantic collapse of status codes** covered in Chapter 5 appears here with only the direction changed.
Chapter 5's case was "200 but a failure," and this chapter's case is "404 but the resource is fine." In both,
the status code tells a **story that is not true** and cannot be used as a basis for judgment.

So this tool's failure diagnosis puts Referer on the **first line** of cause candidates.

```python
# cli.py:94-96
        "  common causes:",
        "    · Referer/Origin verification — attach --referer 'https://original-page/'",
        "    · cookie·auth needed — attach the browser's Cookie header value with --cookie '...'",
```

And it fixed that guidance down with a regression test so it does not disappear.

```bash
# tests/run.sh:205
grep -q 'Referer' "$DIAG" && ok "solution guidance" || bad "no solution guidance"
```

The very idea of **fixing a diagnostic message with a test** tells the nature of this problem. If the cause is
a header while the symptom is a 404, you cannot expect a person to build that connection themselves. The tool
must tell them.

The same judgment is in the segment-receipt stage.

```python
# cli.py:471
        raise SystemExit("no segments received — possibly token expiry or Referer-verification failure")
```

Rather than ending with "no segments," it **gives two cause candidates together.** Observability is useful only
when it tells you not what failed but what to try next.

---

## 9.2 The principle — who is it that writes Referer?

Fix the terms first.

> **Term** — **Referer**: the HTTP request header carrying the address of the document that induced this
> request (RFC 9110 §10.1.3). The misspelling is a typo from RFC 1945 (1996) that hardened as is, and later
> policy headers use the correct spelling (`Referrer-Policy`).

> **Term** — **origin**: the combination of the three values scheme·host·port (`https://site.example:443`).
> All three must be the same to be same-origin. The `Origin` request header corresponds to the Referer with
> the path and query string removed.

> **Term** — **hotlinking (inline linking)**: referencing a resource on another's server directly from your
> own page, so the bandwidth cost is borne by the original server while the display and ad revenue go to the
> referencing side. The server setting that blocks this is **hotlink blocking.**

Now the one fact this whole chapter hangs on.

> **It is the requester that writes the Referer value. The server only reads it, and cannot decide what will
> be written.**

It is exactly the same structure as `Content-Type` or a URI extension (Chapter 14). Only the direction is
opposite. In Chapter 14 the **server** self-reported about itself, and here the **client** self-reports about
itself. Either way the spec does not enforce that the report is true, and there is no way to.

### 9.2.1 So why does it control at all — the existence of an enforcer

The reason a value forgeable in principle functions as a control in practice is one. **For most requesters
there is an enforcer that writes the value for them, and the requester cannot bypass that enforcer.**

Code running inside a browser cannot set `Referer` itself. Because the Fetch spec put this header on the list
scripts cannot set.

> **Term** — **forbidden header name**: the list of request-header names the Fetch spec designated as not
> settable by script. `Referer`·`Origin`·`Host`·`Cookie` and the `Sec-` prefix, etc., are in it. Specify one
> of these names with `fetch()` or `XMLHttpRequest.setRequestHeader()` and the request does not fail; **only
> that specification is silently ignored.**

That is, the browser enforces the truthfulness of this header on the server's behalf. What the server trusts is
not the value but **the party that wrote the value.**

![The control's efficacy splits by who writes the Referer](/images/lecture/hls-recon/09-enforcer-location.svg)

*Figure 9-1 — the control's efficacy splits by who is the party writing the value*

Outside the browser there is no such enforcer. `curl`, Python `urllib`, and `ffmpeg` all write arbitrary
values. Therefore the following proposition holds.

> **The strength of a self-reported-value control rests not on the value but on the enforcer. For a requester
> with no enforcer, this control's efficacy is 0.**

Even the phrase "weak defense" is not accurate. It is not weak; **for that requester it is not a control at
all.** For a different requester, on the other hand, it is an almost complete control. Which one it is is
decided not by the value but by the **threat model** (§9.7).

---

## 9.3 The code — a different value at each stage of the chain

### 9.3.1 `_from` — the header to attach to this request only

The site this repository handles makes four requests to open one episode. Each request is opened in a different
context, so the Referer a browser carries differs each time. The function that makes it is eleven lines total.

```python
# series.py:99-109
def _from(referer: str) -> dict[str, str]:
    """The Referer/Origin to attach to this request only.

    Each stage of the chain is opened from a different place — the episode page from within the
    site, the player as an iframe within the episode page, the playback source as an XHR within
    the player. You must send the same values a browser sends. Leave even one empty and the server
    returns a 404 that looks like a missing page, making the cause hard to pin.
    """
    # header values are written as ASCII. put a Korean-containing episode address into Referer raw
    # and it dies the moment the request is made, so encode it by the same rule as the address.
    return {"Referer": normalize_url(referer), "Origin": _origin(referer)}
```

That the function name is `_from` says the whole of this function. The argument is "**from** where did the
request come," and the return is the two headers reporting that fact to the server.

### 9.3.2 The chain — which stage gets which value

```python
# series.py:271-284
    page_url = episode.page_url
    page = fetcher.get_text(page_url, _from(_origin(page_url) + "/"))
    player = _player_url(page, episode.page_url)
    origin = _origin(player)
    video_hash = _PLAYER_RE.match(player).group("hash")

    # the player HTML holds only settings. the actual playback address is issued by the XHR below.
    settings = unpack(fetcher.get_text(player, _from(page_url)))

    res = fetcher.post(
        f"{origin}/player/index.php?data={video_hash}&do=getVideo",
        {"hash": video_hash, "r": episode.page_url},
        _from(player),
    )
```

Just look at the fact that the three `_from(…)` arguments differ. `_origin(page_url) + "/"`, `page_url`,
`player` — **the document address one stage back** becomes the next request's Referer.

![The four-stage request chain to open one episode and the per-stage Referer](/images/lecture/hls-recon/09-referer-chain.svg)

*Figure 9-2 — the four-stage request chain to open one episode and the per-stage Referer*

Organized into a table with anchors, it is as follows.

| Stage | Request | Referer | Origin | Anchor |
|---|---|---|---|---|
| 0 | series list `/c/<title>` | site root | site | [`series.py:157`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L157) [`series.py:160`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L160) |
| 1 | episode page `/e/<title> N화` | site root | site | [`series.py:272`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L272) |
| 2 | player `<player>/video/<hash>` (iframe) | **the episode page's full address** | site | [`series.py:278`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L278) |
| 3 | `player/index.php?…&do=getVideo` (XHR·POST) | **the player's full address** | player | [`series.py:283`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L283) |
| 4 | m3u8 · segments (CDN) | the player origin | player | [`series.py:300`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L300) → [`cli.py:907-908`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L907-L908) |

Only in stages 2·3 is the **full address including the path** carried. The rest are the root, just origin plus
`/`. This is a transfer of observing the browser, not a reverse-engineering of the server rule (§9.8).

### 9.3.3 Why the path is discarded at the last stage

The value passed to stage 4 has no path.

```python
# series.py:300
    return Play(playlist_url=link, name=_name_of(settings, episode, fallback_width), referer=origin + "/")
```

```python
# cli.py:905-908
        # use the origin the player told us as the Referer. if the user specified one, leave it.
        ep_headers = dict(given)
        ep_headers.setdefault("Referer", play.referer)
        ep_headers.setdefault("Origin", play.referer.rstrip("/"))
```

The request from the player (`player.example`) to the CDN (`cdn.example`) is **cross-origin.** The current
default Referrer-Policy of major browsers is `strict-origin-when-cross-origin`, and under this policy a
cross-origin request carries **only the origin, no path.** That is, this code discarding the path at stage 4 is
a choice to send the same value a browser actually sends.

> **Term** — **Referrer-Policy**: a response header and document metadata that determines how much Referer to
> carry on requests a document induces. It has values like `no-referrer` (send none) · `origin` (origin only) ·
> `strict-origin-when-cross-origin` (full address if same origin, origin only if different origin, send none on
> an HTTPS→HTTP downgrade).

Here one defender-side conclusion comes early. **A Referer rule that checks the path is already broken.**
Because the browser default erases the path on cross-origin requests. The remaining check is effectively only
a host check, and the host string is the easiest part to forge.

### 9.3.4 Why go through `normalize_url` — without encoding, the request dies

`_from`'s comment says "it dies the moment the request is made." Measure whether that is actually so and it is
this.

```
raw     : https://site.example/e/그렌라간 3화
norm    : https://site.example/e/%EA%B7%B8%EB%A0%8C%EB%9D%BC%EA%B0%84%203%ED%99%94

raw referer  : UnicodeEncodeError - 'latin-1' codec can't encode characters in
               position 23-26: ordinal not in range(256)
norm referer : value the server received = 'https://site.example/e/%EA%B7%B8…%ED%99%94'
```

**It dies inside the client before reaching the server.** It does not even go out to the network, so there is
not even a status code. To be precise, the boundary is not ASCII but latin-1 — because Python `http.client`
encodes headers as latin-1. RFC 9110 specifies the field value as US-ASCII and only says to treat other bytes
(`obs-text`) opaquely.

Here Chapter 7 (URL normalization and idempotency) catches again. Referer is **a header carrying an address**,
so it must be encoded by the **same rule** as the address. Encode it separately and you get two different
strings pointing at the same document, and whether it passes splits by which one the server compares against.
That `_from` does not call `urllib.parse.quote` directly but reuses `fetch.normalize_url` is the reason —
**the rule for making an address must be one in the repository.**

---

## 9.4 The code — why this header is not written on the instance

### 9.4.1 Request locality

The fact that the value differs per stage decides the fetcher's structure. This repository handles it with
`_send`'s first two lines.

```python
# fetch.py:139-150
    def _send(
        self,
        url: str,
        byterange: tuple[int, int] | None = None,
        data: bytes | None = None,
        extra: dict[str, str] | None = None,
    ) -> FetchResult:
        # extra is the header to attach to this request only. as we go through the pages the Referer
        # changes per stage (parent page → iframe → XHR), and writing it to the instance headers
        # contaminates the next request. a user-specified header wins as is.
        headers = {**self.headers, **{k: v for k, v in (extra or {}).items()
                                      if k not in self.headers}}
```

One expression has two properties in it.

| Property | Implementation | What breaks without it |
|---|---|---|
| **request locality** | merge `extra` into the local `headers` only. never write `self.headers` | stage 3's Referer leaks into stage 4, and further into the next episode |
| **priority** | `if k not in self.headers` — a key already on the instance cannot be beaten by `extra` | the value the user specified with `--referer` is overwritten by the chain's guess |

### 9.4.2 Why the contamination spreads to a whole episode

`Fetcher` is not remade per request. Series mode makes **one** and reuses it for list discovery and playback-
source resolution of all episodes.

```python
# cli.py:787
    pages = Fetcher(headers=dict(given), timeout=args.timeout, retries=args.retries)
```

This instance handles both `series.discover()` ([`cli.py:790`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L790)) and `series.resolve()`
([`cli.py:884`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L884), [`cli.py:743`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L743)). Therefore, had it been implemented with `self.headers.update(extra)`, the
contamination scope is not **the one next request.**

```
request 3 (XHR)   Referer = https://player/video/9f3a…   ← recorded on the instance
request 4 (CDN)   Referer = https://player/video/9f3a…   ← the wrong value
episode 1 ends
episode 2 request 1     Referer = https://player/video/9f3a…   ← episode 1's value is still alive
…
all the way to episode 27
```

And this failure is **quiet.** The server returns a 404, and a 404 looks like "a missing page" (§9.1). It
becomes a symptom where only episode 1 of 27 succeeds and the rest are all reported as "missing episodes," and
nowhere in the output is there a clue that the cause is a header.

### 9.4.3 The path where a user specification wins

The rule that `extra` cannot beat an instance header is for user-specified headers.

```python
# cli.py:488-501
def _given_headers(args: argparse.Namespace) -> dict[str, str]:
    """Gather the request headers the user specified. always takes priority over auto-inference."""
    given: dict[str, str] = {}
    for h in args.header:
        k, sep, v = h.partition(":")
        if not sep:
            raise SystemExit(f"--header format is wrong (need K:V): {h}")
        given[k.strip()] = v.strip()
    if args.referer:
        given["Referer"] = args.referer
        given.setdefault("Origin", "{u.scheme}://{u.netloc}".format(u=urlparse(args.referer)))
    if args.cookie:
        given["Cookie"] = _normalize_cookie(args.cookie)
    return given
```

Give `--referer` and `Origin` is set together (being `setdefault`, if `--header 'Origin: …'` gave one
separately, that one remains). This dict becomes the initial value of `Fetcher.headers`, and from that moment
the chain's `_from` has no power over Referer.

**That there is only one priority rule matters.** Since the order "user specification > auto-inference" exists
in only one line of `_send`, GET·POST·segment receipt·ffmpeg delegation all follow the same order. Had this
rule been implemented separately per path, a split symptom like "it is received but only the measurement fails"
occurs — [`probe.py:58-59`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L58-L59) is a spot that wrote down the same intent.

---

## 9.5 Lab — local reproduction

You can reproduce everything with no external site. All you need is `python3` and `curl`.

### 9.5.1 Setting up a Referer-checking server

```python
# srv.py — a server that gives 404 if Referer does not match
import http.server
ALLOWED = "https://site.example/"
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        ref = self.headers.get("Referer", "")
        ok = ref.startswith(ALLOWED)
        body = b"MEDIA" if ok else b"<!DOCTYPE html><html>404</html>"
        self.send_response(200 if ok else 404)
        self.send_header("Content-Type", "video/mp2t" if ok else "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8982), H).serve_forever()
```

Measured result:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8982/seg000.ts
404
$ curl -s -o /dev/null -w '%{http_code}\n' -e 'https://site.example/' http://127.0.0.1:8982/seg000.ts
200
$ curl -s -o /dev/null -w '%{http_code}\n' -H 'Referer: https://site.example/aaaaaa' http://127.0.0.1:8982/seg000.ts
200
```

| Referer sent | Status |
|---|---|
| (none) | `404` |
| `https://site.example/` | `200` |
| `https://site.example/aaaaaa` — **a non-existent path** | `200` |

The third row is this section's point. The server does not confirm whether that page really exists. It has no
way to — it is not its own server, going to check is itself a cost, and whether that page really induced the
request is unknowable anyway. **What it can check is only the front of the string.**

### 9.5.2 The chain — a server that demands a different value per stage

This time, set up a server demanding a different Referer per path and step through it with this repository's
`Fetcher` (the same way as `series._from`).

```python
EXPECT = {
    "/e/ep3":        "http://127.0.0.1:8981/",                # from within the site
    "/video/abc123": "http://127.0.0.1:8981/e/ep3",            # the episode page's iframe
    "/player/get":   "http://127.0.0.1:8981/video/abc123",     # the XHR within the player
}
```

```text
── 1. step through the chain with no Referer
   GET /e/ep3           → 404  HTTP 404 Not Found
   GET /video/abc123    → 404  HTTP 404 Not Found
   GET /player/get      → 404  HTTP 404 Not Found

── 2. carry the same Referer as a browser at each stage (series._from way)
   GET /e/ep3           Referer=http://127.0.0.1:8981/                → 200
   GET /video/abc123    Referer=http://127.0.0.1:8981/e/ep3           → 200
   GET /player/get      Referer=http://127.0.0.1:8981/video/abc123    → 200
```

**Same address, same tool, same order.** What differs is one header.

### 9.5.3 When written to the instance — a counterexample

Assume `extra` was recorded to `self.headers`, and re-request stage 1 with stage 3's value still remaining.

```text
── 3. does extra remain on the instance
   keys of fetcher.headers: ['User-Agent']

── 4. if the last stage's value was written to the instance
   GET /e/ep3       even giving the correct value via extra → 404 HTTP 404 Not Found
   Referer the server actually received: http://127.0.0.1:8981/video/abc123
```

The two lines each confirm one thing.

- **#3** — even after handling three requests via `extra`, `fetcher.headers` has only `User-Agent`. Request
  locality is actually kept.
- **#4** — once the instance is contaminated, **even giving the correct value via `extra` is useless.** Because
  `extra` loses due to `if k not in self.headers`. When the priority rule and contamination overlap, there is
  no recovery path.

#4 is a failure that appears only when the two properties, each correct alone, are **violated together.** Keep
request locality alone and #4 does not happen, and even with contamination, had the priority been the opposite,
`extra` could overwrite. Such failures are hard to catch with unit tests — each function satisfies its own
spec.

---

## 9.6 Generalization — control without an enforcer

### 9.6.1 Headers with the same structure

| Header | Control use | Enforcer inside the browser | Outside the browser |
|---|---|---|---|
| `Referer` | hotlink blocking | the browser (forbidden header) | an arbitrary value in one line |
| `Origin` | CSRF defense | the browser (forbidden header) | an arbitrary value in one line |
| `Sec-Fetch-Site` · `-Mode` · `-Dest` | fetch-metadata-based isolation | the browser (forbidden header) | an arbitrary value in one line |
| `Cookie` | session authentication | the browser (forbidden header · SameSite) | reuse the value as is if you know it |
| `User-Agent` | bot blocking·content negotiation | none | an arbitrary value in one line |
| `X-Forwarded-For` | IP-based access control | none (intermediate proxy writes it) | an arbitrary value in one line |

Only `Cookie` differs in nature. Its value is **an unguessable secret**, so it requires theft, not forgery. The
rest are all: knowing the value is making it.

> **Term** — **fetch metadata**: the bundle of `Sec-Fetch-*` headers the browser attaches to each request
> automatically. They tell the server whether the request came from the same site (`Site`), what mode it is in
> (`Mode`), and what it is for (`Dest`). The `Sec-` prefix in the name is itself the forbidden-header marker.

### 9.6.2 Same header, opposite efficacy

`Origin` checking is recommended as the standard for CSRF defense, and `Referer` checking is said to be unusable
as access control. **The same nature of value, yet the evaluation is opposite.** The point of divergence is not
the value but the threat model.

| Requester | Enforcer | The check's efficacy |
|---|---|---|
| an **attacker page** running in the victim's browser | the browser | **valid** — cannot change the value. the basis on which CSRF defense holds |
| an attacker's **server·script·downloader** | none | **invalid** — writes the value freely |
| an intermediate **proxy·enterprise gateway** | the proxy | the value is erased or appended → **false positive** |

- **CSRF's threat model** is "an attacker page running inside the victim's browser." That requester has an
  enforcer, so `Origin` checking is an actual defense.
- Take **hotlink blocking's threat model** as "every requester trying to take the content" and inside it are
  requesters with no enforcer, and the moment there are, the check is not a defense.

If Chapter 14 showed "the same code becomes a vulnerability or a virtue by role," this chapter shows **the same
mechanism is a valid defense or an empty shell by threat model.** What divides the judgment is always not the
mechanism but **from whom you protect what.**

### 9.6.3 The hole of "a request with no value"

Look at nginx's standard idiom.

```nginx
valid_referers none blocked site.example *.site.example;
if ($invalid_referer) { return 403; }
```

The first word `none` means **allow a request with no Referer at all.** This one word neutralizes the whole
control — because it passes just by **removing the header**, with no need to forge.

But remove `none` and normal users are blocked.

| Put `none` in | Remove `none` |
|---|---|
| every request that omitted the header passes (bypass cost 0) | a normal request from a page with `Referrer-Policy: no-referrer` is blocked |
| users of privacy settings·extensions use it normally | users of privacy extensions·some enterprise proxies are blocked |
| | an HTTPS → HTTP downgrade request is blocked (by spec it does not send Referer) |

**Whichever side you choose there is a price, and that price comes from the control's nature.** "Check if there
is a value and pass if not" is a hole shared by all self-reported-value controls. `X-Forwarded-For` and
`User-Agent`-based blocking are pierced at the same spot in the same way.

---

## 9.7 Security — why a control weak in principle is widely used

### 9.7.1 The threat this control actually aimed at

Hotlink blocking was not made for content protection. It was made to block **bandwidth theft.** If another's
blog attaches my video to their page with `<video src="https://cdn.example/…">`, the transfer cost is mine and
the ad revenue is theirs.

That threat's requester is **the visitor's browser.** There is an enforcer. Therefore —

> **Referer checking is not a failed defense. Within its own threat model it is an almost complete defense.**

The problem arises when you **book it as a control of a different threat model.** It is the accounting item that
is wrong, not the mechanism. It is exactly the same form of error as Chapter 25's "AES-128 is not DRM."

### 9.7.2 Cost vs effect

| Item | Referer check | signed URL (Chapter 11) | session authentication |
|---|---|---|---|
| server-side introduction cost | two lines of config · a CDN console checkbox | HMAC-key management · clock sync · expiry design | user DB · session store |
| client change | **none** | none (only the issuing side changes) | needs a login flow |
| cache friendliness | high — the URL is unchanged | low — the URL differs per issuance | low |
| what it actually blocks | another page's embed | reuse after a link leak (until expiry) | unqualified users |
| what it cannot block | **every requester that knows how to write a header** | redistribution before expiry | credential sharing |
| false-positive cause | Referrer-Policy · privacy settings · proxy | client clock skew | session expiry |

The introduction cost is effectively 0, it changes no client, and it blocks most of the actual threat. **That
is why it is widely used.** There is no need to explain this as "ignorance" — in most cases it is a reasonable
choice. The mistake arises when you make this the **only** control, or book it as paid-content protection.

### 9.7.3 The choice of 404 — what is gained and what is lost

Giving the block as a 404 may be intentional design. It is to hide the resource's **very existence.** But this
gain is almost nil.

| | Given as 403 | Given as 404 |
|---|---|---|
| a requester who already has the address | knows the resource exists | **still knows** — just open it in a browser |
| a requester who does not know the address | cannot request in the first place | cannot request in the first place |
| a normal user·in-house tool | narrows the cause to a header | **spends time suspecting the address** |
| operational cost | — | increased support-inquiry·misdiagnosis cost |

**The gain of hiding does not hold for the side that already has the address, and the cost all returns to
oneself.** Moreover a 404 is a dishonest status code, and a dishonest status code contaminates even the
client's retry policy — [`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201) does not retry a 4xx except `408`·`429` and cuts off, and that judgment
rests on the premise "a 4xx is the same however you redo it." Even though with just a Referer attached it is not
the same.

### 9.7.4 The defender's view — what to do, by role

| Role | What to do |
|---|---|
| **CDN · delivery operator** | book Referer checking only as **bandwidth-theft suppression.** book it as paid-content access control and the ledger is wrong. put the actual control in signed URLs (Chapter 11) and sessions |
| 〃 | give the block **as 403.** a 404 hides nothing while only raising your own support cost (§9.7.3) |
| 〃 | do not **carry the allowed origin in the block response.** attach `Access-Control-Allow-Origin` only to a success response — attach it to a 403 and you are telling "which value to send" (Chapter 10) |
| 〃 | **explicitly decide and record** whether to put `none` in `valid_referers`. leave the default and write "Referer checked" and it is the same as no control (§9.6.3) |
| **application developer** | using `Origin`·`Sec-Fetch-Site` for CSRF defense is **valid** — because the threat model is inside the browser. only, pass a request with **no** header and it becomes invalid at that moment |
| 〃 | do not treat Referer as a **fact** in a log·audit record. it is the requester's statement. to record it as a statement, name the field accordingly |
| **security auditor** | when putting "Referer verification" on the control list, **have who the enforcer is written together.** if the enforcer is the client, it is not a control but a convention |
| 〃 | require the threat model as a document. since the same mechanism splits valid·invalid by model, a control evaluation with no model does not hold (§9.6.2) |
| **network·proxy administrator** | an intermediate device that erases or overwrites Referer creates a **false positive** on the user side. if policy requires erasing it, reflect that fact in the user-support procedure |
| **client-tool author** | put Referer as the **first candidate** in failure diagnosis ([`cli.py:95`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L95)). let a 404 be believed at face value and the user looks for a non-existent problem |
| 〃 | if you must send a different value per stage, implement it as a **request-local header** ([`fetch.py:146-150`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L146-L150)). write it on the instance and contamination spreads quietly (§9.5.3) |

### 9.7.5 What this chapter hands to the next

Up to here we assumed "the requester knows the correct value." But a setup where **the server tells the answer
directly** really exists.

```python
# fetch.py:90-92
    # a hotlink-blocking CDN returns the player page's origin in this header.
    # it comes attached to both success and 403 responses, so it is the basis for Referer inference.
    allow_origin: str = ""
```

Carry `Access-Control-Allow-Origin` in a block response and that header is itself the answer to "which Referer
must be sent to pass." `_adopt_origin` at [`cli.py:105-124`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L105-L124) uses exactly that leak. The subject of Chapter 10.

---

## 9.8 Limits and open questions

Noted honestly.

- **What the target server checks could not be confirmed.** Whether it is the full address, the origin, or a
  host substring is unknown. That `_from` carries a different value per stage is **a result of mimicking browser
  behavior**, not of reverse-engineering the server rule. The "only stages 2·3 are the full address" in the
  table (§9.3.2) is an observation of the same nature.
- **"404 if even one is empty" is a measurement record in a code comment, not reproduced in this chapter.** The
  404 in §9.5 is a **local server's** response mimicking that condition. Which stage emptied gives a 404 on a
  real server, and whether it differs per stage, is not fixed by regression tests. What the regression test
  fixes is only **whether Referer appears in the diagnostic message** (`tests/run.sh:205`).
- **`--referer` overrides all stages of the chain with one value.** Because of `if k not in self.headers`, if
  there is a user specification the per-stage values of `_from` do not go out at all. On a server demanding a
  different value per stage, giving `--referer` fails rather, and **the tool does not tell you that.** It is
  intended policy (README:199-200) but the price is undocumented.
- **`_origin()` does not encode.** It uses `"{u.scheme}://{u.netloc}"` as is, so if the host is non-ASCII (IDN)
  it dies at the same spot as §9.3.4. `normalize_url` does not touch netloc either. Not measured, and did not
  appear within the scope this repository handles.
- **It does not consider Referrer-Policy.** If the target site set `no-referrer`, the browser does not send it
  at all while this code does — **a state of sending more than the browser.** If the server demands an exact
  match, this side fails. Conversely, since most servers do a prefix·host comparison, sending more being safer
  is this code's (unverified) assumption.
- **`_from` is not involved in segment requests.** From stage 4 on, everything goes out with the one value put
  into `Fetcher.headers` ([`cli.py:907-908`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L907-L908)). A delivery demanding a different Referer per segment cannot be
  handled by this structure. Such a delivery was never encountered.
- **The version history of browser policy was not confirmed.** The basis was taken only as far as
  `strict-origin-when-cross-origin` being the current default of major browsers, and since when·whether all
  browsers are the same was not verified in this chapter.

---

## 9.9 Summary

1. **Referer is written by the requester and only read by the server.** It is a self-reported value like
   `Content-Type`·URI extension (Chapter 14), only opposite in direction (server report ↔ client report).
2. **The strength of a self-reported-value control rests not on the value but on the enforcer.** A requester
   inside the browser cannot change this header (a forbidden header name), and a requester outside the browser
   writes it in one line. Measured: `404` with no header, `200` with the one line `-e 'https://site.example/'`.
   Even with a non-existent path, `200`.
3. **The same mechanism is a valid defense or an empty shell by threat model.** `Origin` checking as CSRF
   defense is valid (the threat is inside the browser), and `Referer` checking as content access control is
   invalid (the threat is outside the browser). Not the mechanism but **from whom you protect what** divides the
   judgment.
4. **That it is nonetheless widely used is reasonable.** The introduction cost is effectively 0 and it changes
   no client, and the originally-targeted threat's (bandwidth theft) requesters are all browsers. The mistake
   arises not in the mechanism but in the **accounting** — making this the only control or booking it as content
   protection.
5. **Give the block as a 404 and it hides nothing while only collapsing the diagnosis.** For the side with the
   address, existence is already revealed, and the cost returns to your own users and support org. So this tool
   puts Referer as the first candidate in the diagnostic message and fixes it with a test.
6. **When the value differs per stage, the header must be request-local.** Write it on the instance and
   contamination spreads not to the next request but to **the whole next episode**, and the symptom is that all
   27 episodes look like "missing pages." Measured: even giving the correct value via `extra` cannot beat a
   contaminated instance.
7. **Referer is an address, so it must be encoded by the same rule as an address.** Carry a Korean-containing
   address raw and the request dies inside the client before reaching the server (`UnicodeEncodeError: 'latin-1'
   codec …`). It is the reason the normalization rule must be one in the repository, the spot where Chapter 7's
   principle repeats in a header.

---

**Next chapter** — this chapter's control rested on "does the requester know the correct value." But some
servers **carry that answer in the block response.** `Access-Control-Allow-Origin` is by spec "the origin a
browser's JS may read the response from," not "the Referer the server demands," yet a setup where the two
coincide is common. Chapter 10 covers how misreading the CORS header becomes an information leak, and why the
`_adopt_origin` that uses that leak must remain only an **inference.**
