'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSrt, buildSrt, parseTimestamp, formatTimestamp, parseFlexibleTime } = require('../src/srt');
const { repairSubtitles, visibleLength } = require('../src/repair');

const OPTS = { minDurationMs: 1000, maxCps: 20, minGapMs: 100, cuts: [] };

function makeSubs(list) {
  return list.map(([startMs, endMs, text], i) => ({ index: i + 1, startMs, endMs, text }));
}

test('时间戳解析与格式化互逆', () => {
  assert.equal(parseTimestamp('00:00:01,000'), 1000);
  assert.equal(parseTimestamp('01:02:03,456'), 3723456);
  assert.equal(parseTimestamp('1:02:03.456'), 3723456);
  assert.equal(formatTimestamp(3723456), '01:02:03,456');
  assert.equal(formatTimestamp(parseTimestamp('02:59:59,999')), '02:59:59,999');
});

test('宽松时间解析（切点输入）', () => {
  assert.equal(parseFlexibleTime('83.5'), 83500);
  assert.equal(parseFlexibleTime('01:30'), 90000);
  assert.equal(parseFlexibleTime('00:01:12,500'), 72500);
  assert.equal(parseFlexibleTime('1:02:03.456'), 3723456);
  assert.throws(() => parseFlexibleTime('abc'));
});

test('SRT 解析与序列化', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\n你好\n世界\n\n2\n00:00:03,000 --> 00:00:04,000\n第二句\n';
  const subs = parseSrt(srt);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].text, '你好\n世界');
  assert.equal(subs[1].startMs, 3000);
  const round = parseSrt(buildSrt(subs));
  assert.deepEqual(round, subs);
});

test('可见字符数：忽略标签与换行', () => {
  assert.equal(visibleLength('<i>你好</i>\n世界'), 4);
  assert.equal(visibleLength('{\\an8}abc'), 3);
});

test('短字幕被延长到最短显示时长', () => {
  const subs = makeSubs([[1000, 1200, '短']]);
  const { results, conflicts } = repairSubtitles(subs, OPTS);
  assert.equal(conflicts.length, 0);
  assert.equal(results[0].newStart, 1000);
  assert.equal(results[0].newEnd, 2000); // 补足到 1000ms
  assert.equal(results[0].status, 'adjusted');
});

test('CPS 约束：字符多时需要更长时长', () => {
  const text = '一'.repeat(40); // 40 字 / 20cps = 2000ms
  const subs = makeSubs([[0, 500, text]]);
  const { results } = repairSubtitles(subs, OPTS);
  assert.equal(results[0].newEnd - results[0].newStart, 2000);
});

test('最小间隔：后一条被顺延且保持顺序', () => {
  const subs = makeSubs([
    [1000, 1500, '第一条字幕内容'],   // 延长到 1000+max(500, 6/20*1000=300)=1000+1000=2000
    [1600, 2000, '第二条'],
  ]);
  const { results, conflicts } = repairSubtitles(subs, OPTS);
  assert.equal(conflicts.length, 0);
  assert.equal(results[0].newEnd, 2000);
  assert.equal(results[1].newStart, 2100); // 2000 + 100ms 间隔
  assert.ok(results[1].newStart >= results[0].newEnd + OPTS.minGapMs);
});

test('不越过场景切点：空间足够时在切点前放下', () => {
  const subs = makeSubs([
    [1000, 1100, '第一句'],  // 需要 1000ms -> 1000~2000
    [2100, 2200, '第二句'],  // 需要 1000ms -> 2100~3100
  ]);
  const { results, conflicts } = repairSubtitles(subs, { ...OPTS, cuts: [5000] });
  assert.equal(conflicts.length, 0);
  assert.ok(results.every((r) => r.newEnd <= 5000));
});

test('无解：标出最小连续冲突段及原因', () => {
  // 切点在 5000ms；三条各需 2000ms（40 字 / 20cps），间隔 100ms
  // #3 单独可行（3000~5000 恰好 2000ms），但 #2~#3 共需 4100ms，
  // 从 #2 原始开始 1000 起到 5000 只有 4000ms -> 最小冲突段为 #2~#3
  const long = '字'.repeat(40);
  const subs = makeSubs([
    [0, 500, long],
    [1000, 1100, long],
    [3000, 3100, long],
  ]);
  const { results, conflicts } = repairSubtitles(subs, { ...OPTS, cuts: [5000] });
  assert.equal(conflicts.length, 1);
  const c = conflicts[0];
  assert.equal(c.type, 'no-space');
  assert.equal(c.startIndex, 2);
  assert.equal(c.endIndex, 3);
  assert.match(c.reason, /最小冲突段/);
  assert.match(c.reason, /4\.10s/); // 需要 4.10s
  assert.match(c.reason, /4\.00s/); // 可用 4.00s
  // 冲突段保留原始时间
  assert.equal(results[1].status, 'conflict');
  assert.equal(results[1].newStart, 1000);
  assert.equal(results[2].status, 'conflict');
  // 第一条不受影响
  assert.equal(results[0].status, 'adjusted');
  assert.equal(results[0].newEnd, 2000);
});

test('切点另一侧的字幕不受影响，且不提前于原始开始', () => {
  const subs = makeSubs([
    [0, 300, '甲'],
    [6000, 6300, '乙'],
  ]);
  const { results, conflicts } = repairSubtitles(subs, { ...OPTS, cuts: [5000] });
  assert.equal(conflicts.length, 0);
  assert.equal(results[1].newStart, 6000); // 第二段重新从原始时间开始，不被第一段推挤
  assert.ok(results.every((r) => r.newStart >= r.oldStart));
});

test('原始时间轴跨越切点：直接标记冲突', () => {
  const subs = makeSubs([[4000, 6000, '跨切点']]);
  const { results, conflicts } = repairSubtitles(subs, { ...OPTS, cuts: [5000] });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'crosses-cut');
  assert.equal(results[0].status, 'conflict');
  assert.equal(results[0].newStart, 4000); // 保留原始时间
});

test('修复结果整体校验：顺序、间隔、时长、不越切点', () => {
  const subs = makeSubs([
    [0, 200, '短'],
    [300, 500, '这一句比较长需要更多显示时间才行'],
    [700, 800, 'ok'],
    [9000, 9050, '另一场景'],
  ]);
  const cuts = [8000];
  const { results, conflicts } = repairSubtitles(subs, { ...OPTS, cuts });
  assert.equal(conflicts.length, 0);
  const segOf = (ms) => (ms < 8000 ? 0 : 1);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    assert.ok(r.newEnd - r.newStart >= r.requiredMs, `#${r.index} 时长不足`);
    assert.ok(r.newStart >= r.oldStart, `#${r.index} 被提前`);
    assert.equal(segOf(r.newStart), segOf(r.oldStart), `#${r.index} 越过切点`);
    assert.equal(segOf(r.newEnd), segOf(r.oldEnd), `#${r.index} 越过切点`);
    if (i > 0 && segOf(r.oldStart) === segOf(results[i - 1].oldStart)) {
      assert.ok(r.newStart >= results[i - 1].newEnd + OPTS.minGapMs, `#${r.index} 间隔不足`);
    }
  }
});
