---
title: Vector Search
description: How search-by-meaning actually works. From embeddings to a RAG engine built by hand.
date: 2026-08-04
tags: ['artificial intelligence', 'search', 'embeddings']
thumbnail: /images/lecture/thumb/vector-search.svg
---

Keyword search only finds you things that share characters. Search for "puppy" and you won't
get "dog."

**Vector search** matches on **meaning** instead of characters. This course looks at how that
is possible, from the bottom — starting where a sentence becomes a bundle of numbers, ending
with a search engine built by hand without a library.

## This course does not teach mathematics

Vector search runs on linear algebra. But nothing here re-explains what a vector is or how the
dot product behaves.

There's a reason. Mix the concept and the application on one screen and the reader can no
longer tell whether they **understood the concept or memorised its use here.** You end up
thinking you know cosine similarity when what you know is "the formula search uses."

So the mathematics is handled by
[Mathematics » Linear Algebra](/lecture/math/linear-algebra/). Each session opens with a
**Prerequisite** line; follow the link when you need the concept. What's covered here is only
**what those concepts do inside a search engine.**

## What you'll learn

| Session | Topic |
|---|---|
| 01 Embeddings | How a sentence becomes a vector. Why that vector carries meaning |
| 02 Similarity | What "alike" is measured with. Why angle instead of distance |
| 03 RAG engine | Indexing and querying. Built by hand, no libraries |

01 and 02 are published.

## Prerequisites

- **Mathematics** — [Linear Algebra 01–05](/lecture/math/linear-algebra/). Vectors, norms and
  the dot product are enough.
- **Code** — being able to read Python and NumPy.

No machine learning experience needed. We don't train a model — the subject here is **how to
use** the vectors an already-trained model gives you.
