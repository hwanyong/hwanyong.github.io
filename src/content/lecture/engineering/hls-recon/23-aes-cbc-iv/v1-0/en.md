---
title: "AES-128-CBC and the IV Derivation Rule"
description: "What it means to use the media sequence as the IV"
date: 2026-07-11
version: '1.0'
tags: ['streaming', 'cryptography']
thumbnail: /images/lecture/thumb/hls-recon-23-aes-cbc-iv.svg
---
## 23.0 What this chapter answers

1. Why does `AES-128-CBC` have two names — what layer does the block cipher and the mode of operation each do?
2. What does the IV (initialization vector) block, and what does it fail to block?
3. When `EXT-X-KEY` has no IV attribute, what exactly is the rule "**use the media sequence number as the IV**",
   and is the fact that the IV is fully predictable a problem here?
4. What is the condition under which a predictable IV becomes an attack, and **which of those conditions does not
   hold here?**
5. What CBC does not do — why is today's standard AEAD?

The fourth is this chapter's summit. The sentence "a predictable IV is dangerous" is only half right, and what
fills the other half is the threat model.

---

## 23.1 The problem — before ciphertext, every check so far halts

Part 4's checks all stood on the same premise. The premise that **you can see the bytes.** Chapter 14's
leading-byte determination looks for `0x47`, and Chapters 17·18's continuity-counter check reads packet headers
at the 188-byte period. In an encrypted segment that premise breaks from the very first byte.

Copy the leading 16 bytes of a segment from a locally made AES-128 stream as-is (measured).

```
$ xxd -l 16 enc/seg000.ts
00000000: 2f05 b85b 9b27 a315 f60d 8de3 f882 f98e  /..[.'..........
```

There is no `0x47`. Put it into this repository's `sniff()` as-is and `unknown` comes out — that is, **the
verification tool judges a normal segment as "not media."** It means decryption must finish first for Part 4's
checks to gain meaning at all, and so the order at [`cli.py:456-458`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L456-L458) is not negotiable.

```python
# cli.py:456-458
        data = res.body
        if seg.key and seg.key.is_encrypted:
            data = keys.decrypt(data, seg.key, seg.seq)
```

What to decrypt with is directed by one line of the playlist. The asset producing that line is generated
directly by the regression test.

```bash
# tests/run.sh:46-49
head -c 16 /dev/urandom > enc/enc.key
printf '%s/enc/enc.key\n%s/enc/enc.key\n' "$BASE" "$WORK" > enc/keyinfo
ffmpeg -v error -y -i source.mp4 -c copy -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_key_info_file enc/keyinfo -hls_segment_filename "enc/seg%03d.ts" enc/index.m3u8
```

It pulls 16 bytes from `/dev/urandom` and uses them as the key file (exactly the "16-octet array" of RFC 8216
§5.1 seen in §23.8), and writes into the key-info file **the address to use as the URI** and the **local path**
in two lines, handing it to ffmpeg. The line ffmpeg 8.1.1 actually wrote in a stream made locally the same way
is this (measured).

```
#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:8899/enc/enc.key",IV=0x00000000000000000000000000000000
```

Three things are written — the **algorithm** (`METHOD`), the **place to get the key** (`URI`), and the **IV.** And
yet the IV attribute is **optional** by spec. What happens if it is absent. There is a default the spec set, and
that default is this chapter's subject.

---

## 23.2 Principle ① — the block cipher and the mode of operation are different layers

The name `AES-128-CBC` is two decisions stuck together. Without separating the two you cannot explain why the IV
is needed.

> **Term** — **block cipher**: a function substituting one fixed-length block with a key. It takes a plaintext
> block and a key and puts out a ciphertext block of the same length, and with the key it can be undone by the
> inverse function. AES's block length is **always 128 bits (16 bytes)**, and only the key length is chosen from
> 128·192·256 bits. The 128 in `AES-128` is the **key length**, not the block length.

Here a problem arises immediately. One segment exceeds 400,000 bytes. How do you process that with a 16-byte
function. The rule answering this question is the mode of operation.

> **Term** — **mode of operation**: the rule applying a fixed-length block cipher to an arbitrary-length message.
> It sets how to split into blocks, what to mix into each block, and how to fill the last block's leftover slot.
> The block cipher itself does not know the mode.

### 23.2.1 The way the simplest mode fails — ECB

The mode that splits into blocks and just encrypts them one by one is **ECB (Electronic Codebook).** It is the
easiest to implement and its failure is the most famous. The same plaintext block always becomes the same
ciphertext block.

You can measure how much this leaks in an actual segment. The result of encrypting a local reproduction stream's
segment plaintext (436,348 bytes, 27,271 whole 16-byte blocks) with the same key under ECB and CBC each, and
producing block-duplication statistics.

