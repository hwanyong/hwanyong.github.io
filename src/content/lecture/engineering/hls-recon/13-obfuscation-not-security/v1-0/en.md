---
title: "Obfuscation Is Not Security"
description: "Packed JS and the trust boundary"
date: 2026-06-17
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-13-obfuscation-not-security.svg
---
## 13.0 What this chapter answers

1. What is the player page's `eval(function(p,a,c,k,e,d){…})` — encryption or compression?
2. What is the procedure to reverse it, and why does Python's `int(x, base)` not work?
3. If you remove one regex flag (`re.ASCII`), what quietly breaks?
4. **What does the decision to only parse and not execute a script received from remote buy?**
5. Is obfuscation a security control — if not, what should it be booked as?

The fourth is this chapter's center. The first three are preparation to understand that decision, and the
fifth is the story of the person on the opposite side of that decision — **the side that deploys the
obfuscation.**

---

## 13.1 The problem — the name to save is inside one layer of script

In Chapter 9 we confirmed the four-stage request chain to open one episode. What is received at stage 2 of
that chain is the player page's HTML. Inside it is a script of this shape.

```
<script>eval(function(p,a,c,k,e,d){e=function(c){return(c<a?'':e(parseInt(c/a)))+
((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))};…}('0 1 = 2 3({"4":"1",
"5":"6://7.8/9/a/b.c","d":"그렌라간e.f"});',62,16,'var|player|new|Playerjs|id|
file|https|cdn|example|hls|abc|master|m3u8|title|01|mkv'.split('|'),0,{}))</script>
```

Unreadable. And yet inside it is one value this repository needs — **the official filename the site set.**

```python
# series.py:303-309
def _name_of(settings: str, episode: Episode, width: int) -> str:
    """The filename to save (no extension).

    The player settings' `title` is the official name the site set (`그렌라간01.mkv`).
    The subtitle file is placed by the same name, so following this name keeps the pair matched.
    Fall back to the list's title only when the settings could not be read.
    """
```

Why cut out this value rather than use the title in the list? **Because the subtitle file is placed by the
same name.** If the video's and subtitle's names go off, the player cannot find the pair. That is, this value
is not one file's name but **the key that binds the video·subtitle pair.**

Here a fork arises. That script must be reversed, and there are two ways.

| Way | What it does | What it needs |
|---|---|---|
| **A. execute it** | hand it to a JS engine and `eval` it and read the result | an executor like Node.js · `js2py` · `PyExecJS` |
| **B. parse it** | figure out the compression rule and reverse it by string substitution | a regex and one table |

A is overwhelmingly easier. It takes one line. This repository chose B, and the basis for that choice is this
chapter's subject. First confirm **that it can be reversed.**

---

## 13.2 The principle — dictionary compression, not encryption

### 13.2.1 The name for what it is

> **Term** — **packed JS**: a format that substitutes JavaScript source with a word dictionary + indices to
> shrink the size, then bundles it with a restore function into one line handed to `eval`. The most widely
> used implementation is the **Dean Edwards Packer**, also called the `p,a,c,k,e,d` packer after the restore
> function's argument names.

> **Term** — **dictionary compression**: a compression method that stores a repeated piece from the input in
> a dictionary once and, in the body, points at that dictionary's position (index) to shrink the total
> length. The LZ78 family is representative, and packed JS uses that idea at the word level.

> **Term** — **radix notation**: writing an integer as a sum of powers of a base `b`. Each digit is assigned a
> symbol from the range `0 … b−1`. Decimal's `0-9` and hex's `0-9 a-f` are special cases of the same rule.

### 13.2.2 The structure of the compression

What the compressing side does is three steps.

1. Cut the source into words (`\b\w+\b`).
2. Make a word dictionary in first-appearance order — `var`, `player`, `new`, `Playerjs`, …
3. Replace each word in the body with **the radix notation of its dictionary index.**

In the earlier example `var` is dictionary #0 so `0`, `player` is #1 so `1`, `title` is #13 so `d` (13 written
in base 62), `01` is #14 so `e`. The result is this.

```
original : var player = new Playerjs({"id":"player", … "title":"그렌라간01.mkv"});
body     : 0 1 = 2 3({"4":"1", … "d":"그렌라간e.f"});
dict     : var|player|new|Playerjs|id|file|https|cdn|example|hls|abc|master|m3u8|title|01|mkv
```

**The dictionary comes carried along with the body.** This one sentence determines the whole next section.

