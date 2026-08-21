---
title: analysis-video
description: Open-source CLI that turns video into AI-readable context.
date: 2026-08-14
tags: ["cli", "ai-agent", "video"]
series: analysis-video
version: "1.0"
stack:
  - Python 3.11–3.14
  - uv workspace
  - PyAV
  - NumPy
  - scikit-image
  - PySceneDetect
  - PySide6
  - MLX / faster-whisper
  - GitHub Actions
thumbnail: /images/project/analysis-video-og-card.png
links:
  repo: https://github.com/hwanyong/analysis-video
  package: https://pypi.org/project/analysis-video/
---

Ask an AI to analyze a lecture video and all it gets is the subtitles: the speech, and nothing that was written, drawn, coded, or shown on screen. analysis-video puts the missing half back.

A command-line tool that turns lecture, screencast, and slide-based video into a single Markdown file an LLM can read: one section per distinct on-screen state, with its keyframe images, the seconds it stayed on screen, and the dialogue spoken over it. Runs entirely on the user's machine: no API key, no upload, no ffmpeg install.

![One section of the generated context.md beside the two keyframes it points to](/images/project/analysis-video-context-example.png)

Role: sole designer and developer — algorithm, CLI contract, packaging, docs, release.

## What I built

- **Change-driven frame selection.** Frames are chosen by how much the screen changed (three pixel-domain signals against rolling baselines), not at a fixed interval. Progressive content such as a board being written keeps both the empty and the finished state — a cut detector alone keeps only the empty one.
- **Agent-first CLI contract.** One JSON object on stdout, decisions expressible through exit codes alone, absolute paths, resumable stages, and a `next` object quoting the image-token bill before any image is opened.
- **Context-window economics.** Linked images are downscaled reading copies, measured at 4.17x fewer tokens than the full-resolution frames kept alongside.
- **Durable analysis.** The agent's write-up is stored and stamped with the sha256 of the exact input it read, so re-detection marks it stale instead of letting an outdated reading pass as current.
- **Zero-LLM pipeline.** Subtitles are read as written, speech recognition is Whisper, frame detection is pixel math. Interpretation stays with the calling agent.
- **Optional Qt desktop GUI** that scores detector output against ground truth.

![The Qt workbench: player, frame sync, dialogue sync, gallery, compare report and timeline in one layout](/images/project/analysis-video-gui-workbench.png)

![The Qt workbench timeline: kept frames, screen starts, and the three detector signals plotted against their baselines](/images/project/analysis-video-gui-timeline.png)

Published as two packages — `analysis-video` and `analysis-video-gui` — under MIT.
