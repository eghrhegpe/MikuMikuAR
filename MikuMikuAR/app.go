package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"

	stdruntime "runtime"
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
	ctx          context.Context
	httpServers  map[string]*httpServerInfo // keyed by dirPath
	httpSrvMu    sync.Mutex
	configMu     sync.Mutex                // guards GetConfig/writeConfig sequences

	// 下载目录监听
	watcher      *fsnotify.Watcher
	watchDir     string                    // 当前监听的目录
	watchMu      sync.Mutex
	watchTimer   *time.Timer               // debounce 定时器
	watchPending map[string]struct{}       // debounce 期间暂存的文件路径
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

// SelectAudioFile opens a file dialog to select an audio file
func (a *App) SelectAudioFile() (string, error) {
	return a.openFileDialog("选择音乐文件", []runtime.FileFilter{
		{DisplayName: "Audio Files (*.mp3 *.wav *.ogg)", Pattern: "*.mp3;*.wav;*.ogg"},
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
	Dir       string `json:"dir"`        // Model directory (absolute); for zip entries, the zip's directory
	PMXPath   string `json:"file_path"`   // .pmx/.vmd absolute path; for zip entries, the zip path
	NameJp    string `json:"name_jp"`    // PMX header: local name
	NameEn    string `json:"name_en"`    // PMX header: universal name; for VMD: basename
	Comment   string `json:"comment"`    // PMX header: local comment (truncated)
	HasThumb  bool   `json:"has_thumb"`  // Whether a thumbnail exists
	Type      string `json:"type"`       // "actor" | "motion" | "stage" | "dressing" | "bundle" | "effect" | "scene" | "other"
	Format    string `json:"format"`     // "pmx" | "vmd" | "zip"
	Container string `json:"container"`  // "file" | "zip"
	ZipInner  string `json:"zip_inner"`  // Relative path inside zip (only for container=zip)
	Category  string `json:"category"`   // DanceXR top-level category dir name (empty if none)
	Source    string `json:"source"`     // Source library name: empty for main lib, ExternalPath.Name for externals
}

// SoftwareEntry represents an executable found in the software/ directory.
type SoftwareEntry struct {
	Name string `json:"name"` // Display name (without extension)
	Path string `json:"path"` // Full absolute path
	Icon string `json:"icon"` // Reserved for future .exe icon extraction
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

// Config holds persistent user settings.
type Config struct {
	LibraryRoot          string                `json:"library_root"`
	ExternalPaths        []ExternalPath        `json:"external_paths"`
	BlenderPath          string                `json:"blender_path"`
	DisplayNamePriority  string                `json:"display_name_priority"` // "name_jp" | "name_en" | "filename"
	DownloadWatchDir     string                `json:"download_watch_dir"`     // 监听目录，空则不监听
	DownloadAutoImport   bool                  `json:"download_auto_import"`  // true 则跳过确认直接导入
	Favorites            []string              `json:"favorites"`             // libraryRef 数组，收藏的模型
	RenderPresets        []RenderPreset        `json:"render_presets"`        // 用户保存的渲染预设
	MMDPath              string                `json:"mmd_path"`              // MikuMikuDance 可执行文件路径，空则自动检测
	Tags                 map[string][]string   `json:"tags"`                  // libraryRef → []tag 列表
	DanceSets            map[string]DanceSet   `json:"dance_sets"`            // 舞蹈套装，key = 套装 ID
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
//   useCache=true  → os.UserCacheDir()/MikuMikuAR/subDir
//   useCache=false → os.UserConfigDir()/MikuMikuAR/subDir
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

// SelectDir opens a directory picker dialog.
func (a *App) SelectDir() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择模型库根目录",
	})
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// ScanModelDir scans main root + all external paths and returns merged ModelEntry list.
// Main root entries have Source=""; external entries get Source = ep.Name.
// root may be "" (external-only scan); external may be nil (main-only scan).
func (a *App) ScanModelDir(root string, external []ExternalPath) ([]ModelEntry, error) {
	var models []ModelEntry

	if root != "" {
		models = append(models, a.scanSingleRoot(root, "")...)
	}
	for _, ep := range external {
		sub := a.scanSingleRoot(ep.Path, ep.Name)
		models = append(models, sub...)
	}

	// Deduplicate by FilePath+ZipInner
	seen := make(map[string]bool)
	deduped := models[:0]
	for _, m := range models {
		key := m.PMXPath + ":" + m.ZipInner
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, m)
	}

	return deduped, nil
}

// GetModelMeta parses the PMX header for a single PMX file and returns its metadata.
// Returns empty meta on error (non-fatal).
func (a *App) GetModelMeta(pmxPath string) (ModelMeta, error) {
	meta, err := ParsePMXHeader(pmxPath)
	if err != nil || meta == nil {
		return ModelMeta{}, nil
	}
	m := ModelMeta{}
	if !isGarbageModelName(meta.NameJp) {
		m.NameJp = meta.NameJp
	}
	if !isGarbageModelName(meta.NameEn) {
		m.NameEn = meta.NameEn
	}
	m.Comment = truncate(meta.CommentJp, 200)
	return m, nil
}

// GetModelMetaBatch parses PMX headers for multiple PMX files at once.
// Returns a map keyed by pmxPath, with empty meta for unparseable files.
func (a *App) GetModelMetaBatch(paths []string) (map[string]ModelMeta, error) {
	result := make(map[string]ModelMeta, len(paths))
	for _, p := range paths {
		meta, err := a.GetModelMeta(p)
		if err == nil {
			result[p] = meta
		}
	}
	return result, nil
}

// scanSingleRoot scans a single root directory, producing ModelEntry with the given source.
func (a *App) scanSingleRoot(root string, source string) []ModelEntry {
	var models []ModelEntry

	// Compute thumbnail dir once for HasThumb checks
	thumbDir, _ := thumbnailDir()

	topEntries, err := os.ReadDir(root)
	if err != nil {
		runtime.LogWarningf(a.ctx, "scanSingleRoot: skipping %s: %v", root, err)
		return nil
	}

	for _, entry := range topEntries {
		if !entry.IsDir() {
			continue
		}
		dirName := strings.ToLower(entry.Name())
		catType, isCategory := dancexrCategories[dirName]
		catDir := filepath.Join(root, entry.Name())

		if isCategory {
			subModels := scanDirRecursive(catDir, entry.Name(), catType, thumbDir)
			models = append(models, subModels...)
		} else {
			subModels := scanDirRecursive(catDir, "", "other", thumbDir)
			models = append(models, subModels...)
		}
	}

	flatModels := scanDirRecursive(root, "", "other", thumbDir)
	models = append(models, flatModels...)

	// Stamp source on all entries
	for i := range models {
		models[i].Source = source
	}

	return models
}

// scanDirRecursive walks dir recursively and returns ModelEntry for .pmx, .vmd, .zip files.
// category is the DanceXR top-level directory name if applicable.
// thumbDir is the thumbnail cache directory; empty string skips thumbnail check.
func scanDirRecursive(dir string, category string, entryType string, thumbDir string) []ModelEntry {
	var models []ModelEntry

	filepath.WalkDir(dir, func(walkPath string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip inaccessible paths
		}

		// Skip dot-directories (like .git, .svn)
		if d.IsDir() && strings.HasPrefix(d.Name(), ".") {
			return filepath.SkipDir
		}

		if d.IsDir() {
			return nil
		}

		// Normalize path separators: Go filepath uses \, frontend needs /
		walkPath = filepath.ToSlash(walkPath)

		lowerName := strings.ToLower(d.Name())

		switch {
		case strings.HasSuffix(lowerName, ".pmx"):
			m := ModelEntry{
				Dir:       filepath.Dir(walkPath),
				PMXPath:   walkPath,
				Format:    "pmx",
				Container: "file",
				Category:  category,
				NameEn:    cleanModelName(strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))),
			}
			// Infer type from category, or default to "actor" for pmx
			if entryType != "" && entryType != "other" {
				m.Type = entryType
			} else {
				m.Type = "actor"
			}
			if thumbDir != "" {
				thumbPath := filepath.Join(thumbDir, sha256Hex(walkPath)+".png")
				if _, err := os.Stat(thumbPath); err == nil {
					m.HasThumb = true
				}
			}
			models = append(models, m)

		case strings.HasSuffix(lowerName, ".vmd"):
			m := ModelEntry{
				Dir:       filepath.Dir(walkPath),
				PMXPath:   walkPath,
				Format:    "vmd",
				Container: "file",
				NameEn:    cleanModelName(strings.TrimSuffix(d.Name(), ".vmd")),
				Category:  category,
			}
			if entryType != "" && entryType != "other" {
				m.Type = entryType
			} else {
				m.Type = "motion"
			}
			models = append(models, m)

		case strings.HasSuffix(lowerName, ".zip"):
			// Traverse zip entries for .pmx/.vmd without extracting.
			zr, err := zip.OpenReader(walkPath)
			if err != nil {
				return nil // skip unreadable zip
			}
			defer zr.Close()

			for _, zf := range zr.File {
				// Decode zip entry name (Shift-JIS → UTF-8 if needed)
				entryName := decodeZipName(zf.Name, zf.NonUTF8)
				zfLower := strings.ToLower(entryName)
				var innerFormat string
				if strings.HasSuffix(zfLower, ".pmx") {
					innerFormat = "pmx"
				} else if strings.HasSuffix(zfLower, ".vmd") {
					innerFormat = "vmd"
				} else {
					continue
				}

				innerName := filepath.Base(entryName)
				// Zip entries get Dir = zip dir + "/" + zip basename (without .zip),
				// making the zip appear as a virtual folder in the library tree.
				zipBase := strings.TrimSuffix(filepath.Base(walkPath), ".zip")
				m := ModelEntry{
					Dir:       filepath.ToSlash(filepath.Dir(walkPath)) + "/" + zipBase,
					PMXPath:   walkPath,
					Format:    innerFormat,
					Container: "zip",
					ZipInner:  entryName,
					NameEn:    strings.TrimSuffix(innerName, filepath.Ext(innerName)),
					Category:  category,
				}
				if entryType != "" && entryType != "other" {
					m.Type = entryType
				} else if innerFormat == "pmx" {
					m.Type = "actor"
				} else {
					m.Type = "motion"
				}


				models = append(models, m)
			}
		}

		return nil
	})

	return models
}

