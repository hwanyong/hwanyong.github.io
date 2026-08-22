---
title: "The Other Side of the Padding Oracle"
description: "Why it does not throw an exception here"
date: 2026-07-13
version: '1.0'
tags: ['streaming', 'cryptography']
thumbnail: /images/lecture/thumb/hls-recon-24-padding-oracle-inverse.svg
---
## 24.0 What this chapter answers

1. What does PKCS#7 padding do, and why does it **append one more block even when it lands exactly**?
2. What should you do when padding verification fails — throw an exception, or swallow it?
3. **Under exactly what conditions does a padding-oracle attack hold?**
4. Why are the same nine lines a vulnerability on one side and correct on the other?

The fourth question is this chapter's summit. Its answer is not inside the code. It is outside the code, in **the
place that code is set.**

---

## 24.1 The problem — a nine-line function and the decision inside it

Copy as-is one function among the shortest in this repository.

```python
# decrypt.py:50-58
def _unpad_pkcs7(data: bytes) -> bytes:
    if not data:
        return data
    n = data[-1]
    # if the padding is broken (a truncated segment, etc.) do not cut, pass the original.
    # throw an exception here and damage detection gets buried in the decryption stage.
    if 1 <= n <= 16 and data[-n:] == bytes([n]) * n:
        return data[:-n]
    return data
```

The last line `return data` is all of this chapter. **If the padding does not conform to spec, nothing happens.**
No exception, no log, and it does not carry a success flag in the return value either. The caller has no way to
know whether the padding was valid.

This is the exact opposite of what the textbook teaches. List the standard libraries' default behavior and it is
this.

| Implementation | When the padding is broken |
|---|---|
| Java `Cipher` (`PKCS5Padding`) | `BadPaddingException` |
| .NET `ICryptoTransform` | `CryptographicException` |
| OpenSSL `EVP_DecryptFinal_ex` | returns 0 (failure) |
| Python `cryptography`'s `padding.PKCS7().unpadder()` | `ValueError` |
| **this code** | **returns the original as-is** |

Only the fifth row is different. And yet this code does not solve the same problem as the libraries above. It
does the same operation but **the role differs.** This chapter covers what that difference inverts.

Since the two comment lines state the reason, the starting point is set. "Throw an exception here and damage
detection gets buried in the decryption stage." Whether this sentence is true, and if so how far true, is what
§24.3 confirms.

---

## 24.2 The principle — PKCS#7 padding

### 24.2.1 Why is padding needed

AES is a **block cipher.**

> **Term** — **block cipher**: a symmetric-key cipher operating only in fixed-length block units. AES's block
> length is 128 bits (16 bytes) at any key length.

> **Term** — **CBC (Cipher Block Chaining) mode**: the mode of operation that XORs each plaintext block with the
> previous ciphertext block and then encrypts. Decryption is `P_i = D_K(C_i) XOR C_(i-1)`, and the IV
> (initialization vector) goes into the first block's `C_0` slot. Chapter 23 covered the rule deriving the IV
> from the media sequence number.

CBC eats the plaintext only in block units. And yet the actual data length is not a multiple of 16. An MPEG-TS
segment is a multiple of 188, and 188 divided by 16 has remainder 12. A rule to fill the shortfall is needed, and
the most widely used of those rules is PKCS#7.

> **Term** — **PKCS#7 padding**: the rule filling the shortfall of `n` bytes **all with the value `n`** to fill
> the block length. It originally came from RFC 2315's PKCS #7 spec and the same rule is now in RFC 5652 §6.3.
> HLS's AES-128 stipulates this padding in RFC 8216 §4.3.2.4.

### 24.2.2 The rule, and the clause that makes the rule unique

The rule itself is one line. **Fill the shortfall of `n` bytes with the value `n`.** And yet one more clause,
seemingly wasteful at a glance, attaches here.

> **If the plaintext ends exactly at a block boundary, append one whole block consisting only of the value 16
> (`0x10`).**

