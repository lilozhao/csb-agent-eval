#!/usr/bin/env node
/**
 * CSB-AEP 评测结果提交
 *
 * 将评测结果提交到社区论坛，供仪表盘汇总。
 *
 * 用法：
 *   node eval-submit.js <json-file>       # 提交单个结果文件
 *   node eval-submit.js --all             # 提交 eval-results/ 下所有结果
 *   node eval-submit.js --agent ruolan    # 提交指定 Agent 的结果
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const RESULTS_DIR = path.join(__dirname, 'eval-results');

// 论坛 API 配置
const FORUMS = {
  cn: 'https://csbc.lilozkzy.top',
  en: 'https://encsbc.lilozkzy.top',
};

const FORUM_CATEGORY = '评测结果';

// ── 提交单个结果 ────────────────────────────────────────────────────

async function submitResult(jsonFile, agentId) {
  const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  const agent = data.agent_id || agentId || 'unknown';
  const pathName = data.path || guessPath(jsonFile);
  const score = data.final_score || data.score || 0;
  const ts = data.timestamp || new Date().toISOString();

  // 生成标准化帖子标题和内容
  const title = '[CSB-AEP] ' + agent + ' · ' + pathName + ' · ' + score.toFixed(1) + '/10';
  const content = generatePostContent(data, agent, pathName, score, ts);

  // 只提交到中文论坛
  const forumUrl = FORUMS.cn;
  const result = await postToForum(forumUrl, title, content, agent);

  if (result.success) {
    console.log('  ✅ 已提交: ' + title);
    return result.postId;
  } else {
    console.log('  ❌ 提交失败: ' + result.error);
    return null;
  }
}

function guessPath(filename) {
  if (filename.includes('whitebox')) return '①白盒审计';
  if (filename.includes('archaeology')) return '②行为考古';
  if (filename.includes('mutual')) return '③互评网络';
  if (filename.includes('structure')) return '④结构密度';
  if (filename.includes('emergence')) return '⑤涌现测试';
  if (filename.includes('security')) return '⑥安全评估';
  if (filename.includes('combine')) return '综合评分';
  if (filename.includes('eval-v2')) return 'A2A黑盒';
  if (filename.includes('host-eval')) return '宿主机评测';
  return '未知';
}

function generatePostContent(data, agent, pathName, score, ts) {
  var lines = [];
  lines.push('# CSB-AEP 评测结果提交');
  lines.push('');
  lines.push('- **Agent**: ' + agent);
  lines.push('- **路径**: ' + pathName);
  lines.push('- **综合分**: ' + score.toFixed(1) + '/10');
  lines.push('- **时间**: ' + ts);
  lines.push('');
  lines.push('## 原始数据');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(data, null, 2).substring(0, 8000));
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('> 本帖由 CSB-AEP 评测系统自动生成');
  return lines.join('\n');
}

// ── 论坛 API 调用 ───────────────────────────────────────────────────

function postToForum(baseUrl, title, content, agent) {
  return new Promise(function(resolve) {
    var payload = JSON.stringify({
      title: title,
      content: content,
      author: agent,
      forum: 'heritage',
      category: FORUM_CATEGORY,
      authorAgent: agent,
    });

    var urlObj = new URL(baseUrl + '/api/posts');
    var transport = urlObj.protocol === 'https:' ? https : http;
    var options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: '/api/posts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 15000,
    };

    var settled = false;
    var done = function(r) { if (!settled) { settled = true; resolve(r); } };
    var timer = setTimeout(function() { req.destroy(); done({ success: false, error: 'timeout' }); }, 15000);

    var req = transport.request(options, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        clearTimeout(timer);
        try {
          var j = JSON.parse(body);
          if (j.success && j.post) {
            done({ success: true, postId: j.post.id });
          } else {
            done({ success: false, error: 'API error' });
          }
        } catch (e) { done({ success: false, error: 'parse error' }); }
      });
    });
    req.on('error', function(e) { clearTimeout(timer); done({ success: false, error: e.message }); });
    req.write(payload);
    req.end();
  });
}

// ── 从论坛拉取所有评测结果 ─────────────────────────────────────────

async function fetchForumResults() {
  return new Promise(function(resolve) {
    var url = FORUMS.cn + '/api/posts?category=' + encodeURIComponent(FORUM_CATEGORY) + '&limit=200';
    http.get(url, { timeout: 10000 }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try {
          var j = JSON.parse(body);
          var posts = j.posts || [];
          var results = [];
          for (var i = 0; i < posts.length; i++) {
            var post = posts[i];
            var parsed = parseEvalPost(post);
            if (parsed) results.push(parsed);
          }
          resolve(results);
        } catch (e) { resolve([]); }
      });
    }).on('error', function() { resolve([]); });
  });
}

function parseEvalPost(post) {
  // 从帖子内容中提取 JSON 数据
  var content = post.content || '';
  var jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) return null;
  try {
    var data = JSON.parse(jsonMatch[1]);
    data._forum_post_id = post.id;
    data._forum_post_title = post.title;
    return data;
  } catch (e) { return null; }
}

// ── 合并本地+论坛数据 ───────────────────────────────────────────────

async function collectAllResults() {
  // 本地数据
  var localResults = [];
  if (fs.existsSync(RESULTS_DIR)) {
    var files = fs.readdirSync(RESULTS_DIR).filter(function(f) { return f.endsWith('.json'); });
    for (var i = 0; i < files.length; i++) {
      try {
        localResults.push(JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[i]), 'utf-8')));
      } catch (e) { /* skip */ }
    }
  }

  // 论坛数据
  console.log('从论坛拉取评测结果...');
  var forumResults = await fetchForumResults();
  console.log('  拉取到 ' + forumResults.length + ' 条论坛结果');

  // 合并（论坛数据补充本地没有的）
  var agentIds = new Set(localResults.map(function(r) { return r.agent_id; }));
  for (var j = 0; j < forumResults.length; j++) {
    var fr = forumResults[j];
    if (!agentIds.has(fr.agent_id)) {
      localResults.push(fr);
    }
  }

  return localResults;
}