// GetConfig reads the persisted config from disk.
// Returns an empty Config (no error) if file doesn't exist.
func (a *App) GetConfig() (*Config, error) {
	dir, err := configDir()
	if err != nil {
		return &Config{}, nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return &Config{}, nil
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return &Config{}, nil
	}
	return &cfg, nil
}

// updateConfig loads the config, runs a mutation under configMu, then persists.
// If rescan is true, it also re-scans the model index.
func (a *App) updateConfig(mutate func(*Config), rescan bool) error {
	a.configMu.Lock()
	defer a.configMu.Unlock()
	cfg, err := a.GetConfig()
	if err != nil {
		cfg = &Config{}
	}
	mutate(cfg)
	if rescan {
		return a.writeConfigAndRescan(cfg)
	}
	return a.writeConfig(cfg)
}

// SetLibraryRoot persists the library root path (preserving external paths) and triggers a rescan+reindex.
func (a *App) SetLibraryRoot(root string) error {
	return a.updateConfig(func(cfg *Config) { cfg.LibraryRoot = root }, true)
}

// AddExternalPath adds an external library path with auto-generated basename name, triggers rescan+reindex.
func (a *App) AddExternalPath(path string) error {
	name := filepath.Base(path)
	if name == "" || name == "." || name == "/" {
		name = "external"
	}
	return a.updateConfig(func(cfg *Config) {
		cfg.ExternalPaths = append(cfg.ExternalPaths, ExternalPath{Path: path, Name: name})
	}, true)
}

// RemoveExternalPath removes an external library by path, triggers rescan+reindex.
func (a *App) RemoveExternalPath(path string) error {
	return a.updateConfig(func(cfg *Config) {
		var kept []ExternalPath
		for _, ep := range cfg.ExternalPaths {
			if ep.Path != path {
				kept = append(kept, ep)
			}
		}
		cfg.ExternalPaths = kept
	}, true)
}

// RenameExternalPath renames an external library display name.
func (a *App) RenameExternalPath(path, name string) error {
	return a.updateConfig(func(cfg *Config) {
		for i, ep := range cfg.ExternalPaths {
			if ep.Path == path {
				cfg.ExternalPaths[i].Name = name
				break
			}
		}
	}, true)
}

// SetBlenderPath saves the Blender executable path to config.
func (a *App) SetBlenderPath(path string) error {
	return a.updateConfig(func(cfg *Config) { cfg.BlenderPath = path }, false)
}

// SetDisplayNamePriority persists the display name priority setting.
func (a *App) SetDisplayNamePriority(priority string) error {
	return a.updateConfig(func(cfg *Config) { cfg.DisplayNamePriority = priority }, false)
}

// ToggleFavorite adds or removes a libraryRef from the favorites list.
func (a *App) ToggleFavorite(libraryRef string) error {
	return a.updateConfig(func(cfg *Config) {
		found := false
		filtered := make([]string, 0, len(cfg.Favorites))
		for _, f := range cfg.Favorites {
			if f == libraryRef {
				found = true
				continue
			}
			filtered = append(filtered, f)
		}
		if !found {
			filtered = append(filtered, libraryRef)
		}
		cfg.Favorites = filtered
	}, false) // false = 不触发 rescan，轻写
}

