#!/usr/bin/env bash
set -euo pipefail

HOST_NAME='com.sparksub.transcriber'
USER_HOME="${HOME:?HOME is required}"
APP_SUPPORT="$USER_HOME/Library/Application Support"
SPARKSUB_ROOT="$APP_SUPPORT/SparkSub"
extension_id=''
browser_set=0
remove_chrome=0
remove_chromium=0

fail() {
  printf 'SparkSub uninstaller: %s\n' "$*" >&2
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
      browser_set=1
      if [[ "$1" == '--chrome' ]]; then remove_chrome=1; else remove_chromium=1; fi
      shift
      ;;
    --help|-h)
      printf '%s\n' "Usage: $0 --extension-id <32-char-id> [--chrome] [--chromium]"
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ "$extension_id" =~ ^[a-p]{32}$ ]] || fail 'extension ID must be exactly 32 lowercase Chrome alphabet characters'
if ((browser_set == 0)); then remove_chrome=1; fi

manifest_dirs=()
if ((remove_chrome)); then manifest_dirs+=("$APP_SUPPORT/Google/Chrome/NativeMessagingHosts"); fi
if ((remove_chromium)); then manifest_dirs+=("$APP_SUPPORT/Chromium/NativeMessagingHosts"); fi

owned_paths=("$SPARKSUB_ROOT/SparkSubHost" "$SPARKSUB_ROOT/bin/yt-dlp_macos" "$SPARKSUB_ROOT/bin/yt-dlp_macos.version")
for manifest_dir in "${manifest_dirs[@]}"; do
  owned_paths+=("$manifest_dir/$HOST_NAME.json")
done

for path in "${owned_paths[@]}"; do
  case "$path" in
    "$APP_SUPPORT"/*) rm -f -- "$path" ;;
    *) fail "refusing unsafe path: $path" ;;
  esac
done

for manifest_dir in "${manifest_dirs[@]}"; do
  rmdir -- "$manifest_dir" 2>/dev/null || true
done
rmdir -- "$SPARKSUB_ROOT/bin" 2>/dev/null || true
rmdir -- "$SPARKSUB_ROOT" 2>/dev/null || true
printf 'Removed SparkSub native-host artifacts.\n'
