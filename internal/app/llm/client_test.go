package llm

import (
	"context"
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
