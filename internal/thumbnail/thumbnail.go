package thumbnail

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

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
		return sha256Hex(keyPath)
	}
	return sha256Hex(keyPath + "|" + info.ModTime().Format("20060102-150405.000") + "|" + strconv.FormatInt(info.Size(), 10))
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
	hash := CacheKey(modelPath, rootPath)
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
