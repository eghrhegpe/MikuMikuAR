// [doc:architecture] Scene Physics Levels — 物理设置子页（场景弹窗域）
// 从 scene-menu.ts 引用，独立管理全局物理参数（WASM Bullet + XPBD 布料）

import type { PopupLevel, PopupRow } from '../core/config';
import { envState, focusedModelId } from '../core/config';
import { getGravityStrength, setGravityStrength } from '../scene/env/env-bridge';
import {
    modelManager,
    setModelWireframe,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
} from '../scene/scene';
import {
    toggleCloth,
    getSolverSubsteps,
    setSolverSubsteps,
    getTimeScale,
    setTimeScale,
    getCollisionEnabled,
    setCollisionEnabled,
    getBodyCollisionEnabled,
    setBodyCollisionEnabled,
    getGroundCollisionEnabled,
    setGroundCollisionEnabled,
    setClothGravity,
    setDebugParticles,
    setDebugConstraints,
    setDebugColliders,
    getDebugState,
} from '../physics/cloth-manager';
import {
    getPhysicsCategories,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
    setModelPhysics,
} from '../scene/scene';
import { buildClothParamsLevel } from './motion-cloth-levels';
import { getSceneMenu, refreshSceneRoot } from './scene-menu';

/** 构建物理设置子页 */
export function buildPhysicsLevel(): PopupLevel {
    const reRender = () => { if (getSceneMenu()) getSceneMenu()?.reRender(); };

    return {
        label: '物理',
        dir: '',
        items: [
            // 重力强度（统控 WASM Bullet + XPBD 布料）
            {
                kind: 'slider',
                label: '重力强度（WASM + 布料）',
                icon: 'lucide:arrow-down',
                target: 'physics:gravity',
                sliderValue: getGravityStrength(),
                sliderMin: 0,
                sliderMax: 2,
                sliderStep: 0.05,
                onSliderChange: (v: number) => {
                    setGravityStrength(v);
                    setClothGravity(v);
                    reRender();
                },
            } as PopupRow,
            // WASM 物理（MMD Bullet 骨髁物理）— 通用物理系统，放第二
            {
                kind: 'folder',
                label: 'WASM 物理',
                icon: 'lucide:atom',
                target: 'physics:wasm',
            } as PopupRow,
            // 布料模拟：独立开关（XPBD 附加）
            {
                kind: 'toggle',
                label: '布料模拟',
                icon: 'lucide:shirt',
                target: 'physics:cloth-toggle',
                toggleValue: envState.clothEnabled,
                onToggleChange: (v: boolean) => {
                    envState.clothEnabled = v;
                    toggleCloth(v);
                    refreshSceneRoot();
                    reRender();
                },
            } as PopupRow,
            // 求解质量（原名 求解迭代）
            {
                kind: 'slider',
                label: '求解质量',
                icon: 'lucide:repeat',
                target: 'physics:substeps',
                sliderValue: getSolverSubsteps(),
                sliderMin: 1,
                sliderMax: 16,
                sliderStep: 1,
                onSliderChange: (v: number) => {
                    setSolverSubsteps(v);
                    reRender();
                },
            } as PopupRow,
            // 模拟速度
            {
                kind: 'slider',
                label: '模拟速度',
                icon: 'lucide:clock',
                target: 'physics:timescale',
                sliderValue: getTimeScale(),
                sliderMin: 0.1,
                sliderMax: 5,
                sliderStep: 0.1,
                onSliderChange: (v: number) => {
                    setTimeScale(v);
                    reRender();
                },
            } as PopupRow,
            // 碰撞：folder + headerToggle
            {
                kind: 'folder',
                label: '碰撞',
                icon: 'lucide:shield',
                target: 'physics:collision',
                headerToggle: {
                    value: getCollisionEnabled(),
                    onChange: (v) => {
                        setCollisionEnabled(v);
                        refreshSceneRoot();
                        getSceneMenu()?.updateControls();
                    },
                    bind: () => getCollisionEnabled(),
                },
            } as PopupRow,
            // 精细调节 → 布料子页
            {
                kind: 'folder',
                label: '精细调节',
                icon: 'lucide:sliders',
                target: 'physics:cloth',
            } as PopupRow,
            // 调试（材质/骨骼/XPBD 可视化）
            {
                kind: 'folder',
                label: '调试',
                icon: 'lucide:bug',
                target: 'physics:debug',
            } as PopupRow,
        ],
    };
}

