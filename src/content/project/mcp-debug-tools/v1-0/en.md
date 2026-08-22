---
title: mcp-debug-tools
description: AI-powered VSCode debugging bridge — connecting MCP agents to the Debug Adapter Protocol.
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

An infrastructure tool that empowers AI agents to debug code directly within VSCode by bridging the Model Context Protocol (MCP) with the Debug Adapter Protocol (DAP).

While modern AI coding assistants can generate code, they lack the ability to inspect runtime states. This project solves that gap by exposing VSCode's debugging capabilities — breakpoints, stack traces, variable inspection — to AI agents via MCP.

## Key innovations

- **Protocol bridging (MCP ↔ DAP).** Translates the agent's requests into standardized Debug Adapter Protocol commands, allowing LLMs to control the VSCode debugger.
- **Agentic debugging.** Enables AI to autonomously set breakpoints, step through code, and analyze call stacks to identify root causes of bugs.
- **Multi-instance support.** Automatically detects and manages connections to multiple VSCode windows, ensuring seamless integration with complex workflows.
- **Stability engineering.** Implemented robust heartbeat mechanisms and auto-reconnection logic to maintain stable communication between the AI agent and the IDE.
