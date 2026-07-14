// [doc:architecture] Scene Bundle — 场景打包/解包
// 职责: 收集场景引用资源、重写 libraryRef、调用 Go 后端打包/解包
// 依赖: scene-serialize.ts + config.ts + wails bindings

import { libraryRoot, externalPaths, setStatus, setLibraryRoot } from '../core/config';
import { t } from '../core/i18n/t';
import {
    computeLibraryRef,
    resolveLibraryRef,
    getBaseName,
    normPath,
    deepClone,
} from '../core/utils';
import {
    serializeScene,
    deserializeScene,
    resolvePathFromRef,
    type SceneFile,
} from './scene-serialize';
import {
    BundleScene,
    SelectBundleSaveFile,
    ExtractZip,
    SelectSceneOpenFile,
    LoadSceneFile,
} from '../core/wails-bindings';

// ======== Asset Collection ========

/** 收集场景所有引用资源的绝对路径（去重）。 */
function collectSceneAssets(scene: SceneFile): string[] {
    const paths = new Set<string>();

    function add(filePath: string | undefined | null, libraryRef?: string) {
        if (!filePath && !libraryRef) {
            return;
        }
        const resolved = resolvePathFromRef(filePath ?? '', libraryRef);
        if (resolved) {
            paths.add(resolved);
        }
    }

    // Models (PMX)
    for (const m of scene.models) {
        add(m.filePath, m.libraryRef);
        // VMD per model
        add(m.vmdPath, m.vmdLibraryRef);
        // VMD layers
        if (m.vmdLayers) {
            for (const layer of m.vmdLayers) {
                add(layer.path);
            }
        }
    }

    // Camera VMD
    if (scene.cameraVmd) {
        add(scene.cameraVmd.path, scene.cameraVmd.libraryRef);
    }

    // Audio
    if (scene.audio) {
        add(scene.audio.path, scene.audio.libraryRef);
    }

    // Props
    if (scene.props) {
        for (const p of scene.props) {
            add(p.filePath, p.libraryRef);
        }
    }

    return Array.from(paths);
}

// ======== libraryRef Rewriting ========

/** 将 SceneFile 中的 libraryRef 重写为 bundle 内部路径。 */
function rewriteRefsForBundle(scene: SceneFile, libraryRoot: string): SceneFile {
    const rewritten = deepClone(scene);

    function rewritePath(
        filePath: string | undefined | null,
        libraryRef: string | undefined
    ): string | undefined {
        if (!filePath && !libraryRef) {
            return undefined;
        }

        // 尝试解析绝对路径
        const abs = resolvePathFromRef(filePath ?? '', libraryRef);
        if (!abs) {
            return undefined;
        }

        // 计算在 bundle assets/ 内的相对路径；库外文件回退为文件名（保留原 _bundleInternalPath 语义）
        const ref = computeLibraryRef(abs);
        return ref ?? getBaseName(abs);
    }

    // Models
    for (const m of rewritten.models) {
        const newRef = rewritePath(m.filePath, m.libraryRef);
        if (newRef) {
            m.libraryRef = newRef;
            m.filePath = ''; // 清除绝对路径，只保留 libraryRef
        }
        // VMD
        const vmdRef = rewritePath(m.vmdPath, m.vmdLibraryRef);
        if (vmdRef) {
            m.vmdLibraryRef = vmdRef;
            m.vmdPath = '';
        }
        // VMD layers — 没有 libraryRef，需要添加
        if (m.vmdLayers) {
            for (const layer of m.vmdLayers) {
                if (layer.path) {
                    const layerRef = rewritePath(layer.path, undefined);
                    if (layerRef) {
                        (layer as Record<string, unknown>).libraryRef = layerRef;
                        layer.path = '';
                    }
                }
            }
        }
    }

    // Camera VMD
    if (rewritten.cameraVmd) {
        const cvRef = rewritePath(rewritten.cameraVmd.path, rewritten.cameraVmd.libraryRef);
        if (cvRef) {
            rewritten.cameraVmd.libraryRef = cvRef;
            rewritten.cameraVmd.path = '';
        }
    }

    // Audio
    if (rewritten.audio) {
        const aRef = rewritePath(rewritten.audio.path, rewritten.audio.libraryRef);
        if (aRef) {
            rewritten.audio.libraryRef = aRef;
            rewritten.audio.path = '';
        }
    }

    // Props
    if (rewritten.props) {
        for (const p of rewritten.props) {
            const pRef = rewritePath(p.filePath, p.libraryRef);
            if (pRef) {
                p.libraryRef = pRef;
                p.filePath = '';
            }
        }
    }

    return rewritten;
}

// ======== Export (Pack) ========

/** 导出场景为 bundle zip 文件。 */
export async function exportSceneBundle(): Promise<void> {
    setStatus(t('scene.bundle.collecting'), true);

    const scene = serializeScene();
    const assetPaths = collectSceneAssets(scene);

    // 重写 libraryRef
    const rewritten = rewriteRefsForBundle(scene, libraryRoot);

    // 选择保存路径
    const targetPath = await SelectBundleSaveFile();
    if (!targetPath) {
        setStatus('', false);
        return;
    }

    setStatus(t('scene.bundle.packing'), true);
    try {
        await BundleScene(targetPath, JSON.stringify(rewritten), assetPaths);
        setStatus(t('scene.bundle.exported', { name: getBaseName(targetPath) }), true);
    } catch (err) {
        console.error('exportSceneBundle:', err);
        setStatus(t('scene.bundle.exportFailed'), false);
    }
}

// ======== Import (Unpack) ========

/** 导入场景 bundle zip 文件。 */
export async function importSceneBundle(): Promise<void> {
    const zipPath = await SelectSceneOpenFile();
    if (!zipPath) {
        return;
    }

    setStatus(t('scene.bundle.importing'), true);
    try {
        // 解压到缓存目录
        const result = await ExtractZip(zipPath, '');
        if (!result || !result.dir) {
            setStatus(t('scene.bundle.unzipFailed'), false);
            return;
        }

        const extractDir = result.dir;

        // 读取 scene.json
        const sceneJsonPath = normPath(`${extractDir}/scene.json`);
        const sceneJson = await LoadSceneFile(sceneJsonPath);
        if (!sceneJson) {
            setStatus(t('scene.bundle.noSceneJson'), false);
            return;
        }

        // 解析场景文件
        const sceneData = JSON.parse(sceneJson) as SceneFile;

        // 临时将 libraryRoot 指向解压目录的 assets/ 子目录。
        // BundleScene 把所有资源写入 zip 的 assets/ 前缀下（ADR-037），
        // 而 rewriteRefsForBundle 写入的 libraryRef 不含该前缀，
        // 故须指向 extractDir/assets 才能被 resolveLibraryRef 正确命中。
        const origRoot = libraryRoot;
        setLibraryRoot(normPath(extractDir + '/assets'));

        try {
            await deserializeScene(sceneData);
            setStatus(t('scene.bundle.imported'), true);
        } finally {
            // 恢复 libraryRoot
            setLibraryRoot(origRoot);
        }
    } catch (err) {
        console.error('importSceneBundle:', err);
        setStatus(t('scene.bundle.importFailed'), false);
    }
}
