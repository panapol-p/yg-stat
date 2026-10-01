package main

// store.go - เก็บข้อมูลเป็น CSV ในโฟลเดอร์ data/ (เปิดด้วย Excel ได้เลย)
//   characters.csv : id,name,job,has_debt,sort_order,active,goal_level
//   snapshots.csv  : id,char_id,date,level,exp_pct,debt,gold,note,conquer,deaths
//   vault.csv      : date,gold,note
//   settings.csv   : key,value
// โหลดทั้งหมดขึ้น memory ตอนเริ่ม แล้วเขียนทับทั้งไฟล์ (atomic) ทุกครั้งที่บันทึก
// ข้อมูลเล็กมาก (6 ตัว x 365 วัน ~ 2 พันแถว/ปี) จึงไม่ต้องใช้ DB จริง

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type Character struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Job       string `json:"job"`
	HasDebt   bool   `json:"has_debt"` // ตายแล้ว EXP% ไม่ลด แต่ติดสถานะ "EXP ติดลบ" (จำนวน EXP) แยกต่างหาก
	SortOrder int    `json:"sort_order"`
	Active    bool   `json:"active"`
	GoalLevel *int   `json:"goal_level"` // เลเวลเป้าหมาย (ว่าง = ไม่ตั้ง)
}

type Snapshot struct {
	ID      int      `json:"id"`
	CharID  int      `json:"char_id"`
	Date    string   `json:"date"` // YYYY-MM-DD
	Level   *int     `json:"level"`
	ExpPct  *float64 `json:"exp_pct"`
	Debt    int64    `json:"debt"` // EXP ติดลบคงเหลือ (จำนวน EXP เต็ม เช่น 500000000 = 500M)
	Gold    *int64   `json:"gold"`
	Note    string   `json:"note"`
	Conquer *int64   `json:"conquer"` // ค่าพิชิตศัตรู (สะสม)
	Deaths  *int     `json:"deaths"`  // จำนวนครั้งที่ตายในวันนั้น
}

type VaultEntry struct {
	Date string `json:"date"`
	Gold int64  `json:"gold"`
	Note string `json:"note"`
}

type Settings struct {
	GoalGold *int64 `json:"goal_gold"` // เป้าหมายทรัพย์สินรวม (เงินเต็มจำนวน)
}

type State struct {
	Version    string       `json:"version"`
	Characters []Character  `json:"characters"`
	Snapshots  []Snapshot   `json:"snapshots"`
	Vault      []VaultEntry `json:"vault"`
	Settings   Settings     `json:"settings"`
}

type Store struct {
	mu   sync.RWMutex
	dir  string
	chr  []Character
	snap []Snapshot
	vlt  []VaultEntry
	set  Settings

	BackupKeep int // จำนวนชุดสำรองที่เก็บไว้ (0 = ไม่สำรอง)
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil // เริ่มต้นไม่มีตัวละคร ผู้ใช้เพิ่มเองในแท็บ "ตัวละคร"
}

// ------------------------------------------------------------- CSV helpers

var bom = string([]byte{0xEF, 0xBB, 0xBF})

func readCSV(path string) ([][]string, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b = bytes.TrimPrefix(b, []byte(bom))
	r := csv.NewReader(bytes.NewReader(b))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	if len(rows) > 0 {
		rows = rows[1:] // header
	}
	return rows, nil
}

func writeCSV(path string, header []string, rows [][]string) error {
	var buf bytes.Buffer
	buf.WriteString(bom) // ให้ Excel อ่านภาษาไทยถูก
	w := csv.NewWriter(&buf)
	w.UseCRLF = true
	if err := w.Write(header); err != nil {
		return err
	}
	if err := w.WriteAll(rows); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func atoiDef(s string, def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return v
	}
	return def
}

func optInt(s string) *int {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	v := int(f)
	return &v
}

func optInt64(s string) *int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	v := int64(f)
	return &v
}

func optFloat(s string) *float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &f
}

func fmtOptInt(v *int) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(*v)
}
func fmtOptInt64(v *int64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}
func fmtOptFloat(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatFloat(*v, 'f', -1, 64)
}
func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}
func get(row []string, i int) string {
	if i < len(row) {
		return row[i]
	}
	return ""
}

