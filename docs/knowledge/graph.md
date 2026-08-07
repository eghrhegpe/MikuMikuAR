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
        c16["脚部落地检测降级"]
        c17["分类材质系统"]
        c18["PMX 模型加载与缩略图捕获"]
        c19["模型注册表与生命周期管理"]
        c20["模型生命周期操作"]
        c21["换装叠加层"]
        c22["换装系统"]
        c23["场景序列化与自动保存"]
        c24["场景核心编排器（纯组装器）"]
        c25["SSS PBR 材质"]
        c26["变换适配器注册表（双模态去重）"]
        c27["拖拽变换模式开关"]
        c28["变换选中物状态源"]
    end

    subgraph cat_physics["物理系统"]
        c29["物理骨骼桥与每帧注册表"]
        c30["虚拟裙骨物理控制器（ADR-084 Phase 2-3）"]
        c31["风力物理注入（WASM Bullet）"]
    end

    subgraph cat_rendering["渲染系统"]
        c32["GPU 压缩纹理能力探测"]
        c33["个人灯光跟随"]
        c34["灯光预设系统"]
        c35["场景光照与阴影（barrel）"]
        c36["性能监控与自动降级"]
        c37["场景渲染管线与后处理"]
    end

    subgraph cat_motion["动作系统"]
        c38["外部动作重定向桥"]
        c39["骨骼覆盖存储（多模块仲裁）"]
        c40["骨骼覆盖核心 API"]
        c41["口型同步桥"]
        c42["脚部地面跟随（MMD-native IK）"]
        c43["动作历史管理"]
        c44["场景级动作意图库"]
        c45["动作模块基类"]
        c46["动作模块注册表"]
        c47["动作管线（逐帧合成）"]
        c48["动作播放控制"]
        c49["感知层主控"]
        c50["程序化动作系统"]
        c51["多 VMD 叠加系统"]
        c52["VMD 动作加载器"]
    end

    subgraph cat_ui["UI / 菜单"]
        c53["渲染层 DOM 契约单源"]
        c54["环境弹窗（编排 + barrel）"]
        c55["资源库操作"]
        c56["资源库核心"]
        c57["资源库初始化"]
        c58["资源库入口与编排"]
        c59["菜单 Overlay 与 Wrapper 管理"]
        c60["声明式菜单 Schema"]
        c61["菜单栈共享指针（stackRegistry）"]
        c62["滑出式菜单引擎（SlideMenu）"]
        c63["模型预设管理 UI"]
        c64["动作绑定 UI"]
        c65["动作详情 UI"]
        c66["动作菜单层级系统"]
        c67["广场状态管理"]
        c68["菜单渲染引擎"]
        c69["场景弹窗（编排 + 路由）"]
        c70["设置共享工具"]
        c71["设置页路由与编排"]
        c72["基础行控件构建器"]
    end

    subgraph cat_core["核心基础设施"]
        c73["统一动作注册表 — 菜单/NL/快捷键共享真相源"]
        c74["AI 配置持久化（IndexedDB）"]
        c75["错误环形缓冲与全局捕获"]
        c76["NL 意图解析 — LLM 文本 → 动作执行"]
        c77["场景运行时快照（AI 上下文）"]
        c78["内置 AI 诊断助手 — 双适配器服务层"]
        c79["安卓文件访问（shared 模式）"]
        c80["音频总线"]
        c81["后端适配层"]
        c82["EnvState 默认值派生"]
        c83["EnvState 单一源 Schema"]
        c84["事件处理与导航系统"]
        c85["结构化反馈 API"]
        c86["统一文件服务层"]
        c87["应用启动引导"]
        c88["统一资源加载队列"]
        c89["模型加载/库扫描完成后菜单刷新注册表"]
        c90["国际化语言状态"]
        c91["babylon-mmd 适配边界"]
        c92["轨道相机键盘输入状态叶子"]
        c93["渲染循环与 FPS 时钟"]
        c94["资源加载失败统一汇总"]
        c95["Runtime 隔离桥（Wails Events/Browser）"]
        c96["运行模式检测"]
        c97["快捷键注册表"]
        c98["全局状态与场景运行时 Store"]
        c99["键盘导航工具"]
        c100["后端绑定聚合层（backend 代理化）"]
    end

    subgraph cat_backend["后端"]
        c101["Go 后端核心（App 生命周期 + 配置系统）"]
        c102["Go 文件与路径平台抽象"]
        c103["Go 模型隔离与安全 HTTP"]
        c104["Go 软件集成（Blender/MMD/自定义）"]
        c105["Go KTX2 纹理编码"]
        c106["Go 模型库扫描"]
        c107["Go LLM 客户端与 AI 绑定"]
        c108["Go 广场窗口与配置"]
        c109["Go 预设持久化与标签"]
        c110["Go 模型广场代理（SSRF 防护）"]
        c111["Go 场景序列化与打包"]
        c112["Go 更新检查与安装"]
        c113["Go 下载目录监听与导入"]
        c114["Go ZIP 解压与缓存管理"]
    end

    subgraph adr_group["决策（ADR）"]
        a3["ADR-003"]
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
        a96["ADR-096"]
        a99["ADR-099"]
        a100["ADR-100"]
        a102["ADR-102"]
        a104["ADR-104"]
        a106["ADR-106"]
        a108["ADR-108"]
        a114["ADR-114"]
        a116["ADR-116"]
        a120["ADR-120"]
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
        a136["ADR-136"]
        a137["ADR-137"]
        a138["ADR-138"]
        a140["ADR-140"]
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
        a173["ADR-173"]
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
        a237["ADR-237"]
        a238["ADR-238"]
        a242["ADR-242"]
        a243["ADR-243"]
    end

    c73 --> a197;
    c73 --> a155;
    c74 --> a196;
    c75 --> a196;
    c76 --> a155;
    c76 --> a197;
    c77 --> a196;
    c78 --> a196;
    c78 --> a176;
    c79 --> a17;
    c79 --> a180;
    c79 --> a183;
    c79 --> a194;
    c38 --> a108;
    c12 --> a55;
    c13 --> a55;
    c80 --> a88;
    c39 --> a84;
    c40 --> a61;
    c40 --> a116;
    c40 --> a123;
    c40 --> a126;
    c40 --> a186;
    c14 --> a100;
    c14 --> a148;
    c15 --> a35;
    c15 --> a100;
    c15 --> a148;
    c81 --> a176;
    c81 --> a206;
    c53 --> a229;
    c0 --> a138;
    c0 --> a148;
    c1 --> a212;
    c2 --> a138;
    c3 --> a148;
    c3 --> a212;
    c4 --> a226;
    c5 --> a114;
    c5 --> a226;
    c6 --> a138;
    c6 --> a106;
    c7 --> a132;
    c54 --> a65;
    c54 --> a155;
    c8 --> a148;
    c8 --> a176;
    c82 --> a243;
    c83 --> a137;
    c83 --> a132;
    c9 --> a148;
    c9 --> a120;
    c9 --> a173;
    c9 --> a176;
    c9 --> a204;
    c9 --> a238;
    c10 --> a62;
    c11 --> a128;
    c84 --> a102;
    c84 --> a179;
    c86 --> a57;
    c16 --> a88;
    c32 --> a189;
    c87 --> a3;
    c87 --> a59;
    c87 --> a99;
    c87 --> a102;
    c87 --> a153;
    c87 --> a176;
    c87 --> a177;
    c87 --> a179;
    c87 --> a196;
    c55 --> a131;
    c55 --> a135;
    c55 --> a143;
    c55 --> a150;
    c55 --> a155;
    c55 --> a169;
    c55 --> a182;
    c55 --> a195;
    c56 --> a131;
    c56 --> a135;
    c56 --> a136;
    c56 --> a195;
    c56 --> a238;
    c57 --> a17;
    c57 --> a180;
    c57 --> a183;
    c58 --> a45;
    c33 --> a168;
    c34 --> a168;
    c35 --> a132;
    c35 --> a168;
    c35 --> a192;
    c41 --> a21;
    c88 --> a45;
    c88 --> a135;
    c90 --> a59;
    c17 --> a188;
    c59 --> a191;
    c60 --> a93;
    c61 --> a191;
    c62 --> a65;
    c62 --> a129;
    c91 --> a192;
    c91 --> a71;
    c18 --> a124;
    c18 --> a167;
    c18 --> a182;
    c18 --> a189;
    c19 --> a49;
    c19 --> a126;
    c19 --> a215;
    c20 --> a49;
    c20 --> a116;
    c20 --> a150;
    c20 --> a167;
    c20 --> a168;
    c63 --> a145;
    c64 --> a129;
    c64 --> a167;
    c65 --> a167;
    c65 --> a170;
    c42 --> a85;
    c42 --> a88;
    c42 --> a202;
    c42 --> a238;
    c43 --> a125;
    c44 --> a121;
    c44 --> a167;
    c66 --> a71;
    c45 --> a116;
    c45 --> a126;
    c46 --> a116;
    c46 --> a129;
    c46 --> a166;
    c47 --> a147;
    c47 --> a116;
    c48 --> a204;
    c92 --> a49;
    c21 --> a242;
    c22 --> a242;
    c49 --> a71;
    c49 --> a162;
    c49 --> a166;
    c36 --> a159;
    c29 --> a81;
    c67 --> a87;
    c50 --> a21;
    c50 --> a237;
    c93 --> a102;
    c68 --> a93;
    c37 --> a76;
    c37 --> a189;
    c95 --> a177;
    c96 --> a99;
    c96 --> a176;
    c69 --> a65;
    c69 --> a155;
    c23 --> a49;
    c23 --> a54;
    c23 --> a61;
    c23 --> a71;
    c23 --> a108;
    c23 --> a116;
    c23 --> a121;
    c23 --> a126;
    c23 --> a145;
    c23 --> a162;
    c23 --> a164;
    c23 --> a167;
    c23 --> a168;
    c23 --> a198;
    c23 --> a207;
    c23 --> a215;
    c24 --> a99;
    c24 --> a116;
    c24 --> a121;
    c24 --> a164;
    c24 --> a168;
    c24 --> a171;
    c24 --> a189;
    c24 --> a196;
    c24 --> a202;
    c70 --> a157;
    c70 --> a204;
    c70 --> a238;
    c71 --> a157;
    c97 --> a36;
    c98 --> a141;
    c98 --> a137;
    c26 --> a126;
    c26 --> a121;
    c28 --> a171;
    c99 --> a153;
    c72 --> a140;
    c72 --> a191;
    c72 --> a173;
    c30 --> a84;
    c30 --> a81;
    c51 --> a51;
    c51 --> a237;
    c52 --> a51;
    c52 --> a57;
    c52 --> a96;
    c52 --> a167;
    c52 --> a169;
    c52 --> a192;
    c52 --> a238;
    c100 --> a176;
    c31 --> a104;
    c31 --> a192;
    c31 --> a194;

    click a3 href "../adr/adr-003-download-strategy.md"
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
    click a96 href "../adr/adr-096-general-helper-consolidation.md"
    click a99 href "../adr/adr-099-mpr-coop-coep-poc.md"
    click a100 href "../adr/adr-100-camera-control-behavior-dual-axis.md"
    click a102 href "../adr/adr-102-main-ts-split.md"
    click a104 href "../adr/adr-104-physics-outfit-design-debt-deferral.md"
    click a106 href "../adr/adr-106-timing-audit-and-async-lifecycle.md"
    click a108 href "../adr/adr-108-animation-retargeter.md"
    click a114 href "../adr/adr-114-ground-reflection-enhancement.md"
    click a116 href "../adr/adr-116-bone-override-ui-redesign.md"
    click a120 href "../adr/adr-120-env-preset-categorized.md"
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
    click a136 href "../adr/adr-136-thumbnail-abortsignal.md"
    click a137 href "../adr/adr-137-envstate-single-source-schema.md"
    click a138 href "../adr/adr-138-env-dispatcher-decouple.md"
    click a140 href "../adr/adr-140-drag-slider-controller.md"
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
    click a173 href "../adr/adr-173-env-bridge-middleware.md"
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
    click a237 href "../adr/adr-237-split-overlong-modules.md"
    click a238 href "../adr/adr-238-循环依赖消解二期-core-scene-根环.md"
    click a242 href "../adr/adr-242-toplevel-layering-axiom.md"
    click a243 href "../adr/adr-243-env-state-defaults-from-schema.md"
```