// GetFavorites returns the current favorites list.
func (a *App) GetFavorites() []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil {
		return nil
	}
	return cfg.Favorites
}

// ======== Tag System ========

// AddTag adds a tag to a model identified by its libraryRef.
func (a *App) AddTag(libraryRef, tag string) error {
	return a.updateConfig(func(cfg *Config) {
		if cfg.Tags == nil {
			cfg.Tags = make(map[string][]string)
		}
		tags := cfg.Tags[libraryRef]
		for _, t := range tags {
			if t == tag {
				return // already exists
			}
		}
		cfg.Tags[libraryRef] = append(tags, tag)
	}, false)
}

// RemoveTag removes a tag from a model.
func (a *App) RemoveTag(libraryRef, tag string) error {
	return a.updateConfig(func(cfg *Config) {
		tags := cfg.Tags[libraryRef]
		var kept []string
		for _, t := range tags {
			if t != tag {
				kept = append(kept, t)
			}
		}
		if len(kept) == 0 {
			delete(cfg.Tags, libraryRef)
		} else {
			cfg.Tags[libraryRef] = kept
		}
	}, false)
}

// GetTagsByModel returns the tags for a specific model.
func (a *App) GetTagsByModel(libraryRef string) []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.Tags == nil {
		return nil
	}
	return cfg.Tags[libraryRef]
}

// GetAllTags returns a deduplicated list of all tags across all models.
func (a *App) GetAllTags() []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.Tags == nil {
		return nil
	}
	seen := make(map[string]bool)
	var result []string
	for _, tags := range cfg.Tags {
		for _, t := range tags {
			if !seen[t] {
				seen[t] = true
				result = append(result, t)
			}
		}
	}
	return result
}

// GetModelsByTag returns all libraryRefs that have a specific tag.
func (a *App) GetModelsByTag(tag string) []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.Tags == nil {
		return nil
	}
	var result []string
	for ref, tags := range cfg.Tags {
		for _, t := range tags {
			if t == tag {
				result = append(result, ref)
				break
			}
		}
	}
	return result
}

// ======== Dance Sets ========

// GetDanceSets returns all dance sets.
func (a *App) GetDanceSets() []DanceSet {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.DanceSets == nil {
		return nil
	}
	result := make([]DanceSet, 0, len(cfg.DanceSets))
	for _, ds := range cfg.DanceSets {
		result = append(result, ds)
	}
	return result
}

// SaveDanceSet saves or updates a dance set with the given id.
func (a *App) SaveDanceSet(id string, ds DanceSet) error {
	return a.updateConfig(func(cfg *Config) {
		if cfg.DanceSets == nil {
			cfg.DanceSets = make(map[string]DanceSet)
		}
		cfg.DanceSets[id] = ds
	}, false)
}

// DeleteDanceSet deletes a dance set by id.
func (a *App) DeleteDanceSet(id string) error {
	return a.updateConfig(func(cfg *Config) {
		if cfg.DanceSets != nil {
			delete(cfg.DanceSets, id)
		}
	}, false)
}

// ImportDanceSet creates a dance set from a VMD file and audio file.
// Returns the generated dance set id.
func (a *App) ImportDanceSet(vmdPath, audioPath, name string) (string, error) {
	if vmdPath == "" {
		return "", fmt.Errorf("VMD 文件路径不能为空")
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(vmdPath), filepath.Ext(vmdPath))
	}
	id := sha256Hex(vmdPath + ":" + audioPath)[:16]
	ds := DanceSet{
		Name:        name,
		VmdPath:     vmdPath,
		AudioPath:   audioPath,
		AudioOffset: 0,
		Description: "",
		Thumbnail:   "",
		Source:      "",
	}
	err := a.SaveDanceSet(id, ds)
	if err != nil {
		return "", err
	}
	return id, nil
}

// ======== Render Presets ========

// SaveRenderPreset saves or updates a named render preset.
// params is a JSON string of the RenderState fields.
func (a *App) SaveRenderPreset(name string, params string) error {
	return a.updateConfig(func(cfg *Config) {
		// Parse the params JSON into a generic map
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(params), &parsed); err != nil {
			parsed = make(map[string]interface{})
		}
		// Update or append
		for i, p := range cfg.RenderPresets {
			if p.Name == name {
				cfg.RenderPresets[i].Params = parsed
				return
			}
		}
		cfg.RenderPresets = append(cfg.RenderPresets, RenderPreset{Name: name, Params: parsed})
	}, false)
}

// DeleteRenderPreset removes a named render preset.
func (a *App) DeleteRenderPreset(name string) error {
	return a.updateConfig(func(cfg *Config) {
		var kept []RenderPreset
		for _, p := range cfg.RenderPresets {
			if p.Name != name {
				kept = append(kept, p)
			}
		}
		cfg.RenderPresets = kept
	}, false)
}

// GetRenderPresets returns all user-defined render presets.
func (a *App) GetRenderPresets() []RenderPreset {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil {
		return nil
	}
	return cfg.RenderPresets
}

// ======== Blender Integration ========

// defaultBlenderCandidates lists common Windows install paths for Blender.
var defaultBlenderCandidates = []string{
	"C:/Program Files/Blender Foundation/Blender 4.3/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 4.2/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 4.1/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 4.0/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 3.6/blender.exe",
	"C:/Program Files/Blender Foundation/Blender/blender.exe",
}

// detectBlender attempts to find Blender on the system.
func detectBlender() string {
	return detectBlenderAt(exec.LookPath, defaultBlenderCandidates)
}

