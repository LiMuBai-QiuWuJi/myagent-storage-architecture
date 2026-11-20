#!/usr/bin/env node
// reindex.mjs —— 扫磁盘生成 索引/db.jsonl + 总索引.md + 各项目 00-入口.md
// 用法: node bin/reindex.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoot, rootHelp } from './root.mjs';

// 根目录：--root 参数 > KB_ROOT/MYAGENT_ROOT > 脚本上一级 > 当前目录
const ROOT = resolveRoot(process.argv.slice(2));
const DB_DIR = path.join(ROOT, '索引');
const DB = path.join(DB_DIR, 'db.jsonl');
const DRY = process.argv.includes('--dry');
const SKIP = new Set(['媒体', 'node_modules', '__pycache__', '.venv', '.git', '_作废', '实现', '记录']);

const readJsonl = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

function readDesc(dir) {
  for (const cand of ['记录/简介.txt', '记录/工程简介.txt']) {
    const f = path.join(dir, cand);
    if (!fs.existsSync(f)) continue;
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    // 只取第一段（遇空行停，最多 2 行）；跳过「XX —— 简介」这类标题行
    const body = [];
    for (const raw of txt.split(/\r?\n/)) {
      const s = raw.trim();
      if (!s) { if (body.length) break; else continue; }
      if (/^[-=_—]{3,}$/.test(s) || s.startsWith('#')) continue;
      if (/^.{1,24}(——|--)\s*(工程)?简介$/.test(s)) continue;
      if (/^(这是什么|工程简介|简介)\s*[:：]?$/.test(s)) continue;
      body.push(s);
      if (body.length >= 2) break;
    }
    const line = body.join(' ').replace(/\s+/g, ' ').trim();
    if (line) return line.slice(0, 120);
  }
  return '[待补]';
}

// 技能不只看一层：SKILL/<分类>/<技能> 是常态，但允许惰性细分 SKILL/<分类>/<子类>/<技能>。
// 判据是「这一层有 SKILL.md」；references/examples/skills 这些是第三方素材，不当技能。
const SKILL_SKIP = /[\\/](references|examples|skills|templates|assets|scripts|node_modules|\.git)[\\/]/i;

function listSkills(base) {
  const found = [];
  (function walk(dir, rel, depth) {
    if (depth > 4) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some(e => e.isFile() && e.name === 'SKILL.md')) {
      const cls = rel.split('/').slice(1, -1).join('/'); // SKILL/a/b/技能 → a/b
      found.push({ rel, name: path.basename(dir), cls, depth });
      return; // 已经是技能，不再往里挖
    }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const nr = `${rel}/${e.name}`;
      if (SKILL_SKIP.test(`/${nr}/`)) continue;
      walk(path.join(dir, e.name), nr, depth + 1);
    }
  })(base, 'SKILL', 0);
  return found.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'));
}

// 技能简介：优先 SKILL.md frontmatter 的 description，其次正文第一段
function readSkillDesc(dir) {
  const f = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(f)) return '[待补]';
  let txt = '';
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return '[待补]'; }
  const fm = txt.match(/^---[\s\S]*?\ndescription:\s*(.+)$/m);
  if (fm) {
    const v = fm[1].trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
    if (v) return v.slice(0, 120);
  }
  const body = [];
  for (const raw of txt.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) { if (body.length) break; else continue; }
    if (s.startsWith('#') || s.startsWith('---') || /^[-=_]{3,}$/.test(s)) continue;
    if (/^[a-zA-Z_-]+:\s/.test(s)) continue; // frontmatter 残留
    body.push(s);
    if (body.length >= 2) break;
  }
  const line = body.join(' ').replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, 120) : '[待补]';
}

function listDirs(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => {
      if (!d.isDirectory() || d.name.startsWith('.') || SKIP.has(d.name)) return false;
      try { if (fs.lstatSync(path.join(base, d.name)).isSymbolicLink()) return false; } catch { return false; }
      return true;
    })
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b, 'zh'));
}

const existing = readJsonl(DB);
// 技能可能重名（不同分类下同名目录），key 用 path；其余用 name
const keyOf = r => r.type === 'skill' ? `skill|${r.path}` : `${r.type}|${r.name}`;
const byKey = new Map(existing.map(r => [keyOf(r), r]));
let seq = { project: 1, skill: 1, external: 1 };
for (const r of existing) {
  const n = parseInt(String(r.id).slice(1), 10);
  if (!isNaN(n) && seq[r.type] !== undefined) seq[r.type] = Math.max(seq[r.type], n + 1);
}
const pad = n => String(n).padStart(2, '0');

// 最近改动时间：扫 实现/ 与 记录/ 往下 2 层，取最新 mtime
// 跳过 SKIP 里的目录与隐藏目录；junction 不跟（避免跳出档案库）
function latestMtime(dir, depth = 2) {
  let max = 0;
  (function walk(d, lv) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isFile() && st.mtimeMs > max) max = st.mtimeMs;
      if (st.isDirectory() && lv > 0) walk(p, lv - 1);
    }
  })(dir, depth);
  return max;
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ensure(type, name, dirPath, extra = {}) {
  const key = `${type}|${extra.key ?? name}`;
  const old = byKey.get(key);
  const abs = path.join(ROOT, dirPath);
  let implCount = 0, recCount = 0;
  try { implCount = fs.readdirSync(path.join(abs, '实现')).length; } catch { }
  try { recCount = fs.readdirSync(path.join(abs, '记录')).length; } catch { }
  const nd = type === 'skill' ? readSkillDesc(abs) : readDesc(abs);
  const lm = Math.max(
    latestMtime(path.join(abs, '实现')),
    latestMtime(path.join(abs, '记录'))
  );
  const lastChange = fmtTime(lm);
  if (old) {
    byKey.delete(key);
    old.path = dirPath;
    if (extra.cls !== undefined) old.cls = extra.cls;
    if (old.status === 'missing') old.status = 'active'; // 目录回来了
    old.implCount = implCount;
    old.recCount = recCount;
    old.lastChange = lastChange;
    if (nd !== '[待补]') old.desc = nd;
    return old;
  }
  return {
    id: '',
    type, name, path: dirPath,
    ...(extra.cls !== undefined ? { cls: extra.cls } : {}),
    desc: nd,
    why: '[待补]', origin: '[待补]', related: [], kw: [],
    status: 'active',
    implCount, recCount, lastChange,
  };
}

const out = [];
for (const name of listDirs(path.join(ROOT, '项目'))) out.push(ensure('project', name, `项目/${name}`));
for (const s of listSkills(path.join(ROOT, 'SKILL'))) {
  out.push(ensure('skill', s.name, s.rel, { key: s.rel, cls: s.cls }));
}
// 兜底：db 里有、磁盘上已经扫不到的行
// - external 本来就不在磁盘上，原样保留
// - project/skill 说明目录被删或改名了 → 标 missing（不删，find 默认不显示，恢复目录自动回 active）
for (const [, rec] of byKey) {
  if (rec.type === 'external') { out.push(rec); continue; }
  if (rec.status !== 'dead') rec.status = 'missing';
  out.push(rec);
}

const ORDER = { project: 0, skill: 1, external: 2 };
out.sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9)
  || String(a.cls || '').localeCompare(String(b.cls || ''), 'zh')
  || a.name.localeCompare(b.name, 'zh'));
// ID 按排序稳定重排：同一类型内按名称序编号
const seq2 = { project: 1, skill: 1, external: 1 };
for (const r of out) r.id = r.type[0].toUpperCase() + pad(seq2[r.type]++);

// —— 生成 总索引.md ——
const _d = new Date();
const _p2 = n => String(n).padStart(2, '0');
const stamp = `${_d.getFullYear()}-${_p2(_d.getMonth() + 1)}-${_p2(_d.getDate())} ${_p2(_d.getHours())}:${_p2(_d.getMinutes())}`;
const head = `<!-- GENERATED by bin/reindex.mjs · src=索引/db.jsonl · ${stamp} · 勿手改 -->`;
const byT = t => out.filter(r => r.type === t && r.status === 'active');
const lines = [
  head, '',
  '# 总索引', '',
  '> 本文件是生成物，改它没用：改 `索引/db.jsonl` 的字段或跑 `node bin/reindex.mjs`。',
  '> 找东西：`node bin/find.mjs <关键词>`；看全量：`node bin/find.mjs list`。', '',
  `## 项目 ${byT('project').length}`, '',
  '| ID | 名称 | 一句话 | 记录/实现 |',
  '|---|---|---|---|',
  ...byT('project').map(r => `| ${r.id} | ${r.name} | ${String(r.desc).replace(/\|/g, '\\|').slice(0, 60)} | ${r.recCount ?? '-'} / ${r.implCount ?? '-'} |`),
  '',
  `## 技能 ${byT('skill').length}`, '',
  '| ID | 名称 | 分类 | 说明 |',
  '|---|---|---|---|',
  ...byT('skill').map(r => `| ${r.id} | ${r.name} | ${r.cls || '-'} | ${String(r.desc).replace(/\|/g, '\\|').slice(0, 50)} |`),
  '',
  `## 外部依赖 ${byT('external').length}`, '',
  '| ID | 名称 | 端口 | 说明 |',
  '|---|---|---|---|',
  ...byT('external').map(r => `| ${r.id} | ${r.name} | ${r.port ?? '-'} | ${String(r.desc).replace(/\|/g, '\\|').slice(0, 60)} |`),
  '',
];

if (!DRY) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB, out.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(ROOT, '总索引.md'), lines.join('\n'), 'utf8');

  // —— 生成各项目 00-入口.md ——
  for (const r of out.filter(x => x.type === 'project')) {
    const abs = path.join(ROOT, r.path);
    if (!fs.existsSync(abs)) continue;
    const deps = out.filter(x => x.type === 'external' && (x.related || []).includes(r.name));
    const body = [
      `<!-- GENERATED by bin/reindex.mjs · ${stamp} · 勿手改 -->`, '',
      `# ${r.name}（${r.id}）`, '',
      r.desc, '',
      '## 代码在哪', '',
      `- 实现：\`${r.path}/实现/\`（${r.implCount} 项）`,
      `- 记录：\`${r.path}/记录/\`（${r.recCount} 项）`, '',
      '## 外部依赖', '',
      deps.length ? deps.map(d => `- ${d.id} ${d.name}${d.port ? ` · 端口 ${d.port}` : ''} — ${d.desc}`).join('\n') : '- （无）', '',
      '## 改之前必须先读', '',
      `- 出处：${r.origin}`,
      `- 为什么存在：${r.why}`,
      `- 关联：${(r.related || []).join('、') || '（无）'}`, '',
      '## 边界', '',
      '- 本目录只管这件事本身；别处需要它时只引用，不复制。',
    ].join('\n');
    fs.writeFileSync(path.join(abs, '00-入口.md'), body, 'utf8');
  }
}

const todoWhy = out.filter(r => r.why === '[待补]' || r.why === '[未知]').length;
const todoDesc = out.filter(r => r.desc === '[待补]').length;
console.log(`[reindex] project=${out.filter(r => r.type === 'project').length} skill=${out.filter(r => r.type === 'skill').length} external=${out.filter(r => r.type === 'external').length} total=${out.length}`);
console.log(`[reindex] 待补 why=${todoWhy} desc=${todoDesc}${DRY ? ' (dry-run，未写盘)' : ''}`);
