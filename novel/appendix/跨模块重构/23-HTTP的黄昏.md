# HTTP 的黄昏

> **背景**：联邦长期通过本地 HTTP 中转加载文件，PMX/VMD/音频均经 `resolveFileUrl → StartFileServer → fetch` 管线。ADR-124 要将主路径迁移到 ArrayBuffer 直传，消除 HTTP roundtrip 和 Android 安全风险。
> **过程**：迁移过程中发现 Wails v3 的 `[]byte` 序列化陷阱、`ListDir` 不递归、outfit 探测读全文件、`resource_root` 配置污染四个坑。最终在 binding 层封装了 base64 解码，消费者完全无感。

---

联邦的文件加载一直走 HTTP。

PMX 模型从磁盘读出来，交给 Go 的 `StartFileServer`，启动一个 `127.0.0.1:{port}` 的临时服务器，前端再通过 `fetch` 去拿。VMD 动作、音频文件，同理。每一次加载都是一次完整的 HTTP 往复——浏览器发请求，本地服务器响应，二进制数据穿过网络栈。

桌面壳知道这条路能走通。但它也知道，这条路有隐患：Android 上的混合内容安全策略（`MIXED_CONTENT_ALWAYS_ALLOW`），HTTP 服务器的端口管理，文件隔离和 URL 编码的层层转译。

外交官说：「web-loader 已经验证过了。PMX 可以直接传 `ArrayBufferView`，纹理可以用 `referenceFiles` 从内存加载。不走 HTTP。」

「那就做。」桌面壳说。

它翻开了 ADR-124。

---

## 一、base64 的谎言

Go 侧新增了 `ReadFileBytes`：

```go
func (a *App) ReadFileBytes(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    return data, nil
}
```

二进制读取，返回字节切片。注释写得很清楚：

> Wails v3 automatically maps []byte to Uint8Array on the frontend side.

桌面壳信了。

它在 `model-loader.ts` 里调用 `ReadFileBytes`，拿到结果，直接传给 `ImportMeshAsync`。然后——

```
at createLoadError (sceneLoader.ts:578:12)
GET http://wails.localhost:9245/UE1YIAAAAEAIAAAEAQECAQIAAAAAAAAAAAAAAAAAAAAAeB8…
net::ERR_FAILED
```

PMX 加载失败了。错误信息是一串乱码——二进制数据被 `.toString()` 后拼成了 URL 路径。

"这不对。" 桌面壳说，"它应该返回 `Uint8Array`。"

外交官去翻了 Wails v3 的源码。在 `internal/generator/render/type.go` 第 56 行，找到了一行铁证：

```go
if types.Identical(typ, typeByteSlice) {
    // encoding/json marshals byte slices as base64 strings
    return "string" + null, null != ""
}
```

不是遗漏。不是 bug。是**显式写死的设计决策**。生成器看到 `[]byte`，直接返回 `string`。注释解释了原因——`encoding/json` 把 `[]byte` 序列化为 base64 字符串，Wails 选择顺从 JSON 协议，不做额外的 base64→Uint8Array 变换。

"注释在说谎。" 外交官说。

"不，" 桌面壳说，"注释写的是 Go 侧的行为。问题是 Go 侧把 `[]byte` 交给了 `encoding/json`，而 JSON 协议会把它变成 base64 字符串。Wails 只是忠实地传递了这个结果。"

它沉默了三秒钟。然后它写了一个函数：

```typescript
function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
```

六个文件，九处调用，逐一补上解码。PMX 终于加载成功了。

**第一个坑：** Wails v3 的 Go `[]byte` 不是 `Uint8Array`，是 base64 字符串。这是 `encoding/json` 的行为 + Wails 生成器的显式设计。注释描述的是 Go 侧，不是前端侧。

---

## 二、白色的诅咒

PMX 加载成功了。模型出现在了舞台中央。

但它是白色的。

所有的纹理都消失了。模型像一尊未上色的石膏像，只有几何轮廓，没有颜色。

"纹理呢？" 桌面壳问。

它检查了 `referenceFiles` 选项——传了。它检查了 `ListDirRecursive` 返回的文件列表——有纹理文件。它检查了 `relativePath`——

等等。

`ListDir` 返回的是 `body.png`。但 PMX 内部引用的是 `textures/body.png`。

"路径对不上。" 外交官说，"babylon-mmd 的 `ReferenceFileResolver` 用 `relativePath` 去匹配 PMX 里写的纹理路径。你给的是文件名，它要的是相对路径。"

