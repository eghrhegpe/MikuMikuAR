// [doc:architecture] Resource Detail Helpers — 资源详情面板公共区块构建器
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 抽离 actor/stage/prop 详情面板的公共区块（变换/材质/危险）
// 现状: stage/prop 详情面板改为薄壳调用本模块；model-detail 因结构差异大保持现状

import { cardContainer, setStatus, modelRegistry, propRegistry } from '../core/config';
import { t } from '../core/i18n/t';
import { slideRow, addSliderRow, addToggleRow, addModeRow, addDangerRow } from '../core/ui-helpers';
import {
    getModelPosition,
    setModelPosition,
    setModelScaling,
    setModelRotationY,
    setModelVisibility,
    setModelOpacity,
    resetModelTransform,
    removeModel,
    getModelOrbit,
    setModelOrbit,
    getModelPositionMode,
    setModelPositionMode,
} from '../scene/manager/model-ops';
import {
    setPropTransform,
    removeProp,
    setPropOrbit,
    getPropOrbit,
    setPropPositionMode,
    getPropPositionMode,
} from '../scene/scene';
import { buildMatRootLevel } from './model-material';
import type { SlideMenu } from './menu';
import type { ResourceKind } from '../core/load-manager';

export interface ResourceHandle {
    id: string;
    kind: ResourceKind;
    name: string;
}

/** 变换区块：可见性 + 坐标模式（笛卡尔/轨道）+ 对应滑条 + 缩放 + 旋转 Y
 *  按 kind 派发到 model-ops（actor/stage）或 prop-ops（prop）
 *  [doc:adr-049] 轨道模式以方位角/仰角/距离绕原点定位；切换模式时反推对方坐标，无跳变。 */
export function buildTransformCard(container: HTMLElement, handle: ResourceHandle): void {
    const { id, kind } = handle;
    const POSITION_MODE_OPTS = [
        { value: 'cartesian' as const, label: '笛卡尔' },
        { value: 'orbit' as const, label: '轨道' },
    ];

    // 自管理子容器：render() 仅清空本卡片内容，避免误伤同一 container 内
    // 由 buildModelLevel 先追加的折叠组/危险卡（它们共享同一 container）。
    const root = document.createElement('div');
    root.style.display = 'contents';
    container.appendChild(root);

    const render = (): void => {
        root.innerHTML = '';

        if (kind === 'actor' || kind === 'stage') {
            const inst = modelRegistry.get(id);
            if (!inst) {
                return;
            }
            const mode = getModelPositionMode(id);
            const scaling = inst.scaling ?? 1;
            const rotationY = inst.rotationY ?? 0;

            cardContainer(root, (c) => {
                // [audit-fix] 用连续透明度滑块替代布尔「可见」开关，与 model-detail
                // 信息区三态「可见性」预设（显示/半透明/隐藏）形成粗调+细调互补，
                // 消除同一面板内的重复可见性控制；stage/prop 亦直接受益。
                addSliderRow(
                    c,
                    '透明度',
                    Math.round((inst.opacity ?? 1) * 100),
                    0,
                    100,
                    1,
                    () => {},
                    'lucide:eye',
                    (v) => {
                        setModelOpacity(id, v / 100);
                        if (v > 0) {
                            setModelVisibility(id, true);
                        }
                    }
                );
                addModeRow(c, '坐标模式', POSITION_MODE_OPTS, mode, (v) => {
                    setModelPositionMode(id, v as 'cartesian' | 'orbit');
                    render();
                });
                if (mode === 'orbit') {
                    const o = getModelOrbit(id) ?? { azimuth: 0, elevation: 0, distance: 10 };
                    addSliderRow(
                        c,
                        '方位角',
                        o.azimuth,
                        -180,
                        180,
                        1,
                        () => {},
                        'lucide:compass',
                        (v) => setModelOrbit(id, v, o.elevation, o.distance)
                    );
                    addSliderRow(
                        c,
                        '仰角',
                        o.elevation,
                        -90,
                        90,
                        1,
                        () => {},
                        'lucide:arrow-up',
                        (v) => setModelOrbit(id, o.azimuth, v, o.distance)
                    );
                    addSliderRow(
                        c,
                        '距离',
                        o.distance,
                        0.1,
                        100,
                        0.5,
                        () => {},
                        'lucide:move',
                        (v) => setModelOrbit(id, o.azimuth, o.elevation, v)
                    );
                } else {
                    const pos = getModelPosition(id);
                    addSliderRow(
                        c,
                        'X',
                        pos[0],
                        -50,
                        50,
                        0.5,
                        () => {},
                        'lucide:move-horizontal',
                        (v) => setModelPosition(id, v, pos[1], pos[2])
                    );
                    addSliderRow(
                        c,
                        'Y',
                        pos[1],
                        -50,
                        50,
                        0.5,
                        () => {},
                        'lucide:move-vertical',
                        (v) => setModelPosition(id, pos[0], v, pos[2])
                    );
                    addSliderRow(
                        c,
                        'Z',
                        pos[2],
                        -50,
                        50,
                        0.5,
                        () => {},
                        'lucide:move',
                        (v) => setModelPosition(id, pos[0], pos[1], v)
                    );
                }
                addSliderRow(
                    c,
                    '缩放',
                    scaling,
                    0.1,
                    10,
                    0.1,
                    () => {},
                    'lucide:maximize',
                    (v) => setModelScaling(id, v)
                );
                addSliderRow(
                    c,
                    '旋转 Y',
                    rotationY,
                    -Math.PI,
                    Math.PI,
                    0.05,
                    () => {},
                    'lucide:rotate-cw',
                    (v) => setModelRotationY(id, v)
                );
            });
            return;
        }

        if (kind === 'prop') {
            const p = propRegistry.get(id);
            if (!p) {
                return;
            }
            const mode = getPropPositionMode(id);

            cardContainer(root, (c) => {
                addModeRow(c, '坐标模式', POSITION_MODE_OPTS, mode, (v) => {
                    setPropPositionMode(id, v as 'cartesian' | 'orbit');
                    render();
                });
                if (mode === 'orbit') {
                    const o = getPropOrbit(id) ?? { azimuth: 0, elevation: 0, distance: 10 };
                    addSliderRow(
                        c,
                        '方位角',
                        o.azimuth,
                        -180,
                        180,
                        1,
                        () => {},
                        'lucide:compass',
                        (v) => setPropOrbit(id, v, o.elevation, o.distance)
                    );
                    addSliderRow(
                        c,
                        '仰角',
                        o.elevation,
                        -90,
                        90,
                        1,
                        () => {},
                        'lucide:arrow-up',
                        (v) => setPropOrbit(id, o.azimuth, v, o.distance)
                    );
                    addSliderRow(
                        c,
                        '距离',
                        o.distance,
                        0.1,
                        100,
                        0.5,
                        () => {},
                        'lucide:move',
                        (v) => setPropOrbit(id, o.azimuth, o.elevation, v)
                    );
                } else {
                    addSliderRow(
                        c,
                        '位置 X',
                        p.position[0],
                        -50,
                        50,
                        0.5,
                        () => {},
                        'lucide:move-horizontal',
                        (v) => setPropTransform(id, { position: [v, p.position[1], p.position[2]] })
                    );
                    addSliderRow(
                        c,
                        '位置 Y',
                        p.position[1],
                        -50,
                        50,
                        0.5,
                        () => {},
                        'lucide:move-vertical',
                        (v) => setPropTransform(id, { position: [p.position[0], v, p.position[2]] })
                    );
                    addSliderRow(
                        c,
                        '位置 Z',
                        p.position[2],
                        -50,
                        50,
                        0.5,
                        () => {},
                        'lucide:move',
                        (v) => setPropTransform(id, { position: [p.position[0], p.position[1], v] })
                    );
                }
                addSliderRow(
                    c,
                    '旋转 Y',
                    p.rotationY,
                    -Math.PI,
                    Math.PI,
                    0.1,
                    () => {},
                    'lucide:rotate-cw',
                    (v) => setPropTransform(id, { rotationY: v })
                );
                addSliderRow(
                    c,
                    '缩放',
                    p.scaling,
                    0.1,
                    10,
                    0.1,
                    () => {},
                    'lucide:maximize',
                    (v) => {
                        p.scaling = v;
                        setPropTransform(id, { scaling: v });
                    }
                );
                addToggleRow(c, '可见', p.visible, (v) => {
                    setPropTransform(id, { visible: v });
                    p.visible = v;
                });
            });
        }
    };

    render();
}