// detectBlenderAt is the testable pure version: tries lookPath then stats candidates.
func detectBlenderAt(lookPath func(name string) (string, error), candidates []string) string {
	if p, err := lookPath("blender"); err == nil {
		return p
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// OpenInBlender launches Blender and opens the specified model file.
func (a *App) OpenInBlender(modelPath string) error {
	cfg, _ := a.GetConfig()
	blenderPath := cfg.BlenderPath
	if blenderPath == "" {
		blenderPath = detectBlender()
	}
	if blenderPath == "" {
		return fmt.Errorf("未找到 Blender，请在设置中配置路径")
	}

	cmd := exec.Command(blenderPath, modelPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 Blender 失败")
	}

	runtime.LogInfof(a.ctx, "Blender started for %s", modelPath)
	return nil
}

// ======== MikuMikuDance Integration ========

// defaultMMDCandidates lists common Windows install paths for MikuMikuDance.
var defaultMMDCandidates = []string{
	"C:/Program Files/MikuMikuDance/mmd.exe",
	"C:/Program Files/MikuMikuDance/MikuMikuDance.exe",
	"C:/Program Files (x86)/MikuMikuDance/mmd.exe",
	"C:/Program Files (x86)/MikuMikuDance/MikuMikuDance.exe",
}

// detectMMD attempts to find MMD on the system.
func detectMMD() string {
	return detectMMDAt(exec.LookPath, os.Stat, defaultMMDCandidates)
}

// detectMMDAt is the testable pure version: tries lookPath then stats candidates.
func detectMMDAt(lookPath func(name string) (string, error), stat func(name string) (os.FileInfo, error), candidates []string) string {
	if p, err := lookPath("mmd"); err == nil {
		return p
	}
	for _, c := range candidates {
		if _, err := stat(c); err == nil {
			return c
		}
	}
	return ""
}

// SetMMDPath saves the MMD executable path to config.
// If path is empty, automatically detects MMD from common install locations.
func (a *App) SetMMDPath(path string) error {
	return a.updateConfig(func(cfg *Config) { cfg.MMDPath = path }, false)
}

// AutoDetectMMD searches for MMD in common install paths and saves the result.
// Returns the detected path, or an error if not found.
func (a *App) AutoDetectMMD() (string, error) {
	path := detectMMD()
	if path == "" {
		return "", fmt.Errorf("未找到 MikuMikuDance")
	}
	if err := a.SetMMDPath(path); err != nil {
		return "", err
	}
	return path, nil
}

// OpenInMMD launches MikuMikuDance and opens the specified model file.
func (a *App) OpenInMMD(modelPath string) error {
	cfg, _ := a.GetConfig()
	mmdPath := cfg.MMDPath
	if mmdPath == "" {
		mmdPath = detectMMD()
	}
	if mmdPath == "" {
		return fmt.Errorf("未找到 MikuMikuDance，请在设置中配置路径")
	}

	cmd := exec.Command(mmdPath, modelPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 MMD 失败")
	}

	runtime.LogInfof(a.ctx, "MMD started for %s", modelPath)
	return nil
}

// ======== Software Management ========

// ScanSoftwareDir scans the software/ directory for .exe files and returns entries.
func (a *App) ScanSoftwareDir() ([]SoftwareEntry, error) {
	dir, err := softwareDir()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SoftwareEntry{}, nil
		}
		return nil, fmt.Errorf("读取软件目录失败")
	}

	var result []SoftwareEntry
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".exe") {
			continue
		}
		ext := filepath.Ext(name)
		displayName := strings.TrimSuffix(name, ext)
		result = append(result, SoftwareEntry{
			Name: displayName,
			Path: filepath.Join(dir, name),
			Icon: "", // reserved for future icon extraction
		})
	}

	return result, nil
}

// LaunchSoftware starts an executable by path.
func (a *App) LaunchSoftware(path string) error {
	cmd := exec.Command(path)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动软件失败")
	}
	runtime.LogInfof(a.ctx, "Launched software: %s", path)
	return nil
}

// OpenSoftwareDir opens the software directory in the system file manager.
func (a *App) OpenSoftwareDir() error {
	dir, err := softwareDir()
	if err != nil {
		return err
	}
	// Ensure the directory exists
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建软件目录失败")
	}
	// Cross-platform: open file manager
	var cmd *exec.Cmd
	switch stdruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

// SaveSceneFile writes a JSON scene file to the given path.
func (a *App) SaveSceneFile(jsonStr string, path string) error {
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadSceneFile reads a JSON scene file from the given path.
func (a *App) LoadSceneFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SelectSceneSaveFile opens a save dialog for scene files.
func (a *App) SelectSceneSaveFile() (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存场景",
		DefaultFilename: "scene.mmascene",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "MikuMikuAR Scene (*.mmascene)",
				Pattern:     "*.mmascene",
			},
			{
				DisplayName: "All Files (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// SelectSceneOpenFile opens a file dialog to pick a scene file.
func (a *App) SelectSceneOpenFile() (string, error) {
	return a.openFileDialog("加载场景", []runtime.FileFilter{
		{
			DisplayName: "MikuMikuAR Scene (*.mmascene)",
			Pattern:     "*.mmascene",
		},
		{
			DisplayName: "All Files (*.*)",
			Pattern:     "*.*",
		},
	})
}

// SaveLastScene stores the current scene state for auto-recovery on next launch.
func (a *App) SaveLastScene(jsonStr string) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "last_scene.json"), []byte(jsonStr), 0644)
}

// LoadLastScene reads the auto-saved scene state.
func (a *App) LoadLastScene() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, "last_scene.json"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// writeConfig persists only the config JSON (no rescan). Use for settings changes
// that don't affect the model index (e.g. Blender path).
func (a *App) writeConfig(cfg *Config) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.json"), data, 0644)
}

// writeConfigAndRescan persists the config, runs a full scan with current settings,
// and writes index.json.
func (a *App) writeConfigAndRescan(cfg *Config) error {
	if err := a.writeConfig(cfg); err != nil {
		return err
	}
	// Scan and write index
	models, err := a.ScanModelDir(cfg.LibraryRoot, cfg.ExternalPaths)
	if err != nil {
		return err
	}
	idxData, err := json.Marshal(models)
	if err != nil {
		return err
	}
	dir, err := configDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "index.json"), idxData, 0644)
}

// GetLibraryIndex reads the last scanned index from disk.
func (a *App) GetLibraryIndex() ([]ModelEntry, error) {
	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		return nil, err
	}
	var models []ModelEntry
	if err := json.Unmarshal(data, &models); err != nil {
		return nil, err
	}
	// Filter out entries with empty FilePath — they come from old index.json
	// that still used "pmx_path" as the JSON key before the rename.
	valid := models[:0]
	for _, m := range models {
		if m.PMXPath != "" {
			valid = append(valid, m)
		}
	}
	if len(valid) != len(models) {
		runtime.LogInfof(a.ctx, "GetLibraryIndex: filtered %d stale entries (empty file_path)", len(models)-len(valid))
	}
	return valid, nil
}

// ======== Zip Extraction (Week 5-6) ========

// ExtractResult holds the result of a zip extraction.
type ExtractResult struct {
	FilePath string `json:"file_path"` // Absolute path to extracted file (PMX or VMD)
	Dir     string `json:"dir"`      // Extraction root directory (for HTTP server)
	Cached  bool   `json:"cached"`   // Whether cache was hit (no re-extract)
}

const extractCacheVersion = 5

// manifest stores source zip metadata for cache validation.
type manifest struct {
	Source  string `json:"source"`
	Mtime   int64  `json:"mtime"`
	Size    int64  `json:"size"`
	Version int    `json:"version,omitempty"`
}

// zipCacheName converts an absolute zip path into a safe directory name.
// "C:\Users\models\miku.zip" → "C__Users_models_miku_zip"
func zipCacheName(zipPath string) string {
	abs, err := filepath.Abs(zipPath)
	if err != nil {
		abs = zipPath
	}
	s := strings.NewReplacer(":", "_", string(filepath.Separator), "_", " ", "_").Replace(abs)
	return s
}

