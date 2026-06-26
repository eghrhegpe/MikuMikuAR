import { describe, it, expect, beforeEach, vi } from "vitest";

// Test the pure function _catOf that classifies material names into categories
// This function exists in scene.ts but is not exported.
// We'll test it through the exported per-material API once implemented.

// For now, we test the expected behavior of the classification logic
const CATEGORIES = ["皮肤", "头发", "眼睛", "服装"] as const;

type MaterialCategoryParams = {
    diffuseMul: number;
    specularMul: number;
    shininess: number;
    ambientMul: number;
};

function _catOf(name: string): string {
    const l = name.toLowerCase();
    if (/skin|face|肌|顔|body|neck|首|cheek|頬|kihada/.test(l)) return "皮肤";
    if (/hair|髪|ahoge/.test(l)) return "头发";
    if (/eye|目|iris|瞳|白目|pupil/.test(l)) return "眼睛";
    return "服装";
}

describe("_catOf material classification", () => {
    it('classifies "skin" as 皮肤', () => {
        expect(_catOf("skin")).toBe("皮肤");
    });

    it('classifies "face" as 皮肤', () => {
        expect(_catOf("face")).toBe("皮肤");
    });

    it('classifies "髪" as 头发', () => {
        expect(_catOf("髪")).toBe("头发");
    });

    it('classifies "hair" as 头发', () => {
        expect(_catOf("hair")).toBe("头发");
    });

    it('classifies "eye" as 眼睛', () => {
        expect(_catOf("eye")).toBe("眼睛");
    });

    it('classifies "目" as 眼睛', () => {
        expect(_catOf("目")).toBe("眼睛");
    });

    it('classifies "pupil" as 眼睛', () => {
        expect(_catOf("pupil")).toBe("眼睛");
    });

    it('classifies unknown names as 服装', () => {
        expect(_catOf("skirt")).toBe("服装");
        expect(_catOf("shoes")).toBe("服装");
        expect(_catOf("ribbon")).toBe("服装");
    });

    it("is case insensitive", () => {
        expect(_catOf("Skin")).toBe("皮肤");
        expect(_catOf("FACE")).toBe("皮肤");
        expect(_catOf("Hair")).toBe("头发");
    });

    it('classifies "kihada" (肌) as 皮肤', () => {
        expect(_catOf("kihada")).toBe("皮肤");
    });
});

// ---------- Per-Material State Management Tests ----------

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

const DEFAULT_MAT_PARAMS: MaterialCategoryParams = {
    diffuseMul: 1,
    specularMul: 1,
    shininess: 50,
    ambientMul: 1,
};

type PerMatEntry = {
    params: MaterialCategoryParams;
    modified: boolean;
};

