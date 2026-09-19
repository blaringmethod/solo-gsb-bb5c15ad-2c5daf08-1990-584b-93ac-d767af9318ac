'use strict';

(function () {
  const fileInput = document.getElementById('file');
  const fileHint = document.getElementById('file-hint');
  const repairBtn = document.getElementById('repair-btn');
  const demoBtn = document.getElementById('demo-btn');
  const resultPanel = document.getElementById('result-panel');
  const summaryEl = document.getElementById('summary');
  const conflictsEl = document.getElementById('conflicts');
  const downloadBtn = document.getElementById('download-btn');
  const tableBody = document.querySelector('#compare-table tbody');

  let srtContent = '';
  let fileName = 'subtitles.srt';
  let fixedSrt = '';

  const DEMO_SRT = [
    '1\n00:00:01,000 --> 00:00:01,300\n这行字幕显示时间太短',
    '2\n00:00:01,400 --> 00:00:02,000\n这一行字幕的字符数比较多导致CPS超标需要延长显示',
    '3\n00:00:02,050 --> 00:00:02,400\n间隔也不够',
    '4\n00:00:06,000 --> 00:00:06,500\n场景二的第一句',
    '5\n00:00:06,600 --> 00:00:06,900\n这句在切点前放不下会报冲突',
  ].join('\n\n') + '\n';
  const DEMO_CUTS = '00:00:05,500\n00:00:07,200';

  function msToSrtTime(ms) {
    let v = Math.max(0, Math.round(ms));
    const h = Math.floor(v / 3600000); v -= h * 3600000;
    const m = Math.floor(v / 60000); v -= m * 60000;
    const s = Math.floor(v / 1000); v -= s * 1000;
    const pad = (n, w) => String(n).padStart(w, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(v, 3)}`;
  }

  function setFile(content, name) {
    srtContent = content;
    fileName = name;
    fileHint.textContent = `${name}（${(content.length / 1024).toFixed(1)} KB）`;
    repairBtn.disabled = false;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFile(String(reader.result), file.name);
    reader.onerror = () => { fileHint.textContent = '文件读取失败'; };
    reader.readAsText(file);
  });

  demoBtn.addEventListener('click', () => {
    document.getElementById('cuts').value = DEMO_CUTS;
    setFile(DEMO_SRT, 'demo.srt');
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const STATUS_LABEL = { unchanged: '未变', adjusted: '已调整', conflict: '冲突' };

  function render(data) {
    resultPanel.classList.remove('hidden');
    fixedSrt = data.srt;

    const { stats } = data;
    summaryEl.innerHTML = [
      `<span class="badge">共 ${stats.total} 条</span>`,
      `<span class="badge warn">已调整 ${stats.adjusted}</span>`,
      `<span class="badge">未变 ${stats.unchanged}</span>`,
      stats.conflict > 0
        ? `<span class="badge bad">冲突 ${stats.conflict}</span>`
        : `<span class="badge ok">✓ 全部满足约束</span>`,
    ].join('');

    if (data.conflicts.length > 0) {
      conflictsEl.innerHTML = data.conflicts.map((c) => {
        const range = c.startIndex === c.endIndex
          ? `字幕 #${c.startIndex}` : `字幕 #${c.startIndex} – #${c.endIndex}`;
        return `<div class="conflict-box"><strong>无解 · ${range}</strong><br>${escapeHtml(c.reason)}</div>`;
      }).join('');
    } else {
      conflictsEl.innerHTML = '';
    }

    tableBody.innerHTML = data.subtitles.map((s) => `
      <tr class="${s.status}">
        <td>${s.index}</td>
        <td><span class="tag ${s.status}">${STATUS_LABEL[s.status]}</span></td>
        <td>${msToSrtTime(s.oldStart)}</td>
        <td>${msToSrtTime(s.oldEnd)}</td>
        <td>${msToSrtTime(s.newStart)}</td>
        <td>${msToSrtTime(s.newEnd)}</td>
        <td>${s.chars} 字 / ≥${s.requiredMs}ms</td>
        <td class="text-cell">${escapeHtml(s.text)}</td>
      </tr>`).join('');

    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  repairBtn.addEventListener('click', async () => {
    repairBtn.disabled = true;
    try {
      const resp = await fetch('/api/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srt: srtContent,
          minDurationMs: Number(document.getElementById('min-duration').value),
          maxCps: Number(document.getElementById('max-cps').value),
          minGapMs: Number(document.getElementById('min-gap').value),
          cuts: document.getElementById('cuts').value,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        alert('修复失败：' + (data.error || resp.statusText));
        return;
      }
      render(data);
    } catch (err) {
      alert('请求失败：' + err.message);
    } finally {
      repairBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!fixedSrt) return;
    const blob = new Blob([fixedSrt], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.srt$/i, '') + '.fixed.srt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();
