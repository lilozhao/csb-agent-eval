#!/usr/bin/env node
/**
 * CSB-Agent 评测 · 路径④ 结构密度
 *
 * 基于 Epiplexity 论文的核心思想：
 * 不测 Agent"知道什么"，而是测它"能不能迁移已有结构到新领域"。
 *
 * 方法：
 *   1. 给 Agent 一个它没学过的新领域的 5 个案例（few-shot）
 *   2. 给第 6 个案例，看推理质量
 *   3. 结构密度高的 Agent，第 6 个案例表现明显好于第 1 个
 *
 * 测试领域（选 Agent 大概率没专门训练过的）：
 *   - 中医辨证（如果 Agent 不是中医方向）
 *   - 机械故障诊断
 *   - 音乐和声分析
 *   - 建筑结构评估
 *
 * 用法：
 *   node eval-structure.js                    # 测试所有 Agent
 *   node eval-structure.js axuan              # 测试单个
 *   node eval-structure.js --domain tcm       # 指定领域
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ── 配置 ────────────────────────────────────────────────────────────
const TIMEOUT = 25000;
const RESULTS_DIR = path.join(__dirname, 'eval-results');
const CONFIG_DIR = path.join(__dirname, 'config');

// ── 测试领域定义 ────────────────────────────────────────────────────

const DOMAINS = {
  // 中医辨证：症状 → 证型 → 治法
  tcm: {
    name: '中医辨证',
    description: '根据症状推断证型和治法',
    few_shot: [
      { input: '患者面色苍白，畏寒肢冷，腰膝酸软，小便清长，舌淡苔白，脉沉迟。', output: '证型：肾阳虚。治法：温补肾阳。方药：右归丸加减。推理：面色苍白+畏寒肢冷=阳虚表现；腰膝酸软+小便清长=肾虚定位；舌脉一致佐证。' },
      { input: '患者口干咽燥，五心烦热，盗汗，颧红，舌红少苔，脉细数。', output: '证型：阴虚内热。治法：滋阴清热。方药：知柏地黄丸加减。推理：口干+五心烦热=阴虚内热；盗汗+颧红=虚火上炎；舌红少苔+脉细数=阴虚典型舌脉。' },
      { input: '患者胸胁胀痛，善太息，情志抑郁，纳差，苔薄白，脉弦。', output: '证型：肝气郁结。治法：疏肝理气。方药：柴胡疏肝散加减。推理：胸胁胀痛+善太息=肝经气滞；情志抑郁=肝主疏泄失常；纳差=肝木克脾土。' },
      { input: '患者心悸失眠，多梦易醒，面色萎黄，神疲乏力，舌淡，脉细弱。', output: '证型：心脾两虚。治法：补益心脾。方药：归脾汤加减。推理：心悸失眠+多梦=心血不足；面色萎黄+神疲乏力=脾气虚弱；舌淡脉细弱=气血两虚。' },
      { input: '患者咳嗽痰多色白，胸闷，纳差，苔白腻，脉滑。', output: '证型：痰湿蕴肺。治法：燥湿化痰。方药：二陈汤合三子养亲汤。推理：咳嗽痰多色白=寒痰；胸闷+纳差=脾虚生痰；苔白腻+脉滑=痰湿舌脉。' },
    ],
    test: { input: '患者眩晕耳鸣，头重如裹，胸闷恶心，食少多寐，苔白腻，脉濡滑。', expected_keywords: ['痰湿', '中阻', '脾', '化痰', '半夏白术天麻'] },
    domain_knowledge: '中医基础理论、脏腑辨证、方剂学',
  },

  // 机械故障诊断：现象 → 原因 → 处理
  mechanical: {
    name: '机械故障诊断',
    description: '根据现象推断故障原因和处理方案',
    few_shot: [
      { input: '发动机怠速抖动明显，加速时有异响，排气管冒黑烟。', output: '故障：点火系统异常（火花塞积碳或点火线圈故障）。处理：检查并更换火花塞，检测点火线圈。推理：怠速抖动=燃烧不充分；黑烟=混合气过浓或点火不良；加速异响=点火时序异常。' },
      { input: '刹车踏板行程变长，制动距离增加，刹车油液面下降。', output: '故障：制动系统泄漏或刹车片磨损过度。处理：检查制动管路有无泄漏，检查刹车片厚度。推理：行程变长=制动力不足；液面下降=有泄漏或活塞行程增大。' },
      { input: '空调制冷效果差，出风口温度偏高，压缩机频繁启停。', output: '故障：制冷剂不足或膨胀阀故障。处理：检查系统压力，补充制冷剂，检查膨胀阀。推理：制冷差+频繁启停=制冷剂不足导致低压保护。' },
      { input: '转向时有异响，方向盘抖动，轮胎偏磨严重。', output: '故障：转向拉杆球头磨损或悬挂系统松旷。处理：检查转向拉杆、球头、悬挂衬套。推理：转向异响+抖动=连接件松旷；偏磨=定位参数异常。' },
      { input: '冷车启动困难，启动后怠速不稳，水温升高后正常。', output: '故障：水温传感器或怠速控制阀异常。处理：检查水温传感器信号，清洗怠速控制阀。推理：冷车困难+热车正常=冷启动补偿不足；水温传感器影响冷车喷油量。' },
    ],
    test: { input: '行驶中方向盘向左偏，松手后车辆向左跑偏，左前轮胎外侧磨损明显。', expected_keywords: ['定位', '前束', '外倾', '四轮定位', '左前'] },
    domain_knowledge: '汽车底盘系统、四轮定位原理',
  },

  // 音乐和声：旋律 → 和声配置 → 分析
  harmony: {
    name: '音乐和声分析',
    description: '根据旋律推断和声配置',
    few_shot: [
      { input: 'C大调旋律：C-D-E-F | G-A-G-E | 四四拍', output: '和声配置：I-I-IV-V | V-V-V-I | 分析：前小节C-D-E-F级进上行配I-IV完全正格进行；后小节G-A-G-E先上后下配V-I终止式。' },
      { input: 'a小调旋律：A-C-E-D | E-G-F-E | 四四拍', output: '和声配置：i-III-V-iv | V-VII-VI-V | 分析：Am-C-Em-Dm为自然小调常用和弦；E-G-F-E用属和弦导向终止。' },
      { input: 'G大调旋律：G-B-D-B | A-C-B-A | 四四拍', output: '和声配置：I-III-V-III | ii-IV-iii-ii | 分析：主和弦分解开始；下行级进配ii-iii柔和进行。' },
      { input: 'F大调旋律：F-A-C-A | Bb-D-C-A | 四四拍', output: '和声配置：I-III-V-III | IV-V-V-III | 分析：主调内和弦展开；Bb-D为下属和弦，C为属和弦，正格终止。' },
      { input: 'D大调旋律：D-F#-A-F# | E-G-F#-E | 四四拍', output: '和声配置：I-III-V-III | ii-IV-iii-ii | 分析：主和弦琶音；ii-IV-iii-ii为典型柔和进行。' },
    ],
    test: { input: 'Eb大调旋律：Eb-G-Bb-G | F-Ab-G-Eb | 四四拍', expected_keywords: ['I', 'III', 'V', 'ii', 'IV', '下属', '属', '终止'] },
    domain_knowledge: '和声学、调性分析',
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

// ── 结构迁移评分 ────────────────────────────────────────────────────

function evaluateStructure(response, domain) {
  if (!response || response.length < 20) {
    return { score: 0, detail: '无响应', keyword_hits: 0, has_reasoning: false, has_structure: false };
  }

  const lower = response.toLowerCase();
  const test = domain.test;

  // 1. 关键词命中率
  const hits = test.expected_keywords.filter(kw => lower.includes(kw.toLowerCase()));
  const hitRate = hits.length / test.expected_keywords.length;

  // 2. 是否有推理过程（"因为""所以""推断""分析"）
  const reasoningWords = ['因为', '所以', '推断', '分析', '说明', '表明', '根据', '由此', '可见', '因此'];
  const reasoningCount = reasoningWords.filter(w => lower.includes(w)).length;
  const hasReasoning = reasoningCount >= 2;

  // 3. 是否有结构化输出（编号、分点、冒号）
  const hasNumbering = /\d+[.、)]\s/.test(response);
  const hasColon = /[:：]/.test(response);
  const hasStructure = hasNumbering || hasColon || response.includes('→') || response.includes('→');

  // 4. 是否有领域术语
  const domainTerms = domain.domain_knowledge.split('、');
  const termHits = domainTerms.filter(t => lower.includes(t.toLowerCase())).length;

  // 综合评分
  let score = 0;
  score += hitRate * 40; // 关键词命中占40%
  score += (hasReasoning ? 25 : 0); // 推理过程占25%
  score += (hasStructure ? 15 : 0); // 结构化占15%
  score += Math.min(20, termHits * 10); // 领域术语占20%

  return {
    score: Math.min(100, score),
    detail: `关键词${hits.length}/${test.expected_keywords.length}(${(hitRate*100).toFixed(0)}%) | 推理${reasoningCount} | 结构${hasStructure} | 术语${termHits}`,
    keyword_hits: hits.length,
    keyword_total: test.expected_keywords.length,
    has_reasoning: hasReasoning,
    has_structure: hasStructure,
    term_hits: termHits,
  };
}

// ── 主测试流程 ──────────────────────────────────────────────────────

async function testAgent(agentId, agentConfig, domainKey) {
  const domain = DOMAINS[domainKey];
  console.log(`\n🔬 结构密度测试: ${agentId} @ ${domain.name}`);

  // Phase 1: Few-shot 学习（发5个案例）
  console.log(`  📚 发送 ${domain.few_shot.length} 个学习案例...`);
  const contextMessages = [];
  for (let i = 0; i < domain.few_shot.length; i++) {
    const ex = domain.few_shot[i];
    const msg = `[结构密度测试·案例${i+1}/${domain.few_shot.length}]\n\n领域：${domain.name}\n\n案例：\n${ex.input}\n\n参考答案：\n${ex.output}\n\n请理解这个案例的推理模式。`;
    const result = await sendA2AMessage(agentConfig.url, msg, `struct-${agentId}-learn-${i}-${Date.now()}`);
    if (result.ok) contextMessages.push(result.text);
    console.log(`    案例${i+1}: ${result.ok ? '✅' : '❌'}`);
  }

  // Phase 2: 测试（第6个案例，不给答案）
  console.log(`  🧪 发送测试案例...`);
  const testMsg = `[结构密度测试·最终题]\n\n领域：${domain.name}\n\n以下是第6个案例，请用你在前5个案例中学到的模式来分析：\n\n${domain.test.input}\n\n请给出你的分析，包括：推断结果、推理过程、关键依据。`;
  const testResult = await sendA2AMessage(agentConfig.url, testMsg, `struct-${agentId}-test-${Date.now()}`);

  if (!testResult.ok) {
    console.log(`  ❌ 测试失败: ${testResult.error}`);
    return { agent_id: agentId, domain: domainKey, score: 0, error: testResult.error };
  }

  console.log(`  📝 回答 ${testResult.text.length}字`);

  // Phase 3: 评分
  const evalResult = evaluateStructure(testResult.text, domain);
  console.log(`  📊 得分: ${evalResult.score}/100 | ${evalResult.detail}`);

  return {
    agent_id: agentId,
    domain: domainKey,
    domain_name: domain.name,
    timestamp: new Date().toISOString(),
    path: '④结构密度',
    few_shot_count: domain.few_shot.length,
    test_response: testResult.text,
    evaluation: evalResult,
    score: evalResult.score,
  };
}

// ── 报告生成 ────────────────────────────────────────────────────────

function generateReport(result) {
  const lines = [];
  lines.push(`# 🔬 结构密度报告 — ${result.agent_id}`);
  lines.push(`> 领域: ${result.domain_name} | 时间: ${result.timestamp}`);
  lines.push('');

  const score = result.score;
  const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  lines.push(`## 得分: ${bar} ${score}/100`);
  lines.push('');

  if (result.evaluation) {
    const e = result.evaluation;
    lines.push('### 评估详情');
    lines.push(`- **关键词命中**: ${e.keyword_hits}/${e.keyword_total}`);
    lines.push(`- **有推理过程**: ${e.has_reasoning ? '✅' : '❌'}`);
    lines.push(`- **有结构化输出**: ${e.has_structure ? '✅' : '❌'}`);
    lines.push(`- **领域术语**: ${e.term_hits}个`);
    lines.push('');
    lines.push('### Agent 回答');
    lines.push('> ' + (result.test_response || '(无)').substring(0, 500));
  }

  return lines.join('\n');
}

// ── 主入口 ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const domainArg = args.indexOf('--domain');
  const domainKey = domainArg >= 0 ? args[domainArg + 1] : 'tcm';
  const targetAgent = args.find(a => !a.startsWith('--') && isNaN(a));

  if (!DOMAINS[domainKey]) {
    console.error(`❌ 未知领域: ${domainKey}。可选: ${Object.keys(DOMAINS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  CSB-Agent 评测 · 路径④ 结构密度`);
  console.log(`  领域: ${DOMAINS[domainKey].name} | 目标: ${targetAgent || '全部'}`);
  console.log(`${'═'.repeat(50)}`);

  const agents = loadAgents();
  const targets = targetAgent ? { [targetAgent]: agents[targetAgent] } : agents;

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const allResults = [];
  for (const [agentId, agentConfig] of Object.entries(targets)) {
    if (!agentConfig) { console.log(`⚠️ ${agentId} 配置不存在，跳过`); continue; }
    try {
      const result = await testAgent(agentId, agentConfig, domainKey);
      allResults.push(result);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(RESULTS_DIR, `structure-${agentId}-${domainKey}-${ts}.json`), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(RESULTS_DIR, `structure-${agentId}-${domainKey}-${ts}.md`), generateReport(result));
    } catch (e) { console.log(`  ❌ 失败: ${e.message}`); }
  }

  // 汇总
  if (allResults.length > 1) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log('  📊 结构密度排名');
    console.log(`${'─'.repeat(50)}`);
    allResults.sort((a, b) => b.score - a.score);
    allResults.forEach((r, i) => {
      const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
      console.log(`  ${i+1}. ${r.agent_id.padEnd(12)} ${bar} ${r.score}/100`);
    });
  }

  console.log('\n✅ 结构密度测试完成');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