// ExtractZip extracts a zip file to the cache directory and returns the path
// to the extracted PMX file specified by innerPath.
//
// Cache hit: if the source zip's mtime and size haven't changed since last
// extraction, returns the cached path immediately (Cached=true).
//
// Cache miss: removes the old cache directory, re-extracts the entire zip,
// writes a manifest.json, and returns the extracted path (Cached=false).
//
// Zip slip protection: validates that every extracted entry stays within the
// destination directory.
func (a *App) ExtractZip(zipPath, innerPath string) (*ExtractResult, error) {
	cacheRoot, err := extractedDir()
	if err != nil {
		return nil, fmt.Errorf("解压失败")
	}

	dest := filepath.Join(cacheRoot, zipCacheName(zipPath))

	// Stat source zip
	srcInfo, err := os.Stat(zipPath)
	if err != nil {
		return nil, fmt.Errorf("压缩包无法访问")
	}
	srcMtime := srcInfo.ModTime().Unix()
	srcSize := srcInfo.Size()

	// Check manifest cache
	manifestPath := filepath.Join(dest, "manifest.json")
	if data, err := os.ReadFile(manifestPath); err == nil {
		var m manifest
		if json.Unmarshal(data, &m) == nil && m.Source == zipPath && m.Mtime == srcMtime && m.Size == srcSize && m.Version == extractCacheVersion {
			cachedPMX := filepath.ToSlash(filepath.Join(dest, innerPath))
			destSlash := filepath.ToSlash(dest)
			runtime.LogInfof(a.ctx, "ExtractZip: cache hit %s → %s", zipPath, cachedPMX)
			return &ExtractResult{FilePath: cachedPMX, Dir: destSlash, Cached: true}, nil
		}
	}

	// Cache miss — re-extract
	runtime.LogInfof(a.ctx, "ExtractZip: extracting %s → %s", zipPath, dest)
	os.RemoveAll(dest)
	if err := os.MkdirAll(dest, 0755); err != nil {
		return nil, fmt.Errorf("创建缓存目录失败")
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("打开压缩包失败")
	}
	defer zr.Close()

	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return nil, fmt.Errorf("解析路径失败")
	}
	destPrefix := destAbs + string(filepath.Separator)

	for _, zf := range zr.File {
		// Decode entry name (Shift-JIS → UTF-8) so extracted files match model entries
		entryName := decodeZipName(zf.Name, zf.NonUTF8)

		// Zip slip protection: reject paths that escape destAbs
		target := filepath.Join(destAbs, entryName)
		targetAbs, err := filepath.Abs(target)
		if err != nil {
			continue
		}
		if !strings.HasPrefix(targetAbs, destPrefix) {
			runtime.LogInfof(a.ctx, "ExtractZip: zip slip blocked: %s", entryName)
			continue
		}

		if zf.FileInfo().IsDir() {
			os.MkdirAll(targetAbs, 0755)
			continue
		}

		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(targetAbs), 0755); err != nil {
			continue
		}

		rc, err := zf.Open()
		if err != nil {
			continue
		}

		outFile, err := os.OpenFile(targetAbs, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, zf.Mode())
		if err != nil {
			rc.Close()
			continue
		}

		if _, err := io.Copy(outFile, rc); err != nil {
			runtime.LogErrorf(a.ctx, "ExtractZip: copy error for %s: %v", entryName, err)
		}
		outFile.Close()
		rc.Close()
	}

	// Write manifest
	m := manifest{Source: zipPath, Mtime: srcMtime, Size: srcSize, Version: extractCacheVersion}
	mData, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("保存索引失败")
	}
	if err := os.WriteFile(manifestPath, mData, 0644); err != nil {
		return nil, fmt.Errorf("写入索引失败")
	}

	resultPath := filepath.ToSlash(filepath.Join(dest, innerPath))
	destSlash := filepath.ToSlash(dest)
	runtime.LogInfof(a.ctx, "ExtractZip: done → %s", resultPath)
	return &ExtractResult{FilePath: resultPath, Dir: destSlash, Cached: false}, nil
}

// CleanOrphanCache cleans extraction cache whose source zip no longer exists.
func (a *App) CleanOrphanCache() (int, error) {
	cacheRoot, err := extractedDir()
	if err != nil {
		return 0, err
	}

	entries, err := os.ReadDir(cacheRoot)
	if err != nil {
		return 0, err
	}

	cleaned := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		mp := filepath.Join(cacheRoot, entry.Name(), "manifest.json")
		data, err := os.ReadFile(mp)
		if err != nil {
			continue
		}
		var m manifest
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if _, err := os.Stat(m.Source); os.IsNotExist(err) {
			os.RemoveAll(filepath.Join(cacheRoot, entry.Name()))
			cleaned++
			runtime.LogInfof(a.ctx, "CleanOrphanCache: removed %s (source %s gone)", entry.Name(), m.Source)
		}
	}
	runtime.LogInfof(a.ctx, "CleanOrphanCache: cleaned %d directories", cleaned)
	return cleaned, nil
}

// ClearExtractCache removes ALL extraction cache directories, forcing
// re-extraction on the next model load (with current encoding fixes).
func (a *App) ClearExtractCache() error {
	cacheRoot, err := extractedDir()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(cacheRoot)
	if err != nil {
		return err
	}
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() {
			os.RemoveAll(filepath.Join(cacheRoot, entry.Name()))
			removed++
		}
	}
	runtime.LogInfof(a.ctx, "ClearExtractCache: removed %d directories", removed)
	return nil
}

// ImportZip opens a zip file, finds the first .pmx entry, and extracts via ExtractZip.
// Returns *ExtractResult as a convenience for the frontend import flow.
func (a *App) ImportZip(zipPath string) (*ExtractResult, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("打开压缩包失败")
	}
	var firstPmx string
	for _, zf := range zr.File {
		entryName := decodeZipName(zf.Name, zf.NonUTF8)
		if strings.HasSuffix(strings.ToLower(entryName), ".pmx") {
			firstPmx = entryName
			break
		}
	}
	zr.Close()
	if firstPmx == "" {
		return nil, fmt.Errorf("压缩包内未找到模型文件")
	}
	return a.ExtractZip(zipPath, firstPmx)
}

// decodeZipName converts a zip entry name from the system encoding to UTF-8.
// Uses the NonUTF8 flag from the zip file header (Go 1.20+): when true,
// the name is encoded in the system's code page (Shift-JIS for Japanese Windows,
// GBK for Chinese Windows). Falls back to utf8.ValidString heuristic for zips
// that don't set the flag.
// Tries both Shift-JIS and GBK (common code pages in East Asia) and picks the
// decoding that produces fewer encoding errors and more CJK characters.
func decodeZipName(name string, nonUTF8 bool) string {
	if !nonUTF8 && utf8.ValidString(name) {
		return cleanControlChars(name)
	}
	return bestDecode(name)
}

