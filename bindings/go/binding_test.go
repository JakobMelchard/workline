package tree_sitter_workline_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_workline "github.com/JakobMelchard/workline/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_workline.Language())
	if language == nil {
		t.Errorf("Error loading workline grammar")
	}
}
