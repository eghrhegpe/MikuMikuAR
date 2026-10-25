package app

import (
	"errors"
	"io"
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
	// [audit:fix 2026-10] 该错误分支原先因 findToktx 未找到时返回 ("", nil)
	// 而不可达；现 findToktx 返回显式错误，分支可达（顺带 gofmt 缩进）。
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

	// 失败路径清理临时产物：toktx 转码失败/校验失败/rename 失败都会残留 tmp 文件。
	// 成功路径 tmpFile 已被 rename 走、tmpLog 已被删除，Remove 不存在文件返回错误无害。
	defer func() {
		os.Remove(tmpFile)
		os.Remove(tmpLog)
	}()

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

	// Verify output has KTX2 magic bytes before replacing the source.
	// [audit:fix 2026-10] verifyKtx2Magic 只读 12 字节头前缀（旧 os.ReadFile
	// 把整张可达几十 MB 的 KTX2 读进内存只为查魔数）；"文件不足 12 字节 /
	// 魔数不符" 的报错语义保持不变（统一包 "转码输出无 KTX2 魔数头"）。
	if err := verifyKtx2Magic(tmpFile); err != nil {
		return "", util.WrapErrorf("KTX2Transcode", "转码输出无 KTX2 魔数头", err)
	}

	// Atomic replace: rename tmp → src (same filesystem)
	if err := os.Rename(tmpFile, srcPath); err != nil {
		return "", util.WrapErrorf("KTX2Transcode", "替换文件失败", err)
	}

	// Clean up temp log
	os.Remove(tmpLog)

	return srcPath, nil
}

// verifyKtx2Magic reports whether the file at path is a valid KTX2 transcode
// output: at least 12 bytes long (KTX2 minimum header length) and starting
// with the KTX2 magic bytes 0xAB 0x4B 0x54 0x58 ("KBTX").
//
// [audit:fix 2026-10] 自 ktx2Encode 内联魔数校验抽出以便单测：os.Open →
// io.ReadFull 读 12 字节前缀（保留旧 len(data) < 12 判定：不足 12 字节时
// ReadFull 返回 io.ErrUnexpectedEOF）→ 校验首 4 字节魔数 → Close（defer）。
// 旧实现 os.ReadFile 整文件读入，仅为查 12 字节头。
func verifyKtx2Magic(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var head [12]byte
	if _, err := io.ReadFull(f, head[:]); err != nil {
		return err
	}
	if head[0] != 0xAB || head[1] != 0x4B || head[2] != 0x54 || head[3] != 0x58 {
		return errors.New("KTX2 魔数不符")
	}
	return nil
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
//  1. App directory / bin/ subdirectory (for distributed binaries):
//     <appdir>/bin/toktx.exe, <appdir>/bin/toktx, <appdir>/toktx.exe, <appdir>/toktx
//  2. PATH (for development / Homebrew / user-installed): toktx.exe, toktx
//
// [audit:fix 2026-10] 未找到时返回显式错误（旧实现 return ("", nil) —— 调用方
// ktx2Encode 的 err != nil 分支不可达，最终 exec.Command("") 报
// "exec: no command" 用户无解；zipextract.go:253 的 findErr == nil 判断亦把
// "未找到"误判为"找到"）。错误文案覆盖三个查找位置：app 目录、其 bin/
// 子目录、PATH。
func findToktx() (string, error) {
	// Strategy 1: look next to the app binary.
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

	// [audit:fix 2026-10] 显式错误（旧实现 return ("", nil)）：文案列出
	// 三个查找位置（app 目录、其 bin/ 子目录、PATH），用户可据此安装/放置 toktx。
	// 用 util.WrapErrorf 贴合本文件既有错误风格（ADR-117 lint 对裸 fmt.Errorf
	// 中文报回归，util.WrapErrorf 中文格式串在检查范围外）。
	return "", util.WrapErrorf("FindToktx", "未找到 toktx：已查找 应用目录、其 bin/ 子目录与 PATH 中的 toktx.exe/toktx，均未命中；请安装 toktx 并加入 PATH 或应用 bin/ 子目录", nil)
}

// transcodeTexturesInDir scans a directory for texture files and transcodes
// PNG/JPG/BMP/TGA files to KTX2 in-place.
//
// Walks recursively; skips non-texture files and toon textures
// (small size — transcode risk > benefit). Errors are collected but do
// not abort the scan.
// [audit:fix 2026-10] 注释贴代码：原写 "toon/shared"，但代码实际只跳 "toon"
// （见下方 "toon" 过滤）；shared 是否跳过是行为决策，不在本批，故仅修注释、
// 不改行为。
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
