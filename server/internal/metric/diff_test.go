package metric

import (
	"testing"
	"time"

	"douyin-server/internal/domain"
)

func day(y, m, d int) time.Time {
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.Local)
}

func TestComputeDaily(t *testing.T) {
	// 615 语义：快照值即当日值，不做差分。prev 不参与计算。
	tests := []struct {
		name        string
		cur         Point
		wantWave    int64
		wantMinutes int
		wantLive    bool
	}{
		{
			name:        "首条快照：当日音浪直接生效",
			cur:         Point{Date: day(2026, 9, 1), Wave: 500000, Minutes: 3000},
			wantWave:    500000,
			wantMinutes: 3000,
			wantLive:    true,
		},
		{
			name:        "连续两天：各取各的日值",
			cur:         Point{Date: day(2026, 9, 2), Wave: 12000, Minutes: 480},
			wantWave:    12000,
			wantMinutes: 480,
			wantLive:    true,
		},
		{
			name:        "数值回退只是数据本身，不报异常不清零",
			cur:         Point{Date: day(2026, 9, 2), Wave: 8000, Minutes: 300},
			wantWave:    8000,
			wantMinutes: 300,
			wantLive:    true,
		},
		{
			name:        "零值快照：未开播",
			cur:         Point{Date: day(2026, 9, 2), Wave: 0, Minutes: 0},
			wantWave:    0,
			wantMinutes: 0,
			wantLive:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, anomalies := ComputeDaily(1, "anchor-1", tt.cur, nil)

			if got.Wave != tt.wantWave {
				t.Errorf("日音浪 = %d, 期望 %d", got.Wave, tt.wantWave)
			}
			if got.Minutes != tt.wantMinutes {
				t.Errorf("日时长 = %d, 期望 %d", got.Minutes, tt.wantMinutes)
			}
			if !got.WaveReliable || !got.MinutesReliable {
				t.Error("日值语义下永远可信")
			}
			if got.WaveSpan != 1 || got.MinutesSpan != 1 {
				t.Errorf("span 应为 1, 实得 %d/%d", got.WaveSpan, got.MinutesSpan)
			}
			if got.IsLive != tt.wantLive {
				t.Errorf("is_live = %v, 期望 %v", got.IsLive, tt.wantLive)
			}
			if got.CumulativeWave != tt.cur.Wave {
				t.Errorf("累计字段应保留快照原值 %d，实得 %d", tt.cur.Wave, got.CumulativeWave)
			}
			if len(anomalies) != 0 {
				t.Errorf("不应有异常, 实得 %d", len(anomalies))
			}
		})
	}
}

func TestAggregateMonthly(t *testing.T) {
	days := []domain.DailyMetric{
		{BizDate: day(2026, 9, 1), Wave: 1000, Minutes: 120, IsLive: true, WaveReliable: true},
		{BizDate: day(2026, 9, 2), Wave: 2000, Minutes: 180, IsLive: true, WaveReliable: true},
		{BizDate: day(2026, 9, 3), Wave: 3000, Minutes: 60, IsLive: true, WaveReliable: false},
		{BizDate: day(2026, 9, 4), Wave: 0, Minutes: 0, IsLive: false, WaveReliable: true},
	}

	got := AggregateMonthly(7, "2026-09", days)

	// 不可信那天的量必须加回月总量，只计入 unreliable_days 供页脚提示。
	if got.Wave != 6000 {
		t.Errorf("月音浪 = %d, 期望 6000（漏采的量不能丢）", got.Wave)
	}
	if got.Minutes != 360 {
		t.Errorf("月时长 = %d, 期望 360", got.Minutes)
	}
	if got.LiveDays != 3 || got.AbsentDays != 1 {
		t.Errorf("开播/未播天数 = %d/%d, 期望 3/1", got.LiveDays, got.AbsentDays)
	}
	if got.UnreliableDays != 1 {
		t.Errorf("不可信天数 = %d, 期望 1", got.UnreliableDays)
	}
	if got.BestDayWave != 3000 {
		t.Errorf("最佳单日 = %d, 期望 3000", got.BestDayWave)
	}
	if got.FormattedDuration != "6h" {
		t.Errorf("时长格式化 = %q, 期望 %q", got.FormattedDuration, "6h")
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		minutes int
		want    string
	}{
		{0, "0h"},
		{45, "0h45m"},
		{60, "1h"},
		{128*60 + 30, "128h30m"},
	}
	for _, tt := range tests {
		if got := domain.FormatDuration(tt.minutes); got != tt.want {
			t.Errorf("FormatDuration(%d) = %q, 期望 %q", tt.minutes, got, tt.want)
		}
	}
}

func TestResolveTier(t *testing.T) {
	rules := []domain.TierRule{
		{Label: "A", MinWave: 500000},
		{Label: "B", MinWave: 200000},
		{Label: "C", MinWave: 50000},
		{Label: "D", MinWave: 0},
	}

	tests := []struct {
		wave int64
		want string
	}{
		{800000, "A"},
		{500000, "A"},
		{499999, "B"},
		{50000, "C"},
		{1, "D"},
		{0, "D"},
	}
	for _, tt := range tests {
		got := ResolveTier(tt.wave, rules)
		if got == nil {
			t.Fatalf("ResolveTier(%d) 返回 nil, 期望 %s", tt.wave, tt.want)
		}
		if *got != tt.want {
			t.Errorf("ResolveTier(%d) = %s, 期望 %s", tt.wave, *got, tt.want)
		}
	}

	if ResolveTier(100, nil) != nil {
		t.Error("没有规则时应返回 nil")
	}
}
