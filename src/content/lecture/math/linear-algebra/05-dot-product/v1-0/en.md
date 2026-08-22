---
title: The Dot Product
description: Two vectors compressed into a single number. The sign of that number tells you the angle.
date: 2026-07-27
version: '1.0'
tags: ['mathematics', 'linear algebra', 'vectors']
thumbnail: /images/lecture/thumb/linear-algebra-05-dot-product.svg
---

The **dot product** takes two vectors and returns **one number**. Multiply corresponding
elements and add them all up.

$$
\delta = \sum_{i=1}^{n} a_i b_i
$$

$$
[1, 2, 3, 4] \cdot [5, 6, 7, 8] = 5 + 12 + 21 + 32 = 70
$$

Multiply, then add. That's the entire computation. The rest of this session is about **why that
number means something.**

## Why you need this

So far we've only handled one vector at a time. We made them
([01](/lecture/math/linear-algebra/01-vectors/)), measured them
([02](/lecture/math/linear-algebra/02-norm/)) and moved them
([03](/lecture/math/linear-algebra/03-vector-operations/)).

Now we put two side by side and ask: **how alike are these?**

1. You can't reduce "alikeness" to one number → an operation compressing two vectors to a scalar → **the dot product**
2. That number has no geometric meaning yet → connect it to the angle between them → **$\delta = \lVert v \rVert \lVert w \rVert \cos\theta$**
3. Large vectors inflate the score → strip magnitude, keep direction → **cosine similarity**

## Intuition one — a taste-matching score

Say these are two people's ratings of three films. Positive means they liked it, negative means
they didn't.

$$
a = [\,2,\ -1,\ 3\,] \qquad b = [\,1,\ -2,\ 2\,]
$$

$$
a \cdot b = (2)(1) + (-1)(-2) + (3)(2) = 2 + 2 + 6 = 10
$$

All three terms came out positive. **Both liked it** gives positive × positive = positive.
**Both disliked it** gives negative × negative = positive too. A term only goes negative when
they disagree.

So multiplication **scores agreement item by item**, and addition **totals it up.** That two-step
structure is why the dot product reads as a "similarity score."

![The dot product as a taste-matching score](/images/figures/la1-7-dot-matching-score.png)

## Intuition two — the length of a shadow

Read the same number geometrically and you get this.

$$
\delta = \lVert v \rVert \, \lVert w \rVert \cos\theta
$$

Drop $w$ perpendicularly onto $v$ and you get a **shadow**. The length of that shadow is
$\lVert w \rVert \cos\theta$. The dot product is that, times $\lVert v \rVert$.

The thick grey segment in the thumbnail is that shadow.

![The dot product as a projection](/images/figures/la1-6-dot-projection-intuition.png)

The two definitions agree, provable via the law of cosines. What matters here is that **angle
information was already inside the algebraic definition** — the sum of element-wise products.
Nobody fed the angle in.

## The sign tells you the angle

$\lVert v \rVert$ and $\lVert w \rVert$ are never negative. So the **sign of the dot product is
the sign of $\cos\theta$.**

| Dot product | $\cos\theta$ | Angle | Meaning |
|:---:|:---:|:---:|---|
| $> 0$ | positive | acute | broadly facing the same way |
| $= 0$ | 0 | **right angle** | no relationship |
| $< 0$ | negative | obtuse | broadly facing opposite ways |

The middle row is the fact you'll use most in this course.

> **Orthogonal $\iff$ dot product is zero**

Which means you can decide "perpendicular" **using only multiplication and addition.** You can
confirm orthogonality in 384 dimensions with no protractor.

![The sign of the dot product versus the angle](/images/figures/la1-5-dot-product-sign-vs-angle.png)

## Trap — a big dot product doesn't mean a small angle

$\delta = \lVert v \rVert \lVert w \rVert \cos\theta$ multiplies three quantities. So a large
dot product might mean **the angle is small**, or it might just mean **the vectors are long.**

```python
import numpy as np

a = np.array([1, 0]);      b = np.array([0.7, 0.7])   # 45 degrees, short
c = np.array([100, 0]);    d = np.array([50, 90])     # about 61 degrees, long

a @ b    # 0.7
c @ d    # 5000   ← larger angle, far larger dot product
```

To compare direction alone, you have to divide the magnitudes out. That's **cosine similarity**.

$$
\cos\theta = \frac{v \cdot w}{\lVert v \rVert \, \lVert w \rVert}
$$

If you normalise in advance — [see 02](/lecture/math/linear-algebra/02-norm/) — cosine
similarity is just the dot product, because between unit vectors
$\lVert v \rVert = \lVert w \rVert = 1$.

## Where the transpose sits decides the result

The same two vectors can produce completely different things. The only difference is where the
$\mathsf{T}$ goes.

| Written as | Name | Result |
|---|---|---|
| $v^{\mathsf{T}} w$ | dot product | a single **scalar** |
| $v \odot w$ | Hadamard product | element-wise product. A **vector**, same dimension |
| $v\, w^{\mathsf{T}}$ | outer product | an $n \times n$ **matrix** |

$(1,n) \times (n,1) = (1,1)$ and $(n,1) \times (1,n) = (n,n)$. The same story as
[the broadcasting trap in 03](/lecture/math/linear-algebra/03-vector-operations/) shows up
again: **orientation decides the shape of the result.**

```python
v = np.array([[1], [2], [3]])   # (3, 1)
w = np.array([[4], [5], [6]])   # (3, 1)

v.T @ w        # [[32]]      dot product → (1, 1)
v * w          # element-wise → (3, 1)
v @ w.T        # outer product → (3, 3)
```

Worth knowing too: `np.dot` is, despite the name, a matrix product. Give it two 1-D arrays and
it behaves like a dot product, but give it `(1,N)` and `(N,1)` and you get a `(1,1)` matrix.
Trust the `shape`, not the name.

## Recap

| Question | Answer |
|---|---|
| Dot product | $\sum a_i b_i$ — sum of element-wise products. Equal dimensions only |
| Geometric definition | $\lVert v \rVert \lVert w \rVert \cos\theta$ |
| What the sign means | Positive = acute · 0 = **right angle** · negative = obtuse |
| Testing orthogonality | Dot product is zero. No angle measurement needed |
| A large dot product | Could be a small angle, could be long vectors |
| Cosine similarity | $\dfrac{v \cdot w}{\lVert v \rVert \lVert w \rVert}$ — the dot product with magnitude erased |
| $v^{\mathsf{T}}w$ vs $vw^{\mathsf{T}}$ | Scalar vs $n\times n$ matrix |

## Where this shows up

- **Artificial Intelligence » Vector Search 02 Similarity** — the calculation a search engine
  uses to pick "the nearest document" is this one dot product.
  → [/lecture/artificial-intelligence/vector-search/02-similarity/](/lecture/artificial-intelligence/vector-search/02-similarity/)

---

That's the published opening. From 06, orthogonal decomposition onward, sessions go up as
they're written.