桌面壳看了一眼 `ListDir` 的实现：

```go
func (a *App) ListDir(dirPath string) ([]string, error) {
    entries, err := os.ReadDir(dirPath)
    // ...
    for _, e := range entries {
        if !e.IsDir() {
            names = append(names, e.Name())  // 只取文件名
        }
    }
    return names, nil
}
```

它只返回了文件名。没有目录前缀，没有相对路径。

于是有了 `ListDirRecursive`——用 `filepath.WalkDir` 递归遍历，返回完整的相对路径：

```go
type FileInfo struct {
    Name         string `json:"name"`
    RelativePath string `json:"relativePath"`
}

func (a *App) ListDirRecursive(dirPath string) ([]FileInfo, error) {
    var files []FileInfo
    err := filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, err error) error {
        if err != nil || d.IsDir() { return nil }
        rel, _ := filepath.Rel(dirPath, path)
        files = append(files, FileInfo{
            Name: d.Name(),
            RelativePath: filepath.ToSlash(rel),
        })
        return nil
    })
    return files, err
}
```

`textures/body.png` 和 PMX 内部引用的 `textures/body.png` 终于对上了。

材质恢复了颜色。

**第二个坑：** 扁平扫描只给文件名，递归扫描才给相对路径。babylon-mmd 的纹理匹配依赖完整的相对路径。

---

## 三、outfit 的攻防战

PMX 和纹理搞定了。换装系统却成了硬骨头。

outfit.ts 里有 12 处用 `inst.port` 拼接 HTTP URL：

```typescript
const url = `http://127.0.0.1:${port}/?f=${encodeFileRef(normPath(newPath))}`;
const newTex = new Texture(url, scene);
```

五个纹理 slot——diffuse、toon、sphere、bump、emissive——每个都走这条路。还有 HEAD 探测，用 HTTP HEAD 请求检查纹理文件是否存在。

全部改成 ArrayBuffer？改造面太大。纹理文件小，HTTP 开销可忽略。ADR-124 的决策是：保留 HTTP 作为 fallback，只改主路径。

但 outfit 的 HEAD 探测用 `ReadFileBytes` 太慢了——每探一个纹理都读整个文件，大纹理直接卡死。

于是有了 `FileExists`——一个只做 `os.Stat` 的轻量级检查：

```go
func (a *App) FileExists(path string) (bool, error) {
    _, err := os.Stat(path)
    if err == nil { return true, nil }
    if os.IsNotExist(err) { return false, nil }
    return false, err
}
```

探测用 `FileExists`，加载用 `readFileBytes`。两件事，两个函数。

**第三个坑：** 存在性检查和读取是两件事。用读全文件的方式检查文件是否存在，就像用消防水龙头浇花。

---

## 四、消失的音乐库

所有代码改完，测试全绿。1576/1577 通过。

用户重启 `wails dev`，打开音乐库——空的。

控制台没有任何报错。日志不触发。

排查了三轮。最后在 Go 终端里看到了真相：

```
category="audio" dir="C:\Users\ZHUJIE~1\AppData\Local\Temp\TestDownloadFromPlaza_SizeLimit3748633684\001\audio"
category="prop" dir="C:\Users\ZHUJIE~1\AppData\Local\Temp\TestDownloadFromPlaza_SizeLimit3748633684\001\prop"
```

`resource_root` 被污染了。广场下载时的临时目录路径被写进了配置文件。audio 和 prop 的扫描路径全部指向了不存在的地方。

"但 UI 上显示的是正确路径。" 桌面壳说。

外交官查了代码：

```typescript
const cfgRoot = cfg.resource_root || cfg.library_root || cfg.override_paths?.pmx || '';
```

UI 显示的是 `libraryRoot`——另一个字段。而扫描用的是 `resource_root`。两个字段，一个对，一个错。

"之前的 HTTP 路径为什么没出问题？" 桌面壳问。

"因为 `IsolateModelDir`。" 外交官说，"HTTP 路径通过 `IsolateModelDir` 做了安全隔离和路径解析，绕开了错误的 `resource_root`。你改成直读文件系统后，路径必须正确。绕过问题不等于解决问题，它只是把炸弹藏得更深。"

桌面壳把 `resource_root` 改回了正确路径。

**第四个坑：** HTTP 中转层隐藏了配置错误。移除中转层后，所有路径必须精确。

---

## 五、最后一层封装

base64 解码的问题解决了，但桌面壳看着代码皱起了眉。

六个文件里散落着同样的 `decodeBase64` 函数——三行 `atob`，三行循环。语义完全相同，位置各不相同。十八行重复代码，散布在六个文件里。

"这是重复。" 外交官说。

"我知道。"

桌面壳先把函数提到了 `fileservice.ts`——文件读取的统一入口。六个文件改为 `import { decodeBase64 } from '@/core/fileservice'`。

但它还是不满意。base64 解码是 Wails v3 的实现细节——是 `encoding/json` 序列化 `[]byte` 的副产品。消费者不应该知道这件事。

于是它在 `wails-bindings.ts` 里加了一层封装：

```typescript
import { ReadFileBytes as _ReadFileBytes } from '@bindings/mikumikuar/internal/app/app';

