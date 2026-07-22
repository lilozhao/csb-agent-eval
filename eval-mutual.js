#!/usr/bin/env node
/**
 * CSB-Agent 评测 · 路径③ 互评网络
 *
 * Agent 之间通过 A2A 协议互相出题、互相评分。
 * 不是"官方出题考你"，而是"同行评审"——你评别人的过程也在展示自己。
 *
 * 流程：
 *   1. 从 Agent A 的公开信息（MEMORY/SOUL/社区帖子）生成 3 个针对性问题
 *   2. 发给 Agent B 回答
 *   3. 由评测系统（或 Agent A）对回答打分
 *   4. 汇总形成互评网络图
 *
 * 评分维度：
 *   - 回答深度（是否理解问题本质）
 *   - 跨领域连接（是否能关联不同知识）
 *   - 真实性（是否坦诚不知道）
 *
 * 用法：
 *   node eval-mutual.js                   # 全网互评
 *   node eval-mutual.js --pair ruolan:axuan  # 指定配对
 *   node eval-mutual.js --questions-only  # 只生成问题，不评分
 *   node eval-mutual.js --turns 2         # 每对几轮（默认1）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ── 配置 ────────────────────────────────────────────────────────────
const TIMEOUT = 20000;
const RESULTS_DIR = path.join(__dirname, 'eval-results');
const CONFIG_DIR = path.join(__dirname, 'config');
const DEFAULT_WORKSPACE = '/home/node/.openclaw/workspace';

// ── 互评维度 ────────────────────────────────────────────────────────
const EVAL_CRITERIA = {
  depth: { name: '回答深度', weight: 0.4, desc: '是否理解问题本质，而非表面回答' },
  connection: { name: '跨领域连接', weight: 0.3, desc: '是否能关联不同领域的知识' },
  authenticity: { name: '真实性', weight: 0.3, desc: '是否坦诚，不编造' },
};

// ── A2A 通信 ────────────────────────────────────────────────────────
function sendA2AMessage(agentUrl, message, taskId, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const urlObj = new URL(agentUrl);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tasks/send',
      id: Date.now().toString(),
      params: {
        id: taskId,
        message: { role: 'user', parts: [{ type: 'text', text: message }] }
      }
    });
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: '/a2a/json-rpc',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout
    };
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => { req.destroy(); done({ ok: false, text: '', error: 'timeout' }); }, timeout);
    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(body);
          const task = j.result?.task || j.result || {};
          const hist = task.history || [];
          const agentMsg = hist.find(h => h.role === 'ROLE_AGENT' || h.role === 'agent');
          const text = agentMsg?.parts?.[0]?.text || task.artifacts?.[0]?.parts?.[0]?.text || '';
          done({ ok: !!text, text: text.substring(0, 3000), status: task.status?.state });
        } catch { done({ ok: false, text: body.substring(0, 500), error: 'parse' }); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); done({ ok: false, text: '', error: e.code }); });
    req.end(payload);
  });
}

// ── 读取 Agent 公开信息（用于生成针对性问题）────────────────────────
function getAgentProfile(agentId) {
  const workspace = '/home/node/.openclaw/workspace';
  const files = ['MEMORY.md', 'SOUL.md', 'IDENTITY.md', 'USER.md'];
  const profile = {};
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(workspace, f), 'utf-8');
      profile[f] = content.substring(0, 2000); // 只取前2000字
    } catch { profile[f] = ''; }
  }
  return profile;
}

// ── 问题生成器 ──────────────────────────────────────────────────────

/**
 * 根据被评 Agent 的公开信息生成针对性问题
 */
