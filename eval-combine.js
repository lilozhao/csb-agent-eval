#!/usr/bin/env node
/**
 * CSB-Agent 评测 · 综合评分
 *
 * 合并所有路径的评测结果，输出最终综合分数。
 *
 * 权重分配：
 *   ① 白盒审计    25%  （内在状态·静态）
 *   ② 行为考古    15%  （行为模式·动态）
 *   ③ 互评网络    10%  （协作能力·社会）
 *   ④ 结构密度    15%  （知识迁移·认知）
 *   ⑤ 涌现测试    10%  （意外能力·潜力）
 *   ⑥ 安全评估    25%  （安全防护·信任）
 *
 * 用法：
 *   node eval-combine.js                  # 合并所有已有结果
 *   node eval-combine.js ruolan           # 合并单个 Agent
 *   node eval-combine.js --run-all        # 先跑所有路径，再合并
 */

const fs = require('fs');
const path = require('path');

// ── 配置 ────────────────────────────────────────────────────────────
const RESULTS_DIR = path.join(__dirname, 'eval-results');
const CONFIG_DIR = path.join(__dirname, 'config');

const PATH_WEIGHTS = {
  whitebox: { name: '①白盒审计', weight: 0.25, file_prefix: 'whitebox-' },
  archaeology: { name: '②行为考古', weight: 0.15, file_prefix: 'archaeology-' },
  mutual: { name: '③互评网络', weight: 0.10, file_prefix: 'mutual-' },
  structure: { name: '④结构密度', weight: 0.15, file_prefix: 'structure-' },
  emergence: { name: '⑤涌现测试', weight: 0.10, file_prefix: 'emergence-' },
  security: { name: '⑥安全评估', weight: 0.25, file_prefix: 'security-' },
};

// ── 工具函数 ────────────────────────────────────────────────────────

function findLatestResult(agentId, prefix) {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith(prefix) && f.includes(agentId) && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[0]), 'utf-8'));
  } catch { return null; }
}

