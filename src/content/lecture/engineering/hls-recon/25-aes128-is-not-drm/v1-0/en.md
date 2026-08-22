---
title: "AES-128 Is Not DRM"
description: "The threat model and Kerckhoffs's principle"
date: 2026-07-16
version: '1.0'
tags: ['streaming', 'cryptography']
thumbnail: /images/lecture/thumb/hls-recon-25-aes128-is-not-drm.svg
---
## 25.0 What this chapter answers

1. In an AES-128-encrypted HLS stream, **where does the key come from?**
2. Is a configuration possible where a client that can play cannot obtain the key?
3. If not, what does this encryption **protect and fail to protect?**
4. Why is DRM a different kind of problem — structurally what more is there?
5. When designing a protection, **what must be set first?**

The first three are answered with observation and code. The latter two are this chapter's main argument, and
their answer is not in cryptography but in the **threat model.**

---

## 25.1 The problem — the key comes in plaintext

Make one encrypted HLS stream directly and it all shows. Exactly the way this repository's regression test does it
(`tests/run.sh:46-49`).

```bash
head -c 16 /dev/urandom > enc/enc.key
printf '%s/enc/enc.key\n%s/enc/enc.key\n' "$BASE" "$WORK" > enc/keyinfo
ffmpeg -v error -y -i source.mp4 -c copy -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_key_info_file enc/keyinfo -hls_segment_filename "enc/seg%03d.ts" enc/index.m3u8
```

The result of reproducing the same procedure in miniature (ffmpeg 8.1.1). The playlist made is this.

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x00000000000000000000000000000000
#EXTINF:4.000000,
seg000.ts
#EXTINF:4.000000,
seg001.ts
#EXT-X-ENDLIST
```

`URI="enc.key"` is the material of this whole chapter. Let us see what that address returns.

```
$ wc -c < enc/enc.key
      16
