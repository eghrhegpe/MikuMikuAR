package util

import (
	"errors"
	"fmt"
)

// WrapError adds an operation prefix to an error, preserving the error chain.
// Returns nil if err is nil.
func WrapError(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", op, err)
}

// ErrorIsOfType checks if err (or any error in its chain) has type T.
// Uses errors.As internally.
func ErrorIsOfType[T error](err error) bool {
	var target T
	return errors.As(err, &target)
}
