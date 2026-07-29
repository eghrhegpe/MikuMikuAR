package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type ToolCall struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Function ToolCallFunc   `json:"function"`
}

type ToolCallFunc struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ChatMessage struct {
	Role       string     `json:"role"`
	Content    any        `json:"content"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
}

type ChatRequest struct {
	Model       string         `json:"model"`
	Messages    []ChatMessage  `json:"messages"`
	Temperature float64        `json:"temperature"`
	MaxTokens   int            `json:"max_tokens"`
	Tools       []ToolSchema   `json:"tools,omitempty"`
}

type Config struct {
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	ApiKey  string `json:"apiKey"`
}

type StreamEvent struct {
	Type     string // "chunk" | "done" | "error" | "tool_call"
	Delta    string // for "chunk"
	Error    string // for "error"
	ToolName string // for "tool_call"
	ToolArgs string // for "tool_call"
	ToolId   string // for "tool_call"
}

type ConnectionResult struct {
	OK      bool   `json:"ok"`
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

func classifyConnectionError(err error, statusCode int, body string) ConnectionResult {
	msg := strings.TrimSpace(body)
	if err != nil {
		msg = err.Error()
	}
	lower := strings.ToLower(msg)

	if statusCode == 0 && err != nil {
		if strings.Contains(lower, "connection refused") ||
			strings.Contains(lower, "no connection could be made") ||
			strings.Contains(lower, "dial tcp") ||
			strings.Contains(lower, "timeout") ||
			strings.Contains(lower, "no such host") {
			return ConnectionResult{OK: false, Kind: "network", Message: msg}
		}
		return ConnectionResult{OK: false, Kind: "unknown", Message: msg}
	}

	switch statusCode {
	case http.StatusUnauthorized:
		return ConnectionResult{OK: false, Kind: "unauthorized", Message: fmt.Sprintf("HTTP %d: %s", statusCode, msg)}
	case http.StatusForbidden:
		return ConnectionResult{OK: false, Kind: "unauthorized", Message: fmt.Sprintf("HTTP %d: %s", statusCode, msg)}
	case http.StatusNotFound:
		return ConnectionResult{OK: false, Kind: "notFound", Message: fmt.Sprintf("HTTP %d: %s", statusCode, msg)}
	case http.StatusTooManyRequests:
		return ConnectionResult{OK: false, Kind: "rateLimit", Message: fmt.Sprintf("HTTP %d: %s", statusCode, msg)}
	}

	if statusCode >= 500 {
		return ConnectionResult{OK: false, Kind: "server", Message: fmt.Sprintf("HTTP %d: %s", statusCode, msg)}
	}

	if statusCode >= 400 {
		return ConnectionResult{OK: false, Kind: "unknown", Message: fmt.Sprintf("HTTP %d: %s", statusCode, msg)}
	}

	return ConnectionResult{OK: true, Kind: "", Message: ""}
}

type deltaToolCall struct {
	Index    *int   `json:"index"`
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function *struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function,omitempty"`
}

type Client struct {
	config Config
	http   *http.Client
}

func NewClient(cfg Config) *Client {
	return &Client{
		config: cfg,
		http:   &http.Client{},
	}
}

func (c *Client) Config() Config {
	return c.config
}

func (c *Client) WithConfig(cfg Config) *Client {
	return NewClient(cfg)
}

