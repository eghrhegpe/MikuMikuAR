// [doc:architecture] Scene Menu — 场景弹窗（核心 + barrel export）
// 职责: MenuStack 场景弹窗路由/入口，拆分后只保留根级 + 路由 + 动作处理
// 子文件: scene-render-levels.ts
// 程序化动作/LipSync 已归位 motion-procmotion-levels.ts（动作弹窗域）
// 环境功能归位 env-menu.ts（环境弹窗域）

import {
    dom,
    PopupRow,
    PopupLevel,
    modelRegistry,
    focusedModelId,
    setFocusedModelId,
    uiState,
    setUIState,
} from '../core/config';
import { feedbackInfo, feedbackStatus } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import { registerPopupMenu } from './menu-factory';
import {
    serializeScene,
    isARModeActive,
    takeARScreenshot,
    setEnvState,
} from '../scene/scene';
import { SelectDir, SaveScreenshot, SaveScenePreset } from '../core/wails-bindings';
import {
    waitForFrame,
    tryCatchStatus,
    showErrorToast,
    closeAllOverlays,
    cardContainer,
} from '../core/utils';
import { registerLoadRefreshHook, registerLibraryScannedHook } from '../core/load-refresh-registry';
import { focusModel } from '../scene/scene';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';

/**
 * canvas → base64 异步编码（ADR-017 A2-04）。
 * 用 toBlob 替代 toDataURL，编码移至后台线程，降低低端机 OOM 风险。
 * toBlob 失败时降级 toDataURL（受约束环境兼容）。
 */
function canvasToBase64(
    canvas: HTMLCanvasElement,
    format: string,
    quality: number
): Promise<string> {
    return new Promise((resolve) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    resolve(
                        canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
                    );
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    const r = reader.result;
                    resolve(
                        typeof r === 'string'
                            ? r.replace(/^data:image\/\w+;base64,/, '')
                            : canvas
                                  .toDataURL(format, quality)
                                  .replace(/^data:image\/\w+;base64,/, '')
                    );
                };
                reader.onerror = () => {
                    resolve(
                        canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
                    );
                };
                reader.readAsDataURL(blob);
            },
            format,
            quality
        );
    });
}

// ======== 导入 ========
import { buildPresetScenesLevel } from './scene-render-levels';
import { buildStageLevel } from './scene-stage-levels';
import { buildStageLightLevel } from './scene-stage-lights';
import { buildPhysicsLevel, buildWasmPhysicsLevel } from './scene-physics-levels';
import { buildGroundLevel } from './env-ground-levels';
import { buildWaterLevel } from './env-water-levels';
import { buildDragModeLevel } from './scene-drag-levels';
import { envState } from '../core/state';
import { getEnvTextureBindingTarget, clearEnvTextureBindingTarget } from './env-menu';
import { setSceneMenu, setRefreshSceneRoot, reRenderSceneMenu } from './scene-menu-state';
import { setMirrorSize, getMirrorInfo, toggleMirror, isMirrorActive } from '../scene/env/env';
import { isDragModeEnabled, setDragModeEnabled } from '../scene/transform/transform-mode';
import { attachGizmoForKind, detachGizmo } from '../scene/transform/transform-adapter';
import { addSliderRow } from '../core/ui-helpers';
import { executeActionById } from '../core/action-executor';

// ======== Barrel Re-Exports ========
// 保持向后兼容——外部文件引用路径不变
export { buildStageTransformLevel } from './scene-stage-levels';

// ======== Scene Menu State ========

const {
    getMenu: getSceneMenu,
    refreshRoot: refreshSceneRoot,
    show: showSceneMenu,
} = registerPopupMenu({
    wrapperKey: 'scene-menu',
    popupType: 'scene',
    buildRoot: () => buildSceneRoot(),
    buildRootItems: () => buildSceneRootItems(),
    handlers: {
        onItemClick: (row) => handleSceneAction(row),
        onFolderEnter: sceneOnFolderEnter,
    },
    onShow: (menu) => setSceneMenu(menu),
    onClose: () => setSceneMenu(null),
});

export { getSceneMenu, showSceneMenu };

