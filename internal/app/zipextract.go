package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"

	"mikumikuar/internal/util"
)

// ======== Zip Extraction (Week 5-6) ========

// ExtractResult holds the result of a zip extraction.
type ExtractResult struct {
	FilePath string `json:"file_path"` // Absolute path to extracted file (PMX or VMD)
	Dir      string `json:"dir"`       // Extraction root directory (for HTTP server)
	Cached   bool   `json:"cached"`    // Whether cache was hit (no re-extract)
}

const extractCacheVersion = 6

// manifest stores source zip metadata for cache validation.
type manifest struct {
	Source  string `json:"source"`
	Mtime   int64  `json:"mtime"`
	Size    int64  `json:"size"`
	Version int    `json:"version,omitempty"`
}

// zipCacheName converts a zip path into a safe, collision-free directory name
// using SHA-256 of the absolute path. This avoids path-length limits and
// naming conflicts that the old path-escaping approach suffered from.
func zipCacheName(zipPath string) string {
	abs, err := filepath.Abs(zipPath)
	if err != nil {
		abs = zipPath
	}
	return util.SHA256Hex(abs)
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
	return util.SafeCall(func() (*ExtractResult, error) {
		return a.extractZipUnsafe(zipPath, innerPath)
	})
}

func (a *App) extractZipUnsafe(zipPath, innerPath string) (*ExtractResult, error) {
	const op = "ExtractZip"
	cacheRoot, err := extractedDir()
	if err != nil {
		return nil, util.WrapErrorf(op, "解压失败", err)
	}

	dest := filepath.Join(cacheRoot, zipCacheName(zipPath))

	// Stat source zip
	srcInfo, err := fileAccessor.Stat(zipPath)
	if err != nil {
		return nil, util.WrapErrorf(op, "压缩包无法访问", err)
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
			a.safeLogInfo("ExtractZip: cache hit %s → %s", zipPath, cachedPMX)
			return &ExtractResult{FilePath: cachedPMX, Dir: destSlash, Cached: true}, nil
		}
	}

	// Cache miss — re-extract
	a.safeLogInfo("ExtractZip: extracting %s → %s", zipPath, dest)
	os.RemoveAll(dest)
	if err := os.MkdirAll(dest, 0755); err != nil {
		return nil, util.WrapErrorf(op, "创建缓存目录失败", err)
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, util.WrapErrorf(op, "打开压缩包失败", err)
	}
	defer zr.Close()

	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return nil, util.WrapErrorf(op, "解析路径失败", err)
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
			a.safeLogInfo("ExtractZip: zip slip blocked: %s", entryName)
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

		_, copyErr := io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if copyErr != nil {
			a.safeLogError("ExtractZip: copy error for %s: %v", entryName, copyErr)
		}
	}

	// Write manifest
	m := manifest{Source: zipPath, Mtime: srcMtime, Size: srcSize, Version: extractCacheVersion}
	mData, err := json.Marshal(m)
	if err != nil {
		return nil, util.WrapErrorf(op, "保存索引失败", err)
	}
	if err := os.WriteFile(manifestPath, mData, 0644); err != nil {
		return nil, util.WrapErrorf(op, "写入索引失败", err)
	}

	resultPath := filepath.ToSlash(filepath.Join(dest, innerPath))
	destSlash := filepath.ToSlash(dest)
	a.safeLogInfo("ExtractZip: done → %s", resultPath)
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
		if _, err := fileAccessor.Stat(m.Source); os.IsNotExist(err) {
			os.RemoveAll(filepath.Join(cacheRoot, entry.Name()))
			cleaned++
			a.safeLogInfo("CleanOrphanCache: removed %s (source %s gone)", entry.Name(), m.Source)
		}
	}
	a.safeLogInfo("CleanOrphanCache: cleaned %d directories", cleaned)
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
	a.safeLogInfo("ClearExtractCache: removed %d directories", removed)
	return nil
}

// ClearThumbnailCache removes ALL thumbnail cache files, forcing
// re-generation on the next model load.
func (a *App) ClearThumbnailCache() error {
	cacheRoot, err := thumbnailDir()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(cacheRoot)
	if err != nil {
		return err
	}
	removed := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			os.Remove(filepath.Join(cacheRoot, entry.Name()))
			removed++
		}
	}
	a.safeLogInfo("ClearThumbnailCache: removed %d files", removed)
	return nil
}

