---
title: "When Evasion Makes You Turn Off the Defense"
description: "CVE-2023-6602 and allowed_extensions ALL, and an unmeasured improvement"
date: 2026-06-22
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-15-evasion-disables-defense.svg
---
## 15.0 What this chapter answers

1. Why does ffmpeg check the segment extension — convenience or defense?
2. To open a masquerading delivery, what must you turn off?
3. Turn it off and what opens?
4. **How do you confirm whether a security improvement is actually an improvement?**

The last question is this chapter's peak. This chapter is also **a record of actually attempting an
improvement and discovering that the improvement is not measured.**

---

## 15.1 The problem — what one line does

As confirmed in Chapter 14, the path delegating the playlist to ffmpeg is blocked by the masquerading
extension. This repository solved that with one argument. The code before the change was this.

```python
# probe.py:48 (before the change)
args += ["-allowed_extensions", "ALL"]
```

`ALL` — allow anything. The masquerading segment opens. The problem looks solved.

The comment too diligently explains why this argument is needed ([`probe.py:64-73`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L64-L73)). But **what this argument
turns off was written nowhere.** This chapter fills that blank.

---

## 15.2 The principle — the playlist chooses the demuxer

### 15.2.1 The extension check is a security patch

The commit message of the patch by which FFmpeg upstream introduced this check states its purpose — it is a
**CVE-2023-6602** response, and says it fixes the "HLS Force TTY Demuxer" and "HLS XBIN Demuxer DoS
Amplification."

> **Term** — **demuxer (demultiplexer)**: a component that separates individual streams — audio·video·subtitle,
> etc. — out of a container file. FFmpeg has hundreds built in, and many of them are old formats unrelated to
> video (TTY text animation, XBIN, etc.).

### 15.2.2 The attack structure

The problem's root is the spec property confirmed in Chapter 14 §14.3.1 — **an HLS playlist's segment URI is
free by spec.**

![What the attacker controls is only one sheet of playlist text](/images/lecture/hls-recon/15-attack-chain.svg)

*Figure 15-1 — what the attacker controls is only one sheet of playlist text*

The crux is that **the attacker can choose remotely "which parser to run."** The playlist is one sheet of
text, and the moment it is opened one of hundreds of demuxers boots according to the attacker's choice.

This is a textbook form of **attack-surface expansion.** The vulnerability is inside a demuxer, but what **made
it reachable** is HLS's URI freedom.

### 15.2.3 The form of defense

The extension allowlist does not fix the vulnerability. **It narrows the path to reach it.**

![An allowlist does not fix the vulnerability but narrows the path to reach it](/images/lecture/hls-recon/15-mitigation.svg)

*Figure 15-2 — an allowlist does not fix the vulnerability but narrows the path to reach it*

This distinction matters. **A vulnerability fix (patch) and a reach-path reduction (mitigation) are responses
at different layers, and in practice the latter is deployed first.** Because narrowing one gate is faster than
auditing all hundreds of demuxers.

---

## 15.3 The defense is not one layer but three

The structure of FFmpeg 8.1.1 confirmed by measurement. Trace which error comes out while changing the option
combinations and the layers separate.

