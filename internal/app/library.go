package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"mikumikuar/internal/dialogs"
	"mikumikuar/internal/util"
)

// SelectDir opens a directory picker dialog.
// On Android: returns the current resource root directly (Wails v3 does not
// support directory selection on Android). Users switch storage mode via
// SetStorageMode instead.
func (a *App) SelectDir() (string, error) {
	if runtime.GOOS == "android" {
		cfg, err := a.GetConfig()
		if err != nil {
			return "", util.WrapErrorf("SelectDir", "get config", err)
		}
		return cfg.ResourceRoot, nil
	}
	return dialogs.SelectLibraryDir(a.wailsApp)
}

// ScanModelDir scans all resource directories and returns merged ModelEntry list.
// Uses ResourceRoot + OverridePaths from config; scans each category directory
// with extension filtering (no auto-classification by directory name).
func (a *App) ScanModelDir(root string, external []ExternalPath) ([]ModelEntry, error) {
	// root and external are ignored; use config instead
	return util.SafeCall(func() ([]ModelEntry, error) {
		cfg, err := a.GetConfig()
		if err != nil {
			cfg = &Config{}
		}
		return a.scanAllCategories(cfg)
	})
}

// scanAllCategories scans each resource category directory in parallel.
func (a *App) scanAllCategories(cfg *Config) ([]ModelEntry, error) {
	type categoryScan struct {
		Category string
		Exts     []string
	}
	scans := []categoryScan{
		{"model", []string{".pmx", ".zip"}},
		{"motion", []string{".vmd", ".zip"}},
		{"audio", []string{".mp3", ".wav", ".ogg", ".flac", ".wma"}},
		{"pose", []string{".vpd"}},
		{"scene", []string{".x", ".pmx", ".zip"}},
		{"environment", []string{".png", ".jpg", ".jpeg", ".hdr", ".dds", ".json", ".zip"}},
		{"outfit", []string{".zip", ".pmx", ".x"}},
		{"prop", []string{".pmx", ".zip"}},
	}

	// Build scan jobs: main categories + external paths
	type scanJob struct {
		dir      string
		category string
		exts     []string
		source   string
	}
	var jobs []scanJob
	for _, s := range scans {
		dir := a.GetPath(cfg, mapCategoryKey(s.Category))
		jobs = append(jobs, scanJob{dir, s.Category, s.Exts, ""})
	}
	for _, ep := range cfg.ExternalPaths {
		for _, s := range scans {
			dir := filepath.Join(ep.Path, s.Category)
			jobs = append(jobs, scanJob{dir, s.Category, s.Exts, ep.Name})
		}
	}

	// Scan all jobs in parallel
	type scanResult struct {
		entries []ModelEntry
	}
	results := make([]scanResult, len(jobs))
	var wg sync.WaitGroup
	for i, job := range jobs {
		wg.Add(1)
		go func(idx int, j scanJob) {
			defer wg.Done()
			entries, err := a.scanDirByExt(j.dir, j.category, j.exts, j.source)
			if err != nil {
				a.safeLogWarning("scanAllCategories: skip dir %q (category=%q): %v", j.dir, j.category, err)
				return
			}
			results[idx] = scanResult{entries}
		}(i, job)
	}
	wg.Wait()

	// Merge results
	var allModels []ModelEntry
	for _, r := range results {
		allModels = append(allModels, r.entries...)
	}
	return allModels, nil
}

// mapCategoryKey maps internal category name to OverridePaths key.
func mapCategoryKey(category string) string {
	switch category {
	case "model":
		return "pmx"
	case "motion":
		return "vmd"
	case "audio":
		return "audio"
	case "prop":
		return "prop"
	case "pose":
		return "pose"
	case "scene":
		return "stage"
	case "environment":
		return "environment"
	case "outfit":
		return "md_dress"
	default:
		return category
	}
}

// formatByCategory returns the unified format tag for a file extension and category.
// Audio files of any extension (mp3/wav/ogg/flac/wma) all use format "audio"
// to match frontend filter: m.format === 'audio'.
func formatByCategory(ext, category string) string {
	if category == "audio" {
		return "audio"
	}
	return strings.TrimPrefix(ext, ".")
}

