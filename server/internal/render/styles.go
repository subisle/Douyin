package render

import (
	"fmt"
	"math"
	"strings"
)

const (
	svgWidth   = 1440
	svgScale   = 2
	logicalW   = 720.0
	fontSans   = "-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
	fontMono   = "SF Mono, Menlo, Consolas, monospace"
	fontSerif  = "Georgia, Times New Roman, serif"
	maxNameLen = 12
	// apple 样式的主色，进度条填充与强调都用这个（取自 615 的 const blue）
	blue = "#007AFF"
)

func buildColumns(set ColumnSet, notLiveLabel, waveLabel string, w weights) []col {
	cols := []col{}
	if set.Rank {
		cols = append(cols, col{key: "rank", label: "排名", width: w.rank, align: "center"})
	}
	if set.Name {
		cols = append(cols, col{key: "name", label: "主播姓名", width: w.name, align: "left"})
	}
	if set.Master {
		cols = append(cols, col{key: "master", label: "师傅", width: w.master, align: "left"})
	}
	if set.NotLiveDays {
		cols = append(cols, col{key: "notLiveDays", label: notLiveLabel, width: w.notLive, align: "center"})
	}
	if set.DailyWave {
		cols = append(cols, col{key: "dailyWave", label: waveLabel, width: w.dailyWave, align: "center"})
	}
	if set.TotalWave {
		cols = append(cols, col{key: "totalWave", label: "累计总音浪", width: w.totalWave, align: "right"})
	}
	if set.Duration {
		cols = append(cols, col{key: "duration", label: "当月时长", width: w.duration, align: "right"})
	}
	if set.Tier {
		cols = append(cols, col{key: "tier", label: "等级", width: w.tier, align: "center"})
	}
	return cols
}

type weights struct {
	rank, name, master, notLive, dailyWave, totalWave, duration, tier float64
}

var classicWeights = weights{rank: 70, name: 180, master: 120, notLive: 110, dailyWave: 280, totalWave: 180, duration: 120, tier: 100}
var appleWeights = weights{rank: 70, name: 150, master: 120, notLive: 110, dailyWave: 280, totalWave: 170, duration: 120, tier: 100}

func maxLiveWave(rows []Row) float64 {
	m := 1.0
	for _, r := range rows {
		if r.IsLive && float64(r.DailyWave) > m {
			m = float64(r.DailyWave)
		}
	}
	return m
}

func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}

/* ============================== classic（女队） ============================== */

