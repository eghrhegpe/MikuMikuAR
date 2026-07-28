/* tslint:disable */
/* eslint-disable */

export class AnimationPool {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    allocateLengthsBuffer(count: number): number;
    animateMmdModel(animation_ptr: number, mmd_model_ptr: number, frame_time: number): void;
    createAnimation(bone_tracks_ptr: number, bone_track_count: number, movable_bone_tracks_ptr: number, movable_bone_track_count: number, morph_tracks_ptr: number, morph_track_count: number, property_track_length: number, property_track_ik_count: number): number;
    createBoneBindIndexMap(animation_ptr: number): number;
    createBoneToBodyBindIndexMap(animation_ptr: number, body_lengths: number): number;
    createBoneTracks(track_lengths: number, track_count: number): number;
    createIkSolverBindIndexMap(animation_ptr: number): number;
    createMorphBindIndexMap(animation_ptr: number, morph_lengths: number): number;
    createMorphTracks(track_lengths: number, track_count: number): number;
    createMovableBoneBindIndexMap(animation_ptr: number): number;
    createMovableBoneTracks(track_lengths: number, track_count: number): number;
    createRuntimeAnimation(animation_ptr: number, bone_bind_index_map: number, movable_bone_bind_index_map: number, morph_bind_index_map: number, ik_solver_bind_index_map: number, bone_to_body_bind_index_map: number): number;
    deallocateLengthsBuffer(ptr: number, count: number): void;
    destroyAnimation(animation_ptr: number): void;
    destroyRuntimeAnimation(runtime_animation_ptr: number): void;
    getBoneTrackFrameNumbers(tracks: number, index: number): number;
    getBoneTrackPhysicsToggles(tracks: number, index: number): number;
    getBoneTrackRotationInterpolations(tracks: number, index: number): number;
    getBoneTrackRotations(tracks: number, index: number): number;
    getMorphTrackFrameNumbers(tracks: number, index: number): number;
    getMorphTrackWeights(tracks: number, index: number): number;
    getMovableBoneTrackFrameNumbers(tracks: number, index: number): number;
    getMovableBoneTrackPhysicsToggles(tracks: number, index: number): number;
    getMovableBoneTrackPositionInterpolations(tracks: number, index: number): number;
    getMovableBoneTrackPositions(tracks: number, index: number): number;
    getMovableBoneTrackRotationInterpolations(tracks: number, index: number): number;
    getMovableBoneTrackRotations(tracks: number, index: number): number;
    getNthBoneToBodyBindIndexMap(bone_to_body_bind_index_map: number, index: number): number;
    getNthMorphBindIndexMap(morph_bind_index_map: number, index: number): number;
    getPropertyTrackFrameNumbers(animation_ptr: number): number;
    getPropertyTrackIkStates(animation_ptr: number, index: number): number;
}

export class MmdRuntime {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    acquireDiagnosticErrorResult(): number;
    acquireDiagnosticInfoResult(): number;
    acquireDiagnosticWarningResult(): number;
    afterPhysics(): void;
    beforePhysics(frame_time?: number | null, time_step?: number | null): void;
    createBoneWorldMatrixBackBuffer(ptr: number): number;
    createMmdModel(serialized_metadata_ptr: number, serialized_metadata_size: number): number;
    destroyMmdModel(ptr: number): void;
    getAnimationArena(ptr: number): number;
    getAnimationIkSolverStateArena(ptr: number): number;
    getAnimationMorphArena(ptr: number): number;
    getAnimationRigidBodyStateArena(ptr: number): number;
    getAnimationRigidBodyStateArenaSize(ptr: number): number;
    getBoneWorldMatrixArena(ptr: number): number;
    getLockStatePtr(): number;
    getMultiPhysicsWorld(): number;
    markMmdModelPhysicsAsNeedInit(ptr: number): void;
    releaseDiagnosticResult(): void;
    setMmdModelWorldMatrix(ptr: number, world_matrix: number): void;
    setPhysicsFixedTimeStep(fixed_time_step: number): void;
    setPhysicsMaxSubSteps(max_sub_steps: number): void;
    setRuntimeAnimation(ptr: number, runtime_animation: number): void;
    swapWorldMatrixBuffer(): void;
    useExternalPhysics(ptr: number, rigidbody_state_size: number): void;
}

