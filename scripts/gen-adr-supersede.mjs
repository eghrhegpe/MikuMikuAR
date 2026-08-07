#!/usr/bin/env node
/**
 * gen-adr-supersede.mjs — 扫描 docs/adr/ 全部 ADR,输出「取代关系」判定结果:
 *
 *   ① 已登记:旧 ADR 首部状态行明确声明「被 [ADR-NNN] 取代」
 *   ①b 部分推翻:声明带局部限定词(部分/§N/条目 N),只有该章节失效,整篇不归档
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
 *   node scripts/gen-adr-supersede.mjs --check # 仅 ②(漏标)失败时退出码 1(供 check:docs 用);
 *                                              # ③/④/⑤ 只提示不拦截,详见文末 --check 分支注释
 *
 * 零依赖(仅 node:fs / node:path)。
 * 设计意图：ADR 替代关系生成器
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAdrHeader } from './_lib/frontmatter.mjs';
import { ROOT } from './_lib/scan-files.mjs';
import {
  RE_SUPERSEDED_BY,
  RE_PARTIAL,
  RE_SELF_DEPRECATED,
  RE_CLAIM_A,
  RE_CLAIM_B,
  RE_DEPRECATED_WORD,
  RE_NEGATED_CLAIM,
  RE_TABLE_FIRST_COL,
  RE_TABLE_VERB,
  RE_TABLE_NEGATED,
  globalOf,
} from './_lib/supersede-regex.mjs';

// [fix] CLI 健壮性契约：--help 自吐 JSDoc 退 0 / 未知 flag 退 1（2026-08-06）
const _HELP = new Set(['--help', '-h']);
const _KNOWN = new Set(['--check', '--quiet', '--strict']);
const _REST = process.argv.slice(2);
if (_REST.some((a) => _HELP.has(a))) {
  const _SRC = fs.readFileSync(process.argv[1], 'utf-8');
  const _B = _SRC.indexOf('/**');
  const _X = _SRC.indexOf('*/', _B);
  console.log(_SRC.slice(_B, _X + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
const _UNK = _REST.filter((a) => a.startsWith('--') && !_KNOWN.has(a) && !_HELP.has(a));
if (_UNK.length) {
  console.error(`❌ 未知参数: ${_UNK.join(', ')}（--help 查看用法）`);
  process.exit(1);
}

// matchAll 强制要求 g 标志;共享常量刻意无 g(避免 lastIndex 状态串味),这里各建一份带 g 的副本。
// matchAll 内部自带克隆,不会污染这两个副本的 lastIndex,可安全跨行复用。
const RE_CLAIM_A_G = globalOf(RE_CLAIM_A);
const RE_CLAIM_B_G = globalOf(RE_CLAIM_B);
const RE_NEGATED_CLAIM_G = globalOf(RE_NEGATED_CLAIM);

const ADR_DIR = path.join(ROOT, 'docs', 'adr');

const FLAG_CHECK = process.argv.includes('--check');
const FLAG_QUIET = process.argv.includes('--quiet');
const FLAG_STRICT = process.argv.includes('--strict'); // --strict：④可疑/⑤表格弱宣称也 exit 1

// ── 已知勘误注记白名单（人工核对后登记，非取代关系，不再报 ④） ──
// 判别：被提及方并非被「取代」，而是被勘误/引用/整合，状态行无废弃词属正常。
//   56-54    ADR-56 背景勘误 ADR-054「gaze 仅 JS 生效」描述已过时 → 修正为双路径已实施（正文 §修改 ADR-054 §二）
//   56-16    ADR-56 引用 ADR-016 双路径 gaze 佐证勘误，非取代
//   162-166  ADR-162 状态行自标「§6 验收标准已过时」（pin 整合入 tier 系统），勘误注记非取代
//   162-164  ADR-162 §六勘误：pin 功能已随 ADR-164/166 整合入 tier，勘误注记非取代
const KNOWN_ERRATA = new Set(['56-54', '56-16', '162-166', '162-164']);

// ── 主流程 ──

function main() {
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => /^adr-\d+.*\.md$/.test(f))
    .sort();

  const adrList = [];     // { num, file, title, status } 全量,允许同 num(子编号 061.1 两篇)
  const adrNums = new Set(); // 所有 num(去重,用于正文引用存在性判断)
  const registered = [];  // ① 已登记取代: oldNum -> { by, status }
  const partial = [];     // ①b 部分推翻/部分取代: 状态行带局部限定词(部分/§N/条目 N),不算整篇被取代
  const unmarked = [];    // ② 漏标告警: 正文宣称取代 target,但 target 状态行未回标
  const unpointed = [];   // ③ 废弃未指明取代者
  const suspicious = [];  // ④ 可疑信号(措辞不规整)
  const tableClaims = []; // ⑤ 表格弱宣称(行首 ADR 编号 + 行内「本 ADR…替代/取代」)

  // 第一遍:解析全部首部
  for (const file of files) {
    const parsed = parseAdrHeader(path.join(ADR_DIR, file));
    if (parsed && !parsed.error && parsed.num !== null) {
      const { num, title, status, statusLine } = parsed;
      adrList.push({ num, file, title, status, statusLine });
      adrNums.add(num);
    }
  }
  // 按编号排序(同 num 子编号按文件名保持稳定顺序)
  adrList.sort((a, b) => a.num - b.num || a.file.localeCompare(b.file));

  // 第二遍:逐篇判定
  for (const meta of adrList) {
    const num = meta.num;
    const text = fs.readFileSync(path.join(ADR_DIR, meta.file), 'utf8');
    const lines = text.split(/\r?\n/);

    // ① 状态行声明「被 ADR-NNN 取代」
    //    带局部限定词(部分/§N/条目 N)的只推翻了某几节,分流到 ①b「部分推翻」而非整篇归档
    const mBy = meta.status.match(RE_SUPERSEDED_BY);
    const isPartial = Boolean(mBy) && RE_PARTIAL.test(meta.status);
    if (mBy && parseInt(mBy[1], 10) !== num) {
      const entry = { old: num, by: parseInt(mBy[1], 10), source: meta.status };
      (isPartial ? partial : registered).push(entry);
    }

    // ③ 状态行自身废弃(⚠️/🗑️ 强调或开头即废弃类词)但未指明取代者(且未被①覆盖)
    if (RE_SELF_DEPRECATED.test(meta.status) && !mBy) {
      unpointed.push({ num, source: meta.status });
    }

    // ② / ④ 正文扫描(跳过首部状态行)
    // 首部边界 = 状态行之后一行:多数 ADR 首部只有 6 行,旧的固定 20 行会把正文第 6–20 行整段吞掉,
    // 那段落里的宣称永远扫不到 ②。statusLine 缺失时(理论上不会,首部解析成功即有状态行)退回旧上限。
    const headerEnd = meta.statusLine >= 0
      ? Math.min(lines.length, meta.statusLine + 1)
      : Math.min(lines.length, 20);
    for (let i = headerEnd; i < lines.length; i++) {
      const line = lines[i];

      // [code_review P3] 目标级否定判定（取代旧「整行 continue」）：ADR 常写「本 ADR **不**取代
      // [ADR-NNN]」澄清边界，RE_CLAIM_A 会把「不取代 ADR-100」误判为宣称 → 误报漏标。
      // 旧实现整行含否定宣称词即 continue，会把「不取代 ADR-100，同时取代 ADR-200」这类
      // 混排行里 ADR-200 的真实宣称也吞掉（② 漏标假绿）。改为仅剔除被否定词直接修饰的
      // 目标编号（RE_NEGATED_CLAIM 带捕获组），其余目标继续走 ②/④ 判定。
      const negatedTargets = new Set(
        [...line.matchAll(RE_NEGATED_CLAIM_G)].map((m) => parseInt(m[1], 10))
      );

      // ② 明确宣称结构:行内「取代/替代…ADR-NNN」或「ADR-NNN…已废弃」,抽取全部目标
      const targets = [];
      for (const m of line.matchAll(RE_CLAIM_A_G)) targets.push(parseInt(m[1], 10));
      for (const m of line.matchAll(RE_CLAIM_B_G)) targets.push(parseInt(m[1], 10));

      const claimedThisLine = [];
      for (const target of targets) {
        if (negatedTargets.has(target)) continue; // 该目标被否定修饰（不取代 X），非宣称
        if (target !== num && adrNums.has(target)) {
          claimedThisLine.push(target);
          const tMeta = adrList.find(e => e.num === target);
          const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
          if (!tMarked) {
            unmarked.push({ claimedBy: num, target, line: line.trim().slice(0, 120) });
          }
        }
      }

      // ④ 可疑信号:行内含其他 ADR 编号 + 强词(推翻/已过时),但无明确宣称结构,且对方未标记 → 人工确认
      //    「提及方自身已标记」或「行内被提及编号任一已标记」(如 ADR-162 §6 已过时)时,
      //    该行多为已处理勘误的交叉引用(文档维护历史),不再报为可疑
      //    豁免只认「整篇已登记被取代」或「整篇自身废弃」两种硬标记:
      //      - 状态行光含「推翻/已过时」字样不算(否则 ADR-192/194 整篇正文被静默);
      //      - 部分推翻(①b)也不算,未被推翻的章节仍需体检。
      const selfMarked = (RE_SUPERSEDED_BY.test(meta.status) && !isPartial)
        || RE_SELF_DEPRECATED.test(meta.status);
      // [code_review P3] ④ 判定同步目标级：旧 `!RE_NEGATED.test(line)` 整行过滤会把
      // 「不废弃 ADR-116 的 UI 改进点，ADR-088 已过时」这类混排行整体排除出 ④ 人工确认，
      // 覆盖范围被否定词收窄。改为只把被否定修饰的编号从 others 剔除。
      if (claimedThisLine.length === 0 && !selfMarked && RE_DEPRECATED_WORD.test(line)) {
        const others = [...new Set([...line.matchAll(/ADR-(\d+)/g)].map(m => parseInt(m[1], 10)))]
          .filter(n => n !== num && adrNums.has(n) && !negatedTargets.has(n));
        const anyOtherMarked = others.some((o) => {
          const t = adrList.find(e => e.num === o);
          return t && (RE_SUPERSEDED_BY.test(t.status)
            || RE_SELF_DEPRECATED.test(t.status)
            || RE_DEPRECATED_WORD.test(t.status));
        });
        if (!anyOtherMarked) {
          for (const other of others) {
            const tMeta = adrList.find(e => e.num === other);
            const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
            if (!tMarked && !KNOWN_ERRATA.has(`${num}-${other}`)) {
              suspicious.push({ num, target: other, line: line.trim().slice(0, 120) });
            }
          }
        }
      }

      // ⑤ 表格弱宣称:行首列为 ADR-NNN、行内含「本 ADR…替代/取代/推翻」
      //    (跨列自指:动词与编号被表格列分隔,紧邻正则抓不到,如 ADR-084 → ADR-019)
      //    目标状态行已回标宣称方(如 ADR-019 状态行含 ADR-084)则不再提示
      const mTable = line.match(RE_TABLE_FIRST_COL);
      if (mTable && RE_TABLE_VERB.test(line) && !RE_TABLE_NEGATED.test(line)) {
        // 子编号(ADR-061.1)用 parseFloat,parseInt 会把它截成 61 张冠李戴到 ADR-061
        const target = parseFloat(mTable[1]);
        if (target !== num && adrNums.has(target)) {
          const tMeta = adrList.find(e => e.num === target);
          // 内插进正则前转义小数点,否则 `ADR-0*61.1` 的 `.` 会当通配符匹配 ADR-061X
          const numPat = String(num).replace('.', '\\.');
          const alreadyBackMarked = tMeta && new RegExp(`ADR-0*${numPat}(?!\\d)`).test(tMeta.status);
          if (!alreadyBackMarked) {
            tableClaims.push({ num, target, line: line.trim().slice(0, 120) });
          }
        }
      }
    }
  }

  // ── 输出 ──
  if (!FLAG_QUIET) {
    console.log('📄 ADR 取代关系扫描\n');

    console.log(`① 已登记取代(${registered.length}):`);
    for (const r of registered) {
      console.log(`   ADR-${r.old} → ADR-${r.by}   [状态行: ${r.source.slice(0, 80)}]`);
    }

    console.log(`\n①b 部分推翻/部分取代 — 仅限定章节被推翻,整篇仍有效(${partial.length}):`);
    for (const p of partial) {
      console.log(`   ADR-${p.old} 部分被 ADR-${p.by} 推翻   [状态行: ${p.source.slice(0, 80)}]`);
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
    console.log(`\n扫描 ${adrList.length} 篇 ADR 完成。`);
  }

  // --check 模式:仅漏标(②)是流程错误 → 退出码 1;
  // 废弃未指明(③)可能是合法登记(放弃/搁置本就无取代者),降级为提示不拦截。
  // --strict:④ 可疑/⑤ 表格弱宣称也视为需人工确认 → exit 1(与 repo 其他 check 脚本惯例一致)。
  if (FLAG_CHECK && (unmarked.length > 0 || (FLAG_STRICT && (suspicious.length > 0 || tableClaims.length > 0)))) {
    if (!FLAG_QUIET) {
      console.error(`\n⚠️ 存在 ${unmarked.length} 处漏标(正文宣称取代但首部未回标),请补标首部状态行。`);
      if (FLAG_STRICT && (suspicious.length > 0 || tableClaims.length > 0)) {
        console.error(`   --strict:另有 ${suspicious.length} 处可疑信号、${tableClaims.length} 处表格弱宣称待人工确认。`);
      }
    }
    process.exit(1);
  }
}

main();