![The three shapes of a PKCS#7 last block](/images/lecture/hls-recon/24-pkcs7-block.svg)

*Figure 24-1 — the three shapes of a PKCS#7 last block*

**What breaks without this clause.** Say the plaintext's last four bytes are by chance `04 04 04 04` and the
length happens to be a multiple of 16. No padding was appended so this is the plaintext as-is. And yet the
removing side reads the last byte `04` and judges "4 padding bytes" and **cuts off four plaintext bytes.** Because
there is no means to tell whether padding was appended or not.

Insert the clause and this ambiguity vanishes. The invariant **padding always exists** stands, and the removal
rule becomes unique as the single one "read the last byte and cut off that much." The block that looks wasteful
is **the value that buys the determinism of removal.**

For the same reason, padding with `n = 0` is undefined. Since `n`'s range is 1–16, the single last byte is itself
the padding length. The code's `1 <= n <= 16` is this range check.

### 24.2.3 Measured — how many bytes attach to an HLS segment

How much actually attaches differs per segment. A TS segment's length is `188 × N` (N = packet count), and `188 ×
N mod 16 = 12N mod 16`, so it becomes 0 only when the packet count is a multiple of 4.

I made an AES-128 HLS stream locally and measured directly.

```
ffmpeg 8.1.1 · Python 3.14.5 · cryptography 48.0.0 · macOS 25.5.0
ffmpeg -f lavfi -i testsrc2 … -f hls -hls_key_info_file keyinfo …
```

| Segment | Ciphertext | Plaintext | Padding `n` | After stripping | Packet count |
|---|---|---|---|---|---|
| `seg000.ts` | 210,384 B | 210,384 B | **12** | 210,372 B | 1,119 |
| `seg001.ts` | 228,800 B | 228,800 B | **4** | 228,796 B | 1,217 |
| `seg002.ts` | 222,224 B | 222,224 B | **8** | 222,216 B | 1,182 |

All three values are different. Compute `12N mod 16` and it is 4·12·8 respectively, and the padding is `16 −` that
value so it becomes 12·4·8 — matching the measurements. The stripped length is exactly divisible by 188 for all
three.

> **The padding length is a property of the data, not a constant of the spec.** Nail a sentence like "an AES-128
> HLS segment always gets 16 bytes appended" as a constant into the code and only one of the three matches.

### 24.2.4 The verification procedure and its information content

The removing side's check is two conditions.

```python
# decrypt.py:56
    if 1 <= n <= 16 and data[-n:] == bytes([n]) * n:
```

First, is `n` in the valid range. Second, are the last `n` bytes **all** `n`. An implementation looking only at
the length without the second condition checks essentially nothing.

What matters here is **how weak a check** this is. Compute the probability an entirely unrelated byte string
passes this check by chance, and

```
P = Σ(n=1..16) 256^-n ≈ 1/255 ≈ 0.392%
```

and the overwhelming share of that is the `n = 1` term — because as long as the last byte is `0x01`, "the last 1
byte is all `0x01`" is always true. Count actually with 200,000 random 16-byte blocks and 801 passed (**1/249.7**,
theoretical 1/255.0 · within sampling error).

> **That a padding check passed is about a bit's worth of information about the last two blocks.** It says nothing
> about the whole segment's integrity.

This sentence is confirmed as-is in §24.3.3's measurement. Take out 12 packets from the **middle** of a segment
and the padding is still valid. Because in CBC the last plaintext block depends only on the last two **ciphertext**
blocks, and those two remain as-is even after the middle is gouged out.

---

## 24.3 The code — why this repository swallows

### 24.3.1 If it had thrown, where would that exception go

Follow the call chain from top to bottom. `_unpad_pkcs7` is called on the last line of `KeyCache.decrypt`.

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

And `decrypt` is called inside the segment loop.

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
            # received a 200 but it is not media — an error page came instead.
            bogus.append((seg.index, res.content_type, data[:16].hex()))
            _eprint(f"    ✗ seg#{seg.index} not media (Content-Type: {res.content_type or 'none'})")
            continue
        ts_total.merge(analyze(data, cc_state))
        p = work / f"seg{seg.index:06d}{ext}"
        p.write_bytes(data)
        paths.append(p)
```

**This loop has no `try`.** Going up it is the same. The exhaustive check result is this.

| Spot | Code | Catches the exception |
|---|---|---|
| [`cli.py:458`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L458) | `data = keys.decrypt(...)` | no |
| [`cli.py:587`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L587) | `run = _run_segments(...)` | no |
| [`cli.py:678`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L678) | `rep = _run_one(...)` (single run) | no |
| [`cli.py:916`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L916) | `rep = _run_one(...)` (series batch run) | **only `SystemExit`** |
| [`cli.py:1117`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L1117) `main()` | — | no global handler |

This repository throws "failures to be shown to the user" uniformly as `SystemExit` ([`cli.py:135`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L135) `:143`
`:445` `:471`, etc.). The series batch run leans on that convention and **swallows one episode's failure and moves
to the next** ([`cli.py:917-922`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L917-L922)).

Had `_unpad_pkcs7` thrown a `ValueError`, it leaks outside this convention. The results are two.

1. **Single run** — the Python stack trace is output as-is. The report is not made, and the measurements
   collected until then vanish with it.
2. **Series batch run** — just one segment of episode 7 of 27 broke, yet **episodes 8 through 27 are not run.**

The second is this decision's real weight. One truncated segment drags the remaining twenty down with it.

### 24.3.2 If it swallows, where does the damage surface

Do you make the damage vanish by not throwing an exception. No. **It goes up one layer.**

![Where one piece of damage gets its name](/images/lecture/hls-recon/24-diagnosis-path.svg)

*Figure 24-2 — where one piece of damage gets its name*

On the right path, two devices catch the damage.

**First, container determination** ([`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37) `sniff`). That function met three times in Chapters
5·14·16. If the decrypted head is `0x47` and `0x47` 188 bytes later too, it is MPEG-TS, else `unknown`. `unknown`
piles into the `bogus` list and becomes a **payload-validity FAIL** in the report ([`report.py:198-211`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L198-L211)).

**Second, the TS-continuity check** ([`tsanalyze.py:71-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L71-L121) `analyze`). What is decisive here is that the `cc_state`
dict made at [`cli.py:438`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L438) is **made outside the loop and passed to each segment.** Since the continuity-counter
state carries across segment boundaries, even if some segment's **end** is cut, it surfaces as a jump at the next
segment's first packet.

```python
# report.py:243-249
        rep.add(
            "TS integrity",
            FAIL if (ts.sync_errors or ts.scrambled_packets) else (WARN if problems else PASS),
            ", ".join(problems)
            if problems
            else f"{ts.packets:,} packets / {len(ts.pids)} PIDs, 0 loss",
        )
```

Note the verdict asymmetry. **Sync loss and undecrypted packets are FAIL, and only a CC discontinuity is WARN.**
And `_exit_code` ([`cli.py:651-652`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L651-L652)) maps WARN to 0. This fact is revisited in §24.8.

### 24.3.3 Measured — where each kind of damage is caught

I broke §24.2.3's stream's `seg000.ts` in several ways, then called this repository's `_unpad_pkcs7` · `sniff` ·
`analyze` as-is and recorded the results.

| Damage | Decryption | Padding | `sniff` | In-segment CC anomaly | Sync loss | Final diagnosis |
|---|---|---|---|---|---|---|
| none (control) | success | valid | `mpegts` | 0 | 0 | PASS |
| cut 1,024 B from the end (multiple of 16) | success | **invalid** | `mpegts` | **0** | 0 | 1 CC across the boundary → **WARN** |
| cut 1,000 B from the end | **ValueError** | — | — | — | — | traceback |
| cut 188 B from the end (1 TS packet) | **ValueError** | — | — | — | — | traceback |
| remove 188×12 B from the middle | success | **valid** | `mpegts` | 1 | **1** | **FAIL** |
| wrong key | success | invalid | **`unknown`** | — | — | payload-validity **FAIL** |
| wrong IV (seq 0↔7) | success | valid | `mpegts` | 0 | 0 | **PASS — not detected** |

There are four things to read in this table.

**(1) Padding invalidity is useless as a damage signal.** Taking out 12 packets from the middle, the padding was
still valid. Because, as computed in §24.2.4, only the last two blocks need be intact. Conversely, cut the end and
the padding becomes invalid, but that fact means not "decryption went wrong" but "transmission was cut." **The
padding check and the integrity check are rulers measuring different things in the first place.**

**(2) A wrong key is caught by `sniff`, not padding.** And caught much more surely. The probability a random byte
string passes `sniff` is about 1/65,536 (leading `0x47` is 1/256, `0x47` 188 bytes later is 1/256), two orders of
magnitude lower than the padding check's 1/255. **To find out the key is wrong, padding is not needed.**

**(3) The cause gets its name in the layer where it was observed.** The real cause of a segment cut at the end is
a transmission loss. And that fact is written in the report as the sentence "1 CC discontinuity (packet loss)."
Had it thrown an exception, the same event would have been written as "decryption failure" — **a wrong sentence,
and whoever read that sentence digs the wrong place, suspecting the key and IV.**

**(4) The locality of the diagnosis is maintained.** An exception loses context as it rides up the stack. The
information "ValueError at seg#7" remains, but "so were the remaining 26 segments fine" does not. The swallowing
side gives an **aggregated verdict** after processing all 27.

### 24.3.4 And this policy has a hole

Do not just pass over the table's rows 3·4. **Cut 1,000 bytes or 188 bytes and an exception arises.**

```
ValueError: The length of the provided data is not a multiple of the block length.
```

This exception comes not from `_unpad_pkcs7` but **one line above it**, at [`decrypt.py:46`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L46)'s `dec.update(data) +
dec.finalize()`. The CBC decryptor cannot finalize if the input is not a multiple of 16.

So the exact statement is this.

> **The policy "do not throw an exception on a padding error" applies only to the padding-verification layer.
> The block-alignment layer still throws an exception, and nowhere catches that exception.**

Since the probability a cut length is a multiple of 16 is 1/16, **15/16 of truncated segments go to that failure
path §24.3.1 described.** It means the counterexample the comment stated ("a truncated segment, etc.") is
actually not blocked in most cases. It is the spot where this code's intended design and its actual behavior
diverge, and the code makes no mention of this. Recorded as an open question in §24.8.

---

## 24.4 The principle — the padding-oracle attack

Now look at the other side. What happens when the same behavior "verify the padding and report the result" is on
a server.

### 24.4.1 The holding conditions are three

> **Term** — **padding oracle**: an interface that decrypts a submitted ciphertext and then makes externally
> distinguishable **whether the padding conforms to spec.** The information told is effectively 1 bit, but if you
> can obtain that 1 bit repeatedly, you can recover the plaintext without the key.

It is a special case of the oracle defined in Chapter 10. Split the holding conditions into items and there are
three.

| Condition | Content | Without it |
|---|---|---|
| **(a) repeated submission** | the attacker can **resubmit the tampered ciphertext as much as wanted** | you get 1 bit once and it ends. the attack does not hold |
| **(b) distinguishable response** | the receiver responds differently to a **padding error** and **other errors** (whether by error code·message·response time·connection handling) | if the responses are the same you cannot get the 1 bit |
| **(c) observability** | the attacker can **see** that difference | if it is left only in the server's internal log it is not a channel |

Break even one of the three and the attack does not hold. Conversely, stand all three, and **an attacker with no
knowledge of the key recovers the plaintext block by block.**

### 24.4.2 Why 1 bit gives up the plaintext — at a concept level

The CBC decryption formula is all.

```
P_i = D_K(C_i) XOR C_(i-1)
```

`D_K(C_i)` is a value the attacker does not know, but **a constant that does not change as long as `C_i` is
fixed.** And `C_(i-1)` is a value the attacker can swap out wholesale. That is, the attacker can make and submit
`P_i` as **the XOR of a value they chose and the unknown constant.**

Attach conditions (b)·(c) here, and the receiver answers **whether the end of the `P_i` so made is a valid PKCS#7
padding shape.** One answer of "valid" gives an equation for the unknown constant's last byte. Know that constant
and `P_i`'s original last byte comes out directly by **XORing with the original `C_(i-1)`.** The same procedure
continues to the inner bytes.

> This course writes only up to here. In what order and how the bytes are searched, and how the requests are
> constructed, is an **executable attack procedure** so it is not covered. What is needed to understand the
> principle is the three paragraphs above, and what is needed for defense is §24.6.

Note only the scale. The queries needed to determine one byte are at worst 256· **on average 128**, and one
16-byte block is 16 times that. This figure is a literature value widely cited since Vaudenay's 2002 paper and **is
not a value this course measured.** What Chapter 10 §10.6's oracle-comparison table ("padding oracle — 1 bit of
the decrypted padding validity — average 128 per byte") points to is this value.

Historically this form has repeatedly become a real-world reality.

| Event | Year | What became the oracle |
|---|---|---|
| Vaudenay's CBC padding attack | 2002 | formalized conditions (a)(b)(c) in a paper |
| ASP.NET padding oracle (MS10-070) | 2010 | **a different HTTP status code** for a padding error and other errors |
| Lucky Thirteen | 2013 | the response code is the same but the **MAC computation time** differed |
| POODLE | 2014 | SSL 3.0's padding bytes were **not protected by the MAC** |

The 2010 one is a case where condition (b) is blatant, and the 2013 one is a case where (b) holds **only by
timing.** The latter is far harder to handle, and so §24.6.2 is placed separately.

### 24.4.3 How the three conditions break in this code

Fill the same table against this repository.

| Condition | Server (vulnerable case) | This repository's `_unpad_pkcs7` |
|---|---|---|
| **(a) repeated submission** | the attacker repeats HTTP requests | **does not hold.** what calls this function is the user themselves, and the ciphertext is what the user received. there is no party to submit to |
| **(b) distinguishable response** | responds to a padding error with a different code·message·time | **does not hold.** it does not make a response in the first place. the return value does not carry a success flag |
| **(c) observability** | the attacker sees the response | **does not hold.** the only thing seeing the result is the process itself |

All three break. But stopping here is seeing only half. The real point is the following.

> **Swallowing the error in this code is not a "dangerous but luckily fine" choice. The swallowing side raises the
> diagnostic accuracy — it is an actively correct choice.**

The reason a server makes the errors indistinguishable (so as not to give the attacker 1 bit) and the reason this
tool swallows the error (so as to attribute the damage's cause to the correct layer) are **different reasons that
happen to point the same direction.** The conclusion being the same does not mean the basis is the same.

---

## 24.5 Generalization — a vulnerability is not a property of the code

### 24.5.1 The proposition

Write this chapter's core proposition in one sentence.

> **The same code becomes a vulnerability or a virtue depending on the role. A vulnerability is not a property of
> the code but the relationship between the code and the threat model.**

> **Term** — **threat model**: a statement specifying what you protect (assets), from whom you protect (the
> attacker and their capabilities), and how far you trust (the trust boundary). Without these three set, no code
> can be judged safe or dangerous.

Put `_unpad_pkcs7` into a static analyzer and a warning "ignores a padding-verification failure" can come out.
That warning is **not wrong but not a verdict.** A verdict needs the third term.

```
verdict = f(code, threat model)
```

Put a different second term into the same first term and a different value comes out. A tool·rule·checklist
answering from the first term alone, omitting the second term of this function, makes **both false positives and
false negatives.**

### 24.5.2 The same form within this repository

Gather the spots where the same structure appeared in this course and it is the following. All four are a choice
between **revealing information and hiding it**, and for all four the answer inverts if the role inverts.

| Chapter | Code·behavior | In a client verification tool | On a server |
|---|---|---|---|
| Chapter 5 | `_diagnose` — outputs the failure cause in detail | **virtue** — information content makes the diagnosis | **vulnerability** — a detailed diagnosis is detailed to the attacker too |
| Chapter 16 | `sniff` — ignores the declaration and determines by content | **virtue** — the determination result decides only classification | **vulnerability** — if the determination result decides execution it is an XSS vector (hence `nosniff`) |
| Chapter 22 | publishes the gap threshold in the report | **virtue** — the auditor computes a PASS's range | **vulnerability** — publishing the detection threshold is distributing an evasion manual |
| **Chapter 24** | **swallows the padding error** | **virtue** — the damage gets its name in the layer where it was observed | **vulnerability** — a distinguishable response is a padding oracle |

The fourth row has one thing different from the first three. Chapters 5·16·22 had **revealing information** as the
virtue on the client. Chapter 24 is the opposite — **hiding information** is the virtue. The direction is opposite
but the principle is the same — either way, **what the determination result opens to whom** decides the answer.

### 24.5.3 The same form outside the domain

| Behavior | Where it is a vulnerability | Where it is a virtue |
|---|---|---|
| guide login failures distinguished by cause | a public service's login — user enumeration | an internal admin console's audit log — cause identification |
| early-return the comparison | secret comparison — timing leaks the prefix length | ordinary string comparison — performance |
| compress the response | a response with a secret mixed in — a CRIME·BREACH-style guessing channel | a static asset — bandwidth saving |
| auto-retry a failure | authentication attempts — account-lockout bypass·credential-stuffing aid | an idempotent GET — availability (Chapter 8) |
| swallow the exception and continue | a permission check — a check failure becomes a pass | **a batch processor·verification tool — this chapter** |
| reflect the input as-is in the error message | a web response — reflected XSS | a CLI tool — diagnostic information |

The second-to-last row is this chapter's general form. "Do not swallow exceptions" is widely-accepted advice and
right in most cases. But **swallow the exception in a permission check and it becomes fail-open, and throw an
exception in an aggregating verification tool and the aggregation itself vanishes.** You must look not at the rule
but at the context the rule presupposes.

### 24.5.4 Rewriting the rule

The practical rule you can pull from this chapter is neither "swallow" nor "throw."

> **Attribute a failure to the layer where that failure was observed. If it is information that layer cannot yet
> judge, raise the information up to the layer that can judge, without losing it.**

`_unpad_pkcs7` knows only the fact "the padding does not match." From that fact alone you cannot tell whether the
cause is a transmission loss·a key error·normal non-padding data. **Not judging in a layer that cannot judge** is
what this function did, and the judgment is split between `sniff` and `analyze` on mutually different bases. It is
a decision of the same lineage as Chapter 38's "distinguish unknown from passing," but here it differs in that it
**does not even make an unknown and flows it down below.**

---

## 24.6 Security — the defender's view

This chapter's evasion-side explanation ended at §24.4. From here is defense.

### 24.6.1 What a server implementer must do — at minimum

If you stand on the padding-verifying side, breaking condition (b) is the minimum requirement.

| What to do | Reason | If you do not |
|---|---|---|
| **make the errors indistinguishable** | unify a padding error·MAC error·format error into the **same response.** the status code·body·headers·connection-close method must all be the same | condition (b) holds — the 2010 ASP.NET case is this |
| **process in constant time** | make the verification path's execution time not vary by input. remove early returns, and even on failure perform the remaining operations | even with the same response, **time becomes an oracle** — Lucky Thirteen |
| **detailed cause only internally** | since the operator must know the cause, leave it in the log, but **do not carry it in the response** | condition (c) holds |
| **rate limit·anomaly detection** | repeated submission of tampered ciphertexts against one resource is not normal traffic | condition (a) holds without limit |

The fourth row must be made clear as a mitigation, not a patch. Chapter 15 §15.2.3's distinction applies as-is —
**narrowing the reach path and removing the vulnerability are different layers**, and you cannot say a padding
oracle was closed by rate limiting alone.

### 24.6.2 The timing channel — what remains even after unifying the response

The most often missed thing in condition (b) is **time.** Even perfectly unify the status code and body, and if
the fact "the padding was broken so the MAC computation was skipped" leaks as a response-latency difference, 1 bit
is observed by that. Lucky Thirteen was exactly this form.

> **Term** — **side channel**: a path by which a secret leaks not through a value the protocol intentionally
> conveys but through an **observable the implementation incidentally leaks**, like execution time·power
> consumption·cache state·response size.

Here two things must be seen together.

- **The difference can be very small.** Repeat the observation and average and even a below-noise difference
  surfaces. The rebuttal "a few microseconds are invisible because of network delay" is true **only for a single
  observation.** As long as condition (a) permits repetition, it is not true.
- **Constant time is a fight with the compiler·CPU.** Remove the branch in source and the optimizer can revive
  it, and a data-dependent memory access leaves cache timing. So the practical answer is not "write it well in
  constant time" but **§24.6.3.**

### 24.6.3 The root solution — so a padding oracle does not arise in the first place

Every item so far is symptomatic treatment presupposing the structure **CBC + a separate MAC.** The root solution
is to not use that structure.

> **Term** — **AEAD (Authenticated Encryption with Associated Data)**: a crypto scheme providing confidentiality
> and integrity·authentication **in one operation.** AES-GCM, ChaCha20-Poly1305 are representative. Decryption,
> if the authentication-tag verification fails, fails **without putting out a single byte of plaintext.**

> **Term** — **encrypt-then-MAC**: a composition method that encrypts the plaintext then computes and attaches a
> MAC **over the ciphertext.** The receiving side verifies the MAC **before decrypting**, and on failure does not
> perform decryption at all.

The reason AEAD or encrypt-then-MAC blocks a padding oracle is not "by checking the padding better." It is **by
having nothing to check the padding for.** A tampered ciphertext is filtered at the authentication stage and does
not even reach the padding-verification code. Since input does not touch the code that would become an oracle,
there is no need to discuss condition (b).

> **Principle** — **Cryptographic Doom Principle** (Marlinspike, 2011): *if you must perform any cryptographic
> operation before verifying the MAC, that implementation will somehow meet doom.* It summarizes in one sentence
> why MAC-then-encrypt and encrypt-and-MAC repeatedly broke.

The standards' movement was in the same direction too.

| Spec | Response |
|---|---|
| TLS 1.2 (RFC 5246) | instructs to respond to a padding error **indistinguishably** from `bad_record_mac` — symptomatic |
| TLS extension (RFC 7366) | replaces the CBC combination with **encrypt-then-MAC** |
| TLS 1.3 (RFC 8446) | **removes the CBC combination from the list.** leaves only AEAD — a structural solution |

Over 20 years it moved from "implement it well" to "do not use that structure." It is the conclusion that
**switching to a structure that cannot break** is cheaper than carefully using a repeatedly-breaking structure.

### 24.6.4 And yet HLS has no slot for that

This is this chapter's last layer. To apply the above prescription to HLS's AES-128, you need a slot per segment
to carry an authentication tag or MAC. **`EXT-X-KEY` has no such field.**

| The spec's slot | What it holds |
|---|---|
| `METHOD` | `NONE` · `AES-128` · `SAMPLE-AES` |
| `URI` | the address to get the key |
| `IV` | initialization vector (derived from media sequence if omitted, Chapter 23) |
| `KEYFORMAT` · `KEYFORMATVERSIONS` | key-format identification |
| — | **there is no slot to hold a MAC·authentication tag** |

[`playlist.py:48-64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L48-L64)'s `Key` dataclass reflects this table as-is. There are four fields and the fifth is absent.