![The four parts of a packed JS call and the four steps of the restore procedure](/images/lecture/hls-recon/13-unpack-anatomy.svg)

*Figure 13-1 — the four parts of a packed JS call and the four steps of the restore procedure*

The reversing side just retraces the figure's ①–④ in reverse. There is not a single piece of new information
to figure out — the base, the dictionary, and the body are all inside the same string.

### 13.2.3 Why you cannot use `int(x, base)`

Step ② is "read the letter `e` as one base-62 digit to get 14." Python already has such a function.

```
>>> int("e", 36)
14
```

But packed JS's base is usually 62. If the dictionary words exceed 36, base 36 cannot fit them in one digit so
the notation gets longer and the compression ratio drops. So the packer mobilizes uppercase letters as digits
too and uses base 62. At that moment the standard library cuts off.

```
>>> int("e", 62)
ValueError: int() base must be >= 2 and <= 36, or 0
```

> **The upper bound of Python `int(x, base)`'s base is 36.** `0-9` and case-insensitive `a-z` make 36 the
> limit, and the standard does not define digit symbols beyond that.

The reason the bound is 36 is not arbitrary. To go to 37 or more you must distinguish case, and then it
conflicts with the convention that `int("A", 16)` gives 10 as it does now. The standard chose **the side that
treats case as the same**, and at the price stopped at 36.

Therefore to read base 62 there is **no choice but to keep a digit table yourself.** With the table the
conversion is elementary — `n = n × base + digit value` per digit.

### 13.2.4 This is not encryption

The criterion that divides encryption and compression is not the appearance but **where the information needed
to restore is.**

| | dictionary compression (packed JS) | symmetric encryption (AES-128) |
|---|---|---|
| What is needed to restore | the base + the dictionary | the key |
| Where it is | **inside the same string** | a separate channel (`EXT-X-KEY` URI) |
| What the other party does not know | nothing | the key |
| The cost of reversing | notation conversion — proportional to input length | 2¹²⁸ attempts without the key |
| The condition it cannot be reversed | only when the format is unknown | when the key is unknown |

The last row is the crux. The only thing packed JS resists is **a party that does not know the format.** But
that format is public, and above all **every browser must know it** — not knowing it, the site does not work.
The argument we will meet again over AES-128 in Chapter 25 first appears here.

---

## 13.3 The code — `unpack`, line by line

### 13.3.1 The whole

```python
# series.py:224-255
def unpack(text: str) -> str:
    """Reverse packed JS (`eval(function(p,a,c,k,e,d){…})`) to the original source.

    The player settings are inside this compression. The compression gathers frequent words into
    a dictionary and references the dictionary number in the body by radix notation, so turning the
    number back into a word gives the original. Since the base exceeds 36 (usually 62), Python
    `int(x, base)` cannot be used and a digit table is kept directly.

    If it cannot be reversed, give an empty string — do not execute, only read.
    """
    m = _PACKED_RE.search(text)
    if not m:
        return ""
    payload, base = m.group("payload"), int(m.group("base"))
    words = m.group("words").split("|")

    def decode(token: str) -> int | None:
        n = 0
        for ch in token:
            i = _ALPHABET.find(ch)
            if i < 0 or i >= base:
                return None
            n = n * base + i
        return n

    def swap(mo: re.Match[str]) -> str:
        i = decode(mo.group(0))
        return words[i] if i is not None and i < len(words) and words[i] else mo.group(0)

    # a dictionary reference is an ASCII word. Python's default \w includes Korean too, so bind to ASCII.
    out = re.sub(r"\b\w+\b", swap, payload, flags=re.ASCII)
    return out.replace("\\/", "/")
```

Thirty-two lines. Of them the actual restore logic is `decode`'s seven lines, `swap`'s two lines, and the last
`re.sub`'s one line — **ten lines.**

### 13.3.2 The regex that catches the format

```python
# series.py:218
_PACKED_RE = re.compile(r"}\('(?P<payload>.*?)',(?P<base>\d+),\d+,'(?P<words>.*?)'\.split\('\|'\)", re.S)
```

```python
# series.py:221
_ALPHABET = string.digits + string.ascii_lowercase + string.ascii_uppercase
```

The spot the regex catches on is the `}(` where the function body ends and **the call begins.** After it come
four values in order.

| Capture | The packer's argument | Does this code use it? |
|---|---|---|
| `payload` | `p` — the body substituted with indices | uses |
| `base` | `a` — the base | uses (`int(...)`) |
| `\d+` (unnamed) | `c` — the dictionary size | **does not use** |
| `words` | `k` — the dictionary joined by `'\|'` | uses |

