---
title: "Unicode Normalization"
description: "NFC/NFD and normalization attacks"
date: 2026-07-30
version: '1.0'
tags: ['streaming', 'portability']
thumbnail: /images/lecture/thumb/hls-recon-31-unicode-normalization.svg
---
## 31.0 What this chapter answers

1. Why can two strings that look completely the same be different?
2. What exactly differs among the four NFC · NFD · NFKC · NFKD?
3. Where does this code normalize, and why those two spots exactly?
4. What is the basis for removing even whitespace·separators and doing `casefold` in the comparison form?
5. **Why does it become a vulnerability if the normalization time and the verification time are off?**

The last question is this chapter's summit, and it is **exactly the same structure** as Chapter 7 (URL
normalization and idempotency).

---

## 31.1 The problem — two folders that look the same

Say you ran `hls-recon` twice and two folders arose in the same spot.

```
그렌라간/
그렌라간/
```

In the terminal, in Finder, in this document, the two names **do not look different by a single letter.** But the
filesystem treated the two as different names, and of the 27 episodes the first few went here and the rest there.

Look at the bytes and they split at once.

```
$ python3 -c "
import unicodedata as u
for f in ('NFC','NFD'):
    s = u.normalize(f, '그렌라간')
    print(f, len(s), s.encode('utf-8').hex())
"
NFC 4 eab7b8eba08ceb9dbceab084
NFD 10 e18480e185b3e18485e185a6e186abe18485e185a1e18480e185a1e186ab
```

**The same four letters are 4 code points 12 bytes and also 10 code points 30 bytes.** The single `그` splits into
two, `ᄀ` (initial giyeok U+1100) + `ᅳ` (medial eu U+1173), and `렌` splits into three: initial·medial·final.
Because the rendering engine merges them back into one syllable to draw, they look the same to the eye.

> **Term** — **code point**: the number Unicode assigns to one character. Written like `U+AC00`. It differs from
> the **byte count** (the UTF-8 encoding result) and from the **number of letters visible on screen** (grapheme
> clusters). This chapter is the story of those three going off.

Compare with `==` and of course they differ. `len()` differs too. The sort order differs. The hash differs.
**Every operation handling strings gives a different answer.** And yet the human eye says the same.

The path by which this situation is actually made in this repository is the point where the following two meet.

| Source | Notation form | Basis |
|---|---|---|
| a work title received from the web | usually **NFC** | HTML·JSON are mostly written·transmitted as NFC |
| a name read from the filesystem | **the volume decides** | HFS+ is decomposed, exFAT·ext4 keep what was written, APFS keeps what was written |

`inventory.stock_for` is the function comparing these two ([`inventory.py:214-256`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L214-L256)). Without matching the notation
before comparing, **it does not recognize the 27 episodes already received and re-receives them all.**

---

## 31.2 The principle — canonical equivalence and compatibility equivalence

### 31.2.1 Unicode defines "the same character" in two layers

Unicode permits the existence of several ways to express the same letter. The Latin letter `Å` can be `U+00C5`
(the composed one) or `A` (U+0041) + `◌̊` (U+030A COMBINING RING ABOVE), two. The Hangul `그` can be `U+ADF8`,
one, or the initial·medial, two. This duplication is not a historical accident but **a design decision to
guarantee round-trip conversion with existing character sets.**

Having permitted duplication, a definition of "sameness" becomes needed. Unicode defines it in two layers.

> **Term** — **canonical equivalence**: the relation where two strings represent **the same character** and can
> be swapped in any context with no change of meaning. `Å` (U+00C5) and `A`+`◌̊` are so.

> **Term** — **compatibility equivalence**: the relation where two strings are **different characters** but
> derived from the same abstract character. Format·width·position differ. `ﬁ` (U+FB01 ligature) and `fi`, `①` and
> `1`, fullwidth `Ａ` and `A` are so. **Swap them and information vanishes.**

Canonical equivalence is "same letter, only different notation," and compatibility equivalence is "different
letter, but the meaning gets through." This distinction dominates the whole of the following sections.

### 31.2.2 Two axes make four forms

A normalization form is a combination of **which equivalence you use** (canonical / compatibility) and **whether
you compose or decompose the result** (composition / decomposition).

> **Term** — **normalization**: the operation of setting one of several equivalent expressions as the
> representative and changing a string to that representative form. The specification is UAX #15 (Unicode
> Normalization Forms).

| Form | Full name | Equivalence | Direction | One-line definition |
|---|---|---|---|---|
| **NFD** | Normalization Form Canonical Decomposition | canonical | decompose | do only canonical decomposition and stop |
| **NFC** | Normalization Form Canonical Composition | canonical | compose | canonically decompose then **re-compose canonically** |
| **NFKD** | …Compatibility Decomposition | compatibility | decompose | do compatibility decomposition |
| **NFKC** | …Compatibility Composition | compatibility | compose | compatibility-decompose then **canonically** compose |

