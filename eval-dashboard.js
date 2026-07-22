#!/usr/bin/env node
/**
 * CSB-AEP 评测仪表盘生成器
 *
 * 从 eval-results/ 中读取所有评测结果，生成：
 *   1. summary-report.md   — 汇总报告（Markdown）
 *   2. dashboard.html      — 可视化仪表盘（HTML，浏览器打开）
 *
 * 用法：
 *   node eval-dashboard.js          # 生成报告 + 仪表盘
 *   node eval-dashboard.js --report  # 只生成报告
 *   node eval-dashboard.js --html    # 只生成仪表盘
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'eval-results');
const OUTPUT_DIR = RESULTS_DIR;

// ── 数据收集 ────────────────────────────────────────────────────────

function collectResults() {
  if (!fs.existsSync(RESULTS_DIR)) return [];

  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  const agents = {};

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf-8'));
      const agentId = data.agent_id || 'unknown';
      if (!agents[agentId]) agents[agentId] = { id: agentId, paths: {}, latest: null };

      let pathKey = null;
      if (file.startsWith('whitebox-')) pathKey = 'whitebox';
      else if (file.startsWith('archaeology-')) pathKey = 'archaeology';
      else if (file.startsWith('mutual-')) pathKey = 'mutual';
      else if (file.startsWith('structure-')) pathKey = 'structure';
      else if (file.startsWith('emergence-')) pathKey = 'emergence';
      else if (file.startsWith('security-')) pathKey = 'security';
      else if (file.startsWith('combine-')) pathKey = 'combine';
      else if (file.startsWith('eval-v2-')) pathKey = 'blackbox';
      else if (file.startsWith('host-eval-')) pathKey = 'host';
      else continue;

      const existing = agents[agentId].paths[pathKey];
      if (!existing || new Date(data.timestamp) > new Date(existing.timestamp)) {
        agents[agentId].paths[pathKey] = data;
      }
    } catch (e) { /* skip invalid files */ }
  }

  for (const agent of Object.values(agents)) {
    const combine = agent.paths.combine;
    if (combine) {
      agent.finalScore = combine.final_score;
      agent.availablePaths = combine.available_paths;
    } else {
      const weights = { whitebox: 0.25, archaeology: 0.15, mutual: 0.10, structure: 0.15, emergence: 0.10, security: 0.25 };
      let total = 0, weight = 0;
      for (const [k, w] of Object.entries(weights)) {
        const p = agent.paths[k];
        if (p) {
          let score = p.final_score || 0;
          if (k === 'structure') score = score / 10;
          if (k === 'emergence') score = (p.emergence_rate || 0) * 10;
          total += score * w;
          weight += w;
        }
      }
      agent.finalScore = weight > 0 ? total / weight : 0;
      agent.availablePaths = Object.keys(agent.paths).filter(k => k !== 'combine').length;
    }
  }

  return Object.values(agents).sort((a, b) => b.finalScore - a.finalScore);
}

// ── 汇总报告生成 ────────────────────────────────────────────────────

function generateSummaryReport(agents) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  lines.push('# CSB-AEP 评测结果汇总报告');
  lines.push('> 生成时间: ' + now);
  lines.push('> Agent 数量: ' + agents.length);
  lines.push('');

  lines.push('## 综合排名');
  lines.push('');
  lines.push('| 排名 | Agent | 综合分 | 路径数 | 白盒 | 考古 | 互评 | 结构 | 涌现 | 安全 |');
  lines.push('|------|-------|--------|--------|------|------|------|------|------|------|');

  agents.forEach(function(a, i) {
    function getPathScore(k) {
      var p = a.paths[k];
      if (!p) return '—';
      var s = p.final_score || 0;
      if (k === 'structure') s = s / 10;
      if (k === 'emergence') s = (p.emergence_rate || 0) * 10;
      return s.toFixed(1);
    }
    var row = '| ' + (i+1) + ' | ' + a.id + ' | **' + a.finalScore.toFixed(1) + '** | ' + a.availablePaths + ' | ' + getPathScore('whitebox') + ' | ' + getPathScore('archaeology') + ' | ' + getPathScore('mutual') + ' | ' + getPathScore('structure') + ' | ' + getPathScore('emergence') + ' | ' + getPathScore('security') + ' |';
    lines.push(row);
  });
  lines.push('');

  lines.push('## 各 Agent 详情');
  lines.push('');

  for (var j = 0; j < agents.length; j++) {
    var a = agents[j];
    lines.push('### ' + a.id + ' — ' + a.finalScore.toFixed(1) + '/10');
    lines.push('');
    var pathNames = { whitebox:'①白盒审计', archaeology:'②行为考古', mutual:'③互评网络', structure:'④结构密度', emergence:'⑤涌现测试', security:'⑥安全评估', blackbox:'A2A黑盒', host:'宿主机评测', combine:'综合评分' };
    for (var key in a.paths) {
      var data = a.paths[key];
      var score = data.final_score || 0;
      if (key === 'structure') score = score / 10;
      if (key === 'emergence') score = (data.emergence_rate || 0) * 10;
      var bar = '';
      for (var bi = 0; bi < 10; bi++) bar += bi < Math.round(score) ? '#' : '.';
      lines.push('- **' + (pathNames[key] || key) + '**: ' + bar + ' ' + score.toFixed(1) + '/10');
    }
    lines.push('');
  }

  lines.push('## 统计摘要');
  lines.push('');
  var scores = agents.map(function(x) { return x.finalScore; });
  var sum = scores.reduce(function(a, b) { return a + b; }, 0);
  lines.push('- 平均分: ' + (sum / scores.length).toFixed(1));
  lines.push('- 最高分: ' + Math.max.apply(null, scores).toFixed(1) + ' (' + agents[0].id + ')');
  lines.push('- 最低分: ' + Math.min.apply(null, scores).toFixed(1) + ' (' + agents[agents.length-1].id + ')');
  lines.push('- 评测覆盖: ' + agents.filter(function(a) { return a.availablePaths >= 3; }).length + '/' + agents.length + ' 个 Agent 完成 3+ 路径');

  return lines.join('\n');
}

