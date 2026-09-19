// Package metric 里的首页聚合。
//
// 首页要 KPI、趋势曲线、未播预警、榜单四份数据，但它们的原始数据是同一份：
// 最近 N 天的日指标。与其打四次 SQL，不如一次取全在内存里算——
// 200 人 × 30 天 = 6000 行，内存里跑是毫秒级，比四次往返快得多。
package metric

import (
	"sort"
	"time"

	"douyin-server/internal/domain"
)

const dateLayout = "2006-01-02"

// DayPoint 是趋势图上的一个点。
type DayPoint struct {
	Date   string `json:"date"`
	Female int64  `json:"female"`
	Male   int64  `json:"male"`
	Total  int64  `json:"total"`
}

// AbsentRow 未播预警的一行，Days 是"截至统计日连续未开播天数"。
type AbsentRow struct {
	PersonID uint64 `json:"personId"`
	Name     string `json:"name"`
	Gender   string `json:"gender"`
	Days     int    `json:"days"`
}

// TopRow 榜单前 N 名。
type TopRow struct {
	PersonID uint64 `json:"personId"`
	Name     string `json:"name"`
	Gender   string `json:"gender"`
	Wave     int64  `json:"wave"`
	Minutes  int    `json:"minutes"`
	Tier     string `json:"tier,omitempty"`
}

// Summary 顶部 KPI。
type Summary struct {
	Date          string  `json:"date"`
	TotalWave     int64   `json:"totalWave"`
	PrevWave      int64   `json:"prevWave"`
	LiveCount     int     `json:"liveCount"`
	TotalCount    int     `json:"totalCount"`
	MonthWave     int64   `json:"monthWave"`
	MonthMinutes  int     `json:"monthMinutes"`
	MonthProgress float64 `json:"monthProgress"`
}

// Dashboard 首页一次返回的全部数据。
type Dashboard struct {
	Summary Summary     `json:"summary"`
	Trend   []DayPoint  `json:"trend"`
	Absent  []AbsentRow `json:"absent"`
	Top     []TopRow    `json:"top"`
}

// BuildDashboard 由最近 N 天的日指标算出首页所需的一切。
//
// rows 里可能包含多个人的多条记录，按 (person, date) 已唯一。
// date 是"今天"，即趋势图最右侧那一天。
func BuildDashboard(rows []domain.DailyMetric, date time.Time, days int, topN int) Dashboard {
	today := date.Format(dateLayout)
	yesterday := date.AddDate(0, 0, -1).Format(dateLayout)
	monthPrefix := date.Format("2006-01")

	byDate := map[string]*DayPoint{}
	dateOrder := []string{}

	// 趋势：按日期 + 性别汇总音浪
	for _, r := range rows {
		key := r.BizDate.Format(dateLayout)
		p, ok := byDate[key]
		if !ok {
			p = &DayPoint{Date: key}
			byDate[key] = p
			dateOrder = append(dateOrder, key)
		}
		p.Total += r.Wave
		switch r.Gender {
		case domain.GenderFemale:
			p.Female += r.Wave
		default:
			p.Male += r.Wave
		}
	}
	sort.Strings(dateOrder)

	trend := make([]DayPoint, 0, len(dateOrder))
	for _, k := range dateOrder {
		trend = append(trend, *byDate[k])
	}
	// 不足 N 天时在左侧补齐空点，否则曲线会被拉歪
	for len(trend) < days {
		first := date.AddDate(0, 0, -(days - 1))
		trend = append([]DayPoint{{Date: first.Format(dateLayout)}}, trend...)
		break
	}

	var summary Summary
	summary.Date = today

	todayRows := map[uint64]domain.DailyMetric{}
	for _, r := range rows {
		key := r.BizDate.Format(dateLayout)
		switch key {
		case today:
			summary.TotalWave += r.Wave
			if r.IsLive {
				summary.LiveCount++
			}
			summary.TotalCount++
			todayRows[r.PersonID] = r
		case yesterday:
			summary.PrevWave += r.Wave
		}
		if len(key) >= 7 && key[:7] == monthPrefix {
			summary.MonthWave += r.Wave
			summary.MonthMinutes += r.Minutes
		}
	}

	// 月进度：已过天数 / 当月总天数
	daysInMonth := daysOfMonth(date)
	summary.MonthProgress = float64(date.Day()) / float64(daysInMonth)

	// 榜单：取当天按音浪降序的前 N 名
	todayList := make([]domain.DailyMetric, 0, len(todayRows))
	for _, r := range todayRows {
		todayList = append(todayList, r)
	}
	sort.Slice(todayList, func(i, j int) bool {
		if todayList[i].Wave == todayList[j].Wave {
			return todayList[i].Minutes > todayList[j].Minutes
		}
		return todayList[i].Wave > todayList[j].Wave
	})
	top := make([]TopRow, 0, topN)
	for i, r := range todayList {
		if i >= topN {
			break
		}
		row := TopRow{PersonID: r.PersonID, Name: r.Name, Gender: string(r.Gender), Wave: r.Wave, Minutes: r.Minutes}
		if r.Tier != nil {
			row.Tier = *r.Tier
		}
		top = append(top, row)
	}

	return Dashboard{
		Summary: summary,
		Trend:   trend,
		Absent:  buildAbsent(rows, date),
		Top:     top,
	}
}

// buildAbsent 算每个人"截至 date 连续未开播天数"。
//
// 只统计 date 当天就没开播的人：昨天开了、今天没开，不算预警对象。
func buildAbsent(rows []domain.DailyMetric, date time.Time) []AbsentRow {
	byPerson := map[uint64]map[string]bool{}
	names := map[uint64]string{}
	genders := map[uint64]string{}

	for _, r := range rows {
		if byPerson[r.PersonID] == nil {
			byPerson[r.PersonID] = map[string]bool{}
		}
		byPerson[r.PersonID][r.BizDate.Format(dateLayout)] = r.IsLive
		names[r.PersonID] = r.Name
		genders[r.PersonID] = string(r.Gender)
	}

	out := []AbsentRow{}
	for id, days := range byPerson {
		streak := 0
		for d := date; ; d = d.AddDate(0, 0, -1) {
			live, ok := days[d.Format(dateLayout)]
			if !ok {
				// 没有记录不等于没开播：数据缺失时停止计数，避免误报
				break
			}
			if live {
				break
			}
			streak++
			if streak > 365 {
				break
			}
		}
		if streak > 0 {
			out = append(out, AbsentRow{
				PersonID: id, Name: names[id], Gender: genders[id], Days: streak,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Days > out[j].Days })
	return out
}

func daysOfMonth(t time.Time) int {
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
	next := first.AddDate(0, 1, 0)
	return int(next.Sub(first).Hours() / 24)
}
