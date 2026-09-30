package main

// backup.go - สำรองโฟลเดอร์ data/ อัตโนมัติไว้ที่ data/backups/<วันที่>/
// สำรองวันละชุด (สถานะก่อนการแก้ไขครั้งแรกของวัน) และก่อนนำเข้า CSV ทุกครั้ง เก็บไว้ BackupKeep ชุดล่าสุด

import (
	"os"
	"path/filepath"
	"sort"
	"time"
)

var dataFiles = []string{"characters.csv", "snapshots.csv", "vault.csv", "settings.csv"}

// now แยกไว้ให้ test เปลี่ยนวันได้
var now = time.Now

// BackupDaily - สำรองชุดของวันนี้ถ้ายังไม่มี (เรียกตอนเปิดโปรแกรม)
func (s *Store) BackupDaily() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backup("")
}

// backup - ก๊อปไฟล์ CSV ไป backups/<YYYY-MM-DD>[_HHMMSS-<tag>]/ แล้วลบชุดเก่าเกิน BackupKeep
// tag ว่าง = ชุดประจำวัน (มีแล้วจะข้าม) คืน path ของชุดที่สร้าง ("" ถ้าไม่ได้สร้าง)
func (s *Store) backup(tag string) (string, error) {
	if s.BackupKeep <= 0 {
		return "", nil
	}
	name := now().Format("2006-01-02")
	if tag != "" {
		name = now().Format("2006-01-02_150405") + "-" + tag
	}
	root := filepath.Join(s.dir, "backups")
	dst := filepath.Join(root, name)
	if _, err := os.Stat(dst); err == nil {
		return "", nil
	}
	copied := 0
	for _, f := range dataFiles {
		b, err := os.ReadFile(s.path(f))
		if err != nil {
			continue // ไฟล์ยังไม่ถูกสร้าง
		}
		if copied == 0 {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return "", err
			}
		}
		if err := os.WriteFile(filepath.Join(dst, f), b, 0o644); err != nil {
			return "", err
		}
		copied++
	}
	if copied == 0 {
		return "", nil
	}
	return dst, pruneBackups(root, s.BackupKeep)
}

func pruneBackups(root string, keep int) error {
	ents, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	var dirs []string
	for _, e := range ents {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	sort.Strings(dirs) // ชื่อขึ้นต้นด้วยวันที่ -> เรียงตามเวลา
	for len(dirs) > keep {
		if err := os.RemoveAll(filepath.Join(root, dirs[0])); err != nil {
			return err
		}
		dirs = dirs[1:]
	}
	return nil
}
