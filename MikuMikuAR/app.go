package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// safeLogInfo calls runtime.LogInfof only if a.ctx is non-nil (safe for tests).
func (a *App) safeLogInfo(format string, args ...interface{}) {
	if a.ctx != nil {
		runtime.LogInfof(a.ctx, format, args...)
	}
}

// safeLogError calls runtime.LogErrorf only if a.ctx is non-nil (safe for tests).
func (a *App) safeLogError(format string, args ...interface{}) {
	if a.ctx != nil {
		runtime.LogErrorf(a.ctx, format, args...)
	}
}

// App struct
type App struct {
	ctx         context.Context
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
func NewApp() *App {
	return &App{
		httpServers: make(map[string]*httpServerInfo),
	}
}

// shutdown cleans up resources when the app exits.
func (a *App) shutdown(ctx context.Context) {
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Restore download directory watching from saved config
	a.restoreWatcher()
}

// openFileDialog is a shared helper for selecting files via OS dialog.
func (a *App) openFileDialog(title string, filters []runtime.FileFilter) (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// SelectPMXFile opens a file dialog to select a PMX file
func (a *App) SelectPMXFile() (string, error) {
	return a.openFileDialog("选择 PMX 模型文件", []runtime.FileFilter{
		{DisplayName: "PMX Model (*.pmx)", Pattern: "*.pmx"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectVMDMotion opens a file dialog to select a VMD motion file
func (a *App) SelectVMDMotion() (string, error) {
	return a.openFileDialog("选择 VMD 动作文件", []runtime.FileFilter{
		{DisplayName: "VMD Motion (*.vmd)", Pattern: "*.vmd"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectVPDPose opens a file dialog to select a VPD pose file
func (a *App) SelectVPDPose() (string, error) {
	return a.openFileDialog("选择 VPD 姿势文件", []runtime.FileFilter{
		{DisplayName: "VPD Pose (*.vpd)", Pattern: "*.vpd"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectAudioFile opens a file dialog to select an audio file
func (a *App) SelectAudioFile() (string, error) {
	return a.openFileDialog("选择音乐文件", []runtime.FileFilter{
		{DisplayName: "Audio Files (*.mp3 *.wav *.ogg)", Pattern: "*.mp3;*.wav;*.ogg"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectEnvTextureFile opens a file dialog to select an environment/skybox texture.
func (a *App) SelectEnvTextureFile() (string, error) {
	return a.openFileDialog("选择环境贴图", []runtime.FileFilter{
		{DisplayName: "Environment Map (*.hdr *.dds *.exr)", Pattern: "*.hdr;*.dds;*.exr"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// SelectExeFile opens a file dialog to select an executable file.
func (a *App) SelectExeFile() (string, error) {
	return a.openFileDialog("选择可执行文件", []runtime.FileFilter{
		{DisplayName: "Executable (*.exe)", Pattern: "*.exe"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}

// ReadFileBytes reads a file from the given path and returns its bytes as base64.

// ======== Model Library Types ========

// ModelEntry represents a model, motion, or zip entry found during library scan.
type ModelEntry struct {
	Dir       string `json:"dir"`       // Model directory (absolute); for zip entries, the zip's directory
	PMXPath   string `json:"file_path"` // .pmx/.vmd absolute path; for zip entries, the zip path
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
	Scale      float64 `json:"scale"`      // 0.8~1.3, default 1.0
	PopupWidth int     `json:"popupWidth"` // 220~380, default 280
	Accent     string  `json:"accent"`     // hex, default "#4a6cf7"
	FontFamily string  `json:"fontFamily"` // "system"|"noto"|"yahei"
	Animations bool    `json:"animations"` // enable menu slide animations
	BlurBg     bool    `json:"blurBg"`     // enable background blur on overlays
}

// Config holds persistent user settings.
type Config struct {
	UIState             UIState             `json:"ui_state"`
	LibraryRoot         string              `json:"library_root"`
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
	SkyMode         string     `json:"skyMode"`
	SkyColorTop     [3]float64 `json:"skyColorTop"`
	SkyColorMid     [3]float64 `json:"skyColorMid"`
	SkyColorBot     [3]float64 `json:"skyColorBot"`
	SkyTexture      string     `json:"skyTexture"`
	SkyRotationY    float64    `json:"skyRotationY"`
	SkyBrightness   float64    `json:"skyBrightness"`
	EnvIntensity    float64    `json:"envIntensity"`
	GroundVisible   bool       `json:"groundVisible"`
	GroundMode      string     `json:"groundMode"`
	GroundColor     [3]float64 `json:"groundColor"`
	GroundAlpha     float64    `json:"groundAlpha"`
	WindEnabled     bool       `json:"windEnabled"`
	WindDirection   [3]float64 `json:"windDirection"`
	WindSpeed       float64    `json:"windSpeed"`
	ParticleEnabled bool       `json:"particleEnabled"`
	ParticleType    string     `json:"particleType"`
	CloudsEnabled   bool       `json:"cloudsEnabled"`
	CloudCover      float64    `json:"cloudCover"`
	CloudScale      float64    `json:"cloudScale"`
	FogEnabled      bool       `json:"fogEnabled"`
	FogColor        [3]float64 `json:"fogColor"`
	FogDensity      float64    `json:"fogDensity"`
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

// ======== Model Preset Bindings ========