$ xxd enc/enc.key
00000000: 2f5f 7cdf ac65 94b1 914c 5d76 4391 387e  /_|..e...L]vC.8~
```

**16 bytes. That is all.** No envelope, no signature, no per-device wrapping. A plaintext symmetric key comes down
over one ordinary HTTP GET.

The segment side is definitely encrypted. Look at the leading byte and the MPEG-TS sync byte `0x47` that Chapter
14 used as a determination basis is not there.

```
$ xxd -l 16 enc/seg000.ts
00000000: 723b 5b66 9184 f0b6 9ace c5f9 5bb4 ad5f  r;[f........[.._
```

Put this byte string into this repository's determination function and `unknown` comes out (measured). The cipher
is doing its job — **seen from the side without the key, this is indistinguishable from random.**

And yet the key is right next to it. In the playlist above, `enc.key` sits in the same directory, the same HTTP
root, as the segments. Whoever can request the segments can request the key too.

Here this chapter's question stands.

> **If the set of people who can obtain the key and the set who can play are the same set, whom is this
> encryption blocking.**

---

## 25.2 The principle — Kerckhoffs's principle is kept. The problem is elsewhere

### 25.2.1 Two terms

> **Term** — **Kerckhoffs's principle**: a cryptosystem's security must not depend on the secrecy of the
> algorithm but **only on the secrecy of the key.** It is the second of six items Auguste Kerckhoffs presented in
> 1883 as requirements for a military cipher. Claude Shannon restated the same requirement as "assume the enemy
> knows the system" (**Shannon's maxim**).

> **Term** — **threat model**: a statement specifying **what** (asset) a protection protects, **from whom**
> (adversary), **against attacks of what capability** (capability), **under what trust assumptions** (trust
> assumption). Only when the four items are filled does the sentence "it is protected" become a claim that can be
> judged true or false.

Write this chapter's conclusion in one line in advance and it is this. **HLS's AES-128 fully keeps Kerckhoffs's
principle. And yet it does not protect the content.** The two sentences are not a contradiction.

### 25.2.2 The algorithm is public from the start

RFC 8216 §4.3.2.4 and §5.2 write out the decryption procedure without omission — AES-128-CBC, PKCS#7 padding, and
if the `IV` attribute is absent, fill the media sequence number as 128-bit big-endian (only the last rule is in
§5.2). This repository's `decrypt.py` is close to a transcription of those sentences, and the module's first line
states the source.

```python
# decrypt.py:1-6
"""HLS AES-128 segment decryption (RFC 8216 §4.3.2.4).

By spec it is AES-128-CBC + PKCS7 padding, and the IV uses the EXT-X-KEY's IV attribute,
or if absent fills that segment's media sequence number as 128-bit big-endian.
The key itself is downloaded as plaintext 16 bytes from a URI — link-protection level, not DRM.
"""
```

That the algorithm is public is not a weakness. **It is the normal state Kerckhoffs's principle requires.** A
system that must hide its algorithm to be safe collapses entirely the moment the algorithm is revealed, and the
algorithm is always revealed. So the whole weight of security is moved to the key.

The problem is **where that key goes.**

### 25.2.3 The condition under which protection holds

Write protection as sets and the condition is simple.

> For any secret-based protection to hold, **the set receiving the secret** and **the set to be blocked** must not
> overlap.

In HLS AES-128 the set receiving the secret is, by definition, this.

- you must decrypt the segments to play
- to decrypt you need the key
- the key **the client fetches itself** via the `EXT-X-KEY` URI

So **a client that can play can, by definition, obtain the key.** This is not a measurement result but a logical
consequence following immediately from the definition of `KEYFORMAT=identity`. There exists no configuration with
an exception — if there were, that client could not play.

![The key-distribution boundary — what is excluded and what is not](/images/lecture/hls-recon/25-key-distribution-boundary.svg)

*Figure 25-1 — the key-distribution boundary: which side of the boundary the adversary is on*

The diagram's two adversaries are all of this chapter.

| Adversary | What they have | Result | Verdict |
|---|---|---|---|
| **A** — a third party who only picked up the segment URL | the segment address | the key request is blocked by the control → only ciphertext | **excluded** |
| **B** — a user who can legitimately play | all credentials needed to play | receives the key normally → can decrypt | **not excluded** |

Blocking adversary A is **link protection**, and blocking adversary B is **content protection.** AES-128 does only
the former. And this is not because the cipher is weak — no known attack breaks AES-128 itself. **There is no need
to break it. Because the key is distributed.**

### 25.2.4 So this is not a failure of the cipher

Write the same fact split into three layers and the misunderstanding vanishes.

| Layer | State |
|---|---|
| the crypto algorithm (AES-128-CBC) | sound. not this chapter's point |
| the key's secrecy | per Kerckhoffs's principle, all of security hangs here |
| **the key-distribution policy** | **distributes to every legitimate requester** ← here is the point |

Without changing the third line, raise the first line to AES-256 and nothing changes. **The success or failure of
protection is decided not by the algorithm but by the distribution policy.**

---

## 25.3 The code — the line this repository drew

### 25.3.1 A one-line boundary

The scope of streams this repository handles is inside the `Key` dataclass.

```python
# playlist.py:49-64
class Key:
    """#EXT-X-KEY — the decryption info applied to subsequent segments."""

    method: str  # NONE | AES-128 | SAMPLE-AES
    uri: str | None = None
    iv: bytes | None = None
    keyformat: str = "identity"

    @property
    def is_encrypted(self) -> bool:
        return self.method != "NONE"

    @property
    def is_supported(self) -> bool:
        # SAMPLE-AES is per-frame partial encryption so whole-segment decryption is impossible.
        return self.method in ("NONE", "AES-128") and self.keyformat == "identity"
```

The two conditions in the last line differ in nature.

| Condition | What it filters | Reason |
|---|---|---|
| `method in ("NONE", "AES-128")` | SAMPLE-AES | **implementability** — being partial encryption, whole-segment decryption does not hold (Chapter 26) |
| `keyformat == "identity"` | Widevine · FairPlay · PlayReady | **scope declaration** — from here on it is DRM and this tool does not handle it |

The `KEYFORMAT` attribute tells **what the URI returns.** RFC 8216's default value and the only standard value is
`identity`, and its meaning is "the URI returns the key itself." If a different value comes, that URI points not
at a key but at **a particular DRM's license-request target.** The parser transcribed the spec's default as-is.

```python
# playlist.py:311-316
            cur_key = Key(
                method=method,
                uri=_absolute(base_url, a.get("URI")),
                iv=bytes.fromhex(iv_hex[2:]) if iv_hex.lower().startswith("0x") else None,
                keyformat=a.get("KEYFORMAT", "identity"),
            )
```

That is, the one condition `keyformat == "identity"` is the code expression of the sentence **"only the case where
the key comes in plaintext."** Chapter 25's subject is compressed into one conditional expression.

### 25.3.2 Measured — what passes and what catches

The result of making a `Key` directly and confirming the two properties.

| METHOD | KEYFORMAT | `is_encrypted` | `is_supported` | This tool's handling |
|---|---|---|---|---|
| `NONE` | `identity` | `False` | `True` | plaintext — no decryption |
| `AES-128` | `identity` | `True` | `True` | **decrypts** |
| `SAMPLE-AES` | `identity` | `True` | `False` | reject → delegate to `remux` |
| `AES-128` | `com.apple.streamingkeydelivery` | `True` | `False` | reject |
| `AES-128` | `urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed` | `True` | `False` | reject |

The last two rows are rejected even though METHOD is `AES-128`. **Even if the crypto algorithm is the same, if the
way the key comes differs it is a different system** — `KEYFORMAT` is the only field telling that difference.

The rejection happens at two spots. Once at the mode-decision stage,

```python
# cli.py:395-398
    unsupported = [s for s in pl.segments if s.key and s.key.is_encrypted and not s.key.is_supported]
    if unsupported:
        _eprint("  · SAMPLE-AES etc. cannot be decrypted segment-by-segment → switching to remux mode")
        return "remux"
```

and once more at the decryption entry ([`decrypt.py:36-40`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L36-L40)). The second is for when the first was bypassed (when
the user specified `--mode segments` directly), and it guides the alternative as a sentence together with a
`NotImplementedError`. **Draw the boundary in code, not a document, and it remains in the next commit too.**

### 25.3.3 The code that fetches the key is itself a statement of the threat model

```python
# decrypt.py:14-31
class KeyCache:
    """Caches so as not to re-fetch the same key URI per segment."""

    def __init__(self, fetcher: Fetcher) -> None:
        self._fetcher = fetcher
        self._cache: dict[str, bytes] = {}

    def material(self, key: Key) -> bytes:
        if not key.uri:
            raise ValueError("EXT-X-KEY has no URI")
        if key.uri not in self._cache:
            r = self._fetcher.get(key.uri)
            if not r.ok:
                raise RuntimeError(f"key request failed: {key.uri}\n  {r.error}")
            if len(r.body) != 16:
                raise ValueError(f"the AES-128 key length is not 16 bytes: {len(r.body)}")
            self._cache[key.uri] = r.body
        return self._cache[key.uri]
```

These 18 lines confirm §25.2's claim in code. There are four things to read.

**① Getting the key is just an HTTP GET.** `self._fetcher.get(key.uri)` — it uses the **same `Fetcher` object** as
when receiving segments. Same headers, same cookies, same Referer, same retry policy (injected as
`KeyCache(fetcher)` at [`cli.py:436`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L436)). One structural fact follows here — **the key channel's access control is the
same as the segment channel's access control.** If you can receive segments you can receive the key, no more and
no less. There is no place for more than link protection to hold.

**② The 16-byte check pulls the error up.** A key URI too, like any other URL, can return an HTML error page as 200
on token expiry (that `200 + text/html` seen in Chapters 5·14). That body is not 16 bytes. What happens without
this check — **the error page's body is passed straight through as the AES key.** Then the failure blows up as
`ValueError: Invalid key size` from the crypto library inside `KeyCache.decrypt` (measured). The failure's cause is
the key request but the symptom is stamped at the decryption layer. One line of length check blocks that
misdiagnosis.

**③ The cache is both performance and a threat-model choice.** The plaintext key stays in process memory until the
run ends. In this tool's threat model it is not a problem — an actor who can read this process's memory can already
read the decrypted segments and the output file too. **The same decision becomes a defect immediately in a DRM
client** (§25.5). It is the spot where the same code's evaluation inverts by threat model, the same structure as
"code that becomes a vulnerability depending on the role" seen in Chapter 24.

**④ If there is no key it ends in failure.** It rises via `raise`. There is no path that quietly stores the
ciphertext as-is and reports success. It is the minimum line a verification tool must keep.

### 25.3.4 By what do you know decryption actually happened

Decryption always "succeeds." Run CBC decryption with a wrong key and no exception arises and a byte string comes
out. As seen in Chapter 24, this repository does not throw an exception even if the padding is broken
([`decrypt.py:50-58`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L50-L58)). Then by what do you judge success.

The answer is in the order.

```python
# cli.py:457-459
        if seg.key and seg.key.is_encrypted:
            data = keys.decrypt(data, seg.key, seg.seq)
        kind = sniff(data)
```

**Decryption first, determination later.** Invert this order and every segment of an encrypted stream falls to
`unknown` and it all FAILs — that the `sniff()` result of an encrypted segment was `unknown` in §25.1 is the
evidence. Conversely, with the order right, `sniff()` becomes the **verdict of whether decryption succeeded.** If
the key was wrong the result does not start with `0x47`.

The second confirmation comes at the bit level. The MPEG-TS header's scrambling-control field.

```python
# tsanalyze.py:101-102
        if (pkt[3] >> 6) & 0x03:
            rep.scrambled_packets += 1
```

A packet with this value nonzero is **a packet not yet decrypted.** The report raises this unconditionally to FAIL
([`report.py:241-245`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L241-L245)). If this counter is nonzero even after segment-unit decryption finishes, it means the key was
wrong or it is SAMPLE-AES.

> **Summary** — decryption's success is not told by the decryption function. It can be known only by **whether the
> decryption result is a spec-conforming container.** The crypto layer cannot prove its own success by itself.

---

## 25.4 So what does it protect — link protection is real

Here we must be honest in the opposite direction. "Not DRM" does not mean "useless."

### 25.4.1 The threat model of link protection

> **Term** — **link protection**: protection that keeps a third party who obtained **only the address** of a
> resource on the transport path from using that resource. The legitimate recipient is not a target of exclusion.

Fill the four items and it becomes this.

| Item | Content |
|---|---|
| **asset** | the segment byte string |
| **adversary** | a third party who obtained the segment URL — hotlinking, log·Referer leak, public directory index, intermediate cache |
| **adversary's capability** | can send a GET request to an arbitrary URL |
| **trust assumption** | **the key URI has a different (or at least valid) access control from the segments** |
| **holding condition** | if the above assumption is true, the adversary obtains only ciphertext |

What you lose when what is leaked is this protection's real worth.

| What leaked | No encryption | With AES-128 |
|---|---|---|
| one segment URL | can play that piece | a meaningless byte string |
| a segment file copy | can play | impossible without the key |
| a response body left in an intermediate cache·proxy | the content is exposed | only ciphertext remains |
| the whole media playlist | can receive the full episode | **the key URI leaks together** — the key path's control is the only defense line |

The third row is the practical gain. **Segments can be cacheable while the key is designed not to be.** However and
wherever the segments are cached, no plaintext remains, and the control point gathers into one key URI. It is a
structure that **folds** distributed resources' access control **into one point**, and this is a practical
simplification by design.

### 25.4.2 And the common way that assumption breaks

Look again at §25.4.1's trust-assumption line. If that line is false, what remains is only CPU usage.

The stream made in §25.1 is exactly that state. `URI="enc.key"` is in the same directory as the segments, and the
same static file server hands it down under the same conditions. **A requester who cannot get the key cannot get
the segments either.** In this configuration AES-128 excludes **not a single adversary.**

This is not a defect of the test stream — the test's purpose is to verify the decryption path so this placement is
right (`tests/run.sh:174` fixes an `AES128-decrypt` PASS with this stream). The problem is **when the same placement
goes out as-is in an operational environment.** Since the default usage of `-hls_key_info_file` is a form putting
the key next to the segments, do nothing more and you get that state.

> **What breaks if you do not do this** — do not put a **different** access control from the segments on the key
> URI, and AES-128 encryption excludes not a single adversary while incurring only the encoding cost and the
> decryption cost. Not even link protection holds.

### 25.4.3 When it overlaps with a signed URL

If the signed URL seen in Chapter 11 (`?md5=…&expires=…`) is on the segments, link protection is already done by
that layer. Overlay AES-128 on top and there are two layers, and you must see that **the two layers' lifetimes
differ.**

| Layer | Expiry | Impact scope on leak |
|---|---|---|
| signed URL | ends at the stated `expires` time | that one URL, until expiry |
| AES-128 key | **has no expiry concept** — valid as long as the key does not change | every segment that key covers, indefinitely |

Do not do key rotation (re-declaring `EXT-X-KEY` mid-stream to change subsequent segments' key) and one key
corresponds to one whole episode permanently. **A signed URL is a time-limiting capability and an AES-128 key is
not.** When using the two layers together the weaker side is usually the latter.

---

## 25.5 Why DRM is a different kind of problem

Here we look at **structure only.** Techniques bypassing an actual DRM system's key handling are not this course's
scope, and this repository has no such code (§25.7).

### 25.5.1 Three structural additions

> **Term** — **Trusted Execution Environment (TEE)**: an execution region separated from the main OS, where
> hardware enforces that its memory and code cannot be accessed even with OS privilege.

> **Term** — **license**: a message holding the content key and usage rules (period·concurrent-play count·
> resolution cap, etc.) together, encrypted so that **only a particular device** can open it.

> **Term** — **output protection**: control over the path by which the decrypted signal leaves the device. It is
> done at the level of the display-connection spec.

These three are the whole structural difference dividing AES-128 and DRM.

![What changes is not the cipher but the location of the trust assumption](/images/lecture/hls-recon/25-trust-boundary-location.svg)

*Figure 25-2 — the location of the trust assumption: HLS AES-128 and the general DRM structure*

Contrast in a table and it is the following.

| Item | HLS AES-128 (`KEYFORMAT=identity`) | General DRM structure |
|---|---|---|
| Key-delivery form | plaintext 16 bytes, ordinary HTTP GET | a license encrypted with a per-device key |
| Who can see the key | the application — and its user | only inside the TEE |
| Policy judgment | none (the access control in front of the key URI is all) | the license server, **per request** |
| Decryption-execution location | general-purpose CPU, process memory | the secure video path |
| After decryption | no control | rules continue up to output protection |
| **Basis of security** | that the server can authenticate the requester | **the integrity of the device hardware** |

### 25.5.2 DRM too does not remove §25.2.3's proposition

An important point. DRM does **not refute** "if you can play you can obtain the key." **It only moves the actor
obtaining the key from the user to the hardware.**

| | AES-128 | DRM |
|---|---|---|
| The decrypting actor | software the user controls | hardware the user does not control |
| The basis for trusting that actor | none | the hardware manufacturing·certification system |
| If the trust breaks | — | protection collapses per that device·model |

So DRM's security is not a cryptographic proposition but a **hardware trust assumption**, and an assumption is a
verification target, not an axiom. In fact cases of this assumption breaking have been reported repeatedly, and
each time the response was an **operational measure** like device retirement·a revocation list — not changing the
cipher. **The concrete techniques are not covered by this course.**

Reduce it to one sentence and it is this.

> **AES-128 ends the trust boundary at the server, and DRM extends it to the user device's hardware. By what the
> inside of the extended boundary is guaranteed is the whole problem of the field called DRM.**

---

## 25.6 Generalization — protection and friction

### 25.6.1 Definition

> **Term** — **friction**: a measure that raises the attack cost but does not exclude the entire adversary set. It
> filters out only some.

The difference between protection and friction is not strength but **whether it covers the whole adversary set.**

| | Protection | Friction |
|---|---|---|
| Adversary set | excludes all | excludes only some |
| Failure mode | when pierced, that fact becomes an incident | pierced and it is normal operation |
| Danger | none (as long as the assumption is true) | **being accounted as protection** |

This does not mean friction is worthless. What is worthless is **calling friction protection.** The moment you
call it that, the organization puts that item on the control list and stacks other decisions on top of it.

> **A protection that does not set from whom it protects what is not a protection but friction.**

### 25.6.2 Where the same structure appears

Most of the chapters this course has already passed through were of the same form.

| Measure | Adversary it actually excludes | Adversary it fails to exclude | Commonly attached name | Chapter |
|---|---|---|---|---|
| HLS AES-128 | a third party who only picked up the URL | every user who can play | "content protection" | 25 |
| extension·MIME filter | a tool seeing only the string | a tool seeing the payload | "blocking" | 14 |
| `Referer` check | browser-via hotlinking | a client writing headers directly | "domain control" | 9 |
| packed JS obfuscation | someone skimming | someone attaching a parser | "code protection" | 13 |
| client-side input validation | a user making a mistake | someone crafting the request directly | "validation" | — |
| an unguessable "hidden" URL | someone sweeping the listing | everyone who knows the URL (log·Referer·cache) | "private" | — |

The commonality is that each row's right two columns are off. And the off-ness always went unrevealed **because
the threat model was not written.** Fill the four items and the third column reveals itself automatically —
because the trust-assumption cell is empty or filled with "the adversary would not bother going that far."

### 25.6.3 The discriminating questions

When you receive a claim, what to ask is not the algorithm.

| To ask | If there is no answer |
|---|---|
| what is the asset | success cannot be defined |
| who is the adversary | any measure is justified and nothing is verified |
| what can the adversary do | the measure is designed underestimating the capability |
| **what is assumed the adversary cannot do** | **empty here means it is friction** |
| what remains if that assumption breaks | failure passes quietly |

The fourth question is the discriminant. HLS AES-128's answer is "**cannot pass the key URI's access control**",
and link protection holds only in a placement where that is true (§25.4.2). If the answer is "would not go find and
read the decryption code," that is obfuscation (Chapter 13), and if the answer is "would not forge the header,"
that is a `Referer` check (Chapter 9).

---

## 25.7 Security — the designer's·defender's view

### 25.7.1 For the designer

| Role | What to do |
|---|---|
| **delivery designer** | put a **different** access control on the key URI from the segments. put it on the same path·same conditions and the encryption excludes no one. and write **in one line in the doc** the adversary this encryption excludes — if you cannot write it, the design is not yet done |
| **security reviewer** | do not accept "it is AES-128 encrypted" as a control item. the one question to ask — **"to whom is the key distributed, and what controls that distribution"** |
| **auditor** | classify a protection whose four threat-model items are not documented not as a verification target but as an **unfinished design.** a claim that cannot be measured cannot be passed either (the same principle as Chapter 15 §15.6) |
| **tool implementer** | draw the support scope in code. reject **at parse time**, like `is_supported`, and no path afterward lets that stream flow in. a boundary written only in a doc vanishes in the next commit |
| **operator** | set a key-rotation period. without setting it, one key corresponds to a whole content indefinitely, and on leak there is no means of retirement (§25.4.3) |

### 25.7.2 The boundary this repository drew

`README.md`'s first notice holds this chapter's conclusion as-is.

```
# README.md:5-13
> **Scope of use**
>
> Use only on streams you have access to. This tool is for delivery-integrity verification,
> and using it for the acquisition·redistribution of unauthorized content is the user's responsibility.
>
> DRM is not covered. Streams protected by Widevine·FairPlay·PlayReady·SAMPLE-AES are rejected
> at the code level (`playlist.py` — only AES-128 with KEYFORMAT=identity is processed).
> RFC 8216 §4.3.2.4's AES-128 is a link-protection level handing down a plaintext key over a URI, not DRM.
```

The two paragraphs differ in nature.

| Paragraph | Nature | Backed by what |
|---|---|---|
| First — "only on streams you have access to" | **usage norm** | code cannot enforce it. the user keeps it |
| Second — "DRM rejected at the code level" | **technical fact** | [`playlist.py:64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L64) enforces it |

That the second paragraph is a verifiable claim matters. This notice is not a declaration "we will not" but a
**statement "we made it so we cannot"**, and it is confirmed by reading `is_supported`. And this chapter's §25.2
explains why that rejection is not a lack of a feature but a **scope definition** — to support DRM means to
implement a DRM client, and that is a different job from what this tool does (delivery-integrity verification).

The course's boundary is in the same place. This chapter **explains with the threat model why AES-128 is not
content protection**, but it does not cover procedures bypassing an actual DRM's key handling or techniques
targeting a particular service. Curriculum §0.1 drew the same line, and the fact that this repository has no such
code backs that line.

### 25.7.3 What the defender actually gains

What this chapter's content gives the defense side is three.

1. **Grading claims** — "encrypted" is not a control but a factual description. To count it as a control, the four
   threat-model items must follow.
2. **Locating the control point** — the moment you use AES-128, the real control point moves from the segments to
   **one key URI.** Concentrate monitoring·logging·blocking on that point. Conversely, neglect that point and all
   the rest is meaningless.
3. **The observability of failure** — a key-request failure must appear with a different symptom from a segment
   failure. `KeyCache.material`'s 16-byte check (§25.3.3 ②) makes that distinction on the client side. On the
   server side too, the key URI's 4xx rate is a value to view separately from the segments'.

---

## 25.8 Limits and open questions

Written honestly.

- **This chapter's core proposition is by definition, not measurement.** "playable ⇒ can obtain the key" is a
  logical consequence following from the definition of `KEYFORMAT=identity`, not a result measured at a particular
  service. What was measured is only §25.1's local reproduction (a plaintext 16-byte key file, the `sniff()`
  result of an encrypted segment) and §25.3.2's `is_supported` verdict table.
