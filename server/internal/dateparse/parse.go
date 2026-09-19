// Package dateparse 解析中文自然语言日期，供 bot 指令使用。
//
// 规则 1:1 迁移自 615 的 electron/weixin-bot-commands.js。
// 这是运营在群里真实敲出来的说法（"9.11" / "18号报告" / "昨天" / "2026年9月"），
// 解析错一个，机器人就答非所问。改正则前先跑测试。
//
// 注意：JS 原版用了 (?=...) 和 (?!\d) 两种 lookahead，Go 的 RE2 不支持，
// 这里改写成等价的消耗性分组（取到的捕获组一致，语义不变）。
package dateparse

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// SpecType 日期规格的类型。
type SpecType string

const (
	TypeRelative  SpecType = "relative"  // 今天 / 昨天
	TypeDate      SpecType = "date"      // 完整年月日
	TypeMonth     SpecType = "month"     // 年月
	TypeYear      SpecType = "year"      // 仅年
	TypeMonthDay  SpecType = "month-day" // 月日（9月18日 / 9.18）
	TypeMonthOnly SpecType = "month-only" // 仅月（9月）
	TypeDay       SpecType = "day"       // 仅日（18号）
)

// Spec 解析结果。字段是否生效取决于 Type。
type Spec struct {
	Type   SpecType
	Year   int
	Month  int
	Day    int
	Offset int // relative 用：0 今天，-1 昨天
}

var (
	reFull        = regexp.MustCompile(`(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?`)
	reCompact     = regexp.MustCompile(`(20\d{2})(\d{2})(\d{2})`)
	reYearMonth   = regexp.MustCompile(`(20\d{2})\s*年\s*(\d{1,2})\s*月?$`)
	reYearOnly    = regexp.MustCompile(`^(20\d{2})\s*年?$`)
	reMonthDay    = regexp.MustCompile(`(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?`)
	reDotMonthDay = regexp.MustCompile(`^(\d{1,2})[.．](\d{1,3})[日号]?$`)
	reMonthOnly   = regexp.MustCompile(`^(\d{1,2})\s*月$`)
	// 原 JS：(?:^|\s)(\d{1,2})\s*[日号](?=$|\s|音浪|文件|日报|报告|数据|_|\.)
	reDay = regexp.MustCompile(`(?:^|\s)(\d{1,2})\s*[日号](?:\s|$|音浪|文件|日报|报告|数据|_|\.)`)
	// 原 JS：^(\d{1,2})[日号](?:数据|音浪|文件|日报|报告)?$
	reDayCompact = regexp.MustCompile(`^(\d{1,2})[日号](?:数据|音浪|文件|日报|报告)?$`)
	// 原 JS：(20\d{2})(\d{2})(?!\d)
	reMonthCompact = regexp.MustCompile(`(20\d{2})(\d{2})(?:[^\d]|$)`)
	// 月份专用：年月两段即可，注意与 reFull（要年月日三段）不是同一个正则
	reMonthFull = regexp.MustCompile(`(20\d{2})\s*[年./-]\s*(\d{1,2})\s*月?`)

	// 尾部日期：用于把「艺名 9月」拆成 { query, dateSpec }
	reTrailingDate = regexp.MustCompile(`(今日|今天|昨日|昨天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?|20\d{6}|20\d{2}[年./-]\d{1,2}[月./-]?|20\d{2}年?|\d{1,2}\s*月|\d{1,2}\s*[日号]|\d{1,2}[.．]\d{1,3})$`)
)