| Target | Block count | Distinct blocks | Blocks in a duplicate group | Most repeated |
|---|---|---|---|---|
| plaintext MPEG-TS | 27,271 | 26,605 | 671 (2.5%) | **662 times** |
| ECB ciphertext of the same plaintext | 27,271 | **26,605** | **671 (2.5%)** | **662 times** |
| CBC ciphertext of the same plaintext | 27,271 | 27,271 | 0 (0.0%) | 1 time |

**The ECB ciphertext's duplication statistics do not differ from the plaintext by a single digit.** The block
repeated 662 times is `ffffffffffffffffffffffffffffffff` — MPEG-TS's adaptation-field stuffing bytes. Even after
encryption the fact "there is the same content here 662 times" remains as-is.

Even unable to read the content, **the structure is read.** This is the identity of the famous example where an
ECB-encrypted bitmap image still shows the original outline, and the table above is the measurement that this
phenomenon happens in the very byte string this repository handles.

### 23.2.2 The properties by mode

| Mode | Inter-block coupling | Initial value | Property needed | Parallel decryption | Authentication |
|---|---|---|---|---|---|
| **ECB** | none | none | — | possible | none |
| **CBC** | XOR with the previous **ciphertext** block | IV | **unpredictability** | possible | none |
| **CTR** | none (counter stream) | nonce | **uniqueness** | possible | none |
| **GCM** | CTR + authentication tag | nonce | **uniqueness** | possible | **yes** |

> **Term** — **nonce (number used once)**: a value that **must not be used twice** under the same key. It is used
> interchangeably with IV but the requirements differ — CBC's IV must be unpredictable, and CTR·GCM's nonce may
> be predictable but must not be reused.

What HLS chose is CBC. The hardware-decryption pipeline at the 2009 design time presupposed CBC, and back then
AEAD was not yet the default choice. The price of this choice is computed in §23.8.

---

## 23.3 Principle ② — CBC and the IV's slot

CBC (Cipher Block Chaining) XORs each plaintext block with the previous ciphertext block **before** encrypting
it. Written as a formula it is this.

```
encrypt   Cᵢ = E_K(Pᵢ ⊕ Cᵢ₋₁)
decrypt   Pᵢ = D_K(Cᵢ) ⊕ Cᵢ₋₁
```

The first block has no "previous ciphertext." The value filling that empty slot from outside is the IV.

> **Term** — **IV (Initialization Vector)**: the initial value the mode of operation needs when processing the
> first block. In CBC it goes into `C₀`'s slot and is 16 bytes, the same as the block length. **It is not a
> secret** — the decrypting side must know it, so it is usually delivered together in plaintext.

