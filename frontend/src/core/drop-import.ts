// [doc:adr-177] 拖拽导入纯逻辑层 — 从 events.ts 拆分
//
// 职责：将 dropped File / 路径落地为模型/动作加载请求。
// 不含 DOM 事件注册（dragenter/dragover/drop 监听仍在 events.ts initDropHandler），
// 只暴露纯异步函数，便于单测 mock 依赖后验证浏览器分支语义。
//
// 拆分动机：events.ts 重依赖 DOM/scene/menus 模块，直接测 handleDroppedFile 需 mock
// 20+ 模块；本模块仅依赖 8 个数据/状态模块，单测成本可控。
//
// 路径语义对齐（ADR-177 Phase 2 A4）：
// - 桌面：File.path 绝对路径 → handleDropFile(path) → Go ImportZip/loadManager
// - 浏览器：File 无 path → 读 arrayBuffer → idbSet('models', 'file:<name>') →
//   handleDropFile(name) → ExtractZip 读 IndexedDB 解压 / loadManager 读 IndexedDB
import { loadManager } from './load-manager';
import { ImportZip, ExtractZip } from './wails-bindings';
import { idbSet, saveModel } from './backend/idb';
import { setStatus, formatError } from './config';
import { t } from './i18n/t';
import { safeCallAsync } from './safe-call';
import { refreshLibrary } from '../menus/library';

/**
 * 处理已落地的路径（桌面绝对路径或浏览器 IndexedDB 键）。
 *
 * - zip + zipBytes：浏览器分支，ExtractZip 读 IndexedDB 解压并返回主 PMX 路径
 * - zip 无 bytes：桌面分支，ImportZip 由 Go 落盘后调用方另行触发加载
 * - pmx：loadManager.load(actor)
 * - vmd：loadManager.load(vmd)
 */
export async function handleDropFile(path: string, zipBytes?: Uint8Array): Promise<void> {
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) {
        setStatus(t('main.importingZip'), false);
        try {
            // [doc:adr-177] 浏览器侧 ExtractZip 内部读 IndexedDB file:<zipStem>、解压、
            // 落地内部文件到 file:<stem>，返回主 PMX 路径；桌面侧 ImportZip(path) 由 Go 落盘。
            if (zipBytes !== undefined) {
                const result = await ExtractZip(path, '');
                if (result?.file_path) {
                    await loadManager.load({ kind: 'actor', path: result.file_path });
                }
            } else {
                await ImportZip(path);
            }
            setStatus(t('main.zipImported'), true);
            await safeCallAsync('drop-import', 'refresh after drop', () => refreshLibrary());
        } catch (err) {
            setStatus(t('main.importFailedDetail') + formatError(err), false);
            console.error('ImportZip failed:', err);
        }
    } else if (lower.endsWith('.pmx')) {
        setStatus(t('main.loadingModel'), false);
        try {
            await loadManager.load({ kind: 'actor', path });
        } catch (err) {
            setStatus(t('main.modelLoadFailed') + formatError(err), false);
            console.error('loadManager actor failed:', err);
        }
    } else if (lower.endsWith('.vmd')) {
        setStatus(t('main.loadingMotion'), false);
        try {
            await loadManager.load({ kind: 'vmd', path });
        } catch (err) {
            setStatus(t('main.vmdLoadFailed') + formatError(err), false);
            console.error('loadManager vmd failed:', err);
        }
    }
}

/**
 * [doc:adr-177] 单个拖入文件落地：桌面走原生 path，浏览器读字节写 IndexedDB。
 *
 * 浏览器侧 File 对象无 path 属性（Wails desktop 才注入），故读 file.arrayBuffer()
 * 写入 models store 的 file:<name>；pmx/zip 额外写 entry:<name> 让 web-loader
 * 模型库可见，vmd 不进模型库（动作文件非库条目）。
 */
export async function handleDroppedFile(file: File): Promise<void> {
    // Desktop：Wails 在 File 上注入 path（绝对路径），直接走原生导入
    const desktopPath = (file as File & { path?: string }).path;
    if (desktopPath) {
        await handleDropFile(desktopPath);
        return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.zip') && !lower.endsWith('.pmx') && !lower.endsWith('.vmd')) {
        return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (lower.endsWith('.zip')) {
        // zip 整体写入 entry（模型库可见），内部文件由 ExtractZip 落地
        await saveModel(file.name, bytes, 'zip');
        await handleDropFile(file.name, bytes);
        return;
    }
    // pmx/vmd：落地 file:<name>
    const name = file.name.replace(/\.(pmx|vmd)$/i, '');
    await idbSet('models', `file:${name}`, bytes);
    if (lower.endsWith('.pmx')) {
        await saveModel(file.name, bytes, 'pmx');
    }
    await handleDropFile(file.name);
}