// ClearAllCaches removes ALL cache directories (extracted, thumbnails, serve)
// in one shot. This is the unified entry point for the "clear all caches" UI action.
func (a *App) ClearAllCaches() error {
	// Clear extracted
	if err := a.ClearExtractCache(); err != nil {
		return util.WrapErrorf("ClearAllCaches", "清除提取缓存失败", err)
	}
	// Clear thumbnails
	if err := a.ClearThumbnailCache(); err != nil {
		return util.WrapErrorf("ClearAllCaches", "清除缩略图缓存失败", err)
	}
	// Clear serve (isolated HTTP model copies)
	serveRoot, err := serveRootDir()
	if err != nil {
		a.safeLogInfo("ClearAllCaches: serve dir unavailable: %v", err)
	} else if err := os.RemoveAll(serveRoot); err != nil {
		return util.WrapErrorf("ClearAllCaches", "清除 serve 目录失败", err)
	}
	a.safeLogInfo("ClearAllCaches: all cache directories cleared")
	return nil
}

// CacheStats holds size/file-count for one cache directory.
type CacheStats struct {
	ExtractedBytes int64 `json:"extractedBytes"`
	ExtractedCount int   `json:"extractedCount"`
	ThumbnailBytes int64 `json:"thumbnailBytes"`
	ThumbnailCount int   `json:"thumbnailCount"`
	ServeBytes     int64 `json:"serveBytes"`
	ServeCount     int   `json:"serveCount"`
	TotalBytes     int64 `json:"totalBytes"`
}

// GetCacheStats returns the total size and file count of all cache directories.
func (a *App) GetCacheStats() (*CacheStats, error) {
	var stats CacheStats

	if dir, err := extractedDir(); err == nil {
		stats.ExtractedBytes, stats.ExtractedCount = dirSize(dir)
	}
	if dir, err := thumbnailDir(); err == nil {
		stats.ThumbnailBytes, stats.ThumbnailCount = dirSize(dir)
	}
	if dir, err := serveRootDir(); err == nil {
		stats.ServeBytes, stats.ServeCount = dirSize(dir)
	}
	stats.TotalBytes = stats.ExtractedBytes + stats.ThumbnailBytes + stats.ServeBytes
	return &stats, nil
}

// dirSize walks a directory and returns total bytes + file count.
func dirSize(path string) (int64, int) {
	var total int64
	var count int
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
			count++
		}
		return nil
	})
	return total, count
}

// ImportZip opens a zip file, finds the first .pmx entry, and extracts via ExtractZip.
// Returns *ExtractResult as a convenience for the frontend import flow.
func (a *App) ImportZip(zipPath string) (*ExtractResult, error) {
	return util.SafeCall(func() (*ExtractResult, error) {
		return a.importZipUnsafe(zipPath)
	})
}

func (a *App) importZipUnsafe(zipPath string) (*ExtractResult, error) {
	const op = "ImportZip"
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, util.WrapErrorf(op, "打开压缩包失败", err)
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
		return nil, util.WrapErrorf(op, "压缩包内未找到模型文件", nil)
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

// toCorruptStringShiftJIS simulates how babylon-mmd incorrectly decodes Shift-JIS bytes as UTF-8.
// [doc:adr-058] Takes a correct UTF-8 filename, encodes to Shift-JIS, then decodes as UTF-8.
func toCorruptStringShiftJIS(s string) string {
	encoded, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte(s))
	if err != nil {
		return ""
	}
	return corruptFromBytes(encoded)
}

// toCorruptStringGBK simulates how babylon-mmd incorrectly decodes GBK bytes as UTF-8.
func toCorruptStringGBK(s string) string {
	encoded, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(s))
	if err != nil {
		return ""
	}
	return corruptFromBytes(encoded)
}

func corruptFromBytes(encoded []byte) string {
	var result strings.Builder
	i := 0
	for i < len(encoded) {
		r, size := utf8.DecodeRune(encoded[i:])
		if r == utf8.RuneError {
			result.WriteRune('\uFFFD')
			i++
		} else {
			result.WriteRune(r)
			i += size
		}
	}
	return result.String()
}

