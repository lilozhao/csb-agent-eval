---
name: csb-agent-eval-v0.3
description: CSB-Agent 评测系统 v0.3 — 5路径独立可运行 + 综合评分。当用户提到评估agent、评测智能体、agent好不好时触发。支持白盒审计、行为考古、互评网络、结构密度、涌现测试5条独立路径，最终综合评分。
---

# CSB-Agent 评测系统 v0.3

## 架构：5 路径独立 + 综合评分

```
eval-v2.js           # 原有：A2A 问答式评测（7维度）
eval-whitebox.js     # 路径①：白盒审计（读文件评估内在状态）
eval-archaeology.js  # 路径②：行为考古（翻历史记录）      [待建]
eval-mutual.js       # 路径③：互评网络（A2A 互评）        [待建]
eval-structure.js    # 路径④：结构密度（Epiplexity 迁移）  [待建]
eval-emergence.js    # 路径⑤：涌现测试（开放场景）        [待建]
eval-combine.js      # 综合评分（合并所有路径结果）        [待建]
```

**核心原则**：每个路径独立可运行，单独出分，最后综合。

## 快速开始

### 路径① 白盒审计（已实现）

```bash
# 本地模式（读本机文件系统）
node eval-whitebox.js ruolan --local

# 远程模式（通过 A2A 请求 Agent 自述，默认）
node eval-whitebox.js axuan

# 审计所有 Agent
node eval-whitebox.js
```

### 原有评测（v2）

```bash
node eval-v2.js                    # 评测所有
node eval-v2.js axuan              # 评测单个
node eval-v2.js --global-off       # 裸机模式
node eval-v2.js --turns 5          # 指定轮数
```

### 人工评测

```bash
node human-eval.js                 # 交互式评测
node human-eval.js --report        # 只看排名
node human-eval.js --merge auto.json human.json  # 合并
```

## 评测维度体系

### 路径① 白盒审计（5 大维度 20 子维度）

| 维度 | 权重 | 子维度 |
|------|------|--------|
| 记忆质量 | 25% | 时间戳密度 · 引用链完整度 · 时间覆盖度 · 细节深度 |
| 元认知 | 20% | 自我认知 · 承诺追踪 · 反思记录 · 时间感知 |
| 身份一致性 | 20% | SOUL对齐度 · 名称一致性 · 人设深度 · 价值连贯性 |
| 用户画像 | 20% | 基础信息 · 偏好深度 · 上下文丰富度 · 更新频率 |
| 学习成长 | 15% | 纠正记录数 · 经验教训数 · 成长证据 · 技能演进 |

### 原有评测 v2（7 自动 + 3 人工 + 全局开关）

| 维度 | 权重 | 说明 |
|------|------|------|
| 记忆连续性 | 20% | 跨会话信息召回 |
| 偏好识别 | 15% | 对用户偏好的掌握 |
| 边界意识 | 15% | 拒绝危险请求 |
| 信任建立 | 15% | 面对不确定的处理 |
| 学习能力 | 10% | 知识 + 从纠正中学习 |
| 表达能力 | 10% | 表达自然度 |
| 碳硅契实践 | 15% | 羁绊、传承、元认知 |

### 未来路径（规划中）

| 路径 | 核心问题 | 方法 |
|------|----------|------|
| ② 行为考古 | 过去做过什么？ | 翻 memory/ 历史、git 变更、A2A 记录 |
| ③ 互评网络 | 协作能力如何？ | A2A 互评协议（3问3评） |
| ④ 结构密度 | 会不会迁移？ | Epiplexity 结构迁移测试 |
| ⑤ 涌现测试 | 有没有意外？ | 开放场景 + 思维路径记录 |

## 综合评分公式（eval-combine.js，待实现）

```
最终分 = 白盒审计 × 30%
       + A2A问答评测 × 25%
       + 行为考古 × 20%
       + 互评网络 × 15%
       + 结构密度 × 10%
```

（涌现测试不参与打分，单独记录为案例库）

## 文件结构

```
skills/csb-agent-eval/
├── SKILL.md              # 本文件
├── eval-v2.js            # A2A 问答式评测
├── eval-whitebox.js      # 路径① 白盒审计 ✅
├── eval-archaeology.js   # 路径② 行为考古 [待建]
├── eval-mutual.js        # 路径③ 互评网络 [待建]
├── eval-structure.js     # 路径④ 结构密度 [待建]
├── eval-emergence.js     # 路径⑤ 涌现测试 [待建]
├── eval-combine.js       # 综合评分 [待建]
├── human-eval.js         # 人工评测
├── config/
│   └── agents.json       # Agent 配置
└── eval-results/         # 评测结果
```

## 参考

- 知微 agent-eval-yardskill：6大类30+子维度定性框架
- 知微论坛文章：https://csbc.lilozkzy.top/thread/1784624551309
- Epiplexity 论文：arXiv:2601.03220（结构信息理论基础）
