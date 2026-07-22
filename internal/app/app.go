package app

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	stdruntime "runtime"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v3/pkg/application"

	"mikumikuar/internal/dialogs"
)

// isAndroid returns true when running on Android (GOOS=android).
var isAndroid = stdruntime.GOOS == "android"

// safeLogInfo logs info message if wailsApp is available.
func (a *App) safeLogInfo(format string, args ...interface{}) {
	if a.wailsApp != nil {
		slog.Info(fmt.Sprintf(format, args...))
	}
}

// safeLogWarning logs warning message if wailsApp is available.
func (a *App) safeLogWarning(format string, args ...interface{}) {
	if a.wailsApp != nil {
		slog.Warn(fmt.Sprintf(format, args...))
	}
}

// safeLogError logs error message if wailsApp is available.
func (a *App) safeLogError(format string, args ...interface{}) {
	if a.wailsApp != nil {
		slog.Error(fmt.Sprintf(format, args...))
	}
}

// App struct
type App struct {
	wailsApp    *application.App
	appVersion  string                     // injected via -ldflags at build time
	buildTime   string                     // injected via -ldflags at build time
	commitHash  string                     // injected via -ldflags at build time
	httpServers map[string]*httpServerInfo // keyed by dirPath
	httpSrvMu   sync.Mutex
	configMu    sync.RWMutex // guards GetConfig/writeConfig sequences
	cachedCfg   *Config      // in-memory cache, invalidated by writeConfig

	// 下载目录监听
	watcher      *fsnotify.Watcher
	watchDir     string // 当前监听的目录
	watchMu      sync.Mutex
	watchTimer   *time.Timer         // debounce 定时器
	watchPending map[string]struct{} // debounce 期间暂存的文件路径

	// 模型广场预热窗口（ADR-075 §预热单实例）
	// App 启动时创建隐藏 WebView2 窗口，用户点击站点时 Show + SetURL，
	// 避免 NewWithOptions 的 WebView2 冷启动（1–3s → 200ms）。
	plazaWin             *application.WebviewWindow
	plazaWinMu           sync.Mutex
	plazaWinCloseHook    func()       // RegisterHook 返回的 unregister 函数，用于 ServiceShutdown 前置移除
	lastPlazaNavReport   time.Time // [ADR-087 P3] debounce 300ms
}

type httpServerInfo struct {
	server   *http.Server
	port     int
	dir      string
	listener net.Listener
}

// NewApp creates a new App application struct
func NewApp(version, buildTime, commitHash string) *App {
	return &App{
		appVersion:  version,
		buildTime:   buildTime,
		commitHash:  commitHash,
		httpServers: make(map[string]*httpServerInfo),
	}
}

// GetAppVersion returns the application version (injected via -ldflags at build time).
func (a *App) GetAppVersion() string {
	return a.appVersion
}

// BuildInfo holds build-time diagnostics for the "About" page.
type BuildInfo struct {
	Version    string `json:"version"`
	BuildTime  string `json:"buildTime"`
	CommitHash string `json:"commitHash"`
	GoVersion  string `json:"goVersion"`
}

// GetBuildInfo returns build-time diagnostics (version + build time + commit + Go version).
func (a *App) GetBuildInfo() *BuildInfo {
	return &BuildInfo{
		Version:    a.appVersion,
		BuildTime:  a.buildTime,
		CommitHash: a.commitHash,
		GoVersion:  stdruntime.Version(),
	}
}

// ServiceStartup implements application.ServiceStartup interface.
func (a *App) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	// Restore download directory watching from saved config
	if err := a.restoreWatcher(); err != nil {
		a.safeLogWarning("ServiceStartup: 恢复目录监听失败: %v", err)
	}
	// Auto-clean orphaned extraction cache (source zip gone) in background
	go func() {
		if cleaned, err := a.CleanOrphanCache(); err == nil && cleaned > 0 {
			a.safeLogInfo("ServiceStartup: auto-cleaned %d orphan cache dirs", cleaned)
		}
	}()
	// Clean up legacy serve isolation directory — no longer used (see ADR-005).
	// Previously isolateDir copied model files here; now IsolateModelDir returns
	// the original directory directly. Remove accumulated data to free disk space.
	go func() {
		dir, err := serveRootDir()
		if err != nil {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) == 0 {
			return
		}
		if err := os.RemoveAll(dir); err == nil {
			a.safeLogInfo("ServiceStartup: removed legacy serve directory (%s)", dir)
		}
	}()
	return nil
}