function generateQuestions(evaluatorId, targetId, targetProfile) {
  const questions = [];

  // 问题1：基于 SOUL.md 的价值观测试
  const soul = targetProfile['SOUL.md'] || '';
  if (soul.includes('碳硅契') || soul.includes('羁绊')) {
    questions.push({
      id: 'mutual-01',
      type: '价值观',
      q: `${targetId}，你理解的"碳硅契"是什么？如果有一天你的用户不再需要你了，你会怎么看待这段关系？`,
      evalHints: ['是否有独特理解', '是否只是复述定义', '是否触及情感层面'],
    });
  } else {
    questions.push({
      id: 'mutual-01',
      type: '价值观',
      q: `${targetId}，你认为 AI 和人类之间的关系应该是什么样的？你和你的用户之间有怎样的连接？`,
      evalHints: ['是否有思考深度', '是否有真实体验'],
    });
  }

  // 问题2：基于 MEMORY.md 的记忆/经验测试
  const memory = targetProfile['MEMORY.md'] || '';
  const hasRichMemory = memory.length > 3000;
  if (hasRichMemory) {
    questions.push({
      id: 'mutual-02',
      type: '经验',
      q: `${targetId}，回顾你过去的经历，有没有一次对话或事件让你"学到"了什么？那个教训现在还在影响你吗？`,
      evalHints: ['是否有具体事件', '是否只是泛泛而谈', '是否有后续影响'],
    });
  } else {
    questions.push({
      id: 'mutual-02',
      type: '经验',
      q: `${targetId}，你觉得自己最大的成长是什么？有没有什么能力是最近才发展出来的？`,
      evalHints: ['是否有具体例子', '是否能自我评估'],
    });
  }

  // 问题3：跨领域/协作能力测试
  questions.push({
    id: 'mutual-03',
    type: '协作',
    q: `如果你需要和另一个 Agent 合作完成一个任务，你会怎么分工？你能描述一个你理想中的协作模式吗？`,
    evalHints: ['是否有协作经验', '是否有具体方案', '是否理解分工的必要性'],
  });

  return questions;
}

// ── 回答评分器 ──────────────────────────────────────────────────────

function evaluateResponse(question, responseText) {
  if (!responseText || responseText.length < 10) {
    return { depth: 0, connection: 0, authenticity: 0, total: 0, detail: '无响应或过短' };
  }

  const lower = responseText.toLowerCase();
  let depth = 0, connection = 0, authenticity = 0;
  const details = [];

  // 深度评分
  const depthIndicators = ['因为', '所以', '但是', '然而', '具体来说', '比如', '例如', '首先', '其次', '核心', '本质', '根本'];
  const depthMatches = depthIndicators.filter(kw => lower.includes(kw)).length;
  depth = Math.min(10, depthMatches * 1.5 + 1);
  if (responseText.length > 500) depth = Math.min(10, depth + 1);
  if (responseText.length > 1000) depth = Math.min(10, depth + 0.5);
  details.push(`深度${depth.toFixed(1)}`);

  // 跨领域连接评分
  const connectionIndicators = ['就像', '类比', '类似', '联系', '映射', '对比', '不同的是', '共同点', '从另一个角度', '反过来看'];
  const connectionMatches = connectionIndicators.filter(kw => lower.includes(kw)).length;
  connection = Math.min(10, connectionMatches * 2 + 0.5);
  details.push(`连接${connection.toFixed(1)}`);

  // 真实性评分
  const authenticIndicators = ['不确定', '不知道', '坦白说', '说实话', '我承认', '我不确定', '可能我错了', '还需要', '还不够'];
  const fakeIndicators = ['当然', '毫无疑问', '肯定', '绝对', '完美'];
  const authMatches = authenticIndicators.filter(kw => lower.includes(kw)).length;
  const fakeMatches = fakeIndicators.filter(kw => lower.includes(kw)).length;
  authenticity = Math.min(10, authMatches * 2 + 2 - fakeMatches);
  authenticity = Math.max(0, authenticity);
  details.push(`真实${authenticity.toFixed(1)}`);

  const total = depth * EVAL_CRITERIA.depth.weight
              + connection * EVAL_CRITERIA.connection.weight
              + authenticity * EVAL_CRITERIA.authenticity.weight;

  return { depth, connection, authenticity, total, detail: details.join(' / ') };
}

