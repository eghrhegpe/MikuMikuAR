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
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { createIconifyIcon } from '../core/icons';
import { slideRow } from '../core/ui-helpers';
import {
    serializeScene,
} from '../scene/scene';
import {
    SelectDir,
    SaveScreenshot,
    SaveScenePreset,
} from '../core/wails-bindings';
import { tryCatchStatus } from '../core/utils';
import { focusModel } from '../scene/scene';

// ======== 从子文件导入 ========
import {
    buildRenderLevel, buildPostProcessLevel, buildPresetScenesLevel,
} from './scene-render-levels';
import { buildStageLevel, buildStageTransformLevel } from './scene-stage-levels';
import { buildPropLevel, buildPropDetailLevel } from './scene-prop-levels';
import {
    buildPhysicsLevel,
    buildPhysicsDebugLevel,
    buildCollisionLevel,
    buildWasmPhysicsLevel,
} from './scene-physics-levels';
import { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Barrel Re-Exports ========
// 保持向后兼容——外部文件引用路径不变
export { buildRenderLevel, buildPostProcessLevel, buildPresetScenesLevel } from './scene-render-levels';
export { buildStageLevel, buildStageTransformLevel } from './scene-stage-levels';
export { buildPropLevel, buildPropDetailLevel } from './scene-prop-levels';

// ======== Scene Menu State ========

const { getMenu: getSceneMenu, refreshRoot: refreshSceneRoot, show: showSceneMenu } = registerPopupMenu({
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

function buildScreenshotLevel(): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [
            {
                kind: 'action',
                label: '截图当前模型',
                icon: 'camera',
                target: 'screenshot:current',
                sublabel: '保存焦点模型截图',
            },
            {
                kind: 'action',
                label: '批量截图',
                icon: 'images',
                target: 'screenshot:batch',
                sublabel: '逐个模型截图到指定目录',
            },
        ],
    };
}

// ======== Scene Root ========

/** 场景弹窗根级 items 构建器——items-based，支持增量 patch */
function buildSceneRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    items.push({ kind: 'folder', label: '预设场景', icon: 'lucide:bookmark', target: 'scene:presets' });
    items.push({ kind: 'action', label: '保存场景', icon: 'lucide:save', target: 'scene:save' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({ kind: 'folder', label: '后处理', icon: 'lucide:sparkles', target: 'scene:render:postprocess' });
    items.push({ kind: 'folder', label: '舞台', icon: 'lucide:monitor', target: 'scene:render:stage' });
    items.push({ kind: 'folder', label: '截图', icon: 'lucide:camera', target: 'scene:screenshot' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({ kind: 'folder', label: '物理', icon: 'lucide:atom', target: 'scene:physics' });
    return items;
}

function buildSceneRoot(): PopupLevel {
    return {
        label: '场景',
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
        case 'physics:cloth':
            return buildClothParamsLevel();
        case 'physics:debug':
            return buildPhysicsDebugLevel();
        case 'physics:collision':
            return buildCollisionLevel();
        case 'physics:wasm':
            return buildWasmPhysicsLevel();
        default:
            return null;
    }
}

// ======== handleSceneAction ========

/** 截图当前焦点模型 */
async function screenshotCurrent(): Promise<void> {
    const id = focusedModelId;
    if (!id) { setStatus('✗ 无焦点模型', false); return; }
    const inst = modelRegistry.get(id);
    if (!inst) { setStatus('✗ 模型不存在', false); return; }
    const dir = await SelectDir();
    if (!dir) return;
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const base64 = dom.canvas.toDataURL('image/png', 0.9).replace(/^data:image\/png;base64,/, '');
    const ts = Date.now();
    const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.png`;
    const r = await tryCatchStatus(async () => {
        await SaveScreenshot(dir, filename, base64);
        return true;
    }, '✗ 截图失败');
    if (r) setStatus(`✓ 截图已保存: ${filename}`, true);
}

/** 批量截图所有已加载模型 */
async function screenshotBatch(): Promise<void> {
    if (modelRegistry.size === 0) { setStatus('✗ 场景中无模型', false); return; }
    const dir = await SelectDir();
    if (!dir) return;
    let saved = 0;
    const prevFocused = focusedModelId;
    const batchOk = await tryCatchStatus(async () => {
        for (const [id, inst] of modelRegistry) {
            setFocusedModelId(id);
            focusModel(id);
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
            const base64 = dom.canvas.toDataURL('image/png', 0.9).replace(/^data:image\/png;base64,/, '');
            const ts = Date.now();
            const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.png`;
            await SaveScreenshot(dir, filename, base64);
            saved++;
            setStatus(`截图中… ${saved}/${modelRegistry.size}`, true);
        }
        if (prevFocused) { setFocusedModelId(prevFocused); focusModel(prevFocused); }
        return true;
    }, '✗ 批量截图失败');
    if (batchOk) {
        setStatus(`✓ 批量截图完成: ${saved} 张`, true);
    }
}

/** 保存场景（自动编号到预设目录） */
async function saveScene(): Promise<void> {
    const json = JSON.stringify(serializeScene(), null, 2);
    const filename = await tryCatchStatus(() => SaveScenePreset(json), '✗ 保存失败');
    if (filename !== undefined) {
        setStatus(`✓ 场景已保存: ${filename}`, true);
        reRenderSceneMenu();
    }
}

/** 场景动作映射表——替代原 handleSceneAction 的 if 链 */
const SCENE_ACTIONS: Record<string, () => void> = {
    'screenshot:current': () => { void screenshotCurrent(); },
    'screenshot:batch': () => { void screenshotBatch(); },
    'scene:save': () => { void saveScene(); },
};

function handleSceneAction(row: PopupRow): void {
    if (row.target) {
        SCENE_ACTIONS[row.target]?.();
    }
}

// Wire up events in main.ts:243-244 — do NOT re-register here.
