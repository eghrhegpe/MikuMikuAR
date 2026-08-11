主应用获取产物方式
在主应用的 package.json 里，把 babylon-mmd 声明为 git 依赖，指向你的 fork 的 dist 分支：


JSON

{
  "dependencies": {
    "babylon-mmd": "github:eghrhegpe/babylon-mmd#feat/p2-native-rigidbody-bundle-dist"
  }
}
然后 npm install 即可（或 npm i github:eghrhegpe/babylon-mmd#feat/p2-native-rigidbody-bundle-dist）。

关键点
为什么用 dist 分支：dist 分支只含 esm/（编译产物）+ package.json，体积小、无源码，主应用直接 import 到 esm/index.js。
导出映射（dist 分支的 package.json#exports）决定了可用的导入路径：
import * as m from "babylon-mmd" → esm/index.js（全功能，含自动注册）
import * as m from "babylon-mmd/pure" → esm/pure.js（零副作用，tree-shake 友好）
import ... from "babylon-mmd/esm/xxx" → 深路径
WASM 产物包含：本次重新编译的 8 个物理配置（esm/Runtime/Optimized/wasm/*/index_bg.wasm）都在 dist 分支里，主应用运行时能正确加载。
注意：因为用的是 git 依赖而非 npm registry 版本号，主应用侧要重新 npm install（或清缓存）才能拿到最新的 d704dab 发布。另外依据项目记忆，同版本依赖下 npm link 会产生双物理路径类型冲突，主应用如用 link 需 npm dedup 收敛。
