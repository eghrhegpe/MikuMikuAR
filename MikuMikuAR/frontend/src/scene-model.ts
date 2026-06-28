// [doc:architecture] Model Manager — 模型注册表 + 生命周期 + 属性管理
// 职责: 封装 modelRegistry、focusedModelId、per-model 状态 map
//       提供模型 CRUD、属性设置、骨骼覆盖、物理类别、Morph 操作
// 消费者: scene.ts (编排器)、model-detail.ts (UI)、serialization
//
// 设计原则:
// - 不直接调用 triggerAutoSave → 通过 onChange 回调触发
// - 不引用 scene.ts 中的任何符号 → 无循环依赖
// - 模型状态完全封装，外部只能通过方法访问

import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Observer } from "@babylonjs/core/Misc/observable";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { MmdWasmModel } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmModel";

import { ModelInstance, setFocusedModelId, focusedModelId as configFocusedId, type PhysicsCategory } from "./config";

// ======== Per-model state maps ========
// (owned by ModelManager, not exported directly)

const PHYSICS_CAT_PATTERNS: [PhysicsCategory, RegExp][] = [
    ["skirt", /スカート|skirt|フリル|frill|裾|hem/],
    ["chest", /胸|chest|bust|バスト/],
    ["hair", /髪|hair|ahoge|bangs|ponytail|前髪|後ろ髪/],
    ["accessory", /リボン|ribbon|アクセサリ|accessory|飾り|collar|ネクタイ|tie|紐|string|襟/],
];

function _classifyBonePhysics(name: string): PhysicsCategory | null {
    const l = name.toLowerCase();
    for (const [cat, re] of PHYSICS_CAT_PATTERNS) {
        if (re.test(l)) return cat;
    }
    return null;
}

function _buildRigidBodyCatMap(mmdModel: MmdWasmModel): Map<number, PhysicsCategory> {
    const bones = mmdModel.runtimeBones;
    const map = new Map<number, PhysicsCategory>();
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (bone.rigidBodyIndices.length === 0) continue;
        const cat = _classifyBonePhysics(bone.name);
        if (!cat) continue;
        for (const rbi of bone.rigidBodyIndices) {
            map.set(rbi, cat);
        }
    }
    return map;
}

/** Apply the current visibility, opacity, and wireframe state to meshes. */
function syncModelVisibility(inst: ModelInstance): void {
    for (const m of inst.meshes) {
        m.setEnabled(inst.visible);
        if (m.material) {
            m.material.alpha = inst.opacity;
            if (m.material instanceof StandardMaterial) {
                m.material.wireframe = inst.wireframe;
            }
        }
    }
}

/** Apply the current scaling and rotation state to the root mesh. */
function syncModelTransform(inst: ModelInstance): void {
    if (inst.meshes.length > 0) {
        const root = inst.meshes[0];
        root.scaling.setAll(inst.scaling);
        root.rotation.y = inst.rotationY;
    }
}

// ======== ModelManager Class ========

export class ModelManager {
    // --- State ---
    readonly modelRegistry = new Map<string, ModelInstance>();
    /** Delegates to config's focusedModelId for cross-module consistency. */
    get focusedModelId(): string | null { return configFocusedId; }
    private set _focusedModelId(v: string | null) { setFocusedModelId(v); }

    private _initialRigidBodyStates = new Map<string, Uint8Array>();
    private _physicsCatState = new Map<string, Map<string, boolean>>();
    private _boneOverlayMap = new Map<string, { overlay: Mesh; joints: Mesh[]; update: () => void }>();
    private _boneUpdateObserver: Observer<Scene> | null = null;

    /** Cleanup callback invoked by removeModel for external per-model state. */
    onRemoveModel: ((id: string) => void) | null = null;

