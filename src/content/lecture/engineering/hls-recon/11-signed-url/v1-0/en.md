---
title: "Signed URLs"
description: "The design of a time-limited capability"
date: 2026-06-13
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-11-signed-url.svg
---
## 11.0 What this chapter answers

Chapter 10 ended by saying "using Referer as authorization" must be fixed. What replaces that place is this
chapter's subject.

1. What is `?md5=<signature>&expires=<unix>` — what **kind of access control** is this?
2. The moment the expiry time is embedded in the URL, **what constraint arises in the client implementation?**
3. What does the expiry time trade off against what?
4. **What must the signature cover** — what is good to include, and what cuts off normal users if included?
5. If you use MD5, what collapses, and why must it be **HMAC** rather than "a hash with the key attached"?
6. **Does expiry block replay?** If it cannot, what more must the defender do?

The sixth is this chapter's peak. Write the conclusion in advance — **expiry does not block replay. It only
narrows the window in which replay is possible.** And every means that actually closes that window collides
head-on with the very reason signed URLs were chosen.

---

## 11.1 The problem — gather 27 episodes in advance and the later ones necessarily break

A single-episode download is done when a person fetches the `.m3u8` address from devtools and hands it over.
For a whole series that way does not hold. This repository's module docstring wrote the reason down in two
parts.

```python
# series.py:1-11
"""Series-page resolution — episode-list discovery and per-episode playback-source resolution.

A single-episode download is done when a person fetches the playback source (m3u8) from devtools and
hands it over. A whole series does not hold that way. The CDN path per episode is an opaque hash so you
cannot derive episode 2's address from episode 1's, and an issued link has an expiry time embedded.

    …/cdn/hls/<per-episode hash>/master.m3u8?md5=<signature>&expires=<unix>

So gathering 27 episodes' addresses in advance and receiving them in order necessarily breaks on the later
episodes. This module secures **only the episode list first, and resolves the playback source just before
receiving that episode** (late resolution). That is why `resolve()` fetches a fresh link each time.
```

The two reasons differ in nature. You must not read them mixed.

| Reason | Nature | What it blocks |
|---|---|---|
| the per-episode CDN path is an **opaque hash** | a structural problem — unpredictability | **deriving** episode 2's address from episode 1's |
| an issued link has an **expiry time** embedded | a time problem — validity period | **gathering** addresses in advance |

The former is "the address cannot be computed," and the latter is "even if you compute and get it in hand it
dies as time passes." With only the former, "request 27 times to make a list and receive in order" is the
answer. Because the latter exists, that answer collapses.

The same decision is written in the user docs on the same basis too — meaning this constraint is not an
internal implementation detail but **a fact at the level that must explain the tool's behavior.**

> `README.md:142-150`
>
> ### Why not gather in advance
>
> The per-episode playback address is issued **just before receiving.** Two reasons overlap.
>
> - The per-episode CDN path is an opaque hash so you cannot derive episode 2 from episode 1.
> - An issued address has an expiry time embedded (`…/master.m3u8?md5=…&expires=…`).
>
> So gathering 27 episodes' addresses first and receiving in order necessarily breaks by expiry on the later
> episodes. Secure only the list first and resolve the playback address on the fly.

### 11.1.1 When it breaks — arithmetic

Suppose episode `k`'s URLs were all issued at time 0. If receiving one episode takes `T`, the time episode
`k`'s URL is **first used** is `(k−1)·T`. If the issued token's lifetime is `E`, the condition for all 27
episodes to succeed is one.

```
26 · T  <  E
```

Plug in numbers and it becomes this.

| Time per episode `T` | Time the last episode is used `26T` | Expiry `E` needed then |
|---|---|---|
| 2 min | 52 min | 1 hour or more |
| 5 min | 2 hr 10 min | 2.5 hours or more |
| 10 min | 4 hr 20 min | 5 hours or more |
| 30 min | 13 hr | 13 hours or more |

> **This table is arithmetic, not a measurement.** `T` varies by line·resolution, and `E` by the deliverer's
> policy. This repository does not even parse the `expires` value so it does not know the actual `E` (§11.10).
> What the table means to show is not specific numbers but the structure that **if `E` is smaller than the
> whole job's duration, it necessarily breaks.**

### 11.1.2 What you see when it breaks

The nasty part of this failure is that **the symptom does not point at the cause.** Episodes 1 through 11 are
received fine and it suddenly fails from episode 12. What appears on screen is `403` or `404`, or a `200` with
an HTML error page. None of them says "expiry."

So on first meeting this phenomenon you come to suspect IP blocking·request-rate limiting·Referer verification
first. All are factors that worsen as time passes, so the symptom looks the same. To suspect expiry you must
**already know that an expiry time is written inside the URL.**

---

## 11.2 The principle — the URL is itself the authorization token

Call `?md5=<signature>&expires=<unix>` an "authentication parameter" and it is half right. There is a precise
name.

> **Term** — **capability-based access control**: a way of judging access permission not by "who is the
> requesting subject" but by "what token the request brought." A capability **describes itself** — the target
> resource and the allowed conditions — and can be exercised by mere possession.

> **Term** — **bearer token**: a token that requires no qualification other than the fact of possession. The
> server cannot distinguish a thief from the original holder. A signed URL's whole URL string is a bearer
> token.

### 11.2.1 Contrast with identity-based

