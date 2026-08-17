#!/usr/bin/env node
/**
 * sync-babylon-lib.mjs — vendored Babylon UMD 与 npm 依赖的字节级一致性守护（ADR-266）
 *
 * 设计意图：
 *   `frontend/public/lib/babylon.js` 是生产（Wails 桌面端）唯一实际运行的 Babylon 构建：
 *   vite.config.ts 的 `external` 把 `@babylonjs/*` 从 bundle 里剔出去，改由 index.html 的
 *   `<script src="/lib/babylon.js">` 提供 `BABYLON` 全局。开发与单测却走 node_modules 的
 *   ESM 构建。两条路径各走各的版本就是「测试全绿、生产黑屏」的经典温床（见证：UMD 8.2MB
 *   卡在 9.14.0，ESM 已到 9.19.0，且没有任何脚本管这件事）。
 *
 *   修法不是给版本号加个比对——那是给漂移量体温；而是把「字节相等」定为不变量：
 *   这两个 UMD 文件必须与 `node_modules/<pkg>` 里同名文件逐字节相同（默认剥离
 *   sourceMappingURL 注释），版本号自然收敛，手改、错拷、半途升级一并被拦下。
 *
 * 不变量：
 *   I1  public/lib/babylon.js               == node_modules/babylonjs/babylon.js（去 map 注释）
 *   I2  public/lib/babylonjs.materials.min.js == node_modules/babylonjs-materials/babylonjs.materials.min.js（去 map 注释）
 *   I3  未随包下发 .map 时，UMD 内不得残留 sourceMappingURL（否则浏览器 404 一个不存在的映射）
 *   I4  `@babylonjs/core` / `babylonjs` / `babylonjs-materials` 三处版本号必须相等（供应源对齐）
 *
 * 依赖：node:fs / node:path / node:url / node:crypto / 本地模块
 *
 * 用法：
 *   node scripts/sync-babylon-lib.mjs              # 检查（任一不变量破坏则退 1）
 *   node scripts/sync-babylon-lib.mjs --write      # 从 node_modules 同步 UMD 到 public/lib
 *   node scripts/sync-babylon-lib.mjs --json       # 机器可读输出
 *   node scripts/sync-babylon-lib.mjs --write --with-map   # 连 .map 一起落盘（27MB，默认不落）
 *
 * 退出码：0 通过 / 1 不变量破坏 / 2 环境缺失（未 npm install）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from './_lib/parse-args.mjs';
import { getRoot } from './_lib/scan-files.mjs';

const REPO_ROOT = getRoot();
// 测试钩子：SYNC_BABYLON_ROOT 指向 fixture（真实运行不设，不受影响）
const FE_ROOT = process.env.SYNC_BABYLON_ROOT
    ? resolve(process.env.SYNC_BABYLON_ROOT)
    : resolve(REPO_ROOT, 'frontend');
const PUBLIC_LIB = join(FE_ROOT, 'public', 'lib');
const NODE_MODULES = join(FE_ROOT, 'node_modules');

/** 供应源契约：npm 包 → public/lib 目标文件。map 字段仅用于 --with-map。 */
const ARTIFACTS = [
    {
        label: 'Babylon 核心 UMD',
        pkg: 'babylonjs',
        src: 'babylon.js',
        dest: 'babylon.js',
        map: 'babylon.js.map',
        versionMarker: /babylonjs@(\d+\.\d+\.\d+)/,
    },
    {
        label: 'Babylon 材质 UMD',
        pkg: 'babylonjs-materials',
        src: 'babylonjs.materials.min.js',
        dest: 'babylonjs.materials.min.js',
        map: 'babylonjs.materials.min.js.map',
        versionMarker: null,
    },
];

const SOURCE_MAP_LINE = /\n?\/\/# sourceMappingURL=[^\n]*\n?$/;

/** sha256 十六进制摘要 */
function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

/**
 * 剥离文件末尾的 sourceMappingURL 注释（Buffer 级，只动尾部 512 字节）。
 * 默认不随包下发 .map，所以下发的 UMD 也必须摘掉这条指针，否则 I3 不成立。
 */
function stripSourceMapComment(buf) {
    const tailStart = Math.max(0, buf.length - 512);
    const tail = buf.subarray(tailStart).toString('latin1');
    const m = tail.match(SOURCE_MAP_LINE);
    if (!m) return buf;
    return buf.subarray(0, tailStart + tail.length - m[0].length);
}