    constructor(
        private scene: Scene,
        private onChange: () => void,
        private autoFrame: (center: Vector3, extent: number) => void,
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
    get size(): number { return this.modelRegistry.size; }

    /** Register a new model instance. */
    register(inst: ModelInstance): void {
        this.modelRegistry.set(inst.id, inst);
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

    /** Get the currently focused MmdWasmModel, or null. */
    focusedMmdModel(): MmdWasmModel | null {
        return configFocusedId
            ? this.modelRegistry.get(configFocusedId)?.mmdModel ?? null
            : null;
    }

    /** Find a model by file path. Returns the first match or undefined. */
    findByFilePath(filePath: string): ModelInstance | undefined {
        for (const inst of this.modelRegistry.values()) {
            if (inst.filePath === filePath) return inst;
        }
        return undefined;
    }

    // ======== Model Lifecycle ========

    /** Remove a model and clean up all associated state. */
    remove(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;

        if (inst.mmdModel) {
            // mmdRuntime.destroyMmdModel is called externally (scene.ts loadPMXFile)
            // because ModelManager doesn't own mmdRuntime
        }
        for (const m of inst.meshes) {
            if (m instanceof Mesh) m.dispose();
        }
        inst._origTextures = undefined;
        inst.outfitFile = undefined;

        this.modelRegistry.delete(id);
        this._initialRigidBodyStates.delete(id);
        this._physicsCatState.delete(id);
        this._boneOverlayMap.delete(id);
        this.destroyBoneOverlay(id);

        // External cleanup (material state, proc motion state, etc.)
        this.onRemoveModel?.(id);

        // Update focus
        if (configFocusedId === id) {
            setFocusedModelId(this.modelRegistry.size > 0
                ? this.modelRegistry.keys().next().value
                : null);
        }
        if (configFocusedId) this.focus(configFocusedId);
    }

    /** Remove the currently focused model. */
    removeFocused(): void {
        if (!configFocusedId) return;
        this.remove(configFocusedId);
    }

    /** Focus a model by ID: set focus + auto-frame camera. */
    focus(id: string): void {
        setFocusedModelId(id);
        const inst = this.modelRegistry.get(id);
        if (!inst) return;

        // Auto-frame camera: compute bounding box from all meshes
        const min = new Vector3(Infinity, Infinity, Infinity);
        const max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const m of inst.meshes) {
            m.computeWorldMatrix(true);
            const bb = m.getBoundingInfo().boundingBox;
            min.minimizeInPlace(bb.minimumWorld);
            max.maximizeInPlace(bb.maximumWorld);
        }
        const center = min.add(max).scale(0.5);
        const size = max.subtract(min);
        const extent = Math.max(size.x, size.y, size.z);

        this.autoFrame(center, extent);

        this.onChange();
    }

    /** Arrange all models in a horizontal row. */
    arrange(): void {
        const models = Array.from(this.modelRegistry.values());
        const spacing = 3;
        models.forEach((inst, i) => {
            const offsetX = (i - (models.length - 1) / 2) * spacing;
            if (inst.meshes.length > 0) inst.meshes[0].position.x = offsetX;
        });
        this.onChange();
    }

    // ======== Property Setters ========

    setVisibility(id: string, visible: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.visible = visible;
        syncModelVisibility(inst);
        this.onChange();
    }

    setOpacity(id: string, opacity: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.opacity = Math.max(0, Math.min(1, opacity));
        syncModelVisibility(inst);
        this.onChange();
    }

    setWireframe(id: string, wireframe: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.wireframe = wireframe;
        syncModelVisibility(inst);
        this.onChange();
    }

    setBoneVis(id: string, show: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.showBones = show;
        if (show) {
            this.createBoneOverlay(id);
        } else {
            this.destroyBoneOverlay(id);
        }
        this.onChange();
    }

    setPhysics(id: string, enabled: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.physicsEnabled = enabled;
        const mmdModel = inst.mmdModel;
        if (mmdModel) {
            const states = mmdModel.rigidBodyStates;
            if (states) {
                if (enabled) {
                    const init = (this._initialRigidBodyStates.get(id) || new Uint8Array(0));
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
        this._physicsCatState.delete(id);
        this.onChange();
    }

    setScaling(id: string, scaling: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.scaling = Math.max(0.01, scaling);
        syncModelTransform(inst);
        this.onChange();
    }

    setRotationY(id: string, rotationY: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.rotationY = rotationY;
        syncModelTransform(inst);
        this.onChange();
    }

    setPosition(id: string, x: number, y: number, z: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        if (inst.meshes.length > 0) {
            inst.meshes[0].position.set(x, y, z);
        }
        this.onChange();
    }

    getPosition(id: string): [number, number, number] {
        const inst = this.modelRegistry.get(id);
        if (!inst || inst.meshes.length === 0) return [0, 0, 0];
        const p = inst.meshes[0].position;
        return [p.x, p.y, p.z];
    }

    resetTransform(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.visible = true;
        inst.opacity = 1.0;
        inst.wireframe = false;
        inst.scaling = 1.0;
        inst.rotationY = 0;
        if (inst.meshes.length > 0) {
            inst.meshes[0].position.set(0, 0, 0);
        }
        syncModelVisibility(inst);
        syncModelTransform(inst);
        this.onChange();
    }

    /** Stop VMD animation on a model and clean up associated state. */
    stopVMD(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst) return;
        inst.vmdData = null;
        inst.vmdName = "";
        inst.vmdPath = null;
        inst.animationDuration = 0;
        this.onChange();
    }

    // ======== Physics Categories ========

    getPhysicsCategories(id: string): PhysicsCategory[] {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel) return [];
        const map = _buildRigidBodyCatMap(inst.mmdModel);
        const set = new Set(map.values());
        return [...set];
    }

    getPhysicsCatState(id: string): Record<string, boolean> | null {
        const state = this._physicsCatState.get(id);
        if (!state || state.size === 0) return null;
        const result: Record<string, boolean> = {};
        for (const [cat, enabled] of state) result[cat] = enabled;
        return result;
    }

    isPhysicsCategoryEnabled(id: string, cat: string): boolean {
        return this._physicsCatState.get(id)?.get(cat) ?? true;
    }

    setPhysicsCategory(id: string, cat: string, enabled: boolean): void {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel) return;
        const states = inst.mmdModel.rigidBodyStates;
        if (!states) return;
        const catMap = _buildRigidBodyCatMap(inst.mmdModel);
        const init = this._initialRigidBodyStates.get(id);
        for (const [rbi, c] of catMap) {
            if (c !== cat || rbi >= states.length) continue;
            states[rbi] = enabled ? (init ? init[rbi] : 1) : 0;
        }
        if (!this._physicsCatState.has(id)) this._physicsCatState.set(id, new Map());
        this._physicsCatState.get(id)!.set(cat, enabled);
        this.onChange();
    }

    // ======== Morphs ========

    getMorphs(id: string): Array<{ name: string; type: number }> {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel?.morph?.morphs) return [];
        return inst.mmdModel.morph.morphs.map(m => ({ name: m.name, type: m.type }));
    }

