package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	deviceauthPkg "github.com/newcl/mytube/backend/internal/deviceauth"
)

const (
	pairingTTL         = 5 * time.Minute
	maxPairingBodySize = 4096
)

func (h *Handler) PostMobilePairing(w http.ResponseWriter, r *http.Request) {
	if h.DeviceAuth == nil {
		http.Error(w, "device authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	pairing, err := h.DeviceAuth.CreatePairing(r.Context(), pairingTTL)
	if err != nil {
		http.Error(w, "could not create pairing", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, pairing)
}

func (h *Handler) PostMobilePairingExchange(w http.ResponseWriter, r *http.Request) {
	if h.DeviceAuth == nil {
		http.Error(w, "device authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Code       string `json:"code"`
		DeviceName string `json:"device_name"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxPairingBodySize+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil || body.Code == "" {
		http.Error(w, "invalid pairing request", http.StatusBadRequest)
		return
	}
	token, device, err := h.DeviceAuth.ExchangePairing(r.Context(), body.Code, body.DeviceName)
	if errors.Is(err, deviceauthPkg.ErrInvalidPairing) {
		http.Error(w, "invalid or expired pairing", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "could not exchange pairing", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token":  token,
		"device": device,
	})
}

func (h *Handler) GetMobileDevices(w http.ResponseWriter, r *http.Request) {
	if h.DeviceAuth == nil {
		http.Error(w, "device authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	devices, err := h.DeviceAuth.ListDevices(r.Context())
	if err != nil {
		http.Error(w, "could not list devices", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, devices)
}

func (h *Handler) DeleteMobileDevice(w http.ResponseWriter, r *http.Request) {
	if h.DeviceAuth == nil {
		http.Error(w, "device authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "invalid device id", http.StatusBadRequest)
		return
	}
	err := h.DeviceAuth.RevokeDevice(r.Context(), id)
	if errors.Is(err, deviceauthPkg.ErrDeviceNotFound) {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "could not revoke device", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