The `K` is the K of compatibility (since C is already used for Composition). And unlike the name, **NFC too
internally decomposes once.** Because composing without decomposing does not sort the combining characters into
the standard order, so the same letter still remains in two expressions.

> **Term** — **canonical ordering**: the rule sorting combining marks, when several attach, by their **canonical
> combining class** value. This sorting is done at the decomposition stage.

The measured result of the four forms.

| Input | NFC | NFD | NFKC | NFKD |
|---|---|---|---|---|
| `가` U+AC00 | `가` (1 char) | `가` (2 chars) | `가` (1 char) | `가` (2 chars) |
| `ﬁ` U+FB01 ligature | `ﬁ` | `ﬁ` | **`fi`** | **`fi`** |
| `①` U+2460 | `①` | `①` | **`1`** | **`1`** |
| `Ａ` U+FF21 fullwidth | `Ａ` | `Ａ` | **`A`** | **`A`** |
| `／` U+FF0F fullwidth slash | `／` | `／` | **`/`** | **`/`** |
| `ㄱ` U+3131 compatibility jamo | `ㄱ` | `ㄱ` | **`ᄀ`** U+1100 | **`ᄀ`** U+1100 |
| `½` U+00BD | `½` | `½` | **`1⁄2`** | **`1⁄2`** |

**The canonical forms (NFC/NFD) do not touch compatibility characters.** The `ﬁ` ligature passes NFC and is
still `ﬁ`. Conversely NFKC **changes `／` (fullwidth solidus) to ASCII `/`** — this fact becomes §31.7.3's core.

### 31.2.3 NFC too changes code points — canonical singleton decomposition

The intuition "NFC only composes so the code points neither grow nor shrink" is wrong.

> **Term** — **canonical singleton decomposition**: the case where one code point canonically decomposes to
> **another single code point** with no combining character. It is a device tidying the historical duplication of
> encoding the same letter twice.

Three measured.

| Input | Name | NFC result | Note |
|---|---|---|---|
| `K` U+212A | KELVIN SIGN | **`K` U+004B** | becomes ASCII uppercase K |
| `Å` U+212B | ANGSTROM SIGN | `Å` U+00C5 | in NFD it is `A`+`◌̊`, two |
| `Ω` U+2126 | OHM SIGN | `Ω` U+03A9 | Greek uppercase omega |

**By NFC alone a non-ASCII character becomes an ASCII character.** This is the spot where the defense logic "we
do not use anything dangerous like NFKC and use only NFC so it is fine" does not hold, and it is raised again in
§31.7.2.

---

## 31.3 Which form does the filesystem return

This code's comment names macOS twice ([`naming.py:123`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L123), [`inventory.py:208`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L208)). What actually happens **depends on
the volume's filesystem**, and that behavior splits on two axes.

> **Term** — **normalization-preserving**: it stores the notation given at creation as-is and returns it as-is.
> **normalization-insensitive**: it **finds by the same name** even if the normalization form differs. The two
> are independent properties.

| Filesystem | On store | On lookup | Can two notations of the same letter coexist |
|---|---|---|---|
| **HFS+** | **converts** to decomposed (an NFD variant) to store | finds regardless of form | no |
| **APFS** (macOS 10.13+) | stores **as-given** | finds regardless of form | no |
| **exFAT** | as-given | compares bytes as-is | **yes** |
| **ext4** (Linux default) | as-given | compares bytes as-is | **yes** |
| **SMB·NFS share** | depends on server implementation | depends on server implementation | **yes** |

The result measured directly on this repository's working volume (APFS, Darwin 25.5.0) while writing this
document.

```
$ python3 -c "
import unicodedata as u, pathlib
d = pathlib.Path('t'); d.mkdir()
(d / (u.normalize('NFC','그렌라간') + '.txt')).write_text('x')
n = next(d.iterdir()).name
print('read-back name is NFC:', u.normalize('NFC', n) == n)
print('read-back name is NFD:', u.normalize('NFD', n) == n)
print('opens by NFD path too :', (d / (u.normalize('NFD','그렌라간') + '.txt')).exists())
"
read-back name is NFC: True
read-back name is NFD: False
opens by NFD path too : True
```

**Made as NFC it came back as NFC, and the same file opened by the NFD path too.** Conversely make it with an NFD
name and it comes back as NFD (confirmed the same way). That is, today's APFS is **preserving yet insensitive.**

Here the code's narrative and the measurement diverge. `sanitize`'s docstring reads like this.

> **Term** — **docstring**: a string literal placed in the position of the first statement of a function·class·
> module. Unlike a `#` comment it remains at runtime as `__doc__` and is read by `help()` and documentation
> generators. That is, **an explanation distributed as part of the code.**

```python
# naming.py:123-124
    The macOS filesystem stores Hangul in the jamo-separated form (NFD), but a name received from the web
    is the composed form (NFC). Mixed, two folders that look the same arise, so fix it to NFC.
```