![The contrast between identity-based access control and capability-based access control](/images/lecture/hls-recon/11-capability-vs-identity.svg)

*Figure 11-1 — where to put the permission — a token that points at a subject, and a token that is the
permission itself*

A cookie **points at a subject.** The server looks up the session store with that value to judge "does this
person have permission to this resource." Since the basis for judgment is inside the server, if the server
changes its mind it is reflected immediately — delete the session and it is a refusal from that moment.

A signed URL **is the permission itself.** There is nothing for the server to look up. Recompute the signature
with the secret key, see if it matches, and it is done. And that judgment cannot be undone — **the server has
no way to recall a URL that already went out.**

### 11.2.2 The four properties of a capability

| Property | Content | Consequence |
|---|---|---|
| **self-describing** | the target path and validity period are written in the token | there is nothing for the server to look up |
| **stateless verification** | recompute the signature with the secret key and compare, done | thousands of CDN edges judge with no central lookup |
| **transferable** | being just a string, it is freely copied·shared | paste the link and the permission goes along |
| **irrevocable** | after issuance the server has no means to undo it | **the only means of recall is expiry** |

The fourth row is the axis of this whole chapter. Expiry is not a convenience feature but **a component that
lets the irrevocable property be endured.** A signed URL with no expiry is "a permanently valid bearer key,"
and once leaked the only response left is secret-key rotation — that is, simultaneous invalidation of all
issued URLs.

### 11.2.3 Why does a CDN choose this way

HTTP's statelessness seen in Chapter 4 returns here as a design requirement. A CDN edge node is meaningful
only when it responds close to the user. Ask the origin server's session store per request and that round trip
dominates the latency, and **the very reason to have a CDN disappears.**

So the edge must be able to judge in place with only "one secret key." What satisfies that requirement is
capability-based, and **irrevocability is the price paid to satisfy that requirement.** Not a design mistake
but a consequence of the requirement.

At the same time capability-based has a virtue identity-based lacks. One token opens **one resource, one
period** — a good fit for the least-privilege principle. A cookie, by contrast, the browser attaches
automatically to **every** request going to that origin, so permissions the request did not point at come
along. That automaticity is the premise of CSRF (cross-site request forgery), and where and how credentials
remain is Chapter 12's subject.

---

## 11.3 The principle — what does the expiry time trade off against what?

> **Term** — **Unix time**: a value counting the seconds elapsed since 1970-01-01 00:00:00 UTC as an integer.
> With no timezone notation, different machines call the same instant by the same number. The integer after
> `expires=` is this.

The expiry time is carried in the URL **in plaintext.** This is not a leak but design — the client must know
the time remaining to decide when to renew. The signature covers that value, so reading is free but changing
is detected (§11.4).

### 11.3.1 The first-order trade — leak window vs availability

| If expiry is **short** | If expiry is **long** |
|---|---|
| a leaked URL's validity is short | a leaked URL lives long |
| normal users are cut off too — resume after pause, slow line, long download | normal users are not cut off |
| reissue requests are frequent so origin-server load rises | reissue is rare |
| renewal logic becomes **mandatory** on the client | the client is simple |
| sensitive to clock error | error is buried |

Up to here is the commonly known trade. But the moment you set the expiry time, two more things move together,
and they are not well written in security documents.

### 11.3.2 Second-order effect — the cache key

> **Term** — **cache key**: the identifier a CDN uses to find a cached response. The default is usually "host
> + path + query string."

If the signature is in the query string and differs per user, under the default cache key **the same segment
piles up as separate entries by the number of users and the hit rate converges to 0.** So real CDN configs
exclude token parameters from the cache key. If that config is missing, the shorter you set expiry the more
requests go to the origin server — **one security setting changes the cost structure.**

And this exclusion config itself makes the next trap. Exclude the token from the cache key and if there is
even one path where **the response content differs by the token**, one user's response goes to another.
Cache-key design is part of access-control design.

### 11.3.3 Second-order effect — clock skew

> **Term** — **clock skew**: the amount by which different machines' clocks are misaligned.

Expiry is judged **not at issuance time but at use time, by the verifying machine's clock.** If the issuing
server's and the edge node's clocks are misaligned, a just-issued URL can already be judged expired. So real
implementations put a tolerance (skew tolerance) of a few seconds to a few minutes.

That tolerance is directly an extension of the validity period. **Set expiry to 60 seconds and skew tolerance
to 300 seconds and the actual lifetime is 360 seconds.** Even if the security review says "token lifetime 60
seconds," the actual exposure window can be sixfold, and that fact is usually in a different config file
managed by a different team.

---

## 11.4 The principle — what must the signature cover?

> **Term** — **signed payload**, or **canonical string**: the byte sequence entered as the hash input when
> computing the signature. The issuer and the verifier must make **the same string by the same rule** for the
> signature to match.

This section's proposition is one.

> **Only a value that went into the signed payload has its forgery detected. A value not in it is freely
> changed.**

That is, signed-payload design is itself a declaration of the threat model. If you do not know what was put
in, you do not know what is guaranteed.

### 11.4.1 Gains and losses per candidate

