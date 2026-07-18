// [doc:adr-084] Virtual Skirt Levels — 虚拟裙骨（Mesh-to-Cloth）参数面板
// ADR-084 约束：本文件顶层仅 type-only import virtual-skirt，运行时类经
// `await import('../scene/physics/virtual-skirt')` 在用户开启时才加载，
// 不污染启动期，也不被 scene.ts 主链 eager 导入。

import type { PopupLevel } from '../core/config';
import { setStatus, cardContainer, focusedModelId } from '../core/config';
import { addSliderRow, addToggleRow, addModeRow } from '../core/ui-helpers';
import { scene, modelManager } from '../scene/scene';
import { mmdRuntime } from '../core/state';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import type { VirtualSkirtConfig } from '../scene/physics/virtual-skirt';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { logWarn, DebouncedTimer } from '../core/utils';

// 与 virtual-skirt.ts 的 defaultVirtualSkirtConfig 保持同源契约；
// 字段稳定，UI 默认值在此声明，引擎默认值在 virtual-skirt.ts。
const DEFAULT_SKIRT_CONFIG: VirtualSkirtConfig = {
    enabled: false,
    quality: 'auto',
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
const controllers = new Map<
    string,
    import('../scene/physics/virtual-skirt').VirtualSkirtController
>();
/** 每模型一个虚拟裙骨配置，key = modelId；避免多模型共享同一份全局单例 */
const skirtConfigs = new Map<string, VirtualSkirtConfig>();
const rebuildTimer = new DebouncedTimer();

function _getSkirtConfig(modelId: string): VirtualSkirtConfig {
    let c = skirtConfigs.get(modelId);
    if (!c) {
        c = { ...DEFAULT_SKIRT_CONFIG };
        skirtConfigs.set(modelId, c);
    }
    return c;
}

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
    rebuildTimer.cancel();
    for (const ctrl of controllers.values()) {
        ctrl.dispose();
    }
    controllers.clear();
}

/** 释放指定模型的虚拟裙骨控制器（供模型卸载流程调用） */
export function disposeVirtualSkirtForModel(modelId: string): void {
    // 契约：本函数在对应模型 destroyMmdModel 之后（微任务）被调用，只操作 controllers，
    // 绝不访问已销毁的 mmdModel 或 modelRegistry。若需模型实例须先加 modelRegistry.get(id) 守卫。
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
    const rt = getRuntime();
    if (!rt || !rt.physics) {
        setStatus(t('cloth.noRuntime'), false);
        return;
    }
    const { VirtualSkirtController } = await import('../scene/physics/virtual-skirt');

    let injected = 0;
    let failed = 0;
    let firstError: unknown = null;
    for (const [id, inst] of modelManager.modelRegistry) {
        if (inst.kind !== 'actor' || !inst.mmdModel) {
            continue;
        }
        const cfg = _getSkirtConfig(id);
        if (!cfg.enabled) {
            continue;
        }
        try {
            const ctrl = new VirtualSkirtController(inst.mmdModel, scene, rt, cfg);
            if (ctrl.build()) {
                controllers.set(id, ctrl);
                injected++;
            }
        } catch (e) {
            failed++;
            if (!firstError) firstError = e;
            console.warn(`虚拟裙骨构建失败 [${id}]:`, e);
            logWarn('virtual-skirt', `build failed for ${id}`, e);
        }
    }

    if (injected > 0 && failed === 0) {
        setStatus(t('cloth.applied', { n: injected }), true);
    } else if (injected > 0 && failed > 0) {
        setStatus(
            t('cloth.applied', { n: injected }) +
                ' · ' +
                t('cloth.buildFailed', { err: firstError instanceof Error ? firstError.message : String(firstError) }),
            false
        );
    } else if (failed > 0) {
        setStatus(
            t('cloth.buildFailed', { err: firstError instanceof Error ? firstError.message : String(firstError) }),
            false
        );
    } else {
        setStatus(t('cloth.skippedAll'), false);
    }
    refreshClothLevel();
}

/** 参数变更后的防抖重建（仅启用时调度） */
function scheduleRebuild(): void {
    const modelId = focusedModelId;
    if (!modelId) return;
    const cfg = _getSkirtConfig(modelId);
    if (!cfg.enabled) {
        return;
    }
    rebuildTimer.schedule(() => void rebuildAll(), 200);
}

