---
title: "Encryption Granularity Determines the Structure"
description: "Why SAMPLE-AES is rejected"
date: 2026-07-18
version: '1.0'
tags: ['streaming', 'cryptography']
thumbnail: /images/lecture/thumb/hls-recon-26-encryption-granularity.svg
---
## 26.0 What this chapter answers

1. What is **encryption granularity** — what unit is encrypted?
2. In AES-128, why does the crypto layer not need to know a single letter of the container?
3. In SAMPLE-AES, why does the very phrase "decrypt the whole segment" not hold?
4. Why does such a scheme **exist** — what had to remain plaintext?
5. What does the path sent down after rejection actually do — and what can it not do?

This chapter is the last of Part 5, and following Chapters 23–25 covering "how to undo AES-128" and "what it
protects," it covers **"why some ciphers were decided not to be undone at all."** The answer is unrelated to the
cipher's strength. SAMPLE-AES's algorithm is the same AES-128-CBC. What differs is only **what that transform is
applied to.**

---

## 26.1 The problem — what one line rejects

The code judging support in this repository is two lines.

```python
# playlist.py:57-64
    @property
    def is_encrypted(self) -> bool:
        return self.method != "NONE"

    @property
    def is_supported(self) -> bool:
        # SAMPLE-AES is per-frame partial encryption so whole-segment decryption is impossible.
        return self.method in ("NONE", "AES-128") and self.keyformat == "identity"
```