| Value put in the signature | What is gained | What is lost · false positive |
|---|---|---|
| **path** | cannot reuse the token on a different resource | none — **minimum requirement** |
| **expires** | the expiry time itself is not forged | none — **minimum requirement** |
| **HTTP method** | cannot PUT·DELETE with a GET token | none. mandatory on a write API |
| **Host** | cannot reuse the token on another domain | management burden on multi-domain·CNAME configs |
| **all query parameters** | cannot get a different response by parameter tampering | the client cannot attach even a tracking parameter |
| **client IP** | a leaked URL does not open on a different line | ★ **normal users are cut off** on mobile↔Wi-Fi switch, CGNAT, IPv6 address rotation |
| **User-Agent** | a link picked in a browser does not open in a tool | ★ if the UA changes on a browser auto-update, it cuts off mid-play. easy to forge so the gain is small too |
| **session·account ID** | account-level tracking·recall becomes possible | a separate credential is needed too — statelessness is partly broken |
| **nonce** | one-time-use becomes possible | ★ **server-side state is needed** — stateless verification collapses (§11.9) |

### 11.4.2 What IP binding actually buys

Put the IP in the signed payload and "just copying the URL and opening it elsewhere" is blocked. Up to here is
correct. But the value is cut from two directions.

**The false-positive side.** A mobile device's public IP changes as it goes between Wi-Fi and cellular. Change
it mid-play and it fails from the next segment. To the user it looks like "the video suddenly stopped," and
the log leaves only a `403`. In IPv6 the address changes periodically by privacy extension, so the same thing
happens even within Wi-Fi — so real implementations sometimes group by the `/64` prefix rather than the whole
address.

**The defense side.** Behind carrier-grade NAT thousands of subscribers share one public IP. IP binding
**blocks nothing against another user behind that NAT.**

That is, IP binding makes false positives while being partial in defense too. Group by prefix to reduce false
positives and defense goes down further. **Precision and false-positive rate are the two ends of the same
knob**, and turn it either way and the other side worsens.

### 11.4.3 The exact size of what User-Agent binding blocks

UA is the same layer as the Referer seen in Chapter 9, i.e., **a client self-reported value.** Forging it
costs nothing. So why put it in?

Look at the paths the token leaks and the answer comes. Where the URL leaks (§11.9), UA usually remains too —
the access log, error reports, proxy records. But **the path where only the URL is copied and pasted** (a link
shared in chat, an address-bar copy) does not carry the UA along. Therefore what UA binding actually blocks is
not "moving it to another device" but **"casually copying and pasting just the URL."** The value is there but
small, and must be weighed against the cost of cutting off normal users on every browser update.

### 11.4.4 Normalization — where Chapter 7's problem becomes an access-control problem

The signed payload is a byte sequence, so even for the same URL there **must be agreement on which string to
make.**

| What must be decided | If it goes off |
|---|---|
| sign the path percent-encoded or decoded | a normal URL is rejected on a path with Korean·space |
| sort the query parameters or leave them in arrival order | the signature goes off just by changing parameter order |
| how to handle host case·default port | the signature differs on the same resource |
| fold path segments like `//`·`.`·`..` | ★ **two different URLs normalize to the same string** |

The first three cause availability incidents — a normal request is rejected. The last one causes a security
incident. Fold two URLs pointing at different resources into the same signed payload and **one token opens two
resources.** The non-idempotency of `%20` and `%2520` seen in Chapter 7 returns here in the form "when the
normalization time and the verification time are misaligned, that itself is a vulnerability."

The principle is the same as Chapter 7 — **normalize once at the boundary, and the signing side and the
verifying side use the same code.**

---

## 11.5 The principle — using MD5, and why it must be HMAC

First, make this section's boundary clear.

> This repository **neither makes nor verifies** the signature. What was observed is only the fact that the
> parameter name is `md5`, and a name does not guarantee the algorithm or the construction. The discussion
> below is a **design discussion of "if it is this construction, what collapses,"** not a diagnosis of a
> specific service, and covers no procedure for forging any signature.

### 11.5.1 Terms

> **Term** — **MAC (Message Authentication Code)**: a short tag that only a party knowing the secret key can
> make and a party knowing the same key can verify. It guarantees the message's **integrity** and **origin**
> together. It is what must go in the `md5=` slot of a signed URL.

> **Term** — **Merkle–Damgård construction**: a hash construction that splits the message into fixed-size
> blocks, applies a compression function repeatedly, and **outputs the last internal state as is.** MD5·SHA-1·
> SHA-2 are this structure. Since the output is the internal state, **you can continue the computation.**

> **Term** — **length extension attack**: an attack exploiting the property that knowing only `H(M)` and
> `len(M)` lets you compute `H(M ‖ pad ‖ M′)` without knowing `M`'s content. It holds on Merkle–Damgård-
> construction hashes.

> **Term** — **collision resistance**: the property that it is hard to find two different inputs with the same
> hash value. It has been practically broken for MD5 since 2004.

### 11.5.2 Three constructions

![A comparison of three signature constructions made with the same hash function](/images/lecture/hls-recon/11-mac-constructions.svg)

*Figure 11-2 — the same hash function, three constructions — on what does the security depend*

**① a hash with the secret prepended — `md5(K ‖ path ‖ expiry)`**

The most natural-looking construction, and the worst. The attacker does not know `K` but gets `H(K ‖ M)` from
one normal link. In Merkle–Damgård that value is **the hash internal state itself**, so continuing the
computation from there you can make `H(K ‖ M ‖ pad ‖ M′)`. **A new signature is made without knowing the key.**

For this to be actually exploited, three conditions must overlap.

