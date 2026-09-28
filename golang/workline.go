// Package workline implements the workline v1 semantics (SPEC.md) on top of
// the tree-sitter grammar in this repo. Syntax comes only from the generated
// parser in bindings/go; this package validates, expands and serializes.
// It mirrors lib/index.js and is checked against test/vectors.json.
package workline

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"

	tree_sitter_workline "github.com/JakobMelchard/workline/bindings/go"
	sitter "github.com/tree-sitter/go-tree-sitter"
)

// Target is the reps, seconds, minutes, meters or kilometers per set.
// Unit is one of "reps", "s", "min", "m", "km". Max is nil unless a range.
type Target struct {
	Min   float64  `json:"min"`
	Max   *float64 `json:"max,omitempty"`
	Unit  string   `json:"unit"`
	Amrap bool     `json:"amrap,omitempty"`
}

// Weight is an absolute load. Value is nil for "?+" (ask, no prescription).
type Weight struct {
	Value *float64 `json:"value,omitempty"`
	Unit  string   `json:"unit,omitempty"`
	Ask   bool     `json:"ask,omitempty"`
}

// Scalar is a percent or RPE value.
type Scalar struct {
	Value float64 `json:"value"`
	Ask   bool    `json:"ask,omitempty"`
}

// Mods are the optional modifiers of a group or a line's defaults.
// Rest is in seconds; nil when absent.
type Mods struct {
	Weight  *Weight `json:"weight,omitempty"`
	Percent *Scalar `json:"percent,omitempty"`
	RPE     *Scalar `json:"rpe,omitempty"`
	Rest    *int    `json:"rest,omitempty"`
}

// Group is SETS x TARGET plus its own mods.
type Group struct {
	Sets   int    `json:"sets"`
	Target Target `json:"target"`
	Mods
}

// Line is one parsed text line. Index is its 0-based line number in the cell.
type Line struct {
	Index    int     `json:"index"`
	Name     string  `json:"name,omitempty"`
	Groups   []Group `json:"groups"`
	Defaults Mods    `json:"defaults"`
}

// SetSpec is one expanded set with the line's defaults applied.
type SetSpec struct {
	Target Target `json:"target"`
	Mods
}

// ParseError reports a line that failed to parse. Reason is free text.
type ParseError struct {
	Line   int    `json:"line"`
	Raw    string `json:"raw"`
	Reason string `json:"reason"`
}

// Parsed is the result of Parse.
type Parsed struct {
	Lines  []Line       `json:"lines"`
	Errors []ParseError `json:"errors"`
}

type lineError string

func (e lineError) Error() string { return string(e) }

func errf(format string, a ...any) error { return lineError(fmt.Sprintf(format, a...)) }

var (
	mu       sync.Mutex
	parser   *sitter.Parser
	language = sitter.NewLanguage(tree_sitter_workline.Language())
)

// Parse parses a cell, one exercise per text line. Blank lines are skipped;
// a bad line lands in Errors and the others still parse.
func Parse(cell string) Parsed {
	out := Parsed{Lines: []Line{}, Errors: []ParseError{}}
	for i, raw := range strings.Split(cell, "\n") {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		line, err := ParseLine(raw, i)
		if err != nil {
			out.Errors = append(out.Errors, ParseError{Line: i, Raw: raw, Reason: err.Error()})
			continue
		}
		out.Lines = append(out.Lines, line)
	}
	return out
}

// ParseLine parses a single line. index is stored as Line.Index.
func ParseLine(raw string, index int) (Line, error) {
	src := []byte(strings.ReplaceAll(raw, "\n", " "))
	mu.Lock()
	if parser == nil {
		parser = sitter.NewParser()
		if err := parser.SetLanguage(language); err != nil {
			mu.Unlock()
			panic("workline: " + err.Error())
		}
	}
	tree := parser.Parse(src, nil)
	mu.Unlock()
	if tree == nil {
		panic("workline: parse aborted")
	}
	defer tree.Close()
	p := &lineParser{src: src}
	return p.line(tree.RootNode(), index)
}

type lineParser struct{ src []byte }

func (p *lineParser) text(n *sitter.Node) string { return n.Utf8Text(p.src) }

func (p *lineParser) line(root *sitter.Node, index int) (Line, error) {
	if root.HasError() {
		return Line{}, lineError(p.syntaxError(root))
	}
	node := firstKid(root, "line")
	if node == nil {
		return Line{}, lineError("no sets")
	}
	line := Line{Index: index, Groups: []Group{}}
	if name := node.ChildByFieldName("name"); name != nil {
		line.Name = strings.Join(strings.Fields(p.text(name)), " ")
	}
	for _, g := range kids(node, "group") {
		group, err := p.group(&g)
		if err != nil {
			return Line{}, err
		}
		line.Groups = append(line.Groups, group)
	}
	if d := node.ChildByFieldName("defaults"); d != nil {
		mods, err := p.mods(d)
		if err != nil {
			return Line{}, err
		}
		line.Defaults = mods
	}
	return line, nil
}

