// [doc:architecture] Model Manager — 模型注册表 + 生命周期 + 属性管理
// 职责: 封装 modelRegistry、focusedModelId、per-model 状态 map
//       提供模型 CRUD、属性设置、骨骼覆盖、物理类别、Morph 操作
// 消费者: scene.ts (编排器)、model-detail.ts (UI)、serialization
//
// 设计原则:
// - 不直接 import triggerAutoSave → 通过构造函数注入的 triggerAutoSave 回调触发（避免循环依赖）
// - 不引用 scene.ts 中的任何符号 → 无循环依赖
// - 模型状态完全封装，外部只能通过方法访问

import { Scene } from '@babylonjs/core/scene';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { detachSharedTextures } from '@/core/dispose-helpers';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import {
    ModelInstance,
    setFocusedModelId,
    focusedModelId as configFocusedId,
    type PhysicsCategory,
    type RuntimeModel,
} from '@/core/config';
import { orbitToCartesian, cartesianToOrbit, normalizeOrbit } from '@/core/orbit';
// [doc:adr-238] 换装释放经 scene-action-bridge（outfit 注册）
import { getSceneAction } from '@/core/scene-action-bridge';
import { clamp01 } from '@/core/clamp';
import { swallowError } from '@/core/async';
import { logWarn } from '@/core/logger';
import { disposeModelMaterialState, _applyAll, type AlphaCtx } from './material';
import { disposeVmdLayerState } from '../motion/vmd-layers';
import { applyWetnessToInst } from '@/scene/env/env-wetness';
// [doc:adr-238] 骨骼覆写类型经 scene-action-bridge（bone-override 注册）
import type { OverrideType } from '../motion/bone-override';
import { showInfoToast } from '@/core/toast';
import { t } from '@/core/i18n/t';
import { feedbackStatus } from '@/core/feedback';

// ======== Per-model state maps ========
// (owned by ModelManager, not exported directly)

// ======== Configurable Physics Classification Rules ========
// 用户可通过 uiState.physicsCategoryMap 覆盖默认规则（格式同 materialCategoryMap）

const PHYSICS_CAT_RULES: Record<PhysicsCategory, string[]> = {
    skirt: ['スカート', 'skirt', 'フリル', 'frill', '裾', 'hem'],
    chest: ['胸', 'chest', 'bust', 'バスト'],
    hair: ['髪', 'hair', 'ahoge', 'bangs', 'ponytail', '前髪', '後ろ髪'],
    accessory: [
        'リボン',
        'ribbon',
        'アクセサリ',
        'accessory',
        '飾り',
        'collar',
        'ネクタイ',
        'tie',
        '紐',
        'string',
        '襟',
    ],
};

const PHYSICS_CAT_PATTERNS: [PhysicsCategory, RegExp][] = Object.entries(PHYSICS_CAT_RULES).map(
    ([cat, keywords]) => [cat as PhysicsCategory, new RegExp(keywords.join('|'), 'i')]
);

function _classifyBonePhysics(name: string): PhysicsCategory | null {
    const l = name.toLowerCase();
    for (const [cat, re] of PHYSICS_CAT_PATTERNS) {
        if (re.test(l)) {
            return cat;
        }
    }
    return null;
}

function _buildRigidBodyCatMap(mmdModel: RuntimeModel): Map<number, PhysicsCategory> {
    const bones = mmdModel.runtimeBones;
    const map = new Map<number, PhysicsCategory>();
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (bone.rigidBodyIndices.length === 0) {
            continue;
        }
        const cat = _classifyBonePhysics(bone.name);
        if (!cat) {
            continue;
        }
        for (const rbi of bone.rigidBodyIndices) {
            map.set(rbi, cat);
        }
    }
    return map;
}

function syncModelVisibility(inst: ModelInstance): void {
    inst.meshes.forEach((m) => {
        m.setEnabled(inst.visible);
        const mat = m.material;
        if (mat instanceof StandardMaterial || mat instanceof PBRMaterial) {
            mat.wireframe = inst.wireframe;
        }
    });
    const alphaCtx: AlphaCtx = { opacity: inst.opacity, origAlpha: inst._origAlpha ?? [] };
    _applyAll(inst.id, alphaCtx);
}

/** Apply the current scaling and rotation state to the root mesh. */
function syncModelTransform(inst: ModelInstance): void {
    if (inst.meshes.length > 0) {
        const root = inst.meshes[0];
        root.scaling.setAll(inst.scaling);
        root.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
    }
}

// ======== Formation Types ========

export type FormationType = 'line' | 'v-shape' | 'circle' | 'grid' | 'diagonal' | 'arc';

const FORMATION_LABELS: Record<FormationType, string> = {
    'line': '一字排列',
    'v-shape': 'V 字阵型',
    'circle': '圆形阵型',
    'grid': '网格阵型',
    'diagonal': '对角排列',
    'arc': '弧形排列',
};

export function getFormationLabels(): Record<FormationType, string> {
    return { ...FORMATION_LABELS };
}

