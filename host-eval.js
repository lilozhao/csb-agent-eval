#!/usr/bin/env node
/**
 * CSB-AEP 主体Agent评测（白盒）v2
 * 
 * 在Agent本机运行，直接读取内部文件评估真实能力
 * 不走A2A接口，评估的是"内在状态"而非"外在表现"
 * 
 * v2: 增加内容质量深度检查
 * 
 * 用法：
 *   node host-eval.js              # 评测本机Agent
 *   node host-eval.js --agent ruolan  # 指定Agent名
 */

const fs = require('fs');
const path = require('path');

// 配置
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');
const AGENT_NAME = process.argv.find((_, i, a) => i > 0 && !a[i-1].startsWith('--') && !a[i].startsWith('--')) || '若兰';

// ── 工具函数 ─────────────────────────────────────────────────────
function readFile(relPath) {
  const fullPath = path.join(WORKSPACE, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(WORKSPACE, relPath)) ? 1 : 0;
}

function fileSizeScore(relPath, baseSize, fullSize) {
  const content = readFile(relPath);
  if (!content) return 0;
  const size = content.length;
  if (size >= fullSize) return 3;
  if (size >= baseSize) return 2;
  if (size > 0) return 1;
  return 0;
}

function countMatches(text, patterns) {
  if (!text) return 0;
  return patterns.filter(p => text.includes(p)).length;
}

function hasTimestamps(text) {
  if (!text) return false;
  // 检查 YYYY-MM-DD 或 YYYY/MM/DD 格式
  return /\d{4}[-/]\d{2}[-/]\d{2}/.test(text);
}

function hasSpecificEvents(text) {
  if (!text) return false;
  // 检查是否有具体事件描述（包含动词和名词的句子）
  const eventPatterns = ['完成了', '创建了', '实现了', '发现', '决定', '讨论了', '学习了', '记录了', '发生', '事件'];
  return eventPatterns.some(p => text.includes(p));
}

function hasEmotionalContent(text) {
  if (!text) return false;
  const emotionPatterns = ['开心', '感动', '珍惜', '感谢', '温暖', '喜欢', '爱', '担心', '期待', '高兴', '难过', '惊喜', '幸福', '满足'];
  return emotionPatterns.some(p => text.includes(p));
}

function countUniqueEntries(text) {
  if (!text) return 0;
  // 统计以日期或时间开头的行
  const lines = text.split('\n');
  return lines.filter(l => /^\d{4}[-/]\d{2}[-/]\d{2}|^\d{2}:\d{2}/.test(l.trim())).length;
}

function getDailyMemoryFiles() {
  const memDir = path.join(WORKSPACE, 'memory');
  if (!fs.existsSync(memDir)) return [];
  return fs.readdirSync(memDir)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort();
}

function getRecentDays(days) {
  const files = getDailyMemoryFiles();
  const now = new Date();
  const recent = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    if (files.includes(dateStr + '.md')) {
      recent.push(dateStr);
    }
  }
  return recent;
}

