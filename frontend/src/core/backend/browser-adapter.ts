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
} from '@bindings/mikumikuar/internal/app/models';
import { NotSupportedError } from './types';
import type { BackendService, BackendCapabilities } from './types';
import { idbGet, idbSet, idbDelete, idbKeys, closeIDB } from './idb';

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
 * [doc:adr-177] 将主应用传入的路径映射为 IndexedDB key。
 *
 * 主应用模型加载器传绝对路径（如 `D:/models/foo.pmx`），但 IndexedDB 的 models store
 * 用 `file:<name>` 键规约存储原档字节（web-loader/library.ts:saveModel 写入）。
 * 本函数做透明映射，使主应用 readFileBytes('D:/models/foo.pmx') 能命中 file:foo。
 *
 * 映射规则：
 * 1. `web://model/<stem>/<relativePath>` → `dir:<stem>:<relativePath>`（虚拟目录资源）
 * 2. 已是 IDB key 前缀（file:/entry:/recent/dir:/outfit:）→ 原样返回
 * 3. 其他 `web://` / `content://` 虚拟 URI → 原样返回
 * 4. 绝对路径 → 提取文件名 → 去扩展名 → `file:<name>`
 *
 * 注意：同名文件（不同目录）会冲突——这是 IndexedDB 扁平键的既有设计限制。
 */
