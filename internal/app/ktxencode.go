package app

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"mikumikuar/internal/util"
)

// ktx2Encode transcodes a single texture file to KTX2 using toktx.
//
// Output strategy (in-place transcode):
//   - Writes KTX2 bytes to the same file path, overwriting the original.
//   - The babylon-mmd fork detects KTX2 via magic bytes regardless of
//     filename extension, so the PMX's original filename stays valid.
//
// Texture type detection by name (case-insensitive):
//   - Normal/ORM/special maps → UASTC (lossless for normals/ORM)
//   - Diffuse/Color/Albedo maps → ETC1S (best for photo-graded color)
//   - Unknown → ETC1S (safe default)
//
// Returns the output file path (same as input) on success, or an error.
func ktx2Encode(srcPath string) (string, error) {
	// Find toktx binary: app dir / bin/ sub-dir / PATH
	toktxBin, err := findToktx()
		if err != nil {
		return "", util.WrapErrorf("KTX2Transcode", "未找到 toktx 二进制", err)
	}

	name := filepath.Base(srcPath)
	ext := strings.ToLower(filepath.Ext(srcPath))
	if !isKtx2SourceExt(ext) {
		return "", util.WrapErrorf("KTX2Transcode", "跳过非纹理格式", errors.New(ext))
	}

	// Decide encoding mode by filename
	encodeMode := guessEncodeMode(name)

	// Write to temp file in same dir, then rename — avoids partial writes
	// if toktx fails mid-stream.
	dir := filepath.Dir(srcPath)
	tmpFile := filepath.Join(dir, ".ktx2_tmp_"+filepath.Base(srcPath))
	tmpLog := tmpFile + ".log"

	// toktx v4.4.2 syntax: `toktx [options] <outfile> <infile>`.
	// Output (tmpFile) MUST precede input (srcPath). There is no --i/--o flag;
	// passing one makes toktx exit non-zero on the unknown option.
	var encodeArgs []string
	switch encodeMode {
	case "uastc":
		encodeArgs = []string{
			"--t2", "--encode", "uastc",
			"--uastc_quality", "4",
			"--assign_oetf", "linear", "--assign_primaries", "none",
			"--zcmp", "22", "--genmipmap",
		}
	default: // etc1s (and any unknown mode → safe default)
		encodeArgs = []string{
			"--t2", "--encode", "etc1s",
			"--clevel", "5", "--qlevel", "255",
			"--genmipmap",
		}
	}
	cmd := exec.Command(toktxBin, append(encodeArgs, tmpFile, srcPath)...)

	cmd.Env = os.Environ()
	_, cmdErr := cmd.CombinedOutput()
	if cmdErr != nil {
		return "", util.WrapErrorf("KTX2Transcode", "toktx 转码失败", errors.New(name))
	}

	// Verify output has KTX2 magic bytes before replacing the source
	data, err := os.ReadFile(tmpFile)
	if err != nil {
		return "", util.WrapErrorf("KTX2Transcode", "读取转码输出失败", err)
	}
	if len(data) < 12 || data[0] != 0xAB || data[1] != 0x4B || data[2] != 0x54 || data[3] != 0x58 {
		return "", util.WrapErrorf("KTX2Transcode", "转码输出无 KTX2 魔数头", errors.New(name))
	}

	// Atomic replace: rename tmp → src (same filesystem)
	if err := os.Rename(tmpFile, srcPath); err != nil {
		return "", util.WrapErrorf("KTX2Transcode", "替换文件失败", err)
	}

	// Clean up temp log
	os.Remove(tmpLog)

	return srcPath, nil
}

// isKtx2SourceExt returns true if the extension is a source format we transcode.
func isKtx2SourceExt(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".bmp", ".tga", ".tif", ".tiff":
		return true
	default:
		return false
	}
}

// guessEncodeMode picks KTX2 encoding based on texture filename keywords.
func guessEncodeMode(name string) string {
	nameLower := strings.ToLower(name)
	for _, kw := range []string{"normal", "norm", "nrm", "orm", "spec", "bump", "rough", "metal"} {
		if strings.Contains(nameLower, kw) {
			return "uastc"
		}
	}
	return "etc1s"
}

// findToktx locates the toktx binary.
// Search order:
// 1. App directory / bin/ subdirectory (for distributed binaries)
// 2. PATH (for development / Homebrew / user-installed)
// Returns empty string (not an error) when toktx is not found — the
// caller decides whether to warn or proceed without transcode.
func findToktx() (string, error) {
	// Strategy 1: look next to the app binary
	if exePath, err := os.Executable(); err == nil {
		appDir := filepath.Dir(exePath)
		for _, candidate := range []string{
			filepath.Join(appDir, "bin", "toktx.exe"),
			filepath.Join(appDir, "bin", "toktx"),
			filepath.Join(appDir, "toktx.exe"),
			filepath.Join(appDir, "toktx"),
		} {
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
		}
	}

	// Strategy 2: PATH lookup
	for _, name := range []string{"toktx.exe", "toktx"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}

	return "", nil
}

// transcodeTexturesInDir scans a directory for texture files and transcodes
// PNG/JPG/BMP/TGA files to KTX2 in-place.
//
// Walks recursively; skips non-texture files and toon/shared textures
// (small size — transcode risk > benefit). Errors are collected but do
// not abort the scan.
func transcodeTexturesInDir(root string) (transcoded int, errs []error) {
	textureExts := map[string]bool{
		".png": true, ".jpg": true, ".jpeg": true,
		".bmp": true, ".tga": true, ".tif": true, ".tiff": true,
	}

	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			errs = append(errs, err)
			return nil
		}
		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !textureExts[ext] {
			return nil
		}

		name := info.Name()
		if strings.Contains(strings.ToLower(name), "toon") {
			return nil
		}

		_, err = ktx2Encode(path)
		if err != nil {
			errs = append(errs, err)
		} else {
			transcoded++
		}
		return nil
	})

	return transcoded, errs
}
