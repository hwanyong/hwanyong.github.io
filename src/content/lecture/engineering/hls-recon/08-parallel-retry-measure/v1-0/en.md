---
title: "Parallelism, Retry, Measurement"
description: "The observing downloader"
date: 2026-06-06
version: '1.0'
tags: ['streaming', 'http']
thumbnail: /images/lecture/thumb/hls-recon-08-parallel-retry-measure.svg
---
## 8.0 What this chapter answers

1. On meeting a failure, **what do you retry and what do you give up on?** What is the basis for that judgment?
2. Why are only `408`·`429` exceptions among the 4xx? Whom does exponential backoff protect?
3. Receive in parallel and results get scrambled by arrival order. **When you lose the order, what exactly breaks?**
4. Why look at latency as **p50·p95** rather than the mean? When does that metric lie?
5. To the peer server, what do parallelism and retry look like?

The first four are three decisions this repository's `Fetcher` made, and the last one is **the mark those
decisions leave on the giving side, not the receiving side.** Answer only the first four without the fifth and
it becomes a performance-tuning document, not a course.

---

## 8.1 The problem — three decisions are tangled in one loop

What this tool does is receive and join hundreds of segments. Let us set the scale in numbers. With 6-second
segments, one 45-minute episode is 450 segments, and a 27-episode batch is **about 12,000 requests.** Here
three things become problems at once.

| Problem | Naive implementation | Its result |
|---|---|---|
| **time** | receive one at a time, sequentially | the per-request round-trip delay accumulates directly |
| **failure** | just retry on failure, or just give up | a retry pushes the server more, or throws away a recoverable failure |
| **observation** | see only whether it arrived | cannot catch "the total length matches but the middle is empty" |

That the three problems' solutions constrain each other is this chapter's starting point. Throw in parallel and
failures come simultaneously; add retry and the parallelism is effectively multiplied; do both and **the
meaning of the measurements blurs** — you cannot tell whether a request's delay is the server's fault or my
own queue wait.

This repository's `Fetcher` split these three as follows.

| Decision | Code location | One-line summary |
|---|---|---|
| **retry classification** | [`fetch.py:139-215`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L139-L215) `_send` | split failures into "could differ if done again" and not |
| **order restoration** | [`fetch.py:223-243`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L223-L243) `get_many` | receive in completion order but return to the submission-time slot |
| **quantile measurement** | [`report.py:56-61`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L56-L61) `_quantile` | see latency as p50·p95, not the mean |

The docstring at the top of the module wrote in one sentence where this tool differs from a general downloader.

```python
# fetch.py:1-5
"""An instrumented HTTP fetcher.

What differs from a general downloader is that it records each request's latency·size·retry count.
Because in delivery verification "when and how long it took to receive" matters more than "it was received."
"""
```

**"When and how long" over "it was received"** — this sentence is the transport-layer version of the problem
consciousness Chapter 1 set up. If Chapter 4 covered this data type's (`FetchResult`) design, this chapter
covers **the loop that produces** that value and **the verdict rules that consume** it.

---

## 8.2 Principle ① — retry is not a performance optimization but a classification problem

### 8.2.1 The criterion is not "did it fail"

Understand retry as "try a few more times on failure" and it becomes a problem of only deciding the retry
count. But the actual decision point is not the count but **whether the following proposition is true.**

> **Send the same request again and could a different answer come?**

If this proposition is false, retry is exactly 0 gain at N× cost. If true, retry is recovery. Therefore a retry
policy is not choosing a backoff constant but **designing a classifier that splits responses into two classes.**

> **Term** — **idempotent**: the property that sending the same request several times has the same effect on
> server state as sending it once. The HTTP spec defines `GET`·`HEAD`·`PUT`·`DELETE` as idempotent, and among
> them `GET`·`HEAD` as **safe**, with no side effects. This tool receives segments only with `GET`, so a retry
> has no risk of changing remote state. A client that auto-retries a non-idempotent `POST` makes a payment
> twice.

Idempotency is a **necessary condition** for retry, not a sufficient one. `GET /seg010.ts` is safe however many
times you send it, but sending a 404 three times is still meaningless. So a second condition is added — **does
the response depend on time.**

### 8.2.2 Why is a 4xx immediate give-up, and why are 408·429 exceptions?

The 4xx family of HTTP status codes means "there is a problem on the request side." Send it again with the
request string·header·credentials unchanged and the server repeats the same judgment.

| Code | Meaning | Does the answer change over time? | This code's handling |
|---|---|---|---|
| `400` Bad Request | the request itself violates the spec | No | halt |
| `401` Unauthorized | no·invalid credentials | No — the credentials are unchanged | halt |
| `403` Forbidden | access denied (hotlink block·signature mismatch) | No | halt |
| `404` Not Found | resource absent | No | halt |
| **`408`** Request Timeout | the server waited for the request and cut it | **Yes** — next time it may arrive in time | **retry** |
| **`429`** Too Many Requests | hit the rate limit | **Yes** — it opens once the window passes | **retry** |
| `5xx` | server-side error | Yes | retry |

`408` and `429` are **two items that negate themselves** within the status-code system. 4xx is the "fix the
request" family, yet these two alone need no fixing of the request and say **you can just wait.** `429` is a
code RFC 6585 added belatedly, and the spec document recommends using the `Retry-After` header with it. That is,
it is **the only 4xx where the server explicitly says "come again."**

