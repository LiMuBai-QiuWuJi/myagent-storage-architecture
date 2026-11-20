#!/usr/bin/env node
// serve.mjs —— 免插件的浏览器界面（读 bin/ui.html，数据全部走 model.mjs）
// 用法: node bin/serve.mjs [--port 7788] [--open]
// 只监听 127.0.0.1，不出网。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRows, search, stats, tree, detail, listDir, readText, rules, mimeOf, kindOf } from './model.mjs';
import { resolveRoot, rootHelp } from './root.mjs';

const argv0 = process.argv.slice(2);
const ROOT = resolveRoot(argv0);
const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html');
const argv = argv0;
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = parseInt(arg('--port', process.env.KB_PORT || '7788'), 10);

function json(res, body, code = 200) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    const THEMES = { '/': 'ui.html', '/index.html': 'ui.html', '/a': 'ui-a.html', '/b': 'ui-b.html' };
    const page = THEMES[url.pathname];
    if (page) {
      const f = path.join(path.dirname(UI), page);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no such theme: ' + page); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(f));
    }

    // 每次请求现读 db.jsonl：34 行，开销可忽略，但永远不会显示过期数据
    const { rows, missing, stale } = readRows(ROOT);

    if (url.pathname === '/api/tree') {
      if (missing) {
        const r = rootHelp(ROOT);
        return json(res, { ok: false, root: ROOT, reason: r.hint || '索引不存在，先跑 node bin/reindex.mjs' }, 500);
      }
      return json(res, { ok: true, root: ROOT, groups: tree(rows), stats: stats(rows), stale });
    }
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      return json(res, { ok: true, rows: search(rows, q, { all: url.searchParams.get('all') === '1' }) });
    }
    if (url.pathname === '/api/item') {
      const d = detail(ROOT, rows, url.searchParams.get('id') || '');
      return d ? json(res, { ok: true, ...d }) : json(res, { ok: false, reason: '没有这一项' }, 404);
    }
    if (url.pathname === '/api/dir') {
      const items = listDir(ROOT, url.searchParams.get('p') || '');
      return items ? json(res, { ok: true, items }) : json(res, { ok: false, reason: '路径越界' }, 400);
    }
    if (url.pathname === '/api/file') {
      return json(res, readText(ROOT, url.searchParams.get('p') || ''));
    }
    if (url.pathname === '/api/raw') {
      const abs = path.resolve(ROOT, url.searchParams.get('p') || '');
      const base = path.resolve(ROOT);
      if (abs !== base && !abs.startsWith(base + path.sep)) return json(res, { ok: false, reason: '路径越界' }, 400);
      let st; try { st = fs.statSync(abs); } catch { return json(res, { ok: false, reason: '不存在' }, 404); }
      if (!st.isFile()) return json(res, { ok: false, reason: '不是文件' }, 400);
      res.writeHead(200, { 'content-type': mimeOf(abs), 'content-length': st.size, 'cache-control': 'no-store' });
      return fs.createReadStream(abs).pipe(res);
    }
    if (url.pathname === '/api/open' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      return req.on('end', () => {
        try {
          const { p = '', mode = 'open' } = JSON.parse(body || '{}');
          const abs = path.resolve(ROOT, p);
          const base = path.resolve(ROOT);
          if (abs !== base && !abs.startsWith(base + path.sep)) return json(res, { ok: false, reason: '路径越界' }, 400);
          if (!fs.existsSync(abs)) return json(res, { ok: false, reason: '不存在' }, 404);
          if (mode === 'reveal') {
            spawn('explorer.exe', [`/select,${abs}`], { detached: true, stdio: 'ignore' }).unref();
          } else {
            const q = abs.replace(/'/g, "''");
            spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -LiteralPath '${q}'`],
              { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          }
          return json(res, { ok: true });
        } catch (e) {
          return json(res, { ok: false, reason: String((e && e.message) || e) }, 400);
        }
      });
    }
    if (url.pathname === '/api/rules') {
      return json(res, { ok: true, ...rules(ROOT) });
    }
    return json(res, { ok: false, reason: '未知路由' }, 404);
  } catch (e) {
    return json(res, { ok: false, reason: String(e && e.message || e) }, 500);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换一个：node bin/serve.mjs --port 7789`);
    process.exit(3);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  const u = `http://127.0.0.1:${PORT}/`;
  const h = rootHelp(ROOT);
  console.log(`档案库界面：${u}`);
  console.log(`库根：${ROOT}`);
  if (!h.ok) { console.error('⚠ ' + h.hint); console.error('  现在起也能开，但会显示「索引不存在」。'); }
  console.log('Ctrl+C 停止');
  if (argv.includes('--open')) {
    try { spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
  }
});