export function allocateBuffer(size: number): number;

export function constraintEnableSpring(ptr: number, index: number, on_off: boolean): void;

export function constraintSetAngularLowerLimit(ptr: number, x: number, y: number, z: number): void;

export function constraintSetAngularUpperLimit(ptr: number, x: number, y: number, z: number): void;

export function constraintSetDamping(ptr: number, index: number, damping: number): void;

export function constraintSetLinearLowerLimit(ptr: number, x: number, y: number, z: number): void;

export function constraintSetLinearUpperLimit(ptr: number, x: number, y: number, z: number): void;

export function constraintSetParam(ptr: number, num: number, value: number, axis: number): void;

export function constraintSetStiffness(ptr: number, index: number, stiffness: number): void;

export function constraintUseFrameOffset(ptr: number, frame_offset_on_off: boolean): void;

export function createAnimationPool(): AnimationPool;

export function createBoxShape(x: number, y: number, z: number): number;

export function createCapsuleShape(radius: number, height: number): number;

export function createGeneric6DofConstraint(body_a: number, body_b: number, frame_a: number, frame_b: number, use_linear_reference_frame_a: boolean): number;

export function createGeneric6DofConstraintFromBundle(body_bundle: number, body_a_index: number, body_b_index: number, frame_a: number, frame_b: number, use_linear_reference_frame_a: boolean): number;

export function createGeneric6DofSpringConstraint(body_a: number, body_b: number, frame_a: number, frame_b: number, use_linear_reference_frame_a: boolean): number;

export function createGeneric6DofSpringConstraintFromBundle(body_bundle: number, body_a_index: number, body_b_index: number, frame_a: number, frame_b: number, use_linear_reference_frame_a: boolean): number;

export function createMmdRuntime(): MmdRuntime;

export function createMultiPhysicsRuntime(physics_world: number): number;

export function createMultiPhysicsWorld(allow_dynamic_shadow: boolean): number;

export function createPhysicsRuntime(physics_world: number): number;

export function createPhysicsWorld(): number;

export function createRigidBody(info: number): number;

export function createRigidBodyBundle(info_list: number, len: number): number;

export function createSphereShape(radius: number): number;

export function createStaticPlaneShape(normal_x: number, normal_y: number, normal_z: number, plane_constant: number): number;

/**
 * Deallocate a buffer allocated by `allocateBuffer`.
 * # Safety
 * `ptr` must be a pointer to a buffer allocated by `allocateBuffer`.
 */
export function deallocateBuffer(ptr: number, size: number): void;

export function destroyConstraint(ptr: number): void;

export function destroyMultiPhysicsRuntime(physics_runtime: number): void;

export function destroyMultiPhysicsWorld(world: number): void;

export function destroyPhysicsRuntime(physics_runtime: number): void;

export function destroyPhysicsWorld(world: number): void;

export function destroyRigidBody(ptr: number): void;

export function destroyRigidBodyBundle(ptr: number): void;

export function destroyShape(ptr: number): void;

/**
 * Number of native rigid bodies in the model's built-in physics bundle.
 * Returns 0 when the model has no physics context (e.g. external/Bullet physics).
 */
export function getMmdModelRigidBodyBundleLen(model_ptr: number): number;

export function init(): void;

/**
 * Applies a central force to the model's native rigid body at `index`.
 * `FollowBone` bodies are skipped (their transforms are bone-driven, not physics).
 */
export function mmdModelRigidBodyApplyCentralForce(model_ptr: number, index: number, force_x: number, force_y: number, force_z: number): void;

export function multiPhysicsRuntimeGetLockStatePtr(runtime: number): number;

export function multiPhysicsWorldAddConstraint(world: number, world_id: number, constraint: number, disable_collisions_between_linked_bodies: boolean): void;

