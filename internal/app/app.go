package app

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	stdruntime "runtime"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v3/pkg/application"
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
	appVersion  string // injected via -ldflags at build time
	httpServers map[string]*httpServerInfo // keyed by dirPath
	httpSrvMu   sync.Mutex
	configMu    sync.Mutex // guards GetConfig/writeConfig sequences

	// 下载目录监听
	watcher      *fsnotify.Watcher
	watchDir     string // 当前监听的目录
	watchMu      sync.Mutex
	watchTimer   *time.Timer         // debounce 定时器
	watchPending map[string]struct{} // debounce 期间暂存的文件路径
}

type httpServerInfo struct {
	server   *http.Server
	port     int
	dir      string
	listener net.Listener
}

// NewApp creates a new App application struct
func NewApp(version string) *App {
	return &App{
		appVersion:  version,
		httpServers: make(map[string]*httpServerInfo),
	}
}

// GetAppVersion returns the application version (injected via -ldflags at build time).
func (a *App) GetAppVersion() string {
	return a.appVersion
}

// ServiceStartup implements application.ServiceStartup interface.
func (a *App) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	// Restore download directory watching from saved config
	a.restoreWatcher()
	return nil
}

// ServiceShutdown implements application.ServiceShutdown interface.
func (a *App) SetWailsApp(wailsApp *application.App) {
	a.wailsApp = wailsApp
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
	return a.shutdownWithTimeout(ctx, 5*time.Second)
}

