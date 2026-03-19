#!/usr/bin/env node
/**
 * sr.mjs — shell report
 *
 * Zero npm dependencies. Node.js 18+.
 * Usage: node sr.mjs <file.html|file.md> [--port N] [--no-open] [--shell PATH] [--cwd PATH]
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';

// ── Args ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flagVal(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

const srcFile  = argv.find(a => !a.startsWith('-'));
const port     = parseInt(flagVal('--port') ?? '0') || 0;
const noOpen   = argv.includes('--no-open');
const shellBin = flagVal('--shell') ?? process.env.SHELL ?? '/bin/sh';
const cwdDir   = path.resolve(flagVal('--cwd') ?? process.cwd());

if (!srcFile) {
  process.stderr.write(
    'Usage: node sr.mjs <file.html|file.md> [--port N] [--no-open] [--shell PATH] [--cwd PATH]\n'
  );
  process.exit(1);
}

const srcPath = path.resolve(srcFile);
if (!fs.existsSync(srcPath)) {
  process.stderr.write(`nb: file not found: ${srcPath}\n`);
  process.exit(1);
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────

const SHELL_LANGS = new Set(['cmd', 'sh', 'bash', 'zsh', 'shell']);

function escHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(text) {
  return escHtml(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseAttrs(str) {
  if (!str) return {};
  const out = {};
  for (const tok of str.trim().split(/\s+/)) {
    const eq = tok.indexOf('=');
    if (eq > 0) out[tok.slice(0, eq)] = tok.slice(eq + 1);
    else out[tok] = '';
  }
  return out;
}

function mdToHtml(src) {
  function inline(s) {
    return escHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escAttr(href)}">${label}</a>`);
  }

  const lines = src.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const afterFence = line.slice(3).trim();
      const pipeIdx = afterFence.indexOf('|');
      const beforePipe = pipeIdx >= 0 ? afterFence.slice(0, pipeIdx).trim() : afterFence;
      const attrsStr  = pipeIdx >= 0 ? afterFence.slice(pipeIdx + 1).trim() : '';
      const [lang, ...cmdTokens] = beforePipe.split(/\s+/);
      const inlineCmd = cmdTokens.join(' ');
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++;
      const cmd = inlineCmd || codeLines.join('\n').trim();
      if (SHELL_LANGS.has(lang) && cmd) {
        const attrs = parseAttrs(attrsStr);
        const parts = [
          `data-cmd="${escAttr(cmd)}"`,
          'autorun'   in attrs ? 'data-cmd-autorun'                           : '',
          attrs.timeout   ? `data-cmd-timeout="${escAttr(attrs.timeout)}"`   : '',
          attrs.var       ? `data-cmd-var="${escAttr(attrs.var)}"`           : '',
          attrs.transform ? `data-cmd-transform="${escAttr(attrs.transform)}"` : '',
          attrs.shell     ? `data-cmd-shell="${escAttr(attrs.shell)}"`       : '',
        ].filter(Boolean).join(' ');
        out.push(`<pre ${parts}></pre>`);
      } else {
        out.push(`<pre><code class="language-${escAttr(lang)}">${escHtml(codeLines.join('\n'))}</code></pre>`);
      }
      continue;
    }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) { out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].slice(2))}</li>`); i++;
      }
      out.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^\d+\.\s/, ''))}</li>`); i++;
      }
      out.push('</ol>');
      continue;
    }

    // Blank line
    if (!line.trim()) { i++; continue; }

    // Paragraph
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !/^[-*\d]/.test(lines[i])
    ) { para.push(lines[i]); i++; }
    if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
  }

  const title = (src.match(/^#\s+(.+)/m) ?? [])[1] ?? path.basename(srcPath, path.extname(srcPath));
  const escTitle = escHtml(title);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escTitle}</title></head>
<body>
${out.join('\n')}
</body>
</html>`;
}

// ── Source reading + runtime injection ────────────────────────────────────────

function readSource() {
  const raw = fs.readFileSync(srcPath, 'utf8');
  return srcPath.endsWith('.md') ? mdToHtml(raw) : raw;
}

function injectRuntime(html) {
  const injection = `<style>\n${STYLES}\n</style>\n<script>\n${CLIENT_RUNTIME}\n</script>`;
  return html.includes('</body>')
    ? html.replace('</body>', injection + '\n</body>')
    : html + '\n' + injection;
}

const MAX_BODY = 1024 * 1024; // 1 MB

function readJsonBody(req, res, onValid) {
  let body = '';
  let overflow = false;
  req.on('data', d => {
    body += d;
    if (body.length > MAX_BODY) {
      overflow = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (overflow) return;
    try {
      onValid(JSON.parse(body));
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    }
  });
  req.on('close', () => {
    if (overflow && !res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
    }
  });
}

// ── Command execution ─────────────────────────────────────────────────────────

function runCommand(cmd, sh, timeoutSecs, onChunk, onDone) {
  const proc = spawn(sh ?? shellBin, ['-c', cmd], { env: process.env, cwd: cwdDir, windowsHide: true });
  let finished = false;
  let timeoutTriggered = false;
  let killTimer;

  const timer = setTimeout(() => {
    timeoutTriggered = true;
    proc.kill('SIGTERM');
    killTimer = setTimeout(() => proc.kill('SIGKILL'), 1000);
  }, timeoutSecs * 1000);

  proc.stdout.on('data', d => { if (!finished) onChunk('stdout', d.toString()); });
  proc.stderr.on('data', d => { if (!finished) onChunk('stderr', d.toString()); });
  proc.on('close', code => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (finished) return;
    finished = true;
    if (timeoutTriggered) {
      onChunk('stderr', `[timeout after ${timeoutSecs}s]\n`);
      onDone(124);
      return;
    }
    onDone(code ?? 0);
  });
  proc.on('error', err => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (finished) return;
    finished = true;
    onChunk('stderr', `${err.message}\n`);
    onDone(1);
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const sseClients = new Set();

// Serialise command execution so output doesn't interleave
let queue = Promise.resolve();
function enqueue(fn) {
  const next = queue.then(fn);
  queue = next.catch(err => { process.stderr.write(`sr: queue error: ${err}\n`); });
  return next;
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');

  // Serve notebook
  if (req.method === 'GET' && pathname === '/') {
    try {
      const html = injectRuntime(readSource());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
    return;
  }

  // File-watch SSE
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Buffered exec
  if (req.method === 'POST' && pathname === '/api/exec') {
    readJsonBody(req, res, ({ command, shell: sh, timeout = 30 }) => {
      enqueue(() => new Promise(resolve => {
        let stdout = '', stderr = '';
        runCommand(command, sh, timeout,
          (t, c) => { if (t === 'stdout') stdout += c; else stderr += c; },
          code => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ stdout, stderr, exitCode: code }));
            resolve();
          }
        );
      }));
    });
    return;
  }

  // Streaming exec
  if (req.method === 'POST' && pathname === '/api/exec-stream') {
    readJsonBody(req, res, ({ command, shell: sh, timeout = 30 }) => {
      enqueue(() => new Promise(resolve => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        runCommand(command, sh, timeout,
          (type, chunk) => res.write(`data: ${JSON.stringify({ type, chunk })}\n\n`),
          code => {
            res.write(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`);
            res.end();
            resolve();
          }
        );
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  const { port: p } = server.address();
  const url = `http://127.0.0.1:${p}`;
  process.stdout.write(`sr  ${srcPath}\n    ${url}\n`);
  if (!noOpen) openBrowser(url);
});

// File watch → SSE broadcast
let debounce;
fs.watch(srcPath, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    for (const c of sseClients) c.write('event: reload\ndata: {}\n\n');
  }, 100);
});

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32'  ? `start "${url}"`
            :                                 `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// ── Styles ────────────────────────────────────────────────────────────────────

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    max-width: 860px; margin: 0 auto;
    padding: 72px 24px 80px;
    line-height: 1.65; color: #1a1a1a;
  }
  h1,h2,h3,h4,h5,h6 { font-weight: 600; line-height: 1.3; margin: 1.6em 0 0.4em; }
  h1 { font-size: 1.75em; } h2 { font-size: 1.35em; } h3 { font-size: 1.1em; }
  p { margin: 0 0 1em; }
  pre { margin: 0; min-height: 1.4em; }
  code { font-family: ui-monospace, 'Cascadia Code', 'Menlo', monospace; font-size: 0.875em; }
  pre code { background: #f5f5f5; display: block; padding: 12px 16px; border-radius: 4px; overflow-x: auto; }
  a { color: #1a73e8; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }

  .nb-bar {
    position: fixed; top: 0; left: 0; right: 0;
    background: #fff; border-bottom: 1px solid #e8e8e8;
    padding: 8px 24px; display: flex; gap: 8px; z-index: 1000;
  }
  .nb-bar button {
    padding: 4px 14px; border: 1px solid #d0d0d0; border-radius: 4px;
    cursor: pointer; background: #fafafa; font-size: 13px; color: #333;
  }
  .nb-bar button:hover { background: #f0f0f0; border-color: #bbb; }

  .nb-cell { display: grid; grid-template-columns: 20px 1fr; gap: 0 8px; margin: 4px 0 20px; }
  .nb-gutter { display: flex; align-items: flex-start; padding-top: 18px; }
  .nb-play {
    background: none; border: none; cursor: pointer;
    color: #ccc; font-size: 10px; padding: 2px 0; line-height: 1;
  }
  .nb-play:hover { color: #1a73e8; }
  .nb-right { min-width: 0; }
  .nb-lbl {
    font-family: ui-monospace, monospace; font-size: 11px;
    color: #6a6a6a; margin-bottom: 8px;
    display: flex; align-items: center;
    position: relative;
    width: min(100%, 960px);
    max-width: 100%;
    background: #f3f4f6;
    border: 1px solid #e1e4e8;
    border-radius: 10px;
    padding: 8px 10px;
    box-sizing: border-box;
    overflow-x: auto;
  }
  .nb-lbl-text {
    white-space: pre; min-width: 0;
  }
  .nb-lbl .nb-copy {
    position: sticky; right: 0;
    margin-left: auto; flex-shrink: 0;
  }
  .nb-copy {
    border: 1px solid #d2d6dc; border-radius: 999px; cursor: pointer;
    background: #fff; color: #5f6368; font-size: 11px; padding: 3px 8px; line-height: 1.2;
    font-family: ui-monospace, monospace;
    flex: 0 0 auto;
  }
  .nb-copy:hover { color: #1a73e8; border-color: #a8c7fa; }

  .nb-output {
    width: min(100%, 960px);
    max-width: 100%;
  }
  .nb-output-body {
    max-width: 100%;
    overflow-x: auto;
    background: #f3f4f6;
    border: 1px solid #e1e4e8;
    border-radius: 10px;
    padding: 12px 14px;
    box-sizing: border-box;
  }
  .nb-output > pre,
  .nb-output-body > pre {
    margin: 0;
    min-width: max-content;
  }
  .nb-output-actions {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 8px 4px 0;
  }
  .nb-status {
    display: inline-flex; align-items: center; gap: 8px;
    color: #5f6368; font: 11px ui-monospace, monospace;
  }
  .nb-status-dot {
    width: 8px; height: 8px; border-radius: 999px; background: currentColor;
    opacity: 0;
  }
  [data-cmd-state=pending] .nb-output-body { opacity: 0.72; }
  [data-cmd-state=running] .nb-output-body { border-color: #8ab4f8; box-shadow: 0 0 0 1px rgba(26,115,232,0.08); }
  [data-cmd-state=done] .nb-output-body { border-color: #9ad1a9; }
  [data-cmd-state=error] .nb-output-body { border-color: #ea4335; color: #b3261e; }
  [data-cmd-state=running] .nb-status { color: #1a73e8; }
  [data-cmd-state=running] .nb-status-dot {
    opacity: 1;
    animation: nb-pulse 1s ease-in-out infinite;
  }
  @keyframes nb-pulse {
    0%, 100% { transform: scale(0.85); opacity: 0.35; }
    50% { transform: scale(1); opacity: 1; }
  }

  .nb-toggle {
    border: 1px solid #d2d6dc; border-radius: 999px; cursor: pointer;
    background: #fff; color: #5f6368; font-size: 11px; padding: 3px 8px; line-height: 1.2;
    font-family: ui-monospace, monospace;
    flex: 0 0 auto;
  }
  .nb-toggle:hover { color: #1a73e8; border-color: #a8c7fa; }
  [data-collapsed] .nb-output-body { display: none; }

  .nb-cell[data-focused] .nb-lbl {
    border-color: #8ab4f8;
    box-shadow: 0 0 0 1px rgba(26,115,232,0.08);
  }

  .nb-err { font-family: ui-monospace, monospace; font-size: 12px; padding: 8px 0; }
  .nb-err-title { color: #c00; font-weight: 600; }
  .nb-err-hint  { color: #666; margin: 3px 0 6px; }
  .nb-err details summary { cursor: pointer; color: #999; user-select: none; }
  .nb-err details pre { margin-top: 4px; background: #fff5f5; padding: 8px 12px; font-size: 11px; }
`;

// ── Client runtime (injected into every notebook) ─────────────────────────────
//
// Deliberately written without template literals or backticks so it can live
// safely inside the outer template literal below.

const CLIENT_RUNTIME = `
(function () {
  'use strict';

  window._vars = {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function interpolate(cmd) {
    return cmd.replace(/\\{\\{(\\w+)\\}\\}/g, function (_, name) {
      if (!(name in window._vars)) {
        var avail = Object.keys(window._vars).join(', ') || 'none';
        throw new Error('Unresolved variable {{' + name + '}}. Available: ' + avail);
      }
      return window._vars[name];
    });
  }

  function classify(stderr, exitCode) {
    if (exitCode === 124)
      return { title: 'Timeout', hint: 'Increase data-cmd-timeout or simplify the command.' };
    var s = (stderr || '').toLowerCase();
    if (/401|unauthorized|token.expired/.test(s))
      return { title: 'Auth required', hint: 'Check your credentials.' };
    if (/404|not.found|does.not.exist/.test(s))
      return { title: 'Not found', hint: 'Check the resource name or path.' };
    if (/403|forbidden|permission.denied|access.denied/.test(s))
      return { title: 'Access denied', hint: 'Check permissions.' };
    if (/econnrefused|enotfound|network|fetch.failed/.test(s))
      return { title: 'Connection failed', hint: 'Check network connectivity.' };
    return null;
  }

  async function runCell(el) {
    var cmd;
    try { cmd = interpolate(el.getAttribute('data-cmd')); }
    catch (e) { el.textContent = e.message; el.dataset.cmdState = 'error'; return; }

    var sh      = el.getAttribute('data-cmd-shell') || null;
    var timeout = parseInt(el.getAttribute('data-cmd-timeout') || '30', 10);
    var varName = el.getAttribute('data-cmd-var');
    var xfName  = el.getAttribute('data-cmd-transform');

    el.dataset.cmdState = 'running';
    el.textContent = '';
    var t0 = Date.now();

    var stdout = '', stderr = '', exitCode = 0, streamed = false;

    try {
      var r = await fetch('/api/exec-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, shell: sh, timeout: timeout }),
      });
      if (r.ok && r.body) {
        streamed = true;
        var reader = r.body.getReader();
        var dec = new TextDecoder();
        var buf = '';
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          var lines = buf.split('\\n'); buf = lines.pop();
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (!line.startsWith('data: ')) continue;
            var evt = JSON.parse(line.slice(6));
            if (evt.type === 'stdout') { stdout += evt.chunk; if (!xfName) el.textContent = stdout; }
            if (evt.type === 'stderr') stderr += evt.chunk;
            if (evt.type === 'done')   exitCode = evt.exitCode;
          }
        }
      }
    } catch (_) {}

    if (!streamed) {
      try {
        var resp = await fetch('/api/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd, shell: sh, timeout: timeout }),
        });
        if (!resp.ok) throw new Error('Server returned ' + resp.status);
        var data = await resp.json();
        stdout = data.stdout; stderr = data.stderr; exitCode = data.exitCode;
      } catch (e) {
        el.textContent = 'Network error: ' + e.message;
        el.dataset.cmdMs = String(Date.now() - t0);
        el.dataset.cmdState = 'error';
        return;
      }
    }

    var xf = (xfName && typeof window[xfName] === 'function') ? window[xfName] : null;

    if (exitCode === 0) {
      if (varName) window._vars[varName] = stdout.trim();
      el.dataset.cmdMs = String(Date.now() - t0);
      el.dataset.cmdState = 'done';
      if (xf) xf(el, { stdout: stdout, stderr: stderr, exitCode: exitCode });
      else if (!streamed) el.textContent = stdout;
    } else {
      el.dataset.cmdMs = String(Date.now() - t0);
      el.dataset.cmdState = 'error';
      if (xf) { xf(el, { stdout: stdout, stderr: stderr, exitCode: exitCode }); return; }
      var c = classify(stderr, exitCode);
      if (c) {
        el.innerHTML =
          '<div class="nb-err">' +
          '<div class="nb-err-title">' + c.title + '</div>' +
          '<div class="nb-err-hint">' + c.hint + '</div>' +
          '<details><summary>Output</summary><pre>' + esc(stdout + stderr) + '</pre></details>' +
          '</div>';
      } else {
        el.textContent = (stdout + stderr).trim() || '(exit ' + exitCode + ')';
      }
    }
  }

  function copyBtn(title, getText) {
    var b = document.createElement('button');
    b.className = 'nb-copy'; b.title = title; b.textContent = 'copy';
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(getText()).then(function () {
        b.textContent = 'copied';
        setTimeout(function () { b.textContent = 'copy'; }, 1200);
      }, function () {});
    });
    return b;
  }

  function setCellChrome(el, wrap, btn, statusEl, toggle, outCopy) {
    var state = el.dataset.cmdState;
    wrap.dataset.cmdState = state;
    var showActions = state === 'done' || state === 'error';
    outCopy.style.display = showActions ? '' : 'none';
    toggle.style.display = showActions ? '' : 'none';
    if (state === 'running') {
      btn.textContent = '...';
      btn.title = 'Running';
      statusEl.innerHTML = '<span class="nb-status-dot"></span><span>Running...</span>';
    } else if (state === 'done') {
      btn.textContent = '\\u25b6';
      btn.title = 'Run';
      var ms = el.dataset.cmdMs;
      statusEl.textContent = ms ? 'Completed in ' + (ms / 1000).toFixed(1) + 's' : 'Completed';
    } else if (state === 'error') {
      btn.textContent = '\\u25b6';
      btn.title = 'Run';
      var ms = el.dataset.cmdMs;
      statusEl.textContent = ms ? 'Failed in ' + (ms / 1000).toFixed(1) + 's' : 'Failed';
    } else {
      btn.textContent = '\\u25b6';
      btn.title = 'Run';
      statusEl.textContent = 'Ready';
    }
  }

  // Wrap each cell with gutter play button + command label
  var cells = Array.from(document.querySelectorAll('[data-cmd]'));
  cells.forEach(function (el) {
    el.dataset.cmdState = 'pending';

    var wrap = document.createElement('div');
    wrap.className = 'nb-cell';
    el.parentNode.insertBefore(wrap, el);

    var gutter = document.createElement('div');
    gutter.className = 'nb-gutter';
    var btn = document.createElement('button');
    btn.className = 'nb-play'; btn.title = 'Run'; btn.textContent = '\\u25b6';
    btn.addEventListener('click', function () { runCell(el); });
    gutter.appendChild(btn);

    var right = document.createElement('div');
    right.className = 'nb-right';
    var lbl = document.createElement('div');
    lbl.className = 'nb-lbl';
    var lblText = document.createElement('span');
    lblText.className = 'nb-lbl-text';
    lblText.textContent = el.getAttribute('data-cmd');
    lbl.appendChild(lblText);
    var cmdCopy = copyBtn('Copy command', function () { return el.getAttribute('data-cmd'); });
    lbl.appendChild(cmdCopy);
    right.appendChild(lbl);

    var output = document.createElement('div');
    output.className = 'nb-output';
    var outputBody = document.createElement('div');
    outputBody.className = 'nb-output-body';
    output.appendChild(outputBody);
    outputBody.appendChild(el);

    var actions = document.createElement('div');
    actions.className = 'nb-output-actions';
    var status = document.createElement('span');
    status.className = 'nb-status';
    actions.appendChild(status);
    var toggle = document.createElement('button');
    toggle.className = 'nb-toggle'; toggle.textContent = 'collapse';
    toggle.style.display = 'none';
    toggle.addEventListener('click', function () {
      var collapsed = output.hasAttribute('data-collapsed');
      if (collapsed) { output.removeAttribute('data-collapsed'); toggle.textContent = 'collapse'; }
      else { output.setAttribute('data-collapsed', ''); toggle.textContent = 'expand'; }
    });
    actions.appendChild(toggle);
    var outCopy = copyBtn('Copy output', function () { return el.textContent; });
    actions.appendChild(outCopy);
    output.appendChild(actions);
    right.appendChild(output);

    var obs = new MutationObserver(function () {
      setCellChrome(el, wrap, btn, status, toggle, outCopy);
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-cmd-state'] });
    setCellChrome(el, wrap, btn, status, toggle, outCopy);

    wrap.appendChild(gutter);
    wrap.appendChild(right);

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      focusCell(cells.indexOf(el));
    });
  });

  // Sticky top bar: Run all + Save snapshot
  var bar = document.createElement('div');
  bar.className = 'nb-bar';
  var btnAll = document.createElement('button');
  btnAll.textContent = 'Run all';
  btnAll.addEventListener('click', async function () {
    for (var k = 0; k < cells.length; k++) await runCell(cells[k]);
  });
  var btnSave = document.createElement('button');
  btnSave.textContent = 'Save snapshot';
  btnSave.addEventListener('click', saveSnapshot);
  bar.appendChild(btnAll);
  bar.appendChild(btnSave);
  document.body.insertBefore(bar, document.body.firstChild);

  // Keyboard navigation
  var focusedIdx = -1;
  var wraps = Array.from(document.querySelectorAll('.nb-cell'));

  function focusCell(idx) {
    if (idx < 0 || idx >= cells.length) return;
    if (focusedIdx >= 0 && wraps[focusedIdx]) wraps[focusedIdx].removeAttribute('data-focused');
    focusedIdx = idx;
    wraps[idx].setAttribute('data-focused', '');
    wraps[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      btnAll.click();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusCell(focusedIdx < 0 ? 0 : Math.min(focusedIdx + 1, cells.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusCell(focusedIdx < 0 ? 0 : Math.max(focusedIdx - 1, 0));
    } else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault();
      runCell(cells[focusedIdx]);
    }
  });

  // Autorun cells in document order
  (async function () {
    for (var k = 0; k < cells.length; k++) {
      if (cells[k].hasAttribute('data-cmd-autorun')) await runCell(cells[k]);
    }
  })();

  // File-watch auto-reload
  try {
    var es = new EventSource('/api/events');
    es.addEventListener('reload', function () { location.reload(); });
  } catch (_) {}

  // Snapshot: freeze current output as a standalone HTML file
  function saveSnapshot() {
    var clone = document.documentElement.cloneNode(true);
    var cloneBar = clone.querySelector('.nb-bar');
    if (cloneBar) cloneBar.remove();
    clone.querySelectorAll('.nb-gutter').forEach(function (g) { g.remove(); });
    clone.querySelectorAll('script').forEach(function (s) {
      if (s.textContent.indexOf('runCell') !== -1) s.remove();
    });
    clone.querySelectorAll('style').forEach(function (s) {
      if (s.textContent.indexOf('nb-bar') !== -1) s.remove();
    });
    var ss = document.createElement('style');
    ss.textContent = [
      '.nb-gutter,.nb-bar{display:none!important}',
      '.nb-cell{display:block;margin-bottom:20px}',
      '.nb-lbl,.nb-output-body{max-width:960px;overflow-x:auto;background:#f3f4f6;border:1px solid #e1e4e8;border-radius:10px;box-sizing:border-box}',
      '.nb-lbl{font-family:monospace;font-size:11px;color:#6a6a6a;margin-bottom:8px;padding:8px 10px}',
      '.nb-output-body{padding:12px 14px}',
      '.nb-output-actions{display:none!important}',
      '[data-cmd-state=done] .nb-output-body{border-color:#9ad1a9}',
      '[data-cmd-state=error] .nb-output-body{border-color:#ea4335;color:#b3261e}',
    ].join('\\n');
    var head = clone.querySelector('head');
    if (head) head.appendChild(ss);
    var html = '<!DOCTYPE html>\\n' + clone.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var title = (document.title || 'notebook').replace(/[^a-z0-9]+/gi, '_');
    a.download = title + '-' + ts + '.html';
    a.click();
  }
})();
`;
