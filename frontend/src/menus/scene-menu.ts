// [doc:architecture] Scene Menu — 场景弹窗（核心 + barrel export）
// 职责: MenuStack 场景弹窗路由/入口，拆分后只保留根级 + 路由 + 动作处理
// 子文件: scene-render-levels.ts
// 程序化动作/LipSync 已归位 motion-procmotion-levels.ts（动作弹窗域）
// 环境功能归位 env-menu.ts（环境弹窗域）

import {
    dom,
    closeAllOverlays,
    setStatus,
    PopupRow,
    PopupLevel,
    cardContainer,
    modelRegistry,
    focusedModelId,
    setFocusedModelId,
    uiState,
    envState,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { createIconifyIcon } from '../core/icons';
import { slideRow } from '../core/ui-helpers';
import { serializeScene } from '../scene/scene';
import { SelectDir, SaveScreenshot, SaveScenePreset } from '../core/wails-bindings';
import { tryCatchStatus, showErrorToast } from '../core/utils';
import { setModelFormation } from '../scene/scene';
import { focusModel } from '../scene/scene';
import { exportSceneBundle, importSceneBundle } from '../scene/scene-bundle';
import { toggleCloth } from '../physics/cloth-manager';
import { t } from '../core/i18n/t';

// ======== 从子文件导入 ========
import {
    buildRenderLevel,
    buildPostProcessLevel,
    buildPresetScenesLevel,
} from './scene-render-levels';
import { buildStageLevel, buildStageTransformLevel } from './scene-stage-levels';
import { buildPropLevel, buildPropDetailLevel } from './scene-prop-levels';
import {
    buildPhysicsLevel,
    buildClothLevel,
    buildWasmPhysicsLevel,
    buildCollisionLevel,
    buildPhysicsDebugLevel,
    buildClothDebugLevel,
} from './scene-physics-levels';
import { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Barrel Re-Exports ========
// 保持向后兼容——外部文件引用路径不变
export {
    buildRenderLevel,
    buildPostProcessLevel,
    buildPresetScenesLevel,
} from './scene-render-levels';
export { buildStageLevel, buildStageTransformLevel } from './scene-stage-levels';
export { buildPropLevel, buildPropDetailLevel } from './scene-prop-levels';

// ======== Formation key map（热切换安全：仅存 i18n key，不含中文）========
const FORMATION_KEYS: Record<string, string> = {
    line: 'scene.formation.line',
    'v-shape': 'scene.formation.vshape',
    circle: 'scene.formation.circle',
    grid: 'scene.formation.grid',
    diagonal: 'scene.formation.diagonal',
    arc: 'scene.formation.arc',
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
});

export { getSceneMenu, refreshSceneRoot, showSceneMenu };

/** 安全 reRender：菜单可能正在 async 重建中（showSceneMenu 的 await 期间），此时 sceneMenu 为 null。 */
export function reRenderSceneMenu(): void {
    getSceneMenu()?.reRender();
}

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

function buildScreenshotLevel(): PopupLevel {
    return {
        label: t('scene.screenshot'),
        dir: '',
        items: [
            {
                kind: 'action',
                label: t('scene.screenshotCurrent'),
                icon: 'camera',
                target: 'screenshot:current',
                sublabel: t('scene.screenshotCurrentSub'),
            },
            {
                kind: 'action',
                label: t('scene.screenshotBatch'),
                icon: 'images',
                target: 'screenshot:batch',
                sublabel: t('scene.screenshotBatchSub'),
            },
        ],
    };
}

// ======== Scene Root ========

/** 场景弹窗根级 items 构建器——items-based，支持增量 patch */
function buildSceneRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    items.push({
        kind: 'folder',
        label: t('scene.presetScenes'),
        icon: 'lucide:bookmark',
        target: 'scene:presets',
    });
    items.push({ kind: 'action', label: t('scene.saveScene'), icon: 'lucide:save', target: 'scene:save' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'folder',
        label: t('scene.postProcess'),
        icon: 'lucide:sparkles',
        target: 'scene:render:postprocess',
    });
    items.push({
        kind: 'folder',
        label: t('scene.stage'),
        icon: 'lucide:monitor',
        target: 'scene:render:stage',
    });
    items.push({
        kind: 'folder',
        label: t('scene.screenshot'),
        icon: 'lucide:camera',
        target: 'scene:screenshot',
    });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({ kind: 'folder', label: t('scene.physics'), icon: 'lucide:atom', target: 'scene:physics' });
    items.push({
        kind: 'folder',
        label: t('scene.clothSim'),
        icon: 'lucide:shirt',
        target: 'scene:cloth',
        headerToggle: {
            value: envState.clothEnabled,
            onChange: (v) => {
                envState.clothEnabled = v;
                toggleCloth(v);
            },
            bind: () => envState.clothEnabled,
        },
    });
    if (modelRegistry.size > 1) {
        items.push({
            kind: 'folder',
            label: t('scene.formation'),
            icon: 'lucide:layout-grid',
            target: 'scene:formation',
        });
    }
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

function sceneOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'scene:presets':
            return buildPresetScenesLevel();
        case 'scene:render':
            return buildRenderLevel();
        case 'scene:screenshot':
            return buildScreenshotLevel();
        case 'scene:render:postprocess':
            return buildPostProcessLevel();
        case 'scene:render:stage':
            return buildStageLevel();
        case 'scene:render:props':
            return buildPropLevel();
        case 'scene:physics':
            return buildPhysicsLevel();
        case 'scene:cloth':
            return buildClothLevel();
        case 'scene:formation':
            return buildFormationLevel();
        case 'cloth:fineTune':
            return buildClothParamsLevel();
        case 'cloth:debug':
            return buildClothDebugLevel();
        case 'cloth:collision':
            return buildCollisionLevel();
        case 'physics:wasm':
            return buildWasmPhysicsLevel();
        case 'wasm:debug':
            return buildPhysicsDebugLevel();
        default:
            return null;
    }
}

// ======== handleSceneAction ========

/** 截图当前焦点模型 */
async function screenshotCurrent(): Promise<void> {
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
    const dir = await SelectDir();
    if (!dir) {
        return;
    }
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const fmt = uiState.screenshotFormat ?? 'image/png';
    const q = uiState.screenshotQuality ?? 0.9;
    const base64 = dom.canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');
    const ts = Date.now();
    const ext = fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
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
    const dir = await SelectDir();
    if (!dir) {
        return;
    }
    let saved = 0;
    const prevFocused = focusedModelId;
    const batchOk = await tryCatchStatus(async () => {
        for (const [id, inst] of modelRegistry) {
            setFocusedModelId(id);
            focusModel(id);
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
            const fmt = uiState.screenshotFormat ?? 'image/png';
            const q = uiState.screenshotQuality ?? 0.9;
            const base64 = dom.canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');
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
        const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
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
    'scene:save': () => {
        void saveScene();
    },
    'scene:export-bundle': () => {
        void exportSceneBundle();
    },
    'scene:import-bundle': () => {
        void importSceneBundle();
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
    if (row.target) {
        SCENE_ACTIONS[row.target]?.();
    }
}

// Wire up events in main.ts:243-244 — do NOT re-register here.
