#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT_DIR/native/scripts/install-host.sh"
UNINSTALLER="$ROOT_DIR/native/scripts/uninstall-host.sh"
EXTENSION_ID='abcdefghijklmnopabcdefghijklmnop'
PINNED_URL='https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp'
PINNED_SHA256='1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6'
TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sparksub-install-test.XXXXXX")"
FAKE_SPARKSCRIBE_APP="$TEST_HOME/Applications/SparkScribe.app"

cleanup() {
  case "$TEST_HOME" in
    /tmp/sparksub-install-test.*|"${TMPDIR:-/tmp}"/sparksub-install-test.*) rm -rf -- "$TEST_HOME" ;;
    *) echo "refusing unsafe test cleanup: $TEST_HOME" >&2; exit 1 ;;
  esac
}
trap cleanup EXIT

expect_fail() {
  if "$@" >/dev/null 2>&1; then
    echo "expected failure: $*" >&2
    exit 1
  fi
}

expect_fail "$INSTALLER" --dry-run
expect_fail "$INSTALLER" --extension-id 'ABC'
expect_fail "$INSTALLER" --extension-id 'qbcdefghijklmnopabcdefghijklmnop' --dry-run
expect_fail "$INSTALLER" --extension-id "$EXTENSION_ID" --chrome --chromium --dry-run
expect_fail "$INSTALLER" --extension-id "$EXTENSION_ID" --unknown-option

before_dry_run="$(find "$TEST_HOME" -mindepth 1 -print -quit)"
chrome_output="$(HOME="$TEST_HOME" SPARKSCRIBE_APP="$FAKE_SPARKSCRIBE_APP" "$INSTALLER" --extension-id "$EXTENSION_ID" --chrome --dry-run)"
[[ -z "$before_dry_run" ]]
[[ -z "$(find "$TEST_HOME" -mindepth 1 -print -quit)" ]]
grep -F "Manifest: $TEST_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sparksub.transcriber.json" <<<"$chrome_output"
grep -F "Host: $TEST_HOME/Library/Application Support/SparkSub/SparkSubHost" <<<"$chrome_output"
grep -F "Allowed origin: chrome-extension://$EXTENSION_ID/" <<<"$chrome_output"
grep -F "yt-dlp asset: $PINNED_URL" <<<"$chrome_output"
grep -F "yt-dlp sha256: $PINNED_SHA256" <<<"$chrome_output"
grep -F "yt-dlp version sidecar: $TEST_HOME/Library/Application Support/SparkSub/bin/yt-dlp_macos.version" <<<"$chrome_output"

chromium_output="$(HOME="$TEST_HOME" SPARKSCRIBE_APP="$FAKE_SPARKSCRIBE_APP" "$INSTALLER" --extension-id "$EXTENSION_ID" --chromium --dry-run --skip-ytdlp)"
grep -F "Manifest: $TEST_HOME/Library/Application Support/Chromium/NativeMessagingHosts/com.sparksub.transcriber.json" <<<"$chromium_output"
grep -F "Allowed origin: chrome-extension://$EXTENSION_ID/" <<<"$chromium_output"

# A ready SparkScribe helper wins in default auto mode. Dry-run must not invoke
# the readiness command because the real helper may locally adopt a legacy
# runtime as part of that probe.
POSITIVE_HOME="$TEST_HOME/positive-home"
POSITIVE_APP="$TEST_HOME/positive-app/SparkScribe.app"
POSITIVE_HELPER="$POSITIVE_APP/Contents/Helpers/SparkSubNativeHost"
PROBE_MARKER="$TEST_HOME/readiness-probed"
mkdir -p "$(dirname "$POSITIVE_HELPER")"
cat > "$POSITIVE_HELPER" <<EOF
#!/bin/sh
if [ "\${1:-}" = "--browser-native-readiness" ]; then
  : > "$PROBE_MARKER"
  exit 0
