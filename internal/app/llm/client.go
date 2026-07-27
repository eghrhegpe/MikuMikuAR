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

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
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

func TestConnection(ctx context.Context, cfg Config) (bool, string) {
	if cfg.BaseURL == "" {
		return false, "端点为空"
	}

	body := map[string]interface{}{
		"model":    cfg.Model,
		"messages": []ChatMessage{{Role: "user", Content: "ping"}},
		"max_tokens": 1,
		"stream":   false,
	}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return false, fmt.Sprintf("序列化失败: %v", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", cfg.BaseURL, bytes.NewReader(bodyJSON))
	if err != nil {
		return false, fmt.Sprintf("创建请求失败: %v", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if cfg.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+cfg.ApiKey)
	}

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return false, fmt.Sprintf("连接失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return false, fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	return true, ""
}
