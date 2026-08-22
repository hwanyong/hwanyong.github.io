---
title: "Segment Extension Masquerading"
description: "When name, declaration, and content diverge"
date: 2026-06-20
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-14-segment-masquerading.svg
---
## 14.0 What this chapter answers

1. What is a delivery doing when the video segment comes as `.html`?
2. Is that an HLS spec violation?
3. Why send it that way?
4. On what basis must the receiving side determine it?

---

## 14.1 The problem — observation

Open a certain streaming site with devtools and the video-segment requests go out like this.

```
GET /hls/9f3a…/1080p_010.html
→ 200 OK
   Content-Type: text/html
   Content-Length: 1128368
```

It is `.html`, `text/html`, and 1.1 MB. Here two natural guesses split.

- **Guess A**: it carries the video data inside HTML (base64-encoded, etc.)
- **Guess B**: HTML is only the name and the content is video

There is only one way to tell the two apart — **look at the body's leading bytes directly.**

```
$ xxd -l 4 seg000.html
00000000: 4740 1110                                G@..
```

It is `0x47`. This is the **sync byte of MPEG-TS** — the fixed value at the head of each 188-byte packet of an
MPEG-2 Transport Stream. Guess B is correct.

**HTML is nowhere.** No tag to parse, no `<html>`, no base64 string. Only the filename extension and the
response header's `Content-Type` claim it is HTML, and the actual byte sequence is ordinary MPEG-TS.

The precise name for this practice is **content-type masquerading.** The phrase "streaming with HTML" is wrong
twice — HTML is not used, and the streaming protocol did not change. The transport is still **an ordinary HTTP
GET.** Neither a WebSocket nor a separate protocol is involved.

---

## 14.2 The principle — a file has three names

To understand this phenomenon you must first separate the fact that the layer saying "what this resource is"
is not one.

