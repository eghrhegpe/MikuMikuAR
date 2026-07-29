// @ts-nocheck
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
const MockCamera = vi.hoisted(() => { return class { fov = 0.8; position = { x: 0, y: 0, z: 0 }; name = ''; constructor(..._a: any[]) {} getClassName() { return 'Camera'; } attachControl() {} detachControl() {} dispose() {} } as any; });
const MockArcRotateCamera = vi.hoisted(() => { return class { alpha = 0; beta = 0; radius = 0; lowerRadiusLimit = 0; upperRadiusLimit = 0; panningSensibility = 50; inertia = 0; angularSensibilityX = 0; angularSensibilityY = 0; pinchPrecision = 0; _panningMouseButton = 0; fov = 0.8; position = { x: 0, y: 0, z: 0 }; target = { x: 0, y: 8, z: 0 }; _scene: any; _cameraRotation = { x: 0, y: 0 }; inputs = { addGamepad: () => {} }; name = ''; constructor(..._a: any[]) {} getClassName() { return 'ArcRotateCamera'; } attachControl() {} detachControl() {} setTarget(_t: any) { this.target.x = _t.x; this.target.y = _t.y; this.target.z = _t.z; } dispose() {} } as any; });
const MockUniversalCamera = vi.hoisted(() => { return class { speed = 0.5; angularSensibility = 2000; fov = 0.8; name = ''; position = { x: 0, y: 0, z: 0 }; keysUp: number[] = []; keysDown: number[] = []; keysLeft: number[] = []; keysRight: number[] = []; constructor(..._a: any[]) {} getClassName() { return 'UniversalCamera'; } attachControl() {} detachControl() {} setTarget() {} getDirection(_d: any) { return { x: 0, y: 0, z: 1, scaleInPlace: () => {}, addInPlace: () => {} }; } dispose() {} } as any; });
const MockV3 = vi.hoisted(() => { const V = class { x=0;y=0;z=0; constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z} clone(){return new V(this.x,this.y,this.z)} add(v:any){return new V(this.x+v.x,this.y+v.y,this.z+v.z)} scale(s:number){return new V(this.x*s,this.y*s,this.z*s)} length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)} normalize(){return this} set(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;return this} setAll(v:number){this.x=this.y=this.z=v;return this} static Zero(){return new V(0,0,0)} static Right(){return new V(1,0,0)} static Up(){return new V(0,1,0)} static Forward(){return new V(0,0,1)} static One(){return new V(1,1,1)} }; return V as any; });
const MockQuat = vi.hoisted(() => { return class { x=0;y=0;z=0;w=1; constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w} clone(){return new (this.constructor as any)(this.x,this.y,this.z,this.w)} static Identity(){return new this(0,0,0,1)} static RotationYawPitchRoll(){return new this(0,0,0,1)} } as any; });
const MockMtx = vi.hoisted(() => { return class { m=new Float32Array(16); constructor(){this.m.fill(0)} getClassName(){return'Matrix'} invertToRef(){} multiplyToRef(){} getRotationMatrixToRef(){} decompose(){return{translation:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scaling:{x:1,y:1,z:1}}} static Identity(){return new this()} static IdentityToRef(){} static RotationYToRef(){} } as any; });
const MockMmdCam = vi.hoisted(() => { return class { name=''; constructor(name:string,..._a:any[]){this.name=name} createRuntimeAnimation(){return 0} setRuntimeAnimation(){} animate(_f:number){} dispose(){} getClassName(){return'MmdCamera'} } as any; });
const MockC4 = vi.hoisted(() => { return class { r=0;g=0;b=0;a=1; constructor(r=0,g=0,b=0,a=1){this.r=r;this.g=g;this.b=b;this.a=a} set(r:number,g:number,b:number,a=this.a){this.r=r;this.g=g;this.b=b;this.a=a;return this} clone(){return new(this.constructor as any)(this.r,this.g,this.b,this.a)} toArray(){return[this.r,this.g,this.b,this.a]} } as any; });
const MockScene = vi.hoisted(() => { return class { _uc=0;cc={r:0,g:0,b:0,a:1};_e:any=null;l:any[]=[];m:any[]=[];mats:any[]=[];ac:any=null;obr={add:()=>({}),remove:()=>{}};odd={add:()=>({}),remove:()=>{},notifyObservers:()=>{},hasObservers:false}; constructor(e?:any){this._e=e??null} getEngine(){return this._e} getScene(){return this} getClassName(){return'Scene'} getUniqueId(){return this._uc++} registerBeforeRender(){} unregisterBeforeRender(){} executeWhenReady(){} addCamera(){} removeCamera(){} attachControl(){} detachControl(){} getTransformMatrix(){return{}} updateTransformMatrix(){} getProjectionMatrix(){return{clone:()=>({})}} markAllMaterialsAsDirty(){} } as any; });

