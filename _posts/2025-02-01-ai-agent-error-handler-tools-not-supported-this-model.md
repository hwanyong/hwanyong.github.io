---
layout: post
enable: true
postType: blog
title: "[AI:Agent] LangGraph 사용시 발생하는 문제 해결을 위한 임시 처리 함수"
description: 메모리 기반으로 변수가 만들어지는 과정을 알아보기
date: 2025-02-01 00:00:00 +0000
image: /resources/post/cs_thumnail.png
projectIdx: 0
version: "1.0"
isLatest: true
tags:
  - computer_science
  - ai
  - agent
  - langchain
  - langgraph
  - openai
  - llm
resourceUrl:
---
# LangChain/LangGraph 사용시 발생하는 문제 해결을 위한 임시 처리 함수
# Temporary Handling Functions for Resolving Issues When Using LangChain/LangGraph

LangChain/LangGraph를 사용하면서 "tools is not supported this model" 오류를 만나신 적이 있으신가요? 이 문제를 해결하기 위해 저희는 별도의 임시 처리 함수를 도입하였습니다. 이번 포스트에서는 `handleToolCall`과 `invokeModelWithToolHandling` 두 함수를 살펴보고, 어떻게 해당 오류 상황에서 도구 호출을 우회하여 원활한 처리를 가능하게 하는지 소개하고자 합니다.
Have you ever encountered the "tools is not supported this model" error when using LangChain/LangGraph? To resolve this issue, we have introduced a temporary handling function. In this post, we will review the two functions `handleToolCall` and `invokeModelWithToolHandling` and explain how they enable smooth processing by bypassing tool calls in such error scenarios.

## 배경
## Background

LangChain/LangGraph를 사용할 때, 모델이 도구(tool)를 지원하지 않는 경우가 발생할 수 있습니다. 예를 들어, 도구 호출 시 JSON 형식의 데이터로 파싱이 실패하거나, 도구가 등록되어 있지 않을 때 발생할 수 있는 문제들을 완화하고자 아래와 같은 임시 처리 함수를 만들게 되었습니다.
When using LangChain/LangGraph, there can be cases where the model does not support tools. For instance, there can be issues such as failures in parsing JSON-formatted data during a tool call or when a tool is not registered. To mitigate these problems, we developed the following temporary handling functions.

## 함수 소개
## Function Overview

### 1. `handleToolCall`
### 1. `handleToolCall`

이 함수는 모델의 응답 내용 중 도구 호출 정보를 파싱하여, 해당 도구를 찾아 호출합니다.
This function parses tool call information from the model's response and invokes the corresponding tool.

- **주요 기능**:
- **Key Features:**
  - 모델 응답을 JSON으로 파싱
  - Parses the model response as JSON.
  - `action` 키를 확인하여 적절한 도구 객체를 찾음
  - Checks the `action` key to find the appropriate tool object.
  - 도구 호출 실패 시 원본 응답 반환
  - Returns the original response if the tool call fails.
  - 디버그 로그를 통해 흐름을 추적
  - Traces the flow through debug logging.

아래는 함수의 주요 코드 스니펫입니다:
Below is the main code snippet of the function:

```javascript
import { debugLog } from "./debugLogger.mjs";

export async function handleToolCall(responseContent, tools) {
  debugLog("Handling tool call for response content:", JSON.stringify(responseContent));
  let parsed;
  try {
    parsed = JSON.parse(responseContent);
  } catch (err) {
    debugLog("Response is not a JSON tool call, error:", err.message);
    return responseContent; // early return
  }
  if (!parsed.action) return responseContent;

  const toolObj = tools.find((t) => t.name === parsed.action);
  if (!toolObj) {
    debugLog(`No tool found for action: ${parsed.action}`);
    return responseContent; // early return
  }
  debugLog(`Invoking tool "${parsed.action}" with parameters:`, parsed.parameters);
  const toolResult = await toolObj.fn(parsed.parameters).catch((err) => {
    debugLog("Tool invocation failed:", err.message);
    return responseContent; // early return if tool call fails
  });
  debugLog(`Tool "${parsed.action}" returned:`, toolResult);
  return toolResult;
}
```

### 2. `invokeModelWithToolHandling`
### 2. `invokeModelWithToolHandling`

이 함수는 모델을 호출할 때 도구 호출을 처리하여 올바른 답변을 얻을 수 있도록 합니다.
This function handles tool invocations when calling the model to ensure that the correct response is achieved.

- **주요 역할**:
- **Key Roles:**
  - 모델 호출 후 반환되는 응답을 검사
  - Inspects the response returned after the model is called.
  - 응답 내용이 도구 호출 형식이면 처리 후 재호출
  - If the response is in the tool call format, processes it and re-invokes.
  - 빈 응답일 경우 이전 유효 메시지 반환
  - If the response is empty, returns the last valid message.

아래는 해당 함수의 주요 코드입니다:
Below is the main code for this function:

```javascript
import { AIMessage } from "@langchain/core/messages";
import { debugLog } from "./debugLogger.mjs";

export async function invokeModelWithToolHandling(messages, model, tools) {
  debugLog("Invoking model with tool handling. Current messages:", messages);
  const responseMessage = await model.invoke(messages);
  debugLog("Raw model response message:", responseMessage);
  let content = responseMessage.content;
  debugLog("Model output content:", content);

  if (!content.trim()) {
    debugLog("Empty output detected. Returning the last valid message instead.");
    return messages[messages.length - 1].content;
  }

  const toolOutput = await handleToolCall(content, tools);
  if (toolOutput !== content) {
    debugLog("Tool output detected. Tool output:", toolOutput);
    const toolOutputMessage = new AIMessage(toolOutput);
    const newMessages = messages.concat(toolOutputMessage);
    debugLog("New messages for re-invocation:", newMessages);
    return invokeModelWithToolHandling(newMessages, model, tools);
  }
  return content;
}
```

## 디버깅 로거: `debugLogger`
## Debug Logger: `debugLogger`

함수의 동작 과정을 추적하기 위해 `debugLogger` 모듈을 활용합니다. 환경 변수 `DEBUG_OUTPUT`이 `true`로 설정되어 있을 경우, 디버깅 로그가 콘솔에 출력됩니다.
The `debugLogger` module is used to trace the flow of operations in the functions. When the environment variable `DEBUG_OUTPUT` is set to `true`, debug logs will be printed to the console.

```javascript
import dotenv from "dotenv";
dotenv.config();

const enableDebug = process.env.DEBUG_OUTPUT === "true";

export function debugLog(...args) {
  if (enableDebug) {
    console.log(...args);
  }
}
```

## 결론
## Conclusion

이와 같이 `handleToolCall` 및 `invokeModelWithToolHandling` 함수는 LangChain/LangGraph 환경에서 도구 호출 관련 문제를 효과적으로 해결할 수 있도록 설계되었습니다. 모델이 지원하지 않는 도구 호출 오류를 임시적으로 처리하고, 디버깅 로거를 통해 개발자들이 문제를 쉽게 추적할 수 있도록 돕습니다.
In summary, the `handleToolCall` and `invokeModelWithToolHandling` functions are designed to effectively resolve issues related to tool calls in the LangChain/LangGraph environment. They temporarily handle errors from unsupported tool calls and help developers trace issues easily through a debug logger.

향후 정식 라이브러리로 릴리즈할 때까지 본 임시 처리 함수를 참고하여 여러분의 프로젝트에 적용해 보시길 바랍니다.
Until these functions are officially released as a library, we encourage you to refer to and implement this temporary handling approach in your projects.

Happy coding!