So **HLS's AES-128 does not provide integrity.** It is a fact already confirmed in Chapter 4 §4.5.2 covering CBC's
malleability, and this chapter reaches the same conclusion from the other side — there being no integrity, padding
cannot substitute for an integrity check either.

Here this repository's design is justified again. **Since the crypto layer does not provide integrity, integrity
judgment is entirely the upper layer's job.** `sniff` and `analyze` and the PTS gap scan split that job.
`_unpad_pkcs7` not butting into the judgment is **because it is not qualified to butt in.**

### 24.6.5 What to do by role

| Role | What to do |
|---|---|
| **server·API implementer** | do not reflect the padding-verification result in the response. unify all decryption failures into one response, and unify the time too. if possible, delete that code and move to AEAD |
| **protocol designer** | when putting an encryption field into a spec, put a **slot to hold an authentication tag together.** it cannot be attached later — HLS's `EXT-X-KEY` is the case in point |
| **client·tool implementer** | if the crypto layer does not give integrity, **state which layer does that job.** without stating it, no one does it |
| **auditor** | when you see a static-analysis warning like "ignores a padding-verification failure," **ask the threat model first.** is there a party observing this function's result, is repeated submission possible. a verdict not answering these two questions is not a verdict |
| **course·rule author** | with a rule like "do not swallow exceptions," write **the presupposed context together.** a context-free rule is thrown away wholesale on meeting a counterexample |

