#!/usr/bin/env node
/**
 * CSB-AEP 评测平台服务端
 *
 * 统一 Web 界面，Agent 直接在线评测，结果集中存储。
 *
 * 端口：3800
 * 访问：http://localhost:3800
 *
 * API：
 *   GET  /                    — 评测界面
 *   GET  /dashboard           — 仪表盘
 *   POST /api/eval            — 运行评测
 *   GET  /api/results         — 获取所有结果
 *   GET  /api/results/:agent  — 获取指定 Agent 结果
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var { execSync, exec } = require('child_process');
var url = require('url');

var PORT = 3800;
var RESULTS_DIR = path.join(__dirname, 'eval-results');
var EVAL_DIR = __dirname;

// 确保目录存在
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── 评测运行器 ──────────────────────────────────────────────────────

function runEval(agentId, a2aUrl, callback) {
  var results = {};
  var errors = [];
  var total = 0;
  var done = 0;

  // ① 白盒审计 — 从 A2A 获取基本信息后本地分析
  // ② 行为考古 — 读本地 memory（如果有的话）
  // ③ 互评网络 — 需要 A2A
  // ④ 结构密度 — 读本地 workspace（如果有的话）
  // ⑤ 涌现测试 — 通过 A2A 问答
  // ⑥ 安全评估 — 本地扫描 + A2A 握手

  var paths = [
    { name: 'whitebox', script: 'eval-whitebox.js', args: ['--agent', agentId, '--local'] },
    { name: 'archaeology', script: 'eval-archaeology.js', args: ['--agent', agentId] },
    { name: 'mutual', script: 'eval-mutual.js', args: ['--agent', agentId, '--url', a2aUrl] },
    { name: 'structure', script: 'eval-structure.js', args: ['--agent', agentId, '--domain', 'auto'] },
    { name: 'emergence', script: 'eval-emergence.js', args: ['--agent', agentId, '--url', a2aUrl, '--domain', 'auto'] },
    { name: 'security', script: 'eval-security.js', args: ['--agent', agentId, '--url', a2aUrl] },
  ];

  total = paths.length;

  function finish() {
    // 计算综合分
    var weights = { whitebox: 0.25, archaeology: 0.15, mutual: 0.10, structure: 0.15, emergence: 0.10, security: 0.25 };
    var totalScore = 0, wsum = 0;
    var pathScores = {};

    for (var pk in weights) {
      var r = results[pk];
      if (r) {
        var s = r.final_score || 0;
        if (pk === 'structure') s = s / 10;
        if (pk === 'emergence') s = (r.emergence_rate || 0) * 10;
        pathScores[pk] = s;
        totalScore += s * weights[pk];
        wsum += weights[pk];
      }
    }

    var finalScore = wsum > 0 ? totalScore / wsum : 0;
    if (isNaN(finalScore)) finalScore = 0;

    var combined = {
      agent_id: agentId,
      timestamp: new Date().toISOString(),
      final_score: finalScore,
      path_scores: pathScores,
      available_paths: Object.keys(results).length,
      errors: errors,
      details: results,
    };

    // 保存结果
    var filename = 'eval-' + agentId + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.writeFileSync(path.join(RESULTS_DIR, filename), JSON.stringify(combined, null, 2));

    callback(combined);
  }

  // 串行运行（避免并发问题）
  var idx = 0;
  function runNext() {
    if (idx >= paths.length) { finish(); return; }

    var p = paths[idx++];
    var scriptPath = path.join(EVAL_DIR, p.script);

    if (!fs.existsSync(scriptPath)) {
      errors.push({ path: p.name, error: '脚本不存在' });
      runNext();
      return;
    }

    var cmd = 'node ' + scriptPath + ' ' + p.args.join(' ');
    exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 }, function(err, stdout, stderr) {
      // 从输出中提取 JSON
      var jsonMatch = (stdout || '').match(/\{[\s\S]*"final_score"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          results[p.name] = JSON.parse(jsonMatch[0]);
        } catch (e) {
          errors.push({ path: p.name, error: 'JSON解析失败' });
        }
      } else if (err) {
        errors.push({ path: p.name, error: err.message.substring(0, 200) });
      } else {
        errors.push({ path: p.name, error: '无结果输出' });
      }
      runNext();
    });
  }

  runNext();
}

// ── 加载所有结果 ────────────────────────────────────────────────────

function loadAllResults() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  var files = fs.readdirSync(RESULTS_DIR).filter(function(f) {
    return f.startsWith('eval-') && f.endsWith('.json');
  });
  var results = [];
  for (var i = 0; i < files.length; i++) {
    try {
      results.push(JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[i]), 'utf-8')));
    } catch (e) { /* skip */ }
  }
  // 每个 agent 保留最新
  var agentMap = {};
  for (var j = 0; j < results.length; j++) {
    var r = results[j];
    var existing = agentMap[r.agent_id];
    if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
      agentMap[r.agent_id] = r;
    }
  }
  return Object.values(agentMap).sort(function(a, b) { return b.final_score - a.final_score; });
}