// ZIP bomb protection thresholds for expandZipEntries.
const (
	maxZipEntryFileSize = 500 * 1024 * 1024      // 500 MB — reject bloated files before zip.OpenReader
	maxZipEntryCount    = 10000                  // reject zip bombs with excessive file entries
	maxZipTotalBytes    = 2 * 1024 * 1024 * 1024 // 2 GB — total uncompressed size limit
)

// totalUncompressedZipSize returns the sum of all entries' UncompressedSize64.
func totalUncompressedZipSize(files []*zip.File) uint64 {
	var total uint64
	for _, zf := range files {
		total += zf.UncompressedSize64
	}
	return total
}

// expandZipEntries opens a zip file and returns ModelEntry for each recognized inner file.
// Supports: .pmx, .vmd, .mp3/.wav/.ogg/.flac/.wma, .vpd.
// If typeOverride is non-empty (and not "other"), it replaces the inferred inner type.
//
// Safety: enforces max file count and total uncompressed size to prevent ZIP bomb attacks.
func (a *App) expandZipEntries(zipPath, category, source, typeOverride string) []ModelEntry {
	// Pre-check: reject oversized zip files by file size (quick stat, no decompression)
	if fi, err := os.Stat(zipPath); err == nil && fi.Size() > maxZipEntryFileSize {
		a.safeLogWarning("expandZipEntries: skipping oversized zip (%.1f MB) %s",
			float64(fi.Size())/1024/1024, zipPath)
		return nil
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil
	}
	defer zr.Close()

	// Guard 1: reject zip bombs with too many entries
	if len(zr.File) > maxZipEntryCount {
		a.safeLogWarning("expandZipEntries: zip %s has %d entries (max %d), possible zip bomb",
			zipPath, len(zr.File), maxZipEntryCount)
		return nil
	}

	// Guard 2: reject zip bombs with excessive total uncompressed size
	if totalUncompressedZipSize(zr.File) > maxZipTotalBytes {
		a.safeLogWarning("expandZipEntries: zip %s total uncompressed size exceeds %.0f MB",
			zipPath, float64(maxZipTotalBytes)/1024/1024)
		return nil
	}

	var models []ModelEntry
	fullPath := filepath.ToSlash(zipPath)
	zipBase := strings.TrimSuffix(filepath.Base(zipPath), ".zip")

	for _, zf := range zr.File {
		entryName := decodeZipName(zf.Name, zf.NonUTF8)
		zfLower := strings.ToLower(entryName)
		var innerFormat, innerType string
		switch {
		case strings.HasSuffix(zfLower, ".pmx"):
			innerFormat, innerType = "pmx", "actor"
		case strings.HasSuffix(zfLower, ".vmd"):
			innerFormat, innerType = "vmd", "motion"
		case strings.HasSuffix(zfLower, ".mp3"), strings.HasSuffix(zfLower, ".wav"),
			strings.HasSuffix(zfLower, ".ogg"), strings.HasSuffix(zfLower, ".flac"),
			strings.HasSuffix(zfLower, ".wma"):
			innerFormat, innerType = "audio", "audio"
		case strings.HasSuffix(zfLower, ".vpd"):
			innerFormat, innerType = "vpd", "pose"
		default:
			continue
		}
		innerName := filepath.Base(entryName)
		entryType := innerType
		if typeOverride != "" && typeOverride != "other" {
			entryType = typeOverride
		} else if innerType == "actor" {
			// Use scan category as type for .pmx files, matching standalone
			// file behavior (scanDirByExt sets Type: category). Without this,
			// a .pmx inside a stage/ zip would have Type:"actor" instead of
			// Type:"scene", making it invisible in the stage browser.
			entryType = category
		}
		models = append(models, ModelEntry{
			Dir:       filepath.Dir(fullPath) + "/" + zipBase,
			PMXPath:   fullPath,
			Format:    innerFormat,
			Container: "zip",
			ZipInner:  entryName,
			NameEn:    strings.TrimSuffix(innerName, filepath.Ext(innerName)),
			Type:      entryType,
			Category:  category,
			Source:    source,
		})
	}
	return models
}