| Condition | Content |
|---|---|
| (a) | the signed-payload assembly rule is known, and the key length can be guessed |
| (b) | the appended padding bytes are representable as a URL and pass the server's normalization |
| (c) | the appended tail is a value meaningful to the server (e.g., a later parameter wins) |

Conditional. But **changing the construction is much cheaper than reviewing whether the conditions match each
time.** And a public report of this construction being pierced on a real web API exists (2009, API signature
forgery). This course did not reproduce that report and only cites it.

**② a hash with the secret appended — `md5(path ‖ expiry ‖ K)`**

Length extension is blocked — with the key at the end you cannot append. Instead the security hangs entirely
on **the hash's collision resistance.** Find a pair with `M₁ ≠ M₂` while `H(M₁) = H(M₂)` and the internal
state at that point is the same, so whatever is appended, the result is the same. That is,

```
H(M₁) = H(M₂)   ⟹   H(M₁ ‖ K) = H(M₂ ‖ K)      (without knowing K)
```

MD5's collisions are practically producible. Therefore ② is a construction that does not hold on MD5.

There is one more layer. A collision is useful **when the attacker can choose both messages.** If the signed
payload is purely a server-set path it is hard to exploit, and if it is a construction where a user-uploaded
filename goes into the path it becomes easy. Conditional again — and that is the state named in Chapter 15.
**Being safe because the conditions do not match is not safety but an accidental defense**, and the conditions
change in the next release.

**③ HMAC — `HMAC(K, M) = H( (K ⊕ opad) ‖ H( (K ⊕ ipad) ‖ M ) )`**

The standard construction (RFC 2104). It hashes the inner hash's output again with the key, so length
extension does not hold. More important is on what the security hangs.

> **Term** — **PRF (pseudorandom function)**: a function indistinguishable from a fully random function to an
> observer who does not know the key.

HMAC's security proof depends on **the assumption that the inner compression function is a PRF**, and **does
not require the whole hash's collision resistance.** So even after MD5's collisions were practical, no
practical forgery attack on HMAC-MD5 is known. That said, there is no reason to choose MD5 in a new design —
HMAC gets stronger by swapping the hash for SHA-256 **while keeping the construction as is.**

### 11.5.3 This section's point is not the algorithm

| Question | Answer |
|---|---|
| "You shouldn't use MD5?" | an unanswerable question. **how it is used** is not decided |
| `md5(K‖M)` | collapses by length extension — **collapses the same** even swapping the hash for SHA-256 |
| `md5(M‖K)` | collapses by MD5's collisions — improves by swapping the hash |
| `HMAC-MD5` | no practical forgery is known — still not recommended |
| `HMAC-SHA256` | the current standard answer |

The second row is this section's peak. **A hash with the key attached is not a MAC.** Swap the algorithm for
a strong one and if the construction is wrong it stays wrong. **The construction comes before the algorithm.**

### 11.5.4 The place that leaks even with the right construction chosen

> **Term** — **timing attack**: a side-channel attack that recovers a secret from differences in the time an
> operation took.

Do the signature verification with an ordinary string comparison and it usually **returns at the first
mismatching byte.** Observe that time difference and you can match a byte at a time. So a MAC comparison must
be done as a **constant-time comparison** that takes the same time regardless of length (`hmac.compare_digest`
in Python).

Measuring this difference remotely is hard due to network noise, and the actual attack difficulty depends
greatly on the situation. But **there is no reason to leave a risk removable in one line** is the practical
judgment. Choosing the algorithm and construction correctly and leaking in one comparison line is a common
failure.

### 11.5.5 Expiry is also the upper bound of key rotation

A secret key must be changed someday. But change the key and all URLs signed with it die. A signed-URL system
usually carries a key identifier (key ID) to keep several keys valid at once, leaves the old key for a period,
then discards it.

**What sets the lower bound of that period is the maximum expiry time.** If expiry is 1 hour, the old key
need only be left 1 hour, and if expiry is 7 days, two keys are both valid for 7 days. The decision to set a
long expiry lengthens **not only the leak window but the lower bound of the key-rotation period too.**

---

## 11.6 The code — late resolution

We see in what form the implementation constraint expiry forces remained in this repository.

### 11.6.1 The data structure already states that decision

```python
# series.py:81-87
@dataclass
class Play:
    """One episode's playback info. the signed link expires, so make it just before receiving."""

    playlist_url: str
    name: str  # the filename without the extension — the official name the site set
    referer: str
```

That `Episode` ([`series.py:60-66`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L60-L66)) and `Play` are **split into separate data types** is the crux of the design.

| Data type | What it holds | Lifetime |
|---|---|---|
| `Episode` | episode number·title·**page address** | effectively unlimited — until the site changes its structure |
| `Play` | **signed playback address**·filename·Referer | until expiry |

Had it not been split and `playlist_url` been placed inside one `Episode`, the moment the list is made, 27
signed URLs would have been made together. **The boundary of the data type is the boundary of the lifetime**,
and not putting "what lives long" and "what dies soon" in the same box is what this structure does.

### 11.6.2 The resolution function — at the present moment

