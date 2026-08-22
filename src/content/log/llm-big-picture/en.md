---
title: The Whole Picture of an LLM
description: Which stretch of the pipeline do vectors, matrices, statistics and calculus each control?
date: 2026-08-19
tags: ['AI', 'LLM', 'roadmap']
---

A few months into going back to mathematics, I hit a stretch where the progress was real but
**the frustration wasn't going away.**

I knew what a vector was. I knew matrix multiplication. And I still couldn't answer "so where
does this show up in an LLM?" I had the parts in hand but **no drawing of the finished machine.**

So I drew the machine first. Including the cells I hadn't learned yet.

![Which stretches of the LLM pipeline vectors, matrices, statistics and calculus control](/images/figures/llm-pipeline-roadmap-vector-matrix-stats-control.png)

## In one sentence

> An LLM is a pipeline where **vectors** (data) are transformed as they pass through
> **matrices** (weights), **statistics** turns that into probability and a measure of
> wrongness, and **calculus** goes back and fixes the matrices.

Four ingredients, each owning a different stretch. Understanding that sentence is what reading
the drawing means.

## Stretch by stretch

| # | Stage | What it does | Controlled by |
|---:|---|---|:---:|
| 1 | Tokens | characters to integer IDs | (raw input) |
| 2 | Embedding | tokens to a meaning vector $x$ | **vectors** |
| 3 | Layer $Wx+b$ | transform the vector by weights | **matrices** |
| 4 | $N$ layers | composition of transforms | **matrices** |
| 5 | Attention | relations between tokens, $QK^{\mathsf{T}}$ | **matrices** |
| 6 | Logits | the final score vector | **vectors** |
| 7 | Softmax | scores to a probability distribution | **statistics** |
| 8 | Loss | how wrong, as a number | **statistics** |
| 9 | Backpropagation | gradients via the chain rule | **calculus** |
| 10 | Weight update | fix $W$, go back to 1 | **matrices** |

Stages 1–6 are the **forward pass**; 7–10 are the **training loop**. At inference time only
the top half runs.

## What drawing it taught me

### One. Each ingredient owns a different stretch

I had vaguely assumed that digging into linear algebra would eventually make LLMs visible.
Drawing the map showed that **linear algebra owns only 3, 4, 5 and 10.**

How output becomes probability (7) and how wrongness gets measured (8) are **statistics**. How
that error is used to fix the matrices (9) is **calculus**. No amount of linear algebra fills
those cells.

That was the real identity of the "something is still missing" feeling. Nothing was missing —
**there were subjects I hadn't started yet.**

### Two. Not seeing the whole thing was correct

The curriculum stacks pieces in order, so that's expected.

```
Stage 1  materials      vectors · matrices · dot product
Stage 2  training engine calculus · statistics · backpropagation
Stage 3  assembly       attention · transformers
```

Standing where you've gathered the materials and assembled one layer, not seeing the whole
machine is **a fact about progress, not a failure of understanding.** That distinction mattered
more than I expected. Whether you can't see it because *you're not capable* or because *you
haven't got there yet* leads to completely different next actions.

### Three. A map with blanks beats a list without them

With only a table of contents, you follow along without knowing where any of it lands. With a
map, **learning the dot product makes cell 5 light up.** Same study; very different when it has
a place to attach.

Which means the important part of this drawing isn't the filled cells — it's **the empty ones.**
I don't yet know what softmax is, but I know it's "the place where scores become probabilities."
When I learn it, it drops straight into that cell.

## When I'll look at this again

After stage 2 (calculus, statistics, backpropagation) I plan to fill in 7–10 and explain the
training loop out loud. After stage 3 (attention), 5 and 6 get filled.

More filled cells on each review is a progress gauge in itself, and it's a more honest one than
a checklist — a checklist counts pages, this map counts **what you can explain.**

---

The parts I'm currently filling in live in [Mathematics » Linear Algebra](/lecture/math/linear-algebra/),
and the story of cell 2, embeddings, is in
[Artificial Intelligence » Vector Search](/lecture/artificial-intelligence/vector-search/).

---

**Why a developer goes down into mathematics** — a four-part set

1. [Why Linear Algebra](/log/why-linear-algebra/)
2. [The One Root of Vectors](/log/one-root-of-vectors/)
3. [Why Neural Networks Are Matrices](/log/why-neural-nets-are-matrices/)
4. **The Whole Picture of an LLM** ← you are here
