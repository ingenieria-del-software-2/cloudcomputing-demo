package httperr

import (
	"encoding/json"
	"net/http"
)

type Problem struct {
	Status    int    `json:"status"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
}

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}

func ProblemJSON(w http.ResponseWriter, status int, code, message, requestID string) {
	JSON(w, status, Problem{
		Status:    status,
		Code:      code,
		Message:   message,
		RequestID: requestID,
	})
}
