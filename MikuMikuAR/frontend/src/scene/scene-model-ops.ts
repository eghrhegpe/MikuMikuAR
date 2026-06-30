import {
    modelRegistry,
    focusedModelId,
    setFocusedModelId,
    isPlaying,
    setIsPlaying,
    autoLoop,
    isLoadingModel,
    setIsLoadingModel,
    isLoadingVmd,
    setIsLoadingVmd,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    dom,
    pendingVmd,
    setPendingVmd,
    mmdRuntime,
} from '../core/config';
import { _catState, _matState, _matEnabled } from './scene-material';
import { refreshWaterRenderList } from './scene-env';
import { getCameraMode, switchCameraMode } from './camera';
import { updatePlaybackUI } from './scene-playback';
import { disposeAudio } from '../outfit/audio';
import { modelManager } from './scene';

export type PhysicsCategory = 'skirt' | 'chest' | 'hair' | 'accessory';

// ======== Model Lifecycle ========

export function removeModel(id: string): void {
    _catState.delete(id);
    _matState.delete(id);
    _matEnabled.delete(id);
    modelManager?.remove(id);
    refreshWaterRenderList();

    if (focusedModelId === null && getCameraMode() === 'concert') {
        switchCameraMode('orbit');
    }
    if (modelRegistry.size === 0) {
        setIsPlaying(false);
        setIsLoadingModel(false);
        setIsLoadingVmd(false);
        setAutoLoop(true);
        setSeekDragging(false);
        dom.playbackBar.style.display = 'none';
        disposeAudio();
    }
}

export function removeFocusedModel(): void {
    if (!focusedModelId) {
        return;
    }
    removeModel(focusedModelId);
    setPendingVmd(null);
}

export function focusModel(id: string): void {
    modelManager?.focus(id);
    updatePlaybackUI();
}

export function arrangeModels(): void {
    modelManager?.arrange();
}

// ======== Visibility / Material / Debug ========

export function setModelVisibility(id: string, visible: boolean): void {
    modelManager?.setVisibility(id, visible);
}

export function setModelOpacity(id: string, opacity: number): void {
    modelManager?.setOpacity(id, opacity);
}

export function setModelWireframe(id: string, wireframe: boolean): void {
    modelManager?.setWireframe(id, wireframe);
}

export function setModelBoneLinesVis(id: string, show: boolean): void {
    modelManager?.setBoneLinesVis(id, show);
}

export function setModelBoneJointsVis(id: string, show: boolean): void {
    modelManager?.setBoneJointsVis(id, show);
}

// ======== Physics ========

export function setModelPhysics(id: string, enabled: boolean): void {
    modelManager?.setPhysics(id, enabled);
}

export function getPhysicsCategories(id: string): PhysicsCategory[] {
    return modelManager?.getPhysicsCategories(id) ?? [];
}

export function getPhysicsCatState(id: string): Record<string, boolean> | null {
    return modelManager?.getPhysicsCatState(id) ?? null;
}

export function isPhysicsCategoryEnabled(id: string, cat: string): boolean {
    return modelManager?.isPhysicsCategoryEnabled(id, cat) ?? false;
}

export function setPhysicsCategory(id: string, cat: string, enabled: boolean): void {
    modelManager?.setPhysicsCategory(id, cat, enabled);
}

// ======== Transform ========

export function setModelScaling(id: string, scaling: number): void {
    modelManager?.setScaling(id, scaling);
}

export function setModelRotationY(id: string, rotationY: number): void {
    modelManager?.setRotationY(id, rotationY);
}

export function setModelPosition(id: string, x: number, y: number, z: number): void {
    modelManager?.setPosition(id, x, y, z);
}

export function getModelPosition(id: string): [number, number, number] {
    return modelManager?.getPosition(id) ?? [0, 0, 0];
}

export function resetModelTransform(id: string): void {
    modelManager?.resetTransform(id);
}

// ======== VMD ========

export function stopVMD(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    if (inst.mmdModel && mmdRuntime) {
        inst.mmdModel.setRuntimeAnimation(null);
    }
    modelManager?.stopVMD(id);
    if (isPlaying) {
        mmdRuntime.pauseAnimation();
        setIsPlaying(false);
    }
    updatePlaybackUI();
}

// ======== Morph / Expression ========

export function getModelMorphs(id: string): Array<{ name: string; type: number }> {
    return modelManager?.getMorphs(id) ?? [];
}

export function setModelMorphWeight(id: string, morphName: string, weight: number): void {
    modelManager?.setMorphWeight(id, morphName, weight);
}

export function getModelMorphWeight(id: string, morphName: string): number {
    return modelManager?.getMorphWeight(id, morphName) ?? 0;
}

export function resetModelMorphs(id: string): void {
    modelManager?.resetMorphs(id);
}
