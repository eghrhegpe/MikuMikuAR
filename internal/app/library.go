package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mikumikuar/internal/util"
)

// SelectDir opens a directory picker dialog.
// On Android, native directory picker is not available in Wails 3 alpha;
// returns the default storage path as a starting point.
func (a *App) SelectDir() (string, error) {
	if isAndroid {
		// Android: return the default MikuMikuAR directory on external storage.
		// The user can set a custom path via SetLibraryRoot directly.
		return "/sdcard/MikuMikuAR", nil
	}
	if a.wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := a.wailsApp.Dialog.OpenFile()
	dialog.SetTitle("选择模型库根目录")
	dialog.CanChooseDirectories(true)
	dialog.CanChooseFiles(false)
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// ScanModelDir scans all resource directories and returns merged ModelEntry list.
// Uses ResourceRoot + OverridePaths from config; scans each category directory
// with extension filtering (no auto-classification by directory name).
func (a *App) ScanModelDir(root string, external []ExternalPath) ([]ModelEntry, error) {
	// root and external are ignored; use config instead
	return util.SafeCall(func() ([]ModelEntry, error) {
		cfg, err := a.GetConfig()
		if err != nil || cfg == nil {
			cfg = &Config{}
		}
		return a.scanAllCategories(cfg)
	})
}

// scanAllCategories scans each resource category directory.
func (a *App) scanAllCategories(cfg *Config) ([]ModelEntry, error) {
	type categoryScan struct {
		Category string
		Exts     []string
	}
	scans := []categoryScan{
		{"model", []string{".pmx"}},
		{"motion", []string{".vmd"}},
		{"scene", []string{".x", ".pmx"}},
		{"environment", []string{".png", ".jpg", ".jpeg", ".hdr", ".dds", ".json"}},
		{"outfit", []string{".zip", ".pmx", ".x"}},
	}
	var allModels []ModelEntry
	for _, s := range scans {
		dir := a.GetPath(cfg, mapCategoryKey(s.Category))
		entries, err := a.scanDirByExt(dir, s.Category, s.Exts, "")
		if err != nil {
			continue // skip unreadable dirs
		}
		allModels = append(allModels, entries...)
	}
	// Also scan external paths (if any)
	for _, ep := range cfg.ExternalPaths {
		for _, s := range scans {
			dir := filepath.Join(ep.Path, s.Category)
			entries, err := a.scanDirByExt(dir, s.Category, s.Exts, ep.Name)
			if err != nil {
				continue
			}
			allModels = append(allModels, entries...)
		}
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

// scanDirByExt scans a directory recursively for files with given extensions.
func (a *App) scanDirByExt(dir, category string, exts []string, source string) ([]ModelEntry, error) {
	var models []ModelEntry

	// Build extension set for O(1) lookup
	extSet := make(map[string]bool, len(exts))
	for _, e := range exts {
		extSet[strings.ToLower(e)] = true
	}

	err := filepath.WalkDir(dir, func(walkPath string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip inaccessible paths
		}
		if d.IsDir() {
			// Skip dot-directories
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
		m := ModelEntry{
			Dir:       filepath.Dir(fullPath),
			PMXPath:   fullPath,
			NameEn:    strings.TrimSuffix(d.Name(), filepath.Ext(d.Name())),
			Type:      category,
			Format:    strings.TrimPrefix(ext, "."),
			Container: "file",
			Source:    source,
		}
		models = append(models, m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return models, nil
}
	// Collect all roots to scan
	type scanRoot struct {
		path   string
		source string
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
	entries, err := os.ReadDir(dirPath)
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

// scanSingleRoot scans a single root directory, producing ModelEntry with the given source.
func (a *App) scanSingleRoot(root string, source string) []ModelEntry {
	var models []ModelEntry

	// Compute thumbnail dir once for HasThumb checks
	thumbDir, _ := thumbnailDir()

	topEntries, err := os.ReadDir(root)
	if err != nil {
		a.safeLogWarning("scanSingleRoot: skipping %s: %v", root, err)
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
				Dir:      filepath.Dir(walkPath),
				PMXPath:  walkPath,
				Format:   "pmx",
				Container: "file",
				Category: category,
				NameEn:   cleanModelName(strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))),
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
// Real I/O errors (permission, filesystem) are logged via safeLogError.
func (a *App) GetConfig() (*Config, error) {
	dir, err := configDir()
	if err != nil {
		return &Config{}, nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		if !os.IsNotExist(err) {
			a.safeLogError("GetConfig: read error %v", err)
		}
		return &Config{}, nil
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		a.safeLogError("GetConfig: json unmarshal error %v", err)
		return &Config{}, nil
	}
	// Migrate library_root → resource_root
	if cfg.LibraryRoot != "" && cfg.ResourceRoot == "" {
		cfg.ResourceRoot = cfg.LibraryRoot
		cfg.LibraryRoot = ""
		// Persist migrated config
		a.writeConfig(&cfg) // best-effort, ignore error
	}
	// Ensure resource directories exist
	a.ensureResourceDirs(&cfg)
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

// SetResourceRoot persists the resource root path and triggers a rescan+reindex.
func (a *App) SetResourceRoot(root string) error {
	return a.updateConfig(func(cfg *Config) {
		cfg.ResourceRoot = root
		cfg.LibraryRoot = "" // clear old field
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

// SetPerformanceMode persists the performance mode setting.
func (a *App) SetPerformanceMode(mode string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.PerformanceMode = mode }, false)
}

// SetEnvState persists the environment state (sky, ground, particles, fog, etc.).
func (a *App) SetEnvState(env EnvState) error {
	return a.updateConfig(func(cfg *Config) { cfg.Env = &env }, false)
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

// GetFavorites returns the current favorites list.
// Reads from the built-in tag "收藏" in the tag system.
func (a *App) GetFavorites() []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil {
		return nil
	}
	// Migrate old Favorites on read
	if len(cfg.Favorites) > 0 {
		return cfg.Favorites
	}
	if cfg.Tags == nil {
		return nil
	}
	var result []string
	for ref, tags := range cfg.Tags {
		for _, t := range tags {
			if t == "收藏" {
				result = append(result, ref)
				break
			}
		}
	}
	return result
}
