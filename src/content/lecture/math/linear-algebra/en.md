---
title: Linear Algebra
description: From a single vector to matrices. The road a developer has to walk before going down into AI.
date: 2026-06-27
tags: ['mathematics', 'linear algebra']
thumbnail: /images/lecture/thumb/linear-algebra.svg
---

This course covers **mathematics only.** No embeddings, no attention, no neural networks.

That may sound strange, since AI is the reason I went back to linear algebra in the first
place. But studying it taught me something. If you pin **"here's how this is used in AI"** next
to a concept, you can no longer tell whether you understood the concept or memorised the
application. I thought I knew the dot product; what I actually knew was "the thing that goes
into cosine similarity."

So I split them. Here you learn what the dot product is. What it does inside a search engine is
taught separately, in
[Artificial Intelligence » Vector Search](/lecture/artificial-intelligence/vector-search/).
The two courses point at each other without taking over each other's content.

## What you'll learn

We start by defining a vector and end at matrix operations. The order is the order in which
concepts need each other — the gap left by one session is what calls in the next.

| Group | Topics |
|---|---|
| Vectors (01–10) | definition · norm · operations · axioms · dot product · orthogonal decomposition · basis · correlation · convolution · k-means |
| Matrices (11–22) | definition · operations · multiplication · transpose · inverse · norm · spaces · rank · determinant · covariance · transformations |

The first five sessions are published. The rest go up as they're written.

## Prerequisites

**None.** It's fine if you've forgotten your school mathematics — we build what we need as we go.

There is code, though. Every example is Python and NumPy, and each session shows how the
formula lands as code. Being able to read Python is enough. You don't need to write it.

## What's different about this course

Textbooks usually go **definition → properties → examples.** When the definition comes first,
the question "but why do I need this" is left hanging behind it. Learning in that order, I
memorise and then forget.

So every session **starts from a lack.** First: here's what you can't do with the tools you
have so far. Then the concept arrives as the thing that fills the gap. The definition comes
after that.

## References

This course is a rewrite of notes I made while reading the books below. No passage or figure
has been reproduced from them — formulas and definitions belong to nobody, but sentences and
drawings do not. For depth, go to the originals.

I read the Korean editions, so both titles are given.

- Mike X Cohen, *Practical Linear Algebra for Data Science*, O'Reilly
  — Korean ed. 《개발자를 위한 실전 선형대수학》, trans. 장정호, Hanbit Media, 2023.
  **The spine of this course.**
- Thomas Nield, *Essential Math for Data Science*, O'Reilly
  — Korean ed. 《개발자를 위한 필수 수학》, trans. 박해선, Hanbit Media, 2024
- Hala Nelson, *Essential Math for AI*, O'Reilly
  — Korean ed. 《AI 를 위한 필수 수학》, trans. 안민재, Hanbit Media, 2024

Every figure here is my own work. No scanned book pages.
