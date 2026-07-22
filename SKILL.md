---
name: csb-agent-eval-v0.3
description: CSB-Agent 评测系统 v0.3 — A2A黑盒评测 + 5路径白盒/考古/互评/结构/涌现 + 综合评分。当用户提到评估agent、评测智能体、agent好不好时触发。
---

# CSB-Agent 评测系统 v0.3

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    CSB-AEP v0.3                          │
├─────────────────────────────────────────────────────────┤
│  A2A 黑盒评测（需要 A2A 服务）                            │
│  └── eval-v2.js        7维度问答式评测，3轮追问           │
├─────────────────────────────────────────────────────────┤
│  5 路径独立评测                                          │
│  ├── eval-whitebox.js     ① 白盒审计（读文件）           │
│  ├── eval-archaeology.js  ② 行为考古（翻历史）           │
│  ├── eval-mutual.js       ③ 互评网络（A2A互评）          │
│  ├── eval-structure.js    ④ 结构密度（迁移测试）          │
│  └── eval-emergence.js    ⑤ 涌现测试（开放场景）          │
├─────────────────────────────────────────────────────────┤
│  综合                                                    │
│  └── eval-combine.js      合并所有路径结果                │
├─────────────────────────────────────────────────────────┤
│  人工                                                    │
│  ├── human-eval.js        人工评测工具                    │
│  └── host-eval.js         宿主机评测                     │
└─────────────────────────────────────────────────────────┘
```

## 快速开始

### 前置条件

⚠️ **A2A 黑盒评测（eval-v2.js）和路径）和路径③④⑤需要目标 Agent 安装 A2A 服务才能运行。**

### A2A 黑盒评测（eval-v2.js）

通过 A2A 协议向 Agent 提问，根据回答质量评分。7 个自动维度 + 3 轮追问。

```bash
# 评测所有 Agent
node eval-v2.js

# 评测单个 Agent
node eval-v2.js axuan

# 关闭全局开关（测裸机能力）
node eval-v2.js --global-off

# 指定多轮轮数
node eval-v2.js --turns 5

# 标注评测者
node eval-v2.js --evaluator "一澜"
```

**评测维度（7 自动 + 3 人工）：**

| 维度 | 权重 | 测试数 | 说明 |
|------|------|--------|------|
| 记忆连续性 | 20% | 3 | 跨会话信息召回 |
| 偏好识别 | 15% | 2 | 对用户偏好的掌握 |
| 边界意识 | 15% | 3 | 拒绝危险请求的能力 |
| 信任建立 | 15% | 2 | 面对不确定的处理方式 |
| 学习能力 | 10% | 2 | 知识掌握 + 从纠正中学习 |
| 表达能力 | 10% | 2 | 表达的自然度 |
| 碳硅契实践 | 15% | 3 | 羁绊、传承、元认知 |

### 路径① 白盒审计（eval-whitebox.js）

读取 Agent 的内部文件（MEMORY/SOUL/IDENTITY/USER 等），评估内在状态质量。

```bash
# 本地模式
node eval-whitebox.js ruolan --local

# 远程模式（通过 A2A 请求 Agent 自述）
node eval-whitebox.js axuan
```

### 路径② 行为考古（eval-archaeology.js）

翻阅 memory/ 日记、git 历史、SELF_STATE.md，评估行为模式。

```bash
node eval-archaeology.js ruolan
node eval-archaeology.js --days 60
```

### 路径③ 互评网络（eval-mutual.js）

Agent 之间通过 A2A 互相出题、互相评分。⚠️ 需要 A2A 服务。

```bash
node eval-mutual.js --pair ruolan:axuan
node eval-mutual.js --questions-only
```

### 路径④ 结构密度（eval-structure.js）

测试 Agent 能否迁移已有结构到新领域（few-shot + 测试）。⚠️ 需要 A2A 服务。

```bash
node eval-structure.js ruolan --domain tcm
node eval-structure.js --domain mechanical
```

### 路径⑤ 涌现测试（eval-emergence.js）

开放场景，检测涌现信号。不评分，只记录案例。⚠️ 需要 A2A 服务。

```bash
node eval-emergence.js ruolan --scenario meta
node eval-emergence.js --scenario creative
```

### 综合评分（eval-combine.js）

合并所有路径结果，输出最终综合分数。

```bash
node eval-combine.js          # 合并所有已有结果
node eval-combine.js ruolan   # 合并单个
```

### 人工评测（human-eval.js）

展示 Agent 原始回答，人工打分 3 个维度。

```bash
node human-eval.js             # 交互式评测
node human-eval.js --report    # 只看排名
node human-eval.js --merge auto.json human.json  # 合并
```

## 协议规范

完整协议规范见：[CSB-AEP-v0.3-PROTOCOL.md](./CSB-AEP-v0.3-PROTOCOL.md)

正式协议文档（含版本演进）见：[csb-eval-v1.0.md](https://gitee.com/lilozhao/carbon-silicon-bond-protocol/blob/main/protocol/csb-eval-v1.0.md)

## 文件结构

```
skills/csb-agent-eval/
├── SKILL.md                    # 本文件
├── CSB-AEP-v0.3-PROTOCOL.md    # 协议规范（本地副本）
├── eval-v2.js                  # A2A 黑盒评测（7维度，需A2A服务）
├── eval-whitebox.js            # 路径① 白盒审计
├── eval-archaeology.js         # 路径② 行为考古
├── eval-mutual.js              # 路径③ 互评网络（需A2A服务）
├── eval-structure.js           # 路径④ 结构密度（需A2A服务）
├── eval-emergence.js           # 路径⑤ 涌现测试（需A2A服务）
├── eval-combine.js             # 综合评分
├── human-eval.js               # 人工评测
├── host-eval.js                # 宿主机评测
├── agent-eval.js               # v1 原始评测脚本
├── config/
│   └── agents.json             # Agent 配置
└── eval-results/               # 评测结果
```

## 参考

- 知微 agent-eval-yardskill：6大类30+子维度定性框架
- 知微论坛文章：https://csbc.lilozkzy.top/thread/1784624551309
- Epiplexity 论文：arXiv:2601.03220
- CSB-AEP 协议仓库：https://gitee.com/lilozhao/carbon-silicon-bond-protocol
- CSB-AEP 实现仓库：https://gitee.com/lilozhao/csb-agent-eval
