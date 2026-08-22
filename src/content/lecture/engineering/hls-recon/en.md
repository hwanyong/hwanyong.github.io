---
title: The hls-recon Course — From Stream to File
description: Computer science and web security, taught from the hls-recon codebase — reassembling an HLS stream into a local file and verifying that it arrived intact.
date: 2026-05-18
version: '1.0'
tags: ['streaming', 'web-security', 'computer-science']
thumbnail: /images/lecture/thumb/hls-recon.svg
project: hls-recon
---

This course grew out of a personal project, [**hls-recon**](https://github.com/hwanyong/hls-recon).
Using that repository's actual code (15 modules, 4,173 LOC + 525 LOC of regression tests) as the
textbook, it covers — across 39 sessions — **the computer science needed to turn web streaming back
into a local file, and the security limits inherent in that process.**

It starts from a single sentence.

> **The total length matches, but the middle is empty.**

`ffmpeg -i master.m3u8 -c copy out.mp4` silently skips a segment that drops out with an HTTP 404 and
still exits 0. Even the output's total playback length matches a clean run. Answering why that is
possible requires knowing that an MPEG-TS presentation timestamp is an absolute coordinate, and once
you know that, why "compare the total length" is a powerless check follows on its own. This course
follows that chain across eight parts.

## What you'll learn

| Part | What it covers |
|---|---|
| 1 The problem takes shape | The two ontologies of stream and file, ABR·HLS, RFC 8216's two-tier indirection |
| 2 Transport | HTTP statelessness and the absence of integrity, the semantic collapse of status codes, content negotiation, URL normalization |
| 3 Access control | Hotlink·CORS·signed URLs·ambient credentials, the limits of obfuscation, extension masquerading and CVE-2023-6602 |
| 4 The bit level | The MPEG-TS 188-byte packet, the 4-bit cyclic counter, self-synchronizing formats, ISO-BMFF, PTS·90kHz |
| 5 Cryptography | AES-128-CBC, IV derivation, padding, "why AES-128 is not DRM", encryption granularity |
| 6 Time and distribution | The affine mapping of two clocks, 33-bit wrapping, at-least-once and idempotency, the boundary of delegation |
| 7 Representation and portability | Unicode normalization, the filename as an interface, the accuracy of a regex |
| 8 Verification methodology | The test oracle problem, fault injection, the control group, bidirectional fixing, synthesizing a verdict |

Each session is built in five movements — **problem → principle → code → generalization → security**.
Where code is cited, an anchor in `file.py:line` form is attached, and that anchor resolves to the
real line in the repository.

## Practice files — download and run them yourself

Every measurement in this course **closes locally.** No internet, no particular streaming service is
needed. With only `ffmpeg` and `python3` you build plain TS, AES-128, fMP4, multi-variant, and subtitle
tracks by hand, serve them over a local HTTP server, and inject faults to confirm the verification tools
actually catch them.

```bash
git clone https://github.com/hwanyong/hls-recon.git
cd hls-recon

# Requirements: python 3.10+, ffmpeg/ffprobe (must be on PATH)
brew install ffmpeg
pip install .          # installs the hls-recon command (cryptography comes along)

./tests/run.sh         # builds 5 kinds of stream, injects faults, runs 62 checks
```

The single line `./tests/run.sh` runs the whole process at once — from stream generation through fault
injection to the control comparison (ffmpeg alone silently succeeds on the same loss). To use it straight
from the repository without installing, `./hls-recon` is the executable. How to build each stream by hand
and how to inject the 8 kinds of fault is written out, commands and all, in the repository's
`docs/appendix-A-lab-setup.md`.

## What this course does not cover

- **DRM circumvention.** This repository handles only AES-128 with `KEYFORMAT=identity` and rejects
  Widevine · FairPlay · PlayReady · SAMPLE-AES at the code level. The course explains "why AES-128 is
  not DRM" as a question of threat models, but does not cover key-extraction techniques for commercial
  protection systems.
- **The inside of a video codec.** This code does no re-encoding (`-c copy`). Codecs are treated as
  opaque byte streams.
- **Justifying the acquisition of content without authorization.** The point of dissecting access-control
  mechanisms is to know how far they guarantee and where they stop guaranteeing. They are only meaningful
  read from a defender's and an auditor's perspective.
