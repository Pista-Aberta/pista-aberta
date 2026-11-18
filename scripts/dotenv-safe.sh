#!/usr/bin/env bash
# Minimal strict dotenv reader/writer for install.sh. It never evaluates values.
set -euo pipefail

trim_left() {
  local value="$1"
  while [[ "$value" == [[:space:]]* ]]; do value="${value:1}"; done
  printf '%s' "$value"
}

trim_right() {
  local value="$1"
  while [[ "$value" == *[[:space:]] ]]; do value="${value:0:${#value}-1}"; done
  printf '%s' "$value"
}

decode_quoted() {
  local raw="$1" quote="$2" out="" escaped=0 char rest i
  for ((i = 1; i < ${#raw}; i++)); do
    char="${raw:i:1}"
    if (( escaped )); then
      case "$quote:$char" in
        \':\'|\':\\|\":\\|\":\") out+="$char" ;;
        \":n) out+=$'\n' ;;
        \":r) out+=$'\r' ;;
        \":t) out+=$'\t' ;;
        *) out+="\\$char" ;;
      esac
      escaped=0
    elif [[ "$char" == '\' ]]; then
      escaped=1
    elif [[ "$quote" == '"' && "$char" == '$' && "${raw:i+1:1}" == '$' ]]; then
      out+='$'
      ((i++))
    elif [[ "$char" == "$quote" ]]; then
      rest="$(trim_left "${raw:i+1}")"
      [[ -z "$rest" || "$rest" == \#* ]] || return 2
      printf '%s' "$out"
      return 0
    else
      out+="$char"
    fi
  done
  return 2
}

decode_value() {
  local raw
  raw="$(trim_left "$1")"
  case "${raw:0:1}" in
    "'") decode_quoted "$raw" "'" ;;
    '"') decode_quoted "$raw" '"' ;;
    *)
      # In an unquoted dotenv value, a whitespace-prefixed # starts a comment.
      if [[ "$raw" =~ ^(.*[^[:space:]])[[:space:]]+#.*$ ]]; then
        raw="${BASH_REMATCH[1]}"
      fi
      trim_right "$raw"
      ;;
  esac
}

dotenv_get() {
  local file="$1" wanted="$2" line key raw
  [[ "$wanted" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 2
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      raw="${BASH_REMATCH[2]}"
      if [[ "$key" == "$wanted" ]]; then
        decode_value "$raw"
        return
      fi
    fi
  done < "$file"
}

encode_value() {
  local value="$1"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    echo "dotenv values cannot contain newlines" >&2
    return 2
  }
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\$\$}"
  printf '"%s"' "$value"
}

dotenv_set() {
  local file="$1" wanted="$2" value="$3" encoded tmp line key found=0
  [[ "$wanted" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 2
  encoded="$(encode_value "$value")"
  mkdir -p "$(dirname "$file")"
  tmp="$(mktemp "${file}.tmp.XXXXXX")"
  if [[ -f "$file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
        key="${BASH_REMATCH[1]}"
        if [[ "$key" == "$wanted" ]]; then
          if (( ! found )); then printf '%s=%s\n' "$wanted" "$encoded" >> "$tmp"; fi
          found=1
          continue
        fi
      fi
      printf '%s\n' "$line" >> "$tmp"
    done < "$file"
  fi
  if (( ! found )); then printf '%s=%s\n' "$wanted" "$encoded" >> "$tmp"; fi
  mv "$tmp" "$file"
}

case "${1:-}" in
  get)
    [[ $# -eq 3 ]] || exit 2
    dotenv_get "$2" "$3"
    ;;
  set)
    [[ $# -eq 4 ]] || exit 2
    dotenv_set "$2" "$3" "$4"
    ;;
  *)
    echo "usage: $0 get FILE KEY | set FILE KEY VALUE" >&2
    exit 2
    ;;
esac