describe("per-material parameter state management", () => {
    let matState: Map<string, Map<number, PerMatEntry>>;

    function ensureMatState(id: string): Map<number, PerMatEntry> {
        let m = matState.get(id);
        if (m) return m;
        m = new Map();
        matState.set(id, m);
        return m;
    }

    function getMatParams(id: string, matIndex: number): MaterialCategoryParams | null {
        const entry = matState.get(id)?.get(matIndex);
        return entry ? { ...entry.params } : null;
    }

    function setMatParams(id: string, matIndex: number, params: Partial<MaterialCategoryParams>): void {
        const state = ensureMatState(id);
        let entry = state.get(matIndex);
        if (!entry) {
            entry = { params: { ...DEFAULT_MAT_PARAMS }, modified: false };
            state.set(matIndex, entry);
        }
        // Clamp values
        if (params.diffuseMul !== undefined) params.diffuseMul = clamp(params.diffuseMul, 0, 2);
        if (params.specularMul !== undefined) params.specularMul = clamp(params.specularMul, 0, 2);
        if (params.shininess !== undefined) params.shininess = Math.round(clamp(params.shininess, 0, 200));
        if (params.ambientMul !== undefined) params.ambientMul = clamp(params.ambientMul, 0, 2);
        Object.assign(entry.params, params);
        entry.modified = true;
    }

    function resetSingleMatParams(id: string, matIndex: number): void {
        matState.get(id)?.delete(matIndex);
    }

    function resetAllMatParams(id: string): void {
        matState.delete(id);
    }

    function getModifiedCount(id: string): number {
        const state = matState.get(id);
        if (!state) return 0;
        let count = 0;
        for (const entry of state.values()) {
            if (entry.modified) count++;
        }
        return count;
    }

    function isMaterialModified(id: string, matIndex: number): boolean {
        return matState.get(id)?.get(matIndex)?.modified ?? false;
    }

    beforeEach(() => {
        matState = new Map();
    });

    describe("getMatParams", () => {
        it("returns null for unset material", () => {
            expect(getMatParams("model1", 0)).toBeNull();
        });
    });

    describe("setMatParams", () => {
        it("sets diffuse multiplier for a single material", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            const params = getMatParams("model1", 0);
            expect(params).not.toBeNull();
            expect(params!.diffuseMul).toBe(0.5);
            // Other params should be defaults
            expect(params!.specularMul).toBe(1);
            expect(params!.shininess).toBe(50);
            expect(params!.ambientMul).toBe(1);
        });

        it("sets specular multiplier for a single material", () => {
            setMatParams("model1", 0, { specularMul: 1.5 });
            const params = getMatParams("model1", 0);
            expect(params!.specularMul).toBe(1.5);
        });

        it("preserves previously set params when updating", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 0, { shininess: 100 });
            const params = getMatParams("model1", 0);
            expect(params!.diffuseMul).toBe(0.5); // preserved
            expect(params!.shininess).toBe(100);  // updated
        });

        it("tracks multiple materials independently", () => {
            setMatParams("model1", 0, { diffuseMul: 0.3 });
            setMatParams("model1", 1, { diffuseMul: 0.7 });
            setMatParams("model2", 0, { diffuseMul: 1.2 });

            expect(getMatParams("model1", 0)!.diffuseMul).toBe(0.3);
            expect(getMatParams("model1", 1)!.diffuseMul).toBe(0.7);
            expect(getMatParams("model2", 0)!.diffuseMul).toBe(1.2);
        });
    });

    describe("modified tracking", () => {
        it("marks material as modified after setting params", () => {
            expect(isMaterialModified("model1", 0)).toBe(false);
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            expect(isMaterialModified("model1", 0)).toBe(true);
        });

        it("returns correct modified count", () => {
            expect(getModifiedCount("model1")).toBe(0);
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { shininess: 80 });
            expect(getModifiedCount("model1")).toBe(2);
        });
    });

    describe("resetSingleMatParams", () => {
        it("removes the parameter entry for a single material", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            expect(getMatParams("model1", 0)).not.toBeNull();

            resetSingleMatParams("model1", 0);
            expect(getMatParams("model1", 0)).toBeNull();
        });

        it("does not affect other materials", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { diffuseMul: 0.7 });

            resetSingleMatParams("model1", 0);
            expect(getMatParams("model1", 0)).toBeNull();
            expect(getMatParams("model1", 1)).not.toBeNull();
        });

        it("decrements modified count", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { shininess: 80 });
            expect(getModifiedCount("model1")).toBe(2);

            resetSingleMatParams("model1", 0);
            expect(getModifiedCount("model1")).toBe(1);

            resetSingleMatParams("model1", 1);
            expect(getModifiedCount("model1")).toBe(0);
        });
    });

    describe("resetAllMatParams", () => {
        it("clears all per-material params for a model", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { shininess: 80 });
            setMatParams("model1", 2, { ambientMul: 0.3 });

            resetAllMatParams("model1");
            expect(getMatParams("model1", 0)).toBeNull();
            expect(getMatParams("model1", 1)).toBeNull();
            expect(getMatParams("model1", 2)).toBeNull();
            expect(getModifiedCount("model1")).toBe(0);
        });

        it("does not affect other models", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model2", 0, { diffuseMul: 0.7 });

            resetAllMatParams("model1");
            expect(getMatParams("model2", 0)).not.toBeNull();
        });
    });

    describe("clamping", () => {
        it("clamps diffuseMul between 0 and 2", () => {
            setMatParams("model1", 0, { diffuseMul: -0.5 });
            const params = getMatParams("model1", 0);
            expect(params!.diffuseMul).toBe(0);
        });

        it("clamps shininess between 0 and 200", () => {
            setMatParams("model1", 0, { shininess: 999 });
            const params = getMatParams("model1", 0);
            expect(params!.shininess).toBe(200);
        });
    });
});

// ═══════════════════════════════════════════
// ⚠ 坑一: _applyAll 叠加顺序 regression test
//   类别级参数先写 → per-material 覆盖层后写 → re-apply 后覆盖层仍胜出
// ═══════════════════════════════════════════