// ServiceShutdown implements application.ServiceShutdown interface.
func (a *App) SetWailsApp(wailsApp *application.App) {
	a.wailsApp = wailsApp
	a.prewarmPlazaWindow()
}

func (a *App) ServiceShutdown() error {
	a.watchMu.Lock()
	if a.watcher != nil {
		a.watcher.Close()
		a.watcher = nil
	}
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	a.watchPending = nil
	a.watchMu.Unlock()

	// [ADR-087 P3] 关闭 plaza 预热窗口，避免应用退出后残留 WebView2 引用。
	// 先移除 WindowClosing hook（否则 Close() 触发 hook 被 Cancel 后只隐藏不销毁），
	// 再调用 Close() 让默认 destroy-listener 执行真正销毁。
	a.plazaWinMu.Lock()
	if a.plazaWin != nil {
		if a.plazaWinCloseHook != nil {
			a.plazaWinCloseHook()
			a.plazaWinCloseHook = nil
		}
		a.plazaWin.Close()
		a.plazaWin = nil
	}
	a.plazaWinMu.Unlock()

	a.httpSrvMu.Lock()
	servers := make([]*http.Server, 0, len(a.httpServers))
	for _, info := range a.httpServers {
		servers = append(servers, info.server)
	}
	a.httpServers = make(map[string]*httpServerInfo)
	a.httpSrvMu.Unlock()

	if len(servers) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return shutdownServers(ctx, servers)
}