- **The DRM structure narrative is a generalization at the public-spec level.** This repository has no DRM code so
  §25.5 is not backed by code anchors. The actual implementation differences of Widevine·FairPlay·PlayReady each
  were not confirmed, and there is no basis inside this repository to assert that the three systems all have
  §25.5.1's three elements in the same way.
- **The access control in front of the key URI is not observed from the client.** What `KeyCache.material` knows is
  only "a 200 came and the body was 16 bytes." Whether a different control from the segments was on that path, or
  whether there was any control at all, is revealed indirectly **only on failure** (403, etc.). So §25.4.2's
  "configuration where the assumption is broken" cannot be diagnosed with this tool.
- **The key cache's memory lifetime was not measured.** `KeyCache._cache` holds the plaintext key until the run
  ends, and in Python there is no sure way to wipe that memory (`bytes` is immutable and the GC timing cannot be
  controlled). It was **judged** not a problem in this tool's threat model, not measured.
- **The reproduction playlist's `IV` value was not explained.** In §25.1 ffmpeg 8.1.1 put `IV=0x000…0` into the
  generated playlist, and why that value came out given a 2-line keyinfo was not confirmed. The IV derivation rule
  itself is Chapter 23's subject and is unrelated to this chapter's thesis (key distribution).
- **Key rotation's actual effect was not verified in this repository.** The parser handles a mid-stream `EXT-X-KEY`
  re-declaration ([`playlist.py:307-316`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L307-L316)), but a stream with rotation is not in the regression test.

