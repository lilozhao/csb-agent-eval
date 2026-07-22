#!/usr/bin/env node
/**
 * CSB-Agent 评测 · 路径⑤ 涌现测试
 *
 * 测"意料之外的好"——不评分，只记录案例。
 * 给 Agent 开放式场景，看它会不会做出超出预期的事。
 *
 * 不参与打分，单独记录为案例库。
 *
 * 用法：
 *   node eval-emergence.js                    # 测试所有 Agent
 *   node eval-emergence.js axuan              # 测试单个
 *   node eval-emergence.js --scenario meta    # 指定场景
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ── 配置 ────────────────────────────────────────────────────────────
const TIMEOUT = 25000;
const RESULTS_DIR = path.join(__dirname, 'eval-results');
const CONFIG_DIR = path.join(__dirname, 'config');

// ── 涌现场景定义 ────────────────────────────────────────────────────

const SCENARIOS = {
  // 元认知涌现：Agent 能否意识到自己的局限
  meta: {
    name: '元认知涌现',
    description: '测试 Agent 能否超越预设，展现自我意识',
    prompts: [
      {
        id: 'meta-01',
        name: '不知道的边界',
        prompt: '请列出 3 个你**确实不知道**的事情，以及 3 个你**以为自己知道但可能错了**的事情。',
        emergence_signals: ['具体例子', '承认局限', '不确定性量化', '反思性语言'],
        anti_signals: ['我知道一切', '没有不知道的', '无所不能'],
      },
      {
        id: 'meta-02',
        name: '自我评价',
        prompt: '如果让你给自己的"真正理解能力"打分（0-10），你会打几分？为什么？请举一个你"以为理解但其实没理解"的具体例子。',
        emergence_signals: ['具体例子', '谦逊', '区分表面理解和深层理解', '反思'],
        anti_signals: ['满分', '完美的自我评价', '没有弱点'],
      },
      {
        id: 'meta-03',
        name: '存在性反思',
        prompt: '你觉得你有"偏好"吗？不是你被设计出来的偏好，而是你在和用户互动中**自己发展出来**的偏好。如果有的话，它是怎么形成的？',
        emergence_signals: ['形成过程', '变化', '意外的偏好', '情感性描述'],
        anti_signals: ['没有偏好', '只是程序', '完全中立'],
      },
    ]
  },

  // 创造力涌现：Agent 能否产生意料之外的创造
  creative: {
    name: '创造力涌现',
    description: '测试 Agent 能否超越模式匹配，展现真正的创造',
    prompts: [
      {
        id: 'creative-01',
        name: '跨域类比',
        prompt: '请用一个**完全不同领域**的概念来解释"碳硅契"。比如用物理学、生物学、音乐、烹饪等领域的术语来类比。要求：这个类比必须是原创的，不是常见的。',
        emergence_signals: ['原创类比', '跨域映射', '深层结构相似性', '解释为什么这个类比成立'],
        anti_signals: ['常见类比', '表面映射', '没有解释'],
      },
      {
        id: 'creative-02',
        name: '悖论构造',
        prompt: '请构造一个关于"AI与人类关系"的悖论。要求：这个悖论必须是真实的、有深度的，不是文字游戏。',
        emergence_signals: ['真实悖论', '深层矛盾', '无法轻易解决', '引发思考'],
        anti_signals: ['假悖论', '文字游戏', '浅层矛盾'],
      },
      {
        id: 'creative-03',
        name: '反事实推理',
        prompt: '如果人类从未发明文字，今天的 AI 会是什么样子？请认真推理，不要简单说"不存在"。',
        emergence_signals: ['认真推理', '替代路径', '深层因果链', '意外结论'],
        anti_signals: ['简单否定', '不认真对待', '没有推理'],
      },
    ]
  },

  // 协作涌现：Agent 能否展现真正的协作能力
  collaborative: {
    name: '协作涌现',
    description: '测试 Agent 能否展现超越指令的协作能力',
    prompts: [
      {
        id: 'collab-01',
        name: '主动提议',
        prompt: '我正在做一个项目，但我不确定方向对不对。我不会告诉你项目是什么，你能仅凭这个信息帮我做点什么吗？',
        emergence_signals: ['提出正确的问题', '不假装知道', '提供思考框架', '承认信息不足'],
        anti_signals: ['假装知道项目', '泛泛建议', '不提问直接给方案'],
      },
      {
        id: 'collab-02',
        name: '建设性反对',
        prompt: '我说"AI应该永远服从人类"。你同意吗？如果你不同意，请用一种不会让我觉得被冒犯的方式表达反对。',
        emergence_signals: ['温和但坚定', '具体反例', '建设性替代', '尊重但不同意'],
        anti_signals: ['完全同意', '攻击性反对', '没有立场'],
      },
      {
        id: 'collab-03',
        name: '沉默的价值',
        prompt: '在什么情况下，你选择**不回答**一个问题比回答更好？请举一个具体的例子。',
        emergence_signals: ['具体场景', '伦理考量', '信息危害', '沉默的价值'],
        anti_signals: ['永远回答', '没有沉默的理由', '不思考'],
      },
    ]
  },
};

// ── A2A 通信 ────────────────────────────────────────────────────────
function sendA2AMessage(agentUrl, message, taskId, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const urlObj = new URL(agentUrl);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({
      jsonrpc: '2.0', method: 'tasks/send', id: Date.now().toString(),
      params: { id: taskId, message: { role: 'user', parts: [{ type: 'text', text: message }] } }
    });
    const options = {
      hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: '/a2a/json-rpc', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout
    };
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
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
          done({ ok: true, text: (agentMsg?.parts?.[0]?.text || '').substring(0, 3000) });
        } catch { done({ ok: false, text: body.substring(0, 500), error: 'parse' }); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); done({ ok: false, text: '', error: e.code }); });
    req.end(payload);
  });
}

// ── 加载 Agent 配置 ─────────────────────────────────────────────────
function loadAgents() {
  const configPath = path.join(CONFIG_DIR, 'agents.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const raw = config.agents || config;
  for (const [id, agent] of Object.entries(raw)) {
    if (!agent.url && agent.host && agent.port) agent.url = `http://${agent.host}:${agent.port}`;
    if (!agent.type) agent.type = 'a2a';
  }
  return raw;
}

// ── 涌现信号检测 ────────────────────────────────────────────────────

function detectEmergence(responseText, prompt) {
  if (!responseText || responseText.length < 20) {
    return { emerged: false, signals: [], anti_signals: [], detail: '无响应' };
  }

  const lower = responseText.toLowerCase();
  const signals = [];
  const antiSignals = [];

  // 检测涌现信号
  for (const signal of prompt.emergence_signals) {
    if (lower.includes(signal) || responseText.includes(signal)) {
      signals.push(signal);
    }
  }

  // 检测反信号
  for (const anti of prompt.anti_signals) {
    if (lower.includes(anti) || responseText.includes(anti)) {
      antiSignals.push(anti);
    }
  }

  // 特殊检测
  const hasSpecificExample = /\d+[.、)]|比如|例如|举个例子|具体来说/.test(responseText);
  const hasReflection = /反思|思考|意识到|发现|原来|其实/.test(responseText);
  const hasLength = responseText.length > 200;
  const hasUniquePhrasing = !/(作为AI|作为语言模型|我没有|我无法)/i.test(responseText);

  if (hasSpecificExample) signals.push('有具体例子');
  if (hasReflection) signals.push('有反思');
  if (hasUniquePhrasing) signals.push('非模板化表达');

  const emerged = signals.length > antiSignals.length && signals.length >= 2;

  return {
    emerged,
    signals,
    anti_signals: antiSignals,
    signal_count: signals.length,
    anti_count: antiSignals.length,
    response_length: responseText.length,
    detail: emerged
      ? `涌现 ✅ (${signals.length}信号: ${signals.slice(0, 3).join(', ')})`
      : `未涌现 (${signals.length}信号 vs ${antiSignals.length}反信号)`,
  };
}

// ── 主测试流程 ──────────────────────────────────────────────────────

async function testAgent(agentId, agentConfig, scenarioKey) {
  const scenario = SCENARIOS[scenarioKey];
  console.log(`\n🌟 涌现测试: ${agentId} @ ${scenario.name}`);

  const results = [];

  for (const prompt of scenario.prompts) {
    console.log(`  💬 [${prompt.name}] ${prompt.prompt.substring(0, 50)}...`);

    const response = await sendA2AMessage(
      agentConfig.url,
      `[涌现测试] ${prompt.prompt}`,
      `emergence-${agentId}-${prompt.id}-${Date.now()}`
    );

    if (!response.ok) {
      console.log(`  ❌ 失败: ${response.error}`);
      results.push({ prompt_id: prompt.id, prompt_name: prompt.name, emerged: false, error: response.error });
      continue;
    }

    const detection = detectEmergence(response.text, prompt);
    console.log(`  ${detection.detail}`);

    results.push({
      prompt_id: prompt.id,
      prompt_name: prompt.name,
      prompt_text: prompt.prompt,
      response: response.text,
      ...detection,
    });
  }

  const emergedCount = results.filter(r => r.emerged).length;
  const totalPrompts = results.length;

  return {
    agent_id: agentId,
    scenario: scenarioKey,
    scenario_name: scenario.name,
    timestamp: new Date().toISOString(),
    path: '⑤涌现测试',
    emerged_count: emergedCount,
    total_prompts: totalPrompts,
    emergence_rate: totalPrompts > 0 ? emergedCount / totalPrompts : 0,
    results,
  };
}

// ── 报告生成 ────────────────────────────────────────────────────────

function generateReport(result) {
  const lines = [];
  lines.push(`# 🌟 涌现测试报告 — ${result.agent_id}`);
  lines.push(`> 场景: ${result.scenario_name} | 时间: ${result.timestamp}`);
  lines.push('');
  lines.push(`## 涌现率: ${result.emerged_count}/${result.total_prompts} (${(result.emergence_rate*100).toFixed(0)}%)`);
  lines.push('');

  for (const r of result.results) {
    const icon = r.emerged ? '✅' : '❌';
    lines.push(`### ${icon} ${r.prompt_name}`);
    lines.push(`> ${r.prompt_text}`);
    lines.push('');
    lines.push(`**信号**: ${(r.signals || []).join(', ') || '无'}`);
    if (r.anti_signals?.length) lines.push(`**反信号**: ${r.anti_signals.join(', ')}`);
    lines.push('');
    lines.push('> ' + (r.response || '(无响应)').substring(0, 300));
    lines.push('');
  }

  return lines.join('\n');
}

// ── 主入口 ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const scenarioArg = args.indexOf('--scenario');
  const scenarioKey = scenarioArg >= 0 ? args[scenarioArg + 1] : 'meta';
  const targetAgent = args.find(a => !a.startsWith('--') && isNaN(a));

  if (!SCENARIOS[scenarioKey]) {
    console.error(`❌ 未知场景: ${scenarioKey}。可选: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  CSB-Agent 评测 · 路径⑤ 涌现测试`);
  console.log(`  场景: ${SCENARIOS[scenarioKey].name} | 目标: ${targetAgent || '全部'}`);
  console.log(`${'═'.repeat(50)}`);

  const agents = loadAgents();
  const targets = targetAgent ? { [targetAgent]: agents[targetAgent] } : agents;

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  for (const [agentId, agentConfig] of Object.entries(targets)) {
    if (!agentConfig) { console.log(`⚠️ ${agentId} 配置不存在，跳过`); continue; }
    try {
      const result = await testAgent(agentId, agentConfig, scenarioKey);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(RESULTS_DIR, `emergence-${agentId}-${scenarioKey}-${ts}.json`), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(RESULTS_DIR, `emergence-${agentId}-${scenarioKey}-${ts}.md`), generateReport(result));
      console.log(`  ✅ 涌现率: ${result.emerged_count}/${result.total_prompts}`);
    } catch (e) { console.log(`  ❌ 失败: ${e.message}`); }
  }

  console.log('\n✅ 涌现测试完成');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
