---
title: "The Boundary of Delegation"
description: "Knowing what the library does not do"
date: 2026-07-28
version: '1.0'
tags: ['streaming', 'distributed-systems']
thumbnail: /images/lecture/thumb/hls-recon-30-delegation-boundary.svg
---
## 30.0 What this chapter answers

1. What did this repository leave to ffmpeg, and what could it not leave?
2. If you do not know what the delegated side **does not do**, what goes quietly wrong?
3. On what does the judgment to **not re-delegate** something already finished rest?
4. Is what delegation inherits only the capability?

This is the chapter closing Part 6. Chapters 27–29 each covered three problems of matching the subtitle time to
the video time (affine correspondence · 33-bit wrapping · boundary-duplicate cues). This chapter asks **why those
three are in this code.** A repository that left segment merging and container conversion all to ffmpeg — why does
it do those three itself. The answer gathers into one principle.

---

## 30.1 The problem — the subtitle is 60 seconds off yet no one fails

### 30.1.1 Observation

Think of a run that receives one subtitle track and pulls it into a file. The concatenation is left to ffmpeg,
and its result is used as-is. The signal each stage gives is this.

```
receive 5 subtitle pieces  → all HTTP 200
ffmpeg concatenation       → exit 0, stderr empty
generated file             → valid WebVTT, cues are in it
put into a player          → opens with no error
```

No stage failed. And yet this subtitle **is not matched to the video timeline.** The `X-TIMESTAMP-MAP` carried in
each piece's header directs "this time of the subtitle is that time of the video," but **not a single layer
applied that directive.** So the whole track remains slipped by the directed amount.

The size of the slip differs per delivery. This repository's regression test nails it to **60 seconds** for
reproduction — since the video is 30 seconds, a 60-second-off subtitle appears **not a single line** on screen,
and the target the slip-checking side must catch is clear.

![The signal each layer gives in a run where the subtitle is 60 seconds off](/images/lecture/hls-recon/30-silent-pass.svg)

*Figure 30-1 — the subtitle is 60 seconds off yet no layer gives an error*

The form of the defect injection is this.

```python
# tests/run.sh:89-92
# subbad sets the X-TIMESTAMP-MAP reference 60 seconds off so the subtitle strays out of the video range.
# must not make it negative — a negative is invalid for a 33-bit unsigned PTS so timestamp_offset returns
# None (subtitles.py:208-210), no correction is applied at all, and the defect is not injected.
OFFSET = {"subko": 0, "suben": 0, "subbad": 60 * 90000}
```

Note the form of the injection. It did not break the file and did not fail a response. **It only changed one
number written in the header** and the output becomes useless. And the error telling that fact is nowhere.

> The second sentence is Chapter 28's material. And it is worth noting **who discards the invalid value** — not
> ffmpeg but **this repository's code.**
>
> ```python
> # subtitles.py:208-210
>     # a 33-bit unsigned value is the spec so a negative is invalid — do not trust the mapping itself.
>     if mpegts < 0:
>         return None
> ```
>
> When `timestamp_offset` returns `None` the caller does not apply the correction, and the subtitle stays in its
> original place. **The defect is not injected.** This comment originally read "because ffmpeg sees it as invalid
> and ignores the mapping itself," and this section's verification found and fixed that attribution error. In a
> chapter on delegation there is no more fitting case than **writing down what one did oneself as what the
> delegate did.**

### 30.1.2 We have seen this form already

Chapter 0 §0.1's starting point was of the same form.

```
1 six-second segment lost → ffmpeg exit code 0, output length 30.03s (same as normal)
                          → in reality the 5.99s ~ 12.02s stretch is entirely empty
```

Segment loss and subtitle slip handle different targets but **the failure mode is the same.**

| | Segment loss | Subtitle 60-second slip |
|---|---|---|
| Exit code | 0 | 0 |
| Standard-error output | empty | empty |
| Output's format validity | valid | valid |
| The metric visible on the surface | total length normal | cues are in and format valid |
| Actual state | a 6-second stretch is empty | the subtitle appears not a single line |

In both cases **the observation metric points at normal but the result is wrong.** Chapter 0 organized this as
"choose a wrong observation metric and the whole verification is meaningless." This chapter goes one step deeper
and asks — **why does no one give an error in the first place.**

The answer is simple, and being simple, easy to miss.

> **Because there was no layer that took on that job.**

ffmpeg did not lie. It did exactly the job it took on (concatenating subtitle pieces in order) and so gave exit
0. The problem is that one job **no one took on** remained. And a job no one took on **no one reports failure
for.**

---

## 30.2 The principle — the three things delegation hands over

### 30.2.1 What decision is delegation

> **Term** — **delegation**: the design decision to hand a responsibility not implemented oneself to another
> component. The handing side is called the delegator, the receiving side the delegate. A function call·library
> use·external-process run·SaaS adoption are all the same form.

This repository's reassembly layer declares delegation as a principle.

```python
# assemble.py:1-6
"""Reassembly layer — all actual container work is delegated to ffmpeg.

Segment merging·decryption·timestamp normalization are already implemented per spec
by ffmpeg's hls/mpegts demuxer, so they are not rebuilt here. This module's responsibility
is only "with what arguments to delegate" and "how to measure progress."
"""
```

This declaration was already cited in Chapter 19. There it was the basis explaining the exception "and yet
`concat_segments` alone does it directly." Here it is read in the opposite direction — **what does the decision to
delegate also decide.**

### 30.2.2 Three things come over together

![The three things delegation hands over](/images/lecture/hls-recon/30-three-regions.svg)

*Figure 30-2 — delegation is not a decision receiving only the capability*

| Region | Identity | When it is revealed |
|---|---|---|
| **capability** | the work the delegate has implemented per spec | immediately — this is what you delegate to obtain |
| **constraint** | the rules·option schema·per-version behavior the delegate set | only on a particular input — hard to reproduce |
| **silence** | the work the delegate does not do, without saying it does not | **not revealed** |

Deciding delegation by looking at only the capability is the default. Because docs and examples explain only the
capability. The constraint pops out later on a strange input, and the silence does not pop out.

### 30.2.3 The three forms of silence

"Does not do" has grades too. This distinction is this chapter's core tool.

| Form | The delegate's reaction | Can the delegator know | Example |
|---|---|---|---|
| **rejection** | error·exception·nonzero exit code | **can know** | an unsupported extension → `Invalid data found` |
| **unimplemented notice** | warning log·no-feature marking | can know (if you read the log) | `Codec not supported, ignoring` |
| **silence** | normal exit, a normal-format output | **cannot know** | it concatenated the subtitles but did not match them to the video |

The first two are the delegation relationship's normal operation. The delegate **tells** its boundary. The
problem is the third — the reason the delegate does not tell its boundary is usually **that it never regarded it
as its job.** There is no component that reports having not done what is not its job.

> **The danger of delegation is not that the delegate cannot do the work. It is that the delegate does not regard
> the work as its own while the delegator believes it delegated it.**

### 30.2.4 Why does ffmpeg not apply X-TIMESTAMP-MAP

§30.1's 60-second slip is a typical silence. And yet calling this ffmpeg's defect misses the principle. Read the
code's explanation as-is.

```python
# subtitles.py:194-197
    X-TIMESTAMP-MAP=LOCAL:<subtitle time>,MPEGTS:<90kHz clock> is a correspondence table saying 'this
    subtitle time corresponds to this clock value on the video timeline'. ffmpeg 8.1.1 does not apply
    this mapping regardless of the input configuration (measured: opening via a master input, the result
    with MPEGTS changed is the same), so compute and correct directly. Nonzero means the subtitle is slipped that much.
```

This comment originally wrote a different reason. **"ffmpeg does not apply this mapping when opening a subtitle
playlist as a standalone input — the video that would be the alignment reference is not in that input."** It is
plausible. `X-TIMESTAMP-MAP` is a correspondence table joining two time axes (Chapter 27), and to use a
correspondence table both axes must be present. By that explanation, **open with a master playlist and the video
axis arises so the demuxer should apply it on its own.**

Chapter 27 §27.4 already experimented on that implication, and this section reproduced it independently. I opened
two subtitle playlists with completely the same cue content and only the `MPEGTS` value differing by 60 seconds,
each bundled with the same video into a master playlist.

```text
$ ffmpeg -i master_s0.m3u8  -map 0:s:0 -c:s webvtt out_s0.vtt   # MPEGTS:0
$ ffmpeg -i master_s60.m3u8 -map 0:s:0 -c:s webvtt out_s60.vtt  # MPEGTS:5400000 (60s)

out_s0.vtt   first cue  00:01.467 --> 00:03.467
out_s60.vtt  first cue  00:01.467 --> 00:03.467      ← the same
```

**I moved the MPEGTS value by 60 seconds and the output did not differ by a millisecond.** Even in a
configuration with a video axis the mapping was not applied (the 1.467-second slip is the result of matching the
video first PTS, not of reading `X-TIMESTAMP-MAP`). Check the binary and the reason is clear.

```text
$ strings -a libavformat.62.dylib | grep -c WEBVTT
15
$ strings -a libavformat.62.dylib | grep -c X-TIMESTAMP-MAP
0
```

`WEBVTT` appears 15 times but `X-TIMESTAMP-MAP` appears **not once.** ffmpeg 8.1.1's libavformat does not have
code parsing this header. That is, the corrected fact is this.

| Input configuration | Is there a video axis | Mapping applied (ffmpeg 8.1.1 measured) |
|---|---|---|
| subtitle playlist **standalone** (`-i subs.m3u8`) | none | does not apply |
| whole master playlist (`-i master.m3u8`) | present | **does not apply** |

**It was not "a function of the input."** The original comment attached a plausible reason to an observed
silence, and what that reason predicted (opening with a master processes it) was refuted by experiment. The
comment was fixed as quoted above.

This is the most costly lesson in this chapter.

> **When the delegate is silent the delegator wants to attach a reason to that silence. That reason hardens into
> a code comment unverified, and even wrong nothing happens — because the delegator is doing that job directly
> anyway.**

Here comes one practical rule. **The narrative about what the delegate does not do must be written as "under what
configuration it does not," not "why it does not."** The former form cannot be verified, and the latter is
refuted in 30 seconds like the experiment above.

The reason this repository pulls the subtitle **separately** is to make a sidecar file (a separate subtitle file
placed beside the video). The decision to do the mapping correction directly — even with a wrong reason — was
right. **That a right decision can stand on a wrong reason** is the uncomfortable fact this section leaves.

---

## 30.3 The code — what was delegated

### 30.3.1 The list of what was delegated