/** 该 UMD 是否仍携带 sourceMappingURL 注释 */
function hasSourceMapComment(buf) {
    const tail = buf.subarray(Math.max(0, buf.length - 512)).toString('latin1');
    return /\/\/# sourceMappingURL=/.test(tail);
}

/** 读 JSON，失败返回 null */
function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/** 去掉 ^ ~ >= <= 前缀后的裸版本串 */
function bareVersion(spec) {
    return typeof spec === 'string' ? spec.replace(/^[\^~>=<\s]+/, '').trim() : null;
}

function mb(bytes) {
    return (bytes / 1048576).toFixed(2) + 'MB';
}

function printHelp() {
    console.log(`sync-babylon-lib.mjs — vendored Babylon UMD 字节级一致性守护

用法：
  node scripts/sync-babylon-lib.mjs              检查（默认）
  node scripts/sync-babylon-lib.mjs --write      从 node_modules 同步到 public/lib
  node scripts/sync-babylon-lib.mjs --json       机器可读输出
  node scripts/sync-babylon-lib.mjs --with-map   连 .map 一起校验/落盘（默认不下发 .map）

不变量：
  I1  public/lib/babylon.js                 == node_modules/babylonjs/babylon.js
  I2  public/lib/babylonjs.materials.min.js == node_modules/babylonjs-materials/babylonjs.materials.min.js
  I3  UMD 内残留的 sourceMappingURL 必须有对应 .map 文件
  I4  @babylonjs/core / babylonjs / babylonjs-materials 三处版本号相等

退出码：0 通过 / 1 不变量破坏 / 2 未安装依赖`);
}

/** 读取供应源（node_modules）并构造校验项 */
function buildEntries(withMap) {
    const fePkg = readJson(join(FE_ROOT, 'package.json')) ?? {};
    const coreSpec = fePkg.dependencies?.['@babylonjs/core'] ?? null;
    const versions = {
        core: bareVersion(coreSpec),
        babylonjs: bareVersion(fePkg.devDependencies?.babylonjs),
        materials: bareVersion(fePkg.devDependencies?.['babylonjs-materials']),
    };

    const entries = [];
    let envError = null;

    for (const art of ARTIFACTS) {
        const pkgDir = join(NODE_MODULES, art.pkg);
        const pkgJson = readJson(join(pkgDir, 'package.json'));
        if (!pkgJson) {
            envError = `未找到 ${art.pkg}（先 cd frontend && npm install）`;
            continue;
        }
        const srcPath = join(pkgDir, art.src);
        const destPath = join(PUBLIC_LIB, art.dest);
        const srcBuf = existsSync(srcPath) ? readFileSync(srcPath) : null;

        const expected = srcBuf ? (withMap ? srcBuf : stripSourceMapComment(srcBuf)) : null;
        const actual = existsSync(destPath) ? readFileSync(destPath) : null;

        const vendoredVersion = actual && art.versionMarker
            ? (art.versionMarker.exec(actual.toString('latin1'))?.[1] ?? null)
            : null;

        let status = 'ok';
        if (!expected) status = 'missing-source';
        else if (!actual) status = 'missing-vendored';
        else if (sha256(expected) !== sha256(actual)) status = 'drift';

        // I3：UMD 里还指着 map 但文件不存在 → 悬挂引用
        const mapPath = join(PUBLIC_LIB, art.map);
        const danglingMap = actual
            ? hasSourceMapComment(actual) && !existsSync(mapPath)
            : false;
        if (status === 'ok' && danglingMap) status = 'dangling-map';

        // --with-map：下发的 map 也必须字节相等
        let mapStatus = 'skip';
        if (withMap && actual) {
            const pkgMap = join(pkgDir, art.map);
            if (!existsSync(pkgMap)) mapStatus = 'missing-source';
            else if (!existsSync(mapPath)) mapStatus = 'missing-vendored';
            else mapStatus = sha256(readFileSync(pkgMap)) === sha256(readFileSync(mapPath)) ? 'ok' : 'drift';
        }

        entries.push({
            label: art.label,
            pkg: art.pkg,
            src: art.src,
            dest: art.dest,
            status,
            mapStatus,
            mapPath,
            destPath,
            srcPath,
            pkgVersion: pkgJson.version ?? null,
            vendoredVersion,
            expected: expected ? { bytes: expected.length, sha256: sha256(expected) } : null,
            actual: actual ? { bytes: actual.length, sha256: sha256(actual) } : null,
        });
    }

    // I4：三处版本号必须相等
    const declared = [versions.core, versions.babylonjs, versions.materials];
    const versionDrift = new Set(declared.filter(Boolean)).size > 1;

    return { entries, versions, versionDrift, envError };
}

