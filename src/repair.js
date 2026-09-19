'use strict';

const { formatTimestamp } = require('./srt');

/**
 * 核心修复算法。
 *
 * 规则（对每条字幕）：
 *   显示时长 >= max(最短显示时长, 可见字符数 / 最大CPS)
 *   相邻字幕间隔 >= 最小间隔
 *   保持字幕先后顺序；时间只允许向后（更晚）平移/延长，不提前于原始开始时间
 *   场景切点把整条时间轴切成若干“场景段”，任何字幕的新时间区间不得跨越切点
 *
 * 若无解，找出造成冲突的最小连续字幕段并说明原因，冲突段保留原始时间。
 */

/** 可见字符数：去掉 HTML 标签、ASS 样式块与换行后计数（含空格，与常见字幕工具一致） */
function visibleLength(text) {
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\r?\n/g, '')
    .length;
}

/** 该字幕要求的最短显示时长（毫秒） */
function requiredDurationMs(text, { minDurationMs, maxCps }) {
  const byCps = maxCps > 0 ? Math.ceil((visibleLength(text) / maxCps) * 1000) : 0;
  return Math.max(minDurationMs, byCps);
}

function fmtSec(ms) {
  return (ms / 1000).toFixed(2) + 's';
}

/**
 * @param subs    parseSrt 的结果 [{ index, startMs, endMs, text }]
 * @param options { minDurationMs, maxCps, minGapMs, cuts: number[] (毫秒) }
 * @returns { results: [...], conflicts: [...] }
 */
function repairSubtitles(subs, options) {
  const { minGapMs } = options;
  const cuts = [...new Set((options.cuts || []).filter((c) => Number.isFinite(c) && c >= 0))]
    .sort((a, b) => a - b);

  const results = subs.map((s) => {
    const requiredMs = requiredDurationMs(s.text, options);
    return {
      index: s.index,
      text: s.text,
      chars: visibleLength(s.text),
      requiredMs,
      oldStart: s.startMs,
      oldEnd: s.endMs,
      newStart: s.startMs,
      newEnd: s.endMs,
      status: 'unchanged', // unchanged | adjusted | conflict
    };
  });
  const conflicts = [];

  // 场景段边界：段 k = [cuts[k-1] ?? 0, cuts[k] ?? +∞)
  const segStartOf = (k) => (k === 0 ? 0 : cuts[k - 1]);
  const segEndOf = (k) => (k === cuts.length ? Infinity : cuts[k]);
  const findSegment = (startMs, endMs) => {
    for (let k = 0; k <= cuts.length; k++) {
      if (startMs >= segStartOf(k) && endMs <= segEndOf(k)) return k;
    }
    return -1; // 原始时间轴本身跨越切点
  };

  /** 每条字幕实际采用的时长：不缩短原始时长，只补足到要求值 */
  const targetDur = (r) => Math.max(r.oldEnd - r.oldStart, r.requiredMs);

  let prevSeg = -1;
  let prevEnd = null;          // 当前场景段内上一条字幕的（新）结束时间
  let segMembers = [];         // 当前场景段内已处理字幕在 results 中的下标

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const seg = findSegment(r.oldStart, r.oldEnd);

    if (seg === -1) {
      r.status = 'conflict';
      conflicts.push({
        type: 'crosses-cut',
        startIndex: r.index,
        endIndex: r.index,
        reason:
          `字幕 #${r.index} 的原始时间轴（${formatTimestamp(r.oldStart)} → ${formatTimestamp(r.oldEnd)}）` +
          `本身跨越了场景切点，任何不越过切点的调整都无法容纳它，已保留原始时间。请修正源文件或调整切点。`,
      });
      prevEnd = Math.max(prevEnd ?? -Infinity, r.oldEnd);
      continue;
    }

    if (seg !== prevSeg) {
      prevSeg = seg;
      prevEnd = null;
      segMembers = [];
    }
    const segStart = segStartOf(seg);
    const segEnd = segEndOf(seg);

    const dur = targetDur(r);
    const earliest = Math.max(
      r.oldStart,
      prevEnd === null ? -Infinity : prevEnd + minGapMs,
      segStart,
    );

    if (earliest + dur <= segEnd) {
      r.newStart = earliest;
      r.newEnd = earliest + dur;
      r.status = (r.newStart === r.oldStart && r.newEnd === r.oldEnd) ? 'unchanged' : 'adjusted';
      prevEnd = r.newEnd;
      segMembers.push(i);
      continue;
    }

    // —— 无解：在当前场景段内寻找造成冲突的最小连续字幕段（以当前字幕结尾） ——
    const group = [...segMembers, i];
    let winFrom = -1; // group 中的下标，窗口起点
    for (let w = group.length - 1; w >= 0; w--) {
      const first = results[group[w]];
      const avail = segEnd - Math.max(segStart, first.oldStart);
      let needed = minGapMs * (group.length - 1 - w);
      for (let t = w; t < group.length; t++) needed += targetDur(results[group[t]]);
      if (needed > avail) { winFrom = w; break; } // 从短到长扫描，第一个不可行的即最小段
    }
    if (winFrom === -1) winFrom = 0; // 理论兜底：整段都不可行
    const windowIdxs = group.slice(winFrom);

    let needed = minGapMs * (windowIdxs.length - 1);
    let windowMaxEnd = -Infinity;
    for (const wi of windowIdxs) {
      const rr = results[wi];
      needed += targetDur(rr);
      rr.newStart = rr.oldStart; // 冲突段回退为原始时间
      rr.newEnd = rr.oldEnd;
      rr.status = 'conflict';
      windowMaxEnd = Math.max(windowMaxEnd, rr.oldEnd);
    }
    const first = results[windowIdxs[0]];
    const last = results[windowIdxs[windowIdxs.length - 1]];
    const avail = segEnd - Math.max(segStart, first.oldStart);
    const rangeText = windowIdxs.length === 1 ? `#${first.index}` : `#${first.index} – #${last.index}`;
    conflicts.push({
      type: 'no-space',
      startIndex: first.index,
      endIndex: last.index,
      reason:
        `字幕 ${rangeText} 构成最小冲突段：按最短显示时长 / 最大 CPS 计算并计入最小间隔，` +
        `该段共需 ${fmtSec(needed)}，但在场景段 [${formatTimestamp(segStart)} → ${formatTimestamp(segEnd)}] 内` +
        `可用空间只有 ${fmtSec(avail)}（受切点限制，且不允许提前于原始开始时间）。` +
        `已保留原始时间，请放宽参数、移动切点或精简文本。`,
    });

    prevEnd = Math.max(prevEnd ?? -Infinity, windowMaxEnd);
    segMembers.push(i);
  }

  return { results, conflicts };
}

module.exports = { visibleLength, requiredDurationMs, repairSubtitles };
