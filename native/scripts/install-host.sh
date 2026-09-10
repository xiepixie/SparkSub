#!/usr/bin/env bash
set -euo pipefail

HOST_NAME='com.sparksub.transcriber'
PROTOCOL_VERSION='2'
YTDLP_VERSION='2026.08.19'
YTDLP_ASSET_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"
YTDLP_SUMS_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS"
PINNED_YTDLP_SHA256='1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
USER_HOME="${HOME:?HOME is required}"
APP_SUPPORT="$USER_HOME/Library/Application Support"
SPARKSUB_ROOT="$APP_SUPPORT/SparkSub"
STANDALONE_HOST_DESTINATION="$SPARKSUB_ROOT/SparkSubHost"
SPARKSUB_BIN="$SPARKSUB_ROOT/bin"
YTDLP_DESTINATION="$SPARKSUB_BIN/yt-dlp_macos"
YTDLP_PAYLOAD="$SPARKSUB_BIN/yt-dlp_macos.zip"
YTDLP_VERSION_FILE="$SPARKSUB_BIN/yt-dlp_macos.version"
SPARKSCRIBE_APP="${SPARKSCRIBE_APP:-/Applications/SparkScribe.app}"
SPARKSCRIBE_HELPER="$SPARKSCRIBE_APP/Contents/Helpers/SparkSubNativeHost"

extension_id=''
browser='chrome'
browser_set=0
dry_run=0
skip_ytdlp=0
host_mode='auto'

usage() {
  printf '%s\n' "Usage: $0 --extension-id <32-char-id> [--chrome|--chromium] [--dry-run] [--skip-ytdlp] [--sparkscribe|--standalone]"
  printf '%s\n' '  default: prefer a ready SparkScribe helper, otherwise install/use the standalone compatibility host'
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
    --sparkscribe)
      [[ "$host_mode" == 'auto' ]] || fail 'host mode already specified'
      host_mode='sparkscribe'
      shift
      ;;
    --standalone)
      [[ "$host_mode" == 'auto' ]] || fail 'host mode already specified'
      host_mode='standalone'
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown option $1"
      ;;
  esac
done

[[ -n "$extension_id" ]] || fail '--extension-id is required'
# Chrome extension IDs use only the a-p alphabet because each hex nibble is
# encoded as one of those sixteen letters.
[[ "$extension_id" =~ ^[a-p]{32}$ ]] || fail '--extension-id must be exactly 32 lowercase Chrome ID letters (a-p)'

if [[ "$browser" == 'chrome' ]]; then
  MANIFEST_DIR="$APP_SUPPORT/Google/Chrome/NativeMessagingHosts"
else
  MANIFEST_DIR="$APP_SUPPORT/Chromium/NativeMessagingHosts"
fi
MANIFEST_PATH="$MANIFEST_DIR/${HOST_NAME}.json"
ALLOWED_ORIGIN="chrome-extension://${extension_id}/"

sparkscribe_candidate_exists() {
  [[ -x "$SPARKSCRIBE_HELPER" ]]
}

# This probe is owned by SparkScribe. SparkSub deliberately does not duplicate
# model-cache, inference or runtime-integrity policy. The helper returns zero
# only when the current v2 integration can cover local ASR + YouTube captions +
# YouTube/Bilibili media. It may locally adopt a verified legacy yt-dlp copy;
# it never downloads anything during the probe.
sparkscribe_ready() {
  sparkscribe_candidate_exists || return 1
  "$SPARKSCRIBE_HELPER" --browser-native-readiness >/dev/null 2>&1
}

if ((dry_run != 0)); then
  if [[ "$host_mode" == 'sparkscribe' ]] && ! sparkscribe_candidate_exists; then
    fail "SparkScribe helper not found at $SPARKSCRIBE_HELPER"
  fi
  printf 'Manifest: %s\n' "$MANIFEST_PATH"
  printf 'Protocol: %s\n' "$PROTOCOL_VERSION"
  printf 'Host mode: %s\n' "$host_mode"
  printf 'SparkScribe helper: %s\n' "$SPARKSCRIBE_HELPER"
  printf 'Standalone host: %s\n' "$STANDALONE_HOST_DESTINATION"
  if [[ "$host_mode" == 'standalone' ]] || ! sparkscribe_candidate_exists; then
    printf 'Host: %s\n' "$STANDALONE_HOST_DESTINATION"
  else
    printf '%s\n' 'Host: SparkScribe when its non-mutating capability/runtime checks pass at install time'
  fi
  printf 'Allowed origin: %s\n' "$ALLOWED_ORIGIN"
  printf 'yt-dlp asset: %s\n' "$YTDLP_ASSET_URL"
  printf 'yt-dlp sha256: %s\n' "$PINNED_YTDLP_SHA256"
  printf 'yt-dlp version sidecar: %s\n' "$YTDLP_VERSION_FILE"
  exit 0
fi