/** 构建碰撞子页（地面碰撞 + 身体碰撞） */
export function buildCollisionLevel(): PopupLevel {
    const reRender = () => { if (getSceneMenu()) getSceneMenu()?.reRender(); };

    return {
        label: '碰撞',
        dir: '',
        items: [
            {
                kind: 'toggle',
                label: '地面碰撞',
                icon: 'lucide:square',
                target: 'collision:ground',
                toggleValue: getGroundCollisionEnabled(),
                onToggleChange: (v: boolean) => {
                    setGroundCollisionEnabled(v);
                    refreshSceneRoot();
                    reRender();
                },
            } as PopupRow,
            {
                kind: 'toggle',
                label: '身体碰撞',
                icon: 'lucide:accessibility',
                target: 'collision:body',
                toggleValue: getBodyCollisionEnabled(),
                onToggleChange: (v: boolean) => {
                    setBodyCollisionEnabled(v);
                    refreshSceneRoot();
                    reRender();
                },
            } as PopupRow,
        ],
    };
}

/** 构建 WASM 物理子页（Bullet 骨髁物理信息 + 总开关） */
export function buildWasmPhysicsLevel(): PopupLevel {
    const id = focusedModelId;
    const inst = id ? modelManager.get(id) : null;
    const reRender = () => { if (getSceneMenu()) getSceneMenu()?.reRender(); };
    const items: PopupRow[] = [];

    if (!id || !inst) {
        items.push({
            kind: 'action' as PopupRow['kind'],
            label: '请先加载模型',
            icon: 'lucide:info',
            target: 'wasm:none',
        } as PopupRow);
        return { label: 'WASM 物理', dir: '', items };
    }

    // 模型名 + 总开关
    items.push({
        kind: 'toggle',
        label: `物理解析（${inst.name}）`,
        icon: 'lucide:atom',
        target: 'wasm:master',
        toggleValue: inst.physicsEnabled,
        onToggleChange: (v) => {
            setModelPhysics(id, v);
            reRender();
        },
    } as PopupRow);

    // 物理类别列表
    const categories = getPhysicsCategories(id);
    if (categories.length === 0) {
        items.push({
            kind: 'action' as PopupRow['kind'],
            label: '该模型无物理刚体',
            icon: 'lucide:info',
            target: 'wasm:nobody',
        } as PopupRow);
        return { label: 'WASM 物理', dir: '', items };
    }

    const CAT_LABELS: Record<string, string> = {
        skirt: '裙子', chest: '胸部', hair: '头发', accessory: '配件',
    };
    const CAT_ICONS: Record<string, string> = {
        skirt: 'lucide:shirt', chest: 'lucide:heart', hair: 'lucide:person-standing', accessory: 'lucide:gem',
    };

    for (const cat of categories) {
        const enabled = isPhysicsCategoryEnabled(id, cat);
        items.push({
            kind: 'toggle',
            label: CAT_LABELS[cat] || cat,
            icon: CAT_ICONS[cat] || 'lucide:settings',
            target: `wasm:cat:${cat}`,
            toggleValue: enabled,
            onToggleChange: (v) => {
                setPhysicsCategory(id, cat, v);
                reRender();
            },
        } as PopupRow);
    }

    return { label: 'WASM 物理', dir: '', items };
}

/** 构建物理调试子页（材质线框/骨骼/XPBD 可视化 toggle） */
export function buildPhysicsDebugLevel(): PopupLevel {
    const id = focusedModelId;
    const inst = id ? modelManager.get(id) : null;
    const dbg = getDebugState();
    const reRender = () => { if (getSceneMenu()) getSceneMenu()?.reRender(); };

    return {
        label: '调试',
        dir: '',
        items: [
            {
                kind: 'toggle', label: '材质线框', icon: 'lucide:square',
                target: 'debug:wireframe',
                toggleValue: inst?.wireframe ?? false,
                onToggleChange: (v) => { if (id) setModelWireframe(id, v); reRender(); },
            } as PopupRow,
            {
                kind: 'toggle', label: '骨骼线', icon: 'lucide:git-branch',
                target: 'debug:bonelines',
                toggleValue: inst?.showBoneLines ?? false,
                onToggleChange: (v) => { if (id) setModelBoneLinesVis(id, v); reRender(); },
            } as PopupRow,
            {
                kind: 'toggle', label: '骨骼关节球', icon: 'lucide:circle-dot',
                target: 'debug:bonejoints',
                toggleValue: inst?.showBoneJoints ?? false,
                onToggleChange: (v) => { if (id) setModelBoneJointsVis(id, v); reRender(); },
            } as PopupRow,
            {
                kind: 'toggle', label: '粒子球', icon: 'lucide:circle',
                target: 'debug:particles',
                toggleValue: dbg.particles,
                onToggleChange: (v) => { setDebugParticles(v); reRender(); },
            } as PopupRow,
            {
                kind: 'toggle', label: '约束线', icon: 'lucide:minus',
                target: 'debug:constraints',
                toggleValue: dbg.constraints,
                onToggleChange: (v) => { setDebugConstraints(v); reRender(); },
            } as PopupRow,
            {
                kind: 'toggle', label: '碰撞体线框', icon: 'lucide:box',
                target: 'debug:colliders',
                toggleValue: dbg.colliders,
                onToggleChange: (v) => { setDebugColliders(v); reRender(); },
            } as PopupRow,
        ],
    };
}