This narrative is **accurate on HFS+ and not accurate on APFS.** That does not make this code unnecessary. There
are still several paths by which an NFD name reaches this tool.

| Path | Why NFD |
|---|---|
| an HFS+ volume (an old external disk·Time Machine backup) | the filesystem decomposes on store |
| the result of unzipping a ZIP·TAR made on macOS | the archive holds the decomposed name as-is |
| `rsync`·SMB share between macOS ↔ Linux | the transfer layer moves the notation without changing it |
| the stored name of a file the browser downloaded | depends on the save dialog·download-manager implementation |

And **the moment an NFD name is placed on an exFAT·ext4 volume**, two notations can coexist. It is the volume
[`naming.py:25`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L25) wrote of as "catches if the external disk is exFAT."

---

## 31.4 The code — the two spots that fix to NFC

This repository normalizes at **exactly two places.** Both are boundaries, and what they do differs.

![The two spots this code fixes to NFC and each one's purpose](/images/lecture/hls-recon/31-two-pins.svg)

*Figure 31-1 — the two spots this code fixes to NFC and each one's purpose*

### 31.4.1 On store — `sanitize()`

```python
# naming.py:120-130
def sanitize(name: str) -> str:
    """Tidy so it can be used as a folder·file name.

    The macOS filesystem stores Hangul in the jamo-separated form (NFD), but a name received from the web
    is the composed form (NFC). Mixed, two folders that look the same arise, so fix it to NFC.
    Remove trailing dots·spaces — they become names unopenable on Windows, and cause a problem as-is
    when moved to an external disk or a network share.
    """
    s = _UNSAFE_RE.sub("_", unicodedata.normalize("NFC", name)).strip()
    s = s.rstrip(". ")
    return s or "untitled"
```

This function is **the sole spot deciding the name that will remain on disk.** The call sites are all "right
before writing."

| Call site | What it decides |
|---|---|
| [`library.py:23`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L23) `series_folder` · [`library.py:77`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L77) `plan_tidy` | the series **folder name** |
| [`library.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L33) `place` · [`cli.py:891`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L891) | the **file name** to store |
| `series.py:194,314,316` | fixes the work title·episode name read from the site as a name |

Here the order matters. **Do NFC first and then substitute the reserved characters.** What happens if you do the
reverse is covered by measurement in §31.7.3.

What `sanitize` **does not do** is also design. It does not `casefold`, does not remove whitespace, does not
flatten compatibility characters. Because this name is one a human reads and another tool opens, so **the
original must be recognizable.** Normalization is only up to canonical equivalence — that is, it unifies only
"different notations of the same letter" and does not touch "different letters."

### 31.4.2 On comparison — `_key()`

```python
# inventory.py:205-211
def _key(s: str) -> str:
    """The comparison form — match to NFC and remove whitespace·separators.

    The macOS filesystem returns Hangul in the jamo-separated form (NFD) and the work title the site
    told is the composed form (NFC). Without normalizing, two strings that look the same go off.
    """
    return re.sub(r"[\s._-]+", "", unicodedata.normalize("NFC", s)).casefold()
```

One line has three operations in order.

| Order | Operation | What it absorbs |
|---|---|---|
| 1 | `normalize("NFC", s)` | notation difference of the same letter (NFC ↔ NFD) |
| 2 | `re.sub(r"[\s._-]+", "", …)` | separator difference (`Sky.Blue` ↔ `Sky Blue` ↔ `Sky_Blue`) |
| 3 | `.casefold()` | case difference (`SKY` ↔ `sky`) |

This key is **made only for comparison and immediately discarded.** It is used only inside `stock_for`.

```python
# inventory.py:238-239
want = _key(title)
keys = {stem: _key(stem) for stem in groups}
```

Since it need not be reversed, it can be mashed far more aggressively than `sanitize`. **What information may be
discarded is set by what that string later becomes** — this is the principle dividing the two functions.

### 31.4.3 `casefold` and `lower` are different

> **Term** — **case folding**: the operation of making a **comparison-only** form that erases case distinction.
> Its purpose differs from `str.lower()` (lowercasing). Lowercasing makes "readable lowercase text," and folding
> makes "a key that comes out the same if it is the same."

The measured difference.

| Character | Code point | Name | `.lower()` | `.casefold()` |
|---|---|---|---|---|
| `ß` | U+00DF | LATIN SMALL LETTER SHARP S | `ß` | **`ss`** |
| `ẞ` | U+1E9E | LATIN CAPITAL LETTER SHARP S | `ß` | **`ss`** |
| `ς` | U+03C2 | GREEK SMALL LETTER FINAL SIGMA | `ς` | **`σ`** |
| `ſ` | U+017F | LATIN SMALL LETTER LONG S | `ſ` | **`s`** |
| `ﬁ` | U+FB01 | LATIN SMALL LIGATURE FI | `ﬁ` | **`fi`** |

**With `lower()` `"STRASSE".lower() != "Straße".lower()`, but with `casefold()` they become the same.** And
folding changes the length — the single letter `ß` becomes the two letters `ss`. So the folding result cannot be
used for display, and this code does not use it so.

In this repository handling only Hangul, this choice makes no observable difference. I confirmed that across the
whole range of Hangul syllables (U+AC00–U+D7A3) · conjoining jamo (U+1100–U+11FF) · compatibility jamo
(U+3130–U+318F), `casefold` is the identity function. **And yet the reason `casefold` is right is that this
function's name is `_key`** — use lowercasing at a spot making a comparison key and it goes quietly wrong when a
Latin-letter title comes in later.

### 31.4.4 Why even the separators are removed

`_key` deletes `[\s._-]+` whole. It looks unrelated to normalization but is a continuation of the same problem.

The file name's stem comes from the player setting's `title`, and the work title comes from the listing page
([`inventory.py:217-219`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L217-L219)). The two sources have different separator conventions.

| Source | Common notation |
|---|---|
| file name (download tool·release group) | `Sky.Blue`, `Sky_Blue`, `Sky-Blue` |
| listing page (a human-written title) | `Sky Blue` |

The three-stage matching (exact match → the work title contains the stem → the stem contains the work title,
[`inventory.py:241-251`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L241-L251)) judges by **substring containment.** If the separator remains, within `천원돌파 그렌라간` you
find `그렌라간` but not `그렌.라간`. As normalization absorbs "the notation difference of the same letter,"
separator removal absorbs "the notation difference of the same title." **The same kind of decision is repeated,
only at a different layer.**

---

## 31.5 What breaks if you do not do this

### 31.5.1 Remove the normalization — re-receive 27 episodes

Follow the inventory path as-is to see what happens if you remove only the `unicodedata.normalize("NFC", s)`
piece from `_key`. If there is only one group, `stock_for` returns it as-is ([`inventory.py:234-236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L234-L236)) so it does not
reach `_key`. So set the case where several works are mixed in one folder via `--flat` — one group is episodes
stored with NFD names, and the site tells the work title as NFC.