The values `METHOD` can take are three per RFC 8216 ([`playlist.py:52`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L52)'s comment enumerates them as-is).

| `METHOD` | What it encrypts | This repository |
|---|---|---|
| `NONE` | nothing | passes through |
| `AES-128` | **the whole segment** | supported |
| `SAMPLE-AES` | **only the body of media samples** | rejected |

What to note here is the **basis** of rejection. `is_supported` does not reject because the cipher is weak.
SAMPLE-AES uses the same AES-128-CBC as AES-128. The key length is the same and the mode is the same. The basis of
rejection is only one —

> **The unit the crypto transform is applied to differs, and that difference moves the very place where the
> operation "decryption" holds.**

[`playlist.py:63`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L63)'s one comment line is a summary of this whole chapter. This chapter unfolds that one line.

---

## 26.2 The principle — encryption granularity

> **Term** — **encryption granularity**: the minimum unit the crypto transform is applied to. It is the **what**
> in "what one thing is encrypted whole." It can be one file, one block, or one frame.

It is the same axis as when Chapter 11 covered **interpretation granularity** (when a signed URL is interpreted),
but the target differs. There it was a granularity on the time axis, and here it is a **granularity on the byte
axis.**

### 26.2.1 AES-128 — the granularity is the segment

RFC 8216's `METHOD=AES-128` views one segment as **one plaintext.** The whole segment is a single CBC chain,
ciphertext from front to end. Decryption ends like this.

```python
# decrypt.py:44-47
        iv = key.iv if key.iv is not None else seq.to_bytes(16, "big")
        dec = Cipher(algorithms.AES(self.material(key)), modes.CBC(iv)).decryptor()
        plain = dec.update(data) + dec.finalize()
        return _unpad_pkcs7(plain)
```

**Nowhere in these four lines is the word "TS" or "MP4."** `data` is just a byte string and the result is a byte
string. When decryption ends, that byte string becomes a **plain MPEG-TS segment**, and from then it takes exactly
the same path as if there had been no cipher — the concatenation seen in Chapter 19, the packet analysis of
Chapter 17, the PTS check of Chapter 21 all hold as-is.

This is **layer separation.** Since the crypto layer's input and output are both "opaque byte strings," the
container layer need not know the cipher exists, and the crypto layer need not know the container exists.

### 26.2.2 SAMPLE-AES — the granularity is the sample

> **Term** — **sample**: a data unit corresponding to one instant in a media container. For video it is one screen
> (frame), for audio one audio frame.

> **Term** — **partial encryption**: a scheme encrypting only part of the data and leaving the rest plaintext.
> What is left is usually **the information needed to read the structure.**

SAMPLE-AES takes as its granularity not the segment but **each individual sample.** As a result, where the
ciphertext sits inside the segment splits like this.

![The contrast of where ciphertext sits in AES-128 and SAMPLE-AES](/images/lecture/hls-recon/26-granularity-map.svg)

*Figure 26-1 — where ciphertext sits in the same segment*

Enumerate what remains plaintext and it is the following.

| What remains plaintext | Why it remains |
|---|---|
| TS packet header (sync byte · PID · CC) | needed for relay·multiplexing — Chapter 17 §17.8.1 |
| adaptation field · PCR | lose the time reference and playback does not hold |
| PSI (PAT · PMT) | you must know which streams are contained |
| PES header (PTS · DTS) | not knowing the presentation time, you can neither edit nor seek |
| the **front part** of each sample | the spot where the frame's kind·size is read |

What remains ciphertext is **only the sample body.** In this structure the operation "decrypt the whole segment"
is undefined. Push the whole segment through CBC and even the header that should be plaintext is treated as
ciphertext and **normal data is destroyed.** Not knowing from where to where the ciphertext stretch is, you cannot
even start decryption.

### 26.2.3 So what must you know

To know the ciphertext stretch's boundary you must parse the below in order.

| Step | What must be found | Which layer's knowledge |
|---|---|---|
| 1 | TS packet boundaries and per-PID separation | container |
| 2 | PES packet reassembly — one sample spanning several packets | container |
| 3 | sample boundary — where does one frame end | container + codec |
| 4 | the encrypted stretch **inside** the sample | **codec** |
| 5 | per-codec rules (leader length·encryption period) | **codec** |

Steps 4·5 are decisive. In H.264 a sample consists of **NAL units**, and the spec defines a pattern that leaves a
plaintext leader of a certain length in front of each NAL unit and then encrypts after it in **skipped** 16-byte
block units. AAC has a different structure so the rule differs too.

> **Term** — **NAL unit (Network Abstraction Layer unit)**: the transport unit of an H.264/H.265 bitstream. It
> consists of a header indicating its kind and a payload after it, and usually one slice is held in one NAL unit.

> **Term** — **pattern encryption**: a partial-encryption scheme alternating encrypted blocks and plaintext blocks
> at a fixed ratio. Its purpose is to reduce the decryption cost while still making the content unusable.

**Written honestly.** The leader's exact byte count and the encryption period are stipulated per codec by Apple's
«MPEG-2 Stream Encryption Format for HTTP Live Streaming», and this course did not cross-check those figures
against the original (§26.8). And this chapter's thesis does not need those figures. What is needed is **the fact
itself that the figures differ per codec.** If they differ per codec the crypto layer must know the codec, and at
that moment the layers entangle.

### 26.2.4 Layer coupling follows from a design decision

> **Term** — **coupling**: a state where one module can operate only if it knows another module's internal
> structure. With strong coupling, a change on one side breaks the other.

![The contrast of the range the crypto layer must know in AES-128 and SAMPLE-AES](/images/lecture/hls-recon/26-layer-coupling.svg)

*Figure 26-2 — the data flow is the same; only the range the crypto layer must know differs*

What to note in this diagram is that **the arrows are identical on both sides.** On either side data flows in one
direction, crypto layer → container layer → codec layer. What differs is only the **range of knowledge** marked by
the dotted line.

> **Layer coupling arises not from writing the code wrong but is forced to follow from the design decision "what to
> leave plaintext."**

This is the identity of the phenomenon this chapter covers. Whoever implements SAMPLE-AES does not entangle the
layers because they want to. **There is no way to implement it without entangling them.**

---

## 26.3 Why SAMPLE-AES exists

Describe partial encryption as "a needlessly complex scheme" and end there and the symmetry is off. This scheme
came from a clear demand, and that demand cannot be met with AES-128.

Write the common demand in one sentence and it is this.

> **A man-in-the-middle without the key must be able to process the stream.**

| Demand | Info that must be plaintext | With whole-segment encryption |
|---|---|---|
| **ad insertion·splicing** | the splice point, PTS, segment boundaries | you cannot even know where to cut without the key |
| **trick play** (speed·seek) | frame kind (I/P/B) and presentation time | you cannot find I-frame positions so seeking is impossible |
| **re-packaging** (TS ↔ fMP4) | all sample boundaries | you must undo and re-apply — the packager comes to hold the key |
| **multi-track multiplexing** | PID, stream kind | the relay does not know what it is carrying |
| **partial caching·quality switching** | packet·sample boundaries | the reuse unit is fixed at the segment |

> **Term** — **trick play**: playback actions other than sequential playback, like speed playback·rewind·seek.
> Usually only I-frames (frames referencing no other frame) are picked out.

> **Term** — **splicing**: the work of cutting and joining boundaries to insert another stream (an ad, etc.) into
> the middle of a stream.

The five rows share the same structure. None of them **needs to see the content.** What is needed is **the
authority to see the structure.** AES-128 encrypts content and structure bound into one, so to see the structure
you must give even the authority to see the content.

The principle seen in Chapter 17 §17.8.1 repeats one layer deeper.

> **Information needed for the relay cannot be encrypted.**

SAMPLE-AES replaced the "relay" of this sentence with **processing.** It is a decision to leave even the info
needed for processing plaintext, and so the plaintext region widened from a 4-byte header to **the whole container
structure.**

Put another way, deciding the encryption granularity is **deciding where to put the trust boundary.**

| Scheme | What can be done without the key | Actor that must hold the key |
|---|---|---|
| AES-128 | only move and cache the segment file | the player + every man-in-the-middle processing the stream |
| SAMPLE-AES | cut·join·re-package·track-select·seek | **only the player** |

**SAMPLE-AES reduces the number of actors holding the key.** From the least-privilege principle's view (Chapter 15
§15.5) this is an improvement. The price of that improvement is §26.2's layer coupling.

