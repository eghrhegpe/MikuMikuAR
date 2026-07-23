/**
 * 临时探针：定位 gen-icon-bundle 5 个假阳性图标的来源。
 * 逐个 regex 逐个文件扫描，输出各 icon 被哪个文件的哪个 regex 命中。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = 'C:/Users/zhujieling11/MikuMikuAR/frontend/src';
const TARGETS = ['mirror', 'blur', 'spring', 'angle', 'hand-finger'];

function scanFile(txt, fileRel) {
  const hits = [];

  // A: 'lucide:xxx' / 'tabler:xxx'
  for (const m of txt.matchAll(/['"]((?:lucide|tabler):[a-z0-9-]+)['"]/gi)) {
    for (const t of TARGETS) if (m[1].includes(t)) hits.push(`A        ${m[1]}  ${fileRel}`);
  }

  // B: \bicon:\s*'xxx'
  for (const m of txt.matchAll(/\bicon:\s*[']([a-z0-9-]+)[']/gi)) {
    if (TARGETS.includes(m[1])) {
      const lineNo = txt.slice(0, m.index).split('\n').length;
      hits.push(`B icon:  ${m[1]}  ${fileRel}:${lineNo}`);
    }
  }

  // C: slideRow('...', 'xxx')
  for (const m of txt.matchAll(/slideRow\(\s*\S+\s*,\s*[']([a-z0-9-]+)[']/gi)) {
    if (TARGETS.includes(m[1])) hits.push(`C slide  ${m[1]}  ${fileRel}`);
  }

  // D: createIconifyIcon('xxx')
  for (const m of txt.matchAll(/createIconifyIcon\(\s*[']([a-z0-9-]+)[']/gi)) {
    if (TARGETS.includes(m[1])) hits.push(`D iconf  ${m[1]}  ${fileRel}`);
  }

  // E: <iconify-icon icon="xxx">
  for (const m of txt.matchAll(/<iconify-icon[^>]*icon=["]([a-z0-9:-]+)["]/gi)) {
    for (const t of TARGETS) if (m[1].includes(t)) hits.push(`E html   ${m[1]}  ${fileRel}`);
  }

  // F: lucide:${ ... 'xxx' }
  for (const m of txt.matchAll(/lucide:\${\s*[^}]*?[']([a-z0-9-]+)['"]/gi)) {
    if (TARGETS.includes(m[1])) hits.push(`F1 dyn   ${m[1]}  ${fileRel}`);
  }

  // G: @iconify/icons-lucide/xxx
  for (const m of txt.matchAll(/@iconify\/icons-(lucide|tabler)\/([a-z0-9-]+)/gi)) {
    if (TARGETS.includes(m[2])) hits.push(`G reg    ${m[2]}  ${fileRel}`);
  }

  return hits;
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'coverage', '.git', '__tests__', '__mocks__'].includes(e.name)) continue;
      walk(fp);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      if (e.name === 'icons-bundle.ts' || e.name.includes('.test.')) continue;
      const rel = path.relative(SRC_DIR, fp).replace(/\\/g, '/');
      const hits = scanFile(fs.readFileSync(fp, 'utf-8'), rel);
      for (const h of hits) console.log(h);
    }
  }
}

walk(SRC_DIR);
console.log('--- probe done ---');
