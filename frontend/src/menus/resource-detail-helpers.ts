// [doc:architecture] Resource Detail Helpers — 资源详情面板公共区块构建器
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 抽离 actor/stage/prop 详情面板的公共区块（变换/材质/危险）
// 现状: stage/prop 详情面板改为薄壳调用本模块；model-detail 因结构差异大保持现状

import { cardContainer, setStatus, modelRegistry, propRegistry } from '../core/config';
import { slideRow, addSliderRow, addToggleRow, addDangerRow } from '../core/ui-helpers';
import { showConfirm } from '../core/dialog';
import {
    getModelPosition,
    setModelPosition,
    setModelScaling,
    setModelRotationY,
    setModelVisibility,
    resetModelTransform,
    removeModel,
} from '../scene/manager/model-ops';
import { setPropTransform, removeProp } from '../scene/scene';
import { buildMatRootLevel } from './model-material';
import type { SlideMenu } from './menu';
import type { ResourceKind } from '../core/load-manager';

export interface ResourceHandle {
    id: string;
    kind: ResourceKind;
    name: string;
}

/** 统一的变换字段描述 */
interface TransformField {
    label: string;
    getValue: () => number;
    min: number;
    max: number;
    step: number;
    icon: string;
    setValue: (v: number) => void;
}

/** 变换区块：可见性 + 位置 X/Y/Z + 缩放 + 旋转 Y
 *  按 kind 派发到 model-ops（actor/stage）或 prop-ops（prop） */
export function buildTransformCard(container: HTMLElement, handle: ResourceHandle): void {
    const { id, kind } = handle;

    if (kind === 'actor' || kind === 'stage') {
        const inst = modelRegistry.get(id);
        const pos = getModelPosition(id);
        const scaling = inst?.scaling ?? 1;
        const rotationY = inst?.rotationY ?? 0;

        const fields: TransformField[] = [
            {
                label: 'X', getValue: () => pos[0], min: -50, max: 50, step: 0.5, icon: 'lucide:move-horizontal',
                setValue: (v) => { pos[0] = v; setModelPosition(id, pos[0], pos[1], pos[2]); },
            },
            {
                label: 'Y', getValue: () => pos[1], min: -50, max: 50, step: 0.5, icon: 'lucide:move-vertical',
                setValue: (v) => { pos[1] = v; setModelPosition(id, pos[0], pos[1], pos[2]); },
            },
            {
                label: 'Z', getValue: () => pos[2], min: -50, max: 50, step: 0.5, icon: 'lucide:move',
                setValue: (v) => { pos[2] = v; setModelPosition(id, pos[0], pos[1], pos[2]); },
            },
            {
                label: '缩放', getValue: () => scaling, min: 0.1, max: 10, step: 0.1, icon: 'lucide:maximize',
                setValue: (v) => setModelScaling(id, v),
            },
            {
                label: '旋转 Y', getValue: () => rotationY, min: -Math.PI, max: Math.PI, step: 0.05, icon: 'lucide:rotate-cw',
                setValue: (v) => setModelRotationY(id, v),
            },
        ];

        cardContainer(container, (c) => {
            addToggleRow(c, '可见', inst?.visible ?? true, (v) => setModelVisibility(id, v), 'lucide:eye');
            for (const f of fields) {
                addSliderRow(c, f.label, f.getValue(), f.min, f.max, f.step, () => {}, f.icon, f.setValue);
            }
        });
        return;
    }

    if (kind === 'prop') {
        const p = propRegistry.get(id);
        if (!p) return;
        const fields: TransformField[] = [
            {
                label: '位置 X', getValue: () => p.position[0], min: -50, max: 50, step: 0.5, icon: 'lucide:move-horizontal',
                setValue: (v) => { p.position[0] = v; setPropTransform(id, { position: [v, p.position[1], p.position[2]] }); },
            },
            {
                label: '位置 Y', getValue: () => p.position[1], min: -50, max: 50, step: 0.5, icon: 'lucide:move-vertical',
                setValue: (v) => { p.position[1] = v; setPropTransform(id, { position: [p.position[0], v, p.position[2]] }); },
            },
            {
                label: '位置 Z', getValue: () => p.position[2], min: -50, max: 50, step: 0.5, icon: 'lucide:move',
                setValue: (v) => { p.position[2] = v; setPropTransform(id, { position: [p.position[0], p.position[1], v] }); },
            },
            {
                label: '旋转 Y', getValue: () => p.rotationY, min: -Math.PI, max: Math.PI, step: 0.1, icon: 'lucide:rotate-cw',
                setValue: (v) => { p.rotationY = v; setPropTransform(id, { rotationY: v }); },
            },
            {
                label: '缩放', getValue: () => p.scaling, min: 0.1, max: 10, step: 0.1, icon: 'lucide:maximize',
                setValue: (v) => { p.scaling = v; setPropTransform(id, { scaling: v }); },
            },
        ];
        cardContainer(container, (c) => {
            for (const f of fields) {
                addSliderRow(c, f.label, f.getValue(), f.min, f.max, f.step, (v) => f.setValue(v), f.icon);
            }
            addToggleRow(c, '可见', p.visible, (v) => { setPropTransform(id, { visible: v }); p.visible = v; });
        });
    }
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
            slideRow(c, 'lucide:rotate-ccw', '重置变换', false, () => {
                resetModelTransform(id);
                setStatus(`✓ ${kind === 'stage' ? '舞台' : '模型'}变换已重置`, true);
                onRemoved?.();
            });
        }
        addDangerRow(c, 'lucide:trash-2', `卸载此${kind === 'prop' ? '道具' : kind === 'stage' ? '舞台' : '模型'}`, async () => {
            if (!(await showConfirm(`确定卸载${kind === 'prop' ? '道具' : kind === 'stage' ? '舞台' : '模型'}「${name}」？`))) return;
            if (kind === 'prop') {
                removeProp(id);
            } else {
                removeModel(id);
            }
            onRemoved?.();
            setStatus(`✓ 已卸载: ${name}`, true);
        });
    });
}

/** 派发到对应 registry 查 ResourceHandle（供 UI 层从 id+kind 构造 handle） */
export function getResourceHandle(id: string, kind: ResourceKind): ResourceHandle | null {
    if (kind === 'actor' || kind === 'stage') {
        const inst = modelRegistry.get(id);
        if (!inst) return null;
        return { id, kind, name: inst.name };
    }
    if (kind === 'prop') {
        const p = propRegistry.get(id);
        if (!p) return null;
        return { id, kind, name: p.name };
    }
    return null;
}