// bestDecode tries to decode a non-UTF-8 string using Shift-JIS and GBK,
// returning the result with the fewest encoding errors.
func bestDecode(raw string) string {
	type candidate struct {
		decoded string
		score   int // higher = better (fewer errors, more CJK)
		name    string
	}
	var candidates []candidate

	for _, dec := range []struct {
		decode func(string) (string, error)
		name   string
	}{
		{func(s string) (string, error) {
			d, _, e := transform.String(japanese.ShiftJIS.NewDecoder(), s)
			return d, e
		}, "sjis"},
		{func(s string) (string, error) {
			d, _, e := transform.String(simplifiedchinese.GBK.NewDecoder(), s)
			return d, e
		}, "gbk"},
	} {
		decoded, err := dec.decode(raw)
		if decoded == "" {
			continue
		}
		cleaned := cleanControlChars(decoded)
		// Score: +2 per CJK ideograph, +1 per kana/punctuation, -5 per RuneError
		// +10 bonus if decoder returned no error (clean decode preferred)
		// +3 bonus for Shift-JIS (most common encoding for Japanese/MMD zips)
		score := 0
		if err == nil {
			score += 10
		}
		if dec.name == "sjis" {
			score += 3
		}
		for _, r := range cleaned {
			if r == utf8.RuneError {
				score -= 5
			} else if r >= 0x4E00 && r <= 0x9FFF {
				score += 2 // CJK Unified Ideographs
			} else if r >= 0x3040 && r <= 0x30FF {
				score += 1 // Hiragana/Katakana
			} else if r >= 0x3000 && r <= 0x303F {
				score += 1 // CJK Symbols and Punctuation
			} else if r >= 0xFF00 && r <= 0xFFEF {
				score -= 1 // Half-width / full-width forms (possible corruption)
			}
		}
		candidates = append(candidates, candidate{cleaned, score, dec.name})
	}

	if len(candidates) == 0 {
		return cleanControlChars(raw)
	}

	// Pick the best candidate
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.score > best.score {
			best = c
		}
	}
	return best.decoded
}

// cleanControlChars removes or replaces control characters and RuneError from a string.
func cleanControlChars(s string) string {
	cleaned := make([]rune, 0, len(s))
	for _, r := range s {
		if r == utf8.RuneError {
			continue
		}
		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r >= 0x7F && r <= 0x9F {
			continue
		}
		cleaned = append(cleaned, r)
	}
	return string(cleaned)
}

// cleanModelName converts a filesystem entry name (from d.Name()) to clean UTF-8.
// On Windows, Go always returns valid UTF-8 from filepath.WalkDir, but the Unicode
// may be corrupted if the file was created via ANSI API with a different code page.
// This function detects and repairs the common case where Shift-JIS bytes were
// passed through the GBK code page, producing half-width katakana Unicode text.
func cleanModelName(name string) string {
	if name == "" {
		return name
	}
	if !utf8.ValidString(name) {
		return bestDecode(name)
	}
	// If already valid clean UTF-8 with no suspicious patterns, use as-is
	// Check for half-width katakana domination (sign of code page corruption)
	hwCount := 0
	for _, r := range name {
		if r >= 0xFF61 && r <= 0xFF9F {
			hwCount++
		}
	}
	nonASCII := 0
	for _, r := range name {
		if r > 0x7F {
			nonASCII++
		}
	}
	// If <50% of non-ASCII chars are half-width katakana, name looks clean
	if nonASCII == 0 || hwCount*2 <= nonASCII {
		return name
	}
	// Half-width katakana dominated — try to recover by mapping each
	// half-width katakana back to its Shift-JIS byte, then decode as GBK.
	raw := make([]byte, 0, len(name))
	for _, r := range name {
		if r >= 0xFF61 && r <= 0xFF9F {
			// U+FF61-U+FF9F → Shift-JIS 0xA1-0xDF
			raw = append(raw, byte(r-0xFF61+0xA1))
		} else if r <= 0x7F {
			raw = append(raw, byte(r))
		}
		// Skip other non-ASCII chars (corruption artifacts)
	}
	if len(raw) > 0 {
		if decoded, _, err := transform.String(simplifiedchinese.GBK.NewDecoder(), string(raw)); err == nil {
			cleaned := cleanControlChars(decoded)
			if cleaned != "" {
				return cleaned
			}
		}
	}
	return name
}

// MMD 圈常见——模型作者把使用条款写在 name_jp 字段里
var garbageNameWords = []string{
	"允许改造", "禁止改造", "只允许",
	"优化骨骼", "重制UV",
	"再配布", "改変",
	"======",
}

func isGarbageModelName(name string) bool {
	for _, w := range garbageNameWords {
		if strings.Contains(name, w) {
			return true
		}
	}
	return false
}

// truncate limits a string to n runes, appending "…" if truncated.
func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

// corsMiddleware adds CORS headers for Wails WebView cross-origin access.
// Sets Access-Control-Allow-Origin: * (unconditional) — desktop app has no
// CSRF risk; the file server binds to 127.0.0.1 so only local processes can
// reach it.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// basenameFallbackFS builds a basename→real-path index then wraps an http.FileServer
// so that if a path 404s, we try to find a file with the same basename anywhere
// under the root. This handles PMX texture path mismatches (..\ subdirs,
// different casing, Chinese/shortened names).
func basenameFallbackFS(root string, logFn func(string, ...interface{})) http.Handler {
	// Build basename index: lowercase basename → first real path found
	index := make(map[string]string)
	filepath.WalkDir(root, func(walkPath string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, walkPath)
		base := strings.ToLower(d.Name())
		if _, exists := index[base]; !exists {
			index[base] = rel
		}
		return nil
	})
	if logFn != nil {
		logFn("FS: indexed %d files under %s", len(index), root)
	}

	fs := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if logFn != nil {
			logFn("FS: %s %s", r.Method, r.URL.Path)
		}

		// Buffer the file server response so we can intercept 404s
		bw := &bufferingResponseWriter{ResponseWriter: w}
		fs.ServeHTTP(bw, r)

		if bw.code != http.StatusNotFound {
			// Not a 404 — commit the real status and body
			bw.flush()
			return
		}

		// 404 — try basename fallback
		// URL-decode the path first so basename matches the file system name
		decodedPath := r.URL.Path
		if unescaped, err := url.PathUnescape(decodedPath); err == nil {
			decodedPath = unescaped
		}
		reqBase := strings.ToLower(path.Base(decodedPath))
		relPath, ok := index[reqBase]
		if !ok {
			// Fallback miss — flush the original 404 response
			bw.flush()
			if logFn != nil {
				logFn("FS: basename %q not found in index either", reqBase)
			}
			return
		}
		if logFn != nil {
			logFn("FS: fallback %s → %s", r.URL.Path, relPath)
		}
		// Clear any headers the FileServer set during its 404 path
		delete(w.Header(), "Content-Type")
		delete(w.Header(), "Content-Length")
		delete(w.Header(), "X-Content-Type-Options")
		// Overwrite the 404 with the fallback file
		fullPath := filepath.Join(root, relPath)
		r.URL.Path = "/" + filepath.ToSlash(relPath)
		http.ServeFile(w, r, fullPath)
	})
}

