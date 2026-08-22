---
title: "URL Normalization and Idempotency"
description: "%20 and %2520"
date: 2026-06-03
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-07-url-normalization.svg
---
## 7.0 What this chapter answers

1. When Korean or a space is embedded in an address, exactly where and what breaks?
2. Why can't that repair be done separately at each receiving side?
3. What does it mean for `_PATH_SAFE` to leave `%` as a safe character?
4. What is guaranteed by gathering the point that births a URI into one?
5. **Why does the same property become a bypass on the attacker's side — and when must verification be done?**

The fifth is this chapter's peak. The first four are "why this code looks the way it does," and the fifth is
**how a system that broke that discipline gets breached.** The two are the front and back of the same
proposition.

---

## 7.1 The problem — it dies before the request is even made

### 7.1.1 Observation

There is a delivery that places subtitle files on a static path. That path looks like this.

```
https://cdn.example/subtitles/old/그렌라간01.srt
```

Korean is embedded raw, without percent-encoding. Paste it into a browser's address bar and it opens —
because the browser converts it behind the scenes. Python's standard library does not do that. A measurement
with a file of that name actually placed on a local server.

```
>>> raw url: http://127.0.0.1:51267/subtitles/old/그렌라간01.srt
UnicodeEncodeError: 'ascii' codec can't encode characters in position 19-22: ordinal not in range(128)

>>> normalized: http://127.0.0.1:51267/subtitles/old/%EA%B7%B8%EB%A0%8C%EB%9D%BC%EA%B0%8401.srt
OK 200 b'x'
```

**The file exists but the request is not made.** This failure has three characteristics.

| Characteristic | Content |
|---|---|
| **not a single HTTP byte goes out** | not even a TCP connection is made. `http.client` first assembles the request line and encodes it to ASCII, and the socket connects after that, so the exception precedes the connection |
| **the exception name hides the cause** | `UnicodeEncodeError` looks like a text-processing error. it points at neither network·server·permission |
| **the position looks off** | in the path the Korean is from the 15th character, but the exception says the **19th** |

> **Term** — **request line**: the first line of an HTTP request message. In the form
> `<method> SP <request-target> SP <version>`, in the above case `GET /subtitles/old/그렌… HTTP/1.1`.

The third pinpoints the failure location. Had it encoded only the path string, the position should be 15. 19
is that plus the four characters `GET `. That is, what Python was trying to encode is not the path but **the
whole request line.** `http.client` assembles the request line and then does `encode("ascii")` on the whole
thing, dying on the spot.

And this tool hands the same address to **two kinds of consumer.**

| Consumer | Failure mode |
|---|---|
| `urllib` (direct receipt) | `UnicodeEncodeError` — at the time of writing the request line (measured above) |
| `ffmpeg` (delegated receipt) | the code comment says "cannot open the input" — **this statement was not reproduced.** §7.6 records the measurement |

`normalize_url`'s docstring wrote this situation down as is.

```python
# fetch.py:36-44
def normalize_url(url: str) -> str:
    """Normalize a URL into a form that can be handed as is to both the request and ffmpeg.

    There is a delivery that sends out an address with Korean embedded in the path without
    percent-encoding (`…/subtitles/그렌라간01.srt`). A URL is ASCII by spec, so such an
    address dies with UnicodeEncodeError the moment urllib writes the request line, and ffmpeg
    too cannot open the input. Repair it separately at each receiving side and one place is
    surely missed, so we fix it here in one place.
    """
```

The last sentence is this chapter's design proposition — **"repair it separately at each receiving side and
one place is surely missed."**

### 7.1.2 So where to repair it

There are three candidates.

| Candidate | Method | Problem |
|---|---|---|
| **A. per consumer** | encode right before the `urllib` call and right before assembling the `ffmpeg` args, each | there are four consumers and they will grow. miss one and only that path breaks quietly |
| **B. at the production point** | encode once at the spot the address is made, and afterward only already-encoded values circulate | if there are several production points there is no way to enforce the discipline |
| **C. B + boundary re-confirmation** | gather the production points into one, and pass through the same function **once more** at each consumer boundary | for two applications to be safe, that function must be **idempotent** |

This repository chose C. And for C to hold, the encoding function must have a certain property, which
**percent-encoding basically does not have.** This chapter covers that gap.

### 7.1.3 What happens if you apply it twice — a counterfactual measurement

The result of removing only `%` from `normalize_url`'s safe-character list and running the same pipeline.
Measured with a minimal HLS on a local HTTP server, with a path containing Korean·space.

```
=== current (% in _PATH_SAFE) ===
first segment requested : …%EA%B7%B8%EB%A0%8C%2001/%EA%B7%B8%EB%A0%8C%2001_000.ts
result                  : [(200, 'ok'), (200, 'ok'), (200, 'ok')]

=== counterfactual (% removed) ===
first segment requested : …%252001/%25EA%25B7%25B8%25EB%25A0%258C%252001_000.ts
result                  : [(404, …), (404, …), (404, …)]
```

`%20` became `%2520`. This chapter's title comes from here.

But more important is the **shape of the failure.**

| Observation | Value |
|---|---|
| playlist request | **success** (200) |
| segment requests | all 404 |

The playlist opens. Because that address does not yet contain a single `%` character, so it received only
the first encoding. The second encoding catches from **the address extracted from the playlist**, so the
symptom looks like not "our encoding is wrong" but **"the server does not give the segments."** The cause and
the symptom are one layer apart.

> **What breaks if you do not do this** — remove `%` from the safe characters and the list is received while
> only the content all 404s. Only 404s remain in the log, so it is indistinguishable from a hotlink block·
> token expiry (Chapters 9·11). **A failure that makes you suspect the wrong layer.**

---

## 7.2 The principle — percent-encoding is not idempotent

### 7.2.1 A URI is ASCII

> **Term** — **URI (Uniform Resource Identifier)**: the general spec for a string that points at a resource.
> Defined by RFC 3986. A URL is the collective name for the subset that **points by location.** When
> speaking of the spec in this chapter, we write URI.

RFC 3986 composes a URI only from a limited subset of US-ASCII — digits, letters, a few symbols. Korean is
not in that set. So to carry a non-ASCII character in an address you must **convert it to bytes and then
represent those bytes in ASCII.** That representation is percent-encoding.

