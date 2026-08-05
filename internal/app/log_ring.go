package app

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

// LogEntry holds a single log record for the diagnostic ring buffer.
type LogEntry struct {
	Time  string         `json:"time"`
	Level string         `json:"level"`
	Msg   string         `json:"msg"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

// LogRing is a fixed-capacity ring buffer for slog records.
// Safe for concurrent use.
type LogRing struct {
	mu      sync.Mutex
	entries []LogEntry
	cap     int
	head    int // next write position
	size    int // current count
}

// NewLogRing creates a ring buffer with the given capacity.
func NewLogRing(cap int) *LogRing {
	if cap <= 0 {
		cap = 200
	}
	return &LogRing{
		entries: make([]LogEntry, cap),
		cap:     cap,
	}
}

// Append adds a log entry to the ring buffer.
func (r *LogRing) Append(entry LogEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries[r.head] = entry
	r.head = (r.head + 1) % r.cap
	if r.size < r.cap {
		r.size++
	}
}

// AppendLine parses a pre-formatted slog line and appends it to the ring.
func (r *LogRing) AppendLine(text string) {
	level := "info"
	// slog TextHandler 输出形如 "time=... level=ERROR msg=..."，行首是 time=，
	// 旧逻辑按行首 5 字节匹配 ERROR/WARN 永不命中 → level 恒为 info，需按 level= 字段匹配。
	switch {
	case strings.Contains(text, "level=ERROR"):
		level = "error"
	case strings.Contains(text, "level=WARN"):
		level = "warn"
	}
	r.Append(LogEntry{
		Time:  time.Now().Format(time.RFC3339),
		Level: level,
		Msg:   text,
	})
}

// Recent returns the last n entries (most recent first).
// If n <= 0 or n > size, returns all entries.
func (r *LogRing) Recent(n int) []LogEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n <= 0 || n > r.size {
		n = r.size
	}
	result := make([]LogEntry, n)
	start := (r.head - n + r.cap) % r.cap
	for i := 0; i < n; i++ {
		result[i] = r.entries[(start+i)%r.cap]
	}
	// Reverse so most recent is first
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result
}

// RecentByLevel returns entries filtered by level (info/warn/error).
func (r *LogRing) RecentByLevel(level string, n int) []LogEntry {
	all := r.Recent(0) // get all
	filtered := make([]LogEntry, 0, len(all))
	for _, e := range all {
		if level == "" || e.Level == level {
			filtered = append(filtered, e)
		}
	}
	if n > 0 && len(filtered) > n {
		filtered = filtered[:n]
	}
	return filtered
}

// DualWriter implements io.Writer for slog: writes to ring buffer AND stderr (forwarded io.Writer).
type DualWriter struct {
	ring    *LogRing
	forward io.Writer
}

// NewDualWriter creates a writer that captures slog output to the ring buffer.
func NewDualWriter(ring *LogRing, forward io.Writer) *DualWriter {
	return &DualWriter{ring: ring, forward: forward}
}

func (w *DualWriter) Write(p []byte) (int, error) {
	n, err := w.forward.Write(p)
	if w.ring != nil && n > 0 {
		w.ring.AppendLine(string(p[:n]))
	}
	return n, err
}

// App diagnostic bindings for the AI assistant.

// AiGetBackendLogs returns recent backend log entries.
func (a *App) AiGetBackendLogs(level string, limit int) []LogEntry {
	if a.logRing == nil {
		return []LogEntry{}
	}
	if limit <= 0 {
		limit = 50
	}
	return a.logRing.RecentByLevel(level, limit)
}

// AiGetBackendState returns current backend configuration state.
func (a *App) AiGetBackendState() map[string]any {
	cfg, err := a.GetConfig()
	if err != nil || cfg.LLMConfig == nil {
		return map[string]any{
			"llmConnected": false,
			"configValid":  false,
			"error":        fmt.Sprintf("配置读取失败: %v", err),
		}
	}
	// llmCancel 由 AiStreamChat/AiCancelStream 在 llmMu 下读写，此处必须持锁读。
	a.llmMu.Lock()
	connected := a.llmCancel != nil
	a.llmMu.Unlock()
	return map[string]any{
		"llmConnected": connected,
		"configValid":  true,
		"model":        cfg.LLMConfig.Model,
		"apiEndpoint":  cfg.LLMConfig.BaseURL,
	}
}
