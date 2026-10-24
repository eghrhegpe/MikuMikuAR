/**
 * 共享 import/export-from 语句扫描器（ADR-242 分层检查配套）。
 *
 * 为什么存在：旧实现用「排除字符集 + 可选注释单元」的跨行正则找 `from '...'`：
 *   /(?:^|\n)\s*(?:import|export)\b((?:[^;"'`]|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*?)\bfrom\s+['"]([^'"]+)['"]/gm
 * `[^;"'`]` 与 `/\/\*[\s\S]*?\*\//` 共享起始字符 `/`，两者都放进 `(...)*?` 后，
 * 遇到「不含 from 的语句」时回溯路径数呈指数增长（每个 `/` 处 2 种走法）。
 * frontend/src/shared/dev-hooks.ts 的 `export function ...` 单条语句就让
 * scripts/check-layering.mjs 单线程卡死 >300s——这就是 ADR-242 门禁此前没接进 CI 的原因。
 *
 * 本模块改为单遍状态机：跳过字符串/注释、跟踪括号深度、按语句边界（`;`、行尾、
 * 语句级 `from`）终止。每条语句的扫描量受语句长度线性约束，不存在回溯分支。
 *
 * 语义与旧正则保持一致的部分：
 *  - 语句必须「行首」(仅空白缩进) 出现，`/* … *\/ import 'x'` 这种前置块注释不算（旧正则同样不算）；
 *  - `export function|class|const|…` 等声明式导出直接短路，不参与 from 搜索（旧正则在这里爆炸）；
 *  - 括号内的 `//` 注释、多行 specifier 列表、`}` 换行后接 `from` 都能正确跨行。
 *
 * 已知边界（有意取舍，敏感场景请勿依赖）：模板字符串内 `${ … }` 里的反引号不做嵌套跟踪；
 * 正则字面量不识别（`/import .* from 'x'/` 会被当普通代码，但其中的 `import` 不在行首，不会误判）。
 */

const DECL_FOLLOWERS = new Set([
    'function',
    'class',
    'const',
    'let',
    'var',
    'async',
    'interface',
    'enum',
    'type',
    'default',
    'declare',
    'abstract',
    'namespace',
    'module',
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

// 类型位置动态 import（`x: import('m').T`）的判定：前一个 token 落在这些集合里即视为类型级，
// 不构成运行时耦合。见 import-scan.test.mjs「类型位置动态 import」用例。
const TYPE_POSITION_WORDS = new Set(['typeof', 'as', 'keyof', 'infer', 'implements', 'extends', 'declare']);
const TYPE_POSITION_CHARS = new Set([':', '<', '|', '&']);

/** from 前文本是否 type-only：`import type …` 或具名项全部带 `type` 前缀（`{ type A, type B }`）。 */
export function isTypeOnlyBody(body) {
    const b = String(body).trim();
    return /^type\b/.test(b) || /^\{\s*(?:type\s+\w+(?:\s+as\s+\w+)?\s*,?\s*)+\}\s*$/.test(b);
}

function readWord(text, i) {
    let j = i;
    while (j < text.length && IDENT_PART.test(text[j])) j++;
    return { word: text.slice(i, j), end: j };
}

/** 跳过空白与注释，返回下一个有效字符下标。 */
export function skipTrivia(text, i) {
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
            i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            const e = text.indexOf('\n', i + 2);
            i = e < 0 ? n : e;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const e = text.indexOf('*/', i + 2);
            i = e < 0 ? n : e + 2;
            continue;
        }
        break;
    }
    return i;
}

/** 跳过 i 处的字符串字面量，返回结束后下标。未闭合的 ' / " 止于行尾，避免吞掉后续语句。 */
export function skipString(text, i) {
    const q = text[i];
    const n = text.length;
    let j = i + 1;
    while (j < n) {
        const c = text[j];
        if (c === '\\') {
            j += 2;
            continue;
        }
        if (c === q) return j + 1;
        if (q !== '`' && c === '\n') return j;
        j++;
    }
    return n;
}

function readQuoted(text, i) {
    const q = text[i];
    if (q !== '"' && q !== "'") return null;
    const end = skipString(text, i);
    if (end <= i + 1) return null;
    const value = text.slice(i + 1, text[end - 1] === q ? end - 1 : end);
    return { value, end };
}

/** 关键字是否「语句起始」：本行之前的内容只有空白与完整注释（`/* eslint-disable *\/ import 'x'` 也算）。
 *  旧的预处理把块注释替换为空格，因此这类同行前置注释的 import 归正则所匹配；这里保持等价。 */
function isLineStart(text, i) {
    let lineStart = i - 1;
    while (lineStart >= 0 && text[lineStart] !== '\n') lineStart--;
    const prefix = text.slice(lineStart + 1, i);
    let p = 0;
    while (p < prefix.length) {
        const c = prefix[p];
        if (c === ' ' || c === '\t' || c === '\r') {
            p++;
            continue;
        }
        if (c === '/' && prefix[p + 1] === '*') {
            const e = prefix.indexOf('*/', p + 2);
            if (e < 0) return false; // 本行内块注释未闭合 —— 保守放弃
            p = e + 2;
            continue;
        }
        return false;
    }
    return true;
}

