// ============================================================
// InterviewAgent - Side Panel Controller
// ============================================================

// ─── State ───────────────────────────────────────────────────
let currentTab = 'setup';
let selectedLevel = 'basic';
let selectedSkillFilter = null;
let timerInterval = null;
let session = null;

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initUpload();
  initButtons();
  initSettings();
  initLevelFilter();
  await syncState();
  checkApiKey();
});

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((msg) => {
  handleBroadcast(msg);
});

async function syncState() {
  const res = await sw('GET_STATE');
  if (res?.session) {
    session = res.session;
    renderAll();
  }
}

// ─── Message Helpers ──────────────────────────────────────────

function sw(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function handleBroadcast(msg) {
  switch (msg.type) {
    case 'PROCESSING':
      showProcessing(msg.step);
      break;

    case 'SKILLS_EXTRACTED':
      session = session || {};
      session.skills = msg.skills;
      renderSkills(msg.skills);
      break;

    case 'QUESTIONS_READY':
      session = session || {};
      session.questionBank = msg.questionBank;
      session.phase = 'SETUP';
      hideProcessing();
      renderQuestions();
      showElement('skills-section');
      break;

    case 'INTERVIEW_STARTED':
      session = session || {};
      session.phase = 'ACTIVE';
      session.startedAt = msg.startedAt;
      session.transcript = [];
      session.assessments = [];
      session.topicTimeline = [];
      setStatusBadge('active');
      switchTab('live');
      startTimer(msg.startedAt);
      break;

    case 'TRANSCRIPT_UPDATED':
      renderTranscript(msg.transcript);
      break;

    case 'ASSESSMENT_READY':
      if (session) {
        session.assessments = session.assessments || [];
        session.assessments.push(msg.assessment);
      }
      renderAssessment(msg.assessment);
      break;

    case 'TOPIC_SWITCHED':
      if (session) session.currentTopic = msg.topic;
      setCurrentTopic(msg.topic);
      syncState(); // refresh topic timeline
      break;

    case 'GENERATING_REPORT':
      session = session || {};
      session.phase = 'GENERATING_REPORT';
      setStatusBadge('generating');
      switchTab('report');
      showElement('report-loading');
      hideElement('report-content');
      hideElement('report-empty');
      stopTimer();
      break;

    case 'REPORT_READY':
      session = session || {};
      session.phase = 'ENDED';
      session.report = msg.report;
      setStatusBadge('ended');
      hideElement('report-loading');
      renderReport(msg.report);
      break;

    case 'ERROR':
      hideProcessing();
      showError(msg.message);
      break;

    case 'STATE_RESET':
      session = null;
      resetUI();
      break;
  }
}

// ─── Tabs ─────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('hidden', c.id !== `tab-${tab}`);
    if (c.id === `tab-${tab}`) c.classList.remove('hidden');
  });
}

// ─── Upload ───────────────────────────────────────────────────

function initUpload() {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  zone.addEventListener('click', () => fileInput.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
  });
}

async function processFile(file) {
  if (file.type !== 'application/pdf') {
    setUploadStatus('Only PDF files are supported.', 'error');
    return;
  }

  setUploadStatus(`Reading ${file.name}…`);

  try {
    const text = await extractPdfText(file);
    if (!text || text.length < 50) {
      setUploadStatus('Could not extract text from PDF. Try a different file.', 'error');
      return;
    }

    setUploadStatus(`✓ ${file.name} (${Math.round(text.length / 100) * 100} chars extracted)`, 'success');

    const candidateName = document.getElementById('candidate-name').value.trim();
    showProcessing('Sending to AI for analysis…');

    await sw('UPLOAD_RESUME', {
      resumeText: text,
      candidateName: candidateName || 'Candidate',
    });

  } catch (e) {
    setUploadStatus(`Error: ${e.message}`, 'error');
    hideProcessing();
  }
}

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js not loaded. Check your connection.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText.replace(/\s+/g, ' ').trim();
}

function setUploadStatus(msg, type = '') {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.className = 'upload-status' + (type ? ` ${type}` : '');
}

// ─── Buttons ──────────────────────────────────────────────────

function initButtons() {
  document.getElementById('start-btn').addEventListener('click', startInterview);
  document.getElementById('end-btn').addEventListener('click', endInterview);
  document.getElementById('force-assess-btn').addEventListener('click', () => sw('FORCE_ASSESS'));
  document.getElementById('copy-report-btn').addEventListener('click', copyReport);
  document.getElementById('new-interview-btn').addEventListener('click', () => sw('RESET'));
}

