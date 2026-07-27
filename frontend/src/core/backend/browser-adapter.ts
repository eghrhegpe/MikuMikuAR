// [doc:architecture] 浏览器后端适配器 — ADR-176 / ADR-177 Phase 2
//
// 实现 BackendService 的 106 个方法（Omit<GoApp, ④33> 全集）：
//   - ① 81 个真实实现：配置/UIState/场景/截图/缩略图/ExtractZip/缓存/标签/最近/预设走 IndexedDB + JSZip
//   - ② 8 个 Select*：触发 File System Access API（调用方需接入阶段改造以消费 handle）
//   - ③ 17 个原生独占：抛 NotSupportedError 显式降级（capabilities() 已如实反映）
// 整体以 as unknown as BackendService 收敛类型（kind / capabilities / readFileBytes 覆盖）。
// 资源配对：beforeunload 释放 IndexedDB 连接（ADR-176 P4）。
//
// [doc:adr-177] Phase 2 A4 补齐：
//   - _resolveIdbKey：主应用传绝对路径（D:/models/foo.pmx）→ 映射为 IndexedDB key（file:foo）
//   - _defaultConfig / _defaultUIState：补全完整默认值，避免首屏空字段守护风暴
//   - Delete*Preset：从 no-op 改为真实删除（idbDelete）
//   - SetEnvState：从 uistate/envState 双源改为 Config.env 单源（对齐主应用 restoreEnvState）
//   - A4 剩余项（p2-5）：ListDirRecursive/LoadOutfitFile/LoadSceneFile/IsolateModelDir 浏览器实现
//     - 虚拟目录语义：IsolateModelDir 返回 web://model/<stem>，ListDirRecursive 扫描
//       dir:<stem>:<relativePath> 前缀，readFileBytes 透明路由到 dir: 键
//     - 键规约：dir:<stem>:<relativePath>（纹理字节，带目录结构）、outfit:<stem>（outfits.json）、
//       scenes store 的 bundle:<zipStem>（scene.json）
//     - ExtractZip 解压时按主 PMX stem 分组存 dir:/outfit:，识别 scene.json 存 bundle:

import JSZip from 'jszip';
import type {
    Config,
    UIState,
    EnvState,
    ModelEntry,
    ModelMeta,
    ExtractResult,
    FileInfo,
    InstallResult,
    UpdateCheckResult,
    RenderPreset,
    SoftwareEntry,
    PlazaDownloadResult,
    CacheStats,
} from '@bindings/mikumikuar/internal/app/models';
import { NotSupportedError } from './types';
import type { BackendService, BackendCapabilities } from './types';
import { idbGet, idbSet, idbDelete, idbKeys, idbBatchSet, closeIDB, type Store } from './idb';
import { detectKtx2Support } from '../gpu-capabilities';

// —— 路径工具函数（消除 6 处 "split + pop + replace" 重复）——

/** 提取路径最后一段文件名（兼容 / 和 \） */
function _baseName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
}

/** 去掉文件名最后一个扩展名段（如 `a.pmx` → `a`，`b.tar.gz` → `b.tar`） */
function _stripExt(name: string): string {
    return name.replace(/\.[^.]+$/, '');
}

/**
 * [doc:adr-177] 将模型 stem（可能含 `/`，如 `A/miku`）编码为 URL/键安全的单 token。
 *
 * 不同目录下同名 PMX（如 `A/miku.pmx` 与 `B/miku.pmx`）在 FSA 扫描时会产生
 * **相同裸文件名 stem**，若直接用作 `dir:<stem>:` 纹理键前缀则相互覆盖（静默错渲染）。
 * 编码后 `web://model/A%2Fmiku` 与 `web://model/B%2Fmiku` 得到互不碰撞的命名空间，
 * 纹理键 `dir:A%2Fmiku:tex/face.png` / `dir:B%2Fmiku:tex/face.png` 各自独立。
 *
 * 解析侧（_classifyPath / _resolveIdbKey / ListDirRecursive / readFileBytes）按单 token
 * 直接透传该编码串，无需解码，故与既有 bare-stem 键（`A/miku` 编码==`A/miku`）完全兼容。
 */
function _encModelStem(stem: string): string {
    return encodeURIComponent(stem);
}

// —— base64 工具（对齐 Go 侧 string ↔ bytes 转换）——

/** base64 字符串 → Uint8Array（兼容浏览器 atob） */
function _base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/** Uint8Array → base64 字符串（兼容浏览器 btoa） */
function _bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

// —— zip 条目名多编码检测（对齐 Go 端 bestDecode，adr-006）——

/**
 * [doc:adr-006] 对齐 Go 端 bestDecode（zipextract.go:428-496）：对非 UTF-8 的 zip 条目名，
 * 同时尝试 Shift-JIS / GBK / Big5 三种编码，按评分挑选（+10 无替换字符 / +3 SJIS 偏置 /
 * +2 CJK 汉字 / +1 假名·标点 / -5 U+FFFD / -1 全角半角）。
 *
 * 解决 MMD 圈 zip 条目名常用 SJIS（日文）/ GBK（中文 Windows）编码，JSZip 默认 UTF-8
 * 解码会乱码，导致 .pmx 扩展名字节被破坏、扫描期 zip 展开失败（模型嵌套识别不足）。
 */
function bestDecodeZipName(bytes: Uint8Array): string {
    const encodings = ['shift_jis', 'gbk', 'big5'] as const;
    let best = '';
    let bestScore = -Infinity;
    for (const enc of encodings) {
        let decoded: string;
        try {
            decoded = new TextDecoder(enc, { fatal: false }).decode(bytes);
        } catch {
            continue; // 浏览器不支持该编码（罕见），跳过
        }
        let score = 0;
        let ffiCount = 0;
        for (let i = 0; i < decoded.length; i++) {
            const cp = decoded.codePointAt(i)!;
            if (cp === 0xfffd) {
                ffiCount++;
                score -= 5; // 替换字符（对齐 Go 的 RuneError -5）
            } else if (cp >= 0x4e00 && cp <= 0x9fff) {
                score += 2; // CJK 统一汉字
            } else if (cp >= 0x3040 && cp <= 0x30ff) {
                score += 1; // 平假名/片假名
            } else if (cp >= 0x3000 && cp <= 0x303f) {
                score += 1; // CJK 标点
            } else if (cp >= 0xff00 && cp <= 0xffef) {
                score -= 1; // 全角/半角（疑似损坏）
            }
        }
        if (ffiCount === 0) score += 10; // 无替换字符（对齐 Go 的 err==nil +10）
        if (enc === 'shift_jis') score += 3; // SJIS 偏置（MMD 主流编码）
        if (score > bestScore) {
            bestScore = score;
            best = decoded;
        }
    }
    return best || new TextDecoder('utf-8').decode(bytes);
}

// —— ZIP 炸弹防护阈值（对齐 Go 端 expandZipEntries，library.go:139-153）——
const MAX_ZIP_FILE_SIZE = 500 * 1024 * 1024; // 500 MB — 单 zip 文件大小上限
const MAX_ZIP_ENTRY_COUNT = 10000; // 条目数上限
const MAX_ZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB — 总未压缩大小上限

// —— Plaza 远程配置源（对齐 Go 端 plaza_config.go:43-47）——
// 三源 fallback：raw.githubusercontent → cdn.jsdelivr.net → api.github.com
// 三个域名均支持 CORS（Access-Control-Allow-Origin: *），网页端可直接 fetch
const PLAZA_GH_OWNER = 'eghrhegpe';
const PLAZA_GH_REPO = 'MikuMikuAR';
const PLAZA_GH_BRANCH = 'main';
const PLAZA_RAW_BASE = `https://raw.githubusercontent.com/${PLAZA_GH_OWNER}/${PLAZA_GH_REPO}/${PLAZA_GH_BRANCH}`;
const PLAZA_JSD_BASE = `https://cdn.jsdelivr.net/gh/${PLAZA_GH_OWNER}/${PLAZA_GH_REPO}@${PLAZA_GH_BRANCH}`;
const PLAZA_API_BASE = `https://api.github.com/repos/${PLAZA_GH_OWNER}/${PLAZA_GH_REPO}/contents`;
const PLAZA_FETCH_TIMEOUT_MS = 10_000; // 对齐 Go 端 10s 超时
const PLAZA_FETCH_MAX_BYTES = 2 << 20; // 2 MB — 对齐 Go 端 io.LimitReader

/**
 * [doc:adr-177] 网页端拉取单个 plaza 配置文件，对齐 Go 端 fetchPlazaRemote 的三源 fallback。
 *
 * 源序：raw.githubusercontent → cdn.jsdelivr.net → api.github.com（返回 base64 content）。
 * 三个域名均带 CORS 头，网页端可直接 fetch；GitHub API 有 60/小时 未认证限速，故放最后。
 * 失败时抛错，由调用方 catch 后走 toast 提示或兜底逻辑。
 */
async function _fetchPlazaFile(name: string): Promise<string> {
    const sources = [
        { url: `${PLAZA_RAW_BASE}/${name}`, isApi: false },
        { url: `${PLAZA_JSD_BASE}/${name}`, isApi: false },
        { url: `${PLAZA_API_BASE}/${name}`, isApi: true },
    ];
    let lastErr: unknown = null;
    for (const s of sources) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), PLAZA_FETCH_TIMEOUT_MS);
            const resp = await fetch(s.url, {
                signal: ctrl.signal,
                headers: s.isApi ? { Accept: 'application/vnd.github.v3+json' } : undefined,
            });
            clearTimeout(timer);
            if (!resp.ok) {
                lastErr = new Error(`HTTP ${resp.status}`);
                continue;
            }
            if (s.isApi) {
                // GitHub API 返回 { content: "<base64>" }
                const result = (await resp.json()) as { content?: string };
                if (!result.content) {
                    lastErr = new Error('GitHub API: missing content');
                    continue;
                }
                const clean = result.content.replace(/[\s\r\n\t]/g, '');
                return new TextDecoder().decode(_base64ToBytes(clean));
            }
            // raw / jsdelivr 直接返回文本
            const text = await resp.text();
            if (text.length > PLAZA_FETCH_MAX_BYTES) {
                lastErr = new Error(`response too large: ${text.length}`);
                continue;
            }
            return text;
        } catch (e) {
            lastErr = e;
        }
    }
    throw new Error(`fetch ${name} failed: ${String(lastErr)}`);
}

// —— 资源配对（P4）——
if (
    typeof window !== 'undefined' &&
    typeof (window as { addEventListener?: unknown }).addEventListener === 'function'
) {
    (window as { addEventListener: (t: string, fn: () => void) => void }).addEventListener(
        'beforeunload',
        () => closeIDB()
    );
}