func (c *Client) StreamChat(ctx context.Context, req ChatRequest, emit func(StreamEvent)) {
	if c.config.BaseURL == "" {
		emit(StreamEvent{Type: "error", Error: "LLM 端点未配置"})
		return
	}

	body := map[string]interface{}{
		"model":       req.Model,
		"messages":    req.Messages,
		"temperature": req.Temperature,
		"max_tokens":  req.MaxTokens,
		"stream":      true,
	}
	if len(req.Tools) > 0 {
		body["tools"] = req.Tools
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("序列化请求失败: %v", err)})
		return
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.config.BaseURL, bytes.NewReader(bodyJSON))
	if err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("创建请求失败: %v", err)})
		return
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Cache-Control", "no-cache")
	httpReq.Header.Set("Connection", "keep-alive")
	if c.config.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.config.ApiKey)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("HTTP 请求失败: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, msg)})
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	type streamChunk struct {
		Choices []struct {
			Delta struct {
				Content   string           `json:"content,omitempty"`
				ToolCalls []deltaToolCall  `json:"tool_calls,omitempty"`
			} `json:"delta"`
			FinishReason *string `json:"finish_reason"`
		} `json:"choices"`
	}

	type toolCallAcc struct {
		id        string
		name      string
		arguments string
	}
	toolAccums := make(map[int]*toolCallAcc)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(line[5:])
		if data == "" || data == "[DONE]" {
			emit(StreamEvent{Type: "done"})
			return
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}

		// Accumulate tool_calls delta by index
		for _, tc := range chunk.Choices[0].Delta.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			acc, exists := toolAccums[idx]
			if !exists {
				acc = &toolCallAcc{}
				toolAccums[idx] = acc
			}
			if tc.ID != "" {
				acc.id = tc.ID
			}
			if tc.Function != nil {
				if tc.Function.Name != "" {
					acc.name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					acc.arguments += tc.Function.Arguments
				}
			}
		}

		// Handle finish_reason
		if chunk.Choices[0].FinishReason != nil {
			reason := *chunk.Choices[0].FinishReason
			if reason == "tool_calls" {
				for _, acc := range toolAccums {
					emit(StreamEvent{
						Type:     "tool_call",
						ToolName: acc.name,
						ToolArgs: acc.arguments,
						ToolId:   acc.id,
					})
				}
				emit(StreamEvent{Type: "done"})
				return
			}
			emit(StreamEvent{Type: "done"})
			return
		}

		// Emit text content
		content := chunk.Choices[0].Delta.Content
		if content != "" {
			emit(StreamEvent{Type: "chunk", Delta: content})
		}
	}

	if err := scanner.Err(); err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("流读取错误: %v", err)})
		return
	}

	emit(StreamEvent{Type: "done"})
}

func TestConnection(ctx context.Context, cfg Config) ConnectionResult {
	if cfg.BaseURL == "" {
		return ConnectionResult{OK: false, Kind: "missingEndpoint", Message: "端点为空"}
	}

	body := map[string]interface{}{
		"model":      cfg.Model,
		"messages":   []ChatMessage{{Role: "user", Content: "ping"}},
		"max_tokens": 1,
		"stream":     false,
	}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return ConnectionResult{OK: false, Kind: "unknown", Message: fmt.Sprintf("序列化失败: %v", err)}
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", cfg.BaseURL, bytes.NewReader(bodyJSON))
	if err != nil {
		return ConnectionResult{OK: false, Kind: "unknown", Message: fmt.Sprintf("创建请求失败: %v", err)}
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if cfg.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+cfg.ApiKey)
	}

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return classifyConnectionError(err, 0, "")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return classifyConnectionError(nil, resp.StatusCode, string(respBody))
	}

	return ConnectionResult{OK: true, Kind: "", Message: ""}
}

// FetchModels 从端点发现可用模型列表（OpenAI 兼容 {base}/models）。
// 镜像前端 browser-adapter 的候选 URL 逻辑：先试 {base}/models，
// 若 base 以 /v1 结尾再试去 /v1 的 /models。全部失败返回最后一个错误。
func FetchModels(ctx context.Context, cfg Config) ([]string, error) {
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("端点为空")
	}
	base := strings.TrimSuffix(cfg.BaseURL, "/chat/completions")
	candidates := []string{base + "/models"}
	if strings.HasSuffix(base, "/v1") {
		candidates = append(candidates, strings.TrimSuffix(base, "/v1")+"/models")
	}

	client := &http.Client{}
	var lastErr error
	for _, url := range candidates {
		models, err := fetchModelsFrom(ctx, client, url, cfg.ApiKey)
		if err != nil {
			lastErr = err
			continue
		}
		if len(models) > 0 {
			return models, nil
		}
		lastErr = fmt.Errorf("响应无有效模型列表")
	}
	return nil, lastErr
}

// fetchModelsFrom 请求单个候选 URL 并解析 OpenAI 兼容的 {data:[{id}]} 结构。
func fetchModelsFrom(ctx context.Context, client *http.Client, url, apiKey string) ([]string, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	models := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	return models, nil
}
