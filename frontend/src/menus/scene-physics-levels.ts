// [doc:architecture] Scene Physics Levels — 物理设置子页（场景弹窗域）
// 从 scene-menu.ts 引用，独立管理全局物理参数（WASM Bullet）

import type { PopupLevel } from '../core/config';
import {
    focusedModelId,
    cardContainer,
    getMmdRuntimeType,
    setMmdRuntimeType,
} from '../core/config';
import { getGravityStrength, setGravityStrength } from '../scene/env/env-bridge';
import {
    modelManager,
    setModelWireframe,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
} from '../scene/scene';
import {
    getCollisionEnabled,
    setCollisionEnabled,
    getBodyCollisionEnabled,
    setBodyCollisionEnabled,
    getGroundCollisionEnabled,
    setGroundCollisionEnabled,
} from '../scene/env/env-bridge';
import {
    getPhysicsCategories,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
    setModelPhysics,
} from '../scene/scene';
import { getSceneMenu, refreshSceneRoot } from './scene-menu';
import { showConfirm } from '../core/dialog';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import {
    slideRow,
    addSliderRow,
    addToggleRow,
    addEmptyRow,
    addModeSlider,
} from '../core/ui-helpers';

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

function buildCollisionSchema(): MenuNode[] {
    return [
        {
            id: 'collision:ground',
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
                            _patchToggle('collision:ground', v);
                        },
                        'lucide:square',
                        { bind: () => getGroundCollisionEnabled() }
                    );
                    addToggleRow(
                        inner,
                        t('scene.bodyCollision'),
                        getBodyCollisionEnabled(),
                        (v) => {
                            setBodyCollisionEnabled(v);
                            refreshSceneRoot();
                            _patchToggle('collision:body', v);
                        },
                        'lucide:accessibility',
                        { bind: () => getBodyCollisionEnabled() }
                    );
                });
            },
        },
    ];
}

/** 构建碰撞子页（地面碰撞 + 身体碰撞） */
export function buildCollisionLevel(): PopupLevel {
    return {
        label: t('scene.collision'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildCollisionSchema(), container);
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
    ];
}

/** 构建物理调试子页（材质线框/骨骼 — WASM 相关） */
export function buildPhysicsDebugLevel(): PopupLevel {
    return {
        label: t('scene.debug'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildPhysicsDebugSchema(), container);
        },
    };
}

function buildWasmPhysicsSchema(): MenuNode[] {
    const id = focusedModelId;
    const inst = id ? modelManager.get(id) : null;

    const CAT_KEYS: Record<string, string> = {
        skirt: 'scene.catSkirt',
        chest: 'scene.catChest',
        hair: 'scene.catHair',
        accessory: 'scene.catAccessory',
    };
    const CAT_ICONS: Record<string, string> = {
        skirt: 'lucide:shirt',
        chest: 'lucide:heart',
        hair: 'lucide:person-standing',
        accessory: 'lucide:gem',
    };

    const nodes: MenuNode[] = [
        // 运行时切换 + 重力强度
        {
            id: 'wasm:global',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addModeSlider(
                        inner,
                        t('scene.runtime'),
                        [
                            { value: 'wasm', label: t('scene.runtimeWasm') },
                            { value: 'js', label: t('scene.runtimeJs') },
                        ],
                        getMmdRuntimeType(),
                        (v) => {
                            if (v === getMmdRuntimeType()) {
                                return;
                            }
                            (async () => {
                                const ok = await showConfirm(
                                    v === 'js' ? t('scene.confirmJs') : t('scene.confirmWasm')
                                );
                                if (!ok) {
                                    getSceneMenu()?.updateControls();
                                    return;
                                }
                                setMmdRuntimeType(v as 'wasm' | 'js');
                                location.reload();
                            })();
                        },
                        'lucide:cpu',
                        undefined,
                        { bind: () => getMmdRuntimeType() }
                    );
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
    ];

    if (!id || !inst) {
        nodes.push({
            id: 'wasm:empty',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addEmptyRow(inner, t('scene.loadModelFirst'));
                });
            },
        });
        return nodes;
    }

    // 模型物理总开关 + 类别
    const categories = getPhysicsCategories(id);
    nodes.push({
        id: 'wasm:model',
        kind: 'custom',
        renderCustom: (c) => {
            cardContainer(c, (inner) => {
                addToggleRow(
                    inner,
                    t('scene.physicsParse', { name: inst.name }),
                    inst.physicsEnabled,
                    (v) => {
                        setModelPhysics(id, v);
                        _patchToggle('wasm:master', v);
                    },
                    'lucide:atom',
                    { bind: () => inst.physicsEnabled }
                );
                if (categories.length === 0) {
                    addEmptyRow(inner, t('scene.noRigidBody'));
                } else {
                    for (const cat of categories) {
                        addToggleRow(
                            inner,
                            t(CAT_KEYS[cat] || cat),
                            isPhysicsCategoryEnabled(id, cat),
                            (v) => {
                                setPhysicsCategory(id, cat, v);
                                _patchToggle(`wasm:cat:${cat}`, v);
                            },
                            CAT_ICONS[cat] || 'lucide:settings',
                            { bind: () => isPhysicsCategoryEnabled(id, cat) }
                        );
                    }
                }
            });
        },
    });

    // 调试入口
    nodes.push({
        id: 'wasm:debug',
        kind: 'custom',
        renderCustom: (c) => {
            slideRow(c, 'lucide:bug', t('scene.debug'), true, () => {
                getSceneMenu()?.push(buildPhysicsDebugLevel());
            });
        },
    });

    return nodes;
}

/** 构建 WASM 物理子页（Bullet 骨髁物理信息 + 总开关） */
export function buildWasmPhysicsLevel(): PopupLevel {
    return {
        label: t('scene.wasmPhysics'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildWasmPhysicsSchema(), container);
        },
    };
}
