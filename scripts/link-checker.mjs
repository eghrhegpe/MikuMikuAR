#!/usr/bin/env node
/**
 * Markdown 链接检查。扫所有 md 文件，验证内部链接目标是否存在。
 * 由 ysm-model-manager/scripts/link-checker.mjs 搬运至联邦（2026-08-03），逻辑逐点保真。
 *
 * 用法：
 *   node scripts/link-checker.mjs            # 文本报告（信息型，exit 0）
 *   node scripts/link-checker.mjs --json     # JSON（便于 CI 解析）
 *   node scripts/link-checker.mjs --strict   # 门禁模式：存在断链即 exit 1
 * 设计意图：文档链接检查器
 * 依赖：node:fs / node:path / node:url
 * 退出码：strict && broken.length ? 1 : 0（失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

// vendored/外部源/工具态目录不参与链接治理：
//  - research/upstream/mmd_tools_repo 为导入的参考材料，其相对链接指向未同步的外部文件（预期断链）
//  - .qoder/.trae/.workbuddy 为外部/AI 工具生成的缓存或状态目录
const SKIP_DIRS = new Set(['node_modules', 'archive', '.git', 'vendor', 'build', 'dist', '.qoder', 'research', 'upstream', 'mmd_tools_repo', '.trae', '.workbuddy']);

function walkMd(dir) {
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

function extractLinks(filepath) {
  /** 提取 md 文件中的 Markdown 链接。 */
  const links = [];
  let text;
  try {
    text = fs.readFileSync(filepath, 'utf-8');
  } catch { return links; }

  // 匹配 [text](path) 和 [text](path "title")
  // 先剔除 fenced 代码块（```...```），避免示例链接（如 adr-030 的占位章节路径）被误判为断链
  const stripped = text.replace(/```[\s\S]*?```/g, '');

  const re = /\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const linkText = m[1];
    const rawPath = m[2].split(/\s+/)[0]; // 去掉 title 部分
    links.push([linkText, rawPath, m.index]);
  }
  return links;
}

function resolvePath(filepath, rawPath) {
  /** 将 Markdown 相对路径解析为实际文件系统路径。 */
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return null; // 外部链接跳过
  if (rawPath.startsWith('file://')) return null; // 源码引用(file://...)非文档链接，跳过
  if (/[<>]/.test(rawPath)) return null; // 占位符链接（如 <page>-<n>.png）非真实链接，跳过
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

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const strict = args.includes('--strict'); // 门禁模式：断链即 exit 1，可接 CI 卡点

// 收集所有 md 文件（跳过 archive）
const files = [];
for (const f of walkMd(ROOT)) {
  const relParts = path.relative(ROOT, f).split(path.sep);
  if (relParts.some((s) => SKIP_DIRS.has(s))) continue;
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
