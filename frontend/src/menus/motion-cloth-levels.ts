// [doc:adr-084] Virtual Skirt Levels — 虚拟裙骨（Mesh-to-Cloth）参数面板
// ADR-084 约束：本文件顶层仅 type-only import virtual-skirt，运行时类经
// `await import('../scene/physics/virtual-skirt')` 在用户开启时才加载，
// 不污染启动期，也不被 scene.ts 主链 eager 导入。

import type { PopupLevel } from '../core/config';
import { setStatus, cardContainer } from '../core/config';
import { addSliderRow, addToggleRow } from '../core/ui-helpers';
import { scene, modelManager } from '../scene/scene';
import { mmdRuntime } from '../core/state';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import type { VirtualSkirtConfig } from '../scene/physics/virtual-skirt';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t';

// 与 virtual-skirt.ts 的 defaultVirtualSkirtConfig 保持同源契约；
// 字段稳定，UI 默认值在此声明，引擎默认值在 virtual-skirt.ts。
const DEFAULT_SKIRT_CONFIG: VirtualSkirtConfig = {
    enabled: false,
    chains: 12,
    segmentsPerChain: 8,
    stiffness: 50,
    damping: 0.3,
    mass: 0.05,
    radius: 0,
    maxVertices: 2000,
    skirtYRatio: 0.3,
};

/** 每模型一个虚拟裙骨控制器；key = ModelManager 中的 modelId */
const controllers = new Map<string, import('../scene/physics/virtual-skirt').VirtualSkirtController>();
let skirtConfig: VirtualSkirtConfig = { ...DEFAULT_SKIRT_CONFIG };
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

function getRuntime(): MmdWasmRuntime | null {
    return (mmdRuntime as unknown as MmdWasmRuntime) ?? null;
}

function refreshClothLevel(): void {
    const menu = getMotionMenu();
    if (menu) {
        menu.reRender();
    }
}

/** 释放全部虚拟裙骨控制器 */
export function disposeAllVirtualSkirts(): void {
    if (rebuildTimer !== null) {
        clearTimeout(rebuildTimer);
        rebuildTimer = null;
    }
    for (const ctrl of controllers.values()) {
        ctrl.dispose();
    }
    controllers.clear();
}

/** 释放指定模型的虚拟裙骨控制器（供模型卸载流程调用） */
export function disposeVirtualSkirtForModel(modelId: string): void {
    const ctrl = controllers.get(modelId);
    if (ctrl) {
        ctrl.dispose();
        controllers.delete(modelId);
    }
}

/**
 * 重建全部虚拟裙骨：先 dispose 旧控制器，再对所有已加载 actor 模型注入。
 * 有裙骨的模型 build() 返回 false（自动跳过），无裙骨模型注入弹簧链。
 */
async function rebuildAll(): Promise<void> {
    disposeAllVirtualSkirts();
    if (!skirtConfig.enabled) {
        return;
    }
    const rt = getRuntime();
    if (!rt || !rt.physics) {
        setStatus(t('cloth.noRuntime'), false);
        return;
    }
    const { VirtualSkirtController } = await import('../scene/physics/virtual-skirt');

    let injected = 0;
    let skipped = 0;
    for (const [id, inst] of modelManager.modelRegistry) {
        if (inst.kind !== 'actor' || !inst.mmdModel) {
            continue;
        }
        try {
            const ctrl = new VirtualSkirtController(inst.mmdModel, scene, rt, skirtConfig);
            if (ctrl.build()) {
                controllers.set(id, ctrl);
                injected++;
            } else {
                skipped++;
            }
        } catch (e) {
            console.warn('[virtual-skirt] build failed for', id, e);
            skipped++;
        }
    }

    if (injected > 0) {
        setStatus(t('cloth.applied', { n: injected }), true);
    } else if (skirtConfig.enabled) {
        setStatus(t('cloth.skippedAll'), false);
    }
    refreshClothLevel();
}

