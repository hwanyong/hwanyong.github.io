---
title: "The Limits of a 4-Bit Cyclic Counter"
description: "Writing the checker's miss rate as a number"
date: 2026-06-29
version: '1.0'
tags: ['streaming', 'binary']
thumbnail: /images/lecture/thumb/hls-recon-18-cc-counter-limits.svg
---
## 18.0 What this chapter answers

1. What exactly does the CC check detect?
2. What does it **fail** to detect — can you write that set exhaustively?
3. What is the miss rate? What does that number depend on?
4. How does an exception placed to avoid false positives increase misses?
5. Why use this check while knowing what it cannot catch?

The fifth is this chapter's summit. This chapter is not one that boasts of the checker but **one that measures
and writes down the checker's failure probability.**

> **Term** — **false negative (miss)**: the checker judging a defect absent when it is actually present. The
> opposite is a **false positive** — judging a defect present when it is absent. Checker design is usually a
> trade between the two.

---

## 18.1 The problem — the checker gave a PASS

First look at the measurement. The following two runs are the **same tool, same options** and differ only in
input.

### 18.1.1 Control — the untouched stream

```bash
ffmpeg -v error -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=10" \
  -f lavfi -i "sine=frequency=440:duration=10" \
  -c:v libx264 -preset ultrafast -g 30 -c:a aac \
  -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "seg%03d.ts" index.m3u8
```

```
  ✓ TS integrity        6,032 packets / 5 PIDs, 0 loss
  ✓ timeline continuity 300 video frames continuous, 0 missing (interval median 33.3ms, threshold 400ms)
  ✓ full decode         decoded to the end with no error
  verdict: PASS — delivery data normal
```

### 18.1.2 Experiment — the stream with 16 packets deleted

In the middle of `seg002.ts`'s video-PID continuous run (packets 251–421), **16 packets = 3,008 bytes were cut
out.** Before and after are untouched.

```
  ✓ TS integrity        6,016 packets / 5 PIDs, 0 loss        ← it says 0 loss
  ✓ timeline continuity 299 video frames continuous, 0 missing ← a frame vanished, yet 0 missing
  ✗ full decode         6 errors — [h264 @ …] mb_type 1034 in P slice too large at 17 3
  verdict: FAIL — defect detected
```

Set the three lines side by side and read them.

| Check | Control | Experiment | Verdict |
|---|---|---|---|
| TS integrity (CC) | 6,032 packets, 0 loss | **6,016 packets, 0 loss** | PASS — **missed** |
| timeline continuity (PTS) | 300 frames | **299 frames**, 0 missing | PASS — **missed** |
| full decode | no error | 6 errors | FAIL — caught |

**The packet count dropped by 16 and one frame vanished, yet two checks gave "0 loss"·"0 missing."** The numbers
are printed in the report as-is, but with no baseline to compare against, those numbers alone tell you nothing.
What caught the defect was **only the third check, which has a completely different failure model.**

The proposition this chapter will set is already visible here.

> **PASS means not "intact" but "this check could not catch it."**

Now we see why it was 16 specifically, and whether the missed cases can be written **exhaustively.**

---

## 18.2 The principle — what 4 bits can count

### 18.2.1 The counter is the header's last 4 bits

> **Term** — **continuity counter (CC)**: the last 4-bit field of the MPEG-TS packet header's 4 bytes. It is
> independent per PID, and **for each packet carrying payload** it cycles 0–15 and increments by 1. A skipped
> value means a packet was lost in between.

