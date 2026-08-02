#!/usr/bin/env node
/**
 * gen-adr-supersede.mjs
 * 扫描 docs/adr/ 全部 ADR,输出「取代关系」判定结果:
 *
 *   ① 已登记:旧 ADR 首部状态行明确声明「被 [ADR-NNN] 取代」
 *   ② 漏标告警:某 ADR 正文宣称「取代/废弃了 ADR-NNN」,但被取代方首部状态行未回标
 *      (即「反向引用」存在而「直接声明」缺失 —— 判别方法第二层证据)
 *   ③ 废弃未指明:状态行含「废弃」但未指明取代者(可能是放弃,不一定是被取代)
 *   ④ 可疑信号:正文提及「废弃/过时/退役/推翻」且同时出现其他 ADR 编号,
 *      措辞不规整,需人工确认(判别方法第四层:语义冲突)
 *   ⑤ 表格弱宣称:表格行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代/取代/推翻」,
 *      跨列自指替代关系(动词与编号被表格列分隔,紧邻正则抓不到,如 ADR-084 → ADR-019)
 *
 * 用法:
 *   node scripts/gen-adr-supersede.mjs         # 打印取代关系清单(0 = 正常)
 *   node scripts/gen-adr-supersede.mjs --check # 存在漏标/废弃未指明时退出码 1(供 check:docs 用)
 *
 * 零依赖(仅 node:fs / node:path)。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAdrHeader } from './_lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.join(ROOT, 'docs', 'adr');

const FLAG_CHECK = process.argv.includes('--check');
const FLAG_QUIET = process.argv.includes('--quiet');

// ── 正则 ──

// ① 状态行/正文中「被 ADR-NNN 取代」类声明(支持 [ADR-NNN](xxx) 链接写法)——已登记
const RE_SUPERSEDED_BY = /被\s*\[?ADR-(\d+)\]?[^)\]]*\)?\s*(?:取代|替代|推翻|退役)/;
// ③ 状态行自身废弃:带 ⚠️/🗑️ 强调标记,或以废弃类词开头(不指明取代者)
//    注意:不能仅因状态行「提到」废弃就判定——ADR-59「废弃 Go UIState 字段」是废弃了别的东西,不是自身废弃
const RE_SELF_DEPRECATED = /(?:⚠️|🗑️)\s*\**(?:已废弃|已过时|已放弃|已搁置|已退役)|^(?:已废弃|已过时|已放弃|已搁置|已退役|搁置|废弃)/;
// ② 正文「取代/废弃了 ADR-NNN」类宣称,紧邻式(间隔 ≤8 个非字母数字字符),避免宽词误报:
//   A. 宣称方在前:「取代 ADR-019」「替代了 ADR-123」
//   B. 被废弃方在前:「ADR-144 已废弃」「ADR-019(已废弃)」
const RE_CLAIM_A = /(?:取代|替代|推翻|废弃|废除)\s*了?\s*\[?ADR-(\d+)\]?/g;
const RE_CLAIM_B = /ADR-(\d+)\s*[）)]?\s*(?:已\s*(?:废弃|过时|放弃|搁置|退役)|被\s*(?:取代|推翻|替代))/g;
// ④ 可疑信号强词:仅「推翻」与「过时」值得人工确认(决策冲突/文档漂移)
const RE_DEPRECATED_WORD = /(推翻|已过时)/;
// ④ 否定语境过滤:「非推翻/不推翻/未推翻」等明确否认,不算冲突信号
const RE_NEGATED = /(非|不|未|无|没有)\s*推翻/;
// ⑤ 表格弱宣称:行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代/取代/推翻」(跨列自指)
const RE_TABLE_FIRST_COL = /^\|\s*ADR-(\d+)/;
const RE_TABLE_VERB = /本\s*ADR[^|]{0,30}(?:完全)?(?:替代|取代|推翻)/;
// ⑤ 否定语境过滤:「不替代/不取代」等明确否认
const RE_TABLE_NEGATED = /(非|不|未|无|没有)\s*(?:替代|取代|推翻)/;

// ── 主流程 ──

function main() {
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => /^adr-\d+.*\.md$/.test(f))
    .sort();

  const adrs = new Map(); // num -> { file, title, status }
  const registered = [];  // ① 已登记取代: oldNum -> { by, status }
  const unmarked = [];    // ② 漏标告警: 正文宣称取代 target,但 target 状态行未回标
  const unpointed = [];   // ③ 废弃未指明取代者
  const suspicious = [];  // ④ 可疑信号(措辞不规整)
  const tableClaims = []; // ⑤ 表格弱宣称(行首 ADR 编号 + 行内「本 ADR…替代/取代」)

  // 第一遍:解析全部首部
  for (const file of files) {
    const parsed = parseAdrHeader(path.join(ADR_DIR, file));
    if (parsed && !parsed.error && parsed.num !== null) {
      const { num, title, status } = parsed;
      adrs.set(num, { file, title, status });
    }
  }

  // 第二遍:逐篇判定
  for (const [num, meta] of [...adrs.entries()].sort((a, b) => a[0] - b[0])) {
    const text = fs.readFileSync(path.join(ADR_DIR, meta.file), 'utf8');
    const lines = text.split(/\r?\n/);

    // ① 状态行声明「被 ADR-NNN 取代」
    const mBy = meta.status.match(RE_SUPERSEDED_BY);
    if (mBy && parseInt(mBy[1], 10) !== num) {
      registered.push({ old: num, by: parseInt(mBy[1], 10), source: meta.status });
    }

    // ③ 状态行自身废弃(⚠️/🗑️ 强调或开头即废弃类词)但未指明取代者(且未被①覆盖)
    if (RE_SELF_DEPRECATED.test(meta.status) && !mBy) {
      unpointed.push({ num, source: meta.status });
    }

    // ② / ④ 正文扫描(跳过首部状态行)
    const headerEnd = Math.min(lines.length, 20);
    for (let i = headerEnd; i < lines.length; i++) {
      const line = lines[i];

      // ② 明确宣称结构:行内「取代/替代…ADR-NNN」或「ADR-NNN…已废弃」,抽取全部目标
      const targets = [];
      for (const m of line.matchAll(RE_CLAIM_A)) targets.push(parseInt(m[1], 10));
      for (const m of line.matchAll(RE_CLAIM_B)) targets.push(parseInt(m[1], 10));

      const claimedThisLine = [];
      for (const target of targets) {
        if (target !== num && adrs.has(target)) {
          claimedThisLine.push(target);
          const tMeta = adrs.get(target);
          const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
          if (!tMarked) {
            unmarked.push({ claimedBy: num, target, line: line.trim().slice(0, 120) });
          }
        }
      }

      // ④ 可疑信号:行内含其他 ADR 编号 + 强词(推翻/已过时),但无明确宣称结构,且对方未标记 → 人工确认
      if (claimedThisLine.length === 0 && RE_DEPRECATED_WORD.test(line) && !RE_NEGATED.test(line)) {
        const others = [...new Set([...line.matchAll(/ADR-(\d+)/g)].map(m => parseInt(m[1], 10)))]
          .filter(n => n !== num && adrs.has(n));
        for (const other of others) {
          const tMeta = adrs.get(other);
          const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
          if (!tMarked) {
            suspicious.push({ num, target: other, line: line.trim().slice(0, 120) });
          }
        }
      }

      // ⑤ 表格弱宣称:行首列为 ADR-NNN、行内含「本 ADR…替代/取代/推翻」
      //    (跨列自指:动词与编号被表格列分隔,紧邻正则抓不到,如 ADR-084 → ADR-019)
      const mTable = line.match(RE_TABLE_FIRST_COL);
      if (mTable && RE_TABLE_VERB.test(line) && !RE_TABLE_NEGATED.test(line)) {
        const target = parseInt(mTable[1], 10);
        if (target !== num && adrs.has(target)) {
          tableClaims.push({ num, target, line: line.trim().slice(0, 120) });
        }
      }
    }
  }

  // ── 输出 ──
  if (!FLAG_QUIET) {
    console.log('=== ADR 取代关系扫描 ===\n');

    console.log(`① 已登记取代(${registered.length}):`);
    for (const r of registered) {
      console.log(`   ADR-${r.old} → ADR-${r.by}   [状态行: ${r.source.slice(0, 80)}]`);
    }

    console.log(`\n③ 状态行含废弃/放弃但未指明取代者(${unpointed.length}):`);
    for (const u of unpointed) {
      console.log(`   ADR-${u.num}   [${u.source.slice(0, 80)}]`);
    }

    console.log(`\n② 漏标告警 — 被正文宣称取代/废弃但首部未回标(${unmarked.length}):`);
    for (const u of unmarked) {
      console.log(`   ADR-${u.target} 被 ADR-${u.claimedBy} 宣称 [${u.line}]`);
    }

    console.log(`\n④ 可疑信号 — 措辞不规整,对方未标记,需人工确认(${suspicious.length}):`);
    for (const s of suspicious) {
      console.log(`   ADR-${s.num} 提及 ADR-${s.target} [${s.line}]`);
    }

    console.log(`\n⑤ 表格弱宣称 — 行首 ADR 编号 + 「本 ADR…替代/取代」跨列关系(${tableClaims.length}):`);
    for (const t of tableClaims) {
      console.log(`   ADR-${t.num} 声称替代 ADR-${t.target} [${t.line}]`);
    }
    console.log(`\n扫描 ${adrs.size} 篇 ADR 完成。`);
  }

  // --check 模式:存在漏标或废弃未指明 → 退出码 1
  if (FLAG_CHECK && (unmarked.length > 0 || unpointed.length > 0)) {
    if (!FLAG_QUIET) {
      console.error(`\n⚠️ 存在 ${unmarked.length} 处漏标、${unpointed.length} 处废弃未指明,请补标首部状态行。`);
    }
    process.exit(1);
  }
}

main();
