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
    getMenuWrapper,
} from '../core/config';
import { SlideMenu } from './menu';
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
import { focusModel } from '../scene/scene';

// ======== 从子文件导入 ========
import {
    buildRenderLevel, buildPostProcessLevel, buildStageLevel, buildPresetScenesLevel,
} from './scene-render-levels';
import { buildPropLevel, buildPropDetailLevel } from './scene-prop-levels';

// ======== Barrel Re-Exports ========
// 保持向后兼容——外部文件引用路径不变
export { buildRenderLevel, buildPostProcessLevel, buildStageLevel, buildStageTransformLevel, buildPresetScenesLevel } from './scene-render-levels';
export { buildPropLevel, buildPropDetailLevel } from './scene-prop-levels';

// ======== Scene Menu State ========

let sceneMenu: SlideMenu | null = null;

export function getSceneMenu(): SlideMenu | null {
    return sceneMenu;
}

/** 安全 reRender：菜单可能正在 async 重建中（showSceneMenu 的 await 期间），此时 sceneMenu 为 null。 */
export function reRenderSceneMenu(): void {
    sceneMenu?.reRender();
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

function buildSceneRoot(): PopupLevel {
    return {
        label: '场景',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            container.style.padding = '0';
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:bookmark', '预设场景', true, () =>
                    sceneMenu.push(buildPresetScenesLevel())
                );
                slideRow(c, 'lucide:save', '保存场景', false, () => {
                    handleSceneAction({ kind: 'action', label: '', icon: '', target: 'scene:save' });
                });
            });
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:sparkles', '后处理', true, () =>
                    sceneMenu.push(buildPostProcessLevel())
                );
                slideRow(c, 'lucide:monitor', '舞台', true, () =>
                    sceneMenu.push(buildStageLevel())
                );
                slideRow(c, 'lucide:camera', '截图', true, () =>
                    sceneMenu.push(buildScreenshotLevel())
                );
            });
        },
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
        default:
            return null;
    }
}

// ======== handleSceneAction ========

function handleSceneAction(row: PopupRow): void {
    // Screenshot current focused model
    if (row.target === 'screenshot:current') {
        (async () => {
            const id = focusedModelId;
            if (!id) { setStatus('✗ 无焦点模型', false); return; }
            const inst = modelRegistry.get(id);
            if (!inst) { setStatus('✗ 模型不存在', false); return; }
            try {
                const dir = await SelectDir();
                if (!dir) return;
                await new Promise((r) => requestAnimationFrame(r));
                await new Promise((r) => requestAnimationFrame(r));
                const base64 = dom.canvas.toDataURL('image/png', 0.9).replace(/^data:image\/png;base64,/, '');
                const ts = Date.now();
                const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.png`;
                await SaveScreenshot(dir, filename, base64);
                setStatus(`✓ 截图已保存: ${filename}`, true);
            } catch (err) {
                setStatus('✗ 截图失败', false);
                console.error('Screenshot error:', err);
            }
        })();
        return;
    }
    // Batch screenshot all loaded models
    if (row.target === 'screenshot:batch') {
        if (modelRegistry.size === 0) { setStatus('✗ 场景中无模型', false); return; }
        (async () => {
            const dir = await SelectDir();
            if (!dir) return;
            let saved = 0;
            const prevFocused = focusedModelId;
            try {
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
                setStatus(`✓ 批量截图完成: ${saved} 张`, true);
            } catch (err) {
                setStatus('✗ 批量截图失败', false);
                console.error('Batch screenshot error:', err);
            }
        })();
        return;
    }
    // Save scene — auto-numbered save to preset directory
    if (row.target === 'scene:save') {
        (async () => {
            try {
                const json = JSON.stringify(serializeScene(), null, 2);
                const filename = await SaveScenePreset(json);
                setStatus(`✓ 场景已保存: ${filename}`, true);
                reRenderSceneMenu();
            } catch (err) {
                setStatus('✗ 保存失败', false);
                console.error('Save scene error:', err);
            }
        })();
        return;
    }
}

// ======== Show Scene Menu ========

export async function showSceneMenu(): Promise<void> {
    dom.sceneOverlay.classList.remove('sceneOverlay-model', 'sceneOverlay-motion', 'sceneOverlay-settings');
    dom.sceneOverlay.dataset.popupType = 'scene';

    const wrapper = getMenuWrapper('scene-menu');
    if (sceneMenu) {
        sceneMenu.resetToRoot();
        sceneMenu.reRender();
        return;
    }

    sceneMenu = new SlideMenu({
        container: wrapper,
        onClose: () => closeAllOverlays(),
        onItemClick: (row) => handleSceneAction(row),
        onFolderEnter: sceneOnFolderEnter,
        onAfterRender: () => {},
    });

    sceneMenu.reset(buildSceneRoot());
}

// Wire up events in main.ts:243-244 — do NOT re-register here.