/** 参数变更后的防抖重建（仅启用时调度） */
function scheduleRebuild(): void {
    if (!skirtConfig.enabled) {
        return;
    }
    if (rebuildTimer !== null) {
        clearTimeout(rebuildTimer);
    }
    rebuildTimer = setTimeout(() => {
        rebuildTimer = null;
        void rebuildAll();
    }, 200);
}

export function buildVirtualSkirtLevel(): PopupLevel {
    return {
        label: t('cloth.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            // === Card: 开关 ===
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('cloth.enable'),
                    skirtConfig.enabled,
                    (v) => {
                        skirtConfig = { ...skirtConfig, enabled: v };
                        if (v) {
                            void rebuildAll();
                        } else {
                            disposeAllVirtualSkirts();
                        }
                        refreshClothLevel();
                    },
                    'lucide:shirt',
                    { bind: () => skirtConfig.enabled }
                );
                if (!skirtConfig.enabled) {
                    const hint = document.createElement('div');
                    hint.className = 'cs-hint';
                    hint.textContent = t('cloth.hint');
                    c.appendChild(hint);
                }
            });

            // === Card: 参数（仅启用时实际生效）===
            if (skirtConfig.enabled) {
                cardContainer(container, (c) => {
                    addSliderRow(
                        c,
                        t('cloth.chains'),
                        skirtConfig.chains,
                        4,
                        32,
                        1,
                        (v) => {
                            skirtConfig = { ...skirtConfig, chains: Math.round(v) };
                            scheduleRebuild();
                        },
                        'lucide:git-branch'
                    );
                    addSliderRow(
                        c,
                        t('cloth.segments'),
                        skirtConfig.segmentsPerChain,
                        4,
                        16,
                        1,
                        (v) => {
                            skirtConfig = { ...skirtConfig, segmentsPerChain: Math.round(v) };
                            scheduleRebuild();
                        },
                        'lucide:layers'
                    );
                    addSliderRow(
                        c,
                        t('cloth.stiffness'),
                        skirtConfig.stiffness,
                        10,
                        200,
                        1,
                        (v) => {
                            skirtConfig = { ...skirtConfig, stiffness: Math.round(v) };
                            scheduleRebuild();
                        },
                        'lucide:spring'
                    );
                    addSliderRow(
                        c,
                        t('cloth.damping'),
                        skirtConfig.damping,
                        0,
                        1,
                        0.05,
                        (v) => {
                            skirtConfig = { ...skirtConfig, damping: v };
                            scheduleRebuild();
                        },
                        'lucide:waves'
                    );
                    addSliderRow(
                        c,
                        t('cloth.mass'),
                        skirtConfig.mass,
                        0.01,
                        0.5,
                        0.01,
                        (v) => {
                            skirtConfig = { ...skirtConfig, mass: v };
                            scheduleRebuild();
                        },
                        'lucide:weight'
                    );
                    addSliderRow(
                        c,
                        t('cloth.yRatio'),
                        skirtConfig.skirtYRatio,
                        0.1,
                        0.6,
                        0.05,
                        (v) => {
                            skirtConfig = { ...skirtConfig, skirtYRatio: v };
                            scheduleRebuild();
                        },
                        'lucide:ruler'
                    );
                    addSliderRow(
                        c,
                        t('cloth.radius'),
                        skirtConfig.radius,
                        0,
                        0.1,
                        0.005,
                        (v) => {
                            skirtConfig = { ...skirtConfig, radius: v };
                            scheduleRebuild();
                        },
                        'lucide:circle'
                    );
                });
            }

            // === Card: 状态 ===
            cardContainer(container, (c) => {
                const stat = document.createElement('div');
                stat.className = 'cs-hint';
                stat.textContent = t('cloth.status', { n: controllers.size });
                c.appendChild(stat);
            });
        },
    };
}
