package thumbnail

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"mikumikuar/internal/util"
)

// CacheKey generates a cache key for the given model path.
// If rootPath is provided, the relative path under rootPath is used instead of
// the absolute path, so thumbnails survive resource root moves.
func CacheKey(modelPath string, rootPath string) string {
	// Compute key path: relative under rootPath if applicable, else absolute
	keyPath := modelPath
	if rootPath != "" {
		if rel, err := filepath.Rel(rootPath, modelPath); err == nil && !strings.HasPrefix(rel, "..") {
			keyPath = rel
		}
	}
	// Still stat the absolute path for mtime/size
	  info, err := os.Stat(modelPath)
	  if err != nil {
	   return util.SHA256Hex(keyPath)
	  }
	  return util.SHA256Hex(keyPath + "|" + info.ModTime().Format("20060102-150405.000") + "|" + strconv.FormatInt(info.Size(), 10))
}

func Save(thumbDir string, modelPath string, rootPath string, base64PNG string) error {
	hash := CacheKey(modelPath, rootPath)
	thumbPath := filepath.Join(thumbDir, hash+".png")
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	return os.WriteFile(thumbPath, data, 0644)
}

func Get(thumbDir string, modelPath string, rootPath string) (string, error) {
	// 主 key：相对 rootPath（resource_root 迁移后可移植）
	if b64, err := readThumb(thumbDir, CacheKey(modelPath, rootPath)); err == nil {
		return b64, nil
	}
	// 回退 key：绝对路径（恢复 resource_root 修复前生成的缩略图——
	// 当时 root 为 temp 目录，Rel() 以 ".." 开头被拒，key 退化为绝对路径）。
	if b64, err := readThumb(thumbDir, CacheKey(modelPath, "")); err == nil {
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
	for _, p := range paths {
		if b64, err := Get(thumbDir, p, rootPath); err == nil {
			result[p] = b64
		}
	}
	return result, nil
}

func SaveScreenshot(dir string, filename string, base64PNG string) error {
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, filename)
	return os.WriteFile(path, data, 0644)
}
