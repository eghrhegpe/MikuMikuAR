#!/usr/bin/env node
/**
 * 一键构建 Android 调试/生产 APK（Windows/macOS/Linux 宿主通用）。
 * 补齐 android-install.mjs 的缺口：它直接装 jniLibs 已有或需重新编译的
 * libwails.so；本脚本先做前端构建 + NDK 交叉编译 libwails.so + gradle
 * assembleDebug，产出全新 APK。
 * 依赖：Android SDK（ANDROID_HOME/ANDROID_SDK_ROOT，含 NDK）+ Go（cgo 交叉编译）
 *       + JDK 17+（gradle wrapper 自带下载）。
 * 子进程统一走 _lib/proc.mjs run()（数组参数，无 shell 拼接，ADR-043）。
 * ADR-059：前端必须走 build:dev（= generate-locale-json && vite build），
 * 不能裸 vite build——locales/*.json 是预构建产物且被 .gitignore 排除，裸构建
 * 会致 dist 缺语言包（安卓端 i18n 全显示 key）。
 * 用法：
 *   node scripts/android-build.mjs                  # 前端 + arm64 Go + gradle，debug 版
 *   node scripts/android-build.mjs --arch amd64     # 只编 x86_64（模拟器）
 *   node scripts/android-build.mjs --arch all        # arm64 + amd64（fat APK）
 *   node scripts/android-build.mjs --production      # 生产版（-tags production,android,mpr）
 *   node scripts/android-build.mjs --skip-frontend   # 跳过前端构建（仅重编 Go + gradle）
 *   node scripts/android-build.mjs --skip-overlay    # 跳过 overlay 生成（已存在时自动跳过）
 *   node scripts/android-build.mjs --help
 * 退出码：0 成功；1 环境缺失/构建失败（错误信息直通）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.mjs';
import { run } from './_lib/proc.mjs';

const ROOT = getRoot();
const ANDROID_DIR = path.join(ROOT, 'build', 'android');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const JNI_BASE = path.join(ANDROID_DIR, 'app', 'src', 'main', 'jniLibs');
const MIN_SDK = '21'; // app/build.gradle minSdk
const OVERLAY = path.join(ROOT, 'build', 'android', 'overlay.json');

/** ABI → GOARCH / NDK target / jniLibs 子目录 */
const ARCHES = {
  arm64: { goarch: 'arm64', ndkTarget: `aarch64-linux-android${MIN_SDK}`, abi: 'arm64-v8a' },
  amd64: { goarch: 'amd64', ndkTarget: `x86_64-linux-android${MIN_SDK}`, abi: 'x86_64' },
};

/** 宿主 → NDK llvm prebuilt 目录名 */
function hostTag() {
  const p = os.platform();
  if (p === 'win32') return 'windows-x86_64';
  if (p === 'darwin') return os.arch() === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64';
  return 'linux-x86_64';
}

/** 定位 NDK 根：$ANDROID_NDK_HOME，或 $SDK/ndk/<最新版本>；兼容 User 级系统环境变量 */
function findNdk() {
  const pick = (v) => (v && fs.existsSync(v) ? v : null);
  const ndkHome = pick(process.env.ANDROID_NDK_HOME);
  if (ndkHome) return ndkHome;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk && fs.existsSync(path.join(sdk, 'ndk'))) {
    const versions = fs
      .readdirSync(path.join(sdk, 'ndk'))
      .filter((d) => fs.statSync(path.join(sdk, 'ndk', d)).isDirectory())
      .sort();
    if (versions.length > 0) return path.join(sdk, 'ndk', versions[versions.length - 1]);
  }
  return null;
}

/** 读取版本号（注入 -ldflags，避免 .so 内 main.AppVersion 落为 "dev"） */
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/** git 短 commit hash（失败回退空串） */
function gitHash() {
  const r = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT });
  return r.ok ? r.out.trim() : '';
}

function fail(msg) {
  console.error(`[android-build] ${msg}`);
  process.exit(1);
}

// ---- 参数解析 ----
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log(`用法:
  node scripts/android-build.mjs                 前端 + arm64 Go + gradle，debug 版
  node scripts/android-build.mjs --arch amd64    只编 x86_64（模拟器）
  node scripts/android-build.mjs --arch all       arm64 + amd64（fat APK）
  node scripts/android-build.mjs --production     生产版（-tags production,android,mpr）
  node scripts/android-build.mjs --skip-frontend  跳过前端构建
前置：ANDROID_HOME（含 NDK）+ Go 1.25+（cgo）+ JDK 17+。
产物：build/android/app/build/outputs/apk/debug/app-debug.apk（或 release/）
装到手机：node scripts/android-install.mjs`);
  process.exit(0);
}
const archIdx = argv.indexOf('--arch');
const archArg =
  argv.find((a) => a.startsWith('--arch='))?.split('=')[1] ??
  (archIdx >= 0 ? argv[archIdx + 1] : undefined) ??
  'arm64';
