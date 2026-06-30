package main

import (
	"context"
	"fmt"
	"net/http"
	"net"
	"testing"
	"time"
)

// ======== shutdown with timeout ========

func TestShutdown_ClosesHTTPServers(t *testing.T) {
	a := &App{
		httpServers: make(map[string]*httpServerInfo),
	}

	// Start a dummy HTTP server
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.NotFoundHandler()}
	go func() { srv.Serve(listener) }()

	a.httpSrvMu.Lock()
	a.httpServers["/test/dir"] = &httpServerInfo{
		server:   srv,
		port:     listener.Addr().(*net.TCPAddr).Port,
		dir:      "/test/dir",
		listener: listener,
	}
	a.httpSrvMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = a.shutdownWithTimeout(ctx, 3*time.Second)
	if err != nil {
		t.Fatalf("shutdownWithTimeout returned error: %v", err)
	}

	// Verify server map is empty
	a.httpSrvMu.Lock()
	if len(a.httpServers) != 0 {
		t.Errorf("expected 0 servers after shutdown, got %d", len(a.httpServers))
	}
	a.httpSrvMu.Unlock()
}

func TestShutdown_RespectsTimeout(t *testing.T) {
	a := &App{
		httpServers: make(map[string]*httpServerInfo),
	}

	// Start a server with a handler that hangs
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	// Use a channel to block the handler
	hanging := make(chan struct{})
	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-hanging
		}),
	}
	go func() { srv.Serve(listener) }()

	// Send a request to make the handler busy (so Shutdown will wait)
	port := listener.Addr().(*net.TCPAddr).Port
	go func() {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
		if err == nil {
			resp.Body.Close()
		}
	}()

	// Wait a bit for the request to reach the handler
	time.Sleep(20 * time.Millisecond)

	a.httpSrvMu.Lock()
	a.httpServers["/test/hang"] = &httpServerInfo{
		server:   srv,
		port:     port,
		dir:      "/test/hang",
		listener: listener,
	}
	a.httpSrvMu.Unlock()

	// Give it a short timeout
	ctx := context.Background()
	start := time.Now()
	err = a.shutdownWithTimeout(ctx, 100*time.Millisecond)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("expected timeout error, got nil")
	}
	if elapsed < 80*time.Millisecond {
		t.Errorf("shutdown returned too quickly (%v), expected to wait for timeout", elapsed)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("shutdown took too long (%v), should have timed out after 100ms", elapsed)
	}

	// Clean up
	close(hanging)
}

func TestShutdown_NoServers(t *testing.T) {
	a := &App{
		httpServers: make(map[string]*httpServerInfo),
	}

	ctx := context.Background()
	err := a.shutdownWithTimeout(ctx, 1*time.Second)
	if err != nil {
		t.Errorf("shutdown with no servers should return nil, got %v", err)
	}
}
