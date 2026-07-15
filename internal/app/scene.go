package app

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"mikumikuar/internal/dialogs"
	"mikumikuar/internal/util"
)

// ======== Scene File I/O ========

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

// SelectSceneOpenFile opens a file dialog to pick a scene file.
func (a *App) SelectSceneOpenFile() (string, error) {
	return a.selectFile("scene", dialogs.SelectSceneOpen)
}

// ======== Scene Auto-Save ========

// SaveLastScene stores the current scene state for auto-recovery on next launch.
func (a *App) SaveLastScene(jsonStr string) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "last_scene.json")
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.WriteString(jsonStr); err != nil {
		return err
	}
	return f.Sync()
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

// ======== Scene Bundle (zip packaging) ========

// BundleScene packages a scene JSON + all referenced asset files into a zip.
// sceneJSON: the rewritten SceneFile JSON (libraryRef pointing to assets/ inside the bundle).
// assetPaths: deduplicated absolute paths of files to include.
// Each asset is stored at "assets/<relativeFromRoot>" preserving directory structure.
func (a *App) BundleScene(targetPath string, sceneJSON string, assetPaths []string) error {
	f, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("create bundle file: %w", err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()

	// Write scene.json
	sw, err := zw.Create("scene.json")
	if err != nil {
		return fmt.Errorf("create scene.json in zip: %w", err)
	}
	if _, err := sw.Write([]byte(sceneJSON)); err != nil {
		return fmt.Errorf("write scene.json: %w", err)
	}

	// Determine the best library root for computing relative paths.
	// We try all category paths (respecting overrides) and pick the longest
	// matching prefix, so models in override directories keep their structure.
	cfg, err := a.GetConfig()
	if err != nil {
		return err
	}
	libRoot := a.findBestLibRoot(cfg, assetPaths)

	// Expand asset paths: a PMX references textures/material maps by relative
	// paths that are NOT listed in the scene file. Walk each asset's parent
	// directory (recursively, bounded to the model folder) and include sibling
	// files with known texture/material extensions so the imported model keeps
	// its textures. See AR review #2.
	allPaths := expandBundleAssets(assetPaths)

	// Write each asset file
	for _, absPath := range allPaths {
		rel := _bundleRelPath(absPath, libRoot)
		_ = _copyFileToZip(zw, absPath, "assets/"+rel)
	}

	return nil
}

// SelectBundleSaveFile opens a save dialog for scene bundle files.
func (a *App) SelectBundleSaveFile() (string, error) {
	return a.selectFile("scene", dialogs.SelectBundleSave)
}

// _bundleTextureExts are file extensions (lower-case, with leading dot) that a
// PMX/model may reference as textures or material maps. When bundling we include
// sibling files with these extensions so the imported model keeps its appearance.
// Other unrelated files in the model folder are skipped to avoid bloating the bundle.
var _bundleTextureExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".bmp": true,
	".tga": true, ".dds": true, ".webp": true, ".svg": true,
	".tif": true, ".tiff": true, ".spa": true, ".sph": true,
	".toon": true,
}

// expandBundleAssets returns the input paths plus sibling texture/material files
// found by recursively walking each path's parent directory (the model folder).
// Results are de-duplicated. Walks are bounded to the model folder so we never
// scan the entire library.
func expandBundleAssets(assetPaths []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(assetPaths))
	add := func(p string) {
		norm := filepath.ToSlash(p)
		if seen[norm] {
			return
		}
		seen[norm] = true
		out = append(out, p)
	}
	for _, p := range assetPaths {
		add(p)
		dir := filepath.Dir(p)
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil // 跳过无法访问的目录
			}
			if d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if _bundleTextureExts[ext] {
				add(path)
			}
			return nil
		})
	}
	return out
}

// findBestLibRoot finds the longest directory path that is a prefix of most
// asset paths among all category paths (respecting OverridePaths).
// Returns empty string if no root contains any of the paths.
func (a *App) findBestLibRoot(cfg *Config, assetPaths []string) string {
	candidates := []string{}
	cats := []string{"pmx", "vmd", "audio", "stage", "prop", "environment", "md_dress", "setting"}
	for _, cat := range cats {
		candidates = append(candidates, a.GetPath(cfg, cat))
	}
	bestRoot := ""
	bestCount := 0
	for _, root := range candidates {
		if root == "" {
			continue
		}
		count := 0
		rootNorm := filepath.ToSlash(root) + "/"
		for _, p := range assetPaths {
			if strings.HasPrefix(filepath.ToSlash(p), rootNorm) {
				count++
			}
		}
		if count > bestCount || (count == bestCount && len(root) > len(bestRoot)) {
			bestRoot = root
			bestCount = count
		}
	}
	return bestRoot
}

// _bundleRelPath computes the relative path for a bundle asset.
func _bundleRelPath(absPath string, libRoot string) string {
	normalised := filepath.ToSlash(absPath)
	if libRoot != "" {
		libNorm := filepath.ToSlash(libRoot)
		if strings.HasPrefix(normalised, libNorm+"/") {
			return normalised[len(libNorm)+1:]
		}
	}
	return filepath.Base(absPath)
}

// _copyFileToZip copies a file into a zip archive at the given entry path.
func _copyFileToZip(zw *zip.Writer, srcPath string, entryPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	info, err := src.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = entryPath
	header.Method = zip.Deflate

	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, src)
	return err
}