func renderClassic(r Report) string {
	const (
		headerHeight      = 54.0
		tableHeaderHeight = 32.0
		rowHeight         = 38.0
		tablePaddingX     = 20.0
	)
	tableWidth := logicalW - tablePaddingX*2

	cols := buildColumns(r.Columns, r.notLiveDaysLabel(), r.dailyWaveLabel(), classicWeights)
	layoutCols(cols, tableWidth)
	for i := range cols {
		cols[i].x += tablePaddingX
	}

	hasInactive := r.ShowInactiveFooter && len(r.InactiveLines) > 0
	footerHeight := 64.0
	if hasInactive {
		footerHeight = math.Max(118, 86+float64(len(r.InactiveLines))*18)
	}
	heightLogical := headerHeight + tableHeaderHeight + rowHeight*float64(len(r.Rows)) + footerHeight

	var b strings.Builder
	b.WriteString(fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%.0f" viewBox="0 0 %.0f %.0f" role="img">`,
		svgWidth, heightLogical*svgScale, logicalW, heightLogical))
	b.WriteString(rect(0, 0, logicalW, heightLogical, "#F8FAFC", ""))

	// 标题栏
	b.WriteString(rect(0, 0, logicalW, headerHeight, "#1E293B", ""))
	title := strings.TrimSpace(r.title(StyleClassic) + " " + classicDate(r.Date) + " " + r.pageSuffix())
	b.WriteString(text(logicalW/2, headerHeight/2+1, title, textOpt{
		size: 22, fill: "#F8FAFC", weight: 700, anchor: "middle",
	}))

	// 表头
	y := headerHeight
	b.WriteString(rect(0, y, logicalW, tableHeaderHeight, "#E2E8F0", ""))
	for _, c := range cols {
		b.WriteString(text(c.x+c.width/2, y+tableHeaderHeight/2+1, c.label, textOpt{
			size: 13, fill: "#475569", weight: 700, anchor: "middle",
		}))
	}
	y += tableHeaderHeight

	maxWave := maxLiveWave(r.Rows)
	rankOffset := 0
	if r.PageIndex > 1 && len(r.Rows) > 0 {
		rankOffset = (r.PageIndex - 1) * len(r.Rows)
	}

	for i, row := range r.Rows {
		rank := rankOffset + i + 1
		isTop3 := rank <= 3
		fill := "#FFFFFF"
		switch {
		case !row.IsLive:
			fill = "#FEF2F2"
		case rank == 1:
			fill = "#FEF3C7"
		case rank == 2:
			fill = "#F8FAFC"
		case rank == 3:
			fill = "#FFEDD5"
		case i%2 == 1:
			fill = "#F8FAFC"
		}
		b.WriteString(rect(0, y, logicalW, rowHeight, fill, ""))
		if !row.IsLive {
			b.WriteString(rect(0, y, 4, rowHeight, "#DC2626", ""))
		}
		lineColor := "#E2E8F0"
		if !row.IsLive {
			lineColor = "#FECACA"
		}
		b.WriteString(fmt.Sprintf(`<line x1="0" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="0.5"/>`,
			y, logicalW, y, lineColor))

		cy := y + rowHeight/2 + 1
		for _, c := range cols {
			switch c.key {
			case "rank":
				cx := c.x + c.width/2
				if isTop3 {
					medal := "🥇"
					if rank == 2 {
						medal = "🥈"
					} else if rank == 3 {
						medal = "🥉"
					}
					fillTxt := "#334155"
					if !row.IsLive {
						fillTxt = "#B91C1C"
					}
					b.WriteString(text(cx, cy, medal, textOpt{size: 20, fill: fillTxt, weight: 700, anchor: "middle"}))
				} else {
					fillTxt := "#334155"
					if !row.IsLive {
						fillTxt = "#B91C1C"
					}
					b.WriteString(text(cx, cy, fmt.Sprintf("%02d", rank), textOpt{
						size: 15, fill: fillTxt, weight: 700, anchor: "middle", family: fontSerif,
					}))
				}
			case "name":
				fillTxt := "#0F172A"
				w := 500
				if !row.IsLive {
					fillTxt = "#991B1B"
					w = 700
				}
				b.WriteString(text(c.x+8, cy, truncate(row.Name, maxNameLen), textOpt{
					size: 15, fill: fillTxt, weight: w, anchor: "start",
				}))
			case "master":
				b.WriteString(text(c.x+8, cy, truncate(row.MasterName, maxNameLen), textOpt{
					size: 13, fill: "#475569", weight: 500, anchor: "start",
				}))
			case "notLiveDays":
				fillTxt := "#15803D"
				if row.NotLiveDays > 0 {
					fillTxt = "#B91C1C"
				}
				b.WriteString(text(c.x+c.width/2, cy, fmt.Sprint(row.NotLiveDays), textOpt{
					size: 13, fill: fillTxt, weight: 700, anchor: "middle",
				}))
			case "dailyWave":
				b.WriteString(classicWaveBar(c, cy, row, maxWave))
			case "totalWave":
				b.WriteString(text(c.x+c.width-12, cy, FormatWave(row.TotalWave), textOpt{
					size: 14, fill: "#475569", weight: 500, anchor: "end", family: fontMono,
				}))
			case "duration":
				b.WriteString(text(c.x+c.width-12, cy, FormatDuration(row.DurationMinutes), textOpt{
					size: 13, fill: "#475569", weight: 500, anchor: "end",
				}))
			case "tier":
				if row.Tier != "" {
					b.WriteString(classicTierPill(c, y, cy, row))
				}
			}
		}
		y += rowHeight
	}

	// 页脚
	b.WriteString(rect(0, y, logicalW, footerHeight, "#E2E8F0", ""))
	totalCount, notLiveCount, notLiveDays := r.summary()
	pageCountLabel := fmt.Sprintf("%s主播 %d 人", r.genderText(), totalCount)
	if r.PageCount > 1 {
		pageCountLabel = fmt.Sprintf("本页 %d 人 · 共 %d 人", len(r.Rows), totalCount)
	}
	summaryText := fmt.Sprintf("%s · 未开播人数 %d 人 · 未开播天数 %d 天", pageCountLabel, notLiveCount, notLiveDays)
	b.WriteString(text(tablePaddingX, y+26, summaryText, textOpt{size: 18, fill: "#334155", weight: 700}))
	b.WriteString(text(tablePaddingX, y+50, "数据日期 "+classicDate(r.Date), textOpt{
		size: 12, fill: "#64748B", weight: 500,
	}))

	if hasInactive {
		warnX := tablePaddingX
		warnY := y + 64
		warnW := logicalW - tablePaddingX*2
		warnH := footerHeight - 78
		b.WriteString(rect(warnX, warnY, warnW, warnH, "#FEF2F2", `rx="8" stroke="#FECACA"`))
		for i, line := range r.InactiveLines {
			ly := warnY + 18 + float64(i)*18
			if ly > warnY+warnH {
				break
			}
			b.WriteString(text(warnX+12, ly, line, textOpt{size: 13, fill: "#991B1B", weight: 500}))
		}
	}

	b.WriteString("</svg>")
	return b.String()
}

