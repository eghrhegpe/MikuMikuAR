#!/usr/bin/env node
/**
 * check-inline-px.mjs — 内联样式写死 px 检查（--ui-scale 泄漏闸门）
 *
 * 设计意图：
 *   设计令牌（--font-ui / --content-px / --lcard-* …）全部定义为
 *   calc(Npx * var(--ui-scale))，用户拖「UI 缩放」滑条（0.8~1.3）时整体缩放。
 *   但 TS 里 392 处内联样式赋值中，有相当一部分直接写死 px（font-size:11px、
 *   padding:6px 14px …），这些值完全不随 --ui-scale 缩放 —— 用户放大 UI 时
 *   一半元素变大、一半原地不动，视觉撕裂。
 *
 *   本脚本把这类「写死 px」收敛成一道只减不增的棘轮（BUDGET）：
 *     · 存量 = BUDGET，允许存在（历史欠账，逐批偿还）；
 *     · 新增一处写死 px → 计数超预算 → CI 阻断；
 *     · 每偿还一处（换成 var(--token) 或抽成 CSS 类）→ 计数下降 → 通过。
 *   这样债是显式、有界、被 review 的，而不是无声复发。
 *
 * 豁免（不算欠账，均有明确理由）：
 *   · transform / translate / scale / rotate / perspective —— 绑过渡动画的位移量，
 *     与布局尺寸无关（如 menu.ts 滑动位移 translateX(±8px)）
 *   · calc(Npx * var(--ui-scale)) —— 已经是「随 scale 缩放」的内联令牌，正解
 *   · var(--token) —— 令牌引用，不含 px
 *   · ${...} 模板插值 —— 运行时计算值（如 `padding-left:${14 + depth * 16}px` 树形缩进）
 *   · .style.setProperty('--x', ...) —— 写 CSS 变量本身，px 由变量定义处负责
 *   · __tests__ / *.d.ts —— 测试与声明文件
 *
 * 依赖：node:fs / node:path / node:url / 本地模块
 *
 * 用法：
 *   node scripts/check-inline-px.mjs                    # 报告模式（不阻断）
 *   node scripts/check-inline-px.mjs --strict           # 阻断模式（CI 用）
 *   node scripts/check-inline-px.mjs --verbose          # 列出每一处
 *   node scripts/check-inline-px.mjs --json             # 机器可读输出
 *
 * 退出码：0 = 通过（未超预算）/ 1 = 超预算或解析异常
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const SRC_DIR = join(ROOT, 'frontend', 'src');

/**
 * 棘轮预算：内联样式中写死 px 的存量上限。只减不增。
 * 偿还一处就往下调；新增一处会被本脚本拦下。
 *
 * 2026-10-22 初始基线 163（frontend/src 全量实测）。
 * 首批等值替换（11/12/13/14px → var(--font-ui-sm/-hint/-ui/-title/--row-pad-x)）
 * 把「行级样式」清干净后剩下的主要是三类：fixed 定位浮层
 * （debug-log-panel / toast / ui-fullscreen-overlay，viewposition 语义不缩放）、
 * 装饰性定尺（swatch 16px/50%、图标 14px、缩进 28px）、
 * 以及 4/6/8px 这类无令牌散间距。
 * 逐批偿还，每批 commit 里同步把这里往下调。
 */
const BUDGET = 163;