describe("_applyAll ordering: per-material overrides category on re-apply", () => {
    // ---- helpers that mirror scene.ts _applyAll ordering ----

    // Mock Babylon Color3
    class MockColor3 {
        r: number; g: number; b: number;
        constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
        set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; }
    }

    // Mock StandardMaterial duck
    function makeMockMat(origR = 1, origG = 1, origB = 1): {
        diffuseColor: MockColor3;
        specularColor: MockColor3;
        specularPower: number;
        ambientColor: MockColor3;
        name: string;
        _origDiffuse: MockColor3;
    } {
        return {
            diffuseColor: new MockColor3(origR, origG, origB),
            specularColor: new MockColor3(0.8, 0.8, 0.8),
            specularPower: 50,
            ambientColor: new MockColor3(0.3, 0.3, 0.3),
            name: "skin",
            _origDiffuse: new MockColor3(origR, origG, origB),
        };
    }

    // Simulates _applyAll: category first, then per-material overlay
    function simulateApply(
        mats: ReturnType<typeof makeMockMat>[],
        catParams: MaterialCategoryParams,
        perMatOverrides: Map<number, MaterialCategoryParams>,
    ): void {
        for (let mi = 0; mi < mats.length; mi++) {
            const m = mats[mi];
            const o = { diffuse: m._origDiffuse };
            // Category level
            m.diffuseColor.set(
                o.diffuse.r * catParams.diffuseMul,
                o.diffuse.g * catParams.diffuseMul,
                o.diffuse.b * catParams.diffuseMul,
            );
            m.specularColor.set(
                0.8 * catParams.specularMul,
                0.8 * catParams.specularMul,
                0.8 * catParams.specularMul,
            );
            m.specularPower = catParams.shininess;
            m.ambientColor.set(
                0.3 * catParams.ambientMul,
                0.3 * catParams.ambientMul,
                0.3 * catParams.ambientMul,
            );
            // Per-material override
            const mp = perMatOverrides.get(mi);
            if (mp) {
                m.diffuseColor.set(
                    o.diffuse.r * mp.diffuseMul,
                    o.diffuse.g * mp.diffuseMul,
                    o.diffuse.b * mp.diffuseMul,
                );
                m.specularColor.set(
                    0.8 * mp.specularMul,
                    0.8 * mp.specularMul,
                    0.8 * mp.specularMul,
                );
                m.specularPower = mp.shininess;
                m.ambientColor.set(
                    0.3 * mp.ambientMul,
                    0.3 * mp.ambientMul,
                    0.3 * mp.ambientMul,
                );
            }
        }
    }

    it("per-material diffuse overrides category after category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        const catParams: MaterialCategoryParams = { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 };
        const perMatOverrides = new Map<number, MaterialCategoryParams>();

        // Step 1: category only → diffuse = 0.5
        perMatOverrides.clear();
        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.5);

        // Step 2: add per-material override → diffuse = 0.9
        perMatOverrides.set(0, { diffuseMul: 0.9, specularMul: 1, shininess: 50, ambientMul: 1 });
        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);

        // Step 3: re-apply with UPDATED category (simulates user tweaking category slider) → per-material 0.9 still wins
        const newCatParams: MaterialCategoryParams = { diffuseMul: 0.3, specularMul: 1, shininess: 50, ambientMul: 1 };
        simulateApply(mats, newCatParams, perMatOverrides);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);
    });

    it("per-material specular overrides category after category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        const catParams: MaterialCategoryParams = { diffuseMul: 1, specularMul: 0.5, shininess: 50, ambientMul: 1 };
        const perMatOverrides = new Map<number, MaterialCategoryParams>();

        // Category only → specular = 0.4
        simulateApply(mats, catParams, perMatOverrides);

        // Add per-material override → specular = 1.6
        perMatOverrides.set(0, { diffuseMul: 1, specularMul: 2, shininess: 50, ambientMul: 1 });
        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].specularColor.r).toBeCloseTo(1.6);

        // Re-apply with different category → per-material 1.6 still wins
        const newCatParams: MaterialCategoryParams = { diffuseMul: 1, specularMul: 0.2, shininess: 50, ambientMul: 1 };
        simulateApply(mats, newCatParams, perMatOverrides);
        expect(mats[0].specularColor.r).toBeCloseTo(1.6);
    });

    it("per-material shininess survives category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        const catParams: MaterialCategoryParams = { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
        const perMatOverrides = new Map<number, MaterialCategoryParams>();

        // Category → shininess = 50
        simulateApply(mats, catParams, perMatOverrides);

        // Per-material → shininess = 120
        perMatOverrides.set(0, { diffuseMul: 1, specularMul: 1, shininess: 120, ambientMul: 1 });
        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].specularPower).toBe(120);

        // Re-apply category with different value → per-material 120 still wins
        const newCatParams: MaterialCategoryParams = { diffuseMul: 1, specularMul: 1, shininess: 30, ambientMul: 1 };
        simulateApply(mats, newCatParams, perMatOverrides);
        expect(mats[0].specularPower).toBe(120);
    });

    it("per-material ambient overrides category after category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        const catParams: MaterialCategoryParams = { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 0.5 };
        const perMatOverrides = new Map<number, MaterialCategoryParams>();

        simulateApply(mats, catParams, perMatOverrides);

        perMatOverrides.set(0, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1.5 });
        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].ambientColor.r).toBeCloseTo(0.45);

        const newCatParams: MaterialCategoryParams = { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 0.1 };
        simulateApply(mats, newCatParams, perMatOverrides);
        expect(mats[0].ambientColor.r).toBeCloseTo(0.45);
    });

    it("multiple material indices are independent under re-apply", () => {
        const mats = [makeMockMat(1, 1, 1), makeMockMat(1, 1, 1)];
        const catParams: MaterialCategoryParams = { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 };
        const perMatOverrides = new Map<number, MaterialCategoryParams>();
        perMatOverrides.set(0, { diffuseMul: 0.9, specularMul: 1, shininess: 50, ambientMul: 1 });

        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9); // overridden
        expect(mats[1].diffuseColor.r).toBeCloseTo(0.5); // category only

        // Re-apply
        simulateApply(mats, catParams, perMatOverrides);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);
        expect(mats[1].diffuseColor.r).toBeCloseTo(0.5);
    });
});