> **Term** — **percent-encoding**: the method of representing one octet as `%` and two hex digits (`%HH`).
> RFC 3986 §2.1. `pct-encoded = "%" HEXDIG HEXDIG`.

> **Term** — **octet**: an 8-bit byte. The spec speaks of the encoding target as octets, not "characters" —
> which encoding to convert a character to bytes with is a separate decision, and on today's web it is UTF-8.

The single `그` is 3 octets (`EA B7 B8`) in UTF-8, and percent-encoded becomes the 9 characters `%EA%B7%B8`.
This expansion is the starting point of everything in this chapter.

There is a separate spec for identifiers containing non-ASCII too.

> **Term** — **IRI (Internationalized Resource Identifier)**: the identifier spec that allows non-ASCII
> characters. RFC 3987. The **IRI → URI conversion** is turning non-ASCII characters into a UTF-8 octet
> sequence and then substituting each octet with `%HH` (§3.1 Step 2).

§7.1.1's address is exactly an IRI, and what `normalize_url` does is turn that IRI into a URI. What the spec
requires of this conversion is cited in §7.2.4.

### 7.2.2 RFC 3986's character classes

To understand the encoding function you must first know precisely how the spec divides characters. There are
three classes.

> **Term** — **unreserved characters**: characters used only as data in any context.
> `ALPHA / DIGIT / "-" / "." / "_" / "~"` (RFC 3986 §2.3). Percent-encode them and the meaning is the same, so
> they are **the only class safe to decode when encoded.**

> **Term** — **reserved characters**: characters that may be used as delimiters.
> `reserved = gen-delims / sub-delims` (RFC 3986 §2.2).
> **gen-delims** = `: / ? # [ ] @` — the characters that divide a URI's major components.
> **sub-delims** = `! $ & ' ( ) * + , ; =` — characters that may be used **within** a component as
> scheme-specific sub-delimiters.

The third class is the rest, in neither of the above — space, non-ASCII, `"`, `<`, `>`, etc. — and **must be
percent-encoded.**

The crux is the treatment of reserved characters. RFC 3986 §2.2 nails it.

> URIs that differ in the replacement of a reserved character with its
> corresponding percent-encoded octet are not equivalent.

**`/` and `%2F` are different URIs.** Therefore the encoding function must already know "what is data and what
is a delimiter." This is why encoding must be done **per component** — in a path `/` is a delimiter but a `/`
inside a filename is data, and the latter must become `%2F`.

The characters allowed per component are defined in ABNF.

```abnf
; RFC 3986
pchar         = unreserved / pct-encoded / sub-delims / ":" / "@"    ; §3.3
segment       = *pchar                                              ; §3.3
path-abempty  = *( "/" segment )                                    ; §3.3
query         = *( pchar / "/" / "?" )                              ; §3.4
fragment      = *( pchar / "/" / "?" )                              ; §3.5
```

> **Term** — **pchar (path character)**: a character that can be placed as is in one path segment. The
> unreserved characters, a percent-encoded triplet, all of sub-delims, and `:` and `@`.

This ABNF is compared **character by character** with the code's constant in §7.3.1. First we see what the
spec says about the number of encodings.

### 7.2.3 The double role of `%`, and the spec's prohibition clause

`%` is special. It is both the **start marker** of the notation and, at the same time, an ordinary character
that may be used as data. `%` as data must be written `%25`.

Here ambiguity arises. Looking at the string `%20`, it can be read two ways.

| Reading | Result |
|---|---|
| **as encoded** | one space character |
| **as raw** | the three characters `%`, `2`, `0` → encoded becomes `%2520` |

**You cannot tell which from the string alone.** To judge, you need the **outside information** "has this
string already gone through encoding." RFC 3986 §2.4 addresses this problem head-on.

> Because the percent ("%") character serves as the indicator for percent-encoded
> octets, it must be percent-encoded as "%25" for that octet to be used as data
> within a URI. **Implementations must not percent-encode or decode the same
> string more than once**, as decoding an already decoded string might lead to
> misinterpreting a percent data octet as the beginning of a percent-encoding,
> or vice versa in the case of percent-encoding an already percent-encoded string.

The same section also says **where** to encode.

> Under normal circumstances, the only time when octets within a URI are
> percent-encoded is during **the process of producing the URI from its component
> parts.** … Once produced, a URI is always in its percent-encoded form.

Combine the two sentences and this chapter's design rule comes out directly.

> **Encode at the very point of producing the URI from its components, exactly once. After that a URI is
> always in its encoded form.**

This repository's `_absolute` docstring is the same as moving this sentence of the spec into a code comment —
"this is the only point that births a URI" ([`playlist.py:31`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L31)).

### 7.2.4 Idempotency — the definition and two functions

> **Term** — **idempotent**: for a function `f`, the property that `f(f(x)) = f(x)` holds for all inputs `x`.
> Applying it two or more times gives the same result as applying it once. In distributed systems it is used
> to mean that sending the same request twice leaves the state the same as sending it once (Chapter 29's
> at-least-once delivery is that context).

Implement percent-encoding **naively** and it is not idempotent. A measurement of repeatedly applying Python's
`quote()` default (only the path separator safe) to the same string.

| Applications | Result |
|---|---|
| 0 | `/hls/Episode%2001.ts` |
| 1 | `/hls/Episode%252001.ts` |
| 2 | `/hls/Episode%25252001.ts` |

`%` grows to `%25` each time, so it becomes a **different string** each application. The length increases
monotonically and does not converge.

The result of repeating `normalize_url` on the same input.

| Applications | Result |
|---|---|
| 0 | `/hls/Episode%2001.ts` |
| 1 | `/hls/Episode%2001.ts` |
| 2 | `/hls/Episode%2001.ts` |

**A fixed point.** The one thing that made the difference is the fact that `%` is in the safe-character list.

This property is also what the spec requires. RFC 3987 §3.1 states for the IRI → URI conversion.

> The mapping is also an identity transformation for URIs and **is idempotent**;
> applying the mapping a second time will not change anything.

That is, "applying the conversion to something already a URI must do nothing" is the spec's requirement. That
`normalize_url`'s safe characters include `%` is not a convenience but **the implementation of this
requirement.**

### 7.2.5 The price of idempotency — you give up injectivity

It is not free. Written precisely, the rule is this.

> **A `%` already in the input is regarded as an encoding marker and left untouched.**

Then there is no way in this function to represent **`%` as data.**