// ------------------------------------------------------------- load / save

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

func (s *Store) load() error {
	rows, err := readCSV(s.path("characters.csv"))
	if err != nil {
		return err
	}
	s.chr = nil
	for _, r := range rows {
		if len(r) < 2 {
			continue
		}
		s.chr = append(s.chr, Character{
			ID:        atoiDef(get(r, 0), 0),
			Name:      get(r, 1),
			Job:       get(r, 2),
			HasDebt:   get(r, 3) == "1",
			SortOrder: atoiDef(get(r, 4), 0),
			Active:    get(r, 5) != "0",
			GoalLevel: optInt(get(r, 6)),
		})
	}

	rows, err = readCSV(s.path("snapshots.csv"))
	if err != nil {
		return err
	}
	s.snap = nil
	for _, r := range rows {
		if len(r) < 3 {
			continue
		}
		var debt int64
		if f := optInt64(get(r, 5)); f != nil {
			debt = *f
		}
		s.snap = append(s.snap, Snapshot{
			ID:      atoiDef(get(r, 0), 0),
			CharID:  atoiDef(get(r, 1), 0),
			Date:    strings.TrimSpace(get(r, 2)),
			Level:   optInt(get(r, 3)),
			ExpPct:  optFloat(get(r, 4)),
			Debt:    debt,
			Gold:    optInt64(get(r, 6)),
			Note:    get(r, 7),
			Conquer: optInt64(get(r, 8)),
			Deaths:  optInt(get(r, 9)),
		})
	}

	rows, err = readCSV(s.path("vault.csv"))
	if err != nil {
		return err
	}
	s.vlt = nil
	for _, r := range rows {
		if len(r) < 2 {
			continue
		}
		var g int64
		if v := optInt64(get(r, 1)); v != nil {
			g = *v
		}
		s.vlt = append(s.vlt, VaultEntry{Date: strings.TrimSpace(get(r, 0)), Gold: g, Note: get(r, 2)})
	}

	rows, err = readCSV(s.path("settings.csv"))
	if err != nil {
		return err
	}
	s.set = Settings{}
	for _, r := range rows {
		if get(r, 0) == "goal_gold" {
			s.set.GoalGold = optInt64(get(r, 1))
		}
	}
	s.sortAll()
	return nil
}

func (s *Store) sortAll() {
	sort.SliceStable(s.chr, func(i, j int) bool {
		if s.chr[i].SortOrder != s.chr[j].SortOrder {
			return s.chr[i].SortOrder < s.chr[j].SortOrder
		}
		return s.chr[i].ID < s.chr[j].ID
	})
	sort.SliceStable(s.snap, func(i, j int) bool {
		if s.snap[i].Date != s.snap[j].Date {
			return s.snap[i].Date < s.snap[j].Date
		}
		return s.snap[i].CharID < s.snap[j].CharID
	})
	sort.SliceStable(s.vlt, func(i, j int) bool { return s.vlt[i].Date < s.vlt[j].Date })
}

func (s *Store) saveCharacters() error {
	rows := make([][]string, 0, len(s.chr))
	for _, c := range s.chr {
		rows = append(rows, []string{strconv.Itoa(c.ID), c.Name, c.Job, boolStr(c.HasDebt), strconv.Itoa(c.SortOrder), boolStr(c.Active), fmtOptInt(c.GoalLevel)})
	}
	return writeCSV(s.path("characters.csv"), []string{"id", "name", "job", "has_debt", "sort_order", "active", "goal_level"}, rows)
}

func (s *Store) saveSnapshots() error {
	rows := make([][]string, 0, len(s.snap))
	for _, x := range s.snap {
		rows = append(rows, []string{strconv.Itoa(x.ID), strconv.Itoa(x.CharID), x.Date, fmtOptInt(x.Level), fmtOptFloat(x.ExpPct), strconv.FormatInt(x.Debt, 10), fmtOptInt64(x.Gold), x.Note, fmtOptInt64(x.Conquer), fmtOptInt(x.Deaths)})
	}
	return writeCSV(s.path("snapshots.csv"), []string{"id", "char_id", "date", "level", "exp_pct", "debt", "gold", "note", "conquer", "deaths"}, rows)
}

