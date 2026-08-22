---
title: Cpp-EventLoop-Core
description: 직접 구현한 C++ Reactor 패턴.
date: 2020-05-21
tags: ["cpp", "systems", "networking"]
version: "1.0"
stack:
  - C++
  - Socket API
  - Network Programming
  - System Programming
links:
  repo: https://github.com/hwanyong/NelsonChio_EventLoop
---

C++로 바닥부터 구현한 고성능 비동기 이벤트 루프 엔진.

Node.js·Redis 같은 논블로킹 I/O 시스템의 핵심 구조를 깊이 이해하려고 만들었다. 이 라이브러리는 외부 프레임워크에 기대지 않고 Reactor 패턴으로 동시 네트워크 연결을 효율적으로 처리한다.

## 핵심 기술 성과

- **Reactor 패턴 구현.** I/O 이벤트와 작업 스케줄링을 관리하도록 이벤트 디멀티플렉서와 디스패처를 C++로 직접 구현했다.
- **논블로킹 I/O.** `epoll`/`kqueue` 같은 메커니즘을 본떠 비동기 소켓 처리를 구현하고 높은 동시성을 지원한다.
- **동시성 아키텍처.** I/O 바운드 작업에 최적화된 단일 스레드 이벤트 루프 모델을 설계해 컨텍스트 스위칭 비용을 최소화했다.
- **시스템 프로그래밍.** 저수준 OS API와 수동 메모리 관리를 활용해 성능과 자원 효율을 최대로 끌어냈다.