| Stage | With normalization | Without normalization |
|---|---|---|
| `_key("그렌라간")` (NFD, disk) | `그렌라간` (NFC 4 chars) | `그렌라간` (NFD 10 chars) |
| `_key("천원돌파 그렌라간")` (NFC, site) | `천원돌파그렌라간` | `천원돌파그렌라간` (NFC) |
| containment judgment `k in want` | **true** | **false** — the bytes differ |
| `stock_for` return | 27 in stock | **empty stock** |
| result | receive only the missing episodes | **re-receive all 27 episodes** |

`stock_for`'s docstring wrote this failure in advance — "gives an empty stock if it cannot disambiguate"
([`inventory.py:229-230`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L229-L230)). It is a safe failure, but here it is **could-have-disambiguated-but-did-not because of the
notation**, so the benefit vanishes wholesale. The very reason for the inventory module existing was to save the
requests of "three times per episode — page·player·XHR, over 80 for 27 episodes" ([`inventory.py:8-10`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L8-L10)).

I confirmed `_key` actually makes the two forms the same.

```
$ python3 -c "
import unicodedata as u, sys; sys.path.insert(0,'.')
from hlsrecon.inventory import _key
print(_key(u.normalize('NFC','그렌라간')) == _key(u.normalize('NFD','그렌라간')))
"
True
```

### 31.5.2 What this code cannot yet block — the group key is not normalized

`_key` normalizes **when comparing.** But grouping episodes happens before that, and there it does not normalize.

```python
# inventory.py:196
slot = groups.setdefault(series_of(f.stem), {})
```

`series_of(f.stem)` uses the name the filesystem gave as-is. If `그렌라간01.mp4` (NFC) and `그렌라간02.mp4` (NFD) are
together in one folder — possible on an exFAT·ext4·SMB volume (§31.3) — the stem becomes **two different keys**
and the group splits into two.

Then when `stock_for` normalizes with `_key`, the two keys **become the same.** Then whether exact-match
candidates or containment candidates, there are two so no length superiority arises. The code judges it ambiguous
and gives up ([`inventory.py:253-256`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L253-L256)). The result reproduced with the actual code.

```
$ python3 -c "
import unicodedata as u, sys; sys.path.insert(0,'.')
from hlsrecon import inventory
from hlsrecon.inventory import Item
from pathlib import Path
nfc, nfd = u.normalize('NFC','그렌라간'), u.normalize('NFD','그렌라간')
groups = {nfc: {1: Item(1, Path(nfc+'01.mp4'))},
          nfd: {2: Item(2, Path(nfd+'02.mp4'))}}
stock, note = inventory.stock_for(groups, '천원돌파 그렌라간')
print(len(stock), note)
"
0 several groups match the title (그렌라간, 그렌라간) — cannot disambiguate by number
```