> **Term** — **injective**: the property that different inputs always have different outputs.
> `x ≠ y ⟹ f(x) ≠ f(y)`.

`normalize_url` is not injective. A measurement.

| Input (different strings) | Output | The name the server decodes and reads |
|---|---|---|
| `/hls/a b.ts` — literal space | `/hls/a%20b.ts` | `a b.ts` |
| `/hls/a%20b.ts` — literal `%` `2` `0` | `/hls/a%20b.ts` | `a b.ts` ← **the intent was `a%20b.ts`** |

The two inputs are different strings but the output is the same. Therefore **a file with `%20` literally in
its name cannot be pointed to by this function alone.** That name's correct URI is `a%2520b.ts`, but
`normalize_url` sees the input's `%` as a marker and cannot produce that value.

There is one thing to add. **The function is not incompetent; it has no information.** If the caller knows "this
is a name" and encodes it first, even a literal `%` is delivered exactly.

```
quote("a%20b.ts", safe="")                      -> 'a%2520b.ts'
normalize_url("https://…/hls/a%2520b.ts")       -> 'https://…/hls/a%2520b.ts'   (no change)
```

§7.3.6's sidecar path is exactly this form — a name-only encoder stands in front, and the normalizer only
passes it through behind. **What cannot be represented is not "a literal `%`" but "a literal `%` inside a raw
string that does not know whether it is a name or a URI."**

A broken escape passes through too.

```
'https://cdn.example/hls/100%.ts'   -> 'https://cdn.example/hls/100%.ts'    (no two hex digits after %)
'https://cdn.example/hls/a%zz.ts'   -> 'https://cdn.example/hls/a%zz.ts'    (%zz is not a valid triplet)
```

Both are **not valid URIs.** The function does not fix them — to fix them it would have to judge "this `%` is
data," and that judgment is exactly the one that breaks idempotency.

**Idempotency and handling a literal `%` inside a raw string cannot be had at once.** This code chose
idempotency, and the basis is in the domain — a literal `%` entering an HLS segment name was not observed, and
the same address passing through several layers happens on every request. §7.6 records the limits of this
choice again.

---

## 7.3 The code — one function, one production point

### 7.3.1 `_PATH_SAFE` is RFC 3986's pchar

```python
# fetch.py:30-33
# characters that may be left as is in each URL part. leaving `%` is the crux — re-encode an
# already-encoded address and `%20` becomes `%2520`, a different address.
_PATH_SAFE = "/%:@!$&'()*+,;=~"
_QUERY_SAFE = _PATH_SAFE + "?"
```

These 16 characters are not an arbitrarily chosen list. They correspond character by character with §7.2.2's
ABNF.

| Character in `_PATH_SAFE` | Identity in RFC 3986 | Why it is safe |
|---|---|---|
| `/` | path-abempty's segment separator | it is the path structure itself. encode it and the hierarchy vanishes |
| `%` | pct-encoded's start marker | **so as not to re-encode something already encoded** |
| `:` `@` | the two gen-delims named in pchar | allowed as data within a path segment |
| `!$&'()*+,;=` | **all 11 sub-delims** | included in pchar |
| `~` | an unreserved character | Python `quote()` already always preserves it — **redundant specification** |

In sum, the following equation holds.

```
_PATH_SAFE  =  pchar ∪ { "/" }        (here the realization of pct-encoded is "%")
_QUERY_SAFE =  pchar ∪ { "/", "?" }   =  the allowed set of query and fragment
```

What is missing matches the spec too.

| Excluded character | Reason |
|---|---|
| `?` (in a path) | the start delimiter of the query string. as data in a path it must be `%3F` |
| `#` (in all components) | the fragment start delimiter. as data within any component it must be `%23` |
| `[` `]` | in RFC 3986 allowed **only in authority's IP-literal notation.** in path·query they are encoding targets |

That `~` is a redundant specification is minor but shows the layers of spec and implementation. RFC 3986 §2.4
states that turning `%7E` back into `~` does not change the interpretation, and Python `quote()`'s
always-safe set is exactly the unreserved-character set (`A-Za-z0-9-._~`). Confirmed by measurement.

```
quote's always-safe characters: -.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~
```

**That a list can be labeled with the spec's names means that list is verifiable.** It is different from
"empirically these characters seem fine." When a proposal to add a new character comes, you can answer "which
component's ABNF is it in."

### 7.3.2 `normalize_url` — cut into components, then per-component rules

```python
# fetch.py:45-54
    u = urlsplit(url)
    return urlunsplit(
        (
            u.scheme,
            u.netloc,
            quote(u.path, safe=_PATH_SAFE),
            quote(u.query, safe=_QUERY_SAFE),
            quote(u.fragment, safe=_QUERY_SAFE),
        )
    )
```

There are three decisions in it.

**① Do not encode the whole thing.** After cutting into five components with `urlsplit`, use a different safe
set per component. As seen in §7.2.2, `?` is a delimiter in a path and data within a query. Apply one rule to
the whole string and **even the scheme's `:` and authority's `//` get encoded and it is no longer an
address.**

**② Use the query rule for the fragment too.** Since by ABNF `query` and `fragment` have literally the same
allowed set (`*( pchar / "/" / "?" )`), share one constant. This is not thrift but correctness — split into
two and there is room for only one to be fixed.

**③ `scheme` and `netloc` are passed through.** Seen separately in the next section.

### 7.3.3 Why is netloc not touched?

A host name's non-ASCII is not handled by percent-encoding. It uses the IDNA conversion based on **punycode**
(RFC 3492). The spec splits it that way too — RFC 3987 §3.1 states, only for the host component
(`ireg-name`), that "it MAY be converted with the ToASCII operation."

Measured, `normalize_url` passes an IDN host through as is.

```
'https://한글도메인.example/a.ts'  ->  'https://한글도메인.example/a.ts'
```

Apply percent-encoding at this spot and it is a **wrong conversion.** Carrying `%EA%B7%B8` in the host is not
punycode, and the DNS lookup does not hold. That is, this is not an omission but **keeping the layers.** In
Python the actual conversion happens where `http.client.putrequest` writes the Host header — it first tries
`netloc.encode("ascii")` and falls back to `netloc.encode("idna")` on failure (confirmed in the standard
library source).

But recorded honestly — **this repository has no case of measuring an IDN host.** The above statement comes
from the spec and standard-library behavior, not a record of this tool processing an IDN delivery.

