---
description: "项目初始化：从 agentic-template 创建新的自主开发项目，生成 .agent/ 目录结构和配置文件。替代 init.sh。"
agent: "agent"
tools: [read, edit, execute]
argument-hint: "项目名称 '项目一句话描述'"
---

# 项目初始化

从 agentic-template 初始化一个新的自主开发项目。

## 输入参数

从用户消息中解析：
- **项目名称**（英文或拼音，用于目录名和 git 信息）
- **项目描述**（一句话，可以是中文）

如果用户没有提供，先询问这两个信息再继续。

---

## 初始化步骤

### 1. 确定目标目录

在当前工作目录下创建以项目名称命名的目录（如项目名为 `my-app`，则创建 `./my-app/`）。

如目录已存在且非空，询问用户是否覆盖。

### 2. 创建目录结构

在终端运行：

```bash
mkdir -p <目标目录>/{.agent/{experiments,knowledge,inbox},.github/{agents,prompts,instructions}}
```

### 3. 创建 `.agent/program.md`

写入以下内容（替换 `{{PROJECT_NAME}}` 和 `{{项目描述}}`）：

```markdown
# program.md — {{PROJECT_NAME}}

## 目标

{{项目描述}}

---

## 系统组成

（PM Agent 将在 task_000 调研后补充）

---

## 约束（不能动的）

- （请填写技术栈约束，例如：只用 TypeScript）
- （请填写外部依赖约束）
- （请填写架构约束）

---

## 停止条件（MVP 验收标准）

- [ ] （功能1：能做 X）
- [ ] （功能2：能做 Y）
- [ ] （构建验证：npm run build 无报错）

---

## 技术选型（PM Agent 默认决策，可 [OVERRIDE]）

（PM Agent 将在 task_000 research 后填充）

---

## 功能进化区（MVP 完成后持续追加）

<!--
使用方式：
1. 在下面追加功能想法，格式随意，可以模糊
2. 运行 evolve.prompt.md
-->
```

### 4. 创建 `.agent/tasks.json`

```json
{
  "tasks": [
    {
      "id": "task_000",
      "type": "pm_research",
      "title": "技术可行性调研 + 项目骨架决策",
      "status": "pending",
      "depends_on": [],
      "acceptance": "knowledge/ 下有调研文档，decisions.md 有完整技术决策",
      "acceptance_cmd": "test -s .agent/decisions.md && ls .agent/knowledge/*.md 2>/dev/null | grep -q . && echo PASS || echo 'FAIL: research 文档不完整'"
    },
    {
      "id": "task_001",
      "type": "coding",
      "title": "（第一个具体任务——请在此填写）",
      "status": "blocked",
      "depends_on": ["task_000"],
      "acceptance": "（验收描述）",
      "acceptance_cmd": "echo PASS"
    }
  ]
}
```

### 5. 创建 `.agent/state.json`

```json
{
  "phase": "research",
  "current_task": "task_000",
  "retry_count": 0,
  "pm_done": false,
  "loop_count": 0,
  "last_tick": "",
  "last_score": 0,
  "last_research": ""
}
```

### 6. 创建 `.agent/decisions.md`

```markdown
# {{PROJECT_NAME}} — 技术决策日志

（PM Agent 将在 task_000 执行后填充此文件）
```

### 7. 复制 Agent 和 Prompt 文件

将 agentic-template 的以下文件复制到目标项目：

```bash
cp -r <模板目录>/.github/agents <目标目录>/.github/
cp -r <模板目录>/.github/prompts <目标目录>/.github/
```

### 8. 创建 `CLAUDE.md`（兼容 Claude CLI）

写入以下内容：

```markdown
# {{PROJECT_NAME}}

## 一句话介绍

{{项目描述}}

## 启动（VS Code Copilot）

1. 编辑 `.agent/program.md` — 写目标和约束
2. 打开 Chat，输入 `/tick` — 系统自动完成 MVP
3. 追加功能 — 在 `program.md` 末尾加 `- [ ] 你的想法`
4. 输入 `/evolve` — 系统自动实现新功能

## 启动（Claude CLI，备选）

```bash
bash tick.sh    # MVP 阶段
bash evolve.sh  # 进化阶段
```

## 查看进度

```bash
cat .agent/tasks.json | python3 -m json.tool
cat .agent/decisions.md
ls .agent/experiments/
ls .agent/knowledge/
```
```

### 9. 初始化 git

```bash
cd <目标目录>
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
git commit -q -m "init: {{PROJECT_NAME}} agentic scaffold"
```

---

## 完成后输出

```
✅ 项目初始化完成：<项目名>

下一步：
1. 编辑 .agent/program.md，填写约束和停止条件
2. 编辑 .agent/tasks.json，填写 task_001 的具体任务
3. 在 Chat 中输入 /tick 启动自主开发
```
