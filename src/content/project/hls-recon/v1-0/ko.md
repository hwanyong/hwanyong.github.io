---
untranslated: en
title: hls-recon
description: HLS delivery integrity verifier.
date: 2026-08-15
tags: ["cli", "streaming", "testing"]
series: hls-recon
version: "1.0"
stack:
  - Python 3.10+
  - FFmpeg
  - MPEG-TS
  - WebVTT
links:
  repo: https://github.com/hwanyong/hls-recon
---

Reassembles HLS (HTTP Live Streaming) delivery into a local file and measures whether the delivery was intact.

## Problem

`ffmpeg -i master.m3u8 -c copy out.mp4` silently skips 404 segments and still exits 0. MPEG-TS carries absolute presentation timestamps, so duration stays correct even when a chunk is gone. Measured: one missing 6s segment, exit 0, output 30.03s identical to a clean run, 5.99–12.02s empty.

## Approach

ffmpeg does the reassembly; only what it does not report is measured.

- Per-segment HTTP outcome, TTFB p50/p95, SHA-256 duplicate detection
- MPEG-TS continuity counter jumps, sync loss, undecrypted packets
- Timeline gaps that survive a correct total duration
- HTTP 200 whose body is not media, classified by leading bytes, not `Content-Type`
- WebVTT `X-TIMESTAMP-MAP` alignment, which ffmpeg skips for standalone subtitle input

Verdicts collapse to PASS/WARN/FAIL and exit codes for CI.

## Idempotent resume

A re-run refetches only what is missing or corrupt, judging completeness by container structure (moov presence, box boundary vs EOF), not filename: a truncated file from a killed run would otherwise read as "already have it" and never be repaired. URLs resolve late, per item, since issued ones expire.

## Verifying the verifier

A checker that only emits PASS verifies nothing. The suite generates local HLS streams (plain TS, AES-128, fMP4, multi-variant, subtitles), injects faults, and asserts each is caught, with ffmpeg alone silently succeeding on the same stream as the control. 62 tests.

## Process

Built by driving Claude Code well past its default envelope under a fixed operating protocol. Agent output is plausible by default, so trust was engineered rather than assumed: every claim in the 39-chapter companion docs (~33k lines) carries a `file.py:line` anchor that a checker resolves against the real line range; fault injection does the same for the code. The harness, not the prompting, is what makes output at this scale reviewable.
