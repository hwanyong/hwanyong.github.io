---
title: iohook-macos
description: macOS를 위한 고성능 시스템 이벤트 후킹.
date: 2025-07-20
tags: ["macos", "native", "electron"]
version: "1.0"
stack:
  - Objective-C++
  - Node.js (N-API)
  - Electron
  - TypeScript
thumbnail: /images/project/iohook-macos.jpg
video:
  id: hO8gianvkLk
  title: "macOS Event Hook 시연"
links:
  repo: https://github.com/hwanyong/iohook-macos
---

Electron·Node.js 애플리케이션을 위해 설계한 macOS용 고성능 전역 시스템 이벤트 후킹 라이브러리.

기존 후킹 솔루션의 파편화와 안정성 문제를 풀려고 이 라이브러리를 개발했다. Node-API(N-API)를 통해 macOS Core Graphics API와 직접 통합해 엔터프라이즈급 성능과 신뢰성을 낸다.

## 핵심 기술 성과

- **네이티브 통합.** Objective-C++와 N-API로 Node.js와 macOS 시스템 이벤트를 잇고, 성능 오버헤드를 최소화했다.
- **안정성과 호환성.** 기존 라이브러리에 있던 복잡한 네이티브 의존성 문제를 해결해 최신 Electron 버전과 매끄럽게 통합되도록 했다.
- **개발자 경험.** macOS 손쉬운 사용(accessibility) 권한 처리를 내장하고, 타입 안전을 위한 완전한 TypeScript 지원을 제공한다.
- **AI 강화 문서.** AI 어시스턴트가 정확한 구현 코드를 생성하도록, LLM에 맞춰 최적화한 문서를 설계했다.
