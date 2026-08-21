---
untranslated: en
title: Germ Warfare (세균전)
description: Serverless client-side PvE strategy web game.
date: 2026-07-22
tags: ["game", "web", "pwa"]
series: germ-warfare
version: "1.0"
stack:
  - JavaScript
  - Vite
  - PWA / Service Worker
  - Web Audio
  - GitHub Actions
links:
  repo: https://github.com/hwanyong/germ-warfare
---

Ataxx-style client-side PvE web game, shipped without a server.

## Architecture

- Isolated the rule engine as a pure, zero-I/O module and made it the single source of truth, so client, AI search, and future server-side validation run identical logic.
- Routed all in-rule randomness through a seeded PRNG, making matches deterministic and reproducible for replays and server re-simulation.
- Captured 12 architecture decisions as ADRs, scoping multiplayer and monetization out to a separate app.

## Game AI

- Move generation, board simulation, evaluation (infection gain, clone gain, risk exposure), then negamax with alpha-beta pruning at depth 3 and root move ordering.
- Built difficulty as parameters, not separate systems — search depth, evaluation noise, blunder rate — with the stage-authored base level split from the player-facing knob.

## Content

- Generated a 20-stage campaign (4 chapters × 5) from data specs and builders, not hardcoded boards: terrain patterns, seeding handicaps, procedural village placement. Tests assert a monotonic difficulty curve and that every stage stays winnable.
- Generalized the two-team engine into N-team free-for-all, with a seat-based human/AI controller model for hot-seat local play.

## Platform

- PWA: Service Worker precache for offline play, plus a manual update check-and-apply flow.
- Cross-device save transfer over binary QR codes, with QR libraries dynamically imported out of the bundle.
- Korean/English i18n, Web Audio BGM/SFX, DOM/CSS/SVG effects, audited asset and font licenses.
- GitHub Actions: push to main runs the test gate, then deploys to Pages.