function _resolveIdbKey(path: string): string {
    // 虚拟目录资源：web://model/<stem>/<relativePath> → dir:<stem>:<relativePath>
    const dirMatch = path.match(/^web:\/\/model\/([^/?#]+)\/(.+)$/);
    if (dirMatch) {
        return `dir:${dirMatch[1]}:${dirMatch[2].replace(/\\/g, '/')}`;
    }
    // 已是 IDB key 前缀
    if (/^(file|entry|recent|dir|outfit):/.test(path) || path === 'recent') {
        return path;
    }
    // Android SAF URI / 其他 web:// 虚拟 URI 原样返回（browser-adapter 不支持，但避免误转换）
    if (path.startsWith('content://') || path.startsWith('web://')) {
        return path;
    }
    // 绝对路径 → 提取文件名（去扩展名）
    const baseName = path.split(/[/\\]/).pop() || path;
    const name = baseName.replace(/\.(pmx|zip|vmd|vpd|png|jpg|jpeg|bmp|tga|dds|tif|tiff|wav|mp3|ogg|flac|json)$/i, '');
    return `file:${name}`;
}

/**
 * [doc:adr-177] 从路径提取模型 stem（去扩展名的文件名）。
 *
 * 用于 IsolateModelDir / LoadOutfitFile / ListDirRecursive 等需要按模型 stem
 * 索引 IndexedDB 的方法。支持多种输入格式：
 * - `web://model/<stem>` 或 `web://model/<stem>/<relativePath>` → 取 <stem>
 * - `file:<stem>` / `entry:<stem>` → 取 <stem>
 * - 绝对路径（`D:/models/foo.pmx`）→ 文件名去扩展名
 */
function _extractStem(path: string): string {
    const m = path.match(/^web:\/\/model\/([^/?#]+)/);
    if (m) return m[1];
    const m2 = path.match(/^(?:file|entry):(.+)$/);
    if (m2) return m2[1];
    const baseName = path.split(/[/\\]/).pop() || path;
    return baseName.replace(/\.[^.]+$/, '');
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
    const stem = file.name.replace(/\.(zip|pmx|vmd)$/i, '');
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
    const pmxStem = pmxFile.name.replace(/\.pmx$/i, '');
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

const _SUPPORTED_EXTS_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|x|vpd|zip)$/i;

/** FSA 目录递归扫描：保留目录结构，按目录约定分类（对齐桌面端） */
async function _scanDirIntoIDB(
    dirHandle: FileSystemDirectoryHandle,
    relPath = '',
    parentPmxStems: string[] = []
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

    // 本层 PMX stem 列表（用于纹理关联）
    const pmxStems = files
        .filter((f) => /\.pmx$/i.test(f.name))
        .map((f) => f.name.replace(/\.pmx$/i, ''));
    // 合并父层 PMX stem：子目录纹理关联到最近的祖先 PMX
    const effectivePmxStems = pmxStems.length > 0 ? pmxStems : parentPmxStems;
    const TEXTURE_EXT = /\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i;
    const textureFiles = files.filter((f) => TEXTURE_EXT.test(f.name));

    // 第二遍：逐个文件写入
    for (const { name, handle } of files) {
        const lower = name.toLowerCase();
        if (!_SUPPORTED_EXTS_RE.test(lower)) continue;
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const stem = name.replace(/\.(pmx|vmd|mp3|wav|ogg|flac|wma|x|vpd|zip)$/i, '');
        await idbSet('models', `file:${stem}`, bytes);

        // 分类：目录约定优先，扩展名兜底
        const ext = lower.split('.').pop() || '';
        let type: string, format: string, virtualDir: string;
        if (byDir) {
            type = byDir.type;
            format = byDir.format;
            virtualDir = `web://selected-dir/${relPath}`;
        } else {
            const byExt = _CATEGORY_BY_EXT[ext];
            type = byExt?.type ?? 'actor';
            format = byExt?.format ?? ext;
            virtualDir = byExt
                ? `web://selected-dir/${byExt.subdir}`
                : relPath ? `web://selected-dir/${relPath}` : 'web://selected-dir';
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
                        const innerBase = innerPath.split(/[/\\]/).pop() || innerPath;
                        const innerExt = innerBase.toLowerCase().split('.').pop() || '';
                        const innerStem = innerBase.replace(/\.[^.]+$/, '');
                        const innerByExt = _CATEGORY_BY_EXT[innerExt];
                        const innerType = byDir ? byDir.type : (innerByExt?.type ?? 'actor');
                        const innerFormat = innerByExt?.format ?? innerExt;
                        // entry key 需唯一：zipStem + 内部路径（去斜杠）
                        const entryKey = `${stem}__${innerPath.replace(/[/\\]/g, '_')}`;
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
                    await idbSet('models', `entry:${stem}`, {
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
                await idbSet('models', `entry:${stem}`, {
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
            await idbSet('models', `entry:${stem}`, {
                dir: virtualDir,
                file_path: `${virtualDir}/${name}`,
                name_jp: stem, name_en: stem,
                comment: '', has_thumb: false,
                type, format,
                container: 'file', zip_inner: '', category: '', source: '',
                name: stem, fileName: name, kind: format,
                size: bytes.byteLength, savedAt: Date.now(),
            });
            console.info(`[web-scan]   写入 entry:${stem} → dir=${virtualDir} type=${type} format=${format}`);
        }
    }

    // 第三遍：为本层的每个 PMX 写入同目录纹理引用
    // [bugfix:texture-subdir] 使用 effectivePmxStems（含父层），
    // 使子目录纹理（如 tex/face.png）也能关联到父目录的 PMX。
    if (effectivePmxStems.length > 0 && textureFiles.length > 0) {
        for (const { name, handle } of textureFiles) {
            const file = await handle.getFile();
            const texBytes = new Uint8Array(await file.arrayBuffer());
            for (const stem of effectivePmxStems) {
                await idbSet('models', `dir:${stem}:${name}`, texBytes);
            }
        }
        console.info(`[web-scan]   纹理关联: ${textureFiles.length} 个纹理 → PMX [${effectivePmxStems.join(', ')}]`);
    }

    // 递归子目录（传递本层 PMX stem，使子目录纹理能关联到祖先 PMX）
    for (const dirName of subDirs) {
        const subHandle = await dir.getDirectoryHandle(dirName);
        const subRelPath = relPath ? `${relPath}/${dirName}` : dirName;
        await _scanDirIntoIDB(subHandle, subRelPath, effectivePmxStems);
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
        // 兜底：dir:<stem>:<relPath> 未命中时，按 ExtractZip 扁平键 file:<stem>（去扩展名）再查一次
        const baseName = path.split(/[/\\]/).pop() || path;
        if (baseName && baseName !== path) {
            const stem = baseName.replace(/\.[^.]+$/, '');
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
    async SetUIState(s: Partial<UIState>): Promise<void> {
        // [doc:adr-177] 双写：Config.ui_state（主应用读）+ uistate store（向后兼容）
        const cfg = await this.GetConfig();
        const merged = { ...(cfg.ui_state ?? _defaultUIState()), ...s };
        await this.SetConfig({ ui_state: merged } as Partial<Config>);
        await idbSet('uistate', 'state', merged);
    },
    async SetEnvState(s: Partial<EnvState>): Promise<void> {
        // [doc:adr-177] 单源：写入 Config.env（对齐主应用 restoreEnvState 读取路径）
        // 旧实现写 uistate/envState，与主应用 cfg.env 读取路径不一致，导致浏览器侧保存的环境状态无法恢复
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
                mainPmxName = target.split(/[/\\]/).pop() || target;
                mainPmxStem = mainPmxName.replace(/\.[^.]+$/, '');
            }
        }
        if (!mainPmxName) {
            for (const name of fileNames) {
                const baseName = name.split(/[/\\]/).pop() || name;
                if (/\.pmx$/i.test(baseName)) {
                    mainPmxName = baseName;
                    mainPmxStem = baseName.replace(/\.pmx$/i, '');
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
                const baseName = name.split(/[/\\]/).pop() || name;
                const stem = baseName.replace(/\.[^.]+$/, '');
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
    async SaveScreenshot(data: Uint8Array): Promise<void> {
        const blob = new Blob([data as BlobPart], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screenshot-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    },
    async SaveThumbnail(name: string, data: Uint8Array): Promise<void> {
        await idbSet('thumbnails', name, data);
    },
    async GetThumbnail(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('thumbnails', name)) ?? null;
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
    async AddTag(tag: string): Promise<void> {
        const all = (await idbGet<string[]>('tags', 'all')) ?? [];
        if (!all.includes(tag)) all.push(tag);
        await idbSet('tags', 'all', all);
    },
    async RemoveTag(tag: string): Promise<void> {
        const all = (await idbGet<string[]>('tags', 'all')) ?? [];
        await idbSet('tags', 'all', all.filter((t) => t !== tag));
    },
    async GetTagsByModel(model: string): Promise<string[]> {
        return (await idbGet<string[]>(`tags`, `model:${model}`)) ?? [];
    },
    async GetModelsByTag(tag: string): Promise<string[]> {
        return (await idbGet<string[]>(`tags`, `tag:${tag}`)) ?? [];
    },
    async GetRecentModels(): Promise<ModelEntry[]> {
        return (await idbGet<ModelEntry[]>('models', 'recent')) ?? [];
    },
    async AddRecentModel(m: ModelEntry): Promise<void> {
        const all = (await idbGet<ModelEntry[]>('models', 'recent')) ?? [];
        all.unshift(m);
        await idbSet('models', 'recent', all.slice(0, 20));
    },
    async GetLibraryIndex(): Promise<ModelEntry[]> {
        return _listModels();
    },
    async GetModelMetaBatch(paths: string[]): Promise<Record<string, ModelMeta>> {
        // Web 模式下无法解析 PMX 文件头，返回空。
        // comment 由 loadActor 阶段通过 parsePmxComment 从 PMX 字节提取后填入缓存。
        return {};
    },
    async SaveModelPreset(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `model:${name}`, data);
    },
    async GetModelPresets(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('model:')).map((k) => k.slice(6));
    },
    async LoadModelPreset(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('presets', `model:${name}`)) ?? null;
    },
    async LoadModelPresetFromLib(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('presets', `model:${name}`)) ?? null;
    },
    async SaveModelPresetToLibAuto(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `model:${name}`, data);
    },
    async SaveRenderPreset(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `render:${name}`, data);
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
    async SaveScenePreset(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `scene:${name}`, data);
    },
    async GetPresetScenes(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('scene:')).map((k) => k.slice(6));
    },
    async GetPresetScenesDir(): Promise<string> {
        return 'web://presets/scenes';
    },
    async SaveEnvPresetAuto(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `env:${name}`, data);
    },
    async LoadEnvPreset(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('presets', `env:${name}`)) ?? null;
    },
    async ListEnvPresets(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('env:')).map((k) => k.slice(4));
    },
    async FileExists(path: string): Promise<boolean> {
        // [doc:adr-177] 经 _resolveIdbKey 映射，对齐 readFileBytes 路径语义
        const key = _resolveIdbKey(path);
        if ((await idbGet('models', key)) !== undefined) return true;
        const baseName = path.split(/[/\\]/).pop() || path;
        if (baseName && baseName !== path) {
            return (await idbGet('models', `file:${baseName}`)) !== undefined;
        }
        return false;
    },
    // [doc:adr-177] 细粒度 UI setter 统一委托 SetUIState → 写入 Config.ui_state，
    // 对齐恢复侧 restoreUIState() 的 GetConfig().ui_state 读取路径。
    // 旧实现写独立 key（ui.accent 等），GetConfig 读不到，导致网页端设置无法持久化。
    async SetUIAccent(v: string): Promise<void> {
        await this.SetUIState({ accent: v } as Partial<UIState>);
    },
    async SetUIAnimations(v: boolean): Promise<void> {
        await this.SetUIState({ animations: v } as Partial<UIState>);
    },
    async SetUIAutoUpdate(v: boolean): Promise<void> {
        await this.SetUIState({ autoUpdateEnabled: v } as Partial<UIState>);
    },
    async SetUIBlurBg(v: boolean): Promise<void> {
        await this.SetUIState({ blurBg: v } as Partial<UIState>);
    },
    async SetUIFontFamily(v: string): Promise<void> {
        await this.SetUIState({ fontFamily: v } as Partial<UIState>);
    },
    async SetUIPopupWidth(v: number): Promise<void> {
        await this.SetUIState({ popupWidth: v } as Partial<UIState>);
    },
    async SetUIScale(v: number): Promise<void> {
        await this.SetUIState({ scale: v } as Partial<UIState>);
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
    async GetDownloadWatchStatus(): Promise<Record<string, unknown>> {
        return (await idbGet('config', 'dl.watchStatus')) ?? {};
    },
    async SetLastBrowseDir(dir: string): Promise<void> {
        await idbSet('config', 'lastBrowseDir', dir);
    },
    async GetLastBrowseDir(): Promise<string> {
        return (await idbGet<string>('config', 'lastBrowseDir')) ?? '';
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
    // [doc:adr-177] 对齐 Go 签名 SetPerformanceMode(mode string)。
    // 旧实现误用 (v: boolean)，performanceMode 实际是字符串（'balanced' 等）。
    async SetPerformanceMode(v: string): Promise<void> {
        await this.SetUIState({ performanceMode: v } as Partial<UIState>);
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
        const baseName = path.split(/[/\\]/).pop() || path;
        if (baseName && baseName !== path) {
            const alt = await idbGet<Uint8Array>('models', `file:${baseName}`);
            if (alt) return new TextDecoder().decode(alt);
        }
        return null;
    },
    async ImportLocalFile(): Promise<ModelEntry[]> {
        return _listModels();
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

    // ============ ① 其余默认实现（返回合理默认，浏览器降级） ============
    async BundleScene(): Promise<Uint8Array> {
        return new Uint8Array();
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
        const keys = (await idbKeys('models')).filter((k) => k.startsWith(prefix));
        return keys.map((k) => {
            const relativePath = k.slice(prefix.length);
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
        const stem = singleFile.name.replace(/\.(zip|pmx|vmd)$/i, '');
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

    // ============ ③ 原生独占，显式降级 ============
    async AddCustomSoftware(): Promise<void> {
        throw new NotSupportedError('AddCustomSoftware');
    },
    async ClosePlazaWindow(): Promise<void> {
        throw new NotSupportedError('ClosePlazaWindow');
    },
    async DownloadFromPlaza(): Promise<void> {
        throw new NotSupportedError('DownloadFromPlaza');
    },
    async FetchPlazaConfig(): Promise<Uint8Array> {
        throw new NotSupportedError('FetchPlazaConfig');
    },
    async GetCachedPlazaConfig(): Promise<Uint8Array | null> {
        throw new NotSupportedError('GetCachedPlazaConfig');
    },
    async LaunchSoftware(): Promise<void> {
        throw new NotSupportedError('LaunchSoftware');
    },
    async NavigatePlazaWindow(): Promise<void> {
        throw new NotSupportedError('NavigatePlazaWindow');
    },
    async OpenCacheDir(): Promise<void> {
        throw new NotSupportedError('OpenCacheDir');
    },
    async OpenScreenshotDir(): Promise<void> {
        throw new NotSupportedError('OpenScreenshotDir');
    },
    async OpenWithSoftware(): Promise<void> {
        throw new NotSupportedError('OpenWithSoftware');
    },
    async RemoveCustomSoftware(): Promise<void> {
        throw new NotSupportedError('RemoveCustomSoftware');
    },
    async ScanSoftwareDir(): Promise<void> {
        throw new NotSupportedError('ScanSoftwareDir');
    },
    async SetDownloadWatchDir(): Promise<void> {
        throw new NotSupportedError('SetDownloadWatchDir');
    },
    async StartFileServer(): Promise<void> {
        throw new NotSupportedError('StartFileServer');
    },
    async StartProxy(): Promise<void> {
        throw new NotSupportedError('StartProxy');
    },
    async StopProxy(): Promise<void> {
        throw new NotSupportedError('StopProxy');
    },
    async UpdateCustomSoftware(): Promise<void> {
        throw new NotSupportedError('UpdateCustomSoftware');
    },
} as unknown as BackendService;
