---
untranslated: en
title: UART_Stream
description: Lightweight buffered UART interface for embedded systems.
date: 2019-09-25
tags: ["cpp", "embedded", "library"]
series: uart-stream
version: "1.0"
stack:
  - C++
  - Embedded Systems
  - UART
  - Circular Buffer
links:
  repo: https://github.com/hwanyong/UART_Stream
---

A lightweight C++ library designed to simplify UART communication in embedded systems by providing a stream-like interface.

Developed to address the complexity of raw serial data handling. This library implements efficient buffering and data stream abstractions, allowing developers to handle serial communication as easily as standard input/output streams, ensuring no data loss even at high baud rates.

## Key features

- **Stream abstraction.** Provides a clean C++ interface (similar to `iostream`) for reading and writing serial data, abstracting away low-level register manipulations.
- **Circular buffering.** Implemented efficient ring buffers for both TX and RX to handle high-speed data transmission without blocking the main loop.
- **Data integrity.** Ensures reliable data reception through interrupt-based handling, preventing buffer overflows and data loss.
- **Portability.** Designed with a modular architecture to be easily ported across different microcontroller platforms (AVR, ESP32, STM32).