const production = argv.includes('--production');
const skipFrontend = argv.includes('--skip-frontend');
if (!(archArg in ARCHES) && archArg !== 'all') fail(`未知架构: ${archArg}（可选 arm64/amd64/all）`);
const arches = archArg === 'all' ? Object.keys(ARCHES) : [archArg];
const version = readVersion();

// ---- 前置检查 ----
// overlay.json 内含本机绝对路径，若缺失需先 wails3 android overlay:gen 生成
if (!fs.existsSync(OVERLAY)) {
  console.log('[android-build] 生成 overlay.json（wails3 android overlay:gen）…');
  const r = run('wails3', ['android', 'overlay:gen', '-out', OVERLAY, '-config', path.join(ROOT, 'build', 'config.yml')], { cwd: ROOT, timeout: 0 });
  if (!r.ok) fail(`overlay 生成失败：\n${r.out.slice(-800)}`);
}
const ndk = findNdk();
if (!ndk) fail(`未找到 NDK：设 ANDROID_NDK_HOME，或 ANDROID_HOME/ndk 下存在 NDK（当前: ${process.env.ANDROID_HOME || '未设置'}）`);
console.log(`[android-build] NDK: ${ndk}`);

// ---- 1. 前端构建（APK assets 需要最新 dist；走 build:dev 见 ADR-059）----
if (!skipFrontend) {
  console.log('[android-build] 前端构建（generate-locale-json && vite build）…');
  const fe = run('npm', ['run', 'build:dev'], { cwd: FRONTEND_DIR, timeout: 0, shell: os.platform() === 'win32' });
  if (!fe.ok) fail(`前端构建失败：\n${fe.out.slice(-800)}`);

  // 前端产物拷入 Android assets
  const assetsDir = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets');
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.cpSync(path.join(FRONTEND_DIR, 'dist'), assetsDir, { recursive: true });
  console.log('[android-build] Android assets 已更新');
}

// ---- 2. Go 交叉编译 libwails.so（per ABI）----
const toolchain = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag());
if (!fs.existsSync(toolchain)) fail(`NDK 工具链缺失: ${toolchain}`);

const commitHash = gitHash();
const ldflags = `-X main.AppVersion=${version} -X main.BuildTime=${new Date().toISOString().slice(0, 10)} -X main.CommitHash=${commitHash}`;
const buildFlags = production
  ? ['-tags', 'production,android,mpr', '-trimpath', '-buildvcs=false', `-ldflags=${ldflags}`]
  : ['-tags', 'android,debug,mpr', '-buildvcs=false', '-gcflags=all=-l', `-ldflags=${ldflags}`];

for (const arch of arches) {
  const a = ARCHES[arch];
  // NDK 26 Windows/Linux 的 clang 无扩展名 PE，可直接 exec；兼容 .cmd shim
  const ccCandidates = [path.join(toolchain, 'bin', a.ndkTarget + '-clang'), path.join(toolchain, 'bin', a.ndkTarget + '-clang.cmd')];
  const cc = ccCandidates.find((c) => fs.existsSync(c));
  if (!cc) fail(`缺少编译器: ${ccCandidates[0]}（或 .cmd）`);
  const out = path.join(JNI_BASE, a.abi, 'libwails.so');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`[android-build] Go 交叉编译 ${arch}（${a.abi}）…`);
  const r = run('go', ['build', '-buildmode=c-shared', `-overlay=${OVERLAY}`, ...buildFlags, '-o', out, '.'], {
    cwd: ROOT,
    timeout: 0,
    env: { CC: cc, CGO_ENABLED: '1', GOOS: 'android', GOARCH: a.goarch },
  });
  if (!r.ok) fail(`Go 交叉编译 ${arch} 失败：\n${r.out.slice(-1000)}`);
  console.log(`[android-build] ✅ ${out}（${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB）`);
}

// ---- 3. gradle assembleDebug/release ----
const task = production ? 'assembleRelease' : 'assembleDebug';
console.log(`[android-build] gradle ${task}…（首次可能下载 gradle 发行版，较慢）`);
const gradlew = os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew';
const gradlewPath = path.join(ANDROID_DIR, gradlew);
if (!fs.existsSync(gradlewPath)) fail(`缺少 ${gradlew}（Android 工程未初始化？）`);
if (os.platform() !== 'win32') {
  try {
    fs.chmodSync(gradlewPath, 0o755);
  } catch { /* 忽略 */ }
}
const g = run(gradlew, [`:app:${task}`], {
  cwd: ANDROID_DIR,
  timeout: 0,
  shell: os.platform() === 'win32', // gradlew.bat 非原生 exe，Windows 必须 shell
});
if (!g.ok) fail(`gradle ${task} 失败：\n${g.out.slice(-1200)}`);

const apkDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', production ? 'release' : 'debug');
const apk = path.join(apkDir, `app-${production ? 'release' : 'debug'}.apk`);
console.log(`[android-build] ✅ 完成：${apk}（${fs.existsSync(apk) ? (fs.statSync(apk).size / 1024 / 1024).toFixed(1) : '?'} MB）`);
console.log('[android-build] 装到设备：node scripts/android-install.mjs');