function _cap(): BackendCapabilities {
    const fsAccess =
        typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function' ||
        typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
    const ktx2 = detectKtx2Support();
    return {
        ar: false,
        externalApps: false,
        plazaWindow: false,
        fsAccess,
        watchDir: false,
        proxyServer: false,
        fileServer: false,
        systemDirOpen: false,
        // [doc:adr-177] 有 FSA API 时浏览器可设置根目录（showDirectoryPicker + 递归扫描写 IndexedDB）
        storageMode: fsAccess,
        screenshotSave: true,
        cacheManage: true,
        configPersist: true,
        modelScan: fsAccess,
        // [doc:adr-178] 宿主级运行时键（与 go-adapter 同语义，读真实运行时）
        crossOriginIsolated:
            typeof window !== 'undefined' &&
            (window as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
        clipboardReliable: typeof navigator !== 'undefined' && !!navigator.clipboard,
        arScope: typeof navigator !== 'undefined' && 'xr' in navigator ? 'webxr' : 'none',
        // [doc:adr-189] GPU 压缩纹理能力探测（运行时，与后端无关）
        ktx2Supported: ktx2.supported,
        ktx2PreferredFormat: ktx2.preferredFormat,
        // [doc:adr-190] 浏览器侧固定能力（无原生安装/窗口/暂存目录）
        installApk: false, // 网页无 APK 安装
        installLocal: false, // 网页跳转外链而非本地安装
        inAppBrowser: false, // 网页/安卓均走系统浏览器
        fsSelectDir: fsAccess, // 网页仅在有 FSA 时可选择目录
        localStaging: false, // 网页暂存走 IndexedDB 路径而非桌面目录
        androidStorageMode: false, // 网页无安卓专属存储模式
    };
}

function _defaultUIState(): UIState {
    // 对齐 createMockUIState（__tests__/mocks/binding-factories.ts）+ UIState 接口必填字段
    return {
        scale: 1.0,
        popupWidth: 280,
        accent: '#4a6cf7',
        fontFamily: 'system',
        animations: true,
        blurBg: true,
        performanceMode: 'balanced',
        screenshotFormat: 'png',
        screenshotQuality: 90,
        autoCameraEnabled: false,
        autoCameraBeatsPerSwitch: 4,
        autoUpdateEnabled: false,
    } as unknown as UIState;
}

function _defaultConfig(): Config {
    // 对齐 Config 接口（models.ts:36-128）+ createMockUIState 默认值
    // 字段名 config_version（非 version），避免 restoreEnvState/restoreUIState 字段名不匹配
    return {
        config_version: 1,
        ui_state: _defaultUIState(),
        resource_root: '',
        storage_mode: 'web',
        override_paths: {
            pmx: '',
            vmd: '',
            audio: '',
            stage: '',
            prop: '',
            environment: '',
            md_dress: '',
            setting: '',
        },
        blender_path: '',
        mmd_path: '',
        display_name_priority: 'name_jp',
        download_watch_dir: '',
        download_auto_import: false,
        favorites: [],
        render_presets: [],
        custom_software: [],
        tags: {},
        recent_models: [],
    } as unknown as Config;
}

/**
 * [doc:adr-177] 路径类型判定（统一 _resolveIdbKey / _extractStem 的分支逻辑）。
 *
 * 把 5 种路径形态归一为 { kind, stem?, rest? }，让两个消费方各自只关心"取 stem"还是"拼 key"，
 * 不再重复写 5 个 if 分支。判定顺序与原 _resolveIdbKey 一致，保持行为兼容。
 */
type _PathInfo =
    | { kind: 'model-dir'; stem: string; rest: string } // web://model/<stem>/<relPath>（有 relPath）
    | { kind: 'model-stem'; stem: string } // web://model/<stem>（无 relPath）
    | { kind: 'selected-dir'; stem: string } // web://selected-dir/<catRelPath>
    | { kind: 'idb-key' } // 已是 file:/entry:/recent/dir:/outfit: 前缀
    | { kind: 'virtual-uri' } // content:// 或其他 web://（Android SAF 等）
    | { kind: 'absolute'; stem: string }; // 绝对路径 → baseName 去扩展名

function _classifyPath(path: string): _PathInfo {
    // 1. 虚拟目录资源：web://model/<stem>/...（relPath 可选，决定 model-dir vs model-stem）
    const dirMatch = path.match(/^web:\/\/model\/([^/?#]+)(?:\/(.+))?$/);
    if (dirMatch) {
        const stem = dirMatch[1];
        const rest = dirMatch[2]?.replace(/\\/g, '/');
        return rest ? { kind: 'model-dir', stem, rest } : { kind: 'model-stem', stem };
    }

    // 2. 选中目录资源：web://selected-dir/<catSeg>/<relPath>
    const selMatch = path.match(/^web:\/\/selected-dir\/(.+)$/);
    if (selMatch) return { kind: 'selected-dir', stem: _stripExt(_stripCategorySeg(selMatch[1])) };

    // 3. 已是 IDB key 前缀（含裸 'recent'）
    if (/^(file|entry|recent|dir|outfit):/.test(path) || path === 'recent') {
        return { kind: 'idb-key' };
    }

    // 4. Android SAF URI / 其他 web:// 虚拟 URI 原样返回
    if (path.startsWith('content://') || path.startsWith('web://')) {
        return { kind: 'virtual-uri' };
    }

    // 5. 绝对路径 → baseName 去扩展名
    return { kind: 'absolute', stem: _stripExt(_baseName(path)) };
}

/**
 * [doc:adr-177] 将主应用传入的路径映射为 IndexedDB key。
 * 判定委托 _classifyPath，本函数只负责"按 kind 拼 key"。
 */
function _resolveIdbKey(path: string): string {
    const info = _classifyPath(path);
    switch (info.kind) {
        case 'model-dir':
            return `dir:${info.stem}:${info.rest}`;
        case 'model-stem':
            // 无 relPath 时原样返回（对齐原实现：dirMatch 要求 /relPath，无则走 virtual-uri）
            return path;
        case 'selected-dir':
        case 'absolute':
            return `file:${info.stem}`;
        case 'idb-key':
        case 'virtual-uri':
            return path;
    }
}

/**
 * [doc:adr-177] 从路径提取模型 stem（去扩展名的文件名）。判定委托 _classifyPath。
 */
function _extractStem(path: string): string {
    const info = _classifyPath(path);
    switch (info.kind) {
        case 'model-dir':
        case 'model-stem':
        case 'selected-dir':
        case 'absolute':
            return info.stem;
        case 'idb-key': {
            // 仅 file:/entry: 前缀提取 stem；dir:/outfit:/recent 保持原样（对齐原实现）
            const m = path.match(/^(?:file|entry):(.+)$/);
            return m ? m[1] : path;
        }
        case 'virtual-uri':
            return '';
    }
}

async function _listModels(): Promise<ModelEntry[]> {
    // 键规约（ADR-176 Phase 3，与 idb.ts saveModel 共享）：
    //   `entry:<name>` = 模型元数据；`file:<name>` = 原档字节；`recent` = 最近列表。
    // 仅列 entry: 前缀，避免把原档字节 / recent 数组误当 ModelEntry 返回。
    const allKeys = await idbKeys('models');
    const keys = allKeys.filter((k) => k.startsWith('entry:'));
    console.info(
        `[web-scan] _listModels: IDB 共 ${allKeys.length} 个键, 其中 entry: ${keys.length} 个`
    );
    const out: ModelEntry[] = [];
    for (const k of keys) {
        const m = await idbGet<ModelEntry>('models', k);
        // [bugfix:stale-entry] 过滤无效 entry（旧版扫描残留的缺 dir/file_path 字段数据）
        if (m && m.dir && m.file_path) out.push(m);
    }
    console.info(`[web-scan] _listModels: 返回 ${out.length} 个 ModelEntry`);
    return out;
}

// —— File System Access 对话框（②）——
/** 一次选多个文件（.pmx + 伴生纹理）。返回 FileSystemFileHandle 数组。 */
async function _pickFilesMultiple(acceptPmx: boolean): Promise<FileSystemFileHandle[] | null> {
    const picker = (
        window as { showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]> }
    ).showOpenFilePicker;
    if (typeof picker !== 'function') return null;
    // .pmx 场景：多选模式让用户 Ctrl+选同目录的纹理
    // 需要同时支持 pmx + 纹理扩展名，但 FSA showOpenFilePicker 的 accept 是"或"语义，
    // 用 application/octet-stream 兜底接收所有文件，靠后缀在 SelectImportFile 内部分流
    const opts: Record<string, unknown> = { multiple: true };
    if (acceptPmx) {
        opts.types = [
            {
                description: 'Model files',
                accept: {
                    'application/octet-stream': [
                        '.pmx',
                        '.png',
                        '.jpg',
                        '.jpeg',
                        '.bmp',
                        '.tga',
                        '.dds',
                        '.tif',
                        '.tiff',
                    ],
                },
            },
        ];
    }
    return (await picker(opts)) ?? null;
}

async function _pickFile(accept?: string): Promise<FileSystemFileHandle | null> {
    const picker = (
        window as { showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]> }
    ).showOpenFilePicker;
    if (typeof picker !== 'function') return null;
    const handles = await picker(
        accept ? { types: [{ accept: { 'application/octet-stream': [accept] } }] } : undefined
    );
    return handles[0] ?? null;
}

/**
 * [doc:adr-182] 检查 entry:<stem> 是否已存在，若冲突则追加序号后缀 "(2)", "(3)"...
 *
 * FSA 多文件选择无天然来源标识——不同目录的同名 PMX 在导入时共用裸文件名为 stem，
 * 后缀机制防止 file:/entry:/dir: 键互相覆盖。与 _encModelStem 协同：先解析唯一 stem，
 * 再编码为键安全 token。
 */
async function _resolveUniqueStem(baseStem: string): Promise<string> {
    let stem = baseStem;
    let n = 1;
    while ((await idbGet('models', `entry:${_encModelStem(stem)}`)) !== undefined) {
        n++;
        stem = `${baseStem} (${n})`;
    }
    return stem;
}

/**
 * [doc:adr-195] 将单个模型/动作文件写入 IndexedDB 资源库（file:<stem> + entry:<stem>），
 * **不加载到场景**。供下载面板批量摄入复用——与 importFileByPath（会 loadManager.load 进场景）解耦。
 * 返回的 loadPath 仅供调用方按需加载；批量摄入场景不应调用 loadManager.load。
 */
interface _IngestPair {
    key: string;
    value: unknown;
}

/** 计算写入键值对（不落库），供单条/批量摄入复用，避免逻辑重复。
 *  [doc:adr-182] 同名冲突检测 + 序号后缀，防止 FSA 多选同名 PMX 覆盖。 */
async function _buildIngestPairs(
    name: string,
    bytes: Uint8Array
): Promise<{ pairs: [string, unknown][]; loadPath: string }> {
    const lower = name.toLowerCase();
    const baseStem = _stripExt(name);
    if (lower.endsWith('.pmx')) {
        const pmxStem = await _resolveUniqueStem(baseStem);
        const encStem = _encModelStem(pmxStem);
        const modelDir = 'web://model';
        const filePath = `${modelDir}/${encStem}`;
        const entry = {
            dir: modelDir,
            file_path: filePath,
            name_jp: pmxStem,
            name_en: pmxStem,
            comment: '',
            has_thumb: false,
            type: 'actor' as const,
            format: 'pmx' as const,
            container: 'file' as const,
            zip_inner: '',
            category: '',
            source: '',
            name: pmxStem,
            fileName: name,
            kind: 'pmx' as const,
            size: bytes.byteLength,
            savedAt: Date.now(),
        };
        return { pairs: [[`file:${encStem}`, bytes], [`entry:${encStem}`, entry]], loadPath: filePath };
    }
    // zip / vmd 保持原有裸 stem 行为（无冲突检测，由上层 ExtractZip/drop-import 管理）
    const stem = baseStem;
    const pairs: [string, unknown][] = [[`file:${stem}`, bytes]];
    if (lower.endsWith('.zip')) {
        pairs.push([
            `entry:${stem}`,
            {
                name: stem,
                fileName: name,
                kind: 'zip' as const,
                size: bytes.byteLength,
                savedAt: Date.now(),
            },
        ]);
    }
    return { pairs, loadPath: name };
}

/** 写入单个模型/动作文件（File）到 IndexedDB 资源库（file:+entry:），不加载到场景。 */
export async function ingestModelFile(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { pairs, loadPath } = await _buildIngestPairs(file.name, bytes);
    for (const [k, v] of pairs) await idbSet('models', k, v);
    return loadPath;
}

/** [doc:adr-195] 写入单文件（名+字节）到资源库，不加载到场景。供下载面板批量摄入复用。 */
export async function ingestModelBytes(name: string, bytes: Uint8Array): Promise<string> {
    const { pairs, loadPath } = await _buildIngestPairs(name, bytes);
    for (const [k, v] of pairs) await idbSet('models', k, v);
    return loadPath;
}

/** [doc:adr-195] P3 批量摄入：单事务写入该批次所有 file:/entry: 键，避免逐条 idbSet 并发写竞态。 */
export async function ingestModelFiles(files: { name: string; bytes: Uint8Array }[]): Promise<number> {
    const all: [string, unknown][] = [];
    for (const f of files) {
        const { pairs } = await _buildIngestPairs(f.name, f.bytes);
        all.push(...pairs);
    }
    await idbBatchSet('models', all);
    return files.length;
}

const TEXTURE_EXTS_RE = /\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i;

/** 写入 .pmx + 伴生纹理文件到 IndexedDB。
 *  PMX → file:<encStem> + entry:<encStem>（含 dir/file_path，模型库可见）
 *  纹理 → dir:<encStem>:<filename>（供 collectTextureFiles / ListDirRecursive 扫描）
 *  返回 web://model/<encStem> 加载路径，对齐 ADR-182 ExtractZip 约定。
 *
 *  [doc:adr-182] 同名冲突检测：FSA 多文件选择无天然来源标识，
 *  写入前检查 entry:<encStem> 是否已存在，冲突时追加序号后缀 "(2)", "(3)"... */
async function _writeModelWithTextures(
    pmxFile: File,
    allHandles: FileSystemFileHandle[]
): Promise<string> {
    const baseStem = _stripExt(pmxFile.name);
    // [doc:adr-182] 同名冲突检测 + 序号后缀
    const pmxStem = await _resolveUniqueStem(baseStem);
    const encStem = _encModelStem(pmxStem);
    // 先写 PMX
    const pmxBytes = new Uint8Array(await pmxFile.arrayBuffer());
    await idbSet('models', `file:${encStem}`, pmxBytes);
    const modelDir = 'web://model';
    const filePath = `${modelDir}/${encStem}`;
    await idbSet('models', `entry:${encStem}`, {
        dir: modelDir,
        file_path: filePath,
        name_jp: pmxStem,
        name_en: pmxStem,
        comment: '',
        has_thumb: false,
        type: 'actor',
        format: 'pmx',
        container: 'file',
        zip_inner: '',
        category: '',
        source: '',
        name: pmxStem,
        fileName: pmxFile.name,
        kind: 'pmx',
        size: pmxBytes.byteLength,
        savedAt: Date.now(),
    });
    // 写纹理文件到 dir:<encStem>:<filename>
    for (const handle of allHandles) {
        const f = await handle.getFile();
        if (!TEXTURE_EXTS_RE.test(f.name.toLowerCase())) continue;
        if (f.name === pmxFile.name) continue; // 跳过 PMX 本身
        const texBytes = new Uint8Array(await f.arrayBuffer());
        const dirKey = `dir:${encStem}:${f.name}`;
        await idbSet('models', dirKey, texBytes);
    }
    return filePath;
}

// [doc:adr-177] FSA 目录扫描：递归遍历 directory handle，将 .pmx/.zip 文件写入 IndexedDB。
// 键规约与 idb.ts saveModel 一致：file:<stem> + entry:<stem>
let _fsaRootHandle: FileSystemDirectoryHandle | null = null;

// [doc:adr-183] 扫描并发守护：防止用户反复点击「设置根目录」触发并发 _scanDirIntoIDB。
// 无锁时第二次 SelectDir 的 _clearScannedEntries 会清空第一次扫描已写入的 entry，
// 两次扫描的 entry 写入相互覆盖，用户表现「只显示一个文件夹」「扫描永远完不成」。
// 锁存进行中的 Promise，并发调用直接 await 同一 Promise，避免重复扫描 + 数据竞争。
let _scanningPromise: Promise<void> | null = null;

// [doc:adr-183] 扫描进度回调（节流刷新 UI 用）。
// 每扫完一个子目录调用一次，调用方据此节流 dispatch 事件增量刷新 UI，
// 避免「扫描中 UI 不更新，扫完才一次性显示」的体感问题。
type ScanProgressCallback = (scannedDirs: number) => void;
let _scanProgressCb: ScanProgressCallback | null = null;

/** [doc:adr-183] 注册扫描进度回调，供 UI 层节流增量刷新。 */
export function setScanProgressCallback(cb: ScanProgressCallback | null): void {
    _scanProgressCb = cb;
}

// [doc:adr-183] 扫描计数器，每次扫描开始前重置。子目录扫完递增，供进度回调读取。
let _scannedDirCount = 0;

// [doc:adr-177] FSA 目录句柄的异步迭代器接口（TS DOM lib 未含 values()，手动断言）
interface FsaDirHandle extends FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
}

// ======== 资源分类（对齐桌面端目录约定）========
//
// 桌面端靠子目录名分类（Go 端 GetPath / scanAllCategories）：
//   PMX/ → 模型, VMD/ → 动作, audio/ → 音乐, prop/ → 道具, stage/ → 舞台 …
// 网页端 SelectDir 扫描时复用同一约定：
//   1. 文件位于已知类别子目录下 → 按目录分类（结构化目录）
//   2. 文件不在已知子目录下 → 按扩展名分类，映射到虚拟子目录（扁平目录兜底）
// 两种模式的 dir 字段都使用 `web://selected-dir/<子目录>` 格式，
// 使 getBrowseDir(category) → libraryRoot + '/' + CATEGORY_DIR[category] 自然匹配，
// 无需 web:// 特殊处理。

/** 桌面端目录约定（对齐 Go 端 GetPath catDef，键为小写目录名）*/
const _CATEGORY_BY_DIR: Record<string, { type: string; format: string }> = {
    'pmx': { type: 'actor', format: 'pmx' },
    'vmd': { type: 'motion', format: 'vmd' },
    'audio': { type: 'audio', format: 'audio' },
    'prop': { type: 'prop', format: 'pmx' },
    'stage': { type: 'stage', format: 'pmx' },
    'environment': { type: 'environment', format: 'environment' },
    'md-dress': { type: 'outfit', format: 'pmx' },
    'setting': { type: 'setting', format: 'setting' },
};

/** 扩展名兜底分类 + 虚拟子目录映射（扁平目录用，子目录名对齐 CATEGORY_DIR）*/
const _CATEGORY_BY_EXT: Record<string, { subdir: string; type: string; format: string }> = {
    pmx: { subdir: 'PMX', type: 'actor', format: 'pmx' },
    vmd: { subdir: 'VMD', type: 'motion', format: 'vmd' },
    mp3: { subdir: 'audio', type: 'audio', format: 'audio' },
    wav: { subdir: 'audio', type: 'audio', format: 'audio' },
    ogg: { subdir: 'audio', type: 'audio', format: 'audio' },
    flac: { subdir: 'audio', type: 'audio', format: 'audio' },
    wma: { subdir: 'audio', type: 'audio', format: 'audio' },
    x: { subdir: 'stage', type: 'stage', format: 'pmx' },
    vpd: { subdir: 'PMX', type: 'pose', format: 'vpd' },
    zip: { subdir: 'PMX', type: 'actor', format: 'zip' },
};

/** 所有类别子目录名（小写），用于 _stripCategorySeg 的 O(1) 判定 */
const _CATEGORY_SUBDIRS = new Set<string>([
    ...Object.keys(_CATEGORY_BY_DIR),
    ...Object.values(_CATEGORY_BY_EXT).map((e) => e.subdir.toLowerCase()),
]);

const _SUPPORTED_EXTS_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|x|vpd|zip)$/i;

