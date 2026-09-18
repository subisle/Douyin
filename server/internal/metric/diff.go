// Package metric 实现从"平台累计快照"到"日/月/年指标"的派生计算。
//
// 为什么放在 Go 里而不是一条 SQL 窗口函数：差分要处理漏采、平台回退、
// 换号这些脏情况，还要能按主播重算。写成纯函数可以单测、可以埋点异常，
// SQL 只负责批量读。
package metric

import (
	"strconv"
	"time"

	"douyin-server/internal/domain"
)

// Point 是某一天采集到的累计快照值。
type Point struct {
	Date    time.Time
	Wave    int64
	Minutes int
}

// Anomaly 描述差分过程中发现的脏数据。这些必须被记录，不能静默吞掉——
// 吞掉的后果是月榜悄悄少一个人的量，且没人知道为什么。
type Anomaly struct {
	Kind   string
	Detail string
}

// ComputeDaily 由当天快照与上一次快照算出日指标。
//
// 差分规则（业务约定，改动前先确认）：
//   - 首条快照：没有基线可比，日音浪记 0，绝不能把累计值当成单日成绩
//   - 跨 1 天：正常差分，reliable = true
//   - 跨 N > 1 天：中间漏采，差值记下来但 reliable = false
//   - 出现负增量：平台回退或换号，日音浪记 0 并报 anomaly
func ComputeDaily(personID uint64, anchorID string, cur Point, prev *Point) (domain.DailyMetric, []Anomaly) {
	m := domain.DailyMetric{
		PersonID:          personID,
		AnchorID:          anchorID,
		BizDate:           cur.Date,
		CumulativeWave:    cur.Wave,
		CumulativeMinutes: cur.Minutes,
		WaveSpan:          1,
		MinutesSpan:       1,
		WaveReliable:      true,
		MinutesReliable:   true,
	}

	if prev == nil {
		// 首条：没有基线，日增量不可知，但也不算"不可信"——
		// 只是这一天没有可比的昨天，记为 0 即可。
		m.Wave = 0
		m.Minutes = 0
		m.IsLive = false
		return m, nil
	}

	m.PrevSnapshotDate = &prev.Date
	span := int(cur.Date.Sub(prev.Date).Truncate(time.Hour).Hours() / 24)
	if span < 1 {
		span = 1
	}
	m.WaveSpan = span
	m.MinutesSpan = span

	var anomalies []Anomaly

	// 音浪：累计值理论上单调不减，出现负增量一定是数据有问题。
	delta := cur.Wave - prev.Wave
	switch {
	case delta < 0:
		m.Wave = 0
		m.WaveReliable = false
		anomalies = append(anomalies, Anomaly{
			Kind:   "negative_delta",
			Detail: "累计音浪回退：" + itoa(prev.Wave) + " -> " + itoa(cur.Wave),
		})
	case span > 1:
		m.Wave = delta
		m.WaveReliable = false
	default:
		m.Wave = delta
		m.WaveReliable = true
	}

	// 时长同理，但平台偶尔会修正时长，小幅回退容忍度更高：
	// 只要不是负数就按差分走，负数同样记 0。
	deltaMinutes := cur.Minutes - prev.Minutes
	switch {
	case deltaMinutes < 0:
		m.Minutes = 0
		m.MinutesReliable = false
	case span > 1:
		m.Minutes = deltaMinutes
		m.MinutesReliable = false
	default:
		m.Minutes = deltaMinutes
		m.MinutesReliable = true
	}

	m.IsLive = m.Minutes > 0 || m.Wave > 0
	return m, anomalies
}

// AggregateMonthly 由一组日指标汇总出月指标。
//
// 注意：不可信的天的量**必须加回月总量**（量确实发生了，只是不知道落在哪天），
// 只把它们计入 unreliable_days 供页脚提示，不能因此丢数据。
func AggregateMonthly(personID uint64, period string, days []domain.DailyMetric) domain.MonthlyMetric {
	m := domain.MonthlyMetric{PersonID: personID, Period: period}

	lastDay := 0
	for _, d := range days {
		m.Wave += d.Wave
		m.Minutes += d.Minutes
		if d.IsLive {
			m.LiveDays++
		} else {
			m.AbsentDays++
		}
		if !d.WaveReliable {
			m.UnreliableDays++
		}
		if d.Wave > m.BestDayWave {
			m.BestDayWave = d.Wave
			best := d.BizDate
			m.BestDayDate = &best
		}
		if day := d.BizDate.Day(); day > lastDay {
			lastDay = day
		}
	}
	if m.LiveDays > 0 {
		m.AvgWavePerLiveDay = m.Wave / int64(m.LiveDays)
	}
	m.FormattedDuration = domain.FormatDuration(m.Minutes)
	return m
}

// AggregateYearly 由一组月指标汇总出年度指标。
func AggregateYearly(personID uint64, year int, months []domain.MonthlyMetric) domain.YearlyMetric {
	y := domain.YearlyMetric{PersonID: personID, Year: year}

	for _, mm := range months {
		y.Wave += mm.Wave
		y.Minutes += mm.Minutes
		y.LiveDays += mm.LiveDays
		if mm.Wave > 0 || mm.Minutes > 0 {
			y.ActiveMonths++
		}
		if mm.Wave > y.BestMonthWave {
			y.BestMonthWave = mm.Wave
			period := mm.Period
			y.BestMonth = &period
		}
		if mm.BestDayWave > y.BestDayWave {
			y.BestDayWave = mm.BestDayWave
			y.BestDayDate = mm.BestDayDate
		}
	}
	if y.ActiveMonths > 0 {
		y.AvgMonthWave = y.Wave / int64(y.ActiveMonths)
	}
	y.FormattedDuration = domain.FormatDuration(y.Minutes)
	return y
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }
