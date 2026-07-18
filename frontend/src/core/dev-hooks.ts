// [doc:adr-102] E2E capture + scene inspection hooks (DEV only).
// Split from main.ts (:1063-1171). Pure DEV-side-effect module: it only
// attaches helpers to `window` for Playwright numeric assertions; it has no
// business logic shared with production paths, so it stays out of the Split
// layer's hot import graph.
import { scene, engine, focusedModel } from '../scene/scene';
import { loadOutfits, applyOutfitVariant } from '../outfit/outfit';

export function setupE2ECapture(): void {
    // [doc:e2e] 生产构建下默认不注入 E2E 钩子（DEV 为 false），
    // 但设 VITE_E2E_MODE=true 后仍可编入，供本地 @webgl 测试使用。
    if (!import.meta.env.DEV && !import.meta.env.VITE_E2E_MODE) {
        return;
    }

    window.__capture = async (): Promise<string> => {
        const { CreateScreenshotAsync } = await import('@babylonjs/core/Misc/screenshotTools');
        // Force a render frame so Babylon writes to the backbuffer
        scene.render();
        return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
    };

    // ======== E2E Scene Inspection Hook (DEV only) ========
    // Exposes live Babylon.js / XPBD state for Playwright numeric assertions.
    // Avoids fragile pixel-screenshot comparison for 3D correctness.
    (window as any).__scene = {
        get fps(): number {
            return engine.getFps();
        },
        get meshCount(): number {
            // Babylon keeps a flat meshes array (incl. system meshes like
            // ground/helpers). Assert a threshold, not an exact number.
            return scene.meshes.length;
        },
        get currentAnimation(): string {
            // Use focusedModel().vmdName instead of mmdRuntime.runtimeAnimation
            // which doesn't exist in babylon-mmd's public API.
            const inst = focusedModel();
            return inst?.vmdName ?? 'idle';
        },
        // --- Outfit (换装) behavior hook (DEV only, on-strategy per ADR-060) ---
        // Drives the REAL applyOutfitVariant path so E2E can assert a 3D change
        // without fragile 3-4 level menu navigation. Returns {variants, error}
        // so the test can distinguish "no outfits" from "loadOutfits failed" —
        // a .catch(->[]) would silently mask real regressions.
        outfitVariants: async (): Promise<{ variants: string[]; error: string | null }> => {
            const inst = focusedModel();
            if (!inst) {
                return { variants: [], error: null };
            }
            try {
                const o = await loadOutfits(inst.id);
                return { variants: (o?.variants ?? []).map((v) => v.name), error: null };
            } catch (e) {
                return { variants: [], error: String(e) };
            }
        },
        applyOutfit: (variantName: string): Promise<boolean> => {
            const inst = focusedModel();
            if (!inst) {
                return Promise.resolve(false);
            }
            return applyOutfitVariant(inst.id, variantName)
                .then(() => true)
                .catch(() => false);
        },
        // Coarse 16x16 luminance fingerprint of the current frame. Stable enough
        // for "did the picture change" assertions without decoding the PNG.
        // (Do NOT read a '2d' context from the WebGL canvas — getContext returns null.)
        fingerprint: async (): Promise<string> => {
            if (!window.__capture) {
                return '';
            }
            const url = await window.__capture!();
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = c.height = 16;
            const ctx = c.getContext('2d');
            if (!ctx) {
                return '';
            }
            ctx.drawImage(img, 0, 0, 16, 16);
            const d = ctx.getImageData(0, 0, 16, 16).data;
            const LUM_THRESHOLD = 384; // ≈ half-brightness: (255×3)/2 = 382.5
            let s = '';
            for (let i = 0; i < d.length; i += 4) {
                s += d[i] + d[i + 1] + d[i + 2] > LUM_THRESHOLD ? '1' : '0';
            }
            return s;
        },
        // Delegate to the existing screenshot helper. NOTE: do NOT read a
        // '2d' context from the WebGL canvas — getContext('2d') returns null.
        capture: (): Promise<string> => window.__capture!(),

        // CI seed model — creates a programmatic Babylon mesh so @webgl E2E tests
        // can assert a real 3D scene without a PMX file on disk.
        createTestMesh: async (): Promise<void> => {
            const { MeshBuilder } = await import('@babylonjs/core/Meshes/meshBuilder');
            const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
            const { Color3 } = await import('@babylonjs/core/Maths/math.color');
            // Dispose any previous test meshes first
            for (const m of [...scene.meshes]) {
                if (m.name.startsWith('e2e-test-')) {
                    m.dispose();
                }
            }
            const box = MeshBuilder.CreateBox('e2e-test-mesh', { size: 0.5 }, scene);
            const mat = new StandardMaterial('e2e-test-mat', scene);
            mat.diffuseColor = new Color3(1, 0, 0);
            box.material = mat;
        },
        clearTestMeshes: (): void => {
            for (const m of [...scene.meshes]) {
                if (m.name.startsWith('e2e-test-')) {
                    m.dispose();
                }
            }
        },
    };
}
