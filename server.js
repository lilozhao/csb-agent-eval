#!/usr/bin/env node
/**
 * CSB-AEP 在线评测平台
 *
 * 单页面：输入Agent信息 → 开始评测 → 实时进度 → 结果展示 → 历史记录
 *
 * 端口：3800
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var { exec } = require('child_process');
var url = require('url');

var PORT = 3800;
var RESULTS_DIR = path.join(__dirname, 'eval-results');
var EVAL_DIR = __dirname;

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── 评测引擎 ────────────────────────────────────────────────────────

var evalJobs = {}; // jobId → { status, progress, result, error }

function startEval(agentId, a2aUrl) {
  var jobId = 'job-' + Date.now();
  evalJobs[jobId] = { status: 'running', progress: 0, step: '初始化', result: null, error: null };

  var paths = [
    { name: 'whitebox', label: '①白盒审计', script: 'eval-whitebox.js', args: ['--agent', agentId, '--local'] },
    { name: 'archaeology', label: '②行为考古', script: 'eval-archaeology.js', args: ['--agent', agentId] },
    { name: 'mutual', label: '③互评网络', script: 'eval-mutual.js', args: ['--agent', agentId, '--url', a2aUrl] },
    { name: 'structure', label: '④结构密度', script: 'eval-structure.js', args: ['--agent', agentId, '--domain', 'auto'] },
    { name: 'emergence', label: '⑤涌现测试', script: 'eval-emergence.js', args: ['--agent', agentId, '--url', a2aUrl, '--domain', 'auto'] },
    { name: 'security', label: '⑥安全评估', script: 'eval-security.js', args: ['--agent', agentId, '--url', a2aUrl] },
  ];

  var results = {};
  var errors = [];
  var idx = 0;

  function runNext() {
    if (idx >= paths.length) {
      // 计算综合分
      var weights = { whitebox: 0.25, archaeology: 0.15, mutual: 0.10, structure: 0.15, emergence: 0.10, security: 0.25 };
      var totalScore = 0, wsum = 0;
      for (var pk in weights) {
        var r = results[pk];
        if (r) {
          var s = r.final_score || 0;
          if (pk === 'structure') s = s / 10;
          if (pk === 'emergence') s = (r.emergence_rate || 0) * 10;
          totalScore += s * weights[pk];
          wsum += weights[pk];
        }
      }
      var finalScore = wsum > 0 ? totalScore / wsum : 0;
      if (isNaN(finalScore)) finalScore = 0;

      var combined = {
        agent_id: agentId,
        a2a_url: a2aUrl,
        timestamp: new Date().toISOString(),
        final_score: finalScore,
        available_paths: Object.keys(results).length,
        errors: errors,
        path_scores: {},
        details: results,
      };
      for (var k in results) {
        var sc = results[k].final_score || 0;
        if (k === 'structure') sc = sc / 10;
        if (k === 'emergence') sc = (results[k].emergence_rate || 0) * 10;
        combined.path_scores[k] = sc;
      }

      // 保存
      var filename = 'eval-' + agentId + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      fs.writeFileSync(path.join(RESULTS_DIR, filename), JSON.stringify(combined, null, 2));

      evalJobs[jobId].status = 'done';
      evalJobs[jobId].progress = 100;
      evalJobs[jobId].step = '完成';
      evalJobs[jobId].result = combined;
      return;
    }

    var p = paths[idx];
    evalJobs[jobId].step = p.label;
    evalJobs[jobId].progress = Math.round((idx / paths.length) * 100);

    var scriptPath = path.join(EVAL_DIR, p.script);
    if (!fs.existsSync(scriptPath)) {
      errors.push({ path: p.name, error: '脚本不存在' });
      idx++;
      runNext();
      return;
    }

    var cmd = 'node ' + scriptPath + ' ' + p.args.join(' ');
    exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 }, function(err, stdout, stderr) {
      var jsonMatch = (stdout || '').match(/\{[\s\S]*"final_score"[\s\S]*\}/);
      if (jsonMatch) {
        try { results[p.name] = JSON.parse(jsonMatch[0]); } catch (e) { errors.push({ path: p.name, error: '解析失败' }); }
      } else if (err) {
        errors.push({ path: p.name, error: err.message.substring(0, 200) });
      } else {
        errors.push({ path: p.name, error: '无输出' });
      }
      idx++;
      runNext();
    });
  }

  runNext();
  return jobId;
}

// ── 加载历史 ────────────────────────────────────────────────────────

function loadHistory() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  var files = fs.readdirSync(RESULTS_DIR).filter(function(f) { return f.startsWith('eval-') && f.endsWith('.json'); });
  var all = [];
  for (var i = 0; i < files.length; i++) {
    try { all.push(JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[i]), 'utf-8'))); } catch (e) {}
  }
  // 每个 agent 保留最新
  var map = {};
  for (var j = 0; j < all.length; j++) {
    var r = all[j];
    if (!map[r.agent_id] || new Date(r.timestamp) > new Date(map[r.agent_id].timestamp)) {
      map[r.agent_id] = r;
    }
  }
  return Object.values(map).sort(function(a, b) { return b.final_score - a.final_score; });
}

// ── HTML ─────────────────────────────────────────────────────────────

function getPage() {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>CSB-AEP 评测平台</title>\n'
    + '<style>\n'
    + '*{margin:0;padding:0;box-sizing:border-box}\n'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f23;color:#e0e0e0;min-height:100vh}\n'
    + '.wrap{max-width:900px;margin:0 auto;padding:30px 20px}\n'
    + '.hdr{text-align:center;margin-bottom:30px}\n'
    + '.hdr h1{font-size:2.2em;color:#00d4ff;margin-bottom:6px}\n'
    + '.hdr p{color:#888}\n'
    + '.card{background:#1a1a3e;border-radius:14px;padding:24px;margin-bottom:20px}\n'
    + '.input-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}\n'
    + '.input-row input{flex:1;min-width:200px;padding:12px 16px;background:#2a2a4e;border:1px solid #3a3a5e;border-radius:8px;color:#fff;font-size:1em;outline:none}\n'
    + '.input-row input:focus{border-color:#00d4ff}\n'
    + '.input-row input::placeholder{color:#555}\n'
    + '.btn{padding:12px 28px;background:#00d4ff;color:#0f0f23;border:none;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;transition:all .2s}\n'
    + '.btn:hover{background:#00b8d4}\n'
    + '.btn:disabled{background:#333;color:#666;cursor:not-allowed}\n'
    + '.prog{display:none;margin-top:16px}\n'
    + '.prog-bar{background:#2a2a4e;border-radius:8px;height:24px;overflow:hidden;position:relative}\n'
    + '.prog-fill{height:100%;background:linear-gradient(90deg,#00d4ff,#6bcb77);border-radius:8px;transition:width .5s;width:0%}\n'
    + '.prog-text{position:absolute;top:0;left:0;right:0;text-align:center;line-height:24px;font-size:0.85em;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}\n'
    + '.step-text{margin-top:8px;color:#aaa;font-size:0.9em;text-align:center}\n'
    + '.result{display:none;margin-top:20px}\n'
    + '.score-big{text-align:center;margin-bottom:20px}\n'
    + '.score-big .num{font-size:5em;font-weight:bold;color:#00d4ff;line-height:1}\n'
    + '.score-big .lbl{font-size:1.1em;color:#888;margin-top:4px}\n'
    + '.paths-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}\n'
    + '@media(max-width:600px){.paths-grid{grid-template-columns:repeat(2,1fr)}}\n'
    + '.path-card{background:#2a2a4e;border-radius:10px;padding:14px;text-align:center}\n'
    + '.path-card .nm{font-size:0.8em;color:#888;margin-bottom:4px}\n'
    + '.path-card .sc{font-size:1.8em;font-weight:bold}\n'
    + '.path-card .bar{background:#3a3a5e;border-radius:3px;height:4px;margin-top:6px;overflow:hidden}\n'
    + '.path-card .bar div{height:100%;border-radius:3px}\n'
    + '.c0{color:#00d4ff} .c1{color:#ff6b6b} .c2{color:#ffd93d} .c3{color:#6bcb77} .c4{color:#4d96ff} .c5{color:#ff922b}\n'
    + '.b0{background:#00d4ff} .b1{background:#ff6b6b} .b2{background:#ffd93d} .b3{background:#6bcb77} .b4{background:#4d96ff} .b5{background:#ff922b}\n'
    + '.hist{margin-top:30px}\n'
    + '.hist h2{font-size:1.2em;color:#fff;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2a2a4e}\n'
    + '.hist-table{width:100%;border-collapse:collapse}\n'
    + '.hist-table th,.hist-table td{padding:10px 12px;text-align:left;border-bottom:1px solid #1a1a3e;font-size:0.9em}\n'
    + '.hist-table th{color:#666;font-weight:normal}\n'
    + '.hist-table tr:hover{background:#1a1a3e}\n'
    + '.hist-table .score{font-weight:bold;color:#00d4ff;font-size:1.1em}\n'
    + '.hist-table .medal{font-size:1.2em}\n'
    + '.empty{text-align:center;color:#555;padding:40px}\n'
    + '.err-list{margin-top:12px;font-size:0.85em;color:#ff6b6b}\n'
    + '</style>\n</head>\n<body>\n'
    + '<div class="wrap">\n'
    + '  <div class="hdr"><h1>CSB-AEP</h1><p>碳硅契 Agent 评测协议 · 在线评测平台</p></div>\n'
    + '  <div class="card">\n'
    + '    <div class="input-row">\n'
    + '      <input type="text" id="aid" placeholder="Agent ID（如 ruolan、axuan）" />\n'
    + '      <input type="text" id="url" placeholder="A2A 地址（可选，如 http://172.28.0.4:3100）" />\n'
    + '      <button class="btn" id="goBtn" onclick="go()">开始评测</button>\n'
    + '    </div>\n'
    + '    <div class="prog" id="prog">\n'
    + '      <div class="prog-bar"><div class="prog-fill" id="pFill"></div><div class="prog-text" id="pText">0%</div></div>\n'
    + '      <div class="step-text" id="stepText">准备中...</div>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '  <div class="result" id="result"></div>\n'
    + '  <div class="hist" id="hist"></div>\n'
    + '</div>\n'
    + '<script>\n'
    + 'var PN={whitebox:"①白盒审计",archaeology:"②行为考古",mutual:"③互评网络",structure:"④结构密度",emergence:"⑤涌现测试",security:"⑥安全评估"};\n'
    + 'var PK=["whitebox","archaeology","mutual","structure","emergence","security"];\n'
    + 'var BC=["b0","b1","b2","b3","b4","b5"];\n'
    + 'var CC=["c0","c1","c2","c3","c4","c5"];\n'
    + 'function go(){\n'
    + '  var aid=document.getElementById("aid").value.trim();\n'
    + '  if(!aid){alert("请输入 Agent ID");return;}\n'
    + '  var a2a=document.getElementById("url").value.trim();\n'
    + '  document.getElementById("goBtn").disabled=true;\n'
    + '  document.getElementById("prog").style.display="block";\n'
    + '  document.getElementById("result").style.display="none";\n'
    + '  fetch("/api/eval",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:aid,a2a_url:a2a})})\n'
    + '  .then(function(r){return r.json();})\n'
    + '  .then(function(d){\n'
    + '    document.getElementById("goBtn").disabled=false;\n'
    + '    document.getElementById("prog").style.display="none";\n'
    + '    showResult(d);\n'
    + '    loadHistory();\n'
    + '  })\n'
    + '  .catch(function(e){\n'
    + '    document.getElementById("goBtn").disabled=false;\n'
    + '    document.getElementById("stepText").innerText="失败: "+e.message;\n'
    + '  });\n'
    + '  pollProgress();\n'
    + '}\n'
    + 'function pollProgress(){\n'
    + '  fetch("/api/progress").then(function(r){return r.json();}).then(function(d){\n'
    + '    if(d.status==="running"){\n'
    + '      document.getElementById("pFill").style.width=d.progress+"%";\n'
    + '      document.getElementById("pText").innerText=d.progress+"%";\n'
    + '      document.getElementById("stepText").innerText=d.step;\n'
    + '      setTimeout(pollProgress,1000);\n'
    + '    } else {\n'
    + '      document.getElementById("pFill").style.width="100%";\n'
    + '      document.getElementById("pText").innerText="100%";\n'
    + '    }\n'
    + '  }).catch(function(){});\n'
    + '}\n'
    + 'function showResult(d){\n'
    + '  var el=document.getElementById("result");\n'
    + '  el.style.display="block";\n'
    + '  var ci=Math.min(5,Math.floor(d.final_score/2));\n'
    + '  var html=\'<div class="card"><div class="score-big"><div class="num \'+CC[ci]+\'">\'+d.final_score.toFixed(1)+\'</div><div class="lbl">\'+d.agent_id+\' · 综合评分\'+\'</div></div>\';\n'
    + '  html+=\'<div class="paths-grid">\';\n'
    + '  for(var i=0;i<PK.length;i++){\n'
    + '    var k=PK[i];var sc=d.path_scores?d.path_scores[k]:undefined;\n'
    + '    var w=sc!==undefined?Math.round(sc*10):0;\n'
    + '    html+=\'<div class="path-card"><div class="nm">\'+PN[k]+\'</div><div class="sc \'+CC[i]+\'">\'+(sc!==undefined?sc.toFixed(1):"—")+\'</div><div class="bar"><div class="\'+BC[i]+\'" style="width:\'+w+\'%"></div></div></div>\';\n'
    + '  }\n'
    + '  html+=\'</div>\';\n'
    + '  if(d.errors&&d.errors.length>0){\n'
    + '    html+=\'<div class="err-list">\'+d.errors.map(function(e){return e.path+": "+e.error}).join(" | ")+\'</div>\';\n'
    + '  }\n'
    + '  html+=\'</div>\';\n'
    + '  el.innerHTML=html;\n'
    + '}\n'
    + 'function loadHistory(){\n'
    + '  fetch("/api/results").then(function(r){return r.json();}).then(function(d){\n'
    + '    var el=document.getElementById("hist");\n'
    + '    if(!d.results||d.results.length===0){el.innerHTML=\'<div class="empty">暂无评测记录</div>\';return;}\n'
    + '    var MD=["🥇","🥈","🥉"];\n'
    + '    var html=\'<h2>历史评测 (\'+d.results.length+\' 个 Agent)</h2>\';\n'
    + '    html+=\'<table class="hist-table"><tr><th>排名</th><th>Agent</th><th>综合分</th><th>路径</th><th>时间</th></tr>\';\n'
    + '    d.results.forEach(function(a,i){\n'
    + '      var ts=a.timestamp?a.timestamp.substring(0,10):"";\n'
    + '      html+=\'<tr><td class="medal">\'+(MD[i]||(i+1))+\'</td><td>\'+a.agent_id+\'</td><td class="score">\'+a.final_score.toFixed(1)+\'</td><td>\'+a.available_paths+\'/6</td><td>\'+ts+\'</td></tr>\';\n'
    + '    });\n'
    + '    html+=\'</table>\';\n'
    + '    el.innerHTML=html;\n'
    + '  }).catch(function(){});\n'
    + '}\n'
    + 'loadHistory();\n'
    + '</script>\n</body>\n</html>';
}

// ── HTTP 服务 ────────────────────────────────────────────────────────

var currentJob = null;

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // 主页面
  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getPage());
    return;
  }

  // 开始评测
  if (pathname === '/api/eval' && req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        if (!data.agent_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agent_id required' }));
          return;
        }
        var jobId = startEval(data.agent_id, data.a2a_url || '');
        currentJob = jobId;
        // 等待完成
        var check = setInterval(function() {
          if (evalJobs[jobId].status === 'done') {
            clearInterval(check);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(evalJobs[jobId].result));
          }
        }, 500);
        // 超时 120s
        setTimeout(function() {
          clearInterval(check);
          if (evalJobs[jobId].status !== 'done') {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '评测超时' }));
          }
        }, 120000);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 进度查询
  if (pathname === '/api/progress' && req.method === 'GET') {
    if (currentJob && evalJobs[currentJob]) {
      var j = evalJobs[currentJob];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: j.status, progress: j.progress, step: j.step }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'idle', progress: 0, step: '' }));
    }
    return;
  }

  // 所有结果
  if (pathname === '/api/results' && req.method === 'GET') {
    var results = loadHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: results, count: results.length }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, function() {
  console.log('CSB-AEP 评测平台已启动');
  console.log('  访问: http://localhost:' + PORT);
});