Letting `c` (the dictionary size) pass unnamed is a small design judgment. **Instead of trusting the
self-reported count, it checks the boundary with the actual dictionary length (`len(words)`)** (`swap`'s `i <
len(words)`). On an input where the declared length and the actual length go off, there is no path at all for
the index to go out of range. "A self-reported value is not a basis for judgment" seen in Chapter 5 applies
here too.

`_ALPHABET` is `0-9`, `a-z`, `A-Z` in order. **Different from base64's alphabet order (`A-Za-z0-9+/`).**
Because the packer makes under-36 with `toString(36)` and 36-and-above with a character-code computation, this
order results. Get the order wrong and the restore does not fail but **quietly changes into a wrong word** —
the kind of error hardest to detect.

### 13.3.3 `re.ASCII` — what one flag erases

```python
# series.py:253-254
    # a dictionary reference is an ASCII word. Python's default \w includes Korean too, so bind to ASCII.
    out = re.sub(r"\b\w+\b", swap, payload, flags=re.ASCII)
```

This one line is the most practical part of this chapter. The reason is **you must cut by the same rule as the
side that compressed.**

JavaScript's `\w` is always `[A-Za-z0-9_]` — ASCII only. Python 3's `\w`, by contrast, **is Unicode by
default**, including Korean·Chinese·Cyrillic characters. That is, the two languages' `\b\w+\b` **cut the same
string at different places.**

See what happens on a body fragment with a Korean title.

![The same regex cuts at two places](/images/lecture/hls-recon/13-token-boundary.svg)

*Figure 13-2 — the same regex cuts at two places — one flag erases the episode number*

The packer, by the JS rule, cut `그렌라간01` into `그렌라간` + `01` and changed only `01` to the index `e`. On
reversing, use Python's default rule and `그렌라간e` becomes **one lump token**, and the `그` inside it is not
in the digit table so `decode` returns `None`. `swap` leaves the original as is. The result is `그렌라간e.mkv`.

**No exception, no warning.** The restore "succeeded" and `_JS_TITLE_RE` finds a value too. Only, the episode
number has disappeared.

A measurement reproduced in §13.4.

| Original `title` | `flags=re.ASCII` | no flag (control) |
|---|---|---|
| `그렌라간01.mkv` | `그렌라간01.mkv` | `그렌라간e.mkv` |
| `그렌라간02.mkv` | `그렌라간02.mkv` | `그렌라간e.mkv` |
| `그렌라간03.mkv` | `그렌라간03.mkv` | `그렌라간e.mkv` |

The three right-column values are **all the same.** Names that should have differed per episode collapse into
one. Once `_name_of` strips the extension, all three episodes become `그렌라간` + one index letter, and they
overwrite the same file in turn. A failure where you received 27 episodes but one file remains.

> Why do the three become the same letter — the index is **the appearance order within that page.** If the
> page skeleton is the same per episode, the spot the episode number sits at is also the same so the index is
> the same. That is, this collision is not a coincidence but **normal behavior when the template is the same.**

The one-line summary is this.

> **The reverse transform must use the same token rule as the forward transform. When the rule goes off, the
> transform does not fail but produces a result that looks partially successful.**

### 13.3.4 `decode`'s two defenses

```python
# series.py:240-247
    def decode(token: str) -> int | None:
        n = 0
        for ch in token:
            i = _ALPHABET.find(ch)
            if i < 0 or i >= base:
                return None
            n = n * base + i
        return n
```

Seven lines with two checks in them.

| Check | What it blocks | Without it |
|---|---|---|
| `i < 0` | a letter not in the table (`_`, Korean, a symbol) | the `-1` `find` gave becomes a digit value and a negative index arises |
| `i >= base` | **a digit not valid in that base** | an `A` (36 in the table) mixed into base-36 body is read as 36 and changed into a wrong word |

The second is less obvious. `_ALPHABET` is fixed at 62 letters but `base` is set by the response. The table's
size and the actual base can differ, and this one line fills that gap. **In a structure that keeps the table
constant and reads the base from the input, a consistency check between the two is essential.**

Both checks give `None` on failure, and `swap` leaves the original. That is, **a token that could not be
reversed is not touched.** This matches the packer's behavior too — the packer also leaves the index notation
as is when a dictionary slot is empty, and `swap`'s `and words[i]` catches that case.

### 13.3.5 The value of a restore failure is an empty string

```python
# series.py:234-236
    m = _PACKED_RE.search(text)
    if not m:
        return ""
```

If it cannot catch the format it is not an exception but an empty string. The basis that this is not neglect
but a **calculated choice** is that the same module behaves the opposite for other values.

| The value not obtained | This code's reaction | Anchor | Basis |
|---|---|---|---|
| the player iframe address | **exception** | [`series.py:263`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L263) | without it everything after is impossible |
| the playback-source response is not JSON | **exception** (carrying the server's message as is) | [`series.py:292-294`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L292-L294) | that message is itself the refusal reason |
| no playback address in the response | **exception** | [`series.py:298`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L298) | there is nothing to receive |
| the player settings (packed JS) | **empty string** | [`series.py:236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L236) | the name is substitutable |