    setMorphWeight(id: string, morphName: string, weight: number): void {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel?.morph) return;
        inst.mmdModel.morph.setMorphWeight(morphName, weight);
    }

    getMorphWeight(id: string, morphName: string): number {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel?.morph) return 0;
        return inst.mmdModel.morph.getMorphWeight(morphName);
    }

    resetMorphs(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel?.morph) return;
        inst.mmdModel.morph.resetMorphWeights();
    }

    // ======== Skeletal Bone Overlay ========

    private createBoneOverlay(id: string): void {
        const inst = this.modelRegistry.get(id);
        if (!inst?.mmdModel) return;
        if (this._boneOverlayMap.has(id)) return;

        const bones = inst.mmdModel.runtimeBones;
        if (!bones || bones.length === 0) return;

        const physicsBoneSet = new Set<number>();
        for (let i = 0; i < bones.length; i++) {
            if (bones[i].rigidBodyIndices.length > 0) {
                physicsBoneSet.add(i);
            }
        }

        const lines: Vector3[][] = [];
        const tmp = new Vector3();
        const joints: Mesh[] = [];
        const jointData: { mesh: Mesh; boneIndex: number }[] = [];

        for (let i = 0; i < bones.length; i++) {
            const bone = bones[i];
            const parent = bone.parentBone;
            if (!parent) continue;

            // Joint sphere at bone position
            bone.getWorldTranslationToRef(tmp);
            const pos = tmp.clone();
            const sphere = MeshBuilder.CreateSphere("bone_joint", { diameter: 1.5, segments: 8 }, this.scene);
            sphere.position.copyFrom(pos);
            sphere.isVisible = false;
            joints.push(sphere);
            jointData.push({ mesh: sphere, boneIndex: i });

            // Bone line from parent to child
            const parentPos = new Vector3();
            parent.getWorldTranslationToRef(parentPos);
            lines.push([parentPos.clone(), pos.clone()]);
        }

        // Create overlay: line system + sphere meshes
        const lineSystem = MeshBuilder.CreateLineSystem("bone_overlay_lines", { lines }, this.scene);
        lineSystem.color = new Color3(1, 1, 1);
        lineSystem.isPickable = false;

        // Update function: reposition joints each frame
        const updateFn = () => {
            for (const jd of jointData) {
                const bone = bones[jd.boneIndex];
                if (!bone) { jd.mesh.setEnabled(false); continue; }
                bone.getWorldTranslationToRef(tmp);
                jd.mesh.position.copyFrom(tmp);
                jd.mesh.setEnabled(true);
            }
        };

        const overlay = Mesh.MergeMeshes(joints, true, true, undefined, false, true) as Mesh;
        if (overlay) {
            overlay.position.set(0, 0, 0);
            overlay.isPickable = false;
        } else {
            // fallback: keep individual spheres visible
            for (const j of joints) j.isVisible = true;
        }

        this._boneOverlayMap.set(id, { overlay: overlay || joints[0], joints, update: updateFn });
        this.ensureBoneUpdateObserver();
    }

    private destroyBoneOverlay(id: string): void {
        const entry = this._boneOverlayMap.get(id);
        if (entry) {
            entry.overlay.dispose();
            for (const j of entry.joints) j.dispose();
            this._boneOverlayMap.delete(id);
        }
    }

    private ensureBoneUpdateObserver(): void {
        if (this._boneUpdateObserver) return;
        this._boneUpdateObserver = this.scene.onBeforeRenderObservable.add(() => {
            const toDelete: string[] = [];
            for (const [id, entry] of this._boneOverlayMap) {
                const inst = this.modelRegistry.get(id);
                if (!inst || !inst.showBones || !inst.mmdModel) {
                    entry.overlay.dispose();
                    for (const j of entry.joints) j.dispose();
                    toDelete.push(id);
                    continue;
                }
                entry.update();
            }
            for (const id of toDelete) this._boneOverlayMap.delete(id);
        });
    }

    /** Clean up all observers. Called on shutdown. */
    dispose(): void {
        if (this._boneUpdateObserver) {
            this.scene.onBeforeRenderObservable.remove(this._boneUpdateObserver);
            this._boneUpdateObserver = null;
        }
    }

    // ======== Thumbnail ========

    /** Captures a screenshot after model load for thumbnail cache. */
    async captureThumbnail(filePath: string, canvas: HTMLCanvasElement, saveFn: (path: string, data: string) => Promise<void>): Promise<void> {
        try {
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => requestAnimationFrame(r));
            const base64 = canvas.toDataURL("image/png", 0.8);
            const raw = base64.replace(/^data:image\/png;base64,/, "");
            await saveFn(filePath, raw);
        } catch (err) {
            console.warn("captureThumbnail:", err);
        }
    }
}
