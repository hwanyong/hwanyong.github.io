---
title: Embeddings
description: One sentence becomes 384 numbers. Why those numbers end up carrying meaning.
date: 2026-08-06
version: '1.0'
tags: ['artificial intelligence', 'embeddings', 'search']
thumbnail: /images/lecture/thumb/vector-search-01-embeddings.svg
---

> **Prerequisite** — [Mathematics » Linear Algebra 01 Vectors](/lecture/math/linear-algebra/01-vectors/).
> What a vector is and what dimension means is taught there. Here we only use it.

An **embedding** turns something into a vector. A sentence, an image, a product — anything
becomes one fixed-length vector.

```python
embed("a dog runs in the park")
# array([ 0.021, -0.184,  0.093, ...,  0.047])   length 384
```

That's what the thumbnail draws. Different things on the left land as points inside **one
space** on the right.

## Why you need this

You're building search. A user types "puppy" and you need to find the document titled "how to
walk your dog." Not a single character overlaps.

1. Matching only on characters → you need a way to handle meaning → **meaning as coordinates**
2. Coordinates of varying length can't be compared → **fixed length**
3. Coordinates measured with different rulers are meaningless together → **same model, same space**

## Why a vector specifically

For a computer to compute "alike," the form has to be **comparable.** Strings aren't — there is
no subtraction between two sentences.

Vectors are different. The tools already exist. You can add them, subtract them, measure their
length, measure the angle between them. Everything built in
[Linear Algebra 01–05](/lecture/math/linear-algebra/) carries straight over.

So what an embedding does comes down to this:

> **It moves something uncomparable into something comparable.**

Once it's moved, the mathematics takes over.

## What does it mean for coordinates to carry meaning

The key isn't the vector itself, it's **the arrangement of the vectors.**

Embedding models are trained roughly on this rule — *put things that appear together near each
other, and things that don't far apart.* Repeat that arrangement over web-scale text for long
enough and "puppy" and "dog" end up sitting near each other, because the contexts they appear
in are nearly identical.

The important consequence: **individual coordinates have no meaning.**

```python
v = embed("puppy")
v[17]   # -0.0413   ← what this single number means: nothing
```

The 17th value doesn't mean "has fur." Meaning comes only from **where one vector sits relative
to the others.** Attempts to pull out one coordinate and interpret it generally fail.

This property has a practical consequence attached.

> **Vectors from different models cannot be mixed.** They're coordinates in different spaces.

Compare a document vector made by model A with a query vector made by model B and you get a
number with no error and no meaning. Swap the embedding model and **you have to rebuild every
stored vector.** It's a common cause of search quality quietly collapsing.

## Why 384 dimensions

You can't draw $\mathbb{R}^{384}$. The arithmetic still works exactly as in $\mathbb{R}^2$ —
as [Linear Algebra 01](/lecture/math/linear-algebra/01-vectors/) put it, the picture is an aid
to understanding, not the definition.

The model decides the dimension. 384, 768 and 1536 are common. If you ever have to choose,
there are two criteria.

| | Lower dimension | Higher dimension |
|---|---|---|
| Expressiveness | misses fine distinctions | separates better |
| Cost | cheap to store and compute | 6KB per vector (1536 × 4 bytes) |

A million documents at 1536 dimensions is 6GB. Search speed roughly scales with dimension. So
the answer isn't "higher is better" but **as much as the task needs.**

## Checking it by hand

Let's confirm in code that embeddings create an arrangement.

```python
import numpy as np

docs = [
    "how to walk your dog",
    "puppy training basics",
    "python list comprehensions",
]
vecs = np.array([embed(d) for d in docs])   # (3, 384)

vecs.shape          # (3, 384)  three documents as three points in one space
np.linalg.norm(vecs[0] - vecs[1])   # small — both about dogs
np.linalg.norm(vecs[0] - vecs[2])   # large — one is about code
```

`np.linalg.norm(a - b)` is exactly [the norm from Linear Algebra 02](/lecture/math/linear-algebra/02-norm/)
and [the subtraction from 03](/lecture/math/linear-algebra/03-vector-operations/). Not one new
concept.

There is a problem with this approach, though. **Long documents are automatically penalised.**
That problem and its fix are the next session.

## Recap

| Question | Answer |
|---|---|
| What an embedding is | Moving something uncomparable into a vector |
| Why a vector | Addition, norms and dot products already exist for them |
| Where the meaning is | Not in one coordinate but in **the arrangement relative to others** |
| What `v[17]` means | Nothing. Individual dimensions aren't for interpreting |
| If you swap models | You must **rebuild every stored vector** |
| Dimension count | The model decides. Not higher-is-better, but as much as needed |

---

We have points in one space. Now we have to define "close."