// scanDirByExt scans a directory recursively for files with given extensions.
func (a *App) scanDirByExt(dir, category string, exts []string, source string) ([]ModelEntry, error) {
	var models []ModelEntry

	// Build extension set for O(1) lookup
	extSet := make(map[string]bool, len(exts))
	for _, e := range exts {
		extSet[strings.ToLower(e)] = true
	}

	err := fileAccessor.WalkDir(dir, func(walkPath string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip inaccessible paths
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if !extSet[ext] {
			return nil
		}
		fullPath := filepath.ToSlash(walkPath)

		if ext == ".zip" {
			models = append(models, a.expandZipEntries(walkPath, category, source, "")...)
			return nil
		}

		models = append(models, ModelEntry{
			Dir:       filepath.Dir(fullPath),
			PMXPath:   fullPath,
			NameEn:    strings.TrimSuffix(d.Name(), filepath.Ext(d.Name())),
			Type:      category,
			Format:    formatByCategory(ext, category),
			Container: "file",
			Source:    source,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return models, nil
}

// GetModelMeta parses the PMX header for a single PMX file and returns its metadata.
// Returns empty meta on error (non-fatal), logs real errors.
func (a *App) GetModelMeta(pmxPath string) (ModelMeta, error) {
	meta, err := util.ParsePMXHeader(pmxPath)
	if err != nil {
		a.safeLogError("GetModelMeta: util.ParsePMXHeader(%s) error: %v", pmxPath, err)
		return ModelMeta{}, nil
	}
	if meta == nil {
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

// LoadOutfitFile reads <modelDir>/outfits.json. Returns empty string if not found.
func (a *App) LoadOutfitFile(pmxPath string) (string, error) {
	dir := filepath.Dir(pmxPath)
	path := filepath.Join(dir, "outfits.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", nil // not an error if missing
	}
	return string(data), nil
}

// ListSubDirs returns first-level subdirectory names under the given directory.
func (a *App) ListSubDirs(dirPath string) ([]string, error) {
	entries, err := fileAccessor.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	return dirs, nil
}

// getConfigUnsafe reads config from disk without locking.
// Caller must hold configMu (at least RLock) if concurrent writes are possible.
// Used internally by updateConfig (which holds Lock) and by GetConfig (RLock).
func (a *App) getConfigUnsafe() (*Config, error) {
	if a.cachedCfg != nil {
		return a.cachedCfg, nil
	}

	// Phase 1: read bootstrap config from internal storage (configDir).
	// This gives us ResourceRoot so we can locate the setting/ directory.
	dir, err := configDir()
	if err != nil {
		return &Config{}, nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil && !os.IsNotExist(err) {
		a.safeLogError("getConfigUnsafe: read error %v", err)
	}

	// Phase 2: if bootstrap has a ResourceRoot, also check setting/ for a
	// potentially newer copy written by writeConfig.
	if data != nil {
		var bootstrap Config
		if uErr := json.Unmarshal(data, &bootstrap); uErr == nil {
			a.finaliseConfig(&bootstrap)
			if bootstrap.ResourceRoot != "" {
				sd, sErr := settingDir(&bootstrap)
				if sErr == nil {
					settingData, rErr := os.ReadFile(filepath.Join(sd, "config.json"))
					if rErr == nil {
						var settingCfg Config
						if uErr := json.Unmarshal(settingData, &settingCfg); uErr == nil {
							a.finaliseConfig(&settingCfg)
							a.cachedCfg = &settingCfg
							return &settingCfg, nil
						}
					}
				}
			}
			// No ResourceRoot or settingDir failed — use bootstrap as-is.
			a.cachedCfg = &bootstrap
			return &bootstrap, nil
		}
	}

	// Phase 3: no valid config anywhere — return empty defaults.
	return &Config{}, nil
}

// GetConfig reads the persisted config from disk with a read lock,
// ensuring safe concurrent access with write operations.
func (a *App) GetConfig() (*Config, error) {
	a.configMu.RLock()
	defer a.configMu.RUnlock()
	return a.getConfigUnsafe()
}

// currentConfigVersion is the latest config schema version.
// Increment when adding breaking config changes; add migration logic in finaliseConfig.
const currentConfigVersion = 1

// finaliseConfig runs migrations and ensure-dirs after loading a config.
func (a *App) finaliseConfig(cfg *Config) {
	// --- Migrations ---
	// v0 → v1: migrate library_root → resource_root
	if cfg.LibraryRoot != "" && cfg.ResourceRoot == "" {
		cfg.ResourceRoot = cfg.LibraryRoot
		cfg.LibraryRoot = ""
	}
	// Future migrations: if cfg.ConfigVersion < 2 { ... }

	// Stamp current version
	cfg.ConfigVersion = currentConfigVersion

	// Android: apply storage mode if set, default to "private"
	if runtime.GOOS == "android" {
		if cfg.StorageMode == "" {
			cfg.StorageMode = "private"
		}
		// If resource root is empty or matches the old default, sync with storage mode
		oldDefault := "/sdcard/MMD"
		privateDir := platformPathMgr.PrivateResourceRoot()
		sharedDir := platformPathMgr.SharedResourceRoot()
		if cfg.ResourceRoot == "" || cfg.ResourceRoot == oldDefault ||
			cfg.ResourceRoot == privateDir || cfg.ResourceRoot == sharedDir {
			switch cfg.StorageMode {
			case "shared":
				cfg.ResourceRoot = sharedDir
			default:
				cfg.ResourceRoot = privateDir
			}
		}
	}

	// Ensure resource directories exist
	a.ensureResourceDirs(cfg)
}

// updateConfig loads the config, runs a mutation under configMu, then persists.
// If rescan is true, it also re-scans the model index.
func (a *App) updateConfig(mutate func(*Config), rescan bool) error {
	a.configMu.Lock()
	defer a.configMu.Unlock()
	cfg, err := a.getConfigUnsafe()
	if err != nil {
		cfg = &Config{}
	}
	mutate(cfg)
	if rescan {
		return a.writeConfigAndRescan(cfg)
	}
	return a.writeConfig(cfg)
}

// SetResourceRoot persists the resource root path, initialises all category
// override paths to their default subdirectories, and triggers a rescan+reindex.
func (a *App) SetResourceRoot(root string) error {
	return a.updateConfig(func(cfg *Config) {
		cfg.ResourceRoot = root
		cfg.LibraryRoot = "" // clear old field
		// Atomically set default override paths for all categories
		if cfg.OverridePaths.PMX == "" {
			cfg.OverridePaths.PMX = filepath.Join(root, "PMX")
		}
		if cfg.OverridePaths.VMD == "" {
			cfg.OverridePaths.VMD = filepath.Join(root, "VMD")
		}
		if cfg.OverridePaths.Stage == "" {
			cfg.OverridePaths.Stage = filepath.Join(root, "stage")
		}
		if cfg.OverridePaths.Environment == "" {
			cfg.OverridePaths.Environment = filepath.Join(root, "environment")
		}
		if cfg.OverridePaths.MDDress == "" {
			cfg.OverridePaths.MDDress = filepath.Join(root, "MD-dress")
		}
		if cfg.OverridePaths.Setting == "" {
			cfg.OverridePaths.Setting = filepath.Join(root, "setting")
		}
	}, true)
}

// SetOverridePath sets an override path for a category and triggers a rescan.
func (a *App) SetOverridePath(category string, path string) error {
	return a.updateConfig(func(cfg *Config) {
		switch category {
		case "pmx":
			cfg.OverridePaths.PMX = path
		case "vmd":
			cfg.OverridePaths.VMD = path
		case "audio":
			cfg.OverridePaths.Audio = path
		case "prop":
			cfg.OverridePaths.Prop = path
		case "stage":
			cfg.OverridePaths.Stage = path
		case "environment":
			cfg.OverridePaths.Environment = path
		case "md_dress":
			cfg.OverridePaths.MDDress = path
		case "setting":
			cfg.OverridePaths.Setting = path
		}
	}, true)
}

// SetStorageMode switches the resource root between private and shared directories.
// Android only: "private" → app-specific dir, "shared" → /sdcard/MMD (needs MANAGE_EXTERNAL_STORAGE).
// On desktop this is a no-op.
func (a *App) SetStorageMode(mode string) error {
	if runtime.GOOS != "android" {
		return nil
	}
	if mode != "private" && mode != "shared" {
		return fmt.Errorf("invalid storage mode: %s", mode)
	}
	return a.updateConfig(func(cfg *Config) {
		cfg.StorageMode = mode
		switch mode {
		case "shared":
			cfg.ResourceRoot = platformPathMgr.SharedResourceRoot()
		default:
			cfg.ResourceRoot = platformPathMgr.PrivateResourceRoot()
		}
		cfg.OverridePaths = OverridePaths{} // reset overrides to re-derive from new root
	}, true)
}

// GetStorageMode returns the current storage mode ("private" or "shared").
// On desktop always returns "shared".
func (a *App) GetStorageMode() (string, error) {
	if runtime.GOOS != "android" {
		return "shared", nil
	}
	cfg, err := a.GetConfig()
	if err != nil {
		return "private", util.WrapErrorf("GetStorageMode", "get config", err)
	}
	if cfg.StorageMode == "" {
		return "private", nil
	}
	return cfg.StorageMode, nil
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

// SetUIScale persists the UI scale factor.
func (a *App) SetUIScale(scale float64) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.Scale = scale }, false)
}

// SetUIPopupWidth persists the popup width.
func (a *App) SetUIPopupWidth(width int) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.PopupWidth = width }, false)
}

// SetUIAccent persists the accent color hex.
func (a *App) SetUIAccent(hex string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.Accent = hex }, false)
}

