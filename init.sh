#!/bin/bash
# init.sh — 从模板初始化新的 agentic 项目
# 用法：bash init.sh <项目名> <项目描述>
#
# 例：bash init.sh my-app "一个帮助用户管理任务的 Web 应用"

set -eo pipefail

PROJECT_NAME="${1:-my-project}"
PROJECT_DESC="${2:-A new project}"
TARGET_DIR="${3:-.}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[init]${NC} $1"; }
warn() { echo -e "${YELLOW}[init]${NC} $1"; }

TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"

log "初始化项目：$PROJECT_NAME"
log "目标目录：$TARGET_DIR"

# 创建目录结构
mkdir -p "$TARGET_DIR"/{.agent/{experiments,knowledge,inbox},.claude}

# 复制并替换模板文件
replace_vars() {
  sed \
    -e "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" \
    -e "s/{{项目描述}}/$PROJECT_DESC/g" \
    "$1" > "$2"
}

replace_vars "$TEMPLATE_DIR/.agent/program.md"    "$TARGET_DIR/.agent/program.md"
replace_vars "$TEMPLATE_DIR/.agent/decisions.md"  "$TARGET_DIR/.agent/decisions.md"
replace_vars "$TEMPLATE_DIR/CLAUDE.md"            "$TARGET_DIR/CLAUDE.md"

# 直接复制不需要替换的文件
cp "$TEMPLATE_DIR/.agent/tasks.json"  "$TARGET_DIR/.agent/tasks.json"
cp "$TEMPLATE_DIR/.agent/state.json"  "$TARGET_DIR/.agent/state.json"
cp "$TEMPLATE_DIR/tick.sh"            "$TARGET_DIR/tick.sh"
cp "$TEMPLATE_DIR/evolve.sh"          "$TARGET_DIR/evolve.sh"

# agent prompts — 替换项目名
for agent in pm coder validator research evolution; do
  replace_vars \
    "$TEMPLATE_DIR/.claude/${agent}-agent.md" \
    "$TARGET_DIR/.claude/${agent}-agent.md"
done

chmod +x "$TARGET_DIR/tick.sh" "$TARGET_DIR/evolve.sh"

# 初始化 git
if [ ! -d "$TARGET_DIR/.git" ]; then
  cd "$TARGET_DIR"
  git init -q
  cat > .gitignore << 'EOF'
.agent/experiments/
.agent/knowledge/
.agent/inbox/
.agent/state.json
node_modules/
dist/
EOF
  git add .
  git commit -q -m "init: $PROJECT_NAME agentic scaffold"
  log "git 初始化完成"
fi

echo ""
log "✅ 项目初始化完成！"
echo ""
echo "  下一步："
echo "  1. 编辑 $TARGET_DIR/.agent/program.md，填写项目目标和约束"
echo "  2. 编辑 $TARGET_DIR/.agent/tasks.json，填写具体任务"
echo "  3. 运行 bash $TARGET_DIR/tick.sh"
echo ""
