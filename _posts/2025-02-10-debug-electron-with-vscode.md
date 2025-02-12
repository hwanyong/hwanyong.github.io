---
layout: post
enable: true
postType: blog
title: Electron 애플리케이션 디버깅 환경 설정하기
description: Electron 디버깅 환경에서 개발해보자
date: 2025-02-10 00:00:00 +0000
image: /resources/post/cs_thumnail.png
projectIdx: 0
version: "1.0"
isLatest: true
tags:
  - debug
  - electron
  - vscode
resourceUrl:
---

# Electron 애플리케이션 디버깅 환경 설정하기

적용환경:
- VSCode 기반 (cursor, windsurf 가능)
- typescript
- ESLint
- Electron
## 소개
Electron 애플리케이션을 개발하다 보면 메인 프로세스와 렌더러 프로세스 모두를 디버깅해야 하는 상황이 자주 발생합니다. 이번 글에서는 VS Code를 사용하여 Electron 애플리케이션의 디버깅 환경을 구성하는 방법을 단계별로 알아보겠습니다.

## 프로젝트 구조
예제에서 사용할 프로젝트는 TypeScript 기반의 Electron 애플리케이션입니다. 기본적인 프로젝트 구조는 다음과 같습니다:

```bash
src/
  ├── main.ts      // 메인 프로세스
  └── renderer.ts  // 렌더러 프로세스
package.json
tsconfig.json
```

## 1. .gitignore 설정
VS Code의 디버깅 설정을 팀원들과 공유하기 위해 .vscode 디렉토리를 버전 관리에 포함시켜야 합니다. .gitignore 파일을 다음과 같이 수정합니다:

```bash
# Dependencies
/node_modules
/.pnp
.pnp.js

# Production
/dist
/build

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Local env files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
!.vscode  # .vscode 디렉토리 포함
```

## 2. VS Code 디버깅 설정
.vscode/launch.json 파일을 생성하여 메인 프로세스와 렌더러 프로세스의 디버깅 설정을 추가합니다:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "args": [".", "--remote-debugging-port=9223"],
      "outputCapture": "std",
      "console": "integratedTerminal",
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    },
    {
      "name": "Debug Renderer Process",
      "type": "chrome",
      "request": "attach",
      "port": 9223,
      "webRoot": "${workspaceFolder}",
      "timeout": 30000
    }
  ],
  "compounds": [
    {
      "name": "Debug All",
      "configurations": ["Debug Main Process", "Debug Renderer Process"]
    }
  ]
}
```

## 3. TypeScript 설정
디버깅을 위해 소스맵을 활성화하고 출력 디렉토리를 설정합니다. tsconfig.json 파일을 다음과 같이 구성합니다:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "resolveJsonModule": true,
    "noEmitOnError": true,
    "types": ["node", "electron"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## 4. 스크립트 설정
package.json에 디버그 모드 실행을 위한 스크립트를 추가합니다:

```json
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "lint": "eslint src/**/*.ts",
    "start": "electron .",
    "dev": "tsc && electron .",
    "debug": "tsc && electron . --remote-debugging-port=9223"
  }
}
```

## 디버깅 방법
설정이 완료되면 다음과 같은 방법으로 디버깅을 시작할 수 있습니다:

1. VS Code에서 F5 키를 누르거나 디버그 패널에서 "Debug All" 설정을 선택
2. 또는 터미널에서 `npm run debug` 명령어 실행

## 디버깅 기능
설정이 완료되면 다음과 같은 디버깅 기능을 사용할 수 있습니다:

- 메인 프로세스와 렌더러 프로세스 모두에 중단점 설정
- 변수 값 조회 및 수정
- 콜 스택 확인
- 단계별 코드 실행 (Step Over, Step Into, Step Out)
- 실시간 변수 감시

이렇게 설정된 디버깅 환경을 통해 Electron 애플리케이션의 메인 프로세스와 렌더러 프로세스를 효율적으로 디버깅할 수 있습니다. 특히 TypeScript를 사용하는 경우, 소스맵 설정을 통해 컴파일된 JavaScript 코드가 아닌 원본 TypeScript 코드에서 직접 디버깅이 가능합니다.