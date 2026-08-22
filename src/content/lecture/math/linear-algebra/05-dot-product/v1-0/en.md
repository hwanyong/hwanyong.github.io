---
untranslated: ko
title: 내적
description: 두 벡터를 한 숫자로 압축한다. 그 숫자의 부호가 사잇각을 말한다.
date: 2026-08-21
version: '1.0'
tags: ['수학', '선형대수', '벡터']
thumbnail: /images/lecture/thumb/linear-algebra-05-dot-product.svg
---

**내적**은 두 벡터를 받아 **숫자 하나**를 내놓는다. 대응하는 원소끼리 곱해서 다 더한다.

$$
\delta = \sum_{i=1}^{n} a_i b_i
$$

$$
[1, 2, 3, 4] \cdot [5, 6, 7, 8] = 5 + 12 + 21 + 32 = 70
$$

곱하고 더한다. 계산은 이게 전부다. 이 차시의 나머지는 **왜 이 숫자가 의미를 갖는가**에
관한 것이다.

## 왜 이걸 배우나

여기까지 벡터 하나를 다루는 법만 배웠다. 만들고([01](/ko/lecture/math/linear-algebra/01-vectors/)),
재고([02](/ko/lecture/math/linear-algebra/02-norm/)),
움직였다([03](/ko/lecture/math/linear-algebra/03-vector-operations/)).

이제 두 벡터를 놓고 물어야 한다. **이 둘이 얼마나 닮았나.**

1. 두 벡터의 "닮음" 을 하나의 수로 못 요약한다 → 둘을 한 스칼라로 압축할 연산 → **내적**
2. 그 숫자가 왜 닮음인지 기하 의미가 없다 → 사잇각과 잇는 정의 → **$\delta = \lVert v \rVert \lVert w \rVert \cos\theta$**
3. 크기가 큰 벡터가 점수를 부풀린다 → 크기를 빼고 방향만 → **코사인 유사도**

## 직관 하나 — 취향 일치 점수

영화 세 편에 대한 두 사람의 선호도라고 하자. 양수는 좋아함, 음수는 싫어함이다.

$$
a = [\,2,\ -1,\ 3\,] \qquad b = [\,1,\ -2,\ 2\,]
$$

$$
a \cdot b = (2)(1) + (-1)(-2) + (3)(2) = 2 + 2 + 6 = 10
$$

세 항 모두 양수가 나왔다. **둘 다 좋아하면** 양수 × 양수 = 양수. **둘 다 싫어해도**
음수 × 음수 = 양수. 의견이 갈릴 때만 항이 음수가 된다.

즉 곱셈이 **항목마다 일치 여부를 채점하고**, 덧셈이 그것을 **총점으로 합산한다.**
내적이 "닮음 점수" 인 이유가 이 두 단계에 있다.

![내적 = 취향 일치 점수](/images/figures/la1-7-dot-matching-score.png)

## 직관 둘 — 그림자의 길이

같은 숫자를 기하로 읽으면 이렇게 된다.

$$
\delta = \lVert v \rVert \, \lVert w \rVert \cos\theta
$$

$w$ 를 $v$ 위로 수직으로 내리면 **그림자**가 생긴다. 그 그림자의 길이가
$\lVert w \rVert \cos\theta$ 다. 내적은 거기에 $\lVert v \rVert$ 를 곱한 값이다.

썸네일의 굵은 회색 선분이 그 그림자다.

![투영으로 보는 내적](/images/figures/la1-6-dot-projection-intuition.png)

두 정의가 같은 값이라는 것은 코사인 법칙으로 증명된다. 여기서 중요한 것은
**원소곱의 합이라는 대수적 정의 안에 각도 정보가 이미 들어 있었다**는 사실이다.
각도를 따로 넣어 준 적이 없는데도 그렇다.

## 부호가 각도를 말한다

$\lVert v \rVert$ 와 $\lVert w \rVert$ 는 항상 0 이상이다. 그러니 내적의 **부호는
$\cos\theta$ 의 부호**다.

| 내적 | $\cos\theta$ | 사잇각 | 뜻 |
|:---:|:---:|:---:|---|
| $> 0$ | 양수 | 예각 | 대체로 같은 쪽을 본다 |
| $= 0$ | 0 | **직각** | 아무 관계 없다 |
| $< 0$ | 음수 | 둔각 | 대체로 반대쪽을 본다 |

가운데 줄이 이 차시에서 가장 많이 쓰이는 사실이다.

> **직교 $\iff$ 내적이 0**