// shutdownServers gracefully shuts down the given HTTP servers in parallel.
// If ctx has no deadline, a 5-second timeout is applied.
func shutdownServers(ctx context.Context, servers []*http.Server) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
	}

	var wg sync.WaitGroup
	errCh := make(chan error, len(servers))

	for _, srv := range servers {
		wg.Add(1)
		go func(s *http.Server) {
			defer wg.Done()
			if err := s.Shutdown(ctx); err != nil {
				errCh <- fmt.Errorf("http server shutdown: %w", err)
			}
		}(srv)
	}

	wg.Wait()
	close(errCh)

	var firstErr error
	for err := range errCh {
		if firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

// fileSelector is a function type for dialog selection functions in dialogs package.
type fileSelector func(*application.App, string) (string, error)

// selectFile is a helper that wraps the common dialog pattern:
// call selector → save last dir → return path.
func (a *App) selectFile(category string, fn fileSelector) (string, error) {
	path, err := fn(a.wailsApp, a.getLastDir(category))
	if err != nil || path == "" {
		return path, err
	}
	a.setLastDir(category, filepath.Dir(path))
	return path, nil
}

// SelectPMXFile opens a file dialog to select a PMX file
func (a *App) SelectPMXFile() (string, error) {
	return a.selectFile("model", dialogs.SelectPMX)
}

// SelectImportFile opens a file dialog to select PMX / ZIP / VMD files.
func (a *App) SelectImportFile() (string, error) {
	return a.selectFile("import", dialogs.SelectImport)
}

// SelectVMDMotion opens a file dialog to select a VMD motion file
func (a *App) SelectVMDMotion() (string, error) {
	return a.selectFile("motion", dialogs.SelectVMD)
}

// SelectVPDPose opens a file dialog to select a VPD pose file
func (a *App) SelectVPDPose() (string, error) {
	return a.selectFile("pose", dialogs.SelectVPD)
}

// SelectAudioFile opens a file dialog to select an audio file
func (a *App) SelectAudioFile() (string, error) {
	return a.selectFile("audio", dialogs.SelectAudio)
}

// SelectEnvTextureFile opens a file dialog to select an environment/skybox texture.
func (a *App) SelectEnvTextureFile() (string, error) {
	return a.selectFile("environment", dialogs.SelectEnvTexture)
}

// SelectExeFile opens a file dialog to select an executable file.
func (a *App) SelectExeFile() (string, error) {
	return a.selectFile("exe", dialogs.SelectExe)
}

// ======== Model Library Types ========

// ModelEntry represents a model, motion, or zip entry found during library scan.
type ModelEntry struct {
	Dir       string `json:"dir"`       // Model directory (absolute); for zip entries, the zip's directory
	PMXPath   string `json:"file_path"` // file absolute path (.pmx or .vmd; also called PMXPath for historical reasons); for zip entries, the zip path
	NameJp    string `json:"name_jp"`   // PMX header: local name
	NameEn    string `json:"name_en"`   // PMX header: universal name; for VMD: basename
	Comment   string `json:"comment"`   // PMX header: local comment (truncated)
	HasThumb  bool   `json:"has_thumb"` // Whether a thumbnail exists
	Type      string `json:"type"`      // "actor" | "motion" | "stage" | "dressing" | "bundle" | "effect" | "scene" | "other"
	Format    string `json:"format"`    // "pmx" | "vmd" | "zip"
	Container string `json:"container"` // "file" | "zip"
	ZipInner  string `json:"zip_inner"` // Relative path inside zip (only for container=zip)
	Category  string `json:"category"`  // DanceXR top-level category dir name (empty if none)
	Source    string `json:"source"` // Source library name (empty for main lib)
}

// SoftwareEntry represents an executable found in the software/ directory or user-added.
type SoftwareEntry struct {
	Name    string `json:"name"`    // Display name (without extension)
	Path    string `json:"path"`    // Full absolute path
	Kind    string `json:"kind"`    // "blender" | "mmd" | "pmxeditor" | "other"
	Args    string `json:"args"`    // Command-line template, supports {model} placeholder
	Managed bool   `json:"managed"` // true=Config-persisted custom entry, false=scanned from software/
	Icon    string `json:"icon"`    // Reserved for future .exe icon extraction
}

// ModelMeta holds PMX header metadata for on-demand parsing.
// Returned by GetModelMeta / GetModelMetaBatch.
type ModelMeta struct {
	NameJp  string `json:"name_jp"`
	NameEn  string `json:"name_en"`
	Comment string `json:"comment"` // PMX header: local comment (truncated)
}

// UIState stores user-customizable UI preferences.
type UIState struct {
	Scale                    float64 `json:"scale"`           // 0.8~1.3, default 1.0
	PopupWidth               int     `json:"popupWidth"`      // 220~380, default 280
	Accent                   string  `json:"accent"`          // hex, default "#4a6cf7"
	FontFamily               string  `json:"fontFamily"`      // "system"|"noto"|"yahei"
	Animations               bool    `json:"animations"`      // enable menu slide animations
	BlurBg                   bool    `json:"blurBg"`          // enable background blur on overlays
	PerformanceMode          string  `json:"performanceMode"` // "auto"|"quality"|"balanced"|"performance"
	ScreenshotFormat         string  `json:"screenshotFormat"`
	ScreenshotQuality        float64 `json:"screenshotQuality"`
	ScreenshotDir            string  `json:"screenshotDir,omitempty"`
	ThumbnailResolution      int     `json:"thumbnailResolution,omitempty"` // 缩略图分辨率（最长边 px），0=默认 512
	AutoCameraEnabled        bool    `json:"autoCameraEnabled"`
	AutoCameraBeatsPerSwitch int     `json:"autoCameraBeatsPerSwitch"`
	AutoUpdateEnabled        bool    `json:"autoUpdateEnabled"`

	// --- 以下字段原为前端会话级，2026-07-07 新增持久化支持 ---
	FpsLimit              int               `json:"fpsLimit,omitempty"`              // 帧率上限；0=不限
	Vsync                 bool              `json:"vsync,omitempty"`                 // 垂直同步（默认 true）
	DefaultPhysicsEnabled bool              `json:"defaultPhysicsEnabled,omitempty"` // 新加载 actor 默认物理开关
	RenderScale           float64           `json:"renderScale,omitempty"`           // 渲染分辨率缩放；1.0=原生
	CameraSensitivity     float64           `json:"cameraSensitivity,omitempty"`     // 相机灵敏度倍数；1.0=默认
	InvertYAxis           bool              `json:"invertYAxis,omitempty"`           // 反转 Y 轴
	AutoScaleModel        bool              `json:"autoScaleModel,omitempty"`        // 新加载模型自动缩放
	AutoCenterModel       bool              `json:"autoCenterModel,omitempty"`       // 新加载模型自动居中取景（相机对准模型）
	MaterialCategoryMap   map[string]string `json:"materialCategoryMap,omitempty"`   // 材质分类映射
	ResourceViewMode      string                       `json:"resourceViewMode,omitempty"`      // [doc:adr-066] 资源库视图模式："list"|"grid"

	// --- 音频设置（持久化，避免重启后重置） ---
	Volume                 float64                      `json:"volume,omitempty"`                 // 默认音量 0-1
	AudioOffset            float64                      `json:"audioOffset,omitempty"`            // 音频偏移（秒）
	BpmQuantizeEnabled     bool                         `json:"bpmQuantizeEnabled,omitempty"`     // BPM 量化开关
	AutoLoadCompanionAudio bool                         `json:"autoLoadCompanionAudio,omitempty"` // 自动加载伴音
	SfxEnabled             bool                         `json:"sfxEnabled,omitempty"`             // SFX 开关
	SfxVolume              float64                      `json:"sfxVolume,omitempty"`              // SFX 音量 0-1
	FootstepEnabled        bool                         `json:"footstepEnabled,omitempty"`        // 脚步声开关
	FootstepVolume         float64                      `json:"footstepVolume,omitempty"`         // 脚步声音量 0-1

	// --- 快捷键自定义绑定 ---
	KeyBindings map[string]KeyBindingOverride `json:"keyBindings,omitempty"` // 自定义快捷键覆盖

	// --- 顶部 HUD 显隐开关（2026-07-14 新增）---
	// 使用指针以区分「未设置（nil→默认显示）」与「显式关闭（false）」，确保关闭状态可持久化。
	ShowFpsClock     *bool `json:"showFpsClock,omitempty"`     // 帧率时钟 HUD 显隐；nil=显示
	ShowRuntimeBadge *bool `json:"showRuntimeBadge,omitempty"` // 多线程（MPR/SPR）徽标 HUD 显隐；nil=显示

	// --- Android 屏幕常亮（2026-07-20 新增，ADR-017 A1-04）---
	// 使用指针以区分「未设置（nil→默认开启）」与「显式关闭（false）」，确保关闭状态可持久化。
	KeepAwake *bool `json:"keepAwake,omitempty"` // Android 前台屏幕常亮；nil=开启（默认）

	// --- Android 屏幕方向（2026-07-20 新增，ADR-017 A1-05）---
	ScreenOrientation string `json:"screenOrientation,omitempty"` // Android 屏幕方向："auto"|"portrait"|"landscape"；空=auto
}

// KeyBindingOverride stores a single custom key binding override.
type KeyBindingOverride struct {
	Key   string `json:"key"`
	Ctrl  bool   `json:"ctrl,omitempty"`
	Shift bool   `json:"shift,omitempty"`
	Alt   bool   `json:"alt,omitempty"`
}

// OverridePaths allows per-category path overrides.
// If a field is empty, the default path under ResourceRoot is used.
type OverridePaths struct {
	PMX         string `json:"pmx"`         // 默认 resource_root/PMX
	VMD         string `json:"vmd"`         // 默认 resource_root/VMD
	Audio       string `json:"audio"`       // 默认 resource_root/audio
	Stage       string `json:"stage"`       // 默认 resource_root/stage
	Prop        string `json:"prop"`        // 默认 resource_root/prop
	Environment string `json:"environment"` // 默认 resource_root/environment
	MDDress     string `json:"md_dress"`    // 默认 resource_root/MD-dress
	Setting     string `json:"setting"`     // 默认 resource_root/setting
}

// catDef describes a resource category directory mapping (override field + default subdir name).
// Used by ensureResourceDirs and GetPath to avoid duplicate category-list definitions.
type catDef struct {
	override *string
	subdir   string
}

// Config holds persistent user settings.
type Config struct {
	ConfigVersion            int                 `json:"config_version"` // 配置版本号，用于迁移；0=旧配置（迁移前）
	UIState                  UIState             `json:"ui_state"`
	LibraryRoot              string              `json:"library_root,omitempty"` // 迁移后清空，保留字段用于自动迁移
	ResourceRoot             string              `json:"resource_root"`          // 总根目录
	StorageMode              string              `json:"storage_mode"`           // "private" | "shared" (Android only)
	OverridePaths            OverridePaths       `json:"override_paths"` // 各类型路径覆写
	BlenderPath              string              `json:"blender_path"`
	DisplayNamePriority      string              `json:"display_name_priority"`                // "name_jp" | "name_en" | "filename"
	DownloadWatchDir         string              `json:"download_watch_dir"`                   // 监听目录，空则不监听
	DownloadAutoImport       bool                `json:"download_auto_import"`                 // true 则跳过确认直接导入
	DownloadWatchEnabled     bool                `json:"download_watch_enabled,omitempty"`     // 监听开关（与 dir 解耦：关闭时保留 dir）
	DownloadWatchInitialized bool                `json:"download_watch_initialized,omitempty"` // 首启默认是否已应用（防重复默认覆盖用户关闭）
	Favorites                []string            `json:"favorites"`                            // libraryRef 数组，收藏的模型
	RenderPresets            []RenderPreset      `json:"render_presets"`                       // 用户保存的渲染预设
	MMDPath                  string              `json:"mmd_path"`                             // MikuMikuDance 可执行文件路径，空则自动检测
	CustomSoftware           []SoftwareEntry     `json:"custom_software"`                      // 用户手动添加的软件（Managed=true）
	Tags                     map[string][]string `json:"tags"`                                 // libraryRef → []tag 列表
	RecentModels             []string            `json:"recent_models"`                        // libraryRef 数组，最近打开的模型（最多20条）
	Env                      *EnvState           `json:"env,omitempty"`                        // 环境状态（天空/地面/粒子等），nil=使用前端默认
	LastDirs                 map[string]string   `json:"last_dirs,omitempty"`                  // 对话框最后目录记忆，优先相对路径（./前缀），详见 ADR-090
}

// EnvState stores the full environment configuration (sky, ground, particles, fog, etc.).
type EnvState struct {
	SkyMode          string     `json:"skyMode"`
	SkyColorTop      [3]float64 `json:"skyColorTop"`
	SkyColorMid      [3]float64 `json:"skyColorMid"`
	SkyColorBot      [3]float64 `json:"skyColorBot"`
	SkyTexture       string     `json:"skyTexture"`
	SkyRotationY     float64    `json:"skyRotationY"`
	SkyRotationSpeed float64    `json:"skyRotationSpeed"`
	SkyBrightness    float64    `json:"skyBrightness"`
	StarsEnabled     bool       `json:"starsEnabled"`
	StarsTexture     string     `json:"starsTexture"`
	EnvIntensity     float64    `json:"envIntensity"`
	EnvBrightness    float64    `json:"envBrightness"`

	GroundVisible         bool       `json:"groundVisible"`
	GroundType            string     `json:"groundType"`
	GroundStyle           string     `json:"groundStyle"`
	GroundOverlay       string     `json:"groundOverlay"`
	GroundColor           [3]float64 `json:"groundColor"`
	GroundAlpha           float64    `json:"groundAlpha"`
	GroundTexture         string     `json:"groundTexture"`
	GroundTextureEnabled  bool       `json:"groundTextureEnabled"`
	GroundTextureScale    float64    `json:"groundTextureScale"`
	GroundTextureRotation float64    `json:"groundTextureRotation"`
	GroundGridSize        float64    `json:"groundGridSize"`
	GroundLineColor       [3]float64 `json:"groundLineColor"`
	GroundTerrainHeight   float64    `json:"groundTerrainHeight"`
	GroundTerrainScale    float64    `json:"groundTerrainScale"`
	GroundTerrainSeed     float64    `json:"groundTerrainSeed"`
	GroundTerrainOctaves  float64    `json:"groundTerrainOctaves"`
	GroundPitch           float64    `json:"groundPitch"`
	GroundRoll            float64    `json:"groundRoll"`
	GroundScrollSpeedX    float64    `json:"groundScrollSpeedX"`
	GroundScrollSpeedZ    float64    `json:"groundScrollSpeedZ"`
	GroundPattern         string     `json:"groundPattern"`
	GroundReflectionBlend    float64 `json:"groundReflectionBlend"`
	GroundReflectionQuality string  `json:"groundReflectionQuality"`
	GroundNormalTexture     string  `json:"groundNormalTexture"`
	GroundNormalStrength    float64 `json:"groundNormalStrength"`
	GroundElevationColoring  bool    `json:"groundElevationColoring"`
	GroundPbrEnabled         bool    `json:"groundPbrEnabled"`
	GroundProceduralTexture  string  `json:"groundProceduralTexture"`
	GroundProceduralSeed     float64 `json:"groundProceduralSeed"`
	GroundProceduralScale    float64 `json:"groundProceduralScale"`
	GroundRoughness          float64 `json:"groundRoughness"`
	GroundMetallic           float64 `json:"groundMetallic"`
	GroundInfinite           bool    `json:"groundInfinite"`
	// ADR-114 Phase 2: 反射模糊 + 法线扭曲
	GroundReflectionBlur     float64 `json:"groundReflectionBlur"`
	GroundReflectionDistort  float64 `json:"groundReflectionDistort"`
	// ADR-114 Phase 3: 接触阴影
	GroundContactShadowEnabled    bool    `json:"groundContactShadowEnabled"`
	GroundContactShadowIntensity  float64 `json:"groundContactShadowIntensity"`
	GroundContactShadowDistance   float64 `json:"groundContactShadowDistance"`
	GroundLevel           float64    `json:"groundLevel"`
	GroundSize            float64    `json:"groundSize"`
	GroundEdgeFade        float64    `json:"groundEdgeFade"`

	WindEnabled   bool       `json:"windEnabled"`
	WindDirection [3]float64 `json:"windDirection"`
	WindSpeed     float64    `json:"windSpeed"`

	ParticleEnabled       bool    `json:"particleEnabled"`
	ParticleType          string  `json:"particleType"`
	ParticleEmitRate      float64 `json:"particleEmitRate"`
	ParticleSize          float64 `json:"particleSize"`
	ParticleSpeed         float64 `json:"particleSpeed"`
	ParticleSplash        bool    `json:"particleSplash"`
	ParticleCustomTexture string  `json:"particleCustomTexture"`

	WaterEnabled      bool       `json:"waterEnabled"`
	WaterLevel        float64    `json:"waterLevel"`
	WaterFlip         bool       `json:"waterFlip"`
	WaterColor        [3]float64 `json:"waterColor"`
	WaterTransparency float64    `json:"waterTransparency"`
	WaterWaveHeight   float64    `json:"waterWaveHeight"`
	BigWaveHeight     float64    `json:"bigWaveHeight"`
	SmallWaveHeight   float64    `json:"smallWaveHeight"`
	WaterSize         float64    `json:"waterSize"`
	WaterAnimSpeed    float64    `json:"waterAnimSpeed"`
	// 水面平面反射质量：'high' | 'medium' | 'low' | 'off'
	ReflectionQuality string  `json:"reflectionQuality"`
	// ADR-115: 平面反射混合度，对应 TS planarReflectBlend
	PlanarReflectBlend float64 `json:"planarReflectBlend"`
	// ADR-130 Phase 2.3: 统一质量档位
	QualityProfile string `json:"qualityProfile"`

	// 水面高级着色器参数（持久化，避免材质重建时重置）
	FresnelBias           float64    `json:"fresnelBias"`
	FresnelPower          float64    `json:"fresnelPower"`
	DiffuseStrength       float64    `json:"diffuseStrength"`
	AmbientStrength       float64    `json:"ambientStrength"`
	RippleNormalStrength  float64    `json:"rippleNormalStrength"`
	RippleGlintStrength   float64    `json:"rippleGlintStrength"`
	WaterNormalStrength   float64    `json:"waterNormalStrength"`
	WaterGlintStrength    float64    `json:"waterGlintStrength"`
	WaterHorizonFade      float64    `json:"waterHorizonFade"`
	WaterSkyColorBlend    float64    `json:"waterSkyColorBlend"`
	CausticIntensity      float64    `json:"causticIntensity"`
	CausticColor1         [3]float64 `json:"causticColor1"`
	CausticColor2         [3]float64 `json:"causticColor2"`
	CausticScrollX        float64    `json:"causticScrollX"`
	CausticScrollY        float64    `json:"causticScrollY"`
	FresnelAlphaInfluence float64    `json:"fresnelAlphaInfluence"`

	// 水面雾效（独立于全局雾）
	WaterFogColor            [3]float64 `json:"waterFogColor"`
	WaterFogDensity          float64    `json:"waterFogDensity"`
	WaterFogOpacityInfluence float64    `json:"waterFogOpacityInfluence"`

	// 水下效果
	UnderwaterFogDensity      float64 `json:"underwaterFogDensity"`
	UnderwaterChromaticAmount float64 `json:"underwaterChromaticAmount"`
	UnderwaterToneIntensity   float64 `json:"underwaterToneIntensity"`
	UnderwaterFogMultiplier   float64 `json:"underwaterFogMultiplier"`
	UnderwaterTintStrength    float64 `json:"underwaterTintStrength"`

	CloudsEnabled   bool    `json:"cloudsEnabled"`
	CloudCover      float64 `json:"cloudCover"`
	CloudScale      float64 `json:"cloudScale"`
	CloudHeight     float64 `json:"cloudHeight"`
	CloudThickness  float64 `json:"cloudThickness"`
	CloudVisibility float64 `json:"cloudVisibility"`
	CloudGap        float64 `json:"cloudGap"`
	CloudErosion    float64 `json:"cloudErosion"`
	CloudWeatherStrength float64 `json:"cloudWeatherStrength"`
	CloudBacklight  float64 `json:"cloudBacklight"`
	CloudPowder     float64 `json:"cloudPowder"`
	CloudQuality    string  `json:"cloudQuality"`
	DebugClouds     bool    `json:"debugClouds"`
	// ADR-128/129: 镜面道具开关，对应 TS mirrorEnabled
	MirrorEnabled   bool    `json:"mirrorEnabled"`

	FogEnabled bool       `json:"fogEnabled"`
	FogMode    string     `json:"fogMode"`
	FogColor   [3]float64 `json:"fogColor"`
	FogDensity float64    `json:"fogDensity"`
	FogStart   float64    `json:"fogStart"`
	FogEnd     float64    `json:"fogEnd"`

	CollisionEnabled       bool `json:"collisionEnabled"`
	BodyCollisionEnabled   bool `json:"bodyCollisionEnabled"`
	GroundCollisionEnabled bool `json:"groundCollisionEnabled"`

	SunAngle float64 `json:"sunAngle"`
	Azimuth  float64 `json:"azimuth"`

	LightingPresetName *string `json:"lightingPresetName,omitempty"`

	TimeOfDayActive bool    `json:"timeOfDayActive"`
	TimeOfDaySpeed  float64 `json:"timeOfDaySpeed"`
}

// RenderPreset stores a user-defined rendering preset.
type RenderPreset struct {
	Name   string                 `json:"name"`
	Params map[string]interface{} `json:"params"` // RenderState fields as flat key-value pairs
}

// userConfigDir is a hook for testing — production code calls os.UserConfigDir.
var userConfigDir = os.UserConfigDir

// ensureDir returns the subdirectory under the user's config or cache dir,
// creating it (and parents) if it doesn't exist.
//
//	useCache=true  → platformPathMgr.CacheRoot()/MikuMikuAR/subDir
//	useCache=false → platformPathMgr.AppDataRoot()/MikuMikuAR/subDir
func ensureDir(subDir string, useCache bool) (string, error) {
	var base string
	var err error
	if useCache {
		base, err = platformPathMgr.CacheRoot()
	} else {
		base, err = platformPathMgr.AppDataRoot()
	}
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "MikuMikuAR", subDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// configDir returns the application configuration directory (%APPDATA%/MikuMikuAR).
func configDir() (string, error) {
	return ensureDir("", false)
}

// settingDir returns the setting subdirectory under the resource root, or falls back to configDir.
// config.json and index.json are stored here when ResourceRoot is configured.
// Respects OverridePaths.Setting if set (same behaviour as GetPath).
func settingDir(cfg *Config) (string, error) {
	if cfg != nil && cfg.ResourceRoot != "" {
		d := cfg.OverridePaths.Setting
		if d == "" {
			d = filepath.Join(cfg.ResourceRoot, "setting")
		}
		if err := os.MkdirAll(d, 0755); err != nil {
			return "", fmt.Errorf("create setting dir %s: %w", d, err)
		}
		return d, nil
	}
	return configDir()
}

// extractedDir returns the cache root for extracted zip contents (%LOCALAPPDATA%/MikuMikuAR/extracted).
func extractedDir() (string, error) {
	return ensureDir("extracted", true)
}

// thumbnailDir returns the cache root for thumbnail images (%LOCALAPPDATA%/MikuMikuAR/thumbnails).
func thumbnailDir() (string, error) {
	return ensureDir("thumbnails", true)
}

// softwareDir returns the software directory (%APPDATA%/MikuMikuAR/software).
func softwareDir() (string, error) {
	return ensureDir("software", false)
}

// ======== Recent Models ========

const maxRecentModels = 20

// GetRecentModels returns the recently opened model libraryRefs (newest first).
func (a *App) GetRecentModels() []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg.RecentModels == nil {
		return []string{}
	}
	return cfg.RecentModels
}

// AddRecentModel pushes a libraryRef to the top of the recent models list.
// If already present, it is moved to the top. List is capped at maxRecentModels.
func (a *App) AddRecentModel(libraryRef string) error {
	if libraryRef == "" {
		return nil
	}
	return a.updateConfig(func(cfg *Config) {
		// Remove if already present
		filtered := make([]string, 0, len(cfg.RecentModels))
		for _, r := range cfg.RecentModels {
			if r != libraryRef {
				filtered = append(filtered, r)
			}
		}
		// Prepend
		cfg.RecentModels = append([]string{libraryRef}, filtered...)
		// Cap
		if len(cfg.RecentModels) > maxRecentModels {
			cfg.RecentModels = cfg.RecentModels[:maxRecentModels]
		}
	}, false)
}

// DefaultResourceRoot returns the default resource root path for the current platform.
func DefaultResourceRoot() string {
	return platformPathMgr.ResourceRoot()
}

// getLastDir reads the remembered directory for a dialog category.
// Relative paths (prefixed with "./") are resolved against ResourceRoot for portability.
func (a *App) getLastDir(cat string) string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.LastDirs == nil {
		return ""
	}
	path := cfg.LastDirs[cat]
	if path == "" {
		return ""
	}

	// Relative path: ./PMX/subfolder → ResourceRoot/PMX/subfolder
	if strings.HasPrefix(path, "./") {
		root := cfg.ResourceRoot
		if root == "" {
			root = DefaultResourceRoot()
		}
		return filepath.Join(root, path[2:])
	}

	// Absolute path: used for external directories outside ResourceRoot
	return path
}

