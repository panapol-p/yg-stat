// YG Stat - ระบบบันทึก EXP / เงิน ตัวละครโยวกัง (local, single binary)
//
//	build: go build -o yg-stat.exe .
//	run:   yg-stat.exe            (เปิด browser ให้อัตโนมัติ)
//	       yg-stat.exe -port 9000 -data D:\yg\data -no-browser
//
// ข้อมูลเก็บเป็น CSV ในโฟลเดอร์ data/ ข้าง ๆ ไฟล์ exe
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

//go:embed static
var staticFS embed.FS

// version - ใส่ตอน build ด้วย -ldflags "-X main.version=v1.2.3" (GitHub Actions ทำให้ตอนออก release)
var version = "dev"

func main() {
	exe, _ := os.Executable()
	defaultData := filepath.Join(filepath.Dir(exe), "data")
	// ตอนรัน `go run .` ไฟล์ exe อยู่ใน temp -> ถ้า cwd เป็นโปรเจกต์ (มี go.mod) ให้ใช้ cwd/data แทน
	if fileExists(filepath.Join(mustCwd(), "go.mod")) {
		defaultData = filepath.Join(mustCwd(), "data")
	}

	port := flag.Int("port", 8765, "พอร์ต")
	dataDir := flag.String("data", defaultData, "โฟลเดอร์เก็บ CSV")
	noBrowser := flag.Bool("no-browser", false, "ไม่ต้องเปิด browser อัตโนมัติ")
	backupKeep := flag.Int("backup-keep", 14, "จำนวนชุดสำรองอัตโนมัติที่เก็บไว้ใน data/backups (0 = ไม่สำรอง)")
	showVersion := flag.Bool("version", false, "แสดงเวอร์ชันแล้วจบ")
	flag.Parse()
	if *showVersion {
		fmt.Println("yg-stat", version)
		return
	}

	store, err := OpenStore(*dataDir)
	if err != nil {
		log.Fatalf("เปิดข้อมูลไม่ได้: %v", err)
	}
	store.BackupKeep = *backupKeep
	backupDir, err := store.BackupDaily()
	if err != nil {
		log.Printf("สำรองข้อมูลไม่สำเร็จ: %v", err)
	}

	sub, _ := fs.Sub(staticFS, "static")
	mux := http.NewServeMux()
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))

	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		st := store.State()
		st.Version = version
		writeJSON(w, 200, st)
	})
	mux.HandleFunc("POST /api/day", func(w http.ResponseWriter, r *http.Request) {
		var p DayPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeErr(w, 400, err)
			return
		}
		n, err := store.SaveDay(p)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "saved": n})
	})
	mux.HandleFunc("POST /api/characters", func(w http.ResponseWriter, r *http.Request) {
		var c Character
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			writeErr(w, 400, err)
			return
		}
		id, err := store.SaveCharacter(c)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "id": id})
	})
	mux.HandleFunc("POST /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var v Settings
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := store.SaveSettings(v); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 10<<20))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		res, err := store.ImportCSV(b)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "result": res})
	})
	mux.HandleFunc("DELETE /api/snapshots/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		if err := store.DeleteSnapshot(id); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("DELETE /api/vault/{date}", func(w http.ResponseWriter, r *http.Request) {
		if err := store.DeleteVault(r.PathValue("date")); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("DELETE /api/characters/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		if err := store.DeleteCharacter(id); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /api/export.csv", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="yg_stat_export.csv"`)
		_, _ = w.Write(store.ExportCSV())
	})

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	url := "http://" + addr + "/"
	fmt.Printf("YG Stat %s  ->  %s\n", version, url)
	fmt.Printf("ข้อมูล    ->  %s\n", *dataDir)
	if backupDir != "" {
		fmt.Printf("สำรอง    ->  %s\n", backupDir)
	}
	fmt.Println("กด Ctrl+C เพื่อปิด")
	if !*noBrowser {
		go func() {
			time.Sleep(500 * time.Millisecond)
			openBrowser(url)
		}()
	}
	log.Fatal(http.ListenAndServe(addr, mux))
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]any{"ok": false, "error": err.Error()})
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func mustCwd() string {
	d, err := os.Getwd()
	if err != nil {
		return "."
	}
	return d
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