/**
 * [doc:adr-177] 计算文件在 IndexedDB 内的「分类相对路径」。
 *
 * 对齐桌面端 WalkDir 天然拥有真实路径的语义：web 端没有文件系统，
 * 需用 `web://selected-dir/<categoryRelPath>` 重建目录树。
 *
 * - 当顶层目录名命中 `_CATEGORY_BY_DIR`（PMX/VMD/...）时，relPath 已含类别段，直接返回。
 * - 否则按扩展名映射虚拟类别段（PMX/VMD/audio...），拼到真实 relPath 前方，
 *   使 `web://selected-dir/PMX/<真实子目录>` 保留嵌套层级，UI 按 dir 字段自然长出文件夹树。
 * 返回值不含前缀；为空串时表示根（无子路径）。
 */
function _computeCategoryRelPath(byDir: boolean, ext: string, relPath: string): string {
    if (byDir) return relPath;
    const byExt = _CATEGORY_BY_EXT[ext];
    const catSub = byExt?.subdir;
    return catSub ? (relPath ? `${catSub}/${relPath}` : catSub) : relPath;
}

/**
 * [doc:adr-177] 去掉 `web://selected-dir/` 路径开头的类别段（PMX/VMD/audio...），
 * 返回真实相对路径。与 `_CATEGORY_BY_DIR` / `_CATEGORY_BY_EXT` 对齐。
 * 例：`PMX/分类1/miku.pmx` → `分类1/miku.pmx`；`分类1/miku.pmx` 原样返回。
 */
function _stripCategorySeg(p: string): string {
    const seg = p.split('/')[0];
    if (!seg) return p;
    return _CATEGORY_SUBDIRS.has(seg.toLowerCase()) ? p.slice(seg.length + 1) : p;
}

/**
 * [doc:adr-177][p2b] 计算纹理文件相对其关联 PMX 的相对路径。
 *
 * - `childRelIdCategory`：纹理相对分类根（已去掉类别段）的相对路径，如 `tex` / `分类1/tex`。
 * - `pmxRelPath`：关联 PMX 相对分类根的相对路径（PMX 所在层计算，如 '' / `分类1`）。
 * 返回纹理相对 PMX 的路径段（不含文件名），用于构造 `dir:<pmxStem>:<relToPmx>/<name>` 键，
 * 使读取侧 `readFileBytes('web://model/<pmxStem>/<relToPmx>/<name>')` 能精确命中。
 *
 * 例：PMX 在分类根（pmxRelPath=''），纹理在 `tex/face.png`（childRelIdCategory='tex'）→ `tex`；
 *     PMX 在 `分类1`（pmxRelPath='分类1'），纹理在 `分类1/tex/face.png` → `tex`。
 */
function _relPathFrom(childRelIdCategory: string, pmxRelPath: string): string {
    if (!pmxRelPath) return childRelIdCategory;
    if (childRelIdCategory === pmxRelPath) return '';
    if (childRelIdCategory.startsWith(pmxRelPath + '/')) {
        return childRelIdCategory.slice(pmxRelPath.length + 1);
    }
    return childRelIdCategory;
}

/** [doc:adr-180] 清掉上一次 FSA 扫描写入的模型库 entry（dir 以 web://selected-dir 开头），根目录重扫前调用，
 * 保证层级彻底自愈且旧塌缩 entry 被清除。设计可靠性：
 * - 扫描器(_scanDirIntoIDB)写入的 entry 含 dir 字段，值为 'web://selected-dir/...'。
 * - 手动导入(SelectImportFile/ingestModelFile)写入的 entry dir 为 'web://model'（[doc:adr-182] 补齐），不匹配前缀，得以保留。
 * - bundle entry 的 dir 为 'web://bundle/...'，不匹配前缀，得以保留。 */
async function _clearScannedEntries(): Promise<void> {
    const keys = (await idbKeys('models')).filter((k) => k.startsWith('entry:'));
    for (const k of keys) {
        const v = await idbGet<{ dir?: string }>('models', k);
        if (v && typeof v.dir === 'string' && v.dir.startsWith('web://selected-dir')) {
            await idbDelete('models', k);
        }
    }
}

/** [doc:adr-180] 从 IndexedDB 恢复持久化的 FSA 目录句柄（供 ScanModelDir 启动自愈调用）。
 * 仅 queryPermission 恢复授权，绝不 requestPermission（后者须用户手势，启动期无手势会被浏览器拦截）。
 * 未授权 / 无句柄 / 句柄失效返回 null，调用方降级为手动 SelectDir。 */
async function restoreFsaRootHandle(): Promise<FileSystemDirectoryHandle | null> {
    const h = await idbGet<FileSystemDirectoryHandle>('config', 'fsaRootHandle');
    if (!h) return null;
    const permHandle = h as FileSystemDirectoryHandle & {
        queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof permHandle.queryPermission === 'function') {
        try {
            const perm = await permHandle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') return h;
        } catch {
            /* 句柄失效（权限撤销 / 隐私模式）→ 降级为手动 SelectDir */
        }
    }
    // 不支持 queryPermission 的旧实现：保守不自动恢复，避免静默失败。
    return null;
}

export type FsaAuthState = 'unsupported' | 'none' | 'granted' | 'revoked';

/** [doc:adr-183] 查询 FSA 根目录授权状态，供 UI 启动引导（不触发任何权限弹窗）。
 *  - unsupported: 浏览器无 FSA API（桌面端/旧浏览器）→ 不引导
 *  - none: 从未授权过 → 首启动应引导
 *  - granted: 持久化句柄仍有效 → 启动自愈，不引导
 *  - revoked: 曾授权但失效（权限撤销/隐私模式/句柄损坏）→ 应提示重新授权 */
export async function getFsaAuthState(): Promise<FsaAuthState> {
    if (!_cap().fsAccess) return 'unsupported';
    const h = await idbGet<FileSystemDirectoryHandle>('config', 'fsaRootHandle');
    if (!h) return 'none';
    const permHandle = h as FileSystemDirectoryHandle & {
        queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof permHandle.queryPermission === 'function') {
        try {
            return (await permHandle.queryPermission({ mode: 'readwrite' })) === 'granted'
                ? 'granted'
                : 'revoked';
        } catch {
            return 'revoked';
        }
    }
    return 'revoked'; // 老实现不支持 queryPermission，保守视为需重选
}

/** [doc:adr-183] 用户跳过启动授权引导后写入「已跳过」标志，避免纯导入用户每次启动被弹窗骚扰。
 * 想重新触发引导只需手动点「设置根目录」。 */
export async function isFsaAuthPromptDismissed(): Promise<boolean> {
    return (await idbGet<boolean>('config', 'fsaAuthPromptDismissed')) === true;
}

export async function dismissFsaAuthPrompt(): Promise<void> {
    await idbSet('config', 'fsaAuthPromptDismissed', true);
}

