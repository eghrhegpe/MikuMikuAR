// [doc:architecture] Scene Physics Levels — 物理设置子页（场景弹窗域）
// 从 scene-menu.ts 引用，独立管理全局物理参数（WASM Bullet）

import type { PopupLevel, PopupRow } from '../core/config';
import {
    envState,
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
import {
    slideRow,
    addSliderRow,
    addSectionTitle,
    addPresetChip,
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


/** 构建碰撞子页（地面碰撞 + 身体碰撞） */
export function buildCollisionLevel(): PopupLevel {
    return {
        label: t('scene.collision'),
        dir: '',
        items: [
            {
                kind: 'toggle',
                label: t('scene.groundCollision'),
                icon: 'lucide:square',
                target: 'collision:ground',
                toggleValue: getGroundCollisionEnabled(),
                onToggleChange: (v: boolean) => {
                    setGroundCollisionEnabled(v);
                    refreshSceneRoot();
                    _patchToggle('collision:ground', v);
                },
            } as PopupRow,
            {
                kind: 'toggle',
                label: t('scene.bodyCollision'),
                icon: 'lucide:accessibility',
                target: 'collision:body',
                toggleValue: getBodyCollisionEnabled(),
                onToggleChange: (v: boolean) => {
                    setBodyCollisionEnabled(v);
                    refreshSceneRoot();
                    _patchToggle('collision:body', v);
                },
            } as PopupRow,
        ],
    };
}

/** 构建物理调试子页（材质线框/骨骼 — WASM 相关） */
export function buildPhysicsDebugLevel(): PopupLevel {
    const id = focusedModelId;
    const inst = id ? modelManager.get(id) : null;

    return {
        label: t('scene.debug'),
        dir: '',
        items: [
            {
                kind: 'toggle',
                label: t('scene.matWireframe'),
                icon: 'lucide:square',
                target: 'debug:wireframe',
                toggleValue: inst?.wireframe ?? false,
                onToggleChange: (v) => {
                    if (id) {
                        setModelWireframe(id, v);
                    }
                    _patchToggle('debug:wireframe', v);
                },
            } as PopupRow,
            {
                kind: 'toggle',
                label: t('scene.boneLines'),
                icon: 'lucide:git-branch',
                target: 'debug:bonelines',
                toggleValue: inst?.showBoneLines ?? false,
                onToggleChange: (v) => {
                    if (id) {
                        setModelBoneLinesVis(id, v);
                    }
                    _patchToggle('debug:bonelines', v);
                },
            } as PopupRow,
            {
                kind: 'toggle',
                label: t('scene.boneJoints'),
                icon: 'lucide:circle-dot',
                target: 'debug:bonejoints',
                toggleValue: inst?.showBoneJoints ?? false,
                onToggleChange: (v) => {
                    if (id) {
                        setModelBoneJointsVis(id, v);
                    }
                    _patchToggle('debug:bonejoints', v);
                },
            } as PopupRow,
        ],
    };
}




/** 构建 WASM 物理子页（Bullet 骨髁物理信息 + 总开关） */
export function buildWasmPhysicsLevel(): PopupLevel {
    const id = focusedModelId;
    const inst = id ? modelManager.get(id) : null;
    const items: PopupRow[] = [];

    // 运行时切换（WASM 物理 / JS 调试）— 全局物理引擎开关
    items.push({
        kind: 'modeSlider',
        label: t('scene.runtime'),
        icon: 'lucide:cpu',
        target: 'wasm:runtime',
        modeValue: getMmdRuntimeType(),
        modeOptions: [
            { value: 'wasm', label: t('scene.runtimeWasm') },
            { value: 'js', label: t('scene.runtimeJs') },
        ],
        onModeChange: (v: string) => {
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
        bind: () => getMmdRuntimeType(),
    } as PopupRow);

    // 重力强度（统控 WASM Bullet）
    items.push({
        kind: 'slider',
        label: t('scene.gravityStrength'),
        icon: 'lucide:arrow-down',
        target: 'wasm:gravity',
        sliderValue: getGravityStrength(),
        sliderMin: 0,
        sliderMax: 2,
        sliderStep: 0.05,
        onSliderChange: (v: number) => {
            setGravityStrength(v);
        },
    } as PopupRow);

    if (!id || !inst) {
        items.push({
            kind: 'action' as PopupRow['kind'],
            label: t('scene.loadModelFirst'),
            icon: 'lucide:info',
            target: 'wasm:none',
        } as PopupRow);
        return { label: t('scene.wasmPhysics'), dir: '', items };
    }

    // 模型名 + 总开关
    items.push({
        kind: 'toggle',
        label: t('scene.physicsParse', { name: inst.name }),
        icon: 'lucide:atom',
        target: 'wasm:master',
        toggleValue: inst.physicsEnabled,
        onToggleChange: (v) => {
            setModelPhysics(id, v);
            _patchToggle('wasm:master', v);
        },
    } as PopupRow);

    // 物理类别列表
    const categories = getPhysicsCategories(id);
    if (categories.length === 0) {
        items.push({
            kind: 'action' as PopupRow['kind'],
            label: t('scene.noRigidBody'),
            icon: 'lucide:info',
            target: 'wasm:nobody',
        } as PopupRow);
        return { label: t('scene.wasmPhysics'), dir: '', items };
    }

    // 物理类别 key 映射（热切换安全：仅存 i18n key，不含中文）
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

    for (const cat of categories) {
        const enabled = isPhysicsCategoryEnabled(id, cat);
        items.push({
            kind: 'toggle',
            label: t(CAT_KEYS[cat] || cat),
            icon: CAT_ICONS[cat] || 'lucide:settings',
            target: `wasm:cat:${cat}`,
            toggleValue: enabled,
            onToggleChange: (v) => {
                setPhysicsCategory(id, cat, v);
                _patchToggle(`wasm:cat:${cat}`, v);
            },
        } as PopupRow);
    }

    // 调试
    items.push({
        kind: 'folder',
        label: t('scene.debug'),
        icon: 'lucide:bug',
        target: 'wasm:debug',
    } as PopupRow);

    return { label: t('scene.wasmPhysics'), dir: '', items };
}
