import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";

vi.hoisted(() => {
  const ids = ["renderCanvas", "statusBar", "loading", "loadingText", "btnMainAction", "modelPopup"];
  for (const id of ids) {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
  }
});

vi.mock("@babylonjs/core/Engines/engine", () => ({
  Engine: class MockEngine {
    _features = { trackUbosInFrame: false, doNotHandleContextLost: true };
    _renderLoops: Array<() => void> = [];
    _renderPassIdCounter = 0;
    _renderPassIds: number[] = [];
    runRenderLoop(cb: () => void) { this._renderLoops.push(cb); }
    stopRenderLoop() { this._renderLoops = []; }
    getRenderWidth() { return 800; }
    getRenderHeight() { return 600; }
    resize() {}
    clear() {}
    getClassName() { return "Engine"; }
    setHardwareScalingLevel() {}
    getHardwareScalingLevel() { return 1; }
    createRenderPassId() { const id = this._renderPassIdCounter++; this._renderPassIds.push(id); return id; }
    releaseRenderPassId(id: number) { const i = this._renderPassIds.indexOf(id); if (i >= 0) this._renderPassIds.splice(i, 1); }
  },
}));

class MockScene {
  _uniqueIdCounter = 0;
  clearColor = { r: 0, g: 0, b: 0, a: 1 };
  _engine: any;
  lights: any[] = [];
  meshes: any[] = [];
  actionManager = null;
  metadata = null;
  _transformMatrix = {};
  constructor(engine: any) { this._engine = engine; }
  getEngine() { return this._engine; }
  getScene() { return this; }
  getClassName() { return "Scene"; }
  getUniqueId() { return this._uniqueIdCounter++; }
  addLight(l: any) { this.lights.push(l); }
  removeLight(l: any) { const i = this.lights.indexOf(l); if (i >= 0) this.lights.splice(i, 1); }
  sortLightsByPriority() {}
  createDefaultCameraOrLight() {}
  _notifyIdleControllers() {}
  getBoundingBoxRenderer() { return { isEnabled: false }; }
  attachControl() {}
  detachControl() {}
  _blockEntityCollection = false;
  onDisposeObservable = { add: vi.fn(), remove: vi.fn(), notifyObservers: vi.fn(), hasObservers: false };
  metadataObj: any = null;
  getTransformMatrix() { return this._transformMatrix; }
  updateTransformMatrix() {}
  getProjectionMatrix() { return { clone: () => ({}) }; }
  markAllMaterialsAsDirty() {}
}

vi.mock("@babylonjs/core/scene", () => ({ Scene: MockScene }));

vi.mock("@babylonjs/core/Lights/hemisphericLight", () => ({
  HemisphericLight: class MockHemisphericLight {
    intensity = 0.8;
    diffuse: any = null;
    specular: any = null;
    groundColor: any = null;
    _scene: any;
    constructor(_name: string, _direction: any, scene: any) {
      this._scene = scene;
      if (scene?.addLight) scene.addLight(this);
    }
    dispose() { if (this._scene?.removeLight) this._scene.removeLight(this); }
  },
}));

vi.mock("@babylonjs/core/Lights/directionalLight", () => ({
  DirectionalLight: class MockDirectionalLight {
    intensity = 0.5;
    diffuse: any = null;
    specular: any = null;
    _scene: any;
    constructor(_name: string, _direction: any, scene: any) {
      this._scene = scene;
      if (scene?.addLight) scene.addLight(this);
    }
    dispose() { if (this._scene?.removeLight) this._scene.removeLight(this); }
  },
}));

vi.mock("@babylonjs/core/Lights/light", () => ({
  Light: class MockLight {
    intensity = 1;
    _scene: any;
    _parentNode: any = null;
    constructor(_name: string, scene: any) { this._scene = scene; }
  },
}));

vi.mock("@babylonjs/core/Cameras/arcRotateCamera", () => ({
  ArcRotateCamera: class MockArcRotateCamera {
    _scene: any;
    _cameraRotation = { x: 0, y: 0 };
    inputs = { addGamepad: () => {} };
    inertia = 0;
    angularSensibilityX = 0;
    angularSensibilityY = 0;
    pinchPrecision = 0;
    panningSensibility = 0;
    _panningMouseButton = 0;
    fov = 0.8;
    position = { x: 0, y: 0, z: 0 };
    constructor(...args: any[]) {}
    getClassName() { return "ArcRotateCamera"; }
    attachControl() {}
    detachControl() {}
    dispose() {}
  },
}));

vi.mock("@babylonjs/core/Cameras/camera", () => ({
  Camera: class MockCamera {
    _scene: any;
    fov = 0.8;
    position = { x: 0, y: 0, z: 0 };
    constructor(...args: any[]) {}
    getClassName() { return "Camera"; }
    attachControl() {}
    detachControl() {}
    dispose() {}
  },
}));

vi.mock("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline", () => ({
  DefaultRenderingPipeline: class MockPipeline {
    constructor() {}
    setRenderCamera() {}
    dispose() {}
  },
}));

vi.mock("babylon-mmd/esm/Runtime/mmdCamera", () => ({
  MmdCamera: class MockMmdCamera {
    constructor() {}
  },
}));

vi.mock("@babylonjs/core/Materials/Textures/texture", () => ({
  Texture: class MockTexture {
    _url: string;
    _scene: any;
    name = "";
    url = "";
    _texture = null;
    onLoadObservable = { add: vi.fn(), remove: vi.fn() };
    constructor(url: string, scene: any) {
      this._url = url;
      this._scene = scene;
      this.name = url;
      this.url = url;
    }
    isReady() { return true; }
    dispose() {}
    getClassName() { return "Texture"; }
    clone() { return this; }
    set onError(_: any) {}
    get onError() { return undefined; }
  },
}));

