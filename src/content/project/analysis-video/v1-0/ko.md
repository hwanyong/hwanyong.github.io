---
title: analysis-video
description: 영상을 AI가 읽을 수 있는 맥락으로 바꾸는 오픈소스 CLI.
date: 2026-08-14
tags: ["cli", "ai-agent", "video"]
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

AI에게 강의 영상을 분석해 달라고 하면 손에 쥐는 건 자막뿐이다 — 말한 내용만 있고, 화면에 쓰고 그리고 코딩하고 띄운 것은 하나도 없다. analysis-video는 그 빠진 절반을 되돌려 놓는다.

강의·스크린캐스트·슬라이드 기반 영상을 LLM이 읽을 수 있는 하나의 마크다운 파일로 바꾸는 명령줄 도구다. 화면 상태가 바뀔 때마다 한 섹션씩 — 그 상태의 키프레임 이미지, 화면에 머문 초, 그 위로 오간 대사를 담는다. 전부 사용자 기기에서 돌아간다: API 키도, 업로드도, ffmpeg 설치도 필요 없다.

![생성된 context.md의 한 섹션과 그것이 가리키는 두 키프레임](/images/project/analysis-video-context-example.png)

역할: 단독 설계·개발 — 알고리즘, CLI 계약, 패키징, 문서, 릴리스.

## 만든 것

- **변화 기반 프레임 선택.** 프레임은 고정 간격이 아니라 화면이 얼마나 바뀌었는지로 고른다(이동 기준선에 대비한 세 가지 픽셀 영역 신호). 판서처럼 점진적으로 채워지는 내용은 비어 있는 상태와 완성된 상태를 모두 남긴다 — 컷 감지기만으로는 비어 있는 쪽만 남는다.
- **에이전트 우선 CLI 계약.** stdout에는 JSON 객체 하나, 판단은 종료 코드만으로 표현 가능, 절대 경로, 재개 가능한 단계, 그리고 이미지를 하나라도 열기 전에 이미지 토큰 비용을 미리 알려 주는 `next` 객체.
- **컨텍스트 윈도 경제성.** 링크된 이미지는 축소된 열람용 사본으로, 함께 보관되는 원해상도 프레임보다 토큰을 4.17배 적게 쓰는 것으로 측정됐다.
- **오래 가는 분석.** 에이전트의 분석 결과는 그것이 읽은 입력의 sha256을 찍어 저장한다. 그래서 재감지 때 낡은 분석을 최신인 양 통과시키지 않고 '오래됨'으로 표시한다.
- **LLM 없는 파이프라인.** 자막은 쓰인 그대로 읽고, 음성 인식은 Whisper, 프레임 감지는 픽셀 연산이다. 해석은 호출하는 에이전트의 몫으로 남긴다.
- **선택적 Qt 데스크톱 GUI** — 감지기 출력을 정답과 비교해 점수를 매긴다.

![Qt 워크벤치: 플레이어, 프레임 동기화, 대사 동기화, 갤러리, 비교 리포트, 타임라인을 한 화면에](/images/project/analysis-video-gui-workbench.png)

![Qt 워크벤치 타임라인: 남긴 프레임, 화면 시작점, 그리고 세 감지 신호를 각자의 기준선과 함께 그린 그래프](/images/project/analysis-video-gui-timeline.png)

두 패키지로 배포 — `analysis-video`와 `analysis-video-gui` — MIT 라이선스.