![The chaining of CBC decryption and the IV's slot](/images/lecture/hls-recon/23-cbc-chain.svg)

*Figure 23-1 — the chaining of CBC decryption and the IV's slot*

Two things are read immediately from the diagram. Most of the rest of this chapter comes from these two.

- **The IV touches only the first block.** `P₂` references only `C₁` and does not see the IV. So if the IV is
  wrong, the only thing that goes off is `P₁`.
- **Decryption does not propagate forward.** Touch `Cᵢ` and only `Pᵢ` and `Pᵢ₊₁` are affected and what is before
  is fine. The error is localized.

### 23.3.1 What the IV actually blocks

The IV's mission is **to block the same plaintext becoming the same ciphertext.** This too can be measured. I
encrypted two plaintexts, identical in the first 10 blocks (160 bytes) and differing only in the 11th block,
with the same key.

| Two plaintexts | IV | Matching leading ciphertext blocks |
|---|---|---|
| first 10 blocks identical | both `0x00…00` | **10 / 11** |
| first 10 blocks identical | `0x00…00` and `0x00…01` | **0 / 11** |

Use the same IV and the common-prefix length is exposed as-is in the ciphertext. The information **"these two
messages have the same first 160 bytes"** is read without the key. Change the IV by just 1 and it differs from
the first block so that information vanishes.

That is, what the IV provides is not confidentiality but **non-determinism.** Making two ciphertexts of the same
plaintext under the same key look mutually unrelated.

### 23.3.2 The last block — padding to the next chapter

CBC requires the plaintext length be a multiple of 16. An MPEG-TS segment is a multiple of 188, and 188 is not a
multiple of 16, so there is almost always a remainder. The rule filling that slot is PKCS#7. One measured example
only.

```
plaintext 436,348 bytes  (= 188 × 2,321 packets)
ciphertext 436,352 bytes → difference 4 bytes, value 04 04 04 04
```

Why padding removal is implemented in this repository **in a way that does not throw an exception** is the
subject of all of Chapter 24. Here we confirm only up to "a rule-based fill goes into the last block" and move
on.

### 23.3.3 CBC restarts at each segment boundary

Copy RFC 8216 §4.3.2.4's sentence as-is.

> "CBC is restarted on each segment boundary, using either the Initialization Vector (IV)
> attribute value or the Media Sequence Number as the IV."

This one sentence holds up this repository's entire structure. That **the chain breaks per segment** means
decrypting segment N does not need segment N-1. So

- Chapter 8's **parallel receiving** holds — receive out of order and unpack each.
- **Random-position playback** holds — start from the middle and only that segment is needed.
- **Partial verification** holds — receive just one segment and decrypt only it.

Had the whole file been tied into one CBC chain, all three would be impossible. It is that the spec designed the
"closure under concatenation" (join two valid TS and get valid TS again) seen in Chapter 19 to be maintained at
the crypto layer too. **In exchange, as many IVs as there are segments become needed.** Where to obtain that IV
is the next section's question.

---

## 23.4 The spec — RFC 8216's IV derivation rule

The three sentences of RFC 8216 §5.2 "IV for AES-128" are the whole rule. Copy the original text as-is.

> "[AES_128] REQUIRES the same 16-octet IV to be supplied when encrypting and decrypting."
>
> "An IV attribute on an EXT-X-KEY tag with a KEYFORMAT of "identity" specifies an IV
> that can be used when decrypting Media Segments encrypted with that Key file."
>
> "An EXT-X-KEY tag with a KEYFORMAT of "identity" that does not have an IV attribute
> indicates that the Media Sequence Number is to be used as the IV when decrypting a
> Media Segment, by putting its big-endian binary representation into a 16-octet
> (128-bit) buffer and padding (on the left) with zeros."

![The two branches of RFC 8216's IV derivation](/images/lecture/hls-recon/23-iv-derivation.svg)

*Figure 23-2 — the two branches of RFC 8216's IV derivation*

> **Term** — **media sequence number**: the integer serial number assigned per segment within a media playlist.
> The first segment's number is the value of the `EXT-X-MEDIA-SEQUENCE` tag (0 if absent), and each subsequent
> segment increases by 1. Even if the window slides in a live delivery, **the same segment's number does not
> change** — so the player can judge which piece it has already seen.

Organize the two branches' properties and it is this.

| | ① When the IV attribute is present | ② When the IV attribute is absent |
|---|---|---|
| IV value | the written 16 bytes as-is | the media sequence number's 128-bit big-endian |
| Change between segments | **none** — all identical under the same KEY tag | exactly +1 per segment |
| Predictability | knowable by reading the playlist | **knowable without reading the playlist** |
| Secrecy | none (written in plaintext) | none |
| Spec version | 2 or higher needed | no restriction |

In both branches **the IV is not a secret.** ① is written in the playlist in plaintext, and ② is computed if you
just know the segment's serial number. The spec does not require the IV's confidentiality in the first place,
nor can it — because the decrypting side must know it.

The difference is not in the **degree of predictability** but in **uniqueness.** ② guarantees a different IV per
segment, but ① uses the **same IV** for all segments the same KEY tag applies to. Per §23.3.1's measurement, ①
exposes the segments' common prefix — an actual TS segment has a different continuity counter from the first
block so the prefixes almost never match, but that is by chance, not a property the spec guarantees.

### 23.4.1 For the rule to hold there must be a number

The default rule has one quiet premise. **To make the IV, that piece must have a number.** There is one piece
with no number — the fMP4 initialization section (`EXT-X-MAP`). The spec explicitly blocks this hole (§4.3.2.5).

> "If the Media Initialization Section declared by an EXT-X-MAP tag is encrypted with a
> METHOD of AES-128, the IV attribute of the EXT-X-KEY tag that applies to the EXT-X-MAP
> is REQUIRED."

It is that the spec placed an exception clause at the spot where the rule's premise breaks. The way to read such
a clause is not "what does it require" but to ask back **"what premise broke that this clause arose."**

---

## 23.5 The code — where the spec fits into fifteen lines

### 23.5.1 The scope the module states itself

```python
# decrypt.py:1-6
"""HLS AES-128 segment decryption (RFC 8216 §4.3.2.4).

By spec it is AES-128-CBC + PKCS7 padding, and the IV uses the EXT-X-KEY's IV attribute,
or if absent fills that segment's media sequence number as 128-bit big-endian.
The key itself is downloaded as plaintext 16 bytes from a URI — link-protection level, not DRM.
"""
```

The docstring's three lines are a summary of §23.2–§23.4. The last line ("link-protection level, not DRM") nails
down Chapter 25's proposition in advance.

### 23.5.2 The decryption body

```python
# decrypt.py:33-47
    def decrypt(self, data: bytes, key: Key, seq: int) -> bytes:
        if not key.is_encrypted:
            return data
        if not key.is_supported:
            raise NotImplementedError(
                f"METHOD={key.method} KEYFORMAT={key.keyformat} cannot be decrypted "
                "segment-by-segment — delegate to ffmpeg with --mode remux"
            )

        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        iv = key.iv if key.iv is not None else seq.to_bytes(16, "big")
        dec = Cipher(algorithms.AES(self.material(key)), modes.CBC(iv)).decryptor()
        plain = dec.update(data) + dec.finalize()
        return _unpad_pkcs7(plain)
```

Point at each line.

| Line | What it does | To note |
|---|---|---|
| `if not key.is_encrypted` | pass if `METHOD=NONE` | the encryption judgment is here, not in the caller |
| `if not key.is_supported` | reject SAMPLE-AES·DRM | **rejects and tells the alternative.** Chapter 26's subject |
| in-function `import` | load `cryptography` only when needed | a run handling only plaintext streams does not open this module |
| `seq.to_bytes(16, "big")` | §5.2's default rule | "big-endian in a 16-octet buffer, left padded with zeros" is exactly one expression |
| `modes.CBC(iv)` | mode specification | the block cipher (`algorithms.AES`) and the mode are **separated as arguments** |
| `_unpad_pkcs7(plain)` | padding removal | Chapter 24 |

That `algorithms.AES(...)` and `modes.CBC(...)` go in as different arguments is the API reflecting the two layers
§23.2 split as-is. Changing the block cipher and changing the mode are independent decisions.

`import`ing inside a function is a common lazy-load idiom in Python. Only, this repository does not make
`cryptography` an optional dependency.

```toml
# pyproject.toml:23-25
# Used only for AES-128 segment decryption (decrypt.py), but absent and it raises
# ModuleNotFoundError right at that spot. Kept required so an install does not work half-broken.
dependencies = ["cryptography"]
```

That is, the reason for the lazy import is not "to make it work without it." Since there is no comment, **the
intent is inference** — the remaining explanation is about the startup cost (most runs, handling only plaintext
streams, do not open the heavy module).

### 23.5.3 Where the IV comes from — parsing

The origin of `key.iv` is one line.

```python
# playlist.py:307-316
        elif line.startswith("#EXT-X-KEY:"):
            a = _parse_attrs(line.split(":", 1)[1])
            method = a.get("METHOD", "NONE")
            iv_hex = a.get("IV", "")
            cur_key = Key(
                method=method,
                uri=_absolute(base_url, a.get("URI")),
                iv=bytes.fromhex(iv_hex[2:]) if iv_hex.lower().startswith("0x") else None,
                keyformat=a.get("KEYFORMAT", "identity"),
            )
```

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

The type `iv: bytes | None` expresses the spec's "optional attribute" as-is. **`None` is not "the IV is 0" but
"there is no IV attribute"**, and so `decrypt` checks with `key.iv is not None`. Why not mashing the two states
into one value matters here is measured in §23.6.

That `keyformat`'s default is `"identity"` is per spec too (§4.3.2.4 — the absence of KEYFORMAT means
`identity`). And §5.2's default IV rule is **limited to the case `KEYFORMAT="identity"`**, and in this code
`is_supported` already passes only `identity` so the condition is automatically satisfied.

### 23.5.4 Where seq comes from

```python
# playlist.py:141
    seq: int  # media sequence number — used to compute the AES-128 default IV
```

The comment states the field's reason for existing. The value is assigned as a state variable during parsing.

```python
# playlist.py:300-302
        elif line.startswith("#EXT-X-MEDIA-SEQUENCE:"):
            pl.media_sequence = int(line.split(":", 1)[1])
            seq = pl.media_sequence
```

`seq` starts at 0 as a parser local variable ([`playlist.py:220`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L220)), is reset to that value when it meets
`EXT-X-MEDIA-SEQUENCE`, and increases by 1 each time it makes a segment (`playlist.py:240,248`). It is a state
machine transcribing the spec's definition as-is.

Here there is an **order dependency.** If `EXT-X-MEDIA-SEQUENCE` comes after the first segment, the front
segments have already received numbers from 0. RFC 8216 requires this tag come before the first media segment so
in a spec-conforming playlist there is no problem, but the parser **does not enforce** that requirement. Confirmed
by measurement — move the tag to the playlist's end and it becomes this.

```
media_sequence = 100   (the tag was read)
per-segment seq = [0, 1, 2]   (the numbers were already assigned)
```

`media_sequence` is 100 but the segments' `seq` are 0·1·2. If it is a stream with no IV attribute, **all three
segments are decrypted with a wrong IV and no error arises.** It is the price of "an M3U8 parser cannot help but
be a state machine," organized in Chapter 2, appearing as-is on the crypto path too — after `prev_range_end`
(offset carry-over) and `cur_key` (key persistence), `seq` is the third state.

---

## 23.6 What breaks if you get the IV wrong — measured

This is the most important measurement in this chapter. Confirm on an actual segment the "the IV touches only the
first block" Figure 23-1 predicted, and see how that result appears to the verification tool.

The target is the second segment of the local reproduction stream (ciphertext 457,984 bytes, plaintext 457,968
bytes = 188 × 2,436 packets). This stream declares `IV=0x00…00` so the correct IV is 0.

| Case | Bytes off | Ratio | `sniff()` | ffmpeg playback | Detected |
|---|---|---|---|---|---|
| correct IV (=0) | 0 | — | `mpegts` | exit 0 · 4.000s | — |
| **ignore the IV attribute and use seq(=1)** | **1** (offset 15) | 0.00022% | `mpegts` | exit 0 · 4.000s | **no** |
| random IV | 16 (all of block 0) | 0.0035% | **`unknown`** | exit 0 · 4.000s | `sniff()` only |
| wrong key itself | all | 100% | `unknown` | (unmeasured) | `sniff()` |

The second row is frightening. Use `1` instead of `0x00…00` as the IV and the XORed value differs by only 1 in
the last byte, so **the plaintext too differs in exactly one byte, offset 15 only.** The value is exactly `0xff →
0xfe`, i.e. XOR 1. One byte of 450,000. (As seq grows the number of differing bytes rises to a few, but it is
**always inside block 0** — the XOR of the two IVs is exactly the off spot.)

- the leading byte `0x47` unchanged → `sniff()` passes
- the 188th byte too unchanged → the second-packet check passes too
- not a packet header (bytes 0–3) → Chapter 18's continuity-counter check is unaffected too
- ffmpeg gives exit code 0, and the duration is identical to the decimal

**No check of this tool catches it.** The output file is quietly contaminated.

The third row is the control. Use a random IV and the first block's 16 bytes become random wholesale, and among
them offset 0 is the magic-number slot so `sniff()` gives `unknown`. Only, this is a **lucky detection** — the
damage merely happened to fall on a spot with a determination basis, and this detection too leaks by the
probability 1/256 (≈0.4%) that a random first byte becomes `0x47` by chance (a computed value. In 200 trials I
observed 0 misjudgments, but that experiment changed the key too randomly so it is not a direct measurement of
this probability).

Here one small decision of the code has worth.

> `iv = key.iv if key.iv is not None else seq.to_bytes(16, "big")`
>
> **An implementation that does not distinguish "there is no IV attribute" from "the IV is 0" produces the
> table's second row every day.** And that contamination catches on no check.

Actually this trap is close. ffmpeg 8.1.1's HLS muxer **always writes `IV=0x00000000000000000000000000000000`
into the playlist** even if you do not specify an IV in the key-info file (measured). That is, "a stream whose IV
is all 0" is not an exceptional input but a common one.

The same property is on the parsing side too. [`playlist.py:314`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L314) puts `None` if the IV string does not start with
`0x`. RFC 8216 requires a `0x`/`0X` prefix on a hexadecimal-sequence so a prefix-less IV is a spec-violating
playlist, but the result then is **not an error but a different IV.** It is a spot where spec-violating input
leads to quiet contamination instead of an exception.

---

## 23.7 Generalization — when is a predictable IV a problem

Use the default rule and the IV is 0, 1, 2, 3 … . The crypto textbook says CBC's IV must be **unpredictable.** It
looks as if the spec is violating the textbook. You must point out exactly when this is a problem.

> **Term** — **chosen-plaintext attack (CPA)**: an attack model assuming the attacker can choose an arbitrary
> plaintext, get it encrypted **with the same key**, and observe that ciphertext. It is the situation modern
> crypto's basic security criterion (IND-CPA) presupposes.

The condition CBC's CPA-security proof requires is exactly "the IV must be unpredictable." Why is read from
§23.3's encryption formula. If the attacker knows the next IV in advance, they can **assemble** the plaintext
block they will inject as `IV_next ⊕ (guess) ⊕ (a prior ciphertext block)`. Then just by seeing which past
ciphertext block the encryption result equals, they can judge "was my guess right." They must guess all 16 bytes
at once, but push the block boundary one slot at a time so an unknown byte comes only one at the block's end and
the number of tries drops to the level of 256. **BEAST** (2011) against TLS 1.0 had this structure.

### 23.7.1 Decompose the conditions and compare

①–③ are conditions for the attack **to hold technically** and all three are needed (AND). ④ is a separate
question dividing, even if it holds, **whether it is worth attacking.**

| Condition | TLS 1.0 browser (BEAST) | HLS segment AES-128 |
|---|---|---|
| ① the next IV can be predicted | **holds** (the previous record's last block is the next IV) | **holds** (seq + 1) |
| ② the ciphertext can be observed | **holds** (same network·same page) | **holds** (the CDN distributes publicly) |
| ③ **the attacker can get a chosen plaintext encrypted with the same key** | **holds** (the attacker's JS makes the request, and a secret cookie rides in that request) | **does not hold** |
| ④ the plaintext has a secret the attacker does not know | **holds** (the session cookie) | **does not hold** (the video is public to the viewer) |

![The presence or absence of a plaintext-injection path divides the conclusion](/images/lecture/hls-recon/23-injection-path.svg)

*Figure 23-3 — the presence or absence of a plaintext-injection path divides the conclusion*

③ is this chapter's core. An HLS segment is encrypted **once, offline, at packaging time.** The encrypting party
is the deliverer, and there is no party online for the attacker to ask "please encrypt these bytes." That is,
**there is no encryption oracle.**

> **Term** — **oracle**: an entity that returns an answer when the attacker sends a query. An encryption oracle
> answers "encrypt this plaintext for me," and a padding oracle (Chapter 24) answers "is this ciphertext's
> padding correct." For an attack to hold, usually **some oracle must be online.**

④ must be seen together. Even if an injection path arose, this plaintext has no secret the attacker does not
know. The video is shown as-is to every normal viewer. Without defining **what the encryption is trying to
protect**, this judgment itself is impossible — that question is Chapter 25.

### 23.7.2 The exact form of the conclusion

Here how you write the conclusion matters.

> ✗ "A predictable IV is actually safe"
> ✗ "HLS uses the IV wrong but it is fine since it is video anyway"
> ✓ **"A predictable IV is a necessary condition for a chosen-plaintext attack, and this threat model has no
>   plaintext-injection path so that attack does not hold. Change the threat model and the conclusion changes."**

Only the third sentence is verifiable. The first two do not say **why** it is safe, so there is no way to notice
when the condition changed. In fact the condition changes often.

| Context | IV rule | Injection path | Verdict |
|---|---|---|---|
| HLS segment | seq serial | none | does not hold |
| TLS 1.0 record | the previous ciphertext block | browser JS | **BEAST** |
| a web app's cookie·token encryption | fixed IV·counter | user input encrypted with the same key | **holds** |
| DB column deterministic encryption | IV fixed (for search) | the user registers a value | frequency analysis·existence confirmation |
| nonce reuse in CTR·GCM | uniqueness violation | — | **keystream reuse — fatal** |

The last row is a failure in a different direction. CBC stops at "common-prefix exposure" even if you reuse the
IV, but reuse the nonce in the CTR family and the XOR of two ciphertexts becomes the XOR of two plaintexts and it
effectively collapses. **Each mode requires a different property of the initial value, and the price for
violating it differs too** (§23.2.2's table).

---

## 23.8 Security — what CBC does not do

### 23.8.1 That decryption succeeded proves nothing

CBC provides only confidentiality. It provides neither integrity nor origin authentication. This is not a defect
but a **design scope**, and the problem arises from mistaking that scope.

> **Term** — **malleability**: the property that a ciphertext can be manipulated to cause a **predictable** change
> in the plaintext. Even not knowing the plaintext, the attacker can do a "flip a specific bit" manipulation.

Measured. The result of flipping the low 1 bit of one byte in the ciphertext's 100th block and decrypting with
the correct key·correct IV.

| Item | Value |
|---|---|
| bytes changed across the whole plaintext | **17** (of 457,968) |
| block 100 (offset 1600–1615) | all 16 bytes changed randomly |
| block 101 (offset 1619) | **exactly 1 bit flipped** — the same spot as the manipulation |
| block 102 onward | no change |
| `sniff()` verdict | `mpegts` — **passes** |

Figure 23-1's formula is reproduced as-is. In `Pᵢ = D_K(Cᵢ) ⊕ Cᵢ₋₁`, touch `Cᵢ₋₁` and that value is
**transmitted 1:1** by XOR, so in the next block exactly the bit the attacker intended is flipped. The block
before it is randomized as the price.

So it is organized like this.

> **The fact that an AES-128-CBC segment's decryption succeeded does not mean those bytes were made by the key
> holder.** HLS's AES-128 has no MAC. A layer checking integrity does not exist within the protocol.

It means the same blank as "an HLS manifest has no piece-integrity information" confirmed in Chapter 2
(BitTorrent·Git·OCI·APT put hashes in the listing) is in the crypto layer too. Not in the manifest and not in the
crypto mode — **the reason a tool like this repository exists becomes one layer clearer here.**

> **Term** — **AEAD (Authenticated Encryption with Associated Data)**: a crypto construction providing
> confidentiality and integrity·origin authentication **in one operation.** AES-GCM, ChaCha20-Poly1305 are the
> representatives, and at decryption, if the authentication tag does not match, it does not put out the plaintext
> but fails.

The reason AEAD became the standard is not theoretical elegance but **a history of failures.** Assemble
encryption and MAC by hand and you get the order wrong (the padding oracle of the MAC-then-Encrypt family —
Chapter 24), do not compare the tag in constant time and leak by timing, and leave the associated data out of the
authentication range. AEAD is **removing the error-prone assembly from the API.**

The reason HLS is still CBC is organized into three. Written distinguishing confirmed from presumed.

| Reason | Basis |
|---|---|
| 2009 design · hardware-decryption pipeline compatibility | spec history — literature basis |
| integrity delegated to the transport layer (HTTPS) | **inference** from the fact the spec put no MAC |
| the threat model does not require tamper defense | argued in Chapter 25 |

The second item has a consequence important to the defender. **AES-128 does not replace TLS.** Put AES-128 HLS
over plaintext HTTP and the content is masked, but a man-in-the-middle can manipulate the segment and decryption
still "succeeds." The measurement above is that situation's exact picture — 17 bytes changed and the tool gave a
pass.

### 23.8.2 The key cache's threat model

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

Point at three things.

**(1) The length check is the crypto edition of "200 is not success."** `len(r.body) != 16` is both a direct
application of RFC 8216 §5.1 ("[AES_128] encryption uses 16-octet keys… a single packed array of 16 octets in
binary format") and, at the same time, Chapter 5's principle. If a key URI returns an HTML error page as 200 on
token expiry, the body is several hundred bytes, and without this check `modes.CBC` or `algorithms.AES` throws a
hard-to-recognize exception much further down. **It catches the wrong thing at the nearest spot.**

**(2) The plaintext key stays in memory for the process's lifetime.** There is no code clearing `self._cache`.
The verdict splits by threat model.

| Threat | Is the cache a point of contention | Reason |
|---|---|---|
| a local process with the same user privilege | **no** | with that privilege you can just fetch the key URI directly |
| left in a core dump·swap file | partly yes | only, Python's immutable `bytes` has no sure way to be wiped |
| process-memory reading (debugger attach) | partly yes | with the same privilege it becomes the same as the first row |
| report·artifact leak | **no** | confirmed — (3) below |
| a different user·remote attacker | no | there is no reach path |

You must also weigh what happens if you remove the cache. Re-fetch the key per segment and the memory-residence
time shrinks but **the number of times the key travels the network rises by the segment count**, and the access
trace left in server logs rises by the same multiple. Moreover, in Python `del` does not overwrite memory. That
is, **removing the cache does not reduce the threat while only raising the cost.**

And a bigger fact sets this contention's size — this key can be fetched by anyone with just one URI in the first
place. For memory residence to become a grave problem, the key must first be a secret. That is the question
Chapter 25 will answer.

**(3) The key request uses the same `Fetcher` as the segments** ([`decrypt.py:25`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L25)). So the cookie·`Referer` the
user passed attaches to the key request too. It means Chapter 12's ambient-authority problem applies identically
to the key-distribution path. Only, the report side was confirmed — the URL `report.py` records is only the
subtitle track (`report.py:475,486`), and **neither the key URI nor the key bytes go into the report JSON.**

### 23.8.3 The defender's view

| Role | What to do |
|---|---|
| **delivery operator** | do not use AES-128 as a substitute for TLS. tamper defense is HTTPS's job, and AES-128 gives only confidentiality. the key URI is meaningful only if it receives **different access control** from the segments (Chapter 25) |
| **player·tool implementer** | never treat "no IV attribute" and "IV=0" as the same value. check with `is not None`, and if the IV length is not 16 bytes **reject.** do not use decryption success as an integrity basis |
| **protocol designer** | do not choose CBC in a new design. use AEAD, and state in the spec text the property required of the initial value (uniqueness or unpredictability). the way HLS put IV as REQUIRED on `EXT-X-MAP` is a good example |
| **auditor** | do not judge it a vulnerability by "the IV is predictable" alone. first ask **is there a plaintext-injection path**, and if not, record that fact as the basis. only then can you know the verdict must flip later when an injection path arises |
| **pipeline operator** | confirm how the packager uses the IV. a configuration nailing the same IV into every segment (§23.4's ①) is not a spec violation but loses uniqueness |

---

## 23.9 Limits and open questions

Written honestly.

- **This repository's regression test does not pass through the default IV path.** ffmpeg 8.1.1's HLS muxer
  always writes `IV=0x00…00` even if the key-info file has no IV line (measured). So in the stream
  `tests/run.sh:46-49` makes, `key.iv` is always 16 bytes and the `seq.to_bytes(16, "big")` branch is **never
  executed.** It means the line implementing the spec's default rule is not fixed by a test. To cover it you must
  separately make, as assets, a playlist with the IV attribute removed and segments re-encrypted with a
  seq-based IV — an item not among Chapter 35's 8 defect injections.
- **An IV syntax error becomes quiet contamination.** [`playlist.py:314`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L314) drops an IV with no `0x` prefix to
  `None`. It is spec-violating input but the result is a different IV, not an exception, and per §23.6's
  measurement no check catches it. I think attaching a diagnostic is right, but **I could not confirm whether that
  change causes false positives in real delivery.**
- **There is no diagnostic for input whose IV length is not 16 bytes.** `KeyCache.material` checks the key length
  but no one checks the IV length. The library-level exception `modes.CBC` throws goes straight to the user. A
  layer like [`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)'s `_diagnose` is not on the crypto path.
- **`EXT-X-MAP` is not decrypted.** [`cli.py:441-448`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L441-L448) records the initialization section as the bytes received.
  RFC 8216 §4.3.2.5 presupposes the initialization section can be AES-128 encrypted and in that case puts the IV
  attribute as REQUIRED. Meet such a delivery and the ciphertext would be stored as-is. Only, **I have never
  actually met such a stream and confirmed** — what I confirmed is only the fact that there is no decryption call
  on the code path.
- **The cryptographic claims are literature organization, not this chapter's proof.** That CBC's CPA security
  requires the IV's unpredictability, and the holding conditions of BEAST-family attacks, are summaries of
  standard results. What this chapter measured is the **mode's behavior** (error localization, malleability,
  ECB's duplicate exposure), not a security proof.
- **1/256 is a computed value.** §23.6's "probability `sniff()` misses a random IV" is a value from the
  probability the first byte is `0x47` by chance, not directly measured.
- **The behavior for a wrong key was only partly measured.** That `sniff()` gives `unknown` was confirmed, but
  the interaction with the path viewing the TS header's scrambling-control bit (`tsanalyze.py`), and what error
  ffmpeg gives, was not covered in this chapter.
- **The measurements all came from one local reproduction stream (ffmpeg 8.1.1 · libx264 · 320x180 · 4-second
  segments).** Values like block-duplication statistics differ by content. What does not differ is the structural
  fact (the ECB ciphertext's duplication statistics match the plaintext, an IV error is confined to the first
  block).

---

## 23.10 Summary

1. **`AES-128-CBC` is two decisions.** AES is a function substituting one 128-bit block, and CBC is the rule
   applying it to a 450,000-byte message. The 128 in `AES-128` is the **key length**, not the block length.
2. **Without a mode (ECB) the structure leaks.** Measured: of the plaintext's 27,271 blocks, 671 are duplicates
   with a top repeat of 662 times, and **the ECB ciphertext's statistics are completely identical to the
   plaintext's.** Switch to CBC and duplicates become 0.
3. **The IV is not a secret but a value that makes non-determinism.** Use the same IV and the common-prefix
   length of two messages is exposed as-is in the ciphertext (measured: 10 blocks matching → change the IV by 1
   and 0 blocks).
4. **RFC 8216's rule is exactly two** — if there is an IV attribute, that value; if not, put that segment's media
   sequence number into a 16-octet buffer big-endian and left-pad with zeros. The latter is **fully
   predictable.** In code it is the one expression `seq.to_bytes(16, "big")`.
5. **CBC restarts at each segment boundary.** So parallel receiving·random-position playback·partial
   verification hold. In exchange as many IVs as segments become needed, and what fills that demand is point 4's
   default rule.
6. **An IV error remains only in the first block, and so it is quiet.** Measured: ignore the IV attribute and use
   seq and **exactly 1 byte** of 450,000 goes off and `sniff()`·the continuity-counter check·ffmpeg all pass it.
   It is contamination that would have been produced every time by an implementation not distinguishing "no IV
   attribute" from "IV=0."
7. **A predictable IV is not itself a vulnerability.** A chosen-plaintext attack needs all of ① next-IV
   prediction ② ciphertext observation ③ **being able to get attacker plaintext encrypted with the same key**,
   and an HLS segment has no ③ (encryption is one offline time at packaging). TLS 1.0's BEAST was a case with all
   three in place. **The conclusion is not "it is safe" but "it does not hold in this threat model," and change
   the threat model and the conclusion changes.**
8. **CBC does not authenticate.** Measured: a 1-bit ciphertext manipulation changes only 17 bytes of 450,000, and
   among them the next block's 1 bit is flipped **exactly as the attacker specified.** The verification tool gave
   a pass. Decryption success is not evidence of origin, and so today's standard is AEAD. **AES-128 does not
   replace TLS.**

---

**Next chapter** — this chapter skipped decryption's last line, `_unpad_pkcs7(plain)`. That function does not
throw an exception even when the padding is broken and passes the original as-is. Do the same behavior on a
server and it becomes the classic vulnerability called a **padding oracle**, but in this tool the opposite — it
is the correct design. Chapter 24 covers **the condition under which the same code becomes a vulnerability or a
design virtue depending on the role.**