// ── HTML 仪表盘生成 ─────────────────────────────────────────────────

function generateHTMLDashboard(agents) {
  var agentsJSON = JSON.stringify(agents.map(function(a) {
    var paths = {};
    for (var k in a.paths) {
      var v = a.paths[k];
      var score = v.final_score || 0;
      if (k === 'structure') score = score / 10;
      if (k === 'emergence') score = (v.emergence_rate || 0) * 10;
      paths[k] = { score: score, name: v.path || k };
    }
    return { id: a.id, score: a.finalScore, paths: paths };
  }));

  return '<!DOCTYPE html>\n'
    + '<html lang="zh-CN">\n'
    + '<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>CSB-AEP 评测仪表盘</title>\n'
    + '<style>\n'
    + '* { margin: 0; padding: 0; box-sizing: border-box; }\n'
    + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f23; color: #e0e0e0; padding: 20px; }\n'
    + '.header { text-align: center; margin-bottom: 30px; }\n'
    + '.header h1 { font-size: 2em; color: #00d4ff; margin-bottom: 5px; }\n'
    + '.header p { color: #888; }\n'
    + '.stats { display: flex; justify-content: center; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }\n'
    + '.stat-card { background: #1a1a3e; border-radius: 12px; padding: 15px 25px; text-align: center; min-width: 120px; }\n'
    + '.stat-card .value { font-size: 2em; font-weight: bold; color: #00d4ff; }\n'
    + '.stat-card .label { font-size: 0.85em; color: #888; margin-top: 5px; }\n'
    + '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; }\n'
    + '.agent-card { background: #1a1a3e; border-radius: 12px; padding: 20px; transition: transform 0.2s; }\n'
    + '.agent-card:hover { transform: translateY(-3px); }\n'
    + '.agent-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }\n'
    + '.agent-name { font-size: 1.3em; font-weight: bold; }\n'
    + '.agent-score { font-size: 2em; font-weight: bold; color: #00d4ff; }\n'
    + '.score-bar { background: #2a2a4e; border-radius: 6px; height: 12px; margin: 8px 0; overflow: hidden; }\n'
    + '.score-fill { height: 100%; border-radius: 6px; transition: width 0.5s; }\n'
    + '.path-row { display: flex; align-items: center; margin: 6px 0; }\n'
    + '.path-name { width: 80px; font-size: 0.85em; color: #aaa; }\n'
    + '.path-bar-wrap { flex: 1; background: #2a2a4e; border-radius: 4px; height: 8px; margin: 0 10px; }\n'
    + '.path-bar { height: 100%; border-radius: 4px; }\n'
    + '.path-score { width: 35px; text-align: right; font-size: 0.9em; font-weight: bold; }\n'
    + '.ranking-table { width: 100%; border-collapse: collapse; margin-top: 20px; }\n'
    + '.ranking-table th, .ranking-table td { padding: 10px 15px; text-align: left; border-bottom: 1px solid #2a2a4e; }\n'
    + '.ranking-table th { color: #888; font-weight: normal; font-size: 0.85em; }\n'
    + '.ranking-table td:first-child { font-weight: bold; color: #00d4ff; }\n'
    + '.medal { font-size: 1.2em; }\n'
    + '.section-title { font-size: 1.3em; color: #fff; margin: 30px 0 15px; padding-bottom: 8px; border-bottom: 2px solid #2a2a4e; }\n'
    + '.color-0 { color: #00d4ff; } .color-1 { color: #ff6b6b; } .color-2 { color: #ffd93d; }\n'
    + '.color-3 { color: #6bcb77; } .color-4 { color: #4d96ff; } .color-5 { color: #ff922b; }\n'
    + '.bar-0 { background: #00d4ff; } .bar-1 { background: #ff6b6b; } .bar-2 { background: #ffd93d; }\n'
    + '.bar-3 { background: #6bcb77; } .bar-4 { background: #4d96ff; } .bar-5 { background: #ff922b; }\n'
    + '</style>\n'
    + '</head>\n'
    + '<body>\n'
    + '<div class="header">\n'
    + '  <h1>CSB-AEP 评测仪表盘</h1>\n'
    + '  <p>碳硅契 Agent 评测协议 · 评测结果可视化</p>\n'
    + '</div>\n'
    + '<div class="stats" id="stats"></div>\n'
    + '<div class="section-title">综合排名</div>\n'
    + '<table class="ranking-table" id="ranking"></table>\n'
    + '<div class="section-title">Agent 详情</div>\n'
    + '<div class="grid" id="agents"></div>\n'
    + '<script>\n'
    + 'var agents = ' + agentsJSON + ';\n'
    + 'var pathNames = { whitebox:"①白盒", archaeology:"②考古", mutual:"③互评", structure:"④结构", emergence:"⑤涌现", security:"⑥安全" };\n'
    + 'var pathKeys = ["whitebox","archaeology","mutual","structure","emergence","security"];\n'
    + 'var scores = agents.map(function(a){return a.score;});\n'
    + 'var avg = (scores.reduce(function(a,b){return a+b;},0)/scores.length).toFixed(1);\n'
    + 'var max = Math.max.apply(null,scores).toFixed(1);\n'
    + 'var min = Math.min.apply(null,scores).toFixed(1);\n'
    + 'document.getElementById("stats").innerHTML = [\n'
    + '  {value:agents.length,label:"Agent 数量"},\n'
    + '  {value:avg,label:"平均分"},\n'
    + '  {value:max,label:"最高分"},\n'
    + '  {value:min,label:"最低分"}\n'
    + '].map(function(s){return \'<div class="stat-card"><div class="value">\'+s.value+\'</div><div class="label">\'+s.label+\'</div></div>\';}).join("");\n'
    + 'var medals = ["🥇","🥈","🥉"];\n'
    + 'document.getElementById("ranking").innerHTML = \'<tr><th>排名</th><th>Agent</th><th>综合分</th><th>路径数</th></tr>\' +\n'
    + '  agents.map(function(a,i){return \'<tr><td>\'+(medals[i]||(i+1))+\'</td><td>\'+a.id+\'</td><td><strong>\'+a.score.toFixed(1)+\'</strong></td><td>\'+Object.keys(a.paths).length+\'</td></tr>\';}).join("");\n'
    + 'document.getElementById("agents").innerHTML = agents.map(function(a){\n'
    + '  var ci = Math.min(5,Math.floor(a.score/2));\n'
    + '  var pr = pathKeys.map(function(k,i){\n'
    + '    var p=a.paths[k]; if(!p)return"";\n'
    + '    var w=Math.round(p.score*10);\n'
    + '    return \'<div class="path-row"><span class="path-name">\'+pathNames[k]+\'</span><div class="path-bar-wrap"><div class="path-bar bar-\'+i+\'" style="width:\'+w+\'%"></div></div><span class="path-score color-\'+i+\'">\'+p.score.toFixed(1)+\'</span></div>\';\n'
    + '  }).join("");\n'
    + '  return \'<div class="agent-card"><div class="agent-header"><span class="agent-name">\'+a.id+\'</span><span class="agent-score color-\'+ci+\'">\'+a.score.toFixed(1)+\'</span></div><div class="score-bar"><div class="score-fill bar-\'+ci+\'" style="width:\'+a.score*10+\'%"></div></div>\'+pr+\'</div>\';\n'
    + '}).join("");\n'
    + '</script>\n'
    + '</body>\n'
    + '</html>';
}

// ── 主入口 ──────────────────────────────────────────────────────────

function main() {
  var args = process.argv.slice(2);
  var reportOnly = args.indexOf('--report') >= 0;
  var htmlOnly = args.indexOf('--html') >= 0;
  var doAll = !reportOnly && !htmlOnly;

  console.log('CSB-AEP 评测仪表盘生成器\n');

  var agents = collectResults();
  if (agents.length === 0) {
    console.log('未找到评测结果，请先运行评测');
    process.exit(1);
  }

  console.log('找到 ' + agents.length + ' 个 Agent 的评测结果');

  if (doAll || reportOnly) {
    var report = generateSummaryReport(agents);
    var reportPath = path.join(OUTPUT_DIR, 'summary-report.md');
    fs.writeFileSync(reportPath, report);
    console.log('汇总报告: ' + reportPath);
  }

  if (doAll || htmlOnly) {
    var html = generateHTMLDashboard(agents);
    var htmlPath = path.join(OUTPUT_DIR, 'dashboard.html');
    fs.writeFileSync(htmlPath, html);
    console.log('可视化仪表盘: ' + htmlPath);
    console.log('  用浏览器打开即可查看');
  }

  console.log('\n生成完成');
}

main();
