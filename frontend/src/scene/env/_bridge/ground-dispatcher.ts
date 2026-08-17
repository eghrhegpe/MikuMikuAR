/**
 * env/_bridge/ground-dispatcher.ts
 * 地面装配回写分发器（控制反转）。
 *
 * [doc:adr-271] 从 env-ground.ts 的 `triggerTerrainReady` / `setGroundMesh` /
 * `setGroundActualSize` 三个 setter 抽出的请求式接口。原因：env-ground-spec.ts 建完地面后
 * 需要回写 env-ground 的模块局部状态，而 env-ground 又 import spec 建材质 ——
 * `env-ground ⇄ env-ground-spec` 构成 size=3 SCC。
 *
 * 改走分发器后依赖方向变为 `env-ground-spec → dispatcher ← env-ground`（单向漏斗），
 * 环消失；spec 不再需要知道地面状态存在哪里。语义与 ADR-271 决策 1 的
 * env-dispatcher 观察器请求同范式。
 *
 * 约束：本文件不得 import 任何 env 子系统（它必须是叶子）。
 */

type TerrainReadyHandler = () => void;
type GroundMeshHandler = (mesh: unknown) => void;
type GroundSizeHandler = (size: number) => void;

let _onTerrainReady: TerrainReadyHandler | null = null;
let _setGroundMesh: GroundMeshHandler | null = null;
let _setGroundActualSize: GroundSizeHandler | null = null;

/** 由 env-ground.ts 在模块求值时注册三个回写实现。 */
export function registerGroundHandlers(handlers: {
    terrainReady: TerrainReadyHandler;
    setMesh: GroundMeshHandler;
    setActualSize: GroundSizeHandler;
}): void {
    _onTerrainReady = handlers.terrainReady;
    _setGroundMesh = handlers.setMesh;
    _setGroundActualSize = handlers.setActualSize;
}

/** 触发地形就绪监听（由 spec 模块在 terrain 建成后调用）。未注册时静默跳过。 */
export function requestTerrainReady(): void {
    _onTerrainReady?.();
}

/** 回写地面 mesh（由 spec 模块在新建/替换地面后调用）。未注册时静默跳过。 */
export function publishGroundMesh(mesh: unknown): void {
    _setGroundMesh?.(mesh);
}

/** 回写地面实际尺寸（由 spec 模块在尺寸变化后调用）。未注册时静默跳过。 */
export function publishGroundActualSize(size: number): void {
    _setGroundActualSize?.(size);
}