![The three tiers that state a resource's identity in one segment response](/images/lecture/hls-recon/14-three-names.svg)

*Figure 14-1 — the three tiers that state a resource's identity in one segment response*

① and ② are **the server's self-reported** values. No spec enforces that these are true, and there is no way
to. ③, by contrast, cannot be forged — forge it and the video does not play at that moment. **Even the
deliverer has the constraint that only ③ cannot be changed, and that becomes the receiving side's only lever.**

A masquerading delivery changes only ①·② and does not touch ③. That is the entire condition under which this
practice holds.

> **Term** — **magic number**: a fixed byte sequence placed at the head to identify a file format. MPEG-TS
> repeats `0x47` at a 188-byte period, and ISO-BMFF (the MP4 family) has the box type (`ftyp`·`styp`·`moof`,
> etc.) at offset 4–8.

---

## 14.3 What the spec requires

### 14.3.1 RFC 8216 does not specify the segment extension

What RFC 8216 (HTTP Live Streaming) puts a MUST on regarding extensions is **the playlist only.** A playlist's
path must end in `.m3u8`/`.m3u` or its Content-Type must be `application/vnd.apple.mpegurl` (or
`audio/mpegurl`).

**For media segments there is no such requirement.** What the spec requires is the segment's *format*
(MPEG-TS · ISO-BMFF, etc.), not its *name* or *declared type.*

![What RFC 8216 puts requirements on for extension·type](/images/lecture/hls-recon/14-rfc-scope.svg)

*Figure 14-2 — what RFC 8216 puts requirements on for extension·type*

This repository's parser reflects the same distinction in code as is.

```python
# playlist.py:18-24
def is_playlist_uri(uri: str) -> bool:
    """Does the address point at a playlist — judged only by the path extension.

    There is a delivery that puts a finished `.srt` into a subtitle-track URI instead of a
    subtitle playlist, so a spot arises that must be split before fetching.
    """
    return urlsplit(uri).path.lower().endswith(PLAYLIST_SUFFIXES)
```

That the target judged by extension is **limited to the playlist** matters. There is nowhere in this
repository code that judges a segment the same way.

### 14.3.2 But it is an HTTP spec violation

`Content-Type` must, by HTTP spec, indicate **the actual media type of the transmitted representation.**
Declaring an MPEG-TS byte sequence as `text/html` breaks this requirement.

In sum, this practice is the following combination.

| Spec | Verdict |
|---|---|
| RFC 8216 (HLS) | not a violation — the segment URI is free |
| HTTP (Content-Type accuracy) | **a violation** |

Therefore there is no basis to call it "a proper streaming communication method." It is **an evasion practice
that uses a gap in the HLS spec while violating the HTTP spec.**

### 14.3.3 And yet it is effectively acknowledged

Despite being an off-spec practice, this is not a peripheral phenomenon. Look up FFmpeg 8.1.1's HLS demuxer
default directly and it is as follows.

```
$ ffmpeg -h demuxer=hls | grep allowed_segment_extensions
-allowed_segment_extensions <string>  (default "3gp,aac,avi,ac3,eac3,flac,mkv,
  m3u8,m4a,m4s,m4v,mpg,mov,mp2,mp3,mp4,mpeg,mpegts,ogg,ogv,oga,ts,vob,vtt,
  wav,webvtt,cmfv,cmfa,ec3,fmp4,html")
                                                                    ↑
```

`html` is **in the default of the segment allow list.** The comparison target `allowed_extensions` default
does not have it — it is only in the segment-specific list.

This is not a coincidence but an upstream judgment. **"A delivery where the segment comes as `.html` really
exists, so to play it must be allowed."** By contrast `.txt` is excluded and the policy not to add it going
forward is confirmed in a public issue. That is, upstream makes an individual judgment per masquerading
extension, and `.html` is the acknowledged side of them.

---

## 14.4 The code — how does this repository handle it

### 14.4.1 Determination by bytes, not the header

```python
# tsanalyze.py:20-37
def sniff(data: bytes) -> str:
    """Determine the segment bytes' container kind: mpegts | fmp4 | unknown.

    Responding with HTTP 200 does not mean media arrived. …
    Determine by the leading bytes, not the status code.
    """
    if len(data) < 8:
        return "unknown"
    # TS repeats a sync byte every 188 bytes, so check up to the second packet.
    if data[0] == SYNC_BYTE and (
        len(data) < PACKET_SIZE + 1 or data[PACKET_SIZE] == SYNC_BYTE
    ):
        return "mpegts"
    if data[4:8] in _MP4_BOXES:
        return "fmp4"
    return "unknown"
```

This function references neither `Content-Type` nor the status code. It does not even take them as arguments —
**make it unable to receive them and it cannot reference them by mistake.**

The reason for checking up to the second packet is ruling out a chance match. The probability that an arbitrary
byte sequence starts with `0x47` is 1/256, but the probability it is `0x47` again 188 bytes later drops to
1/65536.

### 14.4.2 Promote a determination failure to a check item

```python
# cli.py:459-464
kind = sniff(data)
if kind == "unknown":
    # received a 200 but it is not media — an error page came carried instead.
    bogus.append((seg.index, res.content_type, data[:16].hex()))
    _eprint(f"    ✗ seg#{seg.index} not media (Content-Type: {res.content_type or 'none'})")
    continue
```

A determination failure does not pass quietly but piles into the `bogus` list and leads to the report's
**payload-validity** check (FAIL) ([`report.py:198-211`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L198-L211)). Leaving `Content-Type` in the record is not a basis
for the verdict but for after-the-fact analysis — which CDN declared it as what remains.

### 14.4.3 On the path delegating to ffmpeg, an argument is needed

```python
# probe.py:79-80
if playlist.is_playlist_uri(target):
    args += ["-allowed_extensions", ALLOWED_SEGMENT_EXTS]
```

The path receiving segments directly (`segments` mode) is sufficed by the `sniff()` above, but the path
handing the playlist URL whole to ffmpeg (`remux` mode·`probe` measurement·subtitle extraction) inherits
ffmpeg's extension policy as is. What adjusts that policy is this argument.

The reason for the `is_playlist_uri(target)` condition is a separate measurement case — this option exists only
on the HLS demuxer, so attach it to a non-playlist input (a delivery putting a finished `.srt` into a subtitle
track) and **the open itself fails** with `Option allowed_extensions not found` ([`probe.py:70-73`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L70-L73)).

Why this argument's value is an enumeration rather than `ALL`, and what that choice gained and did not gain, is
covered in Chapter 15.

---

## 14.5 Lab — local reproduction

You can reproduce the whole process with no external site. All you need is `ffmpeg` and `python3`.

### 14.5.1 Make a masquerading stream

```bash
# a 5-second test-pattern HLS stream
ffmpeg -v error -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=5" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -c:v libx264 -preset ultrafast -g 30 -c:a aac \
  -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "seg%03d.ts" index.m3u8

# a copy with only the extension changed — the content is untouched
mkdir -p as_html
for f in seg*.ts; do cp "$f" "as_html/${f%.ts}.html"; done
sed 's/\.ts$/.html/' index.m3u8 > as_html/index.m3u8
```

### 14.5.2 Confirm the content did not change

```bash
$ xxd -l 4 as_html/seg000.html
00000000: 4740 1110                                G@..
```

`0x47` — the extension is `.html` but it is MPEG-TS. It is the stage of confirming by eye that **only §14.2's ①
changed and ③ is the same.**

### 14.5.3 Measure playability by extension

```bash
python3 -m http.server 8977 --bind 127.0.0.1 &
for ext in ts html txt png jpg aaa; do
  # (after making a copy with each extension)
  ffmpeg -v error -i "http://127.0.0.1:8977/as_$ext/index.m3u8" -c copy -f null -
done
```

Measured result (ffmpeg 8.1.1, remote HTTP, no options):

| `.ts` | `.html` | `.txt` | `.png` | `.jpg` | `.aaa` |
|---|---|---|---|---|---|
| opens | **opens** | rejected | rejected | rejected | rejected |

Even though the content is all identical MPEG-TS, the result splits. **One filename decides playability** — this
is the opposite consequence of "① and ② guarantee nothing" said in §14.2. They guarantee nothing yet **serve as
a gate.**

### 14.5.4 This repository's tool's reaction

Feed the same `.txt`-masquerading stream to `hls-recon` and the result splits by mode.

| Mode | Result |
|---|---|
| `--mode segments` | **success** — 7 checks pass |
| `--mode remux` | **failure** (ffmpeg exit 1) |

![The two paths that split on the same masquerading stream](/images/lecture/hls-recon/14-mode-asymmetry.svg)

*Figure 14-3 — the two paths that split on the same masquerading stream*

**Delegation has a price — it inherits the delegate's policy too.** It is the concrete consequence of the
principle [`assemble.py:1-6`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L1-L6) declared, "all container work is delegated to ffmpeg."

To this is added a reproduction-difficulty trap. `auto` mode ([`cli.py:391-402`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L391-L402)) drops to `remux` only when it
is LIVE or per-segment decryption is impossible. So this failure appears only on the **LIVE + masquerading-
extension** combination, and test with VOD and it is invisible forever.

---

## 14.6 Generalization — the separation of name and content

This chapter's principle is not limited to streaming.

> **Self-reported metadata is for convenience, not a basis for judgment.**

Listing where the same structure appears, it is as follows.

| Domain | The self-reported value | The actual basis |
|---|---|---|
| file upload | the filename extension, `Content-Type` | the magic number, the actual parse result |
| email attachment | the attachment filename, the MIME part declaration | payload inspection |
| package repository | the name·version in the package metadata | the signature, the hash |
| HTTP authentication | `X-Forwarded-For`, `Referer`, `User-Agent` | none — forgeable |
| container image | the tag name | the digest |

Every system that took the left column as a basis was bypassed the same way. Check a file upload by extension
alone and a webshell goes up; judge the IP by `X-Forwarded-For` and access control collapses.

**This chapter's segment masquerade is just one item on that list.** But there is a peculiar point — here the
masquerading side is not an attacker but **the service provider itself**, and the side that must pierce the
masquerade is a client wanting normal playback. The roles of attacker and defender are placed opposite to the
usual.

---

## 14.7 Security — why send it this way

What the masquerade aims at is **every intermediate layer that judges by the URL string and response header
alone.**

| Tier | Evasion target | Working principle |
|---|---|---|
| client extension | ad blocker, download extension | the filter list uses URL patterns like `.ts`·`\.m3u8` |
| enterprise·school proxy | content filter, MIME-based blocking | a "block video MIME" rule looks at `video/*` and `text/html` is not caught |
| network device | DPI, traffic shaping | passes a device that classifies traffic by extension·MIME to limit bandwidth |
| automatic collector | a naive scraper | a tool going around looking for `.ts` finds nothing |
| CDN·billing | cache policy, bandwidth unit price | some CDNs have different cache rules and unit prices per MIME |

> **Term** — **DPI (Deep Packet Inspection)**: a technique that looks not only at a packet's header but into
> the payload to classify the traffic kind.

The premise the five tiers share is one.

> **"What a file is, the name and declaration tell you."**

The masquerade knocks down this one premise and passes the five layers at once. And **that premise was never
true to begin with.** The masquerade did not create a new vulnerability but revealed a control that depended on
an assumption that never held.

### 14.7.1 The defender's view

| Defender | Judgment |
|---|---|
| **network administrator** | extension·MIME **cannot be a control point.** to control you must see the payload, and for that you need TLS termination. that is, control at this layer has a limit in principle |
| **ad-blocker developer** | a URL-pattern filter is an arms race. what is sustainable is behavior-based detection, not string matching |
| **platform operator** | you must not trust the extension on an upload·receipt path. this chapter's principle applies as is with only the direction changed |
| **delivery provider** | in exchange for filter evasion, you come to **require every client that opens your content to relax its extension defense** → Chapter 15 |

### 14.7.2 The same header, opposite meaning

This is this chapter's last layer. A client handling masquerading delivery must distinguish the following two
responses.

| Case | Status | Content-Type | Leading bytes | Actual meaning |
|---|---|---|---|---|
| a masqueraded normal segment | `200` | `text/html` | `47 40 11 10` | **normal** — process it as is |
| a token-expiry error page | `200` | `text/html` | `3C 21 44 4F` (`<!DO`) | **failure** — catch it as FAIL |

**The headers are completely identical.** The status code and the Content-Type are the same. There is no basis
for distinction other than the leading bytes.

`README.md:247-250` recorded this fact by measurement.

> Do not mistake a normal segment declared `text/html` for an error page, and conversely catch the real HTML
> error page that comes on token expiry — on this CDN the two's headers are completely the same so without this
> method you cannot distinguish them.

**A tool that does not do this determination saves the error page as a segment and then reports "full receipt
success."** It is the point where a verification tool renders the opposite conclusion, and the reason this
repository's regression test fixed this situation as a fault injection (`tests/run.sh:141-145`).

---

## 14.8 Limits and open questions

Noted honestly.

- **The weight of the motives is an estimate.** The five tiers of §14.7 all hold technically, but which one a
  particular deliverer actually aimed at is known only to that deliverer.
- **`.html`'s special treatment depends on upstream policy.** Remove `.html` from FFmpeg's default allow list
  and the current behavior changes. It is a point where the code is tied to upstream's judgment.
- **`sniff()` knows only two containers.** A segment format other than MPEG-TS and ISO-BMFF (e.g., packetized
  audio) falls to `unknown` and becomes a false positive. Within the scope this repository handles there is no
  problem, but for a general tool it is a limit.

---

## 14.9 Summary

1. A `.html` segment **is not HTML.** Only the extension and `Content-Type` changed and the payload is MPEG-TS
   as is. The transport is an ordinary HTTP GET too, with no separate protocol.
2. **It is not an HLS spec violation** — RFC 8216 does not specify the segment URI. But declaring `Content-Type`
   wrongly is an **HTTP spec violation.**
3. A file has three names — the URI extension·Content-Type·payload. The first two are the server's self-report
   and **guarantee nothing.** What cannot be forged is only the third.
4. This practice is so widespread that FFmpeg puts `.html` in the segment allow-list default.
5. **Delegation carries the price of policy inheritance.** The path receiving directly has resistance to the
   masquerade, and the path delegating to ffmpeg is subordinate to ffmpeg's extension policy.
6. Since `200` + `text/html` means **both** a normal segment and an error page, without leading-byte
   determination a verification tool renders the opposite conclusion.

---

**Next chapter** — to play a masquerade you must relax the extension defense. But that defense was originally
made as a CVE response. Chapter 15 covers the structure where evasion and defense fight over the same control
point, and "what it becomes if you do not measure a security improvement."