---

## 26.4 The code — how rejection is implemented

### 26.4.1 Declaration stage — judge as soon as it is parsed

Since `is_supported` is a property of the `Key` object, the moment the playlist is parsed ([`playlist.py:307-316`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L307-L316)'s
`#EXT-X-KEY` handling) it is already in a judgeable state. The two conditions are bound by **and.**

| Condition | What it excludes | Chapter |
|---|---|---|
| `method in ("NONE", "AES-128")` | SAMPLE-AES — **this chapter** | 26 |
| `keyformat == "identity"` | Widevine · FairPlay · PlayReady family | 25 |

The targets the two conditions reject are entirely different in nature. The former rejects **because the structure
does not match**, and the latter rejects because **the very path to obtain the key is a different system.** They are
bound in one expression but the reasons are two.

### 26.4.2 Decryption stage — one method knows nothing of the container

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

Three branches.

| Branch | Condition | What it does |
|---|---|---|
| pass | `METHOD=NONE` | returns the input as-is — the crypto layer becomes the identity function |
| reject | an unsupported scheme | immediate stop with `NotImplementedError` |
| decrypt | AES-128 · identity | CBC once, padding removal once |

**The second branch is this chapter's protagonist.** What happens if you do not throw an exception here. A
SAMPLE-AES segment enters the third branch and the whole segment receives one CBC decryption, and the TS header
that was plaintext turns into random bytes. The result is garbage that is neither TS nor SAMPLE-AES. **Do not
reject and it destroys the data.**

And the third branch's code is exactly as seen in §26.2.1 — it handles `data` as a byte string only. This whole
module is 58 lines, and in it there is not a single identifier pointing at a container. The same file's first-line
comment already declared that fact.

```python
# decrypt.py:5
The key itself is downloaded as plaintext 16 bytes from a URI — link-protection level, not DRM.
```

Had SAMPLE-AES been supported, what would this module have had to hold.

| What is needed | Rough nature | Already present |
|---|---|---|
| TS demultiplexing | per-PID separation, packet reassembly | no — `tsanalyze.py` **only checks** and does not reassemble |
| PES reassembly | restoring a sample spanning several packets | no |
| H.264 NAL parser | start-code search, unit boundaries | no |
| AAC frame parser | ADTS header interpretation | no |
| per-codec partial-decrypt rules | leader length·pattern | no |
| the fMP4 path's counterpart | sample-auxiliary-info box interpretation | no |

All six items are **container·codec layer code.** And this repository already declared it would not make that
layer.

```python
# assemble.py:1-6
"""Reassembly layer — all actual container work is delegated to ffmpeg.

Segment merging·decryption·timestamp normalization are already implemented per spec
by ffmpeg's hls/mpegts demuxer, so they are not rebuilt here. This module's responsibility
is only "with what arguments to delegate" and "how to measure progress."
"""
```

**SAMPLE-AES support collides head-on with this declaration.** To implement partial decryption you must make the
very thing said "not rebuilt here." Rejection is not laziness but a **decision to keep the module boundary.**

### 26.4.3 The consequence of rejection — mode downgrade

```python
# cli.py:391-402
def _decide_mode(args: argparse.Namespace, pl: playlist.Playlist) -> str:
    """auto-mode decision — if segment-unit measurement is impossible, drop to ffmpeg delegation."""
    if args.mode != "auto":
        return args.mode
    unsupported = [s for s in pl.segments if s.key and s.key.is_encrypted and not s.key.is_supported]
    if unsupported:
        _eprint("  · SAMPLE-AES etc. cannot be decrypted segment-by-segment → switching to remux mode")
        return "remux"
    if pl.is_live:
        _eprint("  · LIVE playlist → switching to remux mode (snapshot measurement impossible)")
        return "remux"
    return "segments"
```

