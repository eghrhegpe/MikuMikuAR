#!/usr/bin/env node
/**
 * doc-check-next-steps.mjs — 读 docs/.doc-check-last.json（由 pre-push hook 调 check-doc-drift.mjs --json 生成），
 * 产出面向 AI / 人的「下一步建议」简报 docs/.doc-check-next-steps.md。
 *
 * 设计：纯零依赖（node:fs / node:path / node:url）。
 *      JSON 缺失 / 解析失败 → 写最小占位并退出 0（绝不阻断 hook）。
 * 设计意图：文档下一步检查（生成器产出物验证）
 * 用法：
 *   node scripts/doc-check-next-steps.mjs                 # 默认行为
 *   node scripts/doc-check-next-steps.mjs --baseline # 启用 baseline
 *   node scripts/doc-check-next-steps.mjs --json     # JSON 输出（CI/子代理消费）
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const JSON_PATH = path.join(ROOT, 'docs', '.doc-check-last.json');
const OUT_PATH = path.join(ROOT, 'docs', '.doc-check-next-steps.md');

function load() {
  try {
    return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// 由源文件路径推导建议的知识卡名（去掉路径与 .ts 后缀）
function cardNameFromSource(rel) {
  const base = path.basename(rel).replace(/\.ts$/, '');
  return `${base}.md`;
}

function byDirStr(map) {
  return Object.entries(map || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join('，');
}

// architecture 卡必须有路由入口（用户决策：改为非阻断 AI 提示，不进 CI 红线）
// 扫描 docs/knowledge/*.md 的 tier: architecture 卡，核对是否出现在 routes.md 链接中。
// 非知识卡文件（机器生成的索引/地图，有 frontmatter 但非卡）须排除，避免 menu-map 等误判为「缺路由」。
const KNOWLEDGE_NON_CARDS = new Set([
  'README.md', 'index.md', 'routes.md', 'menu-map.md', 'graph.md', 'tier-review.md',
]);
function checkArchRoutes() {
  const knDir = path.join(ROOT, 'docs', 'knowledge');
  const routesPath = path.join(knDir, 'routes.md');
  const routesSet = new Set();
  if (fs.existsSync(routesPath)) {
    const rt = fs.readFileSync(routesPath, 'utf8');
    for (const m of rt.matchAll(/\]\(\.\/([A-Za-z0-9_-]+\.md)\)/g)) routesSet.add(m[1]);
  }
  let archTotal = 0;
  const missing = [];
  if (fs.existsSync(knDir)) {
    for (const f of fs.readdirSync(knDir)) {
      if (!f.endsWith('.md') || KNOWLEDGE_NON_CARDS.has(f)) continue;
      const t = fs.readFileSync(path.join(knDir, f), 'utf8');
      if (!/^---\r?\n/.test(t)) continue;
      const fm = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) continue;
      let tier = '';
      for (const l of fm[1].split(/\r?\n/)) {
        const mm = l.match(/^tier\s*:\s*(.*)$/);
        if (mm) { tier = mm[1].trim(); break; }
      }
      if (tier === 'architecture') {
        archTotal++;
        if (!routesSet.has(f)) missing.push(f.replace(/\.md$/, ''));
      }
    }
  }
  return { archTotal, missing };
}

function main() {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = load();

  if (!d) {
    fs.writeFileSync(
      OUT_PATH,
      '# 文档漂移 · 推送后下一步建议\n\n' +
        '> 生成时间: ' + ts + '\n\n' +
        '本次未生成快照（纯文档推送或 hook 跳过 check:docs）。无需动作。\n'
    );
    return;
  }

  const errors = d.errors || [];
  const cov = d.coverage || { undocumented: 0, undocumentedByDir: {} };
  const rev = d.reverse || { total: 0, byDir: {}, files: [] };
  const api = d.apiSymbols || { flagged: [] };
  const agentsWarns = d.agentsWarns || [];
  // 与 JSON 快照无关，独立扫描（即便 JSON 缺失也能给出路由提示）
  const archRoutes = checkArchRoutes();

  const L = [];
  L.push('# 文档漂移 · 推送后下一步建议');
  L.push('');
  L.push('> 由 `.githooks/pre-push` 自动生成（基于 `scripts/check-doc-drift.mjs --json`）。');
  L.push('> 生成时间: ' + ts);
  L.push('');

  // ── 总览 ──
  L.push('## 总览');
  L.push('');
  L.push('- ERROR 级漂移: **' + errors.length + '**（阻断级，需人工修复）');
  L.push('- 知识卡覆盖缺口: **' + rev.total + '** 个源文件尚无知识卡（INFO）');
  L.push('- 符号 0% 未文档化模块: **' + cov.undocumented + '**（INFO）');
  L.push('- 知识卡 API 符号可疑: **' + api.flagged.length + '** 张（INFO）');
  L.push('- AGENTS.md 手写事实索引 WARN: **' + agentsWarns.length + '** 项');
  L.push('- architecture 卡未登记路由: **' + archRoutes.missing.length + '**（INFO）');
  L.push('');

  // ── ERROR ──
  L.push('## 🔴 需人工修复（ERROR）');
  L.push('');
  if (errors.length === 0) {
    L.push('无 ERROR 级漂移。');
  } else {
    for (const e of errors) L.push('- ' + e);
  }
  L.push('');

  // ── 知识卡覆盖缺口 ──
  L.push('## 🟡 建议补登知识卡（INFO，不阻断）');
  L.push('');
  if (rev.total > 0) {
    L.push(rev.total + ' 个源文件尚无任何知识卡覆盖：');
    L.push('');
    for (const f of rev.files) {
      const card = cardNameFromSource(f);
      L.push('- `' + f + '` → 建议创建 `docs/knowledge/' + card + '`，frontmatter 登记 `source_files: [' + f + ']`');
    }
    const byDir = byDirStr(rev.byDir);
    if (byDir) {
      L.push('');
      L.push('  按目录: ' + byDir);
    }
  } else {
    L.push('无。');
  }
  L.push('');

  // ── 符号 0% 未文档化 ──
  L.push('## 🟡 符号 0% 未文档化模块（INFO，不阻断）');
  L.push('');
  if (cov.undocumented > 0) {
    L.push(cov.undocumented + ' 个模块导出符号 0% 出现在 architecture.md / function-map.md。');
    L.push('');
    const byDir = byDirStr(cov.undocumentedByDir);
    if (byDir) L.push('  按目录: ' + byDir);
    L.push('');
    L.push('  建议：补登 `docs/architecture.md` 目录树 或 `docs/function-map.md`。');
  } else {
    L.push('无。');
  }
  L.push('');

  // ── API 符号可疑 ──
  L.push('## 🟡 知识卡 API 符号可疑（INFO，不阻断）');
  L.push('');
  if (api.flagged.length > 0) {
    for (const f of api.flagged) {
      L.push('- `' + f.card + '` 查无符号: ' + (f.missing || []).join(', '));
    }
    L.push('');
    L.push('  建议：核对知识卡正文引用的函数名是否拼写错误 / 已更名 / 属外部框架。');
  } else {
    L.push('无。');
  }
  L.push('');

  // ── AGENTS WARN ──
  if (agentsWarns.length > 0) {
    L.push('## 🟡 AGENTS.md 手写事实索引（WARN，不阻断）');
    L.push('');
    for (const w of agentsWarns) L.push('- ' + w);
    L.push('');
  }

  // ── architecture 卡路由登记（INFO，不阻断；用户决策：A 改为 AI 提示，不进 CI 红线） ──
  L.push('## 🟡 architecture 卡未登记路由（INFO，不阻断）');
  L.push('');
  if (archRoutes.missing.length > 0) {
    L.push(archRoutes.missing.length + ' 张 architecture 卡未出现在 routes.md（AI 检索首跳可能漏接）：');
    L.push('');
    for (const name of archRoutes.missing) {
      L.push('- `' + name + '` → 建议在 `docs/knowledge/routes.md` 增加对应意图行并链接 `./' + name + '.md`');
    }
  } else {
    L.push('无（' + archRoutes.archTotal + ' 张 architecture 卡均已登记路由）。');
  }
  L.push('');

  // ── AI 下一步建议（最高优先级单条） ──
  L.push('## AI 下一步建议');
  L.push('');
  let advice;
  if (errors.length > 0) {
    advice = '存在 ' + errors.length + ' 处 ERROR 级漂移，需人工修复后再推送（运行 `node scripts/check-doc-drift.mjs --baseline` 查看详情）。';
  } else if (rev.total > 0) {
    advice = '为 ' + rev.files.length + ' 个尚无知识卡的源文件补建知识卡（见上方「建议补登知识卡」清单），登记 source_files 即可消除覆盖缺口。';
  } else if (archRoutes.missing.length > 0) {
    advice = '为 ' + archRoutes.missing.length + ' 张 architecture 卡补登 routes.md 路由入口（见上方「architecture 卡未登记路由」），避免 AI 检索首跳漏接。';
  } else if (cov.undocumented > 0) {
    advice = '将 ' + cov.undocumented + ' 个 0% 未文档化模块补登进 `docs/architecture.md` 树 / `docs/function-map.md`。';
  } else if (api.flagged.length > 0) {
    advice = '核对 ' + api.flagged.length + ' 张知识卡中查无的符号引用（拼写 / 更名 / 外部框架）。';
  } else {
    advice = '文档健康度 OK，无待办动作。';
  }
  L.push('> ' + advice);
  L.push('');

  fs.writeFileSync(OUT_PATH, L.join('\n'));
  console.log('📝 已生成 docs/.doc-check-next-steps.md（AI 可读的下一步建议）');
}

main();
