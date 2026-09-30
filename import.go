package main

// import.go - นำเข้า CSV รูปแบบเดียวกับไฟล์ export (อ่านตามชื่อคอลัมน์ ลำดับไม่สำคัญ)
//   ต้องมี: date, character   ไม่บังคับ: job, level, exp_pct, debt|debt_m, gold|gold_m, conquer, deaths, note
//   แถวที่ job = vault หรือ character = "คลัง/อื่นๆ" คือเงินคลัง
// ตัวละครจับคู่ด้วยชื่อ (ไม่มีจะสร้างใหม่) แถววันเดียวกันของตัวเดียวกันจะถูกทับ

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"strings"
	"time"
)

const vaultName = "คลัง/อื่นๆ"

type ImportResult struct {
	Snapshots     int `json:"snapshots"`
	Vault         int `json:"vault"`
	NewCharacters int `json:"new_characters"`
	Skipped       int `json:"skipped"`
}

func (s *Store) ImportCSV(data []byte) (ImportResult, error) {
	var res ImportResult
	data = bytes.TrimPrefix(data, []byte(bom))
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	rows, err := r.ReadAll()
	if err != nil {
		return res, fmt.Errorf("อ่าน CSV ไม่ได้: %w", err)
	}
	if len(rows) < 2 {
		return res, errors.New("ไฟล์ไม่มีข้อมูล")
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	if _, ok := col["date"]; !ok {
		return res, errors.New("ไม่พบคอลัมน์ date (ต้องเป็นไฟล์รูปแบบเดียวกับที่ดาวน์โหลดจากโปรแกรม และบันทึกเป็น UTF-8)")
	}
	if _, ok := col["character"]; !ok {
		return res, errors.New("ไม่พบคอลัมน์ character")
	}
	field := func(row []string, name string) string {
		i, ok := col[name]
		if !ok {
			return ""
		}
		return strings.TrimSpace(get(row, i))
	}
	// amount - ค่าเต็มจำนวนจากคอลัมน์ name หรือหน่วยล้านจากคอลัมน์ name_m
	amount := func(row []string, name string) *int64 {
		if v := optInt64(field(row, name)); v != nil {
			return v
		}
		if f := optFloat(field(row, name+"_m")); f != nil {
			v := int64(*f*1e6 + 0.5)
			return &v
		}
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.backup("import"); err != nil {
		return res, fmt.Errorf("สำรองข้อมูลก่อนนำเข้าไม่สำเร็จ: %w", err)
	}
	byName := map[string]int{}
	maxChar, maxSnap := 0, 0
	for _, c := range s.chr {
		byName[c.Name] = c.ID
		maxChar = max(maxChar, c.ID)
	}
	for _, x := range s.snap {
		maxSnap = max(maxSnap, x.ID)
	}

	for _, row := range rows[1:] {
		date, name := field(row, "date"), field(row, "character")
		if _, err := time.Parse("2006-01-02", date); err != nil || name == "" {
			res.Skipped++
			continue
		}
		note := field(row, "note")
		gold := amount(row, "gold")
		if field(row, "job") == "vault" || name == vaultName {
			if gold == nil {
				res.Skipped++
				continue
			}
			found := false
			for i := range s.vlt {
				if s.vlt[i].Date == date {
					s.vlt[i].Gold, s.vlt[i].Note = *gold, note
					found = true
					break
				}
			}
			if !found {
				s.vlt = append(s.vlt, VaultEntry{Date: date, Gold: *gold, Note: note})
			}
			res.Vault++
			continue
		}

		sn := Snapshot{
			Date:    date,
			Level:   optInt(field(row, "level")),
			ExpPct:  optFloat(field(row, "exp_pct")),
			Gold:    gold,
			Note:    note,
			Conquer: optInt64(field(row, "conquer")),
			Deaths:  optInt(field(row, "deaths")),
		}
		if d := amount(row, "debt"); d != nil {
			sn.Debt = *d
		}
		if sn.Level == nil && sn.ExpPct == nil && sn.Gold == nil && sn.Conquer == nil && sn.Deaths == nil && note == "" {
			res.Skipped++
			continue
		}
		id, ok := byName[name]
		if !ok {
			maxChar++
			id = maxChar
			s.chr = append(s.chr, Character{ID: id, Name: name, Job: field(row, "job"), HasDebt: sn.Debt > 0, SortOrder: len(s.chr), Active: true})
			byName[name] = id
			res.NewCharacters++
		}
		sn.CharID = id
		found := false
		for i := range s.snap {
			if s.snap[i].CharID == id && s.snap[i].Date == date {
				sn.ID = s.snap[i].ID
				s.snap[i] = sn
				found = true
				break
			}
		}
		if !found {
			maxSnap++
			sn.ID = maxSnap
			s.snap = append(s.snap, sn)
		}
		res.Snapshots++
	}

	s.sortAll()
	if err := s.saveCharacters(); err != nil {
		return res, err
	}
	if err := s.saveSnapshots(); err != nil {
		return res, err
	}
	return res, s.saveVault()
}
