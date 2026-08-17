import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { computeCoupling } from './check-coupling.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'check-coupling.mjs');

/** 在临时目录建 fixture 源码树：files = { 'core/a.ts': ["import './b'"] } */
function makeFixture(files) {
    const dir = mkdtempSync(join(tmpdir(), 'coupling-'));
    for (const [rel, lines] of Object.entries(files)) {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, lines.join('\n') + '\n', 'utf8');
    }
    return dir;
}

/** 跑脚本（fixture src + fixture baseline），返回 { status, stdout, stderr } */
function run(srcDir, baselinePath, extraArgs = []) {
    try {
        const stdout = execFileSync(process.execPath, [SCRIPT, ...extraArgs], {
            env: { ...process.env, COUPLING_SRC: srcDir, COUPLING_BASELINE: baselinePath },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, stdout, stderr: '' };
    } catch (e) {
        return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
}

/** 写基线：{ modulePairs: [...], fileSccFiles, fileSccMax } */
function writeBaseline(dir, data) {
    const p = join(dir, 'baseline.json');
    writeFileSync(
        p,
        JSON.stringify({ modulePairs: data.modulePairs ?? [], fileSccFiles: data.fileSccFiles ?? 0, fileSccMax: data.fileSccMax ?? 0 }),
        'utf8',
    );
    return p;
}

test('computeCoupling: 单模块无环 → 0 模块对 / 0 SCC', () => {
    const dir = makeFixture({
        'core/a.ts': ["import { b } from './b';"],
        'core/b.ts': ['export const b = 1;'],
    });
    try {
        const m = computeCoupling(dir);
        assert.deepEqual(m.modulePairs, []);
        assert.equal(m.fileSccCount, 0);
        assert.equal(m.fileSccMax, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('computeCoupling: 跨模块单向依赖计入模块对，不产生 SCC', () => {
    const dir = makeFixture({
        'menus/m.ts': ["import { c } from '../core/c';"],
        'core/c.ts': ['export const c = 1;'],
    });
    try {
        const m = computeCoupling(dir);
        assert.deepEqual(m.modulePairs, ['menus|core']);
        assert.equal(m.fileSccCount, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('computeCoupling: 双向跨模块依赖是 2 个有向对，且成环', () => {
    const dir = makeFixture({
        'menus/m.ts': ["import { c } from '../core/c';"],
        'core/c.ts': ["import { m } from '../menus/m';"],
    });
    try {
        const m = computeCoupling(dir);
        assert.deepEqual(m.modulePairs, ['core|menus', 'menus|core'], '正反各是一个有向对');
        assert.equal(m.fileSccCount, 1);
        assert.equal(m.fileSccMax, 2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: 无回归 → exit 0', () => {
    const dir = makeFixture({
        'core/a.ts': ["import { b } from './b';"],
        'core/b.ts': ['export const b = 1;'],
    });
    const baseline = writeBaseline(dir, {});
    try {
        const r = run(dir, baseline);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /结构耦合未恶化/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: 新增跨模块通道 → exit 1（正向回归也被拦住）', () => {
    // 基线无任何模块对，实际出现 menus→core 单向边 —— 环门禁看不见这种回归
    const dir = makeFixture({
        'menus/m.ts': ["import { c } from '../core/c';"],
        'core/c.ts': ['export const c = 1;'],
    });
    const baseline = writeBaseline(dir, {});
    try {
        const r = run(dir, baseline);
        assert.equal(r.status, 1, '首次出现的模块对必须阻断');
        assert.match(r.stderr, /结构耦合恶化/);
        assert.match(r.stderr, /menus\|core/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: 已有模块对内新增边不阻断（只拦新通道，不拦加粗）', () => {
    // 基线已批准 menus|core，现在再加一条同向边 —— 架构未变，不该红
    const dir = makeFixture({
        'menus/m.ts': ["import { c } from '../core/c';"],
        'menus/m2.ts': ["import { c } from '../core/c';"],
        'core/c.ts': ['export const c = 1;'],
    });
    const baseline = writeBaseline(dir, { modulePairs: ['menus|core'] });
    try {
        const r = run(dir, baseline);
        assert.equal(r.status, 0, '同一对模块内增边属正常演进，不应阻断');
        assert.match(r.stdout, /结构耦合未恶化/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: 子系统内部纠缠恶化 → exit 1', () => {
    // 基线 max=2，实际 max=3（同模块内三文件互指）
    const dir = makeFixture({
        'scene/env/a.ts': ["import { b } from './b';"],
        'scene/env/b.ts': ["import { c } from './c';"],
        'scene/env/c.ts': ["import { a } from './a';"],
    });
    const baseline = writeBaseline(dir, { fileSccFiles: 2, fileSccMax: 2 });
    try {
        const r = run(dir, baseline);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /fileSccMax: 基线 2 → 当前 3/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: 指标改善 → exit 0 并提示收紧基线', () => {
    const dir = makeFixture({
        'core/a.ts': ["import { b } from './b';"],
        'core/b.ts': ['export const b = 1;'],
    });
    const baseline = writeBaseline(dir, { modulePairs: ['a|b', 'c|d'], fileSccFiles: 4, fileSccMax: 3 });
    try {
        const r = run(dir, baseline);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /已收紧/);
        assert.match(r.stdout, /a\|b/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: --update 拒绝放宽基线（只减不增护栏）', () => {
    const dir = makeFixture({
        'menus/m.ts': ["import { c } from '../core/c';"],
        'core/c.ts': ['export const c = 1;'],
    });
    const baseline = writeBaseline(dir, {});
    try {
        const r = run(dir, baseline, ['--update']);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /--update 拒绝/);
        // 基线文件未被改写
        assert.deepEqual(JSON.parse(readFileSync(baseline, 'utf8')).modulePairs, []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: --update 在指标未放宽时收紧成功', () => {
    const dir = makeFixture({
        'core/a.ts': ["import { b } from './b';"],
        'core/b.ts': ['export const b = 1;'],
    });
    const baseline = writeBaseline(dir, { modulePairs: ['x|y'], fileSccFiles: 5, fileSccMax: 4 });
    try {
        const r = run(dir, baseline, ['--update']);
        assert.equal(r.status, 0, r.stderr);
        const written = JSON.parse(readFileSync(baseline, 'utf8'));
        assert.deepEqual(written.modulePairs, []);
        assert.equal(written.fileSccFiles, 0);
        assert.equal(written.fileSccMax, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: 基线缺失 → exit 1 并指路', () => {
    const dir = makeFixture({ 'core/a.ts': ['export const a = 1;'] });
    try {
        const r = run(dir, join(dir, 'no-such-baseline.json'));
        assert.equal(r.status, 1);
        assert.match(r.stderr, /基线缺失/);
        assert.match(r.stderr, /--update/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('check-coupling: --json 可解析且区分新对与已修对', () => {
    const dir = makeFixture({
        'menus/m.ts': ["import { c } from '../core/c';"],
        'core/c.ts': ['export const c = 1;'],
    });
    const baseline = writeBaseline(dir, { modulePairs: ['gone|pair'] });
    try {
        const r = run(dir, baseline, ['--json']);
        assert.equal(r.status, 1);
        const j = JSON.parse(r.stdout);
        assert.deepEqual(j.newPairs, ['menus|core']);
        assert.deepEqual(j.fixedPairs, ['gone|pair']);
        assert.equal(j.current.modulePairs, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