```python
# series.py:266-278
def resolve(episode: Episode, fetcher: Fetcher, fallback_width: int = 2) -> Play:
    """Resolve one episode's playback source at the present moment.

    The link has an expiry time embedded, so do not gather in advance — call it just before receiving.
    """
    page_url = episode.page_url
    page = fetcher.get_text(page_url, _from(_origin(page_url) + "/"))
    player = _player_url(page, episode.page_url)
    origin = _origin(player)
    video_hash = _PLAYER_RE.match(player).group("hash")

    # the player HTML holds only settings. the actual playback address is issued by the XHR below.
    settings = unpack(fetcher.get_text(player, _from(page_url)))
```

What to note is the **cost.** One `resolve()` makes at least three round trips — the episode page, the player
page, and the issuing XHR.

```python
# series.py:280-284
    res = fetcher.post(
        f"{origin}/player/index.php?data={video_hash}&do=getVideo",
        {"hash": video_hash, "r": episode.page_url},
        _from(player),
    )
```

```python
# series.py:296-300
    link = data.get("securedLink") or data.get("videoSource") or ""
    if not link:
        raise ValueError(f"no playback address in the response: {episode.title}\n  {body[:200]}")

    return Play(playlist_url=link, name=_name_of(settings, episode, fallback_width), referer=origin + "/")
```

The response field name is `securedLink`. The issuing side too calls it a "secured link."

Late resolution is not free. For 27 episodes these three round trips repeat 27 times. **What expiry demanded
was "resolve late," and the price is an increase in the number of requests.** Chapter 9's constraint that each
stage must carry a different Referer repeats here too ([`series.py:99-109`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L99-L109)).

![A timeline comparison of gathering in advance and late resolution](/images/lecture/hls-recon/11-late-resolution.svg)

*Figure 11-3 — the timeline runs left to right — process 27 episodes in order*

### 11.6.3 The call site — a second gain the order makes

```python
# cli.py:868-870
    for i, ep in enumerate(picked, 1):
        _eprint("\n" + "─" * 72)
        _eprint(f"  [{i}/{len(picked)}] {ep.title}")
```

```python
# cli.py:872-889
        # look at inventory before issuing a playback source — if the episode is already fully received,
        # it ends here and not a single request goes out.
        have = stock.get(ep.number)
        stale = bool(have and not have.ok)
        if have and have.ok and not args.overwrite:
            _eprint(f"  · already have it — skipping ({have.video.name}). to re-receive use --overwrite")
            done.append((ep, "skipped"))
            continue
        if stale and not args.overwrite:
            _eprint(f"  · re-receiving — {have.flaw} ({have.video.name})")

        try:
            play = series.resolve(ep, pages, found.width)
        except (ValueError, RuntimeError) as e:
            _eprint(f"  ✗ playback-source resolution failed — skipping\n    {e}")
            done.append((ep, "resolve-failed"))
            failed += 1
            continue
```

The inventory check (`stock.get`) is **before** `resolve()`. For an episode already fully received, not a
single issuing request goes out. With the gather-in-advance way this saving is impossible — at list-making
time the inventory has not yet been compared.

**A structure forced by expiry incidentally reduced the number of requests.** A case where a constraint
improved the design, a form that appears repeatedly in this repository.

The same principle is written in `--probe-only` too.

```python
# cli.py:846-848
    if args.probe_only:
        # in a series each episode must be issued a playback source separately. do not send 27 issuing
        # requests to a request that only wants to probe — show only up to the list.
```

The fact that issuing is expensive is deciding the feature's boundary. The reason "probe" and "receive" are
split is not performance but the principle **do not make a token unnecessarily.**

The issued `Play` is used immediately in that episode's header config.

```python
# cli.py:905-908
        # use the origin the player told us as the Referer. if the user specified one, leave it.
        ep_headers = dict(given)
        ep_headers.setdefault("Referer", play.referer)
        ep_headers.setdefault("Origin", play.referer.rstrip("/"))
```

```python
# cli.py:915-916
        try:
            rep = _run_one(ep_args, play.playlist_url, out, ep_headers, report_path)
```