### 7.3.4 The only point that births a URI

The segment addresses written in a playlist body are usually relative references.

```
#EXTINF:6.000,
seg000.ts
```

The spot that turns this into an absolute address is **the spot where a URI is born.**

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

![A relative URI and a base URL enter only one function, and four consumers share the value that came out of it](/images/lecture/hls-recon/07-uri-birth.svg)

*Figure 7-1 — the only point that births a URI — one door in, four doors out*

> **Term** — **SSOT (Single Source of Truth)**: a design where a value is produced in only one place in the
> system and all the rest only reference it. If a value is made in several places, a state where **different
> values circulate under the same name** will inevitably arise someday.

The spots that call this function are four inside the playlist parser, and **those four are all of them.**

| Call site | URI of what |
|---|---|
| [`playlist.py:229`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L229) | segments and variants (a non-tag line = the URI the preceding tag points to) |
| [`playlist.py:282`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L282) | `#EXT-X-MEDIA`'s subtitle·audio track |
| [`playlist.py:313`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L313) | `#EXT-X-KEY`'s decryption key |
| [`playlist.py:325`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L325) | `#EXT-X-MAP`'s initialization segment |

**That two things are in one line is important.**

```python
normalize_url(urljoin(base_url, uri) if base_url else uri)
```

`urljoin` is RFC 3986 §5's reference resolution, and inside it is §5.2.4's dot-segment removal
(`remove_dot_segments`). `normalize_url` is §2.1's percent-encoding. **The two are different operations of
different sections, and the order is fixed in this one line.** The caller has no room to choose the order.

A result confirmed by measurement. Whether the base URL is **before or after normalization**, the result is
the same.

| Relative URI | When the base is raw | When the base is normalized | Same? |
|---|---|---|---|
| `seg000.ts` | `…/%EA%B7%B8%EB%A0%8C%2001/seg000.ts` | same | ✔ |
| `../keys/키.bin` | `…/hls/keys/%ED%82%A4.bin` | same | ✔ |
| `그렌 01_000.ts` | `…/%EA%B7%B8%EB%A0%8C%2001/%EA%B7%B8%EB%A0%8C%2001_000.ts` | same | ✔ |

In the second row `../` disappearing is `urljoin`'s doing, and Korean turning into triplets is
`normalize_url`'s doing. The fact that **the two paths converge to the same value** is what makes §7.1.2's
method C hold.

### 7.3.5 The number of calls differs per consumer — yet the value is the same

There is a spot that applies it once more at the boundary.

```python
# fetch.py:151
        url = normalize_url(url)
```

A value that already passed `_absolute` passes here again. It looks like waste but is not — `Fetcher.get`
receives addresses that did not pass through the playlist parser too. **The first address the user pasted on
the command line**, a series-page link, a sidecar-subtitle candidate are such. This spot is the gate that
guarantees "whatever comes, from here it is a URI."

Measured how many times it actually applies during one receipt. Wrapped `normalize_url` to count calls on a
local 3-segment stream.

```
normalize_url called 7 times total
   1. transformed    http://127.0.0.1:PORT/그렌 01/index.m3u8          ← user input, fetch boundary
   2. transformed    …/그렌 01/그렌 01_000.ts                          ← _absolute
   3. transformed    …/그렌 01/그렌 01_001.ts                          ← _absolute
   4. transformed    …/그렌 01/그렌 01_002.ts                          ← _absolute
   5. no change      …%2001/%EA%B7%B8%EB%A0%8C%2001_000.ts             ← fetch boundary (re-pass)
   6. no change      …%2001/%EA%B7%B8%EB%A0%8C%2001_001.ts             ← fetch boundary (re-pass)
   7. no change      …%2001/%EA%B7%B8%EB%A0%8C%2001_002.ts             ← fetch boundary (re-pass)
```

Of the 7, 3 are **calls that do nothing.** And the accumulated count differs per consumer.

