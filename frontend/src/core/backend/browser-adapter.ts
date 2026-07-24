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
    UpdateCheckResult,
    RenderPreset,
    SoftwareEntry,
    PlazaDownloadResult,
} from '@bindings/mikumikuar/internal/app/models';
import { NotSupportedError } from './types';
import type { BackendService, BackendCapabilities } from './types';
import { idbGet, idbSet, idbDelete, idbKeys, closeIDB } from './idb';

// —— 路径工具函数（消除 6 处 "split + pop + replace" 重复）——

/** 提取路径最后一段文件名（兼容 / 和 \） */
function _baseName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
}

/** 去掉文件名最后一个扩展名段（如 `a.pmx` → `a`，`b.tar.gz` → `b.tar`） */
function _stripExt(name: string): string {
    return name.replace(/\.[^.]+$/, '');
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

// —— 资源配对（P4）——
if (
    typeof window !== 'undefined' &&
    typeof (window as { addEventListener?: unknown }).addEventListener === 'function'
) {
    (window as { addEventListener: (t: string, fn: () => void) => void }).addEventListener('beforeunload', () =>
        closeIDB()
    );
}

function _cap(): BackendCapabilities {
    const fsAccess =
        typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function' ||
        typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
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
    | { kind: 'model-dir'; stem: string; rest: string }   // web://model/<stem>/<relPath>（有 relPath）
    | { kind: 'model-stem'; stem: string }                // web://model/<stem>（无 relPath）
    | { kind: 'selected-dir'; stem: string }              // web://selected-dir/<catRelPath>
    | { kind: 'idb-key' }                                 // 已是 file:/entry:/recent/dir:/outfit: 前缀
    | { kind: 'virtual-uri' }                             // content:// 或其他 web://（Android SAF 等）
    | { kind: 'absolute'; stem: string };                 // 绝对路径 → baseName 去扩展名

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
    // 键规约（ADR-176 Phase 3，与 web-loader/library.ts 共享）：
    //   `entry:<name>` = 模型元数据；`file:<name>` = 原档字节；`recent` = 最近列表。
    // 仅列 entry: 前缀，避免把原档字节 / recent 数组误当 ModelEntry 返回。
    const allKeys = await idbKeys('models');
    const keys = allKeys.filter((k) => k.startsWith('entry:'));
    console.info(`[web-scan] _listModels: IDB 共 ${allKeys.length} 个键, 其中 entry: ${keys.length} 个`);
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
async function _pickFilesMultiple(
    acceptPmx: boolean
): Promise<FileSystemFileHandle[] | null> {
    const picker = (window as { showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (typeof picker !== 'function') return null;
    // .pmx 场景：多选模式让用户 Ctrl+选同目录的纹理
    // 需要同时支持 pmx + 纹理扩展名，但 FSA showOpenFilePicker 的 accept 是"或"语义，
    // 用 application/octet-stream 兜底接收所有文件，靠后缀在 SelectImportFile 内部分流
    const opts: Record<string, unknown> = { multiple: true };
    if (acceptPmx) {
        opts.types = [{
            description: 'Model files',
            accept: { 'application/octet-stream': ['.pmx', '.png', '.jpg', '.jpeg', '.bmp', '.tga', '.dds', '.tif', '.tiff'] }
        }];
    }
    return await picker(opts) ?? null;
}

async function _pickFile(accept?: string): Promise<FileSystemFileHandle | null> {
    const picker = (window as { showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (typeof picker !== 'function') return null;
    const handles = await picker(accept ? { types: [{ accept: { 'application/octet-stream': [accept] } }] } : undefined);
    return handles[0] ?? null;
}

/** 写入单个模型/动作文件到 IndexedDB，返回文件名。 */
async function _writeModelFile(file: File): Promise<string> {
    const lower = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stem = _stripExt(file.name);
    await idbSet('models', `file:${stem}`, bytes);
    if (lower.endsWith('.pmx')) {
        await idbSet('models', `entry:${stem}`, {
            name: stem, fileName: file.name, kind: 'pmx',
            size: bytes.byteLength, savedAt: Date.now(),
        });
    } else if (lower.endsWith('.zip')) {
        await idbSet('models', `entry:${stem}`, {
            name: stem, fileName: file.name, kind: 'zip',
            size: bytes.byteLength, savedAt: Date.now(),
        });
    }
    return file.name;
}

const TEXTURE_EXTS_RE = /\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i;

/** 写入 .pmx + 伴生纹理文件到 IndexedDB。
 *  PMX → file:<stem> + entry:<stem>
 *  纹理 → dir:<stem>:<filename>（供 collectTextureFiles / ListDirRecursive 扫描）
 */
async function _writeModelWithTextures(
    pmxFile: File,
    allHandles: FileSystemFileHandle[]
): Promise<string> {
    const pmxStem = _stripExt(pmxFile.name);
    // 先写 PMX
    const pmxBytes = new Uint8Array(await pmxFile.arrayBuffer());
    await idbSet('models', `file:${pmxStem}`, pmxBytes);
    await idbSet('models', `entry:${pmxStem}`, {
        name: pmxStem, fileName: pmxFile.name, kind: 'pmx',
        size: pmxBytes.byteLength, savedAt: Date.now(),
    });
    // 写纹理文件到 dir:<stem>:<filename>
    for (const handle of allHandles) {
        const f = await handle.getFile();
        if (!TEXTURE_EXTS_RE.test(f.name.toLowerCase())) continue;
        if (f.name === pmxFile.name) continue; // 跳过 PMX 本身
        const texBytes = new Uint8Array(await f.arrayBuffer());
        const dirKey = `dir:${pmxStem}:${f.name}`;
        await idbSet('models', dirKey, texBytes);
    }
    return pmxFile.name;
}

// [doc:adr-177] FSA 目录扫描：递归遍历 directory handle，将 .pmx/.zip 文件写入 IndexedDB。
// 键规约与 web-loader/library.ts saveModel 一致：file:<stem> + entry:<stem>
let _fsaRootHandle: FileSystemDirectoryHandle | null = null;

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
    'pmx':         { type: 'actor',       format: 'pmx' },
    'vmd':         { type: 'motion',      format: 'vmd' },
    'audio':       { type: 'audio',       format: 'audio' },
    'prop':        { type: 'prop',        format: 'pmx' },
    'stage':       { type: 'stage',       format: 'pmx' },
    'environment': { type: 'environment', format: 'environment' },
    'md-dress':    { type: 'outfit',      format: 'pmx' },
    'setting':     { type: 'setting',     format: 'setting' },
};

/** 扩展名兜底分类 + 虚拟子目录映射（扁平目录用，子目录名对齐 CATEGORY_DIR）*/
const _CATEGORY_BY_EXT: Record<string, { subdir: string; type: string; format: string }> = {
    'pmx':  { subdir: 'PMX',   type: 'actor',  format: 'pmx' },
    'vmd':  { subdir: 'VMD',   type: 'motion', format: 'vmd' },
    'mp3':  { subdir: 'audio', type: 'audio',  format: 'audio' },
    'wav':  { subdir: 'audio', type: 'audio',  format: 'audio' },
    'ogg':  { subdir: 'audio', type: 'audio',  format: 'audio' },
    'flac': { subdir: 'audio', type: 'audio',  format: 'audio' },
    'wma':  { subdir: 'audio', type: 'audio',  format: 'audio' },
    'x':    { subdir: 'stage', type: 'stage',  format: 'pmx' },
    'vpd':  { subdir: 'PMX',   type: 'pose',   format: 'vpd' },
    'zip':  { subdir: 'PMX',   type: 'actor',  format: 'zip' },
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

/** FSA 目录递归扫描：保留目录结构，按目录约定分类（对齐桌面端） */
async function _scanDirIntoIDB(
    dirHandle: FileSystemDirectoryHandle,
    relPath = '',
    parentPmx: { stem: string; relPath: string }[] = []
): Promise<void> {
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

    // 第二遍：逐个文件写入（纹理关联 + 资源写入合并为单遍，避免 files 数组二次迭代）
    for (const { name, handle } of files) {
        const lower = name.toLowerCase();

        // 纹理分支：关联到 effectivePmx（含子目录纹理，[p2b] 相对 PMX 路径）
        if (TEXTURE_EXTS_RE.test(lower)) {
            if (effectivePmx.length > 0) {
                const file = await handle.getFile();
                const texBytes = new Uint8Array(await file.arrayBuffer());
                for (const pmx of effectivePmx) {
                    const relToPmx = _relPathFrom(texRelIdCategory, pmx.relPath);
                    // bare stem 统一：剥离类别前缀，使 ListDirRecursive / readFileBytes 查询路径一致
                    const bareStem = pmx.stem.includes('/') ? pmx.stem.split('/').pop()! : pmx.stem;
                    const key = relToPmx ? `dir:${bareStem}:${relToPmx}/${name}` : `dir:${bareStem}:${name}`;
                    await idbSet('models', key, texBytes);
                }
                texLinkedCount++;
            }
            continue;
        }
        if (!_SUPPORTED_EXTS_RE.test(lower)) continue;
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
            try {
                const zip = await JSZip.loadAsync(bytes);
                const INNER_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|vpd)$/i;
                const innerFiles = Object.keys(zip.files).filter(
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
                            name_jp: innerStem, name_en: innerStem,
                            comment: '', has_thumb: false,
                            type: innerType, format: innerFormat,
                            container: 'zip', zip_inner: innerPath, category: '', source: '',
                            name: innerStem, fileName: innerBase, kind: innerFormat,
                            size: 0, savedAt: Date.now(),
                        });
                        console.info(`[web-scan]   展开 zip entry:${entryKey} → dir=${zipDir} inner=${innerPath} format=${innerFormat}`);
                    }
            } else {
                // zip 内无识别资源，作为整体 entry 保留
                await idbSet('models', `entry:${relIdStem}`, {
                    dir: virtualDir, file_path: `${virtualDir}/${name}`,
                        name_jp: stem, name_en: stem,
                        comment: '', has_thumb: false,
                        type, format: 'zip',
                        container: 'zip', zip_inner: '', category: '', source: '',
                        name: stem, fileName: name, kind: 'zip',
                        size: bytes.byteLength, savedAt: Date.now(),
                    });
                }
            } catch (zipErr) {
                // zip 解析失败（损坏/加密），作为整体 entry 保留
                console.warn(`[web-scan]   zip 解析失败: ${name}`, zipErr);
                await idbSet('models', `entry:${relIdStem}`, {
                    dir: virtualDir, file_path: `${virtualDir}/${name}`,
                    name_jp: stem, name_en: stem,
                    comment: '', has_thumb: false,
                    type, format: 'zip',
                    container: 'zip', zip_inner: '', category: '', source: '',
                    name: stem, fileName: name, kind: 'zip',
                    size: bytes.byteLength, savedAt: Date.now(),
                });
            }
        } else {
            await idbSet('models', `entry:${relIdStem}`, {
                dir: virtualDir,
                file_path: `${virtualDir}/${name}`,
                name_jp: stem, name_en: stem,
                comment: '', has_thumb: false,
                type, format,
                container: 'file', zip_inner: '', category: '', source: '',
                name: stem, fileName: name, kind: format,
                size: bytes.byteLength, savedAt: Date.now(),
            });
            console.info(`[web-scan]   写入 entry:${relIdStem} → dir=${virtualDir} type=${type} format=${format}`);
        }
    }

    if (texLinkedCount > 0) {
        console.info(`[web-scan]   纹理关联: ${texLinkedCount} 个纹理 → PMX [${effectivePmx.map((p) => _baseName(p.stem)).join(', ')}]`);
    }

    // 递归子目录（传递本层 PMX，使子目录纹理能按相对 PMX 路径关联祖先）
    for (const dirName of subDirs) {
        const subHandle = await dir.getDirectoryHandle(dirName);
        const subRelPath = relPath ? `${relPath}/${dirName}` : dirName;
        await _scanDirIntoIDB(subHandle, subRelPath, effectivePmx);
    }
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
    async GetStorageMode(): Promise<string> {
        return 'web';
    },
    async SetStorageMode(_mode: string): Promise<void> {
        // 浏览器固定 web 模式
    },
    async GetSystemA11ySettings(): Promise<Record<string, unknown>> {
        return (await idbGet<Record<string, unknown>>('config', 'a11y')) ?? {};
    },
    async GetBuildInfo(): Promise<Record<string, string>> {
        return { version: 'web', commit: 'web', date: new Date().toISOString() };
    },
    async CheckForUpdate(): Promise<UpdateCheckResult> {
        return {
            available: false,
            currentVersion: 'web',
            latestVersion: 'web',
            notes: '',
            url: '',
        } as unknown as UpdateCheckResult;
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
        const buf = await this.readFileBytes(zipPath);
        if (!buf) return null;
        const zip = await JSZip.loadAsync(buf);
        const ASSET_RE = /\.(pmx|vmd|vpd|png|jpg|jpeg|bmp|tga|dds|tif|tiff|wav|mp3|ogg|flac|glb)$/i;
        const fileNames = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
        // 第一遍：确定目标文件（优先使用 innerPath，兜底找第一个 PMX）
        let mainPmxName = '';
        let mainPmxStem = '';
        if (_innerPath) {
            // [bugfix:zip-innerpath] 多文件 zip 点击特定内部文件时，按 innerPath 定位
            const target = fileNames.find((n) => n === _innerPath || n.replace(/\\/g, '/') === _innerPath);
            if (target) {
                mainPmxName = _baseName(target);
                mainPmxStem = _stripExt(mainPmxName);
            }
        }
        if (!mainPmxName) {
            for (const name of fileNames) {
                const baseName = _baseName(name);
                if (/\.pmx$/i.test(baseName)) {
                    mainPmxName = baseName;
                    mainPmxStem = _stripExt(baseName);
                    break;
                }
            }
        }
        const zipStem = _extractStem(zipPath);
        // 第二遍：并发存资源（含 dir: / outfit: / bundle: 分类）
        const baseNames: string[] = [];
        await Promise.all(
            fileNames.map(async (name) => {
                const bytes = new Uint8Array(await zip.files[name].async('arraybuffer'));
                const baseName = _baseName(name);
                const stem = _stripExt(baseName);
                const relPath = name.replace(/\\/g, '/');
                if (ASSET_RE.test(baseName)) {
                    await idbSet('models', `file:${stem}`, bytes);
                    // 按主 PMX stem 存带目录结构的纹理（ListDirRecursive + readFileBytes 路由）
                    if (mainPmxStem) {
                        await idbSet('models', `dir:${mainPmxStem}:${relPath}`, bytes);
                    }
                    baseNames.push(baseName);
                }
                // outfits.json → outfit:<pmxStem>（伴生换装配置）
                if (baseName.toLowerCase() === 'outfits.json' && mainPmxStem) {
                    await idbSet('models', `outfit:${mainPmxStem}`, bytes);
                }
                // scene.json → scenes store bundle:<zipStem>（LoadSceneFile bundle 路径）
                if (baseName.toLowerCase() === 'scene.json' && zipStem) {
                    await idbSet('scenes', `bundle:${zipStem}`, bytes);
                }
            })
        );
        // 返回主 PMX + 虚拟 dir（LoadSceneFile bundle 路径 web://bundle/<zipStem>/scene.json）
        return {
            file_path: mainPmxName,
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
    async GetCacheStats(): Promise<{ count: number; size: number }> {
        const keys = await idbKeys('caches');
        return { count: keys.length, size: 0 };
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
        await idbSet('tags', `model:${libraryRef}`, modelTags.filter((t) => t !== tag));
        const tagModels = (await idbGet<string[]>('tags', `tag:${tag}`)) ?? [];
        const newTagModels = tagModels.filter((r) => r !== libraryRef);
        if (newTagModels.length === 0) {
            await idbDelete('tags', `tag:${tag}`);
            const all = (await idbGet<string[]>('tags', 'all')) ?? [];
            await idbSet('tags', 'all', all.filter((t) => t !== tag));
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
        return (await idbKeys('presets')).filter((k) => k.startsWith('model:')).map((k) => k.slice(6));
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
        } catch { /* 解析失败用默认名 */ }
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
        } catch { /* 解析失败用默认名 */ }
        await idbSet('presets', `scene:${name}`, jsonStr);
        return name;
    },
    async GetPresetScenes(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('scene:')).map((k) => k.slice(6));
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
        } catch { /* 解析失败用默认名 */ }
        await idbSet('presets', `env:${name}`, jsonStr);
        return name;
    },
    async LoadEnvPreset(name: string): Promise<string> {
        return (await idbGet<string>('presets', `env:${name}`)) ?? '';
    },
    async ListEnvPresets(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('env:')).map((k) => k.slice(4));
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
    async BundleScene(_targetPath: string, sceneJSON: string, assetPaths: string[] | null): Promise<void> {
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
        // [doc:adr-177] 浏览器侧无真实目录，返回虚拟目录 web://model/<stem>，
        // 供 ListDirRecursive 扫描 dir:<stem>: 前缀 + readFileBytes 透明路由
        return `web://model/${_extractStem(pmxPath)}`;
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
    async ScanModelDir(): Promise<ModelEntry[]> {
        return _listModels();
    },

    // ============ ② File System Access API 对话框替代 ============
    // [doc:adr-177] SelectDir：浏览器端根目录设置入口。
    // 调用 showDirectoryPicker 获取句柄 → 保存到 _fsaRootHandle → 递归扫描写 IndexedDB。
    // 返回 'web://selected-dir' 作为虚拟根路径，供 SetResourceRoot 持久化。
    async SelectDir(): Promise<string> {
        const picker = (window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectDir');
        _fsaRootHandle = await picker();
        console.info(`[web-scan] SelectDir: 用户选择目录 "${_fsaRootHandle.name}"，开始扫描...`);
        await _scanDirIntoIDB(_fsaRootHandle);
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
                return await _writeModelFile(singleFile);
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
        const picker = (window as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> }).showSaveFilePicker;
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
        const picker = (window as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> }).showSaveFilePicker;
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
    async DownloadFromPlaza(_fileURL: string, _fileName: string): Promise<PlazaDownloadResult | null> {
        throw new NotSupportedError('DownloadFromPlaza');
    },
    async FetchPlazaConfig(): Promise<[string, string]> {
        throw new NotSupportedError('FetchPlazaConfig');
    },
    async GetCachedPlazaConfig(): Promise<[string, string]> {
        throw new NotSupportedError('GetCachedPlazaConfig');
    },
    async LaunchSoftware(_path: string, _args: string): Promise<void> {
        throw new NotSupportedError('LaunchSoftware');
    },
    async NavigatePlazaWindow(_targetURL: string): Promise<void> {
        throw new NotSupportedError('NavigatePlazaWindow');
    },
    async OpenCacheDir(_subDir: string): Promise<void> {
        throw new NotSupportedError('OpenCacheDir');
    },
    async OpenScreenshotDir(): Promise<void> {
        throw new NotSupportedError('OpenScreenshotDir');
    },
    async OpenWithSoftware(_modelPath: string, _softwarePath: string, _args: string): Promise<void> {
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