fi
exit 2
EOF
chmod 755 "$POSITIVE_HELPER"
HOME="$POSITIVE_HOME" SPARKSCRIBE_APP="$POSITIVE_APP" "$INSTALLER" --extension-id "$EXTENSION_ID" --chrome --dry-run >/dev/null
[[ ! -e "$PROBE_MARKER" ]]
HOME="$POSITIVE_HOME" SPARKSCRIBE_APP="$POSITIVE_APP" "$INSTALLER" --extension-id "$EXTENSION_ID" --chrome >/dev/null
[[ -e "$PROBE_MARKER" ]]
POSITIVE_MANIFEST="$POSITIVE_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sparksub.transcriber.json"
grep -F "\"path\": \"$POSITIVE_HELPER\"" "$POSITIVE_MANIFEST" >/dev/null
[[ ! -e "$POSITIVE_HOME/Library/Application Support/SparkSub/SparkSubHost" ]]
expect_fail env HOME="$POSITIVE_HOME" SPARKSCRIBE_APP="$TEST_HOME/missing/SparkScribe.app" "$INSTALLER" --extension-id "$EXTENSION_ID" --chrome --sparkscribe

SPARKSUB_ROOT="$TEST_HOME/Library/Application Support/SparkSub"
CHROME_MANIFEST="$TEST_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sparksub.transcriber.json"
CHROMIUM_MANIFEST="$TEST_HOME/Library/Application Support/Chromium/NativeMessagingHosts/com.sparksub.transcriber.json"
mkdir -p "$(dirname "$CHROME_MANIFEST")" "$(dirname "$CHROMIUM_MANIFEST")" "$SPARKSUB_ROOT/Models" "$SPARKSUB_ROOT/Sibling"
printf '%s\n' '{"name":"com.sparksub.transcriber"}' > "$CHROME_MANIFEST"
printf '%s\n' '{"name":"com.sparksub.transcriber"}' > "$CHROMIUM_MANIFEST"
printf 'host\n' > "$SPARKSUB_ROOT/SparkSubHost"
mkdir -p "$SPARKSUB_ROOT/bin"
printf 'ytdlp\n' > "$SPARKSUB_ROOT/bin/yt-dlp_macos"
printf 'payload\n' > "$SPARKSUB_ROOT/bin/yt-dlp_macos.zip"
printf '2026.08.19\n' > "$SPARKSUB_ROOT/bin/yt-dlp_macos.version"
printf 'model\n' > "$SPARKSUB_ROOT/Models/keep-model"
printf 'sibling\n' > "$SPARKSUB_ROOT/Sibling/keep-sibling"

HOME="$TEST_HOME" "$UNINSTALLER" --extension-id "$EXTENSION_ID" --chrome --chromium
[[ ! -e "$CHROME_MANIFEST" && ! -e "$CHROMIUM_MANIFEST" ]]
[[ ! -e "$SPARKSUB_ROOT/SparkSubHost" && ! -e "$SPARKSUB_ROOT/bin/yt-dlp_macos" && ! -e "$SPARKSUB_ROOT/bin/yt-dlp_macos.zip" && ! -e "$SPARKSUB_ROOT/bin/yt-dlp_macos.version" ]]
[[ -f "$SPARKSUB_ROOT/Models/keep-model" && -f "$SPARKSUB_ROOT/Sibling/keep-sibling" ]]

checksum_line="$(grep -n '^PINNED_YTDLP_SHA256=' "$INSTALLER" | head -n 1 | cut -d: -f1)"
verify_line="$(grep -n '^[[:space:]]*verify_ytdlp$' "$INSTALLER" | head -n 1 | cut -d: -f1)"
payload_commit_line="$(grep -n 'mv -f.*YTDLP_PAYLOAD' "$INSTALLER" | head -n 1 | cut -d: -f1)"
version_line="$(grep -n 'mv -f.*YTDLP_VERSION_FILE' "$INSTALLER" | head -n 1 | cut -d: -f1)"
[[ -n "$checksum_line" && -n "$verify_line" && -n "$payload_commit_line" && -n "$version_line" ]]
[[ "$verify_line" -lt "$payload_commit_line" && "$payload_commit_line" -lt "$version_line" ]]
grep -F 'NF == 2' "$INSTALLER" >/dev/null
! grep -Eq 'rm[[:space:]]+-rf.*(Application Support|SPARKSUB_ROOT|APP_SUPPORT)' "$UNINSTALLER"

echo '✅ Native host installer tests passed'
