// [doc:architecture] DOM element references for MikuMikuAR.
// Extracted from config.ts — pure DOM refs, zero runtime logic.

export const dom = {
    canvas: document.getElementById('renderCanvas') as HTMLCanvasElement,
    statusBar: document.getElementById('statusBar') as HTMLElement,
    statusText: document.getElementById('statusText') as HTMLElement,
    fpsClock: document.getElementById('fpsClock') as HTMLElement,
    loadingEl: document.getElementById('loading') as HTMLElement,
    btnMainAction: document.getElementById('btnMainAction') as HTMLButtonElement,
    btnMotionPopup: document.getElementById('btnMotionPopup') as HTMLButtonElement,
    playbackBar: document.getElementById('playbackBar') as HTMLElement,
    btnPlayPause: document.getElementById('btnPlayPause') as HTMLButtonElement,
    btnLoopToggle: document.getElementById('btnLoopToggle') as HTMLButtonElement,
    timeDisplay: document.getElementById('timeDisplay') as HTMLElement,
    seekBar: document.getElementById('seekBar') as HTMLElement,
    seekProgress: document.getElementById('seekProgress') as HTMLElement,
    loadingText: document.getElementById('loadingText') as HTMLElement,
    btnSettings: document.getElementById('btnSettings') as HTMLButtonElement,
    btnScene: document.getElementById('btnScene') as HTMLButtonElement,
    btnEnv: document.getElementById('btnEnv') as HTMLButtonElement,
    sceneOverlay: document.getElementById('sceneOverlay') as HTMLElement,
};