// normalizeText 与 615 一致：去 BOM、去 \r、去尾部标点，不删中间空格。
func normalizeText(value string) string {
	s := strings.TrimPrefix(value, "\uFEFF")
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "。！!，,；;")
	return strings.TrimSpace(s)
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// ParseDateSpec 解析日期规格，无法识别返回 nil。
func ParseDateSpec(value string) *Spec {
	text := normalizeText(value)
	if text == "" {
		return nil
	}
	switch text {
	case "今天", "今日":
		return &Spec{Type: TypeRelative, Offset: 0}
	case "昨天", "昨日":
		return &Spec{Type: TypeRelative, Offset: -1}
	}

	if m := reFull.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeDate, Year: atoi(m[1]), Month: atoi(m[2]), Day: atoi(m[3])}
	}
	if m := reCompact.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeDate, Year: atoi(m[1]), Month: atoi(m[2]), Day: atoi(m[3])}
	}
	if m := reYearMonth.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeMonth, Year: atoi(m[1]), Month: atoi(m[2])}
	}
	if m := reYearOnly.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeYear, Year: atoi(m[1])}
	}
	if m := reMonthDay.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeMonthDay, Month: atoi(m[1]), Day: atoi(m[2])}
	}
	if m := reDotMonthDay.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeMonthDay, Month: atoi(m[1]), Day: atoi(m[2])}
	}
	if m := reMonthOnly.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeMonthOnly, Month: atoi(m[1])}
	}
	if m := reDay.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeDay, Day: atoi(m[1])}
	}
	if m := reDayCompact.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeDay, Day: atoi(m[1])}
	}
	return nil
}

// ParseMonthSpec 解析月份规格，无法识别返回 nil。
func ParseMonthSpec(value string) *Spec {
	text := normalizeText(value)
	if text == "" {
		return nil
	}
	if m := reMonthFull.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeMonth, Year: atoi(m[1]), Month: atoi(m[2])}
	}
	if m := reMonthCompact.FindStringSubmatch(text); m != nil {
		return &Spec{Type: TypeMonth, Year: atoi(m[1]), Month: atoi(m[2])}
	}
	if m := reMonthOnlyNum(text); m != nil {
		return m
	}
	return nil
}

// 原 JS：(\d{1,2})\s*月 —— 没有锚定，出现即命中
var reMonthLoose = regexp.MustCompile(`(\d{1,2})\s*月`)

func reMonthOnlyNum(text string) *Spec {
	m := reMonthLoose.FindStringSubmatch(text)
	if m == nil {
		return nil
	}
	return &Spec{Type: TypeMonthOnly, Month: atoi(m[1])}
}

// SplitTrailingDate 把「艺名 9月」拆成 { Query: "艺名", DateSpec: month-only }。
// 没有尾部日期时原样返回，Query 等于整个输入。
func SplitTrailingDate(value string) (query string, spec *Spec) {
	text := normalizeText(value)
	if text == "" {
		return "", nil
	}
	loc := reTrailingDate.FindStringIndex(text)
	if loc == nil {
		return text, nil
	}
	tail := text[loc[0]:]
	head := strings.TrimSpace(text[:loc[0]])
	if head == "" {
		return text, ParseDateSpec(tail)
	}
	return head, ParseDateSpec(tail)
}

// 任意位置的日期片段（reTrailingDate 去掉 $ 锚定），用于从句子里剔除日期
var reDateToken = regexp.MustCompile(`(今日|今天|昨日|昨天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日号]?|20\d{6}|20\d{2}[年./-]\d{1,2}[月./-]?|20\d{2}年?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|\d{1,2}\s*月|\d{1,2}\s*[日号]|\d{1,2}[.．]\d{1,3})`)

// SplitQuery 把「艺名 + 日期」拆开，两种情况都覆盖：
//
//	"柚子 9月"   → ("柚子", month-only)   日期在句尾
//	"18号报告"   → ("报告", day 18)       日期在句中
//
// 返回空 query 表示整句只有日期、没有艺名。
func SplitQuery(value string) (string, *Spec) {
	text := normalizeText(value)
	if text == "" {
		return "", nil
	}

	// 先试句尾
	if q, s := SplitTrailingDate(text); s != nil && q != "" && q != text {
		return strings.TrimSpace(q), s
	}

	// 再试句中
	s := ParseDateSpec(text)
	if s == nil {
		return text, nil
	}
	stripped := strings.TrimSpace(reDateToken.ReplaceAllString(text, ""))
	return stripped, s
}

