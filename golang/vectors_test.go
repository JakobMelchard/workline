package workline_test

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	workline "github.com/JakobMelchard/workline/golang"
)

// Conformance: runs test/vectors.json exactly like test/vectors.test.js.
type vector struct {
	In        string          `json:"in"`
	Canonical *string         `json:"canonical"`
	Errors    []int           `json:"errors"`
	Lines     json.RawMessage `json:"lines"`
	Comment   string          `json:"comment"`
}

type viewLine struct {
	Name string             `json:"name,omitempty"`
	Sets []workline.SetSpec `json:"sets"`
}

type view struct {
	Errors []int      `json:"errors"`
	Lines  []viewLine `json:"lines"`
}

func viewOf(p workline.Parsed) view {
	v := view{Errors: []int{}, Lines: []viewLine{}}
	for _, e := range p.Errors {
		v.Errors = append(v.Errors, e.Line)
	}
	for _, l := range p.Lines {
		v.Lines = append(v.Lines, viewLine{Name: l.Name, Sets: workline.Expand(l)})
	}
	return v
}

// generic round-trips through JSON so Go structs compare against vectors.json.
func generic(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestVectors(t *testing.T) {
	b, err := os.ReadFile("../test/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []vector
	if err := json.Unmarshal(b, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors) == 0 {
		t.Fatal("no vectors")
	}
	for _, vec := range vectors {
		name := vec.Comment
		if name == "" {
			n, _ := json.Marshal(vec.In)
			name = string(n)
		}
		t.Run(name, func(t *testing.T) {
			p := workline.Parse(vec.In)
			wantErrors := vec.Errors
			if wantErrors == nil {
				wantErrors = []int{}
			}
			var wantLines any = []any{}
			if len(vec.Lines) > 0 {
				if err := json.Unmarshal(vec.Lines, &wantLines); err != nil {
					t.Fatal(err)
				}
			}
			want := generic(t, map[string]any{"errors": wantErrors, "lines": wantLines})
			got := generic(t, viewOf(p))
			if !reflect.DeepEqual(got, want) {
				gj, _ := json.Marshal(got)
				wj, _ := json.Marshal(want)
				t.Fatalf("view mismatch\n got %s\nwant %s\nerrors %+v", gj, wj, p.Errors)
			}

			out := workline.Serialize(p)
			canonical := vec.In
			if vec.Canonical != nil {
				canonical = *vec.Canonical
			}
			if out != canonical {
				t.Fatalf("serialize = %q, want %q", out, canonical)
			}

			again := workline.Parse(out)
			// Blank lines drop, so compare errors by text, not index.
			raws := func(p workline.Parsed) []string {
				r := []string{}
				for _, e := range p.Errors {
					r = append(r, e.Raw)
				}
				return r
			}
			if !reflect.DeepEqual(raws(again), raws(p)) {
				t.Fatalf("reparse errors %q, want %q", raws(again), raws(p))
			}
			if !reflect.DeepEqual(generic(t, viewOf(again).Lines), generic(t, viewOf(p).Lines)) {
				t.Fatal("parse(serialize(x)) changed meaning")
			}
			if s := workline.Serialize(again); s != out {
				t.Fatalf("canonical form is not a fixed point: %q -> %q", out, s)
			}
		})
	}
}