That is, the signed URL (a capability) and the Referer (Chapters 9·10's self-report control) are used
**together within the same episode.** The two controls are not exclusive but stacked in layers.

### 11.6.4 Where the wait is placed

```python
# cli.py:933-934
        if args.delay > 0 and i < len(picked):
            time.sleep(args.delay)
```

```python
# cli.py:1108-1113
    grp.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="seconds to wait between episodes (default 1.0) — to avoid being blocked by consecutive requests",
    )
```

This `sleep` is at the **end** of the loop. So the order of one lap processing episode `k` is as follows.

| Order | What it does | The token's age |
|---|---|---|
| 1 | `resolve(k)` — issue the token | 0 |
| 2 | receive·verify episode `k` | 0 → `T` |
| 3 | `sleep(delay)` | episode `k` is already done |
| 4 | to the next lap — `resolve(k+1)` | 0 again |

Because the wait is placed not **after** `resolve()` but **before the next lap**, the issued token does not
age by the wait time. Had the order been reversed (issue → wait → use), the wait seconds would come straight
out of the expiry budget. **Where the same one `sleep` line is placed determines the expiry budget** — a fact
confirmed by reading the code order, and since the expiry value is unknown, how much slack that actually is
cannot be measured with this repository (§11.10).

### 11.6.5 Expiry has no dedicated status code

The form expiry appears as a failure is not one.

| The form expiry appears | What the code sees | Where it is caught |
|---|---|---|
| `403` · `404` | `FetchResult.ok = False`. being 4xx, halt without retry | [`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201) |
| `401` | as above | as above |
| `200` + HTML error page | the leading bytes are `<!DO…` → `sniff()` is `unknown` | [`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37), [`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464) |
| not a single segment arrives | the exit message states expiry as a possibility | [`cli.py:471`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L471) |
| the playlist itself is rejected | the diagnostic message guides expiry as a candidate | [`cli.py:97-100`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L97-L100) |

The third row joins several chapters of this course. [`tsanalyze.py:23`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L23)'s comment points at this situation
directly — "responding with HTTP 200 does not mean media arrived. a CDN with an expired token…". The
**leading-byte determination** seen in Chapter 14 is at once a check that handles a disguised segment normally
and **a check that catches an expiry error page.** The regression test fixed this situation as fault-injection
4 (`tests/run.sh:141` — "reproduce a CDN returning an error page as 200 for an expired token"), and the
verdict-side comment writes the same reason ([`report.py:198`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L198)).

**One check catches two different causes together.** And without that check, an expiry error page is saved as
a segment and "full receipt success" is reported.

### 11.6.6 Retry cannot fix expiry

```python
# fetch.py:199-201
                # 4xx gives the same result on retry (401/403/404 = token expiry·hotlink block)
                if 400 <= e.code < 500 and e.code not in (408, 429):
                    break
```

The comment explicitly cites expiry as the basis for this branch. The principle set in Chapter 10 applies as
is.

> **The condition under which a retry has meaning is not the count but "did the request change."**

Resending an expired signed URL is **the same request.** However much you increase the backoff it does not
improve, and rather the more you increase it the worse — because the more time passes the farther from expiry
it gets. To change, you must **re-resolve.** That is, the correct response to expiry is in the resolution layer,
not the retry layer. This repository did not implement that auto-re-resolution (§11.10).

---

## 11.7 The code — what late resolution leaves

Delay per episode and §11.1's problem disappears. But the expiry problem itself does not disappear. Only the
**granularity** changed.

### 11.7.1 Within one episode it is still a snapshot

Look at the segment-receipt path and the playlist is parsed **once**, all segment URIs come from that snapshot,
and parallel receipt ends in one call.

```python
# cli.py:414
    segs = pl.segments[: args.limit] if args.limit else pl.segments
```

```python
# cli.py:423
    items = [(s.uri, s.byterange) for s in segs]
```

```python
# cli.py:431
    results = fetcher.get_many(items, jobs=args.jobs, on_done=tick)
```

If the segment URLs are also signed and their expiry is shorter than one episode's duration, §11.1's failure
**reproduces as is, shrunk to episode scale** — the front segments come and the rear ones are `403`.

### 11.7.2 Resolution granularity and expiry tolerance

| Resolution granularity | Max time the token ages | Number of requests | This repository |
|---|---|---|---|
| the whole series in advance | `(N−1)·T` | minimal | does not do |
| **just before each episode** | one episode's duration `T` | 3 round trips per episode | **this** |
| on each playlist refresh | the refresh period | 1 round trip per refresh | does not do |
| per segment | one segment's duration | per segment | does not do |

**The finer the granularity the higher the expiry tolerance and the more requests.** This tool stopped at
episode granularity. It is the correct choice at 27-episode scale, but may be insufficient on a delivery with
minute-level expiry.

A live HLS player solves the same problem at a different spot — it re-fetches the media playlist periodically
(Chapter 2's ABR discussion). Then the segment URLs are refreshed to newly signed ones too. This tool, which
receives VOD at once, has no such refresh point structurally.

There is no record of this repository actually experiencing this failure. Recorded as a **possibility read from
the code structure** and marked honestly again in §11.10.

---

## 11.8 Generalization — where a time-limited capability appears

### 11.8.1 The list of the same structure

| Case | The token's form | Rough lifetime | Replay prevention |
|---|---|---|---|
| object-storage presigned URL | signature·expiry in the query string | seconds – days | **none** — expiry only |
| CDN token authentication | signature·expiry in the query or a cookie | minutes – hours | none (optional IP binding) |
| password-reset link | an arbitrary token in the path | minutes – hours | **yes** — the server discards it after one use |
| magic-link login | same | minutes | **yes** |
| OAuth 2.0 authorization code | the code in the redirect query | seconds – minutes | **yes** — one exchange |
| a JWT's `exp` claim | the `Authorization` header | minutes – hours | none — hard to cancel before expiry |
| Kerberos ticket | a protocol message | hours | partial — replay cache |
| the key URI of HLS `EXT-X-KEY` | a URL inside the playlist | session | a separate control (Chapter 25) |

The common structure is three.

1. **Possession = exercise.** Having the token is the permission.
2. **Expiry.** Since it cannot be recalled, it must die on its own.
3. **The presence of replay prevention splits on "does the server intend to keep state."**

Look at the fourth column and a rule appears. The ones that **have** replay prevention (reset link, magic
link, authorization code) are all **low-frequency authentication flows.** The server can pay the cost of
remembering one token. The ones that **lack** it (presigned URL, CDN token, JWT) are all **high-frequency
resource access.** They cannot pay the cost of remembering.

### 11.8.2 The general condition that forces late resolution

> **If the job using a token takes longer than the token's lifetime, the token must be obtained just before
> use.**

This condition appears everywhere, unrelated to streaming.

| Situation | What breaks if obtained in advance |
|---|---|
| receive a large file list all at once with presigned URLs | the rear of the list |
| put temporary credentials in a DB connection pool | connections that sat long |
| a long batch job receives a token only once at start | the batch's latter half |
| put a request object whole, including headers, into a retry queue | a delayed-execution retry |
| store a signed URL in a cache | **everything**, if the hit comes late |

The last row is an especially common trap. **Cache a signed URL and there are two expiries** — the cache's TTL
and the token's lifetime. The effective lifetime is the shorter of the two, but **the cache usually knows only
its own TTL.** Set the cache TTL to 1 hour and the token lifetime to 10 minutes and a cache is made that
faithfully returns a dead token for 50 minutes.

### 11.8.3 The reverse of this principle — do not hold the token long

Late resolution is "obtain late," but the same principle has a pair, **"do not hold it long."** Putting a token
in a log·config file·global variable is artificially extending its lifetime. The token's lifetime is set by the
issuer, but **the number of places the token is alive is set by the holder.** That this repository keeps `Play`
only as a local variable inside the episode loop is the minimum implementation of that principle. Only, give
`--report` and that signed URL remains on disk as the report JSON's `source` ([`report.py:98`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L98), [`cli.py:645`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L645)).

---

## 11.9 Security — replay prevention and the defender's view

### 11.9.1 Expiry does not block replay

> **Term** — **replay attack**: an attack that intercepts a legitimately made request or token and **sends it
> again as is.** Since it does not forge the content, it passes signature verification as is.

Here you must split precisely what the signature guarantees and does not.

| What the signature guarantees | What the signature does **not** guarantee |
|---|---|
| this URL was issued by us | this request is the **first** |
| the signed payload is not forged | the requester is **the person it was issued to** |
| the expiry time was set by us | this URL is used **only once** |

Within the expiry window that URL is valid **any number of times, to anyone.** Expiry only sets the length of
that window. Reduce expiry to 60 seconds and the risk does not disappear but becomes **a 60-second risk.**

### 11.9.2 To actually block replay

| Means | Principle | Price |
|---|---|---|
| one-time nonce + server record | remember a used token and reject the second | ★ **statelessness collapses.** a store shared by all edges is needed |
| use-count limit | maintain a counter | same. retries·range requests eat the count and cause false positives |
| session·account binding | put a session ID in the signed payload and demand a cookie too | a separate credential is needed — it is no longer purely capability-based |
| client-IP binding | the IP in the signed payload | §11.4.2's false positives. behind NAT defense is partial |
| shorter expiry | narrow the window | all of §11.3's costs |
| channel binding (mTLS, etc.) | tie to the transport-layer identity | deployment difficulty rises sharply |

The reason the first two rows have stars is this section's crux.

> **All the strong means of replay prevention require server-side state. But stateless verification was the
> very reason capability-based was chosen (§11.2.3). Replay prevention and stateless verification are the two
> ends of the same axis.**

That a CDN chooses only shorter expiry is not laziness but the result of choosing a position on this axis.
Only, **what remains from that choice must be stated** — the sentence "we use signed URLs so it is safe" hides
the replay risk.

### 11.9.3 The places the token leaks — a URL is a bad vessel for a secret

The moment you put a capability in a URL, every place the URL remains becomes a place a credential remains.

| Leak place | How |
|---|---|
| the `Referer` header | if a page opened with a signed URL calls an external resource, that URL goes along |
| server·proxy access log | many implementations default to leaving the whole query string |
| browser history·address bar | the user copies and shares it as is |
| a shared link in chat·issue tracker | since **possession = exercise**, sharing the link is sharing the permission |
| error reports·monitoring | the URL rides on the exception stack and request record |
| an intermediate cache | depending on the cache-key config, a response can go to another user (§11.3.2) |

**TLS blocks none of these.** TLS protects the transport span, and the leaks are at both ends. This list
connects straight to Chapter 12's subject (the ambient privilege of credentials — cookies, process lists,
artifacts). The same problem as this repository redacting credential headers in the report JSON
([`report.py:36-46`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L36-L46)) is raised, for a signed URL, about **the URL itself.**

### 11.9.4 The defender's view

| Role | What to do |
|---|---|
| **service issuing signed URLs** | the construction is **HMAC** (SHA-256 or higher if possible). do not make "a hash with the key attached" yourself. put **path·expiry·method** minimally in the signed payload, and confirm that a parameter outside the signature does not change the response. verify with a constant-time comparison |
| **the person setting expiry** | expiry is a security value and an **availability value.** measure normal users' longest job time first, and if you will set it shorter, **provide a renewal path too.** account for the clock-skew tolerance adding to the effective lifetime |
| **CDN·platform operator** | **exclude token parameters from the cache key**, but confirm there is no path where the response differs by the token. redact signature parameters in the access log. if the threat requires recall, admit that **capability-based alone is insufficient** and add a separate control |
| **client implementer** | **do not gather tokens in advance.** parse the expiry and know the time remaining and you can handle failure before rather than after. respond to an expiry failure not with a retry but with **re-resolution** |
| **auditor** | **compare the signed-payload string against the docs**, and **have the parameters outside the signature listed** — that list is the surface the attacker can change freely. ask "how it is used" before "it uses MD5" |
| **the person handling logs·artifacts** | **a signed URL is a credential.** when attaching a URL to a bug report, treat it the same as attaching a cookie |

### 11.9.5 What this section does not cover

This chapter covers **what construction hangs its security on what property.** How to find out what a specific
deliverer's signed payload is, the procedure to forge a signature, and how to bypass expiry are not covered.
There is no code for that in this repository and it is not in the course's purpose either.

What a defender and an auditor need is **the ability to diagnose their own system's configuration**, not the
procedure to pierce another's. Knowing §11.5's three constructions, when you see `md5(secret + path)` in your
own team's code you know what to ask — that is the whole purpose of this section.

---

## 11.10 Limits and open questions

Noted honestly.

- **The signature algorithm could not be confirmed.** `md5=` is only a parameter name, and a name does not
  guarantee the algorithm or the construction. Which of §11.5's ①·②·③ the actual construction is, or something
  else entirely, cannot be known with this repository's code and was not attempted. All of §11.5 is a **design
  discussion, not a diagnosis.**
- **It does not parse the expiry value.** This tool does not read `expires`. Read it and it could (a) warn **in
  advance** when the remaining time is shorter than the expected duration and (b) say "it was expiry" in the
  failure diagnosis as a fact, not an inference. Now it guides **only as a possibility** like [`cli.py:97`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L97). An
  unimplemented improvement.
- **There is no auto-re-resolution on an expiry failure.** `resolve()` is called once at the episode start
  ([`cli.py:884`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L884)). If expiry hits mid-episode, that episode ends as a failure. A retry after re-resolution is
  structurally possible (just call `_run_one` again) but needs an upper-bound design to block an infinite loop
  and request flood, so it was not added.
- **Per-segment expiry was not observed.** §11.7's scenario (a segment signature expiring within one episode)
  is a **structural possibility read from the code structure**, and is in neither this repository's measurement
  records nor the regression tests. To reproduce it you would make a local server issuing signed segments with
  short expiry — an item not among the 8 fault injections currently.
- **§11.1.1's arithmetic table is not a measurement.** `T` and `E` vary by line·resolution·deliverer. What the
  table means to show is not specific numbers but the structure of **under what relationship it breaks.**
- **The actual exploitation case of the length-extension attack was not reproduced.** That §11.5.2 ① has a
  public report of being pierced on a real web API is a **citation**, and this course did not reproduce it.
- **The interaction of `--delay` and expiry was read from the code order.** It is a conclusion from the fact
  that `sleep` is at the end of the loop ([`cli.py:933-934`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L933-L934)), and how much expiry budget that placement actually
  leaves cannot be verified since `E` is unknown.
- **The cache-key·clock-skew discussion is a general principle, not this code's observation.** This tool is a
  client so it cannot see the CDN config or the issuing server's clock. §11.3.2·§11.3.3 are sections for the
  designer, not facts confirmed with this repository.

---

## 11.11 Summary

1. `?md5=<signature>&expires=<unix>` is **capability-based access control.** The URL itself is the
   authorization token, and possessing it lets you exercise it ([`series.py:1-11`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L1-L11)).
2. A capability is **irrevocable.** That there is no state to look up on the server is the reason this way was
   chosen (stateless verification at the CDN edge), and irrevocability is its price. So **expiry is not an
   optional feature but a component.**
3. When expiry is embedded in the URL, a **work-order constraint** arises on the client. If `token lifetime <
   the whole job's duration`, gathering in advance necessarily breaks → **late resolution.**
4. This repository does late resolution per episode ([`series.py:266-300`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L266-L300), [`cli.py:884`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L884)). The data type holds
   that decision (`Episode` ↔ `Play`, [`series.py:81-87`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L81-L87)), and as a side effect not a single issuing request
   goes out for an episode already in inventory ([`cli.py:872-874`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L872-L874)).
5. **Expiry has no dedicated status code.** It comes as `403`·`404`, and as `200` + an HTML error page too. So
   Chapter 14's **leading-byte determination** becomes part of expiry detection ([`tsanalyze.py:23`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L23),
   [`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464)).
6. **Retry cannot fix expiry.** Because it is repeating the same request ([`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201)). What is needed
   is not a retry but **re-resolution**, and this repository did not automate it.
7. The expiry time is **a trade of the leak window and normal-user availability**, and the cache key·clock skew·
   reissue load·key-rotation period all move together. The skew tolerance adds directly to the effective
   lifetime.
8. **What is outside the signature changes freely.** Signed-payload design is itself a declaration of the threat
   model. IP·User-Agent binding raises leak tolerance but cuts off normal users, and lower the precision to
   reduce false positives and defense goes down together.
9. **A hash with the key attached is not a MAC.** `H(K ‖ M)` hangs its security on length extension, `H(M ‖ K)`
   on the hash's collision resistance. The correct construction is **HMAC**, and HMAC's security proof **does
   not require collision resistance.** The construction comes before the algorithm.
10. **Expiry does not block replay.** It only narrows the window in which replay is possible. Every actual
    replay-prevention means requires server-side state, and that collides head-on with the very reason
    capability-based was chosen. **This collision is not resolved; the design only chooses a position on the
    axis.**

---

**Next chapter** — this chapter's last table (§11.9.3) listed the places the token leaks. `Referer`, the access
log, browser history, shared links, error reports. That list is not signed-URLs' problem alone. A cookie
remains in plaintext in the shell history and `ps` output, and the report JSON remains as a CI artifact.
Chapter 12 traces **where credentials actually remain**, and asks whether this repository's redaction-target
list is complete.