/** 与布局尺寸无关、绑动画位移的属性 —— 豁免 */
const ANIMATION_PROPS = new Set([
    'transform',
    'translate',
    'scale',
    'rotate',
    'perspective',
    'transform-origin',
    'transform-origin-x',
    'transform-origin-y',
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

// ======== 文件收集 ========

function collectTsFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            collectTsFiles(full, out);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

// ======== CSS 文本解析 ========

/**
 * 括号感知地挖掉 var(...) / calc(...) 整段。
 * calc(14px * var(--ui-scale)) 这类嵌套括号必须整段移除，
 * 否则内层 var() 剥掉后残留的 14px 会被误判成欠账。
 */
function stripScaledSpans(css) {
    let out = '';
    let i = 0;
    while (i < css.length) {
        const fnStart = css.startsWith('var(', i) || css.startsWith('calc(', i);
        if (fnStart) {
            let depth = 0;
            let j = i;
            for (; j < css.length; j++) {
                if (css[j] === '(') depth++;
                else if (css[j] === ')') {
                    depth--;
                    if (depth === 0) {
                        j++;
                        break;
                    }
                }
            }
            out += '\u0000'; // 占位，避免两侧 token 粘连
            i = j;
            continue;
        }
        out += css[i];
        i++;
    }
    return out;
}

/**
 * 挖掉 ${...} 模板插值，换成可读占位符 ${…}。
 * 用 '${…}' 而不是 '\u0000'：插值后的 px（如 `${14 + depth * 16}px`）
 * 会被留在文本里，占位符让 verbose 输出显示成 `2px ${…}px`
 * ——一眼能看出这是运行时计算值，而不是拼写错误的 CSS。
 */
function stripInterpolations(css) {
    let out = '';
    let i = 0;
    while (i < css.length) {
        if (css[i] === '$' && css[i + 1] === '{') {
            let depth = 0;
            let j = i + 1;
            for (; j < css.length; j++) {
                if (css[j] === '{') depth++;
                else if (css[j] === '}') {
                    depth--;
                    if (depth === 0) {
                        j++;
                        break;
                    }
                }
            }
            out += '${…}';
            i = j;
            continue;
        }
        out += css[i];
        i++;
    }
    return out;
}

/** 把一段 CSS 声明文本拆成 [{ prop, value }]，容忍缺省 prop（cssText 形态） */
function splitDeclarations(css) {
    return css
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
            const idx = d.indexOf(':');
            if (idx === -1) return { prop: '', value: d };
            return { prop: d.slice(0, idx).trim().toLowerCase(), value: d.slice(idx + 1).trim() };
        });
}

/** 从一处内联样式值里数出写死的 px 个数 */
function countHardcodedPx(css, forcedProp) {
    let count = 0;
    for (const { prop, value } of splitDeclarations(css)) {
        const p = forcedProp || prop;
        if (ANIMATION_PROPS.has(p)) continue;
        // stripInterpolations 先把 ${14 + depth * 16} 换成 ${…}，
        // 于是 `${…}px` 里的 px 会被计入——这是有意的：
        // 运行时算出来的 px 同样不随 --ui-scale 缩放，同属欠账。
        const cleaned = stripScaledSpans(stripInterpolations(value));
        const hits = cleaned.match(/\d+(?:\.\d+)?px|\$\{…\}px/g);
        if (hits) count += hits.length;
    }
    return count;
}

// ======== 赋值点扫描 ========

const ASSIGN_RE = /\.style\.(cssText|[A-Za-z][A-Za-z0-9]*)\s*=\s*|\.style\.setProperty\s*\(/g;

/** 从位置 i 起读出一个字符串字面量（单引号/双引号/反引号），返回其内容 */
function readStringLiteral(text, i) {
    const quote = text[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') return null;
    let out = '';
    let j = i + 1;
    while (j < text.length) {
        const c = text[j];
        if (c === '\\') {
            out += text[j + 1] ?? '';
            j += 2;
            continue;
        }
        if (c === quote) return { value: out, end: j + 1 };
        if (quote === '`' && c === '$' && text[j + 1] === '{') {
            // 跳过 ${...}，内容后续由 stripInterpolations 统一挖掉
            let depth = 0;
            let k = j + 1;
            for (; k < text.length; k++) {
                if (text[k] === '{') depth++;
                else if (text[k] === '}') {
                    depth--;
                    if (depth === 0) {
                        k++;
                        break;
                    }
                }
            }
            out += '\u0000';
            j = k;
            continue;
        }
        out += c;
        j++;
    }
    return null; // 未闭合
}

/** 把字符偏移换算成 1-based 行号 */
function lineOf(text, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') line++;
    }
    return line;
}

const files = collectTsFiles(SRC_DIR);
const hits = [];
let scannedFiles = 0;
let scannedAssignments = 0;

for (const file of files) {
    const text = readFileSync(file, 'utf8');
    scannedFiles++;
    ASSIGN_RE.lastIndex = 0;
    let m;
    while ((m = ASSIGN_RE.exec(text)) !== null) {
        const prop = m[1];
        if (prop === undefined) continue; // .style.setProperty(...) —— 豁免
        const camelToCss = prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        let after = ASSIGN_RE.lastIndex;
        // 跳过字符串拼接前缀（如 'a' + 'b'）—— 只认紧随其后的第一个字面量
        while (after < text.length && /[\s+]/.test(text[after])) after++;
        const lit = readStringLiteral(text, after);
        if (!lit) continue;
        scannedAssignments++;
        const css = prop === 'cssText' ? lit.value : lit.value;
        const n = countHardcodedPx(css, prop === 'cssText' ? null : camelToCss);
        if (n > 0) {
            hits.push({
                file: relative(ROOT, file).split(sep).join('/'),
                line: lineOf(text, m.index),
                prop,
                count: n,
                // 原样展示（保留 var()/calc() 好让人看出哪些已接令牌），
                // 只把 ${...} 换成可读的 ${…}；readStringLiteral 已把插值换成 \u0000
                snippet: css
                    .replace(/\u0000/g, '${…}')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 90),
            });
        }
    }
}

