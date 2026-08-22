---
title: Vector Axioms — Direction, Negatives, Inverses
description: Direction isn't stored anywhere. A negative isn't "the opposite" — it's the partner that returns you to zero.
date: 2026-07-20
version: '1.0'
tags: ['mathematics', 'linear algebra', 'vectors']
thumbnail: /images/lecture/thumb/linear-algebra-04-vector-axioms.svg
---

Finishing [03](/lecture/math/linear-algebra/03-vector-operations/) leaves one thing nagging.
Addition just adds components separately, so **why does the direction of the result change?**

Components are added with no regard for each other. $x$ with $x$, $y$ with $y$. And yet when you
draw it, the arrow is pointing somewhere else. It looks as if addition created a direction.

It didn't. This session starts by taking that apart.

## Why you need this

If you don't know why an operation behaves the way it does, you don't know what to suspect when
a result surprises you. Axioms aren't rules to memorise — they're **knowing how far the outcome
of an operation is forced.**

1. Components added separately, yet the direction changes → look again at what direction is → **direction is derived**
2. No grounds for why a negative multiple flips the arrow → derive it from the definition → **additive inverse**
3. Lumping scalars in as "1-D vectors" breaks dimension counting later → **a scalar is 0-dimensional**

## Direction isn't stored

Nowhere in the vector $[3, 4]$ is there a value that says "angle 53.13 degrees." There is only
3 and 4.

Direction is **a derived value computed from the ratio of the components.**

$$
\theta = \arctan\!\left(\frac{y}{x}\right)
$$

So adding components independently changes the ratio, and a changed ratio gives a different
computed angle. Addition didn't touch direction — **direction was always a value you read out
of the components.**

```python
import numpy as np

v = np.array([3, 4])
np.degrees(np.arctan2(v[1], v[0]))   # 53.13...  ← computed, not stored
```

This is called **superposition**. Components along each axis add independently without
interfering, and the diagonal arrow is those independent sums **read back geometrically.**

It's the same story as resolving forces into components in physics class, adding each, and
recovering the resultant.

### Physics fitting isn't a mystery

It's easy to get the causality backwards here — to land on "amazing how well mathematics fits
physics."

It's the other way round. The vector axioms are **rules built to describe phenomena like the
superposition of forces.** Physics doesn't follow mathematics; mathematics was designed after
physics. Of course it fits.

## A scalar is 0-dimensional

You sometimes hear "a scalar is 1-dimensional, a vector is 2-dimensional or more." That's wrong.

| | Dimension | Direction |
|---|---|---|
| Scalar | **0** | none |
| Vector in $\mathbb{R}^1$ | 1 | yes (sign) |
| Vector in $\mathbb{R}^2$ | 2 | yes |

A scalar is a **scaling factor** with magnitude but no direction. And $\mathbb{R}^1$ vectors
genuinely exist — vectors with one element. A scalar and an $\mathbb{R}^1$ vector may look
alike in value but they're different objects, and in code that difference is the `shape` of `5`
versus `np.array([5])`.

## Negatives — not "opposite" but "the partner that returns you"

Learning $-v$ as "the vector in the opposite direction" gets you halfway. The definition is
this:

> $-v$ is **the partner that, added to $v$, gives the identity $0$.**
> $$ v + (-v) = 0 $$

This is the **additive inverse**. The flip in direction isn't the definition — it's
**a consequence of the definition.**

That's what the thumbnail shows. $v$ and $-v$ facing each other across the origin. Add them and
you're back at the origin.

### $(-1)\cdot v = -v$ is forced, not intuited

It looks obvious, but this isn't a fact you accept by eye — it's a result **you can't escape**
once you have the axioms.

$$
v + (-1)v = 1\cdot v + (-1)v = (1 + (-1))v = 0 \cdot v = 0
$$

Grant only distributivity and $1\cdot v = v$, and $(-1)v$ must be the additive inverse of $v$.
Inverses are unique, so $(-1)v = -v$.

Why does the difference matter? Many of the objects coming up can't be drawn as arrows.
Functions form a vector space. So do polynomials, and 384-dimensional embeddings. At that point
the picture of "the opposite direction" is unusable, but "the partner that sums to zero" still
works.

**The picture is the special case; the axioms are the general one.**

## Recap

| Question | Answer |
|---|---|
| Where is direction stored | Nowhere. It's computed from the component ratio ($\arctan$) |
| Does addition change direction | No. Components change, so the angle you read out changes |
| Superposition | Each axis adds independently. The diagonal is that result, read back |
| Why physics fits | Mathematics was designed after physics, not the reverse |
| Dimension of a scalar | **0.** A different object from an $\mathbb{R}^1$ vector |
| Definition of $-v$ | The partner with $v + (-v) = 0$. The flip is a consequence |
| $(-1)v = -v$ | Forced by the axioms. Not something you accept intuitively |

---

One operation left: turning two vectors into a single number.
