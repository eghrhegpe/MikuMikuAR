package main

import (
	"fmt"
)

// safeCall executes fn and recovers from any panic, converting it to an error.
// It returns the result and error from fn, or a wrapped error if a panic occurs.
// If the panic value is an error, it is wrapped (errors.Is works through it).
func safeCall[T any](fn func() (T, error)) (result T, err error) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(error); ok {
				err = fmt.Errorf("panic recovered: %w", e)
			} else {
				err = fmt.Errorf("panic recovered: %v", r)
			}
		}
	}()
	return fn()
}

// safeCallVoid is like safeCall but for functions that return only an error.
func safeCallVoid(fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(error); ok {
				err = fmt.Errorf("panic recovered: %w", e)
			} else {
				err = fmt.Errorf("panic recovered: %v", r)
			}
		}
	}()
	return fn()
}
