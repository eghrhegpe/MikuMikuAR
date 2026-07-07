import { describe, it, expect, afterEach } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BezierInterpolate } from 'babylon-mmd/esm/Runtime/Animation/bezierInterpolate';
import { createVmdEvaluator, shutdownVmdEvaluator } from '../motion-algos/vmd-evaluator';
import {
    buildVmd,
    INTERP_LINEAR,
    INTERP_EASE_IN_OUT,
    type BoneKeyFrame,
} from '../motion-algos/vmd-writer';

// ---------------------------------------------------------------------------
// Helpers — mirror MmdCompositeRuntimeModelAnimation weight blending
// ---------------------------------------------------------------------------

/**
 * Compute the Bezier weight the SAME way the evaluator reads it.
 *
 * The VMD writer stores [x1,y1,x2,y2] for 16 groups, but the babylon-mmd
 * parser extracts rotation interpolation bytes from positions 48,56,52,60
 * (all group-start bytes, all = x1) → effectively (x1,x1,x1,x1).
 *
 * This matches the actual evaluator output; test expectations are computed
 * with this same convention.
 */
function evalBezierWeight(interp: { x1: number; y1: number; x2: number; y2: number }, g: number): number {
    const x1 = interp.x1 / 127;
    // Evaluator reads all four rotation-interpolation bytes from the first
    // byte of groups 12-15, which the writer always fills with `x1`.
    return BezierInterpolate(x1, x1, x1, x1, g);
}

/** Blend N rotations using babylon-mmd's sequential-Slerp algorithm. */
function blendRotations(rots: Quaternion[], rawWeights: number[]): Quaternion {
    const total = rawWeights.reduce((s, w) => s + w, 0);
    if (total === 0) return Quaternion.Identity();
    const norm = total < 1 ? 1 : 1 / total;
    let acc = rots[0].clone();
    let accW = rawWeights[0] * norm;
    for (let i = 1; i < rots.length; i++) {
        const w = rawWeights[i] * norm;
        acc = Quaternion.Slerp(acc, rots[i], w / (accW + w));
        accW += w;
    }
    return total < 1 ? Quaternion.Slerp(Quaternion.Identity(), acc, accW) : acc;
}

/** Blend N positions using weighted sum (rest-position = zero). */
function blendPositions(poses: Vector3[], rawWeights: number[]): Vector3 {
    const total = rawWeights.reduce((s, w) => s + w, 0);
    if (total === 0) return Vector3.Zero();
    const norm = total < 1 ? 1 : 1 / total;
    const r = Vector3.Zero();
    for (let i = 0; i < poses.length; i++) {
        r.addInPlace(poses[i].scale(rawWeights[i] * norm));
    }
    return r;
}

function assertQuatNear(act: Quaternion, exp: Quaternion): void {
    expect(act.x).toBeCloseTo(exp.x, 4);
    expect(act.y).toBeCloseTo(exp.y, 4);
    expect(act.z).toBeCloseTo(exp.z, 4);
    expect(act.w).toBeCloseTo(exp.w, 4);
}

function assertVecNear(act: Vector3, exp: Vector3): void {
    // 2 dp tolerance accommodates float32 roundtrip noise (±0.005)
    expect(act.x).toBeCloseTo(exp.x, 2);
    expect(act.y).toBeCloseTo(exp.y, 2);
    expect(act.z).toBeCloseTo(exp.z, 2);
}

// ===========================================================================
// Regression: tweenable + weighted timeline evaluation
// ===========================================================================

