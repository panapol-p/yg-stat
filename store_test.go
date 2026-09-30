package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestSaveDayRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.SaveDay(DayPayload{Date: "2026-09-30", Rows: []DayRow{
		{CharID: 3, Level: ptr(131), ExpPct: ptr(53.18), Debt: ptr(int64(500_000_000)), Gold: ptr(int64(20_700_000)), Deaths: ptr(2), Note: "ตาย 2"},
		{CharID: 1}, // แถวว่าง ต้องถูกข้าม
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSettings(Settings{GoalGold: ptr(int64(20_000_000_000))}); err != nil {
		t.Fatal(err)
	}

	s2, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	st := s2.State()
	if len(st.Snapshots) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(st.Snapshots))
	}
	x := st.Snapshots[0]
	if x.Debt != 500_000_000 || x.Deaths == nil || *x.Deaths != 2 || *x.ExpPct != 53.18 || x.Note != "ตาย 2" {
		t.Errorf("snapshot ไม่ตรง: %+v", x)
	}
	if st.Settings.GoalGold == nil || *st.Settings.GoalGold != 20_000_000_000 {
		t.Errorf("goal_gold ไม่ตรง: %v", st.Settings.GoalGold)
	}
}

func TestDefaultDebtClasses(t *testing.T) {
	s, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range s.State().Characters {
		want := c.Job == "มิโกะ" || c.Job == "ชินพุง"
		if c.HasDebt != want {
			t.Errorf("%s: has_debt = %v, want %v", c.Name, c.HasDebt, want)
		}
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	src, _ := OpenStore(t.TempDir())
	_, err := src.SaveDay(DayPayload{
		Date: "2026-09-29",
		Rows: []DayRow{{CharID: 3, Level: ptr(131), ExpPct: ptr(11.01), Debt: ptr(int64(800_000_000)), Gold: ptr(int64(25_200_000)), Conquer: ptr(int64(47173945)), Deaths: ptr(1)}},
		Vault: &struct {
			Gold *int64 `json:"gold"`
			Note string `json:"note"`
		}{Gold: ptr(int64(1_500_000_000)), Note: "คลัง"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.SaveCharacter(Character{Name: "ตัวใหม่", Job: "หอก", Active: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := src.SaveDay(DayPayload{Date: "2026-09-29", Rows: []DayRow{{CharID: 7, Level: ptr(50), ExpPct: ptr(1.5)}}}); err != nil {
		t.Fatal(err)
	}

	dst, _ := OpenStore(t.TempDir())
	res, err := dst.ImportCSV(src.ExportCSV())
	if err != nil {
		t.Fatal(err)
	}
	if res.Snapshots != 2 || res.Vault != 1 || res.NewCharacters != 1 || res.Skipped != 0 {
		t.Errorf("result = %+v", res)
	}
	st := dst.State()
	if len(st.Snapshots) != 2 || len(st.Vault) != 1 || len(st.Characters) != 7 {
		t.Fatalf("state: %d snapshots, %d vault, %d chars", len(st.Snapshots), len(st.Vault), len(st.Characters))
	}
	x := st.Snapshots[0]
	if x.CharID != 3 || x.Debt != 800_000_000 || *x.Gold != 25_200_000 || *x.Conquer != 47173945 || *x.Deaths != 1 {
		t.Errorf("snapshot ไม่ตรง: %+v", x)
	}
	if st.Vault[0].Gold != 1_500_000_000 {
		t.Errorf("vault = %+v", st.Vault[0])
	}

	// นำเข้าซ้ำ = ทับ ไม่เพิ่มแถว
	if _, err := dst.ImportCSV(src.ExportCSV()); err != nil {
		t.Fatal(err)
	}
	if n := len(dst.State().Snapshots); n != 2 {
		t.Errorf("นำเข้าซ้ำแล้วได้ %d แถว, want 2", n)
	}
}

func TestImportUnitsAndBadRows(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	csv := "date,character,level,exp_pct,gold_m,debt_m\n" +
		"2026-09-30,ดาบ,131,41.27,796.9,\n" +
		"30/09/2026,ดาบ,131,50,1,\n" + // รูปแบบวันที่ผิด
		"2026-09-30,มิโกะ,131,60,,350\n"
	res, err := s.ImportCSV([]byte(csv))
	if err != nil {
		t.Fatal(err)
	}
	if res.Snapshots != 2 || res.Skipped != 1 || res.NewCharacters != 0 {
		t.Errorf("result = %+v", res)
	}
	for _, x := range s.State().Snapshots {
		switch x.CharID {
		case 1:
			if *x.Gold != 796_900_000 {
				t.Errorf("gold = %d", *x.Gold)
			}
		case 3:
			if x.Debt != 350_000_000 {
				t.Errorf("debt = %d", x.Debt)
			}
		}
	}
	if _, err := s.ImportCSV([]byte("a,b\n1,2\n")); err == nil {
		t.Error("ไฟล์ไม่มีคอลัมน์ date ต้อง error")
	}
}

func TestBackupDailyAndPrune(t *testing.T) {
	defer func() { now = time.Now }()
	dir := t.TempDir()
	s, _ := OpenStore(dir)
	s.BackupKeep = 3
	day := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		now = func() time.Time { return day.AddDate(0, 0, i) }
		// บันทึก 2 ครั้งในวันเดียว ต้องได้ชุดสำรองชุดเดียว
		for j := 0; j < 2; j++ {
			if _, err := s.SaveDay(DayPayload{Date: "2026-09-01", Rows: []DayRow{{CharID: 1, Level: ptr(100 + i)}}}); err != nil {
				t.Fatal(err)
			}
		}
	}
	ents, err := os.ReadDir(filepath.Join(dir, "backups"))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range ents {
		names = append(names, e.Name())
	}
	want := []string{"2026-09-03", "2026-09-04", "2026-09-05"}
	if len(names) != 3 || names[0] != want[0] || names[2] != want[2] {
		t.Errorf("backups = %v, want %v", names, want)
	}
	// ชุดสำรองคือสถานะ "ก่อน" การแก้ครั้งแรกของวัน
	b, err := os.ReadFile(filepath.Join(dir, "backups", "2026-09-05", "snapshots.csv"))
	if err != nil {
		t.Fatal(err)
	}
	s2 := &Store{dir: filepath.Join(dir, "backups", "2026-09-05")}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	if len(s2.snap) != 1 || *s2.snap[0].Level != 103 {
		t.Errorf("backup content ไม่ใช่ของวันก่อน: %s", b)
	}
}