func (p *lineParser) syntaxError(n *sitter.Node) string {
	var find func(n *sitter.Node) string
	find = func(n *sitter.Node) string {
		if n.IsMissing() {
			return fmt.Sprintf("missing %s at column %d", n.Kind(), n.StartByte())
		}
		if n.IsError() {
			return fmt.Sprintf("unexpected %q at column %d", p.text(n), n.StartByte())
		}
		for i := uint(0); i < n.ChildCount(); i++ {
			if s := find(n.Child(i)); s != "" {
				return s
			}
		}
		return ""
	}
	if s := find(n); s != "" {
		return s
	}
	return "syntax error"
}

func (p *lineParser) group(g *sitter.Node) (Group, error) {
	setsNode, err := field(g, "sets")
	if err != nil {
		return Group{}, err
	}
	sets := p.num(setsNode)
	if sets != math.Trunc(sets) || sets < 1 || sets > math.MaxInt32 {
		return Group{}, errf("sets must be a whole number >= 1: %s", jsNum(sets))
	}
	t, err := field(g, "target")
	if err != nil {
		return Group{}, err
	}
	minNode, err := field(t, "min")
	if err != nil {
		return Group{}, err
	}
	target := Target{Min: p.num(minNode), Unit: "reps"}
	if u := t.ChildByFieldName("unit"); u != nil {
		target.Unit = strings.ToLower(p.text(u))
	}
	if maxNode := t.ChildByFieldName("max"); maxNode != nil {
		max := p.num(maxNode)
		if max < target.Min {
			return Group{}, errf("range %s-%s is descending", jsNum(target.Min), jsNum(max))
		}
		if max != target.Min {
			target.Max = &max
		}
	}
	if t.ChildByFieldName("ask") != nil {
		target.Amrap = true
	}
	group := Group{Sets: int(sets), Target: target}
	if m := firstKid(g, "mods"); m != nil {
		mods, err := p.mods(m)
		if err != nil {
			return Group{}, err
		}
		group.Mods = mods
	}
	return group, nil
}

func (p *lineParser) mods(node *sitter.Node) (Mods, error) {
	var mods Mods
	has := map[string]bool{}
	claim := func(kind string) error {
		load := kind == "weight" || kind == "percent"
		if has[kind] || (load && (has["weight"] || has["percent"])) {
			if load {
				return lineError("duplicate load")
			}
			return errf("duplicate %s", kind)
		}
		has[kind] = true
		return nil
	}
	for i := uint(0); i < node.NamedChildCount(); i++ {
		m := node.NamedChild(i)
		kind := m.Kind()
		var value float64
		if kind != "ask_weight" {
			v, err := field(m, "value")
			if err != nil {
				return Mods{}, err
			}
			value = p.num(v)
		}
		ask := m.ChildByFieldName("ask") != nil
		text := p.text(m)
		switch kind {
		case "ask_weight":
			if err := claim("weight"); err != nil {
				return Mods{}, err
			}
			mods.Weight = &Weight{Ask: true}
		case "weight":
			u, err := field(m, "unit")
			if err != nil {
				return Mods{}, err
			}
			if err := claim("weight"); err != nil {
				return Mods{}, err
			}
			mods.Weight = &Weight{Value: &value, Unit: strings.ToLower(p.text(u)), Ask: ask}
		case "percent":
			if value <= 0 || value > 200 {
				return Mods{}, errf("percent out of range: %s", text)
			}
			if err := claim("percent"); err != nil {
				return Mods{}, err
			}
			mods.Percent = &Scalar{Value: value, Ask: ask}
		case "rpe":
			if value < 1 || value > 10 {
				return Mods{}, errf("RPE out of range: %s (weights need a unit, e.g. 60kg)", text)
			}
			if err := claim("rpe"); err != nil {
				return Mods{}, err
			}
			mods.RPE = &Scalar{Value: value, Ask: ask}
		case "rest":
			if value != math.Trunc(value) || value > math.MaxInt32 {
				return Mods{}, errf("rest must be whole: %s", text)
			}
			u, err := field(m, "unit")
			if err != nil {
				return Mods{}, err
			}
			secs := int(value)
			if strings.ToLower(p.text(u)) == "min" {
				secs *= 60
			}
			if err := claim("rest"); err != nil {
				return Mods{}, err
			}
			mods.Rest = &secs
		}
	}
	return mods, nil
}

// num reads a number node. Gap-carrying tokens include leading whitespace.
func (p *lineParser) num(n *sitter.Node) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(p.text(n)), 64)
	if err != nil {
		return math.NaN()
	}
	return v
}

func field(n *sitter.Node, name string) (*sitter.Node, error) {
	if f := n.ChildByFieldName(name); f != nil {
		return f, nil
	}
	return nil, errf("missing %s", name)
}

func kids(n *sitter.Node, kind string) []sitter.Node {
	var out []sitter.Node
	for i := uint(0); i < n.NamedChildCount(); i++ {
		if c := n.NamedChild(i); c.Kind() == kind {
			out = append(out, *c)
		}
	}
	return out
}