function buildVirtualSkirtSchema(): MenuNode[] {
    const modelId = focusedModelId;
    const cfg = modelId ? _getSkirtConfig(modelId) : { ...DEFAULT_SKIRT_CONFIG };
    return [
        // 卡片 1：开关
        {
            id: 'cloth:toggle',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addToggleRow(
                        inner,
                        t('cloth.enable'),
                        cfg.enabled,
                        (v) => {
                            cfg.enabled = v;
                            if (v) {
                                void rebuildAll();
                            } else {
                                disposeAllVirtualSkirts();
                            }
                            refreshClothLevel();
                        },
                        'lucide:shirt',
                        { bind: () => cfg.enabled }
                    );
                    if (!cfg.enabled) {
                        const hint = document.createElement('div');
                        hint.className = 'cs-hint';
                        hint.textContent = t('cloth.hint');
                        inner.appendChild(hint);
                    }
                });
            },
        },
        // 卡片 2：参数（仅启用时渲染）
        {
            id: 'cloth:params',
            kind: 'custom',
            visibleWhen: () => cfg.enabled,
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addModeRow(
                        inner,
                        t('cloth.quality'),
                        [
                            { value: 'auto', label: t('cloth.qualityAuto') },
                            { value: 'high', label: t('cloth.qualityHigh') },
                            { value: 'medium', label: t('cloth.qualityMedium') },
                            { value: 'low', label: t('cloth.qualityLow') },
                        ],
                        cfg.quality,
                        (v) => {
                            cfg.quality = v;
                            scheduleRebuild();
                        }
                    );
                    addSliderRow(
                        inner,
                        t('cloth.chains'),
                        cfg.chains,
                        4,
                        32,
                        1,
                        (v) => {
                            cfg.chains = Math.round(v);
                            scheduleRebuild();
                        },
                        'lucide:git-branch'
                    );
                    addSliderRow(
                        inner,
                        t('cloth.segments'),
                        cfg.segmentsPerChain,
                        4,
                        16,
                        1,
                        (v) => {
                            cfg.segmentsPerChain = Math.round(v);
                            scheduleRebuild();
                        },
                        'lucide:layers'
                    );
                    addSliderRow(
                        inner,
                        t('cloth.stiffness'),
                        cfg.stiffness,
                        10,
                        200,
                        1,
                        (v) => {
                            cfg.stiffness = Math.round(v);
                            scheduleRebuild();
                        },
                        'lucide:spring'
                    );
                    addSliderRow(
                        inner,
                        t('cloth.damping'),
                        cfg.damping,
                        0,
                        1,
                        0.05,
                        (v) => {
                            cfg.damping = v;
                            scheduleRebuild();
                        },
                        'lucide:waves'
                    );
                    addSliderRow(
                        inner,
                        t('cloth.mass'),
                        cfg.mass,
                        0.01,
                        0.5,
                        0.01,
                        (v) => {
                            cfg.mass = v;
                            scheduleRebuild();
                        },
                        'lucide:weight'
                    );
                    addSliderRow(
                        inner,
                        t('cloth.yRatio'),
                        cfg.skirtYRatio,
                        0.1,
                        0.6,
                        0.05,
                        (v) => {
                            cfg.skirtYRatio = v;
                            scheduleRebuild();
                        },
                        'lucide:ruler'
                    );
                    addSliderRow(
                        inner,
                        t('cloth.radius'),
                        cfg.radius,
                        0,
                        0.1,
                        0.005,
                        (v) => {
                            cfg.radius = v;
                            scheduleRebuild();
                        },
                        'lucide:circle'
                    );
                });
            },
        },
        // 卡片 3：状态
        {
            id: 'cloth:status',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const stat = document.createElement('div');
                    stat.className = 'cs-hint';
                    const first = controllers.values().next().value;
                    if (first) {
                        stat.textContent = t('cloth.lodInfo', {
                            quality: t(
                                `cloth.quality${first.effectiveQuality.charAt(0).toUpperCase()}${first.effectiveQuality.slice(1)}`
                            ),
                            chains: first.effectiveChains,
                            segments: first.effectiveSegments,
                            throttle: first.throttleEvery,
                        });
                    } else {
                        stat.textContent = t('cloth.status', { n: 0 });
                    }
                    inner.appendChild(stat);
                });
            },
        },
    ];
}

export function buildVirtualSkirtLevel(): PopupLevel {
    return {
        label: t('cloth.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildVirtualSkirtSchema(), container);
        },
    };
}
