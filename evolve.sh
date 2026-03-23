#!/bin/bash
# evolve.sh — 直接进入功能进化模式
# MVP 已完成后使用：bash evolve.sh
# 在 .agent/program.md 追加 "- [ ] 你的想法" 触发实现

set -eo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$PROJECT_DIR/.agent"
STATE="$AGENT_DIR/state.json"
TASKS="$AGENT_DIR/tasks.json"
INBOX="$AGENT_DIR/inbox/needs-you.md"
CLAUDE_DIR="$PROJECT_DIR/.claude"
KNOWLEDGE_DIR="$AGENT_DIR/knowledge"
EXP_DIR="$AGENT_DIR/experiments"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
log()      { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn()     { echo -e "${YELLOW}[$(date '+%H:%M:%S')]${NC} $1"; }
err()      { echo -e "${RED}[$(date '+%H:%M:%S')]${NC} $1"; }
info()     { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
research() { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }

# ── 工具函数（与 tick.sh 保持一致）────────────────────────
py_state_get() {
  python3 -c "
import json
try:
    d = json.load(open('$STATE'))
    v = d.get('$1', '')
    print('' if v is None else v)
except: print('')
" 2>/dev/null || echo ""
}

py_state_set() {
  local key="$1" val="$2"
  python3 -c "
import json
with open('$STATE') as f: d = json.load(f)
d['$key'] = $val
with open('$STATE', 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
" 2>/dev/null || true
}

py_state_inc() {
  python3 -c "
import json
with open('$STATE') as f: d = json.load(f)
d['$1'] = d.get('$1', 0) + 1
with open('$STATE', 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
" 2>/dev/null || true
}

next_evo_task() {
  python3 -c "
import json
with open('$TASKS') as f: data = json.load(f)
tasks = data['tasks']
done_ids = {t['id'] for t in tasks if t['status'] == 'done'}
changed = False
for t in tasks:
    if t['status'] == 'blocked' and t['id'].startswith('evo_'):
        if all(d in done_ids for d in t.get('depends_on', [])):
            t['status'] = 'pending'
            changed = True
if changed:
    with open('$TASKS', 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
for t in tasks:
    if t['status'] == 'pending' and t['id'].startswith('evo_'):
        print(t['id'])
        break
" 2>/dev/null || echo ""
}

task_field() {
  python3 -c "
import json
for t in json.load(open('$TASKS'))['tasks']:
    if t['id'] == '$1':
        print(t.get('$2', ''))
        break
" 2>/dev/null || echo ""
}

mark_done() {
  python3 -c "
import json
with open('$TASKS') as f: d = json.load(f)
for t in d['tasks']:
    if t['id'] == '$1': t['status'] = 'done'
with open('$TASKS', 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
" 2>/dev/null || true
}

run_acceptance() {
  local cmd
  cmd=$(task_field "$1" "acceptance_cmd")
  [ -z "$cmd" ] && echo "PASS" && return 0
  cd "$PROJECT_DIR"
  local result
  result=$(bash -c "$cmd" 2>&1) || true
  echo "$result"
  echo "$result" | grep -q "^PASS" && return 0 || return 1
}

notify() {
  command -v osascript &>/dev/null && \
    osascript -e "display notification \"$1\" with title \"Browser Agent\"" 2>/dev/null || true
  warn "━━━ $1 ━━━"
}


check_evolution_goals() {
  PMFILE="$AGENT_DIR/program.md" python3 -c "
import re, os
try:
    text = open(os.environ[chr(80)+chr(77)+chr(70)+chr(73)+chr(76)+chr(69)]).read()
    text = re.sub(chr(60)+chr(33)+chr(45)+chr(45)+chr(46)+chr(42)+chr(63)+chr(45)+chr(45)+chr(62), chr(32), text, flags=re.DOTALL)
    pending = [l for l in text.split('\n') if l.strip().startswith('- [ ]')]
    print(len(pending))
except: print(0)
" 2>/dev/null || echo "0"
}

run_evolution_agent() {
  log "🌱 Evolution Agent 启动，分析新功能目标..."
  cd "$PROJECT_DIR"
  local out
  out=$(claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/evolution-agent.md")" \
    "读取 .agent/program.md 的功能进化区，处理第一个 - [ ] 待处理功能（注意跳过 HTML 注释块中的内容）。
先检查现有代码结构，再 research 行业最佳实践（如需要），然后拆解成任务追加到 tasks.json，
更新 program.md 状态为 [~]。
注意：最后一行必须严格输出：EVOLUTION_RESULT: <任务ID列表> | <功能名>" 2>&1) || true

  local result_line
  result_line=$(echo "$out" | grep "^EVOLUTION_RESULT:" | tail -1)
  if [ -n "$result_line" ]; then
    log "🌱 $result_line"
    return 0
  else
    warn "⚠️ Evolution Agent 未输出结果"
    return 1
  fi
}

run_research_agent() {
  local tid="$1" fail_file="$2"
  research "🔬 Research Agent（$tid）..."
  cd "$PROJECT_DIR"
  local out
  out=$(claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/research-agent.md")" \
    "分析失败，找解法写入 knowledge/fix_${tid}_<描述>.md

任务：$(task_field "$tid" "title")
失败记录：$(cat "$fail_file" 2>/dev/null | head -30)

最后一行输出：RESEARCH_RESULT: <文件路径> | <一句话结论>" 2>&1) || true

  local result_line
  result_line=$(echo "$out" | grep "^RESEARCH_RESULT:" | tail -1)
  [ -n "$result_line" ] && research "📚 $result_line" || true
}

run_coder_agent() {
  local tid="$1" retry="$2"
  log "⚙️  Coder Agent（$tid，第 $((retry+1)) 次）..."

  local fix_knowledge=""
  local fail_ctx=""
  local fix_files
  fix_files=$(ls "$KNOWLEDGE_DIR"/fix_${tid}_*.md 2>/dev/null || true)
  [ -n "$fix_files" ] && fix_knowledge="【解法参考】\n$(cat $fix_files)\n"

  local fail_files
  fail_files=$(ls "$EXP_DIR"/exp_${tid}_fail_*.md 2>/dev/null || true)
  [ -n "$fail_files" ] && fail_ctx="【历史失败】\n$(tail -20 $(echo $fail_files | tr ' ' '\n' | tail -1))\n"

  cd "$PROJECT_DIR"
  claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/coder-agent.md")" \
    "执行 ${tid}（第$((retry+1))次）。任务：$(task_field "$tid" "title")。

${fix_knowledge}${fail_ctx}
完成后最后一行输出：CODER_RESULT: SUBMIT|score=XX|描述 或 CODER_RESULT: SELF_REJECT|score=XX|原因" \
    || true
}

run_validator_agent() {
  local tid="$1"
  log "🔍 Validator Agent（$tid）..."
  cd "$PROJECT_DIR"
  claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/validator-agent.md")" \
    "验收 ${tid}。验收命令：$(task_field "$tid" "acceptance_cmd")
最后一行输出 'VALIDATION_RESULT: PASS' 或 'VALIDATION_RESULT: FAIL: 原因'。
更新 .agent/state.json 的 last_validation 字段。" \
    || true
}

mark_program_done() {
  local goal_text="$1"
  python3 -c "
with open('$AGENT_DIR/program.md') as f: content = f.read()
lines = content.split('\n')
for i, line in enumerate(lines):
    if '[~]' in line and '$goal_text'[:15] in line:
        lines[i] = line.replace('[~]', '[x]')
        break
with open('$AGENT_DIR/program.md', 'w') as f:
    f.write('\n'.join(lines))
" 2>/dev/null || true
}

# ── 执行单个进化任务（Karpathy Loop）──────────────────────
run_evo_task() {
  local tid="$1"
  local retry
  retry=$(py_state_get "retry_count")
  [ -z "$retry" ] || [ "$retry" = "None" ] && retry=0

  if [ "$retry" -ge 3 ]; then
    warn "$tid 失败 3 次，需要你介入"
    printf "## %s 进化任务失败\n\n处理完删除本文件后重跑 bash evolve.sh\n" "$tid" > "$INBOX"
    notify "⚠️ $tid 失败 3 次"
    exit 0
  fi

  # Coder 执行
  local coder_out score_line score
  coder_out=$(run_coder_agent "$tid" "$retry" 2>&1) || true
  score_line=$(echo "$coder_out" | grep "^CODER_RESULT:" | tail -1)
  score=$(echo "$score_line" | grep -o 'score=[0-9]*' | cut -d= -f2)
  score=${score:-0}
  info "   Coder 自评：${score}/100"

  if echo "$score_line" | grep -q "SELF_REJECT"; then
    warn "❌ Coder 自拒（${score}分）"
    local fail_log="$EXP_DIR/exp_${tid}_fail_$((retry+1)).md"
    printf "## %s Coder 自拒\n自评：%s\n\n%s\n" "$tid" "$score" "$coder_out" > "$fail_log"
    run_research_agent "$tid" "$fail_log"
    py_state_inc "retry_count"
    return 1
  fi

  if run_acceptance "$tid"; then
    local val_out
    val_out=$(run_validator_agent "$tid" 2>&1) || true
    if echo "$val_out" | grep -q "VALIDATION_RESULT: PASS"; then
      cd "$PROJECT_DIR"
      git add -A 2>/dev/null || true
      local goal_text
      goal_text=$(task_field "$tid" "evolution_goal")
      git commit -m "evo($tid): $(task_field "$tid" "title") [score=$score]" 2>/dev/null || true
      mark_done "$tid"
      mark_program_done "$goal_text"
      py_state_set "retry_count" "0"
      log "✅ $tid 完成 [score=$score]"
      notify "✅ 新功能完成：$goal_text"
      return 0
    else
      warn "❌ Validator 拒绝"
      cd "$PROJECT_DIR" && git checkout -- . 2>/dev/null || true
      local fail_log="$EXP_DIR/exp_${tid}_fail_$((retry+1)).md"
      printf "## %s Validator 拒\n\n%s\n" "$tid" "$val_out" > "$fail_log"
      run_research_agent "$tid" "$fail_log"
      py_state_inc "retry_count"
      return 1
    fi
  else
    warn "❌ 命令验收失败"
    cd "$PROJECT_DIR" && git checkout -- . 2>/dev/null || true
    local fail_log="$EXP_DIR/exp_${tid}_fail_$((retry+1)).md"
    printf "## %s 验收失败\n" "$tid" > "$fail_log"
    run_research_agent "$tid" "$fail_log"
    py_state_inc "retry_count"
    return 1
  fi
}

# ════════════════════════════════════════════════════════════
# 主逻辑
# ════════════════════════════════════════════════════════════
main() {
  command -v claude &>/dev/null || { err "未找到 claude"; exit 1; }
  command -v python3 &>/dev/null || { err "需要 python3"; exit 1; }

  log "🌱 Browser Agent — 功能进化模式"
  log "项目：$PROJECT_DIR"
  log ""
  log "追加新功能：编辑 .agent/program.md"
  log "格式：- [ ] 你的功能想法（可以模糊）"
  log "停止：Ctrl+C"
  log ""

  local evo_loop=0

  while true; do
    evo_loop=$((evo_loop + 1))

    # 检查用户介入
    if [ -f "$INBOX" ] && [ -s "$INBOX" ]; then
      notify "⚠️ 需要你介入"
      warn "查看：cat .agent/inbox/needs-you.md"
      warn "处理完：rm .agent/inbox/needs-you.md && bash evolve.sh"
      exit 0
    fi

    # 先看有没有进行中的进化任务
    current_evo=$(next_evo_task)

    if [ -n "$current_evo" ]; then
      info "── Evo Loop $evo_loop | 执行 $current_evo ──"
      run_evo_task "$current_evo"
      sleep 2
      continue
    fi

    # 没有进行中任务，检查 program.md 有没有新目标
    pending=$(check_evolution_goals)

    if [ "$pending" -gt 0 ]; then
      info "── Evo Loop $evo_loop | 发现 $pending 个新功能目标 ──"
      py_state_set "retry_count" "0"
      if run_evolution_agent; then
        log "任务已拆解，开始执行..."
      fi
      sleep 2
    else
      log "💤 等待新功能目标... (60秒检查一次)"
      log "   编辑：.agent/program.md"
      log "   追加：- [ ] 你的想法"
      sleep 60
    fi

  done
}

trap 'echo ""; warn "进化模式已停止（Ctrl+C）"; exit 0' INT
main