async function startInterview() {
  const name = document.getElementById('candidate-name').value.trim();
  if (name && session) session.candidateName = name;

  await sw('START_INTERVIEW');
}

async function endInterview() {
  if (!confirm('End the interview and generate report?')) return;
  await sw('END_INTERVIEW');
}

function copyReport() {
  if (!session?.report) return;
  const r = session.report;
  const text = [
    `# Interview Report: ${session.candidateName || 'Candidate'}`,
    `Recommendation: ${r.recommendation?.toUpperCase()}`,
    `Overall Score: ${r.overallScore}/10`,
    '',
    '## Summary',
    r.executiveSummary,
    '',
    '## Strengths',
    ...(r.strengths || []).map(s => `- ${s}`),
    '',
    '## Areas to Improve',
    ...(r.areasToImprove || []).map(a => `- ${a}`),
    '',
    '## Skill Breakdown',
    ...(r.skillAssessments || []).map(s => `- ${s.skill}: ${s.rating}/5 (${s.verdict})`),
  ].join('\n');

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-report-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy Report'; }, 2000);
  });
}

// ─── Settings ─────────────────────────────────────────────────

function initSettings() {
  const modal = document.getElementById('settings-modal');
  document.getElementById('settings-btn').addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('close-settings').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  document.getElementById('save-api-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return;
    await sw('SET_API_KEY', { key });
    setApiStatus('✓ Key saved for this session.', 'ok');
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-warning').classList.add('hidden');
  });

  document.getElementById('clear-api-key').addEventListener('click', async () => {
    await sw('SET_API_KEY', { key: '' });
    setApiStatus('Key cleared.', 'ok');
    checkApiKey();
  });
}

async function checkApiKey() {
  const res = await sw('GET_API_KEY');
  if (!res?.key) {
    document.getElementById('api-warning').classList.remove('hidden');
  } else {
    document.getElementById('api-warning').classList.add('hidden');
  }
}

function setApiStatus(msg, type) {
  const el = document.getElementById('api-key-status');
  el.textContent = msg;
  el.className = `status-text ${type}`;
}

// ─── Level Filter ─────────────────────────────────────────────

function initLevelFilter() {
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedLevel = btn.dataset.level;
      renderQuestions();
    });
  });
}

// ─── Render Functions ─────────────────────────────────────────

function renderAll() {
  if (!session) return;

  const phase = session.phase;
  setStatusBadge(phase.toLowerCase());

  if (session.skills?.length) renderSkills(session.skills);
  if (session.questionBank) renderQuestions();
  if (session.transcript?.length) renderTranscript(session.transcript.slice(-15));
  if (session.assessments?.length) renderAssessment(session.assessments[session.assessments.length - 1]);
  if (session.currentTopic) setCurrentTopic(session.currentTopic);
  if (session.topicTimeline?.length) renderTopics();
  if (session.report) renderReport(session.report);

  if (phase === 'SETUP' && session.skills?.length) showElement('skills-section');
  if (phase === 'ACTIVE' && session.startedAt) startTimer(session.startedAt);
  if (phase === 'GENERATING_REPORT') {
    showElement('report-loading');
    hideElement('report-content');
  }
}

function renderSkills(skills) {
  const list = document.getElementById('skills-list');
  const count = document.getElementById('skill-count');
  count.textContent = `${skills.length} skills`;

  list.innerHTML = skills.map(s => `
    <span class="skill-chip ${s.proficiencySignal || 'mentioned'}" title="${s.category || ''}">
      ${escHtml(s.name)}
    </span>
  `).join('');

  // Build skill filter buttons for question bank
  const filter = document.getElementById('skill-filter');
  filter.innerHTML = `
    <button class="skill-filter-btn active" data-skill="">All</button>
    ${skills.map(s => `<button class="skill-filter-btn" data-skill="${escHtml(s.name)}">${escHtml(s.name)}</button>`).join('')}
  `;

  filter.querySelectorAll('.skill-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filter.querySelectorAll('.skill-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSkillFilter = btn.dataset.skill || null;
      renderQuestions();
    });
  });
}

function renderQuestions() {
  const qb = session?.questionBank;
  if (!qb) return;

  const list = document.getElementById('question-list');
  const entries = [];

  for (const [skill, levels] of Object.entries(qb)) {
    if (selectedSkillFilter && skill !== selectedSkillFilter) continue;
    const q = levels[selectedLevel];
    if (q) {
      entries.push({ skill, question: q });
    }
  }

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No questions for this filter.</div>';
    return;
  }

  list.innerHTML = entries.map((e, i) => `
    <div class="question-item">
      <div>
        <div class="q-skill-tag">${escHtml(e.skill)}</div>
        <div class="question-text">${escHtml(e.question)}</div>
      </div>
      <button class="use-btn" data-idx="${i}">Use</button>
    </div>
  `).join('');

  // Mark questions as used
  list.querySelectorAll('.use-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      btn.textContent = '✓ Asked';
      btn.disabled = true;
      btn.style.background = '#6b7280';
    });
  });
}

function renderTranscript(entries) {
  const list = document.getElementById('transcript-list');
  if (!entries?.length) return;

  list.innerHTML = entries.map(u => `
    <div class="utterance ${u.speaker || 'unknown'}">
      <div class="utterance-speaker">${speakerLabel(u.speaker)}</div>
      <div>${escHtml(u.text)}</div>
    </div>
  `).join('');

  list.scrollTop = list.scrollHeight;
}

function speakerLabel(s) {
  if (s === 'interviewer') return '👤 You';
  if (s === 'candidate') return '👥 Candidate';
  return '🎙️ Speaker';
}

function renderAssessment(a) {
  if (!a) return;
  const card = document.getElementById('assessment-card');
  card.classList.remove('hidden');

  document.getElementById('score-stars').textContent = starsFromScore(a.score);
  const vb = document.getElementById('verdict-badge');
  vb.textContent = a.verdict || '—';
  vb.className = `verdict-badge verdict-${(a.verdict || 'adequate').toLowerCase()}`;

  document.getElementById('assessment-summary').textContent = a.summary || '';

  const gaps = document.getElementById('assessment-gaps');
  gaps.innerHTML = (a.keyGaps || []).map(g => `<span class="gap-pill">${escHtml(g)}</span>`).join('');

  const followups = a.followUpQuestions || [];
  const fSection = document.getElementById('followup-section');
  const fList = document.getElementById('followup-list');

  if (followups.length) {
    fSection.classList.remove('hidden');
    fList.innerHTML = followups.map(f => `
      <div class="followup-item">
        <div class="followup-text">${escHtml(f.question)}</div>
        <button class="use-btn">Use</button>
      </div>
    `).join('');
    fList.querySelectorAll('.use-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.textContent = '✓';
        btn.disabled = true;
        btn.style.background = '#6b7280';
      });
    });
  } else {
    fSection.classList.add('hidden');
  }
}

