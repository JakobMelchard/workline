package workline

import (
	"reflect"
	"testing"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// Expand is ExpandWeek pinned to week 1; it has no caller or vector of its
// own (vectors_test.go calls ExpandWeek directly), so pin the week-1 default
// against a line whose weeks disagree, to catch a wrong default drifting in.
func TestExpand(t *testing.T) {
	line := Line{Groups: []Group{{
		Sets:   2,
		Target: Target{Min: 5, Unit: "reps"},
		Weeks:  []Target{{Min: 5, Unit: "reps"}, {Min: 3, Unit: "reps"}},
	}}}
	if got, want := Expand(line), ExpandWeek(line, 1); !reflect.DeepEqual(got, want) {
		t.Fatalf("Expand = %+v, want %+v", got, want)
	}
	if got := Expand(line); got[0].Target.Min != 5 {
		t.Fatalf("Expand used week %v, want week 1 (min=5)", got[0].Target.Min)
	}
}

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
