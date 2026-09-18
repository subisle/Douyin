package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"douyin-server/internal/domain"
	"douyin-server/internal/repo"
)

// importSnapshots POST /api/v1/imports/snapshots
//
// 请求体：
//
//	{
//	  "date": "2026-09-18",
//	  "source": "douyinlang",
//	  "operator": "admin",
//	  "waves":     [{"anchorId":"A1","waveValue":123456,"rank":3}],
//	  "durations": [{"anchorId":"A1","minutes":480}]
//	}
//
// 写完快照会立刻重算涉及到的主播，保证查到的永远是新鲜指标。
// anchor_id 没绑过主播的行会被跳过并计入 skipped，不会静默丢数据。
func (s *Server) importSnapshots(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Date      string `json:"date"`
		Source    string `json:"source"`
		Operator  string `json:"operator"`
		Waves     []struct {
			AnchorID  string `json:"anchorId"`
			WaveValue int64  `json:"waveValue"`
			Rank      *int   `json:"rank"`
		} `json:"waves"`
		Durations []struct {
			AnchorID string `json:"anchorId"`
			Minutes  int    `json:"minutes"`
		} `json:"durations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	if req.Date == "" {
		badRequest(w, "date 不能为空")
		return
	}
	date, err := time.ParseInLocation(isoDate, req.Date, time.Local)
	if err != nil {
		badRequest(w, "date 格式应为 YYYY-MM-DD")
		return
	}
	if len(req.Waves) == 0 && len(req.Durations) == 0 {
		badRequest(w, "waves 与 durations 不能同时为空")
		return
	}
	if req.Source == "" {
		req.Source = "manual"
	}

	batchID, err := s.repo.CreateBatch(r.Context(), date, req.Source, req.Operator)
	if err != nil {
		internalError(w, err)
		return
	}

	// 解析归属：认不出的账号单独记下来，让前端能看到"这次导入漏了谁"。
	waves := make([]domain.WaveSnapshot, 0, len(req.Waves))
	var skipped []string
	owners := map[uint64]bool{}

	for _, item := range req.Waves {
		if item.AnchorID == "" {
			continue
		}
		personID, err := s.repo.ResolveAnchorOwner(r.Context(), item.AnchorID)
		if err != nil {
			if errors.Is(err, repo.ErrNotFound) {
				skipped = append(skipped, item.AnchorID)
				continue
			}
			_ = s.repo.FinishBatch(r.Context(), batchID, 0, err.Error())
			internalError(w, err)
			return
		}
		waves = append(waves, domain.WaveSnapshot{
			AnchorID:  item.AnchorID,
			PersonID:  personID,
			BizDate:   date,
			WaveValue: item.WaveValue,
			RankInGuild: item.Rank,
		})
		owners[personID] = true
	}

	durations := make([]domain.DurationSnapshot, 0, len(req.Durations))
	for _, item := range req.Durations {
		if item.AnchorID == "" {
			continue
		}
		personID, err := s.repo.ResolveAnchorOwner(r.Context(), item.AnchorID)
		if err != nil {
			if errors.Is(err, repo.ErrNotFound) {
				skipped = append(skipped, item.AnchorID)
				continue
			}
			_ = s.repo.FinishBatch(r.Context(), batchID, 0, err.Error())
			internalError(w, err)
			return
		}
		durations = append(durations, domain.DurationSnapshot{
			AnchorID:          item.AnchorID,
			PersonID:          personID,
			BizDate:           date,
			CumulativeMinutes: item.Minutes,
		})
		owners[personID] = true
	}

	if err := s.repo.UpsertWaveSnapshots(r.Context(), batchID, waves); err != nil {
		_ = s.repo.FinishBatch(r.Context(), batchID, 0, err.Error())
		internalError(w, err)
		return
	}
	if err := s.repo.UpsertDurationSnapshots(r.Context(), batchID, durations); err != nil {
		_ = s.repo.FinishBatch(r.Context(), batchID, 0, err.Error())
		internalError(w, err)
		return
	}

	// 只重算今天这一天：导入是按天来的，没必要全量刷。
	for personID := range owners {
		if err := s.repo.RecomputePerson(r.Context(), personID, date, date); err != nil {
			_ = s.repo.FinishBatch(r.Context(), batchID, 0, err.Error())
			internalError(w, err)
			return
		}
	}

	rowCount := len(waves) + len(durations)
	if err := s.repo.FinishBatch(r.Context(), batchID, rowCount, ""); err != nil {
		internalError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"batchId":   batchID,
		"imported":  rowCount,
		"persons":   len(owners),
		"skipped":   skipped,
	})
}

// recompute POST /api/v1/imports/recompute
//
// 物化表脏了就用它重建。数据量小，全量重算也是秒级。
// 请求体：{"from":"2026-09-01","to":"2026-09-30","personId":123}
// 不传 personId 表示全量。
func (s *Server) recompute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From     string `json:"from"`
		To       string `json:"to"`
		PersonID uint64 `json:"personId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	from, to, ok := parseRange(w, req.From, req.To)
	if !ok {
		return
	}

	if req.PersonID > 0 {
		if err := s.repo.RecomputePerson(r.Context(), req.PersonID, from, to); err != nil {
			internalError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"persons": 1})
		return
	}

	n, err := s.repo.RecomputeAll(r.Context(), from, to)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"persons": n})
}

func parseRange(w http.ResponseWriter, rawFrom, rawTo string) (time.Time, time.Time, bool) {
	now := time.Now()
	from := now.AddDate(0, 0, -30)
	to := now

	if rawFrom != "" {
		v, err := time.ParseInLocation(isoDate, rawFrom, time.Local)
		if err != nil {
			badRequest(w, "from 格式应为 YYYY-MM-DD")
			return time.Time{}, time.Time{}, false
		}
		from = v
	}
	if rawTo != "" {
		v, err := time.ParseInLocation(isoDate, rawTo, time.Local)
		if err != nil {
			badRequest(w, "to 格式应为 YYYY-MM-DD")
			return time.Time{}, time.Time{}, false
		}
		to = v
	}
	if to.Before(from) {
		badRequest(w, "to 不能早于 from")
		return time.Time{}, time.Time{}, false
	}
	return from, to, true
}