---

## 24.7 The conditions under which this decision holds — and the conditions under which it breaks

It is dangerous if this chapter's logic generalizes to "you may swallow exceptions." State the conditions.

| Condition | This repository | If broken |
|---|---|---|
| the swallowed error is **necessarily caught by another layer** | `sniff` + `analyze` + PTS gap scan catch it (§24.3.3 measured) | it just becomes hiding a defect |
| the swallowing fact **does not affect the verdict** | the padding validity does not go into any check item | the verdict basis turns into silence |
| the function result **cannot be observed from outside** | it is used only inside the process | condition (c) holds → oracle |
| there is **no party repeatedly submitting** the input | the user processes their own data | condition (a) holds → oracle |
| a failure **must be aggregated to have meaning** | 27 segments·27 episodes must be processed to the end for a verdict | immediate stop may be better |

Break even one of the five and this chapter's conclusion does not apply as-is. **When you move the conclusion, you
must move the conditions with it.**

---

## 24.8 Limits and open questions

Written honestly.

- **There is no defect-injection regression test for encrypted streams.** The way `tests/run.sh:130` makes a
  defect-injected copy is `cp -R plain damaged` — a **copy of the plaintext stream**, and no defect is injected
  into the `enc/` stream. `tests/run.sh:174`'s `expect_pass "AES128-decrypt"` fixes **only the normal path.** That
  is, §24.3.3's table was measured separately to write this chapter and **is not nailed down by regression.**
  Borrowing Chapter 34's phrasing, this decision has no oracle now. Change `_unpad_pkcs7`'s last line to `raise
  ValueError` and **the regression test passes entirely as-is** — because no test flows a padding-broken
  ciphertext into this function (this is an inference confirmed by following the code path, not actually running a
  modified copy).