vi.mock('@babylonjs/core/Cameras/camera', () => ({ Camera: MockCamera }));
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({ ArcRotateCamera: MockArcRotateCamera }));
vi.mock('@babylonjs/core/Cameras/universalCamera', () => ({ UniversalCamera: MockUniversalCamera }));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({ Vector3: MockV3, Quaternion: MockQuat, Matrix: MockMtx }));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color3: class { r=0;g=0;b=0;set(){}clone(){return this} }, Color4: MockC4 }));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({ AbstractMesh: class {}, Mesh: class {} }));
vi.mock('@babylonjs/core/scene', () => ({ Scene: MockScene }));
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => ({ MmdCamera: MockMmdCam }));
vi.mock('babylon-mmd/esm/Loader/Animation/mmdAnimation', () => ({}));
const mockUiState: Record<string, unknown> = {};
vi.mock('@/core/config', () => ({ focusedModelId: null, modelRegistry: new Map(), uiState: mockUiState, triggerAutoSave: vi.fn(), setStatus: vi.fn() }));
const mockPBD = vi.fn<() => any>(() => null);
vi.mock('@/scene/scene', () => ({ focusModel: vi.fn(), reattachPipeline: vi.fn(), setARMode: vi.fn(), getProcBeatDetector: mockPBD }));
vi.mock('../scene/env/env-persist', () => ({ schedulePersistUI: vi.fn() }));
vi.mock('../scene/camera/camera', () => ({ initCameraSystem: vi.fn(), autoFrame: vi.fn(), getCameraMode: vi.fn(() => 'orbit'), getCurrentCamera: vi.fn(() => null), getFov: vi.fn(() => 0.8), setFov: vi.fn(), getOrbitParams: vi.fn(), getFreeflyParams: vi.fn(), getConcertParams: vi.fn(), getSurroundParams: vi.fn(), setOrbitParams: vi.fn(), setFreeflyParams: vi.fn(), setConcertParams: vi.fn(), setSurroundParams: vi.fn(), hasCameraVmd: vi.fn(() => false) }));

let cam: any;
beforeAll(async () => { const m = await vi.importActual('../scene/camera/camera'); cam = m as any; (cam as any).setSyncAxesCallback(() => (cam as any)._syncAxesFromMode((cam as any).getCameraMode())); });
beforeEach(() => { cam.setCameraPreset(cam.defaultCameraPreset()); cam.setFov(0.8); });

