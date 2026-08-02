/**
 * frontmatter.mjs
 * 知识卡/ADR frontmatter 解析共享工具 —— 各脚本各写一套的痛点由本模块统一。
 *
 * 用法：
 *   import { parseFrontmatter, getScalar, getList, parseSourceFiles, parseAdrHeader }
 *     from './_lib/frontmatter.mjs';
 *
 *   const fm = parseFrontmatter(text);
 *   const name = getScalar(fm, 'name');
 *   const adrs = getList(fm, 'adr');
 *
 * 零依赖（仅 node:fs / node:path）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 提取 frontmatter 块字符串，无则返回 null。 */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/** 提取 frontmatter 标量字段（key: value 或 key: value#注释）。 */
export function getScalar(fm, key) {
  if (!fm) return undefined;
  const line = fm.match(new RegExp('^' + escapeRe(key) + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  let v = line[1].trim();
  if (v === '' || v.startsWith('<')) return undefined;
  return v.replace(/\s*#.*/, '').trim();
}

/** 提取 frontmatter 列表字段（块列表或行内数组）。 */
export function getList(fm, key) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + escapeRe(key) + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/\s*#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/\s*#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

/** 解析 source_files 字段（兼容行内数组 [a, b] 与块列表）。 */
export function parseSourceFiles(fm) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const head = line.match(/^source_files\s*:\s*(.*)$/);
    if (!head) continue;
    inBlock = true;
    // 行内数组: source_files: [a.ts, b.ts]
    const inline = head[1].match(/\[([^\]]*)\]/);
    if (inline) {
      inline[1].split(',').forEach((s) => {
        const v = s.trim().replace(/^['"]|['"]$/g, '');
        if (v) out.push(v);
      });
      inBlock = false;
      continue;
    }
  }
  // 块列表
  let inBlock2 = false;
  for (const line of lines) {
    if (/^source_files\s*:\s*$/.test(line) || /^source_files\s*:\s*\[/.test(line)) {
      inBlock2 = true;
      continue;
    }
    if (inBlock2) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        const v = item[1].replace(/^['"]|['"]$/g, '').trim();
        if (v) out.push(v);
      } else if (/^\S/.test(line)) {
        inBlock2 = false;
      }
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析 ADR 文件首部，返回 { num, title, status, date }。
 * 复用 gen-status-index.mjs / gen-adr-supersede.mjs 的解析契约。
 * 支持 blockquote / list / table 三种首部格式，兼容中文冒号。
 */
export function parseAdrHeader(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  let num = null;
  let title = '';
  let status = '';
  let date = '';

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];

    // # ADR-NNN: Title 或 # ADR-NNN Title
    const mTitle = line.match(/^#\s+ADR-(\d+):\s*(.+)/);
    if (mTitle) {
      num = parseInt(mTitle[1], 10);
      title = mTitle[2].trim();
      continue;
    }
    // 兼容无冒号：# ADR-NNN Title
    const mTitleNoColon = line.match(/^#\s+ADR-(\d+)\s+(.+)/);
    if (mTitleNoColon && !mTitle) {
      num = parseInt(mTitleNoColon[1], 10);
      title = mTitleNoColon[2].trim();
      continue;
    }

    // **状态** 四种格式
    const mStatus = line.match(/^>\s*\*\*状态\*\*\s*[：:]\s*(.+)/)
      || line.match(/^[-*]\s*\*\*状态\*\*\s*[：:]\s*(.+)/)
      || line.match(/^\s*\*\*状态\*\*\s*[：:]\s*(.+)/)
      || line.match(/^\|\s*\*\*状态\*\*\s*\|\s*(.+?)\s*\|\s*$/);
    if (mStatus) {
      status = mStatus[1].trim();
      continue;
    }

    // **日期** 四种格式
    const mDate = line.match(/^>\s*\*\*日期\*\*\s*[：:]\s*(.+)/)
      || line.match(/^[-*]\s*\*\*日期\*\*\s*[：:]\s*(.+)/)
      || line.match(/^\s*\*\*日期\*\*\s*[：:]\s*(.+)/)
      || line.match(/^\|\s*\*\*日期\*\*\s*\|\s*(.+?)\s*\|\s*$/);
    if (mDate) {
      date = mDate[1].trim();
      continue;
    }

    // blockquote 结束标记
    if (line.startsWith('---') && status) break;
  }

  if (num === null) return { error: '未找到 ADR 编号' };
  if (!status) return { error: '未找到可解析的状态字段' };
  if (!title) return { error: '未找到 ADR 标题' };
  if (date && !/^\d{4}-\d{2}-\d{2}/.test(date)) return { error: `日期格式不可识别：${date}` };

  return { num, title, status, date };
}
