#!/usr/bin/env bash
# ==============================================================================
# SparkSub (闪幕) 一键极速配置脚本 (Lazy Setup Script)
# ==============================================================================
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_FILE="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sparksub.transcriber.json"

echo -e "${BOLD}${BLUE}======================================================${NC}"
echo -e "${BOLD}${BLUE}   ✨ SparkSub (闪幕) 本机服务一键配置向导${NC}"
echo -e "${BOLD}${BLUE}======================================================${NC}\n"

# 1. 系统与硬件架构检查
echo -e "${BOLD}[1/4] 正在检测系统环境...${NC}"
OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" != "Darwin" ]]; then
  echo -e "${YELLOW}提示: SparkSub 浏览器扩展（实时字幕、多P批量收割、AI总结、订阅追踪等）全平台即用！${NC}"
  echo -e "${YELLOW}但当前本机 CoreML 离线 ASR 语音识别服务仅支持 macOS (Apple Silicon)。${NC}"
  echo -e "您可以在 Chrome 中打开 chrome://extensions 直接加载本项目体验在线字幕功能。\n"
  exit 0
fi

if [[ "$ARCH" != "arm64" ]]; then
  echo -e "${RED}错误: 本机转录服务基于 CoreML Neural Engine 深度优化，要求 Apple Silicon (M1/M2/M3/M4等) 芯片。${NC}\n"
  exit 1
fi

if ! command -v swift >/dev/null 2>&1; then
  echo -e "${RED}错误: 未检测到 Swift 编译环境。请在终端执行 'xcode-select --install' 安装命令行开发者工具。${NC}\n"
  exit 1
fi

echo -e "  ${GREEN}✔ macOS 系统与 Apple Silicon 架构验证通过${NC}"
echo -e "  ${GREEN}✔ Swift 开发编译环境已就绪${NC}\n"

# 2. 读取或引导输入 Chrome 扩展 ID
echo -e "${BOLD}[2/4] 获取 SparkSub 扩展 ID...${NC}"

DEFAULT_ID=""
if [[ -f "$MANIFEST_FILE" ]]; then
  EXISTING_ORIGIN=$(grep -o 'chrome-extension://[a-z]\{32\}/' "$MANIFEST_FILE" 2>/dev/null || true)
  if [[ -n "$EXISTING_ORIGIN" ]]; then
    DEFAULT_ID=$(echo "$EXISTING_ORIGIN" | sed -E 's|chrome-extension://([a-z]{32})/|\1|')
  fi
fi

CLI_ID=""
BROWSER="chrome"
NON_INTERACTIVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id|--extension-id|-i)
      CLI_ID="$2"
      shift 2
      ;;
    --chromium)
      BROWSER="chromium"
      shift
      ;;
    --yes|-y)
      NON_INTERACTIVE=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

TARGET_ID=""
if [[ -n "$CLI_ID" ]]; then
  TARGET_ID="$CLI_ID"
elif [[ $NON_INTERACTIVE -eq 1 && -n "$DEFAULT_ID" ]]; then
  TARGET_ID="$DEFAULT_ID"
else
  echo -e "请先确保已在 Chrome 中加载了本扩展："
  echo -e "  1. 打开 Chrome 地址栏访问：${BOLD}chrome://extensions${NC}"
  echo -e "  2. 开启右上角${BOLD}「开发者模式」${NC}"
  echo -e "  3. 点击左上角${BOLD}「加载已解压的扩展程序」${NC}，选择当前项目目录："
  echo -e "     ${BLUE}${SCRIPT_DIR}${NC}"
  echo -e "  4. 在页面找到 SparkSub 卡片，复制它的 32 位「ID」"
  echo ""

  PROMPT_TEXT="请输入 32 位扩展 ID"
  if [[ -n "$DEFAULT_ID" ]]; then
    PROMPT_TEXT+=" [回车默认: ${DEFAULT_ID}]"
  fi
  PROMPT_TEXT+=": "

  read -r -p "$(echo -e "${BOLD}${YELLOW}${PROMPT_TEXT}${NC}")" INPUT_ID
  TARGET_ID="${INPUT_ID:-$DEFAULT_ID}"
fi

# 清理用户可能意外复制到的前后空白、引号或 chrome-extension:// 前缀
TARGET_ID="$(echo "$TARGET_ID" | tr '[:upper:]' '[:lower:]' | sed -E 's|chrome-extension://||g' | tr -d ' /"\t\r\n')"

if [[ ! "$TARGET_ID" =~ ^[a-z]{32}$ ]]; then
  echo -e "${RED}错误: 扩展 ID 必须是严格的 32 位字母（例如: oadpbmafdiifomohcfgpampelgioagp）。${NC}"
  echo -e "请检查后重新运行 ./setup.sh\n"
  exit 1
fi

echo -e "  ${GREEN}✔ 锁定目标扩展 ID: ${TARGET_ID}${NC}\n"

# 3. 执行安装
echo -e "${BOLD}[3/4] 正在编译安装本机服务并绑定浏览器通道...${NC}"
INSTALL_SCRIPT="$SCRIPT_DIR/native/scripts/install-host.sh"
if [[ ! -x "$INSTALL_SCRIPT" ]]; then
  chmod +x "$INSTALL_SCRIPT"
fi

if [[ "$BROWSER" == "chromium" ]]; then
  "$INSTALL_SCRIPT" --extension-id "$TARGET_ID" --chromium
else
  "$INSTALL_SCRIPT" --extension-id "$TARGET_ID" --chrome
fi

# 4. 执行状态自检诊断
echo -e "\n${BOLD}[4/4] 正在运行就绪自检...${NC}"
HOST_BIN="$HOME/Library/Application Support/SparkSub/SparkSubHost"

if [[ -x "$HOST_BIN" ]]; then
  "$HOST_BIN" --diagnose 2>&1 | while read -r line; do
    echo -e "  ${line}"
  done
else
  echo -e "  ${YELLOW}本机可执行文件已安装，正在等待首次浏览器消息唤醒。${NC}"
fi

echo -e "\n${BOLD}${GREEN}======================================================${NC}"
echo -e "${BOLD}${GREEN}   🎉 恭喜！SparkSub 本机离线服务已配置成功！${NC}"
echo -e "${BOLD}${GREEN}======================================================${NC}"
echo -e "  1. 浏览器与本机安全通讯通道已就绪；"
echo -e "  2. 离线 yt-dlp 抓取引擎已就绪；"
echo -e "  3. CoreML 端侧离线 ASR 语音模型已就绪。"
echo -e "\n现在打开任意 Bilibili 或 YouTube 视频，即可开始畅享极速字幕体验！\n"