![FFmpeg 8's three-layer extension-defense structure](/images/lecture/hls-recon/15-defense-layers.svg)

*Figure 15-3 — FFmpeg 8's three-layer extension-defense structure*

The measurement result table.

| Input | Option | Result | Layer caught |
|---|---|---|---|
| `.html` / local | none | rejected | ② |
| `.html` / local | `-allowed_extensions ALL` | **opens** | — |
| `.html` / remote | none | **opens** | — (allowed by default at ①) |
| `.txt` / local | `-allowed_extensions ALL` | rejected | ① |
| `.txt` / local | `-allowed_segment_extensions ALL` | rejected | ② |
| `.txt` / remote | `-allowed_segment_extensions ALL` | rejected | ③ |

Here one important fact already comes out. **`-allowed_extensions ALL` does not pierce ①.** A `.txt`·`.png`
masquerade is caught first at ①, so it does not open with this repository's argument. The reason `remux` mode
failed on a `.txt` stream in Chapter 14 §14.5.4 is this.

---

## 15.4 So what did `ALL` turn off?

The whole of layer ②. That is, **it unconditionally lifts one layer of the CVE-2023-6602 response.**

Here comes this chapter's first proposition.

> **One side's filter-evasion practice forces the other side's security defense to be turned off.**

Drawn as a structure, it is this.

![The side that decides and the side that pays the cost are different](/images/lecture/hls-recon/15-externality.svg)

*Figure 15-4 — the side that decides and the side that pays the cost are different*

The deliverer achieves its evasion purpose, but the price is **every client that opens its content relaxing its
extension defense.** The cost is passed to a third party.

This can be called an **externality.** The party making the decision and the party paying the cost differ, and
the cost is invisible to the deciding party.

---

## 15.5 Attempting an improvement — and measuring it

`ALL` is broader than necessary. By the **principle of least privilege**, you should enumerate only what is
actually needed. The extensions this tool handles are finite.

```python
# probe.py:52, probe.py:80 (after the change)
ALLOWED_SEGMENT_EXTS = "ts,m4s,mp4,m4v,mov,m4a,aac,mp3,ac3,ec3,vtt,webvtt,m3u8,m3u,html"

args += ["-allowed_extensions", ALLOWED_SEGMENT_EXTS]
```

You must not stop here. **To call it an improvement you must show it improved.** Two things to confirm.

1. **Is there no functional regression** — do the things that should open still open?
2. **Did the attack surface actually shrink** — is what opened under `ALL` now blocked?

### 15.5.1 Functional-regression check

| Input | `ALL` (before) | enumeration (after) |
|---|---|---|
| `.html` / local | opens | **opens** |
| `.html` / remote | opens | **opens** |
| `.ts` / local | opens | **opens** |

No regression. The full regression test (`./tests/run.sh`) also **passed 62/62.**

### 15.5.2 Attack-surface-reduction check — a result different from expectation

Measured with extensions that are in the layer-② default list but this tool does not use. The content is all
identical MPEG-TS and only the filename differs.

| Extension | `ALL` (before) | enumeration (after) | Difference |
|---|---|---|---|
| `.avi` | rejected | rejected | none |
| `.mkv` | rejected | rejected | none |
| `.vob` | rejected | rejected | none |
| `.ogg` | rejected | rejected | none |
| `.wav` | rejected | rejected | none |
| `.flac` | rejected | rejected | none |
| `.3gp` | rejected | rejected | none |
| `.html` | opens | opens | none |
| `.ts` | opens | opens | none |

**The behavior is the same on every item.** The attack-surface reduction is not measured.

---

## 15.6 Why is it not measured — the incidental defense

The cause is in §15.3's three-layer structure. Layer ③ (the format–extension match check) filters **behind
layer ②, and more strictly.**

![The incidental defense — ② is hidden behind ③](/images/lecture/hls-recon/15-incidental-defense.svg)

*Figure 15-5 — the incidental defense — ② is hidden behind ③*

That is, **layer ② is currently hidden behind layer ③.** Narrow ② or widen it and there is no observable
difference.

This state needs a name. This course calls it an **incidental defense** — a state where a control does not
actually take effect, but **another control blocking in front of it makes it look effective, or conversely look
ineffective.**

Here comes this chapter's second proposition.

> **If you do not measure a security improvement you cannot know whether it is an improvement, and calling it
> an improvement unmeasured becomes security theater.**

Had it not been measured, this change would have been recorded as "applied the least-privilege principle to
reduce the attack surface." That record is **a sentence not wrong but with no true basis.** And the next person
comes to judge, on the basis of that sentence, "this part is already strengthened."

---

## 15.7 Why enumeration was chosen anyway

If it was not measured, should it be reverted? This course's judgment is **keep it**, and the basis is two.
A keep with no stated basis is taste, not engineering, so it is written down.

### Basis 1 — do not make a coupling between layers

**Defense in depth** holds only when each layer works **independently.** The judgment "③ blocks it so ② can be
opened wide" makes ②'s security depend on ③'s existence. Then the moment ③ is relaxed or removed, ② remains in
a state defending nothing — and **no one knows that fact.**

This repository does not fix the ffmpeg version. The README's requirement is only "ffmpeg/ffprobe on PATH."
Layer ③ was introduced relatively recently (an upstream commit January 2025, backported to the 4.4·7.0·7.1
release branches), and in a build without it **② is the only gate.** That is, this change's effect is **0 in
the current environment but not 0 in all environments.**

### Basis 2 — the list itself becomes a record

`ALL` is a declaration "open anything," and that differs from this tool's actual need. The enumerated list
becomes **the single source of truth for "what segment formats this tool handles."** When supporting a new
format the spot to fix is made explicit, and someone reading the code can know the support range.

### And honestly — write it into the code as is

What matters is that **the comment does not diverge from the measurement result.** The actual code says this.

```python
# probe.py:43-46
# But noted honestly. **Measured on ffmpeg 8.1.1, the behavior of `ALL` and this enumeration was
# completely the same.** Because the format–extension match check placed behind filters it first
# (if the content is MPEG-TS but the extension is `.avi`, either way it is rejected). That is, this
# change's current gain is not measured. The reasons enumeration was chosen anyway are two.
```

It did not write "reduced the attack surface." **Writing what was measured and what was not measured
separately** is the form this course recommends.

---

## 15.8 Generalization — when evasion and defense fight over the same control point

This chapter's structure repeats outside streaming too. The common form is as follows.

> **When a mechanism is used both for defense and for evasion, one side's victory automatically becomes the
> other's defeat.**

| Case | The defense-side use | The evasion-side use | Result |
|---|---|---|---|
| **extension allowlist** | reducing reachable parsers | masquerade for filter evasion | to play, relax the defense |
| **certificate verification** | blocking a man-in-the-middle | an enterprise proxy's TLS inspection | to inspect, relax verification (install a private CA) |
| **CSP** | blocking XSS | a normal inline script | add `unsafe-inline` for convenience |
| **SELinux·AppArmor** | privilege isolation | a normal app's exceptional access | switch to permissive if it does not work |
| **CORS** | blocking cross-origin reads | a normal API call | `Access-Control-Allow-Origin: *` if bothersome |

The last column of each row is identical — **the moment a defense blocks normal use, the user chooses to turn
the defense off.** And usually turns it off in the broadest way (`ALL`, `*`, `permissive`, `unsafe-inline`).

Here a practical principle is derived.

> **When you must turn off a defense, turn it off in the narrowest scope.**
> Only the needed value instead of `ALL`. Only a specific origin instead of `*`. Only a specific domain instead
> of permissive.

This principle does not conflict with §15.6's measurement result. The reason turning it off narrowly is correct
even when unmeasured is §15.7's basis 1 — **to not make a coupling between layers.**

---

## 15.9 The defender's view

| Role | What to do |
|---|---|
| **client implementer** | do not use `ALL` when turning off a defense. enumerate the needed values, and leave in a comment **why that list.** and measure that change's effect |
| **delivery provider** | recognize that an evasion practice passes the cost to a third party. weigh the gain from extension masquerading against the cost of requiring defense relaxation from every client |
| **library maintainer** | when a defense blocks normal use, the user turns it off in the broadest way. so **make the narrow-off path easy.** that FFmpeg takes a list specification alongside `ALL` is correct design in this respect |
| **auditor** | when you see a change labeled "security improvement," **require the measurement result.** an improvement claim with no measurement is a verification target, not a basis |

---

## 15.10 Limits and open questions

- **The exact behavior of layer ③ was not confirmed from the source.** This chapter's three-layer model is
  **inferred in reverse** from the error messages per option combination. Read `libavformat/hls.c` and the
  layer boundaries may appear differently. The observed behavior is reproducible, but the statement about the
  internal structure is disclosed as black-box inference.
- **It could not be verified on a build without layer ③.** §15.7 basis 1's key claim ("in a build without ③, ②
  is the only gate") is inference, not measurement. To confirm it you would repeat the same experiment with an
  old-version build.
- **The completeness of the `ALLOWED_SEGMENT_EXTS` list is not guaranteed.** If a normal extension this tool has
  not encountered is missing from the list, it will block a normal stream in the future. It is a failure mode
  `ALL` did not have — **the narrowing choice carries this cost.**

---

## 15.11 Summary

1. ffmpeg's segment-extension check is not a convenience feature but a **CVE-2023-6602 response defense.** It
   narrows the attack surface that boots an arbitrary demuxer remotely using the HLS playlist's URI freedom.
2. `-allowed_extensions ALL` unconditionally lifts one layer of that defense.
3. **When evasion and defense fight over the same control point, one side's victory is the other's defeat.** The
   deliverer's filter evasion creates an externality requiring defense relaxation from every client.
4. `ALL` was changed to an enumeration, and there **was no functional regression** (62/62 passed). But the
   **attack-surface reduction was not measured** — because layer ③ hides layer ② (the incidental defense).
5. The basis for keeping it anyway is **not making a coupling between layers** and **the list being a record of
   the support range.** The basis was left in the code comment along with the measurement result.
6. **An unmeasured security improvement cannot be called an improvement.** Writing what was measured and what
   was not measured separately is this course's form.

---

**Next chapter** — Chapters 14·15 stand on the principle "do not trust the declaration, look at the content."
But in the browser exactly that principle was long a vulnerability, and so the defense header
`X-Content-Type-Options: nosniff` was made. Chapter 16 covers why the same principle is a virtue on one side and
a vulnerability on the other.