// ResolveDate 把规格落成具体日期。now 是"今天"，用于补全年月。
func ResolveDate(spec *Spec, now time.Time) (time.Time, error) {
	if spec == nil {
		return now, nil
	}
	switch spec.Type {
	case TypeRelative:
		return now.AddDate(0, 0, spec.Offset), nil
	case TypeDate:
		if !validMonth(spec.Month) || spec.Day < 1 || spec.Day > 31 {
			return time.Time{}, errInvalidDate
		}
		return time.Date(spec.Year, time.Month(spec.Month), spec.Day, 0, 0, 0, 0, now.Location()), nil
	case TypeMonthDay:
		if !validMonth(spec.Month) || spec.Day < 1 || spec.Day > 31 {
			return time.Time{}, errInvalidDate
		}
		return time.Date(now.Year(), time.Month(spec.Month), spec.Day, 0, 0, 0, 0, now.Location()), nil
	case TypeDay:
		if spec.Day < 1 || spec.Day > 31 {
			return time.Time{}, errInvalidDate
		}
		return time.Date(now.Year(), now.Month(), spec.Day, 0, 0, 0, 0, now.Location()), nil
	case TypeMonth, TypeMonthOnly:
		// 只给了月份，查询日粒度时退化为该月 1 号
		if !validMonth(spec.Month) {
			return time.Time{}, errInvalidDate
		}
		y := now.Year()
		if spec.Type == TypeMonth && spec.Year > 0 {
			y = spec.Year
		}
		return time.Date(y, time.Month(spec.Month), 1, 0, 0, 0, 0, now.Location()), nil
	}
	return now, nil
}

// ResolveMonth 把规格落成 "YYYY-MM"。fallback 用于补全年。
func ResolveMonth(spec *Spec, fallback time.Time) (string, error) {
	y, m := fallback.Year(), int(fallback.Month())
	if spec == nil {
		return formatMonth(y, m), nil
	}
	switch spec.Type {
	case TypeMonth:
		if !validMonth(spec.Month) {
			return "", errInvalidMonth
		}
		return formatMonth(spec.Year, spec.Month), nil
	case TypeMonthOnly:
		if !validMonth(spec.Month) {
			return "", errInvalidMonth
		}
		return formatMonth(y, spec.Month), nil
	case TypeDate, TypeMonthDay:
		if !validMonth(spec.Month) {
			return "", errInvalidMonth
		}
		yy := y
		if spec.Type == TypeDate && spec.Year > 0 {
			yy = spec.Year
		}
		return formatMonth(yy, spec.Month), nil
	case TypeRelative, TypeDay:
		return formatMonth(y, m), nil
	}
	return formatMonth(y, m), nil
}

// ResolveYear 解析年份，非年粒度返回 fallback 年份。
func ResolveYear(spec *Spec, fallback time.Time) int {
	if spec != nil && spec.Type == TypeYear && spec.Year > 0 {
		return spec.Year
	}
	if spec != nil && spec.Type == TypeDate && spec.Year > 0 {
		return spec.Year
	}
	if spec != nil && spec.Type == TypeMonth && spec.Year > 0 {
		return spec.Year
	}
	return fallback.Year()
}

func validMonth(m int) bool { return m >= 1 && m <= 12 }

func formatMonth(y, m int) string {
	if m < 10 {
		return strconv.Itoa(y) + "-0" + strconv.Itoa(m)
	}
	return strconv.Itoa(y) + "-" + strconv.Itoa(m)
}

var (
	errInvalidDate  = &ParseError{"日期无效"}
	errInvalidMonth = &ParseError{"月份无效"}
)

// ParseError 解析失败。消息直接回给用户，所以要说人话。
type ParseError struct{ msg string }

func (e *ParseError) Error() string { return e.msg }