function _computeFormationPos(
    type: FormationType,
    index: number,
    total: number,
    spacing: number
): [number, number, number] {
    const cx = 0,
        cz = 0;
    switch (type) {
        case 'line': {
            const x = (index - (total - 1) / 2) * spacing;
            return [cx + x, 0, cz];
        }
        case 'v-shape': {
            const half = Math.floor(total / 2);
            const row = Math.abs(index - half);
            const x = (index - half) * spacing * 0.6;
            const z = row * spacing * 0.8;
            return [cx + x, 0, cz + z];
        }
        case 'circle': {
            const radius = Math.max(spacing, (total * spacing) / (2 * Math.PI));
            const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const z = cz + Math.sin(angle) * radius;
            return [x, 0, z];
        }
        case 'grid': {
            const cols = Math.ceil(Math.sqrt(total));
            const row = Math.floor(index / cols);
            const col = index % cols;
            const x = (col - (cols - 1) / 2) * spacing;
            const z = row * spacing;
            return [cx + x, 0, cz + z];
        }
        case 'diagonal': {
            const x = (index - (total - 1) / 2) * spacing * 0.7;
            const z = index * spacing * 0.5;
            return [cx + x, 0, cz + z];
        }
        case 'arc': {
            const radius = Math.max(spacing * 2, total * spacing * 0.8);
            const spread = Math.min(Math.PI * 0.8, (total - 1) * 0.4);
            const angle = -spread / 2 + (index / Math.max(1, total - 1)) * spread;
            const x = cx + Math.sin(angle) * radius;
            const z = cz + (1 - Math.cos(angle)) * radius * 0.3;
            return [x, 0, z];
        }
    }
}

// ======== ModelManager Class ========

export class ModelManager {
    // --- State ---
    readonly modelRegistry = new Map<string, ModelInstance>();
    /** Delegates to config's focusedModelId for cross-module consistency. */
    get focusedModelId(): string | null {
        return configFocusedId;
    }
    private set _focusedModelId(v: string | null) {
        setFocusedModelId(v);
    }

    private _initialRigidBodyStates = new Map<string, Uint8Array>();
    private _physicsCatState = new Map<string, Map<string, boolean>>();
    private _boneOverlayMap = new Map<
        string,
        {
            lineSystem: Mesh;
            joints: Mesh[];
            /** 覆盖着色线段（每对骨骼一条，根据覆盖状态显示/隐藏/着色） */
            overrideLines: LinesMesh[];
            update: () => void;
            dirty: boolean;
            markDirty: () => void;
        }
    >();
    /** 骨骼覆盖着色材质（懒加载，四种类型共享所有模型） */
    private _ovMaterials: Record<OverrideType | 'default', StandardMaterial> | null = null;
    private _boneUpdateObserver: ObserverHandle | null = null;

    /** Currently active formation type, or null if custom/manual arrangement. */
    private _activeFormation: FormationType | null = null;
    /** Currently active formation spacing (default 3). */
    private _activeFormationSpacing: number = 3;

    /** Cleanup callback invoked by removeModel for external per-model state. */
    onRemoveModel: ((id: string) => void) | null = null;
    /** Callback invoked when a model receives focus (e.g. to activate gaze tracking). */
    onModelFocused: ((id: string) => void | Promise<void>) | null = null;

    constructor(
        private scene: Scene,
        private triggerAutoSave: () => void,
        private autoFrame: (center: Vector3, extent: number) => void
    ) {}

    // ======== Registry ========

    /** Get a model by ID. Returns undefined if not found. */
    get(id: string): ModelInstance | undefined {
        return this.modelRegistry.get(id);
    }

    /** Get all registered models as an array. */
    getAll(): ModelInstance[] {
        return Array.from(this.modelRegistry.values());
    }

    /** Get the number of registered models. */
    get size(): number {
        return this.modelRegistry.size;
    }

    /** Register a new model instance. */
    register(inst: ModelInstance): void {
        // [fix:round17 P2] 同 ID 覆盖防御：若已存在不同实例，先释放旧实例再注册，
        // 防止旧 mesh/材质泄漏（model-loader 已预检，此处为 API 层兜底）。
        const existing = this.modelRegistry.get(inst.id);
        if (existing && existing !== inst) {
            logWarn('model-manager', `register: 同 ID "${inst.id}" 覆盖旧实例，先释放旧资源`);
            this.remove(inst.id);
        }
        this.modelRegistry.set(inst.id, inst);
        applyWetnessToInst(inst);
    }

    /** Store initial rigid body state for physics toggle restoration. */
    storeRigidBodyState(id: string, states: Uint8Array): void {
        this._initialRigidBodyStates.set(id, new Uint8Array(states));
    }

    // ======== Convenience getters ========

    /** Get the currently focused ModelInstance, or undefined. */
    focused(): ModelInstance | undefined {
        return configFocusedId ? this.modelRegistry.get(configFocusedId) : undefined;
    }

    /** Get the currently focused runtime model (RuntimeModel), or null. */
    focusedMmdModel(): RuntimeModel | null {
        if (!configFocusedId) {
            return null;
        }
        const inst = this.modelRegistry.get(configFocusedId);
        return inst?.mmdModel ?? null;
    }

    /** Find a model by file path. Returns the first match or undefined. */
    findByFilePath(filePath: string): ModelInstance | undefined {
        for (const inst of this.modelRegistry.values()) {
            if (inst.filePath === filePath) {
                return inst;
            }
        }
        return undefined;
    }

    // ======== Model Lifecycle ========

    /** Remove a model and clean up all associated state. */
    remove(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }

        // [doc:adr-215] 级联卸载附属子模型（先子后父，递归）
        this.detachChildModels(id);

        getSceneAction('disposeOverlay')?.(inst);
        getSceneAction('restoreMaterials')?.(inst);

        // ⚠️ onRemoveModel（mmdRuntime.destroyMmdModel）必须在网格释放之前调用！
        // destroyMmdModel 需要 skeleton 尚存才能从运行时中解除 observable 链接，
        // 否则下一帧渲染循环中 mmdWasmModel.skeleton 为 null 会抛 TypeError。
        // onRemoveModel 也必须在 modelRegistry.delete 之前调用，
        // 因为外部回调需要通过 modelRegistry.get(id) 获取模型实例。
        // [fix:round17 P2] try/catch 隔离：外部回调抛错不得中断清理链，
        // 否则 mesh 未 dispose、registry 未 delete → 半删除 + GPU 泄漏。
        try {
            this.onRemoveModel?.(id);
        } catch (e) {
            logWarn('model-manager', `onRemoveModel failed for "${id}"; continuing cleanup`, e);
        }

