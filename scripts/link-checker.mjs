#!/usr/bin/env node
/**
 * link-checker.mjs — Markdown 链接检查。扫所有 md 文件，验证内部链接目标是否存在。
 *
 * ## 双实现职责边界（[P2 2026-08-07] 收敛：JS 为准做严格门禁）
 *   - 本脚本（`npm run link:check`）为**断链严格门禁**：--strict 断链即 exit 1，
 *     已接入 CI（ci.yml）与 pre-push 阻断；check:docs 链以本脚本收尾。
 *   - `tests/test_markdown_links.py`（`npm run check:md-links`）为**契约测试**：
 *     broken 链接仅打印不 exit 1，验证解析器基本行为；解析规则以本脚本为准，
 *     两者范围已对齐（均跳 dancexr-zh，不跳 docs/research/ 其他文档）。
 *
 * 用法：
 *   node scripts/link-checker.mjs            # 文本报告（信息型，exit 0）
 *   node scripts/link-checker.mjs --json     # JSON（便于 CI 解析）
 *   node scripts/link-checker.mjs --strict   # 门禁模式：存在断链即 exit 1
 * 设计意图：文档链接检查器
 * 依赖：node:fs / node:path / 本地模块
 * 退出码：strict && broken.length ? 1 : 0（失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT as REPO_ROOT } from './_lib/scan-files.mjs';
import { parseArgs } from './_lib/parse-args.mjs';

// 测试钩子：LINK_CHECK_ROOT 指向 fixture 目录（真实运行不设，不受影响），
// 供单测 spawn 时把扫描范围限定在临时 fixture（与 check-layering 的 LAYERING_SRC 同款）。
const ROOT = process.env.LINK_CHECK_ROOT ? path.resolve(process.env.LINK_CHECK_ROOT) : REPO_ROOT;

// vendored/外部源/工具态目录不参与链接治理：
//  - research/upstream/mmd_tools_repo 为导入的参考材料，其相对链接指向未同步的外部文件（预期断链）
//  - .qoder/.trae/.workbuddy 为外部/AI 工具生成的缓存或状态目录
// [P2 2026-08-07] 移除过宽的 'research'（此前 docs/research/ 25+ 份分析文档链接零校验），
// 仅保留 upstream/mmd_tools_repo 等导入参考；与 Python 版对齐（Python 只额外跳 dancexr-zh，见下）。
const SKIP_DIRS = new Set(['node_modules', 'archive', '.git', 'vendor', 'build', 'dist', '.qoder', 'upstream', 'mmd_tools_repo', '.trae', '.workbuddy']);

// [P3 2026-08-07] 导出纯函数供单测直测（test:scripts 此前无 link-checker 用例）。
export function walkMd(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function extractLinks(filepath) {
  /** 提取 md 文件中的 Markdown 链接。 */
  const links = [];
  let text;
  try {
    text = fs.readFileSync(filepath, 'utf-8');
  } catch { return links; }

  // 匹配 [text](path) 和 [text](path "title")
  // 先剔除 fenced 代码块（```...```），避免示例链接（如 adr-030 的占位章节路径）被误判为断链
  const stripped = text.replace(/```[\s\S]*?```/g, '');

  // 普通形式：[text](path "title")，path 不含空格（含空格会被下一分支捕获）
  const rePlain = /\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  // 尖括号形式：[text](<path with space> "title")，路径可含空格（buglog 中文/空格文件名）
  // [P2 2026-08-07] 此前 `[^)\s]+` 遇空格截断、`/[<>]/` 守卫把真实尖括号链接当占位符跳过。
  // [P3 2026-08-08] ① `[^>]+` → `[^<>]+`：内部含 `<` 视为占位符；
  // ② 末尾加 `\)`：真实尖括号链接 `(<path>)` 的 `>` 后必须紧跟 `)`——
  //    占位符 `<page>-<n>.png` 在 `page>` 后还有 `-<n>.png`，不会误匹配。
  // [P2 2026-08-08] ③ `>(?:\s+"[^"]*")?\)`：允许 CommonMark 带 title 的尖括号链接
  //    `[text](<path> "title")`——纯 `\)` 要求会让此类合法链接整体失配（rePlain 兜底
  //    捕获 `<path>` 又被 <> 守卫丢弃 → 断链漏检）。占位符 `page>` 后既非 `)` 也非 title，仍排除。
  const reAngle = /\[([^\]]*)\]\(<([^<>]+)>(?:\s+"[^"]*")?\)/g;
  for (const re of [reAngle, rePlain]) {
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const linkText = m[1];
      // 尖括号分支：路径可含空格，直接取全量（<...> 内即完整路径，无 title）；
      // 普通分支：去掉 title 部分（`path "title"` 形式）
      const rawPath = re === reAngle ? m[2].trim() : m[2].split(/\s+/)[0];
      // [P3 2026-08-08] 占位符链接（含 < >，如 `<page>-<n>.png`）不产出条目：
      // 普通分支 `[^)\s]+` 会捕获它们，若放行到 resolvePath 会绕过占位符守卫。
      // 此处与 resolvePath 的 `<>` 守卫同口径过滤。
      if (rawPath.includes('<') || rawPath.includes('>')) continue;
      links.push([linkText, rawPath, m.index]);
    }
  }
  return links;
}