**The diagnostic message shown to the user is `(그렌라간, 그렌라간)`.** Since the two names look identical, whoever
gets this message has no way to find out what went wrong. §31.1's problem is replayed once more inside the error
message.

Organized, this code's normalization placement is this.

| Spot | Normalize | Result |
|---|---|---|
| `sanitize` — right before writing | **does** | the names this tool makes are always NFC |
| `_key` — right before comparing | **does** | recognized as the same work even with different notation |
| `series_of` — when grouping | **does not** | different notation splits the group |

The third row is unresolved. The fix method is written in §31.8.

### 31.5.3 The regression test cannot fix this

Inventory verification makes actual files and runs actual code (`tests/run.sh:366-397`).

```bash
# tests/run.sh:372-373
groups = inventory.scan(folder)
stock, note = inventory.stock_for(groups, "천원돌파 그렌라간")
```

And nails the result with nine assertions (`tests/run.sh:399-417`). Of those, only `MIXED`·`ALONE` actually go
through `_key` — the folder the `NOTE` assertion (`tests/run.sh:411-413`) looks at has only one group so it
catches on `stock_for`'s early return ([`inventory.py:234-236`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L234-L236)). The closest to normalization is this.

```bash
# tests/run.sh:416-417
grep -q 'ALONE 2' "$INV" \
  && ok "disambiguates when caught by only one group (works with --flat too)" || bad "gave up when it could disambiguate"
```

**This assertion fixes `_key`'s containment judgment but cannot fix the NFC conversion.** The reason was
confirmed by measurement.

- The 1,187 Hangul fragments in the `tests/run.sh` source are **all NFC** (0 NFD fragments).
- The shell makes files with those NFC names, and APFS preserves the notation (§31.3).
- So the names `inventory.scan` reads are **NFC** too.

That is, while this test runs, `unicodedata.normalize("NFC", s)` is **always the identity function.** Delete the
normalization call whole and all 62 tests pass.

This is not so much a defect of the test as a **case where the environment the test runs in cannot reveal that
defect.** Borrowing Chapter 34's (test-oracle-problem) phrasing, this check's PASS means not "the NFC conversion
is right" but "on this volume the NFC conversion was not needed." To fix it **the file-making side must explicitly
write an NFD name** — see §31.8.

---

## 31.6 Generalization — convert once at the boundary

Pull the form the two spots of this chapter (`sanitize`·`_key`) share and it is this.

> **A conversion that changes the representation is done only once at the system's boundary, and inside it only
> one representation is handled.**

There are two boundaries — **on entry** (external representation → internal standard form) and **on exit**
(internal standard form → external representation). Convert again inside and two problems arise.

| Problem | What happens |
|---|---|
| **idempotency collapse** | if the conversion is not idempotent (e.g. percent encoding) a twice-applied value becomes a different value → Chapter 7 `%20` → `%2520` |
| **verification-use divergence** | the verified value and the actually-used value differ → §31.7 |

List where the same structure appears outside this domain and it is this.

| Domain | External representation | Internal standard form | Conversion point |
|---|---|---|---|
| **Unicode string** | NFC · NFD mixed | NFC (or NFD) | input boundary (this chapter) |
| **URL** | `%20` · `+` · case-mixed scheme | normalized URL | `fetch.normalize_url` (Chapter 7) |
| **time** | local time · offset notation | UTC integer | parse boundary |
| **line ending** | CRLF · CR · LF | LF | file-read boundary |
| **path** | relative path · symbolic link · `..` | absolute real path | `Path.resolve()` (`tests/gzip_server.py:22-25`) |
| **floating point** | decimal string | binary double precision | parse boundary |
| **email address** | case · dot variation | the standard form the service set | signup·login boundary |

In each row, a system where the "conversion point" scatters across several places all broke the same way. And
**what to set as the standard form is usually an arbitrary choice, but not setting one is not an arbitrary choice
but a defect.**

The reason this repository chose NFC and not NFD as the standard form is within the range of that arbitrariness
too. NFC is short (Hangul 12 bytes vs 30 bytes), values coming from the web are already mostly NFC, and W3C
recommends NFC for web content so the conversion count drops. **Unified as NFD, the accuracy would be the same.**
That there is one settled thing matters, not which side it is.

---

## 31.7 Security — Unicode normalization attacks

### 31.7.1 The structure — the off-ness of the normalization time and the verification time

Read the definition of normalization flipped to the attacker's view and it becomes this.

> **Normalization is a function that makes different strings into the same string.**

On the defense side this property is the convenience "recognized as the same even with different notation." On
the attack side the same property means "you can find a notation that passes the verifier." What divides the two
is not the property itself but the **order.**

![The order of verification and normalization makes the bypass](/images/lecture/hls-recon/31-normalize-then-validate.svg)

*Figure 31-2 — the order of verification and normalization makes the bypass*