func firstKid(n *sitter.Node, kind string) *sitter.Node {
	if k := kids(n, kind); len(k) > 0 {
		return &k[0]
	}
	return nil
}

// Expand returns one SetSpec per set, in order, with the line's defaults
// applied. A group's own mod wins; weight and percent count as one kind.
func Expand(line Line) []SetSpec {
	d := line.Defaults
	out := []SetSpec{}
	for _, g := range line.Groups {
		var s SetSpec
		s.Target = g.Target
		weight, percent := g.Weight, g.Percent
		if weight == nil && g.Percent == nil {
			weight = d.Weight
		}
		if percent == nil && g.Weight == nil {
			percent = d.Percent
		}
		s.Weight, s.Percent = weight, percent
		s.RPE = g.RPE
		if s.RPE == nil {
			s.RPE = d.RPE
		}
		s.Rest = g.Rest
		if s.Rest == nil {
			s.Rest = d.Rest
		}
		for i := 0; i < g.Sets; i++ {
			out = append(out, s.clone())
		}
	}
	return out
}

func (s SetSpec) clone() SetSpec {
	c := SetSpec{Target: s.Target, Mods: s.Mods.clone()}
	if s.Target.Max != nil {
		c.Target.Max = ptr(*s.Target.Max)
	}
	return c
}

func (m Mods) clone() Mods {
	var c Mods
	if m.Weight != nil {
		w := *m.Weight
		if w.Value != nil {
			w.Value = ptr(*w.Value)
		}
		c.Weight = &w
	}
	if m.Percent != nil {
		c.Percent = ptr(*m.Percent)
	}
	if m.RPE != nil {
		c.RPE = ptr(*m.RPE)
	}
	if m.Rest != nil {
		c.Rest = ptr(*m.Rest)
	}
	return c
}

func ptr[T any](v T) *T { return &v }

// Serialize renders the canonical cell. Error lines are kept verbatim.
func Serialize(parsed Parsed) string {
	type row struct {
		index int
		text  string
	}
	rows := make([]row, 0, len(parsed.Lines)+len(parsed.Errors))
	for _, l := range parsed.Lines {
		rows = append(rows, row{l.Index, SerializeLine(l)})
	}
	for _, e := range parsed.Errors {
		rows = append(rows, row{e.Line, e.Raw})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].index < rows[j].index })
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.text
	}
	return strings.Join(out, "\n")
}

// SerializeLine renders one line in canonical form.
func SerializeLine(line Line) string {
	groups := make([]string, len(line.Groups))
	for i, g := range line.Groups {
		groups[i] = strings.Join(append([]string{strconv.Itoa(g.Sets) + "x" + g.Target.String()}, SerializeMods(g.Mods)...), " ")
	}
	var b strings.Builder
	if line.Name != "" {
		b.WriteString(line.Name + " / ")
	}
	b.WriteString(strings.Join(groups, ", "))
	if d := SerializeMods(line.Defaults); len(d) > 0 {
		b.WriteString(" / " + strings.Join(d, " "))
	}
	return b.String()
}

// String renders the canonical target, e.g. "8-12", "30s+", "5".
func (t Target) String() string {
	s := jsNum(t.Min)
	if t.Max != nil {
		s += "-" + jsNum(*t.Max)
	}
	if t.Unit != "reps" {
		s += t.Unit
	}
	if t.Amrap {
		s += "+"
	}
	return s
}

// SerializeMods renders mods in canonical order: weight or percent, rpe, rest.
func SerializeMods(m Mods) []string {
	var out []string
	plus := func(ask bool) string {
		if ask {
			return "+"
		}
		return ""
	}
	if m.Weight != nil {
		if m.Weight.Value == nil {
			out = append(out, "?+")
		} else {
			out = append(out, jsNum(*m.Weight.Value)+m.Weight.Unit+plus(m.Weight.Ask))
		}
	}
	if m.Percent != nil {
		out = append(out, jsNum(m.Percent.Value)+"%"+plus(m.Percent.Ask))
	}
	if m.RPE != nil {
		out = append(out, "@"+jsNum(m.RPE.Value)+plus(m.RPE.Ask))
	}
	if m.Rest != nil {
		r := *m.Rest
		if r%60 == 0 && r > 0 {
			out = append(out, strconv.Itoa(r/60)+"min")
		} else {
			out = append(out, strconv.Itoa(r)+"s")
		}
	}
	return out
}

// jsNum formats like JavaScript's String(number).
func jsNum(x float64) string {
	a := math.Abs(x)
	if a != 0 && (a >= 1e21 || a < 1e-6) {
		s := strconv.FormatFloat(x, 'e', -1, 64)
		mant, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		exp = strings.TrimLeft(exp[1:], "0")
		return mant + "e" + string(sign) + exp
	}
	return strconv.FormatFloat(x, 'f', -1, 64)
}