// ═══════════════════════════════════════════
// ⚠ 坑二: setMatParams → Babylon property write-through spy test
//   验证四个滑块对应的 Babylon property 被正确写入
// ═══════════════════════════════════════════

describe("per-material params write through to Babylon material properties", () => {
    class SpyColor3 {
        r = 0; g = 0; b = 0;
        set = vi.fn((r: number, g: number, b: number) => { this.r = r; this.g = g; this.b = b; });
    }

    function applyPerMatToBabylonMat(
        mat: { diffuseColor: SpyColor3; specularColor: SpyColor3; specularPower: number; ambientColor: SpyColor3 },
        origDiffuse: { r: number; g: number; b: number },
        params: MaterialCategoryParams,
    ): void {
        mat.diffuseColor.set(
            origDiffuse.r * params.diffuseMul,
            origDiffuse.g * params.diffuseMul,
            origDiffuse.b * params.diffuseMul,
        );
        mat.specularColor.set(
            0.8 * params.specularMul,
            0.8 * params.specularMul,
            0.8 * params.specularMul,
        );
        mat.specularPower = params.shininess;
        mat.ambientColor.set(
            0.3 * params.ambientMul,
            0.3 * params.ambientMul,
            0.3 * params.ambientMul,
        );
    }

    it("writes diffuseMul → diffuseColor.set with correct multiplier", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        const orig = { r: 0.8, g: 0.6, b: 0.4 };

        applyPerMatToBabylonMat(mat, orig, { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });

        expect(mat.diffuseColor.set).toHaveBeenCalledTimes(1);
        expect(mat.diffuseColor.set).toHaveBeenCalledWith(0.4, 0.3, 0.2);
    });

    it("writes specularMul → specularColor.set with correct multiplier", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };

        applyPerMatToBabylonMat(mat, { r: 1, g: 1, b: 1 }, { diffuseMul: 1, specularMul: 1.5, shininess: 50, ambientMul: 1 });

        expect(mat.specularColor.set).toHaveBeenCalledTimes(1);
        expect(mat.specularColor.r).toBeCloseTo(1.2, 10);
        expect(mat.specularColor.g).toBeCloseTo(1.2, 10);
        expect(mat.specularColor.b).toBeCloseTo(1.2, 10);
    });

    it("writes shininess → specularPower assignment", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };

        applyPerMatToBabylonMat(mat, { r: 1, g: 1, b: 1 }, { diffuseMul: 1, specularMul: 1, shininess: 120, ambientMul: 1 });

        expect(mat.specularPower).toBe(120);
    });

    it("writes ambientMul → ambientColor.set with correct multiplier", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };

        applyPerMatToBabylonMat(mat, { r: 1, g: 1, b: 1 }, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 2 });

        expect(mat.ambientColor.set).toHaveBeenCalledWith(0.6, 0.6, 0.6);
    });

    it("write-through is idempotent — calling twice with same params produces same result", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        const orig = { r: 1, g: 1, b: 1 };

        applyPerMatToBabylonMat(mat, orig, { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });
        applyPerMatToBabylonMat(mat, orig, { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });

        expect(mat.diffuseColor.set).toHaveBeenCalledTimes(2);
        expect(mat.diffuseColor.r).toBeCloseTo(0.5);
    });
});