Only the last row differs. The reason shows exactly by seeing where `unpack`'s result flows. `settings`
appears exactly twice inside `resolve`.

```python
# series.py:278
    settings = unpack(fetcher.get_text(player, _from(page_url)))
```

```python
# series.py:300
    return Play(playlist_url=link, name=_name_of(settings, episode, fallback_width), referer=origin + "/")
```

**The playback address does not come from `settings`.** `link` comes from the XHR response JSON's
`securedLink`/`videoSource` ([`series.py:296`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L296)). What `settings` decides is only `name`, and that `name` has an
alternative path prepared.

```python
# series.py:310-316
    m = _JS_TITLE_RE.search(settings)
    if m and m.group("title").strip():
        stem = re.sub(r"\.(mkv|mp4|ts|m4v|avi|webm|mov)$", "", m.group("title").strip(), flags=re.I)
        if stem:
            return sanitize(stem)
    base = _EP_SUFFIX_RE.sub("", episode.title).strip() or "episode"
    return sanitize(f"{base} {episode.number:0{width}d}")
```

If `settings` is an empty string, `_JS_TITLE_RE.search("")` is `None`, and it falls back to the episode title
obtained from the list + the zero-padded episode number. That `sanitize`, covered in Chapters 31·32, is
attached identically at the end of both paths is the same design — **whichever path it came from, the filename
rule is applied in one place.**

> **Principle** — **the return value on failure is decided by that value's consumer.** A value with an
> alternative path fails soft, and a value with no alternative path fails fast. Force one failure policy on the
> whole module and one of the two is necessarily wrong.

Had `unpack` thrown an exception, **the whole tool dies the day the site changes its packer.** It would answer
with a full halt to a matter where only the name being less pretty is at stake. Conversely, had it passed on
an empty string when there is no playback address, it would have made a 0-byte file and reported success.

---

## 13.4 Lab — reproduce compression and restore locally

You can confirm the whole process with no external site. All you need is `python3` and this repository.
**Making the compressing side yourself** is this section's point — the very fact that a compressor can be
written in twenty lines is §13.7's conclusion.

### 13.4.1 The compressor

```python
import re, string
_ALPHABET = string.digits + string.ascii_lowercase + string.ascii_uppercase
BASE = 62

def enc(n: int) -> str:
    """The packer's digit notation — 0-9 a-z A-Z."""
    if n == 0:
        return _ALPHABET[0]
    out = ""
    while n:
        out, n = _ALPHABET[n % BASE] + out, n // BASE
    return out

def pack(src: str) -> tuple[str, list[str]]:
    words, index = [], {}
    def tok(mo):
        w = mo.group(0)
        if w not in index:
            index[w] = len(words); words.append(w)
        return enc(index[w])
    # JavaScript's \w is ASCII only — the compressing side's rule is set here.
    return re.sub(r"\b\w+\b", tok, src, flags=re.ASCII), words
```

### 13.4.2 Round-trip verification

```python
from hlsrecon.series import unpack

SRC = ('var player = new Playerjs({"id":"player",'
       '"file":"https://cdn.example/hls/abc/master.m3u8","title":"그렌라간01.mkv"});')

payload, words = pack(SRC)
dic = "|".join(words)
blob = f"}}('{payload}',{BASE},{len(words)},'{dic}'.split('|'),0,{{}}))"
assert unpack(blob) == SRC          # round-trip match — passes
```

Run it and it passes. The body and dictionary come out like this.

```
body: 0 1 = 2 3({"4":"1","5":"6://7.8/9/a/b.c","d":"그렌라간e.f"});
dict: var|player|new|Playerjs|id|file|https|cdn|example|hls|abc|master|m3u8|title|01|mkv
```

