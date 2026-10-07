package workline

import (
	"testing"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// A parser with no language returns no tree; ParseLine must report that, not panic.
func TestParseLineNoTree(t *testing.T) {
	mu.Lock()
	old := parser
	parser = sitter.NewParser()
	mu.Unlock()
	defer func() {
		mu.Lock()
		parser.Close()
		parser = old
		mu.Unlock()
	}()
	if _, err := ParseLine("3x5", 0); err == nil {
		t.Fatal("want error")
	}
}
