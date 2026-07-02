package main

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sync/errgroup"
)

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
	return safeCall(func() ([]ModelEntry, error) {
		return a.scanModelDirUnsafe(root, external)
	})
}

func (a *App) scanModelDirUnsafe(root string, external []ExternalPath) ([]ModelEntry, error) {
	// Collect all roots to scan
	type scanRoot struct {
		path   string
		source string
	}
	var roots []scanRoot
	if root != "" {
		roots = append(roots, scanRoot{root, ""})
	}
	for _, ep := range external {
		roots = append(roots, scanRoot{ep.Path, ep.Name})
	}

	// Parallel scan using errgroup — each root's I/O is independent
	g, ctx := errgroup.WithContext(a.ctx)
	g.SetLimit(4) // cap concurrent directory scans

	results := make([][]ModelEntry, len(roots))
	for i, r := range roots {
		i, r := i, r
		g.Go(func() error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			results[i] = a.scanSingleRoot(r.path, r.source)
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, err
	}

	// Merge all results
	var total int
	for _, r := range results {
		total += len(r)
	}
	models := make([]ModelEntry, 0, total)
	for _, r := range results {
		models = append(models, r...)
	}

	// Deduplicate by PMXPath+ZipInner
	seen := make(map[string]bool, total)
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
// Returns empty meta on error (non-fatal), logs real errors.
func (a *App) GetModelMeta(pmxPath string) (ModelMeta, error) {
	meta, err := ParsePMXHeader(pmxPath)
	if err != nil {
		a.safeLogError("GetModelMeta: ParsePMXHeader(%s) error: %v", pmxPath, err)
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
