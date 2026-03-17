# shell-report

A local HTTP server that turns an HTML (or Markdown) file into a live,
re-executable report. Any element with a `data-cmd` attribute becomes a
cell: the server runs the command in your shell and streams the output back
to the browser.

Zero npm dependencies. Node.js 18+. One file.

```sh
node sr.mjs report.html
```

---

## Why

Coding agents build up a picture of a problem by running commands. They produce
findings, but the human has no easy way to reproduce the context the agent had.
A shell notebook solves this: the agent writes a single HTML file that is both
a readable report *and* a self-re-executing document. Open it, click "Run all",
and you have exactly the same view the agent had — verifiable, repeatable,
shareable.

The snapshot export turns the live notebook into a static HTML file you can
attach to a bug report or share with a colleague.

---

## Quick start

```sh
# Serve an HTML notebook
node sr.mjs report.html

# Serve a Markdown notebook
node sr.mjs report.md

# Fixed port, skip browser open
node sr.mjs report.html --port 8080 --no-open

# Override working directory (all commands run here)
node sr.mjs report.html --cwd /path/to/project

# Override shell
node sr.mjs report.html --shell /bin/zsh
```

The server binds to `127.0.0.1` only and prints the URL on startup. Edit the
source file and the browser reloads automatically.

---

## HTML format

Add `data-cmd` to any element. The attribute value is the shell command.
`<pre>` is recommended because it preserves whitespace.

```html
<!DOCTYPE html>
<html>
<body>
  <h1>System report</h1>

  <h2>Node</h2>
  <pre data-cmd="node --version"></pre>

  <h2>Disk</h2>
  <pre data-cmd="df -h"></pre>

  <h2>Git log</h2>
  <pre data-cmd="git log --oneline -10"></pre>
</body>
</html>
```

---

## Markdown format

Files with a `.md` extension are converted to HTML on each request.
Fenced code blocks with `cmd`, `sh`, `bash`, `zsh`, or `shell` as the
language tag become cells.

````md
# Build diagnosis

## TypeScript errors

```bash
pnpm tsc --noEmit 2>&1 | head -40
```

## Recent changes

```sh
git log --oneline -5
```
````

### Inline command (single-line blocks)

Put the command on the same line as the fence:

````md
```sh git log --oneline -10
```
````

### Extended attributes

Add attributes after a `|` separator:

````md
```sh git log --oneline -10 | autorun timeout=30 var=log
```
````

---

## Cell attributes

| Attribute | Description |
|-----------|-------------|
| `data-cmd="command"` | Shell command to run. Required. |
| `data-cmd-autorun` | Run automatically on page load (boolean, no value). |
| `data-cmd-timeout="N"` | Per-cell timeout in seconds. Default: 30. |
| `data-cmd-var="name"` | Capture trimmed stdout into `window._vars.name` on success. |
| `data-cmd-transform="fn"` | Call `window.fn(el, {stdout, stderr, exitCode})` instead of default rendering. |
| `data-cmd-shell="bash"` | Per-cell shell override. Enables polyglot notebooks. |

---

## Variables

Pass one cell's output into another cell's command with `{{name}}`.

```html
<!-- capture the current git SHA -->
<pre data-cmd="git rev-parse HEAD" data-cmd-var="sha"></pre>

<!-- use it in the next command -->
<pre data-cmd="gh run list --commit {{sha}} --limit 5"></pre>
```

Variables are interpolated just before the command is sent to the server.
If a placeholder can't be resolved, the cell enters the error state and
lists which variables are currently available.

---

## Transforms

`data-cmd-transform` names a `window` function that receives the element
and the full result object. The function owns the element — it can render
a chart, build a table, or do anything else.

```html
<canvas data-cmd="cat metrics.json" data-cmd-transform="renderChart"></canvas>

<script>
function renderChart(el, { stdout }) {
  const data = JSON.parse(stdout);
  // render with Chart.js, D3, or the raw canvas API
}
</script>
```

Because transforms are plain JavaScript in the same document, an agent can
generate both the command and its visualisation in one file.

---

## Polyglot cells

`data-cmd-shell` runs a specific cell under a different interpreter:

```html
<pre data-cmd="import json, sys; print(json.dumps({'x': 42}))"
     data-cmd-shell="python3"></pre>

<pre data-cmd=". ~/.jq; echo '[1,2,3]' | jq 'add'"
     data-cmd-shell="bash"></pre>
```

---

## Snapshot export

Click **Save snapshot** to download a static HTML file. The snapshot captures
all current cell output, removes the runtime and play buttons, and produces a
standalone document that opens in any browser with no server.

---

## Execution model

- Commands run as child processes: `spawn($SHELL, ['-c', cmd])`
- Environment: full `process.env` is inherited — credentials, `$PATH`, shell
  functions, everything
- Working directory: defaults to the directory you ran `node sr.mjs` from
  (override with `--cwd`)
- Commands are serialised — one at a time — so output never interleaves
- Streaming: stdout/stderr chunks arrive in the browser in real time via SSE
- Timeout: each cell has a configurable timeout (default 30s); on expiry the
  process receives `SIGTERM` and the cell enters the error state

This is a single-user local tool. There is no sandboxing. The document author
owns the commands and the credentials.

---

## Examples

- [`examples/system.html`](examples/system.html) — environment overview with
  autorun, variables, and a transform
- [`examples/git-report.md`](examples/git-report.md) — Markdown notebook for
  git analysis

```sh
node sr.mjs examples/system.html
node sr.mjs examples/git-report.md
```
