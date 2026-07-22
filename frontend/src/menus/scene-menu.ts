// [doc:architecture] Scene Menu — 场景弹窗（核心 + barrel export）
// 职责: MenuStack 场景弹窗路由/入口，拆分后只保留根级 + 路由 + 动作处理
// 子文件: scene-render-levels.ts
// 程序化动作/LipSync 已归位 motion-procmotion-levels.ts（动作弹窗域）
// 环境功能归位 env-menu.ts（环境弹窗域）

import {
    dom,
    setStatus,
    PopupRow,
    PopupLevel,
    modelRegistry,
    focusedModelId,
    setFocusedModelId,
    uiState,
    setUIState,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import {
    serializeScene,
    isARModeActive,
    takeARScreenshot,
    setEnvState,
    popUndoSnapshot,
    restoreUndoSnapshot,
} from '../scene/scene';
import { SelectDir, SaveScreenshot, SaveScenePreset } from '../core/wails-bindings';
import { waitForFrame, tryCatchStatus, showErrorToast, closeAllOverlays } from '../core/utils';
import { addDisposableListener } from '../core/dom';
import { setModelFormation } from '../scene/scene';
import { focusModel } from '../scene/scene';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';

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
import { attachGizmoForKind } from '../scene/transform/transform-adapter';
import { addModeSlider, addSliderRow, addToggleRow, slideRow } from '../core/ui-helpers';
import { SCENE_EVENTS } from '../core/ui-constants';

// ======== Barrel Re-Exports ========
// 保持向后兼容——外部文件引用路径不变
export { buildPresetScenesLevel } from './scene-render-levels';
export { buildStageLevel, buildStageTransformLevel } from './scene-stage-levels';
export { buildPropDetailLevel } from './scene-prop-levels';

// ======== Formation key map（热切换安全：仅存 i18n key，不含中文）========
const FORMATION_KEYS: Record<string, string> = {
    'line': 'scene.formation.line',
    'v-shape': 'scene.formation.vshape',
    'circle': 'scene.formation.circle',
    'grid': 'scene.formation.grid',
    'diagonal': 'scene.formation.diagonal',
    'arc': 'scene.formation.arc',
};

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

// 从 scene-menu-state.ts 再导出，切断子文件与 scene-menu 的直接 import 路径
export { reRenderSceneMenu, refreshSceneRoot } from './scene-menu-state';

// 当库扫描完成时，如果场景菜单已打开则 reRender，
// 使道具面板等依赖 allModels 的 renderCustom 回调拿到最新数据。
const _libraryScannedDisp = addDisposableListener(window, 'mmar:library-scanned', () => {
    reRenderSceneMenu();
});

function buildFormationLevel(): PopupLevel {
    const formations: string[] = ['line', 'v-shape', 'circle', 'grid', 'diagonal', 'arc'];
    const icons: Record<string, string> = {
        'line': 'lucide:minus',
        'v-shape': 'lucide:chevron-up',
        'circle': 'lucide:circle',
        'grid': 'lucide:grid-3x3',
        'diagonal': 'lucide:trending-up',
        'arc': 'lucide:arrow-up-right',
    };
    return {
        label: t('scene.formation'),
        dir: '',
        items: formations.map((f) => ({
            kind: 'action' as const,
            label: t(FORMATION_KEYS[f]),
            icon: icons[f],
            target: `formation:set:${f}`,
        })),
    };
}

// ======== Mirror Level ========

function buildMirrorLevel(): PopupLevel {
    return {
        label: t('scene.mirror'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const info = getMirrorInfo();
            const wrapper = document.createElement('div');
            wrapper.style.padding = '8px';

            addSliderRow(
                wrapper,
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
                wrapper,
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
            const p = info.position;
            const infoText = info.active
                ? `mesh: ${info.meshCount} | pos: (${p[0].toFixed(1)}, ${p[1].toFixed(1)}, ${p[2].toFixed(1)}) | ${info.width}×${info.height}m @ ${info.resolution}px`
                : t('scene.mirrorHint');
            slideRow(
                wrapper,
                'lucide:info',
                infoText,
                false,
                () => {},
                undefined,
                undefined,
                false,
                undefined,
                { testId: 'menu.scene.mirrorInfo' }
            );

            container.appendChild(wrapper);
        },
    };
}

// ======== Scene Root ========

/** 场景弹窗根级 items 构建器——items-based，支持增量 patch */
function buildSceneRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    // 高频功能前置：灯光 > 地面/水面（带开关）> 舞台 > 物理 > 阵型 > 预设场景/镜像/撤销/保存
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
                    setStatus(t('scene.dragModeHint'), false);
                    const id = focusedModelId;
                    const inst = id ? modelRegistry.get(id) : undefined;
                    if (inst) attachGizmoForKind(inst.kind, inst.id);
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
    if (modelRegistry.size > 1) {
        items.push({
            kind: 'folder',
            label: t('scene.formation'),
            icon: 'lucide:layout-grid',
            target: 'scene:formation',
        });
    }
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
    'scene:formation': buildFormationLevel,
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
        setStatus(t('scene.statusNoFocusModel'), false);
        return;
    }
    const inst = modelRegistry.get(id);
    if (!inst) {
        setStatus(t('scene.statusModelNotFound'), false);
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
        base64 = takeARScreenshot(fmt, q);
    } else {
        base64 = dom.canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');
    }
    const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.${ext}`;
    const r = await tryCatchStatus(async () => {
        await SaveScreenshot(dir, filename, base64);
        return true;
    }, t('scene.statusScreenshotFailed'));
    if (r) {
        setStatus(t('scene.statusScreenshotSaved', { filename }), true);
    }
}

/** 批量截图所有已加载模型 */
async function screenshotBatch(): Promise<void> {
    if (modelRegistry.size === 0) {
        setStatus(t('scene.statusNoModels'), false);
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
                base64 = takeARScreenshot(fmt, q);
            } else {
                base64 = dom.canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');
            }

            const ts = Date.now();
            const ext = fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
            const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.${ext}`;
            await SaveScreenshot(dir, filename, base64);
            saved++;
            setStatus(t('scene.statusScreenshotting', { saved, total: modelRegistry.size }), true);
        }
        if (prevFocused) {
            setFocusedModelId(prevFocused);
            focusModel(prevFocused);
        }
        return true;
    }, t('scene.statusBatchScreenshotFailed'));
    if (batchOk) {
        setStatus(t('scene.statusBatchScreenshotDone', { saved }), true);
    }
}