export function resolvePath(filepath, rawPath) {
  /** 将 Markdown 相对路径解析为实际文件系统路径。 */
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return null; // 外部链接跳过
  if (rawPath.startsWith('file://')) return null; // 源码引用(file://...)非文档链接，跳过
  // 占位符链接（如 <page>-<n>.png）非真实链接，跳过。
  // [P2 2026-08-07] 真实尖括号链接 `<./xxx.md>` 已在 extractLinks 剥离尖括号，
  // 到此处若仍含 < > 即为占位符。
  if (rawPath.includes('<') || rawPath.includes('>')) return null;
  if (rawPath.startsWith('#')) return null; // 锚点跳过
  let candidate;
  if (rawPath.startsWith('/')) {
    // 绝对路径从项目根开始
    candidate = path.join(ROOT, rawPath.replace(/^\/+/, ''));
  } else {
    // 相对路径从文件目录开始
    candidate = path.join(path.dirname(filepath), rawPath);
  }

  // 去掉 #anchor
  const base = path.basename(candidate);
  if (base.includes('#')) {
    candidate = path.join(path.dirname(candidate), base.split('#')[0]);
  }

  candidate = path.resolve(candidate);
  return candidate;
}

function checkLinks(files) {
  /** 检查文件列表中的所有内部链接。 */
  const broken = [];
  let okCount = 0;
  for (const fp of files) {
    for (const [text, rawPath, pos] of extractLinks(fp)) {
      const resolved = resolvePath(fp, rawPath);
      if (resolved === null) continue; // 外部链接
      if (fs.existsSync(resolved)) {
        okCount += 1;
      } else {
        const rel = path.relative(ROOT, fp);
        let type = 'file';
        try {
          if (fs.statSync(resolved).isDirectory()) type = 'dir';
        } catch { /* doesn't exist */ }
        broken.push({
          file: rel,
          position: pos,
          link_text: text,
          raw_path: rawPath,
          resolved_path: resolved,
          type,
        });
      }
    }
  }
  return [okCount, broken];
}

// [P1 2026-08-07] 未知 flag 不再静默：旧实现 `args.includes('--json')` 手写解析，
// `--stict` 打字错误会静默退回 info 模式 exit 0 → 门禁静默失效。改走 _lib/parse-args
// 契约（未知 flag 报错退 1，符合 scripts/README「未知 --flag 一律报错退 1」）。
const { json: jsonMode, strict, help, unknown } = parseArgs(process.argv.slice(2), {
  bools: ['json', 'strict'],
  strings: [],
  defaults: {},
});
if (help) {
  const _src = fs.readFileSync(process.argv[1], 'utf-8');
  const _s = _src.indexOf('/**');
  const _e = _src.indexOf('*/', _s);
  console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
if (unknown && unknown.length) {
  console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}

// 收集所有 md 文件（跳过 archive）
function main() {
const files = [];
for (const f of walkMd(ROOT)) {
  const relParts = path.relative(ROOT, f).split(path.sep);
  if (relParts.some((s) => SKIP_DIRS.has(s))) continue;
  // 与 Python 版对齐（test_markdown_links.py:121）：dancexr-zh 为外部参考，跳过
  if (relParts.includes('dancexr-zh')) continue;
  files.push(f);
}

const [ok, broken] = checkLinks(files);

if (jsonMode) {
  const out = {
    _summary: { files_scanned: files.length, links_ok: ok, links_broken: broken.length },
    broken_links: broken,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(strict && broken.length ? 1 : 0);
}

process.stdout.write(`扫描 ${files.length} 个 md 文件\n有效链接: ${ok}, 断链: ${broken.length}\n\n`);
if (broken.length) {
  for (const b of broken) {
    process.stdout.write(`  [BROKEN] ${b.file}: 链接 \`${b.link_text}\` -> \`${b.raw_path}\`\n`);
  }
  process.stdout.write(`\n共 ${broken.length} 条断链\n`);
} else {
  process.stdout.write('全部链接有效\n');
}

// 门禁模式：存在断链则非零退出（可接 CI 卡点）；--strict 未启用时仅信息展示
process.exit(strict && broken.length ? 1 : 0);
}

// 仅直接运行时执行主流程；被测试 import 时只导出纯函数（extractLinks/resolvePath/walkMd）
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