![The bit layout of the MPEG-TS packet header's 4 bytes and the position of the continuity counter](/images/lecture/hls-recon/18-cc-field.svg)

*Figure 18-1 — of the MPEG-TS packet header's 4 bytes, the last 4 bits are the continuity counter*

This repository's module docstring writes that role in one sentence.

```python
# tsanalyze.py:3-5
ffmpeg reports only decode-view errors. What delivery verification actually needs is
"was a packet dropped in transit," and that answer is in the TS packet header's 4-bit
continuity counter — it cycles 0-15 per PID, so a skipped value is a loss.
```

**Why is there such a field.** MPEG-TS was designed for 1990s broadcast transport paths (satellite·cable·
terrestrial). The path is untrustworthy and there is no retransmission. The receiver had to judge for itself
"is the packet just received the next one after the previous," and the budget it could spend on that judgment
was **4 bits per packet.** 4 bits of 188 bytes — 0.27%. This budget births every limit in this chapter.

### 18.2.2 The observation function — the loss count is not observed

Say `k` payload-carrying packets were lost consecutively on some PID. Call the CC value of the packet just
before the loss `p`; then the CC of the next observed packet is the following.

```
observed CC = (p + 1 + k) mod 16
```

What the checker can see is only `observed CC`. `k` itself is carried nowhere. That is, **the checker observes
not `k` but `k mod 16`.** Losses with the same remainder mod 16 are indistinguishable from each other — `k = 16`
and `k = 0` (no loss) are the **same event** to this counter.

This is not an implementation flaw but **an information-content problem.** 4 bits can distinguish only 16 states,
and the loss count can take more than 16 values. Try to represent something larger than the representation space
and a collision necessarily arises. It is a direct consequence of the pigeonhole principle.

---

## 18.3 The code — the check rule and three exceptions

```python
# tsanalyze.py:104-119
        has_payload = bool(pkt[3] & 0x10)
        cc = pkt[3] & 0x0F

        # CC increases only in packets carrying payload. an adaptation-only packet holds it.
        if not has_payload:
            last_cc[pid] = cc
            continue

        prev = last_cc.get(pid)
        if prev is not None:
            expected = (prev + 1) & 0x0F
            if cc != expected and cc != prev:  # cc == prev is a spec-permitted duplicate packet
                rep.cc_discontinuities += 1
                if len(rep.cc_detail) < 20:
                    rep.cc_detail.append((pid, expected, cc))
        last_cc[pid] = cc
```

Sixteen lines, but the rules are four, and three of them are **exceptions to prevent false positives.** I
confirmed by measurement what breaks without each exception.

### 18.3.1 Exception ① — a per-PID independent counter

```python
# tsanalyze.py:96-98
        pid = ((pkt[1] & 0x1F) << 8) | pkt[2]
        if pid == NULL_PID:
            continue
```

CC cycles not per whole stream but **per PID.** Inside one TS several elementary streams are multiplexed, each
with its own counter. The composition of the measured test stream is this.

| PID | Role | Packet count | Ratio |
|---|---|---|---|
| `0x0100` | video (H.264) | 1,033 | 90.5% |
| `0x0101` | audio (AAC) | 104 | 9.1% |
| `0x0000` | PAT (Program Association Table) | 2 | 0.2% |
| `0x1000` | PMT (Program Map Table) | 2 | 0.2% |
| `0x0011` | SDT (Service Description Table) | 1 | 0.1% |

`NULL_PID` (`0x1FFF`) is a bandwidth-filling null packet, and its CC value is spec-undefined so it is skipped
entirely. Only, even if you delete this line, in the CBR stream ffmpeg made no false positive arose — because
those null packets' CC are all 0, so §18.3.3's duplicate exception absorbs it. What this line prevents is a
false positive on a multiplexer that assigns CC to null packets differently.

### 18.3.2 Exception ② — a packet without payload does not raise the counter

> **Term** — **adaptation field**: a variable-length area placed before the payload in a TS packet. It contains
> the PCR (reference clock)·random-access marker·stuffing bytes. The header's `adaptation_field_control` 2 bits
> set the presence of this field and payload.

A packet whose `adaptation_field_control` is `10` (adaptation field only, no payload) **does not increase CC**
by spec. Not knowing this and checking "+1 for every packet" makes a normal stream all defect.

I confirmed with a synthetic stream (200 normal packets + 200 adaptation-only packets, 400 total).

| Rule | False positives |
|---|---|
| current code | **0** |
| remove **both** the `has_payload` check and the duplicate exception | **200** — the whole normal stream is judged defective |

### 18.3.3 Exception ③ — `cc == prev` is a permitted duplicate packet

The MPEG-TS spec permits **sending the same packet once more** (mainly in packets carrying the PCR, a duplicate
transmission against transport-path errors). A duplicate packet does not raise CC, so its CC equals the previous
packet's. The `cc != prev` condition lets this case pass.

I confirmed with a synthetic stream mixing 10 duplicate packets.

| Rule | False positives |
|---|---|
| current code | **0** |
| remove the `cc != prev` exception | **10** — all duplicate transmissions misjudged as loss |

### 18.3.4 Exception ④ — the first packet has no baseline

If `prev is None`, it does not check but only plants the baseline. Because the first time it sees that PID there
is no previous value to compare against. This rule is inevitable but **makes one blind spot** — §18.7 measures
that price.

### 18.3.5 One loss = one discontinuity

The last line `last_cc[pid] = cc` runs **even after** a discontinuity is detected. That is, the counter resyncs
right after detection, so one loss event is counted as **1** only. This is why in the repository's defect
injection deleting 12 packets, that segment's `cc_discontinuities` is 2, not 12 (two PIDs detected).

> **The N in "N CC discontinuities" is not the number of lost packets but the number of loss events.**
> Since the report wording ([`report.py:236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L236)) is `5 CC discontinuities (packet loss)`, it is easy to misread.

---

## 18.4 The miss set — exactly two residue classes

Now overlay §18.2.2's observation function with §18.3's rules. The detection condition is this.

```
detect ⟺  observed CC ≠ expected   and   observed CC ≠ prev
```

Substitute `observed CC = (p + 1 + k) mod 16`, `expected = (p + 1) mod 16`, `prev = p`, and the condition for
detection to fail falls exactly into two.

| Condition | Derivation | The conclusion the checker draws |
|---|---|---|
| `observed CC == expected` | `k ≡ 0 (mod 16)` | there was no loss |
| `observed CC == prev` | `k ≡ 15 (mod 16)` | it is a spec-permitted **duplicate packet** |

![Of the remainders of lost-packet count k mod 16, exactly two escape the check](/images/lecture/hls-recon/18-blind-residues.svg)

*Figure 18-2 — of the 16 residue classes, exactly two escape this check*

### 18.4.1 Measured — a synthetic single-PID stream

I made a 400-packet single-PID stream, deleted `k = 1…48` packets in the middle, and called
`tsanalyze.analyze()` as-is.

```
undetected k: [15, 16, 31, 32, 47, 48]   →  k mod 16 ∈ {0, 15}
```

**Inference and measurement match exactly.** The other 42 values are all detected.

### 18.4.2 So the miss rate is not 1/16 but 2/16

The course's knowledge-extraction matrix (`docs/00-curriculum.md` item C2) wrote this limit as **1/16.** Looking
only at the counter's information-theoretic limit, that is right — a multiple-of-16 loss cannot be caught by any
implementation.

But **this implementation's miss rate is 2/16 = 12.5%.** What made the difference is §18.3.3's duplicate-packet
exception.

> **One exception placed to reduce false positives doubled the miss rate exactly.**

This must not be called a "bug." Without that exception a normal stream gives false positives, and **nobody uses
a checker that false-positives.** A checker no one uses has a 100% miss rate. The design is right, the price is
real, and only not writing down the price is the fault.

---

## 18.5 The miss rate is not a single number

12.5% is the number **when the loss length is a uniform random.** Real-world loss is not random. So the same
checker's miss rate becomes 0.4% under one model and 83% under another.

### 18.5.1 The measurement design

On an actual multiplexed stream (`seg000.ts`, 1,142 packets), for **every possible cut position** I inserted a
consecutive cut of length `L` and counted whether it was detected. The cut was aligned to the 188-byte boundary
(off-boundary and §18.7's sync check catches it instead).

| Loss length L | Missed positions / total | Miss rate |
|---|---|---|
| 1 | 7 / 1,140 | 0.6% |
| 2 | 6 / 1,139 | 0.5% |
| 4 | 5 / 1,137 | 0.4% |
| 8 | 5 / 1,133 | 0.4% |
| 12 | 5 / 1,129 | 0.4% |
| 14 | 5 / 1,127 | 0.4% |
| **15** | 934 / 1,126 | **82.9%** |
| **16** | 923 / 1,125 | **82.0%** |
| 17 | 24 / 1,124 | 2.1% |
| 20 | 6 / 1,121 | 0.5% |
| 30 | 31 / 1,111 | 2.8% |
| **31** | 902 / 1,110 | **81.3%** |
| **32** | 875 / 1,109 | **78.9%** |
| 33 | 38 / 1,108 | 3.4% |
| **47** | 884 / 1,094 | **80.8%** |
| **48** | 843 / 1,093 | **77.1%** |
| **L = 1…48 overall average** | **5,765 / 53,592** | **10.76%** |

### 18.5.2 Three ways to read it

**First — the average converges to the theoretical value.** The overall average 10.76% is close to §18.4's
12.5%. It confirms the theory was not wrong.

**Second — the average tells you nothing.** The actual distribution is a bimodal split into 0.4% and 83%. The
summary "miss rate about 10%" **explains neither peak.** The same problem of the average hiding outliers appears
here too (the same reason [`report.py:56-61`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L56-L61) views TTFB by p50·p95 and not the average).

**Third — what is dangerous is not random loss but structural loss.** The miss rate spikes only when `L ≡ 0` or
`L ≡ 15 (mod 16)`. And real-world loss occurs not as a uniform random but in **fixed-size units.**

| Loss unit | Size | Aligned with a multiple of 16 packets |
|---|---|---|
| 1 TS packet | 188 B | — |
| 1 Ethernet MTU (RTP/UDP TS is usually 7 packets) | 1,316 B | 7 — no |
| 4 KB disk block | 4,096 B | 21.8 — no |
| **3,008 B (=188×16)** | 3,008 B | **exactly 16** |
| CDN object chunk · arbitrary cut | variable | depends on implementation |

That is, the miss rate hangs on **the unit size of the layer producing the loss.** If that layer works in
multiples of 16 packets, this check is **structurally blind** to that layer's errors. Whether any particular
transport stack uses such a unit could not be confirmed in this repository — it stays inference (§18.11).

---

## 18.6 The incidental defense multiplexing makes, and its hole

### 18.6.1 Multiple PIDs must match simultaneously for a miss

Since CC is independent per PID, when a consecutive cut crosses several PIDs, a miss occurs only if **all PIDs
fall simultaneously into the residue classes {0, 15}.** With two PIDs (1/8)² ≈ 1.6%, with five it is
effectively 0.

This is why the repository's defect injection (removing 12 packets) is caught. The cut point crossed a PID
boundary and deleted 8 video·2 audio·1 PAT·1 PMT together, and audio's `k = 2` caught immediately.

This is the **incidental defense** named in Chapter 15 — multiplexing was not designed for detection but as a
result pulls up the detection rate.

### 18.6.2 But multiplexing has a big hole

Incidental defense is incidental so it is not guaranteed. In the measured stream each PID's **continuous run
length** is this.

| PID | Continuous run lengths |
|---|---|
| `0x0100` video | 30 · 71 · 135 · 146 · 149 · 161 · 170 · 171 |
| `0x0101` audio | 9 · 15 · 16 · 16 · 16 · 16 · 16 |
| PAT · PMT · SDT | 1 each |

Video packets run unbroken up to 171 at a time. **A cut of length 16 fits wholly inside this run, and then only
one PID is affected.** There are 918 such positions of 1,125, and most of the 923 misses = 82% come from here.
The peaks in §18.5's table are exactly those 923.

> **Multiplexing lowers the miss rate, but in an actual video stream where one PID takes 90% of the band, that
> effect vanishes completely at a specific loss length.**

### 18.6.3 The regression test choosing 12 is no accident

```bash
# tests/run.sh:134-137
p = d / "seg002.ts"                       # defect 1: remove 12 TS packets → a CC jump
raw = p.read_bytes()
cut = (len(raw) // 188 // 2) * 188
p.write_bytes(raw[:cut] + raw[cut + 188 * 12:])
```

```bash
# tests/run.sh:483
grep -q 'CC discontinuity'  "$DLOG" && ok "packet loss detected"   || bad "packet loss missed"
```

**12 is outside the residue classes {0, 15}.** If someone changes this number to "make it a clean 16," depending
on the cut position this test **fails intermittently.** And the person seeing the failure will conclude "the
checker broke." In reality the checker worked exactly as designed.

Two lessons overlap.

1. **The defect-injection value must be chosen to avoid the checker's blind spot.** Otherwise the test measures
   not the checker but the blind spot.
2. **If the reason is not in a comment the next person changes it.** The current comment only says "remove 12
   packets" and **does not say why 12.** This chapter is that blank.

---

## 18.7 What the counter does not look at at all

Misses are not only residue classes. There are four more blind spots the counter rule itself makes.

### 18.7.1 A PID's first packet and last packet

In the `L = 1` (delete a single packet) sweep, 7 misses arose. I investigated the identity of those 7.

| Position | PID | Identity |
|---|---|---|
| 1 | `0x0000` PAT | that PID's **first** packet |
| 2 | `0x1000` PMT | that PID's **first** packet |
| 3 | `0x0100` video | that PID's **first** packet |
| 173 | `0x0101` audio | that PID's **first** packet |
| 561 | `0x0000` PAT | that PID's **last** packet |
| 562 | `0x1000` PMT | that PID's **last** packet |
| 1132 | `0x0100` video | that PID's **last** packet |

**All 7, without exception, are "either the first packet or the last packet."**

- **first packet**: delete it and the next packet becomes the first, and with `prev is None` the check skips.
- **last packet**: delete it and there is no following packet to compare.

That is, **at boundaries the counter is powerless in principle.** This is not a probability but a deterministic
miss.

### 18.7.2 Payload corruption — count right, content wrong

I overwrote 20 packets' payload with zeros but left the header 4 bytes as-is and measured.

```
cc_discontinuities = 0,  sync_errors = 0,  clean = True
```

**It is completely silent.** CC is a device that counts the **number** of packets, not one that inspects the
**content.** A bit flip·partial overwrite·wrong decryption result is outside this check's concern.

### 18.7.3 An off-boundary cut — another check catches it instead

Insert a cut off by a byte and all packets after it lose alignment.

| Cut | `sync_errors` | `cc_discontinuities` |
|---|---|---|
| 100 B (unaligned) | **569** | 0 |
| 2,256 B (= 188×12, aligned) | 0 | **1** |
| 2,356 B (= 188×12 + 100, unaligned) | **557** | 0 |

CC gives 0 but **the sync check catches it instead.** And `sync_errors` is FAIL, not WARN ([`report.py:245`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L245)). It
means the two checks are designed so their failure models do not overlap — this is the form defense in depth
takes in a verification tool.

### 18.7.4 A segment with a broken leading byte — the upstream catches it

```python
# tsanalyze.py:78-80
    if len(data) < PACKET_SIZE or data[0] != SYNC_BYTE:
        # a non-TS container like fMP4 (starts with ftyp/moof) — not an analysis target
        return rep
```

Put in a TS with the leading 3 bytes deleted and `analyze()` returns an empty report with `parsed=False`,
`packets=0` and **leaves no error.** By this alone it is a grave hole.

But put the same data into `sniff()` and `unknown` comes out, and the caller promotes it to a **payload-validity
FAIL** ([`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464)). That is, this hole is blocked upstream.

> **When counting one checker's blind spot, you must count the checks above and below it too.**
> A condition silent alone is sometimes caught by the whole pipeline, and conversely, as in §18.1, three checks
> can be silent side by side.

---

## 18.8 Carrying state across segment boundaries

### 18.8.1 The design

```python
# tsanalyze.py:71-83
def analyze(data: bytes, state: dict[int, int] | None = None) -> TSReport:
    """Interpret a segment byte string as TS and check it.

    state is a PID→previous-CC mapping; to view continuity across segment boundaries
    the caller keeps passing the same dict. If None, only inside the segment is checked.
    """
    rep = TSReport()
    if len(data) < PACKET_SIZE or data[0] != SYNC_BYTE:
        # a non-TS container like fMP4 (starts with ftyp/moof) — not an analysis target
        return rep

    rep.parsed = True
    last_cc = state if state is not None else {}
```

The caller makes one dict and **passes the same one to every segment.**

```python
# cli.py:437-438
    ts_total = TSReport()
    cc_state: dict[int, int] = {}
```

```python
# cli.py:465
        ts_total.merge(analyze(data, cc_state))
```

`last_cc = state if state is not None else {}` is **a reference, not a copy.** It updates the dict the caller
passed as-is, so on the next call the previous segment's last CC is alive.

![Whether state is carried across segment boundaries makes the same loss yield a different conclusion](/images/lecture/hls-recon/18-state-across-segments.svg)

*Figure 18-3 — the same loss, a different conclusion — it depends on whether the counter state is carried across the boundary*

### 18.8.2 Measured — 12 vs 2

I reproduced the repository's defect-injected copy (12 packets removed · seg001 404 · seg003 error page · seg004
duplicate) as-is and measured, changing only whether `state` is shared.

| Design | `cc_discontinuities` | What is caught |
|---|---|---|
| **share the same dict** (current code) | **12** | inside-segment loss + boundary-crossing loss |
| `state=None` per segment | **2** | only seg002's inside-segment loss |

**A sixfold difference.** And the 10 missed are all "a whole segment vanished" and "segment order went off" —
the most common failures in HLS.

### 18.8.3 If a whole segment vanishes

The result of carrying CC through with only `seg001.ts` removed from a normal stream.

```
5 CC discontinuities — (17, 1, 2) (0, 2, 4) (4096, 2, 4) (256, 9, 10) (257, 8, 11)
```

**5 PIDs, 1 each, exactly 5.** The per-PID packet counts that segment held were video 1,137 · audio 99 · PAT 2 ·
PMT 2 · SDT 1, and their remainders mod 16 are 1 · 3 · 2 · 2 · 1 respectively — **none fell into the residue
classes {0, 15}.**

Here §18.6.1's incidental defense works most strongly. Since a miss requires **all** 5 PIDs to fall
simultaneously into the residue classes, a whole-segment loss is virtually always caught. Only, it is
**"virtually," not "always"** — for a delivery aligned so each segment's per-PID packet counts are multiples of
16, this check is **structurally** blind to segment loss. Such a delivery was not actually observed (§18.11).

---

## 18.9 The verdict — why WARN and not FAIL

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

| Observation | Verdict | Basis |
|---|---|---|
| `sync_errors > 0` | **FAIL** | the stream alignment broke — cannot come from a normal delivery |
| `scrambled_packets > 0` | **FAIL** | not decrypted — wrong key or SAMPLE-AES |
| `cc_discontinuities > 0` | **WARN** | likely loss but **could be an intended seam** |
| `transport_errors > 0` | **WARN** | TEI is a marker the upstream transport layer attached |

The reason a CC discontinuity is WARN is **because a legitimate discontinuity exists.** At the point where the
HLS playlist declared `#EXT-X-DISCONTINUITY`, the encoder restarts so CC also restarts from an arbitrary value.
The jump then is not a defect.

But §18.8's design makes a price here. **`cc_state` does not look at `EXT-X-DISCONTINUITY`.** The parser is
reading that tag ([`playlist.py:331`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L331), `Segment.discontinuity` — [`playlist.py:145`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L145)), and the timeline check
takes it into account.

```python
# report.py:309-310
            # if it is a discontinuity the playlist announced with EXT-X-DISCONTINUITY, it may be an intended seam.
            intended = discontinuities >= len(gaps.gaps)
```

**But the TS-integrity check has no such consideration.** [`cli.py:465`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L465) always passes the same `cc_state`
regardless of the segment's `discontinuity` flag. Check an ad-inserted playlist and a CC discontinuity is caught
at every seam, and the WARN wording will call it `packet loss`. Since the grade is WARN the verdict itself does
not flip, but **the wording is the wrong wording.** It is an open point confirmed in this repository (§18.11).

---

## 18.10 Generalization — observing infinite events with finite state

This chapter's structure is not limited to streaming. The general form is this.

> **If the observation space is finite with `N` states and the observation target takes more values than that,
> the observation necessarily becomes a `mod N` operation, and events that are exactly multiples of `N` go
> unobserved.**

| Domain | Finite counter | What happens when it wraps | Response |
|---|---|---|---|
| **MPEG-TS CC** | 4 bits / PID | a multiple-of-16 loss looks lossless | upper-layer checks (decode·PTS) |
| **TCP sequence number** | 32 bits | on a fast line, at wraparound an old segment looks valid | PAWS — verdict via the timestamp option |
| **IPv4 identifier (IP ID)** | 16 bits | on reassembly a fragment of another datagram mixes in | fragment reassembly timeout |
| **CBC·CTR nonce** | block/counter width | **nonce reuse — confidentiality collapses** | enforce a total cap before key rotation |
| **log sequence number** | per-file counter | after rotation the numbers overlap and drops are hidden | monotonically increasing ULID·UUIDv7 |
| **PTS (Chapter 21)** | 33 bits 90kHz | wraps about every 26.5 hours — time jumps to the past | wrap-detection logic |

Each row demands the same prescription.

> **For a check made with a finite counter you must always write the size of "the event where this counter goes
> full circle" and the condition under which that event occurs.**

And here a clue peculiar to this chapter attaches. CC's wraparound must not be handled with probabilistic
thinking. Unlike the birthday problem's "someday it coincides by chance," **if the loss count falls into a
specific residue class it is deterministically invisible, always.** So if the unit size of the loss-producing
layer aligns with the counter width, the miss rate becomes not 12.5% but **100%.**

---

## 18.11 Security — what does this check protect

### 18.11.1 Write the threat model first

Before asking what the CC check blocks, you must write **from whom, what it was designed to protect.** The
principle Chapter 25 will cover applies here as-is — protection with no threat model set is not protection.

| Item | Answer |
|---|---|
| **adversary** | none. the opponent is **noise and breakage** — transport errors, truncated responses, CDN cache anomalies |
| **protection target** | the accuracy of the verification conclusion — "is what was received the same as what was sent" |
| **assumption** | the stream creator is honest. the man-in-the-middle does not alter content |
| **cost** | 4 bits per packet = 0.27% |

The first row of this table is decisive. **CC is an error-detection device, not an integrity-guarantee device.**

### 18.11.2 With an adversary the miss rate is 100%

Assume an opponent who can alter the stream bytes and §18.4's 12.5% is meaningless. Because after deleting
packets you just **renumber the CC fields of the following packets by 1.** It is altering half a byte per
packet, 4 bits of 188 bytes.

| Opponent | This check's miss rate |
|---|---|
| random transport error | table §18.5.1 (0.4% – 83%, average 10.76%) |
| a broken relay layer working in 16-packet units | **100%** (structural alignment) |
| an adversary who can alter the stream | **100%** (just renumber CC) |

> **A keyless check cannot stop an adversary.** The same reason a CRC is not a MAC.
> The detection rate against random error and the detection rate against adversarial tampering are **different
> numbers**, and claiming the latter on the basis of the former is this domain's representative error.

What stops adversarial tampering is not CC but **the transport layer's cryptographic integrity.** HTTPS's AEAD
(authenticated encryption) stops in-transit tampering, and above that CC views "and even so, is anything
missing." The two layers are not substitutes but complements.

One more thing written honestly. This repository's **segment-uniqueness** check uses SHA-256, but that is a
**duplicate determination** between segments, not a comparison against the original. Since there is no path to
obtain the original hash, this tool proves "same as the original" by no check.

### 18.11.3 The defender's view — what to do by role

| Role | What to do |
|---|---|
| **verification-tool implementer** | write the miss rate **as a number.** not "CC detects loss" but down to "a multiple-of-16 loss and a PID-boundary loss are not detected." and place at least one more **independent check** whose failure model does not overlap — in §18.1 what caught the defect was not CC but the decode check |
| **defect-injection test author** | confirm the injected value avoids the checker's blind spot, and **leave in a comment why that value.** with no basis for the value the next person moves it into the blind spot |
| **delivery operator · CDN operator** | CC is a **lower-bound metric** of your delivery quality. do not use "0 CC discontinuities" as proof of integrity. publish segment digests next to the manifest and the receiver can do a real integrity check |
| **player implementer** | recover quietly from a CC jump but **measure and expose the count.** quiet recovery protects the user experience, but quiet without measurement means quality degradation is forever unobserved |
| **SRE · auditor** | when reported "check passed," **ask that check's miss rate.** with no answer, that PASS is not information. read the dashboard's green light as "not caught by this check," not "no defect" |
| **spec designer** | the counter width sets the upper bound of detectable loss size. when choosing the width, pick it **not to align with the expected loss unit.** 4 bits and 16-packet alignment is exactly that accident |

### 18.11.4 What this chapter does not cover

The concrete procedure to align loss to evade detection, a particular service's verification-bypass method, and
the acquisition of protected content are outside this course's scope (§0.1). Writing above "an adversary just
renumbers CC" was to explain **the principled limit of a keyless check**, and that limit is precisely why
cryptographic-integrity techniques exist.

---

## 18.12 Limits and open questions

Written honestly.

- **The CC check does not take `EXT-X-DISCONTINUITY` into account.** The parser reads that tag
  ([`playlist.py:331`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L331)) and the timeline check takes it into account ([`report.py:309-310`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L309-L310)), but
  [`cli.py:465`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L465) always passes the same `cc_state` regardless of the segment's `discontinuity` flag. In a
  playlist with intended seams such as ad insertion, **an intended discontinuity will be reported as `packet
  loss`.** Only, **I could not confirm by running with such a playlist** — it is a prediction derived from
  reading the code.
- **It does not report the number of lost packets.** Since `cc_detail` keeps `(pid, expected, actual)`, you
  could compute a **lower bound on the loss count** as `(actual − expected) mod 16`, but the current code does
  not produce this value. It has the limit of being only a lower bound, but it is more information than "how many
  events."
- **The miss-rate table is a number from a single stream.** §18.5.1's values were measured under a particular
  encoding setting (`libx264 ultrafast`, `g=30`, 320x180, 2-second segments). Change the per-PID ratios and
  continuous-run lengths and the table's values change too. **The residue classes {0, 15} are a property
  independent of the stream**, but a concrete number like 82% is a property of this stream.
- **Could not confirm a real layer that produces loss in 16-packet units.** §18.5.2 said "structural loss is
  dangerous," but I did not actually observe a transport·storage layer that cuts in 3,008-byte units. The
  **shape** of the danger was measured and the **cause** producing that shape is inference.
- **`cc_detail` is cut off at 20** ([`tsanalyze.py:117`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L117), [`tsanalyze.py:68`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L68)). In a mass-loss stream the detail
  is left as only the first 20. The total is accurate so the verdict is unaffected, but in post-hoc analysis the
  PID distribution of the later losses cannot be known.
- **An fMP4 segment has no such check.** `analyze()` returns immediately if the head is not `0x47`
  ([`tsanalyze.py:78-80`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L78-L80)). An ISO-BMFF segment's transport integrity must be viewed by another method (Chapter
  20), and currently this repository has only a structural-completeness check.