// basenameFallbackFS builds a basename→real-path index then wraps an http.FileServer
// so that if a path 404s, we try to find a file with the same basename anywhere
// under the root. This handles PMX texture path mismatches (..\ subdirs,
// different casing, Chinese/shortened names).
func basenameFallbackFS(root string, logFn func(string, ...interface{})) http.Handler {
	// Build basename index: lowercase basename → first real path found
	index := make(map[string]string)
	corruptIndex := make(map[string]string)
	fileAccessor.WalkDir(root, func(walkPath string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, walkPath)
		base := strings.ToLower(d.Name())
		if _, exists := index[base]; !exists {
			index[base] = rel
		}
		// [doc:adr-058] Pre-compute corrupt strings: simulate babylon-mmd incorrectly decoding
		// Shift-JIS/GBK bytes as UTF-8, producing U+FFFD replacement characters.
		for _, fn := range []func(string) string{toCorruptStringShiftJIS, toCorruptStringGBK} {
			if corrupt := fn(base); corrupt != "" && corrupt != base {
				if prev, exists := corruptIndex[corrupt]; !exists {
					corruptIndex[corrupt] = rel
				} else {
					// [doc:adr-058] Collision: two different files produce the same corrupt
					// encoding (e.g. ひらがな vs カタカナ under GBK). Log warning and keep
					// the first-seen entry — arbitrary but deterministic.
					if logFn != nil {
						logFn("FS: corruptIndex collision: %q (prev=%q, curr=%q) — keeping first", corrupt, prev, rel)
					}
				}
			}
		}
		return nil
	})
	if logFn != nil {
		logFn("FS: indexed %d files (%d corrupt entries) under %s", len(index), len(corruptIndex), root)
	}

	fs := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if logFn != nil {
			logFn("FS: %s %s", r.Method, r.URL.Path)
		}

		// [doc:adr-057] 优先处理查询参数 ?f=<base64url>
		// 前端将文件名（或相对路径）base64url 编码后通过 ?f= 传递，
		// 绕开 URL 路径段编码歧义（U+FFFD 被编码为 %EF%BF%BD 后与 d.Name() 不匹配）。
		if enc := r.URL.Query().Get("f"); enc != "" {
			if decoded, err := base64.RawURLEncoding.DecodeString(enc); err == nil {
				relPath := string(decoded)
				// 路径遍历防护
				cleaned := filepath.Clean(relPath)
				if strings.Contains(cleaned, "..") {
					http.NotFound(w, r)
					return
				}
				// 1. 尝试完整 relPath（支持 outfit 传来的子目录相对路径）
				fullPath := filepath.Join(root, filepath.FromSlash(cleaned))
				if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
					http.ServeFile(w, r, fullPath)
					return
				}
				// 2. basename fallback（支持 resolveFileUrl 传来的单文件名）
				reqBase := strings.ToLower(path.Base(cleaned))
				if entry, ok := index[reqBase]; ok {
					http.ServeFile(w, r, filepath.Join(root, entry))
					return
				}
				// ?f= 未命中 → 直接 404，不走路径段兜底（避免歧义）
				http.NotFound(w, r)
				return
			}
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

		// [doc:adr-058] Standard match failed → try corrupt string mapping
		if !ok {
			if relPath, ok = corruptIndex[reqBase]; ok {
				if logFn != nil {
					logFn("FS: corrupt match %q → %s", reqBase, relPath)
				}
			}
		}

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
		a.safeLogInfo("StartFileServer: reuse port %d for %s", info.port, dirPath)
		return info.port, nil
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}

	port := listener.Addr().(*net.TCPAddr).Port
	a.safeLogInfo("StartFileServer: dir=%s port=%d", dirPath, port)

	handler := corsMiddleware(basenameFallbackFS(dirPath, func(format string, args ...interface{}) {
		a.safeLogInfo(format, args...)
	}))

	srv := &http.Server{Handler: handler}
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			a.safeLogError("StartFileServer: Serve error: %v", err)
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

// StopFileServer stops and releases the HTTP file server previously started
// for dirPath via StartFileServer. The underlying listener is closed by the
// server's Serve goroutine once Shutdown completes. If no server is running
// for dirPath, it returns an error.
func (a *App) StopFileServer(dirPath string) error {
	a.httpSrvMu.Lock()
	info, ok := a.httpServers[dirPath]
	if !ok {
		a.httpSrvMu.Unlock()
		return fmt.Errorf("no file server running for %s", dirPath)
	}
	delete(a.httpServers, dirPath)
	a.httpSrvMu.Unlock()

	a.safeLogInfo("StopFileServer: stop port %d for %s", info.port, dirPath)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := info.server.Shutdown(ctx); err != nil {
		a.safeLogError("StopFileServer: shutdown error: %v", err)
		return err
	}
	return nil
}
