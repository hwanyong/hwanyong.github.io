---
untranslated: en
title: djmax_controller
description: ESP32-based rhythm game controller firmware.
date: 2022-04-16
tags: ["cpp", "embedded", "hardware"]
series: djmax-controller
version: "1.0"
stack:
  - C++
  - ESP32
  - PlatformIO
  - USB HID
thumbnail: /images/project/djmax-controller.jpg
video:
  id: YVvkJqi8xpY
  title: "(PS4) DJMAX Controller Test: Oblivion Rockin night style"
links:
  repo: https://github.com/hwanyong/djmax_controller
---

Firmware for a custom rhythm game controller powered by an ESP32 microcontroller.

Developed to achieve ultra-low latency input required for competitive rhythm gaming. This project utilizes the ESP32's capabilities to handle high-frequency inputs and communicate with the PC as a standard HID (Human Interface Device).

## Key features

- **Embedded engineering.** Developed high-performance firmware using C++ and PlatformIO on the Heltec ESP32 architecture.
- **HID implementation.** Configured the microcontroller to act as a USB/Bluetooth generic game controller (HID), ensuring plug-and-play compatibility with Windows and macOS.
- **Input optimization.** Optimized input polling logic (debouncing, interrupts) to minimize input lag, critical for high-speed gameplay.
- **Hardware control.** Managed GPIO interfacing for arcade buttons and rotary encoders.
