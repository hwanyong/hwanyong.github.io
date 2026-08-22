---
title: "The Ambient Authority of Credentials"
description: "Cookies, process lists, artifacts"
date: 2026-06-15
version: '1.0'
tags: ['streaming', 'security']
thumbnail: /images/lecture/thumb/hls-recon-12-ambient-credentials.svg
---
## 12.0 What this chapter answers

1. What is **ambient authority**, and why is a cookie its archetype?
2. Why does this code **not parse** the cookie value — what breaks if it parses?
3. What does the one line that strips newlines from a header value block?
4. Where does a pasted cookie line **leave copies** — exhaustively?
5. Is `_redact_headers`'s redaction-target list complete?

The fifth question is this chapter's peak. This repository has code that hides credentials in the report
JSON, and that code **hides exactly what is enumerated.** Counting what is not enumerated is this chapter's
last section.

---

## 12.1 The problem — the moment you paste one line

The access control seen in Chapters 9–11 all rested on **what the requester knows.** Does it know the Referer
(Chapter 9), did it read the origin the server leaked (Chapter 10), does it have a valid signature and expiry
time (Chapter 11). But there is a delivery that opens by none of those. The case where a session is needed.

This repository's README wrote the manipulation for that case like this (`README.md:213-222`).

> There is a CDN that does not open by the token URL alone and demands a session cookie. In the browser
> devtools Network tab find the `.m3u8` request and **copy the `Cookie` value from Request Headers as is**
> and paste it into `--cookie`.

```bash
hls-recon URL -o out.mp4 --cookie 'sid=abc; token=xyz'
hls-recon URL -o out.mp4 --cookie 'Cookie: sid=abc; token=xyz'   # a prefix is allowed
```

A one-line manipulation. And what this one line does is bigger than it looks.

Inside the browser that cookie was **attached automatically.** The user did not consciously do it, the code
did not specify it, and yet the browser carried it on every request going to that domain on its own. The
moment you copy it and place it on the command line, that cookie becomes **an explicitly passed string.** Its
nature changes — and when the nature changes, the places it remains change too.

The rest of this chapter is the work of making that sentence precise.

---

## 12.2 The principle — ambient authority

### 12.2.1 Definition

> **Term** — **ambient authority**: **the authority the execution environment grants automatically** even
> without the requesting subject specifying it explicitly. The request says only "what I will do," and "with
> what qualification" the environment fills in on its own.

Ambient authority is not an exceptional concept but close to computing's default. List a few and the same
structure repeats.

| Environment | What is specified | What the environment attaches automatically |
|---|---|---|
| Unix file open | the path | the calling process's uid·gid |
| browser HTTP request | URL·method | that domain's cookie, client certificate |
| AWS SDK call | API name·parameter | temporary credentials from instance metadata |
| internal-network service call | the endpoint | the source IP (= the very fact of being inside the network) |

All four rows have the same property. **The credential is not visible at the call site.** Read the code and
"under whose authority does this request go out" is not written; only the environment at execution time knows
it.

The concept placed on the opposite side is a capability.

> **Term** — **capability**: a way where the value indicating the authority is itself carried explicitly in
> the request, and only the one holding that value exercises that authority. Chapter 11's signed URL
> (`?md5=<signature>&expires=<unix>`) is that example — the authority is inside the address string.

Set the two ways' difference in a table and it reveals where this chapter's problem comes from.

| Item | Ambient authority (cookie) | Capability (signed URL) |
|---|---|---|
| Where the authority resides | the execution environment (the browser's cookie store) | the value itself (the URL string) |
| How it is carried in the request | automatically | explicitly |
| Scope | the whole domain·the whole account | one signed resource |
| Lifetime | until the session or expiry date (long) | until `expires` (short) |
| The path it leaks by accident | few — no one carries it by hand | many — the address is the authority so it leaks by copy·log·referer |
| The way it is misused | **CSRF** — it attaches automatically even to an unintended request | **replay** — anyone who got the address uses it until expiry |

The last two rows are the crux. **The two ways are a relationship of trading each other's weaknesses.**

### 12.2.2 CSRF is a direct consequence of ambient authority

> **Term** — **CSRF (Cross-Site Request Forgery)**: an attack that makes another site B send a request,
> through the user's browser, to site A the user is logged into. Since the browser carries A's cookie
> automatically, A cannot distinguish that request from a legitimate user's.

The reason CSRF holds is not a bug but a definition. That a cookie is ambient authority means **"it attaches
regardless of who induced the request,"** and a request an attacker induced enters the scope of that
"regardless." The vulnerability is not in the browser but in **the automaticity itself.**

So CSRF response can go only two directions.

| Direction | Means | What it does |
|---|---|---|
| **demand one more capability** | CSRF token, double-submit cookie | demand an additional non-ambient value — the attacker does not know it |
| **narrow the automaticity itself** | `SameSite=Lax`/`Strict`, `Sec-Fetch-Site` check, Origin-header verification | do not attach the cookie to a cross-origin request, or refuse it even if attached |

Why the `SameSite` attribute came up belatedly (after 2016) even in browser-default discussions is explained
here — it is not a new feature but **the work of reversing, 20 years later, an automaticity decided in 1994.**
Because there was already a web built on that automaticity, reversing it took that long.

### 12.2.3 What this tool actually does

Now we can write §12.1's sentence precisely.

> `--cookie` is **the manipulation of taking ambient authority that was inside the browser and turning it
> into a bearer token.**

> **Term** — **bearer token**: a credential where whoever presents the value is treated as the authorized
> party. Possession itself is the qualification, and the holder's identity is not separately verified.

While inside the browser that cookie was not moved. It was in the cookie store, may have had `HttpOnly` set so
JavaScript could not read it, and only the browser's request code referenced it. The moment you paste it on
the command line all that isolation disappears. The value is now **an ordinary string the shell handles**, and
everything the shell does to a string — record, pass, expose — applies to that value.

§12.5 counts that "everything" exhaustively. Before that we see the code that handles the value.

---

## 12.3 Code ① — it does not parse the cookie

### 12.3.1 The whole function

```python
# cli.py:39-54
def _normalize_cookie(raw: str) -> str:
    """Normalize a pasted cookie string into a Cookie header value.

    Copy from devtools and the header name (`Cookie:`) comes along or newlines get mixed in.
    A newline left in a header value makes the request itself rejected, so join into one line.

    The cookie value itself is not touched — by spec a value can contain almost any character,
    so splitting into name/value and reassembling makes a cookie whose original is damaged. pass it whole.
    """
    s = raw.strip().strip("\"'").strip()
    if s[:7].lower() == "cookie:":
        s = s[7:].lstrip()
    s = "; ".join(part.strip().rstrip(";") for part in s.splitlines() if part.strip())
    if "=" not in s:
        raise SystemExit(f"--cookie format is wrong (need name=value; name2=value2): {raw[:60]}")
    return s
```

It is right to see what this function **does not do** first. It does not decompose into name·value pairs, does
not inspect individual cookies, and does not reassemble. What it touches is only four things.

| Operation | Target | Why |
|---|---|---|
| `strip()` → `strip("\"'")` → `strip()` | both ends of the string | when pasting from the shell with the quotes included |
| `s[:7].lower() == "cookie:"` | the prefix | devtools copies the header name along |
| `splitlines()` → `"; ".join(...)` | newlines | **§12.4's subject** |
| `"=" not in s` | a minimal format check | fail immediately when a wrong value is entered |

All four operations act only on **the delimiters and the shell.** The interior of the value passes through.

### 12.3.2 What breaks if you parse

The comment says only "by spec a value can contain almost any character." Unfold that sentence into concrete
counterexamples and it is as follows.

The grammar of one cookie pair RFC 6265 defines is `cookie-pair = cookie-name "=" cookie-value`, and
`cookie-value` is a US-ASCII string excluding `;`·`,`·space·backslash·double-quote·control characters. **`=`
is not on the exclusion list.** That is, however many `=` can be inside a value.

This is not a theoretical margin but an everyday form.

| The value's form | Why `=` goes in |
|---|---|
| Base64-encoded session state | the padding character is `=` or `==` |
| a URL-encoded struct | it is common for an implementation not to escape it into `a%3Db` form |
| a value with a signature attached | an implementation putting `payload=…&sig=…` whole into one cookie |

Therefore `name, value = pair.split("=")` dies immediately with a `ValueError` if the value has a `=`, and
even fixing it to `split("=", 1)` the next step is the problem. Code that, after getting the name and value,
reassembles with `f"{name}={value}"` stands on **the assumption that the round trip is the identity**, and
that assumption breaks the next moment.

- The moment you `strip()` the whitespace around the value — whitespace the server put meaningfully disappears
- The moment you URL-decode the value and re-encode it — the **non-idempotency of encoding** seen in Chapter 7
  reproduces as is. It is the cookie version of the `%2520` problem
- The moment you round-trip the value through a library whose `quote`/`unquote` rules differ

This repository's choice is to **not do that round trip at all.** Confirmed by measurement, a `=` inside the
value passes through.

```
>>> _normalize_cookie("sid=a=b=c; t=x;y;z")
'sid=a=b=c; t=x;y;z'
```

Both `sid`'s value `a=b=c` and `t`'s value `x;y;z` remained undamaged.

> **What breaks if you do not do this** — on a site where the login-session cookie's value is Base64 so it
> ends in `==`, a client that "parses and tidies the cookie" sends a truncated value. The server does not find
> the session and returns 401 or 403. The symptom the user sees is **"login does not work even though I pasted
> the cookie correctly,"** and the cause is inside their own tool. This failure is especially hard to diagnose
> — since the server response is "authentication failure," the user keeps trying by re-copying the cookie.

### 12.3.3 The general form of the choice "do not parse"

This decision is not isolated in this repository. The same form repeats.

| Location | What passes through | What is touched |
|---|---|---|
| `_normalize_cookie` ([`cli.py:39-54`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L39-L54)) | the whole cookie value | the shell·newlines |
| `normalize_url` ([`fetch.py:36-54`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/fetch.py#L36-L54)) | an already-encoded `%` | non-ASCII not encoded |
| `sniff` ([`tsanalyze.py:20-37`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/tsanalyze.py#L20-L37)) | the segment bytes | — (only determines, does not transform) |
| `concat_segments` ([`assemble.py:93-105`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L93-L105)) | the whole segment bytes | — (joins as is) |

It is summarized by one principle running through them.

> **Data whose meaning you need not know is moved without interpreting. Interpretation is always a possibility
> of loss.**

This principle appears again in Chapter 13. It is the same family as `series.py`'s decision to **parse but not
execute** packed JS — interpret only the minimum you handle.

---

## 12.4 Code ② — why strip one newline

### 12.4.1 That one line

```python
# cli.py:51
    s = "; ".join(part.strip().rstrip(";") for part in s.splitlines() if part.strip())
```

The comment writes the reason in one sentence only — **"a newline left in a header value makes the request
itself rejected, so join into one line."** What is behind this sentence is this section's subject.

### 12.4.2 Request splitting and header injection

> **Term** — **HTTP request splitting**: an attack that pushes a CRLF (`\r\n`) into a request header's value
> to make the receiving side **read one request as two.** When only one extra header is added it is called
> **header injection**, and when even a new request line is made it becomes request splitting. When the same
> thing happens on the response side it is **HTTP response splitting.**

The conditions for it to hold are exactly three, and it holds only when all three are true.

| Condition | Content | In this code |
|---|---|---|
| ① control of the value | the attacker can decide part of the header value | the party putting the value is the user themselves |
| ② serialization without validation | that value is written into the header block as is without checking | **differs per path — §12.4.3** |
| ③ text framing | the receiving side interprets CRLF as a header boundary | true if HTTP/1.1 |

③ is the important condition. HTTP/1.1 is a text protocol and the header boundary is set by a **delimiter
character** (CRLF). When the delimiter character can go inside the data, the same kind of attack always
arises — exactly the same structure as the quote in SQL injection, the semicolon in shell injection, the comma
in CSV injection.

Since HTTP/2, headers are carried in length-prefixed binary frames (HPACK in HTTP/2, QPACK in HTTP/3), so this
vector does not hold as is. Only, a case where it revives in **a proxy that receives HTTP/2 and re-sends it as
HTTP/1.1** is known (a so-called downgrade point). This is a summary of published research and **was not
confirmed in this repository.**

### 12.4.3 Measurement — the two request paths check differently

This repository hands the same header dictionary to **two different request implementations.**

```python
# fetch.py:115
        self.headers = {"User-Agent": DEFAULT_UA, **(headers or {})}
```

```python
# probe.py:75-77
    args: list[str] = []
    if headers:
        args += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())]
```

The first is serialized by Python's `http.client` through `urllib`, and the second hands ffmpeg **a string
joined with CRLF inside one argv token.** The two paths' newline checks were measured directly.

**The Python side** — `http.client` checks the header value with a regex. That one line, confirmed by opening
the standard-library source with `inspect.getsource` (Python 3.14.5).

```python
# http.client — standard library
_is_illegal_header_value = re.compile(rb'\n(?![ \t])|\r(?![ \t\n])').search
```

Trip this check and the request dies before going out to the network.

```
>>> c.putheader("Cookie", "a=b\r\nX: 1")
ValueError: Invalid header value b'a=b\r\nX: 1'
```

Since the negative lookahead `(?![ \t])` is there, **it passes if a space or tab comes after the CRLF.** This
is still allowing the line-folding (obs-fold) grammar HTTP/1.1 put up for deprecation, and measured,
`"a=b\r\n X-Folded: 1"` passes without exception. **There is a check but not an outright ban.**

**The ffmpeg side** — set up a local HTTP server and passed a `-headers` with a CRLF.

```bash
$ ffprobe -v error -headers $'X-Test: a\r\nX-Injected: yes\r\n' \
    -i http://127.0.0.1:8991/a.m3u8
```

The request headers the server received (excerpt):

```
User-Agent: Lavf/62.12.101
Host: 127.0.0.1:8991
X-Test: a
X-Injected: yes
```

**It was sent as two headers.** There is no check.

Summarized (measured on ffmpeg/ffprobe 8.1.1, Python 3.14.5).

| Request path | Serialization point | CRLF inside the value | Result |
|---|---|---|---|
| `urllib` (segment·playlist receipt) | `http.client.putheader` | checked | `ValueError` — does not go out |
| `-headers` (ffmpeg·ffprobe, 5 call sites) | the string join at [`probe.py:77`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L77) | no check | **a header is added and sent** |

Therefore `_normalize_cookie`'s joining into one line is **the only point that protects even the side of the
two paths with no check.** Looking at the Python side alone it seems unnecessary, but the ffmpeg side has no
such defense.

> **What breaks if you do not do this** — suppose a user who copied the cookie in several lines from devtools
> pasted it into `--cookie` as is. Without normalization the `urllib` path dies with `ValueError: Invalid
> header value` (at least it fails loudly), and the ffmpeg path does not die and sends **a request with an
> unintended header.** The two paths request under different conditions, and at that moment the "single source
> of truth for headers" principle stated at [`cli.py:526-528`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L526-L528) collapses.

### 12.4.4 Honestly — this defense is only on the cookie

Look at the path receiving other headers in the same file and there is no normalization.

```python
# cli.py:488-501
def _given_headers(args: argparse.Namespace) -> dict[str, str]:
    """Gather the request headers the user specified. always takes priority over auto-inference."""
    given: dict[str, str] = {}
    for h in args.header:
        k, sep, v = h.partition(":")
        if not sep:
            raise SystemExit(f"--header format is wrong (need K:V): {h}")
        given[k.strip()] = v.strip()
    if args.referer:
        given["Referer"] = args.referer
        given.setdefault("Origin", "{u.scheme}://{u.netloc}".format(u=urlparse(args.referer)))
    if args.cookie:
        given["Cookie"] = _normalize_cookie(args.cookie)
    return given
```

`v.strip()` removes **only the whitespace at both ends.** A CRLF in the middle of the value remains. That is,
values coming in via `--header` and `--referer` do not get §12.4.3's normalization.

Is this a vulnerability? **You can answer only by setting the threat model.** If the party of condition ①
(control of the value) is the user themselves, this is "attaching one more header to your own request," which
is what `--header` is there to do in the first place. It becomes a problem only when that value **originates
from remote data.** Those paths were confirmed exhaustively.

| The header value's source | Is it remote data? | Does a CRLF pass? |
|---|---|---|
| `--header` · `--referer` · `--cookie` | no (user input) | only `--cookie` blocks it |
| `_adopt_origin`'s `Referer`/`Origin` ([`cli.py:118-122`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L118-L122)) | **yes** (the response header ACAO) | no — `urlparse` removes `\r`·`\n`·`\t` |
| series mode's `play.referer` ([`cli.py:750-751`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L750-L751)) | **yes** (remote HTML) | no — `_origin()` goes through `urlparse` |

Both values from remote pass `urlparse`. Python's URL parser **removes** ASCII newlines·tabs from the input
before parsing (behavior aligned with the WHATWG URL spec). Measured, it is this.

```
>>> urlparse("https://evil.example\r\nX-Injected: 1/").netloc
'evil.exampleX-Injected: 1'
```

As the newline disappeared the remaining characters got stuck to the hostname — **injection does not happen;
instead it becomes a wrong host.** The request fails at the name-resolution stage.

The conclusion can be written thus. **In the current code there is no path by which remote data puts a CRLF
into a header value.** But that safety was made not by `_normalize_cookie` but obtained as a side effect of
`urlparse`. In Chapter 15's phrasing it is an **incidental defense**, and if a new header source that does not
go through a URL appears, that defense is gone.

---

## 12.5 The places credentials remain — exhaustively

From here is this chapter's main point. Handling the value itself correctly and **where the value remains** are
completely different problems.

![The four points a pasted cookie line passes through](/images/lecture/hls-recon/12-credential-trail.svg)

*Figure 12-1 — the four points a pasted cookie line passes through — a copy remains at each pass*

### 12.5.1 A per-point comparison table

| # | Point | The form it remains in | Who can read it | Lifetime | Can this code touch it? |
|---|---|---|---|---|---|
| ① | **shell history file** | the whole command line | the same account, anyone with a backup·sync copy of that file | permanent (until deleted) | ✗ |
| ② | **`hls-recon`'s own argv** | `--cookie '…'` | another user on the same host | while the process lives | ✗ |
| ③ | **child process's argv** | `-headers 'Cookie: …\r\n'` | another user on the same host | again on each child execution | ✗ |
| ④ | **report JSON** | `stats.mux_command` | anyone who receives the artifact | until the file is deleted | **✓ partially** |
| ⑤ | **CI log·terminal scrollback** | the command echo, diagnostic output | everyone with log-reading permission | per the retention policy | ✗ |

**Of the five points the code can intervene in only one, ④.** The other four can be handled not by code but
only by operational rules and interface design — §12.8 covers that part.

### 12.5.2 ① Shell history

The moment you paste it, the shell records that line in the history file. `zsh` is `~/.zsh_history`, `bash` is
`~/.bash_history`. This file's nature grows the problem.

- **It is plaintext.** No shell encrypts the history.
- **It lives long.** The default retention count is thousands of lines, and unless explicitly deleted it
  remains.
- **It is replicated.** The practice of managing dotfiles as a git repository, a setting to sync the whole
  home directory to the cloud, a system backup — all three carry the history file along.

The response the README recommends is a shell feature (`README.md:238-240`).

> The cookie remains as is in the shell history and `ps` output. On a shared machine, prefix the command with
> a space to avoid the history record. In the muxing command left in the `--report` JSON, `Cookie`·
> `Authorization`-family headers are hidden with `***`.

"Prefix with a space" depends on `bash`'s `HISTCONTROL=ignorespace` (or `ignoreboth`) and `zsh`'s
`HIST_IGNORE_SPACE` option. **Neither setting is on by default.** Therefore this recommendation works only when
the user configured their shell in advance — the recommendation itself has a precondition, and the README does
not write that precondition. Honestly speaking, this is **less a defense than a practice guide.**

### 12.5.3 ② ③ The process list — command-line arguments are not secrets

This is the most widely misunderstood point in this chapter.

> **Command-line arguments (argv) are not an access-control target.** On Unix-like systems a process's argv is
> close to **public metadata** the kernel exposes to other processes.

On Linux `/proc/<pid>/cmdline` is world-readable in the default setting (`hidepid=0`). That `ps aux` shows
another user's command line is the result. This can be narrowed with a mount option (`hidepid=1`/`2`) but is
not the distro default.

Whether the same property holds on macOS was confirmed directly. The result of looking up a root-owned
process's arguments from an ordinary user account.

```
$ id -un
uhd
$ ps -axww -o user=,args= | awk '$1=="root"' | head -3
root  /usr/libexec/containermanagerd_system --runmode=privileged --user-container-mode=current …
root  /System/Library/PrivateFrameworks/CloudKitDaemon.framework/Support/cloudd --system
root  /usr/libexec/triald_system
```

**They are visible.** Another user's (root's) process arguments are read as is, options and all (measurement
environment: macOS Darwin 25.5.0). The statement about Linux's `/proc` default is a transfer of documented
behavior and was not measured in this environment, but the macOS side is a measurement.

To this is added this tool's peculiar multiplier effect. The headers come from one dictionary and flow to
**five child-process call sites.**

| Call site | What it executes |
|---|---|
| [`probe.py:127`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L127) `probe()` | ffprobe — stream-structure measurement |
| [`probe.py:239`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L239) `first_pts()` | ffprobe — first-PTS measurement |
| [`assemble.py:82`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L82) `remux_from_url()` | ffmpeg — `remux`-mode reassembly |
| [`subtitles.py:143`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L143) | ffmpeg — subtitle-track extraction |
| [`subtitles.py:360`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L360) `embed_args()` | ffmpeg — subtitle embedding (repeated per track) |

All five go through `probe.input_args()`, so all carry the cookie in `-headers`. Receive a 27-episode series
where an episode has 3 subtitles and **child processes spawn hundreds of times.** Each time the cookie goes up
onto argv and comes down.

> **What breaks if you do not do this** — conversely, what breaks if you do **not** pass the headers to the
> children is written in the code too. [`probe.py:58-59`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/probe.py#L58-L59) is that — "the three tools (reassembly·measurement·
> subtitle extraction) must access the original under the same conditions. miss one and a split symptom like
> 'it is received but only the measurement fails' occurs." **That is, this exposure is not a mistake but the
> price of the correctness requirement.** Unavoidable unless you use a delivery path other than argv.

ffmpeg does not actually provide another path. `-headers` is an option that takes the value as an argument, and
there is no option to read headers from a file or standard input. It is the point where the **price of
delegation** appears again with a different face than Chapter 14's (extension-policy inheritance) — this time
what is inherited is not a policy but **the credential-exposure surface.**

### 12.5.4 ④ The report JSON — one file is account access

If `--report` is given, the verdict result is saved as JSON.

```python
# cli.py:643-646
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(rep.to_json(), encoding="utf-8")
        _eprint(f"  report saved: {report_path}\n")
```

This file's nature is decisively different from ①–③. **①–③ do not leave that host, but ④ is made to leave.** A
report is an output meant to be attached, uploaded, pasted to an issue. In CI it is saved as an artifact and
downloaded by everyone with repository-read permission.

`_redact_headers`'s docstring points at this fact exactly.

```python
# report.py:36-46
def _redact_headers(cmd: list[str]) -> list[str]:
    """Make a copy of the ffmpeg command with credentials hidden in the -headers block.

    The report JSON remains as a CI artifact or is attached and passed around as is. If the session
    cookie is carried in plaintext, one file becomes account access.
    """
    out = list(cmd)
    for i, tok in enumerate(out):
        if tok == "-headers" and i + 1 < len(out):
            out[i + 1] = "\r\n".join(_redact_line(h) for h in out[i + 1].split("\r\n"))
    return out
```

**"One file becomes account access"** — a sentence that applies §12.2.3's bearer-token definition as is. Since
a cookie's possession is the qualification, a file holding a cookie is also, by possession, the qualification.
That the name attached to the file is "verification report" changes nothing.

To this is added one more file-permission problem. `write_text` follows the process's umask, so at the common
default (`022`) the file mode is `0644` — **every user on the same host can read it.** This repository does not
specify a separate permission on the report file.

### 12.5.5 ⑤ CI logs

CI worsens the above four points at once.

| CI practice | Effect on credentials |
|---|---|
| `set -x` or command echo | the same exposure as ① remains in a **permanent log** |
| re-printing the command on failure | the more it fails the more remains |
| artifact upload | ④ is distributed organization-wide |
| long-term log retention | even after discarding the cookie, a copy of the log remains |

The masking a CI platform provides (GitHub Actions' `::add-mask::`, etc.) substitutes **only when it exactly
matches a registered string.** If the value is re-encoded in Base64, URL-encoded, or escaped inside JSON, the
match breaks and the masking is passed. **Masking is a last safety net, not a first defense.**

---

## 12.6 Code ③ — the range of redaction

### 12.6.1 The redaction-target list

```python
# report.py:33
SENSITIVE_HEADERS = frozenset({"cookie", "authorization", "proxy-authorization", "x-api-key"})
```

```python
# report.py:49-53
def _redact_line(line: str) -> str:
    name, sep, _ = line.partition(":")
    if sep and name.strip().lower() in SENSITIVE_HEADERS:
        return f"{name}: ***"
    return line
```

And the call site.

```python
# report.py:146-149
    # leave the muxing command that actually ran so the same output can be remade from the report alone.
    # but hide cookie·auth headers — preventing credential leakage comes before reproducibility.
    if mux_cmd:
        rep.stats["mux_command"] = _redact_headers(mux_cmd)
```

The comment's last clause states this design's priority — **reproducibility < leak prevention.** This is a
decision colliding head-on with Part 8's verification methodology. The very purpose of leaving the command in
the report is "so the same output can be remade," and yet run that command as is and it does not reproduce
because there is no credential. **It was made intentionally irreproducible**, and the comment does not hide
that choice.

### 12.6.2 The part done well

First, write what this implementation handles properly. Three things.

**One — it processes all `-headers`.** Since the loop runs over the whole `enumerate(out)`, even if `-headers`
appears several times all are redacted. This is an actually needed property. `subtitles.embed_args()`
([`subtitles.py:357-366`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/subtitles.py#L357-L366)) calls `input_args()` per subtitle track and attaches its own `-headers` before `-i`, so with
`--sub-embed` putting 3 subtitles the command has `-headers` four times (1 video + 3 subtitles). Had it been
an implementation redacting only the first, the other three would remain in plaintext.

**Two — it compares the name in lowercase.** Since HTTP header names are case-insensitive, comparing with
`name.strip().lower()` is correct. Enter it as `--header 'COOKIE: …'` and it is still caught.

**Three — it does not transform the original.** It makes a copy with `out = list(cmd)`. If the redacted command
went back to the actual execution path, the request would fail authentication, so it must be a copy.

### 12.6.3 Outside the range

![The range redaction reaches — one report JSON](/images/lecture/hls-recon/12-redaction-scope.svg)

*Figure 12-2 — the range redaction reaches — one report JSON*

`_redact_headers` opens **only the token right after `-headers`.** It does not inspect the rest of the command.
So the following remain as is.

**(a) The `-i` argument's URL.** The command `assemble.remux_from_url()` ([`assemble.py:81-90`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L81-L90)) makes contains
`cmd += ["-i", url]`. If that URL is Chapter 11's signed URL, `?md5=<signature>&expires=<unix>` is carried in
plaintext. **A signed URL is itself a capability**, so anyone with that string can receive the same resource
until expiry.

**(b) The `source` field.** The first key `Report.to_json()` ([`report.py:95-108`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L95-L108)) serializes is `"source"`, and its
value is the original address passed to `_run_one`. In series mode [`cli.py:916`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L916) passes `play.playlist_url` — i.e.,
**the just-issued signed playlist address** — as is. Redaction does not reach this field.

**(c) A header not on the list.** This is this section's crux. A synthetic command was passed through the
actual function to measure which headers survive.

```
>>> cmd = ["ffmpeg", *input_args(headers, url), "-i", url, "out.mp4"]
>>> print(_redact_headers(cmd)[2])
User-Agent: Mozilla/5.0
Referer: https://site.example/
Cookie: ***
X-Auth-Token: deadbeef
Set-Cookie: a=b
Authorization: ***
```

`Cookie` and `Authorization` became `***`, and **`X-Auth-Token: deadbeef` and `Set-Cookie: a=b` remained as
is.** Because they are not enumerated.

Compare the credential headers common in practice against the list and it is this.

| Header | What it holds | In `SENSITIVE_HEADERS`? |
|---|---|---|
| `Cookie` | the session | ✓ |
| `Authorization` | Bearer·Basic credential | ✓ |
| `Proxy-Authorization` | proxy credential | ✓ |
| `X-API-Key` | API key | ✓ |
| `X-Auth-Token` | session·API token | ✗ |
| `X-Access-Token` | access token | ✗ |
| `X-Amz-Security-Token` | AWS temporary session token | ✗ |
| `X-CSRF-Token` | CSRF token | ✗ |
| `Api-Key` (no `X-` prefix) | API key | ✗ |
| `X-Session-Id` | session identifier | ✗ |
| `X-Goog-Api-Key` | Google API key | ✗ |
| `Set-Cookie` | cookie (a response header but settable via `--header`) | ✗ |

**Four are there and eight or more are not.** And this table is not complete — that it cannot be complete is
the next section's subject.

Call this only a fault and it is half right. This tool receives **arbitrary headers** via `--header`
([`cli.py:1019`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L1019)). That is, the set of header names the user can put in is infinite, and which part of that set is a
credential the **tool cannot know.** What a list-based redaction misses is not the implementer's carelessness
but **a property of the method itself.**

---

## 12.7 Generalization — the failure direction of list-based control

### 12.7.1 Two methods, opposite failure directions

> **Term** — **denylist**: a control enumerating what to forbid and passing the rest.
> **allowlist**: a control enumerating what to allow and blocking the rest.
> The latter is also called **default-deny.**

`SENSITIVE_HEADERS` is a denylist. "These names are hidden, the rest are carried as is."

The two methods' difference is neither performance nor elegance. It is **the direction of failure.**

| | Denylist | Allowlist |
|---|---|---|
| On meeting something not enumerated | **passes it** | **blocks it** |
| Failure symptom | quiet — no one knows | loud — immediately says it does not work |
| When discovered | after an incident | the moment you try to use the feature |
| Maintenance burden | every time the world makes a new item | every time I use a new feature |
| Who is made to update the list | no one — there is no pressure | the user — blocked, they request immediately |

The last row is decisive. **A denylist does not emit a signal that it is stale.** Even if a new header name
appears in the world, the code quietly carries it in plaintext. An allowlist, by contrast, tells you the moment
it goes stale — because it does not work.

So the principle is written thus.

> **A control that blocks an irreversible failure (leak·execution·deletion) must be an allowlist.** Use a
> denylist only when the failure is reversible.

A credential leak is irreversible. Delete the report and the already-downloaded copy remains, and until the
cookie is discarded that value is valid.

### 12.7.2 Where the same structure appears

| Domain | The denylist form | What it misses | The allowlist form |
|---|---|---|---|
| **log redaction** | a list of sensitive key names (this chapter) | a new header·new field·a value in a nested structure | serialize by naming only the fields to export |
| **input validation** | forbidden characters·forbidden patterns | encoding variants, Unicode homoglyphs (Chapter 31) | the allowed character set |
| **file upload** | block dangerous extensions | a new extension, case·trailing-dot variants | allowed extensions + magic-number check (Chapter 14) |
| **segment extension** | — | — | `ALLOWED_SEGMENT_EXTS` (Chapter 15) |
| **CSP** | individual block rules | a new resource type | start at `default-src 'none'` and open up |
| **firewall** | a list of blocked ports | a new service·non-standard port | open only allowed ports |
| **secret scanner** | known-token regexes | a new token format, an in-house custom format | (impossible in principle — below) |

The last row has an exception. **A secret scanner cannot be made an allowlist.** Because enumerating "only
these are OK in plaintext" is the same as enumerating the whole source code. So a scanner is inherently a
denylist, and that fact is why a scanner **must be operated on the premise that it misses things.** A scanner's
pass is not "there are no secrets" but "there are no secrets of a format this scanner knows." The same sentence
structure as Chapter 34's test-oracle problem.

### 12.7.3 So why is this code a denylist

Set the reason honestly. Change to an allowlist and `mux_command` becomes this.

```
["ffmpeg", "-headers", "***", "-protocol_whitelist", "***", "-i", "***", "***"]
```

**Every value** of the command is potentially sensitive — the URL has a signature, the output path has the
title of the work, the whole header value is the session. Apply an allowlist strictly and what remains is only
option names, and at that point the purpose of recording `mux_command` disappears.

That is, this code's denylist is **a compromise between "fully hiding credentials" and "leaving the command
recognizable."** And being a compromise, neither side is complete.

How this judgment can be re-set is §12.8's last item.

---

## 12.8 Security — threat model and the defender's view

### 12.8.1 Who gets what

Before discussing defense, set the threat model. **A protection that has not decided from whom it protects what
is not protection** (in Chapter 25 the same sentence applies to AES-128).

| The attacker's location | What they get | What they need | This code's current response |
|---|---|---|---|
| **another user on the same host** | ②③ the cookie in argv | one local shell | none |
| **a holder of a home-directory copy** (backup·sync·leaked dotfiles) | ① the whole command in history | file access | none (only the README recommendation) |
| **a CI-artifact reader** | ④ the report JSON | repository-read permission | 4 header kinds redacted |
| **a CI-log reader** | ⑤ the echoed command | repository-read permission | none |
| **a third party who received ④** | the signed URL (`source`·`-i`) | one file | none — outside the redaction range |
| **screen share·shoulder surfing** | terminal scrollback | physical·video access | none |

There are six rows and one has a response. This is why this chapter must be read not as "the code's fault" but
as **"a problem of interface design."** The moment you choose the interface `--cookie <value>`, ①②③⑤ are
decided. What the code can fix is only ④.

### 12.8.2 The defender's view

| Role | What to do |
|---|---|
| **tool author** | **do not receive a credential via argv.** choose among a file path (`--cookie-file`), standard input (`--cookie @-`), an environment variable. `curl`'s `-K/--config`, `git`'s credential helper, `ssh`'s `IdentityFile` all exist for the same reason |
| **tool author** | serialize logs·artifacts as **default-deny.** decide "what to carry," not "what to hide." if reproducibility is needed, leave not the whole command but **the structure needed to reproduce** (mode·container·option names) and put the values as placeholders |
| **tool author** | make the report file **`0600`.** do not leave the umask default on an output that may mix credentials |
| **user** | **separate the account** whose cookie you take out. that cookie usually opens not just video access but the whole account of that site — it can include the payment method·personal info·email-change permission |
| **user** | **log out that session** when the job is done. the only sure way to close the leak window is to invalidate the value |
| **CI operator** | treat artifacts **at the same grade as secrets.** since masking works only on an exact match, count it only as the last defense |
| **service operator** | **narrow the cookie's scope and lifetime.** `HttpOnly`·`Secure`·`SameSite`·`__Host-` prefix. use a **scope- and expiry-bound signed URL** (Chapter 11) instead of a session cookie for media access and a leak's damage is limited to one resource·a few minutes |
| **auditor** | look at the redaction list and ask **"what is not on the list."** and ask "how far the redaction applies" — in this repository's case the answer is "the one token after `-headers`" |

### 12.8.3 Why turning ambient into a capability is a defense

Return to §12.2.1's comparison table and the basis for the service-operator item shows.

If a session cookie leaks, what the attacker gets is **authority over the whole account, until session
expiry.** If a signed URL leaks, what they get is **authority over one resource, until `expires`.** In the same
incident the damage surface shrinks on both axes (scope·time).

This is the time-axis extension of the **principle of least privilege**, and the implementation constraint
Chapter 11 explained for the signed URL — a short expiry means you cannot gather addresses in advance so late
resolution is forced — is its price. **The security gain and the implementation complexity are on the same
knob.**

Meanwhile from this tool's view a reverse-direction requirement arises. When a signed URL becomes the
credential, **what must be redacted moves from the header to the URL.** The two out-of-range items confirmed in
§12.6.3 (a)(b) are exactly that. The more a service adopts a better defense, the more this tool's redaction
misses — because the redaction is looking only at the header.

### 12.8.4 What this chapter does not cover

State the course's boundary. This chapter covers the problem of **where credentials remain**, and does not
cover how to obtain a specific service's session or the procedure to bypass access control. `--cookie` is a
means of passing **a session the user already legitimately holds** to their own tool, and this chapter's
concern is how many copies of that session are made during that passing.

---

## 12.9 Limits and open questions

Noted honestly.

- **`SENSITIVE_HEADERS` is a four-item denylist.** `X-Auth-Token` `X-Amz-Security-Token` `X-Access-Token`
  `X-CSRF-Token` `Api-Key`, etc., are not redacted (measured in §12.6.3). This is this repository's **actual
  limit**, and as long as it receives arbitrary headers via `--header`, however you grow the list it will not
  become complete.
- **Credentials inside a URL are outside the redaction range.** A signed URL remains in plaintext in
  `mux_command`'s `-i` argument and the `source` field ([`assemble.py:83`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/assemble.py#L83), [`report.py:98`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/report.py#L98), [`cli.py:916`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L916)).
  A third party who received the report JSON can access the same resource until expiry.
- **There is no regression test for the redaction code.** Search the whole 525 lines of `tests/run.sh` and the
  strings `redact`·`cookie`·`mux_command`·`Authorization` **appear not once.** That is, even if
  `SENSITIVE_HEADERS` is wrongly redacted or the `-headers` serialization format changes, the test passes. In
  Chapter 34's phrasing, **this check has no oracle.**
- **The README's "known limits" has no credential handling.** `README.md:409-441` enumerates the limits of
  encryption·subtitles·inventory but does not write the redaction's incompleteness. §12.5.2's
  `HIST_IGNORE_SPACE` precondition is likewise.
- **argv exposure cannot be avoided with the current interface.** There is no file·standard-input path besides
  `--cookie` ([`cli.py:1021-1026`](https://github.com/hwanyong/hls-recon/blob/910c5a1f23676cdad3ce2c55f65eae37cc2b2a19/hlsrecon/cli.py#L1021-L1026)), and on the child-process side ffmpeg provides no delivery means other than
  `-headers`, so it is not solvable by this tool's decision alone.
- **`str.splitlines()` splits even on characters HTTP does not treat as a newline.** Measured, a value
  containing U+2028 (LINE SEPARATOR) is split·reassembled.
  ```
  >>> _normalize_cookie("sid=ab cd; t=1")   # U+2028 LINE SEPARATOR
  'sid=ab; cd; t=1'
  ```
  The docstring's invariant "the value is not touched" does not hold on this input. The practical impact is
  almost none — a cookie value is US-ASCII by spec, and a value with U+2028 dies in latin-1 encoding anyway.
  But **the nature of the failure changes.** A loud failure (`UnicodeEncodeError`) becomes a quiet corruption
  (a request with the value split in two).
- **Process-list visibility differs by OS.** That an ordinary user can read a root process's argv on macOS
  (Darwin 25.5.0) was **measured** in §12.5.3. The statement about the default permission of Linux's
  `/proc/<pid>/cmdline` is a transfer of documented behavior and was not measured in this environment. It is
  different in an environment with the `hidepid` mount option.
- **The request splitting at an HTTP/2 downgrade point is a citation.** §12.4.2's statement is a summary of
  published research and was not reproduced in this repository.
- **The conclusion that remote data has no path to put a CRLF in a header is by the current code.** §12.4.4
  confirmed the two paths (`_adopt_origin`·series-mode Referer) exhaustively, but that safety comes from a
  `urlparse` side effect. If a new header source that does not go through a URL appears, there is no defense.

---

## 12.10 Summary

1. **Ambient authority** is authority the environment attaches automatically even without the requester
   specifying it. A cookie is its archetype, and **CSRF is a direct consequence of that automaticity** — it
   follows from the definition, not a bug. `SameSite` is the work of belatedly narrowing that automaticity.
2. `--cookie` takes the ambient authority inside the browser and turns it into a **bearer token.** The
   isolation disappears, and everything the shell does to a string applies to that value.
3. This code **does not parse** the cookie value. RFC 6265's `cookie-value` allows `=` (Base64 padding is
   representative), so splitting into name/value and reassembling damages the value. Measured, `sid=a=b=c`
   passes as is. **Interpretation is always a possibility of loss.**
4. Newline stripping is a trace of the **request splitting·header injection** defense. Of the three holding
   conditions (control of the value·serialization without validation·CRLF framing), ② differs per path —
   measured, `urllib` rejects with `ValueError` but **ffmpeg's `-headers` adds a header with no check.** So the
   normalization is the only point protecting even the side with no check.
5. Credentials remain in five places — **shell history · one's own argv · child-process argv · report JSON ·
   CI logs.** The code can touch only the report JSON, and the rest are problems of interface design and
   operational rules. **Command-line arguments are not secrets** — that an ordinary user can read a root
   process's argv on macOS was measured.
6. **When the report JSON remains as an artifact, one file is account access.** That is `_redact_headers`'s
   reason for existing, and the comment states the priority — **leak prevention before reproducibility.**
7. But the redaction's range is narrow. Since it inspects **only the one token after `-headers`**, the `-i`'s
   signed URL and the `source` field remain as is, and headers not on the list (`X-Auth-Token`, etc.) are
   carried in plaintext too. The redaction code has **no regression test.**
8. **A denylist fails in the direction of missing what is not enumerated; an allowlist in the direction of
   blocking.** A control that blocks an irreversible failure (a leak) must be an allowlist. A denylist's real
   problem is not that it misses but **that it emits no signal that it missed.**
9. The defender's order is **(a) receive credentials via a file·standard input rather than argv, (b) serialize
   logs as default-deny, (c) narrow the output file's permission, (d) on the service side replace the cookie
   with a scope- and expiry-bound capability.** Masking is the last of this order, not the first.

---

**Next chapter** — this chapter's credential was one value, and it was the problem of protecting that value.
But at the front of access control there is a case where not a value but **code** is placed. The logic issuing
the playback address is inside JavaScript compressed as `eval(function(p,a,c,k,e,d){…})`, and you must read it
to make the next request. Chapter 13 explains why obfuscation is not security by Kerckhoffs's principle, and at
the same time covers what trust boundary this repository drew with the decision to **parse but not execute**
that code.
