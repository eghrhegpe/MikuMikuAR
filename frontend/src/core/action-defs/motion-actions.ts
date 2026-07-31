import { registerAction } from '../action-registry';
import { setLipSyncEnabled, getLipSyncState } from '../../scene/motion/lipsync-bridge';
import {
    clearAllSceneMotions,
    addSceneMotion,
    replaceDefaultMotion,
} from '../../scene/motion/motion-intent';
import { pushUndoSnapshot, offerSceneUndoAndRefresh } from '../../scene/scene-serialize';
import { updatePlaybackUI } from '../../scene/motion/playback';
import { triggerAutoSave } from '../config';
import { feedbackInfo } from '../feedback';
import { showInfoToast } from '../toast';
import { showConfirm } from '../dialog';
import { isPlaying, setIsPlaying } from '../playback-state';
import { mmdRuntime } from '../scene-state';
import { getMotionMenu, refreshMotionRoot } from '../../menus/motion-popup';
import { buildMotionRootItems, importExternalAnimation } from '../../menus/motion-root-ui';
import {
    handleModelAction,
    resetFocusedLayerId,
    buildActionBindingLevel,
} from '../../menus/motion-binding-ui';
import { buildMotionDetailLevel } from '../../menus/motion-detail-ui';
import { setProcMotionMode, regenerateProcMotion } from '../../scene/motion/proc-motion-bridge';
import type { ProcMotionMode } from '../../motion-algos/procedural-motion';
import { loadManager } from '../load-manager';
import { loadVPDPose, modelManager } from '../../scene/scene';
import { getAudioName } from '../../outfit/audio';
import { t } from '../i18n/t';
import { stackRegistry } from '../config';
import { getBrowseDir } from '../../library/library-path';

/** 按名称模糊搜索场景内已加载模型（供 entity resolve 消费）。 */
async function findSceneModelByName(name: string): Promise<unknown> {
    return (
        modelManager.getAll().find((m) => m.name.toLowerCase().includes(name.toLowerCase())) ?? null
    );
}

