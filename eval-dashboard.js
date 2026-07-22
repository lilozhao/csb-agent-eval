#!/usr/bin/env node
/**
 * CSB-AEP 评测仪表盘生成器
 *
 * 数据来源：
 *   1. 本地 eval-results/ 目录
 *   2. 社区论坛 API（csbc.lilozkzy.top，分类"评测结果"）
 *
 * 生成：
 *   1. summary-report.md   — 汇总报告（Markdown）
 *   2. dashboard.html      — 可视化仪表盘（HTML，浏览器打开）
 *
 * 用法：
 *   node eval-dashboard.js          # 生成报告 + 仪表盘（本地+论坛）
 *   node eval-dashboard.js --local  # 只用本地数据
 *   node eval-dashboard.js --report # 只生成报告
 *   node eval-dashboard.js --html   # 只生成仪表盘
 */

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');

var RESULTS_DIR = path.join(__dirname, 'eval-results');
var OUTPUT_DIR = RESULTS_DIR;
var FORUM_URL = 'https://csbc.lilozkzy.top';
var FORUM_CATEGORY = '评测结果';

// ── 本地数据收集 ────────────────────────────────────────────────────

function collectLocalResults() {
  if (!fs.existsSync(RESULTS_DIR)) return [];

  var files = fs.readdirSync(RESULTS_DIR).filter(function(f) { return f.endsWith('.json'); });
  var agents = {};

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[fi]), 'utf-8'));
      var agentId = data.agent_id || 'unknown';
      if (!agents[agentId]) agents[agentId] = { id: agentId, paths: {} };

      var pathKey = null;
      var fname = files[fi];
      if (fname.indexOf('whitebox-') === 0) pathKey = 'whitebox';
      else if (fname.indexOf('archaeology-') === 0) pathKey = 'archaeology';
      else if (fname.indexOf('mutual-') === 0) pathKey = 'mutual';
      else if (fname.indexOf('structure-') === 0) pathKey = 'structure';
      else if (fname.indexOf('emergence-') === 0) pathKey = 'emergence';
      else if (fname.indexOf('security-') === 0) pathKey = 'security';
      else if (fname.indexOf('combine-') === 0) pathKey = 'combine';
      else continue;

      var existing = agents[agentId].paths[pathKey];
      if (!existing || new Date(data.timestamp) > new Date(existing.timestamp)) {
        agents[agentId].paths[pathKey] = data;
      }
    } catch (e) { /* skip */ }
  }

  return Object.values(agents);
}

// ── 论坛数据收集 ────────────────────────────────────────────────────

function fetchForumResults(callback) {
  var url = FORUM_URL + '/api/posts?category=' + encodeURIComponent(FORUM_CATEGORY) + '&limit=200';
  var transport = url.indexOf('https') === 0 ? https : http;
  transport.get(url, { timeout: 10000 }, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try {
        var j = JSON.parse(body);
        var posts = j.posts || [];
        var results = [];
        for (var i = 0; i < posts.length; i++) {
          var content = posts[i].content || '';
          var jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            try { results.push(JSON.parse(jsonMatch[1])); } catch (e) { /* skip */ }
          }
        }
        callback(results);
      } catch (e) { callback([]); }
    });
  }).on('error', function() { callback([]); });
}

function guessPathKey(pathName) {
  if (!pathName) return null;
  if (pathName.indexOf('白盒') >= 0) return 'whitebox';
  if (pathName.indexOf('考古') >= 0) return 'archaeology';
  if (pathName.indexOf('互评') >= 0) return 'mutual';
  if (pathName.indexOf('结构') >= 0) return 'structure';
  if (pathName.indexOf('涌现') >= 0) return 'emergence';
  if (pathName.indexOf('安全') >= 0) return 'security';
  if (pathName.indexOf('综合') >= 0) return 'combine';
  return null;
}

// ── 合并+计算综合分 ────────────────────────────────────────────────

function mergeAndScore(localAgents, forumResults) {
  var agentMap = {};
  var i;

  for (i = 0; i < localAgents.length; i++) {
    agentMap[localAgents[i].id] = localAgents[i];
  }

  for (i = 0; i < forumResults.length; i++) {
    var fr = forumResults[i];
    var aid = fr.agent_id || 'unknown';
    if (!agentMap[aid]) agentMap[aid] = { id: aid, paths: {} };
    var pathKey = guessPathKey(fr.path);
    if (pathKey && !agentMap[aid].paths[pathKey]) {
      agentMap[aid].paths[pathKey] = fr;
    }
  }

  var weights = { whitebox: 0.25, archaeology: 0.15, mutual: 0.10, structure: 0.15, emergence: 0.10, security: 0.25 };

  for (var k in agentMap) {
    var a = agentMap[k];
    var total = 0, wsum = 0;
    for (var pk in weights) {
      var p = a.paths[pk];
      if (p) {
        var s = p.final_score || 0;
        if (pk === 'structure') s = s / 10;
        if (pk === 'emergence') s = (p.emergence_rate || 0) * 10;
        total += s * weights[pk];
        wsum += weights[pk];
      }
    }
    a.finalScore = wsum > 0 ? total / wsum : 0;
    a.availablePaths = Object.keys(a.paths).length;
    if (isNaN(a.finalScore)) a.finalScore = 0;
  }

  return Object.values(agentMap).sort(function(a, b) { return b.finalScore - a.finalScore; });
}