// ======== 自校验：扫描器空转即报解析异常（防假绿） ========

if (scannedAssignments === 0) {
    console.error('❌ 未扫描到任何内联样式赋值，疑似源码结构变更，无法执行检查');
    process.exit(1);
}

const total = hits.reduce((s, h) => s + h.count, 0);
const byFile = new Map();
for (const h of hits) {
    const cur = byFile.get(h.file) ?? { sites: 0, px: 0 };
    cur.sites++;
    cur.px += h.count;
    byFile.set(h.file, cur);
}

if (json) {
    console.log(JSON.stringify({ total, budget: BUDGET, hits, byFile: [...byFile] }, null, 2));
    process.exit(strict && total > BUDGET ? 1 : 0);
}

console.log('内联样式写死 px 检查 — frontend/src（--ui-scale 泄漏棘轮）');
console.log(`  扫描文件: ${scannedFiles}，内联样式赋值点: ${scannedAssignments}`);
console.log(`  写死 px 合计: ${total}（棘轮预算 BUDGET=${BUDGET}，余量 ${BUDGET - total}）`);

if (verbose) {
    console.log('\n明细：');
    for (const h of hits) {
        console.log(`  ${h.file}:${h.line}  [${h.prop}] ×${h.count}  ${h.snippet}`);
    }
} else if (hits.length > 0) {
    console.log('\n写死 px 最多的文件（--verbose 看全部）：');
    const top = [...byFile].sort((a, b) => b[1].px - a[1].px).slice(0, 10);
    for (const [f, v] of top) console.log(`  ${f}  ${v.px} px / ${v.sites} 处`);
}

if (total > BUDGET) {
    console.log(
        `\n❌ 超出棘轮预算 ${total - BUDGET}：内联样式里新增了不随 --ui-scale 缩放的写死 px。`
    );
    console.log('  修复方式（任选其一）：');
    console.log('   1. 换成已有令牌 —— font-size:11px → var(--font-ui-sm)、padding:6px 14px → var(--row-pad-x)');
    console.log('   2. 确有新散值 → 在 app.css :root 补一个 calc(Npx * var(--ui-scale)) 令牌再引用');
    console.log('   3. 整块样式可复用 → 抽成 CSS 类（参考 ADR-228 的 .card-title-bar / .conflict-banner）');
    console.log('   4. 属动画位移/运行时计算 → 加入本脚本 ANIMATION_PROPS 豁免并注明理由');
    console.log('  偿还存量后把 BUDGET 往下调（只减不增）。');
    if (strict) process.exit(1);
    console.log('\n  (warning mode — 非阻塞。加 --strict 后 CI 阻断。)');
} else {
    console.log('\n✅ 未超棘轮预算。');
}
process.exit(0);