### 13.4.3 Control — the restore with the flag removed

Copy `unpack`, make a variant with only `flags=re.ASCII` removed, and feed it the same input and §13.3.3's
table reproduces. On three inputs differing only in the episode number, the three results all become the same
`그렌라간e.mkv`.

> **What this lab confirms and does not.** What it confirms is "using the same digit table and the same token
> rule, the round trip holds exactly." What it does **not** confirm is "the actual Dean Edwards Packer's
> output uses this digit table" — since the same table was used on both compression·restore, this experiment
> shows only internal consistency. Verifying the convention itself is left as a limit in §13.8.

---

## 13.5 The code — parse but do not execute

### 13.5.1 The real difference between the two ways

Back to §13.1's fork. The difference between A (execute) and B (parse) is not code length.

![The same byte sequence, two boundaries](/images/lecture/hls-recon/13-trust-boundary.svg)

*Figure 13-3 — the same byte sequence, two boundaries — keep it as data or raise it to code*

> **Term** — **trust boundary**: the point where two regions of different trust levels meet. Data crossing the
> boundary is a validation target, and where you draw the boundary sets "what must be validated."

The criterion for drawing the boundary is **not the data's source but the capability that data gets.** Listing
the capabilities the two ways grant a remote string, it is this.

| | B. parse (this repository) | A. execute (`eval` family) |
|---|---|---|
| What the remote string can do | become a dictionary index | all of JavaScript |
| Reachable resources | one `words` list | the file system · network · environment variables · child processes |
| Worst outcome | a wrong filename | **arbitrary code execution (RCE)** |
| If the other party turns attacker | the name gets weird | does anything under this account |
| Additional dependency | none (standard library) | a JS executor — itself an attack surface |

The last row is often missed in practice. Whatever you use among `js2py`·`PyExecJS`·a Node subprocess, **the
executor introduced to run remote code is itself a new attack surface.** The structure seen in Chapter 15 —
relaxing a defense to do something — repeats here in the form of a dependency.

### 13.5.2 The entirety of operations this code permits on a remote string

Writing out, with nothing left, the operations a remote string is involved in inside `unpack`, it is these
four.

| Operation | Code | What the remote controls | What the remote does not control |
|---|---|---|---|
| regex matching | `_PACKED_RE.search(text)` | whether it matches | the regex itself (constant) |
| integer conversion | `int(m.group("base"))` | the base value | the digit table converted against |
| list indexing | `words[i]` | the index value | the list content is remote too but **strings only** |
| string substitution | `re.sub(..., swap, payload, ...)` | the substitution-result string | the substitution rule |

**No attribute access, no dynamic call, no import, no file·socket access.** A string turns into a string and
that is all. This is the actual content of "only parse."

There is one more thing to confirm. The `base` the remote set goes into `int()`, and since the regex limits it
to `(?P<base>\d+)`, what comes here is necessarily a decimal digit string. Only, with no length limit, **a very
long digit string could make `int()` slow.** Python 3.11 and up (and security releases of earlier lines) put an
integer-conversion digit cap (default 4300) blocking this path, but a build without it is not blocked. It was
not measured in this repository, and the observable worst is a delay, not code execution — **where you drew the
boundary sets the size of the worst** applies here as is.

### 13.5.3 What to accept as the player — the choice is a trust decision too

Even choosing to only parse, **the choice of which document to receive and parse** remains. The episode page
has several `<iframe>`s — ads·social widgets, etc.

```python
# series.py:258-263
def _player_url(page: str, url: str) -> str:
    for src in _IFRAME_RE.findall(page):
        absolute = urljoin(url, src)
        if _PLAYER_RE.match(absolute):
            return absolute
    raise ValueError(f"could not find the player iframe in the episode page: {url}")
```

```python
# series.py:216-217
# the player address is of the shape `<host>/video/<hash>`. the basis for distinguishing ad·social iframes.
_PLAYER_RE = re.compile(r"^https?://[^/]+/video/(?P<hash>[0-9A-Za-z]{8,})/?$")
```

Three things are in these six lines.

1. **Choose by shape, not position.** Not "the first iframe" but the one matching `/video/<8+ alphanumerics>`.
   Had it chosen by position, the moment one ad iframe is added at the page top the tool goes to parse the ad
   server.
2. **If there is none matching the shape it is an exception.** It does not grab any and proceed. It is the
   first row of §13.3.5's table.
