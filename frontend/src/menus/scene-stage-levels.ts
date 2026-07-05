// [doc:architecture] Scene Stage Levels — 舞台管理/舞台变换弹窗层级
// 从 scene-render-levels.ts 拆分

import { setStatus, cardContainer, modelRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { showConfirm } from '../core/dialog';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addSectionTitle,
} from '../core/ui-helpers';
import {
    getModelPosition,
    removeModel,
    setModelVisibility,
    setModelPosition,
    setModelScaling,
    setModelRotationY,
    resetModelTransform,
} from '../scene/manager/model-ops';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';
import { buildStageLightLevel } from './scene-stage-lights';
import { buildPropLevel } from './scene-prop-levels';

// ======== 舞台根面板：舞台加载、灯光、道具 ========

export function buildStageLevel(): PopupLevel {
    return {
        label: '舞台',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');

            // —— 卡片 1：功能入口 ——
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:upload', '加载舞台', true, () => {
                    (async () => {
                        try {
                            const { libraryRoot } = await import('../core/config');
                            if (!libraryRoot) {
                                setStatus('✗ 请先在设置中配置模型库目录', false);
                                return;
                            }
                            const { buildLevel } = await import('./library-core');
                            const level = buildLevel(
                                libraryRoot,
                                '舞台',
                                (m) => m.type === 'stage' || m.type === 'scene'
                            );
                            const sm = getSceneMenu();
                            if (sm) sm.push(level);
                        } catch (err) {
                            setStatus('✗ 打开舞台库失败', false);
                            console.error('Stage library error:', err);
                        }
                    })();
                });
                slideRow(c, 'lucide:lightbulb', '舞台灯光', true, () => {
                    const sm = getSceneMenu();
                    if (sm) sm.push(buildStageLightLevel());
                });
                slideRow(c, 'lucide:box', '舞台道具', true, () => {
                    const sm = getSceneMenu();
                    if (sm) sm.push(buildPropLevel());
                });
            });

            // —— 卡片 2：已加载舞台列表 ——
            const stageModels = Array.from(modelRegistry.entries())
                .filter(([, inst]) => inst.kind === 'stage');

            if (stageModels.length > 0) {
                cardContainer(container, (c) => {
                    addSectionTitle(c, '已加载舞台');

                    for (const [id, inst] of stageModels) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.style.cursor = 'pointer';

                        // 眼睛 toggle
                        const eyeSpan = document.createElement('span');
                        eyeSpan.className = 'slide-icon';
                        const eyeIcon = createIconifyIcon(
                            inst.visible ? 'lucide:eye' : 'lucide:eye-off'
                        );
                        if (eyeIcon) eyeSpan.appendChild(eyeIcon);
                        eyeSpan.style.cursor = 'pointer';
                        eyeSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const newVis = !inst.visible;
                            setModelVisibility(id, newVis);
                            reRenderSceneMenu();
                            setStatus(newVis ? '✓ 舞台已显示' : '✓ 舞台已隐藏', true);
                        });
                        row.appendChild(eyeSpan);

                        // 名称
                        const label = document.createElement('span');
                        label.className = 'slide-label';
                        label.textContent = inst.name;
                        row.appendChild(label);

                        // 箭头
                        const arrow = document.createElement('span');
                        arrow.className = 'slide-arrow';
                        arrow.textContent = '>';
                        row.appendChild(arrow);

                        // 删除按钮
                        const del = document.createElement('span');
                        del.textContent = '✕';
                        del.style.cssText = 'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 4px;margin-left:4px;';
                        del.title = '卸载此舞台';
                        del.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            if (!(await showConfirm(`确定卸载舞台「${inst.name}」？`))) return;
                            removeModel(id);
                            reRenderSceneMenu();
                            setStatus(`✓ 已卸载: ${inst.name}`, true);
                        });
                        row.appendChild(del);

                        // 点击进入变换面板
                        row.addEventListener('click', () => {
                            const sm = getSceneMenu();
                            if (sm) sm.push(buildStageTransformLevel(id));
                        });

                        c.appendChild(row);
                    }
                });
            } else {
                cardContainer(container, (c) => {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'font-size:11px;color:var(--text-dim);text-align:center;padding:8px 0;';
                    empty.textContent = '暂无已加载舞台，点击上方加载';
                    c.appendChild(empty);
                });
            }
        },
    };
}

// ======== Stage Transform Panel ========

export function buildStageTransformLevel(id: string): PopupLevel {
    const inst = modelRegistry.get(id);
    const name = inst?.name ?? id;
    const pos = inst ? getModelPosition(id) : [0, 0, 0];
    const scaling = inst?.scaling ?? 1;
    const rotationY = inst?.rotationY ?? 0;

    return {
        label: `舞台: ${name}`,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                // 可见性
                addToggleRow(c, '可见', inst?.visible ?? true, (v) => {
                    setModelVisibility(id, v);
                }, 'lucide:eye');

                // 位置
                const posFields: Array<{ label: string; key: 0 | 1 | 2; icon: string }> = [
                    { label: 'X', key: 0, icon: 'lucide:move-horizontal' },
                    { label: 'Y', key: 1, icon: 'lucide:move-vertical' },
                    { label: 'Z', key: 2, icon: 'lucide:move' },
                ];
                for (const f of posFields) {
                    addSliderRow(c, f.label, pos[f.key], -50, 50, 0.5, () => {}, f.icon,
                        (v) => {
                            const p = getModelPosition(id);
                            p[f.key] = v;
                            setModelPosition(id, p[0], p[1], p[2]);
                        });
                }

                // 缩放
                addSliderRow(c, '缩放', scaling, 0.1, 10, 0.1, () => {}, 'lucide:maximize',
                    (v) => setModelScaling(id, v));

                // 旋转 Y
                addSliderRow(c, '旋转 Y', rotationY, -Math.PI, Math.PI, 0.05, () => {}, 'lucide:rotate-cw',
                    (v) => setModelRotationY(id, v));
            });

            // —— 重置 + 删除 ——
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:rotate-ccw', '重置变换', false, () => {
                    resetModelTransform(id);
                    reRenderSceneMenu();
                    setStatus('✓ 舞台变换已重置', true);
                });

                const delRow = document.createElement('div');
                delRow.className = 'slide-item';
                delRow.style.color = '#ff6b6b';
                const delIcon = document.createElement('span');
                delIcon.className = 'slide-icon';
                const delIconEl = createIconifyIcon('lucide:trash-2');
                if (delIconEl) delIcon.appendChild(delIconEl);
                delRow.appendChild(delIcon);
                const delLabel = document.createElement('span');
                delLabel.className = 'slide-label';
                delLabel.textContent = '卸载此舞台';
                delRow.appendChild(delLabel);
                delRow.addEventListener('click', async () => {
                    if (!(await showConfirm(`确定卸载舞台「${name}」？`))) return;
                    removeModel(id);
                    const sm = getSceneMenu();
                    if (sm) sm.pop();
                    reRenderSceneMenu();
                    setStatus(`✓ 已卸载: ${name}`, true);
                });
                c.appendChild(delRow);
            });
        },
    };
}