// Setup minimal model registry
import { modelRegistry, setLibraryRoot } from "../config";

function makeColor(r: number, g: number, b: number) {
  return { r, g, b, set: function(sr: number, sg: number, sb: number) { this.r = sr; this.g = sg; this.b = sb; }, multiplyInPlace: function(c: any) { this.r *= c.r; this.g *= c.g; this.b *= c.b; } };
}

function createMockMaterial(name: string, textures: Record<string, any>) {
  const mat: any = { name, isReady: true, clone: () => mat, dispose: () => {} };
  for (const [k, v] of Object.entries(textures)) mat[k] = v;
  mat.diffuseColor = makeColor(1, 1, 1);
  mat.specularColor = makeColor(1, 1, 1);
  mat.specularPower = 50;
  mat.ambientColor = makeColor(1, 1, 1);
  return mat;
}

function createMockMesh(material: any) {
  return { material, _positions: null, name: "mesh" };
}

describe("applyOutfitVariant", () => {
  let inst: any;
  const origDiffuse = { name: "orig.png", url: "orig.png", isReady: () => true, dispose: vi.fn(), onLoadObservable: { add: vi.fn(), remove: vi.fn() } };
  const origToon = { name: "orig_toon.png", url: "orig_toon.png", isReady: () => true, dispose: vi.fn(), onLoadObservable: { add: vi.fn(), remove: vi.fn() } };

  beforeEach(() => {
    modelRegistry.clear();
    setLibraryRoot("");
    const sm = createMockMaterial("顔", { diffuseTexture: origDiffuse, toonTexture: origToon });
    inst = {
      id: "m1", name: "test", filePath: "/models/test.pmx", port: 12345,
      meshes: [createMockMesh(sm)], rootMesh: createMockMesh(sm),
      scaling: 1, rotationY: 0, visible: true, opacity: 1, wireframe: false,
      showBones: false, physicsEnabled: false, kind: "actor",
      vmdData: null, vmdName: "", vmdPath: null, animationDuration: 0,
      modelDir: "/models",
      outfitFile: {
        version: 1,
        variants: [
          { name: "泳装", byCategory: { "服装": { diffuse: "swim.png", toon: "swim_toon.png" } } },
          { name: "校服", byMaterial: { "顔": { diffuse: "school.png" } } },
        ],
      },
      activeVariant: undefined,
      _origTextures: undefined,
    };
    modelRegistry.set("m1", inst);
  });

  it("should return early if no outfitFile", async () => {
    inst.outfitFile = undefined;
    const { applyOutfitVariant } = await import("../outfit");
    await applyOutfitVariant("m1", "泳装");
    expect(inst.activeVariant).toBeUndefined();
  });

  it("should capture _origTextures on first apply", async () => {
    const { applyOutfitVariant } = await import("../outfit");
    expect(inst._origTextures).toBeUndefined();
    await applyOutfitVariant("m1", "泳装");
    expect(inst._origTextures).toBeDefined();
    expect(inst._origTextures!.size).toBe(1);
    const orig = inst._origTextures!.get(0);
    expect(orig?.diffuse).toBe(origDiffuse);
    expect(orig?.toon).toBe(origToon);
  });

  it("should set activeVariant after apply", async () => {
    const { applyOutfitVariant } = await import("../outfit");
    await applyOutfitVariant("m1", "校服");
    expect(inst.activeVariant).toBe("校服");
  });

  it("should apply byMaterial override over byCategory", async () => {
    const { applyOutfitVariant } = await import("../outfit");
    await applyOutfitVariant("m1", "校服");
    // "顔" material: byMaterial has "school.png" for diffuse → should win
    expect(inst.activeVariant).toBe("校服");
  });

  it("should restore originals on '默认'", async () => {
    const { applyOutfitVariant } = await import("../outfit");
    await applyOutfitVariant("m1", "泳装");
    expect(inst.activeVariant).toBe("泳装");
    await applyOutfitVariant("m1", "默认");
    expect(inst.activeVariant).toBe("默认");
  });

  it("should be a no-op for unknown variant", async () => {
    const { applyOutfitVariant } = await import("../outfit");
    inst.activeVariant = "泳装";
    await applyOutfitVariant("m1", "不存在");
    expect(inst.activeVariant).toBe("泳装");
  });
});

describe("resetOutfit", () => {
  let inst: any;
  const origDiffuse = { name: "orig.png", url: "orig.png", isReady: () => true, dispose: vi.fn(), onLoadObservable: { add: vi.fn(), remove: vi.fn() } };

  beforeEach(() => {
    modelRegistry.clear();
    setLibraryRoot("");
    const sm = createMockMaterial("体", { diffuseTexture: origDiffuse });
    inst = {
      id: "m1", name: "test", filePath: "/models/test.pmx", port: 12345,
      meshes: [createMockMesh(sm)], rootMesh: createMockMesh(sm),
      scaling: 1, rotationY: 0, visible: true, opacity: 1, wireframe: false,
      showBones: false, physicsEnabled: false, kind: "actor",
      vmdData: null, vmdName: "", vmdPath: null, animationDuration: 0,
      modelDir: "/models",
      outfitFile: null,
      activeVariant: "泳装",
      _origTextures: new Map([[0, { diffuse: origDiffuse }]]),
    };
    modelRegistry.set("m1", inst);
  });

  it("should clear outfit state", async () => {
    const { resetOutfit } = await import("../outfit");
    resetOutfit("m1");
    expect(inst.activeVariant).toBeUndefined();
    expect(inst.outfitFile).toBeUndefined();
    expect(inst._origTextures).toBeUndefined();
  });
});