/** 保存场景（自动编号到预设目录） */
async function saveScene(): Promise<void> {
    const json = JSON.stringify(serializeScene(), null, 2);
    try {
        const filename = await SaveScenePreset(json);
        try {
            await navigator.clipboard.writeText(json);
            setStatus(t('scene.statusSceneSavedClipboard', { filename }), true);
        } catch {
            setStatus(t('scene.statusSceneSaved', { filename }), true);
        }
        reRenderSceneMenu();
    } catch (err) {
        const msg = translateGoError(err);
        setStatus(t('scene.statusSaveFailed'), false);
        showErrorToast(t('scene.toastSaveSceneFailed'), msg);
    }
}

/** 场景动作映射表——替代原 handleSceneAction 的 if 链 */
const SCENE_ACTIONS: Record<string, () => void> = {
    'screenshot:current': () => {
        void screenshotCurrent();
    },
    'screenshot:batch': () => {
        void screenshotBatch();
    },
    [SCENE_EVENTS.SAVE]: () => {
        void saveScene();
    },
    'scene:undo': () => {
        const snap = popUndoSnapshot();
        if (!snap) {
            setStatus(t('scene.statusNoUndo'), false);
            return;
        }
        void restoreUndoSnapshot(snap).then((ok) => {
            if (ok) {
                setStatus(t('scene.undoApplied'), true);
            }
        });
    },
    'formation:set:line': () => {
        setModelFormation('line');
        setStatus(t('scene.formationStatus.line'), true);
    },
    'formation:set:v-shape': () => {
        setModelFormation('v-shape');
        setStatus(t('scene.formationStatus.vshape'), true);
    },
    'formation:set:circle': () => {
        setModelFormation('circle');
        setStatus(t('scene.formationStatus.circle'), true);
    },
    'formation:set:grid': () => {
        setModelFormation('grid');
        setStatus(t('scene.formationStatus.grid'), true);
    },
    'formation:set:diagonal': () => {
        setModelFormation('diagonal');
        setStatus(t('scene.formationStatus.diagonal'), true);
    },
    'formation:set:arc': () => {
        setModelFormation('arc');
        setStatus(t('scene.formationStatus.arc'), true);
    },
};

function handleSceneAction(row: PopupRow): void {
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
        SCENE_ACTIONS[row.target]?.();
    }
}

// Wire up events in main.ts:243-244 — do NOT re-register here.
