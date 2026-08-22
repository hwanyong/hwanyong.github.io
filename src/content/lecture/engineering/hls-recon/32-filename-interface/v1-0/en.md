---
title: "The Filename as an Interface"
description: "Reserved characters and portability"
date: 2026-08-01
version: '1.0'
tags: ['streaming', 'portability']
thumbnail: /images/lecture/thumb/hls-recon-32-filename-interface.svg
---
## 32.0 What this chapter answers

1. A filename is **an interface for whom** — how many read this string?
2. What characters does this code block, and what breaks if you do **not** block them?
3. When a name expresses a **relationship** between files, where does it go off?
4. When names collide, why not overwrite?
5. **At the spot where a user string becomes a path**, what must be reviewed?

---

## 32.1 The problem — the side deciding the name is not us

For this tool to store a file it needs a name. Trace the source of that name and all three are **outside the
code.**

| Source of the name | Anchor | Deciding actor |
|---|---|---|
| the piece at the end of the series address, if empty the `<title>` tag | `series.py:194,201-208` | the remote server |
| the `title` value inside the player-setting JS | [`series.py:310-316`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/series.py#L310-L316) | the remote server |
| the file path received via `-o/--output` | [`cli.py:662-665`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L662-L665) | a human |

The first two matter. **Most of the file name is decided by the remote server.** This tool takes that value and
makes it into a disk path as-is.

```python
# library.py:26-33
def place(base: Path, name: str, ext: str, series: str = "") -> Path:
    """Make `base/<series>/<name><ext>` (does not create the directory).

    Give series and it is used as the folder name — the work title the site told is more accurate
    than one derived from the file name (`천원돌파 그렌라간` vs `그렌라간`). Not given, the episode
    number at the end of the file name is stripped to split the series.
    """
    return series_folder(base, series or series_of(name)) / (sanitize(name) + ext)
```

The last line has **two path components** and both came from outside. The folder name is `series`, the file name
is `name`.

Set one actual title down and look.

```
천원돌파 그렌라간: 나선편 01
```

There is a colon. Do nothing and make a file with this string and on macOS it **is made.** And copy that file to
an exFAT external disk and it fails. Move it to Windows and it fails.

> **Term** — **exFAT (Extended File Allocation Table)**: a filesystem Microsoft made. It is the effective default
> format of USB external disks·SD cards, and its filename rules follow Windows's as-is.

Chapter 1's proposition appears again here — **being made and being made correctly are different.** And this
chapter's special circumstance is that the fact of being wrong **is never revealed at the spot where it was
made.**

---

## 32.2 The principle — one string, three grammars

> **Term** — **filename**: the string key pointing at an inode in a directory entry. It is **one component of a
> path**, and cannot itself contain a path separator. The filename of the path `a/b/c.mp4` is only `c.mp4`.

The reason a filename is hard is that the side reading this string is not one.

![Three sides read the same string and the three grammars do not know each other](/images/lecture/hls-recon/32-three-roles.svg)

*Figure 32-1 — three sides read the same string, and the three grammars do not know each other*

Organize the three roles and it is this.

| Role | Consumer | Grammar | Special characters |
|---|---|---|---|
| a name a human reads | the user | none — the meaning just has to get through | none |
| the filesystem's key | the kernel, the filesystem | path grammar | `/` (POSIX) · `\` `:` (Windows) · `\x00` |
| the shell·command-line argument | the shell, scripts, `exec` | token grammar | whitespace · `*` `?` `[` · `>` `<` `\|` · leading `-` |

The three grammars **do not know of each other's existence.** `그렌라간: 01/2화`, natural to a human, is two paths
to the filesystem and two arguments to the shell.

From here comes the definition of portability.

> **The set of portable names = the intersection of the allow sets of every filesystem it can reach.**

And **where it will reach we do not choose.** The user moves the received file to an external disk, uploads it to
a NAS, compresses it and sends it to someone. At that moment the name stands before the rules of a filesystem we
have never tested.

### 32.2.1 This filesystem now blocks almost nothing

The result of actually making files on APFS (macOS default). I made a file for each name in Python and recorded
only whether it succeeded.

| Name | Result | Note |
|---|---|---|
| `a:b` | **made** | not possible on Windows·exFAT |
| `a*b` `a?b` `a"b` `a<b` `a>b` `a\|b` | **made** | all Windows reserved characters |
| `a\b` | **made** | Windows path separator |
| `a\x01b` `a\tb` `a\nb` | **made** | control characters |
| `name.` `name ` | **made** | names unopenable on Windows |
| `a/b` | fail (`FileNotFoundError`) | interpreted as a **path**, not a name |
| `a\x00b` | fail (`ValueError`) | Python rejects it in the path string |

**What APFS rejects is only two — `/` and the null byte.** Everything else passes. That is, of the characters
`_UNSAFE_RE` blocks, **only two actually cause a problem locally — `/` and the null byte** — and the other eight
kinds **give no symptom on this machine now.**

This is the typical form of a portability defect.

> **It is not reproduced in the environment it was made. So it is not caught by a test either.**

`a/b`'s failure mode is worth noting too. The exception is not "there is a slash in the name" but
`FileNotFoundError` — the filesystem read it **not as a wrong name but as a file `b` under a nonexistent directory
`a`.** The name quietly became a path.

---

## 32.3 The code — the characters `_UNSAFE_RE` blocks and their basis

```python
# naming.py:23-26
# Characters unusable or troublesome in a file name.
# '/' is the path separator, ':' Finder shows back as '/' and some tools read it as a drive
# separator. The rest are Windows reserved characters — catches if the external disk is exFAT.
_UNSAFE_RE = re.compile(r'[/\\:*?"<>|\x00-\x1f]')
```

One regex has four different bases overlaid. Unpack them one by one.

| Character | In which grammar is it special | What breaks if not blocked |
|---|---|---|
| `/` | POSIX path separator | the name becomes **two path components.** the depth `place()` makes grows with the title content — that is, the name changes the directory structure |
| `\` | Windows path separator | an ordinary character on macOS, but move that name as-is to Windows and the path splits. it is also an escape character in the shell |
| `:` | HFS-era macOS's path separator, Windows's drive·stream separator | the Finder display flips to `/`, and on Windows it reads as a drive designation like `C:` or an NTFS alternate data stream (`file.txt:hidden`) |
| `*` `?` | Windows reserved characters, and **shell glob metacharacters** | a command like `rm *.mp4` catches unintended files too. the `*` in a name can collide with another name |
| `"` `<` `>` `\|` | Windows reserved characters, and the shell's quote·redirect·pipe | paste the name onto the command line as-is and a file is truncated or a command is executed |
| `\x00`–`\x1f` | control characters | `\x00` is the C string terminator (§32.7.2). `\n` breaks **every pipeline processing a file list line by line** — `ls \| while read f` reads one file as two |

> **Term** — **Alternate Data Stream (ADS)**: a feature letting NTFS attach several data streams to one file.
> Accessed in the form `name:streamname`. This is why a `:` in a file name is dangerous on Windows.

> **Term** — **glob**: the shell expanding `*` `?` `[]` as a filename pattern. The expansion is done **by the
> shell before the command runs**, so the program cannot know what its argument originally was.

About `:` distinguish honestly. The Windows·exFAT basis is written in the spec, and **the part that Finder shows
`:` back as `/` is a measurement this repository's comment recorded** ([`naming.py:24-25`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/naming.py#L24-L25)). While writing this
chapter I confirmed `a:b` is made at the POSIX layer (§32.2.1), but did not confirm up to Finder's display layer.

### 32.3.1 Why substitution and not removal

`_UNSAFE_RE.sub("_", …)` — it does not delete the problem character but **changes** it to `_`. The reasons are
two.

- **The character count is preserved.** A human seeing `천원돌파 그렌라간_ 나선편 01` can guess what was originally
  there. Delete it and it becomes `천원돌파 그렌라간 나선편 01`, losing the trace.
- **It does not collapse to an empty name.** If the title is `///`, removal makes an empty string.

But there is something substitution does not solve, and it must not be hidden. **Substitution makes name
collisions.**

```
sanitize("a/b") → "a_b"
sanitize("a:b") → "a_b"
sanitize("a?b") → "a_b"
```

Three different titles become one name. This is not a side effect but **an inevitability of an information-losing
operation.** A function sending different inputs to the same output is not injective, and not injective means
collisions arise.

**The price of this loss is received by the layer below.** §32.5's "does not overwrite" is exactly the spot that
receives it. It is a structure where the tidy layer asks a human back about the collision the sanitize layer
made.

### 32.3.2 The trailing dot and space — a defect invisible at the spot it was made

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

NFC normalization is Chapter 31's subject so I pass it here and look at `rstrip(". ")`.

Windows's Win32 API **silently removes the dots and spaces at the end of a path component.** As a result a
problem arises in both directions.

| Direction | What happens |
|---|---|
| when making on Windows | try to make `보고서.` and it becomes `보고서`. the name differs from the request |
| when opening on Windows what was made on macOS | a name `보고서.` **cannot be reached by a Win32 path.** the file is visible but does not open |

And §32.2.1's measurement gains meaning again here — **APFS makes both `name.` and `name ` with no complaint.**
So this defect never appears on the development machine and appears only after the user moves the file. The one
line `rstrip(". ")` is **code that pays in advance for what will happen on another OS.**

That `.strip()` erases even leading whitespace is a decision of the same lineage. A leading space pushes the file
to the front in name-order sorting, and quietly vanishes when a human copies the name to move it — **a character
that changes the identity judgment while being invisible** is not put in a name.

### 32.3.3 Where the order changes the result

`sanitize` walks five stages **in this order.**

```
NFC normalize  →  substitute reserved characters with _  →  strip()  →  rstrip(". ")  →  untitled if empty name
```

That the substitution comes **before** `strip()` yields an observable result. Control characters are in the
`\x00-\x1f` range so they are already `_`, and then they are not whitespace that `strip()` can erase. Actually
measured it is this.

```
sanitize("그렌라간01\n")  →  "그렌라간01_"
sanitize("\t그렌라간")    →  "_그렌라간"
```

A title scraped from HTML commonly has a newline at the end. That newline does not vanish but **remains as one
underscore.** The name does not break but it is probably not the intended result. Written as a limit in §32.8.

`return s or "untitled"` is a finish of the same nature. If the title is `"..."` or `"   "` an empty string
remains after the earlier stages, and **the filesystem does not accept an empty name.** The reason it does not
throw an exception here but gives an alternative name is that this function's call sites are all "the moment of
trying to store already-received data." Throwing away video already received because the name could not be set is
a bad cost trade.

### 32.3.4 The spot deciding the name is one

```python
# library.py:16-23
# Targets to gather into series folders. Sidecar files like subtitles move with the video.
MEDIA_EXTS = frozenset({".mp4", ".mkv", ".ts", ".m4v", ".mov", ".webm", ".avi"})
SIDECAR_EXTS = frozenset({".srt", ".vtt", ".ass", ".ssa", ".smi", ".sub", ".idx", ".json"})


def series_folder(base: Path, series: str) -> Path:
    """The spot for the series folder. The sole spot deciding the folder name."""
    return base / sanitize(series)
```

The comment's last sentence is this section's whole — **"the sole spot deciding the folder name."**

`naming.py`'s module docstring applies the same discipline to a different target.

```python
# naming.py:3-6
There are three places that must read the episode number: subtitle-filename candidates (`name_variants`),
neighbor-episode gathering (`episode_names`), series-folder placement (`series_of`). If the rule scatters,
somewhere `그렌라간1` and `그렌라간01` are seen as the same work and somewhere as different.
So the episode-number regex and range-notation interpretation are kept only in this module.
```

This is called the **SSOT (Single Source of Truth)** principle. Here it is narrated as an accuracy problem, but
the same structure is sharper in security.

> **If there are two or more sanitization·verification spots, one of them necessarily gets left out of updates.
> That left-out path is itself the bypass path.**

It is exactly the same discipline as Chapter 7's (URL normalization) "convert only once at the boundary," of the
same root as Chapter 31's "verify after normalizing." Actually, the spots calling `sanitize` in this repository
are only seven — [`library.py:23`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L23), [`library.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L33), [`library.py:77`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L77), `series.py:194,314,316`, and
[`cli.py:891`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L891). That the surface to audit is this narrow is SSOT's practical benefit.

---

## 32.4 The code — when the name expresses a relationship: the one dot of `sidecars`

A filename does not stop at pointing to one file. **A relationship between files** is also expressed by the name.
Video and subtitle are so.

```python
# library.py:43-54
def sidecars(media: Path, files: list[Path]) -> list[Path]:
    """The sidecar files paired with the video. The names continue like `영상01.srt`, `영상01.ko.srt`.

    Compare including the dot — otherwise when finding `영상01`'s sidecars, `영상010`'s get dragged in too.
    """
    prefix = media.stem + "."
    return [
        f
        for f in files
        if f != media and f.suffix.lower() in SIDECAR_EXTS and f.name.startswith(prefix)
    ]
```

> **Term** — **sidecar file**: a file placed beside the main file with the same name, holding the main file's
> auxiliary info. Here it is subtitles (`.srt`·`.vtt`) and the report (`.json`).

The one dot of `media.stem + "."` is this function's whole. Actually reproduced it is this.

| File list | without the dot `startswith("영상01")` | with the dot `startswith("영상01.")` |
|---|---|---|
| `영상01.srt` | caught | caught |
| `영상01.ko.srt` | caught | caught |
| `영상010.srt` | **caught (wrong)** | not caught |
| `영상010.ko.srt` | **caught (wrong)** | not caught |

What breaks. When `plan_tidy` moves episode 1 to the series folder it **drags episode 10's subtitle along too.**
And `inventory.scan` sees episode 1 as having two subtitle sets and judges episode 10 as having no subtitle, going
to re-receive it. File moves are hard to undo so this wrong answer hardens as-is on disk.

### 32.4.1 The principle — a prefix is not a boundary

Generalized it is this.

> **A prefix match of variable-length tokens cannot know the start of the next token, so it always over-matches.
> To make a boundary you must include the separator in the prefix.**

`영상01` is a prefix of `영상010`. Because the episode-number digit count is not fixed. Attach the dot and `영상01.`
is no longer a prefix of `영상010…` — **the separator proves the token's end.**

The same mistake repeats in different clothes.

| Situation | The wrong check | The value that passes | The right form |
|---|---|---|---|
| file pairing | `name.startswith(stem)` | `영상010.srt` | compare with `stem + "."` |
| path containment | `path.startswith("/srv/public")` | `/srv/public-backup` | compare component-wise or with `/srv/public/` |
| origin check | `origin.startswith("https://example.com")` | `https://example.com.evil.net` | compare the parsed host by **exact match** |
| domain check | `host.endswith("example.com")` | `notexample.com` | `host == d or host.endswith("." + d)` |

**In file pairing it is one extra subtitle attaching, but in an origin check it is authentication bypass.** The
principle is one and only the damage differs.

### 32.4.2 Where normalization is needed and where it is not

`sidecars` compares strings as-is. It does neither Unicode normalization nor case folding. After reading Chapter
31 this looks like a defect. But at this spot it is not.

**Because the two strings compared came from the same source.** `media` and `files` are both the same
`root.iterdir()` result ([`library.py:64-65`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L64-L65), [`inventory.py:181`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L181)). If macOS returns names as NFD both are NFD, and then the
prefix comparison matches exactly.

Look at the opposite side and the contrast is clear.

```python
# inventory.py:205-211
def _key(s: str) -> str:
    """The comparison form — match to NFC and remove whitespace·separators.

    The macOS filesystem returns Hangul in the jamo-separated form (NFD) and the work title the site
    told is the composed form (NFC). Without normalizing, two strings that look the same go off.
    """
    return re.sub(r"[\s._-]+", "", unicodedata.normalize("NFC", s)).casefold()
```

`_key` compares **a filename from disk** and **a work title from the web.** The sources are two so the notation
rules are two, and so normalization is essential.

> **Whether normalization is needed is decided not by the string's content but by its source. Two strings from
> the same source already follow the same rules, and two strings from different sources must necessarily be
> matched.**

---

## 32.5 The code — an irreversible operation asks a human

When deciding the name is done, moving the file remains. `plan_tidy` and `apply_tidy` **split that work into
two.**

```python
# library.py:57-87
def plan_tidy(root: Path) -> list[Move]:
    """Plan gathering episode files scattered right under the folder into series folders.

    What is moved is only videos where **there are two or more episodes tying into the same series**.
    Put even a file with no episode number (one movie) or a lone episode into a folder and only
    single-file folders multiply, making it harder to find. Subfolders are seen as already tidied and not touched.
    """
    files = sorted(p for p in root.iterdir() if p.is_file() and not p.name.startswith("."))
    media = [f for f in files if f.suffix.lower() in MEDIA_EXTS]

    groups: dict[str, list[Path]] = {}
    for f in media:
        if split_episode(f.stem) is None:
            continue  # no episode number — no basis to see it as one episode of a series
        groups.setdefault(series_of(f.stem), []).append(f)

    moves: list[Move] = []
    for series, members in sorted(groups.items()):
        if len(members) < 2:
            continue
        folder = root / sanitize(series)
        for m in members:
            for src in [m, *sidecars(m, files)]:
                dest = folder / src.name
                skip = ""
                if dest.exists():
                    skip = "a file of the same name already exists"
                elif folder.exists() and not folder.is_dir():
                    skip = "a file of the same name occupies the folder's spot"
                moves.append(Move(src=src, dest=dest, skip=skip))
    return moves
```

This function **does not change the filesystem by a single letter.** The return value is a plan.

> **Term** — **plan/apply separation**: a structure separating the stage computing what to do from the stage
> actually doing it, with a human's confirmation between them. Terraform's `plan`/`apply` and a package manager's
> `--dry-run` are the same form.

### 32.5.1 The skip reason is a string, not a boolean

```python
# library.py:36-40
@dataclass
class Move:
    src: Path
    dest: Path
    skip: str = ""  # if not empty, do not move — the reason
```

Had `skip` been a `bool`, `plan_tidy` could say only up to "cannot move." Thanks to keeping it a string, that
value goes to a human as-is.

```python
# cli.py:964-966
mark = "·" if not mv.skip else "✗"
note = f"   ({mv.skip})" if mv.skip else ""
_eprint(f"    {mark} {mv.src.name}{note}")
```

**Not knowing why it was skipped, the user cannot fix it.** "a file of the same name already exists" and "a file
of the same name occupies the folder's spot" have entirely different responses — the former is confirming a
duplicate receive, the latter is clearing that file away.

### 32.5.2 Why not overwrite

```python
# library.py:90-104
def apply_tidy(moves: list[Move]) -> tuple[int, int]:
    """Move as planned. Returns: (moved count, skipped count).

    Skipped items are left as-is — overwriting is irreversible, and that names collide means
    the same episode was received twice, which is a human's matter to confirm.
    """
    done = skipped = 0
    for mv in moves:
        if mv.skip or not mv.src.exists():
            skipped += 1
            continue
        mv.dest.parent.mkdir(parents=True, exist_ok=True)
        mv.src.rename(mv.dest)
        done += 1
    return done, skipped
```

The basis is written in two comment lines, and the two differ in nature.

| Basis | Nature |
|---|---|
| **overwriting is irreversible** | a property of the operation — reversibility |
| **that names collide means the same episode was received twice** | domain knowledge — the meaning of the collision |

Generalize the former basis and it becomes this section's principle.

| Operation | Reversibility | This code's handling |
|---|---|---|
| file move | reversible — move it back | does it automatically |
| folder creation | reversible — delete it if empty | does it automatically (`mkdir(parents=True, exist_ok=True)`) |
| **overwrite** | **irreversible — the original vanishes** | **does not do it. skips with a reason** |
| deleting a damaged existing file | irreversible | does not do it — only notifies a human ([`cli.py:930-932`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L930-L932)) |

> **A reversible operation the tool does, and an irreversible operation a human decides.**

And §32.3.1's thread connects here. **A name collision may be one that originally was not there but arose because
of `sanitize`** — `작품: 특별편` and `작품/특별편` become `작품_ 특별편` and `작품_특별편` respectively, but `작품:편` and
`작품?편` become exactly the same `작품_편`. What the upper layer lost, the lower layer receives by "asking a human."
**It is the spot where the responsibility division between layers is revealed in code.**

### 32.5.3 The default is preview, running is explicit

```python
# cli.py:968-971
movable = sum(1 for m in moves if not m.skip)
if not args.apply:
    _eprint(f"\n  preview — {movable} can be moved. attach --apply to run")
    return 0
```

The default is the safe side. And the regression test fixes this default itself.

```bash
# tests/run.sh:323-325
"$RECON" --tidy "$TIDY" >"$WORK/out/tidy1.log" 2>&1
[[ -f "$TIDY/모아모아01.mp4" && ! -d "$TIDY/모아모아" ]] \
  && ok "preview does not move files" || bad "moved without --apply"
```

Collision avoidance has a test attached the same way.

```bash
# tests/run.sh:335-339
# If a file of the same name already exists, do not overwrite — it is an irreversible loss.
: >"$TIDY/모아모아01.mp4"; : >"$TIDY/모아모아02.mp4"
"$RECON" --tidy "$TIDY" --apply >"$WORK/out/tidy3.log" 2>&1
[[ -f "$TIDY/모아모아01.mp4" ]] && grep -q 'a file of the same name already exists' "$WORK/out/tidy3.log" \
  && ok "name collision is skipped" || bad "overwrote on a collision"
```

It looks at **both** whether the file remains (`-f`) and whether the reason was output (`grep`). Confirm only the
file and an "implementation that does nothing" passes, confirm only the message and an "implementation that emits
the message and overwrites" passes. The form of Chapter 37 (bidirectional fixing) is here too.

### 32.5.4 The gap between check and use

There is something to write honestly. The `dest.exists()` check happens in `plan_tidy` ([`library.py:82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L82)), and the
actual `rename` happens in `apply_tidy` ([`library.py:102`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L102)). Between them there is time.

> **Term** — **TOCTOU (Time-Of-Check to Time-Of-Use)**: a defect arising from assuming the checked state remains
> the same at use time. If the state changes in that gap, the check passed but the action is applied to a
> different target.

What happens if another process makes a file of the same name in that gap. POSIX's `rename(2)` **atomically
replaces if the target already exists.** Python's `Path.rename` exposes this behavior as-is on Unix, so a move
that passed the check ends up **overwriting.** Change to `Path.replace` and the result is the same — the two
methods differ only on Windows.

To actually close this gap you must first try `os.link()` (get `EEXIST` if the target exists) and delete the
original, or preempt the spot with `os.open(..., O_CREAT | O_EXCL)`. This tool presupposes a single user running
one at a time in their own download folder so it keeps the current structure, but that **the premise is not
written in the code** is a limit.

---

## 32.6 Generalization — the spot where a string becomes input of another grammar

This chapter's structure is not limited to filenames. The common form is this.

> **At the spot where some string becomes input of another grammar, that grammar's special characters must
> necessarily be handled. There are only three ways — reject · escape · replace.**

| Domain | User string | Whose grammar it enters | If not handled |
|---|---|---|---|
| file storage | title, uploaded filename | path grammar | path traversal, portability breakage |
| shell call | filename, argument | shell token grammar | command injection, argument injection (a name starting with `-rf`) |
| SQL | search term, identifier | SQL grammar | SQL injection |
| HTTP response header | user name, redirect target | header grammar (CRLF) | response splitting |
| log | arbitrary input | line-oriented log grammar | log forging — injecting a fake log line |
| CSV export | cell value | spreadsheet formula grammar | CSV injection (a value starting with `=`, `+`, `-`, `@`) |
| archive extraction | a path inside the archive | path grammar | Zip Slip — a file written outside the archive |
| HTML output | arbitrary text | HTML grammar | XSS |

In each row, if the left holds the right grammar's special characters that grammar is warped. The name differs
but the structure is one.

**Which of the three handling methods to choose** is decided by the target grammar.

| Method | Holding condition | In this code |
|---|---|---|
| **reject** | when normal input does not use that character | cannot be used — a colon in a title is common. reject and you cannot receive normal content |
| **escape** | when the target grammar has an escape notation | **there is none.** the filesystem does not turn `\/` back into a slash |
| **replace** | the sole choice when the above two do not work | adopted. the price is §32.3.1's name collision |

> **In a grammar with no escape notation, replacement is the sole choice, and replacement necessarily makes
> collisions. Designing where to receive that collision is the remaining work.**

HTML (`&lt;`) and SQL (parameter binding) have escaping, and so lose no information. The filesystem does not. This
difference is the root cause making the filename problem uniquely messy.

---

## 32.7 Security — the spot where a user string becomes a path

![A string from outside becomes a path through one gate](/images/lecture/hls-recon/32-name-boundary.svg)

*Figure 32-2 — a string from outside becomes a path through one gate*

This diagram's left column is the **trust boundary.** As confirmed in §32.1, most of a file name is decided by
the remote server. That is, the "user-controlled string" here is not the person using the tool but **the string
the counterpart server controls.**

### 32.7.1 Path traversal — the reason it is blocked is not that `..` is blocked

> **Term** — **path traversal (directory traversal)**: an attack putting `..` or a path separator in input to
> read or write a file outside the intended directory.

Say the remote server sent the work title down as `../../etc/passwd`. The actual result is this.

```
sanitize("../../etc/passwd")  →  ".._.._etc_passwd"
```

It became **one name**, not a path. But point out exactly why it was blocked.

- `..` was not filtered. It remains as-is as `.._..`.
- What blocked it is that **the separator `/` was substituted with `_`.**

`..` by itself is not dangerous. **Only when combined with a separator** does it mean the parent directory.
Without a separator, `..` is just a two-dot name.

Here one coincidence overlaps. If the title is exactly `".."`, `rstrip(". ")` erases the dots and it becomes an
empty string, and `or "untitled"` receives it. That is, `sanitize("..")` is `"untitled"`. **But this is not a
rule aimed at path traversal but the Windows-portability rule happening to catch the same input.** Borrowing
Chapter 15's term it is an **incidental defense**, and the moment someone judges "we decided not to support
Windows so let's remove `rstrip`" that defense vanishes — **and no one knows that fact.**

Compare the defense strategies and the nature of what this code chose is clear.

| Strategy | What it does | What it catches | What it does not catch |
|---|---|---|---|
| **pre-sanitization** (this code) | remove the separator **before** joining to guarantee one component | depth increase, escaping upward | symbolic links, the property of an existing path |
| **post-verification** (`tests/gzip_server.py:22-25`) | after joining, `resolve()` and confirm it is inside the root | the actual reach point including symbolic links | permits depth increase **inside** the root |

The reason this code chose pre-sanitization is that the requirement differs. What is needed here is not "inside
the root is fine" but **"the path component must be exactly one."** The folder name and the file name must each be
one component, so the requirement cannot be expressed by post-join verification.

> **Sanitization and validation are different jobs.** Sanitization changes the value and validation judges the
> value. It is common for both to be needed, and believing you did one and thinking you did the other is a
> typical mistake.

### 32.7.2 Null-byte truncation

> **Term** — **null-byte injection**: a C string ends at `\x00`, but a string in a language holding the length
> separately (Python·Java, etc.) does not. At the boundary where the two representations meet the string is
> **truncated.**

The classic form is this.

```
upload name:     "shell.php\x00.jpg"
high-level check: the extension is .jpg  → pass
low-level store:  passing to a C string it is cut at \x00 → stored as shell.php
```

**The checked string and the actually-used string differ.** It is a defect of the same lineage as TOCTOU but the
cause is not time but **a mismatch of representation.**

In this code `\x00` is in the `\x00-\x1f` range so it is substituted with `_` (measured: `sanitize("ep01\x00.mp4")`
→ `"ep01_.mp4"`). Only, written honestly, **in modern Python the truncation does not happen even without this
substitution.** Because if there is a null byte in the path it is rejected with `ValueError: embedded null byte`
(confirmed by measurement). That is, `\x00` substitution's practical effect here is **not vulnerability defense
but exception prevention.**

But that safety is only inside the Python runtime. The name this tool makes soon passes to a shell script, to
`rsync`, to a backup tool written in C. **The moment it crosses a language boundary the null byte's meaning
revives.** That is why removing it at the name-making side is right.

### 32.7.3 Reserved device names — what this code does not handle

Windows has things where not a character but **the whole name** is reserved.

```
CON  PRN  AUX  NUL  COM1…COM9  LPT1…LPT9
```

These names pointed at devices in the MS-DOS era, and are still specially treated in Win32 path interpretation.
Attaching an extension does not unreserve them — `CON.txt` is also `CON`.

This code does not handle this. The measurement.

```
sanitize("CON")      →  "CON"
sanitize("PRN.txt")  →  "PRN.txt"
sanitize("nul")      →  "nul"
```

Organize what breaks in a threat model.

| Item | Content |
|---|---|
| what the attacker can do | make a remote page's work title `CON` |
| the environment this tool runs in | macOS·Linux — there are no reserved device names so **the file is made normally** |
| when the actual damage happens | when moving that file **to Windows** — the unzip·copy fails, or on an old path-interpretation path it is opened as a device |
| the damage size | up to being unable to move one file. a path leading to remote code execution or information leak was not confirmed |

**A small damage can be a reason not to handle it. But if you do not write that judgment down, it is
indistinguishable from "did not know."** To fix it, at `sanitize`'s end uppercase the part before the first dot,
compare against the reserved list, and if it catches attach a suffix (`_`) — a few lines but not in the current
code.

### 32.7.4 When a prefix check is on an authentication path

Re-read §32.4.1's table from the security view. That `영상01` is a prefix of `영상010`, and that
`https://example.com` is a prefix of `https://example.com.evil.net`, are the **same property.** If the separator
cannot prove the token's end, the check always over-permits.

The one dot of `sidecars` gains meaning here — this repository's comment explains that dot as subtitle
mis-matching, but **the same one character, on an origin check, is the code blocking authentication bypass.**

### 32.7.5 The defender's view

| Role | What to do |
|---|---|
| **tool·client implementer** | gather the name-making spot into one (`series_folder`'s "sole spot"). the function to audit must be one for auditing to be possible |
| **server·platform implementer** | **do not use the uploaded filename as the storage name.** store with an opaque ID and keep the original name only in a metadata column. when displaying, re-escape to match the grammar of that spot (HTML) |
| **the archive-extracting side** | a path inside an archive is a value the archive author set — sanitize per component, and after joining verify **again** with `resolve()` (Zip Slip) |
| **the side with a portability target** | decide by the final destination's filesystem rules. if the development machine's filesystem is lenient the defect appears **only in the user's hands** |
| **auditor** | ask distinguishing "sanitized" and "validated." **which grammar the sanitization targeted**, and whether that grammar is really the only one (filesystem + shell + display layer) |

---

## 32.8 Limits and open questions

Written honestly.

- **It does not handle reserved device names.** Confirmed by measurement in §32.7.3. Leaving it because the damage
  is judged small and leaving it out of ignorance are different, but **that judgment is not written in the code.**
- **There is no name-length cap.** The result measured for APFS in this chapter had **255 characters** as the
  boundary — 255 Hangul characters (UTF-8 765 bytes) pass and 256 characters is `ENAMETOOLONG`. Meanwhile a common
  Linux filesystem like ext4 is known to have **255 bytes** as the cap, and if so a Hangul title passes up to 85
  characters (exactly 255 bytes) and catches at 86. **This Linux figure was not confirmed in this chapter — it is
  inference.** Either way, the current structure where a long title becomes the name as-is is open to
  truncation·failure.
- **The name collision substitution makes is not received anywhere on the `place()` path.** `plan_tidy` skips a
  collision with a reason (§32.5.2), but confirming a collision on a newly-receiving path is only the series mode
  ([`cli.py:894-895`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L894-L895)). The single run (`_run_single`) has no such confirmation.
- **A control character at the name's end leaves an underscore.** Measured: `sanitize("그렌라간01\n")` →
  `"그렌라간01_"`. Because the substitution comes before `strip()` (§32.3.3). Harmless but does not look like the
  intended result.
- **It does not filter a leading dot.** A title like `.hack//SIGN` becomes `.hack__SIGN` and is a **hidden file**
  on POSIX. And since `plan_tidy` ([`library.py:64`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L64)) and `inventory.scan` ([`inventory.py:181`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L181)) both filter with
  `not p.name.startswith(".")`, files of this name **are invisible in tidying and in inventory both.** There is no
  case reproduced with an actual stream and it was confirmed only by `sanitize`'s output.
- **The TOCTOU window is open.** §32.5.4. It is a single-user premise, and that premise is not stated in the code.
- **There is no rollback for a partial failure.** If a `rename` throws an exception mid-`apply_tidy` it is left
  partially moved. Only, `plan_tidy` does not save the plan and **re-plans from the current state each time**, so
  re-running continues moving from what remains — not a complete transaction but re-running is safe.
- **It does not handle case equivalence.** APFS by default is case-insensitive so `Video01.mp4` and `video01.mp4`
  are the same file, but `sidecars`'s string comparison sees them as different. It is the spot where the
  filesystem's identity judgment and the code's identity judgment go off. **A case that actually became a problem
  in this repository could not be confirmed.**

---

## 32.9 Summary

1. **Most of the file name is decided by the remote server** (`series.py:194,310-316`). That string becomes two
   path components in the one line `place()` ([`library.py:33`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/library.py#L33)). Here is the trust boundary.
2. A filename is **an interface where three roles overlap** — a name a human reads, the filesystem's key, the
   shell's argument. The three grammars do not know each other, and a portable name is **their intersection.**
3. **What APFS rejects is only `/` and the null byte** (measured). The rest `_UNSAFE_RE` blocks give no symptom on
   the development machine so they are **not caught by a test.** It is typical of a portability defect.
4. Removing the trailing dot·space is **code that pays in advance for what will happen on another OS.** Windows
   can neither make nor open such a name.
5. **In a grammar with no escape notation, replacement is the sole choice, and replacement necessarily makes name
   collisions.** `apply_tidy` receives that collision by "not overwriting and skipping with a reason" — a
   structure where the lower layer asks a human back about the upper layer's information loss.
6. The one dot of `sidecars` handles **the fact that a prefix is not a boundary.** If the same mistake is in path
   containment·origin check, only the damage differs — not one subtitle but authentication bypass.
7. **Whether normalization is needed is decided by the string's source.** Two names from the same `iterdir()`
   already have the same notation, and two names each from disk and web must necessarily be matched
   ([`inventory.py:205-211`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/inventory.py#L205-L211)).
8. The reason path traversal is blocked is not that `..` is blocked but that **the separator is removed.** Sending
   `".."` itself to `untitled` is a side effect of the Windows rule — an **incidental defense**, and if that rule
   vanishes it vanishes with it.
9. **Sanitization and validation are different jobs.** This code chose pre-sanitization and it fits the
   requirement, but reserved device names·the length cap it neither sanitizes nor validates.

---

**Next chapter** — this chapter's `sanitize` was a rule that **changes** a string. Chapter 33 covers a rule that
**splits** a string, i.e. `EPISODE_RE`. Omit one negative lookbehind `(?<!\d)` and `Sky.Blue.2003` splits into the
stem `Sky.Blue.2` and the episode number `003`, and one movie becomes episode 3 of a nonexistent series. How the
accuracy of one regex fragment becomes the misclassification rate as-is, and what the same kind of mistake becomes
when it is on an authentication path, is what we see.