func (s *Store) saveSettings() error {
	return writeCSV(s.path("settings.csv"), []string{"key", "value"}, [][]string{{"goal_gold", fmtOptInt64(s.set.GoalGold)}})
}

func (s *Store) saveVault() error {
	rows := make([][]string, 0, len(s.vlt))
	for _, v := range s.vlt {
		rows = append(rows, []string{v.Date, strconv.FormatInt(v.Gold, 10), v.Note})
	}
	return writeCSV(s.path("vault.csv"), []string{"date", "gold", "note"}, rows)
}

// ------------------------------------------------------------- public API

func (s *Store) State() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := State{
		Characters: append([]Character{}, s.chr...),
		Snapshots:  append([]Snapshot{}, s.snap...),
		Vault:      append([]VaultEntry{}, s.vlt...),
		Settings:   s.set,
	}
	if st.Snapshots == nil {
		st.Snapshots = []Snapshot{}
	}
	if st.Vault == nil {
		st.Vault = []VaultEntry{}
	}
	return st
}

type DayRow struct {
	CharID  int      `json:"char_id"`
	Level   *int     `json:"level"`
	ExpPct  *float64 `json:"exp_pct"`
	Debt    *int64   `json:"debt"`
	Gold    *int64   `json:"gold"`
	Note    string   `json:"note"`
	Conquer *int64   `json:"conquer"`
	Deaths  *int     `json:"deaths"`
}

type DayPayload struct {
	Date  string   `json:"date"`
	Rows  []DayRow `json:"rows"`
	Vault *struct {
		Gold *int64 `json:"gold"`
		Note string `json:"note"`
	} `json:"vault"`
}

