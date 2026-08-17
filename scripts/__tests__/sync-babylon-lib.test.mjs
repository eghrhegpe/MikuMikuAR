/**
 * sync-babylon-lib.test.mjs — vendored Babylon UMD 一致性守护的契约测试（ADR-266）
 *
 * 覆盖的不变量：
 *   I1/I2  UMD 与 node_modules 供应源字节相等（默认剥离 sourceMappingURL）
 *   I3     残留 sourceMappingURL 但无 .map → 悬挂引用，红
 *   I4     @babylonjs/core / babylonjs / babylonjs-materials 三处版本号必须相等
 *   --write 能从供应源重建；--json 输出机器可读结构
 *
 * 每个用例用独立 mkdtemp fixture，通过 SYNC_BABYLON_ROOT 注入，不碰真实 frontend/。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-babylon-lib.mjs');

const CORE_UMD = 'globalThis.BABYLON=globalThis.BABYLON||{};e.NpmPackage={get:function(){return"babylonjs@9.19.0"}};';
const MAP_SUFFIX = '\n//# sourceMappingURL=babylon.js.map\n';
const MATERIALS_UMD = 'globalThis.BABYLON=globalThis.BABYLON||{};e.SimpleMaterial=function(){};';

/** 建一个最小 frontend fixture（package.json + node_modules 供应源 + public/lib 目标） */
function makeFixture({ coreVersion = '9.19.0', materialsVersion = '9.19.0', declared = {} } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-babylon-lib-'));
    const write = (rel, content) => {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
    };
    write('package.json', JSON.stringify({
        dependencies: { '@babylonjs/core': `^${coreVersion}` },
        devDependencies: {
            babylonjs: declared.babylonjs ?? coreVersion,
            'babylonjs-materials': declared.materials ?? materialsVersion,
        },
    }, null, 2));
    write('node_modules/babylonjs/package.json', JSON.stringify({ name: 'babylonjs', version: coreVersion }));
    write('node_modules/babylonjs/babylon.js', CORE_UMD + MAP_SUFFIX);
    write('node_modules/babylonjs/babylon.js.map', '{"version":3}');
    write('node_modules/babylonjs-materials/package.json', JSON.stringify({ name: 'babylonjs-materials', version: materialsVersion }));
    write('node_modules/babylonjs-materials/babylonjs.materials.min.js', MATERIALS_UMD);
    return root;
}

/** 跑一次 CLI，返回 {status, stdout, stderr}（不因非零退出抛异常） */
function run(root, args = []) {
    try {
        const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env, SYNC_BABYLON_ROOT: root },
        });
        return { status: 0, stdout, stderr: '' };
    } catch (err) {
        return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
}

const destPath = (root, name) => path.join(root, 'public', 'lib', name);

test('--write 从供应源重建，并剥掉 sourceMappingURL（I1/I2）', () => {
    const root = makeFixture();
    const write = run(root, ['--write']);
    assert.equal(write.status, 0, write.stderr);

    const core = fs.readFileSync(destPath(root, 'babylon.js'), 'utf8');
    assert.equal(core, CORE_UMD, '应等于供应源去掉 map 注释后的字节');
    assert.ok(!core.includes('sourceMappingURL'), '默认不落 .map 时必须摘掉指针');

    assert.equal(fs.readFileSync(destPath(root, 'babylonjs.materials.min.js'), 'utf8'), MATERIALS_UMD);

    const check = run(root);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /一致/);
});

test('vendored 字节被手改 → 退 1（I1 漂移）', () => {
    const root = makeFixture();
    run(root, ['--write']);
    fs.writeFileSync(destPath(root, 'babylon.js'), CORE_UMD + '/*hand-edit*/');

    const res = run(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /字节不一致/);
});

test('vendored 版本落后于依赖（9.14 vs 9.19）→ 退 1 且报出两边版本', () => {
    const root = makeFixture();
    run(root, ['--write']);
    // 模拟真实故障现场：vendored 里嵌的是旧版本号
    fs.writeFileSync(
        destPath(root, 'babylon.js'),
        CORE_UMD.replace('9.19.0', '9.14.0'),
    );

    const res = run(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /内嵌 9\.14\.0/);
    assert.match(res.stderr, /版本 9\.19\.0/);
});

test('vendored 文件缺失 → 退 1', () => {
    const root = makeFixture();
    run(root, ['--write']);
    fs.unlinkSync(destPath(root, 'babylonjs.materials.min.js'));

    const res = run(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /未找到 public\/lib\/babylonjs\.materials\.min\.js/);
});

test('UMD 残留 sourceMappingURL 但无 .map → 退 1（I3 悬挂引用）', () => {
    const root = makeFixture();
    run(root, ['--write']);
    fs.writeFileSync(destPath(root, 'babylon.js'), CORE_UMD + MAP_SUFFIX);

    const res = run(root);
    assert.equal(res.status, 1);
    // 既可能先命中字节不一致，也可能命中 dangling-map；两条都必须判红
    assert.match(res.stderr, /不一致|不存在的/);
});

test('三处依赖版本号不一致 → 退 1（I4 供应源未对齐）', () => {
    const root = makeFixture({ declared: { babylonjs: '9.18.0' } });
    run(root, ['--write']);

    const res = run(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /三处版本号|不一致/);
});

test('node_modules 缺依赖 → 退 2（环境错误，不是违规）', () => {
    const root = makeFixture();
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });

    const res = run(root);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /npm install/);
});

test('--json 输出机器可读结构', () => {
    const root = makeFixture();
    run(root, ['--write']);
    const res = run(root, ['--json']);
    assert.equal(res.status, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, 'check');
    assert.equal(payload.results.length, 2);
    assert.deepEqual(payload.versions, { core: '9.19.0', babylonjs: '9.19.0', materials: '9.19.0' });
});

test('--help 退 0 并列出不变量', () => {
    const res = run(makeFixture(), ['--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /sync-babylon-lib\.mjs/);
    assert.match(res.stdout, /I1/);
});

test('未知参数 → 退 2', () => {
    const res = run(makeFixture(), ['--nope']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /未知参数/);
});