export function multiPhysicsWorldAddRigidBody(world: number, world_id: number, rigidbody: number): void;

export function multiPhysicsWorldAddRigidBodyBundle(world: number, world_id: number, bundle: number): void;

export function multiPhysicsWorldAddRigidBodyBundleShadow(world: number, world_id: number, bundle: number): void;

export function multiPhysicsWorldAddRigidBodyBundleToGlobal(world: number, bundle: number): void;

export function multiPhysicsWorldAddRigidBodyShadow(world: number, world_id: number, rigidbody: number): void;

export function multiPhysicsWorldAddRigidBodyToGlobal(world: number, rigidbody: number): void;

export function multiPhysicsWorldRemoveConstraint(world: number, world_id: number, constraint: number): void;

export function multiPhysicsWorldRemoveRigidBody(world: number, world_id: number, rigidbody: number): void;

export function multiPhysicsWorldRemoveRigidBodyBundle(world: number, world_id: number, bundle: number): void;

export function multiPhysicsWorldRemoveRigidBodyBundleFromGlobal(world: number, bundle: number): void;

export function multiPhysicsWorldRemoveRigidBodyBundleShadow(world: number, world_id: number, bundle: number): void;

export function multiPhysicsWorldRemoveRigidBodyFromGlobal(world: number, rigidbody: number): void;

export function multiPhysicsWorldRemoveRigidBodyShadow(world: number, world_id: number, rigidbody: number): void;

export function multiPhysicsWorldSetGravity(world: number, x: number, y: number, z: number): void;

export function multiPhysicsWorldStepSimulation(world: number, time_step: number, max_sub_steps: number, fixed_time_step: number): void;

export function multiPhysicsWorldUseMotionStateBuffer(world: number, use_buffer: boolean): void;

export function physicsRuntimeGetLockStatePtr(physics_runtime: number): number;

export function physicsWorldAddConstraint(world: number, constraint: number, disable_collisions_between_linked_bodies: boolean): void;

export function physicsWorldAddRigidBody(world: number, rigidbody: number): void;

export function physicsWorldAddRigidBodyBundle(world: number, bundle: number): void;

export function physicsWorldRemoveConstraint(world: number, constraint: number): void;

export function physicsWorldRemoveRigidBody(world: number, rigidbody: number): void;

export function physicsWorldRemoveRigidBodyBundle(world: number, bundle: number): void;

export function physicsWorldSetGravity(world: number, x: number, y: number, z: number): void;

export function physicsWorldStepSimulation(world: number, time_step: number, max_sub_steps: number, fixed_time_step: number): void;

export function physicsWorldUseMotionStateBuffer(world: number, use_buffer: boolean): void;

export function rigidBodyApplyCentralForce(ptr: number, force_x: number, force_y: number, force_z: number): void;

export function rigidBodyApplyCentralImpulse(ptr: number, impulse_x: number, impulse_y: number, impulse_z: number): void;

export function rigidBodyApplyCentralPushImpulse(ptr: number, impulse_x: number, impulse_y: number, impulse_z: number): void;

export function rigidBodyApplyForce(ptr: number, force_ptr: number, relative_position_ptr: number): void;

export function rigidBodyApplyImpulse(ptr: number, impulse_ptr: number, relative_position_ptr: number): void;

export function rigidBodyApplyPushImpulse(ptr: number, impulse_ptr: number, relative_position_ptr: number): void;

export function rigidBodyApplyTorque(ptr: number, torque_x: number, torque_y: number, torque_z: number): void;

export function rigidBodyApplyTorqueImpulse(ptr: number, torque_x: number, torque_y: number, torque_z: number): void;

export function rigidBodyApplyTorqueTurnImpulse(ptr: number, torque_x: number, torque_y: number, torque_z: number): void;

export function rigidBodyBundleApplyCentralForce(ptr: number, index: number, force_x: number, force_y: number, force_z: number): void;

export function rigidBodyBundleApplyCentralImpulse(ptr: number, index: number, impulse_x: number, impulse_y: number, impulse_z: number): void;

