---
title: "Dissecting the MPEG-TS Packet"
description: "The structure of 188 bytes"
date: 2026-06-27
version: '1.0'
tags: ['streaming', 'binary']
thumbnail: /images/lecture/thumb/hls-recon-17-mpegts-packet.svg
---
## 17.0 What this chapter answers

1. Why is the packet length fixed at 188 bytes, and what does that fixing make possible?
2. The 4-byte header — what exactly is in the 32 bits?
3. Which field does each single bit operation in the code read?
4. What goes off if you do not skip the NULL PID?
5. **What breaks if you do not look at scrambling control?**

In Chapter 14 the basis for determining a segment's identity was the leading byte `0x47`. This chapter reads the
3 bytes that follow that `0x47`. It is the point where we cross from determination to verification.

---

## 17.1 The problem — the reassembly path does not tell you about loss

This repository's TS-analysis module wrote its reason for existing in its first paragraph.

```python
# tsanalyze.py:1-6
"""Segment-payload analysis — container determination and MPEG-TS transport integrity.

ffmpeg reports only decode-view errors. What delivery verification actually needs is
"was a packet dropped in transit," and that answer is in the TS packet header's 4-bit
continuity counter — it cycles 0-15 per PID, so a skipped value is a loss.
"""
```

Let us re-measure whether this claim is true, first-hand. Locally we make a 4-second test stream (the same as
§17.10's lab procedure), inject a defect into the first segment, then attach four observation tools to the same
file. The defect is exactly the way this repository's regression test does it — **it cuts twelve 188-byte
packets** out of the middle of the file (`tests/run.sh:134-137`).

```python
# tests/run.sh:134-137 — defect injection 1
p = d / "seg002.ts"                       # defect 1: remove 12 TS packets → a CC jump
raw = p.read_bytes()
cut = (len(raw) // 188 // 2) * 188
p.write_bytes(raw[:cut] + raw[cut + 188 * 12:])
```

The measurements (ffmpeg 8.1.1, the same file `seg000.ts` 214,696 bytes = 188 × 1,142).

| Observation tool | Normal | video 12 packets removed | video 16 packets removed | audio 12 packets removed |
|---|---|---|---|---|
| `ffmpeg -c copy` (reassembly path) | exit 0, 0 lines | **exit 0, 0 lines** | **exit 0, 0 lines** | **exit 0, 0 lines** |
| `ffprobe` play length | 2.023222 | **2.023222** | **2.023222** | **2.023222** |
| full decode (`-xerror`) | 0 lines | 3 lines | 6 lines | 3 lines |
| `tsanalyze.analyze` | normal | **1 CC discontinuity** | **0 — missed** | **1 CC discontinuity** |

Three things to read.

**First, the reassembly path this tool actually uses says nothing.** `assemble.py` delegates all container work
to `-c copy` (Chapter 19). On that path ffmpeg gives exit code 0, standard error 0 lines. **The play length too
is identical to the sixth decimal place.** Why an attempt to find loss by aggregate is powerless is confirmed
again with PTS in Chapter 21, but it already holds within a single segment.

**Second, full decode catches it but the price differs.** `probe.decode_check` decodes the output to the end and
counts standard-error lines.

```python
# probe.py:298-309
def decode_check(path: str) -> tuple[int, list[str]]:
    """Run a full decode and collect error lines. Throw the output away (-f null).

    "opens" and "decodes to the end" are different questions, and in reassembly verification the latter is the criterion.
    """
    proc = subprocess.run(
        [require("ffmpeg"), "-v", "error", "-hide_banner", "-xerror", "-i", path, "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    lines = [ln for ln in proc.stderr.splitlines() if ln.strip()]
    return len(lines), lines[:20]
```

Why it **counts lines** rather than the exit code is revealed by measurement. Drop `-xerror` and run the same
file, and ffmpeg prints 2 lines of `corrupted macroblock` and yet ends with **exit code 0**. Had the exit code
been the verdict basis, this check would have caught nothing.

The price is cost and resolution. On the same 210 KB file `analyze()` took 0.4 ms and full decode took 62 ms
(about 150×). And a decode error comes out of **the whole output after reassembly finished**, so it cannot tell
you "which segment." `analyze()` points, immediately on receipt, per segment, down to `(PID, expected, actual)`.

**Third, neither side contains the other.** Remove 16 packets and the decoder spits 6 lines but the CC check
gives **0**. Because the 4-bit counter cycles with period 16, and that is Chapter 18's subject. Conversely there
is loss that only the CC check catches. **The two checks do not overlap; they fill each other's blind spots.**

So this chapter's question narrows to this — **at the spot where the reassembly path is silent, what can be
known from the bytes alone?** The answer is in the 4-byte header.

---

## 17.2 The principle — what the 188-byte fixed length does

> **Term** — **MPEG-TS (MPEG-2 Transport Stream)**: the multiplexing container ISO/IEC 13818-1 defines. It was
> designed presupposing error-prone, non-rewindable transport paths (broadcast·network), and the whole stream
> consists of nothing but **a sequence of fixed-length packets.**

> **Term** — **packet (transport stream packet)**: TS's sole unit. Its length is **always 188 bytes**, the
> leading 4 bytes are the header, the remaining 184 bytes the body.

The code fixes this fact in three constants.

```python
# tsanalyze.py:12-14
PACKET_SIZE = 188
SYNC_BYTE = 0x47
NULL_PID = 0x1FFF
```

Three lines are the whole vocabulary of this chapter. One length, one alignment marker, one exception.

### 17.2.1 The four things the fixed length buys

Unlike variable-length containers (ISO-BMFF·Matroska), TS **has no length field.** Because the length is a
constant. From this one decision four properties follow.

| Property | Content | Where it is used in this repository |
|---|---|---|
| **resync is computable** | the next packet's start is always `current + 188`. arithmetic, not a search | the loop stride of `analyze` ([`tsanalyze.py:85`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L85)) |
| **determination is O(1)** | read just two bytes (`data[0]`·`data[188]`) and you know the container | `sniff` ([`tsanalyze.py:31-34`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L31-L34)), `_ts_flaw` ([`inventory.py:113-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L113-L121)) |
| **counting is possible** | file size ÷ 188 = packet count. a nonzero remainder is itself an anomaly signal | measured: 214,696 = 188 × 1,142, remainder 0 |
| **closed under concatenation** | join two valid TS and you get valid TS again | `assemble.concat_segments` (Chapter 19) |

The fourth holds up this tool's whole reassembly strategy, and the second holds up Chapter 14's masquerade
determination. **The fixed length is not a trivial choice of the spec but the premise of what this repository
does.**

### 17.2.2 Why 188 exactly — the received story and what is confirmed

The widely cited basis is ATM (Asynchronous Transfer Mode) compatibility. The explanation is that an ATM cell's
payload, 47 bytes × 4 = 188. **This course could not confirm this basis in the spec's own text** (§17.11). What
is confirmed is only the following.

- the header is 4 bytes and the body 184 bytes — header overhead **2.13%**
- the sync byte is `0x47`, which in ASCII is `G`. so in an `xxd` dump it shows as `G@..` (that byte string of
  Chapter 14 §14.1)

The value `0x47` itself has no magic. **It appears freely inside the payload too.** So a single match is no
basis, and the determiner reconfirms 188 bytes later (Chapter 14 §14.4.1). The chance-match probability falls
from 1/256 to 1/65,536.

---

## 17.3 The 4-byte header — a full dissection into 32 bits

![A map of the TS packet header's 4 bytes unfolded into 32 bits](/images/lecture/hls-recon/17-header-bits.svg)

*Figure 17-1 — a map of the TS packet header's 4 bytes unfolded into 32 bits*

Eight fields share the 32 bits. Laid out fully in a table it is the following. The last column is this course's
format — **what breaks if you do not look at this field.**

| # | Field | Bits | Code | Does this code use it | If you do not look |
|---|---|---|---|---|---|
| 1 | **sync byte** | `pkt[0]` 8 bits | `pkt[0] != SYNC_BYTE` | ✅ | a misaligned byte string is read as TS and every field becomes garbage |
| 2 | **TEI** | `pkt[1]` bit 7 | `pkt[1] & 0x80` | ✅ | you miss the upstream gear marking "this packet is already damaged" |
| 3 | **PUSI** | `pkt[1]` bit 6 | — | ❌ | you cannot catch a PES boundary. this code does not parse PES so it is unnecessary |
| 4 | **transport priority** | `pkt[1]` bit 5 | — | ❌ | a priority hint. unrelated to integrity |
| 5 | **PID** | `pkt[1]` low 5 bits + `pkt[2]` = 13 bits | `((pkt[1] & 0x1F) << 8) \| pkt[2]` | ✅ | you cannot view CC split per stream. video·audio counters mix and it is all false positives |
| 6 | **transport scrambling control** | `pkt[3]` bits 7-6 | `(pkt[3] >> 6) & 0x03` | ✅ | **it saves ciphertext as video and reports success** (§17.9) |
| 7 | **adaptation field control** | `pkt[3]` bits 5-4 | `pkt[3] & 0x10` (payload bit only) | ✅ | you mistake a payload-less packet's CC for having increased and false positives pour out |
| 8 | **continuity counter** | `pkt[3]` low 4 bits | `pkt[3] & 0x0F` | ✅ | the means to detect packet loss disappears |

### 17.3.1 Measured — unpack the first packet by hand

```
$ xxd -l 16 seg000.ts
00000000: 4740 1110 0042 f025 0001 c100 00ff 01ff  G@...B.%........
```

Decompose the leading 4 bytes `47 40 11 10` per the table.

| Byte | Value | Bits | Field → value |
|---|---|---|---|
| `pkt[0]` | `0x47` | `0100 0111` | sync byte = `0x47` ✅ |
| `pkt[1]` | `0x40` | `0100 0000` | TEI=0 · **PUSI=1** · priority=0 · PID high 5 bits = `00000` |
| `pkt[2]` | `0x11` | `0001 0001` | PID low 8 bits = `00010001` → **PID = 0x0011** |
| `pkt[3]` | `0x10` | `0001 0000` | scrambling=`00` · **AFC=`01`** · CC=`0000` |

What was read: **it is a PID 0x0011 packet, a new unit starts here (PUSI=1), it is not scrambled, there is only
payload with no adaptation field (AFC=01), and this PID's first counter value is 0.** PID 0x0011 is the number
DVB assigns to the Service Description Table (SDT), and ffmpeg's TS muxer writes service info at the front by
default.

> **Term** — **PID (Packet Identifier)**: a 13-bit integer. It is a **number tag** indicating which elementary
> stream (video·audio·subtitle·control table) that packet belongs to, not an address. The range is 0–8191
> (0x1FFF), and the meaning assignment is set by the control tables in the stream (PAT·PMT).

The PID distribution across all 1,142 packets of the same segment is this.

| PID | Packet count | What |
|---|---|---|
| `0x0000` | 2 | PAT (Program Association Table) — a number the spec fixes |
| `0x0011` | 1 | SDT — a number DVB fixes |
| `0x1000` | 2 | PMT (Program Map Table) — ffmpeg muxer's default |
| `0x0100` | 1,033 | video |
| `0x0101` | 104 | audio |

**The analyzer knows none of these meanings.** It uses PID only as an integer key and counts the counter under
it separately. The work that requires knowing the meaning (which track is video) is delegated to ffprobe. The
result of dividing "what can be done without knowing and what must be known" is this module's size — 121 lines.

### 17.3.2 A field boundary differs from a byte boundary

Of the eight fields, **only one straddles a byte boundary: PID.** You must join `pkt[1]`'s low 5 bits and
`pkt[2]`'s 8 bits to get 13 bits. The code is exactly that assembly.

```python
pid = ((pkt[1] & 0x1F) << 8) | pkt[2]
```

- `pkt[1] & 0x1F` — **discard** the high 3 bits (TEI·PUSI·priority). `0x1F` = `0001 1111`
- `<< 8` — push the remaining 5 bits 8 places left, emptying the low-byte slot
- `| pkt[2]` — fill that slot with the next byte

What happens if you omit the mask. In the first packet where `pkt[1] = 0x40` (PUSI=1), `(0x40 << 8) | 0x11 =
0x4011` comes out. It differs from the real PID 0x0011 and **exceeds the 13-bit range (max 0x1FFF).** Because a
packet where PUSI is set and one where it is not split into different PIDs, one stream's counter is cut into two
and the check becomes all false positives. The mask is not decoration but the field boundary itself.

### 17.3.3 What occupies the 184-byte body

![The 2 AFC bits set the body layout of the 188 bytes](/images/lecture/hls-recon/17-packet-layout.svg)

*Figure 17-2 — the 2 AFC bits set the body layout of the 188 bytes*

> **Term** — **adaptation field**: a control area that can go into the body instead of payload. It starts with a
> length byte and carries the PCR (reference clock)·discontinuity marker·padding. Since its length is variable,
> when it is together with payload only as much payload as fits the leftover rides along.

> **Term** — **adaptation field control (AFC)**: 2 bits. Each bit tells, respectively, whether there is an
> adaptation field in the body and whether there is payload.

| AFC | Body composition | CC | Measured (seg000.ts 1,142 packets) |
|---|---|---|---|
| `00` | unused by spec | — | 0 |
| `01` | payload only | **increases** | 1,008 |
| `10` | adaptation field only (no payload) | **holds** | 0 |
| `11` | adaptation field + payload | **increases** | 134 |

The code does not read these 2 bits whole. It looks at **only the one payload bit.**

```python
has_payload = bool(pkt[3] & 0x10)
```

`0x10` = `0001 0000` — of the two AFC bits it keeps only the lower one, i.e. "is there payload." Why this is
enough is in the table's third column. **The case where CC increases and the case where the payload bit is set
match exactly.** Whether there is an adaptation field is not needed for this check, so it is not read. Not
reading what is not needed is also a decision — read it and code that interprets it follows, and interpretation
brings spec exceptions with it.

---

## 17.4 The code — one loop line is one field

Now read the whole analysis loop. It is 35 lines, and the fields seen above come out in order from the top.

```python
# tsanalyze.py:85-119
    for off in range(0, len(data) - PACKET_SIZE + 1, PACKET_SIZE):
        pkt = data[off : off + PACKET_SIZE]
        rep.packets += 1

        if pkt[0] != SYNC_BYTE:
            rep.sync_errors += 1
            continue

        if pkt[1] & 0x80:
            rep.transport_errors += 1

        pid = ((pkt[1] & 0x1F) << 8) | pkt[2]
        if pid == NULL_PID:
            continue
        rep.pids.add(pid)

        if (pkt[3] >> 6) & 0x03:
            rep.scrambled_packets += 1

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

### 17.4.1 The correspondence of line to field

| Code | Field read | Verdict | Why this spot |
|---|---|---|---|
| `range(0, len(data) - PACKET_SIZE + 1, PACKET_SIZE)` | — | — | the stride is the packet length. it goes only to the last whole packet |
| `pkt[0] != SYNC_BYTE` | ① sync byte | `sync_errors` | if alignment is broken the remaining 24 bits are not worth interpreting → `continue` |
| `pkt[1] & 0x80` | ② TEI | `transport_errors` | a damage marker the upstream attached. count but do not stop |
| `((pkt[1] & 0x1F) << 8) \| pkt[2]` | ⑤ PID | — | every subsequent verdict is per-PID so obtain it first |
| `pid == NULL_PID` | ⑤ PID | — | padding is not a check target → `continue` (§17.5) |
| `(pkt[3] >> 6) & 0x03` | ⑥ scrambling control | `scrambled_packets` | if nonzero the payload is ciphertext (§17.9) |
| `pkt[3] & 0x10` | ⑦ AFC's payload bit | — | the sole condition for whether CC increases |
| `pkt[3] & 0x0F` | ⑧ CC | `cc_discontinuities` | compared against the previous value |

**The order is itself the policy.** Look at the two spots where `continue` is placed and you know what this code
declared "not a verdict target."

- **a sync-lost packet** — its fields are not interpreted. read misaligned bytes as PID and nonexistent streams
  arise in droves
- **a NULL packet** — not even put in the PID list, and CC is not looked at

Conversely TEI does **not** `continue`. Even a packet with a damage marker can still have its header itself
read, and that packet's CC is still needed for the loss verdict.

### 17.4.2 What this loop does not do — resync

After `sync_errors += 1` comes `continue`. **There is no attempt to find the next `0x47` and recover
alignment.** The stride is always 188.

This makes an observable result. **Insert 1 byte** into the middle of a normal file and run it and it comes out
like this.

```
1 byte inserted → packets 1142, sync_errors 571, cc_discontinuities 0, clean False
```

Just one byte went off, and yet **all 571 packets after it are caught as sync-lost.** A defect with a single
cause is reported as 571 errors.

This is not a bug but a choice. The grounds are two.

1. **It is enough for the detection purpose.** The question this check must answer is not "how many bytes went
   off" but "can I trust this segment," and the answer is no either way.
2. **Resync brings in new misjudgments.** Realign to an accidental `0x47` inside the payload and everything
   after it reads as plausible-garbage fields. Alignment recovery is a separate problem that must verify several
   candidates.

Only, **what must be written honestly** is that the number in the report is not the count of defects. `sync-lost
571` means not "571 places broke" but "this point onward cannot be interpreted."

### 17.4.3 A truncated last packet is quietly discarded

The loop range `len(data) - PACKET_SIZE + 1` goes only **to the last position that fills a whole 188 bytes.** A
partial packet left at the file's end is neither counted nor caught as an error.

```
remove the last 100 bytes from seg000.ts → packets 1141 (original 1142), sync_errors 0, clean True
```

The segment is cut at the end and yet **TS integrity passes.** This means with only this check a truncated
segment is missed, and in reality other checks (received byte count, length consistency, timeline continuity)
fill this hole. **Knowing the structure where one check's blind spot is covered by another check** is what lets
you say which check, turned off, opens what.

---

## 17.5 Why the NULL PID is skipped

```python
if pid == NULL_PID:
    continue
```

> **Term** — **null packet**: a packet whose PID is `0x1FFF`. Its content has no meaning, and it exists only as
> **padding** to keep the stream's bitrate constant. Relay gear inserts and removes it freely.

Why these two lines are needed is seen at once if you make a CBR (constant bitrate) stream. This is the result of
multiplexing the same source at a fixed 3 Mbps.

| | Packet count | Ratio |
|---|---|---|
| whole | 7,988 | 100% |
| **NULL (0x1FFF)** | **5,381** | **67.4%** |
| video `0x0100` | 2,314 | 29.0% |
| audio `0x0101` | 202 | 2.5% |
| control (PAT·PMT·SDT) | 91 | 1.1% |

**Two-thirds of the file is padding.** Include these packets in the check and two things go off.

**First, the PID list is polluted.** The report prints `PID: 6 kinds` instead of `PID: 5 kinds`, and 8191 mixes
into the JSON stats' `pids` array ([`report.py:250-256`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L250-L256)). To someone weighing "how many tracks does this delivery
have" from the verification result, this is a wrong value.

**Second, the CC check loses its basis.** A null packet's counter is unrelated to the stream's continuity, and
relay gear inserting and removing null packets is **normal operation.** Counting what is not loss as loss is a
false positive.

Here the measurement must be written honestly. **In this environment no CC false positive arose even without
skipping.**

```
check including NULL → 0 CC discontinuities
check excluding NULL → 0 CC discontinuities   (the only difference is the PID list, 6 kinds vs 5)
```

The reason is that ffmpeg's muxer **fixes all null packets' CC to 0** (I checked the first 24 directly). Since
the value does not change, it catches on the `cc == prev` branch — the spec-permitted duplicate packet — and no
false positive arises.

That is, **the benefit of this skip, within the measured range, is only the PID list's accuracy.** The reason
keeping it is nonetheless right is the same as ground 1 of Chapter 15 §15.7. It is **not letting this code's
safety depend on a particular muxer's accidental behavior.** If there is an implementation that increments null
packets' counters or scrambles the value during re-multiplexing, at that moment two-thirds flips to false
positives.

One more thing. **HLS segments usually have no null packets.** The measured VOD segment's PID list had no
`0x1FFF`. Because receiving a file over HTTP has no reason to fill the bitrate. But in a delivery that
re-multiplexes a broadcast signal as-is out to HLS, null packets remain. **"Our stream does not have it" is not
"it is fine to remove from the code."**

---

## 17.6 TSReport — why four totals and not one

```python
# tsanalyze.py:40-49
@dataclass
class TSReport:
    packets: int = 0
    parsed: bool = False  # was it interpreted as TS (False if fMP4)
    sync_errors: int = 0  # sync byte 0x47 mismatch = stream alignment broken
    transport_errors: int = 0  # TEI flag = an error the transport layer marked
    cc_discontinuities: int = 0  # continuity counter jump = packet loss
    scrambled_packets: int = 0  # scrambling control ≠ 0 = not decrypted
    pids: set[int] = field(default_factory=set)
    cc_detail: list[tuple[int, int, int]] = field(default_factory=list)  # (pid, expected, actual)
```

The reason the four error counts are not merged into one is that **the cause and the response differ for each.**

| Count | Field read | What happened | Whose problem | Verdict |
|---|---|---|---|---|
| `sync_errors` | ① | byte alignment broke | the receive·store path, or reading non-TS as TS | **FAIL** |
| `transport_errors` | ② | upstream gear marked damage | the delivery-side upstream (satellite·cable segments, etc.) | WARN |
| `cc_discontinuities` | ⑧ | a packet was dropped | the transport path or the delivery side | WARN |
| `scrambled_packets` | ⑥ | the payload is ciphertext | a mismatch of key·encryption method | **FAIL** |

The verdict mapping is right there in the code.

```python
# report.py:232-245
    # 3) TS transport integrity
    if ts and ts.parsed:
        problems = []
        if ts.cc_discontinuities:
            problems.append(f"{ts.cc_discontinuities} CC discontinuities (packet loss)")
        if ts.transport_errors:
            problems.append(f"{ts.transport_errors} TEI")
        if ts.sync_errors:
            problems.append(f"{ts.sync_errors} sync-lost")
        if ts.scrambled_packets:
            problems.append(f"{ts.scrambled_packets} undecrypted packets")
        rep.add(
            "TS integrity",
            FAIL if (ts.sync_errors or ts.scrambled_packets) else (WARN if problems else PASS),
```

**Only sync-lost and undecrypted are FAIL.** Those two cases leave the whole output unusable, whereas TEI and CC
discontinuity are **partial damage** so there is room for a judgment the user can accept. With one total this
distinction could not be made. Splitting the counts is not taste but the verdict rule's demand.

### 17.6.1 `parsed` — distinguishing absence from passing

```python
# tsanalyze.py:77-83
    rep = TSReport()
    if len(data) < PACKET_SIZE or data[0] != SYNC_BYTE:
        # a non-TS container like fMP4 (starts with ftyp/moof) — not an analysis target
        return rep

    rep.parsed = True
    last_cc = state if state is not None else {}
```

An fMP4 segment is not TS so there is nothing to check. Then a report with `parsed=False` returns, and the
report **does not make the item itself** via `if ts and ts.parsed:`. What happens if you believe `sync_errors=0`,
`cc_discontinuities=0` as-is and stamp PASS — every fMP4 stream gets "TS integrity passed." **That what was not
checked is recorded as passed** is the worst error a verification tool can make (the same principle as Chapter
38's "verdict withheld").

### 17.6.2 `merge` and the 20-item `cc_detail` cap

```python
# tsanalyze.py:60-68
    def merge(self, other: "TSReport") -> None:
        self.packets += other.packets
        self.parsed = self.parsed or other.parsed
        self.sync_errors += other.sync_errors
        self.transport_errors += other.transport_errors
        self.cc_discontinuities += other.cc_discontinuities
        self.scrambled_packets += other.scrambled_packets
        self.pids |= other.pids
        self.cc_detail.extend(other.cc_detail[: max(0, 20 - len(self.cc_detail))])
```

Counts are added, PIDs are a union, `parsed` is OR — if even one segment is TS the whole is viewed as TS. Only
the last line differs in nature. **`cc_detail` is cut off at 20.**

In a file whose alignment is broken thousands of losses can arise, and holding them all inflates the report JSON
to several megabytes over a single defect. The cap is once more inside `analyze` too ([`tsanalyze.py:117`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L117)).
**What the verdict needs is the count, and the detail is a diagnostic sample.** Not distinguishing the two makes
the log itself a failure factor.

### 17.6.3 The state that spans segment boundaries

```python
# cli.py:437-438
    ts_total = TSReport()
    cc_state: dict[int, int] = {}
```

```python
# cli.py:465
        ts_total.merge(analyze(data, cc_state))
```

`cc_state` **keeps passing the same dict for each segment** and carries the last per-PID counter forward. If a
whole segment is missing, the counter jumps only at that boundary, so if you do not pass the state **a
segment-unit loss is forever invisible.** Exactly what this state passing catches more and what it still cannot
catch is quantified in Chapter 18.

---

## 17.7 A miniature of the same determination — [`inventory.py:113-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L113-L121)

The same principle is implemented once more in this repository, **much smaller.**

```python
# inventory.py:113-121
def _ts_flaw(path: Path) -> str:
    """MPEG-TS has a sync byte (0x47) every 188 bytes. Compare the two."""
    with path.open("rb") as fh:
        head = fh.read(_TS_PACKET + 1)
    if len(head) < _TS_PACKET + 1:
        return "could not fill even one packet"
    if head[0] != _TS_SYNC or head[_TS_PACKET] != _TS_SYNC:
        return "the MPEG-TS sync byte does not match"
    return ""
```

It reads only 189 bytes and **looks at only two bytes.** It does not touch the header's remaining fields. Why are
there two different checks for the same file format — because the purpose and the cost differ.

| | `tsanalyze.analyze` | `inventory._ts_flaw` |
|---|---|---|
| **Question** | was the just-received thing intact in transit | is the thing already in the folder a finished copy |
| **Amount read** | all | 189 bytes |
| **Fields seen** | ①②⑤⑥⑦⑧ | ① (twice) |
| **Timing** | just after receipt, in memory | on re-run, from disk |
| **Call count** | once per segment | **once per episode × every run** |

[`inventory.py:17-19`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L17-L19) wrote the basis for that judgment.

> Whether it is intact, we check by default only what can be confirmed cheaply. Opening 27 files with ffprobe
> every time makes the re-run slow, so the benefit of "receive only what is missing" disappears.

It is a **cost asymmetry of the verdict.** Get it wrong in the inventory and the two directions of loss differ —
too lenient and a broken file passes as finished so that episode is **never** recovered, too strict and 27 fine
episodes are re-received every time ([`inventory.py:13-15`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L13-L15)). So at this spot it looks at "only the cheap and
sure." Two bytes satisfy that condition.

It is worth noting too that the two modules **each hold the same constants.**

```python
# inventory.py:44-45
_TS_SYNC = 0x47
_TS_PACKET = 188
```

This is a duplication that could be removed by importing `tsanalyze`. In exchange `inventory` comes to not depend
on `tsanalyze` — the inventory holds up knowing nothing of the network-receive layer at all. **It is the spot
where the benefit of keeping a single source of truth (SSOT) and the benefit of keeping layer independence
collide head-on**, and this code chose the latter. That they are spec constants that will not change supports
that choice. Had they been constants that could change, the opposite would be right.

Finally, this miniature's limit. **It applies only to the `.ts` extension** ([`inventory.py:144-145`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L144-L145)). A file
saved with the masquerade extension seen in Chapter 14 just passes this check by. What the inventory handles is
**the output this tool saved itself** so there is no problem now, but put a file the user got by another path in
the same folder and the verdict basis disappears.

---

## 17.8 Generalization — fixed-length frames and plaintext headers

### 17.8.1 Relayability requires the header be plaintext

The TS packet's structure is not peculiar but **typical.** The same form repeats per layer.

| Layer | Frame | Header | Who reads the header |
|---|---|---|---|
| link | Ethernet frame | leading 14 bytes | switch — forwards by MAC address |
| cell | ATM cell | leading 5 bytes (53 bytes fixed) | cell switch — swaps by VPI/VCI |
| network | IP packet | leading 20 bytes (+options) | router·NAT·firewall |
| media | **MPEG-TS packet** | **leading 4 bytes (188 bytes fixed)** | **re-multiplexer·relay — filters by PID** |
| security | TLS record | leading 5 bytes | receiver — must know the record boundary to start decryption |

Writing the common principle in one sentence, it is this.

> **Information needed for the relay cannot be encrypted. So scrambling·encryption always applies from the
> payload on, and the header remains plaintext.**

This is why TS's scrambling applies only to the payload. Unable to read the PID, relay gear cannot know where to
send that packet, and then the network does not hold up.

This principle has **two faces.**

- **the bright face** — the receiving side can verify the transport's integrity without knowing the content.
  the whole basis on which §17.9's check holds is this
- **the dark face** — even if you encrypt the content, **the metadata leaks.** the track count via the PID
  composition, the bitrate via the packet arrival rate, the time axis via the PCR are all observable

QUIC's **header protection** is exactly a counterexample aimed at this dark face. It leaves only the bare minimum
needed for the relay and masks the rest of the header fields too, so an on-path observer cannot track the
connection. QUIC showed the very fact that **how far to leave things plaintext is a protocol-design choice.** TS,
on the 1990s broadcast premise, made that choice "all plaintext."

### 17.8.2 A parser whose length is a constant and a parser that trusts the length

Set side by side with Chapter 20's ISO-BMFF and the contrast is sharp.

| | MPEG-TS | ISO-BMFF |
|---|---|---|
| How the next boundary is known | **constant 188** | **reads the `box_size` field** of the box head |
| Does the input set it | no | **yes** |
| Representative failure mode | alignment loss (1 byte inserted → everything after is an error) | size-field forgery → **integer overflow** if the boundary check is omitted |
| Defense code | can be absent | `box_size < 8`·`offset + box_size > size` checks required ([`inventory.py:92-95`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L92-L95)) |

**Having no length field means there is no length field to verify.** One large branch of file-format parser
vulnerabilities comes from trusting length·offset fields, and TS erased that branch at the design stage. In
exchange it got a different vulnerability, alignment, and that is not a memory-safety problem but an
**interpretability** problem.

> **The surest way to reduce the input you must trust is to not take that value from the input.**

This principle applies as-is not only to format design but to API design. In Chapter 14, making `sniff()` **not
even take `Content-Type` as an argument** was a decision of the same form.

---

## 17.9 Security — do not look at scrambling control and you save ciphertext as video

> **Term** — **transport scrambling control (TSC)**: 2 bits of the header. `00` means no scrambling, any other
> value means **the payload is scrambled.** The header and adaptation field are always plaintext regardless of
> this value.

```python
if (pkt[3] >> 6) & 0x03:
    rep.scrambled_packets += 1
```

`>> 6` pulls down the top 2 bits and `& 0x03` erases the rest. If nonzero — **whatever the value** — it counts
as an undecrypted packet. What the two bits' concrete value (`01`·`10`·`11`) distinguishes is not this code's
concern. **Only whether it is zero or not is needed for the verdict.**

### 17.9.1 What it means — exactly

If you received a packet whose TSC is nonzero, that payload is in a state that does not open with the key this
tool has. The cause splits into three.

| Cause | What actually happened | This tool's response |
|---|---|---|
| **transport-layer scrambling** | scrambling a conditional-access (CA) system placed. a signal that never presupposed this client as a recipient | verdict FAIL — content that cannot be handled |
| **part of some frame-level encryption implementation** | a method where whole-segment decryption does not hold. it is already refused at the `EXT-X-KEY` stage | [`playlist.py:62-64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L62-L64) blocks it earlier |
| **re-multiplexing residue·muxer error** | a stream re-multiplexed with the scrambling undone but the bit not cleared | verdict FAIL — false positive possible (§17.11) |

Here one common misunderstanding must be corrected. **"The decryption key is wrong" does not catch on this
check.** Decrypt a stream that AES-128-encrypted every segment with the wrong key and the result is a random
byte string, and the probability its head is `0x47` is 1/256. Measured, it comes out like this.

```
random byte string → sniff() = "unknown", analyze().parsed = False
```

That is, a wrong key **is caught one stage earlier at the magic-number determination**, and recorded as a
payload-validity FAIL ([`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464), Chapter 14 §14.4.2). What the TSC check catches is a different
situation — **the byte string is a completely normal TS but only its inner content is ciphertext.**

### 17.9.2 Measured — the magic number passes and only TSC catches it

I left a normal segment's payload as-is and set the TSC of 1,137 packets — excluding the PSI (control tables) —
to `10`. I changed only the header's 2 bits.

```
sniff()               = "mpegts"        ← passes
analyze().packets     = 1142
analyze().cc_disc     = 0               ← CC also normal
analyze().scrambled   = 1137            ← caught only here
analyze().clean       = False
leading 4 bytes       = 47 40 11 10     ← identical to a normal segment
```

![In a scrambled packet too the header 4 bytes stay plaintext](/images/lecture/hls-recon/17-clear-header.svg)

*Figure 17-3 — in a scrambled packet too the header 4 bytes stay plaintext*

**Chapter 14's determination basis is powerless here.** Both the leading byte and the byte 188 later are `0x47`.
It cannot be otherwise — as seen in §17.8.1, **the header is not a scrambling target.** The magic number is
inside the header, and the header is always plaintext.

So the conclusion splits like this.

| Tool | Where it looks | Verdict | What is reported to the user |
|---|---|---|---|
| a tool looking at the leading byte only | `data[0]`, `data[188]` | `mpegts` | **"full receipt success"** — it saves ciphertext as `.ts` |
| a tool reading the 2 header bits | `pkt[3]` bits 7-6 | 1,137 undecrypted | **FAIL** — the output cannot be trusted |

**From the same byte string opposite conclusions come out.** Chapter 14 §14.7.2's "the same header, opposite
meaning" repeats one layer deeper. Then the response headers were the same; now the magic number is the same.
**Place the determination basis one layer only and there always remains a case that passes that layer.**

This is why [`report.py:245`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L245) puts undecrypted as **FAIL** and not WARN. The file is made, its size is normal, and a
play length comes out. And yet there is no content. **A failure that looks like success** is more dangerous than
a failure that looks like failure.

### 17.9.3 Where the TSC check sits in this repository

Honestly, this check **never fires on the normal path.** Because it is already filtered three times upstream.

1. [`playlist.py:62-64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L62-L64) — if `METHOD` is not `AES-128`·`NONE` or `KEYFORMAT` is not `identity`, it is excluded
   from support
2. [`decrypt.py:36-40`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/decrypt.py#L36-L40) — if segment-unit decryption is nonetheless attempted, `NotImplementedError`
3. [`cli.py:459-464`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L464) — if the decryption result is not media, a payload-validity FAIL

Then why leave it. **Because there is no guarantee that the previous three verdicts are all correct.** Number 1
depends on the playlist's self-report. If the playlist declared `METHOD=NONE` but the actual segment is
scrambled, 1·2·3 all pass and **only the TSC check remains.**

> **After a verdict based on a self-report there must always be a verdict based on the bytes.**

It is the last application point of the principle this course has repeated since Chapter 5. The last knot of the
net is there for when all the previous knots are torn.

### 17.9.4 The defender's view

| Role | What to do |
|---|---|
| **verification-tool implementer** | separate container determination (magic number) and content validity (header fields) and check **both.** using determination-pass as validity-pass reports success on ciphertext |
| **player implementer** | if TSC ≠ 0 but there is no decryption means, **do not attempt playback and fail explicitly.** a silent black screen looks to the user like a network problem |
| **delivery operator** | make the encryption method **match** between the playlist declaration (`EXT-X-KEY`) and the actual bits. if the declaration and content go off, even a normal client makes a failure it cannot diagnose |
| **auditor** | when you see a "100% receipt success" report, ask **on what basis it was called success.** whether it is the status code, the magic number, or the header field, the meaning of that 100% is entirely different |
| **network operator** | build the threat model presupposing that even if you encrypt the content **the PID composition·packet arrival rate·PCR are exposed as-is.** encryption masks the content, not the traffic's shape |

The last row is §17.8.1's dark face. **The property that the header is plaintext is a lever for the verifier and
at the same time a window for the observer.** The same property becomes a virtue or an exposure depending on the
role — exactly the same structure as Chapter 15's "the same mechanism is used for both defense and evasion."

### 17.9.5 The course's boundary

This section **does not cover how to undo scrambling.** What it covered is "how to know the fact that it is
scrambled," and that is reading the header's 2 bits. Key acquisition·bypassing a conditional-access system has
no code in this repository and is outside the course's scope (§0.1). What must be learned here is the **threat
model and observability** — what remains plaintext, what can be known from it, and what cannot be known.

---

## 17.10 Lab — local reproduction

Every number in this chapter can be reproduced with no external server. You only need `ffmpeg` and `python3`.

### 17.10.1 Making the stream

```bash
ffmpeg -v error -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=4" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -c:v libx264 -preset ultrafast -g 30 -c:a aac \
  -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "seg%03d.ts" index.m3u8

# to see null packets, once more at constant bitrate
ffmpeg -v error -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=4" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -c:v libx264 -preset ultrafast -g 30 -c:a aac \
  -f mpegts -muxrate 3000000 cbr.ts
```

### 17.10.2 Unpacking the header by hand

```python
P = 188
data = open("seg000.ts", "rb").read()
for i in range(0, P * 6, P):
    p = data[i:i + P]
    print(f"#{i // P:<3} {p[:4].hex(' ')}  "
          f"TEI={(p[1] >> 7) & 1} PUSI={(p[1] >> 6) & 1} "
          f"PID=0x{((p[1] & 0x1F) << 8) | p[2]:04X} "
          f"SC={(p[3] >> 6) & 3} AFC={(p[3] >> 4) & 3:02b} CC={p[3] & 0xF}")
```

```
#0   47 40 11 10  TEI=0 PUSI=1 PID=0x0011 SC=0 AFC=01 CC=0
#1   47 40 00 10  TEI=0 PUSI=1 PID=0x0000 SC=0 AFC=01 CC=0
#2   47 50 00 10  TEI=0 PUSI=1 PID=0x1000 SC=0 AFC=01 CC=0
#3   47 41 00 30  TEI=0 PUSI=1 PID=0x0100 SC=0 AFC=11 CC=0
#4   47 01 00 11  TEI=0 PUSI=0 PID=0x0100 SC=0 AFC=01 CC=1
#5   47 01 00 12  TEI=0 PUSI=0 PID=0x0100 SC=0 AFC=01 CC=2
```

From packet #3 the video PID `0x0100` starts and **CC rises 0·1·2.** That only #3 has AFC `11` is because a PCR
sits there. You can also see that the stream's first three packets are SDT·PAT·PMT — an order that lets the
receiving side interpret the stream with no prior knowledge.

### 17.10.3 Inject a defect and run the checker

```python
import sys; sys.path.insert(0, ".")          # from the repository root
from hlsrecon.tsanalyze import analyze, sniff

raw = open("seg000.ts", "rb").read()
cut = (len(raw) // 188 // 2) * 188

for n in (12, 16):
    r = analyze(raw[:cut] + raw[cut + 188 * n:])
    print(n, "packets removed →", r.cc_discontinuities, "found", r.cc_detail[:1])
```

```
12 packets removed → 1 found [(256, 6, 2)]
16 packets removed → 0 found []
```

How to read `(256, 6, 2)` — on PID 256 (`0x0100`) the counter should have been 6 but 2 came. `(2 − 6) mod 16 =
12`, and this is **exactly the same as the number of packets removed.** The 4-bit counter looks as if it tells
you even the loss amount. And the very next line collapses that impression — remove 16 and `(0) mod 16 = 0` so
**it is indistinguishable from nothing having happened.**

Chapter 18 begins from this one line.

---

## 17.11 Limits and open questions

Written honestly.

- **Could not cross-check against the spec's own text.** This chapter's field layout·meanings were confirmed in
  reverse from the code and measurements (ffmpeg 8.1.1 output). There are three items not confirmed against
  ISO/IEC 13818-1's text — ⓐ the origin of 188 bytes (the ATM 4-cell story), ⓑ the null packet continuity
  counter's spec status, ⓒ what TSC values `01`·`10`·`11` each indicate. ⓒ has no effect on the verdict since
  this code sees only whether it is 0, but as a basis for the narrative it is insufficient.
- **Could not obtain a real frame-level-encryption stream.** So whether the TSC bits actually get set in such a
  stream **was not measured.** That row in §17.9.1's table is inference. To confirm it you would need an actual
  stream encoded that way.
- **Does not handle the 192-byte·204-byte variants.** Measured: put in the 192-byte format (M2TS) where a 4-byte
  timestamp precedes each packet and `sniff()` gives `unknown`, `analyze().parsed` is `False`. The 204-byte
  format with an error-correction code attached is the same. It does not appear in the current target (HLS
  segments) but for a general tool it is a limit.
- **Does not read inside the adaptation field.** In there is a `discontinuity_indicator`, which would be a basis
  to distinguish "a discontinuity the spec announced" from "loss," but this code does not read it. In a stream
  where discontinuity occurs normally via ad insertion, etc., **a false positive can arise.** It did not appear
  within this repository's measured range but has not been confirmed either.
- **If a whole PID vanishes it says nothing.** Measured: remove all 104 packets of the audio PID (`0x0101`) and
  `cc_discontinuities = 0`, `clean = True`. Because the remaining PIDs' counters are perfectly continuous. **Even
  if a whole track disappears, TS integrity passes.**
- **The undecrypted verdict is FAIL even at one packet.** Measured: even if only one packet has TSC set, `clean =
  False` and the verdict is FAIL. In a stream with one or two re-multiplexing residues mixed in it can be a false
  positive. Whether to put a threshold is an open design problem, and currently it takes the strong stance that
  "undecrypted must be 0."
- **`analyze()` alone does not guarantee it is TS.** Measured: put in 201 bytes of garbage starting with `0x47`
  and `parsed = True`, `packets = 1` comes out. In the pipeline `sniff()` filters first so it is no problem
  ([`cli.py:459-465`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L459-L465)), but **used as a function alone there is no guarantee.** It is a contractual gap born of
  separating determination and analysis.
- **This chapter's numbers are one muxer's output.** The PID assignment (0x0100·0x0101·0x1000)·AFC distribution·
  null packets' CC values are all set by ffmpeg 8.1.1's TS muxer. On another muxer·hardware encoder they can
  differ, and §17.5's "no false positive arose" conclusion is valid only that far.

---

## 17.12 Summary

1. **TS is nothing but a sequence of 188-byte fixed-length packets.** From that fixing follow the arithmetic of
   resync, O(1) container determination, packet counting, and closure under concatenation. This tool's
   determination·reassembly·verification strategies all stand on this property.
2. **The 4-byte header contains eight fields, and only one straddles a byte boundary: PID.** The mask and shift
   of `((pkt[1] & 0x1F) << 8) | pkt[2]` transfer that field boundary as-is, and omit the mask and one stream's
   counter is cut into two and the check becomes all false positives.
3. **The code reads only the bits it needs.** Instead of the 2 AFC bits it looks at one payload bit (`pkt[3] &
   0x10`), because the condition for CC increasing and that bit match exactly. Fields it chose not to read
   (PUSI·priority·inside the adaptation field) add no basis to this check.
4. **Skipping the NULL PID is a decision larger than the measured benefit.** 67.4% of the CBR stream was null
   packets, and without skipping the PID list is polluted. A CC false positive was not observed in this
   environment — because the muxer happened to fix CC to 0 — but **not making safety depend on a muxer's
   accident** is the worth of these two lines.
5. **The reassembly path is silent about loss.** `-c copy` gave exit code 0 with 0 error lines, and the play
   length was identical to the sixth decimal place. Full decode catches it but is 150× slower and does not tell
   you which segment. **The two checks fill each other's blind spots; neither contains the other.**
6. **Do not look at scrambling control and you save ciphertext as video and report success.** Since the header is
   not a scrambling target the magic-number determination passes as-is (measured: `sniff()` = `mpegts`, 1,137
   undecrypted). **Place the determination basis one layer only and there always remains a case that passes that
   layer** — a form of Chapter 14's "the same header, opposite meaning" repeated one layer deeper.
7. **Relayability requires the header be plaintext, and that property has two faces.** For the verifier it is a
   lever and for the observer a window. Encryption masks the content, not the traffic's shape.

---

**Next chapter** — in §17.10.3 the 12-packet loss was caught and the 16-packet loss was not. The cause is not a
bug but the 4-bit width itself. Chapter 18 **quantifies this check's miss rate** and sets the proposition "PASS
is not integrity but means this check could not catch it." Knowing the checker's limit is the condition for
using the checker.
