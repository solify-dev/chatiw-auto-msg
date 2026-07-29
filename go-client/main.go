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

const defaultAPI = "http://38.247.138.163:3000"

type startResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Error   string `json:"error"`
	Job     *Job   `json:"job"`
}

type friendUser struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	Age      string `json:"age"`
	Gender   string `json:"gender"`
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
	Friends     []friendUser `json:"friends"`
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

	if err := startMessaging(apiBase, username, age, msg); err != nil {
		fatal(err.Error())
	}

	watchAndLog(apiBase)
}

func startMessaging(apiBase, username string, age int, message string) error {
	payload, _ := json.Marshal(map[string]any{
		"username": username,
		"age":      age,
		"message":  message,
	})

	fmt.Printf("\nStarting messaging via %s/api/message ...\n", apiBase)
	resp, err := http.Post(apiBase+"/api/message", "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("could not reach server: %v\nIs the API running? (npm run api)", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var started startResponse
	_ = json.Unmarshal(raw, &started)

	if resp.StatusCode == http.StatusConflict {
		return fmt.Errorf("busy: %s", prefer(started.Error, string(raw)))
	}
	if resp.StatusCode >= 400 || !started.OK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, prefer(started.Error, string(raw)))
	}

	fmt.Println("Messaging start requested.")
	if started.Job != nil && started.Job.ID != "" {
		fmt.Printf("Job ID: %s\n", started.Job.ID)
	}
	return nil
}

// watchAndLog prints "Initializing Cloudflare..." until the server publishes the
// full friend list, then logs "Message sent to {username}" for every user from
// first to last, one every 0.5 seconds.
func watchAndLog(apiBase string) {
	const (
		pollEvery = 2 * time.Second
		sendEvery = 500 * time.Millisecond
	)

	ticker := time.NewTicker(pollEvery)
	defer ticker.Stop()

	intervalLog("Initializing Cloudflare...")

	var friends []friendUser

	for range ticker.C {
		st, err := getStatus(apiBase)
		if err != nil {
			intervalLog("Initializing Cloudflare...")
			continue
		}

		if st.Job != nil && st.Job.Status == "failed" {
			fmt.Println("error:", st.Job.Error)
			os.Exit(1)
		}

		if st.Job != nil && len(st.Job.Friends) > 0 {
			friends = st.Job.Friends
			intervalLog(fmt.Sprintf("Friend list ready (%d users) — logging sends...", len(friends)))
			break
		}

		intervalLog("Initializing Cloudflare...")
	}

	for _, f := range friends {
		name := strings.TrimSpace(f.Username)
		if name == "" {
			name = strings.TrimSpace(f.UserID)
		}
		if name == "" {
			continue
		}
		intervalLog(fmt.Sprintf("Message sent to %s", name))
		time.Sleep(sendEvery)
	}

	intervalLog(fmt.Sprintf("Done. logged=%d users", len(friends)))
}

func intervalLog(msg string) {
	fmt.Printf("[%s] %s\n", time.Now().Format("15:04:05"), msg)
}

func getStatus(apiBase string) (*statusResponse, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiBase + "/api/status")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
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