`auto` drops to `remux` under two conditions. One is this chapter's SAMPLE-AES, and the other is LIVE. The two
conditions look mutually unrelated but share the **same property** — both break the premise "receive segments one
by one and check one by one." LIVE because the listing is not fixed, SAMPLE-AES because it cannot be opened even
when received.

That `_decide_mode` looks at `args.mode != "auto"` first is intentional too. If the user gives `--mode segments`
explicitly, it does not downgrade. In that case [`decrypt.py:36-40`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L36-L40)'s `NotImplementedError` blocks it instead —
**the judgment is two-ply**, and the outer ply handles convenience (auto switching) and the inner ply safety
(preventing data destruction).

### 26.4.4 What the downgrade loses

The downgrade is not free. In `remux` mode this tool does not receive the segments itself, so a check that can only
be done by looking at the segments disappears wholesale. That cut face is right there in the code.

```python
# cli.py:632
        ts=run.ts if mode == "segments" else None,
```

The measured check-list contrast (the same stream, same tool, of §26.5).

| Check | `segments` mode | `remux` mode | What the check looks at |
|---|---|---|---|
| playlist | ✓ | ✓ | declared values |
| segment receive | ✓ | **absent** | per-request success·retry |
| response latency | ✓ | **absent** | TTFB p50/p95 |
| payload validity | ✓ | **absent** | leading byte (Chapter 14) |
| segment uniqueness | ✓ | **absent** | SHA-256 duplicate |
| TS integrity | ✓ | **absent** | CC loss·**scrambling control** (Chapters 17·18) |
| length consistency | ✓ | ✓ | output |
| stream composition | ✓ | ✓ | output |
| timeline continuity | ✓ | ✓ | output (Chapter 21) |
| full decode | ✓ | ✓ | output |

**It drops from 10 to 5.** What hurts especially is TS integrity. Chapter 17 §17.9.3 called this check "the last
net for when the previous three verdicts are all wrong," and downgrade lifts that net itself. The remaining five
are all **checks that open the output to look**, and the actor that made the output is the ffmpeg just delegated
to.

> **Delegation hands over not just the work but the observation point too.** If Chapter 14 §14.5.4 said delegation
> inherits the policy, here delegation makes you **give up measurement.**

---

## 26.5 Measured — what happens if you do not reject

Up to here is the story following from the spec and code. I measured locally what actually happens.

### 26.5.1 Experiment design

No external stream is used. In the same way as Chapter 14 §14.5, I sent a **self-made 4-second test pattern**
(`testsrc2` + `sine`, H.264 + AAC, 2 segments) and a 16-byte key file pulled from `/dev/urandom` out over a local
HTTP server, and **declared** the same segments differently by changing only the playlist's `#EXT-X-KEY`
declaration.

That is, in this experiment **the segment content is all the same and only the declaration differs.** Neither
protected content nor an actual key-distribution system is involved. The measurement target is not the content but
**the tool's reaction.**

Measurement environment: ffmpeg 8.1.1 · macOS · `python3 -m http.server` · local loopback.

### 26.5.2 How does ffmpeg react

| The playlist's `#EXT-X-KEY` declaration | ffmpeg exit code | What was observed |
|---|---|---|
| none (control) | `0` | decoded with no error |
| `METHOD=AES-128, URI="enc.key"` | `183` | `Error when loading first segment` · `Invalid data found` |
| `METHOD=SAMPLE-AES, URI="enc.key"` | **`0`** | opens. **only the frames destroyed** |
| `METHOD=SAMPLE-AES, KEYFORMAT="com.apple.streamingkeydelivery", URI="skd://…"` | `183` | `Unable to open key file skd://…` |

The contrast of the second and third rows is this chapter's core. **The bytes are completely the same and only
the declaration differs, yet the results are opposite.**