setRefreshSceneRoot(refreshSceneRoot);

// [doc:P4] 加载模型后刷新根菜单 items（使道具列表等即时更新）
const _unregisterLoadRefresh = registerLoadRefreshHook(() => {
    if (getSceneMenu()) refreshSceneRoot();
});

// 从 scene-menu-state.ts 再导出，切断子文件与 scene-menu 的直接 import 路径
export { refreshSceneRoot } from './scene-menu-state';

// 库扫描完成时刷新菜单（通过注册表统一监听，替代独立 addDisposableListener）
const _unregisterLibraryScanned = registerLibraryScannedHook(() => reRenderSceneMenu());

/** 释放 scene-menu 模块资源（取消注册 hooks + HMR/清理时调用） */
export function disposeSceneMenu(): void {
    _unregisterLoadRefresh();
    _unregisterLibraryScanned();
}

// ======== Mirror Level ========

function buildMirrorLevel(): PopupLevel {
    return {
        label: t('scene.mirror'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const info = getMirrorInfo();
            cardContainer(container, (card) => {
                addSliderRow(
                    card,
                    t('scene.mirrorWidth'),
                    info.width,
                    0,
                    40,
                    1,
                    (v) => {
                        const cur = getMirrorInfo();
                        setMirrorSize(v, cur.height);
                    },
                    'lucide:move-horizontal'
                );
                addSliderRow(
                    card,
                    t('scene.mirrorHeight'),
                    info.height,
                    0,
                    30,
                    1,
                    (v) => {
                        const cur = getMirrorInfo();
                        setMirrorSize(cur.width, v);
                    },
                    'lucide:move-vertical'
                );
            });
        },
    };
}

// ======== Scene Root ========

/** 场景弹窗根级 items 构建器——items-based，支持增量 patch */
function buildSceneRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    // 高频功能前置：灯光 > 地面/水面（带开关）> 舞台 > 物理 > 预设场景/镜像/撤销/保存
    items.push({
        kind: 'folder',
        label: t('scene.stageLight'),
        icon: 'lucide:lightbulb',
        target: 'scene:stageLight',
    });
    items.push({
        kind: 'folder',
        label: t('env.ground'),
        icon: 'lucide:square',
        target: 'scene:ground',
        headerToggle: {
            value: envState.groundVisible,
            onChange: (v: boolean) => setEnvState({ groundVisible: v }),
            bind: () => envState.groundVisible,
        },
    });
    items.push({
        kind: 'folder',
        label: t('env.water'),
        icon: 'lucide:waves',
        target: 'scene:water',
        headerToggle: {
            value: envState.waterEnabled,
            onChange: (v: boolean) => setEnvState({ waterEnabled: v }),
            bind: () => envState.waterEnabled,
        },
    });
    items.push({
        kind: 'folder',
        label: t('scene.dragMode'),
        icon: 'lucide:move-3d',
        target: 'scene:dragMode',
        headerToggle: {
            value: isDragModeEnabled(),
            onChange: (v: boolean) => {
                setDragModeEnabled(v);
                if (v) {
                    closeAllOverlays();
                    feedbackStatus('scene.dragModeHint', undefined, false);
                    const id = focusedModelId;
                    const inst = id ? modelRegistry.get(id) : undefined;
                    if (inst) {
                        attachGizmoForKind(inst.kind, inst.id);
                    }
                } else {
                    detachGizmo();
                    feedbackStatus('scene.statusExitDrag', undefined, false);
                }
            },
            bind: () => isDragModeEnabled(),
        },
    });
    items.push({
        kind: 'folder',
        label: t('scene.stage'),
        icon: 'lucide:monitor',
        target: 'scene:render:stage',
    });
    items.push({
        kind: 'folder',
        label: t('scene.physics'),
        icon: 'lucide:atom',
        target: 'scene:physics',
    });
    // 场景操作：预设场景 > 镜像 > 撤销 > 保存场景（从原"高级"folder 拆出）
    items.push({
        kind: 'folder',
        label: t('scene.presetScenes'),
        icon: 'lucide:bookmark',
        target: 'scene:presets',
    });
    items.push({
        kind: 'folder',
        label: t('scene.mirror'),
        icon: 'lucide:scan',
        target: 'scene:mirror',
        headerToggle: {
            value: isMirrorActive(),
            onChange: () => toggleMirror(),
            bind: () => isMirrorActive(),
        },
    });
    // 反射质量（统一控制：水面 + 地面 + 镜面反射）
    items.push({
        kind: 'modeSlider',
        label: t('env.reflectionQuality'),
        icon: 'lucide:monitor',
        target: '',
        modeOptions: [
            { value: 'off', label: t('env.reflectionQualityOff') },
            { value: 'low', label: t('env.reflectionQualityLow') },
            { value: 'medium', label: t('env.reflectionQualityMedium') },
            { value: 'high', label: t('env.reflectionQualityHigh') },
        ],
        modeValue: envState.reflectionQuality,
        onModeChange: (v) => {
            setEnvState({ reflectionQuality: v as 'high' | 'medium' | 'low' | 'off' });
            getSceneMenu()?.updateControls();
        },
    });
    // 反射模式（ADR-151：独立于反射质量，控制 SSR/探针/平面反射的激活策略）
    items.push({
        kind: 'modeSlider',
        label: t('env.reflectionMode'),
        icon: 'lucide:layers',
        target: '',
        modeOptions: [
            { value: 'none', label: t('env.reflectionModeNone') },
            { value: 'planar', label: t('env.reflectionModePlanar') },
            { value: 'ssr', label: t('env.reflectionModeSsr') },
            { value: 'probe', label: t('env.reflectionModeProbe') },
            { value: 'hybrid', label: t('env.reflectionModeHybrid') },
        ],
        modeValue: envState.reflectionMode,
        onModeChange: (v) => {
            setEnvState({
                reflectionMode: v as 'none' | 'planar' | 'ssr' | 'probe' | 'hybrid',
            });
            getSceneMenu()?.updateControls();
        },
    });
    return items;
}