| Consumer | Accumulated applications | Path |
|---|---|---|
| HTTP segment receipt | **2** | `_absolute` → [`fetch.py:151`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L151) |
| decryption-key request | **2** | `_absolute` → [`fetch.py:151`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L151) |
| ffmpeg input — variant chosen from the master | **1** | `_absolute` only ([`cli.py:195`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L195)'s `chosen.uri`) |
| ffmpeg input — user gave the media playlist directly | **0** | [`cli.py:177`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L177) takes the input string as `media_url` as is |
| report JSON record | **1** | `_absolute` only (`report.py:475,486`) |

**The count differs per layer but the value is the same.** This is what idempotency actually buys. Had it not
been idempotent, the 1-application row and the 2-application row of this table would be different addresses,
and the stream `probe` saw and the stream `fetch` received would be different resources.

The fourth row is the exception, and **the spot where this chapter's discipline is not kept.** `_load` returns
the user-given string as the base URL as is ([`cli.py:138`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L138)), and if that value is not a master it becomes
`media_url` and goes to ffmpeg ([`cli.py:177`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L177)). The segment addresses are safe because `_absolute` normalizes
them, but **only the top-level address going to ffmpeg does not pass normalization.** Exactly the form the
docstring warned of — "repair it separately at each receiving side and one place is surely missed" — actually
remains in one place. The impact and reproducibility are recorded in §7.6.

> **What breaks if you do not do this** — choose method B (only at the production point) and delete
> [`fetch.py:151`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L151), and only a run that entered a raw Korean address on the command line dies with §7.1.1's
> `UnicodeEncodeError`. The addresses inside the playlist are fine, so it becomes a **failure that splits by
> input method**, and the reproduction condition is hard to pin.

### 7.3.6 From name to URI — division of labor between the encoder and the normalizer

There is a delivery with no subtitle declaration in the playlist and only a file placed on a static path. Here
a URI is not **picked up** but **assembled from a name.**

```python
# subtitles.py:398-414
def sidecar_urls(name: str, origin: str) -> list[str]:
    """Assemble subtitle-URL candidates from a name and an origin (path × extension × name form)."""
    u = urlparse(origin.strip())
    if u.scheme not in ("http", "https") or not u.netloc:
        raise ValueError(f"the subtitle origin is not a URL: {origin!r}")
    base = urlunparse((u.scheme, u.netloc, "", "", "", ""))
    urls: list[str] = []
    for variant in name_variants(name):
        # a name with Korean·space enters the path as is, so encode it. '/' cannot be part of
        # a name either, so empty the safe set and encode the whole thing.
        encoded = quote(variant, safe="")
        for path in SIDECAR_PATHS:
            for ext in SIDECAR_EXTS:
                url = base + path.format(name=encoded, ext=ext)
                if url not in urls:
                    urls.append(url)
    return urls
```

What is used here is **not** `normalize_url`. It is `quote(variant, safe="")` — the safe set is completely
empty. Because the two functions have different roles.

| | `quote(name, safe="")` | `normalize_url(url)` |
|---|---|---|
| **input** | a human-decided **name.** not a URI | a URI, or a string trying to become a URI |
| **`/` treatment** | encodes it (`%2F`) — cannot be part of a name | preserves it — it is the path separator |
| **`%` treatment** | encodes it (`%25`) — a literal within the name | preserves it — an encoding marker |
| **idempotent?** | **No** | Yes |
| **applications** | exactly once | any number |

![The three stages from one name to a request line](/images/lecture/hls-recon/07-encode-once.svg)

*Figure 7-2 — from one name to a request line — encoding exactly once, normalization any number of times*

`safe=""` looks easily like a mistake. Because it encodes even `/`. But at this spot `variant` is **not a path
but one path segment.** It is a value going into RFC 3986's `segment`, so `/` is data, and data `/` must be
`%2F` as seen in §7.2.2.

> **What breaks if you do not do this** — leave `safe="/"` (Python's default) and the moment a name contains
> `/` a path layer is added. The name `그렌라간 1/2화` comes to request `/subtitles/old/그렌라간 1/2화.srt`,
> and on the server side it points at a **different directory.** A name changing the path structure — this is
> the same form as the seed of the path traversal §7.5 covers.

And this value passes `normalize_url` **once more** through `Fetcher.get`. That nothing happens then is §7.2.4's
fixed-point property. `%EC%97%90`'s `%` is preserved, so it does not become `%25EC%2597%2590`.

This path is fixed by a regression test.

```bash
# tests/run.sh:246-249
# ------------------------------------------------------- sidecar subtitle (URL assembly)
# a delivery with no subtitle declaration in the playlist. make a URL from a name and origin and receive it.
# using Korean·episode notation as is is to also fix down URL encoding and name-candidate generation
# — the path actually encountered was of that form.
```

The test leaves the filename as `에피소드01.srt`, and passes the whole process where the tool assembles the URL
from that name and receives it. The round trip **file-system name → encoding → request → server's decoding →
the same file** is fixed at once. It even compares whether the received bytes are the same as the original
(`cmp -s`), so if the name changes in between it fails.

### 7.3.7 Headers get the same rule

Where normalization is needed is not only the request line.

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

`Referer` is **a URI carried in a header value.** It gets the same ASCII constraint as the request line, so it
uses the same function. What is notable is the phrase "by the same rule **as the address**" — no separate
header encoding was made.

Why this matters becomes clear thinking about the server side. Hotlink blocking **compares the `Referer` value
as a string** (Chapter 9). If the request line and `Referer` are encoded by different rules, a value different
from what the browser sent is carried, and the check does not pass. **The very fact that the two spots use the
same function guarantees the match.**

### 7.3.8 The reverse direction — a fault visible only by decoding

So far only the encoding direction has been seen. There is one spot in this repository that necessarily needs
the reverse direction, and that spot shows this chapter's discipline best.

```python
# series.py:131-148
def _series_url_of_episode(page: str, url: str) -> str:
    """Get the series-page address from an episode page.

    A breadcrumb link's title sometimes has a trailing space. That address returns 200 too but comes
    **with an empty list** — a failure that does not look like an error. So do not use the received
    address as is but strip the space of the title part and normalize.
    """
    …
    absolute = urljoin(url, href.group(1))
    u = urlparse(absolute)
    return u._replace(path=unquote(u.path).rstrip()).geturl()
```

The problem is this. The path of a link extracted from the HTML is `/c/작품%20`. A space is attached to the
end, and that address **returns 200 while giving an empty list.**

To strip the space you must do `rstrip()`. But in the encoded state that does not work. A measurement.

```
rstrip in the encoded state : 'https://site.example/c/%EC%9E%91%ED%92%88%20'   ← no change
rstrip after unquote        : 'https://site.example/c/작품'
then normalize_url          : 'https://site.example/c/%EC%9E%91%ED%92%88'
```

Because the trailing space is represented as the **three-character ASCII string** `%20`. `rstrip()` looks for
a space character at the string's end, but what is there is the digit `0`. It finds nothing to strip and
returns it as is. **A fault whose very existence is invisible unless you decode.**

So this spot takes three stages.

| Stage | Operation | Why |
|---|---|---|
| 1 | `unquote(u.path)` | makes the fault (trailing space) **visible** |
| 2 | `.rstrip()` | removes the fault — a data-layer operation |
| 3 | (at the boundary) `normalize_url` | turns it back into a URI — [`fetch.py:151`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L151) does it |

That this function does not do stage 3 itself is worth noting. The return value is a string with raw Korean,
and turning it into a URI is left to the boundary. Exactly §7.2.3's rule — **encode once, at the point of
producing the URI.**

Here comes this chapter's second proposition.

> **If you must operate on a string, do it on the decoded representation, and re-encoding the result is the
> boundary's job. Operate directly on the encoded representation and the operation fails quietly.**

The `rstrip()` that passed over `%20` throws no exception. It merely returns the value as is. And that address
returns 200. **No error at any layer, yet the result is empty** — another form of the "successful failure" seen
in Chapter 5.

---

## 7.4 Generalization — transform at the boundary, once

### 7.4.1 Extract the form

All the code in this chapter shares one form.

> **A transform that changes the representation is done only once at the system's boundary, and the inside
> handles only one representation. For a re-transform on the inside to be safe too, that transform must be
> idempotent.**

The first sentence is the discipline and the second is **the safety net for when that discipline is broken.**
In practice both are needed — the discipline alone does not stop new code from violating it, and the safety
net alone leaves no one knowing where the transform happens.

### 7.4.2 Idempotent transforms and non-idempotent ones

Divide the transforms placed at the same spot by the idempotency axis and it shows which side is dangerous.

| Transform | Idempotent? | Apply twice |
|---|---|---|
| percent-encoding (naive implementation) | **No** | `%20` → `%2520` → `%252520` (diverges) |
| percent-encoding (`%` preserved, this code) | Yes | no change |
| percent-**decoding** | **No** | `%2520` → `%20` → space (different value) |
| HTML entity escape | **No** | `&` → `&amp;` → `&amp;amp;` |
| SQL quote escape | **No** | `'` → `''` → `''''` |
| Base64 encoding | **No** | length increases by 4/3 each time |
| uppercasing · lowercasing | Yes | no change |
| Unicode NFC normalization | Yes | no change (Chapter 31) |
| absolute path resolution (`Path.resolve`) | Yes | no change |
| dot-segment removal | Yes | no change |
| whitespace strip (`strip`) | Yes | no change |

**Those named "encoding" are mostly not idempotent, and those named "normalization" are mostly idempotent.**
It is not a coincidence.

> **Term** — **equivalence class**: the set of values grouped as "the same" by some relation.
> **representative**: one value chosen as the representative from that set.

Normalization is by definition **an operation that picks a representative per equivalence class and sends the
value to it**, and send the representative again and it comes out itself. That is why it is idempotent.
Encoding, by contrast, is an operation that **moves a representation to another representation**, and move the
moved thing again and it becomes yet another representation.

That `normalize_url` does encoding yet is named not `encode_url` matches this distinction. This function sends
**both** non-URI strings and already-URI strings to URIs, **and leaves what is already a URI in place.** That
is why it can be idempotent.

### 7.4.3 When an un-normalized value becomes a key

There is one more thing idempotency and single-source buy together — **the reliability of a key.**

```python
# decrypt.py:24-31
        if key.uri not in self._cache:
            r = self._fetcher.get(key.uri)
            …
            self._cache[key.uri] = r.body
        return self._cache[key.uri]
```

`KeyCache` uses the key URI as the cache key, as a string. The basis for this working correctly is only the
fact that **every `key.uri` is a value that passed [`playlist.py:313`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L313).** Two notations pointing at the same
key cannot go into the cache separately.

Had the normalization point been scattered, the same key goes into the cache separately as **a normalized
notation and a non-normalized one.** `…/키.bin` and `…/%ED%82%A4.bin` are the same resource to the server but
different keys to a Python dict. The symptom is "the key is received twice" — the feature is normal and only
the request count rises. **A correctness fault that looks only like a performance degradation.**

(The case where two notations that **both passed normalization** — like `…/key.bin` and `…/key%2Ebin` —
point at the same resource, this code cannot merge. Because `normalize_url` does not do all of RFC 3986
§6.2.2's normalization, recorded again in §7.6.)

Gather the places the same form appears.

| Domain | The value that becomes a key | If normalization is off |
|---|---|---|
| HTTP cache | the request URI | the same resource is cached as two entries. conversely if different resources merge into one entry, **cache poisoning** |
| dedup set | URL · identifier | duplicates are not filtered (the same structure as Chapter 29's subtitle-cue dedup) |
| access-control list | path · username | **bypass the list with a different notation** → §7.5 |
| idempotency key | request identifier | the same request is performed twice |
| file system | filename | two entries that look the same (Chapter 31) |

The third row is the bridge to the security section. **A key not being normalized means verification saw a
non-normalized value, and that is a bypass.**

---

## 7.5 Security — the double-encoding bypass

### 7.5.1 The structure

Read this whole chapter's property inverted to the attacker's view and it becomes this.

> **When the number of decodings differs per layer, the same string looks like a different value per layer.**

> **Term** — **double encoding bypass**: a technique of percent-encoding a forbidden string twice to pass a
> verifier, then having a post-verification layer's additional decoding turn it back into the forbidden
> string. Broadly it is a kind of **canonicalization attack**, classified as CWE-174 (Double Decoding of the
> Same Data).

> **Term** — **canonicalization**: the operation of gathering several notations meaning the same thing into
> one standard notation. This chapter's `normalize_url` is canonicalization for URIs.

> **Term** — **path traversal**: an attack of putting parent-directory-move notation (`../`) into the input to
> reach a file outside the intended directory. CWE-22.

![The accumulated decode count differs at the request·verifier·file layers](/images/lecture/hls-recon/07-decode-mismatch.svg)

*Figure 7-3 — the double-encoding bypass — the accumulated decode count differs per layer*

Move to a table how the same request looks at each layer of the figure.

| Layer | Accumulated decode | The string that layer sees | Verdict |
|---|---|---|---|
| ① arrival | 0 | `/files/%252e%252e%252fetc/passwd` | — |
| ② verifier | 1 | `/files/%2e%2e%2fetc/passwd` | no parent-move notation → **pass** |
| ③ file layer | 2 | `/files/../etc/passwd` | reaches the parent directory |

② did not lie. In the string it saw there really is no `../`. **The problem is the fact that what ② saw is
different from what ③ uses.**

### 7.5.2 Why the counts get misaligned

Because each layer independently decides whether to decode, and each does not know the others' decisions.
Listing the spots decoding can happen in a real stack.

| Spot | Decodes? | Note |
|---|---|---|
| reverse proxy · load balancer | varies by implementation·config | a config passing a **normalized form** upstream after normalizing is common |
| WAF · filter rule | usually does | how many times varies by product |
| web-framework router | usually does | when extracting path variables |
| application code | as many as the developer called | a spot that habitually calls `unquote()` one more time |
| file layer · OS | does not | uses the string as a path as is |

> **Term** — **WAF (Web Application Firewall)**: an intermediate device that matches HTTP requests against
> rules to block malicious patterns. The rules are usually string·regex matching.

**No one layer did wrong.** Each made a reasonable choice, and the sum of those choices is misaligned. So this
vulnerability is not easily caught in code review — looking at one file alone, there is no problem.

Here comes this chapter's third proposition. It is the crux of this chapter.

> **When the normalization time and the verification time are misaligned, that itself is a vulnerability.
> Verification must be done after the final normalization.**

This proposition has a name in CWE too.

> **Term** — **CWE-180 (Incorrect Behavior Order: Validate Before Canonicalize)**: the wrong order of
> performing verification before canonicalization. It refers to the class of fault where a value verification
> passed becomes a forbidden value after canonicalization.

Look at §7.4.2's table again and it shows exactly where the dangerous combination is. The condition is **a
non-idempotent transform remaining after verification.** If the transform is idempotent, the value at
verification and the value at use are the same, so this fault does not hold.

### 7.5.3 Which side is this chapter's code?

`normalize_url` is **canonicalization in the encoding direction**, and the above attack happens in the
**decoding direction.** The sign is opposite. But the property is the same.

| | This chapter's code (client) | Double-encoding bypass (server) |
|---|---|---|
| direction | encoding | decoding |
| if the count is misaligned | the address points at a **different resource** → 404 | the path points at a **different file** → leak |
| property | idempotent, so the value is the same even if misaligned | not idempotent, so the value differs if misaligned |
| result | safe | vulnerable |

**It is a difference of which side you view the same property from.** The client wants "the same value however
many times applied," and so chose an idempotent transform. Server-side decoding is inherently not idempotent,
so it cannot use the same method, and instead must **fix the count to one.**

### 7.5.4 This repository's server-side code

This repository has code that receives HTTP too. A test server.

```python
# tests/gzip_server.py:22-25
        target = (ROOT / self.path.lstrip("/").split("?")[0]).resolve()
        if not target.is_file() or ROOT not in target.parents and target != ROOT:
            self.send_error(404)
            return
```

Two things can be confirmed.

**① The decode count is 0.** `BaseHTTPRequestHandler` does not percent-decode `self.path`. Measured.

```
200  /plain/index.m3u8
404  /%EC%97%90%ED%94%BC%EC%86%8C%EB%93%9C01.vtt     ← the file exists but does not open
404  /에피소드01.vtt
```

Since it does not decode, `%2e%2e` only looks for a directory literally named `%2e%2e` to the end, and **there
is no room for the count to be misaligned.** But this is not so much a defense as an unimplemented feature — it
cannot open even a percent-encoded normal path. The current tests use only ASCII paths, so it does not surface
(§7.6).

**② Verification comes after canonicalization.** After making the **final absolute path** with `resolve()`
resolving all symbolic links and `..`, it checks against that value whether it is under `ROOT`. Had the order
been reversed, checking `".." in path` on the `self.path` string and then opening, §7.5.1's structure would
hold as is.

> **What breaks if you do not do this** — block `..` with a string check and then join the path, and notations
> like `..%2f`·`%2e%2e/`·`....//` each become a separate bypass. The fight against the variety of notations
> never ends. **Check one final value and it becomes independent of the variety of notations.**

For comparison, `python3 -m http.server` (`tests/run.sh:149`), which the regression test uses to serve
content, does the opposite — it **decodes exactly once** and then filters out `..` and `.` from the path
segments. The count is fixed at 1 and verification is after it, so there is no room for misalignment either.
**Whether the count is 0 or 1 does not matter — what matters is that it is fixed to one and verification is
after it.**

### 7.5.5 The defender's view

We do not explain only bypass paths and stop. What to do, by role.

| Role | What to do |
|---|---|
| **application developer** | put the check on **the value just before final use.** check not the string but the interpreted result (absolute path·parsed URI·integer). growing the blocklist (`..`, `%2e`) never ends |
| **framework·library designer** | **expose the decoding point as one**, and make the values before and after it distinct types. if `RawPath` and `DecodedPath` are different types, an order mistake is caught at compile time |
| **infrastructure operator** | **document which of proxy·WAF·application decodes**, and fix the total count. whether the proxy passes the normalized form upstream or the original is decisive |
| **WAF-rule author** | confirm that the value the rule sees and the value the application uses are the same. if they differ, that rule is **there but not there**, and its existence is rather a danger |
| **auditor** | the claim "we validate the input" must be met with **at what time's value do you validate.** the problem is not the validation function itself but the transform between validation and use |
| **client implementer** (this repository) | make the transform idempotent and gather the production points into one. then however many times it applies per layer, the value is the same |

The second row is most fundamental. **Making it impossible to get the order wrong is better than requiring the
order be kept.** That this repository attached `urljoin` and `normalize_url` together in one `_absolute` spot
is the same idea — it gives the caller no choice of order.

### 7.5.6 The same structure in a different alphabet

This chapter's proposition catches not only on percent-encoding. Any transform makes the same fault as long as
it satisfies the condition "a value-changing transform remains after verification."

| Transform | What the verifier sees | What a later transform makes |
|---|---|---|
| percent-decoding (this chapter) | `%2e%2e` | `..` |
| Unicode normalization | a notation that passes the check | a forbidden value (Chapter 31) |
| case folding | a notation not in the list | a value in the list |
| path normalization | `a/b/../c` | `a/c` |
| character-encoding conversion | a different byte sequence | the same character |

The second row is Part 7's subject. **Character normalization and percent-encoding are actually on the same
transform chain** — RFC 3987 §3.1's IRI → URI conversion requires NFC normalization in stage 1 (when the input
is a non-Unicode representation) and does UTF-8 percent-encoding in stage 2. This chapter is the back half of
that chain, and the front half is covered in Chapter 31. Since the structure is the same, we only confirm here
that §7.5.2's proposition applies as is and move on.

---

## 7.6 Limits and open questions

Noted honestly.

- **A literal `%` inside a raw string cannot be represented.** As seen in §7.2.5, it is the price of
  idempotency and a choice, not a bug. A path assembled from a name (§7.3.6) has a dedicated encoder in front
  so it is unaffected, and it holds only in **a relative URI written in a playlist and an address the user
  pasted.** But that **the choice's basis is an absence of observation** is weak — "I have never seen such a
  name" is not "no such name exists." Meet it and `normalize_url` passes a quietly broken escape through, and
  the server gives a 404 or 400.

- **It does not detect a broken escape.** Inputs like `%zz`·`%2` go out as is. To detect it you would add a
  stage checking the triplet syntax, and that check reintroduces §7.2.5's ambiguity ("is this `%` a marker or
  data"). Currently it does not check.

- **`normalize_url` does not do all of RFC 3986 §6.2.2's normalization.** A measurement.

  ```
  'https://CDN.Example:443/a/../b/c.ts'  ->  'https://CDN.Example:443/a/../b/c.ts'
  ```

  Scheme·host lowercasing (§6.2.2.1), triplet-hex uppercasing (§6.2.2.1), unnecessary-encoding removal of
  unreserved characters (§6.2.2.2), dot-segment removal (§6.2.2.3) — it does none of them. The last is done by
  `urljoin` inside `_absolute`, but `normalize_url` **alone** does not. **This function does not make a
  "canonical form for URI-equivalence judgment"** — the name is normalization but the actual scope is closer
  to "IRI → URI conversion + encoding of illegal characters."

  Where this actually becomes a problem is §7.4.3's cache key. `…/key.bin` and `…/key%2Ebin` point at the same
  resource by spec (§6.2.2.2 says to decode unreserved characters), but this code leaves the two as different
  strings so the cache entry splits into two. **Not observed, and there is no measurement to observe it.**

- **The call-count measurement is a value from a minimal reproduction environment.** §7.3.5's "7 times" is
  measured by wrapping counting code on a local 3-segment stream, and the count of a real run (including
  subtitle·key·series paths) is higher than this. The **ratio** and the **difference in accumulated count per
  consumer** in the table are the point, not the absolute value.

- **The comment "ffmpeg too cannot open the input" was not reproduced.** It is the statement at
  [`fetch.py:41-42`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L41-L42). The result of making the same condition and measuring with ffmpeg 8.1.1 was the
  opposite — placed an HLS with a Korean·space path on a local server and passed **the raw URL as is**, and it
  opened.

  ```
  $ ffprobe -v error -show_entries format=duration -of csv=p=0 "http://127.0.0.1:8979/그렌 01/index.m3u8"
  4.000000

  # the request line the server received
  "GET /%EA%B7%B8%EB%A0%8C%2001/index.m3u8 HTTP/1.1"
  ```

  **ffmpeg percent-encoded and sent it itself.** That is, in this version the delegated path works even without
  `normalize_url`. There are three possibilities and which one could not be determined — (a) the comment was
  observed on an older ffmpeg, (b) a real CDN's path had a different property from this reproduction (e.g.,
  non-ASCII inside a query string), (c) the comment was a statement inferred from the urllib-side failure.

  But **the conclusion does not change.** The urllib-side failure was measured in §7.1.1, and this repository
  does not fix the ffmpeg version (same argument as Chapter 15 §15.7), so relying on an upstream
  implementation's voluntary encoding is weak grounds. **Recording what was measured and what was not
  separately** is this course's form, so it is left as is.

- **The top-level address going to ffmpeg does not pass normalization.** It is the fourth row of §7.3.5. If the
  user gives the media playlist URL directly, the raw string is passed **as is** to `probe`·`assemble` via the
  `cli.py:138 → 177 → 539/595` path. By the above item's measurement it is not a problem on ffmpeg 8.1.1, so
  **there is no currently observed symptom.** But this is the same state as the **accidental defense** §15.6
  spoke of — the reason this spot is safe is not this repository's decision but the upstream's behavior. The
  way to fix it is obvious (`_load` returning `normalize_url(src)`). **This chapter did not fix the code.**

- **An IDN host could not be measured.** §7.3.3's statement comes from the spec (RFC 3987 §3.1) and
  standard-library behavior. There is no record of this tool processing an IDN-host delivery.

- **`tests/gzip_server.py` cannot open a percent-encoded path.** §7.5.4's measurement is that. The current test
  requests of this server only ASCII paths under `/plain/` (`tests/run.sh:157,183,191`), so it does not
  surface. Move a Korean path to this server and it 404s immediately. It means **the test fixture handles a
  narrower case than the server itself**, and the test fixing the encoding round trip is only on the
  `python3 -m http.server` side.

- **`series.discover`'s dedup key is the pre-normalization value.** It puts `page_url` into the `seen` set as
  the `urljoin` result as is ([`series.py:171-174`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L171-L174)). If the same episode is carried in two notations, dedup
  fails — the form §7.4.3 warned of. **No such list was actually observed**, and even if it fails the impact is
  about receiving the same episode twice.

---

## 7.7 Summary

1. A URI is ASCII by spec (RFC 3986). An address with Korean·space embedded dies with `UnicodeEncodeError`
   **before the connection.** Not even a TCP connection is made, so not a single HTTP byte has gone out, and
   the exception name looks like a text-processing error. (The ffmpeg-side failure the same comment claims was
   **not reproduced** — §7.6.)
2. **Percent-encoding is not idempotent.** Implement it naively and `%20` → `%2520` → `%252520` diverges. RFC
   3986 §2.4 states "must not percent-encode or decode the same string more than once."
3. That `_PATH_SAFE` leaves `%` makes this code idempotent. A measured counterfactual — remove `%` and **the
   playlist opens while only the segments all 404.** A failure with cause and symptom one layer apart.
4. `_PATH_SAFE` is not an arbitrary list but **RFC 3986's `pchar` ∪ {`/`}**, and `_QUERY_SAFE` is exactly the
   allowed set of `query`·`fragment`. That a list can be labeled with the spec's names is verifiability.
5. **The point that births a URI is one** ([`playlist.py:30-38`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L30-L38)). A playlist relative path·series-page link·
   sidecar candidate·a header's Referer all pass the same function. The **order** of `urljoin` (reference
   resolution) and `normalize_url` (encoding) is fixed in one line, so the caller has no choice.
6. The accumulated applications differ per consumer — HTTP receipt 2, ffmpeg input 1, and **one spot remains at
   0** (a media playlist URL the user gave directly, §7.3.5·§7.6). **That the count differs but the value is
   the same** is all idempotency buys.
7. The price of idempotency is **injectivity.** This function cannot represent a literal `%` inside a raw
   string. It chose one of the two that cannot be had at once, and the basis is in the domain. The path where a
   name-only encoder stands in front (§7.3.6) is unaffected.
8. Do string operations on the **decoded representation** and leave encoding to the boundary. A trailing space
   left as `%20` is invisible to `rstrip()`, and that address returns **200 with an empty list.**
9. **When the normalization time and the verification time are misaligned, that itself is a vulnerability.** If
   the verifier decodes once and the file layer decodes twice, `%252e%252e` passes verification and then
   becomes `..` (CWE-174 · CWE-180). No layer did wrong; the sum is misaligned.
10. The defense is **checking one final value.** That `tests/gzip_server.py:22-25` checks after `resolve()` is
    that form. Growing the list of forbidden notations never ends.

---

**Next chapter** — up to here the address is made correctly and the request can go out. But if there are
hundreds of segments there is no reason to receive them one at a time, and you must also decide how many times
to retry a failed request. Chapter 8 covers **how the result order is preserved** in parallel receipt, which
status codes to retry and which to give up on immediately, and the reason for looking at **p95** rather than
the mean. Since a retry can be amplification toward the server itself, what is worth trying again is a
performance issue and a matter of courtesy.