describe('defaultCameraPreset', () => {
    it('structure', () => { const p = cam.defaultCameraPreset(); ['mode','orbit','freefly','concert','surround'].forEach(k => expect(p).toHaveProperty(k)); ['targetHeight','distance','beta'].forEach(k => expect(p.orbit).toHaveProperty(k)); ['speed','angularSensibility'].forEach(k => expect(p.freefly).toHaveProperty(k)); });
    it('defaults', () => { const p = cam.defaultCameraPreset(); expect(p.mode).toBe('orbit'); expect(p.orbit.targetHeight).toBe(0); expect(p.orbit.distance).toBe(16); });
    it('fresh copy', () => { const a = cam.defaultCameraPreset(); expect(a).not.toBe(cam.defaultCameraPreset()); });
});
describe('setOrbitParams', () => {
    it('partial', () => { cam.setOrbitParams({ distance: 20 }); expect(cam.getOrbitParams().distance).toBe(20); expect(cam.getOrbitParams().targetHeight).toBe(0); });
    it('all at once', () => { cam.setOrbitParams({ targetHeight: 10, distance: 22, beta: 1.2 }); const p = cam.getOrbitParams(); expect(p.targetHeight).toBe(10); expect(p.distance).toBe(22); expect(p.beta).toBe(1.2); });
    it('no live camera safe', () => { expect(() => cam.setOrbitParams({ distance: 5 })).not.toThrow(); });
    it('preserves others', () => { cam.setOrbitParams({ distance: 30 }); expect(cam.getFreeflyParams().speed).toBe(0.5); });
    it('accumulates', () => { cam.setOrbitParams({ distance: 10 }); cam.setOrbitParams({ beta: 0.5 }); cam.setOrbitParams({ targetHeight: 3 }); const p = cam.getOrbitParams(); expect(p.distance).toBe(10); expect(p.beta).toBe(0.5); expect(p.targetHeight).toBe(3); });
});
describe('setFreeflyParams', () => {
    it('partial', () => { cam.setFreeflyParams({ speed: 2 }); expect(cam.getFreeflyParams().speed).toBe(2); expect(cam.getFreeflyParams().angularSensibility).toBe(2000); });
    it('angular independently', () => { cam.setFreeflyParams({ angularSensibility: 5000 }); expect(cam.getFreeflyParams().angularSensibility).toBe(5000); expect(cam.getFreeflyParams().speed).toBe(0.5); });
    it('no live universal safe', () => { expect(() => cam.setFreeflyParams({ speed: 5 })).not.toThrow(); });
    it('both', () => { cam.setFreeflyParams({ speed: 3, angularSensibility: 800 }); const p = cam.getFreeflyParams(); expect(p.speed).toBe(3); expect(p.angularSensibility).toBe(800); });
});
describe('setConcertParams', () => {
    it('all fields', () => { cam.setConcertParams({ radius: 20, height: 10, sweepAngle: 80, baseBeta: 0.9 }); const p = cam.getConcertParams(); expect(p.radius).toBe(20); expect(p.height).toBe(10); expect(p.sweepAngle).toBe(80); expect(p.baseBeta).toBeCloseTo(0.9, 6); });
    it('partial preserve', () => { cam.setConcertParams({ radius: 18 }); const p = cam.getConcertParams(); expect(p.radius).toBe(18); expect(p.height).toBe(8); expect(p.sweepAngle).toBe(120); });
    it('no throw', () => { expect(() => cam.setConcertParams({ radius: 99 })).not.toThrow(); });
});
describe('setSurroundParams', () => {
    it('all fields', () => { cam.setSurroundParams({ radius: 20, height: 10, speed: 0.8 }); const p = cam.getSurroundParams(); expect(p.radius).toBe(20); expect(p.height).toBe(10); expect(p.speed).toBe(0.8); });
    it('partial preserve', () => { cam.setSurroundParams({ radius: 18 }); const p = cam.getSurroundParams(); expect(p.radius).toBe(18); expect(p.height).toBe(8); expect(p.speed).toBe(0.3); });
});
describe('gCM/gCC', () => {
    it('default orbit', () => { expect(cam.getCameraMode()).toBe('orbit'); });
    it('null camera', () => { expect(cam.getCurrentCamera()).toBeNull(); });
});
describe('FOV', () => {
    it('default 0.8', () => { expect(cam.getFov()).toBe(0.8); });
    it('set 1.5', () => { cam.setFov(1.5); expect(cam.getFov()).toBe(1.5); });
    it('clamp min', () => { cam.setFov(0.05); expect(cam.getFov()).toBe(0.1); });
    it('clamp max', () => { cam.setFov(5); expect(cam.getFov()).toBe(3); });
    it('clamp negative', () => { cam.setFov(-1); expect(cam.getFov()).toBe(0.1); });
    it('boundary low', () => { cam.setFov(0.1); expect(cam.getFov()).toBe(0.1); });
    it('boundary high', () => { cam.setFov(3); expect(cam.getFov()).toBe(3); });
    it('roundtrip', () => { cam.setFov(2.5); expect(cam.getFov()).toBe(2.5); cam.setFov(0.8); expect(cam.getFov()).toBe(0.8); });
    it('no cam safe', () => { expect(() => cam.setFov(1.2)).not.toThrow(); });
});