---

## 18.13 Summary

1. **CC does not observe the loss count `k`. It observes `k mod 16`.** It is a direct consequence of the 4-bit
   budget and cannot be improved by implementation.
2. The residue classes escaping this code's rules are **exactly two** — `k ≡ 0` (the counter goes full circle)
   and `k ≡ 15` (misread as a permitted duplicate packet). If the loss length is a uniform random the miss rate
   is **2/16 = 12.5%**, and the measured average was 10.76%, matching the theory.
3. **An exception placed to reduce false positives doubled the miss rate.** Without that exception, 10·200 false
   positives are measured on a normal stream. The design is right and the price is real, and only not writing
   down the price is the fault.
4. **The miss rate is not a single number.** The same checker splits from 0.4% to 83% by loss length. What is
   dangerous is not random loss but **structural loss aligned with the counter width.**
5. **Multiplexing makes an incidental defense** — a miss requires several PIDs to fall into the residue classes
   simultaneously. But in an actual video stream where one PID takes 90% of the band and runs up to 171 packets
   continuously, a length-16 cut is trapped inside a single PID with 82% probability and that defense vanishes.
6. **The design of carrying the counter state across segment boundaries multiplies detection power sixfold** (12
   vs 2). With `state=None` a whole-segment loss is entirely invisible.
7. **CC is an error-detection device, not an integrity-guarantee device.** To an opponent who can alter the
   stream the miss rate is 100% — just renumber 4 bits per packet. Transcribing a keyless check's detection rate
   as a guarantee against adversarial tampering is this domain's representative error.
8. So this chapter's proposition gathers into one.
   **PASS means not intact but "this check could not catch it," and without knowing the checker's miss rate that
   checker's PASS is not information.**

---

**Next chapter** — this chapter counted packets inside a segment. But why does the act of **joining** segments
work by byte concatenation alone? Because MPEG-TS is a self-synchronizing format, so as long as the 188-byte
grid is maintained it is closed under concatenation. Chapter 19 covers that algebraic property, and what must
come in front for the same property to hold in fMP4.
