---
title: "What the CORS Header Leaks"
description: "Misreading ACAO and information leakage"
date: 2026-06-10
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-10-cors-leak.svg
---
## 10.0 What this chapter answers

1. What does `Access-Control-Allow-Origin` control by spec — and what does it not control?
2. Why does that header come attached **even to a blocked 403 response?**
3. How does a setup where the block response tells you the bypass method arise?
4. Why can `*` not be a basis?
5. **How does a defender fix this? Once fixed, what actually improves, and what does not?**

The fifth question is this chapter's peak. To write the conclusion in advance — **blocking the leak is not
restoring the control.** There is a separate reason to block it anyway, and building that distinction is this
chapter's goal.

---

## 10.1 The problem — the tool finds out what it should not be able to know

Run this repository's tool with only one URL and a line like this appears.

```
  source: https://cdn.example/hls/9f3a…/master.m3u8
  Referer auto : https://site.example/ (the allowed origin the server told us)
```

The odd point must be noted. The input the tool received is **only the CDN's playlist address.** The string
`site.example` is nowhere in the input. The user did not tell it, nor did the tool crawl that site. And yet in
just one first request it found that value, and attaching it as `Referer` opened the blocked stream.

The information has only one source — **the header of that rejected response.**

```
GET /hls/9f3a…/master.m3u8
  User-Agent: Mozilla/5.0 …
  (no Referer, no Origin)

→ 403 Forbidden
   Content-Type: text/html
   Access-Control-Allow-Origin: https://site.example
```

Here three questions split.

| Question | Section |
|---|---|
| what is ACAO originally for | §10.2 |
| why does it come attached even to a rejection response | §10.3 |
| why does that value happen to match "the required Referer" | §10.4 |

Gather the three answers and the last sentence comes out. **This is not one server's mistake but a structure
that necessarily arises when two mechanisms are run from the same config value.**

---

## 10.2 The principle — what does ACAO control?

### 10.2.1 Terms first

> **Term** — **origin**: the combination of the three values scheme·host·port. Its serialized form is
> `https://site.example` or `http://a.b:8080`, with **no path and no trailing slash.** `https://site.example/`
> is a URL, not an origin.

> **Term** — **same-origin policy (SOP)**: a **rule inside the browser** that keeps a document·script from one
> origin from reading the response content of another origin. It is not a rule that blocks sending the request
> itself, but a rule that decides whether to hand the returned response to the script.

> **Term** — **CORS (Cross-Origin Resource Sharing)**: a spec (Fetch Standard) by which the server, via
> response headers, **relaxes** SOP to allow a specific origin's script to read the response. It is not a spec
> that restricts access but a spec that lifts the restriction.

> **Term** — **ACAO (`Access-Control-Allow-Origin`)**: CORS's core response header. It specifies one origin
> allowed to read this response, or allows all with `*`.