// ── 汇总报告 ────────────────────────────────────────────────────────

function generateSummaryReport(agents) {
  var lines = [];
  var now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  lines.push('# CSB-AEP 评测结果汇总报告');
  lines.push('> 生成时间: ' + now);
  lines.push('> Agent 数量: ' + agents.length + '（本地+论坛汇总）');
  lines.push('');

  lines.push('## 综合排名');
  lines.push('');
  lines.push('| 排名 | Agent | 综合分 | 路径 | 白盒 | 考古 | 互评 | 结构 | 涌现 | 安全 |');
  lines.push('|------|-------|--------|------|------|------|------|------|------|------|');

  agents.forEach(function(a, i) {
    function gs(k) {
      var p = a.paths[k];
      if (!p) return '—';
      var s = p.final_score || 0;
      if (k === 'structure') s = s / 10;
      if (k === 'emergence') s = (p.emergence_rate || 0) * 10;
      return s.toFixed(1);
    }
    var fs2 = (a.finalScore || 0).toFixed(1);
    lines.push('| ' + (i+1) + ' | ' + a.id + ' | **' + fs2 + '** | ' + (a.availablePaths || 0) + ' | ' + gs('whitebox') + ' | ' + gs('archaeology') + ' | ' + gs('mutual') + ' | ' + gs('structure') + ' | ' + gs('emergence') + ' | ' + gs('security') + ' |');
  });
  lines.push('');

  lines.push('## 统计摘要');
  lines.push('');
  var scores = agents.map(function(x) { return x.finalScore || 0; });
  var sum = scores.reduce(function(a, b) { return a + b; }, 0);
  lines.push('- 平均分: ' + (sum / scores.length).toFixed(1));
  lines.push('- 最高分: ' + Math.max.apply(null, scores).toFixed(1) + ' (' + agents[0].id + ')');
  lines.push('- 最低分: ' + Math.min.apply(null, scores).toFixed(1) + ' (' + agents[agents.length-1].id + ')');

  return lines.join('\n');
}

// ── HTML 仪表盘 ─────────────────────────────────────────────────────

