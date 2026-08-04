#!/usr/bin/env node
/**
 * check-schema-groups.mjs — Schema group 完整性检查（env-state-schema.ts）
 *
 * 设计意图：Schema group 完整性检查（env-state-schema.ts）
 *
 * 依赖：node:fs / node:path / node:url / 本地模块
 *
 * 用法：
 *   node scripts/check-schema-groups.mjs                 # 默认行为
 *   node scripts/check-schema-groups.mjs --strict # 启用 strict
 *
 * 退出码：1 / missing.length > 0 && strict ? 1 : 0 / 0（含失败码）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = resolve(__dirname, '..', 'frontend', 'src', 'core', 'env-state-schema.ts');

const { strict, json } = parseArgs(process.argv.slice(2), {
  bools: ['strict', 'json'],
});

const EXEMPT_FIELDS = new Set(['groundPreset', 'lightingPresetName']);

const text = readFileSync(SCHEMA_FILE, 'utf8');

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

const lines = schemaText.split('\n');
let baseIndent = 0;
for (const line of lines) {
    const m = line.match(/^(\s+)\w+\s*:\s*\{/);
    if (m) {
        baseIndent = m[1].length;
        break;
    }
}

const prefix = ' '.repeat(baseIndent);

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

if (json) {
    console.log(JSON.stringify({ total: fields.length, missing, exemptFound }, null, 2));
    process.exit(missing.length > 0 && strict ? 1 : 0);
}

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