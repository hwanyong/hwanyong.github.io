---
title: Vectors — Definition, Dimension, Orientation
description: A vector is numbers laid out in order. Dimension is how many; orientation is upright or flat.
date: 2026-06-29
version: '1.0'
tags: ['mathematics', 'linear algebra', 'vectors']
thumbnail: /images/lecture/thumb/linear-algebra-01-vectors.svg
---

A vector is **numbers laid out in order.** That's all.

If that definition sounds trivial, good. The first component of linear algebra really is
trivial; what gets hard is handling many of these trivial things at once.

## Why you need this

To handle data with mathematics, you first need **a single object** to hold it in.

Height 172, weight 68, age 34. These three belong to one person, so they should travel
together — but scattered across three variables, the unit "this person" disappears from your
code. You pass three arguments to every function, and comparing two people means comparing
three times.

1. Several numbers must be handled as one → you need a container → **vector**
2. You must count "how many pieces of information" → you need a measure → **dimension**
3. The same numbers multiply differently depending on flat or upright → you need a convention → **orientation**

In one line: bundle numbers into one object (vector), count them (dimension), decide which way
they stand (orientation).

## Two properties of a vector

$$
x = \begin{bmatrix} 1 \\ 4 \\ 5 \\ 6 \end{bmatrix}, \qquad
y = \begin{bmatrix} 0.3 \\ -7 \end{bmatrix}, \qquad
z = \begin{bmatrix} 1 & 4 & 5 & 6 \end{bmatrix}
$$

**Dimensionality** is the number of elements. $x$ is 4-dimensional, $y$ is 2-dimensional. The
set of $N$-dimensional real vectors is written $\mathbb{R}^N$, so $y \in \mathbb{R}^2$.

**Orientation** is whether it stands upright or lies flat. Upright is a **column vector**, flat
is a **row vector**. $x$ is a column vector, $z$ is a row vector.

Here's the first place you can trip.

> $x$ and $z$ are **different vectors.** Same numbers in the same order — but different
> orientation means different.

Right now that looks like nitpicking. In
[05 The Dot Product](/lecture/math/linear-algebra/05-dot-product/), that distinction changes
the *shape* of the result.

![The definition of a vector, with examples](/images/figures/md4-1-2-vector-basics-and-examples.png)

## Trap one — "dimension" means two different things

What mathematics calls dimension and what NumPy calls dimension are different. Not knowing this
costs you debugging time.

| | What it counts | For a 4-element vector |
|---|---|---|
| Mathematical dimension | **number of elements** | 4 |
| NumPy's `ndim` | **number of axes** | 1 |

In NumPy the element count is reported by `shape` or `len()`, not by dimension.

```python
import numpy as np

v = np.array([1, 4, 5, 6])
v.ndim      # 1    ← one axis. Not the mathematical "dimension"
v.shape     # (4,) ← the 4 here is the mathematical dimension
len(v)      # 4
```

What you called a "4-dimensional vector" at the whiteboard reports `ndim == 1` in code. The same
word is counting different things in two places; neither is wrong.

## Making orientation visible in code

There are four ways to make a vector in NumPy, and they are not the same thing.

```python
[1, 4, 5, 6]                      # Python list — not a vector yet
np.array([1, 4, 5, 6])            # shape (4,)   no orientation
np.array([[1, 4, 5, 6]])          # shape (1, 4) row vector
np.array([[1], [4], [5], [6]])    # shape (4, 1) column vector
```

Because `shape` is `(rows, columns)`, the orientation is visible. The third has one row; the
fourth has one column.

The second, `(4,)`, is the subtle one. It's a 1-D array with **no orientation** — neither a
mathematical column vector nor a row vector. It's convenient and widely used in practice, but
transposing it does nothing (`v.T` is still `(4,)`) and some linear algebra functions will
reject it.

In this course, **when the formula says column vector, the code writes `(N, 1)`.** It's more
typing, but keeping formula and code aligned is cheaper in the end.

## Vectors as arrows

Vectors in $\mathbb{R}^2$ or $\mathbb{R}^3$ can be drawn: an arrow from a **tail** to a **head**.

The important part is that the arrow is **the same vector wherever you put it.** $[2, 3]$ means
"2 to the right, 3 up" — a displacement, not a location. Draw it anywhere on the page and it's
the same vector as long as the length and slope match.

Putting the tail at the origin is called **standard position**. Not because it's special, but
because if everyone agrees to place them in the same spot, comparison gets easy.

![A three-dimensional vector](/images/figures/md4-3-3d-vector.png)

From four dimensions on, you can't draw it. The arithmetic works exactly the same — the picture
is an aid to understanding, not the definition. That fact makes 384-dimensional embeddings much
less alarming later.

## Recap

| Question | Answer |
|---|---|
| What is a vector | Numbers laid out in order |
| Dimension | Number of elements (the $N$ in $\mathbb{R}^N$) |
| Orientation | Column (upright) or row (flat) |
| $x$ vs $x^{\mathsf{T}}$ | Different orientation, therefore **different vectors** |
| Mathematical dimension ↔ NumPy | Element count ↔ `shape`, axis count ↔ `ndim` |
| What `(4,)` is | A 1-D array with no orientation. Not a column vector |

## Where this shows up

- **Artificial Intelligence » Vector Search 01 Embeddings** — one sentence turns into 384
  numbers and becomes a vector in exactly this sense.
  → [/lecture/artificial-intelligence/vector-search/01-embeddings/](/lecture/artificial-intelligence/vector-search/01-embeddings/)

## Next

We have vectors. Now we need to be able to measure them.
→ [02 Norms and Unit Vectors](/lecture/math/linear-algebra/02-norm/)
