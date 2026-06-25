目录结构很规整。在 dancexr/，各语言镜像在对应前缀下，结构完全一致：

dancexr-zh/                          ← 从这里搬
├── features.md                   ← 功能总索引（Markdown 表格 + YAML 分类）
├── features/
│   ├── accessory.md             ← 每个功能一个 .md（+ 同名 .json 配置快照）
│   ├── ai_chat.md
│   ├── cloth_simulation.md
│   ├── motion_override.md
│   ├── sex_motion_3.md
│   └── ...（共 ~120 个 .md）
├── releases/
│   ├── 2026.6.md                ← 每月发布说明
│   ├── 2026.5.md
│   ├── 2026.4.md
│   └── ...（共 ~42 个版本）
├── releases.md                  ← 发布索引
├── actors.md / motion.md / physics.md / appearance.md / cameras.md  ← 分类 Hub 页
├── home.md / download.md / support.md / faq.md / concepts.md / controls.md
├── ai.md / ai-index.md / creator.md / play.md / getting-started.md
├── preparecontent.md / content_android_quest.md / vr_operations.md
└── web/                         ← Unity WebGL 构建（不是文档）

功能分类还挺清晰的，整个文档站把 DanceXR 的功能分成了 10 个大类：

1. ✨ New and Noteworthy — 最新亮点
Discovery 资源发现 App、Operator AI 后端、AI 语音聊天、离线渲染录制

2. 🤖 AI Features — AI 功能
Operator 本地 AI + AI Voice Chat（不需要云）

3. 📦 Model Support — 模型支持
内容与加载：标签系统、角色选项、播放列表、编队、ZIP 格式
格式细节：Bone Mapper、PMX 物理、Blendshape Morph、面部控制
角色工具：菜单工具、全局控制、附加到角色、脚部调整、缩放偏移、预设
4. 🎨 Appearance — 外观
穿衣系统：换装/Optionals、Alternative Textures、Outfit/Bodypaint、配饰
材质：全局材质、卡通着色、皮肤/头发/眼睛/嘴唇/不透明/透明材质、自定义材质、纹理增强、汗液效果、法线贴图等
5. ⚡ Physics — 物理
模拟：布料模拟、Mesh to Cloth、粒子动力学、软体物理、布娃娃、Light Ball
物理工具：Body Colliders、头发/摆动物品/裙子/胸部物理、软体物理、分离对象
6. 💃 Motion & Media — 动作与媒体
程序化动作：Idle Motion、Free Pose、Catwalk、Auto Dance 1/2/3
角色行为：眨眼/呼吸/眼神、Lifelike Motions
音频视频：音频设置、空间音频、LipSync、视频播放器、音乐节拍
动作文件：Dance Set、播放选项、动作分配、Pose 文件、VMD2PNG、Remix、Motion Override、关键帧动画
7. 🌍 Atmosphere & Environment — 大气与环境
天空与光照：Sky/Cloud、光照系统
环境与特效：粒子效果、水体系统、AR 模式、水的交互
舞台与道具：地面、房间舞台、场景、道具、基本体、屏幕、镜子、Laser、Beats Ring
场景与渲染：保存/打包场景、光线追踪
8. 🎥 Cinematic Camera — 电影级镜头
六种模式：Freefly、Auto、Orbit、One-shot、First Person、Concert（固定机位）

9. ⚙️ System & Platform — 系统与平台
参考：概念术语、操作/UI、VR 操作
系统：内容库、Google Drive、Android/Quest 库、语言、系统物理、自动更新、预设、远程控制、应用/输入/录制设置
图形与显示：VR 设置、显示设置、Graphics、HDR
10. 🔞 Adult Lane — 成人内容
Boob Shake、Sex Overlay、Dildo、及多种 Sex Motion（独立分区，标注 NSFW）