> **Term** — **Unicode normalization attack**: an attack that puts in input with a notation passing verification,
> then has the normalization **after** verification change it to a forbidden value. More broadly it is a kind of
> **canonicalization attack**, classified as CWE-180 (Incorrect Behavior Order: Validate Before Canonicalize).

The holding conditions of the attack are three, and all three are needed.

| Condition | Content |
|---|---|
| ① | the input goes through verification |
| ② | there is a stage changing the string **after** verification (normalization·folding·encoding conversion) |
| ③ | that conversion **can produce** the value the verification meant to block |

③ is the core. It is not enough for the conversion to merely change the string; it must change it **into a value
in the block list.** How many such code points actually exist can be counted — §31.7.3.

### 31.7.2 "We use only NFC" is not a defense

§31.2.3's canonical singleton decomposition has worth here. The measured result.

```
raw  'Key'    cp = U+212A U+0065 U+0079      ← the first letter is KELVIN SIGN
NFC           cp = U+004B U+0065 U+0079      ← ASCII 'Key'
NFC.casefold  cp = U+006B U+0065 U+0079      ← ASCII 'key'
```

`U+212A` is not ASCII, and by byte string it is entirely different from `K`. **No check looking for the ASCII
string `"Key"` catches this.** And yet one NFC and it is ASCII.

`casefold` has the same property.

```
raw           'adminiſtrator'   ← the 7th is U+017F LATIN SMALL LETTER LONG S
NFC           'adminiſtrator'   ← NFC does not touch it
NFC.casefold  'administrator'   ← folding makes ſ into s
```

Here comes a practical principle.

> **The judgment "you just need to avoid dangerous normalization (NFKC)" is wrong. Every stage that changes the
> string is condition ②** — NFC too, `casefold()` too, `lower()` too, an encoding round-trip too.

### 31.7.3 NFKC **produces** reserved characters — it can be counted

Compatibility normalization flattens format characters to ASCII. Among that ASCII are separators. I swept the
whole Unicode code-point space using the reserved-character set of [`naming.py:26`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L26) as-is.

```python
# naming.py:26
_UNSAFE_RE = re.compile(r'[/\\:*?"<>|\x00-\x1f]')
```

**The count of code points that "were not reserved characters but get a reserved character mixed into the
normalization result."**

| Form | Count of such code points | Example |
|---|---|---|
| **NFC** | **0** | — |
| NFD | 2 | `≮` U+226E → `<` (U+003C) + `◌̸` (U+0338) |
| **NFKC** | **25** | `℀` U+2100 → `a/c` · `︓` U+FE13 → `:` · `？` U+FF1F → `?` |
| NFKD | 27 | the union of the above two |

This table justifies `sanitize`'s two decisions at once.

**First, choosing NFC.** With NFC a reserved character is produced in **0** cases. Had you used compatibility
normalization, the single letter `℀` (ACCOUNT OF) becomes the three letters `a/c` and **a path separator arises
inside the file name.** What verification passed was one name with no reserved character, but what actually gets
made is a `c` file under an `a` folder.

**Second, the order.** The current code does normalization first and substitution later.

```python
# naming.py:128
s = _UNSAFE_RE.sub("_", unicodedata.normalize("NFC", name)).strip()
```

Reverse the order (`normalize(NFC, _UNSAFE_RE.sub(...))`) and conditions ①②③ hold as-is. For NFC alone the result
happens to be the same because of the 0 in the table above, but **the moment someone changes it to NFKC it
quietly becomes vulnerable.** I confirmed that difference by measurement.

```
$ python3 -c "
import unicodedata as u, sys; sys.path.insert(0,'.')
from hlsrecon.naming import sanitize
print(repr(sanitize('a／b')))                     # current code (NFC)
print(repr(u.normalize('NFKC', 'a／b')))          # had it been compatibility normalization
"
'a／b'
'a/b'
```

The upper leaves the fullwidth solidus as-is so it is **one ordinary file name**, and the lower becomes an ASCII
slash so it is **two path pieces.** Same input, different normalization form, different trust boundary.

> **The reason this repository's code is safe is not that the order is right but that it chose NFC.** The order is
> now safe by chance. This is the same form as the state Chapter 15 named "incidental defense" — another decision
> blocks the front so this decision's rightness or wrongness is not observed.

### 31.7.4 Where the same structure appears

Organize the classic vectors of normalization attacks against conditions ①②③ and it is this. All are widely
documented vulnerability types, and are written as **patterns**, not procedures targeting a particular service.

| Vector | ① what verification meant to block | ② the conversion afterward | ③ the value produced |
|---|---|---|---|
| **path traversal** | `../` | NFKC · encoding conversion | fullwidth `．．／` → `../` |
| **authentication bypass** | an already-existing account name | NFC · `casefold` · `lower` | `ſ`→`s`, `U+212A`→`K` collide with an existing account |
| **XSS-filter bypass** | `<` `>` | NFKC | `﹤` U+FE64 → `<` |
| **SQL-injection-filter bypass** | `'` `"` | NFKC · encoding conversion | fullwidth quote → ASCII quote |
| **length-limit bypass** | max N chars | NFD (grows) · NFKC (shrinks) | 4 chars into 10, `½` into `1⁄2` |
| **duplicate-account creation** | the same name as an existing one | normalize only on store | registration passes, lookup collides |

