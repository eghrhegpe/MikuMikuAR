package app

import (
	"context"
	"net"
	"net/http"
	"testing"
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

	a.httpSrvMu.Lock()
	if len(a.httpServers) != 0 {
		t.Errorf("expected 0 servers after shutdown, got %d", len(a.httpServers))
	}
	a.httpSrvMu.Unlock()
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
