'use strict';

const path = require('path');
const express = require('express');
const { parseSrt, buildSrt, parseFlexibleTime } = require('./src/srt');
const { repairSubtitles } = require('./src/repair');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function toNumber(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`参数 ${name} 非法：需在 ${min} ~ ${max} 之间`);
  }
  return n;
}

/** 切点文本 -> 毫秒数组。支持每行一个，或用分号 / 空白分隔 */
function parseCuts(input) {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) return input.map((v) => parseFlexibleTime(v));
  return String(input)
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseFlexibleTime(s));
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/repair', (req, res) => {
  try {
    const body = req.body || {};
    const { srt } = body;
    if (typeof srt !== 'string' || !srt.trim()) {
      return res.status(400).json({ error: '缺少字幕内容（字段 srt）' });
    }
    const options = {
      minDurationMs: toNumber(body.minDurationMs, 1000, 0, 600000, 'minDurationMs'),
      maxCps: toNumber(body.maxCps, 20, 0.1, 1000, 'maxCps'),
      minGapMs: toNumber(body.minGapMs, 100, 0, 60000, 'minGapMs'),
      cuts: parseCuts(body.cuts),
    };

    const subs = parseSrt(srt);
    const { results, conflicts } = repairSubtitles(subs, options);
    const fixedSrt = buildSrt(results.map((r) => ({
      startMs: r.newStart,
      endMs: r.newEnd,
      text: r.text,
    })));

    const stats = {
      total: results.length,
      adjusted: results.filter((r) => r.status === 'adjusted').length,
      unchanged: results.filter((r) => r.status === 'unchanged').length,
      conflict: results.filter((r) => r.status === 'conflict').length,
    };

    res.json({
      ok: conflicts.length === 0,
      stats,
      conflicts,
      subtitles: results,
      srt: fixedSrt,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`SRT 时轴修复工具已启动: http://localhost:${PORT}`);
});
