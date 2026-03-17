---
name: shell-report
description: >
  Use this skill when the user wants to produce a shell report: a report
  that an agent or human can re-execute in the browser. Trigger when the user
  asks to "generate a report", "create a shell report", "write an sr file",
  "produce a reproducible report", "document these findings", or wants to
  validate agent findings interactively. Also trigger when the user asks to
  run `sr` or `sr.mjs`.
version: 1.0.0
---

# shell-report

`sr` is a shell report server. It turns an HTML (or Markdown) file into a
live, re-executable document. Elements with `data-cmd` attributes become cells
— the server runs the command in the user's shell and streams output back to
the browser.

**One file. Zero dependencies. Node.js 18+.**

---

## Running the server

```sh
node /path/to/sr.mjs <file.html|file.md> [options]
```

| Option | Description |
|--------|-------------|
| `--port N` | Fixed port (default: ephemeral) |
| `--no-open` | Skip opening the browser |
| `--shell PATH` | Shell for all cells (default: `$SHELL`) |
| `--cwd PATH` | Working directory for all commands (default: `$PWD`) |

The server binds to `127.0.0.1` only. Edit the source file and the browser
reloads automatically.

---

## When to generate a notebook

Generate a notebook when you have:
- Run several commands to diagnose a problem and want the user to be able to
  reproduce your findings with one click
- Produced a hypothesis and want to give the user a document that proves or
  disproves it
- Gathered information across multiple sources that the user will want to
  re-query or refresh
- Results that would benefit from visualisation beyond plain text

The notebook is the handoff. It should be self-explanatory when read top to
bottom, and self-verifiable when "Run all" is clicked.

---

## HTML format

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Title</h1>

  <p>Prose describing what this cell shows and why it matters.</p>
  <pre data-cmd="command here"></pre>

  <h2>Section</h2>
  <p>More prose.</p>
  <pre data-cmd="another command"></pre>
</body>
</html>
```

The `data-cmd` value is the exact shell command. The element content is
replaced with the command's stdout on execution.

### Key attributes

| Attribute | Description |
|-----------|-------------|
| `data-cmd="cmd"` | Shell command. Required on every cell. |
| `data-cmd-autorun` | Run on page load (boolean, no value needed). |
| `data-cmd-timeout="N"` | Seconds before timeout. Default: 30. |
| `data-cmd-var="name"` | Store trimmed stdout in `window._vars.name` on success. |
| `data-cmd-transform="fn"` | Call `window.fn(el, {stdout, stderr, exitCode})` for custom rendering. |
| `data-cmd-shell="bash"` | Run this cell under a specific shell/interpreter. |

---

## Markdown format

Use fenced code blocks with `cmd`, `sh`, `bash`, `zsh`, or `shell`:

````md
# Report title

## Section

Prose here.

```bash
command here
```
````

Extended attributes after `|`:

````md
```sh git log --oneline -20 | autorun timeout=60 var=log
```
````

---

## Variables

Pass one cell's output into another's command with `{{name}}`:

```html
<pre data-cmd="git rev-parse HEAD" data-cmd-var="sha"></pre>
<pre data-cmd="gh run list --commit {{sha}} --limit 5"></pre>
```

Variables are interpolated before the command is sent to the server.

---

## Transforms

`data-cmd-transform` names a function on `window`. The function receives
`(el, { stdout, stderr, exitCode })` and owns the element.

```html
<table data-cmd="cat data.json" data-cmd-transform="renderTable"></table>
<script>
function renderTable(el, { stdout }) {
  const rows = JSON.parse(stdout);
  el.innerHTML = rows.map(r => '<tr><td>' + r.name + '</td></tr>').join('');
}
</script>
```

---

## Patterns for agent-generated reports

### Structure

1. **Title + one-sentence summary** — what is this report about
2. **Hypothesis or question** — what claim does this notebook investigate
3. **Evidence cells** — commands that produce the evidence, with prose context
4. **Conclusion** — what the evidence shows (plain text, no cell)

### Cell prose discipline

Every cell should be preceded by a sentence explaining:
- what the command shows
- why it is relevant to the hypothesis

Don't make the user guess why a command is there.

### Use autorun for key cells

If a cell is central to the hypothesis and safe to run (read-only), add
`data-cmd-autorun`. The user will see results immediately on open, before
they even read the prose.

### Prefer specific over broad commands

```html
<!-- too broad — noisy output -->
<pre data-cmd="cat package.json"></pre>

<!-- better — targeted -->
<pre data-cmd="jq '.dependencies | keys[]' package.json"></pre>
```

### Quote commands defensively

Use `&quot;` for double quotes in `data-cmd` attribute values:

```html
<pre data-cmd="git log --format=&quot;%h %s&quot; -10"></pre>
```

### Per-cell shells for the right tool

```html
<!-- jq for JSON -->
<pre data-cmd="cat result.json | jq '.errors[]'"
     data-cmd-shell="bash"></pre>

<!-- python for more complex transforms -->
<pre data-cmd="import json, sys; d=json.load(open('data.json')); print(len(d['items']))"
     data-cmd-shell="python3"></pre>
```

---

## Minimal working example

```html
<!DOCTYPE html>
<html>
<body>
  <h1>CI failure — 2024-03-18</h1>

  <p>The build is failing on the typecheck step. This notebook traces the cause.</p>

  <h2>TypeScript errors</h2>
  <p>The raw compiler output from the failing step:</p>
  <pre data-cmd="pnpm tsc --noEmit 2>&amp;1 | head -60" data-cmd-autorun></pre>

  <h2>Recent tsconfig changes</h2>
  <p>Looking for a recent change that might have introduced stricter settings:</p>
  <pre data-cmd="git log --oneline -- '*.json' | head -10"></pre>

  <h2>Current base config</h2>
  <pre data-cmd="cat tsconfig.base.json"></pre>
</body>
</html>
```

---

## Snapshot

The **Save snapshot** button exports a static HTML file with all current cell
output frozen — no server needed to open it. This is the artifact to attach
to a bug report or hand to a colleague.
