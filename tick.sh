#!/bin/bash
# tick.sh — Browser Agent v3
# 新增：失败自动触发 Research Agent、量化分数、知识积累
# 用法：bash tick.sh

set -eo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$PROJECT_DIR/.agent"
STATE="$AGENT_DIR/state.json"
TASKS="$AGENT_DIR/tasks.json"
INBOX="$AGENT_DIR/inbox/needs-you.md"
DONE_FILE="$AGENT_DIR/inbox/done.md"
CLAUDE_DIR="$PROJECT_DIR/.claude"
KNOWLEDGE_DIR="$AGENT_DIR/knowledge"
EXP_DIR="$AGENT_DIR/experiments"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
log()      { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn()     { echo -e "${YELLOW}[$(date '+%H:%M:%S')]${NC} $1"; }
err()      { echo -e "${RED}[$(date '+%H:%M:%S')]${NC} $1"; }
info()     { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
research() { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }

# ── JSON 操作 ────────────────────────────────────────────────
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

next_pending_task() {
  python3 -c "
import json
with open('$TASKS') as f:
    data = json.load(f)
tasks = data['tasks']
done_ids = {t['id'] for t in tasks if t['status'] == 'done'}
changed = False
for t in tasks:
    if t['status'] == 'blocked':
        if all(d in done_ids for d in t.get('depends_on', [])):
            t['status'] = 'pending'
            changed = True
if changed:
    with open('$TASKS', 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
for t in tasks:
    if t['status'] == 'pending':
        print(t['id'])
        break
" 2>/dev/null || echo ""
}

task_field() {
  local tid="$1" field="$2"
  python3 -c "
import json
for t in json.load(open('$TASKS'))['tasks']:
    if t['id'] == '$tid':
        print(t.get('$field', ''))
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
  local tid="$1"
  local cmd
  cmd=$(task_field "$tid" "acceptance_cmd")
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

# ── Agent 启动函数 ────────────────────────────────────────────

run_pm_agent() {
  log "🧠 PM Agent 启动..."
  cd "$PROJECT_DIR"
  claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/pm-agent.md")" \
    "执行 task_000：技术调研。完成后更新 tasks.json（task_000 status=done）和 state.json（pm_done=true）。" \
    || true
}

run_coder_agent() {
  local tid="$1"
  local retry="$2"
  local attempt=$((retry + 1))
  log "⚙️  Coder Agent（$tid，第 ${attempt} 次）..."

  # 收集历史上下文
  local history_ctx=""
  local fix_knowledge=""

  # 找失败记录
  local fail_files
  fail_files=$(ls "$EXP_DIR"/exp_${tid}_fail_*.md 2>/dev/null || true)
  if [ -n "$fail_files" ]; then
    history_ctx="【历史失败记录】\n"
    for f in $fail_files; do
      history_ctx="${history_ctx}$(cat "$f")\n---\n"
    done
  fi

  # 找 Research Agent 专门准备的解法
  local fix_files
  fix_files=$(ls "$KNOWLEDGE_DIR"/fix_${tid}_*.md 2>/dev/null || true)
  if [ -n "$fix_files" ]; then
    fix_knowledge="【Research Agent 为本任务准备的解法，必须参考】\n"
    for f in $fix_files; do
      fix_knowledge="${fix_knowledge}$(cat "$f")\n---\n"
    done
  fi

  cd "$PROJECT_DIR"
  claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/coder-agent.md")" \
    "执行 ${tid}（第${attempt}次）。任务：$(task_field "$tid" "title")。

${fix_knowledge}
${history_ctx}

完成后：
1. 把量化分数写入 .agent/state.json 的 last_score 字段
2. 最后一行输出 CODER_RESULT: SUBMIT|score=XX|描述 或 CODER_RESULT: SELF_REJECT|score=XX|原因" \
    || true
}

# ── 核心新机制：失败触发 Research Agent ─────────────────────
run_research_agent() {
  local tid="$1"
  local fail_file="$2"
  research "🔬 Research Agent 启动（分析 $tid 失败原因）..."

  cd "$PROJECT_DIR"
  local output
  output=$(claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/research-agent.md")" \
    "分析以下失败记录，找到解法并写入 knowledge/ 目录。

任务ID：$tid
任务描述：$(task_field "$tid" "title")
验收标准：$(task_field "$tid" "acceptance")

失败记录：
$(cat "$fail_file" 2>/dev/null || echo '无失败记录，首次失败')

请搜索解法，写入 knowledge/fix_${tid}_<描述>.md
最后一行输出：RESEARCH_RESULT: <文件路径> | <一句话结论>" 2>&1) || true

  # 提取 research 结论
  local result_line
  result_line=$(echo "$output" | grep "^RESEARCH_RESULT:" | tail -1)
  if [ -n "$result_line" ]; then
    research "📚 $result_line"
    # 记录到 state
    py_state_set "last_research" "\"$result_line\""
  else
    research "⚠️ Research Agent 未输出结论，继续重试"
  fi
}

run_validator_agent() {
  local tid="$1"
  log "🔍 Validator Agent（$tid）..."
  cd "$PROJECT_DIR"
  claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/validator-agent.md")" \
    "验收 ${tid}。
验收命令：$(task_field "$tid" "acceptance_cmd")
最后一行输出 'VALIDATION_RESULT: PASS' 或 'VALIDATION_RESULT: FAIL: 原因'。
更新 .agent/state.json 的 last_validation 字段。" \
    || true
}

# ── 分数趋势判断 ─────────────────────────────────────────────
get_score_trend() {
  local tid="$1"
  # 从实验记录里提取历史分数
  python3 -c "
import os, re
exp_dir = '$EXP_DIR'
scores = []
for f in sorted(os.listdir(exp_dir)):
    if f.startswith('exp_${tid}') and f.endswith('.md'):
        content = open(os.path.join(exp_dir, f)).read()
        m = re.search(r'自评分[：:]\s*(\d+)', content)
        if m: scores.append(int(m.group(1)))
print(','.join(map(str, scores)) if scores else 'no_data')
" 2>/dev/null || echo "no_data"
}

check_env() {
  command -v claude &>/dev/null || { err "未找到 claude"; exit 1; }
  command -v python3 &>/dev/null || { err "需要 python3"; exit 1; }
  [ ! -d "$PROJECT_DIR/.git" ] && \
    cd "$PROJECT_DIR" && git init -q && \
    git add . 2>/dev/null && git commit -q -m "init" 2>/dev/null || true
}

# ════════════════════════════════════════════════════════════
# 主循环
# ════════════════════════════════════════════════════════════
main() {
  check_env
  log "🚀 Browser Agent v3 | autoresearch 版"
  log "项目：$PROJECT_DIR"
  log "停止：Ctrl+C"
  echo ""

  local loop=0

  while true; do
    loop=$((loop + 1))
    python3 -c "
import json, datetime
with open('$STATE') as f: d = json.load(f)
d['loop_count'] = $loop
d['last_tick'] = datetime.datetime.utcnow().isoformat() + 'Z'
with open('$STATE', 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
" 2>/dev/null || true

    # 检查用户介入
    if [ -f "$INBOX" ] && [ -s "$INBOX" ]; then
      notify "⚠️ 需要你介入"
      warn "查看：cat .agent/inbox/needs-you.md"
      warn "处理完：rm .agent/inbox/needs-you.md && bash tick.sh"
      exit 0
    fi

    # 检查完成
    if [ -f "$DONE_FILE" ]; then
      notify "🎉 Browser Agent MVP 完成！"
      cat "$DONE_FILE"
      exit 0
    fi

    # 找下一个任务
    current_task=$(next_pending_task)
    if [ -z "$current_task" ]; then
      if [ ! -f "$DONE_FILE" ]; then
        printf "## Browser Agent MVP 完成\nTime: %s\n" "$(date)" > "$DONE_FILE"
        notify "🎉 MVP 完成！进入进化模式"
      fi
      evolution_loop
      exit 0
    fi

    ttype=$(task_field "$current_task" "type")
    retry=$(py_state_get "retry_count")
    [ -z "$retry" ] || [ "$retry" = "None" ] && retry=0

    info "── Loop $loop | $current_task ($ttype) | retry=$retry ──"

    # 分数趋势
    trend=$(get_score_trend "$current_task")
    [ "$trend" != "no_data" ] && info "   分数趋势：[$trend]"

    # 超重试上限
    if [ "$retry" -ge 3 ]; then
      warn "$current_task 连续失败 3 次，需要你介入"
      printf "## %s 需要你的决策\n\n失败次数：%s\n分数趋势：%s\n实验记录：.agent/experiments/\n\n处理完删除本文件后重跑 tick.sh\n" \
        "$current_task" "$retry" "$trend" > "$INBOX"
      notify "⚠️ $current_task 失败 3 次"
      exit 0
    fi

    case "$ttype" in

      # ── PM Research ──────────────────────────────────────
      pm_research)
        run_pm_agent
        if run_acceptance "$current_task"; then
          log "✅ PM research 通过"
          mark_done "$current_task"
          py_state_set "retry_count" "0"
          py_state_set "phase" '"coding"'
          py_state_set "pm_done" "True"
        else
          warn "❌ PM research 验收失败"
          # PM 失败也触发 research（搜索如何做好技术调研）
          fail_log="$EXP_DIR/exp_${current_task}_fail_${retry}.md"
          printf "## %s 失败\nPM research 验收未通过\n" "$current_task" > "$fail_log"
          run_research_agent "$current_task" "$fail_log"
          py_state_inc "retry_count"
        fi
        ;;

      # ── Coding ───────────────────────────────────────────
      coding)
        # 启动 Coder Agent
        coder_out=$(run_coder_agent "$current_task" "$retry" 2>&1) || true

        # 读取 Coder 自评分
        score_line=$(echo "$coder_out" | grep "^CODER_RESULT:" | tail -1)
        score=0
        if [ -n "$score_line" ]; then
          score=$(echo "$score_line" | grep -o 'score=[0-9]*' | cut -d= -f2)
          score=${score:-0}
          info "   Coder 自评：${score}/100"
          py_state_set "last_score" "$score"
        fi

        # Coder 自我拒绝
        if echo "$score_line" | grep -q "SELF_REJECT"; then
          warn "❌ Coder 自评 ${score}分，自我拒绝提交"
          fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
          printf "## %s Coder 自拒（第%s次）\n\n自评分：%s\n\n%s\n" \
            "$current_task" "$((retry+1))" "$score" "$coder_out" > "$fail_log"
          # ★ 失败触发 Research Agent
          research "触发 autoresearch 机制..."
          run_research_agent "$current_task" "$fail_log"
          py_state_inc "retry_count"
          sleep 2
          continue
        fi

        # 运行验收命令
        if run_acceptance "$current_task"; then
          log "✅ 命令验收通过（Coder 自评 ${score}分），Validator 复核..."
          val_out=$(run_validator_agent "$current_task" 2>&1) || true

          if echo "$val_out" | grep -q "VALIDATION_RESULT: PASS"; then
            log "✅ $current_task 全部通过，git commit"
            cd "$PROJECT_DIR"
            git add -A 2>/dev/null || true
            git commit -m "feat($current_task): $(task_field "$current_task" "title") [score=$score]" \
              2>/dev/null || true
            mark_done "$current_task"
            py_state_set "retry_count" "0"
            py_state_set "last_score" "$score"
            log "📈 已提交，分数趋势：[$trend → $score]"
          else
            warn "❌ Validator 拒绝，revert"
            cd "$PROJECT_DIR" && git checkout -- . 2>/dev/null || true
            fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
            printf "## %s Validator 拒绝（第%s次）\n\n自评：%s\nValidator：\n%s\n" \
              "$current_task" "$((retry+1))" "$score" "$val_out" > "$fail_log"
            # ★ 失败触发 Research Agent
            research "Validator 拒绝，触发 autoresearch..."
            run_research_agent "$current_task" "$fail_log"
            py_state_inc "retry_count"
          fi
        else
          warn "❌ 命令验收失败（Coder 自评 ${score}分），revert"
          cd "$PROJECT_DIR" && git checkout -- . 2>/dev/null || true
          fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
          printf "## %s 命令验收失败（第%s次）\n\n自评：%s\n" \
            "$current_task" "$((retry+1))" "$score" > "$fail_log"
          # ★ 失败触发 Research Agent
          research "命令验收失败，触发 autoresearch..."
          run_research_agent "$current_task" "$fail_log"
          py_state_inc "retry_count"
        fi
        ;;

      # ── 最终验收 ─────────────────────────────────────────
      validate)
        run_validator_agent "$current_task" || true
        if run_acceptance "$current_task"; then
          log "🎉 最终验收通过"
          mark_done "$current_task"
          printf "## Browser Agent MVP 完成\n\n时间：%s\nLoop 总数：%s\nknowledge 文件数：%s\nexperiments 数：%s\n" \
            "$(date)" "$loop" \
            "$(ls "$KNOWLEDGE_DIR" 2>/dev/null | wc -l)" \
            "$(ls "$EXP_DIR" 2>/dev/null | wc -l)" \
            > "$DONE_FILE"
        else
          warn "❌ 最终验收失败"
          fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
          printf "## 最终验收失败（第%s次）\n" "$((retry+1))" > "$fail_log"
          run_research_agent "$current_task" "$fail_log"
          py_state_inc "retry_count"
        fi
        ;;

      *)
        warn "未知任务类型：$ttype，跳过"
        mark_done "$current_task"
        ;;
    esac

    sleep 2
  done
}

trap 'echo ""; warn "调度器已停止（Ctrl+C）"; exit 0' INT
main

# ════════════════════════════════════════════════════════════
# Evolution Loop（MVP 完成后自动进入）
# ════════════════════════════════════════════════════════════

check_evolution_goals() {
  # 返回 program.md 里待处理的功能数量
  python3 -c "
import re
try:
    content = open('$AGENT_DIR/program.md').read()
    pending = re.findall(r'- \[ \]', content)
    print(len(pending))
except: print(0)
" 2>/dev/null || echo "0"
}

mark_evolution_done() {
  local goal_id="$1"
  # 把 tasks.json 里对应 evolution_goal 的任务标记完成时
  # 同时把 program.md 里的 [~] 改为 [x]
  python3 -c "
import json, re
# 找到这个任务的 evolution_goal
with open('$TASKS') as f: data = json.load(f)
goal_text = ''
for t in data['tasks']:
    if t['id'] == '$goal_id':
        goal_text = t.get('evolution_goal', '')
        break
if not goal_text: exit()
# 更新 program.md
with open('$AGENT_DIR/program.md') as f: content = f.read()
# 找到包含这段文字的 [~] 行，改为 [x]
lines = content.split('\n')
for i, line in enumerate(lines):
    if '[~]' in line and goal_text[:20] in line:
        lines[i] = line.replace('[~]', '[x]')
        break
with open('$AGENT_DIR/program.md', 'w') as f:
    f.write('\n'.join(lines))
" 2>/dev/null || true
}

run_evolution_agent() {
  log "🌱 Evolution Agent 启动..."
  cd "$PROJECT_DIR"
  local out
  out=$(claude -p --dangerously-skip-permissions \
    --system-prompt "$(cat "$CLAUDE_DIR/evolution-agent.md")" \
    "读取 .agent/program.md 的功能进化区，处理第一个待处理（- [ ]）功能。
按规范拆解任务追加到 tasks.json，更新 program.md 状态。
最后一行输出 EVOLUTION_RESULT: <任务ID列表> | <功能名>" 2>&1) || true

  local result_line
  result_line=$(echo "$out" | grep "^EVOLUTION_RESULT:" | tail -1)
  if [ -n "$result_line" ]; then
    log "🌱 $result_line"
    return 0
  else
    warn "Evolution Agent 未输出结果"
    return 1
  fi
}

evolution_loop() {
  log ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "🎉 MVP 完成，进入功能进化模式"
  log "在 .agent/program.md 的「待实现功能」下追加想法"
  log "格式：- [ ] 你的功能描述（可以模糊）"
  log "保存后系统自动检测并开始实现"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""

  local evo_loop=0

  while true; do
    evo_loop=$((evo_loop + 1))

    # 检查用户介入
    if [ -f "$INBOX" ] && [ -s "$INBOX" ]; then
      notify "⚠️ 需要你介入"
      warn "查看：cat .agent/inbox/needs-you.md"
      warn "处理完：rm .agent/inbox/needs-you.md && bash tick.sh"
      exit 0
    fi

    # 检查有没有待处理的进化目标
    pending=$(check_evolution_goals)

    if [ "$pending" -gt 0 ]; then
      info "── Evolution Loop $evo_loop | 发现 $pending 个待处理功能 ──"

      # 启动 Evolution Agent 拆解任务
      if run_evolution_agent; then
        # 拆解成功，继续正常的 Karpathy Loop 执行新任务
        log "开始执行进化任务..."

        # 重置 retry_count
        py_state_set "retry_count" "0"

        # 用主循环逻辑执行新任务（复用已有机制）
        while true; do
          current_task=$(next_pending_task)
          [ -z "$current_task" ] && break

          # 只执行 evo_ 开头的任务
          if ! echo "$current_task" | grep -q "^evo_"; then
            break
          fi

          ttype=$(task_field "$current_task" "type")
          retry=$(py_state_get "retry_count")
          [ -z "$retry" ] || [ "$retry" = "None" ] && retry=0

          info "── Evo | $current_task ($ttype) | retry=$retry ──"

          if [ "$retry" -ge 3 ]; then
            warn "$current_task 失败 3 次，需要你介入"
            printf "## %s 进化任务需要决策\n\n失败次数：%s\n\n处理完删除本文件后重跑 tick.sh\n" \
              "$current_task" "$retry" > "$INBOX"
            notify "⚠️ 进化任务 $current_task 失败 3 次"
            exit 0
          fi

          # 复用相同的 coding 执行逻辑
          case "$ttype" in
            coding)
              coder_out=$(run_coder_agent "$current_task" "$retry" 2>&1) || true
              score_line=$(echo "$coder_out" | grep "^CODER_RESULT:" | tail -1)
              score=$(echo "$score_line" | grep -o 'score=[0-9]*' | cut -d= -f2)
              score=${score:-0}

              if echo "$score_line" | grep -q "SELF_REJECT"; then
                warn "❌ Coder 自拒（$score 分）"
                fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
                printf "## %s 失败\n\n%s\n" "$current_task" "$coder_out" > "$fail_log"
                run_research_agent "$current_task" "$fail_log"
                py_state_inc "retry_count"
              elif run_acceptance "$current_task"; then
                val_out=$(run_validator_agent "$current_task" 2>&1) || true
                if echo "$val_out" | grep -q "VALIDATION_RESULT: PASS"; then
                  cd "$PROJECT_DIR"
                  git add -A 2>/dev/null || true
                  git commit -m "evo($current_task): $(task_field "$current_task" "title") [score=$score]" \
                    2>/dev/null || true
                  mark_done "$current_task"
                  mark_evolution_done "$current_task"
                  py_state_set "retry_count" "0"
                  log "✅ 进化任务 $current_task 完成 [score=$score]"
                  notify "✅ 新功能完成：$(task_field "$current_task" "evolution_goal")"
                else
                  warn "❌ Validator 拒绝"
                  cd "$PROJECT_DIR" && git checkout -- . 2>/dev/null || true
                  fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
                  printf "## %s Validator 拒绝\n\n%s\n" "$current_task" "$val_out" > "$fail_log"
                  run_research_agent "$current_task" "$fail_log"
                  py_state_inc "retry_count"
                fi
              else
                warn "❌ 命令验收失败"
                cd "$PROJECT_DIR" && git checkout -- . 2>/dev/null || true
                fail_log="$EXP_DIR/exp_${current_task}_fail_$((retry+1)).md"
                printf "## %s 验收失败\n" "$current_task" > "$fail_log"
                run_research_agent "$current_task" "$fail_log"
                py_state_inc "retry_count"
              fi
              ;;
          esac
          sleep 2
        done
      fi

    else
      # 没有待处理目标，等待用户追加
      log "💤 等待新功能目标... (每60秒检查一次 program.md)"
      log "   追加方式：在 .agent/program.md 的「待实现功能」下加一行"
      log "   格式：- [ ] 你的想法"
      sleep 60
    fi

  done
}
