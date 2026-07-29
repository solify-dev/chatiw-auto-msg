package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultAPI = "http://127.0.0.1:3000"

type startResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Error   string `json:"error"`
	Job     *Job   `json:"job"`
}

type sentTarget struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
}

type Job struct {
	ID          string       `json:"id"`
	Username    string       `json:"username"`
	Age         string       `json:"age"`
	Status      string       `json:"status"`
	TotalSent   int          `json:"totalSent"`
	ProxiesUsed int          `json:"proxiesUsed"`
	SentTo      []sentTarget `json:"sentTo"`
	Error       string       `json:"error"`
}

type statusResponse struct {
	Running bool `json:"running"`
	Job     *Job `json:"job"`
}

func main() {
	apiBase := strings.TrimRight(envOr("API_URL", defaultAPI), "/")
	in := bufio.NewReader(os.Stdin)

	fmt.Println("Chatiw auto-message client")
	fmt.Println("API:", apiBase)
	fmt.Println()

	username := prompt(in, "Username (nickname)")
	if username == "" {
		fatal("username is required")
	}

	ageStr := prompt(in, "Age")
	age, err := strconv.Atoi(strings.TrimSpace(ageStr))
	if err != nil || age < 18 || age > 90 {
		fatal("age must be a number between 18 and 90")
	}

	msg := prompt(in, "Message [hello]")
	if strings.TrimSpace(msg) == "" {
		msg = "hello"
	}

	payload := map[string]any{
		"username": username,
		"age":      age,
		"message":  msg,
	}
	body, _ := json.Marshal(payload)

	fmt.Printf("\nCalling POST %s/api/message ...\n", apiBase)
	resp, err := http.Post(apiBase+"/api/message", "application/json", bytes.NewReader(body))
	if err != nil {
		fatal(fmt.Sprintf("request failed: %v\nIs the API server running? (npm run api)", err))
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	var started startResponse
	_ = json.Unmarshal(raw, &started)

	if resp.StatusCode == http.StatusConflict {
		fatal(fmt.Sprintf("busy: %s", prefer(started.Error, string(raw))))
	}
	if resp.StatusCode >= 400 || !started.OK {
		fatal(fmt.Sprintf("API error (%d): %s", resp.StatusCode, prefer(started.Error, string(raw))))
	}

	fmt.Println("Started:", prefer(started.Message, "ok"))
	if started.Job != nil && started.Job.ID != "" {
		fmt.Printf("Job ID: %s\n", started.Job.ID)
	}

	watchJob(apiBase)
}

// watchJob logs "Initializing Cloudflare..." for the first 10s,
// then logs each newly sent friend username from the server status.
func watchJob(apiBase string) {
	const cfInitFor = 10 * time.Second
	const tickEvery = 2 * time.Second

	start := time.Now()
	cfUntil := start.Add(cfInitFor)
	seen := map[string]bool{}
	ticker := time.NewTicker(tickEvery)
	defer ticker.Stop()

	intervalLog("Initializing Cloudflare...")

	for range ticker.C {
		now := time.Now()

		if now.Before(cfUntil) {
			intervalLog("Initializing Cloudflare...")
			continue
		}

		st, err := getStatus(apiBase)
		if err != nil {
			intervalLog(fmt.Sprintf("status error: %v", err))
			continue
		}
		if st.Job == nil {
			intervalLog("waiting for job status...")
			continue
		}

		for _, t := range st.Job.SentTo {
			name := strings.TrimSpace(t.Username)
			if name == "" {
				name = strings.TrimSpace(t.UserID)
			}
			if name == "" {
				continue
			}
			key := t.UserID
			if key == "" {
				key = name
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			intervalLog(fmt.Sprintf("Message sent to %s", name))
		}

		status := st.Job.Status
		if !st.Running && (status == "completed" || status == "failed") {
			if status == "failed" {
				fmt.Println("error:", st.Job.Error)
				os.Exit(1)
			}
			intervalLog(fmt.Sprintf("Done. totalSent=%d", st.Job.TotalSent))
			return
		}
	}
}

func intervalLog(msg string) {
	fmt.Printf("[%s] %s\n", time.Now().Format("15:04:05"), msg)
}

func getStatus(apiBase string) (*statusResponse, error) {
	resp, err := http.Get(apiBase + "/api/status")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var st statusResponse
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

func prompt(in *bufio.Reader, label string) string {
	fmt.Printf("%s: ", label)
	line, _ := in.ReadString('\n')
	return strings.TrimSpace(line)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func prefer(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