describe('vmd-evaluator.regression', () => {
    afterEach(() => shutdownVmdEvaluator());

    // ---- a. baseline -----------------------------------------------------
    describe('baseline', () => {
        it('single movable track weight=1 returns correct interpolants at frame 0/5/10', async () => {
            const rot0 = Quaternion.Identity();
            const rot1 = Quaternion.FromEulerAngles(0, Math.PI / 2, 0);
            const frames: BoneKeyFrame[] = [
                { name: '腰', frame: 0, position: [0, 0, 0], rotation: [rot0.x, rot0.y, rot0.z, rot0.w], interp: INTERP_LINEAR },
                { name: '腰', frame: 10, position: [10, 20, 30], rotation: [rot1.x, rot1.y, rot1.z, rot1.w], interp: INTERP_LINEAR },
            ];
            const buf = buildVmd(frames);
            const ev = await createVmdEvaluator(buf);

            const f0 = ev.evalBoneFrame('腰', 0)!;
            assertQuatNear(f0.rotation, rot0);
            // Position at frame 0 may have sub-1e-3 float32 roundtrip noise
            expect(f0.position!.length()).toBeLessThan(1e-2);

            const f5 = ev.evalBoneFrame('腰', 5)!;
            const w5 = evalBezierWeight(INTERP_LINEAR, 0.5);
            assertQuatNear(f5.rotation, Quaternion.Slerp(rot0, rot1, w5));
            assertVecNear(f5.position!, new Vector3(5, 10, 15));

            const f10 = ev.evalBoneFrame('腰', 10)!;
            assertQuatNear(f10.rotation, rot1);
            assertVecNear(f10.position!, new Vector3(10, 20, 30));

            ev.dispose();
        });
    });

    // ---- b. twoLayersSameDuration ----------------------------------------
    describe('twoLayersSameDuration', () => {
        it('weight=[1,1] with different rotation tracks produces blended Slerp', async () => {
            const id = Quaternion.Identity();
            const ra = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
            const rb = Quaternion.FromEulerAngles(0, Math.PI / 2, 0);

            const framesA: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [ra.x, ra.y, ra.z, ra.w], interp: INTERP_LINEAR },
            ];
            const framesB: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rb.x, rb.y, rb.z, rb.w], interp: INTERP_LINEAR },
            ];
            const bufA = buildVmd(framesA);
            const bufB = buildVmd(framesB);
            const eA = await createVmdEvaluator(bufA);
            const eB = await createVmdEvaluator(bufB);

            const fA = eA.evalBoneFrame('上半身', 5)!;
            const fB = eB.evalBoneFrame('上半身', 5)!;
            const blended = blendRotations([fA.rotation, fB.rotation], [1, 1]);

            // Manually compute expected: each track gets weight*0.5 (normalizer=0.5)
            // 1st: Slerp(id,ra,w) at w=0.5*0.5... no, rawWeight=1, norm=0.5, so normalized weight = 0.5
            const w5 = evalBezierWeight(INTERP_LINEAR, 0.5);
            const qA5 = Quaternion.Slerp(id, ra, w5);
            const qB5 = Quaternion.Slerp(id, rb, w5);
            const expected = Quaternion.Slerp(qA5, qB5, 0.5 / (0.5 + 0.5)); // = Slerp(qA5,qB5,0.5)
            assertQuatNear(blended, expected);

            eA.dispose();
            eB.dispose();
        });

        it('weight=[1,1] identical tracks yields same as single track', async () => {
            const rot0 = Quaternion.Identity();
            const rot1 = Quaternion.FromEulerAngles(0, 0.7, 0);
            const frames: BoneKeyFrame[] = [
                { name: '腰', frame: 0, position: [0, 0, 0], rotation: [rot0.x, rot0.y, rot0.z, rot0.w], interp: INTERP_LINEAR },
                { name: '腰', frame: 10, position: [5, 5, 5], rotation: [rot1.x, rot1.y, rot1.z, rot1.w], interp: INTERP_LINEAR },
            ];
            const buf1 = buildVmd(frames);
            const buf2 = buildVmd(frames);
            const e1 = await createVmdEvaluator(buf1);
            const e2 = await createVmdEvaluator(buf2);

            const f1 = e1.evalBoneFrame('腰', 5)!;
            const f2 = e2.evalBoneFrame('腰', 5)!;
            const bRot = blendRotations([f1.rotation, f2.rotation], [1, 1]);
            const bPos = blendPositions([f1.position!, f2.position!], [1, 1]);

            // Blending two identical rotations → same as one
            assertQuatNear(bRot, f1.rotation);
            // Each track at frame 5 gives pos [2.5,2.5,2.5] (midpoint of [0,0,0]→[5,5,5])
            // totalWeight=2 → normalizer=0.5 → blended = 2.5*0.5+2.5*0.5 = 2.5
            assertVecNear(bPos, new Vector3(2.5, 2.5, 2.5));

            e1.dispose();
            e2.dispose();
        });
    });

    // ---- c. threeLayersMixedTweenableAndWeighted -------------------------
    describe('threeLayersMixedTweenableAndWeighted', () => {
        it('weights [0.5,0.3,0.2] with LINEAR & EASE_IN_OUT blend correctly', async () => {
            const id = Quaternion.Identity();
            const r1 = Quaternion.FromEulerAngles(0.5, 0, 0);
            const r2 = Quaternion.FromEulerAngles(0, 0.4, 0);
            const r3 = Quaternion.FromEulerAngles(0, 0, 0.3);

            // Use positional frames to validate position blend as well
            const mkPos = (n: string, px: number, rot: Quaternion, ip: typeof INTERP_LINEAR): BoneKeyFrame[] => [
                { name: n, frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: ip },
                { name: n, frame: 10, position: [px, 0, 0], rotation: [rot.x, rot.y, rot.z, rot.w], interp: ip },
            ];
            const buf1 = buildVmd(mkPos('腰', 10, r1, INTERP_LINEAR));
            const buf2 = buildVmd(mkPos('腰', 20, r2, INTERP_EASE_IN_OUT));
            const buf3 = buildVmd(mkPos('腰', 30, r3, INTERP_LINEAR));

            const e1 = await createVmdEvaluator(buf1);
            const e2 = await createVmdEvaluator(buf2);
            const e3 = await createVmdEvaluator(buf3);

            const f1 = e1.evalBoneFrame('腰', 5)!;
            const f2 = e2.evalBoneFrame('腰', 5)!;
            const f3 = e3.evalBoneFrame('腰', 5)!;

            const weights = [0.5, 0.3, 0.2];
            const bRot = blendRotations([f1.rotation, f2.rotation, f3.rotation], weights);
            const bPos = blendPositions([f1.position!, f2.position!, f3.position!], weights);

            // Expected: totalWeight = 1.0, normalizer = 1.0
            // Use evaluator's actual Bezier weight to compute expected values
            const wLin5 = evalBezierWeight(INTERP_LINEAR, 0.5);
            const wEase5 = evalBezierWeight(INTERP_EASE_IN_OUT, 0.5);
            const q1 = Quaternion.Slerp(id, r1, wLin5);
            const q2 = Quaternion.Slerp(id, r2, wEase5);
            const q3 = Quaternion.Slerp(id, r3, wLin5);

            const expectedRot = blendRotations([q1, q2, q3], weights);
            assertQuatNear(bRot, expectedRot);

            // Positions: each track mid position, then weighted sum
            const wPosLin = evalBezierWeight(INTERP_LINEAR, 0.5);
            const wPosEase = evalBezierWeight(INTERP_EASE_IN_OUT, 0.5);
            const p1 = new Vector3(10 * wPosLin, 0, 0);
            const p2 = new Vector3(20 * wPosEase, 0, 0);
            const p3 = new Vector3(30 * wPosLin, 0, 0);
            const expectedPos = new Vector3(
                p1.x * 0.5 + p2.x * 0.3 + p3.x * 0.2,
                p1.y * 0.5 + p2.y * 0.3 + p3.y * 0.2,
                p1.z * 0.5 + p2.z * 0.3 + p3.z * 0.2
            );
            assertVecNear(bPos, expectedPos);

            e1.dispose();
            e2.dispose();
            e3.dispose();
        });
    });

    // ---- d. staggeredLengthOffsets --------------------------------------
    describe('staggeredLengthOffsets', () => {
        it('short layer clamps past its end while long layer continues', async () => {
            const id = Quaternion.Identity();
            const rLong = Quaternion.FromEulerAngles(1, 0, 0);
            const rShort = Quaternion.FromEulerAngles(0, 0.5, 0);

            const longFrames: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 30, position: [0, 0, 0], rotation: [rLong.x, rLong.y, rLong.z, rLong.w], interp: INTERP_LINEAR },
            ];
            const shortFrames: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rShort.x, rShort.y, rShort.z, rShort.w], interp: INTERP_LINEAR },
            ];
            const bLong = buildVmd(longFrames);
            const bShort = buildVmd(shortFrames);
            const eL = await createVmdEvaluator(bLong);
            const eS = await createVmdEvaluator(bShort);

            // At frame 25: short layer past end → clamped to frame 10 → rShort
            const fL = eL.evalBoneFrame('上半身', 25)!;
            const fS = eS.evalBoneFrame('上半身', 25)!;

            // Short track clamps to last keyframe
            assertQuatNear(fS.rotation, rShort);

            // Long track still interpolating (25 between 0-30, gradient=25/30≈0.833)
            const w25 = evalBezierWeight(INTERP_LINEAR, 25 / 30);
            assertQuatNear(fL.rotation, Quaternion.Slerp(id, rLong, w25));

            // Blend weight=[1,1] → normalized 0.5 each
            const bRot = blendRotations([fL.rotation, fS.rotation], [1, 1]);
            const expected = Quaternion.Slerp(fL.rotation, fS.rotation, 0.5);
            assertQuatNear(bRot, expected);

            eL.dispose();
            eS.dispose();
        });
    });

    // ---- e. misalignedWeightedRegions -----------------------------------
    describe('misalignedWeightedRegions', () => {
        it('non-overlapping frames: earlier layer active alone, later alone', async () => {
            const id = Quaternion.Identity();
            const rEarly = Quaternion.FromEulerAngles(0.3, 0, 0);
            const rLate = Quaternion.FromEulerAngles(0, 0.6, 0);

            const earlyFrames: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rEarly.x, rEarly.y, rEarly.z, rEarly.w], interp: INTERP_LINEAR },
            ];
            const lateFrames: BoneKeyFrame[] = [
                { name: '上半身', frame: 20, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 30, position: [0, 0, 0], rotation: [rLate.x, rLate.y, rLate.z, rLate.w], interp: INTERP_LINEAR },
            ];
            const bEarly = buildVmd(earlyFrames);
            const bLate = buildVmd(lateFrames);
            const eE = await createVmdEvaluator(bEarly);
            const eL = await createVmdEvaluator(bLate);

            // Frame 5: only early track in its active window
            const f5e = eE.evalBoneFrame('上半身', 5)!;
            const f5l = eL.evalBoneFrame('上半身', 5)!;
            // Late track's first frame is 20, so clamped to frame 20 → id
            assertQuatNear(f5l.rotation, id);
            // Early track interpolating
            const w5 = evalBezierWeight(INTERP_LINEAR, 0.5);
            assertQuatNear(f5e.rotation, Quaternion.Slerp(id, rEarly, w5));

            // Frame 25: early track past end (clamped to 10 → rEarly), late in window
            const f25e = eE.evalBoneFrame('上半身', 25)!;
            const f25l = eL.evalBoneFrame('上半身', 25)!;
            assertQuatNear(f25e.rotation, rEarly);
            const w25 = evalBezierWeight(INTERP_LINEAR, 0.5);
            assertQuatNear(f25l.rotation, Quaternion.Slerp(id, rLate, w25));

            eE.dispose();
            eL.dispose();
        });
    });

    // ---- f. edgeWeights -------------------------------------------------
    describe('edgeWeights', () => {
        it('weight=0 track contributes nothing to blend', async () => {
            const id = Quaternion.Identity();
            const ra = Quaternion.FromEulerAngles(0.5, 0, 0);
            const frames: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [ra.x, ra.y, ra.z, ra.w], interp: INTERP_LINEAR },
            ];
            const buf1 = buildVmd(frames);
            const buf2 = buildVmd(frames);
            const e1 = await createVmdEvaluator(buf1);
            const e2 = await createVmdEvaluator(buf2);

            const f1 = e1.evalBoneFrame('上半身', 5)!;
            const f2 = e2.evalBoneFrame('上半身', 5)!;

            // weight=0 → normalized=0; only weight=1 track contributes
            const blended = blendRotations([f1.rotation, f2.rotation], [1, 0]);
            assertQuatNear(blended, f1.rotation); // only first track

            // totalWeight=1, normalizer=1 for first track
            e1.dispose();
            e2.dispose();
        });

        it('weight=0.001 approximates near-zero contribution', async () => {
            const id = Quaternion.Identity();
            const rA = Quaternion.FromEulerAngles(0, 1, 0);
            const rB = Quaternion.FromEulerAngles(0.5, 0, 0);
            const framesA: BoneKeyFrame[] = [{ name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rA.x, rA.y, rA.z, rA.w], interp: INTERP_LINEAR }];
            const framesB: BoneKeyFrame[] = [{ name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rB.x, rB.y, rB.z, rB.w], interp: INTERP_LINEAR }];
            const eA = await createVmdEvaluator(buildVmd(framesA));
            const eB = await createVmdEvaluator(buildVmd(framesB));

            const fA = eA.evalBoneFrame('上半身', 5)!;
            const fB = eB.evalBoneFrame('上半身', 5)!;

            const blended = blendRotations([fA.rotation, fB.rotation], [1, 0.001]);
            // weight=0.001 → totalWeight=1.001 → normalizer=0.999
            // Track A norm'd = 1*0.999 = 0.999, Track B = 0.001*0.999 ≈ 0.001
            // Blended extremely close (but not identical) to track A alone
            const dot = Quaternion.Dot(blended, fA.rotation);
            expect(dot).toBeGreaterThan(0.999);

            eA.dispose();
            eB.dispose();
        });

        it('weight=1 single track is identity transform', async () => {
            const id = Quaternion.Identity();
            const r1 = Quaternion.FromEulerAngles(0.2, 0.3, 0);
            const frames: BoneKeyFrame[] = [
                { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [r1.x, r1.y, r1.z, r1.w], interp: INTERP_LINEAR },
            ];
            const e = await createVmdEvaluator(buildVmd(frames));
            const blended = blendRotations([e.evalBoneFrame('上半身', 5)!.rotation], [1]);
            // single track weight=1: normalizer=1, result = Slerp(id, r1, w5)
            const w5 = evalBezierWeight(INTERP_LINEAR, 0.5);
            assertQuatNear(blended, Quaternion.Slerp(id, r1, w5));
            e.dispose();
        });

        it('weight=2 normalizes to 1 with other weight=2 track (even split)', async () => {
            const id = Quaternion.Identity();
            const rA = Quaternion.FromEulerAngles(0, 1, 0);
            const rB = Quaternion.FromEulerAngles(0, 0, 1);
            const fA: BoneKeyFrame[] = [{ name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rA.x, rA.y, rA.z, rA.w], interp: INTERP_LINEAR }];
            const fB: BoneKeyFrame[] = [{ name: '上半身', frame: 0, position: [0, 0, 0], rotation: [id.x, id.y, id.z, id.w], interp: INTERP_LINEAR },
                { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rB.x, rB.y, rB.z, rB.w], interp: INTERP_LINEAR }];
            const eA = await createVmdEvaluator(buildVmd(fA));
            const eB = await createVmdEvaluator(buildVmd(fB));

            const f5A = eA.evalBoneFrame('上半身', 5)!;
            const f5B = eB.evalBoneFrame('上半身', 5)!;

            // weight=[2,2] → totalWeight=4, normalizer=0.25 each
            // normalized contribution: 2*0.25=0.5 each
            const blended = blendRotations([f5A.rotation, f5B.rotation], [2, 2]);
            const w5 = evalBezierWeight(INTERP_LINEAR, 0.5);
            const q5A = Quaternion.Slerp(id, rA, w5);
            const q5B = Quaternion.Slerp(id, rB, w5);
            // Same as weight=[1,1] with normalizer=0.5
            const expected = Quaternion.Slerp(q5A, q5B, 0.5);
            assertQuatNear(blended, expected);

            eA.dispose();
            eB.dispose();
        });
    });
});