function buildSceneRoot(): PopupLevel {
    return {
        label: t('scene.scene'),
        dir: '',
        items: buildSceneRootItems(),
    };
}

// ======== onFolderEnter Router ========

// [doc:adr-065] 子层路由表：target → 纯 items 构建器（零参）；自动挂 itemBuilder 实现语言热刷新
const SCENE_FOLDER_ROUTES: Record<string, () => PopupLevel> = {
    'scene:presets': buildPresetScenesLevel,
    'scene:render:stage': buildStageLevel,
    'scene:stageLight': buildStageLightLevel,
    'scene:ground': buildGroundLevel,
    'scene:water': buildWaterLevel,
    'scene:dragMode': buildDragModeLevel,
    'scene:physics': buildPhysicsLevel,
    'scene:mirror': buildMirrorLevel,
    'physics:wasm': buildWasmPhysicsLevel,
};

function sceneOnFolderEnter(row: PopupRow): PopupLevel | null {
    const builder = SCENE_FOLDER_ROUTES[row.target as string];
    if (builder) {
        const lvl = builder();
        lvl.itemBuilder = () => builder().items;
        return lvl;
    }
    return null;
}

// ======== handleSceneAction ========

/** 截图当前焦点模型 */
export async function screenshotCurrent(): Promise<void> {
    const id = focusedModelId;
    if (!id) {
        feedbackStatus('scene.statusNoFocusModel', undefined, false);
        return;
    }
    const inst = modelRegistry.get(id);
    if (!inst) {
        feedbackStatus('scene.statusModelNotFound', undefined, false);
        return;
    }
    let dir = uiState.screenshotDir;
    if (!dir) {
        dir = await tryCatchStatus(async () => {
            const d = await SelectDir();
            if (!d) {
                return undefined;
            }
            return d;
        }, t('scene.statusScreenshotFailed'));
        if (!dir) {
            return;
        }
        uiState.screenshotDir = dir;
        setUIState({ screenshotDir: dir });
    }
    await waitForFrame();
    await waitForFrame();
    const fmt = uiState.screenshotFormat ?? 'image/png';
    const q = uiState.screenshotQuality ?? 0.9;
    const ts = Date.now();
    const ext = fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
    let base64: string;
    if (isARModeActive()) {
        base64 = await takeARScreenshot(fmt, q);
    } else {
        base64 = await canvasToBase64(dom.canvas, fmt, q);
    }
    const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.${ext}`;
    const r = await tryCatchStatus(async () => {
        await SaveScreenshot(dir, filename, base64);
        return true;
    }, t('scene.statusScreenshotFailed'));
    if (r) {
        showInfoToast(t('scene.statusScreenshotSaved', { filename }));
    }
}

/** 批量截图所有已加载模型 */
export async function screenshotBatch(): Promise<void> {
    if (modelRegistry.size === 0) {
        feedbackStatus('scene.statusNoModels', undefined, false);
        return;
    }
    let dir = uiState.screenshotDir;
    if (!dir) {
        dir = await tryCatchStatus(async () => {
            const d = await SelectDir();
            if (!d) {
                return undefined;
            }
            return d;
        }, t('scene.statusScreenshotFailed'));
        if (!dir) {
            return;
        }
        uiState.screenshotDir = dir;
        setUIState({ screenshotDir: dir });
    }
    let saved = 0;
    const prevFocused = focusedModelId;
    const batchOk = await tryCatchStatus(async () => {
        for (const [id, inst] of modelRegistry) {
            setFocusedModelId(id);
            focusModel(id);
            await waitForFrame();
            await waitForFrame();
            await waitForFrame();
            const fmt = uiState.screenshotFormat ?? 'image/png';
            const q = uiState.screenshotQuality ?? 0.9;
            let base64: string;
            if (isARModeActive()) {
                base64 = await takeARScreenshot(fmt, q);
            } else {
                base64 = await canvasToBase64(dom.canvas, fmt, q);
            }

            const ts = Date.now();
            const ext = fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
            const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.${ext}`;
            await SaveScreenshot(dir, filename, base64);
            saved++;
            showInfoToast(t('scene.statusScreenshotting', { saved, total: modelRegistry.size }));
        }
        if (prevFocused) {
            setFocusedModelId(prevFocused);
            focusModel(prevFocused);
        }
        return true;
    }, t('scene.statusBatchScreenshotFailed'));
    if (batchOk) {
        showInfoToast(t('scene.statusBatchScreenshotDone', { saved }));
    }
}

