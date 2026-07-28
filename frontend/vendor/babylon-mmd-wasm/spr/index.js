/* @ts-self-types="./index.d.ts" */

export class AnimationPool {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(AnimationPool.prototype);
        obj.__wbg_ptr = ptr;
        AnimationPoolFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AnimationPoolFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_animationpool_free(ptr, 0);
    }
    /**
     * @param {number} count
     * @returns {number}
     */
    allocateLengthsBuffer(count) {
        const ret = wasm.animationpool_allocateLengthsBuffer(this.__wbg_ptr, count);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @param {number} mmd_model_ptr
     * @param {number} frame_time
     */
    animateMmdModel(animation_ptr, mmd_model_ptr, frame_time) {
        wasm.animationpool_animateMmdModel(this.__wbg_ptr, animation_ptr, mmd_model_ptr, frame_time);
    }
    /**
     * @param {number} bone_tracks_ptr
     * @param {number} bone_track_count
     * @param {number} movable_bone_tracks_ptr
     * @param {number} movable_bone_track_count
     * @param {number} morph_tracks_ptr
     * @param {number} morph_track_count
     * @param {number} property_track_length
     * @param {number} property_track_ik_count
     * @returns {number}
     */
    createAnimation(bone_tracks_ptr, bone_track_count, movable_bone_tracks_ptr, movable_bone_track_count, morph_tracks_ptr, morph_track_count, property_track_length, property_track_ik_count) {
        const ret = wasm.animationpool_createAnimation(this.__wbg_ptr, bone_tracks_ptr, bone_track_count, movable_bone_tracks_ptr, movable_bone_track_count, morph_tracks_ptr, morph_track_count, property_track_length, property_track_ik_count);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @returns {number}
     */
    createBoneBindIndexMap(animation_ptr) {
        const ret = wasm.animationpool_createBoneBindIndexMap(this.__wbg_ptr, animation_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @param {number} body_lengths
     * @returns {number}
     */
    createBoneToBodyBindIndexMap(animation_ptr, body_lengths) {
        const ret = wasm.animationpool_createBoneToBodyBindIndexMap(this.__wbg_ptr, animation_ptr, body_lengths);
        return ret >>> 0;
    }
    /**
     * @param {number} track_lengths
     * @param {number} track_count
     * @returns {number}
     */
    createBoneTracks(track_lengths, track_count) {
        const ret = wasm.animationpool_createBoneTracks(this.__wbg_ptr, track_lengths, track_count);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @returns {number}
     */
    createIkSolverBindIndexMap(animation_ptr) {
        const ret = wasm.animationpool_createIkSolverBindIndexMap(this.__wbg_ptr, animation_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @param {number} morph_lengths
     * @returns {number}
     */
    createMorphBindIndexMap(animation_ptr, morph_lengths) {
        const ret = wasm.animationpool_createMorphBindIndexMap(this.__wbg_ptr, animation_ptr, morph_lengths);
        return ret >>> 0;
    }
    /**
     * @param {number} track_lengths
     * @param {number} track_count
     * @returns {number}
     */
    createMorphTracks(track_lengths, track_count) {
        const ret = wasm.animationpool_createMorphTracks(this.__wbg_ptr, track_lengths, track_count);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @returns {number}
     */
    createMovableBoneBindIndexMap(animation_ptr) {
        const ret = wasm.animationpool_createMovableBoneBindIndexMap(this.__wbg_ptr, animation_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} track_lengths
     * @param {number} track_count
     * @returns {number}
     */
    createMovableBoneTracks(track_lengths, track_count) {
        const ret = wasm.animationpool_createMovableBoneTracks(this.__wbg_ptr, track_lengths, track_count);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @param {number} bone_bind_index_map
     * @param {number} movable_bone_bind_index_map
     * @param {number} morph_bind_index_map
     * @param {number} ik_solver_bind_index_map
     * @param {number} bone_to_body_bind_index_map
     * @returns {number}
     */
    createRuntimeAnimation(animation_ptr, bone_bind_index_map, movable_bone_bind_index_map, morph_bind_index_map, ik_solver_bind_index_map, bone_to_body_bind_index_map) {
        const ret = wasm.animationpool_createRuntimeAnimation(this.__wbg_ptr, animation_ptr, bone_bind_index_map, movable_bone_bind_index_map, morph_bind_index_map, ik_solver_bind_index_map, bone_to_body_bind_index_map);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     * @param {number} count
     */
    deallocateLengthsBuffer(ptr, count) {
        wasm.animationpool_deallocateLengthsBuffer(this.__wbg_ptr, ptr, count);
    }
    /**
     * @param {number} animation_ptr
     */
    destroyAnimation(animation_ptr) {
        wasm.animationpool_destroyAnimation(this.__wbg_ptr, animation_ptr);
    }
    /**
     * @param {number} runtime_animation_ptr
     */
    destroyRuntimeAnimation(runtime_animation_ptr) {
        wasm.animationpool_destroyRuntimeAnimation(this.__wbg_ptr, runtime_animation_ptr);
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getBoneTrackFrameNumbers(tracks, index) {
        const ret = wasm.animationpool_getBoneTrackFrameNumbers(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getBoneTrackPhysicsToggles(tracks, index) {
        const ret = wasm.animationpool_getBoneTrackPhysicsToggles(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getBoneTrackRotationInterpolations(tracks, index) {
        const ret = wasm.animationpool_getBoneTrackRotationInterpolations(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getBoneTrackRotations(tracks, index) {
        const ret = wasm.animationpool_getBoneTrackRotations(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMorphTrackFrameNumbers(tracks, index) {
        const ret = wasm.animationpool_getMorphTrackFrameNumbers(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMorphTrackWeights(tracks, index) {
        const ret = wasm.animationpool_getMorphTrackWeights(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMovableBoneTrackFrameNumbers(tracks, index) {
        const ret = wasm.animationpool_getMovableBoneTrackFrameNumbers(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMovableBoneTrackPhysicsToggles(tracks, index) {
        const ret = wasm.animationpool_getMovableBoneTrackPhysicsToggles(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMovableBoneTrackPositionInterpolations(tracks, index) {
        const ret = wasm.animationpool_getMovableBoneTrackPositionInterpolations(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMovableBoneTrackPositions(tracks, index) {
        const ret = wasm.animationpool_getMovableBoneTrackPositions(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMovableBoneTrackRotationInterpolations(tracks, index) {
        const ret = wasm.animationpool_getMovableBoneTrackRotationInterpolations(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} tracks
     * @param {number} index
     * @returns {number}
     */
    getMovableBoneTrackRotations(tracks, index) {
        const ret = wasm.animationpool_getMovableBoneTrackRotations(this.__wbg_ptr, tracks, index);
        return ret >>> 0;
    }
    /**
     * @param {number} bone_to_body_bind_index_map
     * @param {number} index
     * @returns {number}
     */
    getNthBoneToBodyBindIndexMap(bone_to_body_bind_index_map, index) {
        const ret = wasm.animationpool_getNthBoneToBodyBindIndexMap(this.__wbg_ptr, bone_to_body_bind_index_map, index);
        return ret >>> 0;
    }
    /**
     * @param {number} morph_bind_index_map
     * @param {number} index
     * @returns {number}
     */
    getNthMorphBindIndexMap(morph_bind_index_map, index) {
        const ret = wasm.animationpool_getNthMorphBindIndexMap(this.__wbg_ptr, morph_bind_index_map, index);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @returns {number}
     */
    getPropertyTrackFrameNumbers(animation_ptr) {
        const ret = wasm.animationpool_getPropertyTrackFrameNumbers(this.__wbg_ptr, animation_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} animation_ptr
     * @param {number} index
     * @returns {number}
     */
    getPropertyTrackIkStates(animation_ptr, index) {
        const ret = wasm.animationpool_getPropertyTrackIkStates(this.__wbg_ptr, animation_ptr, index);
        return ret >>> 0;
    }
}
if (Symbol.dispose) AnimationPool.prototype[Symbol.dispose] = AnimationPool.prototype.free;

export class MmdRuntime {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MmdRuntime.prototype);
        obj.__wbg_ptr = ptr;
        MmdRuntimeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MmdRuntimeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mmdruntime_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    acquireDiagnosticErrorResult() {
        const ret = wasm.mmdruntime_acquireDiagnosticErrorResult(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    acquireDiagnosticInfoResult() {
        const ret = wasm.mmdruntime_acquireDiagnosticInfoResult(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    acquireDiagnosticWarningResult() {
        const ret = wasm.mmdruntime_acquireDiagnosticWarningResult(this.__wbg_ptr);
        return ret >>> 0;
    }
    afterPhysics() {
        wasm.mmdruntime_afterPhysics(this.__wbg_ptr);
    }
    /**
     * @param {number | null} [frame_time]
     * @param {number | null} [time_step]
     */
    beforePhysics(frame_time, time_step) {
        wasm.mmdruntime_beforePhysics(this.__wbg_ptr, isLikeNone(frame_time) ? 0x100000001 : Math.fround(frame_time), isLikeNone(time_step) ? 0x100000001 : Math.fround(time_step));
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    createBoneWorldMatrixBackBuffer(ptr) {
        const ret = wasm.mmdruntime_createBoneWorldMatrixBackBuffer(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} serialized_metadata_ptr
     * @param {number} serialized_metadata_size
     * @returns {number}
     */
    createMmdModel(serialized_metadata_ptr, serialized_metadata_size) {
        const ret = wasm.mmdruntime_createMmdModel(this.__wbg_ptr, serialized_metadata_ptr, serialized_metadata_size);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     */
    destroyMmdModel(ptr) {
        wasm.mmdruntime_destroyMmdModel(this.__wbg_ptr, ptr);
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    getAnimationArena(ptr) {
        const ret = wasm.mmdruntime_getAnimationArena(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    getAnimationIkSolverStateArena(ptr) {
        const ret = wasm.mmdruntime_getAnimationIkSolverStateArena(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    getAnimationMorphArena(ptr) {
        const ret = wasm.mmdruntime_getAnimationMorphArena(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    getAnimationRigidBodyStateArena(ptr) {
        const ret = wasm.mmdruntime_getAnimationRigidBodyStateArena(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    getAnimationRigidBodyStateArenaSize(ptr) {
        const ret = wasm.mmdruntime_getAnimationRigidBodyStateArenaSize(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     * @returns {number}
     */
    getBoneWorldMatrixArena(ptr) {
        const ret = wasm.mmdruntime_getBoneWorldMatrixArena(this.__wbg_ptr, ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    getLockStatePtr() {
        const ret = wasm.mmdruntime_getLockStatePtr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    getMultiPhysicsWorld() {
        const ret = wasm.mmdruntime_getMultiPhysicsWorld(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} ptr
     */
    markMmdModelPhysicsAsNeedInit(ptr) {
        wasm.mmdruntime_markMmdModelPhysicsAsNeedInit(this.__wbg_ptr, ptr);
    }
    releaseDiagnosticResult() {
        wasm.mmdruntime_releaseDiagnosticResult(this.__wbg_ptr);
    }
    /**
     * @param {number} ptr
     * @param {number} world_matrix
     */
    setMmdModelWorldMatrix(ptr, world_matrix) {
        wasm.mmdruntime_setMmdModelWorldMatrix(this.__wbg_ptr, ptr, world_matrix);
    }
    /**
     * @param {number} fixed_time_step
     */
    setPhysicsFixedTimeStep(fixed_time_step) {
        wasm.mmdruntime_setPhysicsFixedTimeStep(this.__wbg_ptr, fixed_time_step);
    }
    /**
     * @param {number} max_sub_steps
     */
    setPhysicsMaxSubSteps(max_sub_steps) {
        wasm.mmdruntime_setPhysicsMaxSubSteps(this.__wbg_ptr, max_sub_steps);
    }
    /**
     * @param {number} ptr
     * @param {number} runtime_animation
     */
    setRuntimeAnimation(ptr, runtime_animation) {
        wasm.mmdruntime_setRuntimeAnimation(this.__wbg_ptr, ptr, runtime_animation);
    }
    swapWorldMatrixBuffer() {
        wasm.mmdruntime_swapWorldMatrixBuffer(this.__wbg_ptr);
    }
    /**
     * @param {number} ptr
     * @param {number} rigidbody_state_size
     */
    useExternalPhysics(ptr, rigidbody_state_size) {
        wasm.mmdruntime_useExternalPhysics(this.__wbg_ptr, ptr, rigidbody_state_size);
    }
}
if (Symbol.dispose) MmdRuntime.prototype[Symbol.dispose] = MmdRuntime.prototype.free;

/**
 * @param {number} size
 * @returns {number}
 */
export function allocateBuffer(size) {
    const ret = wasm.allocateBuffer(size);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {boolean} on_off
 */
export function constraintEnableSpring(ptr, index, on_off) {
    wasm.constraintEnableSpring(ptr, index, on_off);
}

/**
 * @param {number} ptr
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function constraintSetAngularLowerLimit(ptr, x, y, z) {
    wasm.constraintSetAngularLowerLimit(ptr, x, y, z);
}

/**
 * @param {number} ptr
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function constraintSetAngularUpperLimit(ptr, x, y, z) {
    wasm.constraintSetAngularUpperLimit(ptr, x, y, z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} damping
 */
export function constraintSetDamping(ptr, index, damping) {
    wasm.constraintSetDamping(ptr, index, damping);
}

/**
 * @param {number} ptr
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function constraintSetLinearLowerLimit(ptr, x, y, z) {
    wasm.constraintSetLinearLowerLimit(ptr, x, y, z);
}

/**
 * @param {number} ptr
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function constraintSetLinearUpperLimit(ptr, x, y, z) {
    wasm.constraintSetLinearUpperLimit(ptr, x, y, z);
}

/**
 * @param {number} ptr
 * @param {number} num
 * @param {number} value
 * @param {number} axis
 */
export function constraintSetParam(ptr, num, value, axis) {
    wasm.constraintSetParam(ptr, num, value, axis);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} stiffness
 */
export function constraintSetStiffness(ptr, index, stiffness) {
    wasm.constraintSetStiffness(ptr, index, stiffness);
}

/**
 * @param {number} ptr
 * @param {boolean} frame_offset_on_off
 */
export function constraintUseFrameOffset(ptr, frame_offset_on_off) {
    wasm.constraintUseFrameOffset(ptr, frame_offset_on_off);
}

/**
 * @returns {AnimationPool}
 */
export function createAnimationPool() {
    const ret = wasm.createAnimationPool();
    return AnimationPool.__wrap(ret);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function createBoxShape(x, y, z) {
    const ret = wasm.createBoxShape(x, y, z);
    return ret >>> 0;
}

/**
 * @param {number} radius
 * @param {number} height
 * @returns {number}
 */
export function createCapsuleShape(radius, height) {
    const ret = wasm.createCapsuleShape(radius, height);
    return ret >>> 0;
}

/**
 * @param {number} body_a
 * @param {number} body_b
 * @param {number} frame_a
 * @param {number} frame_b
 * @param {boolean} use_linear_reference_frame_a
 * @returns {number}
 */
export function createGeneric6DofConstraint(body_a, body_b, frame_a, frame_b, use_linear_reference_frame_a) {
    const ret = wasm.createGeneric6DofConstraint(body_a, body_b, frame_a, frame_b, use_linear_reference_frame_a);
    return ret >>> 0;
}

/**
 * @param {number} body_bundle
 * @param {number} body_a_index
 * @param {number} body_b_index
 * @param {number} frame_a
 * @param {number} frame_b
 * @param {boolean} use_linear_reference_frame_a
 * @returns {number}
 */
export function createGeneric6DofConstraintFromBundle(body_bundle, body_a_index, body_b_index, frame_a, frame_b, use_linear_reference_frame_a) {
    const ret = wasm.createGeneric6DofConstraintFromBundle(body_bundle, body_a_index, body_b_index, frame_a, frame_b, use_linear_reference_frame_a);
    return ret >>> 0;
}

/**
 * @param {number} body_a
 * @param {number} body_b
 * @param {number} frame_a
 * @param {number} frame_b
 * @param {boolean} use_linear_reference_frame_a
 * @returns {number}
 */
export function createGeneric6DofSpringConstraint(body_a, body_b, frame_a, frame_b, use_linear_reference_frame_a) {
    const ret = wasm.createGeneric6DofSpringConstraint(body_a, body_b, frame_a, frame_b, use_linear_reference_frame_a);
    return ret >>> 0;
}

/**
 * @param {number} body_bundle
 * @param {number} body_a_index
 * @param {number} body_b_index
 * @param {number} frame_a
 * @param {number} frame_b
 * @param {boolean} use_linear_reference_frame_a
 * @returns {number}
 */
export function createGeneric6DofSpringConstraintFromBundle(body_bundle, body_a_index, body_b_index, frame_a, frame_b, use_linear_reference_frame_a) {
    const ret = wasm.createGeneric6DofSpringConstraintFromBundle(body_bundle, body_a_index, body_b_index, frame_a, frame_b, use_linear_reference_frame_a);
    return ret >>> 0;
}

/**
 * @returns {MmdRuntime}
 */
export function createMmdRuntime() {
    const ret = wasm.createMmdRuntime();
    return MmdRuntime.__wrap(ret);
}

/**
 * @param {number} physics_world
 * @returns {number}
 */
export function createMultiPhysicsRuntime(physics_world) {
    const ret = wasm.createMultiPhysicsRuntime(physics_world);
    return ret >>> 0;
}

/**
 * @param {boolean} allow_dynamic_shadow
 * @returns {number}
 */
export function createMultiPhysicsWorld(allow_dynamic_shadow) {
    const ret = wasm.createMultiPhysicsWorld(allow_dynamic_shadow);
    return ret >>> 0;
}

/**
 * @param {number} physics_world
 * @returns {number}
 */
export function createPhysicsRuntime(physics_world) {
    const ret = wasm.createPhysicsRuntime(physics_world);
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function createPhysicsWorld() {
    const ret = wasm.createPhysicsWorld();
    return ret >>> 0;
}

/**
 * @param {number} info
 * @returns {number}
 */
export function createRigidBody(info) {
    const ret = wasm.createRigidBody(info);
    return ret >>> 0;
}

/**
 * @param {number} info_list
 * @param {number} len
 * @returns {number}
 */
export function createRigidBodyBundle(info_list, len) {
    const ret = wasm.createRigidBodyBundle(info_list, len);
    return ret >>> 0;
}

/**
 * @param {number} radius
 * @returns {number}
 */
export function createSphereShape(radius) {
    const ret = wasm.createSphereShape(radius);
    return ret >>> 0;
}

/**
 * @param {number} normal_x
 * @param {number} normal_y
 * @param {number} normal_z
 * @param {number} plane_constant
 * @returns {number}
 */
export function createStaticPlaneShape(normal_x, normal_y, normal_z, plane_constant) {
    const ret = wasm.createStaticPlaneShape(normal_x, normal_y, normal_z, plane_constant);
    return ret >>> 0;
}

/**
 * Deallocate a buffer allocated by `allocateBuffer`.
 * # Safety
 * `ptr` must be a pointer to a buffer allocated by `allocateBuffer`.
 * @param {number} ptr
 * @param {number} size
 */
export function deallocateBuffer(ptr, size) {
    wasm.deallocateBuffer(ptr, size);
}

/**
 * @param {number} ptr
 */
export function destroyConstraint(ptr) {
    wasm.destroyConstraint(ptr);
}

/**
 * @param {number} physics_runtime
 */
export function destroyMultiPhysicsRuntime(physics_runtime) {
    wasm.destroyMultiPhysicsRuntime(physics_runtime);
}

/**
 * @param {number} world
 */
export function destroyMultiPhysicsWorld(world) {
    wasm.destroyMultiPhysicsWorld(world);
}

/**
 * @param {number} physics_runtime
 */
export function destroyPhysicsRuntime(physics_runtime) {
    wasm.destroyPhysicsRuntime(physics_runtime);
}

/**
 * @param {number} world
 */
export function destroyPhysicsWorld(world) {
    wasm.destroyPhysicsWorld(world);
}

/**
 * @param {number} ptr
 */
export function destroyRigidBody(ptr) {
    wasm.destroyRigidBody(ptr);
}

/**
 * @param {number} ptr
 */
export function destroyRigidBodyBundle(ptr) {
    wasm.destroyRigidBodyBundle(ptr);
}

/**
 * @param {number} ptr
 */
export function destroyShape(ptr) {
    wasm.destroyShape(ptr);
}

/**
 * Number of native rigid bodies in the model's built-in physics bundle.
 * Returns 0 when the model has no physics context (e.g. external/Bullet physics).
 * @param {number} model_ptr
 * @returns {number}
 */
export function getMmdModelRigidBodyBundleLen(model_ptr) {
    const ret = wasm.getMmdModelRigidBodyBundleLen(model_ptr);
    return ret >>> 0;
}

export function init() {
    wasm.init();
}

/**
 * Applies a central force to the model's native rigid body at `index`.
 * `FollowBone` bodies are skipped (their transforms are bone-driven, not physics).
 * @param {number} model_ptr
 * @param {number} index
 * @param {number} force_x
 * @param {number} force_y
 * @param {number} force_z
 */
export function mmdModelRigidBodyApplyCentralForce(model_ptr, index, force_x, force_y, force_z) {
    wasm.mmdModelRigidBodyApplyCentralForce(model_ptr, index, force_x, force_y, force_z);
}

/**
 * @param {number} runtime
 * @returns {number}
 */
export function multiPhysicsRuntimeGetLockStatePtr(runtime) {
    const ret = wasm.multiPhysicsRuntimeGetLockStatePtr(runtime);
    return ret >>> 0;
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} constraint
 * @param {boolean} disable_collisions_between_linked_bodies
 */
export function multiPhysicsWorldAddConstraint(world, world_id, constraint, disable_collisions_between_linked_bodies) {
    wasm.multiPhysicsWorldAddConstraint(world, world_id, constraint, disable_collisions_between_linked_bodies);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} rigidbody
 */
export function multiPhysicsWorldAddRigidBody(world, world_id, rigidbody) {
    wasm.multiPhysicsWorldAddRigidBody(world, world_id, rigidbody);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} bundle
 */
export function multiPhysicsWorldAddRigidBodyBundle(world, world_id, bundle) {
    wasm.multiPhysicsWorldAddRigidBodyBundle(world, world_id, bundle);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} bundle
 */
export function multiPhysicsWorldAddRigidBodyBundleShadow(world, world_id, bundle) {
    wasm.multiPhysicsWorldAddRigidBodyBundleShadow(world, world_id, bundle);
}

/**
 * @param {number} world
 * @param {number} bundle
 */
export function multiPhysicsWorldAddRigidBodyBundleToGlobal(world, bundle) {
    wasm.multiPhysicsWorldAddRigidBodyBundleToGlobal(world, bundle);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} rigidbody
 */
export function multiPhysicsWorldAddRigidBodyShadow(world, world_id, rigidbody) {
    wasm.multiPhysicsWorldAddRigidBodyShadow(world, world_id, rigidbody);
}

/**
 * @param {number} world
 * @param {number} rigidbody
 */
export function multiPhysicsWorldAddRigidBodyToGlobal(world, rigidbody) {
    wasm.multiPhysicsWorldAddRigidBodyToGlobal(world, rigidbody);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} constraint
 */
export function multiPhysicsWorldRemoveConstraint(world, world_id, constraint) {
    wasm.multiPhysicsWorldRemoveConstraint(world, world_id, constraint);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} rigidbody
 */
export function multiPhysicsWorldRemoveRigidBody(world, world_id, rigidbody) {
    wasm.multiPhysicsWorldRemoveRigidBody(world, world_id, rigidbody);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} bundle
 */
export function multiPhysicsWorldRemoveRigidBodyBundle(world, world_id, bundle) {
    wasm.multiPhysicsWorldRemoveRigidBodyBundle(world, world_id, bundle);
}

/**
 * @param {number} world
 * @param {number} bundle
 */
export function multiPhysicsWorldRemoveRigidBodyBundleFromGlobal(world, bundle) {
    wasm.multiPhysicsWorldRemoveRigidBodyBundleFromGlobal(world, bundle);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} bundle
 */
export function multiPhysicsWorldRemoveRigidBodyBundleShadow(world, world_id, bundle) {
    wasm.multiPhysicsWorldRemoveRigidBodyBundleShadow(world, world_id, bundle);
}

/**
 * @param {number} world
 * @param {number} rigidbody
 */
export function multiPhysicsWorldRemoveRigidBodyFromGlobal(world, rigidbody) {
    wasm.multiPhysicsWorldRemoveRigidBodyFromGlobal(world, rigidbody);
}

/**
 * @param {number} world
 * @param {number} world_id
 * @param {number} rigidbody
 */
export function multiPhysicsWorldRemoveRigidBodyShadow(world, world_id, rigidbody) {
    wasm.multiPhysicsWorldRemoveRigidBodyShadow(world, world_id, rigidbody);
}

/**
 * @param {number} world
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function multiPhysicsWorldSetGravity(world, x, y, z) {
    wasm.multiPhysicsWorldSetGravity(world, x, y, z);
}

/**
 * @param {number} world
 * @param {number} time_step
 * @param {number} max_sub_steps
 * @param {number} fixed_time_step
 */
export function multiPhysicsWorldStepSimulation(world, time_step, max_sub_steps, fixed_time_step) {
    wasm.multiPhysicsWorldStepSimulation(world, time_step, max_sub_steps, fixed_time_step);
}

/**
 * @param {number} world
 * @param {boolean} use_buffer
 */
export function multiPhysicsWorldUseMotionStateBuffer(world, use_buffer) {
    wasm.multiPhysicsWorldUseMotionStateBuffer(world, use_buffer);
}

/**
 * @param {number} physics_runtime
 * @returns {number}
 */
export function physicsRuntimeGetLockStatePtr(physics_runtime) {
    const ret = wasm.physicsRuntimeGetLockStatePtr(physics_runtime);
    return ret >>> 0;
}

/**
 * @param {number} world
 * @param {number} constraint
 * @param {boolean} disable_collisions_between_linked_bodies
 */
export function physicsWorldAddConstraint(world, constraint, disable_collisions_between_linked_bodies) {
    wasm.physicsWorldAddConstraint(world, constraint, disable_collisions_between_linked_bodies);
}

/**
 * @param {number} world
 * @param {number} rigidbody
 */
export function physicsWorldAddRigidBody(world, rigidbody) {
    wasm.physicsWorldAddRigidBody(world, rigidbody);
}

/**
 * @param {number} world
 * @param {number} bundle
 */
export function physicsWorldAddRigidBodyBundle(world, bundle) {
    wasm.physicsWorldAddRigidBodyBundle(world, bundle);
}

/**
 * @param {number} world
 * @param {number} constraint
 */
export function physicsWorldRemoveConstraint(world, constraint) {
    wasm.physicsWorldRemoveConstraint(world, constraint);
}

/**
 * @param {number} world
 * @param {number} rigidbody
 */
export function physicsWorldRemoveRigidBody(world, rigidbody) {
    wasm.physicsWorldRemoveRigidBody(world, rigidbody);
}

/**
 * @param {number} world
 * @param {number} bundle
 */
export function physicsWorldRemoveRigidBodyBundle(world, bundle) {
    wasm.physicsWorldRemoveRigidBodyBundle(world, bundle);
}

/**
 * @param {number} world
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function physicsWorldSetGravity(world, x, y, z) {
    wasm.physicsWorldSetGravity(world, x, y, z);
}

/**
 * @param {number} world
 * @param {number} time_step
 * @param {number} max_sub_steps
 * @param {number} fixed_time_step
 */
export function physicsWorldStepSimulation(world, time_step, max_sub_steps, fixed_time_step) {
    wasm.physicsWorldStepSimulation(world, time_step, max_sub_steps, fixed_time_step);
}

/**
 * @param {number} world
 * @param {boolean} use_buffer
 */
export function physicsWorldUseMotionStateBuffer(world, use_buffer) {
    wasm.physicsWorldUseMotionStateBuffer(world, use_buffer);
}

/**
 * @param {number} ptr
 * @param {number} force_x
 * @param {number} force_y
 * @param {number} force_z
 */
export function rigidBodyApplyCentralForce(ptr, force_x, force_y, force_z) {
    wasm.rigidBodyApplyCentralForce(ptr, force_x, force_y, force_z);
}

/**
 * @param {number} ptr
 * @param {number} impulse_x
 * @param {number} impulse_y
 * @param {number} impulse_z
 */
export function rigidBodyApplyCentralImpulse(ptr, impulse_x, impulse_y, impulse_z) {
    wasm.rigidBodyApplyCentralImpulse(ptr, impulse_x, impulse_y, impulse_z);
}

/**
 * @param {number} ptr
 * @param {number} impulse_x
 * @param {number} impulse_y
 * @param {number} impulse_z
 */
export function rigidBodyApplyCentralPushImpulse(ptr, impulse_x, impulse_y, impulse_z) {
    wasm.rigidBodyApplyCentralPushImpulse(ptr, impulse_x, impulse_y, impulse_z);
}

/**
 * @param {number} ptr
 * @param {number} force_ptr
 * @param {number} relative_position_ptr
 */
export function rigidBodyApplyForce(ptr, force_ptr, relative_position_ptr) {
    wasm.rigidBodyApplyForce(ptr, force_ptr, relative_position_ptr);
}

/**
 * @param {number} ptr
 * @param {number} impulse_ptr
 * @param {number} relative_position_ptr
 */
export function rigidBodyApplyImpulse(ptr, impulse_ptr, relative_position_ptr) {
    wasm.rigidBodyApplyImpulse(ptr, impulse_ptr, relative_position_ptr);
}

/**
 * @param {number} ptr
 * @param {number} impulse_ptr
 * @param {number} relative_position_ptr
 */
export function rigidBodyApplyPushImpulse(ptr, impulse_ptr, relative_position_ptr) {
    wasm.rigidBodyApplyPushImpulse(ptr, impulse_ptr, relative_position_ptr);
}

/**
 * @param {number} ptr
 * @param {number} torque_x
 * @param {number} torque_y
 * @param {number} torque_z
 */
export function rigidBodyApplyTorque(ptr, torque_x, torque_y, torque_z) {
    wasm.rigidBodyApplyTorque(ptr, torque_x, torque_y, torque_z);
}

/**
 * @param {number} ptr
 * @param {number} torque_x
 * @param {number} torque_y
 * @param {number} torque_z
 */
export function rigidBodyApplyTorqueImpulse(ptr, torque_x, torque_y, torque_z) {
    wasm.rigidBodyApplyTorqueImpulse(ptr, torque_x, torque_y, torque_z);
}

/**
 * @param {number} ptr
 * @param {number} torque_x
 * @param {number} torque_y
 * @param {number} torque_z
 */
export function rigidBodyApplyTorqueTurnImpulse(ptr, torque_x, torque_y, torque_z) {
    wasm.rigidBodyApplyTorqueTurnImpulse(ptr, torque_x, torque_y, torque_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} force_x
 * @param {number} force_y
 * @param {number} force_z
 */
export function rigidBodyBundleApplyCentralForce(ptr, index, force_x, force_y, force_z) {
    wasm.rigidBodyBundleApplyCentralForce(ptr, index, force_x, force_y, force_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} impulse_x
 * @param {number} impulse_y
 * @param {number} impulse_z
 */
export function rigidBodyBundleApplyCentralImpulse(ptr, index, impulse_x, impulse_y, impulse_z) {
    wasm.rigidBodyBundleApplyCentralImpulse(ptr, index, impulse_x, impulse_y, impulse_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} impulse_x
 * @param {number} impulse_y
 * @param {number} impulse_z
 */
export function rigidBodyBundleApplyCentralPushImpulse(ptr, index, impulse_x, impulse_y, impulse_z) {
    wasm.rigidBodyBundleApplyCentralPushImpulse(ptr, index, impulse_x, impulse_y, impulse_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} force_ptr
 * @param {number} relative_position_ptr
 */
export function rigidBodyBundleApplyForce(ptr, index, force_ptr, relative_position_ptr) {
    wasm.rigidBodyBundleApplyForce(ptr, index, force_ptr, relative_position_ptr);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} impulse_ptr
 * @param {number} relative_position_ptr
 */
export function rigidBodyBundleApplyImpulse(ptr, index, impulse_ptr, relative_position_ptr) {
    wasm.rigidBodyBundleApplyImpulse(ptr, index, impulse_ptr, relative_position_ptr);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} impulse_ptr
 * @param {number} relative_position_ptr
 */
export function rigidBodyBundleApplyPushImpulse(ptr, index, impulse_ptr, relative_position_ptr) {
    wasm.rigidBodyBundleApplyPushImpulse(ptr, index, impulse_ptr, relative_position_ptr);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} torque_x
 * @param {number} torque_y
 * @param {number} torque_z
 */
export function rigidBodyBundleApplyTorque(ptr, index, torque_x, torque_y, torque_z) {
    wasm.rigidBodyBundleApplyTorque(ptr, index, torque_x, torque_y, torque_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} torque_x
 * @param {number} torque_y
 * @param {number} torque_z
 */
export function rigidBodyBundleApplyTorqueImpulse(ptr, index, torque_x, torque_y, torque_z) {
    wasm.rigidBodyBundleApplyTorqueImpulse(ptr, index, torque_x, torque_y, torque_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} torque_x
 * @param {number} torque_y
 * @param {number} torque_z
 */
export function rigidBodyBundleApplyTorqueTurnImpulse(ptr, index, torque_x, torque_y, torque_z) {
    wasm.rigidBodyBundleApplyTorqueTurnImpulse(ptr, index, torque_x, torque_y, torque_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 */
export function rigidBodyBundleClearForces(ptr, index) {
    wasm.rigidBodyBundleClearForces(ptr, index);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @returns {number}
 */
export function rigidBodyBundleGetAngularDamping(ptr, index) {
    const ret = wasm.rigidBodyBundleGetAngularDamping(ptr, index);
    return ret;
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetAngularVelocity(ptr, index, out) {
    wasm.rigidBodyBundleGetAngularVelocity(ptr, index, out);
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyBundleGetBufferedMotionStatesPtr(ptr) {
    const ret = wasm.rigidBodyBundleGetBufferedMotionStatesPtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyBundleGetKinematicStatesPtr(ptr) {
    const ret = wasm.rigidBodyBundleGetKinematicStatesPtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @param {number} index
 * @returns {number}
 */
export function rigidBodyBundleGetLinearDamping(ptr, index) {
    const ret = wasm.rigidBodyBundleGetLinearDamping(ptr, index);
    return ret;
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetLinearVelocity(ptr, index, out) {
    wasm.rigidBodyBundleGetLinearVelocity(ptr, index, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetLocalInertia(ptr, index, out) {
    wasm.rigidBodyBundleGetLocalInertia(ptr, index, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @returns {number}
 */
export function rigidBodyBundleGetMass(ptr, index) {
    const ret = wasm.rigidBodyBundleGetMass(ptr, index);
    return ret;
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyBundleGetMotionStatesPtr(ptr) {
    const ret = wasm.rigidBodyBundleGetMotionStatesPtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetPushVelocity(ptr, index, out) {
    wasm.rigidBodyBundleGetPushVelocity(ptr, index, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} relative_position_ptr
 * @param {number} out
 */
export function rigidBodyBundleGetPushVelocityInLocalPoint(ptr, index, relative_position_ptr, out) {
    wasm.rigidBodyBundleGetPushVelocityInLocalPoint(ptr, index, relative_position_ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetTotalForce(ptr, index, out) {
    wasm.rigidBodyBundleGetTotalForce(ptr, index, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetTotalTorque(ptr, index, out) {
    wasm.rigidBodyBundleGetTotalTorque(ptr, index, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} out
 */
export function rigidBodyBundleGetTurnVelocity(ptr, index, out) {
    wasm.rigidBodyBundleGetTurnVelocity(ptr, index, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} relative_position_ptr
 * @param {number} out
 */
export function rigidBodyBundleGetVelocityInLocalPoint(ptr, index, relative_position_ptr, out) {
    wasm.rigidBodyBundleGetVelocityInLocalPoint(ptr, index, relative_position_ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @returns {number}
 */
export function rigidBodyBundleGetWorldTransformPtr(ptr, index) {
    const ret = wasm.rigidBodyBundleGetWorldTransformPtr(ptr, index);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodyBundleSetAngularVelocity(ptr, index, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodyBundleSetAngularVelocity(ptr, index, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} linear_damping
 * @param {number} angular_damping
 */
export function rigidBodyBundleSetDamping(ptr, index, linear_damping, angular_damping) {
    wasm.rigidBodyBundleSetDamping(ptr, index, linear_damping, angular_damping);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodyBundleSetLinearVelocity(ptr, index, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodyBundleSetLinearVelocity(ptr, index, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} mass
 * @param {number} local_inertia_x
 * @param {number} local_inertia_y
 * @param {number} local_inertia_z
 */
export function rigidBodyBundleSetMassProps(ptr, index, mass, local_inertia_x, local_inertia_y, local_inertia_z) {
    wasm.rigidBodyBundleSetMassProps(ptr, index, mass, local_inertia_x, local_inertia_y, local_inertia_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodyBundleSetPushVelocity(ptr, index, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodyBundleSetPushVelocity(ptr, index, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} shape
 */
export function rigidBodyBundleSetShape(ptr, index, shape) {
    wasm.rigidBodyBundleSetShape(ptr, index, shape);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodyBundleSetTurnVelocity(ptr, index, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodyBundleSetTurnVelocity(ptr, index, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} index
 * @param {number} translation_x
 * @param {number} translation_y
 * @param {number} translation_z
 */
export function rigidBodyBundleTranslate(ptr, index, translation_x, translation_y, translation_z) {
    wasm.rigidBodyBundleTranslate(ptr, index, translation_x, translation_y, translation_z);
}

/**
 * @param {number} ptr
 */
export function rigidBodyClearForces(ptr) {
    wasm.rigidBodyClearForces(ptr);
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetAngularDamping(ptr) {
    const ret = wasm.rigidBodyGetAngularDamping(ptr);
    return ret;
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetAngularVelocity(ptr, out) {
    wasm.rigidBodyGetAngularVelocity(ptr, out);
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetBufferedMotionStatePtr(ptr) {
    const ret = wasm.rigidBodyGetBufferedMotionStatePtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetKinematicStatePtr(ptr) {
    const ret = wasm.rigidBodyGetKinematicStatePtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetLinearDamping(ptr) {
    const ret = wasm.rigidBodyGetLinearDamping(ptr);
    return ret;
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetLinearVelocity(ptr, out) {
    wasm.rigidBodyGetLinearVelocity(ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetLocalInertia(ptr, out) {
    wasm.rigidBodyGetLocalInertia(ptr, out);
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetMass(ptr) {
    const ret = wasm.rigidBodyGetMass(ptr);
    return ret;
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetMotionStatePtr(ptr) {
    const ret = wasm.rigidBodyGetMotionStatePtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetPushVelocity(ptr, out) {
    wasm.rigidBodyGetPushVelocity(ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} relative_position_ptr
 * @param {number} out
 */
export function rigidBodyGetPushVelocityInLocalPoint(ptr, relative_position_ptr, out) {
    wasm.rigidBodyGetPushVelocityInLocalPoint(ptr, relative_position_ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetTotalForce(ptr, out) {
    wasm.rigidBodyGetTotalForce(ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetTotalTorque(ptr, out) {
    wasm.rigidBodyGetTotalTorque(ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} out
 */
export function rigidBodyGetTurnVelocity(ptr, out) {
    wasm.rigidBodyGetTurnVelocity(ptr, out);
}

/**
 * @param {number} ptr
 * @param {number} relative_position_ptr
 * @param {number} out
 */
export function rigidBodyGetVelocityInLocalPoint(ptr, relative_position_ptr, out) {
    wasm.rigidBodyGetVelocityInLocalPoint(ptr, relative_position_ptr, out);
}

/**
 * @param {number} ptr
 * @returns {number}
 */
export function rigidBodyGetWorldTransformPtr(ptr) {
    const ret = wasm.rigidBodyGetWorldTransformPtr(ptr);
    return ret >>> 0;
}

/**
 * @param {number} ptr
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodySetAngularVelocity(ptr, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodySetAngularVelocity(ptr, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} linear_damping
 * @param {number} angular_damping
 */
export function rigidBodySetDamping(ptr, linear_damping, angular_damping) {
    wasm.rigidBodySetDamping(ptr, linear_damping, angular_damping);
}

/**
 * @param {number} ptr
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodySetLinearVelocity(ptr, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodySetLinearVelocity(ptr, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} mass
 * @param {number} local_inertia_x
 * @param {number} local_inertia_y
 * @param {number} local_inertia_z
 */
export function rigidBodySetMassProps(ptr, mass, local_inertia_x, local_inertia_y, local_inertia_z) {
    wasm.rigidBodySetMassProps(ptr, mass, local_inertia_x, local_inertia_y, local_inertia_z);
}

/**
 * @param {number} ptr
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodySetPushVelocity(ptr, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodySetPushVelocity(ptr, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} shape
 */
export function rigidBodySetShape(ptr, shape) {
    wasm.rigidBodySetShape(ptr, shape);
}

/**
 * @param {number} ptr
 * @param {number} velocity_x
 * @param {number} velocity_y
 * @param {number} velocity_z
 */
export function rigidBodySetTurnVelocity(ptr, velocity_x, velocity_y, velocity_z) {
    wasm.rigidBodySetTurnVelocity(ptr, velocity_x, velocity_y, velocity_z);
}

/**
 * @param {number} ptr
 * @param {number} translation_x
 * @param {number} translation_y
 * @param {number} translation_z
 */
export function rigidBodyTranslate(ptr, translation_x, translation_y, translation_z) {
    wasm.rigidBodyTranslate(ptr, translation_x, translation_y, translation_z);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./index_bg.js": import0,
    };
}

const AnimationPoolFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_animationpool_free(ptr >>> 0, 1));
const MmdRuntimeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mmdruntime_free(ptr >>> 0, 1));

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('index_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
