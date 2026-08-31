#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[test-ark-key] %s\n' "$*" >&2
}

if [[ -z "${ARK_API_KEY:-}" || -z "${ARK_MODEL:-}" ]]; then
  log "ARK_API_KEY and ARK_MODEL are required."
  log "Example: ARK_API_KEY=key ARK_MODEL=ep-id-or-model-name ./scripts/test-ark-key.sh"
  log "Optional: ARK_BASE_URL (default: https://ark.ap-southeast.bytepluses.com/api/v3)"
  exit 2
fi

base_url="${ARK_BASE_URL:-https://ark.ap-southeast.bytepluses.com/api/v3}"
prompt="${1:-Reply with the single word: pong}"

command -v curl >/dev/null 2>&1 || {
  log "curl is required."
  exit 2
}

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

log "Calling $base_url/responses with model=$ARK_MODEL"

http_code="$(curl -s -o "$response_file" -w '%{http_code}' \
  --location "$base_url/responses" \
  --header "Authorization: Bearer $ARK_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "$(python3 -c '
import json, sys
model, prompt = sys.argv[1], sys.argv[2]
print(json.dumps({
    "model": model,
    "stream": False,
    "input": [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": prompt}],
        }
    ],
}))
' "$ARK_MODEL" "$prompt")")"

log "HTTP status: $http_code"

if [[ "$http_code" == "200" ]]; then
  log "Success. Model output:"
  python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for item in data.get("output", []):
    if item.get("type") == "message":
        for part in item.get("content", []):
            if part.get("type") == "output_text":
                print(part["text"])
' "$response_file" || cat "$response_file"
  exit 0
else
  log "Failed. Response body:"
  cat "$response_file" >&2
  exit 1
fi
