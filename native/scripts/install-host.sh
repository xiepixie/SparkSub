#!/usr/bin/env bash
set -euo pipefail

HOST_NAME='com.sparksub.transcriber'
PROTOCOL_VERSION='1'
YTDLP_VERSION='2026.08.19'
YTDLP_ASSET_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_macos"
YTDLP_SUMS_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS"
PINNED_YTDLP_SHA256='0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
USER_HOME="${HOME:?HOME is required}"
APP_SUPPORT="$USER_HOME/Library/Application Support"
SPARKSUB_ROOT="$APP_SUPPORT/SparkSub"
HOST_DESTINATION="$SPARKSUB_ROOT/SparkSubHost"
SPARKSUB_BIN="$SPARKSUB_ROOT/bin"
YTDLP_DESTINATION="$SPARKSUB_BIN/yt-dlp_macos"
YTDLP_VERSION_FILE="$SPARKSUB_BIN/yt-dlp_macos.version"

extension_id=''
browser='chrome'
browser_set=0
dry_run=0
skip_ytdlp=0

usage() {
  printf '%s\n' "Usage: $0 --extension-id <32-char-id> [--chrome|--chromium] [--dry-run] [--skip-ytdlp]"
}

fail() {
  printf 'SparkSub installer: %s\n' "$*" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --extension-id)
      (($# >= 2)) || fail '--extension-id requires a value'
      extension_id="$2"
      shift 2
      ;;
    --chrome|--chromium)
      ((browser_set == 0)) || fail 'choose only one browser selector'
      browser="${1#--}"
      browser_set=1
      shift
      ;;
    --dry-run) dry_run=1; shift ;;
    --skip-ytdlp) skip_ytdlp=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ "$extension_id" =~ ^[a-p]{32}$ ]] || fail 'extension ID must be exactly 32 lowercase Chrome alphabet characters'

if [[ "$browser" == 'chrome' ]]; then
  MANIFEST_DIR="$APP_SUPPORT/Google/Chrome/NativeMessagingHosts"
else
  MANIFEST_DIR="$APP_SUPPORT/Chromium/NativeMessagingHosts"
fi
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"
ALLOWED_ORIGIN="chrome-extension://${extension_id}/"

print_plan() {
  printf 'Native host: %s (protocol v%s)\n' "$HOST_NAME" "$PROTOCOL_VERSION"
  printf 'Manifest: %s\n' "$MANIFEST_PATH"
  printf 'Host: %s\n' "$HOST_DESTINATION"
  printf 'Allowed origin: %s\n' "$ALLOWED_ORIGIN"
  printf 'yt-dlp asset: %s\n' "$YTDLP_ASSET_URL"
  printf 'yt-dlp sha256: %s\n' "$PINNED_YTDLP_SHA256"
  printf 'yt-dlp version sidecar: %s\n' "$YTDLP_VERSION_FILE"
  printf 'Actions: build release host, install SparkSub-owned files atomically%s, write one-origin manifest\n' "$([[ "$skip_ytdlp" == 1 ]] && printf '; skip yt-dlp' || true)"
}

if ((dry_run)); then
  print_plan
  exit 0
fi

[[ "$(uname -s)" == 'Darwin' ]] || fail 'macOS 14+ on Apple Silicon is required'
[[ "$(uname -m)" == 'arm64' ]] || fail 'Apple Silicon is required'
macos_major="$(sw_vers -productVersion | awk -F. '{print $1}')"
[[ "$macos_major" =~ ^[0-9]+$ && "$macos_major" -ge 14 ]] || fail 'macOS 14+ is required'

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sparksub-host-install.XXXXXX")"
cleanup() {
  case "$WORK_DIR" in
    /tmp/sparksub-host-install.*|"${TMPDIR:-/tmp}"/sparksub-host-install.*) rm -rf -- "$WORK_DIR" ;;
    *) printf 'refusing unsafe installer cleanup: %s\n' "$WORK_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$SPARKSUB_ROOT" "$SPARKSUB_BIN" "$MANIFEST_DIR"
swift build -c release --package-path "$REPO_ROOT/native/SparkSubHost"
BUILT_HOST="$REPO_ROOT/native/SparkSubHost/.build/release/sparksub-native-host"
[[ -f "$BUILT_HOST" ]] || fail 'release host binary was not produced'
install -m 755 "$BUILT_HOST" "$WORK_DIR/SparkSubHost"
mv -f "$WORK_DIR/SparkSubHost" "$HOST_DESTINATION"

verify_ytdlp() {
  local actual_hash
  awk -v expected="$PINNED_YTDLP_SHA256" '
    $1 == expected && $2 == "yt-dlp_macos" && NF == 2 { matches += 1 }
    END { exit(matches == 1 ? 0 : 1) }
  ' "$WORK_DIR/SHA2-256SUMS" || fail 'official SHA2-256SUMS does not contain exactly one pinned yt-dlp_macos line'
  actual_hash="$(shasum -a 256 "$WORK_DIR/yt-dlp_macos" | awk '{print $1}')"
  [[ "$actual_hash" == "$PINNED_YTDLP_SHA256" ]] || fail 'downloaded yt-dlp_macos checksum does not match the pinned official hash'
}

if ((skip_ytdlp == 0)); then
  curl --fail --location --proto '=https' --tlsv1.2 --output "$WORK_DIR/yt-dlp_macos" "$YTDLP_ASSET_URL"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$WORK_DIR/SHA2-256SUMS" "$YTDLP_SUMS_URL"
  verify_ytdlp
  chmod 755 "$WORK_DIR/yt-dlp_macos"
  mv -f "$WORK_DIR/yt-dlp_macos" "$YTDLP_DESTINATION"
  printf '%s\n' "$YTDLP_VERSION" > "$WORK_DIR/yt-dlp_macos.version"
  mv -f "$WORK_DIR/yt-dlp_macos.version" "$YTDLP_VERSION_FILE"
fi

manifest_temp="$(mktemp "$MANIFEST_DIR/.${HOST_NAME}.XXXXXX")"
cat > "$manifest_temp" <<EOF
{
  "name": "$HOST_NAME",
  "description": "SparkSub native transcription host",
  "path": "$HOST_DESTINATION",
  "type": "stdio",
  "allowed_origins": ["$ALLOWED_ORIGIN"]
}
EOF
mv -f "$manifest_temp" "$MANIFEST_PATH"
printf 'Installed %s for %s.\n' "$HOST_NAME" "$browser"