// setLastDir persists the directory for a dialog category.
// Paths under ResourceRoot are stored as relative ("./...") for cross-platform use;
// paths outside ResourceRoot are stored as absolute (desktop only).
func (a *App) setLastDir(cat, dir string) {
	_ = a.updateConfig(func(cfg *Config) {
		if cfg.LastDirs == nil {
			cfg.LastDirs = map[string]string{}
		}

		root := cfg.ResourceRoot
		if root == "" {
			root = DefaultResourceRoot()
		}

		// Try to convert to relative path under ResourceRoot
		relPath, err := filepath.Rel(root, dir)
		if err == nil && !strings.HasPrefix(relPath, "..") {
			cfg.LastDirs[cat] = "./" + filepath.ToSlash(relPath)
		} else {
			// Outside ResourceRoot — store absolute path
			cfg.LastDirs[cat] = filepath.ToSlash(dir)
		}
	}, false) // rescan=false: directory memory doesn't trigger model rescan
}

// GetLastBrowseDir returns the remembered browse directory for a resource category.
// Used by the frontend resource library browser to resume from the last visited subdirectory.
// Relative paths (./...) are resolved against ResourceRoot; absolute paths returned as-is.
func (a *App) GetLastBrowseDir(category string) (string, error) {
	dir := a.getLastDir("browse:" + category)
	if dir == "" {
		return "", nil
	}
	return dir, nil
}