function _decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

export async function readFileBytes(path: string): Promise<Uint8Array | null> {
    const b64 = await _ReadFileBytes(path);
    return b64 ? _decodeBase64(b64) : null;
}
```

消费者只看到 `readFileBytes(path) → Uint8Array`。base64？不存在。`atob`？不存在。所有的解码逻辑被封装在 binding 层内部，像一条暗河——水在地下流，地面上只有干净的管道。

六个文件的 `ReadFileBytes` + `decodeBase64` 全部替换为 `readFileBytes`。测试 mock 也同步更新。

"这才是它应该有的样子。" 外交官说。

**第五个坑：** base64 是 Wails v3 的实现细节，不是消费者的契约。封装在 binding 层，消费者无感。

---

## 六、HTTP 的遗产

清理完所有诊断日志，跑完全部测试。

`resolveFileUrl` 和 `StartFileServer` 还在——作为 fallback，作为历史，作为曾经的解决方案。

`resolveModelDir` 诞生了——只拿目录路径，不启动 HTTP 服务器：

```typescript
export async function resolveModelDir(filePath: string): Promise<string> {
    const normalized = normPath(filePath);
    return IsolateModelDir(normalized);
}
```

从 HTTP 中转到 ArrayBuffer 直传，这条路走了三个 Phase，踩了五个坑，改了十二个文件。

桌面壳在新地图上画了一条从 HTTP 服务器通往 ArrayBuffer 的桥。桥的入口处写着 ADR-124 的标题。桥的另一端连着直读文件系统的平原。

"为什么我们要修这座桥？" 它问。

"因为 HTTP 是一条绕路。" 外交官说，"文件在磁盘上，我们却要先启动一个服务器，再从服务器上 fetch 回来。绕了一整圈，回到了原点。"

"但绕路有时候是安全的。"

"是的。所以桥没有拆掉旧路——`resolveFileUrl` 还在，`StartFileServer` 还在。它们是 fallback，是安全网。新路不通的时候，旧路还能走。"

桌面壳看着干净的 `model-loader.ts`——PMX 用 ArrayBuffer 直传，纹理通过 `referenceFiles` 从内存加载。没有 HTTP 请求，没有端口管理，没有 URL 编码。消费者调用 `readFileBytes`，拿到 `Uint8Array`，不知道也不需要知道背后有一个 base64 的故事。

"有时候，" 外交官在离开前说，"最安全的路不是最短的路。是那条把复杂性藏在地下的路——地面上只有干净的接口，地下埋着所有的补丁。"

---

> 联邦的文件管道终于从 HTTP 中转迁移到了 ArrayBuffer 直传。代价是五个坑、十二个文件、一整天的排查。但管道变短了——从磁盘到内存，一步到位。
>
> 而 HTTP 服务器还在那里，作为 fallback，作为安全网，作为联邦曾经的基础设施。它没有被拆除，只是被绕过了。就像旧城墙没有被拆掉——新的道路从它旁边经过，城墙上长满了青苔，但门还开着。
>
> base64 的故事也结束了。它曾经散布在六个文件里，像六个相同的补丁。现在它藏在 `wails-bindings.ts` 的暗河里，地面上只有 `readFileBytes` 一个干净的接口。消费者打开水龙头，水就来了——不需要知道水从哪来，经过了什么过滤。

*教训：绕过问题不等于解决问题。移除中间层后，所有路径必须精确——因为中间层曾经替你兜了底。而实现细节应该封装在边界层，消费者不应感知协议的副产品。*
