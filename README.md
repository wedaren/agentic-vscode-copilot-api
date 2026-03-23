# Agentic Project Template

基于 Karpathy autoresearch 理念的 AI 自主开发模板。

**核心思想：你只写想法，系统自动 research → 实现 → 验收 → 进化。**

---

## 快速开始

### 方式一：VS Code Copilot（推荐）

在 VS Code Chat 中直接运行，无需 Claude CLI：

```
# 1. 初始化新项目（在 Chat 中输入）
/init my-app "一个帮助用户管理任务的 Web 应用"

# 2. 填写需求
编辑 .agent/program.md — 写目标、约束、停止条件

# 3. 启动
/tick          # 全自动跑到 MVP
/evolve        # MVP 完成后持续进化
```

> 提示词文件位于 `.github/prompts/`，自动出现在 Chat 的 `/` 命令列表中。

### 方式二：Claude CLI（备选）

```bash
# 1. 初始化新项目
bash init.sh my-app "一个帮助用户管理任务的 Web 应用"
cd my-app

# 2. 填写需求
edit .agent/program.md   # 写目标、约束、停止条件

# 3. 启动
bash tick.sh             # 全自动跑到 MVP
bash evolve.sh           # MVP 完成后持续进化
```

---

## 文件结构

```
.github/
  agents/
    pm.agent.md          PM Agent（调研+决策）
    coder.agent.md       Coder Agent（写代码）
    validator.agent.md   Validator Agent（验收）
    research.agent.md    Research Agent（搜索解法）
    evolution.agent.md   Evolution Agent（拆解功能）
  prompts/
    tick.prompt.md       /tick   调度器（MVP 阶段）
    evolve.prompt.md     /evolve 调度器（进化阶段）
    init.prompt.md       /init   项目初始化

.agent/                  文件系统消息总线（运行时生成）
  program.md             唯一需求基准（你来写）
  tasks.json             任务队列
  state.json             全局状态
  decisions.md           PM 决策日志
  knowledge/             research 知识库
  experiments/           迭代历史
  inbox/                 需要介入时才有文件
```

---

## 模板文件说明

### 你需要填写的（2 个文件）

| 文件 | 填什么 |
|---|---|
| `.agent/program.md` | 项目目标、约束、MVP 停止条件 |
| `.agent/tasks.json` | 具体任务列表（task_001 开始） |

task_000（技术调研）已经预置，不需要你填。

### 系统自动维护的

```
.agent/state.json      运行状态
.agent/decisions.md    PM 的技术决策
.agent/knowledge/      research 积累的知识
.agent/experiments/    每次迭代记录
.agent/inbox/          需要你介入时才有文件
```

---

## 系统架构

```
你
 ↕ 只写 program.md
调度层（tick.sh / evolve.sh）
 ↕ while true + 状态路由
Agent 层（5 个独立 session）
 ├── PM Agent      research + 决策
 ├── Coder Agent   写代码 + 自评分
 ├── Validator     多维度验收
 ├── Research      失败时自动搜索解法   ← autoresearch 核心
 └── Evolution     模糊想法 → 可执行任务
 ↕
Karpathy Loop
 假设 → 执行 → 评估（量化分数）→ commit or revert
 ↕
文件系统（.agent/ 作为消息总线）
```

---

## Karpathy Loop 原理

每个任务都在此循环内运行：

```
读历史记录 + knowledge
  ↓
形成假设（与上次有什么不同）
  ↓
写代码
  ↓
自评分（0-100，低于60自动拒绝）
  ↓
运行 acceptance_cmd
  ↓
pass → git commit
fail → revert → Research Agent 搜索解法 → 重试
  ↓
3次失败 → 通知你介入
```

**关键：失败不是终点，而是触发 research 的信号。系统越跑越聪明。**

---

## tasks.json 编写指南

```json
{
  "id": "task_001",
  "type": "coding",
  "title": "简短的任务描述",
  "status": "blocked",
  "depends_on": ["task_000"],
  "acceptance": "人类可读的验收标准",
  "acceptance_cmd": "bash -c '...命令... && echo PASS || echo FAIL: 原因'"
}
```

**acceptance_cmd 关键规则：**
- 必须能在 shell 中直接执行
- 成功时必须输出以 `PASS` 开头的内容
- 失败时输出 `FAIL: 原因`

**常用验收命令模式：**

```bash
# 文件存在
test -f src/index.ts && echo PASS || echo 'FAIL: 文件不存在'

# 编译通过
npm run build 2>&1 | grep -c error | xargs test 0 -eq && echo PASS || echo 'FAIL: 编译错误'

# 代码包含关键字
grep -r 'functionName' src/ > /dev/null && echo PASS || echo 'FAIL: 函数未实现'

# 多条件组合
test -f src/api.ts && grep -r 'export' src/api.ts > /dev/null && echo PASS || echo 'FAIL: API 模块不完整'
```

---

## 进化功能

MVP 完成后，在 `.agent/program.md` 末尾追加：

```markdown
- [ ] 你的功能想法（可以很模糊）
- [ ] 另一个想法
```

然后在 VS Code Chat 输入 `/evolve`（或运行 `bash evolve.sh`），系统自动：
1. 读取想法
2. Research 行业最佳实践
3. 拆解成具体任务
4. Karpathy Loop 实现
5. 完成后通知你，更新为 `[x]`

---

## 需要你介入的唯一情况

某任务连续失败 3 次，系统写入 `.agent/inbox/needs-you.md`。

**VS Code Copilot：**
```
查看 .agent/inbox/needs-you.md 文件
处理完后删除该文件，再重新运行 /tick 或 /evolve
```

**Claude CLI：**
```bash
cat .agent/inbox/needs-you.md
# 处理完后
rm .agent/inbox/needs-you.md
bash tick.sh  # 或 evolve.sh
```

---

## 适用场景

✅ 适合：
- 技术选型明确或可以调研的项目
- 能写出可执行验收命令的功能
- 模块相对独立、可以串行推进的项目

⚠️ 不适合：
- 需要实时人机交互决策的创意类工作
- 验收标准完全主观（"做得好看"）
- 强依赖外部实时数据的任务

---

## 已知局限

| 局限 | 说明 |
|---|---|
| 验收自写自评 | agent 写的 acceptance_cmd 可能偏宽松 |
| Claude Max 速率 | 密集调用可能触发 429，调大 sleep 值 |
| knowledge 无验证 | Research Agent 的结论可能不准确 |
| 串行执行 | 不支持并行，大型项目速度受限 |
