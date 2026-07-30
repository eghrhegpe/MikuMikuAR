#!/usr/bin/env node
// scripts/check-schema-groups.mjs — ADR-212 P4: Schema group 完整性检查
//
// 校验 env-state-schema.ts 中除已声明豁免字段外，所有字段必须有 `group`。
// 无 group 的字段不会被 getEnvKeys() 收录，导致写状态后静默不派发 —— 这是已知 bug 模式。
//
// 用法：
//   node scripts/check-schema-groups.mjs           # 默认 warning 模式
//   node scripts/check-schema-groups.mjs --strict  # 任何缺失即 exit 1（CI 阻塞）

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = resolve(__dirname, '..', 'frontend', 'src', 'core', 'env-state-schema.ts');

const strict = process.argv.includes('--strict');

// 已知豁免字段：有充分理由不设 group
const EXEMPT_FIELDS = new Set(['groundPreset', 'lightingPresetName']);

const text = readFileSync(SCHEMA_FILE, 'utf8');

// 找到 ENV_STATE_SCHEMA 对象范围
const schemaStart = text.indexOf('export const ENV_STATE_SCHEMA = {');
if (schemaStart === -1) {
    console.error('❌ 未找到 ENV_STATE_SCHEMA 定义');
    process.exit(1);
}

const schemaBody = text.slice(schemaStart);
const asConstIdx = schemaBody.indexOf('} as const;');
if (asConstIdx === -1) {
    console.error('❌ 未找到 ENV_STATE_SCHEMA 结束标记');
    process.exit(1);
}
const schemaText = schemaBody.slice(0, asConstIdx + 1);

// 确定基准缩进（schema 内第一层字段的缩进）
const lines = schemaText.split('\n');
let baseIndent = 0;
for (const line of lines) {
    const m = line.match(/^(\s+)\w+\s*:\s*\{/);
    if (m) {
        baseIndent = m[1].length;
        break;
    }
}

// 前缀字符串用于匹配 baseIndent 级别的字段
const prefix = ' '.repeat(baseIndent);

// 收集所有字段定义块：从 `prefix + fieldName: {` 到匹配的 `prefix + }`
const fields = [];
let i = 0;
while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith(prefix) || line.startsWith(prefix + ' ') || line.startsWith(prefix + '}')) {
        i++;
        continue;
    }
    const m = line.match(/^(\s+)(\w+)\s*:\s*\{/);
    if (!m) {
        i++;
        continue;
    }
    const fieldName = m[2];
    if (fieldName === 'ENV_STATE_SCHEMA') {
        i++;
        continue;
    }
    // 收集从当前行到匹配 } 的块
    let block = '';
    let depth = 0;
    let done = false;
    let j = i;
    for (; j < lines.length && !done; j++) {
        const l = lines[j];
        block += l + '\n';
        for (let c = 0; c < l.length; c++) {
            if (l[c] === '{') depth++;
            else if (l[c] === '}') depth--;
            if (depth === 0 && l[c] === '}') {
                // 确认是同级的 }
                const closeIndent = l.search(/\S/);
                if (closeIndent === baseIndent) {
                    done = true;
                    break;
                }
            }
        }
    }
    const hasGroup = /group\s*:/.test(block);
    fields.push({ name: fieldName, hasGroup });
    i = j;
}

const missing = fields.filter((f) => !f.hasGroup && !EXEMPT_FIELDS.has(f.name));
const exemptFound = fields.filter((f) => !f.hasGroup && EXEMPT_FIELDS.has(f.name));

console.log(`Schema group 完整性检查 — env-state-schema.ts`);
console.log(`  总字段: ${fields.length}`);
console.log(`  有 group: ${fields.filter((f) => f.hasGroup).length}`);
console.log(`  豁免（无 group 但已知原因）: ${exemptFound.map((f) => f.name).join(', ') || '无'}`);

if (missing.length > 0) {
    const names = missing.map((f) => f.name).join(', ');
    console.log(`\n❌ ${missing.length} 个字段缺少 group 声明: ${names}`);
    console.log('  这些字段写状态后不会触发 dispatch，形成静默不派发 bug。');
    console.log('  修复方式：在 env-state-schema.ts 中给字段加 group: \'<分组名>\'。');
    console.log('  若确实不需要 dispatch，请将字段名加入 EXEMPT_FIELDS 并附注释说明原因。');
    if (strict) {
        process.exit(1);
    }
    console.log('  (warning mode — 非阻塞。加 --strict 后 CI 阻断。)');
} else {
    console.log('\n✅ 所有字段均有 group 或已豁免。');
}
process.exit(0);