/** 材质区块：进入材质调节子层级 */
export function buildMaterialCard(
    container: HTMLElement,
    handle: ResourceHandle,
    targetStack: SlideMenu | null
): void {
    cardContainer(container, (c) => {
        slideRow(c, 'lucide:palette', '材质调节', true, () => {
            const level = buildMatRootLevel(handle.id, handle.name, targetStack);
            targetStack?.push(level);
        });
    });
}

/** 危险区块：卸载资源（带确认对话框）
 *  onRemoved 可选回调，用于卸载后弹窗导航（如 pop 到上一级） */
export function buildDangerCard(
    container: HTMLElement,
    handle: ResourceHandle,
    onRemoved?: () => void
): void {
    const { id, kind, name } = handle;
    cardContainer(container, (c) => {
        // stage/actor 提供"重置变换"
        if (kind === 'actor' || kind === 'stage') {
            slideRow(c, 'lucide:rotate-ccw', t('settings.transformReset'), false, () => {
                resetModelTransform(id);
                setStatus(
                    t('settings.transformReset', {
                        kind: kind === 'stage' ? t('common.stage') : t('common.model'),
                    }),
                    true
                );
                onRemoved?.();
            });
        }
        addDangerRow(
            c,
            'lucide:trash-2',
            `卸载此${kind === 'prop' ? '道具' : kind === 'stage' ? '舞台' : '模型'}`,
            () => {
                if (kind === 'prop') {
                    removeProp(id);
                } else {
                    removeModel(id);
                }
                onRemoved?.();
                setStatus(t('settings.unloaded', { name }), true);
            }
        );
    });
}

/** 派发到对应 registry 查 ResourceHandle（供 UI 层从 id+kind 构造 handle） */
export function getResourceHandle(id: string, kind: ResourceKind): ResourceHandle | null {
    if (kind === 'actor' || kind === 'stage') {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return null;
        }
        return { id, kind, name: inst.name };
    }
    if (kind === 'prop') {
        const p = propRegistry.get(id);
        if (!p) {
            return null;
        }
        return { id, kind, name: p.name };
    }
    return null;
}
