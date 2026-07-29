package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestFetchModels_ParsesOpenAIFormat 验证 {data:[{id}]} 解析与 Bearer 鉴权透传。
func TestFetchModels_ParsesOpenAIFormat(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/models" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-b"},{"id":"model-a"}]}`))
	}))
	defer srv.Close()

	models, err := FetchModels(context.Background(), Config{
		BaseURL: srv.URL + "/v1/chat/completions",
		ApiKey:  "sk-test",
	})
	if err != nil {
		t.Fatalf("FetchModels failed: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d: %v", len(models), models)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization not forwarded: got %q", gotAuth)
	}
}

// TestFetchModels_EmptyEndpoint 空端点应立即返回错误，不发请求。
func TestFetchModels_EmptyEndpoint(t *testing.T) {
	if _, err := FetchModels(context.Background(), Config{}); err == nil {
		t.Error("expected error for empty endpoint")
	}
}

// TestFetchModels_HTTPError 上游非 200 应返回错误而非空成功。
func TestFetchModels_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer srv.Close()

	if _, err := FetchModels(context.Background(), Config{BaseURL: srv.URL + "/v1/chat/completions"}); err == nil {
		t.Error("expected error for HTTP 401")
	}
}

// captureStreamModel 起一个 SSE 桩服务器，捕获 StreamChat 请求体里的 model 字段。
func captureStreamModel(t *testing.T, cfg Config, reqModel string) string {
	t.Helper()
	var gotModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var parsed struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &parsed)
		gotModel = parsed.Model
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: [DONE]\n"))
	}))
	defer srv.Close()

	cfg.BaseURL = srv.URL + "/v1/chat/completions"
	c := NewClient(cfg)
	c.StreamChat(context.Background(), ChatRequest{Model: reqModel, Messages: []ChatMessage{{Role: "user", Content: "hi"}}}, func(StreamEvent) {})
	return gotModel
}

// TestStreamChat_ModelFallsBackToConfig 验证 req.Model 为空时回退到 config.Model。
// 回归背景：body 曾直接用 req.Model，前端未传 model 时发出空 model，
// SenseNova 等网关返回 400 "required model"（TestConnection 用 cfg.Model 却能过，掩盖了问题）。
func TestStreamChat_ModelFallsBackToConfig(t *testing.T) {
	got := captureStreamModel(t, Config{Model: "sensenova-6.7-flash-lite"}, "")
	if got != "sensenova-6.7-flash-lite" {
		t.Errorf("空 req.Model 应回退到 config.Model，got %q", got)
	}
}

// TestStreamChat_ModelPrefersRequest 验证 req.Model 非空时优先于 config.Model。
func TestStreamChat_ModelPrefersRequest(t *testing.T) {
	got := captureStreamModel(t, Config{Model: "config-model"}, "req-model")
	if got != "req-model" {
		t.Errorf("非空 req.Model 应优先，got %q", got)
	}
}

// collectStreamText 起 SSE 桩服务器返回指定行，收集 StreamChat emit 的全部文本 chunk。
func collectStreamText(t *testing.T, sseLines []string) (string, int) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, ln := range sseLines {
			_, _ = w.Write([]byte(ln + "\n"))
		}
	}))
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL + "/v1/chat/completions", Model: "m"})
	var text string
	events := 0
	c.StreamChat(context.Background(), ChatRequest{Messages: []ChatMessage{{Role: "user", Content: "hi"}}}, func(ev StreamEvent) {
		events++
		if ev.Type == "chunk" {
			text += ev.Delta
		}
	})
	return text, events
}

// TestStreamChat_EmptyFinishReasonNotDone 回归守护：SenseNova 每个 chunk 都带
// "finish_reason":""（空串非 null），旧逻辑仅判 != nil 会在首个 chunk 误判结束、
// 立即 done return，导致 reasoning/content 全丢（事件数=1）。空串不得终止流。
func TestStreamChat_EmptyFinishReasonNotDone(t *testing.T) {
	lines := []string{
		`data: {"choices":[{"index":0,"delta":{"reasoning":"想一下"},"finish_reason":""}]}`,
		`data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":""}]}`,
		`data: {"choices":[{"index":0,"delta":{"content":"！"},"finish_reason":"stop"}]}`,
	}
	text, events := collectStreamText(t, lines)
	if text != "想一下你好！" {
		t.Errorf("应输出 reasoning + content 全部文本，got %q", text)
	}
	// 3 个 chunk + 1 个 done
	if events != 4 {
		t.Errorf("expected 4 events (3 chunk + done), got %d", events)
	}
}

// TestStreamChat_ReasoningEmitted 验证纯 reasoning 字段（无 content）也作为文本输出。
func TestStreamChat_ReasoningEmitted(t *testing.T) {
	lines := []string{
		`data: {"choices":[{"index":0,"delta":{"reasoning":"思考"},"finish_reason":""}]}`,
		`data: [DONE]`,
	}
	text, _ := collectStreamText(t, lines)
	if text != "思考" {
		t.Errorf("reasoning 应作为文本输出，got %q", text)
	}
}
