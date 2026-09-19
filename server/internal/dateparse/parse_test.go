package dateparse

import (
	"testing"
	"time"
)

func TestParseDateSpec(t *testing.T) {
	tests := []struct {
		in   string
		want *Spec
	}{
		{"今天", &Spec{Type: TypeRelative, Offset: 0}},
		{"今日", &Spec{Type: TypeRelative, Offset: 0}},
		{"昨天", &Spec{Type: TypeRelative, Offset: -1}},
		{"昨日", &Spec{Type: TypeRelative, Offset: -1}},

		{"2026年9月19日", &Spec{Type: TypeDate, Year: 2026, Month: 9, Day: 19}},
		{"2026-09-19", &Spec{Type: TypeDate, Year: 2026, Month: 9, Day: 19}},
		{"2026/9/19", &Spec{Type: TypeDate, Year: 2026, Month: 9, Day: 19}},
		{"2026.9.19", &Spec{Type: TypeDate, Year: 2026, Month: 9, Day: 19}},
		{"20260919", &Spec{Type: TypeDate, Year: 2026, Month: 9, Day: 19}},
		{"2026年9月19号", &Spec{Type: TypeDate, Year: 2026, Month: 9, Day: 19}},

		{"2026年9月", &Spec{Type: TypeMonth, Year: 2026, Month: 9}},
		{"2026年", &Spec{Type: TypeYear, Year: 2026}},
		{"2026", &Spec{Type: TypeYear, Year: 2026}},

		{"9月18日", &Spec{Type: TypeMonthDay, Month: 9, Day: 18}},
		{"9.18", &Spec{Type: TypeMonthDay, Month: 9, Day: 18}},
		{"9.1", &Spec{Type: TypeMonthDay, Month: 9, Day: 1}},
		{"9月", &Spec{Type: TypeMonthOnly, Month: 9}},

		{"18号", &Spec{Type: TypeDay, Day: 18}},
		{"18日", &Spec{Type: TypeDay, Day: 18}},
		{"18号音浪", &Spec{Type: TypeDay, Day: 18}},
		{"18号报告", &Spec{Type: TypeDay, Day: 18}},
		{"24号数据", &Spec{Type: TypeDay, Day: 24}},

		{"柚子", nil},
		{"", nil},
		{"   ", nil},
	}

	for _, tt := range tests {
		got := ParseDateSpec(tt.in)
		if !specEqual(got, tt.want) {
			t.Errorf("ParseDateSpec(%q) = %+v, 期望 %+v", tt.in, got, tt.want)
		}
	}
}

func TestParseMonthSpec(t *testing.T) {
	tests := []struct {
		in   string
		want *Spec
	}{
		{"2026年9月", &Spec{Type: TypeMonth, Year: 2026, Month: 9}},
		{"2026-09", &Spec{Type: TypeMonth, Year: 2026, Month: 9}},
		{"202609", &Spec{Type: TypeMonth, Year: 2026, Month: 9}},
		{"9月", &Spec{Type: TypeMonthOnly, Month: 9}},
	}
	for _, tt := range tests {
		got := ParseMonthSpec(tt.in)
		if !specEqual(got, tt.want) {
			t.Errorf("ParseMonthSpec(%q) = %+v, 期望 %+v", tt.in, got, tt.want)
		}
	}
}

func TestSplitTrailingDate(t *testing.T) {
	tests := []struct {
		in       string
		wantQ    string
		wantType SpecType
	}{
		{"柚子 9月", "柚子", TypeMonthOnly},
		{"柚子 9.18", "柚子", TypeMonthDay},
		{"柚子 昨天", "柚子", TypeRelative},
		{"柚子", "柚子", ""},
		{"9月", "9月", TypeMonthOnly},
	}
	for _, tt := range tests {
		q, spec := SplitTrailingDate(tt.in)
		if q != tt.wantQ {
			t.Errorf("SplitTrailingDate(%q) query = %q, 期望 %q", tt.in, q, tt.wantQ)
		}
		gotType := SpecType("")
		if spec != nil {
			gotType = spec.Type
		}
		if gotType != tt.wantType {
			t.Errorf("SplitTrailingDate(%q) type = %q, 期望 %q", tt.in, gotType, tt.wantType)
		}
	}
}

func TestResolve(t *testing.T) {
	now := time.Date(2026, 9, 20, 10, 0, 0, 0, time.Local)

	tests := []struct {
		in   string
		want string
	}{
		{"今天", "2026-09-20"},
		{"昨天", "2026-09-19"},
		{"2026年9月19日", "2026-09-19"},
		{"9月18日", "2026-09-18"},
		{"9.18", "2026-09-18"},
		{"18号", "2026-09-18"},
		{"9月", "2026-09-01"},
	}
	for _, tt := range tests {
		spec := ParseDateSpec(tt.in)
		got, err := ResolveDate(spec, now)
		if err != nil {
			t.Errorf("ResolveDate(%q) 报错: %v", tt.in, err)
			continue
		}
		if got.Format("2006-01-02") != tt.want {
			t.Errorf("ResolveDate(%q) = %s, 期望 %s", tt.in, got.Format("2006-01-02"), tt.want)
		}
	}

	// 月份
	if m, _ := ResolveMonth(ParseMonthSpec("2026年3月"), now); m != "2026-03" {
		t.Errorf("ResolveMonth(2026年3月) = %s", m)
	}
	if m, _ := ResolveMonth(ParseMonthSpec("3月"), now); m != "2026-03" {
		t.Errorf("ResolveMonth(3月) = %s", m)
	}
	if m, _ := ResolveMonth(nil, now); m != "2026-09" {
		t.Errorf("ResolveMonth(nil) = %s", m)
	}

	// 年
	if y := ResolveYear(ParseDateSpec("2025年"), now); y != 2025 {
		t.Errorf("ResolveYear(2025年) = %d", y)
	}
	if y := ResolveYear(ParseDateSpec("昨天"), now); y != 2026 {
		t.Errorf("ResolveYear(昨天) = %d", y)
	}
}

func TestInvalidInput(t *testing.T) {
	now := time.Date(2026, 9, 20, 0, 0, 0, 0, time.Local)
	if _, err := ResolveMonth(&Spec{Type: TypeMonthOnly, Month: 13}, now); err == nil {
		t.Error("13 月应当报错")
	}
	if _, err := ResolveDate(&Spec{Type: TypeDay, Day: 40}, now); err == nil {
		t.Error("40 号应当报错")
	}
}

func specEqual(a, b *Spec) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