function check(withMap, json) {
    const { entries, versions, versionDrift, envError } = buildEntries(withMap);
    const results = [];
    for (const e of entries) {
        const problems = [];
        if (e.status === 'missing-source') problems.push(`未找到 node_modules/${e.pkg}/${e.src}`);
        else if (e.status === 'missing-vendored') problems.push(`未找到 public/lib/${e.dest}`);
        else if (e.status === 'drift') {
            problems.push(
                `字节不一致（vendored ${e.actual.bytes}B 内嵌 ${e.vendoredVersion ?? '?'} vs 供应源 ${e.expected.bytes}B 版本 ${e.pkgVersion}）`,
            );
        } else if (e.status === 'dangling-map') problems.push(`UMD 指向不存在的 ${e.mapPath.split(/[\\/]/).pop()}`);
        if (e.mapStatus !== 'skip' && e.mapStatus !== 'ok') problems.push(`.map 不一致（${e.mapStatus}）`);
        results.push({ label: e.label, status: e.status, ok: problems.length === 0, problems, detail: e });
    }
    if (versionDrift) {
        results.push({
            label: '依赖版本对齐（I4）',
            status: 'version-drift',
            ok: false,
            problems: [`@babylonjs/core=${versions.core} / babylonjs=${versions.babylonjs} / babylonjs-materials=${versions.materials} 不一致`],
            detail: { versions },
        });
    }
    const ok = results.every((r) => r.ok) && !envError;

    if (json) {
        console.log(JSON.stringify({ ok, mode: 'check', root: FE_ROOT, versions, envError, results }, null, 2));
    } else if (envError) {
        console.error(`✗ ${envError}`);
    } else {
        for (const r of results) {
            if (r.ok) console.log(`✓ ${r.label}`);
            else for (const p of r.problems) console.error(`✗ ${r.label}：${p}`);
        }
        const core = results[0]?.detail ?? {};
        if (ok) {
            console.log(`\n✓ vendored Babylon UMD 与依赖一致（${core.pkgVersion ?? '?'}，${core.actual ? mb(core.actual.bytes) : '?'}）`);
        } else {
            console.error('\n→ 修法：cd frontend && npm install && node ..\\scripts\\sync-babylon-lib.mjs --write');
        }
    }
    return envError ? 2 : ok ? 0 : 1;
}

function writeLib(withMap, json) {
    const { entries, envError } = buildEntries(withMap);
    if (envError) {
        console.error(`✗ ${envError}`);
        return 2;
    }
    mkdirSync(PUBLIC_LIB, { recursive: true });
    const written = [];
    for (const e of entries) {
        if (!e.expected) {
            console.error(`✗ ${e.label}：供应源缺失（${e.srcPath}）`);
            return 2;
        }
        const buf = withMap ? readFileSync(e.srcPath) : stripSourceMapComment(readFileSync(e.srcPath));
        writeFileSync(e.destPath, buf);
        let mapBytes = null;
        if (withMap) {
            const pkgMap = join(NODE_MODULES, e.pkg, e.map);
            if (existsSync(pkgMap)) {
                const mapBuf = readFileSync(pkgMap);
                writeFileSync(e.mapPath, mapBuf);
                mapBytes = mapBuf.length;
            }
        }
        written.push({ label: e.label, dest: e.destPath, bytes: buf.length, mapBytes });
    }
    if (json) console.log(JSON.stringify({ ok: true, mode: 'write', root: FE_ROOT, written }, null, 2));
    else {
        for (const w of written) {
            console.log(`✓ 写入 ${w.dest.split(/[\\/]/).slice(-2).join('/')}（${mb(w.bytes)}${w.mapBytes ? `，map ${mb(w.mapBytes)}` : ''}）`);
        }
    }
    return 0;
}

function main() {
    const args = parseArgs(process.argv.slice(2), {
        bools: ['check', 'write', 'json', 'with-map'],
    });
    if (args.help) {
        printHelp();
        return 0;
    }
    if (args.unknown?.length) {
        console.error(`未知参数：${args.unknown.join(' ')}（--help 看用法）`);
        return 2;
    }
    return args.write ? writeLib(args['with-map'], args.json) : check(args['with-map'], args.json);
}

process.exitCode = main();