| Delegated work | Reason delegated | Code anchor |
|---|---|---|
| segment merging (remote path) | the hls demuxer implements it per spec | [`assemble.py:69-90`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L69-L90) `remux_from_url` |
| container muxing·conversion | no reason to rebuild box·PES rewriting | [`assemble.py:108-130`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L108-L130) `remux_local` |
| timestamp normalization | PTS/DTS rewriting needs container knowledge | [`assemble.py:121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L121) `-fflags +genpts` |
| AES-128 decryption (remote path) | in `remux` mode ffmpeg fetches the key directly | [`assemble.py:78`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L78) docstring |
| redirection·segment retry (remote path) | same as above | [`assemble.py:78`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L78) |
| subtitle-piece concatenation | no reason to rebuild piece order·format parsing | [`subtitles.py:142-149`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L142-L149) |
| subtitle format conversion (vtt↔srt) | codec conversion is ffmpeg's job | [`subtitles.py:432-441`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L432-L441) `_convert` |
| container subtitle embedding | mapping·metadata muxing | [`subtitles.py:339-374`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L339-L374) `embed_args` |
| stream info·packet-time measurement | ffprobe reads the container | [`probe.py:124-162`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L124-L162), `191-233` |

Here you want to attach one commonality — "all work that must understand the container's internal structure."
Mostly right, but **this very table refutes that generalization.** Redirection and segment retry are the
transport layer's job, not the container's, and among "what was done directly" seen in §30.4 there is the MPEG-TS
continuity-counter check — the most container-internal work of parsing the 188-byte packet header directly.

What divides the boundary is **not the work's material but whether the delegate regards it as its own.** Divide by
material and it goes off at those two counterexamples right away. This is why §30.2.3's three-grade silence
classification is the criterion.

### 30.3.2 `remux_local` — a function that touches not a single byte

The function where the form of delegation is best revealed.

```python
# assemble.py:108-130
def remux_local(
    raw: Path,
    out: Path,
    on_progress: Callable[[float], None] | None = None,
    subs: tuple[list[str], list[str], str] | None = None,
) -> list[str]:
    """Losslessly mux the concatenated raw into the final container.

    A subtitle input has subtitles.embed_args() return it with even its own input options,
    so here they are just appended as-is.
    """
    cmd = [
        require("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
        "-fflags", "+genpts",  # correct the PTS gap at segment junctions
        "-i", str(raw),
    ]
    if subs:
        cmd += subs[0]
    cmd += _stream_args(subs)
    cmd += container_args(out)
    cmd += ["-progress", "pipe:1", str(out)]
    _run_with_progress(cmd, on_progress)
    return cmd
```

What this whole function does is **make a list.** It does not open `raw`, nor read or write bytes. The heavy task
of container conversion is reduced here to string assembly. This is the concrete form of "delegate."

> **Term** — **remuxing**: the work of rewriting only the container **without re-encoding** the audio·video
> streams. This repository does not re-encode on any path (`-c copy`, [`assemble.py:16`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L16)).

And the last line `return cmd` is the finish of the delegation design. It returns the executed command as-is and
leaves it in the report ([`cli.py:637`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L637) `mux_cmd=run.mux_cmd`). **Delegated work must be reproducible** — if what was delegated is
not left in the record, the result cannot be verified.

### 30.3.3 `container_args` is part of delegation too

Delegation is not "handle it however." The delegator **must know** under what conditions the delegate fails.

```python
# assemble.py:16-31
# Per-container extra arguments. Never re-encode in any case (-c copy).
_CONTAINER_ARGS: dict[str, list[str]] = {
    # A bitstream filter converting ADTS-headered AAC into MP4's ASC format.
    #
    # Written honestly. **Measured on ffmpeg 8.1.1, the mov muxer inserts this filter itself**
    # — the verbose log prints "Automatically inserted bitstream filter
    # 'aac_adtstoasc'", and the audio payload md5 of the output specifying it and the output
    # not specifying it are the same. That is, this argument's current benefit is not measured.
    #
    # The reason to keep it anyway is the same as probe.py's extension enumeration — this tool
    # does not pin the ffmpeg version so it does not want to lean on the muxer's auto-insertion.
    ".mp4": ["-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"],
    ".m4v": ["-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"],
    ".mkv": [],
    ".ts": [],
}
```

AAC inside MPEG-TS has an ADTS header and MP4 requires the ASC format, so a bitstream filter must change the
header format — up to here it is a fact of the spec. The problem is **who changes it.**

This comment originally read like this.

```text
# If ADTS-headered AAC is not converted to MP4's ASC format, mp4 muxing fails.
```

Verified while writing this course, **that sentence was not true in the current environment.**

```text
$ ffmpeg -v verbose -i src.ts -c copy out_nobsf.mp4        # did not give the filter
Automatically inserted bitstream filter 'aac_adtstoasc'; args=''
$ echo $?
0

$ ffmpeg -i out_nobsf.mp4 -map 0:a -c copy -f md5 -
MD5=c7be92a4449e31fa0b7f5a81a9bfd093
$ ffmpeg -i out_bsf.mp4   -map 0:a -c copy -f md5 -        # specified the filter
MD5=c7be92a4449e31fa0b7f5a81a9bfd093
```

**It does not fail. The output audio is byte-identical too.** Because the mov muxer inserts the needed filter
itself (ffmpeg 8.1.1).

So this spot is not §30.2.3's **rejection** but a **silent proxy-action.** The delegate handled it on its own
before the delegator, and does not report that fact in the default log — you must raise it to `-v verbose` to
see. The delegator keeps giving that argument with no way to confirm why it gives it.

It is the same shape met over `-allowed_extensions` in Chapter 15 §15.6. **An argument whose benefit is not
measured now is kept for the reason of not wanting to lean on the delegate's implementation.** The only
difference is one — Chapter 15 wrote that fact in the code and this side did not. So the comment aged, and no one
knew the aged line. This section's verification found it and the comment was fixed as quoted above.

**The empty lists of `.mkv` and `.ts` are still evidence this table is a product of measurement** — nothing was
put in for containers that do not need it. Only, measurement is not a one-time thing. **When the delegate is
upgraded, the delegator's knowledge quietly ages.** The real cost of delegation is not the moment of handing off
but here, in the counterpart changing after the handoff.

---

## 30.4 The code — what was done directly because it could not be delegated

### 30.4.1 The list and reasons

| Directly-done work | Why it cannot be delegated | Code anchor |
|---|---|---|
| `X-TIMESTAMP-MAP` alignment correction | ffmpeg does not apply it under any input configuration (§30.2.4) | [`subtitles.py:191-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L191-L218), [`cli.py:237-289`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L237-L289) |
| boundary-duplicate cue removal | ffmpeg only concatenates — being a spec-permitted duplicate it is not even an error | [`subtitles.py:259-322`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L259-L322) `dedupe` |
| fragment-header cleaning | a **byproduct** of concatenation so to the delegate it is normal output | [`subtitles.py:172-181`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L172-L181) `_clean_body` |
| transport-layer measurement | ffmpeg does not report the HTTP status·TTFB·wire bytes (§30.7) | [`fetch.py:73-104`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L73-L104), [`report.py:159-230`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L159-L230) |
| payload determination | must look at the leading byte, not the header (Chapters 14·16) | [`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37) `sniff` |
| MPEG-TS continuity-counter check | the demuxer only recovers loss and does not report it (Chapter 18) | [`tsanalyze.py:71-121`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L71-L121) |
| timeline-loss scan | the total length is preserved so to ffmpeg it is normal (Chapter 21) | [`probe.py:191-233`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L191-L233) `gap_scan` |

The first three are Part 6's subject (time and distribution), and the last four are Part 2·Part 3·Part 4's
subject. Things each covered in different parts **are tied by one principle** — all are §30.2.3's **silence**
region.

### 30.4.2 `extract` — two worlds in one function

The subtitle-extraction function is the seam where delegation and direct handling meet. The docstring declares the
boundary first.

```python
# subtitles.py:116-127
    """Pull each subtitle track into a separate file (sidecar).

    If the track URI is a subtitle playlist, the pieces must be concatenated so it is left to ffmpeg.
    Some deliveries declare a finished subtitle file directly as the URI (the spec requires a playlist
    but they go out that way), and there it ends with receiving and storing — feeding ffmpeg when
    there is no piece to concatenate only loses the original bytes and gains nothing.
    fetch_sidecar already knows how to receive, so it is passed there.

    offsets is track URI → alignment offset (seconds). The X-TIMESTAMP-MAP correction ffmpeg
    does not apply is reflected directly after extraction. A finished file has no such mapping
    so it is not a target.
    """
```

The three paragraphs each hold a different decision.

| Paragraph | Decision | Basis for the judgment |
|---|---|---|
| 1 | if pieces, delegate to ffmpeg | concatenation is the delegate's capability |
| 2 | if a finished file, **do not delegate** | loses the original bytes gaining nothing (§30.5) |
| 3 | apply the correction directly after delegating | the delegate's silence region |

And the body is exactly that order.

```python
# subtitles.py:138-164
        if not is_playlist_uri(track.uri or ""):
            results.append(fetch_sidecar([track.uri or ""], dest, fetcher, fmt, track))
            continue

        cmd = [require("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y"]
        cmd += input_args(fetcher.headers, track.uri or "")
        cmd += [
            "-i", track.uri or "",
            "-map", "0:s:0",
            "-c:s", codec,
            str(dest),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        res = SubtitleResult(track=track, path=dest)
        if proc.returncode != 0:
            res.error = proc.stderr.strip()[-300:] or f"ffmpeg exit {proc.returncode}"
        elif not dest.exists() or dest.stat().st_size == 0:
            res.error = "an empty file was generated — the subtitle piece has no cues"
        else:
            res.ok = True
            res.duplicates, res.header_leaks = dedupe(dest, fmt)
            res.offset = (offsets or {}).get(track.uri or "", 0.0)
            shift(dest, fmt, res.offset)
            res.cues, res.first_cue, res.last_cue = measure(dest)
            if res.cues == 0:
                res.ok, res.error = False, "there is not a single cue"
        results.append(res)
```

Look at the three branches under `proc.returncode != 0`.

| Branch | What it catches | §30.2.3's form |
|---|---|---|
| `returncode != 0` | the delegate **rejected** | rejection |
| no file / 0 bytes | the delegate reported success but there is no output | the boundary of rejection and silence |
| the four lines under `else:` | the delegate succeeded and there is output — **from here is the silence region** | silence |

The four lines of the `else` block are the abridgment of this whole chapter. **Direct handling begins at the
point where delegation succeeded.** Not "it succeeded so it is done" but "it succeeded so now the work the
delegate did not do must be done."

### 30.4.3 The post-processing has an order

The order `dedupe` → `shift` → `measure` is not arbitrary.

| Order | Why this spot | If you break it |
|---|---|---|
| 1 `dedupe` | fragment-header cleaning and duplicate removal | (see below) |
| 2 `shift` | move the times after the cue count is fixed | it moves even duplicate cues so meaningless work rises, and the duplicate-judgment key splits before and after the move |
| 3 `measure` | read the cue count·range from the final file | the report reports the pre-tidy state |

Inside `dedupe` there is one more order, and this was Chapter 29's subject.

```python
# subtitles.py:296-300
        # Clean the header before the duplicate judgment. If the contaminated side and the clean side's bodies
        # look different, the same cue is not caught as a duplicate.
        body = _clean_body(raw_body)
        if body != raw_body:
            leaked += 1
```

The fact that two post-processings are **entangled with each other** matters. A byproduct the delegated side left
(the fragment header) contaminates the input of another post-processing (the duplicate judgment). A problem
flowing out of the delegation boundary does not come alone.

### 30.4.4 Measured — what actually remains in the delegated result

You can confirm locally that the above claims are not abstract. It reproduces with no external server and all you
need is `ffmpeg` and `python3`.

**Setup**: a 30-second video, five 6-second WebVTT pieces. The unique cues are **6**, and interval-straddling
cues were put on both pieces as the spec permits (Chapter 29). So the cue **instances** scattered across the
pieces are 9.

```bash
$ grep -c -- '-->' subko/seg*.vtt
subko/seg000.vtt:2
subko/seg001.vtt:2
subko/seg002.vtt:2
subko/seg003.vtt:2
subko/seg004.vtt:1        # total 9 instances / 6 unique cues
```

Now leave the concatenation to ffmpeg.

```bash
$ ffmpeg -v error -y -protocol_whitelist file,http,https,tcp,tls,crypto \
    -allowed_extensions ts,m4s,vtt,webvtt,m3u8 \
    -i subko/index.m3u8 -map 0:s:0 -c:s webvtt raw.vtt
$ echo $?
0
$ grep -c -- '-->' raw.vtt
9
```

**exit 0, 9 cues.** And the file's front part is this.

```
WEBVTT

00:00.000 --> 00:04.000
line 1

00:05.000 --> 00:09.000
line 2
WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

00:05.000 --> 00:09.000
line 2
```

Two things are seen at once.

1. `line 2` is carried **twice** — the boundary-duplicate cue remained as-is
2. **inside** the second `line 2` cue's body are `WEBVTT` and `X-TIMESTAMP-MAP=…` — the fragment header was
   absorbed into the previous cue's body

And §30.2.4's claim is confirmed the same way. Change the fragment header's `MPEGTS` value to declare **"subtitle
local 0 seconds is the video's 60-second point"** and run the same command.

```bash
$ grep X-TIMESTAMP-MAP subshift/seg000.vtt
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:5400000     # 5400000 / 90000 = 60s

$ ffmpeg -v error -y -protocol_whitelist file,http,https,tcp,tls,crypto \
    -allowed_extensions ts,m4s,vtt,webvtt,m3u8 \
    -i subshift/index.m3u8 -map 0:s:0 -c:s webvtt shifted.vtt
$ grep -m1 -- '-->' shifted.vtt
00:00.000 --> 00:04.000
```

**The first cue still starts at 0 seconds.** It was declared the 60-second point but not moved — because the
reference to move it (the video axis) is not in that input. No error, no warning.

The boundary-duplicate and header-absorption sides are phenomena [`subtitles.py:172-181`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L172-L181)'s comment already
recorded.

```python
# subtitles.py:172-181
def _clean_body(body: str) -> str:
    """Strip fragment headers that got mixed into a cue body.

    When ffmpeg concatenates subtitle pieces, it absorbs each piece's leading `WEBVTT` and
    `X-TIMESTAMP-MAP=` lines into the previous cue's body. Leave them and those strings are
    displayed on screen as subtitles, so remove them.
    """
    return "\n".join(
        ln for ln in _SEG_HEADER_RE.sub("", body).split("\n") if ln.strip()
    ).strip()
```

Organize the measurement in a table (ffmpeg 8.1.1, macOS arm64).

| Observed item | Value | The delegate's verdict |
|---|---|---|
| exit code | 0 | success |
| standard-error output | empty | no anomaly |
| the output file's format validity | valid WebVTT | no anomaly |
| cue instance count | **9** (6 unique) | — |
| cues with a header mixed in the body | **4** | — |
| `X-TIMESTAMP-MAP` reflected | **not reflected** (60s declared → 0s output) | — |

**About the lower three rows the delegate says nothing.** A tool looking at only the upper three rows records
this file as "normal extraction." This is why this repository places `dedupe`·`shift` directly, and why the
regression test nails its result in numbers.

```bash
# tests/run.sh:225-227
# The original is 6 cues per track. If boundary duplicates remain it becomes 9 cues.
kocues=$(grep -c -- '-->' "$WORK/out/subs.ko.vtt" || true)
[[ "$kocues" -eq 6 ]] && ok "boundary duplicates removed (6 cues)" || bad "cue count is not 6: $kocues"
```

**The sentence "it becomes 9 cues" matches the measurement above exactly.** It means the number written in the
comment is not an estimate but an observation, and that is why this repository can be used as a course (Chapter 0
§0.6).

---

## 30.5 The judgment to not re-delegate — a finished subtitle is not fed to ffmpeg

### 30.5.1 The decision

§30.4.2's docstring second paragraph is this section's subject.

> Feeding ffmpeg when there is no piece to concatenate **only loses the original bytes and gains nothing.**

The same judgment is written on the sidecar-receive side too.

```python
# subtitles.py:451-455
    """Try the subtitle URL candidates from the front and store the first that succeeds.

    A received file is a finished copy so dedupe/shift are not applied — those two are problems that arise
    only in a product concatenated from pieces. The original bytes must be left as-is to compare with the result
    of fetching the same URL by hand. A converted copy is made separately only when the request format differs from the original.
```

> **Term** — **sidecar subtitle**: a subtitle placed not inside the video container but beside the video file as a
> separate same-named file (`video.ko.srt`, etc.). The player finds the pair by the filename rule.

### 30.5.2 What is lost — measured

The claim "loses the original bytes" can be confirmed directly. Make a SubRip file in a form servers commonly emit
(BOM + CRLF line endings) and pass it through ffmpeg once.

```bash
$ xxd -l 16 orig.srt
00000000: efbb bf31 0d0a 3030 3a30 303a 3031 2c30  ...1..00:00:01,0
          ^^^^^^^   ^^^^
          UTF-8 BOM CRLF

$ ffmpeg -v error -y -i orig.srt -c:s subrip round.srt
$ xxd -l 16 round.srt
00000000: 310a 3030 3a30 303a 3031 2c30 3030 202d  1.00:00:01,000 -
            ^^
            LF alone — the BOM vanished

$ wc -c orig.srt round.srt
     119 orig.srt
     110 round.srt
$ cmp orig.srt round.srt
orig.srt round.srt differ: char 1, line 1
```

The measurement.

| Item | Original | After ffmpeg pass | Verdict |
|---|---|---|---|
| UTF-8 BOM | present | **removed** | loss |
| line ending | CRLF | **LF** | loss |
| size | 119 B | 110 B | -9 B |
| cue time | as-is | as-is | preserved |
| `<i>` tag | present | present | preserved |
| `{\an8}` positioning | present | present | preserved |
| byte identity | — | **differs** | — |

What was lost in this run is 9 bytes, and **what was gained is nothing.** Since there was no piece to
concatenate, ffmpeg had no work at all.

> Added honestly. This measurement is for one file with simple tags. What happens to a complex WebVTT style block
> (`STYLE`·`REGION`) or a positioning attribute on the pass was not confirmed. **But the directionality "it can go
> only toward loss" does not change** — a rewrite does not increase information.

### 30.5.3 Fix this judgment by regression

```bash
# tests/run.sh:272-274
# A received file is a finished copy so it is not touched — it must be byte-identical to the server original.
cmp -s "$WORK/out/에피소드/에피소드01.srt" "$WORK/subtitles/old/에피소드01.srt" \
  && ok "original bytes preserved (including BOM·CRLF)" || bad "received subtitle differs from the original"
```

The original file the test makes deliberately puts in a BOM and CRLF (`tests/run.sh:255-257`). **It is a sample
designed so the loss is in a visible form.** If someone refactors "let's normalize all subtitles with ffmpeg for
consistency," this one line fails immediately.

### 30.5.4 The three questions dividing whether to delegate

Move this repository's decision to a general form and it is this.

| Question | Piece subtitle | Finished subtitle |
|---|---|---|
| 1. Is the delegate's work **the work needed now** | yes (concatenation) | **no** (there is no work) |
| 2. If done directly, is it **as accurate as the delegate** | no (must rebuild format parsing) | no problem (store as-is) |
| 3. Is there **something lost** by passing it through | there is but there is no alternative | **there is and there is an alternative** |

Delegate only when all three questions point the same direction. The last column need not look at the rest since
question 1 already gave a "no."

Here note one common misunderstanding.

> **"Since we already depend on it, leaving this job to it too is more consistent" is not a basis.**

Consistency is a property of the **interface**, not of the **dependency count.** An unneeded pass does not make
consistency, only loss.

---

## 30.6 Delegation inherits constraints too

### 30.6.1 Generalize Chapter 14's policy inheritance

The result measured in Chapter 14 §14.5.4 was this. On the same `.txt`-masquerade stream,

| Mode | Result |
|---|---|
| `--mode segments` (direct receive) | success |
| `--mode remux` (ffmpeg delegation) | fail |

**Same input, same tool, different result.** The splitting point is only one — the latter inherits even ffmpeg's
extension-allow policy. That policy is not set by this code, and this side cannot change it (only adjusts it by
option, Chapter 15).

This was called the **constraint** region in §30.2.2's table. The general form is this.

> **The moment you delegate, the delegate's policy becomes the delegator's behavior specification. So it is even
> if it is not written in the delegator's document.**

### 30.6.2 Why the delegation points are gathered into one place

If it inherits constraints, **the inheritance points must not scatter across many places.** This repository calls
ffmpeg-family tools at three spots (reassembly·measurement·subtitle extraction), but the input arguments are made
in only one function.

```python
# probe.py:56-63
    """The common arguments to prepend before the ffmpeg/ffprobe input (`-i`).

    The three tools (reassembly·measurement·subtitle extraction) must access the original under the same
    conditions. Miss one and a split symptom like "it receives but only the measurement fails" arises.

    - headers      : carry the UA·Referer·Cookie through even to the segment requests.
    - whitelist    : allow the structure where a local .m3u8 references remote segments.
                     an option every demuxer accepts so it does not discriminate the input.
```

The comment's counterexample is exact — **"it receives but only the measurement fails."** If the delegation
condition differs per path the symptom splits, and a split symptom is hard to point the cause to. A tool where
reassembly works but only verification fails amounts to distrusting its own output.

Confirm the call sites and they actually gather into one place.

| Caller | Anchor | What it opens |
|---|---|---|
| `assemble.remux_from_url` | [`assemble.py:82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L82) | the playlist URL |
| `probe.probe` | [`probe.py:127`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L127) | the output or URL |
| `probe.first_pts` | [`probe.py:239`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L239) | the first segment |
| `subtitles.extract` | [`subtitles.py:143`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L143) | the subtitle playlist |
| `subtitles.embed_args` | [`subtitles.py:360`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L360) | the subtitle playlist (for embedding) |

> **Term** — **SSOT (Single Source of Truth)**: a state where the same fact is not duplicately recorded in several
> places but is in only one. Here "under what conditions to access ffmpeg" is in only one place, `input_args`.

### 30.6.3 The delegator must know even the delegate's option schema

`input_args`'s body is seven lines, and two of them are conditional.

```python
# probe.py:75-81
    args: list[str] = []
    if headers:
        args += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())]
    args += ["-protocol_whitelist", "file,http,https,tcp,tls,crypto"]
    if playlist.is_playlist_uri(target):
        args += ["-allowed_extensions", ALLOWED_SEGMENT_EXTS]
    return args
```

Why `if playlist.is_playlist_uri(target)` is needed the comment wrote by measurement.

```python
# probe.py:70-73
                     an option that **exists only in the HLS demuxer**, so attach it to a non-playlist input
                     and the open itself fails with `Option allowed_extensions not found` — it actually
                     catches in a delivery putting a finished `.srt` in the subtitle track. So it takes target
                     and attaches it only when it is a playlist.
```

There is a fact this conditional reveals. **It is not enough for the delegator to know "what it wants"; it must
know even "at which input the delegate accepts that request."** ffmpeg's options exist not globally but
per-demuxer, and a nonexistent option is not ignored but **fails the open itself.**

Split into three layers it is this.

| Layer | What the delegator must know | If unknown |
|---|---|---|
| capability | what work it does for you | cannot delegate at all |
| interface | with what arguments to request | the wanted behavior does not come out |
| **scope** | **at which input** that argument is valid | a normal input does not open |

The third layer is this section's finding. Most documents explain only the first·second.

### 30.6.4 The reproduction difficulty inheritance makes

Finish organizing the trap Chapter 14 §14.5.4 pointed out. When `auto` mode drops to `remux` is half the problem.

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

The switch conditions are both **properties of the input.** They are not chosen by the user but decided by the
stream. So a failure from policy inheritance appears only in the following combination.

| Stream | Extension | Run mode | Result |
|---|---|---|---|
| VOD | normal | `segments` | success |
| VOD | masquerade (`.txt`, etc.) | `segments` | **success** — does not look at the extension |
| LIVE | normal | `remux` | success |
| LIVE | masquerade (`.txt`, etc.) | `remux` | **fail** — inherits the policy |

It fails only in one of the four cells. And that cell is **forever invisible if you test with VOD.** This is why a
defect from the delegation boundary is hard to reproduce — the condition to cross the boundary is in the input,
not the code.

---

## 30.7 Delegate and the measurement vanishes

### 30.7.1 Two observation windows

`segments` mode receives segments directly, and `remux` mode has ffmpeg receive them. Same stream, same output,
yet **what is observable differs.** The report writes that fact in a one-line comment.

```python
# report.py:159-160
    # 2) transport layer — collected only in segments mode
    if fetches:
```

Receive directly and it leaves this much per request.

```python
# fetch.py:77-92
    url: str
    ok: bool
    status: int = 0
    body: bytes = b""  # the decompressed body
    size: int = 0  # size after decompression
    wire_size: int = 0  # the bytes that actually went over the wire (compressed)
    encoding: str = ""  # the Content-Encoding text
    ttfb_ms: float = 0.0  # time to first byte — until the server starts responding
    total_ms: float = 0.0  # until the body finishes receiving
    attempts: int = 1
    error: str = ""
    content_type: str = ""
    sha256: str = ""
    # A hotlink-blocking CDN reflects the player page's origin back in this header.
    # It comes on a success response and on a 403 too, so it is a basis for inferring the Referer.
    allow_origin: str = ""
```

What comes back on delegation. The channel receiving progress is one `-progress` pipe, and standard error is read
**only on failure** ([`assemble.py:56-58`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L56-L58)).

```python
# assemble.py:45-54
    """Read out_time_ms from the -progress pipe and callback the progress seconds."""
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        if on_progress and line.startswith("out_time_ms="):
            raw = line.strip().split("=", 1)[1]
            if raw.isdigit():
                on_progress(int(raw) / 1_000_000)
```

Pull out all fields `-progress` actually emits and it is this (ffmpeg 8.1.1 measured).

```bash
$ ffmpeg -hide_banner -loglevel error -y -i vid.mp4 -c copy \
    -progress pipe:1 -f mp4 /dev/null | cut -d= -f1 | sort -u
bitrate
drop_frames
dup_frames
fps
frame
out_time
out_time_ms
out_time_us
progress
speed
stream_0_0_q
total_size
```

**All twelve are output-side (encoding) metrics.** There is not a single field about where and how the input
came. Even `total_size` is not the bytes that went over the wire but the **bytes written to the output file.**

### 30.7.2 What vanishes

| Observed item | `segments` (direct) | `remux` (delegate) | The check you cannot do if it vanishes |
|---|---|---|---|
| per-segment HTTP status | `status` | **absent** | which piece was a 404 |
| TTFB | `ttfb_ms` | **absent** | response-latency p50·p95 verdict (Chapter 8) |
| wire bytes / compression | `wire_size`, `encoding` | **absent** | compression-negotiation confirmation (Chapter 6) |
| retry count | `attempts` | **absent** | delivery-instability WARN |
| segment hash | `sha256` | **absent** | duplicate-segment detection |
| declared Content-Type | `content_type` | **absent** | masquerade·error-page post-hoc analysis (Chapter 14) |
| leading-byte determination | `sniff(data)` | **absent** | 200-error-page detection (Chapter 5) |
| TS continuity counter | `analyze(data)` | **absent** | packet-loss detection (Chapter 18) |
| progress time | present | `out_time_ms` | — |
| output measurement | present | present (the output remains) | — |

The last two rows matter. **There is measurement that does not vanish even on delegation** — the post-hoc check
of the output. The file remains on disk in either mode so it can be re-opened with ffprobe.

```python
# cli.py:609-617
    # pull into a separate file only when not embedding.
    if chosen_subs and not args.sub_embed:
        subrep.results = _extract_subs(chosen_subs, media, out, args, fetcher, headers)

    info = probe.probe(str(out))
    if subrep.embed_tracks:
        subrep.embed_span = probe.subtitle_span(str(out))
    gaps = None if args.no_gap_scan else probe.gap_scan(str(out))
    decode = None if args.no_decode_check else probe.decode_check(str(out))
```

These four lines do not look at `mode`. **They re-open the output regardless of mode.** Even losing transport-
layer observation to delegation, timeline loss·decode error·subtitle-time range are still caught.

Here comes one principle of measurement design.

> **Measurement that crosses the delegation boundary is lost. But measurement observing the output outside the
> boundary is not lost.** If you can move the observation point to the output side, you can reduce the price of
> delegation.

### 30.7.3 So there are two modes

The conditions under which `_decide_mode` (§30.6.4) drops to `remux` are both **cases where measurement is
impossible in principle.**

| Condition | Why measurement is impossible |
|---|---|
| SAMPLE-AES, etc. | segment-unit decryption does not hold so the payload cannot be seen (Chapter 26) |
| LIVE | the playlist keeps growing so the segment list at the snapshot moment is not the whole |

That is, this repository **drops to delegation only when it must give up measurement.** Put the other way, the
default (`segments`) is "slow but observes," and delegation is the second-best when the condition of
unobservability attaches.

> **Term** — **observability**: how much you can learn about the internal state from the system's external output
> alone. Delegation is a trade gaining convenience and paying observability.

The README writes this trade in one sentence.

```
# README.md:32-34
hls-recon delegates the reassembly itself to ffmpeg and separately measures **only what ffmpeg does not tell
you**: per-segment HTTP results and latency, the MPEG-TS continuity counter, and the reassembled copy's timeline loss.
```

**"Only what ffmpeg does not tell you"** — this tool's definition is exactly the complement of the delegation
boundary.

---

## 30.8 Generalization — the general form of the delegation boundary

### 30.8.1 The proposition

Organize this chapter's observation into three sentences.

> **① Delegation inherits constraints along with the capability.** The delegate's policy becomes the delegator's
> behavior specification.
>
> **② The delegate's silence does not appear as an error.** There is no component that reports having not done
> what it regards as not its job.
>
> **③ So the delegation boundary does not end at being known but must be written down and fixed.** If the boundary
> is not in a document, the next person believes, seeing only the capability, that the silence region was
> delegated.

### 30.8.2 The same structure in other domains

| Delegation | Capability | Constraint (inherited) | Silence (what it does not do) |
|---|---|---|---|
| **TLS library** | certificate-chain verification | trust-root store·protocol version | **hostname verification** — does not do it unless you turn on the API separately |
| **ORM** | SQL generation·object mapping | per-dialect types·identifier-quoting rules | transaction-isolation-level choice, N+1 query prevention |
| **HTTP client** | connection·redirect following | max redirect count, proxy rules | judging whether credentials leak to a different host on redirect |
| **JSON parser** | parsing·type conversion | number-precision handling | duplicate-key policy — undefined by spec so it differs per parser |
| **container runtime** | process·filesystem isolation | cgroup·seccomp default profile | vulnerability from kernel sharing, the trustworthiness of the image content |
| **CI cache action** | dependency restore | cache-key rules·capacity cap | whether the restored thing **really is that commit's output** |
| **cloud managed DB** | backup·patch·availability | parameter-group defaults | schema design, access-control policy, verifying the backup's **restorability** |
| **`ffmpeg` (this chapter)** | merge·normalize·mux | extension-allow policy·option scope | matching two time axes, boundary duplicates, transport measurement |

Each row's right column is the spot where an actual accident happened. TLS hostname-verification omission is a
long-repeated vulnerability type, and an organization that never tested a backup restore learning that fact only
at recovery time is of the same form. **The right column gives no error so it is quiet until an accident
happens.**

### 30.8.3 The format for writing the delegation boundary

The format this course recommends is three columns. A document writing only the capability is not a
delegation-boundary document.

| Column | What is written | Verification method |
|---|---|---|
| what was delegated | the work the delegate does for you | normal-path test |
| **what was done directly because it could not be delegated** | the work the delegator fills | defect injection — turn off the direct handling and it should fail |
| **what the delegated side does not do** | the list of the silence region | fix by regression — it must tell you if the upstream changes |

This repository wrote the three columns split across each module's docstring.

| Module | Boundary declaration |
|---|---|
| [`assemble.py:1-6`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L1-L6) | "all container work is delegated to ffmpeg … this module's responsibility is only with what arguments to delegate and how to measure" |
| [`subtitles.py:1-11`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L1-L11) | "the merge is delegated to ffmpeg and here it takes responsibility only for 'what to receive' and 'whether the received result matches the video'" |
| [`probe.py:1-4`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L1-L4) | "a measurement layer for cross-checking the values the playlist declared with the actual media's values" |

`subtitles.py`'s is especially closest to the three-column format.

```python
# subtitles.py:1-11
"""Subtitle-track selection·extraction·verification.

Subtitles are chopped up just like the video, and each WebVTT piece comes with an X-TIMESTAMP-MAP
(a correspondence table of the 90kHz MPEG-TS clock and the subtitle local time) in its header. Apply this
mapping wrong and the whole subtitle slips a fixed amount, so the merge is delegated to ffmpeg and here
it takes responsibility only for 'what to receive' and 'whether the received result matches the video'.

A subtitle placed as a separate file outside the playlist (sidecar) does not appear in the track list
so it is not found by the path above. There the URL is assembled and received directly, but the verification
after receiving uses the same function (measure) — even with a different source, the criterion of 'does it match the video' is one.
"""
```

**"Apply this mapping wrong and the whole subtitle slips a fixed amount"** — right before the delegation-boundary
declaration, it wrote what breaks if you do not know that boundary. This is the narrative format this course
recommends (Chapter 0 §0.5-3).

### 30.8.4 The delegation boundary is not an interface but a contract

The last generalization. An interface is the list of **what is callable**, and the delegation boundary is the
**division line of responsibility.** The two do not coincide.

| | Interface | Delegation boundary |
|---|---|---|
| What it defines | signature·arguments·return | who guarantees what result |
| Where it is written | code·type·API document | usually **nowhere** |
| If you break it | compile·call fails | **quietly wrong** |
| How to check | type checker·linter | defect injection·regression test |

The cloud industry named this division line.

> **Term** — **shared responsibility model**: a table specifying which layer's security·availability the provider
> and the user each take responsibility for. "The provider takes the infrastructure's security, the user the
> security **inside** the infrastructure" is a typical division.

Libraries have almost no such table. So the delegator must make it themselves. **§30.8.3's three-column table is
the library edition of the shared responsibility model.**

---

## 30.9 Security — the dependency's policy is this side's behavior

### 30.9.1 The trust boundary and the delegation boundary are different

> **Term** — **trust boundary**: the point where data or control crosses between regions of different trust
> levels. A value crossing over must be verified.

Overlay the two boundaries and this tool's structure shows.

| | Trust boundary | Delegation boundary |
|---|---|---|
| What it divides | trustable data / untrustable data | the work I do / the work someone else does |
| In this tool | everything a remote server sent (playlist·header·segment) | ffmpeg / hlsrecon |
| What to do on crossing | verify | **know what it does not do for you** |

**Delegating does not transfer trust.** Hand the playlist to ffmpeg and that playlist is still untrusted input a
remote server wrote, and now **ffmpeg, not this side, parses it.** Chapter 15's CVE-2023-6602 is exactly that
spot — one sheet of attacker-controlled text picks one of the delegate's hundreds of parsers.

That is, delegation **does not remove the trust boundary but moves it.** The defense state of the place it is
moved to is not set by this side.

### 30.9.2 An upstream policy change is this side's behavior change

Promote to a principle here the item Chapter 14 §14.8 wrote as a limit.

> If FFmpeg removes `.html` from the default allow list, the current behavior changes.

Both directions are possible, and both are a problem.

| Upstream change | The symptom appearing on this side | Nature |
|---|---|---|
| remove `.html` from the extension allow list (security hardening) | a stream that worked suddenly does not open | **security hardening breaks a feature** |
| start applying `X-TIMESTAMP-MAP` on subtitle standalone input (improvement) | this side's correction is **double-applied** and the subtitle slips the opposite way | **an improvement makes a defect** |
| change an option name·scope | open fails with `Option … not found` | interface change |
| change the error-message wording | the diagnostic-string matching goes off | observation-path breakage |

The second row is the most uncomfortable item in this chapter. **When the delegate starts filling the silence
region, the delegator's code that filled that region turns into a defect.** The delegation boundary is not a fixed
line but **a line that moves per version.**

> **Term** — **Hyrum's Law**: with a sufficiently large user base, whatever the API, someone comes to depend on
> **every observable behavior** regardless of what is written in the spec. Here this side's correction code
> depends on the observable behavior "ffmpeg does **not** apply the mapping."

### 30.9.3 So fix it by regression

If the boundary moves, a **device to tell you** when it moved is needed. This repository's way is the regression
test.

| Fixed fact | Test | If the upstream changes |
|---|---|---|
| delegation alone slips the subtitle | `tests/run.sh:492-498` the off subtitle track is FAIL·exit 2 | the pass/fail flips and it is revealed |
| delegation alone leaves duplicate cues | `tests/run.sh:225-227` 6 cues fixed | the number goes off and it is revealed |
| delegation alone leaves the fragment header | `tests/run.sh:228-229` no `WEBVTT` in the body | if the cleaning drops it fails immediately |
| a finished file is not passed through | `tests/run.sh:272-274` byte identity | fails immediately on refactoring |
| **ffmpeg alone misses the loss** | `tests/run.sh:512-522` control | tells you with a yellow dot |

The last item is Chapter 36's subject and is worth re-reading from this chapter's view.

```bash
# tests/run.sh:513-519
head_ "[4/4] control — ffmpeg alone misses the loss"
set +e
ffmpeg -v error -y -i "$BASE/damaged/index.m3u8" -c copy "$WORK/out/naive.mp4" >/dev/null 2>&1
naive=$?
set -e
if [[ $naive -eq 0 ]]; then
  ok "ffmpeg alone exit 0 — does not report the loss (the reason the tool is needed)"
```

What these seven lines check is not this repository's code. **It checks the delegate's silence.** It nailed the
fact itself "ffmpeg does not report this loss" as a test, and if the upstream someday starts reporting it, this
item turns to a yellow dot and tells you.

> **Write the delegation boundary in a document only and it ages. Write it as a test and it tells you when it
> ages.**

### 30.9.4 The defender's·designer's view

| Role | What to do |
|---|---|
| **library user** | do not read only "what it can do" in the dependency's document but find **"what it does not do under this input configuration."** if you cannot find it, learn it by experiment — in the form of §30.4.4·§30.5.2 |
| **library maintainer** | **state in the document** what it does not do, and if possible **say it in a log.** the one line "did not apply X to this input" turns the user's silence region into a rejection region |
| **security reviewer** | draw the delegation boundary **together with the trust boundary** on the threat-model diagram. where the parsing was handed is where the attack surface moved (Chapter 15) |
| **dependency-upgrade owner** | see in the release notes whether a "bug fix" invalidates this side's workaround code. **an improvement can make a double application** (§30.9.2 second row) |
| **auditor** | when you see the narrative "the library handles this part," ask **under which input configuration.** change the input and the answer changes (§30.2.4) |
| **architect** | write the delegation boundary in §30.8.3's three columns, and hang **a test fixing that boundary** on each row |

### 30.9.5 Supply-chain view — with no boundary you cannot state the impact scope

> **Term** — **software supply chain**: all dependencies going into the final output and the whole path by which
> those dependencies are made and distributed.

When a vulnerability advisory comes out the first question is always the same — **"are we affected."** To answer
this question you must know three things.

1. do you **use** that dependency
2. do you use the vulnerable **feature path**
3. does **untrusted input** reach that path

Number 1 can be answered automatically (the dependency list). **2·3 cannot be answered without a
delegation-boundary document.** That this repository gathers the delegation points into one function as in §30.6.2
is, from the security view, what makes it possible to answer "under what conditions it hands what" in one place.

Conversely, if delegation is scattered across ten spots and each spot's arguments are different, for one CVE
advisory you must **re-do an exhaustive investigation.** And an exhaustive investigation done in a hurry misses
things.

---

## 30.10 Limits and open questions

Written honestly.

- **Did not read the ffmpeg source to confirm.** §30.2.4's basis is two — the **behavioral observation** that
  moving `MPEGTS` by 60 seconds on a master input gives the same output, and the **circumstantial evidence** that
  the `X-TIMESTAMP-MAP` string is absent in the `libavformat` binary. The latter does not exclude an
  implementation not using a string constant (character-unit comparison, macro assembly). Reading the source would
  be a stronger basis. Only, either way **the original "because there is no video axis" explanation is refuted** —
  because it was not applied even in a configuration with a video axis.

- **There is no check detecting the double application.** §30.9.2's second-row danger is real. Since
  `timestamp_offset` computes the offset from only the subtitle piece's header and the video first PTS
  ([`subtitles.py:191-218`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L191-L218)), **it gives the same value even if ffmpeg starts applying the mapping.** Then the
  correction is applied twice. There is a possibility the post-hoc check ([`report.py:421-460`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L421-L460) subtitle timeline)
  catches it as "strayed out of the video range," but that is a **symptom**, not a cause, and if the offset is
  small it stays in range and is not caught. This repository has no check that points to the cause.

- **The `--sub-embed` path does not get `dedupe`.** An exhaustive check of the code path found `dedupe` (and
  `_clean_body` it calls inside) has only one call site, `subtitles.extract` ([`subtitles.py:158`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L158)), and the path
  embedding subtitles into the container does not pass that function because of the `not args.sub_embed` condition
  at [`cli.py:610`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L610). The embed path muxes directly with ffmpeg using the arguments `embed_args` made, and passes
  only the alignment via `-itsoffset` ([`subtitles.py:361-365`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L361-L365)).

  The result of measuring the embedded output under the same conditions as §30.4.4 is this.

  ```bash
  $ ffmpeg -v error -y -i vid.mp4 -i subko/index.m3u8 \
      -map 0 -map 1:s:0 -c copy -c:s srt embed.mkv
  $ ffprobe -v error -select_streams s:0 -show_entries packet=pts_time \
      -of csv=p=0 embed.mkv | grep -c .
  9                      # 6 unique cues but 9 subtitle packets
  ```

  Pull it back out and the `WEBVTT` / `X-TIMESTAMP-MAP=` lines absorbed into the body remain as-is. **That is,
  this repository itself does not fully fill the delegation boundary on one path.** The regression test's embed
  item confirms only the track count and language metadata and does not count cues (`tests/run.sh:238-244`) —
  Chapter 37's "bidirectional fixing" is not applied to this item. It is the result of applying this chapter's
  principle to this chapter's repository so it is left as-is.

- **§30.4.4·§30.5.2's measurements are one environment.** They are values measured on ffmpeg 8.1.1 / macOS arm64
  / a Homebrew build. Whether the same result comes on another version·build was not confirmed. In particular the
  `-progress` field list can grow with the version.

- **The three-way classification "silence / rejection / unimplemented notice" is this course's organization.** It
  is not a widely-used standard classification. If a name in common practical use is found, it is right to switch
  to it.

- **The delegation-boundary list is not gathered in one place.** §30.8.3's table was gathered from several
  modules' docstrings while writing this chapter, and there is no such document inside the repository. This
  repository itself does not yet have the format §30.8.3 recommends.

---

## 30.11 Summary

1. **Delegation is not a decision receiving only the capability.** Three things come over together — capability·
   **constraint**·**silence.** Documents usually explain only the capability.
2. **Silence does not appear as an error.** Rejection (an error) and unimplemented notice (a log) the delegator
   can know, but work the delegate never regarded as its own hides behind a success code and a normal-format
   output. The subtitle is 60 seconds off yet exit 0 comes.
3. **A reason attached to silence hardens unverified.** The explanation "not applied because there is no video
   axis" was plausible and even got into a code comment, but was refuted by the master-input experiment (§30.2.4).
   A right decision can stand on a wrong reason and nothing happens.
4. **Confirmed by measurement.** Leave the piece concatenation to ffmpeg and with exit 0, 6 unique cues come out
   as **9 cues**, and **4** of them have the fragment header mixed into the body. About these three the delegate
   says nothing.
5. **Unneeded delegation makes only loss.** Pass a finished subtitle file through ffmpeg once and it loses the BOM
   and CRLF (119→110 bytes) gaining nothing. "Since we already depend on it, consistently" is not a basis for
   delegation.
6. **Delegation inherits the policy too** (Chapter 14's generalization). `remux` mode inherits ffmpeg's
   extension-allow policy, failing only in the **LIVE + masquerade-extension** combination — the reproduction
   difficulty is because the boundary-crossing condition is in the input, not the code.
7. **Delegate and you lose measurement.** The 12 fields `-progress` emits are all output-side metrics and none
   is the HTTP status·TTFB·wire bytes. But **the post-hoc check of the output is not lost** — move the observation
   point to the output side and you can reduce the price.
8. **The delegation boundary is not an interface but a contract.** Break the interface and the call fails, but
   misunderstand the delegation boundary and it is quietly wrong. So it must be written in three columns (what was
   delegated / what was done directly / **what the delegated side does not do**) and fixed by regression.
9. **The boundary moves per version.** Upstream security hardening breaks this side's feature, and an upstream
   improvement turns this side's correction into a double application. **A boundary written in a document only
   ages, and a boundary written as a test tells you when it ages.**

---

**Next chapter** — Part 6 began with the problem of matching the time axis and ended with the responsibility
problem "who is supposed to match what." Part 7 changes coordinates. It is a domain where not time but the **name**
becomes the problem. Two strings that look identical to the eye become two different folders in the filesystem,
and that off-ness too gives no error. Chapter 31 covers that quiet split Unicode normalization makes.