/** 同一行内上一个非空白字符（不跨行——跨行会误把上一行行尾的 `.` 当成成员访问 `x.import`）。 */
function prevSameLine(text, i) {
    let j = i - 1;
    while (j >= 0 && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j--;
    return j >= 0 ? text[j] : '';
}

/** [fix P1 round79] `=` 前的 import() 是否属于 type alias 声明：`export type T = import('@/x').Y`。
 * 不能直接把 '=' 加入 TYPE_POSITION_CHARS，否则 `const v = import('@/x')`（运行时）被误豁免。
 * 回溯到语句起点，检查是否以 (export|declare) type <Name> 收尾。 */
function isInTypeAlias(text, eqIdx) {
    let s = eqIdx;
    while (s >= 0 && !'\n;{}'.includes(text[s])) s--;
    const stmt = text.slice(s + 1, eqIdx).trim();
    return /^(?:export\s+|declare\s+)*type\s+\w+$/.test(stmt);
}

/** 该 `import(` 是否出现在类型位置（`scene: import('x').Scene` / `typeof import('x')`）。 */
function isTypePosition(text, i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (j < 0) return false;
    if (IDENT_PART.test(text[j])) {
        let k = j;
        while (k >= 0 && IDENT_PART.test(text[k])) k--;
        return TYPE_POSITION_WORDS.has(text.slice(k + 1, j + 1));
    }
    if (text[j] === '=') return isInTypeAlias(text, j);
    return TYPE_POSITION_CHARS.has(text[j]);
}

/**
 * 解析一条语句（关键字之后到语句结束）。返回 { end, result? }，result 为命中的导入描述。
 * 无 `from` 子句时 result 缺省，end 指向语句结束处。
 */
function parseStatement(text, start, word) {
    const n = text.length;
    const bodyStart = start + word.length;
    let i = skipTrivia(text, bodyStart);

    if (word === 'export') {
        const { word: next, end: nextEnd } = readWord(text, i);
        if (DECL_FOLLOWERS.has(next)) {
            // `export type { … } from` / `export type * from` 仍是 re-export，其余 type 走声明
            if (next !== 'type') return { end: nextEnd };
            const afterType = skipTrivia(text, nextEnd);
            const c = text[afterType];
            if (c !== '{' && c !== '*') return { end: nextEnd };
            i = afterType;
        }
    }

    if (word === 'import' && (text[i] === '"' || text[i] === "'")) {
        const quoted = readQuoted(text, i);
        if (!quoted) return { end: i };
        return { end: quoted.end, result: { kind: 'side', spec: quoted.value, body: '', index: start } };
    }

    let depth = 0;
    while (i < n) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            const e = text.indexOf('\n', i + 2);
            i = e < 0 ? n : e;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const e = text.indexOf('*/', i + 2);
            if (e < 0) return { end: n };
            i = e + 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            i = skipString(text, i);
            continue;
        }
        if (c === '{' || c === '(' || c === '[') {
            depth++;
            i++;
            continue;
        }
        if (c === '}' || c === ')' || c === ']') {
            if (depth > 0) depth--;
            i++;
            continue;
        }
        if (depth === 0) {
            if (c === ';') return { end: i + 1 };
            if (c === '\n') {
                const j = skipTrivia(text, i + 1);
                if (text.startsWith('from', j) && !IDENT_PART.test(text[j + 4] ?? '')) {
                    i = j;
                    continue;
                }
                return { end: i + 1 };
            }
            if (c === 'f' && text.startsWith('from', i) && !IDENT_PART.test(text[i + 4] ?? '')) {
                if (i > 0 && IDENT_PART.test(text[i - 1])) {
                    i++;
                    continue;
                }
                const q = skipTrivia(text, i + 4);
                const quoted = readQuoted(text, q);
                if (quoted) {
                    return {
                        end: quoted.end,
                        result: { kind: 'from', spec: quoted.value, body: text.slice(bodyStart, i), index: start },
                    };
                }
                return { end: i + 4 };
            }
        }
        i++;
    }
    return { end: n };
}

/**
 * 线性扫描一段源码，返回所有导入边。
 * @param {string} text 源码文本
 * @returns {{kind:'from'|'side'|'dynamic', spec:string, body:string, index:number, typeOnly?:boolean}[]}
 *   kind: `from` = 静态 import/export … from；`side` = `import 'x'`；`dynamic` = `import('x')`
 *   body: 关键字与 `from` 之间的文本（供 type-only 判定）；side/dynamic 为空串
 *   index: 语句起始（关键字）在原文中的下标
 *   typeOnly: 仅 dynamic 可能为 true——`import('x')` 位于类型位置（不构成运行时耦合）
 */
export function scanImportSpecs(text) {
    const out = [];
    const n = text.length;
    let i = 0;

    while (i < n) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            const e = text.indexOf('\n', i + 2);
            i = e < 0 ? n : e;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const e = text.indexOf('*/', i + 2);
            i = e < 0 ? n : e + 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            i = skipString(text, i);
            continue;
        }
        if (IDENT_START.test(c)) {
            const { word, end } = readWord(text, i);
            if (word === 'import' || word === 'export') {
                if (word === 'import' && prevSameLine(text, i) !== '.') {
                    const j = skipTrivia(text, end);
                    if (text[j] === '(') {
                        const quoted = readQuoted(text, skipTrivia(text, j + 1));
                        if (quoted) {
                            out.push({
                                kind: 'dynamic',
                                spec: quoted.value,
                                body: '',
                                index: i,
                                typeOnly: isTypePosition(text, i),
                            });
                            i = quoted.end;
                            continue;
                        }
                    } else if (isLineStart(text, i)) {
                        const { end: stmtEnd, result } = parseStatement(text, i, word);
                        if (result) out.push(result);
                        i = stmtEnd;
                        continue;
                    }
                } else if (word === 'export' && isLineStart(text, i)) {
                    const { end: stmtEnd, result } = parseStatement(text, i, word);
                    if (result) out.push(result);
                    i = stmtEnd;
                    continue;
                }
            }
            i = end;
            continue;
        }
        i++;
    }
    return out;
}
