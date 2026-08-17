#!/usr/bin/env node
/**
 * check-magic-numbers.mjs — 魔法数重复内联检查（"重复真相"棘轮）
 *
 * 设计意图：
 *   审计轮反复登记同一类问题：同一个数值字面量（500ms 防抖、0.35 BFS 阈值、
 *   MAX_STAGE_LIGHTS=6 这类）在多处内联裸写。每多一处裸写，就多一份"会漂移的
 *   真相"——改 A 忘 B，行为静默分叉。这是隐式耦合的数值形态。
 *   本脚本把「同一数值在多个文件裸写」收敛成一道只减不增的棘轮（BUDGET），
 *   与 check-inline-px 同族：存量冻结在基线，新增一处重复 → 超预算 → 阻断。
 *
 * 度量口径（v1，刻意保守，宁漏报不误报）：
 *   · 候选 = 裸写的数值字面量：整数 ≥3 位（500/360/086…），或小数部分 ≥2 位
 *     （0.35、1.75）。个位数与 .5 这类一位小数视为结构性噪声，v1 不抓——
 *     小整数（循环界、索引、对半）信噪比太低，等闸门站稳再扩。
 *   · 重复 = 同一数值出现在 ≥2 个不同文件（单文件多处属局部常数倾向，不算债）。
 *   · 债务计数 = 重复数值的全部出现次数（含首处——首处也该抽成共享常量）。
 *   · 豁免（不算裸写）：
 *       - 声明行：const/let/var/readonly/static/enum 开头的行（已具名）；
 *       - 字符串/模板串/注释内的数字（先剥掉再扫）；
 *       - 16 进制 / 指数 / BigInt 字面量（0x1f、1e3、10n——各有语义格式）；
 *       - IGNORE_VALUES 良性数值表：单位换算（100/1000）、alpha 掩码（255）、
 *         2 的幂（字节/分辨率尺寸）。每张豁免都有明确理由，扩充需注释。
 *   · 扫描范围：frontend/src 下全部 .ts，排除 __tests__ 目录、.d.ts 与 .test.ts
 *     （同 inline-px 再加严：测试里的期望值是刻意冗余的 oracle，重复是特性不是债）。
 *
 * 依赖：node:fs（仅 --help 自读源码）/ ./_lib/parse-args.mjs / ./_lib/scan-files.mjs
 *
 * 用法：
 *   node scripts/check-magic-numbers.mjs               # 报告模式（不阻断）
 *   node scripts/check-magic-numbers.mjs --strict      # 阻断模式（门禁用）
 *   node scripts/check-magic-numbers.mjs --verbose     # 列出每一处
 *   node scripts/check-magic-numbers.mjs --json        # 机器可读输出
 *
 * 退出码：0 = 通过（未超预算）/ 1 = 超预算或扫描疑似空转
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from './_lib/parse-args.mjs';
import { SRC_DIR, walk, relPosix } from './_lib/scan-files.mjs';

/**
 * 棘轮预算：重复魔法数的出现次数上限。只减不增。
 * 偿还一处（抽成共享 const 并全点引用）就把这里往下调。
 *
 * 2026-10-23 初始基线 551（frontend/src 全量实测，48 个重复值；
 * 头部大户：0.05×111 滑块步长、0.15×40、0.01×38、0.35×25——多为
 * 逐处登记的 range step / 默认值，属"同一真相手写副本"，正解是具名常量）。
 */
const BUDGET = 551;

/** 良性数值豁免表（仅当整数 ≥100 或 2 位小数命中时才需要豁免） */
const IGNORE_VALUES = new Set([
    100,    // 百分比
    1000,   // 秒↔毫秒换算
    127, 128, 255, // 字节中点 / alpha 掩码（rgb 灰值、0xff 一族）
    180, 360, // 角度半周/整周（弧度↔度换算）
    256, 512, 1024, 2048, 4096, 8192, // 2 的幂：纹理/缓冲/分辨率尺寸
    65535, 65536, // Uint16 边界
]);

const { strict, json, verbose, help, unknown } = parseArgs(process.argv.slice(2), {
    bools: ['strict', 'json', 'verbose'],
});
if (help) {
    const _src = readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
}
if (unknown && unknown.length) {
    console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
}

// ======== 文件收集（共享层 walk，口径：.ts 去测试去声明） ========

const files = walk(SRC_DIR, {
    exts: ['.ts'],
    skipDir: (n) => n.startsWith('.') || n === 'node_modules' || n === 'css' || n === '__tests__',
    skipFile: (n) => n.endsWith('.d.ts') || n.endsWith('.test.ts'),
});

// ======== 剥离器：注释 / 字符串字面量 → 空格 ========

/**
 * 把 // 行注释、/* *\/ 块注释、三种引号的字符串内容替换为等长空格，
 * 保持偏移不变（行号换算和"具名声明行"判定都依赖原始行结构）。
 * 模板串的 ${...} 内部保留——里面的数字是真实码值。
 */
function stripDeadSpans(text) {
    const out = text.split('');
    const blank = (from, to) => {
        for (let i = from; i < to && i < out.length; i++) {
            if (out[i] !== '\n') out[i] = ' ';
        }
    };
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        const n = text[i + 1];
        if (c === '/' && n === '/') {
            let j = i; while (j < text.length && text[j] !== '\n') j++;
            blank(i, j); i = j; continue;
        }
        if (c === '/' && n === '*') {
            let j = i + 2; while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
            j = Math.min(j + 2, text.length);
            blank(i, j); i = j; continue;
        }
        if (c === "'" || c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
            blank(i + 1, j); i = j + 1; continue;
        }
        if (c === '`') {
            // 模板串：逐段扫，${ } 内跳过
            let j = i + 1;
            let segStart = j;
            while (j < text.length) {
                if (text[j] === '\\') { j += 2; continue; }
                if (text[j] === '`') break;
                if (text[j] === '$' && text[j + 1] === '{') {
                    blank(segStart, j);
                    let depth = 0, k = j + 1;
                    for (; k < text.length; k++) {
                        if (text[k] === '{') depth++;
                        else if (text[k] === '}') { depth--; if (depth === 0) { k++; break; } }
                    }
                    j = k; segStart = j; continue;
                }
                j++;
            }
            blank(segStart, j); i = j + 1; continue;
        }
        i++;
    }
    return out.join('');
}