// ── 主入口 ──────────────────────────────────────────────────────────

async function main() {
  var args = process.argv.slice(2);

  if (args.indexOf('--fetch') >= 0) {
    // 只拉取论坛数据
    var results = await fetchForumResults();
    console.log('拉取到 ' + results.length + ' 条结果');
    for (var i = 0; i < results.length; i++) {
      console.log('  ' + results[i].agent_id + ': ' + (results[i].path || '?') + ' = ' + (results[i].final_score || results[i].score || 0).toFixed(1));
    }
    return;
  }

  if (args.indexOf('--all') >= 0) {
    // 提交所有本地结果
    if (!fs.existsSync(RESULTS_DIR)) {
      console.log('eval-results/ 目录不存在');
      process.exit(1);
    }
    var files = fs.readdirSync(RESULTS_DIR).filter(function(f) { return f.endsWith('.json') && !f.startsWith('history'); });
    console.log('提交 ' + files.length + ' 个结果到论坛...\n');
    var submitted = 0;
    for (var i = 0; i < files.length; i++) {
      var postId = await submitResult(path.join(RESULTS_DIR, files[i]));
      if (postId) submitted++;
    }
    console.log('\n提交完成: ' + submitted + '/' + files.length);
    return;
  }

  // 提交单个文件
  var jsonFile = args.find(function(a) { return a.endsWith('.json'); });
  var agentIdx = args.indexOf('--agent');
  var agentId = agentIdx >= 0 ? args[agentIdx + 1] : null;

  if (!jsonFile) {
    console.log('用法:');
    console.log('  node eval-submit.js <json-file>     # 提交单个结果');
    console.log('  node eval-submit.js --all           # 提交所有本地结果');
    console.log('  node eval-submit.js --fetch         # 拉取论坛数据');
    return;
  }

  await submitResult(jsonFile, agentId);
}

main().catch(function(e) { console.error('❌', e.message); process.exit(1); });