/** [doc:adr-183] 对持久化的 FSA 句柄重新请求授权（不重选目录）。
 * 须在用户手势上下文中调用（如 confirm 框点击），否则 requestPermission 会被浏览器拦截。
 * 成功写入内存句柄并返回 true；无句柄 / 用户拒绝 / 句柄失效返回 false。
 * 与 restoreFsaRootHandle 的区别：后者仅 queryPermission（无手势），本函数主动 requestPermission（需手势）。 */
export async function reauthorizeFsaRoot(): Promise<boolean> {
    const h = await idbGet<FileSystemDirectoryHandle>('config', 'fsaRootHandle');
    if (!h) return false;
    const permHandle = h as FileSystemDirectoryHandle & {
        requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof permHandle.requestPermission !== 'function') return false;
    try {
        const perm = await permHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
            _fsaRootHandle = h;
            return true;
        }
    } catch {
        /* 用户拒绝 / 句柄失效 → 降级为手动 SelectDir */
    }
    return false;
}

// [doc:adr-195] 下载文件夹独立 FSA 句柄（P3：不得强制共用 root 句柄）。
// 与 _fsaRootHandle / fsaRootHandle 完全独立，支持用户把下载文件夹与模型库根目录设为不同目录
// （如下载在桌面 Downloads、库在移动硬盘）。复用 ADR-180/183 的持久化/授权机制，仅键空间分离。
let _fsaDownloadHandle: FileSystemDirectoryHandle | null = null;
const _FSA_DOWNLOAD_KEY = 'fsaDownloadHandle';

/** 查询下载文件夹 FSA 授权状态（不触发权限弹窗），供 UI 引导。 */
export async function getFsaDownloadAuthState(): Promise<FsaAuthState> {
    if (!_cap().fsAccess) return 'unsupported';
    const h = await idbGet<FileSystemDirectoryHandle>('config', _FSA_DOWNLOAD_KEY);
    if (!h) return 'none';
    const permHandle = h as FileSystemDirectoryHandle & {
        queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof permHandle.queryPermission === 'function') {
        try {
            return (await permHandle.queryPermission({ mode: 'readwrite' })) === 'granted'
                ? 'granted'
                : 'revoked';
        } catch {
            return 'revoked';
        }
    }
    return 'revoked';
}

/** 对持久化的下载文件夹句柄重新请求授权（须用户手势上下文）。成功返回 true。 */
export async function reauthorizeFsaDownload(): Promise<boolean> {
    const h = await idbGet<FileSystemDirectoryHandle>('config', _FSA_DOWNLOAD_KEY);
    if (!h) return false;
    const permHandle = h as FileSystemDirectoryHandle & {
        requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof permHandle.requestPermission !== 'function') return false;
    try {
        const perm = await permHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
            _fsaDownloadHandle = h;
            return true;
        }
    } catch {
        /* 用户拒绝 / 句柄失效 → 降级为手动重选 */
    }
    return false;
}

/** 选择下载文件夹（独立 FSA 句柄），持久化到 _FSA_DOWNLOAD_KEY。 */
export async function selectFsaDownloadDir(): Promise<string | null> {
    const picker = (
        window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker;
    if (typeof picker !== 'function') return null;
    try {
        const h = await picker();
        await idbSet('config', _FSA_DOWNLOAD_KEY, h);
        _fsaDownloadHandle = h;
        return h.name;
    } catch {
        return null;
    }
}

/** 读取持久化的下载文件夹句柄（供扫描使用），不触发权限弹窗；无句柄返回 null。 */
export async function getFsaDownloadHandle(): Promise<FileSystemDirectoryHandle | null> {
    const h = await idbGet<FileSystemDirectoryHandle>('config', _FSA_DOWNLOAD_KEY);
    if (!h) return null;
    _fsaDownloadHandle = h;
    return h;
}

/** FSA 目录递归扫描：保留目录结构，按目录约定分类（对齐桌面端） */
async function _scanDirIntoIDB(
    dirHandle: FileSystemDirectoryHandle,
    relPath = '',
    parentPmx: { stem: string; relPath: string }[] = [],
    depth = 0
): Promise<void> {
    const MAX_SCAN_DEPTH = 20;
    if (depth > MAX_SCAN_DEPTH) {
        console.warn(`[web-scan] 递归深度超限 (${depth})，跳过: ${relPath}`);
        return;
    }
    // [doc:adr-180] 根目录重扫：先清旧，避免旧版塌缩 entry 残留导致自愈不彻底。
    if (relPath === '') {
        await _clearScannedEntries();
    }
    const dir = dirHandle as FsaDirHandle;
    // 第一遍：收集本层所有文件信息（FileSystemDirectoryHandle 的 values() 是有状态的，一次读完）
    const files: { name: string; handle: FileSystemFileHandle }[] = [];
    const subDirs: string[] = [];
    for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
            files.push({ name: entry.name, handle: entry as FileSystemFileHandle });
        } else if (entry.kind === 'directory') {
            subDirs.push(entry.name);
        }
    }
    console.info(
        `[web-scan] 目录 "${relPath || '(根)'}": ${files.length} 个文件, ${subDirs.length} 个子目录 [${subDirs.join(', ')}]`
    );

    // 判定本层类别：顶层目录名匹配已知类别 → 按目录约定分类
    const topDir = relPath.split('/')[0]?.toLowerCase() || '';
    const byDir = _CATEGORY_BY_DIR[topDir];

    // 本层 PMX 的相对 stem + 相对分类根路径（用于纹理关联；含类别段 + 相对路径，杜绝同名文件覆盖）
    const pmxEntries = files
        .filter((f) => /\.pmx$/i.test(f.name))
        .map((f) => {
            const sn = _stripExt(f.name);
            const catRelPath = _computeCategoryRelPath(!!byDir, 'pmx', relPath);
            const relIdCategory = _stripCategorySeg(catRelPath);
            return {
                stem: relIdCategory ? `${relIdCategory}/${sn}` : sn,
                relPath: relIdCategory,
            };
        });
    // 合并父层 PMX：子目录纹理关联到最近的祖先 PMX
    const effectivePmx = pmxEntries.length > 0 ? pmxEntries : parentPmx;
    // 本层纹理相对分类根的相对路径（所有本层纹理共享同一 relPath，一次算好）
    const texRelIdCategory = _stripCategorySeg(relPath);
    let texLinkedCount = 0; // 本层已关联纹理计数（用于汇总日志）

    // 第二遍：并发写入（纹理关联 + 资源写入，[doc:adr-183] 性能优化）
    // 原串行 for-of 每个 zip 都 await getFile()+arrayBuffer()+JSZip.loadAsync()，
    // Android FUSE 单文件 500ms + JSZip 200ms = 700ms/zip，1秒扫 2 个。
    // 改 Promise.all 并发：IO + CPU 重叠，同层 N 个文件总耗时 ≈ max(单文件) 而非 sum。
    // IDB 写入经事务串行化保证安全；texLinkedCount ++ 在 JS 单线程 async 交错下安全。
    await Promise.all(
        files.map(async ({ name, handle }) => {
            const lower = name.toLowerCase();
            try {
            // 纹理分支：关联到 effectivePmx（含子目录纹理，[p2b] 相对 PMX 路径）
            if (TEXTURE_EXTS_RE.test(lower)) {
                if (effectivePmx.length > 0) {
                    const file = await handle.getFile();
                    const texBytes = new Uint8Array(await file.arrayBuffer());
                for (const pmx of effectivePmx) {
                    const relToPmx = _relPathFrom(texRelIdCategory, pmx.relPath);
                    // [bugfix:tex-stem-collision] 用含路径的 pmx.stem 编码键，杜绝不同目录同名 PMX
                    // （如 A/miku.pmx 与 B/miku.pmx）纹理键互相覆盖；解析侧 IsolateModelDir 产出
                    // 同一编码 stem，ListDirRecursive / readFileBytes 精确命中。
                    const key = relToPmx
                        ? `dir:${_encModelStem(pmx.stem)}:${relToPmx}/${name}`
                        : `dir:${_encModelStem(pmx.stem)}:${name}`;
                    await idbSet('models', key, texBytes);
                }
                texLinkedCount++;
            }
            return;
        }
        if (!_SUPPORTED_EXTS_RE.test(lower)) return;
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const stem = _stripExt(name);
        const ext = lower.split('.').pop() || '';
        const catRelPath = _computeCategoryRelPath(!!byDir, ext, relPath);
        const relIdCategory = _stripCategorySeg(catRelPath);
        const virtualDir = catRelPath ? `web://selected-dir/${catRelPath}` : 'web://selected-dir';
        const relIdStem = relIdCategory ? `${relIdCategory}/${stem}` : stem;
        await idbSet('models', `file:${relIdStem}`, bytes);

        // 分类：目录约定优先，扩展名兜底（type/format 不变）
        let type: string, format: string;
        if (byDir) {
            type = byDir.type;
            format = byDir.format;
        } else {
            const byExt = _CATEGORY_BY_EXT[ext];
            type = byExt?.type ?? 'actor';
            format = byExt?.format ?? ext;
        }

        // [bugfix:zip-expand] 对齐 Go 端 expandZipEntries：扫描时展开 zip 内部文件，
        // 每个识别文件（pmx/vmd/audio/vpd）生成独立 entry，dir = virtualDir/zipStem（虚拟文件夹），
        // container='zip' + zip_inner=内部路径。UI 层 buildLevel 按 dir 分组自然形成文件夹层级。
        if (ext === 'zip') {
            // [doc:adr-006] ZIP 炸弹防护 1：文件大小预判（对齐 Go 端 maxZipEntryFileSize）
            if (bytes.byteLength > MAX_ZIP_FILE_SIZE) {
                console.warn(
                    `[web-scan] 跳过过大 zip (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB): ${name}`
                );
                return;
            }
            try {
                // [doc:adr-006] 传入 decodeFileName：对非 UTF-8 条目名做 SJIS/GBK/Big5 评分检测，
                // 避免乱码导致 .pmx 扩展名字节被破坏、zip 展开失败（模型嵌套识别不足）
                const zip = await JSZip.loadAsync(bytes, { decodeFileName: bestDecodeZipName });
                const allEntries = Object.keys(zip.files);
                // [doc:adr-006] ZIP 炸弹防护 2：条目数（对齐 Go 端 maxZipEntryCount）
                if (allEntries.length > MAX_ZIP_ENTRY_COUNT) {
                    console.warn(
                        `[web-scan] zip ${name} 条目数 ${allEntries.length} 超限，疑似 zip 炸弹`
                    );
                    return;
                }
                // [doc:adr-006] ZIP 炸弹防护 3：总未压缩大小（对齐 Go 端 maxZipTotalBytes）
                // JSZip 类型未暴露 _data.uncompressedSize，用 as 访问内部字段（安全防护必需）
                let totalUncompressed = 0;
                for (const n of allEntries) {
                    const zf = zip.files[n] as unknown as {
                        _data?: { uncompressedSize?: number };
                    };
                    if (typeof zf._data?.uncompressedSize === 'number') {
                        totalUncompressed += zf._data.uncompressedSize;
                    }
                    if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) break;
                }
                if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) {
                    console.warn(
                        `[web-scan] zip ${name} 总未压缩大小超限，疑似 zip 炸弹`
                    );
                    return;
                }
                const INNER_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|vpd)$/i;
                const innerFiles = allEntries.filter(
                    (n) => !zip.files[n].dir && INNER_RE.test(n)
                );
                if (innerFiles.length > 0) {
                    const zipDir = `${virtualDir}/${stem}`;
                    for (const innerPath of innerFiles) {
                        const innerBase = _baseName(innerPath);
                        const innerExt = innerBase.toLowerCase().split('.').pop() || '';
                        const innerStem = _stripExt(innerBase);
                        const innerByExt = _CATEGORY_BY_EXT[innerExt];
                        const innerType = byDir ? byDir.type : (innerByExt?.type ?? 'actor');
                        const innerFormat = innerByExt?.format ?? innerExt;
                        // entry key 需唯一：zipStem + 内部路径（去斜杠）
                        const entryKey = `${relIdStem}__${innerPath.replace(/[/\\]/g, '_')}`;
                        await idbSet('models', `entry:${entryKey}`, {
                            dir: zipDir,
                            file_path: `${virtualDir}/${name}`,
                            name_jp: innerStem,
                            name_en: innerStem,
                            comment: '',
                            has_thumb: false,
                            type: innerType,
                            format: innerFormat,
                            container: 'zip',
                            zip_inner: innerPath,
                            category: '',
                            source: '',
                            name: innerStem,
                            fileName: innerBase,
                            kind: innerFormat,
                            size: 0,
                            savedAt: Date.now(),
                        });
                        console.info(
                            `[web-scan]   展开 zip entry:${entryKey} → dir=${zipDir} inner=${innerPath} format=${innerFormat}`
                        );
                    }
                } else {
                    // zip 内无识别资源，作为整体 entry 保留
                    await idbSet('models', `entry:${relIdStem}`, {
                        dir: virtualDir,
                        file_path: `${virtualDir}/${name}`,
                        name_jp: stem,
                        name_en: stem,
                        comment: '',
                        has_thumb: false,
                        type,
                        format: 'zip',
                        container: 'zip',
                        zip_inner: '',
                        category: '',
                        source: '',
                        name: stem,
                        fileName: name,
                        kind: 'zip',
                        size: bytes.byteLength,
                        savedAt: Date.now(),
                    });
                }
            } catch (zipErr) {
                // zip 解析失败（损坏/加密），作为整体 entry 保留
                console.warn(`[web-scan]   zip 解析失败: ${name}`, zipErr);
                await idbSet('models', `entry:${relIdStem}`, {
                    dir: virtualDir,
                    file_path: `${virtualDir}/${name}`,
                    name_jp: stem,
                    name_en: stem,
                    comment: '',
                    has_thumb: false,
                    type,
                    format: 'zip',
                    container: 'zip',
                    zip_inner: '',
                    category: '',
                    source: '',
                    name: stem,
                    fileName: name,
                    kind: 'zip',
                    size: bytes.byteLength,
                    savedAt: Date.now(),
                });
            }
        } else {
            await idbSet('models', `entry:${relIdStem}`, {
                dir: virtualDir,
                file_path: `${virtualDir}/${name}`,
                name_jp: stem,
                name_en: stem,
                comment: '',
                has_thumb: false,
                type,
                format,
                container: 'file',
                zip_inner: '',
                category: '',
                source: '',
                name: stem,
                fileName: name,
                kind: format,
                size: bytes.byteLength,
                savedAt: Date.now(),
            });
            console.info(
                `[web-scan]   写入 entry:${relIdStem} → dir=${virtualDir} type=${type} format=${format}`
            );
        }
        } catch (e) {
            // [doc:adr-183] 单文件读取/写入失败（权限拒访/文件损坏/编码异常）不应中断
            // 整个目录扫描。原实现无 try/catch，handle.getFile() 或 arrayBuffer() 抛错会让
            // _scanDirIntoIDB 在此处断裂，已扫到的兄弟文件已写入 IDB，后续文件全部消失。
            // 守卫后 return 让兄弟文件继续扫描（Promise.all 不中断），与 Go 端 WalkDir err 后 return nil 一致。
            console.warn(`[web-scan] 文件处理失败: "${name}" (relPath=${relPath || '(根)'})`, e);
        }
        })
    );

    if (texLinkedCount > 0) {
        console.info(
            `[web-scan]   纹理关联: ${texLinkedCount} 个纹理 → PMX [${effectivePmx.map((p) => _baseName(p.stem)).join(', ')}]`
        );
    }

    // 递归子目录（并发，传递本层 PMX 使子目录纹理关联祖先）
    // [doc:adr-183] 原串行 await，子目录多时累积延迟。改 Promise.all 并发递归，
    // 同层 N 个子目录总耗时 ≈ max(单子树) 而非 sum。
    await Promise.all(
        subDirs.map(async (dirName) => {
            let subHandle: FileSystemDirectoryHandle;
            try {
                subHandle = await dir.getDirectoryHandle(dirName);
            } catch (e) {
                // [doc:adr-183] Android Chrome WebView 对部分中文目录名可能因编码/权限边界
                // 抛错（NotSupportedError / SecurityError）。原实现无 try/catch，整个 _scanDirIntoIDB
                // 异步链在此断裂——已扫到的 entry 已写入 IDB，后续兄弟目录全部消失。
                // 用户表现：「只扫到一个文件夹」（首个目录扫到后，第二个目录失败导致链路断裂）。
                // 守卫后 return 让兄弟目录继续扫描，与 Go 端 WalkDir err 后 return nil 一致。
                console.warn(`[web-scan] getDirectoryHandle 失败: "${dirName}" (relPath=${relPath || '(根)'})`, e);
                return;
            }
            const subRelPath = relPath ? `${relPath}/${dirName}` : dirName;
            await _scanDirIntoIDB(subHandle, subRelPath, effectivePmx, depth + 1);
            // [doc:adr-183] 子目录扫完触发进度回调，UI 层节流增量刷新。
            // 回调在 try 外部，子目录扫描失败已 return 不会到此处。
            if (_scanProgressCb) {
                try {
                    _scanProgressCb(++_scannedDirCount);
                } catch {
                    /* 回调失败不影响扫描 */
                }
            }
        })
    );
}