// ======== 候选数值抽取 ========

/**
 * 匹配整数字面量（≥3 位）与 ≥2 位小数。前后断言排除：
 *   · 标识符粘连（abc123、x2）、小数尾（1.5 的 5）、点号成员（a.5）；
 *   · 16 进制/指数/BigInt 由前置字符检查排除（0x 前缀、e/E、n 后缀）。
 */
const NUM_RE = /(?<![\w.$])(\d+\.\d{2,}|\d{3,})(?![\w.$])/g;

/** 具名声明行：const/let 等开头的整行豁免（已具名=非裸写） */
const NAMED_DECL_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var|readonly|static|enum|public|private|protected)\b/;

/** value → { count, files:Set, sites:[{file,line,text}] } */
const groups = new Map();
let scannedFiles = 0;
let candidateTotal = 0;

for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const clean = stripDeadSpans(raw);
    const rel = relPosix(file);
    const rawLines = raw.split('\n');
    scannedFiles++;
    let m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(clean)) !== null) {
        const literal = m[1];
        // 排除 0x/指数/BigInt 粘连（前一个非空字符是 . e E n 之类则跳过）
        const before = clean.slice(Math.max(0, m.index - 2), m.index);
        if (/[eExXoObBn]$/.test(before)) continue;
        const num = Number(literal);
        if (!Number.isFinite(num) || IGNORE_VALUES.has(num)) continue;
        const lineIdx = clean.slice(0, m.index).split('\n').length - 1;
        const lineText = rawLines[lineIdx] ?? '';
        if (NAMED_DECL_RE.test(lineText)) continue; // 已具名
        candidateTotal++;
        let g = groups.get(literal);
        if (!g) { g = { count: 0, files: new Set(), sites: [] }; groups.set(literal, g); }
        g.count++;
        g.files.add(rel);
        g.sites.push({ file: rel, line: lineIdx + 1 });
    }
}

// ======== 自校验：扫描器空转即异常（防假绿，同 inline-px） ========

if (scannedFiles < 300) {
    console.error(`❌ 仅扫描到 ${scannedFiles} 个文件（预期 ≥300），疑似源码目录结构变更，无法执行检查`);
    process.exit(1);
}

// ======== 重复债计算 ========

const repeated = [];
for (const [literal, g] of groups) {
    if (g.files.size >= 2) {
        repeated.push({
            value: literal,
            occurrences: g.count,
            distinctFiles: g.files.size,
            sites: g.sites.slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
        });
    }
}
repeated.sort((a, b) => b.occurrences - a.occurrences || b.distinctFiles - a.distinctFiles || a.value.localeCompare(b.value, 'en', { numeric: true }));
const total = repeated.reduce((s, r) => s + r.occurrences, 0);

// ======== 输出 ========

if (json) {
    console.log(JSON.stringify({
        total, budget: BUDGET, scannedFiles, candidateTotal,
        distinctValues: repeated.length,
        repeated: repeated.slice(0, 60),
    }, null, 2));
    process.exit(strict && total > BUDGET ? 1 : 0);
}

console.log('魔法数重复内联检查 — frontend/src（重复真相棘轮）');
console.log(`  扫描文件: ${scannedFiles}，候选裸写数值: ${candidateTotal}`);
console.log(`  重复魔法数（≥2 文件同值）: ${repeated.length} 个值 / ${total} 处（棘轮预算 BUDGET=${BUDGET}，余量 ${BUDGET - total}）`);

if (verbose) {
    for (const r of repeated) {
        console.log(`\n  ${r.value}  ×${r.occurrences}（${r.distinctFiles} 文件）`);
        for (const s of r.sites) {
            console.log(`    ${s.file}:${s.line}`);
        }
    }
} else {
    console.log('\n重复最严重的魔法数（--verbose 看每一处）：');
    for (const r of repeated.slice(0, 15)) {
        console.log(`  ${r.value.padEnd(8)} ×${String(r.occurrences).padStart(3)} 处 / ${String(r.distinctFiles).padStart(2)} 文件  例: ${r.sites[0].file}:${r.sites[0].line}`);
    }
}

if (total > BUDGET) {
    console.log(`\n❌ 超出棘轮预算 ${total - BUDGET}：新增了跨文件重复内联的数值字面量。`);
    console.log('  修复方式（任选其一）：');
    console.log('   1. 抽成共享具名常量（单一定义点）并全引用点替换——正解；');
    console.log('   2. 属两个独立语义恰好同值（如 500ms 防抖 vs 500px 尺寸）→ 各抽各的名，勿混用；');
    console.log('   3. 确属良性全局值 → 加入本脚本 IGNORE_VALUES 并注明理由。');
    console.log('  偿还存量后把 BUDGET 往下调（只减不增）。');
    if (strict) process.exit(1);
    console.log('\n  (warning mode — 非阻塞。加 --strict 后门禁阻断。)');
} else {
    console.log('\n✅ 未超棘轮预算。');
}
process.exit(0);
