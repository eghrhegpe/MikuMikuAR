package app

import (
	"context"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

// ======== shutdown with timeout ========

func TestShutdown_ClosesHTTPServers(t *testing.T) {
	a := &App{
		httpServers: make(map[string]*httpServerInfo),
	}

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

	// The caller drains the map itself (ServiceShutdown contract); the real
	// behavior under test is that shutdownServers gracefully shuts down the
	// underlying http.Server (the old "map is empty" check was tautological
	// — the test emptied it). The RegisterOnShutdown callback count is the
	// observable signal that Shutdown reached the server.
	var shutdowns int32
	srv.RegisterOnShutdown(func() { atomic.AddInt32(&shutdowns, 1) })

	a.httpSrvMu.Lock()
	servers := make([]*http.Server, 0, len(a.httpServers))
	for _, info := range a.httpServers {
		servers = append(servers, info.server)
	}
	a.httpServers = make(map[string]*httpServerInfo)
	a.httpSrvMu.Unlock()

	err = shutdownServers(context.Background(), servers)
	if err != nil {
		t.Fatalf("shutdownServers returned error: %v", err)
	}

	// [audit:fix] Go's http.Server.Shutdown invokes onShutdown callbacks in
	// background goroutines (`go f()` in net/http/server.go) and returns
	// without waiting for them, so the counter may not have advanced yet
	// when Shutdown returns. Poll briefly instead of asserting immediately.
	deadline := time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(&shutdowns) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if n := atomic.LoadInt32(&shutdowns); n != 1 {
		t.Errorf("expected exactly 1 graceful-shutdown callback, got %d", n)
	}
}

func TestShutdown_NoServers(t *testing.T) {
	err := shutdownServers(context.Background(), nil)
	if err != nil {
		t.Errorf("shutdown with no servers should return nil, got %v", err)
	}
}

func TestServiceShutdown_ClearsServers(t *testing.T) {
	a := &App{
		httpServers: make(map[string]*httpServerInfo),
	}

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

	err = a.ServiceShutdown()
	if err != nil {
		t.Fatalf("ServiceShutdown returned error: %v", err)
	}

	a.httpSrvMu.Lock()
	n := len(a.httpServers)
	a.httpSrvMu.Unlock()
	if n != 0 {
		t.Errorf("expected 0 servers after ServiceShutdown, got %d", n)
	}
}
