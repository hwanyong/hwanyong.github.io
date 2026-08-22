---
title: Similarity
description: Why angle instead of distance. Why search throws length away first.
date: 2026-08-13
version: '1.0'
tags: ['artificial intelligence', 'search', 'embeddings']
thumbnail: /images/lecture/thumb/vector-search-02-similarity.svg
---

> **Prerequisite** — [Mathematics » Linear Algebra 02 Norms](/lecture/math/linear-algebra/02-norm/) ·
> [05 The Dot Product](/lecture/math/linear-algebra/05-dot-product/).
> Why cosine similarity is the dot product with magnitude removed is derived there. Here we deal
> with **why search picks that particular ruler.**

In [01](/lecture/artificial-intelligence/vector-search/01-embeddings/) we turned documents into
points in one space. Turn the query into a point the same way and search becomes a single
sentence.

> **Find the nearest point.**

The problem is that "near" isn't one thing.

## Why you need this

At the end of 01 we used distance. Small `norm(a - b)` meant similar. Put that into a real
search and something strange happens.

1. Measured by distance, **long documents always lose** → remove the effect of length → **normalisation**
2. With length removed, only direction is left → a ruler for direction → **cosine similarity**
3. Normalise up front and you never divide again → **it collapses to one dot product**

## Why distance loses

The length of an embedding vector broadly tracks **how long or how emphatic the text is.** Two
documents on the same topic sit at different distances from the origin if one is longer.

Take two documents pointing the same way.

```python
import numpy as np

query = np.array([1.0, 1.0])          # the query
short = np.array([1.2, 1.1])          # same topic, short text
long_ = np.array([6.0, 5.5])          # same topic, long text

np.linalg.norm(query - short)   # 0.22  close
np.linalg.norm(query - long_)   # 6.73  far!
```

`long_` points in **almost exactly the same direction** as `short`. Same topic. And yet by
distance it reads as far away. It was pushed out purely by length.

Build search this way and **only short documents reach the top.** Regardless of content.

## Throw length away first

Length is the cause, so erase length.
[The normalisation from Linear Algebra 02](/lecture/math/linear-algebra/02-norm/) is the tool.

$$
\hat v = \frac{v}{\lVert v \rVert}
$$

Normalise and every vector sits on **the same circle.** That's what the thumbnail shows —
length has already been erased, and the only difference left between two vectors is **the angle
between them.**

```python
def unit(v):
    return v / np.linalg.norm(v)

unit(short)   # [0.737, 0.676]
unit(long_)   # [0.737, 0.676]   ← they became the same vector
```

Two vectors that differed by a factor of five are indistinguishable after normalisation. That's
what we wanted — for search, they should be the same thing.

## Hence cosine

The dot product of two normalised vectors is exactly $\cos\theta$.

$$
\cos\theta = \frac{v \cdot w}{\lVert v \rVert \, \lVert w \rVert} = \hat v \cdot \hat w
$$

The derivation is in [Linear Algebra 05](/lecture/math/linear-algebra/05-dot-product/). What we
use here is the **behaviour** of that result.

| $\cos\theta$ | Meaning | In search |
|:---:|---|---|
| $1$ | same direction | same content |
| $0$ | right angle | unrelated |
| $-1$ | opposite direction | — |

A practical fact attaches to that last row. **Negative values almost never appear in embedding
search.** Modern embedding vectors cluster inside a narrow cone, so even unrelated documents
score $\cos\theta$ around 0.2–0.5.

Which means **you can't use an absolute cut-off like "above 0.5 is relevant."** The threshold
differs by model and by dataset. What you can use is **rank** — which is why "fetch the top
$k$" is the standard shape in practice.

## Normalise up front and the division disappears

Normalise once at indexing time and the per-query division goes away.

$$
\hat v \cdot \hat w = \cos\theta
$$

Between unit vectors the denominator is 1, so **the dot product is cosine similarity.**

```python
# Indexing — once
index = np.array([unit(embed(d)) for d in docs])   # (N, 384)

# Search — one matrix product
def search(q, k=5):
    scores = index @ unit(embed(q))                # (N,)
    return np.argsort(-scores)[:k]
```

`index @ q` computes the similarity against every document at once. Same result as looping over
documents, except NumPy handles the whole product as a single matrix operation.

Which reveals what vector search actually is.

> **Search by meaning is, underneath, one matrix multiplication.**

## So when do you use distance

Cosine isn't always right. **If length carries meaning, don't erase it.**

| Ruler | When |
|---|---|
| Cosine similarity | text search — when document length must be ignored |
| Euclidean distance | coordinates, sensor readings — when magnitude itself is information |
| Dot product (unnormalised) | recommenders that load popularity or confidence into the length |

The third is the interesting one. Some recommender systems deliberately make popular items'
vectors **longer**. Then an unnormalised dot product computes "direction match × popularity" in
one step. The property
[Linear Algebra 05 flagged as a trap](/lecture/math/linear-algebra/05-dot-product/) — that the
dot product carries both angle and magnitude — used here as a tool.

**Which ruler to pick is not something mathematics decides for you.** Knowing whether length is
signal or noise belongs to whoever knows the domain.

## Recap

| Question | Answer |
|---|---|
| Why not distance | Embedding length tracks text length, so **long documents lose** |
| The fix | Normalisation — erase length, keep direction |
| Cosine similarity | The dot product between unit vectors. 1 = same, 0 = unrelated |
| Absolute thresholds | **Don't.** The distribution differs by model. Use rank |
| Normalising up front | Search becomes one matrix product (`index @ q`) |
| When to use distance | When magnitude itself is information (coordinates, sensors) |

---

We have a similarity measure. Time to assemble the engine — the RAG engine session (03) is on the way.