// classicWaveBar 日音浪进度条。填充超过轨道 52% 时数字转白，否则深蓝。
func classicWaveBar(c col, cy float64, row Row, maxWave float64) string {
	const padX = 8.0
	const barH = 22.0
	barLeft := c.x + padX
	barTrackW := math.Max(48, c.width-padX*2)
	barTop := cy - barH/2

	var b strings.Builder
	if !row.IsLive {
		b.WriteString(rect(barLeft, barTop, barTrackW, barH, "#FEE2E2", fmt.Sprintf(`rx="%.1f"`, barH/2)))
		b.WriteString(text(barLeft+barTrackW/2, cy, "未开播", textOpt{
			size: 13, fill: "#DC2626", weight: 700, anchor: "middle",
		}))
		return b.String()
	}

	fillW := math.Max(0, math.Min(barTrackW, barTrackW*float64(row.DailyWave)/maxWave))
	b.WriteString(rect(barLeft, barTop, barTrackW, barH, "#DBEAFE", fmt.Sprintf(`rx="%.1f"`, barH/2)))
	if fillW > 0 {
		drawn := math.Max(fillW, barH)
		b.WriteString(rect(barLeft, barTop, drawn, barH, "#60A5FA", fmt.Sprintf(`rx="%.1f"`, barH/2)))
	}
	textFill := "#1E3A8A"
	if fillW/barTrackW > 0.52 {
		textFill = "#FFFFFF"
	}
	b.WriteString(text(barLeft+barTrackW/2, cy, FormatWave(row.DailyWave), textOpt{
		size: 13, fill: textFill, weight: 700, anchor: "middle", family: fontMono,
	}))
	return b.String()
}

func classicTierPill(c col, y, cy float64, row Row) string {
	bw := math.Min(c.width-20, 66)
	bh := 20.0
	bl := c.x + (c.width-bw)/2
	bt := y + (38-bh)/2
	bg := "#E0F2FE"
	fg := "#0369A1"
	if !row.IsLive {
		bg = "#FEE2E2"
		fg = "#B91C1C"
	}
	var b strings.Builder
	b.WriteString(rect(bl, bt, bw, bh, bg, `rx="8"`))
	b.WriteString(text(c.x+c.width/2, cy, row.Tier, textOpt{size: 11, fill: fg, weight: 700, anchor: "middle"}))
	return b.String()
}