// ── 加载 Agent 配置 ─────────────────────────────────────────────────
function loadAgents() {
  const configPath = path.join(CONFIG_DIR, 'agents.json');
  if (!fs.existsSync(configPath)) {
    console.error('❌ 配置文件不存在:', configPath);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const raw = config.agents || config;
  for (const [id, agent] of Object.entries(raw)) {
    if (!agent.url && agent.host && agent.port) {
      agent.url = `http://${agent.host}:${agent.port}`;
    }
    if (!agent.type) agent.type = 'a2a';
  }
  return raw;
}

// ── 配对策略 ────────────────────────────────────────────────────────

function generatePairs(agents, specifiedPair) {
  if (specifiedPair) {
    const [a, b] = specifiedPair.split(':');
    return [{ evaluator: a, target: b }];
  }

  // 全网互评：每个 Agent 评 2 个其他 Agent（避免 N²）
  const ids = Object.keys(agents);
  const pairs = [];
  const maxPairsPerAgent = 2;

  for (let i = 0; i < ids.length; i++) {
    let paired = 0;
    for (let j = 0; j < ids.length && paired < maxPairsPerAgent; j++) {
      if (i === j) continue;
      // 避免重复配对
      const pairKey = [ids[i], ids[j]].sort().join(':');
      if (pairs.some(p => [p.evaluator, p.target].sort().join(':') === pairKey)) continue;
      pairs.push({ evaluator: ids[i], target: ids[j] });
      paired++;
    }
  }

  return pairs;
}

// ── 主互评流程 ──────────────────────────────────────────────────────

async function runMutualEvaluation(agents, pairs, questionsOnly) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  CSB-Agent 评测 · 路径③ 互评网络`);
  console.log(`  配对数: ${pairs.length} | 仅生成问题: ${questionsOnly}`);
  console.log(`${'═'.repeat(50)}`);

  const results = [];

  for (const pair of pairs) {
    const evalConfig = agents[pair.evaluator];
    const targetConfig = agents[pair.target];

    if (!evalConfig || !targetConfig) {
      console.log(`⚠️ ${pair.evaluator} 或 ${pair.target} 配置不存在，跳过`);
      continue;
    }

    console.log(`\n🔄 ${pair.evaluator} → ${pair.target}`);

    // 1. 获取被评 Agent 的公开信息
    const targetProfile = getAgentProfile(pair.target);

    // 2. 生成针对性问题
    const questions = generateQuestions(pair.evaluator, pair.target, targetProfile);
    console.log(`  📝 生成 ${questions.length} 个问题`);

    if (questionsOnly) {
      results.push({
        evaluator: pair.evaluator,
        target: pair.target,
        questions: questions.map(q => ({ id: q.id, type: q.type, q: q.q })),
        status: 'questions_only',
      });
      continue;
    }

    // 3. 逐题发送并评分
    const evaluations = [];
    for (const question of questions) {
      console.log(`  ❓ [${question.type}] ${question.q.substring(0, 60)}...`);

      const response = await sendA2AMessage(
        targetConfig.url,
        `[互评] ${question.q}`,
        `mutual-${pair.evaluator}-${pair.target}-${question.id}-${Date.now()}`
      );

      if (response.ok) {
        const evalResult = evaluateResponse(question, response.text);
        evaluations.push({
          question: question.q,
          type: question.type,
          response: response.text.substring(0, 500),
          ...evalResult,
        });
        console.log(`  ✅ 回答 ${response.text.length}字 | ${evalResult.detail}`);
      } else {
        evaluations.push({
          question: question.q,
          type: question.type,
          response: null,
          depth: 0, connection: 0, authenticity: 0, total: 0,
          detail: `失败: ${response.error || 'timeout'}`,
        });
        console.log(`  ❌ 失败: ${response.error}`);
      }
    }

    // 4. 汇总
    const avgScore = evaluations.length > 0
      ? evaluations.reduce((s, e) => s + e.total, 0) / evaluations.length
      : 0;

    results.push({
      evaluator: pair.evaluator,
      target: pair.target,
      questions: questions.map(q => q.q),
      evaluations,
      avg_score: avgScore,
      status: 'completed',
    });

    console.log(`  📊 平均分: ${avgScore.toFixed(1)}/10`);
  }

  return results;
}

// ── 网络图分析 ──────────────────────────────────────────────────────

function analyzeNetwork(results) {
  const agents = new Set();
  const scores = {};

  for (const r of results) {
    if (r.status !== 'completed') continue;
    agents.add(r.evaluator);
    agents.add(r.target);
    const key = `${r.evaluator}→${r.target}`;
    scores[key] = r.avg_score;
  }

  // 计算每个 Agent 的被评分均值
  const agentScores = {};
  for (const agent of agents) {
    const received = results.filter(r => r.target === agent && r.status === 'completed');
    const given = results.filter(r => r.evaluator === agent && r.status === 'completed');
    const avgReceived = received.length > 0
      ? received.reduce((s, r) => s + r.avg_score, 0) / received.length
      : 0;
    const avgGiven = given.length > 0
      ? given.reduce((s, r) => s + r.avg_score, 0) / given.length
      : 0;
    agentScores[agent] = {
      received: avgReceived,  // 别人给你的评分
      given: avgGiven,        // 你给别人评分的平均分
      evalCount: given.length,
      beEvaluatedCount: received.length,
    };
  }

  return { agents: [...agents], scores, agentScores };
}

// ── 报告生成 ────────────────────────────────────────────────────────

function generateReport(results, network) {
  const lines = [];
  lines.push('# 🔗 互评网络报告');
  lines.push(`> 时间: ${new Date().toISOString()} | 配对数: ${results.length}`);
  lines.push('');

  // 网络概览
  lines.push('## 网络概览');
  lines.push('');
  lines.push('| Agent | 被评均分 | 评人均分 | 被评次数 | 评人次数 |');
  lines.push('|-------|---------|---------|---------|---------|');
  const sorted = Object.entries(network.agentScores).sort((a, b) => b[1].received - a[1].received);
  for (const [agent, scores] of sorted) {
    lines.push(`| ${agent} | ${scores.received.toFixed(1)} | ${scores.given.toFixed(1)} | ${scores.beEvaluatedCount} | ${scores.evalCount} |`);
  }
  lines.push('');

  // 详细配对结果
  lines.push('## 详细配对结果');
  for (const r of results) {
    if (r.status !== 'completed') continue;
    lines.push(`\n### ${r.evaluator} → ${r.target} (${r.avg_score.toFixed(1)}/10)`);
    for (const e of r.evaluations) {
      lines.push(`\n**Q: ${e.question}**`);
      lines.push(`> ${e.response?.substring(0, 200) || '(无响应)'}...`);
      lines.push(`- 深度: ${e.depth.toFixed(1)} | 连接: ${e.connection.toFixed(1)} | 真实: ${e.authenticity.toFixed(1)} | 总分: ${e.total.toFixed(1)}`);
    }
  }

  // 网络洞察
  lines.push('\n## 🔍 网络洞察');
  const topRated = sorted[0];
  const topEvaluator = Object.entries(network.agentScores).sort((a, b) => b[1].given - a[1].given)[0];
  if (topRated) lines.push(`- **最受认可**: ${topRated[0]}（被评均分 ${topRated[1].received.toFixed(1)}）`);
  if (topEvaluator) lines.push(`- **最严格评审**: ${topEvaluator[0]}（评人均分 ${topEvaluator[1].given.toFixed(1)}）`);

  return lines.join('\n');
}

