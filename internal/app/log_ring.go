package app

import (
	"context"
	"fmt"
	"log/slog"
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

// SlogRingHandler is a custom slog.Handler that writes to a LogRing + original handler.
type SlogRingHandler struct {
	ring    *LogRing
	inner   slog.Handler
}

// NewSlogRingHandler creates a handler that dual-writes to ring and inner handler.
func NewSlogRingHandler(ring *LogRing, inner slog.Handler) *SlogRingHandler {
	return &SlogRingHandler{ring: ring, inner: inner}
}

func (h *SlogRingHandler) Enabled(_ context.Context, _ slog.Level) bool {
	return true
}

func (h *SlogRingHandler) Handle(_ context.Context, r slog.Record) error {
	attrs := make(map[string]any)
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = a.Value.Any()
		return true
	})

	entry := LogEntry{
		Time:  r.Time.Format(time.RFC3339),
		Level: r.Level.String(),
		Msg:   r.Message,
	}
	if len(attrs) > 0 {
		entry.Attrs = attrs
	}

	h.ring.Append(entry)

	// Forward to inner handler
	if h.inner != nil {
		return h.inner.Handle(context.Background(), r)
	}
	return nil
}

func (h *SlogRingHandler) WithAttrs(_ []slog.Attr) slog.Handler {
	// Simplified: return self (inner handler handles its own attrs)
	return h
}

func (h *SlogRingHandler) WithGroup(_ string) slog.Handler {
	return h
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
	return map[string]any{
		"llmConnected": a.llmCancel != nil,
		"configValid":  true,
		"model":        cfg.LLMConfig.Model,
		"apiEndpoint":  cfg.LLMConfig.BaseURL,
	}
}
