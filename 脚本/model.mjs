// model.mjs —— V9 档案库的唯一数据模型
// CLI(find.mjs)、独立浏览器界面(serve.mjs)、DSH 插件(index.v4.js) 三处共用这一份逻辑。
// 界面只负责画，不自己做计算——这是"两个界面不会给出两个结果"的唯一保障。
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = ['project', 'skill', 'external'];
export const LABEL = { project: '项目', skill: '技能', external: '外部依赖', knowledge: '知识' };
export const FILE_LIMIT = 320 * 1024;

export function readRows(root) {
  const db = path.join(root, '索引', 'db.jsonl');
  if (!fs.existsSync(db)) return { rows: [], dbTime: 0, missing: true, stale: false };
  const rows = fs.readFileSync(db, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const dbTime = fs.statSync(db).mtimeMs;
  let stale = false;
  for (const base of ['项目', 'SKILL']) {
    const d = path.join(root, base);
    try { if (fs.statSync(d).mtimeMs > dbTime + 1000) stale = true; } catch { /* 没有就跳过 */ }
  }
  return { rows, dbTime, missing: false, stale };
}

export function isVisible(r, all = false) {
  return all || r.status === 'active' || r.status === 'missing';
}

// 与 find.mjs 的匹配口径完全一致：name 精确 > name 包含 > kw > desc > path
export function search(rows, q, { all = false, limit = 50 } = {}) {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return [];
  const out = [];
  for (const r of rows) {
    if (!all && r.status !== 'active') continue;
    const n = String(r.name || '').toLowerCase();
    let s = 0;
    if (n === k) s = 100;
    else if (n.includes(k)) s = 80;
    if ((r.kw || []).some((x) => String(x).toLowerCase().includes(k))) s = Math.max(s, 60);
    if (String(r.desc || '').toLowerCase().includes(k)) s = Math.max(s, 40);
    if (String(r.path || '').toLowerCase().includes(k)) s = Math.max(s, 30);
    if (s) out.push({ ...r, score: s });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

export function stats(rows) {
  const by = { project: 0, skill: 0, external: 0 };
  let missing = 0, whyTodo = 0, descTodo = 0;
  for (const r of rows) {
    if (r.status === 'missing') { missing++; continue; }
    if (r.status !== 'active') continue;
    if (by[r.type] != null) by[r.type]++;
    if (!r.why || r.why === '[待补]') whyTodo++;
    if (!r.desc || r.desc === '[待补]') descTodo++;
  }
  return { ...by, total: Object.values(by).reduce((a, b) => a + b, 0), missing, whyTodo, descTodo };
}

export function tree(rows, { all = false } = {}) {
  const groups = [];
  for (const t of TYPES) {
    const items = rows
      .filter((r) => r.type === t && isVisible(r, all))
      .map((r) => ({
        id: r.id, name: r.name, desc: r.desc, status: r.status,
        cls: r.cls ?? null, path: r.path ?? null,
        implCount: r.implCount ?? null, recCount: r.recCount ?? null,
        lastChange: r.lastChange || '', port: r.port ?? null,
      }));
    groups.push({ type: t, label: LABEL[t], items });
  }
  return groups;
}

function safeJoin(root, rel) {
  const abs = path.resolve(root, String(rel || '').replace(/[\\/]+/g, path.sep));
  const r = path.resolve(root);
  return abs === r || abs.startsWith(r + path.sep) ? abs : null;
}

export const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.venv', 'venv', '.git', '.idea', '.vscode', 'dist', 'build']);

export function listDir(root, rel) {
  const abs = safeJoin(root, rel);
  if (!abs) return null;
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(abs, e.name);
    let size = 0, mtime = 0;
    try { const st = fs.statSync(p); size = st.size; mtime = Math.floor(st.mtimeMs / 1000); } catch { /* ignore */ }
    out.push({ name: e.name, dir: e.isDirectory(), size, mtime, rel: path.join(rel, e.name).replace(/\\/g, '/') });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.dir ? -1 : 1));
  return out;
}

export function readText(root, rel, limit = FILE_LIMIT) {
  const abs = safeJoin(root, rel);
  if (!abs) return { ok: false, reason: '路径越界' };
  try {
    const st = fs.statSync(abs);
    if (st.isDirectory()) return { ok: false, reason: '这是目录' };
    if (st.size > limit) return { ok: false, reason: `文件过大（${st.size} 字节）` };
    return { ok: true, text: fs.readFileSync(abs, 'utf8'), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

export function detail(root, rows, id) {
  const r = rows.find((x) => String(x.id).toLowerCase() === String(id).toLowerCase());
  if (!r) return null;
  const related = (r.related || []).map((n) => {
    const hit = rows.find((x) => x.name === n);
    return hit ? { id: hit.id, name: hit.name } : { id: null, name: n };
  });
  // 技能没有 记录/实现 两段，直接列技能目录本身
  if (r.type === 'skill') {
    const files = r.path ? listDir(root, r.path) : [];
    return { item: r, record: [], impl: files || [], related, files: files || [], isSkill: true };
  }
  const rec = r.path ? listDir(root, path.join(r.path, '记录').replace(/\\/g, '/')) : [];
  const impl = r.path ? listDir(root, path.join(r.path, '实现').replace(/\\/g, '/')) : [];
  return { item: r, record: rec || [], impl: impl || [], related };
}

// Agent_Rule.md 按「一、二、…」切节；界面用它做「规则」页
export function rules(root) {
  const f = path.join(root, 'Agent_Rule.md');
  if (!fs.existsSync(f)) return { sections: [], total: 0 };
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const secs = [];
  // 标题是纯文本行「一、工作根目录」；用行首顿号 + 行长度约束，避开正文里的编号列表
  const HEAD = /^([一二三四五六七八九十]+)、(.{1,40})$/;
  let cur = null;
  lines.forEach((line, i) => {
    const m = line.match(HEAD);
    if (m && !/[，。；]$/.test(m[2])) {
      if (cur) { cur.lineEnd = i; cur.body = cur.lines.join('\n').trim(); delete cur.lines; }
      cur = { id: m[1], title: m[2], lineStart: i + 1, lines: [line] };
      secs.push(cur);
    } else if (cur) cur.lines.push(line);
  });
  if (cur) { cur.lineEnd = lines.length; cur.body = cur.lines.join('\n').trim(); delete cur.lines; }
  for (const s of secs) s.chars = s.body.replace(/\s/g, '').length;
  return { sections: secs, total: lines.length };
}

export function fmtText(r) {
  const w = r.why && r.why !== '[待补]' ? r.why : '⚠ why [待补]';
  const tags = (r.kw || []).length ? `  [${r.kw.join(' ')}]` : '';
  const lc = r.lastChange ? `\n    最近改动: ${r.lastChange}` : '';
  return `${r.id}  ${r.name}  ·  ${LABEL[r.type] || r.type}${r.status !== 'active' ? ' · ' + r.status : ''}\n    路径: ${r.path}\n    说明: ${r.desc}${tags}\n    出处: ${r.origin}    因果: ${w}${lc}`;
}

// ── 预览类型判定（三处界面共用，保证「能看什么」到处一致）──────
const KIND_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'wma'],
  pdf: ['pdf'],
  text: ['md', 'markdown', 'txt', 'text', 'json', 'jsonl', 'ndjson', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'java', 'py', 'pyw', 'css', 'scss', 'html', 'htm', 'xml', 'yml', 'yaml', 'log', 'csv', 'tsv', 'bat',
    'cmd', 'ps1', 'sh', 'bash', 'conf', 'cfg', 'ini', 'toml', 'sql', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
    'go', 'rs', 'php', 'rb', 'vue', 'svelte', 'gradle', 'properties', 'env', 'gitignore', 'editorconfig', 'mdc'],
};
const EXT_KIND = {};
for (const [k, list] of Object.entries(KIND_EXT)) for (const e of list) EXT_KIND[e] = k;

export function extOf(nameOrPath) {
  const b = String(nameOrPath || '').split(/[\/]/).pop();
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

export function kindOf(nameOrPath) {
  return EXT_KIND[extOf(nameOrPath)] || 'other';
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  aac: 'audio/aac', opus: 'audio/opus', wma: 'audio/x-ms-wma',
  pdf: 'application/pdf', json: 'application/json', jsonl: 'application/x-ndjson',
  md: 'text/markdown', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
};

export function mimeOf(nameOrPath) {
  return MIME[extOf(nameOrPath)] || (kindOf(nameOrPath) === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream');
}