find_built_host() {
  for candidate in \
    "$REPO_ROOT/native/SparkSubHost/.build/release/sparksub-native-host" \
    "$REPO_ROOT/native/SparkSubHost/.build/arm64-apple-macosx/release/sparksub-native-host" \
    "$REPO_ROOT/native/SparkSubHost/.build/release/SparkSubHost" \
    "$REPO_ROOT/native/SparkSubHost/.build/arm64-apple-macosx/release/SparkSubHost" \
    "$REPO_ROOT/native/SparkSubHost/.build/apple/Products/Release/SparkSubHost"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

verify_ytdlp() {
  local actual_hash
  awk -v expected="$PINNED_YTDLP_SHA256" '
    $1 == expected && $2 == "yt-dlp" && NF == 2 { matches += 1 }
    END { exit(matches == 1 ? 0 : 1) }
  ' "$WORK_DIR/SHA2-256SUMS" || fail 'official SHA2-256SUMS does not contain exactly one pinned yt-dlp line'
  actual_hash="$(shasum -a 256 "$WORK_DIR/yt-dlp" | awk '{print $1}')"
  [[ "$actual_hash" == "$PINNED_YTDLP_SHA256" ]] || fail 'downloaded yt-dlp checksum does not match the pinned official hash'
}

install_standalone_compatibility_host() {
  local built_host
  built_host="$(find_built_host || true)"
  if [[ -z "$built_host" ]]; then
    swift build -c release --package-path "$REPO_ROOT/native/SparkSubHost"
    built_host="$(find_built_host || fail 'SparkSubHost executable not found; build failed')"
  fi

  mkdir -p "$SPARKSUB_ROOT" "$SPARKSUB_BIN"
  WORK_DIR="$(mktemp -d "$SPARKSUB_ROOT/.install.XXXXXX")"
  trap 'rm -rf -- "${WORK_DIR:-}"' EXIT

  install -m 755 "$built_host" "$WORK_DIR/SparkSubHost"
  mv -f "$WORK_DIR/SparkSubHost" "$STANDALONE_HOST_DESTINATION"

  if ((skip_ytdlp == 0)); then
    curl --fail --location --proto '=https' --tlsv1.2 --output "$WORK_DIR/yt-dlp" "$YTDLP_ASSET_URL"
    curl --fail --location --proto '=https' --tlsv1.2 --output "$WORK_DIR/SHA2-256SUMS" "$YTDLP_SUMS_URL"
    verify_ytdlp
    mv -f "$WORK_DIR/yt-dlp" "$YTDLP_PAYLOAD"
    cat << 'EOF' > "$WORK_DIR/yt-dlp_macos"
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
for py in /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.10 /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
  if [ -x "$py" ]; then
    ver=$("$py" -c 'import sys; print(sys.version_info >= (3, 10))' 2>/dev/null || true)
    if [ "$ver" = "True" ]; then
      exec "$py" "$DIR/yt-dlp_macos.zip" "$@"
    fi
  fi
done
exec python3 "$DIR/yt-dlp_macos.zip" "$@"
EOF
    chmod 755 "$WORK_DIR/yt-dlp_macos"
    mv -f "$WORK_DIR/yt-dlp_macos" "$YTDLP_DESTINATION"
    printf '%s\n' "$YTDLP_VERSION" > "$WORK_DIR/yt-dlp_macos.version"
    mv -f "$WORK_DIR/yt-dlp_macos.version" "$YTDLP_VERSION_FILE"
  fi
}

selected_host=''
selected_mode=''
case "$host_mode" in
  sparkscribe)
    sparkscribe_ready || fail 'SparkScribe browser integration is not fully ready; install the required model/runtime in SparkScribe Models & Runtime or use --standalone'
    selected_host="$SPARKSCRIBE_HELPER"
    selected_mode='SparkScribe'
    ;;
  standalone)
    install_standalone_compatibility_host
    selected_host="$STANDALONE_HOST_DESTINATION"
    selected_mode='standalone compatibility host'
    ;;
  auto)
    if sparkscribe_ready; then
      selected_host="$SPARKSCRIBE_HELPER"
      selected_mode='SparkScribe'
    else
      # Keep the old implementation as a fully working rollback path. On an
      # existing SparkScribe install this may also provide the verified legacy
      # yt-dlp payload that the next readiness probe can adopt locally.
      install_standalone_compatibility_host
      if sparkscribe_ready; then
        selected_host="$SPARKSCRIBE_HELPER"
        selected_mode='SparkScribe'
      else
        selected_host="$STANDALONE_HOST_DESTINATION"
        selected_mode='standalone compatibility host'
      fi
    fi
    ;;
  *) fail "invalid host mode: $host_mode" ;;
esac

mkdir -p "$MANIFEST_DIR"
manifest_temp="$(mktemp "$MANIFEST_DIR/.${HOST_NAME}.XXXXXX")"
cat > "$manifest_temp" <<EOF
{
  "name": "$HOST_NAME",
  "description": "SparkSub browser integration via $selected_mode",
  "path": "$selected_host",
  "type": "stdio",
  "allowed_origins": ["$ALLOWED_ORIGIN"]
}
EOF
mv -f "$manifest_temp" "$MANIFEST_PATH"
printf 'Installed %s for %s via %s.\n' "$HOST_NAME" "$browser" "$selected_mode"