export function registerMotionActions(): void {
    registerAction({
        id: 'motion:lipsync:toggle',
        label: 'ai.actions.motion.lipsync.toggle',
        domain: 'motion',
        icon: 'lucide:languages',
        params: [],
        destructive: false,
        execute: async () => {
            setLipSyncEnabled(!getLipSyncState().enabled);
        },
    });

    registerAction({
        id: 'motion:clear-all',
        label: 'ai.actions.motion.clearAll',
        domain: 'motion',
        icon: 'lucide:eraser',
        params: [],
        destructive: true,
        execute: async () => {
            if (!(await showConfirm(t('motion.clearAllConfirm')))) {
                return;
            }
            const snap = pushUndoSnapshot();
            clearAllSceneMotions();
            if (isPlaying && mmdRuntime) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
            }
            updatePlaybackUI();
            refreshMotionRoot();
            triggerAutoSave();
            feedbackInfo('motion.motionCleared', undefined);
            offerSceneUndoAndRefresh('motion.motionCleared', snap, () => {
                refreshMotionRoot();
            });
        },
    });

    registerAction({
        id: 'motion:retarget:mixamo',
        label: 'ai.actions.motion.retarget.mixamo',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            importExternalAnimation('mixamo');
        },
    });

    registerAction({
        id: 'motion:retarget:vrm',
        label: 'ai.actions.motion.retarget.vrm',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            importExternalAnimation('vrm');
        },
    });

    registerAction({
        id: 'motion:retarget:custom',
        label: 'ai.actions.motion.retarget.custom',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            importExternalAnimation('custom');
        },
    });

    registerAction({
        id: 'motion:model:pause',
        label: 'ai.actions.motion.model.pause',
        domain: 'motion',
        icon: 'lucide:play',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        execute: async (p) => {
            await handleModelAction('pause', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:reset',
        label: 'ai.actions.motion.model.reset',
        domain: 'motion',
        icon: 'lucide:refresh-cw',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: true,
        execute: async (p) => {
            await handleModelAction('reset', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:pose',
        label: 'ai.actions.motion.model.pose',
        domain: 'motion',
        icon: 'lucide:palette',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        execute: async (p) => {
            await handleModelAction('pose', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:loop',
        label: 'ai.actions.motion.model.loop',
        domain: 'motion',
        icon: 'lucide:repeat',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        execute: async (p) => {
            await handleModelAction('loop', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:procmotion:set-mode',
        label: 'ai.actions.motion.procmotion.setMode',
        domain: 'motion',
        icon: 'lucide:bot',
        params: [
            {
                name: 'mode',
                type: 'enum',
                enum: ['idle', 'walking', 'running', 'dancing', 'breathing'] as const,
            },
        ],
        destructive: false,
        execute: async (p) => {
            setProcMotionMode(p.mode as ProcMotionMode);
            regenerateProcMotion();
        },
    });

    // ── 模型格式分支（文件选择回调） ──

    registerAction({
        id: 'motion:load-camera-vmd',
        label: 'ai.actions.motion.loadCameraVmd',
        domain: 'motion',
        icon: 'lucide:video',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            await loadManager.load({ kind: 'camera-vmd', path: p.path as string });
        },
    });

    registerAction({
        id: 'motion:add-scene-vmd',
        label: 'ai.actions.motion.addSceneVmd',
        domain: 'motion',
        icon: 'lucide:film',
        params: [
            { name: 'path', type: 'string' },
            { name: 'name', type: 'string' },
        ],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            addSceneMotion({
                vmdPath: p.path as string,
                vmdName:
                    (p.name as string) ||
                    (p.path as string)
                        .split(/[/\\]/)
                        .pop()
                        ?.replace(/\.\w+$/, '') ||
                    '',
                vmdLayers: [],
                source: 'vmd',
            });
        },
    });

    registerAction({
        id: 'motion:load-audio',
        label: 'ai.actions.motion.loadAudio',
        domain: 'motion',
        icon: 'lucide:music',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            loadManager.load({ kind: 'audio', path: p.path as string });
            showInfoToast(t('motion.musicLoaded', { name: getAudioName() }));
        },
    });

    registerAction({
        id: 'motion:load-vpd',
        label: 'ai.actions.motion.loadVpd',
        domain: 'motion',
        icon: 'lucide:figma',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            loadVPDPose(p.path as string);
        },
    });

    // ── 导航分支 ──

    registerAction({
        id: 'motion:open-binding',
        label: 'ai.actions.motion.openBinding',
        domain: 'motion',
        icon: 'lucide:link',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            resetFocusedLayerId();
            const id = p.modelId as string;
            const lvl = buildActionBindingLevel(id);
            lvl.itemBuilder = () => buildActionBindingLevel(id).items;
            getMotionMenu()?.push(lvl);
        },
    });

    registerAction({
        id: 'motion:browse-music',
        label: 'ai.actions.motion.browseMusic',
        domain: 'motion',
        icon: 'lucide:library',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            const level = stackRegistry.buildLevel!(
                getBrowseDir('audio'),
                t('motion.musicLibrary'),
                (m) => m.format === 'audio',
                getMotionMenu() ?? undefined
            );
            getMotionMenu()?.push(level);
        },
    });

    registerAction({
        id: 'motion:browse-scene-motions',
        label: 'ai.actions.motion.browseSceneMotions',
        domain: 'motion',
        icon: 'lucide:folder-open',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            resetFocusedLayerId();
            const level = stackRegistry.buildLevel!(
                getBrowseDir('vmd'),
                t('motion.browseMotionLibrary'),
                (m) => m.format === 'vmd',
                getMotionMenu() ?? undefined,
                undefined,
                {
                    mode: 'stay',
                    onVmdPick: (path: string, name: string) => {
                        const vmdName = name.replace(/\.vmd$/i, '');
                        addSceneMotion({ vmdPath: path, vmdName, vmdLayers: [], source: 'vmd' });
                        const menu = getMotionMenu();
                        if (menu) {
                            const root = menu.getLevel(0);
                            if (root) {
                                root.items = buildMotionRootItems();
                            }
                        }
                    },
                    onVmdReplace: (path: string, name: string) => {
                        const vmdName = name.replace(/\.vmd$/i, '');
                        replaceDefaultMotion({
                            vmdPath: path,
                            vmdName,
                            vmdLayers: [],
                            source: 'vmd',
                        });
                        const menu = getMotionMenu();
                        if (menu) {
                            const root = menu.getLevel(0);
                            if (root) {
                                root.items = buildMotionRootItems();
                            }
                        }
                    },
                }
            );
            getMotionMenu()?.push(level);
        },
    });

    registerAction({
        id: 'motion:open-detail',
        label: 'ai.actions.motion.openDetail',
        domain: 'motion',
        icon: 'lucide:info',
        params: [{ name: 'sceneMotionId', type: 'string', optional: true }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            const sceneMotionId = p.sceneMotionId as string | undefined;
            const lvl = buildMotionDetailLevel(sceneMotionId);
            lvl.itemBuilder = () => [];
            getMotionMenu()?.push(lvl);
        },
    });
}