export function rigidBodyBundleApplyCentralPushImpulse(ptr: number, index: number, impulse_x: number, impulse_y: number, impulse_z: number): void;

export function rigidBodyBundleApplyForce(ptr: number, index: number, force_ptr: number, relative_position_ptr: number): void;

export function rigidBodyBundleApplyImpulse(ptr: number, index: number, impulse_ptr: number, relative_position_ptr: number): void;

export function rigidBodyBundleApplyPushImpulse(ptr: number, index: number, impulse_ptr: number, relative_position_ptr: number): void;

export function rigidBodyBundleApplyTorque(ptr: number, index: number, torque_x: number, torque_y: number, torque_z: number): void;

export function rigidBodyBundleApplyTorqueImpulse(ptr: number, index: number, torque_x: number, torque_y: number, torque_z: number): void;

export function rigidBodyBundleApplyTorqueTurnImpulse(ptr: number, index: number, torque_x: number, torque_y: number, torque_z: number): void;

export function rigidBodyBundleClearForces(ptr: number, index: number): void;

export function rigidBodyBundleGetAngularDamping(ptr: number, index: number): number;

export function rigidBodyBundleGetAngularVelocity(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetBufferedMotionStatesPtr(ptr: number): number;

export function rigidBodyBundleGetKinematicStatesPtr(ptr: number): number;

export function rigidBodyBundleGetLinearDamping(ptr: number, index: number): number;

export function rigidBodyBundleGetLinearVelocity(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetLocalInertia(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetMass(ptr: number, index: number): number;

export function rigidBodyBundleGetMotionStatesPtr(ptr: number): number;

export function rigidBodyBundleGetPushVelocity(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetPushVelocityInLocalPoint(ptr: number, index: number, relative_position_ptr: number, out: number): void;

export function rigidBodyBundleGetTotalForce(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetTotalTorque(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetTurnVelocity(ptr: number, index: number, out: number): void;

export function rigidBodyBundleGetVelocityInLocalPoint(ptr: number, index: number, relative_position_ptr: number, out: number): void;

export function rigidBodyBundleGetWorldTransformPtr(ptr: number, index: number): number;

export function rigidBodyBundleSetAngularVelocity(ptr: number, index: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodyBundleSetDamping(ptr: number, index: number, linear_damping: number, angular_damping: number): void;

export function rigidBodyBundleSetLinearVelocity(ptr: number, index: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodyBundleSetMassProps(ptr: number, index: number, mass: number, local_inertia_x: number, local_inertia_y: number, local_inertia_z: number): void;

export function rigidBodyBundleSetPushVelocity(ptr: number, index: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodyBundleSetShape(ptr: number, index: number, shape: number): void;

export function rigidBodyBundleSetTurnVelocity(ptr: number, index: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodyBundleTranslate(ptr: number, index: number, translation_x: number, translation_y: number, translation_z: number): void;

export function rigidBodyClearForces(ptr: number): void;

export function rigidBodyGetAngularDamping(ptr: number): number;

export function rigidBodyGetAngularVelocity(ptr: number, out: number): void;

export function rigidBodyGetBufferedMotionStatePtr(ptr: number): number;

export function rigidBodyGetKinematicStatePtr(ptr: number): number;

export function rigidBodyGetLinearDamping(ptr: number): number;

export function rigidBodyGetLinearVelocity(ptr: number, out: number): void;

export function rigidBodyGetLocalInertia(ptr: number, out: number): void;

export function rigidBodyGetMass(ptr: number): number;

export function rigidBodyGetMotionStatePtr(ptr: number): number;

export function rigidBodyGetPushVelocity(ptr: number, out: number): void;

export function rigidBodyGetPushVelocityInLocalPoint(ptr: number, relative_position_ptr: number, out: number): void;

export function rigidBodyGetTotalForce(ptr: number, out: number): void;

export function rigidBodyGetTotalTorque(ptr: number, out: number): void;

export function rigidBodyGetTurnVelocity(ptr: number, out: number): void;

export function rigidBodyGetVelocityInLocalPoint(ptr: number, relative_position_ptr: number, out: number): void;

export function rigidBodyGetWorldTransformPtr(ptr: number): number;

export function rigidBodySetAngularVelocity(ptr: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodySetDamping(ptr: number, linear_damping: number, angular_damping: number): void;

export function rigidBodySetLinearVelocity(ptr: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodySetMassProps(ptr: number, mass: number, local_inertia_x: number, local_inertia_y: number, local_inertia_z: number): void;

export function rigidBodySetPushVelocity(ptr: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodySetShape(ptr: number, shape: number): void;

export function rigidBodySetTurnVelocity(ptr: number, velocity_x: number, velocity_y: number, velocity_z: number): void;

export function rigidBodyTranslate(ptr: number, translation_x: number, translation_y: number, translation_z: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_animationpool_free: (a: number, b: number) => void;
    readonly animationpool_allocateLengthsBuffer: (a: number, b: number) => number;
    readonly animationpool_animateMmdModel: (a: number, b: number, c: number, d: number) => void;
    readonly animationpool_createAnimation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly animationpool_createBoneBindIndexMap: (a: number, b: number) => number;
    readonly animationpool_createBoneToBodyBindIndexMap: (a: number, b: number, c: number) => number;
    readonly animationpool_createBoneTracks: (a: number, b: number, c: number) => number;
    readonly animationpool_createIkSolverBindIndexMap: (a: number, b: number) => number;
    readonly animationpool_createMorphBindIndexMap: (a: number, b: number, c: number) => number;
    readonly animationpool_createMorphTracks: (a: number, b: number, c: number) => number;
    readonly animationpool_createMovableBoneBindIndexMap: (a: number, b: number) => number;
    readonly animationpool_createMovableBoneTracks: (a: number, b: number, c: number) => number;
    readonly animationpool_createRuntimeAnimation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly animationpool_deallocateLengthsBuffer: (a: number, b: number, c: number) => void;
    readonly animationpool_destroyAnimation: (a: number, b: number) => void;
    readonly animationpool_destroyRuntimeAnimation: (a: number, b: number) => void;
    readonly animationpool_getBoneTrackFrameNumbers: (a: number, b: number, c: number) => number;
    readonly animationpool_getBoneTrackPhysicsToggles: (a: number, b: number, c: number) => number;
    readonly animationpool_getBoneTrackRotationInterpolations: (a: number, b: number, c: number) => number;
    readonly animationpool_getBoneTrackRotations: (a: number, b: number, c: number) => number;
    readonly animationpool_getMorphTrackFrameNumbers: (a: number, b: number, c: number) => number;
    readonly animationpool_getMorphTrackWeights: (a: number, b: number, c: number) => number;
    readonly animationpool_getMovableBoneTrackFrameNumbers: (a: number, b: number, c: number) => number;
    readonly animationpool_getMovableBoneTrackPhysicsToggles: (a: number, b: number, c: number) => number;
    readonly animationpool_getMovableBoneTrackPositionInterpolations: (a: number, b: number, c: number) => number;
    readonly animationpool_getMovableBoneTrackPositions: (a: number, b: number, c: number) => number;
    readonly animationpool_getMovableBoneTrackRotationInterpolations: (a: number, b: number, c: number) => number;
    readonly animationpool_getMovableBoneTrackRotations: (a: number, b: number, c: number) => number;
    readonly animationpool_getNthBoneToBodyBindIndexMap: (a: number, b: number, c: number) => number;
    readonly animationpool_getPropertyTrackFrameNumbers: (a: number, b: number) => number;
    readonly animationpool_getPropertyTrackIkStates: (a: number, b: number, c: number) => number;
    readonly animationpool_getNthMorphBindIndexMap: (a: number, b: number, c: number) => number;
    readonly createMultiPhysicsWorld: (a: number) => number;
    readonly destroyMultiPhysicsWorld: (a: number) => void;
    readonly multiPhysicsWorldAddConstraint: (a: number, b: number, c: number, d: number) => void;
    readonly multiPhysicsWorldAddRigidBody: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldAddRigidBodyBundle: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldAddRigidBodyBundleShadow: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldAddRigidBodyBundleToGlobal: (a: number, b: number) => void;
    readonly multiPhysicsWorldAddRigidBodyShadow: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldAddRigidBodyToGlobal: (a: number, b: number) => void;
    readonly multiPhysicsWorldRemoveConstraint: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldRemoveRigidBody: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldRemoveRigidBodyBundle: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldRemoveRigidBodyBundleFromGlobal: (a: number, b: number) => void;
    readonly multiPhysicsWorldRemoveRigidBodyBundleShadow: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldRemoveRigidBodyFromGlobal: (a: number, b: number) => void;
    readonly multiPhysicsWorldRemoveRigidBodyShadow: (a: number, b: number, c: number) => void;
    readonly multiPhysicsWorldSetGravity: (a: number, b: number, c: number, d: number) => void;
    readonly multiPhysicsWorldStepSimulation: (a: number, b: number, c: number, d: number) => void;
    readonly multiPhysicsWorldUseMotionStateBuffer: (a: number, b: number) => void;
    readonly createRigidBodyBundle: (a: number, b: number) => number;
    readonly destroyRigidBodyBundle: (a: number) => void;
    readonly rigidBodyBundleApplyCentralForce: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleApplyCentralImpulse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleApplyCentralPushImpulse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleApplyForce: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyBundleApplyImpulse: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyBundleApplyPushImpulse: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyBundleApplyTorque: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleApplyTorqueImpulse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleApplyTorqueTurnImpulse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleClearForces: (a: number, b: number) => void;
    readonly rigidBodyBundleGetAngularDamping: (a: number, b: number) => number;
    readonly rigidBodyBundleGetAngularVelocity: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetBufferedMotionStatesPtr: (a: number) => number;
    readonly rigidBodyBundleGetKinematicStatesPtr: (a: number) => number;
    readonly rigidBodyBundleGetLinearDamping: (a: number, b: number) => number;
    readonly rigidBodyBundleGetLinearVelocity: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetLocalInertia: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetMass: (a: number, b: number) => number;
    readonly rigidBodyBundleGetMotionStatesPtr: (a: number) => number;
    readonly rigidBodyBundleGetPushVelocity: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetPushVelocityInLocalPoint: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyBundleGetTotalForce: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetTotalTorque: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetTurnVelocity: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleGetVelocityInLocalPoint: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyBundleGetWorldTransformPtr: (a: number, b: number) => number;
    readonly rigidBodyBundleSetAngularVelocity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleSetDamping: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyBundleSetLinearVelocity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleSetMassProps: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly rigidBodyBundleSetPushVelocity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleSetShape: (a: number, b: number, c: number) => void;
    readonly rigidBodyBundleSetTurnVelocity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodyBundleTranslate: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __cxa_pure_virtual: () => void;
    readonly bw_free: (a: number) => void;
    readonly bw_malloc: (a: number) => number;
    readonly constraintEnableSpring: (a: number, b: number, c: number) => void;
    readonly constraintSetAngularLowerLimit: (a: number, b: number, c: number, d: number) => void;
    readonly constraintSetAngularUpperLimit: (a: number, b: number, c: number, d: number) => void;
    readonly constraintSetDamping: (a: number, b: number, c: number) => void;
    readonly constraintSetLinearLowerLimit: (a: number, b: number, c: number, d: number) => void;
    readonly constraintSetLinearUpperLimit: (a: number, b: number, c: number, d: number) => void;
    readonly constraintSetParam: (a: number, b: number, c: number, d: number) => void;
    readonly constraintSetStiffness: (a: number, b: number, c: number) => void;
    readonly constraintUseFrameOffset: (a: number, b: number) => void;
    readonly createGeneric6DofConstraint: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly createGeneric6DofConstraintFromBundle: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly createGeneric6DofSpringConstraint: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly createGeneric6DofSpringConstraintFromBundle: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly destroyConstraint: (a: number) => void;
    readonly __wbg_mmdruntime_free: (a: number, b: number) => void;
    readonly mmdruntime_acquireDiagnosticErrorResult: (a: number) => number;
    readonly mmdruntime_acquireDiagnosticInfoResult: (a: number) => number;
    readonly mmdruntime_acquireDiagnosticWarningResult: (a: number) => number;
    readonly mmdruntime_afterPhysics: (a: number) => void;
    readonly mmdruntime_beforePhysics: (a: number, b: number, c: number) => void;
    readonly mmdruntime_createBoneWorldMatrixBackBuffer: (a: number, b: number) => number;
    readonly mmdruntime_createMmdModel: (a: number, b: number, c: number) => number;
    readonly mmdruntime_destroyMmdModel: (a: number, b: number) => void;
    readonly mmdruntime_getAnimationArena: (a: number, b: number) => number;
    readonly mmdruntime_getAnimationIkSolverStateArena: (a: number, b: number) => number;
    readonly mmdruntime_getAnimationMorphArena: (a: number, b: number) => number;
    readonly mmdruntime_getAnimationRigidBodyStateArena: (a: number, b: number) => number;
    readonly mmdruntime_getAnimationRigidBodyStateArenaSize: (a: number, b: number) => number;
    readonly mmdruntime_getBoneWorldMatrixArena: (a: number, b: number) => number;
    readonly mmdruntime_getLockStatePtr: (a: number) => number;
    readonly mmdruntime_getMultiPhysicsWorld: (a: number) => number;
    readonly mmdruntime_markMmdModelPhysicsAsNeedInit: (a: number, b: number) => void;
    readonly mmdruntime_releaseDiagnosticResult: (a: number) => void;
    readonly mmdruntime_setMmdModelWorldMatrix: (a: number, b: number, c: number) => void;
    readonly mmdruntime_setPhysicsFixedTimeStep: (a: number, b: number) => void;
    readonly mmdruntime_setPhysicsMaxSubSteps: (a: number, b: number) => void;
    readonly mmdruntime_setRuntimeAnimation: (a: number, b: number, c: number) => void;
    readonly mmdruntime_swapWorldMatrixBuffer: (a: number) => void;
    readonly mmdruntime_useExternalPhysics: (a: number, b: number, c: number) => void;
    readonly getMmdModelRigidBodyBundleLen: (a: number) => number;
    readonly mmdModelRigidBodyApplyCentralForce: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly allocateBuffer: (a: number) => number;
    readonly bw_acosf: (a: number) => number;
    readonly bw_asinf: (a: number) => number;
    readonly bw_atan2f: (a: number, b: number) => number;
    readonly bw_atanf: (a: number) => number;
    readonly bw_ceil: (a: number) => number;
    readonly bw_cosf: (a: number) => number;
    readonly bw_expf: (a: number) => number;
    readonly bw_fabs: (a: number) => number;
    readonly bw_fabsf: (a: number) => number;
    readonly bw_floor: (a: number) => number;
    readonly bw_fmodf: (a: number, b: number) => number;
    readonly bw_isinf: (a: number) => number;
    readonly bw_isnan: (a: number) => number;
    readonly bw_logf: (a: number) => number;
    readonly bw_powf: (a: number, b: number) => number;
    readonly bw_sinf: (a: number) => number;
    readonly bw_sqrt: (a: number) => number;
    readonly bw_sqrtf: (a: number) => number;
    readonly bw_tanf: (a: number) => number;
    readonly createAnimationPool: () => number;
    readonly createMmdRuntime: () => number;
    readonly deallocateBuffer: (a: number, b: number) => void;
    readonly init: () => void;
    readonly bw_cond_broadcast: (a: number) => number;
    readonly bw_cond_init: () => number;
    readonly bw_cond_wait: (a: number, b: number) => number;
    readonly bw_get_thread_id: () => number;
    readonly bw_mutex_init: () => number;
    readonly bw_mutex_lock: (a: number) => number;
    readonly bw_mutex_unlock: (a: number) => number;
    readonly createBoxShape: (a: number, b: number, c: number) => number;
    readonly createCapsuleShape: (a: number, b: number) => number;
    readonly createMultiPhysicsRuntime: (a: number) => number;
    readonly createRigidBody: (a: number) => number;
    readonly createSphereShape: (a: number) => number;
    readonly createStaticPlaneShape: (a: number, b: number, c: number, d: number) => number;
    readonly destroyMultiPhysicsRuntime: (a: number) => void;
    readonly destroyRigidBody: (a: number) => void;
    readonly destroyShape: (a: number) => void;
    readonly multiPhysicsRuntimeGetLockStatePtr: (a: number) => number;
    readonly rigidBodyApplyCentralForce: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyApplyCentralImpulse: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyApplyCentralPushImpulse: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyApplyForce: (a: number, b: number, c: number) => void;
    readonly rigidBodyApplyImpulse: (a: number, b: number, c: number) => void;
    readonly rigidBodyApplyPushImpulse: (a: number, b: number, c: number) => void;
    readonly rigidBodyApplyTorque: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyApplyTorqueImpulse: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyApplyTorqueTurnImpulse: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyClearForces: (a: number) => void;
    readonly rigidBodyGetAngularDamping: (a: number) => number;
    readonly rigidBodyGetAngularVelocity: (a: number, b: number) => void;
    readonly rigidBodyGetBufferedMotionStatePtr: (a: number) => number;
    readonly rigidBodyGetKinematicStatePtr: (a: number) => number;
    readonly rigidBodyGetLinearDamping: (a: number) => number;
    readonly rigidBodyGetLinearVelocity: (a: number, b: number) => void;
    readonly rigidBodyGetLocalInertia: (a: number, b: number) => void;
    readonly rigidBodyGetMass: (a: number) => number;
    readonly rigidBodyGetMotionStatePtr: (a: number) => number;
    readonly rigidBodyGetPushVelocity: (a: number, b: number) => void;
    readonly rigidBodyGetPushVelocityInLocalPoint: (a: number, b: number, c: number) => void;
    readonly rigidBodyGetTotalForce: (a: number, b: number) => void;
    readonly rigidBodyGetTotalTorque: (a: number, b: number) => void;
    readonly rigidBodyGetTurnVelocity: (a: number, b: number) => void;
    readonly rigidBodyGetVelocityInLocalPoint: (a: number, b: number, c: number) => void;
    readonly rigidBodyGetWorldTransformPtr: (a: number) => number;
    readonly rigidBodySetAngularVelocity: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodySetDamping: (a: number, b: number, c: number) => void;
    readonly rigidBodySetLinearVelocity: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodySetMassProps: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rigidBodySetPushVelocity: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodySetShape: (a: number, b: number) => void;
    readonly rigidBodySetTurnVelocity: (a: number, b: number, c: number, d: number) => void;
    readonly rigidBodyTranslate: (a: number, b: number, c: number, d: number) => void;
    readonly createPhysicsRuntime: (a: number) => number;
    readonly physicsRuntimeGetLockStatePtr: (a: number) => number;
    readonly destroyPhysicsRuntime: (a: number) => void;
    readonly createPhysicsWorld: () => number;
    readonly destroyPhysicsWorld: (a: number) => void;
    readonly physicsWorldAddConstraint: (a: number, b: number, c: number) => void;
    readonly physicsWorldAddRigidBody: (a: number, b: number) => void;
    readonly physicsWorldAddRigidBodyBundle: (a: number, b: number) => void;
    readonly physicsWorldRemoveConstraint: (a: number, b: number) => void;
    readonly physicsWorldRemoveRigidBody: (a: number, b: number) => void;
    readonly physicsWorldRemoveRigidBodyBundle: (a: number, b: number) => void;
    readonly physicsWorldSetGravity: (a: number, b: number, c: number, d: number) => void;
    readonly physicsWorldStepSimulation: (a: number, b: number, c: number, d: number) => void;
    readonly physicsWorldUseMotionStateBuffer: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