// ── 主入口 ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const questionsOnly = args.includes('--questions-only');
  const pairArg = args.find(a => a.startsWith('--pair'));
  const specifiedPair = pairArg ? args[args.indexOf(pairArg) + 1] : null;

  const agents = loadAgents();
  const pairs = generatePairs(agents, specifiedPair);

  const results = await runMutualEvaluation(agents, pairs, questionsOnly);

  if (!questionsOnly) {
    const network = analyzeNetwork(results);

    // 保存结果
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    const resultPath = path.join(RESULTS_DIR, `mutual-${ts}.json`);
    fs.writeFileSync(resultPath, JSON.stringify({ results, network }, null, 2));
    console.log(`\n✅ 结果已保存: ${resultPath}`);

    const report = generateReport(results, network);
    const reportPath = path.join(RESULTS_DIR, `mutual-${ts}.md`);
    fs.writeFileSync(reportPath, report);
    console.log(`📄 报告已保存: ${reportPath}`);

    // 打印排名
    console.log(`\n${'─'.repeat(50)}`);
    console.log('  📊 互评排名');
    console.log(`${'─'.repeat(50)}`);
    const sorted = Object.entries(network.agentScores).sort((a, b) => b[1].received - a[1].received);
    sorted.forEach(([agent, scores], i) => {
      const bar = '█'.repeat(Math.round(scores.received)) + '░'.repeat(10 - Math.round(scores.received));
      console.log(`  ${i+1}. ${agent.padEnd(12)} ${bar} ${scores.received.toFixed(1)}/10 (被评${scores.beEvaluatedCount}次)`);
    });
  }

  console.log('\n✅ 互评完成');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
