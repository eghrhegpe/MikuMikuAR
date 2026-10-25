package thumbnail

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"mikumikuar/internal/util"
)

// CacheKey generates a cache key for the given model path.
// If rootPath is provided, the relative path under rootPath is used instead of
// the absolute path, so thumbnails survive resource root moves.
// [audit:fix 2026-10] The key path is case-normalized (ToLower) before hashing:
// on Windows' case-insensitive FS, case variants of the same file
// ("C:\M\a.pmx" vs "c:\m\A.PMX") must not produce two different SHA256
// keys, otherwise the cache misses and the thumbnail is generated twice.
// Note: normalization rotates the whole key space (a one-shot regeneration);
// Get's legacy fallback chain keeps old thumbnails readable until the next
// Save overwrites them under the new key.
func CacheKey(modelPath string, rootPath string) string {
	// [audit:fix 2026-10] Normalize the final key path (relative and absolute
	// forms alike) before hashing.
	keyPath := strings.ToLower(cacheKeyPath(modelPath, rootPath))
	return hashCacheKey(keyPath, modelPath)
}

// legacyCacheKey is the pre-[audit:fix 2026-10] key formula: the un-normalized
// key path, hashed the same way. It exists only so Get can keep reading
// thumbnails that were written under the old (case-sensitive) keys; all new
// writes go through CacheKey.
func legacyCacheKey(modelPath string, rootPath string) string {
	return hashCacheKey(cacheKeyPath(modelPath, rootPath), modelPath)
}

// cacheKeyPath computes the un-hashed key path: relative under rootPath when
// modelPath lives inside rootPath, otherwise the absolute model path.
func cacheKeyPath(modelPath string, rootPath string) string {
	// Compute key path: relative under rootPath if applicable, else absolute
	keyPath := modelPath
	if rootPath != "" {
		if rel, err := filepath.Rel(rootPath, modelPath); err == nil && !strings.HasPrefix(rel, "..") {
			keyPath = rel
		}
	}
	return keyPath
}

// hashCacheKey hashes keyPath, appending modelPath's mtime/size when the file
// exists on disk so content edits invalidate the cache entry.
func hashCacheKey(keyPath string, modelPath string) string {
	// Still stat the absolute path for mtime/size
	info, err := os.Stat(modelPath)
	if err != nil {
		return util.SHA256Hex(keyPath)
	}
	return util.SHA256Hex(keyPath + "|" + info.ModTime().Format("20060102-150405.000") + "|" + strconv.FormatInt(info.Size(), 10))
}

// Save stores a base64-encoded PNG thumbnail under its cache key.
// [audit:fix 2026-10] The write is atomic: it lands on a unique ".tmp"
// sibling (os.CreateTemp, pattern hash+".png.tmp.") and is moved to the final
// path with os.Rename (Windows MoveFileEx replace semantics, same-volume
// safe), so a crash or concurrent Save can no longer leave a torn .png
// permanently cached. The tmp name is unique per call: a fixed
// thumbPath+".tmp" makes concurrent same-key Saves on Windows fail the
// rename with "file in use" (measured in TestSaveConcurrentSameKey).
// Cleanup follows the tmp precedent in internal/app/ktxencode.go: the failure
// path is cleaned by the defer; on success the tmp has already been renamed
// away and removing a missing file is harmless.
func Save(thumbDir string, modelPath string, rootPath string, base64PNG string) error {
	hash := CacheKey(modelPath, rootPath)
	thumbPath := filepath.Join(thumbDir, hash+".png")
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	tmpFile, err := os.CreateTemp(thumbDir, hash+".png.tmp.")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() {
		os.Remove(tmpPath)
	}()
	if err := tmpFile.Chmod(0644); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, thumbPath)
}

func Get(thumbDir string, modelPath string, rootPath string) (string, error) {
	// 主 key：相对 rootPath（resource_root 迁移后可移植；[audit:fix 2026-10] 大小写归一化）
	if b64, err := readThumb(thumbDir, CacheKey(modelPath, rootPath)); err == nil {
		return b64, nil
	}
	// [audit:fix 2026-10] legacy 回退链：归一化使既有磁盘键全部失效，依次读
	// 旧公式（不 ToLower）的根相对键，再读 legacy 绝对键（resource_root 修复
	// 前生成的缩略图当时以绝对键落盘——旧根为 temp 目录、Rel() 以 ".." 开头
	// 被拒，key 退化为绝对路径）。旧缩略图保持可读，直到下次 Save 以新键覆盖。
	if b64, err := readThumb(thumbDir, legacyCacheKey(modelPath, rootPath)); err == nil {
		return b64, nil
	}
	if b64, err := readThumb(thumbDir, legacyCacheKey(modelPath, "")); err == nil {
		return b64, nil
	}
	return "", os.ErrNotExist
}

func readThumb(thumbDir, hash string) (string, error) {
	data, err := os.ReadFile(filepath.Join(thumbDir, hash+".png"))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func GetBatch(thumbDir string, paths []string, rootPath string) (map[string]string, error) {
	result := make(map[string]string)
	var errs []error
	for _, p := range paths {
		if b64, err := Get(thumbDir, p, rootPath); err == nil {
			result[p] = b64
		} else {
			errs = append(errs, fmt.Errorf("thumbnail for %q: %w", p, err))
		}
	}
	if len(errs) > 0 {
		return result, errors.Join(errs...)
	}
	return result, nil
}

func SaveScreenshot(dir string, filename string, base64PNG string) error {
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	// 路径净化：仅取 basename，防调用方传 ../ 或绝对路径写到目录之外
	// （前端已做 replace 净化，此处是绑定方法的最后一道防线）。
	path := filepath.Join(dir, filepath.Base(filename))
	return os.WriteFile(path, data, 0644)
}