// bufferingResponseWriter buffers the entire response so we can inspect
// the status code before committing. Used by basenameFallbackFS.
type bufferingResponseWriter struct {
	code int
	buf  bytes.Buffer
	http.ResponseWriter
}

func (w *bufferingResponseWriter) WriteHeader(code int) {
	w.code = code
}

func (w *bufferingResponseWriter) Write(p []byte) (int, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return w.buf.Write(p)
}

// flush commits the buffered status + body to the real writer.
func (w *bufferingResponseWriter) flush() {
	code := w.code
	if code == 0 {
		code = http.StatusOK
	}
	w.ResponseWriter.WriteHeader(code)
	if w.buf.Len() > 0 {
		w.ResponseWriter.Write(w.buf.Bytes())
	}
}

// StartFileServer starts (or reuses) an HTTP file server for dirPath,
// serving files with basename fallback for texture lookup.
// Multiple directories each get their own port; servers are never killed
// until the app shuts down.
func (a *App) StartFileServer(dirPath string) (int, error) {
	a.httpSrvMu.Lock()
	defer a.httpSrvMu.Unlock()

	// Reuse existing server for this directory
	if info, ok := a.httpServers[dirPath]; ok {
		runtime.LogInfof(a.ctx, "StartFileServer: reuse port %d for %s", info.port, dirPath)
		return info.port, nil
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}

	port := listener.Addr().(*net.TCPAddr).Port
	runtime.LogInfof(a.ctx, "StartFileServer: dir=%s port=%d", dirPath, port)

	handler := corsMiddleware(basenameFallbackFS(dirPath, func(format string, args ...interface{}) {
		runtime.LogInfof(a.ctx, format, args...)
	}))

	srv := &http.Server{Handler: handler}
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			runtime.LogErrorf(a.ctx, "StartFileServer: Serve error: %v", err)
		}
	}()

	a.httpServers[dirPath] = &httpServerInfo{
		server:   srv,
		port:     port,
		dir:      dirPath,
		listener: listener,
	}

	return port, nil
}

// StopFileServer shuts down the HTTP file server for the given directory.
// Maintained for future cleanup use (e.g., scene teardown, directory unmount).
// Currently unused by the frontend — HTTP servers run until app exit.
func (a *App) StopFileServer(dirPath string) {
	a.httpSrvMu.Lock()
	defer a.httpSrvMu.Unlock()
	if info, ok := a.httpServers[dirPath]; ok {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		info.server.Shutdown(shutdownCtx)
		cancel()
		delete(a.httpServers, dirPath)
		runtime.LogInfof(a.ctx, "StopFileServer: stopped port %d for %s", info.port, dirPath)
	}
}

// ======== Safe Serving (Privacy Isolation) ========

// isolateDir copies the PMX file and ALL its sibling files/subdirectories
// to a temp directory. Uses a hash of the source path to prevent collisions.
func isolateDir(filePath string) (string, error) {
	srcDir := filepath.Dir(filePath)
	hash := sha256Hex(srcDir)[:12]
	dstDir := filepath.Join(os.TempDir(), "MikuMikuAR", "serve", hash)

	// Remove previous stale copy
	os.RemoveAll(dstDir)

	// Copy the PMX/VMD file itself
	baseName := filepath.Base(filePath)
	if err := copyFile(filePath, filepath.Join(dstDir, baseName)); err != nil {
		return srcDir, err // fall back to original if copy fails
	}

	// Copy ALL sibling files and subdirectories (not just dirs — many models
	// have textures like face.bmp sitting next to the .pmx file)
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return dstDir, nil
	}
	for _, e := range entries {
		src := filepath.Join(srcDir, e.Name())
		dst := filepath.Join(dstDir, e.Name())
		if e.IsDir() {
			copyDir(src, dst)
		} else if e.Name() != baseName {
			copyFile(src, dst)
		}
	}
	return dstDir, nil
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		return os.WriteFile(target, data, 0644)
	})
}

// isSafePath checks whether a file path is inside any of the trusted directories
// (library root + external paths). Uses "/"-boundary-aware prefix matching to
// prevent path traversal (e.g. C:/ModelsSecret not matching C:/Models).
func (a *App) isSafePath(filePath string) bool {
	slash := filepath.ToSlash(filePath)

	for _, root := range a.trustedRoots() {
		rootSlash := strings.TrimRight(filepath.ToSlash(root), "/") + "/"
		if strings.HasPrefix(slash, rootSlash) {
			return true
		}
	}
	return false
}

// trustedRoots returns all directory paths that are safe to serve from.
func (a *App) trustedRoots() []string {
	cfg, _ := a.GetConfig()
	roots := make([]string, 0, 1+len(cfg.ExternalPaths))
	if cfg.LibraryRoot != "" {
		roots = append(roots, cfg.LibraryRoot)
	}
	for _, ep := range cfg.ExternalPaths {
		if ep.Path != "" {
			roots = append(roots, ep.Path)
		}
	}
	return roots
}

// IsolateModelDir ensures the model file is served from a safe directory.
// [doc:architecture] IsolateModelDir — 安全隔离：信任目录返回原目录，外部文件复制到 temp
// 规范文档: docs/architecture.md §数据通道（HTTP 文件服务）
// For files inside trusted roots, returns the original directory unchanged.
// For external files, copies PMX + all siblings to a temp directory.
func (a *App) IsolateModelDir(filePath string) (string, error) {
	if a.isSafePath(filePath) {
		return filepath.Dir(filePath), nil
	}
	return isolateDir(filePath)
}

// ======== Thumbnail Cache ========

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// SaveThumbnail saves a base64-encoded PNG thumbnail for the given model path.
func (a *App) SaveThumbnail(modelPath string, base64PNG string) error {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return err
	}
	hash := sha256Hex(modelPath)
	thumbPath := filepath.Join(thumbDir, hash+".png")
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	runtime.LogInfof(a.ctx, "SaveThumbnail: %s → %s (%d bytes)", modelPath, thumbPath, len(data))
	return os.WriteFile(thumbPath, data, 0644)
}