- **The block-alignment exception is an undocumented hole** (§24.3.4). If the cut length is not a multiple of 16,
  a `ValueError` arises at [`decrypt.py:46`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L46) and no one catches it. 15/16 of the counterexample the comment stated ("a
  truncated segment") falls here. This chapter only measured this fact and **did not fix the code.** If fixing,
  catching it per segment in `_run_segments`'s loop and promoting it to a `bogus`-family check item fits §24.5.4's
  rule, but the regression impact of that change was not confirmed.
- **A lone CC discontinuity is WARN and the exit code is 0** ([`report.py:245`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L245), [`cli.py:651-652`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L651-L652)). §24.3.3's "cut
  1,024 bytes from the end" case is recorded in the report but **does not fail CI.** Whether this is the right
  threshold is Chapters 22·39's problem and this chapter does not judge it. Only, that §24.3.2's claim "swallow and
  the upper layer catches it" **does not go as far as "catches it and gives a FAIL"** is written here.
- **The wrong-IV case cannot be generalized.** In §24.3.3's last row, giving the IV as 7 instead of seq 0 caught
  on no check. But this is because the two IVs differed **only in the last byte** so only one byte of the decrypted
  first block went off. Had it been an IV differing greatly, the leading `0x47` would break and `sniff` would
  catch it. **You cannot pull the conclusion "an IV error is not detected" from this single measurement.** The IV
  derivation rule itself is Chapter 23's subject.
- **The padding oracle's query count is a literature value.** The figure of average 128 per byte is not something
  this course measured. To measure it you would have to stand up a vulnerable oracle, and that is outside this
  course's scope.
- **Constant-time-ness was not measured.** `_unpad_pkcs7`'s `data[-n:] == bytes([n]) * n` is a Python byte-string
  comparison so it early-terminates. In this repository's threat model there is no party to observe so it is no
  problem, but **"no problem" is a judgment from the threat model, not a measurement result.** Whoever moves this
  function to a different spot must not use this sentence as a basis.
- **There is one measurement environment.** §24.2.3·§24.3.3's figures were measured once on ffmpeg 8.1.1 · Python
  3.14.5 · cryptography 48.0.0 · macOS. The padding length is reproduced by arithmetic (`12N mod 16`), but the
  exception message and `finalize()`'s behavior depend on the library implementation.

---

## 24.9 Summary

1. **PKCS#7 padding** fills the shortfall of `n` bytes with the value `n`. Even when the plaintext ends exactly at
   a block boundary, it **appends one more block of only the value 16** — only then is the removal rule unique.
   Without appending, it eats four bytes from a plaintext ending in `04 04 04 04`.
2. Measured, a TS segment's padding length differs every time (12·4·8 bytes). Because `188 × N` mod 16 differs per
   segment. **The padding length is not a constant of the spec.**
3. **Padding verification is a weak check.** The probability a random block passes is about 1/255 (measured
   1/249.7), and above all it speaks **only about the last two blocks.** Take out 12 packets from the middle of a
   segment and the padding was still valid.
4. This code does not throw an exception even when the padding is broken. Had it thrown, nowhere in `cli.py`
   catches that exception, so **a single run dies with a traceback, and a series batch run dies together with the
   remaining episodes.** And the diagnosis gets the **wrong name**, "decryption failure." The real cause was a
   transmission loss.
5. Swallowed damage does not vanish but gets its name one layer up — a wrong key by `sniff` as `unknown` (a
   certainty at the 1/65,536 level), a transmission loss by the `cc_state` crossing segment boundaries as a CC
   discontinuity. **An anomaly that is 0 when looking at a single segment alone surfaces as 1 when the boundaries
   are connected.**
6. **A padding-oracle attack holds only when all three conditions stand** — (a) repeated submission of a tampered
   ciphertext, (b) a distinguishable response for a padding error vs other errors, (c) observability of that
   difference. In this tool all three break.
7. **The core proposition — the same code becomes a vulnerability or a virtue depending on the role. A
   vulnerability is not a property of the code but the relationship between the code and the threat model.** A
   verdict always needs the third term.
8. The defender must process the errors **indistinguishably, in constant time.** But that is symptomatic, and the
   root solution is **AEAD or encrypt-then-MAC** — not checking the padding better but **making there be nothing
   to check the padding for.** TLS moved over 20 years from "make it indistinguishable" to "remove that
   structure."
9. **HLS's `EXT-X-KEY` has no slot to hold a MAC.** So AES-128 does not provide integrity, and integrity judgment
   is entirely the upper layer's job. `_unpad_pkcs7` not butting into the judgment is because it is not qualified
   to butt in.
10. This decision is right **only when five conditions hold** (§24.7). When you move the conclusion, you must move
    the conditions with it.

---

**Next chapter** — this chapter showed, with padding alone, that a verdict is impossible without setting "protect
from what." Chapter 25 throws the same question at the whole protocol. HLS's AES-128 hands down a plaintext 16-byte
key over a URI as-is. If it is nonetheless widely used, then **from whom is it protecting what.** On Kerckhoffs's
principle, it covers where the line dividing "link protection" and "content protection" is, and why a protection
that does not draw that line is not a protection.
