---
title: djmax_controller
description: ESP32 기반 리듬 게임 컨트롤러 펌웨어.
date: 2022-04-16
tags: ["cpp", "embedded", "hardware"]
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

ESP32 마이크로컨트롤러로 구동하는 커스텀 리듬 게임 컨트롤러 펌웨어.

경쟁적 리듬 게임에 필요한 초저지연 입력을 얻으려고 만들었다. ESP32의 성능을 활용해 고빈도 입력을 처리하고, 표준 HID(휴먼 인터페이스 장치)로 PC와 통신한다.

## 핵심 기능

- **임베디드 엔지니어링.** Heltec ESP32 아키텍처 위에서 C++와 PlatformIO로 고성능 펌웨어를 개발했다.
- **HID 구현.** 마이크로컨트롤러를 USB/블루투스 범용 게임 컨트롤러(HID)로 동작하게 구성해 Windows·macOS에서 플러그 앤 플레이 호환을 보장한다.
- **입력 최적화.** 고속 플레이에 결정적인 입력 지연을 줄이려고 입력 폴링 로직(디바운싱, 인터럽트)을 최적화했다.
- **하드웨어 제어.** 아케이드 버튼과 로터리 엔코더를 위한 GPIO 인터페이싱을 다뤘다.