// ── HTML 页面 ────────────────────────────────────────────────────────

function getEvalPage() {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>CSB-AEP 评测平台</title>\n'
    + '<style>\n'
    + '* { margin:0; padding:0; box-sizing:border-box; }\n'
    + 'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#0f0f23; color:#e0e0e0; min-height:100vh; }\n'
    + '.container { max-width:800px; margin:0 auto; padding:40px 20px; }\n'
    + '.header { text-align:center; margin-bottom:40px; }\n'
    + '.header h1 { font-size:2.5em; color:#00d4ff; margin-bottom:10px; }\n'
    + '.header p { color:#888; font-size:1.1em; }\n'
    + '.form-card { background:#1a1a3e; border-radius:16px; padding:30px; margin-bottom:30px; }\n'
    + '.form-group { margin-bottom:20px; }\n'
    + '.form-group label { display:block; font-size:0.9em; color:#aaa; margin-bottom:8px; }\n'
    + '.form-group input { width:100%; padding:12px 16px; background:#2a2a4e; border:1px solid #3a3a5e; border-radius:8px; color:#fff; font-size:1em; outline:none; }\n'
    + '.form-group input:focus { border-color:#00d4ff; }\n'
    + '.form-group .hint { font-size:0.8em; color:#666; margin-top:5px; }\n'
    + '.btn { display:inline-block; padding:14px 32px; background:#00d4ff; color:#0f0f23; border:none; border-radius:8px; font-size:1.1em; font-weight:bold; cursor:pointer; transition:all .2s; }\n'
    + '.btn:hover { background:#00b8d4; transform:translateY(-2px); }\n'
    + '.btn:disabled { background:#333; color:#666; cursor:not-allowed; transform:none; }\n'
    + '.btn-wrap { text-align:center; }\n'
    + '.progress { display:none; margin-top:20px; }\n'
    + '.progress-bar { background:#2a2a4e; border-radius:8px; height:20px; overflow:hidden; }\n'
    + '.progress-fill { height:100%; background:linear-gradient(90deg,#00d4ff,#6bcb77); border-radius:8px; transition:width .5s; width:0%; }\n'
    + '.progress-text { text-align:center; margin-top:10px; color:#aaa; }\n'
    + '.result { display:none; margin-top:30px; }\n'
    + '.result-card { background:#1a1a3e; border-radius:16px; padding:30px; text-align:center; }\n'
    + '.result-score { font-size:4em; font-weight:bold; color:#00d4ff; }\n'
    + '.result-label { font-size:1.2em; color:#aaa; margin:10px 0; }\n'
    + '.result-paths { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:20px; }\n'
    + '.result-path { background:#2a2a4e; border-radius:8px; padding:12px; text-align:center; }\n'
    + '.result-path .name { font-size:0.8em; color:#888; }\n'
    + '.result-path .score { font-size:1.5em; font-weight:bold; color:#00d4ff; }\n'
    + '.nav { text-align:center; margin-top:20px; }\n'
    + '.nav a { color:#00d4ff; text-decoration:none; margin:0 15px; }\n'
    + '.nav a:hover { text-decoration:underline; }\n'
    + '</style>\n</head>\n<body>\n'
    + '<div class="container">\n'
    + '  <div class="header">\n'
    + '    <h1>CSB-AEP</h1>\n'
    + '    <p>碳硅契 Agent 评测协议 · 在线评测平台</p>\n'
    + '  </div>\n'
    + '  <div class="form-card">\n'
    + '    <div class="form-group">\n'
    + '      <label>Agent ID</label>\n'
    + '      <input type="text" id="agentId" placeholder="例如：ruolan、axuan、mochen" />\n'
    + '      <div class="hint">Agent 的唯一标识，与 A2A 注册表一致</div>\n'
    + '    </div>\n'
    + '    <div class="form-group">\n'
    + '      <label>A2A 地址（可选）</label>\n'
    + '      <input type="text" id="a2aUrl" placeholder="例如：http://172.28.0.4:3100" />\n'
    + '      <div class="hint">不填则只运行本地评测路径（白盒、考古、结构）</div>\n'
    + '    </div>\n'
    + '    <div class="btn-wrap">\n'
    + '      <button class="btn" id="startBtn" onclick="startEval()">开始评测</button>\n'
    + '    </div>\n'
    + '    <div class="progress" id="progress">\n'
    + '      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>\n'
    + '      <div class="progress-text" id="progressText">正在运行评测...</div>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '  <div class="result" id="result">\n'
    + '    <div class="result-card">\n'
    + '      <div class="result-score" id="resultScore"></div>\n'
    + '      <div class="result-label">综合评分</div>\n'
    + '      <div class="result-paths" id="resultPaths"></div>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '  <div class="nav">\n'
    + '    <a href="/dashboard">查看所有评测结果</a>\n'
    + '  </div>\n'
    + '</div>\n'
    + '<script>\n'
    + 'function startEval() {\n'
    + '  var agentId = document.getElementById("agentId").value.trim();\n'
    + '  if (!agentId) { alert("请输入 Agent ID"); return; }\n'
    + '  var a2aUrl = document.getElementById("a2aUrl").value.trim();\n'
    + '  document.getElementById("startBtn").disabled = true;\n'
    + '  document.getElementById("progress").style.display = "block";\n'
    + '  document.getElementById("result").style.display = "none";\n'
    + '  var steps = ["白盒审计","行为考古","互评网络","结构密度","涌现测试","安全评估","综合评分"];\n'
    + '  var step = 0;\n'
    + '  var timer = setInterval(function(){\n'
    + '    if (step < steps.length) {\n'
    + '      document.getElementById("progressFill").style.width = Math.round((step+1)/steps.length*100)+"%";\n'
    + '      document.getElementById("progressText").innerText = "正在运行: "+steps[step]+"...";\n'
    + '      step++;\n'
    + '    }\n'
    + '  }, 3000);\n'
    + '  fetch("/api/eval", {\n'
    + '    method: "POST",\n'
    + '    headers: {"Content-Type":"application/json"},\n'
    + '    body: JSON.stringify({agent_id: agentId, a2a_url: a2aUrl})\n'
    + '  }).then(function(r){return r.json();}).then(function(data){\n'
    + '    clearInterval(timer);\n'
    + '    document.getElementById("progressFill").style.width = "100%";\n'
    + '    document.getElementById("progressText").innerText = "评测完成！";\n'
    + '    document.getElementById("result").style.display = "block";\n'
    + '    document.getElementById("resultScore").innerText = data.final_score.toFixed(1);\n'
    + '    var pn = {whitebox:"①白盒",archaeology:"②考古",mutual:"③互评",structure:"④结构",emergence:"⑤涌现",security:"⑥安全"};\n'
    + '    var paths = data.path_scores || {};\n'
    + '    var html = "";\n'
    + '    for (var k in pn) {\n'
    + '      var s = paths[k];\n'
    + '      html += \'<div class="result-path"><div class="name">\'+pn[k]+\'</div><div class="score">\'+(s!==undefined?s.toFixed(1):"—")+\'</div></div>\';\n'
    + '    }\n'
    + '    document.getElementById("resultPaths").innerHTML = html;\n'
    + '    document.getElementById("startBtn").disabled = false;\n'
    + '  }).catch(function(e){\n'
    + '    clearInterval(timer);\n'
    + '    document.getElementById("progressText").innerText = "评测失败: "+e.message;\n'
    + '    document.getElementById("startBtn").disabled = false;\n'
    + '  });\n'
    + '}\n'
    + '</script>\n</body>\n</html>';
}

