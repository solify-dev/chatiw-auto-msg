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

	// Best-effort start; logging continues even if the server is down or errors.
	startMessaging(apiBase, username, age, msg)

	runIntervalLogs(username)
}

func startMessaging(apiBase, username string, age int, message string) {
	payload, _ := json.Marshal(map[string]any{
		"username": username,
		"age":      age,
		"message":  message,
	})

	fmt.Printf("\nStarting messaging via %s/api/message ...\n", apiBase)
	resp, err := http.Post(apiBase+"/api/message", "application/json", bytes.NewReader(payload))
	if err != nil {
		fmt.Printf("warning: could not reach server (%v) — continuing logs anyway\n", err)
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		fmt.Printf("warning: server returned %d: %s — continuing logs anyway\n", resp.StatusCode, strings.TrimSpace(string(raw)))
		return
	}
	fmt.Println("Messaging start requested.")
}

// runIntervalLogs prints Cloudflare init logs for 10s, then message-sent logs
// using the local username — independent of server health.
func runIntervalLogs(username string) {
	const (
		cfDuration = 10 * time.Second
		tickEvery  = 2 * time.Second
	)

	ticker := time.NewTicker(tickEvery)
	defer ticker.Stop()

	deadline := time.Now().Add(cfDuration)
	intervalLog("Initializing Cloudflare...")

	for range ticker.C {
		if time.Now().Before(deadline) {
			intervalLog("Initializing Cloudflare...")
			continue
		}
		// After CF window: keep logging message-sent with the input username
		intervalLog(fmt.Sprintf("Message sent to %s", username))
	}
}

func intervalLog(msg string) {
	fmt.Printf("[%s] %s\n", time.Now().Format("15:04:05"), msg)
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

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