The last row is interesting. **Not normalizing at all is a problem (duplicate account), and normalizing after
verification is a problem (authentication bypass).** The safe spot is only one — **before verification, and only
once.**

The second row is the standard form of authentication bypass. Check "an already-existing name" against the raw
string at signup and normalize on store, and you can sign up with a name that becomes the same as an existing
account after normalization. Then if lookup is done with the normalized key, the two accounts fold into one. How
to block it is written in §31.7.5.

### 31.7.5 The defender's view

| Role | What to do |
|---|---|
| **the input-receiving side** | do **normalization before verification.** and pass the normalized value to later stages — pass the original and even a right order is useless |
| **the account·identifier-handling side** | store a normalized key **together** on store and **put a unique constraint on that key.** if check and store use the same key, §31.7.4's six vectors close at once |
| **the filter·block-list-making side** | keep the forbidden-string list in the **same-normalized form** too. normalize only the input and keep the list original and the matching goes off |
| **the API-designing side** | **state the normalization form in the document.** without one sentence like "UTF-8 normalized to NFC," each client sends a different form |
| **auditor** | pull all the `normalize`·`casefold`·`lower`·`decode` call sites in the code and make a table of **whether each call is before or after verification.** those after are the candidates |
| **the file-name-making side** | use canonical normalization (NFC/NFD) and do not use compatibility normalization (NFKC/NFKD). compatibility normalization produces separators with §31.7.3's 25 code points |

The second row has the biggest effect. **"Check and store use the same key" is a design that removes the very
room to have the verification time and normalization time go off.** Better to make the order impossible to get
wrong than to require the order be kept.

### 31.7.6 Homoglyphs are a different problem — outside this code's scope

There is a problem often spoken of bundled with normalization attacks but **not solved by normalization.**

> **Term** — **homoglyph**: a character that is a different character but looks almost the same in a font. Latin
> `a` (U+0061) and Cyrillic `а` (U+0430) are representative. Unicode calls this relation **confusable** and
> handles it separately in UTS #39 (Unicode Security Mechanisms).

Normalization does not unify this. Confirmed.

```
NFC : Latin a == Cyrillic а ?  False
NFD : Latin a == Cyrillic а ?  False
NFKC: Latin a == Cyrillic а ?  False
NFKD: Latin a == Cyrillic а ?  False
adding casefold too       False
```

**All four forms are false.** The reason is in §31.2.1's definition — the two are neither canonically nor
compatibility equivalent. They are **different characters of different languages**, and if Unicode unified them,
Cyrillic text would break. That is, this is not a failure of normalization but **outside normalization's scope.**

| Problem | Relation | Means of solution |
|---|---|---|
| NFC ↔ NFD | canonical equivalence | **normalization** (this chapter) |
| `ﬁ` ↔ `fi` | compatibility equivalence | normalization (NFKC) — but information loss |
| Latin `a` ↔ Cyrillic `а` | **not equivalent** | UTS #39 confusable detection (skeleton algorithm), script-mixing restriction |

**This repository has no homoglyph handling, and there is no reason it should.** Because the threat model
differs. The two strings this code compares are (a) a file name on the user's own disk and (b) a work title the
site the user specified told. **There is no actor who gains from making the two names look the same.** Misjudge
and the result is "re-receive the episode" or "skip the episode," and the latter is blocked by designing the code
to give up when ambiguous.

Where homoglyphs become a real threat is a **system where the name is itself identity or authority** — a domain
name (IDN homoglyph attack), an account name, a package repository's package name, a code repository's
organization name. For such a system, normalization alone is insufficient and UTS #39's confusable detection and
script-mixing restriction are separately needed. **Bundle that with this chapter's normalization as the same
problem and you solve both wrong.**

---

## 31.8 Limits and open questions

Written honestly.

