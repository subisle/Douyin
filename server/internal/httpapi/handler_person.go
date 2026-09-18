package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"douyin-server/internal/domain"
	"douyin-server/internal/repo"
)

func (s *Server) listPersons(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	gender := domain.Gender(q.Get("gender"))
	if gender != "" && !gender.Valid() {
		badRequest(w, "gender 只能是 male / female / unknown")
		return
	}
	status := domain.PersonStatus(q.Get("status"))
	if status != "" && !status.Valid() {
		badRequest(w, "status 只能是 active / left / paused")
		return
	}

	f := repo.PersonFilter{Gender: gender, Status: status, Keyword: q.Get("keyword")}
	f.Limit = queryInt(q.Get("limit"), 200)
	f.Offset = queryInt(q.Get("offset"), 0)

	persons, err := s.repo.ListPersons(r.Context(), f)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, persons)
}

func (s *Server) createPerson(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string             `json:"name"`
		Gender     domain.Gender      `json:"gender"`
		Status     domain.PersonStatus `json:"status"`
		MasterID   *uint64            `json:"masterId"`
		Generation *int               `json:"generation"`
		GroupName  *string            `json:"groupName"`
		AvatarURL  *string            `json:"avatarUrl"`
		Hide       bool               `json:"hideInDailyReport"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	if req.Name == "" {
		badRequest(w, "name 不能为空")
		return
	}
	if req.Gender == "" {
		req.Gender = domain.GenderUnknown
	}
	if !req.Gender.Valid() {
		badRequest(w, "gender 非法")
		return
	}
	if req.Status == "" {
		req.Status = domain.PersonStatusActive
	}
	if !req.Status.Valid() {
		badRequest(w, "status 非法")
		return
	}

	p := &domain.Person{
		Name:              req.Name,
		Gender:            req.Gender,
		Status:            req.Status,
		MasterID:          req.MasterID,
		Generation:        req.Generation,
		GroupName:         req.GroupName,
		AvatarURL:         req.AvatarURL,
		HideInDailyReport: req.Hide,
	}
	if err := s.repo.CreatePerson(r.Context(), p); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) getPerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	p, err := s.repo.GetPerson(r.Context(), id)
	if err != nil {
		if isNotFound(err) {
			notFound(w, "主播不存在")
			return
		}
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) updatePerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	existing, err := s.repo.GetPerson(r.Context(), id)
	if err != nil {
		if isNotFound(err) {
			notFound(w, "主播不存在")
			return
		}
		internalError(w, err)
		return
	}

	// 部分更新：只覆盖请求里出现过的字段，未出现的保持原值。
	var req struct {
		Name       *string             `json:"name"`
		Gender     *domain.Gender      `json:"gender"`
		Status     *domain.PersonStatus `json:"status"`
		MasterID   *uint64             `json:"masterId"`
		Generation *int                `json:"generation"`
		GroupName  *string             `json:"groupName"`
		AvatarURL  *string             `json:"avatarUrl"`
		Hide       *bool               `json:"hideInDailyReport"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Gender != nil {
		if !req.Gender.Valid() {
			badRequest(w, "gender 非法")
			return
		}
		existing.Gender = *req.Gender
	}
	if req.Status != nil {
		if !req.Status.Valid() {
			badRequest(w, "status 非法")
			return
		}
		existing.Status = *req.Status
	}
	if req.MasterID != nil {
		existing.MasterID = req.MasterID
	}
	if req.Generation != nil {
		existing.Generation = req.Generation
	}
	if req.GroupName != nil {
		existing.GroupName = req.GroupName
	}
	if req.AvatarURL != nil {
		existing.AvatarURL = req.AvatarURL
	}
	if req.Hide != nil {
		existing.HideInDailyReport = *req.Hide
	}
	if existing.Name == "" {
		badRequest(w, "name 不能为空")
		return
	}

	if err := s.repo.UpdatePerson(r.Context(), existing); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

func (s *Server) deletePerson(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.repo.SoftDeletePerson(r.Context(), id); err != nil {
		if isNotFound(err) {
			notFound(w, "主播不存在")
			return
		}
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	accounts, err := s.repo.ListAccounts(r.Context(), id)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

func (s *Server) bindAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		AnchorID   string `json:"anchorId"`
		DouyinNo   string `json:"douyinNo"`
		AnchorName string `json:"anchorName"`
		IsPrimary  bool   `json:"isPrimary"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "请求体不是合法 JSON")
		return
	}
	if req.AnchorID == "" {
		badRequest(w, "anchorId 不能为空")
		return
	}

	a := &domain.Account{
		PersonID:   id,
		AnchorID:   req.AnchorID,
		DouyinNo:   req.DouyinNo,
		AnchorName: req.AnchorName,
		IsPrimary:  req.IsPrimary,
		Status:     "active",
	}
	if err := s.repo.BindAccount(r.Context(), a); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

func pathID(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	raw := r.PathValue("id")
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		badRequest(w, "id 不是合法的正整数")
		return 0, false
	}
	return id, true
}

func queryInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}