function starsFromScore(score) {
  const n = Math.max(1, Math.min(5, Math.round(score || 3)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function setCurrentTopic(topic) {
  document.getElementById('current-topic').textContent = topic || '—';
}

function renderTopics() {
  if (!session?.topicTimeline) return;
  const timeline = document.getElementById('topic-timeline');
  const entries = session.topicTimeline;

  if (!entries.length) {
    timeline.innerHTML = '<div class="empty-state">No topic switches detected yet.</div>';
    return;
  }

  timeline.innerHTML = entries.map(e => `
    <div class="timeline-entry">
      <div class="timeline-dot"></div>
      <span class="timeline-time">${formatTime(e.timestamp - session.startedAt)}</span>
      ${e.from ? `<span class="timeline-arrow">${escHtml(e.from)} →</span>` : ''}
      <strong>${escHtml(e.topic)}</strong>
    </div>
  `).join('');

  // Coverage bars
  const topicCounts = {};
  const totalEntries = session.transcript?.length || 1;
  entries.forEach(e => { topicCounts[e.topic] = (topicCounts[e.topic] || 0) + 1; });

  const coverage = document.getElementById('topic-coverage');
  coverage.innerHTML = Object.entries(topicCounts).map(([topic, count]) => {
    const pct = Math.min(100, Math.round((count / Math.max(entries.length, 1)) * 100));
    return `
      <div class="coverage-item">
        <div class="coverage-name">${escHtml(topic)}</div>
        <div class="coverage-bar-bg">
          <div class="coverage-bar" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderReport(r) {
  if (!r) return;
  hideElement('report-loading');
  hideElement('report-empty');
  showElement('report-content');

  // Recommendation card
  const recCard = document.getElementById('recommendation-card');
  const recMap = {
    strong_hire: { cls: 'rec-strong', label: '✅ Strong Hire' },
    hire: { cls: 'rec-hire', label: '✓ Hire' },
    no_hire: { cls: 'rec-no-hire', label: '✗ No Hire' },
    strong_no_hire: { cls: 'rec-strong-no', label: '✗✗ Strong No Hire' },
  };
  const rec = recMap[r.recommendation] || { cls: 'rec-hire', label: r.recommendation || '—' };
  recCard.className = `recommendation-card ${rec.cls}`;
  recCard.innerHTML = `
    <span class="rec-label">${rec.label}</span>
    <span class="rec-score">Overall Score: ${r.overallScore || '—'}/10</span>
  `;

  // Summary
  document.getElementById('exec-summary').textContent = r.executiveSummary || '';

  // Skill breakdown
  const breakdown = document.getElementById('skill-breakdown');
  breakdown.innerHTML = (r.skillAssessments || []).map(s => `
    <div class="skill-row">
      <span class="skill-name-col">${escHtml(s.skill)}</span>
      <span class="skill-stars">${starsFromScore(s.rating)}</span>
      <span class="skill-verdict-tag verdict-${s.verdict || 'adequate'}">${s.verdict || '—'}</span>
    </div>
  `).join('');

  // Strengths & improvements
  const str = document.getElementById('strengths-list');
  str.innerHTML = (r.strengths || []).map(s => `<li>${escHtml(s)}</li>`).join('');

  const imp = document.getElementById('improve-list');
  imp.innerHTML = (r.areasToImprove || []).map(a => `<li>${escHtml(a)}</li>`).join('');

  // Coverage
  const cov = document.getElementById('coverage-summary');
  cov.innerHTML = `
    <span style="color:#16a34a">✓ Covered: ${(r.topicsCovered || []).join(', ') || '—'}</span><br>
    <span style="color:#d97706">⚠ Missed: ${(r.topicsMissed || []).join(', ') || 'none'}</span>
  `;
}

// ─── Timer ────────────────────────────────────────────────────

function startTimer(startedAt) {
  stopTimer();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    document.getElementById('timer').textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function formatTime(ms) {
  if (!ms || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── UI Helpers ───────────────────────────────────────────────

function setStatusBadge(phase) {
  const badge = document.getElementById('status-badge');
  const map = {
    idle: ['badge-idle', 'IDLE'],
    setup: ['badge-setup', 'SETUP'],
    active: ['badge-active', 'LIVE'],
    generating_report: ['badge-generating', 'REPORT'],
    ended: ['badge-ended', 'DONE'],
  };
  const [cls, label] = map[phase] || ['badge-idle', phase.toUpperCase()];
  badge.className = `badge ${cls}`;
  badge.textContent = label;
}

function showProcessing(text) {
  document.getElementById('processing-text').textContent = text;
  document.getElementById('processing-bar').classList.remove('hidden');
  document.getElementById('skills-section').classList.add('hidden');
}

function hideProcessing() {
  document.getElementById('processing-bar').classList.add('hidden');
}

function showElement(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideElement(id) { document.getElementById(id)?.classList.add('hidden'); }

function showError(msg) {
  const existing = document.getElementById('error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'error-toast';
  toast.style.cssText = `
    position: fixed; bottom: 12px; left: 12px; right: 12px;
    background: #dc2626; color: white; padding: 10px 14px;
    border-radius: 8px; font-size: 12px; z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  `;
  toast.textContent = '⚠️ ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function resetUI() {
  session = null;
  stopTimer();
  setStatusBadge('idle');
  switchTab('setup');
  document.getElementById('candidate-name').value = '';
  document.getElementById('upload-status').textContent = '';
  document.getElementById('upload-status').className = 'upload-status';
  hideElement('skills-section');
  hideElement('processing-bar');
  document.getElementById('skills-list').innerHTML = '';
  document.getElementById('question-list').innerHTML = '';
  document.getElementById('transcript-list').innerHTML = '<div class="transcript-empty">Listening…</div>';
  hideElement('assessment-card');
  document.getElementById('current-topic').textContent = '—';
  document.getElementById('timer').textContent = '00:00';
  document.getElementById('topic-timeline').innerHTML = '<div class="empty-state">Interview not started yet.</div>';
  document.getElementById('topic-coverage').innerHTML = '';
  hideElement('report-content');
  hideElement('report-loading');
  showElement('report-empty');
  checkApiKey();
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
