---
title: Norms and Unit Vectors
description: The ruler for a vector's length. And how to throw the length away and keep only direction.
date: 2026-07-06
version: '1.0'
tags: ['mathematics', 'linear algebra', 'vectors']
thumbnail: /images/lecture/thumb/linear-algebra-02-norm.svg
---

The **norm** of a vector is the length of its arrow. The notation is a double vertical bar.

$$
\lVert v \rVert = \sqrt{\sum_{i=1}^{n} v_i^2}
$$

Square each element, add them up, take the square root at the end. In $\mathbb{R}^2$ this is
exactly the Pythagorean theorem. In $\mathbb{R}^{384}$ the formula is unchanged — there are just
384 terms.

## Why you need this

In [01](/lecture/math/linear-algebra/01-vectors/) we made vectors. Having made them, we find we
**can't measure them.** There's no way to ask whether this vector is bigger than that one, or
how far it is from the origin. And without a size, you can't ask how *close* two vectors are
either.

1. You can't measure a vector's size → you need a ruler → **the norm $\lVert v \rVert$**
2. Taking a square root every time is wasteful if you're only comparing → **the squared norm $\lVert v \rVert^2$**
3. Sizes vary, so you can't compare direction cleanly → you need to fix size at 1 → **unit vectors**
4. But zero can't be made into 1 → you need an exception → **the zero vector has no unit vector**

In one line: a ruler (norm) → fast comparison (squared norm) → keeping only direction
(normalisation).

## How to read the formula

If $\sum$ is unfamiliar, read it this way. **It's a for loop.**

$$
\sum_{i=1}^{n} v_i^2 \quad \longleftrightarrow \quad
\texttt{total = 0; for i in range(n): total += v[i]**2}
$$

$i=1$ is the initial value, $n$ is the end, $v_i^2$ is what you add inside. Three symbols
mapping onto the three parts of a for loop. Mathematical notation isn't hard, it's compressed.

```python
import numpy as np

v = np.array([3, 4])
np.linalg.norm(v)        # 5.0
np.sqrt(np.sum(v ** 2))  # 5.0  ← the same calculation by hand
```

## Another collision of terms

The same thing that happened with "dimension" in
[01](/lecture/math/linear-algebra/01-vectors/) happens again here.

| Code | What it gives | For a 4-element vector |
|---|---|---|
| `len(v)` | mathematical **dimension** (element count) | 4 |
| `np.linalg.norm(v)` | geometric **magnitude** (length) | $\sqrt{\sum v_i^2}$ |

The confusion comes from English *length* covering both. That's why this course says **norm**
or **magnitude** rather than length.

## The norm can't be undone

Taking a norm **crushes many vectors into one number.** $[3,4]$, $[5,0]$ and $[0,-5]$ all have
norm 5. From the number 5 alone there is no way back to the original vector.

Obvious, but consequential. The norm is an **operation that discards information**, and what it
discards is direction. So a norm alone can never tell you whether two vectors are alike —
that's the job of [05 The Dot Product](/lecture/math/linear-algebra/05-dot-product/).

## There is more than one norm

What we've used so far is precisely the **L2 norm**. You can build the ruler differently.

$$
\lVert v \rVert_1 = \sum_i |v_i| \qquad
\lVert v \rVert_2 = \sqrt{\sum_i v_i^2} \qquad
\lVert v \rVert_\infty = \max_i |v_i|
$$

L1 is the sum of absolute values (distance walking along a grid), L2 is straight-line distance,
L∞ is the single largest component.

The fastest way to see the difference is to draw **"all the points whose norm is 1."** L2 gives
a circle, L1 a diamond, L∞ a square.

![Nesting of the L1, L2 and L∞ unit balls](/images/figures/la1-3-norm-unit-balls-l1-l2-linf-inclusion.png)

L2 is the default. When this course says "norm" with no qualifier, it means L2.

## The squared norm — square roots are expensive

Often you only need to know which of two vectors is longer. In that case the square root is
**waste.**

$$
\lVert a \rVert < \lVert b \rVert \iff \lVert a \rVert^2 < \lVert b \rVert^2
$$

Square root is monotonically increasing, so it doesn't change the ordering. When you're only
**comparing** magnitudes, dropping it gives the same answer. Differentiation is also much
cleaner on the squared form, which is why loss functions are almost always written squared.

```python
# Finding the nearest point — no square root needed
d2 = np.sum((points - query) ** 2, axis=1)
nearest = points[np.argmin(d2)]
```

## Unit vectors — discard length, keep direction

Multiply by the reciprocal of the norm and you get a vector of length 1.

$$
\hat v = \frac{1}{\lVert v \rVert}\, v
$$

The direction is untouched; only the magnitude becomes 1. This is called **normalisation**.

That's what the thumbnail draws. Four arrows of different lengths all land on a single point on
the same circle. Normalisation is **an operation that throws length away**, and what remains is
direction alone.

Why is throwing something away useful? When you want to compare a "long document" and a "short
document" purely on content, leaving length in means the long one always wins. You have to
erase length first for direction to compete on its own.

```python
def normalize(v):
    n = np.linalg.norm(v)
    if n == 0:
        raise ValueError('the zero vector has no unit vector')
    return v / n
```

### The one exception

$\lVert 0 \rVert = 0$, so the operation becomes $1/0$. **The zero vector has no corresponding
unit vector.**

This isn't mathematical pedantry — it's a real production failure. Feed an empty string into
code that normalises embedding vectors and you get `nan` here, and `nan` spreads quietly and
surfaces much later. Decide what to do about the zero vector before you use a normalise
function.

## Recap

| Question | Answer |
|---|---|
| Norm | $\lVert v \rVert = \sqrt{\sum v_i^2}$ — the length of the arrow |
| Reading $\sum$ | A for loop. Bottom = start, top = end, right = what to add |
| `len()` ↔ `norm()` | Element count (dimension) ↔ magnitude (length) |
| Why the squared norm | Comparison only needs ordering, and square roots are expensive |
| Unit vector | $\hat v = v / \lVert v \rVert$ — keeps only direction |
| The zero vector | Has **no** unit vector ($1/0$) |
| L1 · L2 · L∞ | Sum of absolutes · straight line · maximum. L2 is the default |

## Where this shows up

- **Artificial Intelligence » Vector Search 02 Similarity** — normalisation is what erases
  document length so only content competes.
  → [/lecture/artificial-intelligence/vector-search/02-similarity/](/lecture/artificial-intelligence/vector-search/02-similarity/)

## Next

We can measure. Now we can operate.
→ [03 Vector Operations](/lecture/math/linear-algebra/03-vector-operations/)