So not treating these two codes as exceptions goes wrong in two directions.

- **Not retrying `429`** — the server said "come again shortly" and the client failed to take dictation. It
  reports a normal stream as a loss, and the verification tool **tells the deliverer of a fault they do not
  have.**
- **Retrying `404`** — the requests per lost segment triple. In a 27-episode batch, if the token expires and it
  all 404s, 12,000 becomes 36,000, and that is **amplification toward oneself.**

That the two errors' directions are opposite matters. One goes wrong by being lenient and one by being stingy.
You cannot fix both by having one classifier and moving the threshold — **you must read the per-code
semantics.**

### 8.2.3 Exponential backoff — a device that protects whom?

> **Term** — **exponential backoff**: a scheme that increases the retry interval exponentially in the attempt
> count. This code does `backoff × 2^(n−1)`, which at the default `backoff=0.8` is 0.8s → 1.6s
> ([`fetch.py:205-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L205-L206)).

Understand the purpose of widening the interval only as "to raise my request's success probability" and it is
half right. Exponential backoff has two beneficiaries.

| Beneficiary | What it gets | If you do not widen |
|---|---|---|
| **the client (me)** | gives time for a transient fault to pass | you use up all 3 attempts before the fault ends and confirm failure |
| **the server (the peer)** | the request rate on a faulting server decreases exponentially | **the fault calls up retries and retries grow the fault** |

The second row is the crux. The moment the server starts giving 5xx from overload, if all clients retry
immediately the request rate multiplies on the spot. This state is called a **retry storm**, and it turns an
originally recoverable fault into an unrecoverable one.

> **Exponential backoff is not courtesy but a stability device. And that stability is the peer system's and at
> the same time mine** — if the server dies, all my requests fail too.

This repository's backoff has **no jitter.** With no random wobble, it sleeps exactly 0.8 and 1.6 seconds.
Receive `429` on 8 parallel requests at once and 8 threads **wake at the same time and throw again at the same
time.** What this means is covered in §8.9 and §8.10.

---

## 8.3 Code ① — one lap of the retry loop

### 8.3.1 What is fixed before entering the loop

```python
# fetch.py:149-151
        headers = {**self.headers, **{k: v for k, v in (extra or {}).items()
                                      if k not in self.headers}}
        url = normalize_url(url)
```

The fact that `normalize_url` is **outside the loop** makes retry's premise. For a retry to be "sending the same
request again," the request line's byte sequence must be identical each attempt. Put normalization inside the
loop and the transform is re-applied each attempt, and with a possibly non-idempotent transform like
percent-encoding **the 2nd attempt's request could point at a different resource than the 1st.** That is the
path where `%20` becomes `%2520`.

As a side effect, the returned `FetchResult.url` ([`fetch.py:182`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L182)) is the string **after** normalization. It
means the address left in the report is the same as the address that actually went out on the wire, and without
this after-the-fact reproduction goes off.

### 8.3.2 The loop branches only three ways

![The three branches the retry loop takes when one attempt finishes](/images/lecture/hls-recon/08-retry-classification.svg)

*Figure 8-1 — the three branches the retry loop takes when one attempt finishes*

The condition that runs the classification is two lines.

```python
# fetch.py:199-201
                # 4xx gives the same result on retry (401/403/404 = token expiry·hotlink block)
                if 400 <= e.code < 500 and e.code not in (408, 429):
                    break
```

`break` is **discarding** the remaining attempts. The reason it is neither `continue` nor `return` is that after
exiting the loop it must merge into the common failure return of [`fetch.py:208-215`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L208-L215). Success `return`s
immediately inside the loop ([`fetch.py:181-195`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L181-L195)), and failure of every kind gathers at **one exit.** Because the
failure path is one, the shape of the failure record is always the same.

The figure is drawn as three branches, but the code has a fourth. Let me record the figure's simplification
precisely.

| Branch | Condition | Loop action | Anchor |
|---|---|---|---|
| success | response received + decompression succeeded | `return` (immediately) | [`fetch.py:181-195`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L181-L195) |
| body-decompression failure | exception during `Content-Encoding` decompression | `break` — no retry | [`fetch.py:177-180`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L177-L180) |
| permanent failure | 4xx except `408`·`429` | `break` — no retry | [`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201) |
| transient failure | 5xx · `408` · `429` · network exception | backoff then next attempt | [`fetch.py:202-206`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L202-L206) |

The second row is the branch not in the figure. It is the case where HTTP succeeded with 200 but the body cannot
be decompressed, and it `break`s on the judgment "the same server gives the same corrupted body again." Chapter 6
covered this decision in detail.

### 8.3.3 The last attempt that does not sleep

```python
# fetch.py:205-206
            if attempt < self.retries:
                time.sleep(self.backoff * (2 ** (attempt - 1)))
```

Without `if attempt < self.retries`, it sleeps 3.2 seconds (`0.8 × 2^2`) even after the last attempt and then
returns failure. A sleep no one is waiting on. In a situation where all 450 segments fail (server fault·timeout),
without this one line **450 meaningless waits** pile up.

Compute the worst-case duration of one request with the defaults ([`fetch.py:108-118`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L108-L118): `timeout=30.0`,
`retries=3`, `backoff=0.8`) and it is this.

| Attempt | Max duration | Wait after |
|---|---|---|
| 1st | 30.0s (`timeout`) | 0.8s |
| 2nd | 30.0s | 1.6s |
| 3rd | 30.0s | none |
| **sum** | **92.4s** | — |

This 92.4 seconds is **a computed upper bound, not a measurement.** But the very fact that the bound is this
size is design information. If all 450 segments time out, with 8 parallel the tool does not return for
`450 ÷ 8 × 92.4s ≈ 1.4 hours`. That this tool has no whole-job deadline surfaces here (§8.10).

### 8.3.4 `attempts` lies on the failure path

The success path and the failure path fill this field differently.

```python
# fetch.py:191
                        attempts=attempt,
```

```python
# fetch.py:208-212
        return FetchResult(
            url=url,
            ok=False,
            status=last_status,
            attempts=self.retries,
```

Success puts in the **attempt number that actually succeeded**, while failure puts in **`self.retries` (default
3) even in a case where it could not have retried.** A request that received a 404 and `break`ed on the 1st
attempt is also recorded as `attempts=3`. The requests that went out on the wire are 1.

The reason this breaks nothing now is that the consuming side counts only successes.

```python
# report.py:162
        retried = [f for f in fetches if f.ok and f.attempts > 1]
```

`f.ok and` in front means a failed request's inflated `attempts` does not reach the aggregation. **A state where
two pieces of code interlock by chance without knowing each other**, and the moment someone computes "total
requests = `sum(f.attempts)`" it goes quietly wrong. In Chapter 15's phrasing this too is close to an accidental
defense — the fault does not surface only because a filter elsewhere blocks it in front.

---

## 8.4 Principle ② — for a segment, order is content

### 8.4.1 Why you must not lose the order

In parallel receipt, result-order preservation is usually a "nice-to-have property." In this domain it is not.

As Chapter 19 covers, MPEG-TS is a **format closed under concatenation**, so joining segments byte-for-byte
makes a valid stream. That property makes reassembly a simple `concat` instead, but **for exactly that reason,
order becomes content.**

| Format property | What is gained | The price |
|---|---|---|
| closed under concatenation | no need to make a merger — `cat` suffices | join in the wrong order and it is **an equally valid stream** |

Here is the trap. A reassembled copy with scrambled order **does not break.** The file opens, the total playback
length matches, and the container check passes. Only the video is scrambled. It is the same family as Chapter
1's "the total length matches but the middle is empty" — **an error of a form the checker cannot catch.**

The actual consuming point takes this property as its premise.

```python
# cli.py:452
    for seg, res in zip(segs, results):
```

`zip` pairs **by position.** It applies `segs[3]`'s decryption key·sequence number·segment number to
`results[3]`'s body. Push the order one slot and in an AES-128 stream it **decrypts with the wrong IV**
(Part 5), and in a plaintext stream a quietly scrambled video comes out.

### 8.4.2 Completion order and submission order

> **Term** — **`as_completed`**: a function of `concurrent.futures`. It makes an iterator that yields the passed
> Futures one at a time **in completion order.** Unrelated to submission order.

There are at least four causes of completion order differing from submission order in parallel receipt — a
different size per segment, server-side cache hit or not, per-path congestion, thread-pool scheduling. None of
the four is controlled by the client.

![How to return completion order to input order in parallel receipt](/images/lecture/hls-recon/08-order-restore.svg)

*Figure 8-2 — how to return completion order to input order in parallel receipt*

The crux is **deciding the slot not at arrival time but at submission time.** Make the result array in advance
with `[None] * len(items)` and each result goes into the slot of "in what position was it submitted,"
regardless of "in what position did it arrive." Since the arrival time is **a structure not input to the slot
assignment**, the result is the same even if the order is inverted.

---

## 8.5 Code ② — `get_many` and measurement

### 8.5.1 Submission — why the map's key is a Future

```python
# fetch.py:230-234
        results: list[FetchResult | None] = [None] * len(items)
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            futures = {
                pool.submit(self.get, url, rng): i for i, (url, rng) in enumerate(items)
            }
```

`futures` is `{Future object: index}`. The natural-looking alternative `{URL: index}` **necessarily breaks** in
this repository.

An `EXT-X-BYTERANGE` playlist takes byte spans within one file as segments. The `Segment`s the parser makes all
have the same `uri` and differ only in `byterange` ([`playlist.py:236-247`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/playlist.py#L236-L247)). So the work list [`cli.py:423`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L423)
makes looks like this.

```
items = [("…/all.ts", (188000, 0)),
         ("…/all.ts", (188000, 188000)),
         ("…/all.ts", (188000, 376000)), …]
```

Take the URL as the key and the three items collapse into one and **two indices disappear.** A Future object is
hashed by identity, so different requests of the same URL never collide. The URL normalization Chapter 7 covers
is also harmless in this respect — even if normalization makes two addresses the same string, the keys are still
different Futures.

### 8.5.2 Harvest — returning to the index

```python
# fetch.py:236-243
            for fut in as_completed(futures):
                i = futures[fut]
                res = fut.result()
                results[i] = res
                done += 1
                if on_done:
                    on_done(done, res)
        return [r for r in results if r is not None]
```

Three things to read.

**(1) `i = futures[fut]` is the whole of the restoration.** It looks up the completed Future by key to take out
the index at submission time. Without this one line it becomes `results.append(res)`, and the moment it does,
the result array is filled in completion order.

**(2) Progress is counted in completion order, and results are piled in submission order.** `done` increments by
1 on each arrival and is handed to `on_done(done, res)` ([`cli.py:426-431`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L426-L431)'s `tick`). **That progress and result
order use different axes** summarizes this function's structure — what is visible to the user is "how many
arrived," and what goes to the next stage is "which segment number."

**(3) The last line's `None` filter is a dangerous residue.** `as_completed` yields every passed Future, so on
the normal path no `None` can remain in `results`. But if one did — the return list's **length shrinks**, and
[`cli.py:452`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L452)'s `zip` **continues quietly, pushed one slot from that point.** No one notices the pairing went off.

To write it in a form that reports the same situation, it should be an assertion, not a filter. Filter it out and
the loss appears as a **length decrease**; assert and it appears as an **immediate stop.** In a verification tool
the latter is correct — the same form as Chapter 34's oracle problem.

### 8.5.3 Measurement — even with the order fully inverted, the result is the same

The result of reproducing Figure 8-2's situation locally. Reproducible with no external server, using only the
standard library.

**Setup** — serve `seg0.ts` … `seg7.ts` with `ThreadingHTTPServer`, having the handler sleep `0.10 × (7 − i)`
seconds. `seg0` is slowest and `seg7` fastest. With `jobs=8`, 8 requests go out at once.

```python
# experiment code (outside this repository) — the handler's key line
        time.sleep(0.10 * (N - 1 - i))   # seg0 is slowest
```

```
completion (arrival) order : 7 6 5 4 3 2 1 0
return order               : 0 1 2 3 4 5 6 7
body check                 : seg0 seg1 seg2 seg3 seg4 seg5 seg6 seg7
elapsed 0.73s (serial would be 2.80s+)
```

Repeated 3 times with the same result. Two things to read.

- **The arrival order is a complete inversion but the return order is exactly the input order.** It even
  confirmed the body, cross-checking that `results[3]` really contains `seg3`'s bytes — to rule out the case
  where the index is right but the content is pushed.
- **Elapsed 0.73 seconds.** Received serially, the sleep time alone is `0.0+0.1+…+0.7 = 2.80 seconds`.
  Parallelization pressed the whole thing down to the slowest single one (0.7 seconds).

The second item leads to §8.6. **A parallel batch's completion time is decided not by the mean but by the worst
single one.**

---

## 8.6 Principle ③ — what the mean hides

### 8.6.1 In a fan-out job the tail decides everything

Segment receipt is a job where partial success is meaningless. Receive 449 of 450 and the video is not
completed. In such an **all-or-nothing parallel job** the batch's completion time is decided not by the mean
latency but by **the slowest request.**

Seen arithmetically, it is this. When the probability that some request is in the "slowest 5%" is 0.05, the
probability that at least one of a bundle throwing 8 at once is in that 5% is

```
1 − 0.95^8 = 1 − 0.6634 = 0.3366
```

**A third of each bundle meets the tail.** Split 450 into bundles of 8 and it is 56 bundles, and the expected
number meeting the tail is 19 bundles. However low the mean latency, the whole batch waits out all 19 of these
tails.

> **Term** — **tail latency**: the slow responses corresponding to the upper percentiles (p95·p99, etc.) of the
> latency distribution. The larger the scale, the more the latency users actually experience converges here
> rather than to the mean. The classic that organized this phenomenon is Dean and Barroso's "The Tail at
> Scale" (CACM, 2013).

### 8.6.2 The mean resembles no actual response

![The result of seeing 20 segments' TTFB by the three metrics mean·p50·p95](/images/lecture/hls-recon/08-tail-latency.svg)

*Figure 8-3 — the result of seeing 20 segments' TTFB by the three metrics mean·p50·p95*

**This sample is not a measurement but a constructed example.** But this repository's `_quantile` was actually
run on this sample to cross-check the figure's numbers. The sample and result are as follows.

```
20 samples (ms)
41 44 45 47 48 49 50 52 53 55 56 58 60 62 65 70 72 75 2900 5200

mean                    455.1      ← 18 are 41~75ms but the mean is 8× that
_quantile(v, 0.50)       56        ← idx = round(0.50 × 19) = 10
_quantile(v, 0.95)     2900        ← idx = round(0.95 × 19) = 18
max                    5200
```

The mean 455ms **resembles none of the 20 samples.** It differs from the 18 in the 41ms range and from the 2 at
2900ms·5200ms. What the mean does is mix the two groups to make a single non-existent value.

This is why this tool does not use the mean. A verification report must answer two questions, and the mean
answers neither.

| Question | The metric that answers | Why the mean cannot answer |
|---|---|---|
| how fast is this delivery **usually** | **p50** (median) | it is dragged 8× by the 2 outliers |
| how slow is this delivery **occasionally** | **p95** | it dissolves the outliers into the mean and erases them |

---

## 8.7 Code ③ — `_quantile` and the transport-layer verdict

### 8.7.1 A quantile is nearest-rank, not interpolation

```python
# report.py:56-61
def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, int(round(q * (len(s) - 1))))
    return s[idx]
```

Six lines with four decisions in them.

| Line | Decision | Had it been the alternative |
|---|---|---|
| `if not values: return 0.0` | give 0 for an empty sample | throw an exception and report generation halts on the 0-segment path |
| `s = sorted(values)` | sort per call | p50·p95 are each called, so the same list is sorted twice |
| `int(round(...))` | **nearest-rank** — no interpolation | with linear interpolation a value not in the sample comes out |
| `min(len(s) - 1, ...)` | fix the index upper bound | at `q=1.0` it goes out of range |

> **Term** — **nearest-rank**: a scheme of picking one element from the sorted sample as the quantile. It has
> the property that the return value **is necessarily an actual observation.**
> **linear interpolation**: a scheme of computing proportionally between two neighboring elements. The default
> behavior of NumPy's `percentile` and Python's `statistics.quantiles`. The return value may not be an actual
> observation.

The third line is this section's main point. **Which scheme you use flips the verdict on the same sample.**

### 8.7.2 A measurement where the scheme flips the verdict

The result of applying both schemes to §8.6.2's sample. The threshold is [`report.py:187`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L187)'s 3000ms.

| Computation scheme | p50 | p95 | `p95 > 3000` | Verdict |
|---|---|---|---|---|
| this code (nearest-rank) | 56 | **2900** | false | **PASS** |
| linear interpolation (NumPy default) | 55.5 | **3015.0** | true | **WARN** |

**Same sample, same threshold, opposite verdict.** The source of the difference is simple. Nearest-rank puts out
the actual observation `s[18] = 2900` as is, and linear interpolation computes the 5% point between `s[18]` and
`s[19]` to make `2900 + 0.05 × (5200 − 2900) = 3015`. The delay 3015ms **was observed in no request.**

Here comes this section's proposition.

> **Before setting a threshold you must first set the definition of the statistic to be compared against it.**
> "warn if p95 exceeds 3 seconds" is not a complete rule unless it states p95's computation scheme.

Chapter 22 covers that this threshold `3000` has no basis. This section adds one more layer on top — **a
baseless threshold, and the definition of the comparison target is not even documented.**

### 8.7.3 With a small sample, p95 is not a percentile

Compute the index formula `round(0.95 × (n − 1))` directly and on a small sample the metric changes its
character.

| Sample count n | p95 index | max index | p95 = max? |
|---|---|---|---|
| 5 | 4 | 4 | **Yes** |
| 10 | 9 | 9 | **Yes** |
| 11 | 10 | 10 | **Yes** |
| 12 | 10 | 11 | No |
| 20 | 18 | 19 | No |

**If the sample is 11 or fewer, "p95" is the max.** In a sample run receiving only the first few with `--limit`
or on a short stream, this metric becomes "the one slowest time," and if the server exceeds 3 seconds just once,
a WARN appears. A metric meant to see the tail changes its character into an **outlier metric** on a small
sample. Chapter 22 covers the same fact from a threshold-design view.

p50 has one lesser-known property too. `round` is **round-half-to-even** in Python 3, so when the sample count is
even, which of the two medians it picks alternates by n.

| n | `0.5 × (n−1)` | `round` result | which side chosen |
|---|---|---|---|
| 2 | 0.5 | 0 | lower |
| 4 | 1.5 | 2 | upper |
| 6 | 2.5 | 2 | lower |
| 8 | 3.5 | 4 | upper |

That is, this function's `q=0.5` is **not the usual median that averages the two medians.** It can differ in
value from `statistics.median` (56 vs 55.5 on §8.7.2's sample). At the measurement-report level there is no
impact, but when reusing this function elsewhere you must know it.

### 8.7.4 Transport-layer verdict — what is converted into what

[`report.py:160-230`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L160-L230) is the whole stretch that turns measurements into verdicts. First, aggregation.

```python
# report.py:161-165
        failed = [f for f in fetches if not f.ok]
        retried = [f for f in fetches if f.ok and f.attempts > 1]
        ttfb = [f.ttfb_ms for f in fetches if f.ok]
        tput = [f.throughput_mbps for f in fetches if f.ok and f.throughput_mbps]
        total_bytes = sum(f.size for f in fetches)
```

Note that all four lists split on the basis of `f.ok` (§8.7.5). The verdict is three-way.

| Condition | Verdict | Basis |
|---|---|---|
| there is at least one `failed` | **FAIL** | a loss interval appears in the reassembled output |
| all succeeded but there were retries | **WARN** | the result is intact but the delivery side was unstable |
| all succeeded on the first try | PASS | — |

The middle row is the worth of an instrumented fetcher. **A failure recovered by retry leaves no trace in the
final output.** Look at the file alone and it is normal, and if the fetcher does not count it, that instability
is observed never. It is the same idea as Chapter 36's control-group design — what a tool catches is decided by
what the tool counts.

The latency verdict is one line.

```python
# report.py:185-189
        rep.add(
            "response latency",
            WARN if _quantile(ttfb, 0.95) > 3000 else PASS,
            f"TTFB p50 {_quantile(ttfb, 0.5):.0f}ms / p95 {_quantile(ttfb, 0.95):.0f}ms, "
            f"throughput median {_quantile(tput, 0.5):.1f} Mbps"
```

**What it uses for the verdict is p95 alone, and p50 is only displayed.** And throughput, conversely, uses only
p50. This asymmetry has a reason.

| Metric | Quantile used | Why |
|---|---|---|
| TTFB (latency) | **p95** | the bad side is a large value. the tail is on top |
| throughput | **p50** | the bad side is a small value. to see the tail it should be p5, but this code only displays the representative value |

Throughput's tail (the slow side) **does not appear** in this report. There is only a representative display
value and no verdict. Whether it is an intentional omission or a miss cannot be judged from the code.

Finally, the measurements remain machine-readable.

```python
# report.py:227-229
            "ttfb_ms_p50": round(_quantile(ttfb, 0.5), 1),
            "ttfb_ms_p95": round(_quantile(ttfb, 0.95), 1),
            "throughput_mbps_p50": round(_quantile(tput, 0.5), 2),
```

What is not here matters — **the sample count of the quantiles is not there in itself.** `ttfb`'s sample count
comes out only by subtracting `"failed"` from `"segments"` ([`report.py:221-222`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L221-L222)), and `tput` cannot even be
traced back because successful requests with 0 throughput are also excluded. As seen in §8.7.3, without knowing
the sample count you cannot interpret `ttfb_ms_p95`, yet that count does not remain beside the quantile.

### 8.7.5 The measurement's blind spot — the time this metric cannot see

Confirm `ttfb_ms`'s measurement span in the code and three blind spots surface.

```python
# fetch.py:168-171
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    ttfb = (time.perf_counter() - t0) * 1000
```

**(1) `t0` is reset each attempt.** The `ttfb_ms` of a request that succeeded on the 3rd attempt is the value of
the 3rd only. The two prior timeouts (up to 60 seconds) and backoff waits (2.4 seconds) **remain in no
measurement.** The actual time that request experienced is indicated only indirectly by the fact `attempts > 1`.

**(2) Failed requests are not in the latency statistics at all.** Since the `ttfb` list is filtered by `if f.ok`
([`report.py:163`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L163)), **the requests that took longest are excluded from the sample for exactly that reason.** A
request that timed out at 90 seconds moves the latency metric not at all. Fortunately in that case "segment
receipt" is FAIL so the overall verdict comes out as a failure, but the **number `ttfb_ms_p95` itself is biased
optimistically.**

**(3) `ttfb` is not the server processing time.** Since `t0` is **before** the `urlopen` call, DNS lookup·TCP
connection·TLS negotiation are all included. Moreover urllib's default opener auto-follows 3xx, so **the whole
redirect chain is folded into one TTFB.** On a delivery where a signed URL is issued via a redirect, even if
this value grows, you cannot tell whether the server is slow or the hops are many.

Written in one line, the common form of the three items is this.

> **A measurement's name does not tell you the measurement's definition.** The name `ttfb_ms` does not tell you
> that this value is of the last attempt, of a successful request, including redirects.

---

## 8.8 Generalization — the form the three decisions take elsewhere

### 8.8.1 Retry classification

Every system doing the same classification is answering the same question, "does it change if done again."

| Domain | A failure that could differ if done again | A failure the same however you redo it |
|---|---|---|
| HTTP client (this code) | 5xx · `408` · `429` · connection error | `400` · `401` · `403` · `404` |
| message queue | a consumer-side transient error → requeue | a malformed message → dead-letter queue |
| relational DB | serialization failure · deadlock | constraint violation |
| gRPC | `UNAVAILABLE` · `RESOURCE_EXHAUSTED` | `INVALID_ARGUMENT` · `PERMISSION_DENIED` |
| POSIX syscall | `EINTR` · `EAGAIN` | `ENOENT` · `EACCES` |

The last row shows this classification is older than HTTP. `EINTR` (interruption by a signal) is the archetype of
"just call it again," and code that did not retry it was a class of old Unix bugs.

**That you cannot infer the rest from one domain must be seen together.** Which error is transient depends on that
system's semantics, and the list can be made only by reading the spec document. That this code hardcoded the
exception handling of `408`·`429` ([`fetch.py:200`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200)) is a result of **that list being a property that can only be
enumerated, not derived.**

### 8.8.2 Order restoration

| Domain | Where the order gets scrambled | The device that returns the order |
|---|---|---|
| this code | `as_completed`'s completion order | the index held at submission time |
| TCP | packet arrival order | sequence number |
| MapReduce | reducer completion order | partition number |
| batch API | response arrival order | a correlation id attached per request |
| JavaScript | Promise fulfillment order | `Promise.all` sorts by input-array order |

Written in one sentence, the principle the five rows share is this.

> **To preserve order you must carry order in the data.** A system that uses arrival order as the order goes wrong
> the moment it is parallelized. TCP's sequence number already solved this problem this way in the 1970s.

### 8.8.3 Quantiles

| Domain | What the mean hides |
|---|---|
| web-service SLO | p99 latency — even at a mean of 100ms, if 1% is 5 seconds then 1% of users cannot use the service |
| garbage collection | the mean pause is short, and what drops a frame is the max pause |
| storage | the tail of queue wait hidden behind mean IOPS |
| this code | one segment's 5.2 seconds dissolves and vanishes inside a mean of 455ms |

And §8.7.2 adds one more. **Switching to a quantile is not enough; you must also report that quantile's
computation scheme and sample count.** Because the scheme flips the verdict (2900 vs 3015), and the sample count
changes the metric's character (if n ≤ 11, p95 = max).

---

## 8.9 Security·ethics — parallelism is a load left on the peer system

### 8.9.1 What the client's choice looks like in server logs

So far the three decisions were seen from the view of "how fast·accurately do I receive." See the same decisions
in server logs and they become something else.

| Client-side decision | What is visible on the server side | The judgment the server makes |
|---|---|---|
| 8 concurrent (`--jobs 8`) | tens per second from one IP, sequential segment numbers | not a player a person uses |
| 64 concurrent | as above but tens of times the bandwidth of normal viewing | anomalous traffic · rate-limit target |
| retry a 4xx | the same 404 three in a row | bot · scanner |
| ignore `429` and continue | a request rate maintained despite a limit notice | **block** |

A browser player prefetches only **as much as it needs to play.** A player buffering 30 seconds ahead requests a
segment about once per 6 seconds. A client that receives everything with 8 parallel makes **tens of times the
request rate for the same resource**, and that difference is not erased by forging any header. The `Referer`
disguise Chapter 9 covers changes "who," but **cannot change "how much you request."**

> **Behavior is harder to forge than a header.** Identity disguise is one line of a string, but request-rate
> disguise requires actually giving up speed.

### 8.9.2 Unlimited parallelism becomes an unintended denial of service

`--jobs` has no upper bound.

```python
# cli.py:1061
    ap.add_argument("--jobs", type=int, default=8, help="number of concurrent downloads (default 8)")
```

With only `type=int`, put in `--jobs 500` and `ThreadPoolExecutor(max_workers=500)` is made as is. Run a
27-episode batch that way and 500 parallel connections are maintained to one origin. The result is the same even
with no malice — **on a small-scale delivery server this is a denial of service.**

> **Term** — **denial of service**: a state where normal users cannot use the service. **Attack intent is not in
> the definition.** If availability collapses under load, whatever the cause, it is a denial of service.

The default 8 is a policy choice in this respect. The basis is not written in the code, but it is worth noting
that it is the same order of magnitude as the concurrent connections a browser maintains per origin (about 6 in
HTTP/1.1 practice). **Setting the default to a normal client's order of magnitude is itself defensive design.**

### 8.9.3 What respecting `429` actually means

This code puts `429` among the retry targets, keeping the spec ([`fetch.py:200`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200)). But **evaluated honestly, the
level of respect is half.**

| What the spec·practice expects | What this code does | The gap |
|---|---|---|
| wait for the time the `Retry-After` header specifies | it does not read the header and sleeps 0.8s·1.6s | even if the server says "in 60 seconds," it goes again after 0.8 |
| when hitting a rate limit, **lower concurrency** | only that one request sleeps | the other 7 threads keep throwing as is |
| scatter the retry times (jitter) | fixed interval | 8 wake at the same time and throw at the same time |

All three lines are faults in the same direction. **It treats `429` as an individual request's problem and not
as the whole batch's problem.** A rate limit is originally a signal on the whole client, not one connection, but
in this structure that signal is trapped inside one thread.

The correct form is for the fetcher to have **shared state** — see `429` once and lower the whole concurrency
(additive-increase·multiplicative-decrease), mix in jitter, read `Retry-After` and wait that long. This
repository has no such structure. Recorded as open in §8.10.

### 8.9.4 The defender's view

To not explain bypass and stop, see the same point from the server·platform side.

| Role | What to do |
|---|---|
| **delivery-server operator** | use the **accurate status code** for a rate limit. a client that handles `429` properly lowers concurrency and waits for `Retry-After`, but receive a `503` and it reads it as a transient fault and **retries at the same rate.** this code does not distinguish the two ([`fetch.py:200`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L200) puts both 5xx and `429` among retry targets) so that difference does not surface. choosing the status code accurately is the server's own defense |
| **the same operator** | always attach `Retry-After` to a `429`. do not attach it and the client guesses with its own constant, usually waiting much shorter than the server wanted |
| **CDN·infrastructure** | apply the rate limit by **concurrent connections** too, not only request count. with only a request-rate limit you cannot stop a client that raises parallelism to receive the same amount in the same time |
| **platform security** | base bot determination on **behavior metrics** (request rate, sequential access pattern, full receipt with no buffering), not headers. a header is a string per §8.9.1, and behavior is a cost |
| **client implementer** | add global concurrency control and jitter. put a **retry budget** on retries — e.g., "do not spend more than 10% of total requests on retries." without a budget, on a fault retries dominate the whole traffic |
| **auditor** | when approving an automation tool, look at the **default concurrency and retry policy** together. the two values are the maximum load that tool will leave on the peer system |

Let me point at the first row's paradox once more. **A server that uses `429` receives more requests from this
client than a server that uses `403`.** Because `403` is an immediate halt and `429` is a retry. It is a
structure where a server accurately following the spec receives more load, and this is not the spec being wrong
but **the result of a client that does not read `Retry-After` implementing only half the spec.**

---

## 8.10 Limits and open questions

Noted honestly. Distinguishing what was confirmed, what stopped at computation, and what could not be confirmed.

**What was measured**

- §8.5.3's order-restoration measurement was reproduced 3 times with a local `ThreadingHTTPServer`. When the
  completion order was a complete inversion, both the return order and the body matched the input order.
- §8.7.2's comparison of the two computation schemes (2900 vs 3015.0) was obtained by actually applying both
  schemes to a constructed sample. That the verdict splits was also confirmed by direct comparison with the
  threshold 3000.
- §8.7.3's index table was obtained by computing `round(0.95 × (n − 1))` for n=1..24.

**What was computed but not measured**

- §8.3.3's worst 92.4 seconds per request and 1.4 hours per batch are an **upper bound** derived from the
  defaults. It was not actually measured by inducing timeouts.
- §8.6.1's `1 − 0.95^8 = 0.337` is a computation on the assumption that each request's delay is independent. Real
  segment delays share the same server·same path so there is **positive correlation**, and then this probability
  is an overestimate. The correlation was not measured.

**What could not be confirmed or is not in this repository**

- **It does not read `Retry-After`.** [`fetch.py:196-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L196-L201) takes only `Access-Control-Allow-Origin` out of
  `e.headers`. The wait time `429`·`503` specified is discarded.
- **There is no jitter and no global rate control.** All three items of §8.9.3 are unimplemented. Whether
  synchronized retries actually happen when 8 parallel receive `429` at once was not reproduced — it was only
  read to be so from the code structure.
- **There is no whole-job deadline.** There is a `timeout` for one request but no upper bound for the whole
  batch. On mass timeout the user cannot know when the tool will finish.
- **The push `get_many`'s `None` filter could induce (§8.5.2) looks unreachable in the current code, but its
  unreachability was not proven.** If `fut.result()` throws an exception the whole batch halts, so the path that
  returns a partially filled array was not confirmed. But "safe now" and "designed safely" are different.
- **The sample count is not beside the quantile.** To interpret `ttfb_ms_p95` you need the sample count (it is
  not beside [`report.py:227-229`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L227-L229) and comes out only by subtracting `"failed"` from `"segments"`), and whether
  this is intentional or a miss cannot be judged from the code.
- **It does not see throughput's tail.** `tput` computes only p50 and has no verdict (§8.7.4). The slow-side tail
  appears nowhere in the report.
- **Figure 8-3's sample is not a measurement.** It is a constructed example, and it only confirmed that running
  `_quantile` on that sample equals the figure's numbers. Whether a real delivery's TTFB distribution is this
  shape cannot be said with this repository's data.

---

## 8.11 Summary

1. **Retry is not a performance optimization but a classification problem.** The criterion is not "did it fail"
   but **"send the same request again and could a different answer come,"** and idempotency is a necessary
   condition while time-dependence is the judgment criterion.
2. A 4xx has the same answer unless you fix the request, so halt immediately. The reason **only `408`·`429` are
   exceptions** is that these two are 4xx that mean not "fix the request" but **"wait and come again"**
   ([`fetch.py:199-201`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L199-L201)).
3. **Exponential backoff is not courtesy but a stability device.** It blocks a retry storm where retries grow the
   fault, and that stability is the server's and at the same time the client's.
4. In parallel receipt, **order must be carried in the data.** Since `as_completed` yields in completion order,
   `{Future: index}` looks up the submission-time slot. With the URL as key, `EXT-X-BYTERANGE` segments collapse.
   In measurement, even with a complete inversion of arrival, the return order and body were preserved.
5. **A reassembled copy that lost its order does not break.** MPEG-TS being closed under concatenation, scrambled
   it is still a valid stream and the total length matches too. So order preservation is not convenience but
   correctness.
6. **The mean hides tail latency.** On a constructed 20-sample set the mean 455ms resembles no actual response.
   An all-or-nothing parallel job's completion time is decided not by the mean but by the worst single one.
7. `_quantile` is **nearest-rank** and does not interpolate. On the same sample·same threshold 3000ms,
   nearest-rank gives 2900 (PASS) and linear interpolation gives 3015.0 (WARN) — **the computation scheme flips
   the verdict.** Before setting a threshold you must set the statistic's definition.
8. **If the sample is 11 or fewer, p95 is the max.** The metric's character changes with the sample count, yet
   the report JSON has no such sample count beside the quantile.
9. Measurement has blind spots — **the prior-attempt time of a retry-recovered request, a failed request's
   delay, redirect hops** all do not appear in `ttfb_ms` or are folded into one.
10. **Parallelism and retry are a load left on the peer system.** A header can be forged but a request rate, to
    forge, requires actually giving up speed. Unlimited parallelism becomes a denial of service without malice,
    and respecting `429` is spec compliance and a defense of the peer system. But this code's respect is half —
    it does not read `Retry-After` and does not lower global concurrency.

---

**Next chapter** — Part 2 followed what HTTP does not guarantee. Not integrity, not the meaning of status codes,
not the negotiation result, not the identity of an address. Part 3 goes one step further and covers the way HTTP
does not guarantee **access control.** Chapter 9, as its first case, dissects hotlink blocking, which puts access
permission on a single `Referer` header — can access be controlled by a value the client self-reported, and what
does that control actually block?