// SaveDay - upsert ข้อมูลของวันเดียว (แถวที่ว่างทั้งหมดจะถูกข้าม)
func (s *Store) SaveDay(p DayPayload) (int, error) {
	if len(p.Date) != 10 {
		return 0, errors.New("ต้องระบุวันที่รูปแบบ YYYY-MM-DD")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDaily()
	saved := 0
	nextID := 0
	for _, x := range s.snap {
		if x.ID > nextID {
			nextID = x.ID
		}
	}
	for _, r := range p.Rows {
		note := strings.TrimSpace(r.Note)
		if r.Level == nil && r.ExpPct == nil && r.Gold == nil && r.Conquer == nil && r.Deaths == nil && note == "" {
			continue
		}
		var debt int64
		if r.Debt != nil {
			debt = *r.Debt
		}
		found := false
		for i := range s.snap {
			if s.snap[i].CharID == r.CharID && s.snap[i].Date == p.Date {
				s.snap[i].Level, s.snap[i].ExpPct, s.snap[i].Debt, s.snap[i].Gold, s.snap[i].Note, s.snap[i].Conquer, s.snap[i].Deaths = r.Level, r.ExpPct, debt, r.Gold, note, r.Conquer, r.Deaths
				found = true
				break
			}
		}
		if !found {
			nextID++
			s.snap = append(s.snap, Snapshot{ID: nextID, CharID: r.CharID, Date: p.Date, Level: r.Level, ExpPct: r.ExpPct, Debt: debt, Gold: r.Gold, Note: note, Conquer: r.Conquer, Deaths: r.Deaths})
		}
		saved++
	}
	if p.Vault != nil && p.Vault.Gold != nil {
		found := false
		for i := range s.vlt {
			if s.vlt[i].Date == p.Date {
				s.vlt[i].Gold, s.vlt[i].Note = *p.Vault.Gold, strings.TrimSpace(p.Vault.Note)
				found = true
				break
			}
		}
		if !found {
			s.vlt = append(s.vlt, VaultEntry{Date: p.Date, Gold: *p.Vault.Gold, Note: strings.TrimSpace(p.Vault.Note)})
		}
		saved++
	}
	s.sortAll()
	if err := s.saveSnapshots(); err != nil {
		return 0, err
	}
	if err := s.saveVault(); err != nil {
		return 0, err
	}
	return saved, nil
}

func (s *Store) DeleteSnapshot(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDaily()
	out := s.snap[:0]
	for _, x := range s.snap {
		if x.ID != id {
			out = append(out, x)
		}
	}
	s.snap = out
	return s.saveSnapshots()
}

func (s *Store) DeleteVault(date string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDaily()
	out := s.vlt[:0]
	for _, x := range s.vlt {
		if x.Date != date {
			out = append(out, x)
		}
	}
	s.vlt = out
	return s.saveVault()
}

func (s *Store) SaveCharacter(c Character) (int, error) {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return 0, errors.New("ต้องระบุชื่อตัวละคร")
	}
	if c.GoalLevel != nil && *c.GoalLevel <= 0 {
		c.GoalLevel = nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDaily()
	if c.ID > 0 {
		for i := range s.chr {
			if s.chr[i].ID == c.ID {
				s.chr[i] = c
				s.sortAll()
				return c.ID, s.saveCharacters()
			}
		}
		return 0, errors.New("ไม่พบตัวละคร")
	}
	maxID := 0
	for _, x := range s.chr {
		if x.ID > maxID {
			maxID = x.ID
		}
	}
	c.ID = maxID + 1
	s.chr = append(s.chr, c)
	s.sortAll()
	return c.ID, s.saveCharacters()
}

func (s *Store) SaveSettings(v Settings) error {
	if v.GoalGold != nil && *v.GoalGold <= 0 {
		v.GoalGold = nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDaily()
	s.set = v
	return s.saveSettings()
}

// DeleteCharacter - ลบตัวละครพร้อมประวัติทั้งหมดของตัวนั้น
func (s *Store) DeleteCharacter(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDaily()
	out := s.chr[:0]
	for _, x := range s.chr {
		if x.ID != id {
			out = append(out, x)
		}
	}
	s.chr = out
	sn := s.snap[:0]
	for _, x := range s.snap {
		if x.CharID != id {
			sn = append(sn, x)
		}
	}
	s.snap = sn
	if err := s.saveCharacters(); err != nil {
		return err
	}
	return s.saveSnapshots()
}

// ExportCSV - รวมทุกอย่างเป็นไฟล์เดียว (อ่านง่าย มีชื่อตัวละคร)
func (s *Store) ExportCSV() []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := map[int]Character{}
	for _, c := range s.chr {
		names[c.ID] = c
	}
	var buf bytes.Buffer
	buf.WriteString(bom)
	w := csv.NewWriter(&buf)
	w.UseCRLF = true
	_ = w.Write([]string{"date", "character", "job", "level", "exp_pct", "debt", "debt_m", "gold", "gold_m", "conquer", "deaths", "note"})
	for _, x := range s.snap {
		c := names[x.CharID]
		_ = w.Write([]string{x.Date, c.Name, c.Job, fmtOptInt(x.Level), fmtOptFloat(x.ExpPct), strconv.FormatInt(x.Debt, 10), goldM(&x.Debt), fmtOptInt64(x.Gold), goldM(x.Gold), fmtOptInt64(x.Conquer), fmtOptInt(x.Deaths), x.Note})
	}
	for _, v := range s.vlt {
		g := v.Gold
		_ = w.Write([]string{v.Date, "คลัง/อื่นๆ", "vault", "", "", "", "", strconv.FormatInt(v.Gold, 10), goldM(&g), "", "", v.Note})
	}
	w.Flush()
	return buf.Bytes()
}

// goldM - เงิน/EXP ติดลบ หน่วยล้าน (M) สำหรับไฟล์ export
func goldM(g *int64) string {
	if g == nil {
		return ""
	}
	return strconv.FormatFloat(float64(*g)/1e6, 'f', 3, 64)
}

// backupDaily - เรียกก่อนแก้ข้อมูลทุกครั้ง (ต้องถือ lock อยู่) สำรองได้วันละชุด ถ้าพลาดแค่ log ไม่ขวางการบันทึก
func (s *Store) backupDaily() {
	if _, err := s.backup(""); err != nil {
		log.Printf("สำรองข้อมูลไม่สำเร็จ: %v", err)
	}
}