/** 保存场景（自动编号到预设目录） */
export async function saveScene(): Promise<void> {
    const json = JSON.stringify(serializeScene(), null, 2);
    try {
        const filename = await SaveScenePreset(json);
        try {
            await navigator.clipboard.writeText(json);
            showInfoToast(t('scene.statusSceneSavedClipboard', { filename }));
        } catch {
            showInfoToast(t('scene.statusSceneSaved', { filename }));
        }
        reRenderSceneMenu();
    } catch (err) {
        const msg = translateGoError(err);
        feedbackStatus('scene.statusSaveFailed', undefined, false);
        showErrorToast(t('scene.toastSaveSceneFailed'), msg);
    }
}

let _sceneRegistered = false;

function _ensureSceneActions(): void {
    if (!_sceneRegistered) {
        import('../core/action-defs/scene-actions').then((m) => m.registerSceneActions());
        _sceneRegistered = true;
    }
}

function handleSceneAction(row: PopupRow): void {
    _ensureSceneActions();
    // 处理文件浏览器选择（环境纹理绑定）
    if (row.model) {
        const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'hdr', 'dds'];
        if (IMAGE_FORMATS.includes(row.model.format)) {
            const target = getEnvTextureBindingTarget();
            clearEnvTextureBindingTarget();
            closeAllOverlays();
            if (target === 'ground') {
                setEnvState({
                    groundTexture: row.model.file_path,
                    groundTextureEnabled: !!row.model.file_path,
                    groundStyle: 'texture',
                });
                getSceneMenu()?.reRender();
                return;
            }
        }
    }
    if (row.target) {
        void executeActionById(row.target, {});
    }
}

// Wire up events in main.ts:243-244 — do NOT re-register here.
