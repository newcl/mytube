package api

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

type SubtitleEntry struct {
	Lang string `json:"lang"`
	Name string `json:"name"`
}

type SubtitleList struct {
	Subtitles         []SubtitleEntry `json:"subtitles"`
	AutomaticCaptions []SubtitleEntry `json:"automatic_captions"`
}

type SubtitleCue struct {
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	Text     string  `json:"text"`
}

type SubtitleSearchResult struct {
	JobID    int64   `json:"job_id"`
	Title    string  `json:"title"`
	Uploader string  `json:"uploader"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	Text     string  `json:"text"`
}

type SubtitleSearchResponse struct {
	Results []SubtitleSearchResult `json:"results"`
}

func (h *Handler) GetSubtitles(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	job, err := dbpkg.GetJob(h.DB, id)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	infoPath := infoJSONPath(job.OutputPath)
	if infoPath == "" {
		http.Error(w, "no output file", http.StatusNotFound)
		return
	}

	list := readSubtitleList(infoPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (h *Handler) SearchAllSubtitles(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		http.Error(w, "q is required", http.StatusBadRequest)
		return
	}

	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if lang == "" {
		lang = "en"
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	jobs, err := dbpkg.ListCompletedJobs(h.DB)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	queryLower := strings.ToLower(q)
	var results []SubtitleSearchResult

	for _, job := range jobs {
		if len(results) >= limit {
			break
		}

		infoPath := infoJSONPath(job.OutputPath)
		if infoPath == "" {
			continue
		}

		if _, err := os.Stat(infoPath); os.IsNotExist(err) {
			continue
		}

		vttPath, err := ensureSubtitleFile(infoPath, lang)
		if err != nil {
			continue
		}

		cues, err := parseVTT(vttPath)
		if err != nil {
			continue
		}

		for _, cue := range cues {
			if len(results) >= limit {
				break
			}
			if strings.Contains(strings.ToLower(cue.Text), queryLower) {
				results = append(results, SubtitleSearchResult{
					JobID:    job.ID,
					Title:    job.Title,
					Uploader: job.Uploader,
					Start:    cue.Start,
					Duration: cue.Duration,
					Text:     cue.Text,
				})
			}
		}
	}

	if results == nil {
		results = []SubtitleSearchResult{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(SubtitleSearchResponse{Results: results})
}

func infoJSONPath(outputPath string) string {
	if outputPath == "" {
		return ""
	}
	base := outputPath
	for _, ext := range []string{".mp4", ".mkv", ".webm", ".m4a", ".opus"} {
		if strings.HasSuffix(base, ext) {
			base = strings.TrimSuffix(base, ext)
			break
		}
	}
	return base + ".info.json"
}

func readSubtitleList(infoPath string) SubtitleList {
	data, err := os.ReadFile(infoPath)
	if err != nil {
		return SubtitleList{}
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return SubtitleList{}
	}

	var list SubtitleList

	if subs, ok := raw["subtitles"].(map[string]any); ok {
		for lang, ents := range subs {
			if arr, ok := ents.([]any); ok && len(arr) > 0 {
				name := lang
				if entry, ok := arr[0].(map[string]any); ok {
					if n, ok := entry["name"].(string); ok {
						name = n
					}
				}
				list.Subtitles = append(list.Subtitles, SubtitleEntry{Lang: lang, Name: name})
			}
		}
	}
	sort.Slice(list.Subtitles, func(i, j int) bool { return list.Subtitles[i].Lang < list.Subtitles[j].Lang })

	if auto, ok := raw["automatic_captions"].(map[string]any); ok {
		for lang, ents := range auto {
			if arr, ok := ents.([]any); ok && len(arr) > 0 {
				name := lang + " (auto)"
				if entry, ok := arr[0].(map[string]any); ok {
					if n, ok := entry["name"].(string); ok {
						name = n
					}
				}
				list.AutomaticCaptions = append(list.AutomaticCaptions, SubtitleEntry{Lang: lang, Name: name})
			}
		}
	}
	sort.Slice(list.AutomaticCaptions, func(i, j int) bool { return list.AutomaticCaptions[i].Lang < list.AutomaticCaptions[j].Lang })

	return list
}

func ensureSubtitleFile(infoPath, lang string) (string, error) {
	base := strings.TrimSuffix(infoPath, ".info.json")
	vttPath := base + "." + lang + ".vtt"

	if _, err := os.Stat(vttPath); err == nil {
		return vttPath, nil
	}

	data, err := os.ReadFile(infoPath)
	if err != nil {
		return "", fmt.Errorf("read info.json: %w", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", fmt.Errorf("parse info.json: %w", err)
	}

	subURL := findSubtitleURL(raw, lang)
	if subURL == "" {
		return "", fmt.Errorf("no subtitle URL for %q", lang)
	}

	resp, err := downloadWithTimeout(subURL, 30*time.Second)
	if err != nil {
		return "", fmt.Errorf("download subtitle: %w", err)
	}
	defer resp.Body.Close()

	f, err := os.Create(vttPath)
	if err != nil {
		return "", fmt.Errorf("create subtitle file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		os.Remove(vttPath)
		return "", fmt.Errorf("write subtitle file: %w", err)
	}

	return vttPath, nil
}

func findSubtitleURL(raw map[string]any, lang string) string {
	for _, key := range []string{"subtitles", "automatic_captions"} {
		if subs, ok := raw[key].(map[string]any); ok {
			if entries, ok := subs[lang].([]any); ok && len(entries) > 0 {
				if entry, ok := entries[0].(map[string]any); ok {
					if u, ok := entry["url"].(string); ok && u != "" {
						return u
					}
				}
			}
		}
	}
	return ""
}

func downloadWithTimeout(rawURL string, timeout time.Duration) (*http.Response, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest("GET", parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; MyTube/1.0)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	return resp, nil
}

var vttTimeRe = regexp.MustCompile(`^(\d{2,}):(\d{2}):(\d{2})[.,](\d{3})`)

func parseVTT(path string) ([]SubtitleCue, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// Try YouTube JSON format first (yt-dlp's srv3/srv2 formats)
	if cues, ok := tryParseYouTubeSubs(data); ok {
		return cues, nil
	}

	// Fall back to standard WebVTT parsing
	return parseWebVTT(data)
}

func tryParseYouTubeSubs(data []byte) ([]SubtitleCue, bool) {
	var raw struct {
		Events []struct {
			TStartMs float64 `json:"tStartMs"`
			DDuration float64 `json:"dDurationMs"`
			Segs     []struct {
				UTF8 string `json:"utf8"`
			} `json:"segs"`
		} `json:"events"`
	}
	if err := json.Unmarshal(data, &raw); err != nil || len(raw.Events) == 0 {
		return nil, false
	}

	var cues []SubtitleCue
	for _, ev := range raw.Events {
		var parts []string
		for _, seg := range ev.Segs {
			t := strings.TrimSpace(seg.UTF8)
			if t != "" {
				parts = append(parts, t)
			}
		}
		text := strings.Join(parts, " ")
		text = strings.ReplaceAll(text, "\n", " ")
		text = strings.TrimSpace(text)
		if text != "" && ev.DDuration > 0 {
			cues = append(cues, SubtitleCue{
				Start:    ev.TStartMs / 1000.0,
				Duration: ev.DDuration / 1000.0,
				Text:     text,
			})
		}
	}
	return cues, true
}

func parseWebVTT(data []byte) ([]SubtitleCue, error) {
	var cues []SubtitleCue
	scanner := bufio.NewScanner(strings.NewReader(string(data)))

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || line == "WEBVTT" || strings.HasPrefix(line, "Kind:") || strings.HasPrefix(line, "Language:") {
			continue
		}

		matches := vttTimeRe.FindAllStringSubmatch(line, -1)
		if len(matches) == 1 && len(matches[0]) == 4 {
			start := parseTimestamp(matches[0])
			var end float64
			remaining := line[len(matches[0][0]):]
			endMatches := vttTimeRe.FindAllStringSubmatch(remaining, -1)
			if len(endMatches) == 1 && len(endMatches[0]) == 4 {
				end = parseTimestamp(endMatches[0])
			}
			duration := end - start
			if duration < 0 {
				duration = 0
			}

			var textLines []string
			for scanner.Scan() {
				t := strings.TrimSpace(scanner.Text())
				if t == "" {
					break
				}
				if isCueIdentifier(t) {
					continue
				}
				textLines = append(textLines, t)
			}
			text := strings.Join(textLines, " ")
			text = stripVTTTags(text)
			text = strings.TrimSpace(text)
			if text != "" {
				cues = append(cues, SubtitleCue{Start: start, Duration: duration, Text: text})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return cues, nil
}

func parseTimestamp(matches []string) float64 {
	h, _ := strconv.Atoi(matches[1])
	m, _ := strconv.Atoi(matches[2])
	s, _ := strconv.Atoi(matches[3])
	ms, _ := strconv.Atoi(matches[4])
	return float64(h*3600+m*60+s) + float64(ms)/1000.0
}

func isCueIdentifier(s string) bool {
	n, err := strconv.Atoi(s)
	return err == nil && n > 0
}

var vttTagRe = regexp.MustCompile(`<[^>]+>`)

func stripVTTTags(s string) string {
	s = vttTagRe.ReplaceAllString(s, "")
	return strings.ReplaceAll(s, "&amp;", "&")
}
