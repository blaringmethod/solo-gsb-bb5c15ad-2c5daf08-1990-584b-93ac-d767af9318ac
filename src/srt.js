'use strict';

/**
 * SRT 解析 / 序列化与时间戳工具。
 * 时间一律以毫秒（整数）表示。
 */

const TIME_RE = /(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

/** "HH:MM:SS,mmm" / "HH:MM:SS.mmm" -> 毫秒 */
function parseTimestamp(str) {
  const m = String(str).trim().match(TIME_RE);
  if (!m) throw new Error(`无法解析时间戳: "${str}"`);
  const [, h, mnt, s, frac] = m;
  const ms = Number(frac.padEnd(3, '0').slice(0, 3));
  return ((Number(h) * 60 + Number(mnt)) * 60 + Number(s)) * 1000 + ms;
}

/**
 * 宽松时间解析（用于场景切点输入），支持：
 *   "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS" / "MM:SS.mmm" / 纯秒数 "83.5"
 */
function parseFlexibleTime(str) {
  const s = String(str).trim();
  if (!s) throw new Error('空的时间值');
  if (!s.includes(':')) {
    const sec = Number(s);
    if (!Number.isFinite(sec) || sec < 0) throw new Error(`无法解析时间: "${str}"`);
    return Math.round(sec * 1000);
  }
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) throw new Error(`无法解析时间: "${str}"`);
  const secPart = Number(parts[parts.length - 1].replace(',', '.'));
  const minPart = Number(parts[parts.length - 2]);
  const hourPart = parts.length === 3 ? Number(parts[0]) : 0;
  if (![secPart, minPart, hourPart].every(Number.isFinite) || secPart < 0 || minPart < 0 || hourPart < 0) {
    throw new Error(`无法解析时间: "${str}"`);
  }
  return Math.round(((hourPart * 60 + minPart) * 60 + secPart) * 1000);
}

/** 毫秒 -> "HH:MM:SS,mmm" */
function formatTimestamp(ms) {
  let v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000); v -= h * 3600000;
  const m = Math.floor(v / 60000); v -= m * 60000;
  const s = Math.floor(v / 1000); v -= s * 1000;
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(v, 3)}`;
}

/** 解析 SRT 文本 -> [{ index, startMs, endMs, text }]（序号重新从 1 编排） */
function parseSrt(content) {
  const normalized = String(content).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  const subs = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue; // 跳过无时间轴的块（容错）
    const timeLine = lines[timeLineIdx];
    const arrowIdx = timeLine.indexOf('-->');
    const startStr = timeLine.slice(0, arrowIdx).trim();
    // "-->" 之后可能带有坐标等附加信息，只取第一个时间戳
    const endMatch = timeLine.slice(arrowIdx + 3).match(/\d{1,3}:\d{1,2}:\d{1,2}[,.]\d{1,3}/);
    if (!endMatch) throw new Error(`无法解析时间行: "${timeLine}"`);
    const startMs = parseTimestamp(startStr);
    const endMs = parseTimestamp(endMatch[0]);
    if (endMs < startMs) throw new Error(`第 ${subs.length + 1} 条字幕结束时间早于开始时间`);
    const text = lines.slice(timeLineIdx + 1).join('\n');
    subs.push({ index: subs.length + 1, startMs, endMs, text });
  }
  if (subs.length === 0) throw new Error('未在文件中找到任何有效字幕块');
  return subs;
}

/** [{ index, startMs, endMs, text }] -> SRT 文本（重新编号） */
function buildSrt(subs) {
  return subs
    .map((s, i) => `${i + 1}\n${formatTimestamp(s.startMs)} --> ${formatTimestamp(s.endMs)}\n${s.text}`)
    .join('\n\n') + '\n';
}

module.exports = { parseTimestamp, parseFlexibleTime, formatTimestamp, parseSrt, buildSrt };