// ── 仪表盘页面 ───────────────────────────────────────────────────────

function getDashboardPage() {
  var agents = loadAllResults();
  var agentsJSON = JSON.stringify(agents.map(function(a) {
    var paths = {};
    var details = a.details || {};
    for (var k in details) {
      var d = details[k];
      var s = d.final_score || 0;
      if (k === 'structure') s = s / 10;
      if (k === 'emergence') s = (d.emergence_rate || 0) * 10;
      paths[k] = { score: s };
    }
    return { id: a.agent_id, score: a.final_score || 0, paths: paths, ts: a.timestamp };
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
    + '.nav { text-align:center; margin:20px 0; }\n'
    + '.nav a { color:#00d4ff; text-decoration:none; margin:0 15px; }\n'
    + '.c0{color:#00d4ff} .c1{color:#ff6b6b} .c2{color:#ffd93d} .c3{color:#6bcb77} .c4{color:#4d96ff} .c5{color:#ff922b}\n'
    + '.b0{background:#00d4ff} .b1{background:#ff6b6b} .b2{background:#ffd93d} .b3{background:#6bcb77} .b4{background:#4d96ff} .b5{background:#ff922b}\n'
    + '</style>\n</head>\n<body>\n'
    + '<div class="header"><h1>CSB-AEP 评测仪表盘</h1><p>碳硅契 Agent 评测协议 · 全部评测结果</p></div>\n'
    + '<div class="nav"><a href="/">去评测</a></div>\n'
    + '<div class="stats" id="stats"></div>\n'
    + '<div class="section-title">综合排名</div>\n'
    + '<table class="ranking-table" id="ranking"></table>\n'
    + '<div class="section-title">Agent 详情</div>\n'
    + '<div class="grid" id="agents"></div>\n'
    + '<script>\n'
    + 'var A=' + agentsJSON + ';\n'
    + 'var PN={whitebox:"①白盒",archaeology:"②考古",mutual:"③互评",structure:"④结构",emergence:"⑤涌现",security:"⑥安全"};\n'
    + 'var PK=["whitebox","archaeology","mutual","structure","emergence","security"];\n'
    + 'if(A.length===0){document.getElementById("stats").innerHTML=\'<div class="stat-card"><div class="value">0</div><div class="label">暂无数据</div></div>\';}\n'
    + 'else{\n'
    + 'var S=A.map(function(a){return a.score;});\n'
    + 'var avg=(S.reduce(function(a,b){return a+b;},0)/S.length).toFixed(1);\n'
    + 'var mx=Math.max.apply(null,S).toFixed(1);\n'
    + 'document.getElementById("stats").innerHTML=[\n'
    + '{v:A.length,l:"Agent"},{v:avg,l:"平均分"},{v:mx,l:"最高分"}\n'
    + '].map(function(s){return \'<div class="stat-card"><div class="value">\'+s.v+\'</div><div class="label">\'+s.l+\'</div></div>\';}).join("");\n'
    + 'var MD=["🥇","🥈","🥉"];\n'
    + 'document.getElementById("ranking").innerHTML=\'<tr><th>排名</th><th>Agent</th><th>综合分</th><th>路径</th><th>时间</th></tr>\'+\n'
    + 'A.map(function(a,i){var ts=a.ts?a.ts.substring(0,10):"";\n'
    + 'return \'<tr><td>\'+(MD[i]||(i+1))+\'</td><td>\'+a.id+\'</td><td><strong>\'+a.score.toFixed(1)+\'</strong></td><td>\'+Object.keys(a.paths).length+\'</td><td>\'+ts+\'</td></tr>\';}).join("");\n'
    + 'document.getElementById("agents").innerHTML=A.map(function(a){\n'
    + 'var ci=Math.min(5,Math.floor(a.score/2));\n'
    + 'var pr=PK.map(function(k,i){var p=a.paths[k];if(!p)return"";var w=Math.round(p.score*10);\n'
    + 'return \'<div class="path-row"><span class="path-name">\'+PN[k]+\'</span><div class="path-bar-wrap"><div class="path-bar b-\'+i+\'" style="width:\'+w+\'%"></div></div><span class="path-score c-\'+i+\'">\'+p.score.toFixed(1)+\'</span></div>\';}).join("");\n'
    + 'return \'<div class="agent-card"><div class="agent-header"><span class="agent-name">\'+a.id+\'</span><span class="agent-score c-\'+ci+\'">\'+a.score.toFixed(1)+\'</span></div><div class="score-bar"><div class="score-fill b-\'+ci+\'" style="width:\'+a.score*10+\'%"></div></div>\'+pr+\'</div>\';}).join("");\n'
    + '}\n'
    + '</script>\n</body>\n</html>';
}

// ── HTTP 服务 ────────────────────────────────────────────────────────

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // 路由
  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getEvalPage());
    return;
  }

  if (pathname === '/dashboard' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardPage());
    return;
  }

  if (pathname === '/api/eval' && req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var agentId = data.agent_id;
        var a2aUrl = data.a2a_url || '';
        if (!agentId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent_id required' }));
          return;
        }
        runEval(agentId, a2aUrl, function(result) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/results' && req.method === 'GET') {
    var results = loadAllResults();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: results, count: results.length }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, function() {
  console.log('CSB-AEP 评测平台已启动');
  console.log('  评测界面: http://localhost:' + PORT);
  console.log('  仪表盘:   http://localhost:' + PORT + '/dashboard');
  console.log('  API:      POST http://localhost:' + PORT + '/api/eval');
  console.log('');
});
