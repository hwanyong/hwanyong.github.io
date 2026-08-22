---
title: mcp-debug-tools
description: AI 기반 VSCode 디버깅 브리지 — MCP 에이전트를 Debug Adapter Protocol에 잇는다.
date: 2025-08-07
tags: ["ai-agent", "mcp", "vscode"]
version: "1.0"
stack:
  - TypeScript
  - VSCode Extension API
  - Debug Adapter Protocol (DAP)
  - Model Context Protocol (MCP)
thumbnail: /images/project/mcp-debug-tools.jpg
video:
  id: 0lE4-jZ9hTQ
  title: "AI와 함께하는 똑똑한 디버깅 — MCP Debug Tools 시연"
links:
  repo: https://github.com/hwanyong/mcp-debug-tools
---

Model Context Protocol(MCP)과 Debug Adapter Protocol(DAP)을 이어, AI 에이전트가 VSCode 안에서 코드를 직접 디버깅하게 해 주는 인프라 도구.

요즘 AI 코딩 어시스턴트는 코드를 생성하지만, 런타임 상태를 들여다보는 능력은 없다. 이 프로젝트는 VSCode의 디버깅 기능 — 중단점, 스택 추적, 변수 검사 — 을 MCP를 통해 AI 에이전트에 열어 주어 그 간극을 메운다.

## 핵심 혁신

- **프로토콜 브리징 (MCP ↔ DAP).** 에이전트의 요청을 표준 Debug Adapter Protocol 명령으로 번역해, LLM이 VSCode 디버거를 제어하게 한다.
- **에이전트 디버깅.** AI가 스스로 중단점을 걸고, 코드를 단계 실행하고, 호출 스택을 분석해 버그의 근본 원인을 찾게 한다.
- **다중 인스턴스 지원.** 여러 VSCode 창으로의 연결을 자동으로 감지·관리해, 복잡한 워크플로와 매끄럽게 통합되도록 한다.
- **안정성 엔지니어링.** 견고한 하트비트 메커니즘과 자동 재연결 로직을 구현해 AI 에이전트와 IDE 사이 통신을 안정적으로 유지한다.
