// 临时探针：扫描未标 tier 的知识卡，依据 source_files 判定 barrel（纯 re-export）占比。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const KDIR = 'docs/knowledge';
const EXPORT_FROM_RE = /^\s*export\s+(?:type\s+|interface\s+|const\s+|function\s+|class\s+)?[\w*\s{},]*\s+from\s+/;
const EXPORT_STAR_RE = /^\s*export\s+\*\s+from\s+/;
const REEXPORT_RE = /^\s*export\s*[{*]/; // export { ... } 或 export *

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  return m[1];
}
function getField(fm, key) {
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(key + ':')) {
      const inline = lines[i].slice(key.length + 1).trim();
      if (inline && !inline.startsWith('[') && !inline.startsWith('-')) return inline;
      // 收集后续 - 列表项
      const items = [];
      if (inline.startsWith('[')) {
        const arr = inline.replace(/^\[/, '').replace(/\]$/, '');
        arr.split(',').forEach((s) => { const t = s.trim(); if (t) items.push(t); });
        if (items.length) return items;
      }
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^\S/.test(l) && !l.startsWith('-')) break;
        const mm = l.match(/^\s*-\s*(.+?)\s*$/);
        if (mm) items.push(mm[1]);
      }
      return items;
    }
  }
  return null;
}
function isBarrel(absPath) {
  if (!fs.existsSync(absPath)) return false;
  const src = fs.readFileSync(absPath, 'utf8');
  const lines = src.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
  });
  if (lines.length === 0) return false;
  let reexport = 0;
  for (const l of lines) {
    if (EXPORT_STAR_RE.test(l) || EXPORT_FROM_RE.test(l) || REEXPORT_RE.test(l)) reexport++;
    else if (/^\s*(export\s+)?(default\s+)?(function|class|const|let|var|interface|type|enum)\s+\w/.test(l)) {
      // 自身定义 → 不是纯 barrel
      return false;
    }
  }
  return reexport > 0 && reexport === lines.length;
}

const files = fs.readdirSync(KDIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f !== 'routes.md');
let untagged = 0, barrels = 0, nonBarrel = 0;
const barrelList = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(KDIR, f), 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm) continue;
  const tier = getField(fm, 'tier');
  if (tier && String(tier).trim() && !/^<.*>$/.test(String(tier).trim())) continue; // 已标，跳过
  untagged++;
  const sf = getField(fm, 'source_files');
  const sfs = Array.isArray(sf) ? sf : sf ? [sf] : [];
  let barrel = false;
  for (const s of sfs) {
    if (isBarrel(path.join(ROOT, s))) { barrel = true; break; }
  }
  if (barrel) { barrels++; barrelList.push(f); } else nonBarrel++;
}
console.log(`未标 tier 卡总数: ${untagged}`);
console.log(`  其中 barrel(自动 leaf 候选): ${barrels}`);
console.log(`  非 barrel(需 import-breadth/人工复核): ${nonBarrel}`);
console.log('barrel 列表:', barrelList.join(', '));
