// [doc:architecture] Scene Physics Levels — 物理设置子页（场景弹窗域）
// 从 scene-menu.ts 引用，独立管理全局物理参数（WASM Bullet）

import type { PopupLevel } from '../core/config';
import { focusedModelId, cardContainer } from '../core/config';
import {
    getGravityStrength,
    setGravityStrength,
    getGroundCollisionEnabled,
    setGroundCollisionEnabled,
} from '../scene/env/env-bridge';
import {
    modelManager,
    setModelWireframe,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
} from '../scene/scene';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { refreshSceneRoot } from './scene-menu-state';
import { addSliderRow, addToggleRow } from '../core/ui-helpers';

/**
 * 增量更新 toggle 行的 DOM 状态（不触发 reRender）。
 * 通过 rowKey 定位行 DOM，翻转 switch 类名。
 */
function _patchToggle(target: string, newValue: boolean): void {
    const row = document.querySelector(`[data-row-key="${target}"]`) as HTMLElement | null;
    if (!row) {
        return;
    }
    const sw = row.querySelector('.switch');
    if (sw) {
        sw.classList.toggle('on', newValue);
        sw.classList.toggle('off', !newValue);
    }
}

/** 构建 WASM 物理子页（Bullet 骨髁物理 — per-model） */
export function buildPhysicsLevel(): PopupLevel {
    return buildWasmPhysicsLevel();
}

function buildWasmPhysicsSchema(): MenuNode[] {
    // 场景级全局参数（重力强度 + 地面碰撞）。
    // 模型级调试（线框/骨骼线/骨骼关节）已迁移至模型详情页「故障排除」折叠组。
    return [
        {
            id: 'wasm:global',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSliderRow(
                        inner,
                        t('scene.gravityStrength'),
                        getGravityStrength(),
                        0,
                        2,
                        0.05,
                        () => {},
                        'lucide:arrow-down',
                        (v) => setGravityStrength(v)
                    );
                });
            },
        },
        {
            id: 'wasm:ground',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addToggleRow(
                        inner,
                        t('scene.groundCollision'),
                        getGroundCollisionEnabled(),
                        (v) => {
                            setGroundCollisionEnabled(v);
                            refreshSceneRoot();
                            _patchToggle('wasm:ground', v);
                        },
                        'lucide:square',
                        { bind: () => getGroundCollisionEnabled() }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

/** 构建 WASM 物理子页（Bullet 骨髁物理信息 + 全局开关） */
export function buildWasmPhysicsLevel(): PopupLevel {
    return {
        label: t('scene.wasmPhysics'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildWasmPhysicsSchema(), container);
        },
    };
}

function buildPhysicsDebugSchema(): MenuNode[] {
    const id = focusedModelId;
    const inst = id ? modelManager.get(id) : null;

    return [
        {
            id: 'debug:wireframe',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addToggleRow(
                        inner,
                        t('scene.matWireframe'),
                        inst?.wireframe ?? false,
                        (v) => {
                            if (id) {
                                setModelWireframe(id, v);
                            }
                            _patchToggle('debug:wireframe', v);
                        },
                        'lucide:square',
                        { bind: () => inst?.wireframe ?? false }
                    );
                    addToggleRow(
                        inner,
                        t('scene.boneLines'),
                        inst?.showBoneLines ?? false,
                        (v) => {
                            if (id) {
                                setModelBoneLinesVis(id, v);
                            }
                            _patchToggle('debug:bonelines', v);
                        },
                        'lucide:git-branch',
                        { bind: () => inst?.showBoneLines ?? false }
                    );
                    addToggleRow(
                        inner,
                        t('scene.boneJoints'),
                        inst?.showBoneJoints ?? false,
                        (v) => {
                            if (id) {
                                setModelBoneJointsVis(id, v);
                            }
                            _patchToggle('debug:bonejoints', v);
                        },
                        'lucide:circle-dot',
                        { bind: () => inst?.showBoneJoints ?? false }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

/** 构建物理调试子页（材质线框/骨骼 — WASM 相关，由模型详情页调用） */
export function buildPhysicsDebugLevel(): PopupLevel {
    return {
        label: t('scene.debug'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildPhysicsDebugSchema(), container);
        },
    };
}