3. **Check after absolutizing with `urljoin`.** An input like the relative path `//evil.example/video/abcdefgh`
   is fixed to an absolute address before the check. "Transform once at the boundary" seen in Chapter 7 appears
   here as the **normalize-then-verify** order. Reverse the order and a string that passed the check is later
   interpreted as a different address.

But honestly — **it does not check the host.** As long as the shape matches, it receives and parses any host.
In a client tool where the user gave the address themselves it is not a problem by threat model, but the same
code in a server-side collector is **server-side request forgery (SSRF).** Left as a limit in §13.8.

---

## 13.6 Generalization — the point where data is raised to code

This chapter's principle has nothing to do with packed JS. The general form is this.

> **Parse and evaluate are different jobs. For remote input the former is unavoidable and the latter is always
> a choice, and the moment you choose the latter, the side that made the input gets this side's authority.**

List where the same structure appears. Each row's left is "the short, convenient way," the right "the way that
limits the capability."

| Domain | The call raising data to code | The capability the other party gets | The alternative that limits the capability |
|---|---|---|---|
| JavaScript | `eval` · `new Function` | all of the page context | JSON parse then table lookup |
| Python | `eval` · `exec` | all of the interpreter | `ast.literal_eval` |
| Python serialization | `pickle.loads` | arbitrary code execution | JSON · a schema-based format |
| YAML | `yaml.load` (default Loader) | arbitrary object creation | `yaml.safe_load` |
| Java serialization | `ObjectInputStream.readObject` | a gadget chain → RCE | schema-based serialization |
| templates | a user string as the template **source** | server-side template injection (SSTI) | fix the template, inject only data |
| SQL | query-string concatenation | an arbitrary query | bind parameters |
| XML | a parser allowing external entities | file read (XXE) · entity bomb | an entity-disabled parser |
| shell | executing a string with `shell=True` | command injection | execute directly with an argument array |

> **Term** — **deserialization vulnerability**: a problem where, in restoring serialized data to an object, the
> constructor·magic method of the type the data specified is called and a code path the attacker chose runs.
> `pickle` and Java serialization are representative.

All but the last row arise because "**interpreting the format**" and "**performing the action the format
directs**" are bundled in one function. Split them and it disappears.

Inside this repository there is one more of the same judgment. The tool checking the course's diagrams must
parse SVG as XML, and if that parser has external-entity handling, one diagram file can read a local file.

```python
# tools/check_svg.py:29-39
try:  # external-entity·entity-bomb defense. without it, the DTD rejection below substitutes.
    from defusedxml import ElementTree as ET  # type: ignore
    _DEFUSED = True
except ImportError:
    import xml.etree.ElementTree as ET  # noqa: N817
    _DEFUSED = False

# this course's diagrams do not use DTD·entities. if such a declaration is there, it is not a file we
# made or has been tampered with, so reject before parsing — this is the only path to XXE·billion-laughs
# in an environment without defusedxml.
DTD_DECL = re.compile(r"<!(?:DOCTYPE|ENTITY)\b", re.I)
```

The judgment is the same as `unpack`'s — **parse but do not give the parser extra capability.** And that the
defense is placed in two layers, not one (reject the DTD declaration itself if `defusedxml` is absent), is the
execution of "do not make a coupling between layers" stated in Chapter 15.

---

## 13.7 Security — the exact location of security through obscurity

### 13.7.1 Saying precisely what the problem is

> **Term** — **security through obscurity**: a way of building security on the assumption that the other party
> does not know the design·implementation·data format.

> **Term** — **Kerckhoffs's principle**: the design principle that a cryptosystem must be secure **even if
> everything except the key is public** (1883). Inverted, it is the observation that the only thing that can be
> kept secret is a small replaceable value (the key), and the algorithm cannot be kept secret.

Hold packed JS against this principle and the violation point is exactly one place.

| What Kerckhoffs requires | packed JS's state |
|---|---|
| the secret is in the key | **there is no key** |
| the algorithm is secure even public | if the algorithm is public the restore is self-evident |
| the secret is replaceable | to replace it you must **change every client at once** |
| the secret is distributed only to a few | **it is distributed to every browser that connects** |

The last row is decisive. Since the browser must execute this script, it **necessarily receives everything
needed to restore.** What a client can execute a client can read. The requirement "send it but make it
unreadable" does not hold in this structure.

### 13.7.2 That said, it is not worthless

Here a common over-correction happens. The sentence "obfuscation is meaningless" is wrong. Measured precisely,
it is this.