func classicDate(date string) string {
	parts := strings.Split(date, "-")
	y, m, d := "2026", "1", "1"
	if len(parts) >= 1 && parts[0] != "" {
		y = parts[0]
	}
	if len(parts) >= 2 {
		m = strings.TrimLeft(parts[1], "0")
		if m == "" {
			m = "1"
		}
	}
	if len(parts) >= 3 {
		d = strings.TrimLeft(parts[2], "0")
		if d == "" {
			d = "1"
		}
	}
	return fmt.Sprintf("%s-%02s-%02s", y, m, d)
}

/* =============================== apple（男团） =============================== */

func renderApple(r Report) string {
	const (
		headerH       = 86.0
		tableHeaderH  = 34.0
		rowH          = 48.0
		rowGap        = 6.0
		footerTextGap = 8.0
		footerTextH   = 18.0
		warnGap       = 20.0
		warnH         = 42.0
	)

	hasInactive := r.ShowInactiveFooter && len(r.InactiveLines) > 0
	footerH := footerTextGap + footerTextH
	if hasInactive {
		footerH += warnGap + warnH
	}
	tableRowsH := rowH*float64(len(r.Rows)) + math.Max(0, float64(len(r.Rows)-1))*rowGap
	heightLogical := headerH + tableHeaderH + rowGap + tableRowsH + footerH

	cols := buildColumns(r.Columns, r.notLiveDaysLabel(), r.dailyWaveLabel(), appleWeights)
	layoutCols(cols, logicalW)

	var b strings.Builder
	b.WriteString(fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%.0f" viewBox="0 0 %.0f %.0f" role="img">`,
		svgWidth, heightLogical*svgScale, logicalW, heightLogical))
	b.WriteString(rect(0, 0, logicalW, heightLogical, "#FFFFFF", ""))

	// 斜向水印网格
	for wy := -40.0; wy <= heightLogical+40; wy += 76 {
		for wx := -40.0; wx <= logicalW+40; wx += 180 {
			b.WriteString(fmt.Sprintf(
				`<text x="%.0f" y="%.0f" font-family="%s" font-size="18" font-weight="900" fill="#334155" fill-opacity="0.055" text-anchor="middle" transform="rotate(-18 %.0f %.0f)">内部数据 · 请勿外传</text>`,
				wx, wy, esc(fontSans), wx, wy))
		}
	}

	// 标题区
	y := 0.0
	titleBase := r.title(StyleApple)
	if s := r.pageSuffix(); s != "" {
		titleBase = titleBase + " " + s
	}
	b.WriteString(text(logicalW/2, y+22, titleBase, textOpt{
		size: 25, fill: "#101828", weight: 700, anchor: "middle", family: fontSans,
	}))
	b.WriteString(text(logicalW/2, y+50, appleDate(r.Date), textOpt{
		size: 13, fill: "#475467", weight: 500, anchor: "middle", family: fontSans,
	}))
	y += headerH

	// 表头
	b.WriteString(rect(0, y, logicalW, tableHeaderH, "#F2F4F7", ""))
	for _, c := range cols {
		b.WriteString(text(c.x+c.width/2, y+tableHeaderH/2+1, c.label, textOpt{
			size: 12, fill: "#667085", weight: 700, anchor: "middle", family: fontSans,
		}))
	}
	y += tableHeaderH + rowGap

	maxWave := maxLiveWave(r.Rows)
	rankOffset := 0
	if r.PageIndex > 1 && len(r.Rows) > 0 {
		rankOffset = (r.PageIndex - 1) * len(r.Rows)
	}

	for i, row := range r.Rows {
		rank := rankOffset + i + 1
		rowFill := "#FFFFFF"
		stroke := "#EAECF0"
		if !row.IsLive {
			rowFill = "#FFF7F7"
			stroke = "#FEE4E2"
		}
		b.WriteString(rect(0, y, logicalW, rowH, rowFill, fmt.Sprintf(`stroke="%s" stroke-width="1"`, stroke)))
		if !row.IsLive {
			b.WriteString(rect(0, y+8, 4, rowH-16, "#F04438", `rx="2"`))
		}

		cy := y + rowH/2 + 1
		for _, c := range cols {
			switch c.key {
			case "rank":
				b.WriteString(appleRankChip(c, y, cy, rank, !row.IsLive))
			case "name":
				fillTxt := "#101828"
				if !row.IsLive {
					fillTxt = "#B42318"
				}
				b.WriteString(text(c.x+8, cy, truncate(row.Name, maxNameLen), textOpt{
					size: 14, fill: fillTxt, weight: 700, anchor: "start", family: fontSans,
				}))
			case "master":
				b.WriteString(text(c.x+8, cy, truncate(row.MasterName, maxNameLen), textOpt{
					size: 13, fill: "#667085", weight: 500, anchor: "start", family: fontSans,
				}))
			case "notLiveDays":
				fillTxt := "#027A48"
				if row.NotLiveDays > 0 {
					fillTxt = "#B42318"
				}
				b.WriteString(text(c.x+c.width/2, cy, fmt.Sprint(row.NotLiveDays), textOpt{
					size: 13, fill: fillTxt, weight: 700, anchor: "middle", family: fontSans,
				}))
			case "dailyWave":
				b.WriteString(appleWaveBar(c, cy, row, maxWave))
			case "totalWave":
				b.WriteString(text(c.x+c.width-12, cy, FormatWave(row.TotalWave), textOpt{
					size: 14, fill: "#475467", weight: 500, anchor: "end", family: fontMono,
				}))
			case "duration":
				b.WriteString(text(c.x+c.width-12, cy, FormatDuration(row.DurationMinutes), textOpt{
					size: 13, fill: "#475467", weight: 500, anchor: "end", family: fontSans,
				}))
			case "tier":
				if row.Tier != "" {
					b.WriteString(appleTierPill(c, y, cy, row))
				}
			}
		}
		// 615 只在行与行之间加间距，最后一行后面不加
		y += rowH
		if i != len(r.Rows)-1 {
			y += rowGap
		}
	}

	// 页脚：三块文字同一行——左「数据日期 · 人数」，右「未开播」，中间「内部数据 · 请勿外传」
	totalCount, notLiveCount, notLiveDays := r.summary()
	footerY := y + footerTextGap
	peopleLabel := fmt.Sprintf("%s %d 人", r.genderGroupText(), totalCount)
	if r.PageCount > 1 {
		peopleLabel = fmt.Sprintf("本页 %d/%d 人", len(r.Rows), totalCount)
	}
	b.WriteString(text(8, footerY+4, fmt.Sprintf("数据日期 %s · %s", appleDate(r.Date), peopleLabel), textOpt{
		size: 12, fill: "#667085", weight: 600, anchor: "start", family: fontSans,
	}))
	b.WriteString(text(logicalW-8, footerY+4,
		fmt.Sprintf("未开播人数 %d 人 · 未开播天数 %d 天", notLiveCount, notLiveDays), textOpt{
			size: 12, fill: "#667085", weight: 600, anchor: "end", family: fontSans,
		}))
	b.WriteString(text(logicalW/2, footerY+4, "内部数据 · 请勿外传", textOpt{
		size: 12, fill: "#98A2B3", weight: 700, anchor: "middle", family: fontSans,
	}))

	if hasInactive {
		warnY := footerY + footerTextH + warnGap
		b.WriteString(rect(0, warnY, logicalW, warnH, "#FEF2F2", `rx="8" stroke="#FECACA"`))
		b.WriteString(text(12, warnY+warnH/2, strings.Join(r.InactiveLines, "　"), textOpt{
			size: 13, fill: "#B42318", weight: 500, anchor: "start", family: fontSans,
		}))
	}

	b.WriteString("</svg>")
	return b.String()
}

