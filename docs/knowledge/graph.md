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
        c49["渲染层 DOM 契约单源"]
        c50["环境弹窗（编排 + barrel）"]
        c51["资源库操作"]
        c52["资源库核心"]
        c53["资源库初始化"]
        c54["资源库入口与编排"]
        c55["菜单 Overlay 与 Wrapper 管理"]
        c56["声明式菜单 Schema"]
        c57["菜单栈共享指针（stackRegistry）"]
        c58["滑出式菜单引擎（SlideMenu）"]
        c59["模型预设管理 UI"]
        c60["动作绑定 UI"]
        c61["动作详情 UI"]
        c62["动作菜单层级系统"]
        c63["广场状态管理"]
        c64["菜单渲染引擎"]
        c65["场景弹窗（编排 + 路由）"]
        c66["设置共享工具"]
        c67["设置页路由与编排"]
    end

    subgraph cat_core["核心基础设施"]
        c68["统一动作注册表 — 菜单/NL/快捷键共享真相源"]
        c69["AI 配置持久化（IndexedDB）"]
        c70["错误环形缓冲与全局捕获"]
        c71["NL 意图解析 — LLM 文本 → 动作执行"]
        c72["场景运行时快照（AI 上下文）"]
        c73["内置 AI 诊断助手 — 双适配器服务层"]
        c74["安卓文件访问（shared 模式）"]
        c75["音频总线"]
        c76["后端适配层"]
        c77["EnvState 单一源 Schema"]
        c78["事件处理与导航系统"]
        c79["结构化反馈 API"]
        c80["统一文件服务层"]
        c81["应用启动引导"]
        c82["统一资源加载队列"]
        c83["模型加载/库扫描完成后菜单刷新注册表"]
        c84["国际化语言状态"]
        c85["babylon-mmd 适配边界"]
        c86["轨道相机键盘输入状态叶子"]
        c87["渲染循环与 FPS 时钟"]
        c88["资源加载失败统一汇总"]
        c89["Runtime 隔离桥（Wails Events/Browser）"]
        c90["运行模式检测"]
        c91["快捷键注册表"]
        c92["全局状态与场景运行时 Store"]
        c93["键盘导航工具"]
        c94["后端绑定聚合层（backend 代理化）"]
    end

    subgraph cat_未分类["未分类"]
        c95["tier-review"]
    end

    subgraph adr_group["决策（ADR）"]
        a8["ADR-008"]
        a17["ADR-017"]
        a21["ADR-021"]
        a35["ADR-035"]
        a36["ADR-036"]
        a45["ADR-045"]
        a49["ADR-049"]
        a51["ADR-051"]
        a54["ADR-054"]
        a55["ADR-055"]
        a57["ADR-057"]
        a59["ADR-059"]
        a61["ADR-061"]
        a62["ADR-062"]
        a65["ADR-065"]
        a71["ADR-071"]
        a76["ADR-076"]
        a81["ADR-081"]
        a84["ADR-084"]
        a85["ADR-085"]
        a87["ADR-087"]
        a88["ADR-088"]
        a93["ADR-093"]
        a99["ADR-099"]
        a100["ADR-100"]
        a102["ADR-102"]
        a104["ADR-104"]
        a106["ADR-106"]
        a108["ADR-108"]
        a114["ADR-114"]
        a116["ADR-116"]
        a121["ADR-121"]
        a123["ADR-123"]
        a124["ADR-124"]
        a125["ADR-125"]
        a126["ADR-126"]
        a128["ADR-128"]
        a129["ADR-129"]
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
        a164["ADR-164"]
        a166["ADR-166"]
        a167["ADR-167"]
        a168["ADR-168"]
        a169["ADR-169"]
        a170["ADR-170"]
        a171["ADR-171"]
        a176["ADR-176"]
        a177["ADR-177"]
        a179["ADR-179"]
        a180["ADR-180"]
        a182["ADR-182"]
        a183["ADR-183"]
        a186["ADR-186"]
        a188["ADR-188"]
        a189["ADR-189"]
        a191["ADR-191"]
        a192["ADR-192"]
        a194["ADR-194"]
        a195["ADR-195"]
        a196["ADR-196"]
        a197["ADR-197"]
        a198["ADR-198"]
        a202["ADR-202"]
        a204["ADR-204"]
        a206["ADR-206"]
        a207["ADR-207"]
        a212["ADR-212"]
        a215["ADR-215"]
        a226["ADR-226"]
        a229["ADR-229"]
    end

    c68 --> a197;
    c68 --> a155;
    c69 --> a196;
    c70 --> a196;
    c71 --> a155;
    c71 --> a197;
    c72 --> a196;
    c73 --> a196;
    c73 --> a176;
    c74 --> a17;
    c74 --> a180;
    c74 --> a183;
    c74 --> a194;
    c34 --> a108;
    c12 --> a55;
    c13 --> a55;
    c75 --> a88;
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
    c76 --> a176;
    c76 --> a206;
    c49 --> a229;
    c0 --> a138;
    c0 --> a148;
    c1 --> a212;
    c2 --> a138;
    c3 --> a148;
    c3 --> a212;
    c4 --> a226;
    c5 --> a114;
    c6 --> a138;
    c6 --> a106;
    c7 --> a132;
    c50 --> a65;
    c50 --> a155;
    c8 --> a148;
    c8 --> a176;
    c77 --> a137;
    c77 --> a132;
    c9 --> a148;
    c10 --> a62;
    c11 --> a128;
    c78 --> a102;
    c78 --> a179;
    c80 --> a57;
    c28 --> a189;
    c81 --> a8;
    c81 --> a59;
    c81 --> a99;
    c81 --> a102;
    c81 --> a153;
    c81 --> a176;
    c81 --> a177;
    c81 --> a179;
    c81 --> a196;
    c51 --> a131;
    c51 --> a135;
    c51 --> a143;
    c51 --> a150;
    c51 --> a155;
    c51 --> a169;
    c51 --> a182;
    c51 --> a195;
    c52 --> a131;
    c52 --> a135;
    c52 --> a195;
    c53 --> a17;
    c53 --> a180;
    c53 --> a183;
    c54 --> a45;
    c29 --> a168;
    c30 --> a168;
    c31 --> a132;
    c31 --> a168;
    c31 --> a192;
    c37 --> a21;
    c82 --> a45;
    c82 --> a135;
    c84 --> a59;
    c16 --> a188;
    c55 --> a191;
    c56 --> a93;
    c57 --> a191;
    c58 --> a65;
    c58 --> a129;
    c85 --> a192;
    c85 --> a71;
    c17 --> a124;
    c17 --> a167;
    c17 --> a182;
    c17 --> a189;
    c18 --> a49;
    c18 --> a126;
    c18 --> a215;
    c19 --> a49;
    c19 --> a116;
    c19 --> a150;
    c19 --> a167;
    c19 --> a168;
    c59 --> a145;
    c60 --> a129;
    c60 --> a167;
    c61 --> a167;
    c61 --> a170;
    c38 --> a85;
    c39 --> a125;
    c40 --> a121;
    c40 --> a167;
    c62 --> a71;
    c41 --> a116;
    c41 --> a126;
    c42 --> a116;
    c42 --> a129;
    c42 --> a166;
    c43 --> a147;
    c43 --> a116;
    c44 --> a204;
    c86 --> a49;
    c45 --> a71;
    c45 --> a162;
    c45 --> a166;
    c32 --> a159;
    c25 --> a81;
    c63 --> a87;
    c46 --> a21;
    c87 --> a102;
    c64 --> a93;
    c33 --> a76;
    c33 --> a189;
    c89 --> a177;
    c90 --> a99;
    c90 --> a176;
    c65 --> a65;
    c65 --> a155;
    c20 --> a49;
    c20 --> a54;
    c20 --> a61;
    c20 --> a71;
    c20 --> a108;
    c20 --> a116;
    c20 --> a121;
    c20 --> a126;
    c20 --> a145;
    c20 --> a162;
    c20 --> a164;
    c20 --> a167;
    c20 --> a168;
    c20 --> a198;
    c20 --> a207;
    c20 --> a215;
    c21 --> a99;
    c21 --> a116;
    c21 --> a121;
    c21 --> a164;
    c21 --> a168;
    c21 --> a171;
    c21 --> a189;
    c21 --> a196;
    c21 --> a202;
    c66 --> a157;
    c67 --> a157;
    c91 --> a36;
    c92 --> a141;
    c92 --> a137;
    c22 --> a126;
    c22 --> a121;
    c24 --> a171;
    c93 --> a153;
    c26 --> a84;
    c26 --> a81;
    c47 --> a51;
    c48 --> a51;
    c94 --> a176;
    c27 --> a104;
    c27 --> a192;
    c27 --> a194;

    click a17 href "../adr/adr-017-android-adaptation.md"
    click a21 href "../adr/adr-021-procedural-motion.md"
    click a35 href "../adr/adr-035-settings-gap-analysis.md"
    click a36 href "../adr/adr-036-shortcut-registry.md"
    click a45 href "../adr/adr-045-unified-loading.md"
    click a49 href "../adr/adr-049-orbit-control-extension.md"
    click a51 href "../adr/adr-051-vmd-layers-bonefilter.md"
    click a54 href "../adr/adr-054-roadmap-next.md"
    click a55 href "../adr/adr-055-ar-camera-mode.md"
    click a57 href "../adr/adr-057-shift-jis-url-base64.md"
    click a59 href "../adr/adr-059-i18n-framework.md"
    click a61 href "../adr/adr-061-advanced-bone-systems.md"
    click a62 href "../adr/adr-062-water-reflection-render-target.md"
    click a65 href "../adr/adr-065-pure-items-hot-render.md"
    click a71 href "../adr/adr-071-proc-vs-perception-boundary.md"
    click a76 href "../adr/adr-076-cel-shading-postprocess-mode.md"
    click a81 href "../adr/adr-081-xpbd-removal.md"
    click a84 href "../adr/adr-084-mesh-to-cloth-virtual-skirt-bones.md"
    click a85 href "../adr/adr-085-feet-adjustment.md"
    click a87 href "../adr/adr-087-plaza-browser-experience.md"
    click a88 href "../adr/adr-088-audio-sfx-footstep.md"
    click a93 href "../adr/adr-093-menu-declarative-schema.md"
    click a99 href "../adr/adr-099-mpr-coop-coep-poc.md"
    click a100 href "../adr/adr-100-camera-control-behavior-dual-axis.md"
    click a102 href "../adr/adr-102-main-ts-split.md"
    click a104 href "../adr/adr-104-physics-outfit-design-debt-deferral.md"
    click a106 href "../adr/adr-106-timing-audit-and-async-lifecycle.md"
    click a108 href "../adr/adr-108-animation-retargeter.md"
    click a114 href "../adr/adr-114-ground-reflection-enhancement.md"
    click a116 href "../adr/adr-116-bone-override-ui-redesign.md"
    click a121 href "../adr/adr-121-global-motion-intent.md"
    click a123 href "../adr/adr-123-compute-override-semantics.md"
    click a124 href "../adr/adr-124-filesystem-architecture.md"
    click a125 href "../adr/adr-125-motion-undo-redo.md"
    click a126 href "../adr/adr-126-transform-adapter.md"
    click a128 href "../adr/adr-128-mirror-prop-rename.md"
    click a129 href "../adr/adr-129-scene-level-motion-ui.md"
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
    click a164 href "../adr/adr-164-perception-permodel-phase2.md"
    click a166 href "../adr/adr-166-perception-permodel-rework.md"
    click a167 href "../adr/adr-167-scene-motion-library.md"
    click a168 href "../adr/adr-168-dynamic-light-tracking.md"
    click a169 href "../adr/adr-169-motion-load-replace-default.md"
    click a170 href "../adr/adr-170-motion-selection-paradigm.md"
    click a171 href "../adr/adr-171-scene-drag-mode.md"
    click a176 href "../adr/adr-176-frontend-backend-adapter.md"
    click a177 href "../adr/adr-177-web-loader-main-app-unification.md"
    click a179 href "../adr/adr-179-update-install-launch-platform-tiered.md"
    click a180 href "../adr/adr-180-fsa-handle-persistence.md"
    click a182 href "../adr/adr-182-web-zip-keyspace-namespacing.md"
    click a183 href "../adr/adr-183-fsa-auth-guidance.md"
    click a186 href "../adr/adr-186-bone-override-frame-timing.md"
    click a188 href "../adr/adr-188-pbr-material-builder.md"
    click a189 href "../adr/adr-189-ktx2-texture-compression.md"
    click a191 href "../adr/adr-191-god-barrel-debarreling.md"
    click a192 href "../adr/adr-192-upstream-adapter-layer.md"
    click a194 href "../adr/adr-194-wind-physics-fix.md"
    click a195 href "../adr/adr-195-download-folder-unification.md"
    click a196 href "../adr/adr-196-llm-diagnostic-assistant.md"
    click a197 href "../adr/adr-197-unified-action-registry.md"
    click a198 href "../adr/adr-198-场景序列化异常的保存韧性.md"
    click a202 href "../adr/adr-202-fork-autonomy-batch.md"
    click a204 href "../adr/adr-204-unit-test-layering-and-hygiene.md"
    click a206 href "../adr/adr-206-test-infra-consolidation-and-assertion-quality.md"
    click a207 href "../adr/adr-207-motion-menu-restructure.md"
    click a212 href "../adr/adr-212-naming-vs-functionality-audit.md"
    click a215 href "../adr/adr-215-eliminate-prop-kind.md"
    click a226 href "../adr/adr-226-ground-material-spec-single-source.md"
    click a229 href "../adr/adr-229-e2e-automation-advancement.md"
```
