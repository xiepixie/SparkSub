#!/usr/bin/env bash
set -euo pipefail

HOST_NAME='com.sparksub.transcriber'
PROTOCOL_VERSION='1'
YTDLP_VERSION='2026.08.19'
YTDLP_ASSET_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"
YTDLP_SUMS_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS"
PINNED_YTDLP_SHA256='1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6'

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
  printf 'install-host error: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id)
      [[ $# -ge 2 ]] || fail '--extension-id requires a value'
      extension_id="$2"
      shift 2
      ;;
    --chrome)
      ((browser_set == 0)) || fail 'browser already specified'
      browser='chrome'
      browser_set=1
      shift
      ;;
    --chromium)
      ((browser_set == 0)) || fail 'browser already specified'
      browser='chromium'
      browser_set=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --skip-ytdlp)
      skip_ytdlp=1
      shift
      ;;
    *)
      fail "unknown option $1"
      ;;
  esac
done

[[ -n "$extension_id" ]] || fail '--extension-id is required'
[[ "$extension_id" =~ ^[a-z]{32}$ ]] || fail '--extension-id must be exactly 32 lowercase letters'

if [[ "$browser" == 'chrome' ]]; then
  MANIFEST_DIR="$APP_SUPPORT/Google/Chrome/NativeMessagingHosts"
else
  MANIFEST_DIR="$APP_SUPPORT/Chromium/NativeMessagingHosts"
fi
MANIFEST_FILE="$MANIFEST_DIR/${HOST_NAME}.json"

if ((dry_run != 0)); then
  printf 'Manifest: %s\n' "$MANIFEST_FILE"
  printf 'Host: %s\n' "$HOST_DESTINATION"
  printf 'Allowed origin: chrome-extension://%s/\n' "$extension_id"
  printf 'yt-dlp asset: %s\n' "$YTDLP_ASSET_URL"
  printf 'yt-dlp sha256: %s\n' "$PINNED_YTDLP_SHA256"
  printf 'yt-dlp version sidecar: %s\n' "$YTDLP_VERSION_FILE"
  exit 0
fi

BUILT_HOST="$REPO_ROOT/native/SparkSubHost/.build/apple/Products/Release/SparkSubHost"
[[ -x "$BUILT_HOST" ]] || BUILT_HOST="$REPO_ROOT/native/SparkSubHost/.build/release/SparkSubHost"
[[ -x "$BUILT_HOST" ]] || BUILT_HOST="$REPO_ROOT/native/SparkSubHost/.build/arm64-apple-macosx/release/SparkSubHost"
[[ -x "$BUILT_HOST" ]] || BUILT_HOST="$REPO_ROOT/native/SparkSubHost/.build/arm64-apple-macosx/debug/SparkSubHost"
[[ -x "$BUILT_HOST" ]] || fail 'SparkSubHost executable not found; build it with swift build -c release'

mkdir -p "$MANIFEST_DIR" "$SPARKSUB_ROOT" "$SPARKSUB_BIN"
WORK_DIR="$(mktemp -d "$SPARKSUB_ROOT/.install.XXXXXX")"
cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

install -m 755 "$BUILT_HOST" "$WORK_DIR/SparkSubHost"
mv -f "$WORK_DIR/SparkSubHost" "$HOST_DESTINATION"

verify_ytdlp() {
  local actual_hash
  awk -v expected="$PINNED_YTDLP_SHA256" '
    $1 == expected && $2 == "yt-dlp" && NF == 2 { matches += 1 }
    END { exit(matches == 1 ? 0 : 1) }
  ' "$WORK_DIR/SHA2-256SUMS" || fail 'official SHA2-256SUMS does not contain exactly one pinned yt-dlp line'
  actual_hash="$(shasum -a 256 "$WORK_DIR/yt-dlp" | awk '{print $1}')"
  [[ "$actual_hash" == "$PINNED_YTDLP_SHA256" ]] || fail 'downloaded yt-dlp checksum does not match the pinned official hash'
}

if ((skip_ytdlp == 0)); then
  curl --fail --location --proto '=https' --tlsv1.2 --output "$WORK_DIR/yt-dlp" "$YTDLP_ASSET_URL"
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
