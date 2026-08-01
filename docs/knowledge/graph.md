<!-- 本文件由 scripts/gen-knowledge-graph.mjs 自动生成，请勿手改。重跑：npm run gen:knowgraph -->

# 知识卡关联图

> 机器生成的 Mermaid 图：**architecture 卡（按分类分组）→ 其引用的 ADR 决策**。leaf 卡（工具函数/桩/barrel）不画，见 [索引](./index.md) 折叠行。
> 全量卡片详情见 [知识卡索引](./index.md)；ADR 原文见 [决策记录索引](../adr/index.md)。
> 重新生成：`npm run gen:knowgraph`（分类子集：`npm run gen:knowgraph -- --category env`）。

```mermaid
graph TD;

    subgraph cat_env["环境系统"]
        c0["环境状态写入入口（setEnvState + 中间件链）"]
        c1["环境碰撞控制"]
        c2["环境变更分发回调（破循环依赖）"]
        c3["环境重力控制"]
        c4["地面材质单一事实源（GroundMaterialSpec）"]
        c5["地面系统"]
        c6["环境系统实现核心（barrel + observer + fog）"]
        c7["环境灯光包装"]
        c8["环境状态防抖持久化"]
        c9["时间流转与太阳角系统"]
        c10["水面系统"]
        c11["环境系统门面（Facade）"]
    end

    subgraph cat_scene["场景编排"]
        c12["AR 摄像头视频透传"]
        c13["AR 模式场景级协调"]
        c14["相机状态管理 + 运行时上下文"]
        c15["相机模式管理系统（MmdCamera）"]
        c16["分类材质系统"]
        c17["PMX 模型加载与缩略图捕获"]
        c18["模型注册表与生命周期管理"]
        c19["模型生命周期操作"]
        c20["场景序列化与自动保存"]
        c21["场景核心编排器（纯组装器）"]
        c22["变换适配器注册表（双模态去重）"]
        c23["拖拽变换模式开关"]
        c24["变换选中物状态源"]
    end

    subgraph cat_physics["物理系统"]
        c25["物理骨骼桥与每帧注册表"]
        c26["虚拟裙骨物理控制器（ADR-084 Phase 2-3）"]
        c27["风力物理注入（WASM Bullet）"]
    end

    subgraph cat_rendering["渲染系统"]
        c28["GPU 压缩纹理能力探测"]
        c29["个人灯光跟随"]
        c30["灯光预设系统"]
        c31["场景光照与阴影（barrel）"]
        c32["性能监控与自动降级"]
        c33["场景渲染管线与后处理"]
    end

    subgraph cat_motion["动作系统"]
        c34["外部动作重定向桥"]
        c35["骨骼覆盖存储（多模块仲裁）"]
        c36["骨骼覆盖核心 API"]
        c37["口型同步桥"]
        c38["脚部地面跟随（MMD-native IK）"]
        c39["动作历史管理"]
        c40["场景级动作意图库"]
        c41["动作模块基类"]
        c42["动作模块注册表"]
        c43["动作管线（逐帧合成）"]
        c44["动作播放控制"]
        c45["感知层主控"]
        c46["程序化动作系统"]
        c47["多 VMD 叠加系统"]
        c48["VMD 动作加载器"]
    end

    subgraph cat_ui["UI / 菜单"]
        c49["环境弹窗（编排 + barrel）"]
        c50["资源库操作"]
        c51["资源库核心"]
        c52["资源库初始化"]
        c53["资源库入口与编排"]
        c54["菜单 Overlay 与 Wrapper 管理"]
        c55["声明式菜单 Schema"]
        c56["菜单栈共享指针（stackRegistry）"]
        c57["滑出式菜单引擎（SlideMenu）"]
        c58["模型预设管理 UI"]
        c59["动作绑定 UI"]
        c60["动作详情 UI"]
        c61["动作菜单层级系统"]
        c62["广场状态管理"]
        c63["菜单渲染引擎"]
        c64["场景弹窗（编排 + 路由）"]
        c65["设置共享工具"]
        c66["设置页路由与编排"]
    end

    subgraph cat_core["核心基础设施"]
        c67["统一动作注册表 — 菜单/NL/快捷键共享真相源"]
        c68["AI 配置持久化（IndexedDB）"]
        c69["错误环形缓冲与全局捕获"]
        c70["NL 意图解析 — LLM 文本 → 动作执行"]
        c71["场景运行时快照（AI 上下文）"]
        c72["内置 AI 诊断助手 — 双适配器服务层"]
        c73["安卓文件访问（shared 模式）"]
        c74["音频总线"]
        c75["后端适配层"]
        c76["EnvState 单一源 Schema"]
        c77["事件处理与导航系统"]
        c78["结构化反馈 API"]
        c79["统一文件服务层"]
        c80["应用启动引导"]
        c81["统一资源加载队列"]
        c82["模型加载/库扫描完成后菜单刷新注册表"]
        c83["国际化语言状态"]
        c84["babylon-mmd 适配边界"]
        c85["轨道相机键盘输入状态叶子"]
        c86["渲染循环与 FPS 时钟"]
        c87["Runtime 隔离桥（Wails Events/Browser）"]
        c88["运行模式检测"]
        c89["快捷键注册表"]
        c90["全局状态与场景运行时 Store"]
        c91["键盘导航工具"]
        c92["后端绑定聚合层（backend 代理化）"]
    end

    subgraph cat_未分类["未分类"]
        c93["tier-review"]
    end

    subgraph adr_group["决策（ADR）"]
        a17["ADR-017"]
        a21["ADR-021"]
        a35["ADR-035"]
        a36["ADR-036"]
        a45["ADR-045"]
        a51["ADR-051"]
        a55["ADR-055"]
        a57["ADR-057"]
        a59["ADR-059"]
        a61["ADR-061"]
        a62["ADR-062"]
        a71["ADR-071"]
        a81["ADR-081"]
        a84["ADR-084"]
        a85["ADR-085"]
        a87["ADR-087"]
        a93["ADR-093"]
        a100["ADR-100"]
        a102["ADR-102"]
        a104["ADR-104"]
        a108["ADR-108"]
        a114["ADR-114"]
        a116["ADR-116"]
        a121["ADR-121"]
        a123["ADR-123"]
        a126["ADR-126"]
        a131["ADR-131"]
        a132["ADR-132"]
        a135["ADR-135"]
        a137["ADR-137"]
        a138["ADR-138"]
        a141["ADR-141"]
        a143["ADR-143"]
        a145["ADR-145"]
        a147["ADR-147"]
        a148["ADR-148"]
        a150["ADR-150"]
        a153["ADR-153"]
        a155["ADR-155"]
        a157["ADR-157"]
        a159["ADR-159"]
        a162["ADR-162"]
        a166["ADR-166"]
        a167["ADR-167"]
        a168["ADR-168"]
        a169["ADR-169"]
        a176["ADR-176"]
        a177["ADR-177"]
        a180["ADR-180"]
        a182["ADR-182"]
        a183["ADR-183"]
        a186["ADR-186"]
        a189["ADR-189"]
        a191["ADR-191"]
        a192["ADR-192"]
        a194["ADR-194"]
        a195["ADR-195"]
        a196["ADR-196"]
        a197["ADR-197"]
        a206["ADR-206"]
        a212["ADR-212"]
        a226["ADR-226"]
    end

    c67 --> a197;
    c67 --> a155;
    c68 --> a196;
    c69 --> a196;
    c70 --> a155;
    c70 --> a197;
    c71 --> a196;
    c72 --> a196;
    c72 --> a176;
    c73 --> a17;
    c73 --> a180;
    c73 --> a183;
    c73 --> a194;
    c34 --> a108;
    c12 --> a55;
    c13 --> a55;
    c35 --> a84;
    c36 --> a61;
    c36 --> a116;
    c36 --> a123;
    c36 --> a126;
    c36 --> a186;
    c14 --> a100;
    c14 --> a148;
    c15 --> a35;
    c15 --> a100;
    c15 --> a148;
    c75 --> a176;
    c75 --> a206;
    c0 --> a138;
    c0 --> a148;
    c1 --> a212;
    c2 --> a138;
    c3 --> a148;
    c3 --> a212;
    c4 --> a226;
    c5 --> a114;
    c8 --> a148;
    c8 --> a176;
    c76 --> a137;
    c76 --> a132;
    c9 --> a148;
    c10 --> a62;
    c79 --> a57;
    c28 --> a189;
    c50 --> a131;
    c50 --> a135;
    c50 --> a143;
    c50 --> a150;
    c50 --> a155;
    c50 --> a169;
    c50 --> a182;
    c50 --> a195;
    c29 --> a168;
    c37 --> a21;
    c81 --> a45;
    c81 --> a135;
    c83 --> a59;
    c54 --> a191;
    c55 --> a93;
    c56 --> a191;
    c84 --> a192;
    c84 --> a71;
    c58 --> a145;
    c38 --> a85;
    c40 --> a121;
    c40 --> a167;
    c61 --> a71;
    c41 --> a116;
    c41 --> a126;
    c43 --> a147;
    c43 --> a116;
    c45 --> a71;
    c45 --> a162;
    c45 --> a166;
    c32 --> a159;
    c25 --> a81;
    c62 --> a87;
    c46 --> a21;
    c86 --> a102;
    c63 --> a93;
    c87 --> a177;
    c65 --> a157;
    c66 --> a157;
    c89 --> a36;
    c90 --> a141;
    c90 --> a137;
    c22 --> a126;
    c22 --> a121;
    c91 --> a153;
    c26 --> a84;
    c26 --> a81;
    c47 --> a51;
    c48 --> a51;
    c92 --> a176;
    c27 --> a104;
    c27 --> a192;
    c27 --> a194;

    click a17 href "../adr/adr-017-android-adaptation.md"
    click a21 href "../adr/adr-021-procedural-motion.md"
    click a35 href "../adr/adr-035-settings-gap-analysis.md"
    click a36 href "../adr/adr-036-shortcut-registry.md"
    click a45 href "../adr/adr-045-unified-loading.md"
    click a51 href "../adr/adr-051-vmd-layers-bonefilter.md"
    click a55 href "../adr/adr-055-ar-camera-mode.md"
    click a57 href "../adr/adr-057-shift-jis-url-base64.md"
    click a59 href "../adr/adr-059-i18n-framework.md"
    click a61 href "../adr/adr-061-advanced-bone-systems.md"
    click a62 href "../adr/adr-062-water-reflection-render-target.md"
    click a71 href "../adr/adr-071-proc-vs-perception-boundary.md"
    click a81 href "../adr/adr-081-xpbd-removal.md"
    click a84 href "../adr/adr-084-mesh-to-cloth-virtual-skirt-bones.md"
    click a85 href "../adr/adr-085-feet-adjustment.md"
    click a87 href "../adr/adr-087-plaza-browser-experience.md"
    click a93 href "../adr/adr-093-menu-declarative-schema.md"
    click a100 href "../adr/adr-100-camera-control-behavior-dual-axis.md"
    click a102 href "../adr/adr-102-main-ts-split.md"
    click a104 href "../adr/adr-104-physics-outfit-design-debt-deferral.md"
    click a108 href "../adr/adr-108-animation-retargeter.md"
    click a114 href "../adr/adr-114-ground-reflection-enhancement.md"
    click a116 href "../adr/adr-116-bone-override-ui-redesign.md"
    click a121 href "../adr/adr-121-global-motion-intent.md"
    click a123 href "../adr/adr-123-compute-override-semantics.md"
    click a126 href "../adr/adr-126-transform-adapter.md"
    click a131 href "../adr/adr-131-resource-browse-selection-outcome.md"
    click a132 href "../adr/adr-132-env-brightness-unification.md"
    click a135 href "../adr/adr-135-library-session-store.md"
    click a137 href "../adr/adr-137-envstate-single-source-schema.md"
    click a138 href "../adr/adr-138-env-dispatcher-decouple.md"
    click a141 href "../adr/adr-141-state-split.md"
    click a143 href "../adr/adr-143-unification-remaining.md"
    click a145 href "../adr/adr-145-motion-presets.md"
    click a147 href "../adr/adr-147-explicit-motion-pipeline-scheduler.md"
    click a148 href "../adr/adr-148-overload-file-split.md"
    click a150 href "../adr/adr-150-model-replace-contract.md"
    click a153 href "../adr/adr-153-accessibility-roadmap.md"
    click a155 href "../adr/adr-155-llm-nl-scene-control-route.md"
    click a157 href "../adr/adr-157-settings-ia-restructure.md"
    click a159 href "../adr/adr-159-render-dedup-and-refactor.md"
    click a162 href "../adr/adr-162-perception-permodel-phase1.md"
    click a166 href "../adr/adr-166-perception-permodel-rework.md"
    click a167 href "../adr/adr-167-scene-motion-library.md"
    click a168 href "../adr/adr-168-dynamic-light-tracking.md"
    click a169 href "../adr/adr-169-motion-load-replace-default.md"
    click a176 href "../adr/adr-176-frontend-backend-adapter.md"
    click a177 href "../adr/adr-177-web-loader-main-app-unification.md"
    click a180 href "../adr/adr-180-fsa-handle-persistence.md"
    click a182 href "../adr/adr-182-web-zip-keyspace-namespacing.md"
    click a183 href "../adr/adr-183-fsa-auth-guidance.md"
    click a186 href "../adr/adr-186-bone-override-frame-timing.md"
    click a189 href "../adr/adr-189-ktx2-texture-compression.md"
    click a191 href "../adr/adr-191-god-barrel-debarreling.md"
    click a192 href "../adr/adr-192-upstream-adapter-layer.md"
    click a194 href "../adr/adr-194-wind-physics-fix.md"
    click a195 href "../adr/adr-195-download-folder-unification.md"
    click a196 href "../adr/adr-196-llm-diagnostic-assistant.md"
    click a197 href "../adr/adr-197-unified-action-registry.md"
    click a206 href "../adr/adr-206-test-infra-consolidation-and-assertion-quality.md"
    click a212 href "../adr/adr-212-naming-vs-functionality-audit.md"
    click a226 href "../adr/adr-226-ground-material-spec-single-source.md"
```