- **declared as AES-128** — ffmpeg CBC-decrypts the whole segment. The TS header that was plaintext becomes random
  bytes, and the result is no longer TS. **The container parsing itself fails and it hard-fails immediately.** (The
  internal behavior is read in reverse from the error message. The observed fact is only up to "it fetched the key
  and failed to open the first segment.")
- **declared as SAMPLE-AES** — ffmpeg applies the decrypt transform only to the sample body. **It does not touch
  the container so everything is intact.** The packets, the PTS, the frame count are all normal. What is destroyed
  is only the screen content.

Compare the outputs and it comes out like this.

| Output | Size | ffprobe play length |
|---|---|---|
| control (no declaration) | 424,822 bytes | 4.040272s |
| SAMPLE-AES declaration | 424,625 bytes | **4.040272s** |

**The length is the same to the sixth decimal place and the size differs by 0.05%.** The sentence Chapter 0 took as
its starting point appears again — the total length matches but the middle is empty. This time it is not "the
middle is empty" but **"everything is in but none of it is usable."**

> **Coarse granularity collapses immediately when wrong; fine granularity looks fine when wrong.** A coarse
> granularity's failure is noisy and a fine granularity's failure is quiet.

### 26.5.3 How does this repository's tool react

I put the same SAMPLE-AES-declared playlist into `hls-recon`.

```
    encryption    : SAMPLE-AES
    type          : VOD
  · SAMPLE-AES etc. cannot be decrypted segment-by-segment → switching to remux mode
```

`_decide_mode` fires as designed. Set the verdict result side by side with the control and it becomes this.

| Check | Control (plaintext, `segments`) | SAMPLE-AES declaration (`auto`→`remux`) |
|---|---|---|
| playlist | ✓ | ✓ |
| segment receive | ✓ both 2 | — |
| payload validity | ✓ all media | — |
| segment uniqueness | ✓ | — |
| TS integrity | ✓ 2,382 packets 0 loss | — |
| length consistency | ! drift +0.04s | ! drift +0.04s |
| stream composition | ✓ h264 320x180 + aac | ✓ **identical** |
| timeline continuity | ✓ 120 frames 0 missing | ✓ **identical** |
| full decode | ✓ no error | ✗ **21 errors** |
| **verdict** | WARN (length drift) | **FAIL** |

**Not a single structure-viewing check catches.** The 120 frames are all there, the interval is uniform at 33.3ms,
and the stream composition is the same. It cannot be otherwise — SAMPLE-AES is a **scheme that does not touch the
structure.** A structure-based check cannot, in principle, see this damage.

What it caught is the last one only, **full decode.** And that has an option to turn it off.

```
$ hls-recon … --no-decode-check
  verdict: WARN — needs checking        ← exit code 0
```

Give `--no-decode-check` and **the verdict does not differ from the control by a single letter.** Both are WARN,
both point only at one length drift, both are exit code 0. A file with the whole screen broken and a fine file get
the same verdict.

> **The finer the encryption granularity, the easier it is for an output "structurally intact but content-only
> destroyed" to come out, and such an output is indistinguishable from normal until you actually decode the
> content.**

This is one strand of the reason this repository keeps the costly full-decode check on by default ([`cli.py:1066`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L1066)
put a flag only on the turning-off side — default is on).

### 26.5.4 If you force `segments`

```
$ hls-recon … --mode segments
NotImplementedError: METHOD=SAMPLE-AES KEYFORMAT=identity cannot be decrypted
segment-by-segment — delegate to ffmpeg with --mode remux
```

The inner ply blocks it as expected. Only, this exception is not caught in the CLI so **the Python traceback is
output as-is** and the exit code is 1. The safety verdict works correctly, but the surface shown to the user
diverges from the diagnostic format [`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)'s `_diagnose` has built (§26.8).

---

## 26.6 Generalization — coarse granularity separates, fine granularity entangles

### 26.6.1 One axis

This chapter's contrast is not limited to streaming. Write the axis in one line and it is this.

> **Making the encryption granularity finer means leaving more structure plaintext, and to be able to handle the
> left structure the crypto layer must know that structure.**

| Domain | Coarse granularity | Fine granularity | Layer entangled by going finer | What you gain by going finer |
|---|---|---|---|---|
| **HLS** | `AES-128` (segment) | `SAMPLE-AES` (sample) | container·codec parser | keyless processing·trick play |
| **fMP4·DASH** | whole-file encryption | CENC partial-sample encryption | sample-auxiliary-info box | the same asset for several DRMs |
| **storage** | full-disk encryption | per-file encryption | filesystem | per-user keys·selective sharing |
| **database** | tablespace encryption | column·field encryption | query plan·index | least privilege·partial-exposure control |
| **messaging** | transport-segment encryption | body-only end-to-end encryption | routing-header processing | not needing to trust the relay server |
| **compression** (symmetric case) | whole-file compression | chunk-unit compression | index·seek layer | random access |

> **Term** — **CENC (Common Encryption, ISO/IEC 23001-7)**: the standard partial-encryption spec of ISO-BMFF-family
> containers. It records the pairs of plaintext-stretch and ciphertext-stretch lengths inside a sample as separate
> metadata, and decrypts by reading that table.

The CENC row is especially suggestive. This spec solves §26.2.3's 5-step parsing problem by **externalizing it as
metadata** — instead of the crypto layer parsing the codec, it reads a "so many plaintext bytes, so many
ciphertext bytes" table the packager precomputed. The coupling did not vanish but **moved to the container side.**
It shows coupling cannot be erased and can only be moved.

The last row is put in as a symmetric non-crypto case. Compress one file whole and you cannot read from the
middle; split it into chunks and you can read but must manage a chunk-boundary table. **Leave structure and a
feature arises and a management target rises** — whether compression or crypto, it is the same scale.

### 26.6.2 There is a reverse direction too

The real axis is not the granularity itself but **how much structure is left plaintext**, and that axis is
bidirectional. A case that moved in the opposite direction is QUIC's header protection (Chapter 17 §17.8.1). It
leaves only the bare minimum needed for relay and masks the rest of the header so an on-path observer cannot track
the connection. The price is symmetric — **what intermediate gear can do decreases.**

| Case | Structure left plaintext | What the man-in-the-middle can do | What the crypto layer must know |
|---|---|---|---|
| SAMPLE-AES | the whole container | cut·join·re-package·seek | **container + codec** |
| AES-128 | none (only segment-unit metadata) | move and cache | only the key and IV |
| QUIC header protection | the minimum needed for routing | routing only | only its own record structure |

The three rows are marks on the same scale. QUIC's move changed not the encryption **granularity** but widened the
encryption **scope**, so it is not the same kind of change as SAMPLE-AES. But the commonality is that the three
rows follow the same relationship "as much as left plaintext, the man-in-the-middle can work." Which point to pick
is decided by **whom you want to make do what**, not by cryptographic superiority.

### 26.6.3 So what do you learn

"Remove the coupling" is **not** this chapter's conclusion. SAMPLE-AES's coupling cannot be removed. To remove it
you must give up the demand, and give up the demand and you can do neither ad insertion nor trick play.

What to learn is a different sentence.

> **A design decision forces an implementation structure. So when deciding you must compute the structure that
> will follow together, and if you cannot bear that structure you must change the decision or give up that
> feature.**

What this repository did is exactly the latter. It decided not to bear the layer coupling, and instead **stated
that decision in code and doc.** Not bearing it is not itself a flaw. Pretending to bear it while not bearing it is
the flaw.

---

## 26.7 Security — the threat model of partial encryption

### 26.7.1 What is left plaintext is observed

Partial encryption's first security property follows directly from the definition. **What is left plaintext is
visible to anyone.**

| Scheme | What an on-path observer can see |
|---|---|
| AES-128 | the segments' count·size·request time |
| SAMPLE-AES | plus **the per-frame size series, frame kinds, presentation times, track composition** |

The frame-size time series is fairly unique per content. Encode with variable bitrate and frames grow at scene
changes and shrink in static scenes, so that series itself can work like a fingerprint. It is known that there
exists a research strand trying to identify viewed content by the size pattern of encrypted streaming traffic, but
**this course neither attempted nor measured such identification.** What can be said for sure here is only the
principled direction — **partial encryption increases the information content in that direction.**

This is not a defect of SAMPLE-AES but **the price of the demand.** §26.3's five demands were all "the
man-in-the-middle must be able to see the structure," and what is visible to the man-in-the-middle is visible to
the observer too. You cannot open access to only the chosen target.

### 26.7.2 The parser comes inside the crypto boundary

The second property is more important practically.

> **Make the granularity finer and the container·codec parser enters the same trust region as the code holding
> the key.**

An AES-128 decryptor has almost nothing to verify in the input. Just whether the length is a multiple of 16 and
whether the padding is intact, and even that this repository quietly passes past on padding failure in
`_unpad_pkcs7` (Chapter 24). A SAMPLE-AES decryptor, by contrast, **must read structure fields the attacker can
control** — PES length, NAL size, sample count. The vulnerability class "a parser that trusted the length field"
seen in Chapter 20 reproduces here as-is, and this time that code **holds the key in memory.**

| Configuration | Code inside the trust region | Input-verification burden |
|---|---|---|
| AES-128 | CBC decrypt + padding removal | effectively none |
| SAMPLE-AES | TS·PES·NAL·ADTS parser + partial decrypt | **the full range of parser vulnerabilities** |

This repository ended the crypto layer in 58 lines of `decrypt.py`. So **it has no way to have those parser
vulnerabilities.** The decision not to support keeps the attack surface at 0.

> **A feature not implemented has no vulnerability.** Feature reduction is the surest mitigation, and its only cost
> is not being able to use that feature.

This sentence is easy to abuse. Reject even needed features with the logic "not making it is safe" and the tool
becomes useless. The balance point is **who needs that feature.** This tool is a verification tool, and its
verification target is a stream one has access to. SAMPLE-AES is usually deployed together with a DRM system so it
is not this tool's target in the first place.

### 26.7.3 Declaration-based rejection and incidental failure

I measured one more thing in the same experiment. I put into ffmpeg a playlist declaring `KEYFORMAT` as a
non-identity value while leaving the key URI as an ordinary HTTP address.

| Declaration | ffmpeg result |
|---|---|
| `KEYFORMAT="com.apple.streamingkeydelivery"`, `URI="skd://…"` | fail — **because it could not open the key URI** |
| `KEYFORMAT="com.apple.streamingkeydelivery"`, `URI="http://…"` | **opens** — does not look at `KEYFORMAT` and proceeds as-is |

**ffmpeg did not reject by looking at the `KEYFORMAT` value.** The reason the front row failed is that it could not
open the URI scheme `skd://`, and make the key actually fetchable and it proceeds as-is.

The **incidental defense** named in Chapter 15 appears again here — a state where a control does not actually
judge and block but looks blocked because another circumstance is blocking in front of it. This repository does
the opposite.

| | The basis of rejection | If the basis vanishes |
|---|---|---|
| ffmpeg (observed behavior) | cannot open the key URI | make it openable and it proceeds as-is |
| [`playlist.py:57-64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L57-L64) | **the declared value itself** | does not change |

> **Reject explicitly on the basis of the declaration.** Lean on incidental failure and, the day that coincidence
> vanishes, no one notices.

Only, declaration-based rejection has a limit too. `is_supported` believes the playlist's **self-report** (exactly
Chapter 5's subject). If the playlist wrote `METHOD=AES-128` but the actual segment is a different scheme, this
verdict passes, and what is left then is only Chapter 17 §17.9's scrambling-control check. And as seen in §26.4.4,
**downgrade and that check does not run either.** It means there exists a stretch where a verdict believing the
self-report and a verdict looking at the bytes are simultaneously deactivated under the same condition.

### 26.7.4 The defender's view

| Role | What to do |
|---|---|
| **delivery·packaging operator** | when choosing partial encryption, write what you gain (keyless processing) and what you lose (structure exposure) together. not the fact "it is encrypted" but **what was left plaintext** is the threat model's input |
| **player·library implementer** | implement partial decryption and the parser enters the same trust region as the key. length·offset field verification must be audited **at the same level** as the crypto code |
| **verification-tool maker** | a structure-based check **cannot in principle** catch partial-encryption damage. keep a check that actually decodes the content on by default, and leave turning it off to the user's explicit choice |
| **tool user** | know what an option like `--no-decode-check` turns off. in this chapter's measurement, that one option turned a FAIL into a WARN |
| **spec designer** | when defining partial encryption, design toward minimizing "what the decryptor must parse." CENC pulling the plaintext·ciphertext length table out as container metadata is that direction |
| **auditor** | when you see the sentence "AES-128 encrypted," **ask the granularity.** the same algorithm name can mean an entirely different exposure level |

---

## 26.8 Limits and open questions

Written honestly. This chapter mixes what was measured and what stayed inference.

- **Could not make a real SAMPLE-AES stream.** §26.5's experiment made a decrypt transform be applied by
  **declaring** SAMPLE-AES on a plaintext segment, which is the **mirror image** of opening an actual SAMPLE-AES
  stream with a wrong key. The property meant to be observed (the container is intact and only the sample is
  destroyed) is the same on both sides, but I do not claim the two situations are identical. To settle it a
  SAMPLE-AES packager is needed.
- **Did not cross-check the per-codec partial-encryption rules' figures against the original.** §26.2.3's
  "plaintext leader + skipped encryption" is the rule's **form**, and the concrete values of leader length·
  encryption period are not values this course confirmed. This chapter's thesis does not depend on those values.
- **Did not confirm the container-side signal form.** The decryptor must know which stream·which sample is an
  encryption target and that info must be inside the container, but what concrete form that signal takes (a PMT
  descriptor, etc.) could not be confirmed. It is inference.
- **The README's limit narrative and the measurement diverge.** `README.md:411-413` reads like this.

  > **SAMPLE-AES / DRM**: per-frame partial encryption or streams protected by Widevine·FairPlay
  > are not targets. `auto` mode drops to `remux`, but ffmpeg cannot decrypt them either
  > so it fails.

  The latter sentence does not hold as-is on current ffmpeg. In §26.5.2 ffmpeg 8.1.1 did not reject the
  `METHOD=SAMPLE-AES` declaration and **fetched the key and attempted per-sample decryption**, ending with exit
  code 0. It is true it fails when `KEYFORMAT` is not identity, but the reason for that failure, as seen in
  §26.7.3, is not "because it could not decrypt" but "because it could not fetch the key." Until confirmed with a
  real SAMPLE-AES stream and the correct key, **the README's narrative can be asserted neither wrong nor right.**
  But the reason it gives diverges from this measurement.
- **There is no SAMPLE-AES case in the regression test.** `tests/run.sh:174` fixes AES-128 decryption, but there
  is no test fixing the rejection path. That is, §26.4's two-ply judgment is **not protected by a test.** From
  Chapter 34's oracle-problem view, the behavior this chapter narrated was confirmed by measurement but is not
  fixed by regression.
- **The forced-`segments` path's surface is rough.** §26.5.4's `NotImplementedError` is not caught in the CLI so
  it is exposed as a traceback. The verdict itself is right and the data is not destroyed, but it diverges from the
  diagnostic format [`cli.py:57-102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L57-L102)'s `_diagnose` has set up.
- **The report mislabels the encryption scheme.** The console structure output shows the actual `METHOD` as-is
  ([`cli.py:200-207`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L200-L207)), but the value passed to the report is one boolean.

  ```python
  # cli.py:629
          encrypted=any(s.key and s.key.is_encrypted for s in media.segments),
  ```

  ```python
  # report.py:156
          f"TARGETDURATION {target_duration:g}s, encryption {'AES-128' if encrypted else 'none'}",
  ```

  Since the `METHOD` string is discarded at the boundary, a SAMPLE-AES stream's report too gets **"encryption
  AES-128"** printed. In §26.5.3's run it was actually output that way — `SAMPLE-AES` on the console, `AES-128` in
  the report. No effect on the verdict, but it is a spot to fix in that, **while this whole chapter says "the
  scheme name is the exposure level," the report erases the scheme.**
- **Did not quantify the partial-decrypt implementation cost.** How many lines §26.4.2's six items actually are,
  and how much they invade the existing module boundaries, was not estimated. The basis for the judgment "decided
  not to bear it" is the items' **nature** (all container·codec layer), not a measured size.

---

## 26.9 Summary

1. **Encryption granularity** is the minimum unit the crypto transform is applied to. AES-128's granularity is the
   segment and SAMPLE-AES's is the sample. **The algorithm is the same AES-128-CBC for both** — what differs is
   only what it is applied to.
2. If the granularity is the segment, the decryption result becomes a plain container, so **the crypto layer need
   not know the container.** Within `decrypt.py`'s 58 lines there is not a single identifier pointing at a
   container.
3. If the granularity is the sample, the container structure and headers remain plaintext and only the sample body
   becomes ciphertext. To know the ciphertext stretch's boundary you must parse TS·PES·NAL and know even the
   **per-codec rules** — the crypto layer comes to depend on the container·codec layer.
4. That coupling is not a mistake but the shadow of the demand. The demand **a keyless man-in-the-middle must be
   able to process the stream** (ad insertion·trick play·re-packaging) required leaving the container plaintext.
   Deciding the encryption granularity is **arranging the trust boundary.**
5. This repository decided not to bear that coupling and rejects it two-ply, at the **declaration stage**
   ([`playlist.py:57-64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L57-L64)) and the **decryption stage** ([`decrypt.py:33-47`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L33-L47)), then downgrades from `auto` to
   `remux` ([`cli.py:391-402`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L391-L402)). At the price of the downgrade, **the checks drop from 10 to 5** — even Chapter
   17's last net is lifted.
6. Measured: declare the same segment as `AES-128` and ffmpeg hard-fails immediately, declare it as `SAMPLE-AES`
   and it ends with **exit code 0.** The output's play length is the same as the control to the sixth decimal,
   every structure-based check passes, and give `--no-decode-check` and the verdict does not differ from a normal
   stream by **a single letter.**
7. Generalization: **coarse granularity separates the layers and fine granularity entangles them.** Coupling
   cannot be erased and can only be moved (CENC moved it into container metadata). And **a fine granularity's
   failure is quiet** — because the structure is intact.
8. Security: partial encryption exposes the plaintext structure and pulls the parser into the same trust region as
   the key. Rejection is a decision keeping that attack surface at 0, and **the basis of rejection must be the
   declared value, not an incidental failure** (Chapter 15's incidental defense).

---

**Next chapter** — Part 5 closes with the conclusion that "what is encrypted in what unit" determines the layer
structure. Part 6 meets a problem of the same form on the time axis. A subtitle file counts its own time from 0
and the video counts on a 90kHz clock, and the basis joining the two times is only one line written in the
playlist. Chapter 27 derives the offset formula from that one line, and covers how the subtitles go off if you do
not derive it.
