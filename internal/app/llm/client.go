package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	neturl "net/url"
	"net/http"
	"strings"
	"time"

	"mikumikuar/internal/i18nerr"
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
	Type      string // "chunk" | "done" | "error" | "tool_call"
	Delta     string // for "chunk"
	Reasoning bool   // for "chunk": true 表示这是推理模型的思考过程（reasoning），非正式回答
	Error     string // for "error"
	ToolName  string // for "tool_call"
	ToolArgs  string // for "tool_call"
	ToolId    string // for "tool_call"
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
		http: &http.Client{
			// 流式 SSE 不能设 Client.Timeout（会掐断长连接），但用 Transport 的
			// ResponseHeaderTimeout 限制"请求发出→收到响应头"的时长：服务器接受连接却
			// 迟迟不返回首字节时快速失败（拿到明确错误），避免前端只能靠看门狗黑盒超时。
			// 收到响应头后的流式 body 读取不受此限制。
			Transport: &http.Transport{
				ResponseHeaderTimeout: 25 * time.Second,
			},
		},
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

	// model 优先用请求参数，为空时回退到 client 配置的 model（getLLMClient 已按
	// 配置填充 c.config.Model）。此前直接用 req.Model 会忽略配置回退，导致前端
	// 未显式传 model 时 body 里 model 为空 → SenseNova 等网关返回 400 "required model"。
	model := req.Model
	if model == "" {
		model = c.config.Model
	}

	body := map[string]interface{}{
		"model":       model,
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

	slog.Info(fmt.Sprintf("[ai-stream][llm] 发送请求 url=%s model=%s 消息数=%d", c.config.BaseURL, model, len(req.Messages)))
	reqStart := time.Now()
	resp, err := c.http.Do(httpReq)
	if err != nil {
		slog.Warn(fmt.Sprintf("[ai-stream][llm] http.Do 失败 耗时=%s: %v", time.Since(reqStart), err))
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("HTTP 请求失败: %v", err)})
		return
	}
	defer resp.Body.Close()
	slog.Info(fmt.Sprintf("[ai-stream][llm] 收到响应 status=%d 首字节耗时=%s", resp.StatusCode, time.Since(reqStart)))

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		slog.Warn(fmt.Sprintf("[ai-stream][llm] 非 200 响应 status=%d body=%s", resp.StatusCode, msg))
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, msg)})
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	type streamChunk struct {
		Choices []struct {
			Delta struct {
				Content   string          `json:"content,omitempty"`
				// SenseNova 6.7 等推理模型把思考过程放在 reasoning/reasoning_content，
				// 正式回答仍在 content。二者都需输出，否则纯 reasoning 的 chunk 被丢弃、
				// 前端收不到任何文本（表现为 status=200 但事件数=1 只有 done）。
				Reasoning        string          `json:"reasoning,omitempty"`
				ReasoningContent string          `json:"reasoning_content,omitempty"`
				ToolCalls        []deltaToolCall `json:"tool_calls,omitempty"`
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

	// 诊断计数：区分 content / reasoning / tool_call delta，排查分类错误
	contentChunks := 0
	reasoningChunks := 0
	toolCallChunks := 0

	rawLineCount := 0
	for scanner.Scan() {
		line := scanner.Text()
		// 诊断：打印前若干行原始 SSE，定位非标准格式（前缀/字段差异导致解析不出 chunk）。
		if rawLineCount < 8 {
			slog.Info(fmt.Sprintf("[ai-stream][llm] 原始行#%d: %q", rawLineCount, line))
			rawLineCount++
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(line[5:])
		if data == "" || data == "[DONE]" {
			slog.Info(fmt.Sprintf("[ai-stream][llm] 收到 %q 哨兵 finish_reason=空 content=%d reasoning=%d toolCallDelta=%d",
				data, contentChunks, reasoningChunks, toolCallChunks))
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

		// 先输出文本再判结束：最后一个 chunk 可能同时携带 content 和 finish_reason（如
		// "stop"），若先判 finish_reason 就 return 会丢掉该 chunk 的文本。
		// 正式回答（content）与推理模型的思考过程（reasoning）分开标记，供前端区分展示
		// （思考过程折叠、正式回答直显）。
		delta := chunk.Choices[0].Delta
		if delta.Content != "" {
			contentChunks++
			emit(StreamEvent{Type: "chunk", Delta: delta.Content, Reasoning: false})
		} else if delta.Reasoning != "" {
			reasoningChunks++
			emit(StreamEvent{Type: "chunk", Delta: delta.Reasoning, Reasoning: true})
		} else if delta.ReasoningContent != "" {
			reasoningChunks++
			emit(StreamEvent{Type: "chunk", Delta: delta.ReasoningContent, Reasoning: true})
		}
		if len(chunk.Choices[0].Delta.ToolCalls) > 0 {
			toolCallChunks++
		}

		// Handle finish_reason
		// 注意：SenseNova 等网关每个 chunk 都带 "finish_reason":""（空字符串，非 null），
		// 反序列化后 *string 非 nil 但指向空串。若仅判 != nil 会在第一个 chunk 就误判结束、
		// 立即 emit done return，导致 reasoning/content 全部丢失（表现为事件数=1 只有 done）。
		// 真正结束的标志是 finish_reason 非空（如 "stop"/"tool_calls"/"length"）。
		if fr := chunk.Choices[0].FinishReason; fr != nil && *fr != "" {
			reason := *fr
			if reason == "tool_calls" {
				// 诊断：打印每个累积的 tool_call（名称 + 参数截断）
				for idx, acc := range toolAccums {
					argsPreview := acc.arguments
					if len(argsPreview) > 80 {
						argsPreview = argsPreview[:80] + "…"
					}
					slog.Info(fmt.Sprintf("[ai-stream][llm] tool_call#%d name=%s args=%s id=%s",
						idx, acc.name, argsPreview, acc.id))
					emit(StreamEvent{
						Type:     "tool_call",
						ToolName: acc.name,
						ToolArgs: acc.arguments,
						ToolId:   acc.id,
					})
				}
				slog.Info(fmt.Sprintf("[ai-stream][llm] finish_reason=tool_calls tools=%d content=%d reasoning=%d toolCallDelta=%d",
					len(toolAccums), contentChunks, reasoningChunks, toolCallChunks))
				emit(StreamEvent{Type: "done"})
				return
			}
			// stop / length / 其他未知值
			slog.Info(fmt.Sprintf("[ai-stream][llm] finish_reason=%s content=%d reasoning=%d toolCallDelta=%d",
				reason, contentChunks, reasoningChunks, toolCallChunks))
			emit(StreamEvent{Type: "done"})
			return
		}
	}

	if err := scanner.Err(); err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("流读取错误: %v", err)})
		return
	}

	// 兜底：SSE 流结束但未收到显式 finish_reason（连接被关闭 / 网关异常截断）
	slog.Info(fmt.Sprintf("[ai-stream][llm] 流结束无 finish_reason（兜底） content=%d reasoning=%d toolCallDelta=%d",
		contentChunks, reasoningChunks, toolCallChunks))
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

// FetchModels 从端点发现可用模型列表（OpenAI 兼容 {base}/models + Ollama /api/tags）。
// 镜像前端 browser-adapter 的候选 URL 逻辑：先试 {base}/models，
// 若 base 以 /v1 结尾再试去 /v1 的 /models；localhost 时额外尝试 {origin}/api/tags（Ollama 原生）。
// 全部失败返回最后一个错误。
func FetchModels(ctx context.Context, cfg Config) ([]string, error) {
	if cfg.BaseURL == "" {
		return nil, i18nerr.New("llm.endpointEmpty", "端点为空")
	}
	base := strings.TrimSuffix(cfg.BaseURL, "/chat/completions")
	candidates := []string{base + "/models"}
	if strings.HasSuffix(base, "/v1") {
		candidates = append(candidates, strings.TrimSuffix(base, "/v1")+"/models")
	}
	// Ollama 原生 API：{origin}/api/tags（仅限 localhost，与 browser-adapter 对齐）
	if isLocalhost(base) {
		if origin := urlOrigin(base); origin != "" {
			candidates = append(candidates, origin+"/api/tags")
		}
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
		lastErr = i18nerr.New("llm.noModels", "响应无有效模型列表")
	}
	return nil, lastErr
}

// fetchModelsFrom 请求单个候选 URL 并解析两种格式：
//   - OpenAI 兼容：{ data: [{ id: string }] }
//   - Ollama 原生：{ models: [{ name: string }] }
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

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	// 双格式解析：先试 OpenAI {data:[{id}]}，再试 Ollama {models:[{name}]}
	var openai struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &openai); err == nil && len(openai.Data) > 0 {
		models := make([]string, 0, len(openai.Data))
		for _, m := range openai.Data {
			if m.ID != "" {
				models = append(models, m.ID)
			}
		}
		if len(models) > 0 {
			return models, nil
		}
	}
	var ollama struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &ollama); err == nil && len(ollama.Models) > 0 {
		models := make([]string, 0, len(ollama.Models))
		for _, m := range ollama.Models {
			if m.Name != "" {
				models = append(models, m.Name)
			}
		}
		return models, nil
	}
	return nil, i18nerr.New("llm.unexpectedFormat", "响应不是 OpenAI 或 Ollama 格式")
}

// isLocalhost 判断 URL 是否指向本机（localhost / 127.0.0.1）。
func isLocalhost(rawURL string) bool {
	return strings.Contains(rawURL, "localhost") || strings.Contains(rawURL, "127.0.0.1")
}

// urlOrigin 提取 URL 的 origin（scheme://host[:port]），失败返回空串。
func urlOrigin(rawURL string) string {
	u, err := neturl.Parse(rawURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
