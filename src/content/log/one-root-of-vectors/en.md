---
title: The One Root of Vectors
description: The Pythagorean theorem from school and cosine similarity in AI are the same formula at different ages.
date: 2026-07-09
tags: ['linear algebra', 'mathematics', 'geometry']
---

Going back through linear algebra, I kept getting an odd sense of déjà vu. Learning the norm,
I felt I'd seen it before. Learning cosine similarity, same thing.

It wasn't déjà vu. **I had already learned both in high school.** Only the names had changed.

## Vectors get taught in three different rooms

Three subjects teach the same object separately.

**Geometry** — an arrow on a plane. It has a length and an angle; you measure them with a ruler
and a protractor.

**Physics** — a force, a velocity. Two forces acting at once add component by component to give
a resultant.

**Linear algebra** — a list of numbers. The features of one data point laid out in a row, and
the dimension might be 384.

I don't remember anyone telling me these were related. I learned them in different terms, from
different teachers, on different exams.

## Bridge one — Pythagoras grows up into the norm

Start with a right triangle.

$$
c = \sqrt{a^2 + b^2}
$$

The length of a vector in the plane is the same formula. With components $x$ and $y$, the
length is $\sqrt{x^2+y^2}$. The magnitude of a resultant force in physics is the same:
$\sqrt{F_x^2 + F_y^2}$.

And here's the norm.

$$
\lVert v \rVert = \sqrt{\sum_{i=1}^{n} v_i^2}
$$

**Only the number of terms grew.** Two is Pythagoras, three is the diagonal of a box, 384 is
the norm. Not a new concept — **the general form of the same formula.**

Once I saw that, 384 dimensions got less frightening. You can't draw it, but the arithmetic is
what you were doing in middle school. Being unable to picture something and being unable to
understand it are not the same thing.

## Bridge two — cosine grows up into similarity

The second bridge surprised me more.

In trigonometry, cosine is **adjacent over hypotenuse**. Near 1 for a small angle, 0 at a right
angle, negative past that.

$$
\cos\theta = \frac{A \cdot B}{\lVert A \rVert \, \lVert B \rVert}
$$

That's cosine similarity. The number AI document search uses to ask "how alike are these two
sentences" is **trigonometry with a new name**.

The meaning of the values carries over too. Near 1 means the same direction, 0 means
perpendicular, negative means opposed. Smaller angle means more alike, same as ever. The one
thing that changed is that **you can no longer see the angle.**

In two dimensions you draw it and look. In 384 you can't, so you **measure it indirectly with
the formula.** That's the whole difference.

## Why did nobody say this

The three subjects pretend not to know each other.

Geometry is aimed at **seeing**, so it stays in two and three dimensions. Physics is aimed at
**explaining the world**, so it uses the words force and velocity. Linear algebra is aimed at
**generality**, so it throws away the picture and goes to $n$ dimensions.

Different aims give different vocabularies, and different vocabularies hide the fact that it's
one thing. I learned it three times and didn't notice until my thirties.

## What I got out of it

| What you learned in school | What AI calls it |
|---|---|
| Pythagoras $\sqrt{a^2+b^2}$ | Norm $\lVert v \rVert$ |
| Cosine $\cos\theta$ | Cosine similarity |
| Resolving into components | Coordinates · basis |
| Resultant force | Vector addition |

If you know the left column, the right column isn't something new to learn — **it's something
to extend.**

The first wall anyone hits when going back to mathematics isn't difficulty. It's the question
**"can I actually do this?"** Standing at that wall, this fact helped. You already know it.
You just haven't heard the name yet.

The norm is covered in [Linear Algebra 02](/lecture/math/linear-algebra/02-norm/), and cosine
similarity in [05 The Dot Product](/lecture/math/linear-algebra/05-dot-product/).

---

**Why a developer goes down into mathematics** — a four-part set

1. [Why Linear Algebra](/log/why-linear-algebra/)
2. **The One Root of Vectors** ← you are here
3. [Why Neural Networks Are Matrices](/log/why-neural-nets-are-matrices/)
4. [The Whole Picture of an LLM](/log/llm-big-picture/)
