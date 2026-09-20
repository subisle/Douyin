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

// ComputeDaily 由快照算出日指标。
//
// 口径（2026-09 实证对齐 615 生产库）：快照值就是**当日值**，不做差分——
//   - 音浪快照 = 当日音浪。实测 615 的 wave_snapshots 同一账号逐日数值
//     几百到几万、非单调，是运营 CSV 的日值，不是平台累计值。
//   - 时长快照 = 当期月度时长（615 每月末一条，月内只有这一行有值）。
//
// 日报直接取快照值；月报按日求和（时长一个月只有月末一行，求和即月总量）。
//
// 原「累计值差分」设计建立在错误的数据假设上（数据源给的从来是日值），
// 差分会把正常日值算成负增量→清零，产生海量假异常。彻底废弃。
// prev 参数保留是为了调用方签名稳定，已不参与计算。
func ComputeDaily(personID uint64, anchorID string, cur Point, _ *Point) (domain.DailyMetric, []Anomaly) {
	m := domain.DailyMetric{
		PersonID:          personID,
		AnchorID:          anchorID,
		BizDate:           cur.Date,
		CumulativeWave:    cur.Wave,
		CumulativeMinutes: cur.Minutes,
		WaveSpan:          1,
		MinutesSpan:       1,
		Wave:              cur.Wave,
		Minutes:           cur.Minutes,
		WaveReliable:      true,
		MinutesReliable:   true,
		IsLive:            cur.Wave > 0 || cur.Minutes > 0,
	}
	return m, nil
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
