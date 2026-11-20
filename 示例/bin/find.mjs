#!/usr/bin/env node
// find.mjs —— 档案库唯一查询入口（薄壳：算法全在 model.mjs，和界面共用一份）
// 用法:
//   node bin/find.mjs <关键词>       精确层：匹配 name / kw / desc / path
//   node bin/find.mjs list [type]    清单层：列出全部 (project|skill|external)，也可当关键词
//   node bin/find.mjs show <id>      展开一条
//   node bin/find.mjs 最近 [N]        按最近改动倒序
//   --all  包含 paused/dead/missing
import path from 'node:path';
import { readRows, search, stats, fmtText, LABEL, isVisible } from './model.mjs';
import { resolveRoot, rootHelp } from './root.mjs';

const ROOT = resolveRoot(process.argv.slice(2));
const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root' && argv[i - 1] !== '-r');

const { rows, missing, stale } = readRows(ROOT);
if (missing) {
  const h = rootHelp(ROOT);
  console.error(h.hint || '索引不存在，先跑: node bin/reindex.mjs');
  process.exit(2);
}
const tail = stale ? '\n⚠ 索引可能落后于磁盘（目录有更新），需要时跑 node bin/reindex.mjs' : '';
const cmd = args[0];

if (!cmd) {
  console.log(`用法:
  node bin/find.mjs <关键词>
  node bin/find.mjs list [project|skill|external] [关键词]
  node bin/find.mjs show <id>
  node bin/find.mjs 最近 [N]
可选 --all 显示 paused/dead/missing`);
  process.exit(0);
}

if (cmd === 'list') {
  const raw = args[1];
  const type = ['project', 'skill', 'external'].includes(String(raw).toLowerCase()) ? String(raw).toLowerCase() : null;
  const kw = type ? args[2] : raw;
  let list = rows.filter((r) => isVisible(r, ALL) && (!type || r.type === type));
  if (kw) {
    const k = String(kw).toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(k)
      || (r.kw || []).some((x) => String(x).toLowerCase().includes(k))
      || String(r.desc).toLowerCase().includes(k));
  }
  const by = {};
  for (const r of list) (by[r.type] ||= []).push(r);
  for (const t of Object.keys(by)) {
    console.log(`\n== ${LABEL[t] || t} (${by[t].length}) ==`);
    for (const r of by[t]) console.log(`  ${r.id}  ${r.name.padEnd(18, ' ')} ${String(r.desc).slice(0, 46)}`);
  }
  const s = stats(rows);
  console.log(`\n共 ${s.total} 项（项目 ${s.project} · 技能 ${s.skill} · 外部 ${s.external}）${s.missing ? ` · ${s.missing} 项目录已消失` : ''}${tail}`);
  process.exit(0);
}

if (['最近', '最近改的', 'recent'].includes(cmd)) {
  const n = parseInt(args[1], 10) || 10;
  const list = rows.filter((r) => isVisible(r, ALL)).filter((r) => r.lastChange)
    .sort((a, b) => String(b.lastChange).localeCompare(String(a.lastChange))).slice(0, n);
  console.log(`最近改动 ${list.length} 项：\n`);
  for (const r of list) console.log(`${r.id}  ${r.name.padEnd(20, ' ')} ${r.lastChange}  · ${LABEL[r.type] || r.type}`);
  if (tail) console.log(tail);
  process.exit(0);
}

if (cmd === 'show') {
  const r = rows.find((x) => String(x.id).toLowerCase() === String(args[1] || '').toLowerCase());
  if (!r) { console.log(`没有 ${args[1]}`); process.exit(1); }
  console.log(fmtText(r));
  process.exit(0);
}

const hit = search(rows, cmd, { all: ALL });
if (hit.length) {
  console.log(`命中 ${hit.length} 项：\n`);
  hit.forEach((r) => console.log(fmtText(r) + '\n'));
} else {
  console.log(`「${cmd}」精确匹配 0 条。`);
  console.log('试试换个说法（同义词/角色名/文件名），或用 node bin/find.mjs list 看全量。');
}
if (tail) console.log(tail);
