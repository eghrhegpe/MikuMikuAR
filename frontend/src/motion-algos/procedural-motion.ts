export * from './proc-motion-shared';
export { generateIdleVmd } from './proc-motion-idle';
export { generateAutoDanceVmd } from './proc-motion-autodance';

import type { ProcMotionMode } from './proc-motion-shared';

export function shouldAutoDance(audioPlaying: boolean, mode: ProcMotionMode): boolean {
    if (mode === 'idle') {
        return false;
    }
    if (mode === 'autodance') {
        return true;
    }
    return audioPlaying;
}

export function shouldIdle(
    audioPlaying: boolean,
    hasUserVmd: boolean,
    mode: ProcMotionMode
): boolean {
    return (
        !audioPlaying && !hasUserVmd && (mode === 'idle' || mode === 'off' || mode === 'autodance')
    );
}