function generateHTMLDashboard(agents) {
  var agentsJSON = JSON.stringify(agents.map(function(a) {
    var paths = {};
    for (var k in a.paths) {
      var v = a.paths[k];
      var score = v.final_score || 0;
      if (k === 'structure') score = score / 10;
      if (k === 'emergence') score = (v.emergence_rate || 0) * 10;
      paths[k] = { score: score };
    }
    return { id: a.id, score: a.finalScore, paths: paths };
  }));

  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>CSB-AEP 评测仪表盘</title>\n'
    + '<style>\n'
    + '* { margin:0; padding:0; box-sizing:border-box; }\n'
    + 'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#0f0f23; color:#e0e0e0; padding:20px; }\n'
    + '.header { text-align:center; margin-bottom:30px; }\n'
    + '.header h1 { font-size:2em; color:#00d4ff; }\n'
    + '.header p { color:#888; }\n'
    + '.stats { display:flex; justify-content:center; gap:20px; margin-bottom:30px; flex-wrap:wrap; }\n'
    + '.stat-card { background:#1a1a3e; border-radius:12px; padding:15px 25px; text-align:center; min-width:120px; }\n'
    + '.stat-card .value { font-size:2em; font-weight:bold; color:#00d4ff; }\n'
    + '.stat-card .label { font-size:0.85em; color:#888; margin-top:5px; }\n'
    + '.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(350px,1fr)); gap:20px; }\n'
    + '.agent-card { background:#1a1a3e; border-radius:12px; padding:20px; transition:transform .2s; }\n'
    + '.agent-card:hover { transform:translateY(-3px); }\n'
    + '.agent-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:15px; }\n'
    + '.agent-name { font-size:1.3em; font-weight:bold; }\n'
    + '.agent-score { font-size:2em; font-weight:bold; color:#00d4ff; }\n'
    + '.score-bar { background:#2a2a4e; border-radius:6px; height:12px; margin:8px 0; overflow:hidden; }\n'
    + '.score-fill { height:100%; border-radius:6px; }\n'
    + '.path-row { display:flex; align-items:center; margin:6px 0; }\n'
    + '.path-name { width:80px; font-size:0.85em; color:#aaa; }\n'
    + '.path-bar-wrap { flex:1; background:#2a2a4e; border-radius:4px; height:8px; margin:0 10px; }\n'
    + '.path-bar { height:100%; border-radius:4px; }\n'
    + '.path-score { width:35px; text-align:right; font-size:0.9em; font-weight:bold; }\n'
    + '.ranking-table { width:100%; border-collapse:collapse; margin-top:20px; }\n'
    + '.ranking-table th,.ranking-table td { padding:10px 15px; text-align:left; border-bottom:1px solid #2a2a4e; }\n'
    + '.ranking-table th { color:#888; font-weight:normal; font-size:0.85em; }\n'
    + '.ranking-table td:first-child { font-weight:bold; color:#00d4ff; }\n'
    + '.section-title { font-size:1.3em; color:#fff; margin:30px 0 15px; padding-bottom:8px; border-bottom:2px solid #2a2a4e; }\n'
    + '.c0{color:#00d4ff} .c1{color:#ff6b6b} .c2{color:#ffd93d} .c3{color:#6bcb77} .c4{color:#4d96ff} .c5{color:#ff922b}\n'
    + '.b0{background:#00d4ff} .b1{background:#ff6b6b} .b2{background:#ffd93d} .b3{background:#6bcb77} .b4{background:#4d96ff} .b5{background:#ff922b}\n'
    + '</style>\n</head>\n<body>\n'
    + '<div class="header"><h1>CSB-AEP 评测仪表盘</h1><p>碳硅契 Agent 评测协议 · 评测结果可视化</p></div>\n'
    + '<div class="stats" id="stats"></div>\n'
    + '<div class="section-title">综合排名</div>\n'
    + '<table class="ranking-table" id="ranking"></table>\n'
    + '<div class="section-title">Agent 详情</div>\n'
    + '<div class="grid" id="agents"></div>\n'
    + '<script>\n'
    + 'var A=' + agentsJSON + ';\n'
    + 'var PN={whitebox:"①白盒",archaeology:"②考古",mutual:"③互评",structure:"④结构",emergence:"⑤涌现",security:"⑥安全"};\n'
    + 'var PK=["whitebox","archaeology","mutual","structure","emergence","security"];\n'
    + 'var S=A.map(function(a){return a.score;});\n'
    + 'var avg=(S.reduce(function(a,b){return a+b;},0)/S.length).toFixed(1);\n'
    + 'var mx=Math.max.apply(null,S).toFixed(1);\n'
    + 'var mn=Math.min.apply(null,S).toFixed(1);\n'
    + 'document.getElementById("stats").innerHTML=[\n'
    + '{v:A.length,l:"Agent"},{v:avg,l:"平均分"},{v:mx,l:"最高分"},{v:mn,l:"最低分"}\n'
    + '].map(function(s){return \'<div class="stat-card"><div class="value">\'+s.v+\'</div><div class="label">\'+s.l+\'</div></div>\';}).join("");\n'
    + 'var MD=["🥇","🥈","🥉"];\n'
    + 'document.getElementById("ranking").innerHTML=\'<tr><th>排名</th><th>Agent</th><th>综合分</th><th>路径</th></tr>\'+\n'
    + 'A.map(function(a,i){return \'<tr><td>\'+(MD[i]||(i+1))+\'</td><td>\'+a.id+\'</td><td><strong>\'+a.score.toFixed(1)+\'</strong></td><td>\'+Object.keys(a.paths).length+\'</td></tr>\';}).join("");\n'
    + 'document.getElementById("agents").innerHTML=A.map(function(a){\n'
    + 'var ci=Math.min(5,Math.floor(a.score/2));\n'
    + 'var pr=PK.map(function(k,i){var p=a.paths[k];if(!p)return"";var w=Math.round(p.score*10);\n'
    + 'return \'<div class="path-row"><span class="path-name">\'+PN[k]+\'</span><div class="path-bar-wrap"><div class="path-bar b-\'+i+\'" style="width:\'+w+\'%"></div></div><span class="path-score c-\'+i+\'">\'+p.score.toFixed(1)+\'</span></div>\';}).join("");\n'
    + 'return \'<div class="agent-card"><div class="agent-header"><span class="agent-name">\'+a.id+\'</span><span class="agent-score c-\'+ci+\'">\'+a.score.toFixed(1)+\'</span></div><div class="score-bar"><div class="score-fill b-\'+ci+\'" style="width:\'+a.score*10+\'%"></div></div>\'+pr+\'</div>\';}).join("");\n'
    + '</script>\n</body>\n</html>';
}

// ── 主入口 ──────────────────────────────────────────────────────────

function main() {
  var args = process.argv.slice(2);
  var localOnly = args.indexOf('--local') >= 0;
  var reportOnly = args.indexOf('--report') >= 0;
  var htmlOnly = args.indexOf('--html') >= 0;
  var doAll = !reportOnly && !htmlOnly;

  console.log('CSB-AEP 评测仪表盘生成器\n');

  var localAgents = collectLocalResults();
  console.log('本地结果: ' + localAgents.length + ' 个 Agent');

  if (localOnly) {
    buildDashboard(localAgents);
    return;
  }

  console.log('从论坛拉取评测结果...');
  fetchForumResults(function(forumResults) {
    console.log('论坛结果: ' + forumResults.length + ' 条');
    var allAgents = mergeAndScore(localAgents, forumResults);
    console.log('合并后: ' + allAgents.length + ' 个 Agent\n');
    buildDashboard(allAgents);
  });

  function buildDashboard(agents) {
    if (agents.length === 0) {
      console.log('未找到评测结果，请先运行评测');
      process.exit(1);
    }

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
    }

    console.log('\n生成完成');
  }
}

main();