| Question | Answer |
|---|---|
| What does it **block** | it blocks nothing |
| What does it **raise** | automation cost. what a scraper scraped with one regex, it makes them figure out the format and use a restorer |
| How much does it raise | for a known packer, **nearly 0** (a public restorer exists). for a custom variant, by the time a person reads the format |
| Whom does it slow | a naive automatic collector and an analyst who does not know the format |
| Whom does it not slow | someone who opens browser devtools — the value after execution is visible as is |
| What does it depend on | the unverifiable assumption "the other party does not know this format" |

So this course's formulation is as follows.

> **Obfuscation is a delay, not a control. A delay has value only when there is something else working within
> that time.**

To book a delay itself as value needs a pair. For example, when combined with operations that frequently change
the format while detecting·blocking anomalous access on the server side, obfuscation buys "time for detection
to work." Standing alone, nothing happens in that time so the value converges to 0.

### 13.7.3 The cost obfuscation pays — it turns off an actual control

To measure the value you must measure the cost too. And in this case one cost item is a **security control.**

Packed JS requires `eval` (or `new Function`). But to allow that you must put `script-src 'unsafe-eval'` in the
page's **Content Security Policy (CSP).**

> **Term** — **CSP (Content Security Policy)**: a browser-enforced policy the server declares in a response
> header on what origin's script·style·image the page may execute·load. It is an actual control that reduces
> the impact of XSS.

| Item | Nature | In this trade |
|---|---|---|
| packed JS obfuscation | not a control (a delay) | **gained** |
| CSP `unsafe-eval` ban | an actual control (XSS mitigation) | **lost** |

**You turn off a control to get a non-control.** The structure seen in Chapter 15 repeats as is, with one
difference. In Chapter 15 the cost was paid by a third party (the client), but **here the cost is paid by
oneself.** Your own page's XSS mitigation is weakened.

The other costs, noted too.

| Cost | Content |
|---|---|
| unobservable errors | the stack trace collapses into one line so error reports in operation become meaningless |
| first-execution delay | the restore function must run on every load |
| unauditable | a third-party security review·extension cannot confirm the page behavior |

### 13.7.4 The defender's view

Without this section this chapter ends as an explanation of the bypass. Split by role.

| Role | What to do |
|---|---|
| **service operator** | do not put obfuscation on the control list. **the authorization decision must be the same with or without obfuscation.** the actual control is server-side authorization — permission checks by session·subscription state, short-lived signed URLs (Chapter 11), per-episode access records, rate limiting |
| **frontend developer** | explicitly calculate and write down the trade of turning on `unsafe-eval` for obfuscation. do not calculate it and it is not a trade but an accident |
| **security reviewer** | delete the item "safe because obfuscated" from the control list. put into the threat model the premise **"all code and data deployed to the client is public"** and look again |
| **tool·client implementer** | do not evaluate remote code. if it cannot be reversed give an empty value, and let the upper layer decide whether to use it |
| **incident responder** | on meeting an obfuscated script, do not execute it but restore statically first. the moment you execute it for analysis, the analyst becomes the first victim |

The most practical check is this one sentence.

> **"Is this system safe even if you strip all obfuscation and publish the source?"**
> If the answer is "no," what propped up the safety was not the obfuscation but **the missing authorization
> check.**

Where this question especially stings is the kind of endpoint "it's fine because no one knows the address."
What the obfuscation hid was the address, and an address is not kept secret.

---

## 13.8 Limits and open questions

Noted honestly. This is the boundary of **what was measured and what was inferred** in this chapter.

- **The digit table's convention could not be compared against actual packer output.** §13.4's round-trip
  experiment used the same `_ALPHABET` on both compression·restore, so it shows **only internal consistency.**
  The statement "the 0-9 a-z A-Z order is the Dean Edwards Packer's convention" was not verified in this
  session. To confirm it you would put an actual packer's output side by side and compare.
- **The `re.ASCII` counterexample was reproduced with synthetic input.** §13.3.3's table is a value obtained on
  input made by this chapter's compressor. It was not reproduced with an actual site response. But the
  reproduction condition (a string with an ASCII index attached after Korean) is the same as the situation the
  code comment and [`series.py:306`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L306)'s example (`그렌라간01.mkv`) point at.
- **`_PACKED_RE` catches only one variant of the packer.** A variant where the dictionary separator is not `|`,
  or the string is assembled with `String.fromCharCode`, or an array rotation is mixed in, is not caught. In
  that case it becomes an empty string and **quietly drops to the alternative name.** No log remains either —
  the user can only know it by the filename being different from usual. A point with clear room for improvement.
