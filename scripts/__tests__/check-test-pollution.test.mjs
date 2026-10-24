// scripts/check-test-pollution.mjs 契约测试（round79 P2 修复）
// 锁 setup-wails.ts 全局 vi.mock 必须全部登记，且 // 注释里的 vi.mock 说明文字不得误登记。
// 背景：原主循环与边界查找共用同一全局正则 lastIndex，每轮外层迭代吞掉一个 match，
// 4 个 vi.mock 只登记 2 个（engine mock 漏网）；注释行假阳性把 `.../idb` 当 mock 登记。
// 运行：node --test scripts/__tests__/check-test-pollution.test.mjs（已挂入 npm run test:scripts）
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'check-test-pollution.mjs');
let fixturePath;

before(() => {
    const dir = mkdtempSync(join(tmpdir(), 'pollution-'));
    fixturePath = join(dir, 'setup-fixture.ts');
    writeFileSync(fixturePath, [
        "import { vi } from 'vitest';",
        "vi.mock('@/core/backend/idb', () => ({ default: {} }));",
        "vi.mock('@wailsio/runtime', () => ({ Call: { ByID: vi.fn() } }));",
        "vi.mock('@babylonjs/core/Engines/engine', () => ({ Engine: class {} }));",
        "// 文件级 vi.mock('@/core/comment-only') 覆盖——说明文字非真注册",
        "vi.mock('@/core/fixture-only', () => ({ x: 1 }));",
    ].join(String.fromCharCode(10)));
});

function run() {
    return JSON.parse(execFileSync(process.execPath, [
        SCRIPT, '--json', 'src/__tests__/nonexistent-pollution-fixture.test.ts',
    ], { encoding: 'utf8', env: { ...process.env, TEST_POLLUTION_SETUP: fixturePath } }));
}

describe('check-test-pollution setup mock 解析', () => {
    it('4 个真 vi.mock 全部登记（含 engine mock，原 bug 只登记 2 个）', () => {
        const keys = Object.keys(run().setupMocks);
        assert.equal(keys.length, 4, '应登记 4 个真 mock，实际 ' + keys.length);
        assert.ok(keys.some((k) => k.includes('Engines') && k.includes('engine')), 'engine mock 漏登记');
        assert.ok(keys.some((k) => k.endsWith('fixture-only')));
    });

    it('// 注释里的 vi.mock 说明文字不登记', () => {
        assert.equal(Object.keys(run().setupMocks).some((k) => k.endsWith('comment-only')), false);
    });

    it('4 个真 mock 行号与注册顺序一致', () => {
        const lines = Object.values(run().setupMocks).map((v) => v.line).sort((a, b) => a - b);
        assert.deepEqual(lines, [2, 3, 4, 6]);
    });
});
