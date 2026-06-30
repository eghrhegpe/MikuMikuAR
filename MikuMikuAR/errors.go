package main

import (
	"errors"
	"fmt"
)

// wrapError adds an operation prefix to an error, preserving the error chain.
// Returns nil if err is nil.
//
// Usage:
//
//	result, err := someOp()
//	if err != nil {
//	    return nil, wrapError("LoadModel", err)
//	}
func wrapError(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", op, err)
}

// errorIsOfType checks if err (or any error in its chain) has type T.
// Uses errors.As internally.
func errorIsOfType[T error](err error) bool {
	var target T
	return errors.As(err, &target)
}