- **`out.replace("\\/", "/")` is a whole-string substitution.** If a spot inside the restored source needs `\/`
  as literal characters (a regex literal, etc.), it is changed too. This code reads only `title` so there is no
  impact now, but use this function as a general restorer and it is wrong.
- **A packer with a base over 62 cannot be fully reversed.** A token containing a digit not in the table remains
  as the original. That it **does not reverse wrongly** is confirmed in the code (`decode`'s `i < 0` branch),
  but it was not confirmed by meeting such a packer.
- **`_PLAYER_RE` looks only at the address's shape.** The host follows whatever the page set. In the current
  threat model of a client tool where the user gives the address it is not a problem, but the same form in a
  server-side collector is SSRF. There is no host allowlist.
- **The delay effect of obfuscation could not be quantified.** Statements like §13.7.2's "for a known packer,
  nearly 0" are qualitative judgments, not measured values. Apply Chapter 15's standard to this chapter and
  these claims are **sentences that should be asked for a basis.**

### 13.8.1 The three functions of this chapter have no regression test

Noted separately as the biggest gap. The regression test swaps the playback-source resolution wholesale with a
stand-in.

```python
# tests/run.sh:443-449
# swap only the playback-source resolution with a stand-in — with no site, the path after runs for real.
def fake_resolve(ep, fetcher, width=2):
    return series.Play(
        playlist_url=f"{base}/master-subs.m3u8", name=f"메움{ep.number:02d}", referer=f"{base}/"
    )

series.resolve = fake_resolve
```

The stand-in itself is the right choice — a test depending on an external site cannot be a regression test. But
as a result `unpack` · `_player_url` · `_name_of` **are never executed once.** §13.4's lab is effectively these
functions' only verification, and that is documentation, not a test. From Chapter 34's (test oracle) viewpoint,
the current true-positive rate of the regression test for these three functions is **0.**

The way to fix it is not hard. `unpack` is a pure function and its input can be made with §13.4's compressor,
so a unit test with no external dependency holds — in particular, fixing **a Korean-mixed input** catches
§13.3.3's counterexample as a regression. Something this repository has not yet done.

---

## 13.9 Summary

1. Packed JS is **not encryption but dictionary compression.** The base·dictionary·body needed to restore all
   come carried in the same string. There is not a single value the other party does not know, so the restore
   cost is only proportional to input length.
2. The restore is four steps — cut tokens → radix notation to integer → integer to dictionary index →
   substitute the word. The actual logic is ten lines.
3. **The upper bound of Python `int(x, base)`'s base is 36.** Because of the convention of treating case as the
   same, the standard does not define beyond it. To read base 62 you must keep a digit table directly, and that
   table's order differs from base64.
4. **Remove `re.ASCII` and the reverse transform cuts at a different place than the compression.** JavaScript's
   `\w` is ASCII only, but Python 3's default `\w` includes Korean. As a result the episode number is not
   restored, and episodes with the same page skeleton **collapse into the same filename.** No exception, no
   warning.
5. **This code only parses the remote script and does not execute it.** The operations permitted on the remote
   string are only four — regex matching·integer conversion·list indexing·string substitution. An `eval`
   implementation achieves the same goal in one line but at the price of **the peer server getting execution
   authority over this side's process.**
6. **The return value on failure is decided by the value's consumer.** A name with an alternative path falls
   back to an empty string ([`series.py:236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L236)), and a playback address with no alternative path is an immediate
   exception (`series.py:263,292-294,298`). One module using two policies is correct.
7. **Obfuscation is a delay, not a control.** The Kerckhoffs-principle violation point is exactly one place —
   the secret is in the format, not a key, and that format is distributed to every client. It is not worthless
   (it raises automation cost), but **book it as a security control and the server-side authorization that
   should be there is left empty.**
8. Obfuscation is not free. It requires `eval` so it makes you turn on CSP `unsafe-eval` — **a trade turning
   off a control to get a non-control**, and unlike Chapter 15 the cost is paid by oneself.

---

**Next chapter** — this chapter's obfuscation was an attempt to make a value **hard to read.** The next
chapter's subject is an attempt to make a value **look like something else.** It is the practice of a video
segment arriving with the name `.html` and the declaration `text/html`. What the two chapters share is that
they **become accurate only when the receiving side does not trust the self-report**, and the difference is
that Chapter 14's disguise has no execution risk — so the form of defense differs too.