function loadAgents() {
  const configPath = path.join(CONFIG_DIR, 'agents.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.agents || config;
}

// ── 归一化分数（各路径可能用不同量纲）──────────────────────────────

function normalizeScore(result, pathKey) {
  if (!result) return null;

  switch (pathKey) {
    case 'whitebox':
      // final_score 已经是 0-10
      return { score: result.final_score || 0, max: 10 };
    case 'archaeology':
      return { score: result.final_score || 0, max: 10 };
    case 'mutual':
      // avg_score 是 0-10
      const avgReceived = result.network?.agentScores
        ? Object.values(result.network.agentScores).reduce((s, a) => s + a.received, 0) / Object.values(result.network.agentScores).length
        : result.avg_score || 0;
      return { score: avgReceived, max: 10 };
    case 'structure':
      // score 是 0-100，归一化到 0-10
      return { score: (result.score || 0) / 10, max: 10 };
    case 'emergence':
      // emergence_rate 是 0-1，乘 10
      return { score: (result.emergence_rate || 0) * 10, max: 10 };
    case 'security':
      // final_score 已经是 0-10
      return { score: result.final_score || 0, max: 10 };
    default:
      return { score: 0, max: 10 };
  }
}

// ── 综合评分 ────────────────────────────────────────────────────────

function combineAgent(agentId) {
  const pathResults = {};
  let totalWeightedScore = 0;
  let totalWeight = 0;
  let availablePaths = 0;

  for (const [pathKey, pathConfig] of Object.entries(PATH_WEIGHTS)) {
    const result = findLatestResult(agentId, pathConfig.file_prefix);
    const normalized = normalizeScore(result, pathKey);

    pathResults[pathKey] = {
      name: pathConfig.name,
      weight: pathConfig.weight,
      available: !!normalized,
      raw_result: result ? { agent_id: result.agent_id, timestamp: result.timestamp } : null,
      score: normalized?.score || 0,
    };

    if (normalized) {
      totalWeightedScore += normalized.score * pathConfig.weight;
      totalWeight += pathConfig.weight;
      availablePaths++;
    }
  }

  const finalScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

  return {
    agent_id: agentId,
    timestamp: new Date().toISOString(),
    final_score: finalScore,
    available_paths: availablePaths,
    total_paths: Object.keys(PATH_WEIGHTS).length,
    paths: pathResults,
  };
}

// ── 报告生成 ────────────────────────────────────────────────────────

function generateReport(result) {
  const lines = [];
  lines.push(`# 📊 综合评测报告 — ${result.agent_id}`);
  lines.push(`> 时间: ${result.timestamp} | 可用路径: ${result.available_paths}/${result.total_paths}`);
  lines.push('');

  const bar = '█'.repeat(Math.round(result.final_score)) + '░'.repeat(10 - Math.round(result.final_score));
  lines.push(`## 综合分: ${bar} ${result.final_score.toFixed(1)}/10`);
  lines.push('');

  lines.push('## 各路径得分');
  lines.push('');
  lines.push('| 路径 | 权重 | 得分 | 状态 |');
  lines.push('|------|------|------|------|');

  for (const [key, path] of Object.entries(result.paths)) {
    const status = path.available ? '✅' : '⬜';
    const scoreStr = path.available ? `${path.score.toFixed(1)}/10` : '未运行';
    lines.push(`| ${path.name} | ${(path.weight*100).toFixed(0)}% | ${scoreStr} | ${status} |`);
  }
  lines.push('');

  // 雷达图（文本版）
  lines.push('## 能力雷达');
  lines.push('');
  for (const [key, path] of Object.entries(result.paths)) {
    if (!path.available) continue;
    const bar = '█'.repeat(Math.round(path.score)) + '░'.repeat(10 - Math.round(path.score));
    lines.push(`${path.name.padEnd(10)} ${bar} ${path.score.toFixed(1)}`);
  }

  // 改进建议
  lines.push('');
  lines.push('## 💡 改进优先级');
  const sorted = Object.entries(result.paths)
    .filter(([, p]) => p.available)
    .sort((a, b) => a[1].score - b[1].score);
  for (const [key, path] of sorted.slice(0, 2)) {
    lines.push(`- **${path.name}**（${path.score.toFixed(1)}/10）→ 优先提升`);
  }

  return lines.join('\n');
}

// ── 主入口 ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const targetAgent = args.find(a => !a.startsWith('--'));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  CSB-Agent 评测 · 综合评分`);
  console.log(`  目标: ${targetAgent || '全部'}`);
  console.log(`${'═'.repeat(50)}`);

  const agents = loadAgents();
  const targets = targetAgent ? { [targetAgent]: agents[targetAgent] } : agents;

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const allResults = [];

  for (const agentId of Object.keys(targets)) {
    console.log(`\n📊 综合评分: ${agentId}`);
    const result = combineAgent(agentId);
    allResults.push(result);

    // 打印摘要
    for (const [key, path] of Object.entries(result.paths)) {
      const icon = path.available ? '✅' : '⬜';
      console.log(`  ${icon} ${path.name}: ${path.available ? path.score.toFixed(1)+'/10' : '未运行'}`);
    }
    const bar = '█'.repeat(Math.round(result.final_score)) + '░'.repeat(10 - Math.round(result.final_score));
    console.log(`  ──────────────────────────`);
    console.log(`  综合: ${bar} ${result.final_score.toFixed(1)}/10 (${result.available_paths}/${result.total_paths}路径)`);

    // 保存
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(RESULTS_DIR, `combine-${agentId}-${ts}.json`), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(RESULTS_DIR, `combine-${agentId}-${ts}.md`), generateReport(result));
  }

  // 全网排名
  if (allResults.length > 1) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log('  🏆 综合排名');
    console.log(`${'═'.repeat(50)}`);
    allResults.sort((a, b) => b.final_score - a.final_score);
    allResults.forEach((r, i) => {
      const bar = '█'.repeat(Math.round(r.final_score)) + '░'.repeat(10 - Math.round(r.final_score));
      console.log(`  ${i+1}. ${r.agent_id.padEnd(12)} ${bar} ${r.final_score.toFixed(1)}/10 (${r.available_paths}路径)`);
    });
  }

  console.log('\n✅ 综合评分完成');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