// GetThumbnail returns a base64-encoded PNG thumbnail for the given model path.
func (a *App) GetThumbnail(modelPath string) (string, error) {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return "", err
	}
	hash := sha256Hex(modelPath)
	data, err := os.ReadFile(filepath.Join(thumbDir, hash+".png"))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// GetThumbnailBatch returns thumbnails for multiple model paths at once.
func (a *App) GetThumbnailBatch(paths []string) (map[string]string, error) {
	result := make(map[string]string)
	for _, p := range paths {
		if b64, err := a.GetThumbnail(p); err == nil {
			result[p] = b64
		}
	}
	return result, nil
}

// ======== Download Directory Watching (ADR-008) ========

// watchExts lists the file extensions that trigger watch notifications.
var watchExts = map[string]bool{
	".zip": true,
	".pmx": true,
	".vmd": true,
}

// magicSigs contains the first bytes used to validate file types.
var magicSigs = [][]byte{
	{0x50, 0x4B, 0x03, 0x04}, // ZIP (PK\x03\x04)
	{0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00}, // RAR (Rar!\x1A\x07\x00)
}

// checkMagicNumber reads the first bytes of a file and checks against known signatures.
// Returns true if the file header matches a known archive format.
func checkMagicNumber(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	header := make([]byte, 8)
	n, err := f.Read(header)
	if err != nil || n < 4 {
		return false
	}
	for _, sig := range magicSigs {
		if len(header) >= len(sig) {
			match := true
			for i, b := range sig {
				if header[i] != b {
					match = false
					break
				}
			}
			if match {
				return true
			}
		}
	}
	return false
}

// ImportLocalFile imports a local file into the model library.
// For .zip files, it finds the first .pmx inside and extracts via ImportZip.
// For .pmx/.vmd files, it returns the path directly as an ExtractResult.
func (a *App) ImportLocalFile(path string) (*ExtractResult, error) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".zip":
		return a.ImportZip(path)
	case ".pmx", ".vmd":
		return &ExtractResult{FilePath: path, Dir: filepath.Dir(path)}, nil
	default:
		return nil, fmt.Errorf("不支持的文件格式: %s", ext)
	}
}

// StartWatchDir starts fsnotify-based watching on the specified directory.
// If already watching a directory, it stops the previous watcher first.
// Only files with .zip/.pmx/.vmd extensions trigger notifications,
// filtered through Magic Number detection to skip incomplete downloads.
func (a *App) StartWatchDir(dir string) error {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()

	// Stop existing watcher
	if a.watcher != nil {
		a.watcher.Close()
		a.watcher = nil
		if a.watchTimer != nil {
			a.watchTimer.Stop()
			a.watchTimer = nil
		}
		a.watchPending = nil
	}

	// Verify directory exists
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("监听目录不可访问")
	}
	if !info.IsDir() {
		return fmt.Errorf("路径不是目录: %s", dir)
	}

	// Create new watcher
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("创建文件监听器失败")
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return fmt.Errorf("添加监听目录失败")
	}

	a.watcher = w
	a.watchDir = dir
	a.watchPending = make(map[string]struct{})

	// Start the watch loop goroutine
	go a.watchLoop(w)

	a.safeLogInfo("StartWatchDir: 开始监听 %s", dir)
	return nil
}

// StopWatchDir stops the current directory watcher.
func (a *App) StopWatchDir() error {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()

	if a.watcher == nil {
		return nil // not watching
	}

	a.watcher.Close()
	a.watcher = nil
	a.watchDir = ""
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	a.watchPending = nil

	a.safeLogInfo("StopWatchDir: 已停止监听")
	return nil
}

// SetDownloadWatchDir persists the download watch directory to config
// and restarts the watcher (if dir is non-empty) or stops it (if dir is empty).
func (a *App) SetDownloadWatchDir(dir string) error {
	// Stop current watcher first
	_ = a.StopWatchDir()

	// Persist to config
	err := a.updateConfig(func(cfg *Config) {
		cfg.DownloadWatchDir = dir
	}, false)
	if err != nil {
		return err
	}

	// Start if dir is non-empty
	if dir != "" {
		return a.StartWatchDir(dir)
	}
	return nil
}

// SetDownloadAutoImport persists the auto-import preference to config.
func (a *App) SetDownloadAutoImport(auto bool) error {
	return a.updateConfig(func(cfg *Config) {
		cfg.DownloadAutoImport = auto
	}, false)
}

// GetDownloadWatchStatus returns the current watch state (directory being watched or empty string).
func (a *App) GetDownloadWatchStatus() string {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	return a.watchDir
}

// watchLoop processes fsnotify events with 800ms debounce.
// It filters for Create/Write events on files with known extensions,
// validates Magic Number, and emits watch:newfile events to the frontend.
func (a *App) watchLoop(w *fsnotify.Watcher) {
	for {
		select {
		case event, ok := <-w.Events:
			if !ok {
				return
			}
			// Only interested in Create and Write events
			if event.Op&(fsnotify.Create|fsnotify.Write) == 0 {
				continue
			}
			// Check extension
			ext := strings.ToLower(filepath.Ext(event.Name))
			if !watchExts[ext] {
				continue
			}
			// Validate Magic Number (skip incomplete/corrupt files)
			if !checkMagicNumber(event.Name) {
				continue
			}
			// Store pending file
			a.watchMu.Lock()
			a.watchPending[event.Name] = struct{}{}
			// Reset debounce timer
			if a.watchTimer != nil {
				a.watchTimer.Stop()
			}
			a.watchTimer = time.AfterFunc(800*time.Millisecond, func() {
				a.flushPending()
			})
			a.watchMu.Unlock()

		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			a.safeLogError("watchLoop error: %v", err)
		}
	}
}

// flushPending processes all pending files accumulated during the debounce window.
func (a *App) flushPending() {
	a.watchMu.Lock()
	pending := a.watchPending
	a.watchPending = make(map[string]struct{})
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	a.watchMu.Unlock()

	for path := range pending {
		a.notifyNewFile(path)
	}
}

// notifyNewFile emits a watch:newfile event to the frontend with the detected file info.
func (a *App) notifyNewFile(filePath string) {
	name := filepath.Base(filePath)
	ext := strings.ToLower(filepath.Ext(filePath))
	fileType := "zip"
	if ext == ".pmx" {
		fileType = "model"
	} else if ext == ".vmd" {
		fileType = "motion"
	}

	payload := map[string]string{
		"path": filePath,
		"name": name,
		"type": fileType,
	}
	runtime.EventsEmit(a.ctx, "watch:newfile", payload)
}

// restoreWatcher resumes directory watching from saved config on startup.
// Called during app startup.
func (a *App) restoreWatcher() {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.DownloadWatchDir == "" {
		return
	}
	if err := a.StartWatchDir(cfg.DownloadWatchDir); err != nil {
		a.safeLogError("restoreWatcher: 恢复监听失败 %s: %v", cfg.DownloadWatchDir, err)
	}
}