func appleRankChip(c col, y, cy float64, rank int, inactive bool) string {
	const chipW, chipH = 40.0, 24.0
	chipX := c.x + (c.width-chipW)/2
	chipY := y + (48-chipH)/2

	chipFill, chipStroke, chipText := "#F2F4F7", "#EAECF0", "#475467"
	switch rank {
	case 1:
		chipFill, chipStroke, chipText = "#FFFAEB", "#FEDF89", "#B54708"
	case 2:
		chipFill, chipStroke, chipText = "#F9FAFB", "#D0D5DD", "#475467"
	case 3:
		chipFill, chipStroke, chipText = "#FFF6ED", "#FED7AA", "#C4320A"
	}
	if inactive {
		chipFill, chipStroke, chipText = "#FFF1F2", "#FFE4E6", "#B42318"
	}

	var b strings.Builder
	b.WriteString(rect(chipX, chipY, chipW, chipH, chipFill, fmt.Sprintf(`rx="%.1f" stroke="%s"`, chipH/2, chipStroke)))
	b.WriteString(text(chipX+chipW/2, cy, fmt.Sprintf("%02d", rank), textOpt{
		size: 12, fill: chipText, weight: 700, anchor: "middle", family: fontMono,
	}))
	return b.String()
}

func appleWaveBar(c col, cy float64, row Row, maxWave float64) string {
	const padX = 8.0
	const barH = 22.0
	barX := c.x + padX
	barW := math.Max(48, c.width-padX*2)
	barY := cy - barH/2

	var b strings.Builder
	if !row.IsLive {
		b.WriteString(rect(barX, barY, barW, barH, "#FEE4E2", fmt.Sprintf(`rx="%.1f"`, barH/2)))
		b.WriteString(text(barX+barW/2, cy, "未开播", textOpt{
			size: 13, fill: "#D92D20", weight: 700, anchor: "middle", family: fontSans,
		}))
		return b.String()
	}

	fillW := math.Max(0, math.Min(barW, float64(row.DailyWave)/maxWave*barW))
	b.WriteString(rect(barX, barY, barW, barH, "#EAF3FF", fmt.Sprintf(`rx="%.1f"`, barH/2)))
	if fillW > 0 {
		drawn := math.Max(fillW, barH)
		b.WriteString(rect(barX, barY, drawn, barH, blue, fmt.Sprintf(`rx="%.1f"`, barH/2)))
	}
	textFill := "#1D4ED8"
	if fillW/barW > 0.52 {
		textFill = "#FFFFFF"
	}
	b.WriteString(text(barX+barW/2, cy, FormatWave(row.DailyWave), textOpt{
		size: 13, fill: textFill, weight: 700, anchor: "middle", family: fontMono,
	}))
	return b.String()
}

