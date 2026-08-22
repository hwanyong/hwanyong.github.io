---
title: Why Neural Networks Are Matrices
description: Not because it's convenient. If you want the thing to be learnable, there is no other choice.
date: 2026-08-02
tags: ['AI', 'linear algebra', 'neural networks']
---

Every explanation of neural networks has that picture. Circles in vertical columns, lines
webbing across. And next to it, matrix notation.

For a long time I read those as **two different explanations**. The picture for intuition, the
formula for computation. They aren't. They're **the same thing in two notations.**

## The picture *is* the matrix

Take one layer: 3 input neurons, 2 output neurons. That's $3 \times 2 = 6$ lines.

Each line carries one number, its **weight**. Arrange those six numbers in a table and you have
a $2 \times 3$ matrix.

![A neural network diagram mapped onto its weight matrix](/images/figures/neural-net-diagram-to-weight-matrix-mapping.png)

The circles are the entries of a vector and **the lines are the entries of a matrix.** What one
layer does is $y = Wx$, one line long. Drawing the picture and writing the matrix are the same act.

Which gives you this: **the weights are the model.** "Training" means adjusting the numbers
inside that matrix to fit data, and everything the model knows is those numbers. When someone
says a model has trillions of parameters, they mean **trillions of matrix entries.**

## But why a matrix

Here's the real question. Because it's computationally convenient? Because GPUs are good at it?

Both are consequences, not reasons. The reason is further upstream.

To be a learnable model, one format has to satisfy **three things at once.**

**① Representation** — you must be able to mix inputs. A weighted sum, i.e. a dot product.
**② Composition** — you must be able to stack simple blocks into complex ones.
**③ Differentiation** — gradient descent demands $\partial \text{loss} / \partial W$.

A matrix does all three. But the decisive part is that **applying any of the three gives you
back a matrix.**

- Weighted sum → one cell of a matrix product
- Stacking layers → a chain of matrix products. Still a matrix
- Differentiating a matrix product → the transpose $W^{\mathsf{T}}$. **Still a matrix**

The third is the crux. If differentiation handed you something that wasn't a matrix,
backpropagation would have to switch tools at every layer. Because it's a matrix, **the whole
of backpropagation stays inside matrix operations.** Nothing leaks out.

That property is called being **closed** under the operations. And it's the deepest answer to
"why a matrix."

> You don't use matrices because they're convenient. **Learnability forces the matrix form.**

## The weakness of matrices explains depth

Here's where it flips.

What happens if you keep stacking matrix products? This:

$$
W_2(W_1 x) = (W_2 W_1)\, x
$$

Two layers **collapse into one.** Stack a hundred and you still have the equivalent of a single
matrix, because the composition of linear maps is linear. Depth stops meaning anything.

So you slot a **nonlinearity** like ReLU between the layers. To stop the collapse.

I used to file activation functions under "things that improve performance." They aren't.
They're **the part that makes depth exist at all.** Without them the concept is empty.

So it goes like this. The strength of matrices fixes the *form* of a neural network, and the
**weakness** of matrices fixes its *structure*. The alternation of linear and nonlinear is what
creates expressive power.

Understand matrices and you get why activation functions are mandatory for free. The two facts
are one fact.

## Shape is design

If $W$ is $m \times n$, then $n$ dimensions go in and $m$ come out. So a single shape decides
what that layer is for.

| shape | what it does |
|---|---|
| $m < n$ | compression — bottleneck, dimensionality reduction |
| $m > n$ | expansion |
| final $m = $ number of classes | classifier |

An autoencoder being "narrow in the middle" isn't a metaphor — it's **a literal description of
the chain of matrix shapes.** A large part of architecture design is designing that chain.

## Writing code as numbers

One step further and you can see this is another form of programming.

A traditional program is `if` and `for` written by a person. A neural network is a
**continuous, differentiable program whose matrix entries are set by data.**

A matrix is code turned into numbers, and because it's numbers you can "program" it with
gradient descent. That's what Andrej Karpathy called Software 2.0.

## Three lines

- The diagram is the matrix. Lines are entries, and the weights are the model's knowledge.
- The reason it's a matrix: representation, composition and **differentiation** are all closed
  inside it. Learnability forces it.
- Stack only linear layers and they collapse into one. That's why nonlinearity is mandatory.

Matrix multiplication itself is coming in [Linear Algebra 13](/lecture/math/linear-algebra/),
and the dot product at the root of the weighted sum is in
[05 The Dot Product](/lecture/math/linear-algebra/05-dot-product/).

---

**Why a developer goes down into mathematics** — a four-part set

1. [Why Linear Algebra](/log/why-linear-algebra/)
2. [The One Root of Vectors](/log/one-root-of-vectors/)
3. **Why Neural Networks Are Matrices** ← you are here
4. [The Whole Picture of an LLM](/log/llm-big-picture/)