/**
 * [doc:adr-183] 带并发守护的扫描入口。
 * 锁存进行中的扫描 Promise，并发调用（用户反复点击「设置根目录」/ ScanModelDir 自动恢复）
 * 直接 await 同一 Promise，避免 _clearScannedEntries 清空正在进行的扫描写入导致数据竞争。
 * 扫描完成后清锁，允许下一次主动重扫。
 */
async function _scanRootGuarded(): Promise<void> {
    if (_scanningPromise) {
        console.info('[web-scan] 扫描进行中，复用现有 Promise 避免并发清空');
        return _scanningPromise;
    }
    if (!_fsaRootHandle) return;
    _scannedDirCount = 0; // [doc:adr-183] 重置计数器
    _scanningPromise = (async () => {
        try {
            await _scanDirIntoIDB(_fsaRootHandle);
        } finally {
            _scanningPromise = null;
        }
    })();
    return _scanningPromise;
}

export const browserAdapter: BackendService = {
    kind: 'browser',
    capabilities: _cap,

    // —— readFileBytes（替换原生 ReadFileBytes 大写）——
    // [doc:adr-177] 主应用传绝对路径，经 _resolveIdbKey 映射为 IndexedDB key（file:<name>）
    async readFileBytes(path: string): Promise<Uint8Array | null> {
        const key = _resolveIdbKey(path);
        const bytes = (await idbGet<Uint8Array>('models', key)) ?? null;
        if (bytes) return bytes;
        // 兜底 1：bare stem fallback（FSA 扫描场景，路径含类别前缀）
        // _classifyPath regex 只取第一个 / 前段作为 stem，尝试所有可能的 bare stem 边界
        const modelMatch = path.match(/^web:\/\/model\/(.+)$/);
        if (modelMatch) {
            const segments = modelMatch[1].split('/');
            // 尝试倒数第 2 段作为 bare stem（最后一段是文件名）
            for (let i = segments.length - 2; i >= 1; i--) {
                const candidateStem = segments[i];
                const candidateRest = segments.slice(i + 1).join('/');
                const candidateKey = `dir:${candidateStem}:${candidateRest}`;
                const candidateBytes = (await idbGet<Uint8Array>('models', candidateKey)) ?? null;
                if (candidateBytes) return candidateBytes;
            }
        }
        // 兜底 2：dir:<stem>:<relPath> 未命中时，按 ExtractZip 扁平键 file:<stem>（去扩展名）再查一次
        const baseName = _baseName(path);
        if (baseName && baseName !== path) {
            const stem = _stripExt(baseName);
            const fallback = (await idbGet<Uint8Array>('models', `file:${stem}`)) ?? null;
            if (fallback) return fallback;
        }
        return null;
    },

    // ============ ① 核心真实实现 ============
    async GetConfig(): Promise<Config> {
        return (await idbGet<Config>('config', 'config')) ?? _defaultConfig();
    },
    async SetConfig(cfg: Partial<Config>): Promise<void> {
        const cur = (await idbGet<Config>('config', 'config')) ?? _defaultConfig();
        await idbSet('config', 'config', { ...cur, ...cfg });
    },
    async GetUIState(): Promise<UIState> {
        // [doc:adr-177] 优先从 Config.ui_state 读（对齐主应用 restoreUIState 路径），
        // 兜底从 uistate store 读（向后兼容），最后用 _defaultUIState
        const cfg = await this.GetConfig();
        if (cfg.ui_state) return cfg.ui_state;
        return (await idbGet<UIState>('uistate', 'state')) ?? _defaultUIState();
    },
    // [doc:adr-176] 对齐 Go 签名：SetUIState(ui: UIState)。
    // Go 调用方传完整对象，merge 语义对完整对象等价覆盖；对部分字段调用更健壮。
    async SetUIState(s: UIState): Promise<void> {
        // [doc:adr-177] 双写：Config.ui_state（主应用读）+ uistate store（向后兼容）
        const cfg = await this.GetConfig();
        const merged = { ...(cfg.ui_state ?? _defaultUIState()), ...s };
        await this.SetConfig({ ui_state: merged } as Partial<Config>);
        await idbSet('uistate', 'state', merged);
    },
    // [doc:adr-176] 对齐 Go 签名：SetEnvState(env: EnvState)。
    // merge 语义：Go 调用方传完整 envState 时等价覆盖；部分字段调用保留旧字段。
    async SetEnvState(s: EnvState): Promise<void> {
        // [doc:adr-177] 单源：写入 Config.env（对齐主应用 restoreEnvState 读取路径）
        const cfg = await this.GetConfig();
        const merged = { ...(cfg.env ?? {}), ...s } as EnvState;
        await this.SetConfig({ env: merged } as Partial<Config>);
    },
    // [doc:adr-195] 网页端固定返回 'web' 模式（无 private/shared 切换）。
    // 调用方应通过 `getCachedCapabilities().storageMode` 判断是否可切换存储模式，勿依赖 'private'/'shared' 枚举。
    async GetStorageMode(): Promise<string> {
        return 'web';
    },
    async SetStorageMode(_mode: string): Promise<void> {
        // 浏览器固定 web 模式
    },
    async GetSystemA11ySettings(): Promise<Record<string, unknown>> {
        return (await idbGet<Record<string, unknown>>('config', 'a11y')) ?? {};
    },
    // [doc:adr-195] 网页端无真实构建信息：返回固定假值（version/commit='web'）。
    // 调用方应用 `backend.kind === 'browser'` 判断是否为浏览器端，勿用此返回值做版本比较。
    async GetBuildInfo(): Promise<Record<string, string>> {
        return { version: 'web', commit: 'web', date: new Date().toISOString() };
    },
    // [doc:adr-195] 网页端无版本更新检查能力：永远返回无更新（available:false，current/latest='web'）。
    // 调用方应优先检查 backend.kind === 'browser' 判断是否应跳过升级提示；勿据此判断版本。
    async CheckForUpdate(): Promise<UpdateCheckResult> {
        return {
            current: 'web',
            latest: 'web',
            available: false,
            url: '',
            checkedAt: 0,
            downloadUrl: '',
            assetName: '',
            size: 0,
            error: '',
        };
    },
    async DownloadApk(): Promise<InstallResult | null> {
        return { localPath: '', success: false, error: 'not supported on web' };
    },
    async DownloadAndRunInstaller(): Promise<InstallResult | null> {
        return { localPath: '', success: false, error: 'not supported on web' };
    },
    async ExtractZip(zipPath: string, _innerPath: string): Promise<ExtractResult | null> {
        // [doc:adr-177] 浏览器侧：调用方先将 zip 字节写入 IndexedDB file:<zipStem>，
        // 此处 readFileBytes 读回 → JSZip 解压 → 内部资源落地 → 返回主 PMX + 虚拟 dir。
        // 语义对齐 Go 的 ExtractZip（解压到缓存目录，浏览器侧缓存即 IndexedDB）。
        //
        // 落地键规约（p2-5）：
        //   file:<stem>            —— 扁平存（兼容 readFileBytes 绝对路径兜底）
        //   dir:<pmxStem>:<relPath>—— 带目录结构存（ListDirRecursive 扫描 + readFileBytes 路由）
        //   outfit:<pmxStem>       —— outfits.json（LoadOutfitFile 读取）
        //   scenes store bundle:<zipStem> —— scene.json（LoadSceneFile bundle 路径）
        //
        // [bugfix:zip-pmx-subdir] PMX 在 zip 内子目录时（如 `subdir/Miku.pmx` + `subdir/tex/face.png`），
        // babylon-mmd 拼 `<modelDir>/<PMX 内嵌相对路径>` = `web://model/<nsStem>/tex/face.png`
        // （不带子目录前缀），故 dir: 键的 relPath 必须是「相对 PMX 的路径」而非「zip 内完整路径」。
        // 否则写入 `dir:<nsStem>:subdir/tex/face.png` 与读取 `dir:<nsStem>:tex/face.png` 维度失配 → 贴图读不到。
        // 多 PMX 场景下还需仅处理 mainPmx 同子目录的文件，避免其他 PMX 子目录的贴图污染命名空间。
        const buf = await this.readFileBytes(zipPath);
        if (!buf) return null;
        // [doc:adr-006] 传入 decodeFileName：与扫描期 _scanDirIntoIDB 一致的条目名解码，
        // 保证 n === _inner_path 比较两端解码一致（避免扫描期乱码、解压期又乱码导致找不到目标 pmx）
        const zip = await JSZip.loadAsync(buf, { decodeFileName: bestDecodeZipName });
        const ASSET_RE = /\.(pmx|vmd|vpd|png|jpg|jpeg|bmp|tga|dds|tif|tiff|wav|mp3|ogg|flac|glb)$/i;
        const fileNames = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
        // 第一遍：确定目标文件（优先使用 innerPath，兜底找第一个 PMX）
        let mainPmxName = '';
        let mainPmxStem = '';
        let mainPmxFullPath = ''; // [bugfix:zip-pmx-subdir] 记录 PMX 在 zip 内的完整路径，用于推算目录前缀
        if (_innerPath) {
            // [bugfix:zip-innerpath] 多文件 zip 点击特定内部文件时，按 innerPath 定位
            const target = fileNames.find(
                (n) => n === _innerPath || n.replace(/\\/g, '/') === _innerPath
            );
            if (target) {
                mainPmxFullPath = target.replace(/\\/g, '/');
                mainPmxName = _baseName(target);
                mainPmxStem = _stripExt(mainPmxName);
            }
        }
        if (!mainPmxName) {
            for (const name of fileNames) {
                const baseName = _baseName(name);
                if (/\.pmx$/i.test(baseName)) {
                    mainPmxFullPath = name.replace(/\\/g, '/');
                    mainPmxName = baseName;
                    mainPmxStem = _stripExt(baseName);
                    break;
                }
            }
        }
        // [bugfix:zip-pmx-subdir] PMX 在 zip 内的目录前缀（含尾斜杠）。
        // 根目录 PMX 时为 ''，子目录 PMX（如 `subdir/Miku.pmx`）时为 'subdir/'。
        const pmxPrefix = mainPmxFullPath.includes('/')
            ? mainPmxFullPath.slice(0, mainPmxFullPath.lastIndexOf('/') + 1)
            : '';
        const zipStem = _extractStem(zipPath);
        // [doc:adr-182] 命名空间 stem = zipStem/pmxStem，经 _encModelStem 编码为单 token，
        // 使不同 zip 内同名 PMX 的 dir:/outfit: 键互不碰撞（消除静默错渲染）。
        // zipStem 兜底：极端情况 zipPath 无 stem 时退回裸 mainPmxStem（保持旧行为，不新增碰撞）。
        const nsStem = mainPmxStem
            ? _encModelStem(zipStem ? `${zipStem}/${mainPmxStem}` : mainPmxStem)
            : '';
        // 第二遍：并发存资源（含 dir: / outfit: / bundle: 分类）
        const baseNames: string[] = [];
        await Promise.all(
            fileNames.map(async (name) => {
                const bytes = new Uint8Array(await zip.files[name].async('arraybuffer'));
                const baseName = _baseName(name);
                const stem = _stripExt(baseName);
                const relPath = name.replace(/\\/g, '/');
                if (ASSET_RE.test(baseName)) {
                    // file:<裸stem> 扁平键：保留（向后兼容 + readFileBytes 兜底2 + 跨模型共享）
                    await idbSet('models', `file:${stem}`, bytes);
                    if (nsStem) {
                        // [bugfix:zip-pmx-subdir] 仅写属于 mainPmx 同子目录下的资源到命名空间，
                        // 避免多 PMX zip 中其他子目录的贴图污染 mainPmx 的命名空间。
                        // relPath 剥掉 pmxPrefix 使其相对 PMX 文件，与 babylon-mmd 拼接的 URL 维度一致。
                        if (!pmxPrefix || relPath.startsWith(pmxPrefix)) {
                            const relToPmx = pmxPrefix ? relPath.slice(pmxPrefix.length) : relPath;
                            await idbSet('models', `dir:${nsStem}:${relToPmx}`, bytes);
                            // [doc:adr-182] PMX 主文件额外写命名空间扁平键 file:<nsStem>，
                            // 使返回的 web://model/<nsStem> 加载路径经 readFileBytes 兜底2 命中正确字节。
                            if (baseName === mainPmxName) {
                                await idbSet('models', `file:${nsStem}`, bytes);
                            }
                        }
                        // 不属于 mainPmx 子目录的文件（如其他 PMX 子目录的贴图）：
                        // 仅写 file:<裸stem> 扁平键（跨模型兜底），不写 dir: 命名空间键避免污染。
                    }
                    baseNames.push(baseName);
                }
                // outfits.json → outfit:<enc(zipStem/pmxStem)>（伴生换装配置）
                // [bugfix:zip-pmx-subdir] 仅当与 PMX 同子目录时写入，避免其他 PMX 子目录的 outfits.json 污染。
                if (baseName.toLowerCase() === 'outfits.json' && nsStem) {
                    if (!pmxPrefix || relPath.startsWith(pmxPrefix)) {
                        await idbSet('models', `outfit:${nsStem}`, bytes);
                    }
                }
                // scene.json → scenes store bundle:<zipStem>（LoadSceneFile bundle 路径）
                // scene.json 是 zip 级别的元数据，与 PMX 子目录无关，保持原逻辑全量写。
                if (baseName.toLowerCase() === 'scene.json' && zipStem) {
                    await idbSet('scenes', `bundle:${zipStem}`, bytes);
                }
            })
        );
        // [doc:adr-182] 返回 web://model/<nsStem> 而非裸 mainPmxName：
        // 裸名会落 _classifyPath 的 absolute 分支被 _baseName 吃掉命名空间前缀；
        // web://model/ 形式经 model-stem 分支透传，IsolateModelDir 幂等不再二次编码。
        return {
            file_path: nsStem ? `web://model/${nsStem}` : mainPmxName,
            dir: zipStem ? `web://bundle/${zipStem}` : '',
            cached: false,
        } as unknown as ExtractResult;
    },
    // [doc:adr-176] 对齐 Go 签名：SaveScreenshot(dir, filename, base64PNG)。
    // base64PNG 是 "data:image/png;base64,..." 或纯 base64，浏览器端转 Uint8Array 下载。
    async SaveScreenshot(_dir: string, filename: string, base64PNG: string): Promise<void> {
        const raw = base64PNG.includes(',') ? base64PNG.split(',')[1] : base64PNG;
        const bytes = _base64ToBytes(raw);
        const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `screenshot-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    },
    // [doc:adr-176] 对齐 Go 签名：SaveThumbnail(modelPath, base64PNG)。
    // modelPath 经 _resolveIdbKey 映射为 IndexedDB key，base64 → bytes 存储。
    async SaveThumbnail(modelPath: string, base64PNG: string): Promise<void> {
        const key = _resolveIdbKey(modelPath);
        const bytes = _base64ToBytes(base64PNG.includes(',') ? base64PNG.split(',')[1] : base64PNG);
        await idbSet('thumbnails', key, bytes);
    },
    // [doc:adr-176] 对齐 Go 签名：GetThumbnail(modelPath): string。
    // 读 IDB bytes → btoa → base64 string。无缩略图返回空串（对齐 Go 侧行为）。
    async GetThumbnail(modelPath: string): Promise<string> {
        const key = _resolveIdbKey(modelPath);
        const bytes = await idbGet<Uint8Array>('thumbnails', key);
        if (!bytes) return '';
        return _bytesToBase64(bytes);
    },
    // [doc:adr-177] 对齐 Go 契约（scene.go:38/65）：SaveLastScene(jsonStr) 单参、
    // LoadLastScene() 无参返回 string，单文件覆盖语义（Go 写 last_scene.json）。
    // 旧实现误用 (name, data) 双参，业务侧 SaveLastScene(json) 会把整段 JSON 当作
    // IndexedDB key、data 为 undefined，导致网页端自动保存静默失效、无法恢复。
    async SaveLastScene(jsonStr: string): Promise<void> {
        await idbSet('scenes', 'last_scene', jsonStr);
    },
    async LoadLastScene(): Promise<string> {
        return (await idbGet<string>('scenes', 'last_scene')) ?? '';
    },
    async GetCacheStats(): Promise<CacheStats> {
        // [doc:adr-177] 对齐 Go CacheStats 9 字段结构（settings-system.ts 面板据此渲染）。
        // 网页端无 serve/extracted 磁盘缓存目录，映射：
        //   resourceBytes ← models store（PMX/zip 原档 + dir: 纹理字节，占用量主体）
        //   thumbnailBytes ← thumbnails store
        //   extractedBytes ← caches store（ExtractZip 解压缓存，网页端通常为空）
        //   serveBytes     ← 0（网页端无静态服务目录）
        // 旧实现硬编码 size:0 且字段形状不符，导致面板显示 undefined。
        const scanStore = async (store: Store): Promise<{ bytes: number; count: number }> => {
            const keys = await idbKeys(store);
            let bytes = 0;
            let count = 0;
            for (const k of keys) {
                const v = await idbGet<unknown>(store, k);
                if (v instanceof Uint8Array) {
                    bytes += v.byteLength;
                    count++;
                }
            }
            return { bytes, count };
        };
        const [resource, thumb, extracted] = await Promise.all([
            scanStore('models'),
            scanStore('thumbnails'),
            scanStore('caches'),
        ]);
        return {
            extractedBytes: extracted.bytes,
            extractedCount: extracted.count,
            thumbnailBytes: thumb.bytes,
            thumbnailCount: thumb.count,
            serveBytes: 0,
            serveCount: 0,
            resourceBytes: resource.bytes,
            resourceCount: resource.count,
            totalBytes: resource.bytes + extracted.bytes + thumb.bytes,
        };
    },
    async ClearAllCaches(): Promise<void> {
        for (const k of await idbKeys('caches')) await idbDelete('caches', k);
    },
    async CleanOrphanCache(): Promise<void> {
        for (const k of await idbKeys('caches')) {
            const v = await idbGet('caches', k);
            if (!v) await idbDelete('caches', k);
        }
    },
    async ClearExtractCache(): Promise<void> {
        for (const k of await idbKeys('caches')) {
            if (k.startsWith('extract:')) await idbDelete('caches', k);
        }
    },
    async ClearThumbnailCache(): Promise<void> {
        for (const k of await idbKeys('thumbnails')) await idbDelete('thumbnails', k);
    },
    async GetAllTags(): Promise<string[]> {
        return (await idbGet<string[]>('tags', 'all')) ?? [];
    },
    // [doc:adr-176] 对齐 Go 签名：AddTag(libraryRef, tag)。
    // 维护全局标签列表 + 模型→标签映射 + 标签→模型映射。
    async AddTag(libraryRef: string, tag: string): Promise<void> {
        const all = (await idbGet<string[]>('tags', 'all')) ?? [];
        if (!all.includes(tag)) {
            all.push(tag);
            await idbSet('tags', 'all', all);
        }
        const modelTags = (await idbGet<string[]>('tags', `model:${libraryRef}`)) ?? [];
        if (!modelTags.includes(tag)) {
            modelTags.push(tag);
            await idbSet('tags', `model:${libraryRef}`, modelTags);
        }
        const tagModels = (await idbGet<string[]>('tags', `tag:${tag}`)) ?? [];
        if (!tagModels.includes(libraryRef)) {
            tagModels.push(libraryRef);
            await idbSet('tags', `tag:${tag}`, tagModels);
        }
    },
    // [doc:adr-176] 对齐 Go 签名：RemoveTag(libraryRef, tag)。
    async RemoveTag(libraryRef: string, tag: string): Promise<void> {
        const modelTags = (await idbGet<string[]>('tags', `model:${libraryRef}`)) ?? [];
        await idbSet(
            'tags',
            `model:${libraryRef}`,
            modelTags.filter((t) => t !== tag)
        );
        const tagModels = (await idbGet<string[]>('tags', `tag:${tag}`)) ?? [];
        const newTagModels = tagModels.filter((r) => r !== libraryRef);
        if (newTagModels.length === 0) {
            await idbDelete('tags', `tag:${tag}`);
            const all = (await idbGet<string[]>('tags', 'all')) ?? [];
            await idbSet(
                'tags',
                'all',
                all.filter((t) => t !== tag)
            );
        } else {
            await idbSet('tags', `tag:${tag}`, newTagModels);
        }
    },
    async GetTagsByModel(libraryRef: string): Promise<string[]> {
        return (await idbGet<string[]>('tags', `model:${libraryRef}`)) ?? [];
    },
    async GetModelsByTag(tag: string): Promise<string[]> {
        return (await idbGet<string[]>('tags', `tag:${tag}`)) ?? [];
    },
    // [doc:adr-176] 对齐 Go 签名：GetRecentModels(): string[] | null。
    // 返回 libraryRef 列表（非 ModelEntry[]）。
    async GetRecentModels(): Promise<string[]> {
        return (await idbGet<string[]>('models', 'recent')) ?? [];
    },
    // [doc:adr-176] 对齐 Go 签名：AddRecentModel(libraryRef: string)。
    async AddRecentModel(libraryRef: string): Promise<void> {
        const all = (await idbGet<string[]>('models', 'recent')) ?? [];
        const filtered = all.filter((r) => r !== libraryRef);
        filtered.unshift(libraryRef);
        await idbSet('models', 'recent', filtered.slice(0, 20));
    },
    async GetLibraryIndex(): Promise<ModelEntry[]> {
        return _listModels();
    },
    async GetModelMetaBatch(paths: string[]): Promise<Record<string, ModelMeta>> {
        // Web 模式下无法解析 PMX 文件头，返回空。
        // comment 由 loadActor 阶段通过 parsePmxComment 从 PMX 字节提取后填入缓存。
        return {};
    },
    // [doc:adr-176] 对齐 Go 签名：SaveModelPreset(jsonStr, path)。
    // path 推导 name（去扩展名），存 JSON string（Go 侧也是 string 传输）。
    async SaveModelPreset(jsonStr: string, path: string): Promise<void> {
        const name = _stripExt(_baseName(path)) || path;
        await idbSet('presets', `model:${name}`, jsonStr);
    },
    async GetModelPresets(): Promise<string[]> {
        return (await idbKeys('presets'))
            .filter((k) => k.startsWith('model:'))
            .map((k) => k.slice(6));
    },
    // [doc:adr-176] 对齐 Go 签名：LoadModelPreset(path): string。
    // path 推导 name，返回 JSON string。不存在返回空串（对齐 Go）。
    async LoadModelPreset(path: string): Promise<string> {
        const name = _stripExt(_baseName(path)) || path;
        return (await idbGet<string>('presets', `model:${name}`)) ?? '';
    },
    async LoadModelPresetFromLib(name: string): Promise<string> {
        return (await idbGet<string>('presets', `model:${name}`)) ?? '';
    },
    // [doc:adr-176] 对齐 Go 签名：SaveModelPresetToLibAuto(jsonStr): string。
    // 从 jsonStr 解析 name 字段（约定 name 字段），无则用时间戳。返回 name。
    async SaveModelPresetToLibAuto(jsonStr: string): Promise<string> {
        let name = `preset-${Date.now()}`;
        try {
            const parsed = JSON.parse(jsonStr) as { name?: string };
            if (parsed.name) name = parsed.name;
        } catch {
            /* 解析失败用默认名 */
        }
        await idbSet('presets', `model:${name}`, jsonStr);
        return name;
    },
    // [doc:adr-176] 对齐 Go 签名：SaveRenderPreset(name, params: string)。
    async SaveRenderPreset(name: string, params: string): Promise<void> {
        await idbSet('presets', `render:${name}`, params);
    },
    async GetRenderPresets(): Promise<RenderPreset[]> {
        const keys = (await idbKeys('presets')).filter((k) => k.startsWith('render:'));
        const out: RenderPreset[] = [];
        for (const k of keys) {
            const p = await idbGet<RenderPreset>('presets', k);
            if (p) out.push(p);
        }
        return out;
    },
    // [doc:adr-176] 对齐 Go 签名：SaveScenePreset(jsonStr): string。
    // 从 jsonStr 解析 name，返回 name。
    async SaveScenePreset(jsonStr: string): Promise<string> {
        let name = `scene-${Date.now()}`;
        try {
            const parsed = JSON.parse(jsonStr) as { name?: string };
            if (parsed.name) name = parsed.name;
        } catch {
            /* 解析失败用默认名 */
        }
        await idbSet('presets', `scene:${name}`, jsonStr);
        return name;
    },
    async GetPresetScenes(): Promise<string[]> {
        return (await idbKeys('presets'))
            .filter((k) => k.startsWith('scene:'))
            .map((k) => k.slice(6));
    },
    async GetPresetScenesDir(): Promise<string> {
        return 'web://presets/scenes';
    },
    // [doc:adr-176] 对齐 Go 签名：SaveEnvPresetAuto(jsonStr): string。
    async SaveEnvPresetAuto(jsonStr: string): Promise<string> {
        let name = `env-${Date.now()}`;
        try {
            const parsed = JSON.parse(jsonStr) as { name?: string };
            if (parsed.name) name = parsed.name;
        } catch {
            /* 解析失败用默认名 */
        }
        await idbSet('presets', `env:${name}`, jsonStr);
        return name;
    },
    async LoadEnvPreset(name: string): Promise<string> {
        return (await idbGet<string>('presets', `env:${name}`)) ?? '';
    },
    async ListEnvPresets(): Promise<string[]> {
        return (await idbKeys('presets'))
            .filter((k) => k.startsWith('env:'))
            .map((k) => k.slice(4));
    },
    async FileExists(path: string): Promise<boolean> {
        // [doc:adr-177] 经 _resolveIdbKey 映射，对齐 readFileBytes 路径语义
        const key = _resolveIdbKey(path);
        if ((await idbGet('models', key)) !== undefined) return true;
        const baseName = _baseName(path);
        if (baseName && baseName !== path) {
            return (await idbGet('models', `file:${baseName}`)) !== undefined;
        }
        return false;
    },
    // [doc:adr-177] 细粒度 UI setter：读当前 UIState → merge 单字段 → 写回。
    // 不能直接传 Partial 给 SetUIState（完整覆盖语义），需 merge 保留其他字段。
    async SetUIAccent(v: string): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, accent: v });
    },
    async SetUIAnimations(v: boolean): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, animations: v });
    },
    async SetUIAutoUpdate(v: boolean): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, autoUpdateEnabled: v });
    },
    async SetUIBlurBg(v: boolean): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, blurBg: v });
    },
    async SetUIFontFamily(v: string): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, fontFamily: v });
    },
    async SetUIPopupWidth(v: number): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, popupWidth: v });
    },
    async SetUIScale(v: number): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, scale: v });
    },
    // [doc:adr-176] 对齐 Go 签名：SetPerformanceMode(mode: string)。
    async SetPerformanceMode(v: string): Promise<void> {
        const cur = await this.GetUIState();
        await this.SetUIState({ ...cur, performanceMode: v });
    },
    async GetDownloadAutoImport(): Promise<boolean> {
        return (await idbGet<boolean>('config', 'dl.autoImport')) ?? false;
    },
    async SetDownloadAutoImport(v: boolean): Promise<void> {
        await idbSet('config', 'dl.autoImport', v);
    },
    async GetDownloadWatchEnabled(): Promise<boolean> {
        return (await idbGet<boolean>('config', 'dl.watchEnabled')) ?? false;
    },
    async SetDownloadWatchEnabled(v: boolean): Promise<void> {
        await idbSet('config', 'dl.watchEnabled', v);
    },
    // [doc:adr-176] 对齐 Go 签名：GetDownloadWatchStatus(): string。
    // 返回 JSON string（Go 侧也是 string）。
    async GetDownloadWatchStatus(): Promise<string> {
        const v = await idbGet<Record<string, unknown>>('config', 'dl.watchStatus');
        return v ? JSON.stringify(v) : '';
    },
    // [doc:adr-176] 对齐 Go 签名：SetLastBrowseDir(category, dir)。
    // 按 category 分键存储，对齐 Go 侧按类别持久化。
    async SetLastBrowseDir(category: string, dir: string): Promise<void> {
        await idbSet('config', `lastBrowseDir:${category}`, dir);
    },
    async GetLastBrowseDir(category: string): Promise<string> {
        return (await idbGet<string>('config', `lastBrowseDir:${category}`)) ?? '';
    },
    // [doc:adr-177] Config 级 setter 委托 SetConfig → 写入 'config' key 下完整对象，
    // 对齐恢复侧 GetConfig() 读取路径。旧实现写独立 key，GetConfig 读不到。
    async SetBlenderPath(p: string): Promise<void> {
        await this.SetConfig({ blender_path: p } as Partial<Config>);
    },
    async SetMMDPath(p: string): Promise<void> {
        await this.SetConfig({ mmd_path: p } as Partial<Config>);
    },
    // [doc:adr-177] 对齐 Go 签名 SetOverridePath(category, path) 双参。
    // 旧实现误用单参 (p)，业务侧 SetOverridePath(category, dir) 的 dir 丢失。
    async SetOverridePath(category: string, path: string): Promise<void> {
        const cfg = await this.GetConfig();
        const override_paths = { ...(cfg.override_paths ?? {}), [category]: path };
        await this.SetConfig({ override_paths } as Partial<Config>);
    },
    // [doc:adr-177] 写入 Config.resource_root 字段（对齐主应用 initLibrary 读取路径 cfg.resource_root）
    // 原实现写 config.resourceRoot 独立键，GetConfig 读不到，导致浏览器侧设置根目录后无法持久化恢复
    async SetResourceRoot(p: string): Promise<void> {
        const cfg = (await idbGet<Config>('config', 'config')) ?? _defaultConfig();
        await idbSet('config', 'config', { ...cfg, resource_root: p });
    },
    async SetDisplayNamePriority(v: string): Promise<void> {
        await this.SetConfig({ display_name_priority: v } as Partial<Config>);
    },
    async ReadTextFile(path: string): Promise<string | null> {
        // [doc:adr-177] 经 _resolveIdbKey 映射（场景存档 JSON / outfit JSON 等）
        const key = _resolveIdbKey(path);
        const bytes = await idbGet<Uint8Array>('models', key);
        if (bytes) return new TextDecoder().decode(bytes);
        // 兜底：尝试完整文件名
        const baseName = _baseName(path);
        if (baseName && baseName !== path) {
            const alt = await idbGet<Uint8Array>('models', `file:${baseName}`);
            if (alt) return new TextDecoder().decode(alt);
        }
        return null;
    },
    async WriteTextFile(path: string, content: string): Promise<void> {
        const key = _resolveIdbKey(path);
        await idbSet('models', key, new TextEncoder().encode(content));
    },
    // [doc:adr-176] 对齐 Go 签名：ImportLocalFile(path): ExtractResult | null。
    // 浏览器侧：path 是已写入 IDB 的文件路径，委托 ExtractZip 处理 zip/资源。
    async ImportLocalFile(path: string): Promise<ExtractResult | null> {
        return this.ExtractZip(path, '');
    },
    async ImportZip(zipPath: string): Promise<ExtractResult | null> {
        // [doc:adr-177] 对齐 Go 签名（zipPath），内部委托 ExtractZip
        return this.ExtractZip(zipPath, '');
    },

    // —— PlazaGo* 系列（①，网页内 iframe 可控）——
    async PlazaGoBack(): Promise<void> {
        history.back();
    },
    async PlazaGoForward(): Promise<void> {
        history.forward();
    },
    async PlazaReload(): Promise<void> {
        location.reload();
    },
    async PlazaZoomIn(): Promise<void> {
        /* 缩放由广场内部处理，浏览器侧无全局 hook */
    },
    async PlazaZoomOut(): Promise<void> {
        /* 同上 */
    },
    async PlazaZoomReset(): Promise<void> {
        /* 同上 */
    },

    // [doc:adr-176] 对齐 Go 签名：BundleScene(targetPath, sceneJSON, assetPaths): void。
    // 浏览器侧：用 JSZip 打包 scene.json + 资源字节，触发下载到 targetPath。
    async BundleScene(
        _targetPath: string,
        sceneJSON: string,
        assetPaths: string[] | null
    ): Promise<void> {
        const zip = new JSZip();
        zip.file('scene.json', sceneJSON);
        if (assetPaths) {
            for (const p of assetPaths) {
                const bytes = await this.readFileBytes(p);
                if (bytes) zip.file(_baseName(p), bytes);
            }
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scene-bundle.zip';
        a.click();
        URL.revokeObjectURL(url);
    },
    // [doc:adr-177] Delete*Preset 从 no-op 改为真实删除（idbDelete）
    async DeleteEnvPreset(name: string): Promise<void> {
        await idbDelete('presets', `env:${name}`);
    },
    async DeleteModelPreset(name: string): Promise<void> {
        await idbDelete('presets', `model:${name}`);
    },
    async DeletePresetScene(name: string): Promise<void> {
        await idbDelete('presets', `scene:${name}`);
    },
    async IsolateModelDir(pmxPath: string): Promise<string> {
        // [doc:adr-177] 浏览器侧无真实目录，返回虚拟目录 web://model/<encStem>，
        // 供 ListDirRecursive 扫描 dir:<encStem>: 前缀 + readFileBytes 透明路由。
        // encStem = encodeURIComponent(stem)，使不同目录同名 PMX 的纹理键互不碰撞
        // （[bugfix:tex-stem-collision]）。
        //
        // [doc:adr-182] 幂等：输入若已是 web://model/<encStem>（model-stem 或 model-dir，
        // 可能带 relPath），stem 已编码，直接原样返回，避免二次 encodeURIComponent 造成
        // 双重编码（A%2Fmiku → A%252Fmiku）或 model-dir 全路径二次编码致 ListDirRecursive
        // 前缀失配。正则捕获整段 path（含可选 /rest），匹配即视为已编码、原样返回。
        const already = pmxPath.match(/^web:\/\/model\/([^/?#]+)(?:\/(.+))?$/);
        if (already) return pmxPath;
        return `web://model/${_encModelStem(_extractStem(pmxPath))}`;
    },
    async ListDirRecursive(dirPath: string): Promise<FileInfo[]> {
        // [doc:adr-177] 浏览器侧：从虚拟目录 web://model/<stem> 提取 stem，
        // 扫描 models store 的 dir:<stem>:<relativePath> 前缀，重建目录条目。
        // 调用方据 entry.relativePath 再 readFileBytes(modelDir + '/' + relativePath) 读字节。
        const stem = _extractStem(dirPath);
        const prefix = `dir:${stem}:`;
        const allKeys = await idbKeys('models');

        // 第一轮：精确前缀匹配（ZIP 解压、单文件导入场景）
        let matchedPrefix = prefix;
        let keys = allKeys.filter((k) => k.startsWith(prefix));

        // 第二轮：bare stem fallback（FSA 扫描场景，路径含类别前缀如 web://model/分类1/Miku）
        // _classifyPath 的 regex 只取第一个 / 前的段作为 stem，需从原始路径提取完整段
        if (keys.length === 0) {
            const modelMatch = dirPath.match(/^web:\/\/model\/(.+)$/);
            const fullSegment = modelMatch?.[1] ?? '';
            if (fullSegment.includes('/')) {
                const bareStem = fullSegment.split('/').pop()!;
                matchedPrefix = `dir:${bareStem}:`;
                keys = allKeys.filter((k) => k.startsWith(matchedPrefix));
            }
        }

        return keys.map((k) => {
            const relativePath = k.slice(matchedPrefix.length);
            const name = relativePath.split('/').pop() ?? relativePath;
            return { name, relativePath } as FileInfo;
        });
    },
    async ListSubDirs(_dirPath: string): Promise<string[]> {
        // 浏览器侧无子目录概念，返回空（outfit 自动发现 fallback 无可用子目录）
        return [];
    },
    async LoadOutfitFile(pmxPath: string): Promise<string> {
        // [doc:adr-177] 读 outfits.json（ExtractZip 解压时存入 outfit:<stem>）
        // 对齐 Go：文件不存在返回 ("", nil)，调用方 fall through 到自动发现
        const stem = _extractStem(pmxPath);
        const bytes = await idbGet<Uint8Array>('models', `outfit:${stem}`);
        return bytes ? new TextDecoder().decode(bytes) : '';
    },
    async LoadSceneFile(path: string): Promise<string> {
        // [doc:adr-177] 三路路由：
        // 1. 预设场景 web://presets/scenes/<name> → presets store scene:<name>
        // 2. bundle 场景 web://bundle/<stem>/scene.json → scenes store bundle:<stem>
        // 3. 兜底：_resolveIdbKey 映射
        const presetMatch = path.match(/^web:\/\/presets\/scenes\/(.+)$/);
        if (presetMatch) {
            const bytes = await idbGet<Uint8Array>('presets', `scene:${presetMatch[1]}`);
            return bytes ? new TextDecoder().decode(bytes) : '';
        }
        const bundleMatch = path.match(/^web:\/\/bundle\/([^/]+)\/scene\.json$/);
        if (bundleMatch) {
            const bytes = await idbGet<Uint8Array>('scenes', `bundle:${bundleMatch[1]}`);
            return bytes ? new TextDecoder().decode(bytes) : '';
        }
        const key = _resolveIdbKey(path);
        const bytes = await idbGet<Uint8Array>('models', key);
        return bytes ? new TextDecoder().decode(bytes) : '';
    },
    // [doc:adr-195] 网页端扫描 IndexedDB 模型库（_listModels 读 entry: 前缀），非文件系统。
    // 返回的 entry.dir 为虚拟路径：扫描项 `web://selected-dir/...`，导入项 `web://model/...`。
    // Go 端扫描文件系统目录，返回真实路径。调用方应通过 `backend.kind` 区分行为。
    async ScanModelDir(): Promise<ModelEntry[]> {
        // [doc:adr-180] 无内存句柄时尝试从 IndexedDB 恢复持久化句柄并自动重扫，
        // 使「已授权源」启动即自愈，无需用户手动重选目录。未授权 / 无句柄降级为只读现有 entry。
        if (!_fsaRootHandle) {
            const restored = await restoreFsaRootHandle();
            if (!restored) return _listModels();
            _fsaRootHandle = restored;
            console.info('[web-scan] ScanModelDir: 自动恢复持久化句柄并重扫');
        }
        await _scanRootGuarded();
        return _listModels();
    },

    // ============ ② File System Access API 对话框替代 ============
    // [doc:adr-177] SelectDir：浏览器端根目录设置入口。
    // 调用 showDirectoryPicker 获取句柄 → 保存到 _fsaRootHandle → 递归扫描写 IndexedDB。
    // 返回 'web://selected-dir' 作为虚拟根路径，供 SetResourceRoot 持久化。
    async SelectDir(): Promise<string> {
        const picker = (
            window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
        ).showDirectoryPicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectDir');
        // [doc:adr-183] 若扫描进行中，等其完成再让用户重选——避免 _clearScannedEntries
        // 清空正在进行的扫描写入。用户在 zip 展开慢时反复点击是常见误操作。
        if (_scanningPromise) {
            console.info('[web-scan] SelectDir: 等待当前扫描完成再允许重选');
            await _scanningPromise;
        }
        _fsaRootHandle = await picker();
        // [doc:adr-180] 持久化句柄，供下次启动无手势自动恢复（结构化克隆，IndexedDB 原生支持）。
        await idbSet('config', 'fsaRootHandle', _fsaRootHandle);
        console.info(`[web-scan] SelectDir: 用户选择目录 "${_fsaRootHandle.name}"，开始扫描...`);
        await _scanRootGuarded();
        console.info('[web-scan] SelectDir: 扫描完成');
        return 'web://selected-dir';
    },
    async SelectImportFile(): Promise<string> {
        // [doc:adr-177] 浏览器侧真实实现：弹出文件选择器 → 读字节写入 IndexedDB，
        // 返回文件名（含扩展名）供 importFile() 按后缀分发。
        //
        // .pmx 特殊处理：多选模式，用户一次选 PMX + 同目录纹理文件。
        // 纹理写入 dir:<stem>:<filename>，使 collectTextureFiles 能扫描到伴生纹理，
        // 避免 babylon-mmd 因 referenceFiles 为空 fallback 到 HTTP 404。
        // 先试单文件选择（兼容不支持多选的浏览器）
        const single = await _pickFile();
        if (!single) return '';
        const singleFile = await single.getFile();
        const singleLower = singleFile.name.toLowerCase();
        if (singleLower.endsWith('.pmx')) {
            // 多选：让用户 Ctrl+选同目录的纹理文件
            const handles = await _pickFilesMultiple(true);
            if (!handles || handles.length === 0) {
                // 用户只选了 PMX 但没选纹理，降级：只写 PMX
                return await ingestModelFile(singleFile);
            }
            return await _writeModelWithTextures(singleFile, handles);
        }
        // .zip / .vmd / 不支持格式：走单文件路径
        const bytes = new Uint8Array(await singleFile.arrayBuffer());
        const stem = _stripExt(singleFile.name);
        await idbSet('models', `file:${stem}`, bytes);
        if (singleLower.endsWith('.zip')) {
            await idbSet('models', `entry:${stem}`, {
                name: stem,
                fileName: singleFile.name,
                kind: 'zip',
                size: bytes.byteLength,
                savedAt: Date.now(),
            });
        }
        return singleFile.name;
    },
    async SelectBundleSaveFile(): Promise<string> {
        const picker = (window as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> })
            .showSaveFilePicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectBundleSaveFile');
        await picker();
        return 'web://save';
    },
    async SelectExeFile(): Promise<string> {
        const h = await _pickFile('.exe');
        return h ? 'web://exe' : '';
    },
    async SelectPresetOpenFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://preset' : '';
    },
    async SelectPresetSaveFile(): Promise<string> {
        const picker = (window as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> })
            .showSaveFilePicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectPresetSaveFile');
        await picker();
        return 'web://preset-save';
    },
    async SelectRetargetFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://retarget' : '';
    },
    async SelectSceneOpenFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://scene' : '';
    },

    // ============ ③ 原生独占，显式降级（签名对齐 Go 接口） ============
    async AddCustomSoftware(_path: string, _name: string, _args: string): Promise<void> {
        throw new NotSupportedError('AddCustomSoftware');
    },
    async ClosePlazaWindow(): Promise<void> {
        throw new NotSupportedError('ClosePlazaWindow');
    },
    async DownloadFromPlaza(
        _fileURL: string,
        _fileName: string
    ): Promise<PlazaDownloadResult | null> {
        throw new NotSupportedError('DownloadFromPlaza');
    },
    // [doc:adr-177] 网页端实现：三源 fetch（raw → jsdelivr → GitHub API），对齐 Go 端 fetchPlazaRemote。
    // 拉到后返回原始 JSON 字符串；前端 updateBtn.onclick 会调 savePlazaCache 写入 plaza_cache.json。
    async FetchPlazaConfig(): Promise<[string, string]> {
        const [creators, sites] = await Promise.all([
            _fetchPlazaFile('creators.json'),
            _fetchPlazaFile('workshop_sites.json'),
        ]);
        return [creators, sites];
    },
    // [doc:adr-177] 网页端无 Go 风格 plaza-cache/ 目录；返回空串让 loadCachedConfig 跳过，
    // 由 ensureSitesLoaded 走 plaza_cache.json（savePlazaCache 写出）或硬编码兜底。
    async GetCachedPlazaConfig(): Promise<[string, string]> {
        return ['', ''];
    },
    async LaunchSoftware(_path: string, _args: string): Promise<void> {
        throw new NotSupportedError('LaunchSoftware');
    },
    async NavigatePlazaWindow(_targetURL: string, _direct: boolean): Promise<void> {
        throw new NotSupportedError('NavigatePlazaWindow');
    },
    async OpenCacheDir(_subDir: string): Promise<void> {
        throw new NotSupportedError('OpenCacheDir');
    },
    async OpenScreenshotDir(): Promise<void> {
        throw new NotSupportedError('OpenScreenshotDir');
    },
    async OpenWithSoftware(
        _modelPath: string,
        _softwarePath: string,
        _args: string
    ): Promise<void> {
        throw new NotSupportedError('OpenWithSoftware');
    },
    async RemoveCustomSoftware(_path: string): Promise<void> {
        throw new NotSupportedError('RemoveCustomSoftware');
    },
    async ScanSoftwareDir(): Promise<SoftwareEntry[] | null> {
        throw new NotSupportedError('ScanSoftwareDir');
    },
    async SetDownloadWatchDir(_dir: string): Promise<void> {
        throw new NotSupportedError('SetDownloadWatchDir');
    },
    async StartFileServer(_dirPath: string): Promise<number> {
        throw new NotSupportedError('StartFileServer');
    },
    async StartProxy(_target: string, _mode: string): Promise<string> {
        throw new NotSupportedError('StartProxy');
    },
    async StopProxy(): Promise<void> {
        throw new NotSupportedError('StopProxy');
    },
    async UpdateCustomSoftware(_path: string, _name: string, _args: string): Promise<void> {
        throw new NotSupportedError('UpdateCustomSoftware');
    },
    // [doc:adr-176] 注：返回 Promise 而非 CancellablePromise（Wails 专属类型），
    // 运行时调用方仅 await，不调 cancel/cancelOn。签名（参数）已对齐 Go 接口。
    // 双重断言保留，因 CancellablePromise vs Promise 差异是 Wails 类型固有问题。
} as unknown as BackendService;