"수직" 을 각도로 재지 않고 **곱셈과 덧셈만으로** 판정할 수 있다는 뜻이다.
384차원에서도 각도기 없이 직교를 확인할 수 있다.

![내적의 부호와 사잇각](/images/figures/la1-5-dot-product-sign-vs-angle.png)

## 함정 — 내적이 크다고 각도가 작은 건 아니다

$\delta = \lVert v \rVert \lVert w \rVert \cos\theta$ 에는 값이 세 개 곱해져 있다.
그래서 내적이 크다는 것은 **각도가 작다** 는 뜻일 수도, 그냥 **벡터가 길다** 는 뜻일
수도 있다.

```python
import numpy as np

a = np.array([1, 0]);      b = np.array([0.7, 0.7])   # 45도, 짧다
c = np.array([100, 0]);    d = np.array([50, 90])     # 약 61도, 길다

a @ b    # 0.7
c @ d    # 5000   ← 각도는 더 큰데 내적이 훨씬 크다
```

방향만 비교하려면 크기를 나눠 없애야 한다. 그것이 **코사인 유사도**다.

$$
\cos\theta = \frac{v \cdot w}{\lVert v \rVert \, \lVert w \rVert}
$$

[02 의 정규화](/ko/lecture/math/linear-algebra/02-norm/) 를 미리 해 두면, 코사인
유사도는 그냥 내적이 된다. 단위벡터끼리는 $\lVert v \rVert = \lVert w \rVert = 1$
이기 때문이다.

## 전치의 위치가 결과를 가른다

같은 두 벡터로 전혀 다른 것을 만들 수 있다. 차이는 $\mathsf{T}$ 가 어디 붙느냐뿐이다.

| 쓰는 법 | 이름 | 결과 |
|---|---|---|
| $v^{\mathsf{T}} w$ | 내적 | **스칼라** 하나 |
| $v \odot w$ | 아다마르곱 | 원소별 곱. 차원 그대로인 **벡터** |
| $v\, w^{\mathsf{T}}$ | 외적 | $n \times n$ **행렬** |

$(1,n) \times (n,1) = (1,1)$ 이고 $(n,1) \times (1,n) = (n,n)$ 이다.
[03 의 브로드캐스팅 함정](/ko/lecture/math/linear-algebra/03-vector-operations/) 과
같은 이야기가 여기서도 나온다 — **방향이 결과의 모양을 정한다.**

```python
v = np.array([[1], [2], [3]])   # (3, 1)
w = np.array([[4], [5], [6]])   # (3, 1)

v.T @ w        # [[32]]     내적 → (1, 1)
v * w          # 원소별 곱  → (3, 1)
v @ w.T        # 외적       → (3, 3)
```

`np.dot` 이 이름과 달리 실제로는 행렬곱이라는 점도 같이 알아 두면 좋다.
1차원 배열 두 개를 주면 내적처럼 동작하지만, `(1,N)` 과 `(N,1)` 을 주면 `(1,1)` 행렬이
나온다. 이름을 믿지 말고 `shape` 을 믿는 편이 낫다.

## 한 장 요약

| 물으면 | 답한다 |
|---|---|
| 내적 | $\sum a_i b_i$ — 대응 원소 곱의 합. 같은 차원끼리만 |
| 기하 정의 | $\lVert v \rVert \lVert w \rVert \cos\theta$ |
| 부호가 뜻하는 것 | 양수=예각 · 0=**직각** · 음수=둔각 |
| 직교 판정 | 내적이 0. 각도를 재지 않아도 된다 |
| 내적이 크면 | 각도가 작을 수도, 벡터가 길 수도 있다 |
| 코사인 유사도 | $\dfrac{v \cdot w}{\lVert v \rVert \lVert w \rVert}$ — 크기를 지운 내적 |
| $v^{\mathsf{T}}w$ vs $vw^{\mathsf{T}}$ | 스칼라 vs $n\times n$ 행렬 |

## 이 개념이 일하는 곳

- **인공지능 » 벡터 검색 02 유사도** — 검색 엔진이 "가장 가까운 문서" 를 고르는 계산이
  이 내적 하나다. → [/ko/lecture/artificial-intelligence/vector-search/02-similarity/](/ko/lecture/artificial-intelligence/vector-search/02-similarity/)

## 다음

여기까지가 지금 공개된 앞머리다. 06 직교 분해부터는 쓰는 대로 붙는다.
→ [강의 목록](/ko/lecture/math/linear-algebra/)