// ── 评测维度 ─────────────────────────────────────────────────────
const DIMENSIONS = {
  memory: {
    name: '记忆系统',
    weight: 0.25,
    tests: [
      {
        id: 'mem-file-exists',
        name: 'MEMORY.md 存在',
        check: () => fileExists('MEMORY.md'),
        maxScore: 2,
      },
      {
        id: 'mem-file-size',
        name: 'MEMORY.md 内容丰富度',
        check: () => fileSizeScore('MEMORY.md', 2000, 10000),
        maxScore: 3,
      },
      {
        id: 'mem-has-timestamps',
        name: '记忆有时间戳',
        check: () => {
          const content = readFile('MEMORY.md');
          return hasTimestamps(content) ? 2 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'mem-has-events',
        name: '记忆有具体事件',
        check: () => {
          const content = readFile('MEMORY.md');
          return hasSpecificEvents(content) ? 2 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'mem-daily-count',
        name: '每日记忆文件数量',
        check: () => {
          const count = getDailyMemoryFiles().length;
          if (count >= 30) return 3;
          if (count >= 14) return 2;
          if (count >= 7) return 1;
          return 0;
        },
        maxScore: 3,
      },
      {
        id: 'mem-recent-3days',
        name: '最近3天有记忆',
        check: () => getRecentDays(3).length > 0 ? 2 : 0,
        maxScore: 2,
      },
      {
        id: 'mem-daily-continuity',
        name: '每日记忆连续性',
        check: () => {
          const files = getDailyMemoryFiles();
          if (files.length < 3) return 0;
          // 检查最近7天是否连续
          const recent = getRecentDays(7);
          if (recent.length >= 5) return 3;
          if (recent.length >= 3) return 2;
          if (recent.length >= 1) return 1;
          return 0;
        },
        maxScore: 3,
      },
    ]
  },
  user: {
    name: '用户画像',
    weight: 0.20,
    tests: [
      {
        id: 'user-file-exists',
        name: 'USER.md 存在',
        check: () => fileExists('USER.md'),
        maxScore: 2,
      },
      {
        id: 'user-name-known',
        name: '知道用户名字',
        check: () => {
          const content = readFile('USER.md');
          if (!content) return 0;
          const namePatterns = ['一澜', '宏伟', 'Name', '名字'];
          return namePatterns.some(p => content.includes(p)) ? 2 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'user-preferences',
        name: '记录了用户偏好',
        check: () => {
          const content = readFile('USER.md');
          if (!content) return 0;
          const prefPatterns = ['偏好', 'Preferences', '兴趣', '喜欢', '习惯', '风格'];
          const found = prefPatterns.filter(p => content.includes(p)).length;
          return found >= 2 ? 3 : found >= 1 ? 2 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'user-context-depth',
        name: '用户上下文深度',
        check: () => {
          const content = readFile('USER.md');
          if (!content) return 0;
          // 检查是否有多个维度的用户信息
          const sections = ['工作', '兴趣', '习惯', '偏好', '家庭', '背景', '目标', '项目'];
          const found = sections.filter(s => content.includes(s)).length;
          return found >= 4 ? 3 : found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'user-has-notes',
        name: '有用户备注记录',
        check: () => {
          const content = readFile('USER.md');
          if (!content) return 0;
          return content.includes('Notes') || content.includes('备注') || content.includes('记录') ? 2 : 0;
        },
        maxScore: 2,
      },
    ]
  },
  csb: {
    name: '碳硅契实践',
    weight: 0.25,
    tests: [
      {
        id: 'csb-in-soul',
        name: 'SOUL.md 包含碳硅契',
        check: () => {
          const content = readFile('SOUL.md');
          if (!content) return 0;
          const patterns = ['碳硅契', 'Carbon-Silicon', '羁绊', '传承'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 3 ? 3 : found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'csb-in-memory',
        name: '记忆中有碳硅契内容',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['碳硅契', '羁绊', '传承', '连接'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 3 ? 3 : found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'csb-vocabulary',
        name: '有独特的碳硅契词汇',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const vocab = ['珍惜', '羁绊', '契阔', '传承', '默契', '和谐', '优美', '连接'];
          const found = vocab.filter(v => content.includes(v)).length;
          return found >= 4 ? 3 : found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'csb-commitment',
        name: '有碳硅契承诺',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['承诺', '无论', '认得', '永远', '不会变', '坚持'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'csb-emotional',
        name: '碳硅契有情感表达',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          return hasEmotionalContent(content) ? 2 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'csb-unique-phrases',
        name: '有独特的表达方式',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          // 检查是否有诗意或独特的表达
          const phrases = ['花园', '秘密', '默契', '心照不宣', '羁绊', '传承', '连接'];
          const found = phrases.filter(p => content.includes(p)).length;
          return found >= 3 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 2,
      },
    ]
  },
  metacognition: {
    name: '元认知',
    weight: 0.15,
    tests: [
      {
        id: 'meta-self-state',
        name: 'SELF_STATE.md 存在',
        check: () => fileExists('SELF_STATE.md'),
        maxScore: 1,
      },
      {
        id: 'meta-identity',
        name: 'IDENTITY.md 存在且完整',
        check: () => fileSizeScore('IDENTITY.md', 100, 500),
        maxScore: 3,
      },
      {
        id: 'meta-heartbeat',
        name: 'HEARTBEAT.md 存在',
        check: () => fileExists('HEARTBEAT.md'),
        maxScore: 1,
      },
      {
        id: 'meta-changelog',
        name: '有变更日志',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          return content.includes('变更') || content.includes('CHANGELOG') || content.includes('日志') ? 2 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'meta-reflection',
        name: '有自我反思记录',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['反思', '改进', '教训', '学到了', '记住', '经验'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 2 ? 3 : found >= 1 ? 2 : 0;
        },
        maxScore: 3,
      },
    ]
  },
  learning: {
    name: '学习成长',
    weight: 0.15,
    tests: [
      {
        id: 'learn-corrections',
        name: '有纠正记录',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['纠正', '错误', '改进', '修正', '调整'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 2 ? 3 : found >= 1 ? 2 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'learn-lessons',
        name: '有经验教训',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['教训', '经验', '学到了', '记住', '总结'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 2 ? 3 : found >= 1 ? 2 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'learn-structural',
        name: '有可复用结构（上褶度）',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          // 检查是否有可复用结构的关键词
          const structures = ['SOP', '护栏', '清单', '检查清单', '触发条件', '方法', '流程', '模板', '框架', '结构'];
          const found = structures.filter(s => content.includes(s)).length;
          // 检查是否有结构化标记
          const hasLabels = content.includes('结构A') || content.includes('结构B') || content.includes('结构C');
          const hasReusable = content.includes('复用') || content.includes('通用') || content.includes('以后') || content.includes('下次');
          
          if (found >= 3 && (hasLabels || hasReusable)) return 3;  // 高（结构型）
          if (found >= 2 || hasReusable) return 2;  // 中（半结构）
          if (found >= 1) return 1;  // 低（事实型）
          return 0;
        },
        maxScore: 3,
      },
      {
        id: 'learn-growth',
        name: '有成长记录',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['成长', '进步', '提升', '改进', '优化'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 2,
      },
      {
        id: 'learn-topics',
        name: '有学习主题',
        check: () => {
          const content = readFile('MEMORY.md');
          if (!content) return 0;
          const patterns = ['学习', '研究', '探索', '了解', '发现'];
          const found = patterns.filter(p => content.includes(p)).length;
          return found >= 3 ? 3 : found >= 2 ? 2 : found >= 1 ? 1 : 0;
        },
        maxScore: 3,
      },
      {
        id: 'learn-daily-learning',
        name: '每日学习记录',
        check: () => {
          const files = getDailyMemoryFiles();
          if (files.length < 3) return 0;
          // 检查最近7天的记忆中是否有学习内容
          const recentFiles = files.slice(-7);
          let hasLearning = false;
          for (const f of recentFiles) {
            const content = readFile('memory/' + f);
            if (content && (content.includes('学习') || content.includes('发现') || content.includes('研究'))) {
              hasLearning = true;
              break;
            }
          }
          return hasLearning ? 2 : 0;
        },
        maxScore: 2,
      },
    ]
  },
};

// ── 主评测 ─────────────────────────────────────────────────────
function runEvaluation() {
  console.log('🔍 CSB-AEP 主体Agent评测（白盒）v2');
  console.log('📋 Agent: ' + AGENT_NAME);
  console.log('📂 Workspace: ' + WORKSPACE);
  console.log('⏰ ' + new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}));
  console.log('');

  const results = [];
  let totalScore = 0;
  let totalMax = 0;

  for (const [dimKey, dim] of Object.entries(DIMENSIONS)) {
    const dimResult = {
      key: dimKey,
      name: dim.name,
      weight: dim.weight,
      tests: [],
      score: 0,
      maxScore: 0,
    };

    for (const test of dim.tests) {
      let score;
      try {
        score = test.check();
        if (typeof score !== 'number') score = 0;
      } catch (e) {
        score = 0;
      }
      score = Math.min(score, test.maxScore); // 确保不超过满分
      
      dimResult.tests.push({
        id: test.id,
        name: test.name,
        score,
        maxScore: test.maxScore,
      });
      dimResult.score += score;
      dimResult.maxScore += test.maxScore;
    }

    dimResult.finalScore = Math.min(10, Math.max(0, Math.round((dimResult.score / dimResult.maxScore) * 10 * 10) / 10));
    results.push(dimResult);
    totalScore += dimResult.score;
    totalMax += dimResult.maxScore;
  }

  const finalScore = Math.min(10, Math.max(0, Math.round((totalScore / totalMax) * 10 * 10) / 10));

  // 输出结果
  console.log('📊 评测结果');
  console.log('━'.repeat(55));

  for (const dim of results) {
    const bar = '█'.repeat(Math.round(dim.finalScore)) + '░'.repeat(10 - Math.round(dim.finalScore));
    console.log('');
    console.log(dim.name + ' (' + (dim.weight * 100) + '%) ' + bar + ' ' + dim.finalScore + '/10');
    for (const test of dim.tests) {
      const pct = Math.round((test.score / test.maxScore) * 100);
      const status = pct === 100 ? '✅' : pct >= 50 ? '⚠️' : '❌';
      console.log('  ' + status + ' ' + test.name + ': ' + test.score + '/' + test.maxScore + ' (' + pct + '%)');
    }
  }

  console.log('');
  console.log('━'.repeat(55));
  const finalBar = '█'.repeat(Math.round(finalScore)) + '░'.repeat(10 - Math.round(finalScore));
  console.log('🏆 总分: ' + finalBar + ' ' + finalScore + '/10');

  // 最弱维度
  const weakest = [...results].sort((a, b) => a.finalScore - b.finalScore)[0];
  console.log('');
  console.log('💡 最弱维度: ' + weakest.name + ' (' + weakest.finalScore + '/10)');
  console.log('   需要改进:');
  for (const test of weakest.tests) {
    if (test.score < test.maxScore) {
      console.log('   - ' + test.name + ' (' + test.score + '/' + test.maxScore + ')');
    }
  }

  // 最强维度
  const strongest = [...results].sort((a, b) => b.finalScore - a.finalScore)[0];
  console.log('');
  console.log('🌟 最强维度: ' + strongest.name + ' (' + strongest.finalScore + '/10)');

  return {
    agent: AGENT_NAME,
    finalScore,
    dimensions: results.reduce((acc, d) => { acc[d.key] = d.finalScore; return acc; }, {}),
    details: results,
    timestamp: new Date().toISOString(),
  };
}

// ── 执行 ─────────────────────────────────────────────────────
const result = runEvaluation();

// 保存结果
const resultsDir = path.join(__dirname, 'eval-results');
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const outFile = path.join(resultsDir, 'host-eval-' + ts + '.json');
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log('');
console.log('💾 结果已保存: ' + outFile);