func (a *App) shutdownWithTimeout(ctx context.Context, timeout time.Duration) error {
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

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

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

// openFileDialog is a shared helper for selecting files via OS dialog.
// On Android, Wails v3 supports SAF-based file picker (GOOS=android).
func (a *App) openFileDialog(title string, filters []application.FileFilter) (string, error) {
	if a.wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := a.wailsApp.Dialog.OpenFile()
	dialog.SetTitle(title)
	dialog.CanChooseFiles(true)
	for _, f := range filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// SelectPMXFile opens a file dialog to select a PMX file
func (a *App) SelectPMXFile() (string, error) {
	return a.openFileDialog("选择 PMX 模型文件", []application.FileFilter{
		{DisplayName: "PMX Model (*.pmx)", Pattern: "*.pmx"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectVMDMotion opens a file dialog to select a VMD motion file
func (a *App) SelectVMDMotion() (string, error) {
	return a.openFileDialog("选择 VMD 动作文件", []application.FileFilter{
		{DisplayName: "VMD Motion (*.vmd)", Pattern: "*.vmd"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectVPDPose opens a file dialog to select a VPD pose file
func (a *App) SelectVPDPose() (string, error) {
	return a.openFileDialog("选择 VPD 姿势文件", []application.FileFilter{
		{DisplayName: "VPD Pose (*.vpd)", Pattern: "*.vpd"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectAudioFile opens a file dialog to select an audio file
func (a *App) SelectAudioFile() (string, error) {
	return a.openFileDialog("选择音乐文件", []application.FileFilter{
		{DisplayName: "Audio Files (*.mp3 *.wav *.ogg)", Pattern: "*.mp3;*.wav;*.ogg"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectEnvTextureFile opens a file dialog to select an environment/skybox texture.
func (a *App) SelectEnvTextureFile() (string, error) {
	return a.openFileDialog("选择环境贴图", []application.FileFilter{
		{DisplayName: "Environment Map (*.hdr *.dds *.exr)", Pattern: "*.hdr;*.dds;*.exr"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectExeFile opens a file dialog to select an executable file.
func (a *App) SelectExeFile() (string, error) {
	return a.openFileDialog("选择可执行文件", []application.FileFilter{
		{DisplayName: "Executable (*.exe)", Pattern: "*.exe"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// ReadFileBytes reads a file from the given path and returns its bytes as base64.

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
	Source    string `json:"source"`    // Source library name: empty for main lib, ExternalPath.Name for externals
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

// dancexrCategories maps DanceXR directory names → entry type.
var dancexrCategories = map[string]string{
	"actors":   "actor",
	"motion":   "motion",
	"motions":  "motion",
	"stage":    "stage",
	"stages":   "stage",
	"dressing": "dressing",
	"bundle":   "bundle",
	"bundles":  "bundle",
	"effects":  "effect",
	"scenes":   "scene",
}

// ExternalPath represents an external library mount point.
type ExternalPath struct {
	Path string `json:"path"` // Absolute path to external library root
	Name string `json:"name"` // Display name (default basename, user-renameable)
}

// DanceSet represents a dance set combining VMD motion, audio, and metadata.
type DanceSet struct {
	Name        string  `json:"name"`         // 套装名称
	VmdPath     string  `json:"vmd_path"`     // VMD 文件路径
	AudioPath   string  `json:"audio_path"`   // 音频文件路径
	AudioOffset float64 `json:"audio_offset"` // 音频偏移（秒）
	Description string  `json:"description"`  // 描述（可选）
	Thumbnail   string  `json:"thumbnail"`    // 缩略图 base64（可选）
	Source      string  `json:"source"`       // 来源库名
}

// UIState stores user-customizable UI preferences.
type UIState struct {
	Scale           float64 `json:"scale"`           // 0.8~1.3, default 1.0
	PopupWidth      int     `json:"popupWidth"`      // 220~380, default 280
	Accent          string  `json:"accent"`          // hex, default "#4a6cf7"
	FontFamily      string  `json:"fontFamily"`      // "system"|"noto"|"yahei"
	Animations      bool    `json:"animations"`      // enable menu slide animations
	BlurBg          bool    `json:"blurBg"`          // enable background blur on overlays
	PerformanceMode string  `json:"performanceMode"` // "auto"|"quality"|"balanced"|"performance"
}

// OverridePaths allows per-category path overrides.
// If a field is empty, the default path under ResourceRoot is used.
type OverridePaths struct {
	PMX         string `json:"pmx"`         // 默认 resource_root/PMX
	VMD         string `json:"vmd"`         // 默认 resource_root/VMD
	Stage       string `json:"stage"`       // 默认 resource_root/stage
	Environment string `json:"environment"` // 默认 resource_root/environment
	MDDress     string `json:"md_dress"`    // 默认 resource_root/MD-dress
	Setting     string `json:"setting"`     // 默认 resource_root/setting
}

// Config holds persistent user settings.
type Config struct {
	UIState             UIState             `json:"ui_state"`
	LibraryRoot         string              `json:"library_root,omitempty"` // 迁移后清空，保留字段用于自动迁移
	ResourceRoot        string              `json:"resource_root"`          // 总根目录
	OverridePaths       OverridePaths       `json:"override_paths"`        // 各类型路径覆写
	ExternalPaths       []ExternalPath      `json:"external_paths"`
	BlenderPath         string              `json:"blender_path"`
	DisplayNamePriority string              `json:"display_name_priority"` // "name_jp" | "name_en" | "filename"
	DownloadWatchDir    string              `json:"download_watch_dir"`    // 监听目录，空则不监听
	DownloadAutoImport  bool                `json:"download_auto_import"`  // true 则跳过确认直接导入
	Favorites           []string            `json:"favorites"`             // libraryRef 数组，收藏的模型
	RenderPresets       []RenderPreset      `json:"render_presets"`        // 用户保存的渲染预设
	MMDPath             string              `json:"mmd_path"`              // MikuMikuDance 可执行文件路径，空则自动检测
	CustomSoftware      []SoftwareEntry     `json:"custom_software"`       // 用户手动添加的软件（Managed=true）
	Tags                map[string][]string `json:"tags"`                  // libraryRef → []tag 列表
	DanceSets           map[string]DanceSet `json:"dance_sets"`            // 舞蹈套装，key = 套装 ID
	RecentModels        []string            `json:"recent_models"`         // libraryRef 数组，最近打开的模型（最多20条）
	Env                 *EnvState           `json:"env,omitempty"`         // 环境状态（天空/地面/粒子等），nil=使用前端默认
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
	EnvIntensity     float64    `json:"envIntensity"`

	GroundVisible bool       `json:"groundVisible"`
	GroundMode    string     `json:"groundMode"`
	GroundColor   [3]float64 `json:"groundColor"`
	GroundAlpha   float64    `json:"groundAlpha"`

	WindEnabled   bool       `json:"windEnabled"`
	WindDirection [3]float64 `json:"windDirection"`
	WindSpeed     float64    `json:"windSpeed"`

	ParticleEnabled  bool    `json:"particleEnabled"`
	ParticleType     string  `json:"particleType"`
	ParticleEmitRate float64 `json:"particleEmitRate"`
	ParticleSize     float64 `json:"particleSize"`
	ParticleSpeed    float64 `json:"particleSpeed"`

	WaterEnabled      bool       `json:"waterEnabled"`
	WaterLevel        float64    `json:"waterLevel"`
	WaterColor        [3]float64 `json:"waterColor"`
	WaterTransparency float64    `json:"waterTransparency"`
	WaterWaveHeight   float64    `json:"waterWaveHeight"`
	WaterSize         float64    `json:"waterSize"`
	WaterAnimSpeed    float64    `json:"waterAnimSpeed"`

	CloudsEnabled bool    `json:"cloudsEnabled"`
	CloudCover    float64 `json:"cloudCover"`
	CloudScale    float64 `json:"cloudScale"`
	CloudHeight   float64 `json:"cloudHeight"`

	FogEnabled bool       `json:"fogEnabled"`
	FogColor   [3]float64 `json:"fogColor"`
	FogDensity float64    `json:"fogDensity"`

	ClothEnabled bool        `json:"clothEnabled"`
	ClothConfig  ClothConfig `json:"clothConfig"`
}

// ClothConfig stores XPBD cloth simulation parameters.
type ClothConfig struct {
	AnchorBone     string  `json:"anchorBone"`
	Topology       string  `json:"topology"`
	InnerRadius    float64 `json:"innerRadius"`
	Length         float64 `json:"length"`
	Slope          float64 `json:"slope"`
	SegmentsH      int     `json:"segmentsH"`
	SegmentsV      int     `json:"segmentsV"`
	ParticleRadius float64 `json:"particleRadius"`
	Compliance     float64 `json:"compliance"`
	TotalMass      float64 `json:"totalMass"`
	Damping        float64 `json:"damping"`
	GravityScale   float64 `json:"gravityScale"`
	BendCompliance float64 `json:"bendCompliance"`
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
//	useCache=true  → os.UserCacheDir()/MikuMikuAR/subDir
//	useCache=false → os.UserConfigDir()/MikuMikuAR/subDir
func ensureDir(subDir string, useCache bool) (string, error) {
	var base string
	var err error
	if useCache {
		base, err = os.UserCacheDir()
	} else {
		base, err = userConfigDir()
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
func settingDir(cfg *Config) (string, error) {
	if cfg != nil && cfg.ResourceRoot != "" {
		d := filepath.Join(cfg.ResourceRoot, "setting")
		if err := os.MkdirAll(d, 0755); err != nil {
			return configDir()
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
	if err != nil || cfg == nil {
		return nil
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
	switch stdruntime.GOOS {
	case "android":
		if sd := os.Getenv("EXTERNAL_STORAGE"); sd != "" {
			return filepath.Join(sd, "MMD")
		}
		return "/sdcard/MMD"
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Documents", "MMD")
	default:
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "MMD")
	}
}

// ensureResourceDirs creates the default subdirectories under ResourceRoot if they don't exist.
func (a *App) ensureResourceDirs(cfg *Config) {
	root := cfg.ResourceRoot
	if root == "" {
		root = DefaultResourceRoot()
		cfg.ResourceRoot = root
	}
	dirs := []string{"PMX", "VMD", "stage", "environment", "MD-dress", "setting"}
	for _, d := range dirs {
		os.MkdirAll(filepath.Join(root, d), 0755)
	}
}

// GetPath returns the effective path for a category.
func (a *App) GetPath(cfg *Config, category string) string {
	root := cfg.ResourceRoot
	if root == "" {
		root = DefaultResourceRoot()
	}
	switch category {
	case "pmx":
		if cfg.OverridePaths.PMX != "" {
			return cfg.OverridePaths.PMX
		}
		return filepath.Join(root, "PMX")
	case "vmd":
		if cfg.OverridePaths.VMD != "" {
			return cfg.OverridePaths.VMD
		}
		return filepath.Join(root, "VMD")
	case "stage":
		if cfg.OverridePaths.Stage != "" {
			return cfg.OverridePaths.Stage
		}
		return filepath.Join(root, "stage")
	case "environment":
		if cfg.OverridePaths.Environment != "" {
			return cfg.OverridePaths.Environment
		}
		return filepath.Join(root, "environment")
	case "md_dress":
		if cfg.OverridePaths.MDDress != "" {
			return cfg.OverridePaths.MDDress
		}
		return filepath.Join(root, "MD-dress")
	case "setting":
		if cfg.OverridePaths.Setting != "" {
			return cfg.OverridePaths.Setting
		}
		return filepath.Join(root, "setting")
	default:
		return root
	}
}

// migrateLibraryRoot migrates the old library_root field to resource_root.
func (a *App) migrateLibraryRoot(cfg *Config) bool {
	if cfg.LibraryRoot != "" && cfg.ResourceRoot == "" {
		cfg.ResourceRoot = cfg.LibraryRoot
		cfg.LibraryRoot = ""
		return true
	}
	return false
}

// ======== Model Preset Bindings ========
