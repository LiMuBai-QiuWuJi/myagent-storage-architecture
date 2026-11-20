// root.mjs —— 统一的「库根在哪」判断
// 三个入口（find / reindex / serve）都从这里取，别各写一遍。
// 顺序：--root 参数 > 环境变量 KB_ROOT/MYAGENT_ROOT > 脚本上一级 > 当前目录
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function looksLikeRoot(dir) {
  for (const name of ['项目', '索引']) {
    try { if (fs.statSync(path.join(dir, name)).isDirectory()) return true; } catch { /* 跳过 */ }
  }
  return false;
}

export function resolveRoot(argv = process.argv.slice(2)) {
  const i = argv.findIndex((a) => a === '--root' || a === '-r');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);

  for (const key of ['KB_ROOT', 'MYAGENT_ROOT']) {
    const v = process.env[key];
    if (v && v.trim()) return path.resolve(v.trim());
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const cand of [path.resolve(here, '..'), process.cwd()]) {
    if (looksLikeRoot(cand)) return cand;
  }
  return path.resolve(here, '..');
}

export function rootHelp(root) {
  const has = (n) => { try { return fs.existsSync(path.join(root, n)); } catch { return false; } };
  const miss = [];
  if (!has('项目')) miss.push('项目/');
  if (!has('索引')) miss.push('索引/');
  return {
    root,
    ok: miss.length === 0,
    miss,
    hint: miss.length
      ? `当前根目录 ${root} 里没有 ${miss.join(' 和 ')}。`
        + `在这里跑没用——三个办法任选：① cd 到档案库根再跑；② 加 --root "D:\\你的库"；`
        + `③ 设 KB_ROOT 环境变量。脚本放包里时尤其容易踩这个。`
      : '',
  };
}