func appleTierPill(c col, y, cy float64, row Row) string {
	bw := math.Min(c.width-18, math.Max(42, float64(len([]rune(row.Tier)))*12+20))
	bh := 24.0
	bx := c.x + (c.width-bw)/2
	by := y + (48-bh)/2
	colors := appleTierColor(row.Tier)

	var b strings.Builder
	b.WriteString(rect(bx, by, bw, bh, colors.bg, fmt.Sprintf(`rx="%.1f" stroke="%s"`, bh/2, colors.border)))
	b.WriteString(text(c.x+c.width/2, cy, row.Tier, textOpt{
		size: 11, fill: colors.text, weight: 700, anchor: "middle", family: fontSans,
	}))
	return b.String()
}

type tierColor struct{ bg, border, text string }

func appleTierColor(tier string) tierColor {
	switch strings.ToUpper(tier) {
	case "A":
		return tierColor{"#FFF7E6", "#FDBA74", "#9A3412"}
	case "B":
		return tierColor{"#EAF3FF", "#60A5FA", "#1D4ED8"}
	case "C":
		return tierColor{"#ECFDF3", "#34D399", "#047857"}
	case "D":
		return tierColor{"#F5F3FF", "#A78BFA", "#6D28D9"}
	}
	return tierColor{"#F2F4F7", "#EAECF0", "#667085"}
}

func appleDate(date string) string {
	parts := strings.Split(date, "-")
	y, m, d := "2026", "1", "1"
	if len(parts) >= 1 && parts[0] != "" {
		y = parts[0]
	}
	if len(parts) >= 2 {
		m = strings.TrimLeft(parts[1], "0")
		if m == "" {
			m = "1"
		}
	}
	if len(parts) >= 3 {
		d = strings.TrimLeft(parts[2], "0")
		if d == "" {
			d = "1"
		}
	}
	return fmt.Sprintf("%s年%s月%s日", y, m, d)
}