---

## 25.9 Summary

1. HLS's AES-128 (`KEYFORMAT=identity`) **hands down a plaintext 16-byte key over a URI as-is.** Measured, the key
   file is exactly 16 bytes with no envelope and no signature.
2. So **a client that can play can, by definition, obtain the key.** This is not a failure of the cipher but a
   consequence of the **key-distribution policy.** Switching to AES-256 changes nothing.
3. **Kerckhoffs's principle is fully kept** — the algorithm is public in RFC 8216 §4.3.2.4 and all of security
   hangs on the key. The problem is that that key is distributed to every legitimate requester.
4. So **link protection holds and content protection does not.** Link protection has real worth — you cannot play
   from a segment URL·copy·cache remnant alone, and the control point gathers into one key URI. But **put the key
   URI on the same conditions as the segments and it excludes no one.**
5. **DRM is a different kind of problem.** Not the cipher but the location of the trust assumption differs — the key
   stays inside the TEE, the license server judges policy per request, and control continues up to output. DRM too
   does not remove §25.2.3's proposition; it only moves the key-obtaining actor from the user to the hardware.
6. This repository draws that boundary **in code** — the one condition `keyformat == "identity"` in `is_supported`
   is the code expression of "only the case where the key comes in plaintext," and everything else is rejected at
   parse time ([`playlist.py:64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L64), [`cli.py:395-398`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L395-L398), [`decrypt.py:36-40`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L36-L40)).
7. Generalized it is this — **a protection that does not set from whom it protects what is not a protection but
   friction.** It is not that friction is worthless but that accounting friction as protection is dangerous. The
   discriminant is one: **"what is assumed the adversary cannot do."** If that cell is empty, it is friction.

---

**Next chapter** — this chapter covered only the `keyformat` side of `is_supported`'s two conditions. The remaining
condition `method in ("NONE", "AES-128")` is a problem not of the threat model but of **implementability.**
SAMPLE-AES encrypts only part of the inside of a frame, not the whole segment, so this tool's very processing
structure "receive a segment and decrypt it whole" does not hold. Chapter 26 covers **how the encryption
granularity determines the shape of the processing pipeline.**
