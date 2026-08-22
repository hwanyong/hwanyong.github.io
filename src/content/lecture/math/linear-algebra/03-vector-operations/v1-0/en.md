---
title: Vector Operations
description: Addition, subtraction, scaling, transpose, broadcasting. Only two of them are primitive.
date: 2026-07-13
version: '1.0'
tags: ['mathematics', 'linear algebra', 'vectors']
thumbnail: /images/lecture/thumb/linear-algebra-03-vector-operations.svg
---

We made vectors ([01](/lecture/math/linear-algebra/01-vectors/)) and we can measure them
([02](/lecture/math/linear-algebra/02-norm/)). Now we **operate** on them.

This session covers five operations. And at the end, it shows that only **two of them are real.**

## Why you need this

Putting data into vectors doesn't accomplish anything by itself. You have to combine them,
measure differences, scale them, line up axes, and compute across mismatched shapes.

1. One vector can't combine several pieces of data → a combining operation → **addition**
2. How much and in which direction two data points differ → a difference operation → **subtraction**
3. You need to adjust magnitude (the $1/N$ in a mean, weights) → **scaling**
4. Rows and columns don't line up so the product isn't defined → tip the axis over → **transpose**
5. Compute across mismatched shapes without a loop → automatic expansion → **broadcasting**

## Addition — tail onto head

Add element by element. Only between equal dimensions.

$$
\begin{bmatrix} 1 \\ 3 \end{bmatrix} + \begin{bmatrix} 4 \\ 1 \end{bmatrix}
= \begin{bmatrix} 5 \\ 4 \end{bmatrix}
$$

Geometrically you attach the **tail of the second vector to the head of the first** and draw a
new arrow from the first tail to the last head. That triangle is what the thumbnail shows.

![Head-to-tail addition](/images/figures/md4-4-5-addition-head-to-tail.png)

Swapping the order gives the same result ($v + w = w + v$). Overlay both orders and you get a
parallelogram — the "parallelogram rule" and the "head-to-tail rule" are not two rules but
**two names for the same picture.**

![The commutative law](/images/figures/md4-6-commutative-law.png)

## Subtraction — the line between two heads

$a - b$ is the element-wise difference. Geometrically it's **the arrow from the head of $b$ to
the head of $a$.**

The direction is easy to get backwards; think of it as $b + (a-b) = a$. Starting at $b$ and
arriving at $a$ is what $a-b$ does.

![Addition and subtraction](/images/figures/la1-2-vector-add-sub.png)

This "arrow between two points" turns up constantly later. The difference between two data
points, the gap between a prediction and the truth (a residual), a displacement — all
subtraction.

## Scaling — length only

Multiply every element by a single scalar.

$$
2 \begin{bmatrix} 1 \\ 3 \end{bmatrix} = \begin{bmatrix} 2 \\ 6 \end{bmatrix}
$$

Only the length changes; the direction is untouched. Except that **multiplying by a negative
flips the arrow around.** The important part is that even flipped, it **stays on the same line.**

![Scalar multiplication](/images/figures/la1-3-scalar-vector-product.png)

Collect every vector you can make by scaling $v$ by any number and you get a single line
through the origin. That fact is the seed of linear dependence and bases.

## Transpose — laying flat and standing up

Transpose ($\mathsf{T}$) swaps rows and columns. A column vector becomes a row vector and vice
versa. Do it twice and you're back where you started.

$$
(v^{\mathsf{T}})^{\mathsf{T}} = v
$$

You might wonder why this counts as an operation. Because without it you can't write the norm
as a product.

$$
\lVert v \rVert^2 = v^{\mathsf{T}} v
$$

Same value as [the $\sum v_i^2$ in 02](/lecture/math/linear-algebra/02-norm/). Only the notation
changed — but it's this form that carries over unchanged once we move to matrices.

## Broadcasting — convenient, and quietly biting

NumPy will compute across mismatched shapes, stretching the smaller side to fit.

```python
np.array([1, 2, 3]) + 10        # array([11, 12, 13])
```

Adding a scalar to a vector is undefined in mathematics. Python does it anyway. Convenient — but
be aware this is **where whiteboard mathematics and code mathematics part ways.**

The real trap is when orientations mix.

```python
col = np.array([[1], [2], [3]])   # (3, 1) column vector
row = np.array([[10, 20, 30]])    # (1, 3) row vector

col + row
# array([[11, 21, 31],
#        [12, 22, 32],
#        [13, 23, 33]])   ← a (3, 3) matrix!
```

You added two vectors and got **a matrix.** No error, no warning. This is
[why 01 taught orientation separately](/lecture/math/linear-algebra/01-vectors/): orientation
changes the **shape of the result.**

## Only two of the five are real

We've now seen five operations. Only two of them actually appear in the definition of a vector
space.

| Operation | Status |
|---|---|
| **Addition** | primitive — in the definition |
| **Scaling** | primitive — in the definition |
| Subtraction | derived — $a + (-1)b$ |
| Mean | derived — sum then multiply by $1/N$ |
| Transpose | notation — it doesn't make a new vector |
| Broadcasting | implementation — a NumPy convenience |

Why this matters: being **closed** under those two is exactly **linearity**, and using both at
once is a **linear combination**. The "linear" in linear algebra points precisely at these two.

From now on you have a question to ask of every new operation you meet: **is this primitive or
derived?**

## Recap

| Question | Answer |
|---|---|
| Addition | Element-wise sum. Geometrically head-to-tail. Commutative |
| Subtraction | Element-wise difference. Geometrically head of $b$ → head of $a$ |
| Scaling | Length changes only. Negative flips — but stays on the same line |
| Transpose | Row↔column. $(v^{\mathsf{T}})^{\mathsf{T}} = v$. $\lVert v \rVert^2 = v^{\mathsf{T}}v$ |
| Broadcasting | Column + row = **matrix**. Silently |
| Primitives | **Addition and scaling, only.** The rest are derived or tooling |

## Next

We've seen the operations. Now the rules they have to obey.
→ [04 Vector Axioms](/lecture/math/linear-algebra/04-vector-axioms/)
