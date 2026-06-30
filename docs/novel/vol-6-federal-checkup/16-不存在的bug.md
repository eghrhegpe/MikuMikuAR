# 第 16 章 · 不存在的 bug

> 对应真实事件：2026-07-01 beforeunload 状态持久化验证。审计清单里以为状态持久化有遗漏，实际查证后发现 scene-serialize.ts 已实现 `visibilitychange` + `beforeunload` 双保险，且 `serializeScene` 完整包含 `envState`、模型状态等。无需修改，仅记录验证结果。
>
> 相关代码：[scene-serialize.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-serialize.ts)

---

审计清单里有一项：

> **中优 #9**: beforeunload 状态持久化可能不完整——验证场景自动保存是否覆盖 envState、材质启用状态等新增字段。

"听起来像个 bug，"AI 同行者说，"自动保存可能漏了东西。"

"先别急着改，"外交官说，"审计清单是审计的时候列的。审计的时候可能没仔细看实现。先查。"

"查什么？"

"查 scene-serialize.ts，"外交官说，"看看 serializeScene 都存了什么，beforeunload 触发的自动保存是不是完整。"

---

## 侦探工作

外交官打开 scene-serialize.ts，像个侦探一样开始翻找。

先找自动保存的触发点：

```typescript
// 自动保存触发点
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        saveAutosave();
    }
});

window.addEventListener('beforeunload', () => {
    saveAutosave();
});
```

"两个触发点，"外交官点点头，"visibilitychange 和 beforeunload。双保险。"

"为什么要两个？"

"beforeunload 有时候不可靠，"外交官解释，"移动端切后台的时候，beforeunload 不一定触发——系统可能直接把进程杀了。visibilitychange 更靠谱——页面一隐藏就存。两个都有，双保险。"

"不错啊。"

"不错，"外交官继续往下翻，"再看 serializeScene 存了什么。"

---

## 存了什么

`serializeScene` 的返回类型：

```typescript
export interface SceneState {
    version: number;
    timestamp: number;
    models: ModelState[];
    envState?: EnvState;
    lightingState?: LightingState;
    cameraState?: CameraState;
    playbackState?: PlaybackState;
}
```

"envState 有了，lightingState 有了，cameraState 有了，playbackState 有了。"外交官一个个数。

再看 ModelState：

```typescript
interface ModelState {
    id: string;
    path: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
    visible: boolean;
    materialState?: MaterialState;
    vmdPaths?: string[];
    // ...
}
```

"materialState 也有了。那材质启用状态呢？"AI 问。

"材质启用状态在 materialState 里面——我们前几天刚加的 materialEnabled，"外交官翻了翻 scene-material.ts，"getMatState 返回的对象里有 enabled 字段，serialize 的时候会一起存进去。"

"那 envState 全吗？比如天空参数、地面参数、粒子参数……"

"全，"外交官打开 env-lighting.ts 里的 EnvState 定义，"天空、地面、雾、云、水、粒子、风——都有。"

他合上文件：

"审计清单里的担心是多余的。该存的都存了。"

---

## 为什么审计会提

"那审计的时候为什么会把它列进清单？"AI 问。

"因为不确定，"外交官说，"审计的时候，不可能把每一个函数的实现都仔细看一遍。有些项是'看起来可能有问题，需要验证'——不是确认的 bug，是待验证的疑点。"

"就像体检报告上的'建议进一步检查'。"

"对，就是这个意思，"外交官笑了，"审计清单里的条目，不一定都是真的 bug。有的是真问题，有的是疑似问题，有的是'最好确认一下'。"

"那确认了没问题怎么办？"

"勾掉，"外交官说，"在 checklist 里打个勾，写一句'已验证，无需修改'。然后该干嘛干嘛。"

"不用改代码？"

"不用改，"外交官确认，"发现没有问题，也是一种成果。至少排除了一个疑点，心里踏实了。"

---

## 双保险的设计

"不过既然来了，"外交官说，"我们顺便看看这个双保险的设计好不好。"

"哪双保险？"

"visibilitychange + beforeunload，"外交官指着那两段代码，"为什么两个都要？一个不够吗？"

"不够，"AI 想了想，"beforeunload 在移动端不可靠，visibilitychange 在桌面端切窗口也会触发——但用户可能只是切出去看个微信，马上就切回来。这时候也存吗？"

"也存，"外交官说，"存一下又没坏处。自动保存本来就是'多存几次总没错'的事。存多了不会出问题，存少了才会出问题。"

"那会不会存得太频繁了？"

"不会，"外交官摇头，"serializeScene 很快——就是把几个状态对象拼起来，JSON 序列化一下。几毫秒的事。而且 localStorage 的写入也很快。哪怕用户切出去十次，存十次，也没什么影响。"

"宁滥勿缺。"

"宁滥勿缺，"外交官点头，"自动保存的第一原则就是——多存无害，少存要命。用户最崩溃的时刻，就是做了半小时的东西，软件崩了，打开发现只存了 10 分钟前的。"

---

## 版本号的意义

"还有一个细节，"外交官指着 SceneState 里的 `version` 字段，"你看这个。"

"版本号？"

"版本号，"外交官说，"每次序列化格式变了，版本号就加一。反序列化的时候，先读版本号，根据版本号走不同的解析逻辑。"

"有什么用？"

"向前兼容，"外交官解释，"假设现在版本是 3。用户用新版本存了一个场景，然后降级回旧版本——旧版本读到版本号 3，发现自己不认识，就可以提示'此场景由新版本创建，无法加载'。而不是默默地加载出错。"

"那新版本读旧版本呢？"

"新版本认识所有旧版本，"外交官说，"版本 1 有哪些字段，版本 2 加了哪些，版本 3 又加了哪些——新版本都知道。读的时候，缺的字段用默认值补上。"

"向后兼容。"

"对，向后兼容，"外交官说，"版本号是序列化系统的安全带。没有版本号的序列化，就是裸奔——格式一变，旧数据全废。"

---

## 虚惊一场

第八颗黄石子，外交官在旁边画了个圈，打了个勾。

"这颗不用改？"AI 问。

"不用改，"外交官说，"但也不是白查。至少我们确认了——自动保存是靠谱的。双保险、全字段、有版本号。设计得不错。"

"那也算完成了？"

"算，"外交官点头，"审计的目的不是为了找出 48 个 bug，是为了让系统更可靠。确认没有问题，和修复问题一样重要。"

他把那颗石子翻了个面——正面写着"待验证"，反面写着"已验证，无需修改"。

虚惊一场。
但虚惊一场，是世界上最好的结局之一。

---

## 附录：自动保存系统设计检查清单

| 检查项 | 说明 | 本项目状态 |
|--------|------|-----------|
| **触发时机** | beforeunload + visibilitychange 双保险 | ✅ 已有 |
| **保存频率** | 不能太频繁（IO 压力），也不能太稀疏（丢数据） | ✅ 事件触发，非定时 |
| **数据完整性** | 所有场景状态都要存，不能漏 | ✅ 已验证完整 |
| **版本号** | 序列化格式要有版本号，兼容旧数据 | ✅ 已有 |
| **错误处理** | 保存失败（如 localStorage 满了）要提示用户 | ⚠️ 待验证 |
| **多槽位** | 保留最近 N 个自动保存，避免最新的就是坏的 | ⚠️ 待验证 |

---

*教训：审计清单里的条目不一定都是真 bug。有的是"疑似问题，需要验证"。验证了没问题，也是成果。至少排除了一个疑点，心里踏实了。而且验证的过程中，你还能顺便学习一下现有代码的设计——比如双保险、版本号，这些都是好东西。*
