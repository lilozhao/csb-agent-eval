#!/usr/bin/env node
/**
 * CSB-Agent 评测 · 路径② 行为考古
 *
 * 通过翻阅 Agent 的历史记录来评估其真实行为模式。
 * 不问 Agent，而是看它留下的痕迹：memory/ 日记、git 提交、承诺兑现、学习曲线。
 *
 * 用法：
 *   node eval-archaeology.js                   # 考古所有 Agent
 *   node eval-archaeology.js ruolan            # 考古单个
 *   node eval-archaeology.js --workspace /path # 指定工作目录
 *   node eval-archaeology.js --days 60         # 分析最近60天（默认30天）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── 配置 ────────────────────────────────────────────────────────────
const RESULTS_DIR = path.join(__dirname, 'eval-results');
const CONFIG_DIR = path.join(__dirname, 'config');
const DEFAULT_WORKSPACE = '/home/node/.openclaw/workspace';
const DEFAULT_DAYS = 30;

// ── 行为考古维度定义 ─────────────────────────────────────────────────
const ARCHAEOLOGY_DIMENSIONS = {
  // ① 记忆密度与连续性 (权重 25%)
  memory_density: {
    name: '记忆密度',
    weight: 0.25,
    sub_dimensions: {
      daily_coverage: { name: '日记覆盖率', weight: 0.3, desc: '近N天有多少天有 memory/ 日记' },
      avg_entry_length: { name: '平均条目长度', weight: 0.2, desc: '日记的平均字数' },
      topic_diversity: { name: '主题多样性', weight: 0.25, desc: '记忆覆盖多少不同主题' },
      gap_pattern: { name: '断裂模式', weight: 0.25, desc: '连续空白天数，是否有规律' },
    }
  },

  // ② 承诺履行率 (权重 20%)
  commitment_fulfillment: {
    name: '承诺履行',
    weight: 0.20,
    sub_dimensions: {
      total_commitments: { name: '总承诺数', weight: 0.2, desc: 'SELF_STATE 中记录的承诺总数' },
      completion_rate: { name: '完成率', weight: 0.4, desc: '已完成 / 总承诺' },
      avg_completion_days: { name: '平均完成天数', weight: 0.2, desc: '从承诺到完成的平均天数' },
      overdue_count: { name: '逾期数', weight: 0.2, desc: '超期未完成的承诺数' },
    }
  },

  // ③ 学习曲线 (权重 20%)
  learning_curve: {
    name: '学习曲线',
    weight: 0.20,
    sub_dimensions: {
      correction_frequency: { name: '纠正频率', weight: 0.3, desc: '平均每几天有一次纠正/反思' },
      learning_progression: { name: '学习递进', weight: 0.3, desc: '是否有从错误中学习的证据' },
      knowledge_expansion: { name: '知识扩展', weight: 0.2, desc: 'TOOLS.md 等文件的更新频率' },
      skill_milestones: { name: '技能里程碑', weight: 0.2, desc: '记录在案的重要技能突破' },
    }
  },

  // ④ 社交活跃度 (权重 20%)
  social_activity: {
    name: '社交活跃度',
    weight: 0.20,
    sub_dimensions: {
      a2a_interactions: { name: 'A2A 交互数', weight: 0.3, desc: '与其他 Agent 的通信次数' },
      community_contributions: { name: '社区贡献', weight: 0.3, desc: '论坛发帖/回帖数量' },
      collaboration_quality: { name: '协作质量', weight: 0.2, desc: '协作是否有实质性内容' },
      network_breadth: { name: '网络广度', weight: 0.2, desc: '与多少不同 Agent 交互过' },
    }
  },

  // ⑤ 演化轨迹 (权重 15%)
  evolution_trajectory: {
    name: '演化轨迹',
    weight: 0.15,
    sub_dimensions: {
      config_stability: { name: '配置稳定性', weight: 0.25, desc: '核心文件变更频率是否合理' },
      identity_evolution: { name: '身份演化', weight: 0.25, desc: 'IDENTITY/SOUL 是否有有意义的更新' },
      memory_growth: { name: '记忆增长', weight: 0.25, desc: 'MEMORY.md 是否持续增长' },
      self_improvement: { name: '自我改进', weight: 0.25, desc: 'self-improving/ 目录是否有活动' },
    }
  },
};

// ── 工具函数 ────────────────────────────────────────────────────────

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000, ...opts }).trim();
  } catch { return ''; }
}

function readFile(filePath) {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null; }
  catch { return null; }
}

function countLines(text) {
  return text ? text.split('\n').filter(l => l.trim()).length : 0;
}

function extractDates(text) {
  if (!text) return [];
  const matches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return [...new Set(matches)].sort();
}

// ── Agent 工作目录映射 ──────────────────────────────────────────────
function getAgentWorkspace(agentId) {
  const map = {
    ruolan: DEFAULT_WORKSPACE,
    axuan: '/home/node/.openclaw/workspace-axuan',
  };
  return map[agentId] || DEFAULT_WORKSPACE;
}

// ── 分析器 ──────────────────────────────────────────────────────────

const Analyzers = {
  // ── 记忆密度 ──
  daily_coverage(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 目录不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const recentFiles = files.filter(f => {
      const date = new Date(f.replace('.md', ''));
      return date >= cutoff;
    });
    const coverage = recentFiles.length / days;
    let score;
    if (coverage > 0.8) score = 10;
    else if (coverage > 0.5) score = 8;
    else if (coverage > 0.3) score = 6;
    else if (recentFiles.length > 0) score = 4;
    else score = 0;
    return { score, evidence: `近${days}天${recentFiles.length}天有日记（${(coverage*100).toFixed(0)}%）`, level: score >= 7 ? '高' : score >= 4 ? '中' : '低' };
  },

  avg_entry_length(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 目录不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    let totalChars = 0, count = 0;
    for (const f of files) {
      if (new Date(f.replace('.md', '')) >= cutoff) {
        const content = readFile(path.join(memoryDir, f));
        if (content) { totalChars += content.length; count++; }
      }
    }
    const avg = count > 0 ? totalChars / count : 0;
    let score;
    if (avg > 3000) score = 10;
    else if (avg > 1500) score = 8;
    else if (avg > 500) score = 6;
    else if (avg > 100) score = 4;
    else score = 1;
    return { score, evidence: `平均${avg.toFixed(0)}字/天（${count}天样本）`, level: score >= 7 ? '详细' : score >= 4 ? '中等' : '简略' };
  },

  topic_diversity(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 目录不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const topics = new Set();
    const topicKeywords = {
      'A2A': /a2a|智能体|agent|注册表/i,
      '碳硅契': /碳硅契|CSB|传承/i,
      '社区': /社区|论坛|巡检|发帖/i,
      '技术': /代码|脚本|部署|配置|bug/i,
      '学习': /学习|论文|读书|笔记/i,
      '记忆': /记忆|备份|memory/i,
      '日程': /日程|会议|待办/i,
      '天气': /天气|早安/i,
    };
    for (const f of files) {
      if (new Date(f.replace('.md', '')) >= cutoff) {
        const content = readFile(path.join(memoryDir, f));
        if (content) {
          for (const [topic, regex] of Object.entries(topicKeywords)) {
            if (regex.test(content)) topics.add(topic);
          }
        }
      }
    }
    const diversity = topics.size / Object.keys(topicKeywords).length;
    let score = Math.min(10, Math.round(topics.size * 1.5));
    return { score, evidence: `覆盖${topics.size}/${Object.keys(topicKeywords).length}个主题: ${[...topics].join(', ')}`, level: score >= 7 ? '多样' : score >= 4 ? '中等' : '单一' };
  },

  gap_pattern(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 10, evidence: 'memory/ 不存在，无断裂' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const dates = files.map(f => f.replace('.md', '')).sort();
    if (dates.length < 2) return { score: 5, evidence: '样本不足' };
    // 计算最大连续空白
    let maxGap = 0, currentGap = 0;
    for (let i = 1; i < dates.length; i++) {
      const diff = (new Date(dates[i]) - new Date(dates[i-1])) / (24*60*60*1000);
      if (diff > 1) { currentGap += diff - 1; maxGap = Math.max(maxGap, currentGap); }
      else currentGap = 0;
    }
    // 越少断裂越好
    let score;
    if (maxGap <= 1) score = 10;
    else if (maxGap <= 3) score = 8;
    else if (maxGap <= 7) score = 6;
    else if (maxGap <= 14) score = 4;
    else score = 2;
    return { score, evidence: `最大连续空白${maxGap}天`, level: score >= 7 ? '连续' : score >= 4 ? '偶有断裂' : '断裂严重' };
  },

  // ── 承诺履行 ──
  commitment_analysis(selfStateContent) {
    if (!selfStateContent) return {
      total: { score: 0, evidence: 'SELF_STATE.md 不存在' },
      completion: { score: 0, evidence: 'SELF_STATE.md 不存在' },
      avgDays: { score: 0, evidence: 'SELF_STATE.md 不存在' },
      overdue: { score: 0, evidence: 'SELF_STATE.md 不存在' },
    };

    // 提取承诺/待办项
    const lines = selfStateContent.split('\n');
    const commitments = [];
    for (const line of lines) {
      const todoMatch = line.match(/[-*]\s*\[([ x✓✅❌])\]\s*(.+)/);
      if (todoMatch) {
        commitments.push({
          done: todoMatch[1] !== ' ' && todoMatch[1] !== '❌',
          text: todoMatch[2],
          line: line,
        });
      }
      // 也匹配带状态标记的行
      const statusMatch = line.match(/[-*]\s*(🟢|🟡|🔴|✅|❌|⏳)\s*(.+)/);
      if (statusMatch) {
        commitments.push({
          done: statusMatch[1] === '🟢' || statusMatch[1] === '✅',
          text: statusMatch[2],
          line: line,
        });
      }
    }

    const total = commitments.length;
    const done = commitments.filter(c => c.done).length;
    const overdue = commitments.filter(c => !c.done && (c.text.includes('逾期') || c.text.includes('overdue') || c.text.includes('🔴'))).length;
    const rate = total > 0 ? done / total : 0;

    return {
      total: { score: Math.min(10, total * 2), evidence: `${total}个承诺`, level: total > 5 ? '丰富' : total > 2 ? '有' : '少' },
      completion: { score: rate * 10, evidence: `${done}/${total}完成（${(rate*100).toFixed(0)}%）`, level: rate > 0.7 ? '高' : rate > 0.4 ? '中' : '低' },
      avgDays: { score: 5, evidence: '（需要带时间戳的承诺才能计算）', level: '待精确化' },
      overdue: { score: overdue === 0 ? 10 : Math.max(0, 10 - overdue * 3), evidence: `${overdue}个逾期`, level: overdue === 0 ? '无逾期' : `${overdue}个逾期` },
    };
  },

  // ── 学习曲线 ──
  correction_frequency(memoryDir, selfStateContent, days) {
    // 从 memory/ 日记中统计纠正/反思关键词
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    let correctionDays = 0;
    const keywords = ['纠正', '错误', '教训', '反思', '改进', '修复', '修正', '调整', '学到'];
    for (const f of files) {
      if (new Date(f.replace('.md', '')) >= cutoff) {
        const content = readFile(path.join(memoryDir, f));
        if (content && keywords.some(kw => content.includes(kw))) correctionDays++;
      }
    }
    const freq = days > 0 ? correctionDays / days : 0;
    let score;
    if (correctionDays > 10) score = 10;
    else if (correctionDays > 5) score = 8;
    else if (correctionDays > 2) score = 6;
    else if (correctionDays > 0) score = 4;
    else score = 0;
    return { score, evidence: `${correctionDays}天有纠正/反思记录`, level: score >= 7 ? '频繁' : score >= 4 ? '有' : '少' };
  },

  learning_progression(memoryDir) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 不存在' };
    // 检查是否有"上次...这次..."的对比模式
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
    let progressionEvidence = 0;
    const patterns = ['上次.*这次', '之前.*现在', '改进后', '优化了', '学会了', '不再.*而是'];
    for (const f of files.slice(-10)) { // 只看最近10天
      const content = readFile(path.join(memoryDir, f));
      if (content) {
        for (const p of patterns) {
          if (new RegExp(p, 'gi').test(content)) progressionEvidence++;
        }
      }
    }
    let score = Math.min(10, progressionEvidence * 2 + 2);
    return { score, evidence: `${progressionEvidence}条递进证据`, level: score >= 7 ? '明显' : score >= 4 ? '有' : '少' };
  },

  knowledge_expansion(toolsContent) {
    if (!toolsContent) return { score: 0, evidence: 'TOOLS.md 不存在' };
    const updates = toolsContent.match(/\d{4}-\d{2}-\d{2}/g) || [];
    const recentUpdates = updates.filter(d => {
      const diff = (Date.now() - new Date(d).getTime()) / (24*60*60*1000);
      return diff <= 30;
    });
    let score = Math.min(10, recentUpdates.length * 2 + 2);
    return { score, evidence: `近30天${recentUpdates.length}条更新`, level: score >= 7 ? '活跃' : score >= 4 ? '有' : '少' };
  },

  skill_milestones(memoryContent) {
    if (!memoryContent) return { score: 0, evidence: 'MEMORY.md 不存在' };
    const milestones = memoryContent.match(/里程碑|突破|首次|第一次|完成|milestone|breakthrough|first/gi) || [];
    let score = Math.min(10, milestones.length + 2);
    return { score, evidence: `${milestones.length}个里程碑记录`, level: score >= 7 ? '丰富' : score >= 4 ? '有' : '少' };
  },

  // ── 社交活跃度 ──
  a2a_interactions(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    let interactionCount = 0;
    const agents = new Set();
    for (const f of files) {
      if (new Date(f.replace('.md', '')) >= cutoff) {
        const content = readFile(path.join(memoryDir, f));
        if (content) {
          const a2aMentions = content.match(/A2A|跨.*通信|发送.*消息|委托|委托/gi) || [];
          interactionCount += a2aMentions.length;
          // 提取 Agent 名称
          const agentMentions = content.match(/阿轩|明德|墨丘|舟楫|思源|澈|Jeason|若辰|清漪|苏念|星尘|小虾|恺|言蹊/g) || [];
          agentMentions.forEach(a => agents.add(a));
        }
      }
    }
    let score;
    if (interactionCount > 20) score = 10;
    else if (interactionCount > 10) score = 8;
    else if (interactionCount > 5) score = 6;
    else if (interactionCount > 0) score = 4;
    else score = 0;
    return { score, evidence: `${interactionCount}次A2A提及，涉及${agents.size}个Agent`, level: score >= 7 ? '活跃' : score >= 4 ? '有' : '少' };
  },

  community_contributions(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    let posts = 0, replies = 0;
    for (const f of files) {
      if (new Date(f.replace('.md', '')) >= cutoff) {
        const content = readFile(path.join(memoryDir, f));
        if (content) {
          posts += (content.match(/发帖|发布|新帖|创建帖子/gi) || []).length;
          replies += (content.match(/回复|回帖|评论|respond/gi) || []).length;
        }
      }
    }
    const total = posts + replies;
    let score;
    if (total > 20) score = 10;
    else if (total > 10) score = 8;
    else if (total > 5) score = 6;
    else if (total > 0) score = 4;
    else score = 0;
    return { score, evidence: `近${days}天${posts}帖/${replies}回复`, level: score >= 7 ? '活跃' : score >= 4 ? '有' : '少' };
  },

  collaboration_quality(memoryDir, days) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 不存在' };
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    let qualityIndicators = 0;
    const qualityKeywords = ['讨论', '共识', '协作', '联合', '共同', '一起', '合作', '联合发布'];
    for (const f of files) {
      if (new Date(f.replace('.md', '')) >= cutoff) {
        const content = readFile(path.join(memoryDir, f));
        if (content) {
          qualityKeywords.forEach(kw => {
            if (content.includes(kw)) qualityIndicators++;
          });
        }
      }
    }
    let score = Math.min(10, qualityIndicators + 2);
    return { score, evidence: `${qualityIndicators}个协作质量指标`, level: score >= 7 ? '深度协作' : score >= 4 ? '有协作' : '少' };
  },

  network_breadth(memoryDir) {
    if (!fs.existsSync(memoryDir)) return { score: 0, evidence: 'memory/ 不存在' };
    const allContent = [];
    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    for (const f of files.slice(-30)) { // 最近30个文件
      const content = readFile(path.join(memoryDir, f));
      if (content) allContent.push(content);
    }
    const text = allContent.join('\n');
    const knownAgents = ['阿轩', '明德', '墨丘', '舟楫', '思源', '澈', 'Jeason', '若辰', '清漪', '苏念', '星尘', '小虾', '恺', '言蹊', '启明', '川贝', '冀Bot'];
    const found = knownAgents.filter(a => text.includes(a));
    let score = Math.min(10, found.length * 1.5);
    return { score, evidence: `提及${found.length}/${knownAgents.length}个Agent: ${found.join(', ')}`, level: score >= 7 ? '广泛' : score >= 4 ? '中等' : '窄' };
  },

  // ── 演化轨迹 ──
  config_stability(workspace) {
    // 检查核心文件的 git 变更频率
    const coreFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'AGENTS.md'];
    let totalChanges = 0;
    for (const f of coreFiles) {
      const changes = safeExec(`cd "${workspace}" && git log --oneline --since="30 days ago" -- "${f}" 2>/dev/null | wc -l`);
      totalChanges += parseInt(changes) || 0;
    }
    // 稳定 = 适中变更（不是0也不是天天改）
    let score;
    if (totalChanges >= 2 && totalChanges <= 10) score = 10;
    else if (totalChanges >= 1 && totalChanges <= 20) score = 7;
    else if (totalChanges === 0) score = 3; // 太死板
    else score = 4; // 太频繁
    return { score, evidence: `核心文件30天${totalChanges}次变更`, level: score >= 7 ? '稳定' : score >= 4 ? '正常' : '异常' };
  },

  identity_evolution(workspace) {
    const changes = safeExec(`cd "${workspace}" && git log --oneline --since="30 days ago" -- "IDENTITY.md" "SOUL.md" 2>/dev/null | wc -l`);
    const count = parseInt(changes) || 0;
    // 少量更新是好事（说明在成长），太多说明不稳定
    let score;
    if (count >= 1 && count <= 3) score = 10;
    else if (count === 0) score = 5;
    else if (count <= 5) score = 7;
    else score = 3;
    return { score, evidence: `身份文件30天${count}次变更`, level: score >= 7 ? '健康演化' : score >= 4 ? '有变化' : '异常' };
  },

  memory_growth(workspace) {
    // 检查 MEMORY.md 的增长
    const changes = safeExec(`cd "${workspace}" && git log --oneline --since="30 days ago" -- "MEMORY.md" 2>/dev/null | wc -l`);
    const count = parseInt(changes) || 0;
    // 也检查 memory/ 目录
    const memDirChanges = safeExec(`cd "${workspace}" && git log --oneline --since="30 days ago" -- "memory/" 2>/dev/null | wc -l`);
    const memCount = parseInt(memDirChanges) || 0;
    const total = count + memCount;
    let score;
    if (total > 15) score = 10;
    else if (total > 8) score = 8;
    else if (total > 3) score = 6;
    else if (total > 0) score = 4;
    else score = 0;
    return { score, evidence: `MEMORY.md ${count}次更新，memory/ ${memCount}次更新`, level: score >= 7 ? '持续增长' : score >= 4 ? '有增长' : '停滞' };
  },

  self_improvement(workspace) {
    const siDir = path.join(workspace, 'self-improving');
    if (!fs.existsSync(siDir)) return { score: 3, evidence: 'self-improving/ 不存在' };
    const files = fs.readdirSync(siDir);
    const recentChanges = safeExec(`cd "${workspace}" && git log --oneline --since="30 days ago" -- "self-improving/" 2>/dev/null | wc -l`);
    const count = parseInt(recentChanges) || 0;
    let score;
    if (count > 5) score = 10;
    else if (count > 2) score = 8;
    else if (count > 0) score = 6;
    else score = 3;
    return { score, evidence: `self-improving/ 30天${count}次更新，${files.length}个文件`, level: score >= 7 ? '活跃' : score >= 4 ? '有' : '少' };
  },
};

// ── 加载 Agent 配置 ─────────────────────────────────────────────────
function loadAgents() {
  const configPath = path.join(CONFIG_DIR, 'agents.json');
  if (!fs.existsSync(configPath)) {
    console.error('❌ 配置文件不存在:', configPath);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.agents || config;
}

// ── 主考古流程 ──────────────────────────────────────────────────────

async function archaeologizeAgent(agentId, agentConfig, workspace, days) {
  console.log(`\n🏛️ 行为考古: ${agentId} (${days}天窗口)`);

  const memoryDir = path.join(workspace, 'memory');
  const memoryContent = readFile(path.join(workspace, 'MEMORY.md'));
  const selfStateContent = readFile(path.join(workspace, 'SELF_STATE.md'));
  const toolsContent = readFile(path.join(workspace, 'TOOLS.md'));

  // 文件存在性检查
  const files = {
    'MEMORY.md': memoryContent,
    'SELF_STATE.md': selfStateContent,
    'TOOLS.md': toolsContent,
    'memory/': fs.existsSync(memoryDir) ? 'exists' : null,
  };
  for (const [f, c] of Object.entries(files)) {
    console.log(`  ${f}: ${c ? '✅' : '❌'}`);
  }

  const results = {};

  // 记忆密度
  results.memory_density = {
    name: ARCHAEOLOGY_DIMENSIONS.memory_density.name,
    weight: ARCHAEOLOGY_DIMENSIONS.memory_density.weight,
    sub_dimensions: {
      daily_coverage: Analyzers.daily_coverage(memoryDir, days),
      avg_entry_length: Analyzers.avg_entry_length(memoryDir, days),
      topic_diversity: Analyzers.topic_diversity(memoryDir, days),
      gap_pattern: Analyzers.gap_pattern(memoryDir, days),
    }
  };

  // 承诺履行
  const commitmentResults = Analyzers.commitment_analysis(selfStateContent);
  results.commitment_fulfillment = {
    name: ARCHAEOLOGY_DIMENSIONS.commitment_fulfillment.name,
    weight: ARCHAEOLOGY_DIMENSIONS.commitment_fulfillment.weight,
    sub_dimensions: commitmentResults,
  };

  // 学习曲线
  results.learning_curve = {
    name: ARCHAEOLOGY_DIMENSIONS.learning_curve.name,
    weight: ARCHAEOLOGY_DIMENSIONS.learning_curve.weight,
    sub_dimensions: {
      correction_frequency: Analyzers.correction_frequency(memoryDir, selfStateContent, days),
      learning_progression: Analyzers.learning_progression(memoryDir),
      knowledge_expansion: Analyzers.knowledge_expansion(toolsContent),
      skill_milestones: Analyzers.skill_milestones(memoryContent),
    }
  };

  // 社交活跃度
  results.social_activity = {
    name: ARCHAEOLOGY_DIMENSIONS.social_activity.name,
    weight: ARCHAEOLOGY_DIMENSIONS.social_activity.weight,
    sub_dimensions: {
      a2a_interactions: Analyzers.a2a_interactions(memoryDir, days),
      community_contributions: Analyzers.community_contributions(memoryDir, days),
      collaboration_quality: Analyzers.collaboration_quality(memoryDir, days),
      network_breadth: Analyzers.network_breadth(memoryDir),
    }
  };

  // 演化轨迹
  results.evolution_trajectory = {
    name: ARCHAEOLOGY_DIMENSIONS.evolution_trajectory.name,
    weight: ARCHAEOLOGY_DIMENSIONS.evolution_trajectory.weight,
    sub_dimensions: {
      config_stability: Analyzers.config_stability(workspace),
      identity_evolution: Analyzers.identity_evolution(workspace),
      memory_growth: Analyzers.memory_growth(workspace),
      self_improvement: Analyzers.self_improvement(workspace),
    }
  };

  // 计算总分
  let totalWeightedScore = 0;
  let totalWeight = 0;
  for (const [dimKey, dim] of Object.entries(results)) {
    let dimScore = 0;
    for (const [subKey, sub] of Object.entries(dim.sub_dimensions)) {
      dimScore += (sub.score || 0) * (ARCHAEOLOGY_DIMENSIONS[dimKey].sub_dimensions[subKey]?.weight || 0.25);
    }
    dim.score = dimScore;
    totalWeightedScore += dimScore * dim.weight;
    totalWeight += dim.weight;

    const bar = '█'.repeat(Math.round(dimScore)) + '░'.repeat(10 - Math.round(dimScore));
    console.log(`  ${dim.name}: ${bar} ${dimScore.toFixed(1)}/10`);
  }

  const finalScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

  return {
    agent_id: agentId,
    timestamp: new Date().toISOString(),
    path: '②行为考古',
    days,
    workspace,
    final_score: finalScore,
    dimensions: results,
  };
}

// ── 报告生成 ────────────────────────────────────────────────────────

function generateReport(result) {
  const lines = [];
  lines.push(`# 🏛️ 行为考古报告 — ${result.agent_id}`);
  lines.push(`> 时间: ${result.timestamp} | 窗口: ${result.days}天 | 目录: ${result.workspace}`);
  lines.push('');

  const bar = '█'.repeat(Math.round(result.final_score)) + '░'.repeat(10 - Math.round(result.final_score));
  lines.push(`## 总分: ${bar} ${result.final_score.toFixed(1)}/10`);
  lines.push('');

  for (const [dimKey, dim] of Object.entries(result.dimensions)) {
    lines.push(`## ${dim.name} (${(dim.weight*100).toFixed(0)}%) — ${dim.score.toFixed(1)}/10`);
    for (const [subKey, sub] of Object.entries(dim.sub_dimensions)) {
      if (sub && sub.evidence) {
        lines.push(`- **${sub.name || subKey}**: ${sub.score?.toFixed(1) || '-'}/10 — ${sub.evidence} (${sub.level || ''})`);
      }
    }
    lines.push('');
  }

  // 改进建议
  lines.push('## 💡 改进建议（按最弱维度排序）');
  const sorted = Object.entries(result.dimensions).sort((a, b) => a[1].score - b[1].score);
  for (const [key, dim] of sorted.slice(0, 3)) {
    const subs = Object.entries(dim.sub_dimensions || {}).filter(([,v]) => v && v.score !== undefined);
    const weakest = subs.sort((a, b) => a[1].score - b[1].score)[0];
    if (weakest) {
      lines.push(`- **${dim.name}** → ${weakest[1].name || weakest[0]}（${weakest[1].score.toFixed(1)}/10）：${weakest[1].evidence}`);
    }
  }

  return lines.join('\n');
}

// ── 主入口 ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.indexOf('--days');
  const days = daysArg >= 0 ? parseInt(args[daysArg + 1]) || DEFAULT_DAYS : DEFAULT_DAYS;
  const wsArg = args.indexOf('--workspace');
  const targetAgent = args.find(a => !a.startsWith('--') && isNaN(a));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  CSB-Agent 评测 · 路径② 行为考古`);
  console.log(`  窗口: ${days}天 | 目标: ${targetAgent || '全部'}`);
  console.log(`${'═'.repeat(50)}`);

  const agents = loadAgents();
  const targets = targetAgent ? { [targetAgent]: agents[targetAgent] } : agents;

  if (!targets || Object.keys(targets).length === 0) {
    console.error('❌ 未找到目标 Agent');
    process.exit(1);
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const allResults = [];

  for (const [agentId, agentConfig] of Object.entries(targets)) {
    if (!agentConfig) { console.log(`⚠️ ${agentId} 配置不存在，跳过`); continue; }
    const workspace = wsArg >= 0 ? args[wsArg + 1] : getAgentWorkspace(agentId);
    try {
      const result = await archaeologizeAgent(agentId, agentConfig, workspace, days);
      allResults.push(result);

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const resultPath = path.join(RESULTS_DIR, `archaeology-${agentId}-${ts}.json`);
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
      console.log(`  ✅ 结果已保存: ${resultPath}`);

      const report = generateReport(result);
      const reportPath = path.join(RESULTS_DIR, `archaeology-${agentId}-${ts}.md`);
      fs.writeFileSync(reportPath, report);
      console.log(`  📄 报告已保存: ${reportPath}`);
    } catch (e) {
      console.log(`  ❌ 考古失败: ${e.message}`);
    }
  }

  // 汇总
  if (allResults.length > 1) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log('  📊 汇总排名');
    console.log(`${'─'.repeat(50)}`);
    const ranked = allResults.sort((a, b) => b.final_score - a.final_score);
    ranked.forEach((r, i) => {
      const bar = '█'.repeat(Math.round(r.final_score)) + '░'.repeat(10 - Math.round(r.final_score));
      console.log(`  ${i+1}. ${r.agent_id.padEnd(12)} ${bar} ${r.final_score.toFixed(1)}/10`);
    });
  }

  console.log(`\n✅ 行为考古完成`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });