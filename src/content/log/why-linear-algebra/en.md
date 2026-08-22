---
title: Why Linear Algebra
description: What I couldn't explain wasn't a gap in my thinking. It was a gap in my vocabulary.
date: 2026-06-22
tags: ['linear algebra', 'mathematics', 'metacognition']
---

Before I write code, I **picture the shape of the data and how it flows.** What comes in,
what it passes through, what comes out. The logic comes after that.

But every time I tried to put that picture into words, it went blurry. "So the data kind of
folds here and then flows over that way…" Waving my hands in a meeting room, I'd watch the
same expression form on the other side of the table. Not *you're wrong*. **I don't follow you.**

For a long time I thought this was a problem with how I explain things. It wasn't.

## Two languages

My colleague and I were describing the same system in different languages.

Theirs was **procedure**. "If the condition holds, loop through and append to a list, then
sort and return." A narrative that follows time.

Mine was **structure and flow**. "Lay this block on its side so it meshes with that one, then
keep only the axis you need." A narrative with no time in it, only shape.

Both point at the same program. The problem was that the second language **had no settled
words.** Procedure has `for` and `if` as shared vocabulary; in the language of structure I was
inventing a fresh metaphor every time. A metaphor invented on the spot is vivid only to the
person who invented it.

That's why I went back to linear algebra. I thought it was because of AI. It turned out I was
going to **put names on thinking I was already doing.**

## Putting labels on it

| What I used to say | The word that exists | In a meeting |
|---|---|---|
| Nail down the data structure | Define the vector space | "I defined the effective dimensions and range this data will have" |
| Match up the rows and columns | Dimension · shape | "I matched the input and output matrix shapes to remove the pipeline bottleneck" |
| Reshape it into what I want | Linear transformation | "I transformed it into the subspace the task needs" |
| Keep only what matters | Projection | "I projected onto a chosen basis to strip the noise" |

The right column isn't smarter than the left. It's **the same thing said in words the listener
already knows.** My metaphors have to be learned each time; those words were learned years ago.

### But let's be precise

I got excited about that table, then quickly got careful. **It's a loose analogy, not a
one-to-one correspondence.** Take it literally and you'll be wrong.

The most common trap is "map is a linear transformation." Half true. A linear transformation
is a special function satisfying **both** of these:

$$
f(a+b) = f(a) + f(b), \qquad f(cx) = c\,f(x)
$$

But `map` takes an arbitrary function. `x → x²` is a map. So is `x → x+1`. Neither is linear.
The second one is the interesting case: translation doesn't send the origin to the origin, so
it isn't a linear transformation at all. That's exactly why computer graphics invented
homogeneous coordinates — to push translation inside a matrix.

`filter` is worse. It drops elements based on a condition, so the output dimension depends on
the input. A linear transformation is a map from a fixed space to a fixed space.

**Labels exist to sharpen communication, not to assert mathematical equivalence.** Cross that
line and you trade accuracy for vocabulary.

## It wasn't only about data

Everything above was the payoff I expected. The one I didn't expect was **algorithms.**

Take Fibonacci. Recursion is exponential; iteration is $O(N)$. That's usually where the
algorithms course stops. But write the recurrence like this and the story changes.

$$
\begin{bmatrix} F_{n+1} \\ F_n \end{bmatrix} =
\begin{bmatrix} 1 & 1 \\ 1 & 0 \end{bmatrix}
\begin{bmatrix} F_n \\ F_{n-1} \end{bmatrix}
$$

The $n$-th term is that matrix raised to the $n$-th power. And exponentiation by squaring gets
you there in $O(\log N)$. **Rewriting a recurrence as a matrix drops the complexity class.**

There are more of these. Write a graph as an adjacency matrix and the entries of $A^k$ count
paths of length $k$. PageRank is an eigenvector of the link-structure matrix — a ranking
problem translated into an eigenvalue problem.

In the language of procedure, the best you can do is "how do I shrink this loop." In the
language of structure you can **translate the problem into a different problem.**

## It isn't a universal tool

Stop here and it becomes an overstatement. Far more things don't yield to linear algebra.

Sorting, searching, tree traversal, string matching, cryptography, combinatorial optimization —
that's **discrete mathematics** territory. Nothing continuous, nothing linear, no place for a
matrix to land.

So the conclusion isn't "learn linear algebra." It's that you need **both**, so that you can
look at a problem and choose which language to translate it into. Hold only one and every
problem starts to look like that tool's shape.

## What's left

Three lines:

- My intuition wasn't wrong. **I just had no vocabulary for it.**
- Vocabulary buys communication, and occasionally it **translates a problem into another problem.**
- But a label is not an equation. An analogy stays an analogy.

I went back to mathematics because of AI. Now that I'm some way in, the biggest thing I'm
getting has nothing to do with AI: **I can finally explain something I'd been failing to
explain for ten years.**

I'm keeping the record of that study in [Mathematics » Linear Algebra](/lecture/math/linear-algebra/).

---

**Why a developer goes down into mathematics** — a four-part set

1. **Why Linear Algebra** ← you are here
2. [The One Root of Vectors](/log/one-root-of-vectors/)
3. [Why Neural Networks Are Matrices](/log/why-neural-nets-are-matrices/)
4. [The Whole Picture of an LLM](/log/llm-big-picture/)
