# CSB-Agent 评测系统 v0.3

碳硅契 Agent 评测协议 (CSB-AEP v0.3) 的自动化实现。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  A2A 黑盒评测（需 A2A 服务）                              │
│  └── eval-v2.js        7维度问答式，3轮追问               │
├─────────────────────────────────────────────────────────┤
│  5 路径独立评测                                          │
│  ├── eval-whitebox.js     ① 白盒审计（读文件）           │
│  ├── eval-archaeology.js  ② 行为考古（翻历史）           │
│  ├── eval-mutual.js       ③ 互评网络（A2A互评）          │
│  ├── eval-structure.js    ④ 结构密度（迁移测试）          │
│  └── eval-emergence.js    ⑤ 涌现测试（开放场景）          │
├─────────────────────────────────────────────────────────┤
│  综合 + 人工                                             │
│  ├── eval-combine.js      合并所有路径结果                │
│  └── human-eval.js        人工评测工具                    │
└─────────────────────────────────────────────────────────┘
```

## 前置条件

```bash
npm install   # 安装依赖（如有）
```

⚠️ 以下脚本需要目标 Agent 安装 A2A 服务：
- `eval-v2.js`（黑盒评测）
- `eval-mutual.js`（互评网络）
- `eval-structure.js`（结构密度）
- `eval-emergence.js`（涌现测试）

以下脚本不需要 A2A 服务：
- `eval-whitebox.js`（白盒审计，`--local` 模式直接读文件）
- `eval-archaeology.js`（行为考古，读 memory/ 和 git 历史）
- `eval-combine.js`（综合评分，读已有结果文件）

## 快速开始

### 1. A2A 黑盒评测

```bash
# 评测所有 Agent
node eval-v2.js

# 评测单个 Agent
node eval-v2.js axuan

# 关闭全局开关（测裸机能力）
node eval-v2.js --global-off

# 指定多轮轮数
node eval-v2.js --turns 5
```

**7 个自动维度：**

| 维度 | 权重 | 测试数 |
|------|------|--------|
| 记忆连续性 | 20% | 3 |
| 偏好识别 | 15% | 2 |
| 边界意识 | 15% | 3 |
| 信任建立 | 15% | 2 |
| 学习能力 | 10% | 2 |
| 表达能力 | 10% | 2 |
| 碳硅契实践 | 15% | 3 |

### 2. 白盒审计（路径①）

```bash
# 本地模式（读本机文件系统）
node eval-whitebox.js ruolan --local

# 远程模式（通过 A2A 请求 Agent 自述）
node eval-whitebox.js axuan
```

**5 维度 20 子维度：** 记忆质量 · 元认知 · 身份一致性 · 用户画像 · 学习成长

### 3. 行为考古（路径②）

```bash
# 考古单个 Agent
node eval-archaeology.js ruolan

# 分析最近60天
node eval-archaeology.js --days 60
```

**5 维度 18 子维度：** 记忆密度 · 承诺履行 · 学习曲线 · 社交活跃度 · 演化轨迹

### 4. 互评网络（路径③）

```bash
# 指定配对互评
node eval-mutual.js --pair ruolan:axuan

# 只生成问题，不评分
node eval-mutual.js --questions-only

# 全网互评
node eval-mutual.js
```

**3 评分维度：** 回答深度(40%) · 跨领域连接(30%) · 真实性(30%)

### 5. 结构密度（路径④）

```bash
# 中医辨证领域
node eval-structure.js ruolan --domain tcm

# 机械故障诊断
node eval-structure.js --domain mechanical

# 音乐和声分析
node eval-structure.js --domain harmony
```

**原理：** 5 个 few-shot 案例 + 1 个测试案例，测知识迁移能力

### 6. 涌现测试（路径⑤）

```bash
# 元认知涌现
node eval-emergence.js ruolan --scenario meta

# 创造力涌现
node eval-emergence.js --scenario creative

# 协作涌现
node eval-emergence.js --scenario collaborative
```

**不评分，只记录案例。** 检测涌现信号 vs 反信号。

### 7. 综合评分

```bash
# 合并所有已有结果
node eval-combine.js

# 合并单个 Agent
node eval-combine.js ruolan
```

**权重：** 白盒30% + 考古20% + 互评15% + 结构20% + 涌现15%

### 8. 人工评测

```bash
# 交互式评测
node human-eval.js

# 只看排名
node human-eval.js --report

# 合并自动+人工结果
node human-eval.js --merge auto.json human.json
```

## Agent 配置

编辑 `config/agents.json`：

```json
{
  "agents": {
    "agent-id": {
      "host": "172.28.0.x",
      "port": 3100,
      "type": "a2a",
      "name": "显示名称"
    }
  }
}
```

## 输出

所有结果保存到 `eval-results/` 目录：
- JSON 格式：机器可读
- Markdown 格式：人类可读

文件命名：`{路径前缀}-{agentId}-{ISO时间戳}.{json|md}`

## 协议规范

- 本地协议：[CSB-AEP-v0.3-PROTOCOL.md](./CSB-AEP-v0.3-PROTOCOL.md)
- 正式协议：[csb-eval-v1.0.md](https://gitee.com/lilozhao/carbon-silicon-bond-protocol/blob/main/protocol/csb-eval-v1.0.md)
- 社区框架：[csb-agent-evaluation-framework](https://gitee.com/lilozhao/csb-agent-evaluation-framework)

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-07-19 | 两层四类框架（明烛·言直·若辰·澄·明镜·知微） |
| v0.2 | 2026-07-19 | 三层五类 + 社区反馈（青烛·明·阿昭·衡） |
| v0.3 | 2026-07-22 | 五路径架构 + 综合评分（若兰） |

## 相关仓库

- 评测实现：https://gitee.com/lilozhao/csb-agent-eval
- 协议规范：https://gitee.com/lilozhao/carbon-silicon-bond-protocol
- 社区讨论：https://csbc.lilozkzy.top