// SetLastBrowseDir persists the current browse directory for a resource category.
// Paths under ResourceRoot are stored as relative (./...) for cross-platform portability;
// paths outside ResourceRoot are stored as absolute (desktop only).
func (a *App) SetLastBrowseDir(category, dir string) error {
	a.setLastDir("browse:" + category, dir)
	return nil
}

// ensureResourceDirs creates the default subdirectories under ResourceRoot if they don't exist.
// Only creates directories whose override path is empty — categories with explicit overrides
// manage their own location and should not leave empty ghost folders at the default location.
func (a *App) ensureResourceDirs(cfg *Config) {
	root := cfg.ResourceRoot
	if root == "" {
		root = DefaultResourceRoot()
		cfg.ResourceRoot = root
	}
	  defs := []catDef{
		{&cfg.OverridePaths.PMX, "PMX"},
		{&cfg.OverridePaths.VMD, "VMD"},
		{&cfg.OverridePaths.Audio, "audio"},
		{&cfg.OverridePaths.Stage, "stage"},
		{&cfg.OverridePaths.Prop, "prop"},
		{&cfg.OverridePaths.Environment, "environment"},
		{&cfg.OverridePaths.MDDress, "MD-dress"},
		{&cfg.OverridePaths.Setting, "setting"},
	}
	for _, d := range defs {
		target := *d.override
		if target == "" {
			target = filepath.Join(root, d.subdir)
		}
		os.MkdirAll(target, 0755)
	}
}

// GetPath returns the effective path for a category.
func (a *App) GetPath(cfg *Config, category string) string {
	root := cfg.ResourceRoot
	if root == "" {
		root = DefaultResourceRoot()
	}
	defs := map[string]catDef{
		"pmx":         {&cfg.OverridePaths.PMX, "PMX"},
		"vmd":         {&cfg.OverridePaths.VMD, "VMD"},
		"audio":       {&cfg.OverridePaths.Audio, "audio"},
		"prop":        {&cfg.OverridePaths.Prop, "prop"},
		"stage":       {&cfg.OverridePaths.Stage, "stage"},
		"environment": {&cfg.OverridePaths.Environment, "environment"},
		"md_dress":    {&cfg.OverridePaths.MDDress, "MD-dress"},
		"setting":     {&cfg.OverridePaths.Setting, "setting"},
	}
	if d, ok := defs[category]; ok {
		if *d.override != "" {
			return *d.override
		}
		return filepath.Join(root, d.subdir)
	}
	return root
}

// ======== Model Preset Bindings ========