> **Term** — **hotlink protection**: a server-side rule that does not give out a resource if the request's
> `Referer` (RFC 9110's request header — the address of the page that induced this request) or `Origin` is not
> in the allow list. Since the value is written and sent by the client itself, it cannot block forgery
> (Chapter 9).

### 10.2.2 The location of the control point

The most common misreading is the sentence "I blocked it with ACAO." Examine what was blocked and that sentence
mostly does not hold.

![A comparison of where ACAO acts](/images/lecture/hls-recon/10-acao-scope.svg)

*Figure 10-1 — a comparison of where ACAO acts*

For a simple request (a GET·HEAD·some POST that does not induce a preflight), the order is this.

1. the script makes the request
2. **the request goes to the server** — ACAO does not even exist yet
3. the server judges and makes a response
4. the response arrives at the browser
5. **the browser** compares ACAO
6. if it passes, hand the response to the script; if not, treat it as a network error

> **Term** — **preflight request**: an `OPTIONS` request the browser sends first, ahead of a request outside
> the spec's "simple request" range (e.g., `PUT`, accompanied by custom headers). Then the actual request may
> be withheld entirely. An HLS player's requests receiving the manifest·segments are ordinary `GET`s, so this
> case does not apply.

Two conclusions come from here.

| Conclusion | Basis |
|---|---|
| ACAO **does not reduce the server's load** | the request was already processed. step 5 is after the response is made |
| ACAO **has no effect on a non-browser client** | the party performing step 5 is the browser. `curl`·`python`·`ffmpeg` have no such step |

**"What breaks if you do not do this"** — a design mistaking ACAO for access control puts the control only on
browser users. Instead of asking the user for a bypass that takes one line of script, the server remains with no
actual authorization anywhere. **The typical case where believing there is a control is worse than having none.**

### 10.2.3 Summary — misreadings and the spec

| Common misreading | What the spec actually says |
|---|---|
| "ACAO is the Referer the server demands" | ACAO is **the origin allowed to read the response.** it is not a requirement on the request |
| "CORS blocks access from other sites" | CORS **relaxes** SOP. the blocking party is SOP, and that only inside the browser |
| "without ACAO the request does not go" | a simple request goes as is. the browser only **does not hand the response to the script** |
| "ACAO is a server security setting" | it is a value by which the server **declares its own resource's disclosure scope.** a declaration is not a control |

This repository's comment wrote this distinction down exactly ([`cli.py:112-114`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L112-L114)).

```python
`*` means any origin is allowed, so it cannot be a basis and is ignored.
ACAO is "the origin a browser's JS may read," not "the Referer the server demands"
— it is an inference all the way, and so a user specification always wins.
```

**That it is written "an inference" matters.** This tool does not use ACAO as a spec-based basis. By spec the
two are different things, and it only uses the empirical rule that **they often coincide in real configs.** Why
that empirical rule holds is the next two sections.

---

## 10.3 Why it comes attached even to a 403

Three layers of reason overlap. You must know all three to see this is not a mistake.

### Reason 1 — by spec, attaching it is correct

The CORS check is performed **regardless of the response's status code.** The browser compares ACAO by the same
procedure whether it is `403` or `200`, and if it does not pass, it makes it a network error **without even
telling the script the status code.**

Therefore, for the player to show a "access was denied" screen, the server **must attach** ACAO to that 403
response. Do not attach it and the script cannot even know it was a 403, seeing only an unidentifiable failure.

> Attaching ACAO to an error response is not a spec violation but **a normal config to make an error look like
> an error.** The problem this chapter deals with arises not from "it attached" but from "what it attached."

### Reason 2 — implementation does not gate on the status code

ACAO is usually injected not by application code but as a **response-header rule** of a reverse proxy·CDN. Such
rules are often applied only to success responses by default, so the operator turns on an option to attach the
header on errors too (a widely used example is nginx's `add_header … always`). Then **the same header is
attached to a 403 made by an authorization failure.**

What matters here is that the motive for turning on this option is **Reason 1.** A setting turned on to let the
player read the error becomes the leak path itself.

### Reason 3 — that value is a static constant

This is decisive. And it **can be proven with this repository's code.**

> **Term** — **origin reflection**: a config that writes the request's `Origin` header value back into ACAO as
> is. It becomes `ACAO: <the Origin the request sent>`.

If the server were an origin-reflecting config, **a request that did not send an `Origin` header has no value to
return.** And this tool's first request does not send `Origin`.

```python
# fetch.py:115
self.headers = {"User-Agent": DEFAULT_UA, **(headers or {})}
```

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

The default header is only `User-Agent`, and `Origin` arises only when the user put it in with `--referer` or
`--header`. **In a run given only a URL with no options, there is no `Origin`.**

And yet a concrete origin comes back in the response. The conclusion is one.

> **That value is not reflected but a constant embedded in the server config.**

That is, the server is saying "regardless of who asks, our player is at `https://site.example`." That is the
identity of the value the tool found in §10.1.

---

## 10.4 The structure of the leak — one config, two paths

Now we can answer §10.1's third question. Why does the ACAO value happen to match "the required Referer"?

**Because the value the operator set is one.**

![One config value births the check and the declaration at once](/images/lecture/hls-recon/10-one-config-two-paths.svg)

*Figure 10-2 — one config value births the check and the declaration at once*

On the CDN settings screen the field the operator fills is usually one — "our site address." That value flows to
two places.

| Path | Nature | Direction | Assumption about disclosure |
|---|---|---|---|
| hotlink-block list | a **predicate** for accepting a request | input check | **implicitly assumes it works if secret** |
| ACAO header value | a **declaration** that reading is allowed | output | **disclosure is the purpose from the start** |

The two paths' assumptions are opposite yet the value is the same. So the following proposition holds.

> **Proposition 1 — tie a declaration whose purpose is disclosure and a predicate that presumes secrecy to the
> same config value, and no secret remains.**

And its consequence is this chapter's title.

> **Proposition 2 — when a rejection response describes the acceptance condition, that rejection is not a
> control but guidance.**

What a `403 Forbidden` carries is two things. **The fact that it rejected** and **the value that passes that
rejection.** The round trips needed for the bypass are 1.

---

## 10.5 The code — how does this repository use it

### 10.5.1 Add one header to the measurement targets

```python
# fetch.py:90-92
# a hotlink-blocking CDN returns the player page's origin in this header.
# it comes attached to both success and 403 responses, so it is the basis for Referer inference.
allow_origin: str = ""
```

`FetchResult` is a data type holding one request's measurements ([`fetch.py:73-104`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L104)), and this field is
alongside status·size·TTFB. Excluding `Content-Type`·`Content-Encoding` needed to interpret the body, the very
fact that **only this one of the response headers is promoted separately** reveals the design intent — the rest
of the headers are discarded and only this remains.

### 10.5.2 Read it on **both** the success path and the failure path

Here is the spot most easily gotten wrong in this feature.

```python
# fetch.py:181-195 — success path
return FetchResult(
    url=url,
    ok=True,
    status=resp.status,
    …
    sha256=hashlib.sha256(body).hexdigest(),
    allow_origin=resp.headers.get("Access-Control-Allow-Origin", "") or "",
)
```

```python
# fetch.py:196-201 — failure path
except urllib.error.HTTPError as e:
    last_status, last_err = e.code, f"HTTP {e.code} {e.reason}"
    last_origin = (e.headers or {}).get("Access-Control-Allow-Origin", "") or ""
    # 4xx gives the same result on retry (401/403/404 = token expiry·hotlink block)
    if 400 <= e.code < 500 and e.code not in (408, 429):
        break
```

```python
# fetch.py:208-215 — carry it even on a result confirmed as a failure
return FetchResult(
    url=url,
    ok=False,
    status=last_status,
    attempts=self.retries,
    error=last_err,
    allow_origin=last_origin,
)
```

**"What breaks if you do not do this"** — had it been read only on the success path (line 194), this feature
**would not work at exactly the moment it is needed.** Because if the playlist opened with a 200, there is no
reason to infer the Referer. The only case this value is useful is when the request was blocked, and a blocked
response comes in `urllib` not as a return value but as an **exception.** Without line 198, the whole feature
becomes "help that only helps when it succeeded."

Splitting why both paths are needed, it is this.

| Path | What it is for |
|---|---|
| line 194 (success) | prepares for the **next** request being blocked. there is a delivery where the master opens but the segment is blocked |
| line 198 (failure) | resolves the block on the **current** request — the case this chapter deals with |

One detail. `(e.headers or {})` — blocks the path where `HTTPError`'s `headers` can be `None`. And `or ""` makes
a header absence and an empty value the same, so later code does not meet a `None`. Without this normalization,
§10.5.3's `res.allow_origin.strip()` dies with `AttributeError` — **the tool dies first while trying to use the
leak.**

### 10.5.3 Adoption — `_adopt_origin`

```python
# cli.py:105-124
def _adopt_origin(res: FetchResult, fetcher: Fetcher) -> bool:
    """Adopt the allowed origin the response told us as Referer/Origin.

    A hotlink-blocking CDN returns the player page's origin as Access-Control-Allow-Origin
    — it comes attached even to a blocked 403 response. Only when the user did not give
    --referer, take this value the server told us itself as the basis.

    `*` means any origin is allowed, so it cannot be a basis and is ignored.
    ACAO is "the origin a browser's JS may read," not "the Referer the server demands"
    — it is an inference all the way, and so a user specification always wins.
    """
    if "Referer" in fetcher.headers:
        return False
    u = urlparse(res.allow_origin.strip())
    if u.scheme not in ("http", "https") or not u.netloc:
        return False
    fetcher.headers["Referer"] = f"{u.scheme}://{u.netloc}/"
    fetcher.headers.setdefault("Origin", f"{u.scheme}://{u.netloc}")
    _eprint(f"  Referer auto : {u.scheme}://{u.netloc}/ (the allowed origin the server told us)")
    return True
```

Five things each protect a different thing.

**① `if "Referer" in fetcher.headers: return False`** — a user specification wins. Without this, the value the
server told silently overwrites the value the user specified. The user believes they gave `--referer` while a
different value actually goes out, and **there is no warning on stderr.** A bug of a form that makes debugging
impossible.

**② `*` is not filtered by a separate branch.** `urlparse("*")` yields an empty string for both scheme and
netloc, so it drops together at the origin-syntax check. The per-value verdict is as follows.

| ACAO value | `u.scheme` | `u.netloc` | Adopt | Reason |
|---|---|---|---|---|
| `https://site.example` | `https` | `site.example` | **○** | a normal origin |
| `https://site.example/` | `https` | `site.example` | ○ | the trailing slash is ignored |
| `http://a.b:8080` | `http` | `a.b:8080` | ○ | an origin including a port |
| `*` | `""` | `""` | ✗ | points at no origin |
| `null` | `""` | `""` | ✗ | an opaque origin — not an address |
| `site.example` | `""` | `""` | ✗ | not the origin serialization form |
| (no header) | `""` | `""` | ✗ | no basis |

The reason for excluding `*` is two-layered. **Semantically** it means "anyone may read" and points at no
particular origin — it is not the answer to "which Referer must be sent" in the first place. **Syntactically** it
is not a URL and cannot be assembled into a URL.

**"What breaks if you do not do this"** — do not filter `*` and `f"{u.scheme}://{u.netloc}/"` makes the string
`":///"`. That value goes out as `Referer`, the function returns `True`, §10.5.4's retry fires, and the screen
prints `Referer auto : :/// (the allowed origin the server told us)`. The result is the same 403. **Worse than
sending a wrong value is leaving a diagnostic output that looks like a success.**

**③ `Referer` has a trailing slash and `Origin` does not.** No coincidence. Per §10.2.1's definition an origin
serialization has no path, and `Referer` is a URL so at minimum a `/` comes. Send `https://site.example/` to a
server that compares `Origin` as a raw string and it is a **match failure.** Not knowing that the two headers'
notations differ, you get caught here once.

**④ Only `Origin` is `setdefault`.** Since the key ①'s check looks at is only `Referer`, adoption proceeds even
when the user gave only `--header 'Origin: …'`. Then the user's `Origin` is kept and only `Referer` is newly
attached.

**⑤ It prints the adoption fact to stderr.** It does not use a value obtained by inference quietly. The user sees
that line and learns "ah, this stream has Referer verification," and if the value is wrong can overwrite it with
`--referer`. **Not hiding the inference is the condition for using the inference.**

### 10.5.4 The retry after changing the state

```python
# cli.py:127-135
def _load(src: str, fetcher: Fetcher) -> tuple[playlist.Playlist, str]:
    """Parse a source (URL or local .m3u8). The second return value is the base URL."""
    if _is_url(src):
        res = fetcher.get(src)
        # if a Referer was obtained from the first response, the request it blocked is worth retrying.
        if _adopt_origin(res, fetcher) and not res.ok:
            res = fetcher.get(src)
        if not res.ok:
            raise SystemExit(f"playlist request failed: {src}\n  {res.error}")
```

[`fetch.py:200-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200-L201) cuts the retry loop immediately on a 4xx. And yet [`cli.py:133`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L133) requests that very 4xx once
more. Not a contradiction — **the two retries are different.**

![Two kinds of retry](/images/lecture/hls-recon/10-two-retries.svg)

*Figure 10-3 — two kinds of retry*

| | transport-layer retry ([`fetch.py:205-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L205-L206)) | retry after state change ([`cli.py:132-133`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L132-L133)) |
|---|---|---|
| request content | **exactly the same** | **changed** (two headers attached) |
| on a 4xx | meaningless — halt immediately | meaningful — the basis for the verdict changed |
| trigger condition | 5xx·timeout·408·429 | `_adopt_origin` returns `True` and `not res.ok` |
| count | as many as `retries`, exponential backoff | **exactly once** |

There is a reason for checking both conditions.

- Retry when `_adopt_origin(...)` is `False` and it becomes **a repeat of the identical request**, doing again
  what [`fetch.py:200`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200) already judged meaningless.
- Remove `not res.ok` and it **sends even a successful request once more.** Since ACAO comes attached even to a
  200 response (§10.5.2), without the condition the playlist request doubles on every run of a normal stream.
  From the server's standpoint it is anomalous traffic, and the measurement report's TTFB sample is contaminated
  too.

Here comes one general principle.

> **The condition under which a retry has meaning is not the count but "did the request change."** Since HTTP is
> stateless (Chapter 4), the verdict on the same request is the same unless the server state changes. Cram the
> retry logic into one layer and this distinction disappears.

### 10.5.5 How far does the adopted value go

`_adopt_origin` directly modifies `fetcher.headers`. That dictionary is this tool's **single source of truth**
for request headers.

```python
# cli.py:525-529
fetcher = Fetcher(headers=dict(given), timeout=args.timeout, retries=args.retries)
# from here the single source of truth for request headers is fetcher.headers. the default User-Agent
# and the auto-adopted Referer are reflected only in it, so hand the same dict to ffmpeg/ffprobe too.
# hand a separate copy and segment receipt and reassembly request with different headers.
headers = fetcher.headers
```

So a once-adopted value is reflected in four paths at once — segment receipt, `remux`-mode ffmpeg, ffprobe
measurement, subtitle-track extraction (`README.md:228-233`, [`probe.py:61`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L61)).

**"What breaks if you do not do this"** — hand a copy and it becomes a state where segments are received but only
the ffprobe measurement fails with 403, a state extremely hard to pin the cause of. The same stream becomes half
openable by the same tool.

There is one more side effect. Subtitle-sidecar discovery **reuses** this value.

```python
# cli.py:292-301
def _sidecar_origin(args: argparse.Namespace, fetcher: Fetcher) -> str:
    """Decide the host to look for sidecar subtitles.

    A user specification takes priority, and if none, use the origin already secured from the
    video request — if `_adopt_origin` put the allowed origin the server told into Referer, the
    subtitles are at the same place. so it does not request separately to find out the host.
    """
    if args.sub_origin:
        return args.sub_origin
    return fetcher.headers.get("Referer", "")
```

```python
# subtitles.py:384-386
#   host    the video response's Access-Control-Allow-Origin tells us the player origin.
#           subtitles are placed at the same origin so use it as is (cli._adopt_origin already
#           adopted this value as Referer, so reuse it without requesting anew).
```

It means a value that once flowed out **is used not only for authorization bypass but becomes the starting point
for exploring the site structure.** The use of leaked information is not decided by the side that leaked it. If
there is no value the tool does not guess and backs off ([`cli.py:319-322`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L319-L322)) — because a URL made by guessing
becomes a wasted request.

---

## 10.6 Generalization — when a rejection speaks the acceptance condition

This chapter's structure is not limited to CORS. Abstract the form and it is this.

> **When a control rejects, if that rejection response holds "what it would have taken to pass," that control is
> neutralized in one attempt.**

A response with this property is called an **oracle.**

> **Term** — **oracle**: an interface an attacker can query arbitrarily, and whose response leaks information
> about a secret bit by bit (or wholesale). How much information the response leaks determines the number of
> queries needed.

| Case | What the rejection response leaks | Number of queries needed |
|---|---|---|
| **403 + ACAO** (this chapter) | the **whole value** of the required Referer/Origin | **1** |
| login-error message separation<br>("no such ID" ≠ "wrong password") | the account's existence (user enumeration) | 1 per account |
| padding oracle (Chapter 24) | 1 bit of the decrypted text's padding validity | on average 128 per byte |
| timing difference of a secret comparison | the length of the matched prefix | tens per byte |
| a WAF's "blocked pattern: …" | the filter rule itself | 1 per rule |
| object storage<br>(`AccessDenied` ≠ `NoSuchBucket`) | the bucket's existence | 1 per name |
| a detailed stack trace | framework·version·path structure | 1 |

See that the top row is the **worst.** The other oracles leak the secret one piece at a time so the attack needs
repetition, and so responses like rate limiting·log monitoring have meaning. **The ACAO leak gives the whole
value at once.** With no repetition it does not even trip anomaly detection. A single request is indistinguishable
from normal traffic.

The second generalization is §10.4's Proposition 1.

| Domain | The disclosure-purpose declaration | The secrecy-presumed predicate | Tie the two |
|---|---|---|---|
| CORS + hotlink block | ACAO | the allowed-Referer list | **this chapter** |
| DNS + internal-network access control | a public DNS record | "internal hostnames will not be known" | subdomain enumeration exposes internal structure |
| Certificate Transparency log | the list of issued certificates | "this staging domain is private" | a CT-log lookup exposes it all |
| a version notation on an error page | diagnostic convenience | "which version will not be known" | known-CVE matching becomes immediately possible |
| `robots.txt` | crawler guidance | "this path is hidden" | it becomes the list of paths you meant to hide |

The right column of each row is the same form. **A control that presumed secrecy was run from the same value as
a channel that presumed disclosure.**

---

## 10.7 Security — the defender's view

Explain only the bypass path and stop and this chapter is half done. Write the fixing side.

### 10.7.1 First — what is the actual fault

Placing the fault list in order of severity, it is this.

| # | Fault | Nature |
|---|---|---|
| **A** | using `Referer`/`Origin` as an **authorization means** | the root fault. being a client self-reported value it cannot block forgery (Chapter 9) |
| **B** | declaring that predicate's value as a **static constant on every response** | the leak. makes the cost of piercing A 0 |
| **C** | the declaration is attached even to a rejection response | B's manifestation condition |

**Fix only B and C and leave A and nothing is fixed.** Not inverting this order is this section's most important
claim. The reason to fix B·C anyway is recorded separately in §10.7.3.

### 10.7.2 How to fix B·C — a static constant to a conditional reflection

The principle is one. **Return ACAO only when the request sent an `Origin`, only after comparing that value
against the allow list, and only that value that passed the comparison.** If not in the list, do not attach the
header at all.

| The `Origin` the request sent | Current config (static constant) | Fixed config (conditional reflection) |
|---|---|---|
| none — `curl`·`hls-recon`·server-to-server call | `ACAO: https://site.example` ← **leak** | (no header) |
| `https://site.example` — normal player | `ACAO: https://site.example` | `ACAO: https://site.example`<br>`Vary: Origin` |
| `https://evil.example` — a scraping site | `ACAO: https://site.example` ← **leak** | (no header) |
| `null` — a sandbox iframe·`file://` | `ACAO: https://site.example` ← **leak** | (no header) |

Written in one sentence, the right column's property is this.

> **In the fixed config the only request that receives ACAO is one that already sent the correct answer.** That
> is, the header conveys no new information.

There is a reason `Vary: Origin` must be there too.

> **Term** — **`Vary` response header**: a header that tells a cache by which **request header** this response
> differs. The cache must include that header in the cache key.

**"What breaks if you do not do this"** — use a reflection config without `Vary: Origin` and an intermediate
cache serves the `ACAO: https://site.example` response computed for `site.example` to a request from a different
origin as is. The reverse direction holds too. This is the classic form of **CORS cache poisoning**, and the
field most often missed when introducing a reflection config. The static-constant config did not have this
problem, so record that **fixing B can bring in a new fault.**

### 10.7.3 What improves once fixed — honestly

Write what does **not** improve first.

**The player page's address is public in the first place.** Think about it and it is obvious. Where did you get
that m3u8 address — from that page. Someone who opened devtools is already looking at the address bar. Therefore,
even blocking the ACAO leak, the cost for an attacker to forge the correct `Referer` rises only **from 0 to 1.**
One manual step is added.

| Viewpoint | Once the ACAO leak is blocked |
|---|---|
| an individual attacker | **barely improves.** just open the page and see the address |
| an automation tool | **improves.** the **generalized** path of finding the player origin from an arbitrary CDN address alone disappears |
| mass scanning | **improves.** obtaining the value requires per-site manual work, breaking the economy of scale |
| audit | **improves.** that a 4xx response does not describe the authorization predicate is a checkable invariant |

That is, this fix's precise achievement is **not "blocked the bypass" but "blocked the automation·generalization
of the bypass,"** and that too is temporary unless A is fixed. That what this repository does is exactly that
automation is a proof — **`_adopt_origin` is 20 lines.**

> In Chapter 15's phrasing, fixing only B and recording "strengthened hotlink blocking" is security theater. You
> must record separately what was measured (a rise in automation cost) and what was not (the actual bypass
> possibility).

### 10.7.4 How to fix A

What replaces `Referer`-based control is **not a self-reported value carried in the request but a value the
server can verify.**

| Method | Principle | The chapter that covers it |
|---|---|---|
| signed URL | HMAC-sign the resource path·expiry time with a server secret. to forge you need the key | Chapter 11 |
| session token + resource authorization | confirm the requester's identity and judge whether that identity has permission to see this resource | Chapter 12 |
| short expiry | even leaked, the valid time is short. in exchange the client implementation gets harder (late resolution) | Chapter 11 |

`Referer` checking has meaning kept **alongside** these — for uses like bandwidth saving or blocking casual
embeds. But the moment you make it the **only** gate, the control's strength equals "the cost of finding out the
value," and as this chapter showed that cost is often 0.

### 10.7.5 Audit procedure — confirm with two requests

Whether this fault is present is determined by two requests. Since only the response headers are seen, the body
is not received.

```bash
# ① without sending Origin
curl -sS -o /dev/null -D - 'https://cdn.example/hls/…/master.m3u8'

# ② sending any value as Origin
curl -sS -o /dev/null -D - -H 'Origin: https://audit.invalid' \
     'https://cdn.example/hls/…/master.m3u8'
```

The verdict table is as follows.

| ①'s ACAO | ②'s ACAO | Config | Verdict |
|---|---|---|---|
| none | none | CORS unused or conditional reflection | **good** |
| none | `https://audit.invalid` | **unconditional reflection** | dangerous — anyone allowed to read. serious if credentialed |
| `https://site.example` | `https://site.example` | **static constant** | this chapter's leak |
| `*` | `*` | fully public | not a leak but not a control either |

A config where the value sent in ② comes back as is (unconditional reflection) is worse than this chapter's leak.
With `Access-Control-Allow-Credentials: true` alongside, an arbitrary site can read the result of a request
carrying the user's cookies.

Here one path where this leak **arises structurally** must be noted. The CORS spec forbids `ACAO: *` for a
credentialed request — it must **specify a concrete origin.**

> **Term** — **credentialed request**: a cross-origin request carrying cookies·HTTP auth·client certificate
> (`fetch(..., {credentials: 'include'})`). Then the response must specify the exact origin in `ACAO` and send
> `Access-Control-Allow-Credentials: true` along with it.

That is, **the more a site controls access with a session cookie, the more the spec requires writing the exact
origin.** And it is simpler as a config to embed that value as a constant than to compute it conditionally. This
is why this leak is not "a careless operator's mistake" but **a fault repeatedly produced at the point where a
spec requirement meets configuration convenience.**

### 10.7.6 What to do, by role

| Role | What to do |
|---|---|
| **CDN·infrastructure operator** | do not attach ACAO unconditionally as a static constant. only when there is an `Origin`, compare against the allow list and return that value, and attach `Vary: Origin`. there is no reason to attach ACAO to a request with no `Origin` — there is no party to read it |
| **service designer** | do not make `Referer`/`Origin` the **only** authorization means. do authorization with signed URLs or session tokens, and leave Referer checking only as an auxiliary means |
| **security auditor** | put **all the headers of 4xx responses** in the audit scope. do not stop at "it was blocked" but read **what the block response says.** fix §10.7.5's 2-request procedure as a regression check |
| **frontend developer** | do not make `*` the default. for a credentialed request `*` cannot be used by spec so you end up embedding a concrete origin as a constant — review **how far that constant is exposed** together |
| **tool implementer** | handle an inferred value and a user-confirmed value distinctly. disclose the inference on screen ([`cli.py:123`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L123)), and a user specification always wins ([`cli.py:116`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L116)) |
| **audited organization** | do not put "we configured CORS" in the access-control section. CORS is not a control item but a **disclosure-scope declaration** item |

---

## 10.8 Limits and open questions

Noted honestly.

- **The adoption point is only one place.** `_adopt_origin` is called only from `_load` ([`cli.py:132`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L132)). In the
  case where the master playlist opens with a 200 and then the **variant request is 403** ([`cli.py:185-187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L185-L187))
  or the segment parallel receipt is blocked, adoption does not happen. The latter ends only with the guidance
  at [`cli.py:471`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L471), "possibly token expiry or Referer-verification failure." The range of auto-recovery is
  limited to **the case where the first request was blocked.**
- **There is no regression test fixing this behavior.** `tests/run.sh` has no item handling
  `Access-Control-Allow-Origin`. Because the local test server (`tests/gzip_server.py`) does not attach this
  header. That is, §10.5.3's per-value verdict table is **derived by reading the function and confirming
  `urlparse` behavior**, not guaranteed by this repository's tests. The adoption-failure paths (`*`·`null`·no
  header) are worth adding as fault-injection targets.
- **The match of ACAO and the required Referer is an empirical rule.** This chapter explained in §10.4 the
  structure by which that match arises, but **on what fraction of CDNs it actually matches was not measured.**
  The code comment too only writes "an inference all the way" ([`cli.py:113-114`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L113-L114)). The behavior on a mismatch
  (one more failure with a wrong Referer) is defined, but its frequency is unknown.
- **§10.3's Reason 2 is knowledge outside this repository.** The behavior of a reverse proxy's option to attach a
  header on error responses is a statement of what is generally known, not a confirmation of a specific CDN's
  actual config. What was observed is only as far as "ACAO came attached to a 403," and whether its cause is a
  proxy setting or application code is not distinguishable from outside.
- **Whether a credentialed request was involved could not be confirmed.** §10.7.5 points at the structural
  tendency "the more such a site, the more it writes a concrete origin," but whether the CDN in question actually
  sent `Access-Control-Allow-Credentials: true` has no record in this repository. The response headers
  `FetchResult` leaves are only ACAO and `Content-Type`·`Content-Encoding`, discarding the rest
  ([`fetch.py:73-92`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L92)).
- **The adopted `Referer` is not redacted in the report.** The redaction targets are only
  `SENSITIVE_HEADERS = frozenset({"cookie", "authorization", "proxy-authorization", "x-api-key"})`
  ([`report.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L33)). `Referer` is not a credential so this judgment is sound, but **as a result the report JSON
  retains "from which site it was received."** It is not a credential leak but a provenance record — if that
  distinction is needed in your environment, it is a separate review target (Chapter 12).
- **The key `_adopt_origin` looks at is only `Referer`.** In a state where the user gave only `--header 'Origin:
  …'` and no `Referer`, auto-adoption proceeds. It looks like intended behavior but is not stated in the comment.

---

## 10.9 Summary

1. **ACAO is "the origin a browser's JS may read the response from," not "the Referer the server demands."** CORS
   is a spec that **relaxes** the same-origin policy, not one that restricts access. It has no effect on a
   non-browser client.
2. **The request already reached the server.** The only point ACAO is involved is after the response is made, the
   moment the browser decides whether to hand it to the script.
3. **That header is attached to a 403 too.** Because it must be for the player to show "denied," and this is no
   spec violation. The problem arises not from "it attached" but from **"what it attached."**
4. That a concrete origin comes back even though the tool did not send `Origin` proves that **the value is not a
   reflection but a static constant of the server config** ([`fetch.py:115`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L115), [`cli.py:488-501`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L488-L501)).
5. **The leak arises as one config value splits into two paths** — an input check presuming secrecy (hotlink
   block) and an output declaration presuming disclosure (ACAO). So **a rejection response comes to describe the
   acceptance condition, and that rejection becomes not a control but guidance.**
6. `*` cannot be a basis. **Semantically** it points at no origin, and **syntactically** it cannot be assembled
   into a URL. The code filters it together at the origin-syntax check with no separate branch
   ([`cli.py:118-120`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L118-L120)).
7. **You must read the header on both the success and the failure path.** Read only on success and this feature
   does not work at the moment it is needed — the only case the value is useful is when the request was blocked,
   and a blocked response comes as an exception ([`fetch.py:194`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L194) ↔ [`fetch.py:198`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L198)).
8. **The condition under which a retry has meaning is not the count but "did the request change."** Repeating the
   same request on a 4xx is meaningless ([`fetch.py:200-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200-L201)), and one time after changing a header has meaning
   ([`cli.py:132-133`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L132-L133)).
9. The order of defense is **A (using Referer as authorization) → B (static-constant declaration) → C (error-
   response injection).** Fix only B·C and **the automation·generalization of the bypass is blocked but the
   bypass itself is not.** Because the player address is public in the first place. Record "strengthened" without
   writing that fact and it becomes security theater.

---

**Next chapter** — the way to fix A remains. To control access with a value the server can verify instead of a
value the client self-reports needs a signature and an expiry, and the moment the expiry time is embedded in the
URL, **a work-order constraint arises in the client implementation.** Chapter 11 covers why gathering 27
episodes' addresses in advance necessarily breaks the later ones, and the late resolution that forces.