// SetUIFontFamily persists the font family key ("system"|"noto"|"yahei").
func (a *App) SetUIFontFamily(key string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.FontFamily = key }, false)
}

// SetUIAnimations enables or disables menu slide animations.
func (a *App) SetUIAnimations(on bool) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.Animations = on }, false)
}

// SetUIBlurBg enables or disables background blur on overlays.
func (a *App) SetUIBlurBg(on bool) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.BlurBg = on }, false)
}

// SetUIAutoUpdate persists whether to auto-check for updates on startup.
func (a *App) SetUIAutoUpdate(on bool) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.AutoUpdateEnabled = on }, false)
}

// SetPerformanceMode persists the performance mode setting.
func (a *App) SetPerformanceMode(mode string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.PerformanceMode = mode }, false)
}

// SetEnvState persists the environment state (sky, ground, particles, fog, etc.).
func (a *App) SetEnvState(env EnvState) error {
	return a.updateConfig(func(cfg *Config) { cfg.Env = &env }, false)
}

// SetUIState persists the full UI state (scale, popupWidth, rendering settings, etc.).
// Follows the same full-replace pattern as SetEnvState.
func (a *App) SetUIState(ui UIState) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState = ui }, false)
}

// ToggleFavorite adds or removes a libraryRef from the favorites list.
// Favorites are stored as the built-in tag "收藏" in the tag system.
func (a *App) ToggleFavorite(libraryRef string) error {
	return a.updateConfig(func(cfg *Config) {
		// Migrate old Favorites to tags if needed
		if len(cfg.Favorites) > 0 {
			if cfg.Tags == nil {
				cfg.Tags = make(map[string][]string)
			}
			for _, ref := range cfg.Favorites {
				tags := cfg.Tags[ref]
				hasFav := false
				for _, t := range tags {
					if t == "收藏" {
						hasFav = true
						break
					}
				}
				if !hasFav {
					cfg.Tags[ref] = append(tags, "收藏")
				}
			}
			cfg.Favorites = nil
		}
		if cfg.Tags == nil {
			cfg.Tags = make(map[string][]string)
		}
		tags := cfg.Tags[libraryRef]
		found := false
		filtered := make([]string, 0, len(tags))
		for _, t := range tags {
			if t == "收藏" {
				found = true
				continue
			}
			filtered = append(filtered, t)
		}
		if !found {
			filtered = append(filtered, "收藏")
		}
		cfg.Tags[libraryRef] = filtered
	}, false)
}
