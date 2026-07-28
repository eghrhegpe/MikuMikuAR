import { registerAction } from '../action-registry';
import { setLipSyncEnabled, getLipSyncState } from '../../scene/motion/lipsync-bridge';
import { clearAllSceneMotions } from '../../scene/motion/motion-intent';
import { pushUndoSnapshot, offerSceneUndoAndRefresh } from '../../scene/scene-serialize';
import { updatePlaybackUI } from '../../scene/motion/playback';
import { triggerAutoSave } from '../utils';
import { feedbackInfo } from '../feedback';
import { isPlaying, setIsPlaying, setAutoLoop } from '../playback-state';
import { mmdRuntime } from '../scene-state';
import { refreshMotionRoot } from '../../menus/motion-popup';
import { importExternalAnimation } from '../../menus/motion-root-ui';
import { handleModelAction } from '../../menus/motion-binding-ui';
import { setProcMotionMode, regenerateProcMotion } from '../../scene/motion/proc-motion-bridge';
import type { ProcMotionMode } from '../../motion-algos/procedural-motion';

export function registerMotionActions(): void {
    registerAction({
        id: 'motion:lipsync:toggle',
        label: '切换口型同步',
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
        label: '清除全部动作',
        domain: 'motion',
        icon: 'lucide:eraser',
        params: [],
        destructive: true,
        execute: async () => {
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
        label: '导入 Mixamo 动画',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        execute: async () => { importExternalAnimation('mixamo'); },
    });

    registerAction({
        id: 'motion:retarget:vrm',
        label: '导入 VRM 动画',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        execute: async () => { importExternalAnimation('vrm'); },
    });

    registerAction({
        id: 'motion:retarget:custom',
        label: '导入自定义动画',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        execute: async () => { importExternalAnimation('custom'); },
    });

    registerAction({
        id: 'motion:model:pause',
        label: '暂停/继续播放',
        domain: 'motion',
        icon: 'lucide:play',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => { await handleModelAction('pause', p.modelId as string); },
    });

    registerAction({
        id: 'motion:model:reset',
        label: '重置动画',
        domain: 'motion',
        icon: 'lucide:refresh-cw',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: true,
        execute: async (p) => { await handleModelAction('reset', p.modelId as string); },
    });

    registerAction({
        id: 'motion:model:pose',
        label: '打开展示库',
        domain: 'motion',
        icon: 'lucide:palette',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => { await handleModelAction('pose', p.modelId as string); },
    });

    registerAction({
        id: 'motion:model:loop',
        label: '切换循环播放',
        domain: 'motion',
        icon: 'lucide:repeat',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => { await handleModelAction('loop', p.modelId as string); },
    });

    registerAction({
        id: 'motion:procmotion:set-mode',
        label: '设置程序化动作模式',
        domain: 'motion',
        icon: 'lucide:bot',
        params: [{
            name: 'mode',
            type: 'enum',
            enum: ['idle', 'walking', 'running', 'dancing', 'breathing'] as const,
        }],
        destructive: false,
        execute: async (p) => {
            setProcMotionMode(p.mode as ProcMotionMode);
            regenerateProcMotion();
        },
    });
}