        // [fix:gpu-texture-leak] 显式释放材质及其纹理（mesh.dispose 只释放几何体，不释放材质）。
        // restoreMaterials 已将原始材质恢复到 mesh 上，此处统一 dispose 防止 GPU 纹理泄漏。
        // 用 Set 去重：多个 mesh 可能共享同一材质实例。
        const disposedMats = new Set<Material>();
        for (const m of inst.meshes) {
            if (m instanceof Mesh && m.material) {
                disposedMats.add(m.material);
            }
        }
        // [bugfix:shared-toon-dispose] 必须先摘除共享纹理，再 dispose。
        // MMD 共享 toon（toon01–10）在 babylon-mmd 中是全局单例（纹理缓存键
        // `file:shared_toon_texture_<N>` 不含区分模型的 fileRootId），多个模型共用同一 Texture；
        // 而 MmdPluginMaterial.dispose 无引用计数，会直接销毁它，
        // 导致其他存活模型的 toon 失效 → 相关材质（常见于眼睛）渲染纯黑且不随光照变化。
        detachSharedTextures(disposedMats);
        for (const mat of disposedMats) {
            mat.dispose(false, true); // disposeTextures=true 级联释放贴图
        }

        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                m.dispose();
            }
        }
        inst._origTextures = undefined;
        inst.outfitFile = undefined;

        this.modelRegistry.delete(id);
        this._initialRigidBodyStates.delete(id);
        this._physicsCatState.delete(id);
        // [fix P2] destroyBoneOverlay 内部既 dispose（lineSystem/joints/overrideLines）又 delete，
        // 此处不得提前 delete，否则 destroyBoneOverlay 的 get(id) 得 undefined 会跳过资源释放。
        this.destroyBoneOverlay(id);

        disposeModelMaterialState(id);
        // [fix P2] 模型销毁时清理 vmd-layers 模块级 per-model 状态
        // （_rebuildGenMap/_prevGazeActiveMap 条目积累 + 同 ID 复用读到陈旧状态）
        disposeVmdLayerState(id);

        // Update focus
        const wasFocused = configFocusedId === id;
        if (wasFocused) {
            // 焦点模型被删除：焦点切到剩余第一个模型，并对其重新取景（focus 内含 autoFrame + autoSave）。
            const nextId =
                this.modelRegistry.size > 0 ? this.modelRegistry.keys().next().value : null;
            setFocusedModelId(nextId);
            if (nextId) {
                this.focus(nextId);
            }
        }
        // [audit:round13 P3] 删除非焦点模型：不再隐式对焦点模型 focus()——
        // 原实现无条件 focus(configFocusedId) 会重置相机视角（autoFrame）+ 冗余 autoSave，
        // 删除任意模型都动相机是反直觉副作用。焦点状态已在删除焦点模型分支维护，此处保持不动。
    }

    /** Remove the currently focused model. */
    removeFocused(): void {
        if (!configFocusedId) {
            return;
        }
        this.remove(configFocusedId);
    }

    /** Focus a model by ID: set focus + auto-frame camera.
     *  @param frameCamera 是否自动取景（相机对准模型）。false 时仅切换焦点（不移动相机）。
     *                     由 uiState.autoCenterModel 控制（undefined 视为 true）。 */
    focus(id: string, frameCamera = true): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            setFocusedModelId(null);
            return;
        }
        setFocusedModelId(id);

        // 焦点切换后自动激活默认视线追踪，使眼球 / 头部跟随当前焦点模型
        if (this.onModelFocused) {
            swallowError(Promise.resolve(this.onModelFocused(id)));
        }

        if (frameCamera) {
            const min = new Vector3(Infinity, Infinity, Infinity);
            const max = new Vector3(-Infinity, -Infinity, -Infinity);
            let hasVisibleMesh = false;
            for (const m of inst.meshes) {
                if (!m.isVisible) {
                    continue;
                }
                hasVisibleMesh = true;
                m.computeWorldMatrix(true);
                const bb = m.getBoundingInfo().boundingBox;
                min.minimizeInPlace(bb.minimumWorld);
                max.maximizeInPlace(bb.maximumWorld);
            }
            if (hasVisibleMesh) {
                const center = min.add(max).scale(0.5);
                const size = max.subtract(min);
                const extent = Math.max(size.x, size.y, size.z);
                this.autoFrame(center, extent);
            }
        }

        this.triggerAutoSave();
    }

    /** Arrange all models in a horizontal row. Clears the active formation. */
    arrange(): void {
        this._activeFormation = null;
        const models = Array.from(this.modelRegistry.values());
        const spacing = 3;
        models.forEach((inst, i) => {
            const offsetX = (i - (models.length - 1) / 2) * spacing;
            if (inst.meshes.length > 0) {
                inst.meshes[0].position.x = offsetX;
            }
        });
        this.triggerAutoSave();
    }

    /** Return the currently active formation type, or null if manually arranged. */
    getActiveFormation(): FormationType | null {
        return this._activeFormation;
    }

    /** Return the currently active formation spacing (default 3). */
    getActiveFormationSpacing(): number {
        return this._activeFormationSpacing;
    }

    /** Apply a formation preset to all models. */
    setFormation(type: FormationType, spacing?: number): void {
        this._activeFormation = type;
        // 边界保护：spacing 非有限或 <= 0 时回退默认（损坏场景文件反序列化也不会产生退化/NaN 布局）
        const s = spacing !== undefined && Number.isFinite(spacing) && spacing > 0 ? spacing : 3;
        this._activeFormationSpacing = s;
        const models = Array.from(this.modelRegistry.values());
        const n = models.length;
        if (n === 0) {
            return;
        }
        for (let i = 0; i < n; i++) {
            const inst = models[i];
            if (inst.meshes.length === 0) {
                continue;
            }
            const pos = _computeFormationPos(type, i, n, s);
            inst.meshes[0].position.set(pos[0], pos[1], pos[2]);
        }
        this.triggerAutoSave();
    }

    // ======== Property Setters ========

    setVisibility(id: string, visible: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.visible = visible;
        syncModelVisibility(inst);
        this.triggerAutoSave();
    }

    setOpacity(id: string, opacity: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (!Number.isFinite(opacity)) {
            logWarn('model-manager', 'setOpacity: 无效值', opacity);
            return;
        }
        inst.opacity = clamp01(opacity);
        syncModelVisibility(inst);
        this.triggerAutoSave();
    }

    setWireframe(id: string, wireframe: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.wireframe = wireframe;
        syncModelVisibility(inst);
        this.triggerAutoSave();
    }

    setBoneLinesVis(id: string, show: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.showBoneLines = show;
        const hasAny = show || inst.showBoneJoints;
        const hadOverlay = this._boneOverlayMap.has(id);
        if (hasAny && !hadOverlay) {
            this.createBoneOverlay(id);
        } else if (!hasAny && hadOverlay) {
            this.destroyBoneOverlay(id);
        } else if (hadOverlay) {
            const entry = this._boneOverlayMap.get(id)!;
            entry.lineSystem.setEnabled(show);
            entry.markDirty();
        }
        this.triggerAutoSave();
    }

    setBoneJointsVis(id: string, show: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.showBoneJoints = show;
        const hasAny = show || inst.showBoneLines;
        const hadOverlay = this._boneOverlayMap.has(id);
        if (hasAny && !hadOverlay) {
            this.createBoneOverlay(id);
        } else if (!hasAny && hadOverlay) {
            this.destroyBoneOverlay(id);
        } else if (hadOverlay) {
            const entry = this._boneOverlayMap.get(id)!;
            for (const j of entry.joints) {
                j.setEnabled(show);
            }
            entry.markDirty();
        }
        this.triggerAutoSave();
    }

    setPhysics(id: string, enabled: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.physicsEnabled = enabled;
        const mmdModel = inst.mmdModel;
        if (mmdModel) {
            const states = mmdModel.rigidBodyStates;
            if (states) {
                if (enabled) {
                    const init = this._initialRigidBodyStates.get(id) || new Uint8Array(0);
                    if (init.length === states.length) {
                        states.set(init);
                    } else {
                        states.fill(1);
                    }
                } else {
                    states.fill(0);
                }
            }
        }
        this.triggerAutoSave();
    }

    setScaling(id: string, scaling: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (!Number.isFinite(scaling)) {
            logWarn('model-manager', 'setScaling: 无效值', scaling);
            return;
        }
        inst.scaling = Math.max(0.01, scaling);
        syncModelTransform(inst);
        this.triggerAutoSave();
    }

    setRotationY(id: string, rotationY: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (!Number.isFinite(rotationY)) {
            logWarn('model-manager', 'setRotationY: 无效值', rotationY);
            return;
        }
        inst.rotationY = rotationY;
        inst.rotation[1] = rotationY;
        syncModelTransform(inst);
        this.triggerAutoSave();
    }

    /** [doc:adr-126] 全自由度旋转：以欧拉角（弧度）设置模型 root 三轴旋转。 */
    setRotation(id: string, rotation: Vector3): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (
            !Number.isFinite(rotation.x) ||
            !Number.isFinite(rotation.y) ||
            !Number.isFinite(rotation.z)
        ) {
            logWarn('model-manager', 'setRotation: 无效欧拉角', rotation);
            return;
        }
        inst.rotation[0] = rotation.x;
        inst.rotation[1] = rotation.y;
        inst.rotation[2] = rotation.z;
        inst.rotationY = rotation.y;
        syncModelTransform(inst);
        this.triggerAutoSave();
    }

    /** [doc:adr-126] 读取模型 root 当前三轴旋转（欧拉角，弧度）。 */
    getRotation(id: string): Vector3 | null {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return null;
        }
        return new Vector3(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
    }

    setPosition(id: string, x: number, y: number, z: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            logWarn('model-manager', 'setPosition: 无效坐标', { x, y, z });
            return;
        }
        if (inst.meshes.length > 0) {
            inst.meshes[0].position.set(x, y, z);
        }
        this.triggerAutoSave();
    }

    getPosition(id: string): [number, number, number] {
        const inst = this.modelRegistry.get(id);
        if (!inst || inst.meshes.length === 0) {
            return [0, 0, 0];
        }
        const p = inst.meshes[0].position;
        return [p.x, p.y, p.z];
    }

    /** [doc:adr-049] 以球面坐标（方位角/仰角/距离）定位模型，等价于围绕原点旋转。 */
    setOrbit(id: string, azimuth: number, elevation: number, distance: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        // 边界保护：钳制到合法值域（绝不产生 NaN / 退化），损坏场景文件反序列化也能安全定位。
        const invalid =
            !Number.isFinite(azimuth) ||
            !Number.isFinite(elevation) ||
            !Number.isFinite(distance) ||
            distance <= 0 ||
            elevation < -90 ||
            elevation > 90;
        const o = normalizeOrbit(azimuth, elevation, distance);
        if (invalid) {
            logWarn('model-manager', 'setOrbit: 输入越界已钳制', {
                azimuth,
                elevation,
                distance,
                result: o,
            });
        }
        inst.positionMode = 'orbit';
        inst.orbitAzimuth = o.azimuth;
        inst.orbitElevation = o.elevation;
        inst.orbitDistance = o.distance;
        const [x, y, z] = orbitToCartesian(o.azimuth, o.elevation, o.distance);
        if (inst.meshes.length > 0) {
            inst.meshes[0].position.set(x, y, z);
        }
        this.triggerAutoSave();
    }

    /** [doc:adr-049] 读取模型当前球面坐标。orbit 模式下返回存储值，否则从当前笛卡尔位置反推。 */
    getOrbit(id: string): { azimuth: number; elevation: number; distance: number } | null {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return null;
        }
        if (
            inst.positionMode === 'orbit' &&
            inst.orbitAzimuth !== undefined &&
            inst.orbitElevation !== undefined &&
            inst.orbitDistance !== undefined
        ) {
            return {
                azimuth: inst.orbitAzimuth,
                elevation: inst.orbitElevation,
                distance: inst.orbitDistance,
            };
        }
        const [x, y, z] = this.getPosition(id);
        return cartesianToOrbit(x, y, z);
    }

    /** [doc:adr-049] 切换坐标模式。切到 orbit 时从当前笛卡尔位置反推球面参数（无跳变）；切回 cartesian 保留当前位置。 */
    setPositionMode(id: string, mode: 'cartesian' | 'orbit'): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (mode === 'orbit') {
            const [x, y, z] = this.getPosition(id);
            const o = cartesianToOrbit(x, y, z);
            inst.orbitAzimuth = o.azimuth;
            inst.orbitElevation = o.elevation;
            inst.orbitDistance = o.distance;
        } else {
            // cartesian 模式：确保 mesh 位置与实例当前位置一致（orbit 模式已写入）
            const [x, y, z] = this.getPosition(id);
            if (inst.meshes.length > 0) {
                inst.meshes[0].position.set(x, y, z);
            }
        }
        inst.positionMode = mode;
        this.triggerAutoSave();
    }

    /** [doc:adr-049] 读取模型当前坐标模式（默认 'cartesian'）。 */
    getPositionMode(id: string): 'cartesian' | 'orbit' {
        const inst = this.modelRegistry.get(id);
        return inst?.positionMode ?? 'cartesian';
    }

    resetTransform(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.visible = true;
        inst.opacity = 1.0;
        inst.wireframe = false;
        inst.scaling = 1.0;
        inst.rotationY = 0;
        inst.rotation = [0, 0, 0];
        if (inst.meshes.length > 0) {
            inst.meshes[0].position.set(0, 0, 0);
        }
        syncModelVisibility(inst);
        syncModelTransform(inst);
        this.triggerAutoSave();
    }

    /** Stop VMD animation on a model and clean up associated state. */
    /** 清空模型的 VMD 数据（vmdData/vmdName/vmdPath/animationDuration）。
     *  注意：此方法不暂停动画或修改播放状态——暂停由上层 `stopVMD` 编排。 */
    clearVmdData(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) {
            return;
        }
        inst.vmdData = null;
        inst.vmdName = '';
        inst.vmdPath = null;
        inst.animationDuration = 0;
        inst.vmdLayers = [];
        this.triggerAutoSave();
    }

    // ======== Physics Categories ========

    getPhysicsCategories(id: string): PhysicsCategory[] {
        const inst = this.modelRegistry.get(id);
        if (!inst || !inst.mmdModel) {
            return [];
        }
        const map = _buildRigidBodyCatMap(inst.mmdModel);
        const set = new Set(map.values());
        return [...set];
    }

    getPhysicsCatState(id: string): Record<string, boolean> | null {
        const state = this._physicsCatState.get(id);
        if (!state || state.size === 0) {
            return null;
        }
        const result: Record<string, boolean> = {};
        for (const [cat, enabled] of state) {
            result[cat] = enabled;
        }
        return result;
    }

    isPhysicsCategoryEnabled(id: string, cat: string): boolean {
        return this._physicsCatState.get(id)?.get(cat) ?? true;
    }

    setPhysicsCategory(id: string, cat: string, enabled: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst || !inst.mmdModel) {
            return;
        }
        // 若启用子类别但总开关未开，自动开启总开关防止 UI 状态不一致
        if (enabled && !inst.physicsEnabled) {
            this.setPhysics(id, true);
        }
        const states = inst.mmdModel.rigidBodyStates;
        if (!states) {
            return;
        }
        const catMap = _buildRigidBodyCatMap(inst.mmdModel);
        const init = this._initialRigidBodyStates.get(id);
        for (const [rbi, c] of catMap) {
            if (c !== cat || rbi >= states.length) {
                continue;
            }
            // init 可能比当前 rigidBodyStates 短（历史场景/类别后加），越界时回退 1，避免写 0 假停用
            states[rbi] = enabled ? (init && rbi < init.length ? init[rbi] : 1) : 0;
        }
        let physMap = this._physicsCatState.get(id);
        if (!physMap) {
            physMap = new Map();
            this._physicsCatState.set(id, physMap);
        }
        physMap.set(cat, enabled);
        this.triggerAutoSave();
    }

    // ======== Morphs ========

    getMorphs(id: string): Array<{ name: string; type: number }> {
        const inst = this.modelRegistry.get(id);
        if (!inst || !inst.mmdModel || !inst.mmdModel.morph || !inst.mmdModel.morph.morphs) {
            return [];
        }
        return inst.mmdModel.morph.morphs.map((m) => ({ name: m.name, type: m.type }));
    }

    setMorphWeight(id: string, morphName: string, weight: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst || !inst.mmdModel || !inst.mmdModel.morph) {
            return;
        }
        inst.mmdModel.morph.setMorphWeight(morphName, weight);
    }

    getMorphWeight(id: string, morphName: string): number {
        const inst = this.modelRegistry.get(id);
        if (!inst || !inst.mmdModel || !inst.mmdModel.morph) {
            return 0;
        }
        return inst.mmdModel.morph.getMorphWeight(morphName);
    }

    resetMorphs(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst || !inst.mmdModel || !inst.mmdModel.morph) {
            return;
        }
        inst.mmdModel.morph.resetMorphWeights();
        this.triggerAutoSave();
    }

    // ======== Skeletal Bone Overlay ========

    private createBoneOverlay(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst.mmdModel) {
            return;
        }
        if (this._boneOverlayMap.has(id)) {
            return;
        }
        const bones = inst.mmdModel.runtimeBones;
        if (!bones || bones.length === 0) {
            return;
        }

        const lines: Vector3[][] = [];
        const tmp = new Vector3();
        const joints: Mesh[] = [];
        const jointData: { mesh: Mesh; boneIndex: number; boneName: string }[] = [];
        const lineData: { childIndex: number; parentIndex: number }[] = [];

        // 懒加载覆盖着色材质
        if (!this._ovMaterials) {
            this._ovMaterials = {
                default: new StandardMaterial('bone_ov_default', this.scene),
                rotation: new StandardMaterial('bone_ov_rotation', this.scene),
                position: new StandardMaterial('bone_ov_position', this.scene),
                both: new StandardMaterial('bone_ov_both', this.scene),
            };
            this._ovMaterials.default.diffuseColor = new Color3(1, 1, 1);
            this._ovMaterials.rotation.diffuseColor = new Color3(1, 0.2, 0.2); // 红 — 旋转覆盖
            this._ovMaterials.position.diffuseColor = new Color3(0.2, 0.5, 1); // 蓝 — 位置覆盖
            this._ovMaterials.both.diffuseColor = new Color3(1, 0.3, 1); // 紫 — 旋转 + 位置
        }
        const ovMat = this._ovMaterials;

        for (let i = 0; i < bones.length; i++) {
            const bone = bones[i];
            const parent = bone.parentBone;
            if (!parent) {
                continue;
            }

            // 找到父骨骼的索引
            const parentIndex = bones.indexOf(parent);
            if (parentIndex === -1) {
                continue;
            }

            // Joint sphere at bone position
            bone.getWorldTranslationToRef(tmp);
            const pos = tmp.clone();
            const sphere = MeshBuilder.CreateSphere(
                'bone_joint',
                { diameter: 1.5, segments: 8 },
                this.scene
            );
            sphere.position.copyFrom(pos);
            sphere.setEnabled(false);
            joints.push(sphere);
            jointData.push({ mesh: sphere, boneIndex: i, boneName: bone.name });

            // Bone line from parent to child
            const parentPos = new Vector3();
            parent.getWorldTranslationToRef(parentPos);
            lines.push([parentPos.clone(), pos.clone()]);
            lineData.push({ childIndex: i, parentIndex });
        }

        // Create overlay: line system + sphere meshes
        // updatable: true 必填，否则 updateVerticesData 不写入 GPU buffer，骨骼线无法跟随骨骼运动
        const lineSystem = MeshBuilder.CreateLineSystem(
            'bone_overlay_lines',
            { lines, updatable: true },
            this.scene
        );
        lineSystem.color = new Color3(1, 1, 1);
        lineSystem.isPickable = false;
        lineSystem.setEnabled(inst.showBoneLines);

        // [doc:bone-override] 覆盖着色线段：为每对骨骼创建独立 LinesMesh，
        // 根据覆盖状态显示/隐藏/着色。白色 lineSystem 不可逐段着色，需独立 mesh。
        const overrideLines: LinesMesh[] = [];
        for (let i = 0; i < lineData.length; i++) {
            const ovLine = MeshBuilder.CreateLines(
                'bone_ov_line',
                {
                    points: [Vector3.Zero(), Vector3.Zero()],
                    updatable: true,
                },
                this.scene
            );
            ovLine.isPickable = false;
            ovLine.setEnabled(false);
            overrideLines.push(ovLine);
        }

        let dirty = true;
        const markDirty = () => {
            dirty = true;
        };

        const updateFn = () => {
            if (!dirty) {
                return;
            }
            dirty = false;

            if (inst.showBoneLines && lineSystem.isEnabled()) {
                const positions = lineSystem.getVerticesData('position');
                if (positions) {
                    for (let i = 0; i < lineData.length; i++) {
                        const ld = lineData[i];
                        const childBone = bones[ld.childIndex];
                        const parentBone = bones[ld.parentIndex];

                        if (childBone && parentBone) {
                            parentBone.getWorldTranslationToRef(tmp);
                            positions[i * 6] = tmp.x;
                            positions[i * 6 + 1] = tmp.y;
                            positions[i * 6 + 2] = tmp.z;

                            childBone.getWorldTranslationToRef(tmp);
                            positions[i * 6 + 3] = tmp.x;
                            positions[i * 6 + 4] = tmp.y;
                            positions[i * 6 + 5] = tmp.z;
                        }
                    }
                    lineSystem.updateVerticesData('position', positions);
                }

                // [doc:bone-override] 覆盖线段着色
                const ovLineColors: Record<
                    OverrideType | 'default',
                    Color3
                > = {
                    rotation: new Color3(1, 0.3, 0.3), // 红
                    position: new Color3(0.3, 0.5, 1), // 蓝
                    both: new Color3(1, 0.3, 1), // 紫
                    default: new Color3(0.5, 0.5, 0.5), // 灰
                };
                for (let i = 0; i < lineData.length; i++) {
                    const ld = lineData[i];
                    const childBone = bones[ld.childIndex];
                    const parentBone = bones[ld.parentIndex];
                    if (!childBone || !parentBone) {
                        overrideLines[i].setEnabled(false);
                        continue;
                    }
                    const childOv = getSceneAction('getOverrideType')?.(childBone.name, id) ?? null;
                    const parentOv = getSceneAction('getOverrideType')?.(parentBone.name, id) ?? null;
                    const ovType = childOv ?? parentOv;
                    if (!ovType) {
                        overrideLines[i].setEnabled(false);
                        continue;
                    }
                    const ovLine = overrideLines[i];
                    const ovPositions = ovLine.getVerticesData('position');
                    if (ovPositions) {
                        parentBone.getWorldTranslationToRef(tmp);
                        ovPositions[0] = tmp.x;
                        ovPositions[1] = tmp.y;
                        ovPositions[2] = tmp.z;
                        childBone.getWorldTranslationToRef(tmp);
                        ovPositions[3] = tmp.x;
                        ovPositions[4] = tmp.y;
                        ovPositions[5] = tmp.z;
                        ovLine.updateVerticesData('position', ovPositions);
                    }
                    ovLine.color = ovLineColors[ovType];
                    ovLine.setEnabled(true);
                }
            }

            if (!inst.showBoneJoints) {
                return;
            }
            for (const jd of jointData) {
                const bone = bones[jd.boneIndex];
                if (!bone) {
                    jd.mesh.setEnabled(false);
                    continue;
                }
                bone.getWorldTranslationToRef(tmp);
                jd.mesh.position.copyFrom(tmp);
                jd.mesh.setEnabled(true);

                // [doc:bone-override] 覆盖状态着色
                const ovType = getSceneAction('getOverrideType')?.(jd.boneName, id) ?? null;
                jd.mesh.material = ovType ? ovMat[ovType] : ovMat.default;
            }
        };

        // 不合并 sphere meshes：
        // Mesh.MergeMeshes(disposeSource=true) 会 dispose 原始 sphere，
        // 而合并后 overlay 的顶点数据无法逐 bone 更新 —— 关节球一旦创建就固化在初始位置。
        // 改为保留独立 sphere mesh，每帧由 updateFn 直接修改 mesh.position 跟随骨骼世界坐标。
        for (const j of joints) {
            j.isPickable = false;
            j.setEnabled(inst.showBoneJoints);
        }

        this._boneOverlayMap.set(id, {
            lineSystem,
            joints,
            overrideLines,
            update: updateFn,
            dirty: true,
            markDirty,
        });
        this.ensureBoneUpdateObserver();
    }

    private destroyBoneOverlay(id: string): void {
        const entry = this._boneOverlayMap.get(id);
        if (entry) {
            entry.lineSystem.dispose();
            for (const j of entry.joints) {
                j.dispose();
            }
            for (const ol of entry.overrideLines) {
                ol.dispose();
            }
            this._boneOverlayMap.delete(id);
        }
    }

    private ensureBoneUpdateObserver(): void {
        if (this._boneUpdateObserver) {
            return;
        }
        this._boneUpdateObserver = observe(this.scene.onBeforeRenderObservable, () => {
            const toDelete: string[] = [];
            for (const [id, entry] of this._boneOverlayMap) {
                const inst = this.modelRegistry.get(id);
                // 模型已 dispose（mmdModel 非 null 但 mesh 已释放）时跳过更新并延迟清理，避免访问已销毁骨骼
                if (
                    !inst ||
                    !inst.mmdModel ||
                    inst.mmdModel.mesh?.isDisposed() ||
                    (!inst.showBoneLines && !inst.showBoneJoints)
                ) {
                    entry.lineSystem.dispose();
                    for (const j of entry.joints) {
                        j.dispose();
                    }
                    for (const ol of entry.overrideLines) {
                        ol.dispose();
                    }
                    toDelete.push(id);
                    continue;
                }
                // WASM 物理恒启用，叠加层可见即每帧更新
                entry.markDirty();
                entry.update();
            }
            for (const id of toDelete) {
                this._boneOverlayMap.delete(id);
            }
        });
    }

    /** Clean up all observers. Called on shutdown. */
    dispose(): void {
        if (this._boneUpdateObserver) {
            this._boneUpdateObserver.dispose();
            this._boneUpdateObserver = null;
        }
        // Dispose all bone overlay resources (lineSystem + joints + overrideLines)
        for (const [, entry] of this._boneOverlayMap) {
            entry.lineSystem.dispose();
            for (const j of entry.joints) {
                j.dispose();
            }
            for (const ol of entry.overrideLines) {
                ol.dispose();
            }
        }
        this._boneOverlayMap.clear();
        // Dispose override coloring materials
        if (this._ovMaterials) {
            this._ovMaterials.default.dispose();
            this._ovMaterials.rotation.dispose();
            this._ovMaterials.position.dispose();
            this._ovMaterials.both.dispose();
            this._ovMaterials = null;
        }
        // Dispose all remaining outfit overlays
        for (const [, inst] of this.modelRegistry) {
            getSceneAction('disposeOverlay')?.(inst);
            getSceneAction('restoreMaterials')?.(inst);
        }
    }

    // ======== [doc:adr-215] 模型附属关系管理 ========

    /**
     * DAG 校验：从 startId 沿 parentId 链向上追溯，是否能到达 targetId。
     * 用于判断「把 child 附属到 parent」是否成环——若 parent 的祖先链中已含 child
     * （即 child 是 parent 的祖先），则新建 child←parent 会成环。
     */
    private _hasAncestor(startId: string, targetId: string): boolean {
        const visited = new Set<string>();
        let currentId: string | undefined = startId;
        while (currentId) {
            if (currentId === targetId) {
                return true;
            }
            if (visited.has(currentId)) {
                return false;
            }
            visited.add(currentId);
            currentId = this.modelRegistry.get(currentId)?.parentId;
        }
        return false;
    }

    /**
     * 将子模型（角色配件）附属到父模型的指定骨骼上。
     * 含 DAG 校验、单父限制、骨骼名 guard。
     * @returns 是否成功
     */
    attachModelToBone(
        childId: string,
        parentId: string,
        boneName: string,
        offset: [number, number, number] = [0, 0, 0],
        rotation: [number, number, number] = [0, 0, 0]
    ): boolean {
        const childInst = this.modelRegistry.get(childId);
        if (!childInst) {
            logWarn('model-manager', 'attachModelToBone: child not found:', childId);
            return false;
        }
        const parentInst = this.modelRegistry.get(parentId);
        if (!parentInst?.mmdModel) {
            logWarn(
                'model-manager',
                'attachModelToBone: parent not found or no mmd runtime:',
                parentId
            );
            return false;
        }

        // DAG 校验：防止成环。
        // 从 parent 沿 parentId 链向上追溯，若能到达 child，说明 child 是 parent 的祖先，
        // 建立 child←parent 会成环（child 自身旧 parentId 指向别处不影响此追溯）。
        // 反向也需检查：若 child 沿 parentId 链向上能到达 parent，说明 child 已为 parent 后代，
        // 直接建立 child←parent 也会成环。但排除 child 已直接附属到此 parent 的情况（重挂载）。
        const childIsDescendant =
            childInst.parentId !== undefined &&
            childInst.parentId !== parentId &&
            this._hasAncestor(childInst.parentId, parentId);
        if (childId === parentId || this._hasAncestor(parentId, childId) || childIsDescendant) {
            logWarn('model-manager', 'attachModelToBone: would create cycle');
            feedbackStatus('scene.accessory.cycleDetected', undefined, false);
            return false;
        }

        // 骨骼名 guard
        const rb = parentInst.mmdModel.runtimeBones.find((b) => b.name === boneName);
        if (!rb) {
            logWarn('model-manager', 'attachModelToBone: bone not found:', boneName);
            feedbackStatus('scene.accessory.boneNotFound', undefined, false, { bone: boneName });
            return false;
        }

        const linkedBone = (
            rb as unknown as { linkedBone?: import('@babylonjs/core/Bones/bone').Bone }
        ).linkedBone;
        if (!linkedBone) {
            logWarn('model-manager', 'attachModelToBone: bone has no linkedBone:', boneName);
            return false;
        }

        // [adr-215] 单父限制：换父需先 detach 再 attach。
        // 若 child 已附属到其他父（parentId 存在且 ≠ 新父），必须先解除旧父的
        // bone attach 状态，否则 mesh 会同时 attach 到多个骨骼，造成变换叠加。
        if (childInst.parentId && childInst.parentId !== parentId) {
            childInst.rootMesh.detachFromBone();
        }

        // 记录附属关系
        childInst.parentId = parentId;
        childInst.attachedBone = boneName;
        childInst.attachedOffset = offset;
        childInst.attachedRotation = rotation;

        const target = childInst.rootMesh;
        target.position.set(offset[0], offset[1], offset[2]);
        const rotQ = Quaternion.FromEulerAngles(
            (rotation[0] * Math.PI) / 180,
            (rotation[1] * Math.PI) / 180,
            (rotation[2] * Math.PI) / 180
        );
        target.rotationQuaternion = rotQ;
        target.attachToBone(linkedBone, parentInst.rootMesh);

        showInfoToast(t('scene.accessory.attached', { name: childInst.name, bone: boneName }));
        this.triggerAutoSave();
        return true;
    }

    /**
     * 解除子模型的骨骼附属，回到场景坐标模式。
     * 保留在 modelRegistry 中，可独立操作或重新挂载。
     */
    detachModelFromBone(childId: string): void {
        const childInst = this.modelRegistry.get(childId);
        if (!childInst) {
            return;
        }
        // [doc:adr-215] 未附属的模型无需 detach：跳过 detachFromBone / toast / autoSave，
        // 避免对未挂载网格产生无意义的世界矩阵快照与副作用。
        if (!childInst.parentId) {
            return;
        }

        const target = childInst.rootMesh;
        const worldMat = target.getWorldMatrix().clone();
        target.detachFromBone();

        childInst.parentId = undefined;
        childInst.attachedBone = undefined;
        childInst.attachedOffset = undefined;
        childInst.attachedRotation = undefined;

        target.position = worldMat.getTranslation();
        target.rotationQuaternion = Quaternion.FromRotationMatrix(worldMat.getRotationMatrix());

        showInfoToast(t('scene.accessory.detached', { name: childInst.name }));
        this.triggerAutoSave();
    }

    /**
     * 重新挂载所有附属模型（场景恢复时调用）。
     * 遍历 modelRegistry 中所有 parentId !== undefined 的实例。
     */
    reattachAllAttachments(): void {
        for (const [childId, inst] of this.modelRegistry) {
            if (inst.parentId && inst.attachedBone) {
                const target = inst.rootMesh;
                try {
                    target.detachFromBone();
                } catch (detachErr) {
                    // 记录失败并继续 attach：目标本就是恢复附属关系，attachModelToBone
                    // 内部有独立的错误处理（返回 false + feedbackStatus），此处仅记录。
                    logWarn(
                        'model-manager',
                        'reattachAllAttachments: detachFromBone failed:',
                        detachErr
                    );
                }
                this.attachModelToBone(
                    childId,
                    inst.parentId,
                    inst.attachedBone,
                    inst.attachedOffset ?? [0, 0, 0],
                    inst.attachedRotation ?? [0, 0, 0]
                );
            }
        }
    }

    /**
     * 卸载父模型时，级联卸载其附属子模型。
     * 遍历 modelRegistry 中所有 parentId === parentId 的实例并移除。
     */
    detachChildModels(parentId: string): void {
        const childIds = [...this.modelRegistry]
            .filter(([, inst]) => inst.parentId === parentId)
            .map(([id]) => id);
        for (const cid of childIds) {
            this.remove(cid);
        }
    }
}