- **The code comment diverges from the current APFS behavior.** The narrative "the macOS filesystem stores Hangul
  as NFD" in [`naming.py:123`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L123) and [`inventory.py:208`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L208) is HFS+-based. The result measured on this repository's
  working volume (APFS) was **notation preservation** as in §31.3. The conclusion that normalization code is
  needed stands (§31.3's four paths), but **the fact given as the basis does not hold on today's default
  filesystem.** Fixing the comment is right.

- **HFS+'s actual behavior could not be measured in this environment.** With no HFS+ volume it could not be
  confirmed. It is documented that HFS+ uses not pure NFD but **a variant decomposition excluding some code-point
  ranges**, but I did not confirm that range directly. §31.3's table's HFS+ row is based on literature, not
  measurement.

- **The regression test cannot fix the NFC conversion** (§31.5.3). A fact confirmed by measurement. Since the
  1,187 Hangul fragments in `tests/run.sh` are all NFC and APFS preserves the notation, while the test runs the
  normalization call is the identity function. The fix method is clear — when the test makes files, **mix in one
  NFD name** and assert that episode is recognized as stock. Only, that assertion **can still pass because of
  APFS's normalization insensitivity**, so it is surer to put a unit check calling `_key` directly together. This
  chapter proposes that change but did not apply it.

- **`series_of`'s group key is not normalized** (§31.5.2). A reproducible defect. To fix it you must make
  [`inventory.py:196`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L196)'s group key a normalized form and hold a separate display original. The reason the code was
  not changed in this chapter is two — (a) which to choose as the display name (the first met / the NFC-fixed one)
  is a separate decision, and (b) a regression test reproducing this defect must be put first, and that is
  entangled with the item above. **The fix spot is settled and not fixed.**

- **`_key` is not the exact caseless matching the Unicode standard defines.** The standard's canonical caseless
  match applies normalization twice as `NFD(casefold(NFD(x)))`. `_key` applies it once as `NFC(x).casefold()`. I
  confirmed that 26 characters whose fold result is not re-normalized actually exist (e.g. U+0390 GREEK SMALL
  LETTER IOTA WITH DIALYTIKA AND TONOS). Only, **I swept the whole single-code-point range (0x0–0x10FFFF) for
  cases the standard definition makes the same but `_key` splits, and there were 0.** I did not exhaustively check
  strings of several code points, so "no difference was observed in this code" is the verified extent.

- **§31.7.4's vector table is a structural organization, not an empirical demonstration.** That each item is a
  type reported as an actual vulnerability is confirmed by literature, but what this chapter reproduced directly is
  only §31.7.2·§31.7.3's string-conversion measurements. What system satisfies those conditions is known only by
  opening that system.

---

## 31.9 Summary

1. **Two strings that look the same can differ.** The Hangul `그렌라간` is 4 code points 12 bytes in NFC, 10 code
   points 30 bytes in NFD. `==` · `len()` · sort · hash all give different answers.
2. Unicode defines sameness in two layers — **canonical equivalence** (a different notation of the same letter)
   and **compatibility equivalence** (a different letter but the meaning gets through). The four normalization
   forms are the combination of these two equivalences and composition/decomposition. **Canonical (NFC/NFD) does
   not touch compatibility characters.**
3. **The filesystem's behavior depends on the volume.** HFS+ converts to decomposed to store, APFS preserves the
   notation but ignores the form on lookup, and exFAT·ext4 compare bytes as-is. Only in the last class can two
   notations **coexist.**
4. This code puts only **two** spots that fix to NFC — right before writing (`sanitize`) and right before
   comparing (`_key`). The former must be **reversible** so it does only canonical normalization, the latter is a
   **value to discard** so it adds separator removal and `casefold`.
5. `casefold` is different from `lower`. It is a **comparison-only operation changing even the length** with
   `ß`→`ss`, `ſ`→`s`, `ﬁ`→`fi`. In Hangul it is the identity, but at a spot making a comparison key `casefold` is
   right.
6. Remove the normalization and **it does not recognize the 27 episodes already received and re-receives them
   all.** And this code does not yet normalize `series_of`'s group key, so if two notations coexist in one folder
   it gives an **unreadable diagnostic message** `(그렌라간, 그렌라간)` and gives up.
7. **Normalization is a function that makes different strings the same.** If this property works **after**
   verification it becomes a bypass (CWE-180). The conditions are three — there is a verification, there is a
   conversion after it, and that conversion can produce a forbidden value.
8. **"You just need to avoid NFKC" is wrong.** `U+212A KELVIN SIGN` becomes ASCII `K` **by NFC alone**, and `ſ`
   becomes `s` **by `casefold` alone**. Every stage that changes the string is a danger zone.
9. Only, **in file-name creation the form choice is decisive.** The code points producing reserved characters are
   **0** for NFC and **25** for NFKC (`℀`→`a/c`, `︓`→`:`). The reason this code is safe is not the order but that
   it chose NFC — the order is now **incidentally** safe.
10. **Homoglyphs are not a normalization problem.** Latin `a` and Cyrillic `а` become the same under none of the
    four forms, nor should they. UTS #39's confusable detection is separately needed, and **this repository's
    threat model does not include it.**

---

**Next chapter** — this chapter dealt with the problem that the same name can have several notations. Chapter 32
deals with the opposite side. Even fixing the notation to one, **the moment that string becomes a filesystem
path** it hits another rule set — `/` divides the path, `:` Finder puts back, and `CON` cannot become a file on
Windows. What the one line `_UNSAFE_RE` blocks and does not block, and why the spot where a user-controlled string
becomes a path must always be reviewed, is the next chapter's subject.
