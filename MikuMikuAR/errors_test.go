package main

import (
	"errors"
	"os"
	"strings"
	"testing"
)

// ======== wrapError ========

func TestWrapError_NilError(t *testing.T) {
	if err := wrapError("op", nil); err != nil {
		t.Errorf("wrapError with nil error should return nil, got %v", err)
	}
}

func TestWrapError_WrapsWithOpPrefix(t *testing.T) {
	inner := errors.New("inner failure")
	err := wrapError("LoadModel", inner)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.HasPrefix(err.Error(), "LoadModel: ") {
		t.Errorf("error should start with 'LoadModel: ', got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "inner failure") {
		t.Errorf("error should contain inner message, got %q", err.Error())
	}
}

func TestWrapError_PreservesErrorChain(t *testing.T) {
	inner := os.ErrNotExist
	err := wrapError("ReadFile", inner)
	if !errors.Is(err, os.ErrNotExist) {
		t.Error("errors.Is should find os.ErrNotExist through wrapError")
	}
}

// ======== errorIsOfType ========

type testCustomError struct {
	msg string
}

func (e *testCustomError) Error() string { return e.msg }

func TestErrorIsOfType_MatchingType(t *testing.T) {
	err := &testCustomError{msg: "custom"}
	wrapped := wrapError("op", err)
	if !errorIsOfType[*testCustomError](wrapped) {
		t.Error("errorIsOfType should find *testCustomError through wrapping")
	}
}

func TestErrorIsOfType_NotMatchingType(t *testing.T) {
	err := errors.New("plain")
	wrapped := wrapError("op", err)
	if errorIsOfType[*testCustomError](wrapped) {
		t.Error("errorIsOfType should return false for non-matching type")
	}
}

func TestErrorIsOfType_NilError(t *testing.T) {
	if errorIsOfType[*testCustomError](nil) {
		t.Error("errorIsOfType should return false for nil error")
	}
}
