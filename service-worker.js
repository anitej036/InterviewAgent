// ============================================================
// InterviewAgent - Service Worker (Background Orchestrator)
// ============================================================

// Default session state
const DEFAULT_SESSION = {
  phase: 'IDLE',        // IDLE | SETUP | ACTIVE | GENERATING_REPORT | ENDED
  candidateName: '',
  resumeText: '',
  skills: [],
  questionBank: {},
  transcript: [],
  assessments: [],
  topicTimeline: [],
  currentTopic: null,
  report: null,
  startedAt: null,
  endedAt: null,
  pendingAnswer: '',
  pendingQuestion: '',
  pendingQuestionTopic: null,
};

let session = { ...DEFAULT_SESSION };

// ─── State Persistence ──────────────────────────────────────

async function loadState() {
  try {
    const data = await chrome.storage.session.get('interview_session');
    if (data.interview_session) {
      session = data.interview_session;
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

async function saveState() {
  try {
    await chrome.storage.session.set({ interview_session: session });
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

// ─── API Key ────────────────────────────────────────────────

async function getApiKey() {
  const data = await chrome.storage.session.get('anthropic_api_key');
  return data.anthropic_api_key || null;
}

// ─── Broadcast to UI ────────────────────────────────────────

async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    // Side panel might not be open — that's fine
  }
}

// ─── Claude API ─────────────────────────────────────────────

async function callClaude(systemPrompt, userMessage, maxTokens = 2048) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No API key. Please set your Anthropic API key in settings (⚙️).');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

function parseJSON(text) {
  // Strip markdown code fences if present
  const match = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  const raw = match ? match[1] : text;
  return JSON.parse(raw.trim());
}

// ─── Claude Prompts ─────────────────────────────────────────

async function extractSkills(resumeText) {
  const text = await callClaude(
    'You are a technical recruiter AI. Extract skills from resumes. Always return valid JSON only, no explanation.',
    `Extract the candidate's skills from this resume.

Return JSON with this structure:
{
  "skills": [
    {
      "name": "skill name",
      "category": "language|framework|tool|concept|soft",
      "yearsOfExperience": null,
      "proficiencySignal": "expert|proficient|familiar|mentioned"
    }
  ]
}

Resume text:
${resumeText.substring(0, 8000)}

Return ONLY the JSON object.`,
    1024
  );
  return parseJSON(text).skills;
}

async function generateQuestions(skills) {
  const skillList = skills.map(s => `- ${s.name} (${s.proficiencySignal})`).join('\n');

  const text = await callClaude(
    'You are a senior technical interviewer. Generate targeted interview questions. Return valid JSON only.',
    `Generate 3 interview questions per skill (basic, intermediate, advanced).

Skills:
${skillList}

Return JSON:
{
  "questionBank": {
    "<skill_name>": {
      "basic": "question text",
      "intermediate": "question text",
      "advanced": "question text"
    }
  }
}

Return ONLY the JSON object.`,
    2048
  );
  return parseJSON(text).questionBank;
}

async function assessAnswer(question, answer, topic) {
  const text = await callClaude(
    'You are evaluating a live technical interview. Be concise and actionable. Return valid JSON only.',
    `Topic/Skill: ${topic || 'General'}
Question asked: "${question}"
Candidate answered: "${answer.substring(0, 2000)}"

Assess the answer and suggest follow-ups. Return JSON:
{
  "score": 3,
  "verdict": "adequate",
  "summary": "2 sentence assessment of this answer",
  "keyStrengths": ["strength 1"],
  "keyGaps": ["gap 1"],
  "followUpQuestions": [
    { "question": "follow up question", "rationale": "why ask this" }
  ]
}

score: 1(poor) to 5(excellent)
verdict: strong | adequate | weak | off-topic

Return ONLY the JSON object.`,
    1024
  );
  return parseJSON(text);
}

async function generateReport() {
  const duration = session.endedAt && session.startedAt
    ? Math.round((session.endedAt - session.startedAt) / 60000)
    : 0;

  const topicsCovered = [...new Set(session.topicTimeline.map(t => t.topic))];
  const allSkillNames = session.skills.map(s => s.name);
  const topicsMissed = allSkillNames.filter(s => !topicsCovered.includes(s));

  const assessmentSummary = session.assessments.map((a, i) =>
    `[${i + 1}] Topic: ${a.topic || 'General'}\nQ: ${a.question}\nScore: ${a.score}/5 (${a.verdict})\nGaps: ${(a.keyGaps || []).join(', ') || 'none'}`
  ).join('\n\n');

  const text = await callClaude(
    'You are a senior hiring manager writing a post-interview assessment. Be fair, specific, evidence-based. Return valid JSON only.',
    `Candidate: ${session.candidateName || 'Unknown'}
Interview duration: ${duration} minutes
Skills tested: ${topicsCovered.join(', ') || 'General'}
Skills NOT covered: ${topicsMissed.join(', ') || 'none'}

Answer assessments:
${assessmentSummary || 'No assessments recorded'}

Generate a final hiring report. Return JSON:
{
  "recommendation": "hire",
  "overallScore": 7,
  "executiveSummary": "3-4 sentence summary of the candidate",
  "skillAssessments": [
    { "skill": "skill name", "rating": 4, "verdict": "strength" }
  ],
  "strengths": ["strength 1", "strength 2"],
  "areasToImprove": ["area 1", "area 2"],
  "topicsCovered": ["topic 1"],
  "topicsMissed": ["topic 1"]
}

recommendation: strong_hire | hire | no_hire | strong_no_hire
rating/score: 1-10 scale
verdict per skill: strength | adequate | gap

Return ONLY the JSON object.`,
    2048
  );
  return parseJSON(text);
}

// ─── Topic Detection ─────────────────────────────────────────

function detectTopicFromText(text) {
  if (!session.skills.length) return null;

  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const skill of session.skills) {
    const terms = [skill.name.toLowerCase(), ...skill.name.toLowerCase().split(/[\s/,]+/)].filter(t => t.length > 2);
    const score = terms.filter(t => lower.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = skill.name;
    }
  }

  return bestScore > 0 ? best : null;
}

// ─── Utterance Processing ─────────────────────────────────────

async function processUtterance(utterance) {
  if (session.phase !== 'ACTIVE') return;

  // Add to transcript
  session.transcript.push({ ...utterance, id: Date.now() + Math.random() });

  // Keep only last 200 entries to avoid storage bloat
  if (session.transcript.length > 200) {
    session.transcript = session.transcript.slice(-200);
  }

  // Detect topic switch
  const detected = detectTopicFromText(utterance.text);
  if (detected && detected !== session.currentTopic) {
    session.topicTimeline.push({
      topic: detected,
      timestamp: utterance.timestamp,
      from: session.currentTopic,
    });
    session.currentTopic = detected;
    await broadcast({ type: 'TOPIC_SWITCHED', topic: detected });
  }

  // Accumulate answer vs detect new question
  if (utterance.speaker === 'candidate') {
    session.pendingAnswer = (session.pendingAnswer + ' ' + utterance.text).trim();
  } else if (utterance.speaker === 'interviewer') {
    // When interviewer speaks again, assess the previous answer
    if (session.pendingAnswer && session.pendingAnswer.length > 40 && session.pendingQuestion) {
      triggerAssessment(); // fire-and-forget, don't block
    }
    session.pendingQuestion = utterance.text;
    session.pendingQuestionTopic = session.currentTopic;
    session.pendingAnswer = '';
  }

  await saveState();
  await broadcast({
    type: 'TRANSCRIPT_UPDATED',
    transcript: session.transcript.slice(-15),
  });
}

// ─── Assessment ───────────────────────────────────────────────

async function triggerAssessment() {
  if (!session.pendingAnswer || !session.pendingQuestion) return;

  const q = session.pendingQuestion;
  const a = session.pendingAnswer;
  const topic = session.pendingQuestionTopic || session.currentTopic || 'General';

  // Clear pending immediately to avoid double-assessment
  session.pendingQuestion = '';
  session.pendingAnswer = '';

  try {
    const result = await assessAnswer(q, a, topic);
    const assessment = {
      question: q,
      answer: a,
      topic,
      timestamp: Date.now(),
      ...result,
    };
    session.assessments.push(assessment);
    await saveState();
    await broadcast({ type: 'ASSESSMENT_READY', assessment });
  } catch (e) {
    console.error('Assessment failed:', e);
    await broadcast({ type: 'ASSESSMENT_ERROR', message: e.message });
  }
}

// ─── Message Handler ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_STATE':
      return { session };

    case 'SET_API_KEY': {
      await chrome.storage.session.set({ anthropic_api_key: message.key });
      return { ok: true };
    }

    case 'GET_API_KEY': {
      const key = await getApiKey();
      return { key: key ? key.substring(0, 12) + '...' : null };
    }

    case 'UPLOAD_RESUME': {
      session = {
        ...DEFAULT_SESSION,
        phase: 'SETUP',
        candidateName: message.candidateName || '',
        resumeText: message.resumeText,
      };
      await saveState();

      try {
        session.skills = await extractSkills(message.resumeText);
        await saveState();

        session.questionBank = await generateQuestions(session.skills);
        await saveState();

        // Return success — sidepanel will syncState() to get the data
        return { ok: true };
      } catch (e) {
        console.error('UPLOAD_RESUME error:', e);
        return { ok: false, error: e.message };
      }
    }

    case 'START_INTERVIEW': {
      session.phase = 'ACTIVE';
      session.startedAt = Date.now();
      session.transcript = [];
      session.assessments = [];
      session.topicTimeline = [];
      session.currentTopic = null;
      session.pendingAnswer = '';
      session.pendingQuestion = '';
      await saveState();

      // Inject into active Meet tab
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE' });
        } catch (e) {
          console.warn('Could not reach content script:', e.message);
        }
      }

      await broadcast({ type: 'INTERVIEW_STARTED', startedAt: session.startedAt });
      return { ok: true };
    }

    case 'END_INTERVIEW': {
      // Stop content scripts
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      for (const tab of tabs) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'STOP_CAPTURE' }); } catch (e) {}
      }

      // Assess last pending answer
      if (session.pendingAnswer && session.pendingAnswer.length > 20 && session.pendingQuestion) {
        await triggerAssessment();
      }

      session.phase = 'GENERATING_REPORT';
      session.endedAt = Date.now();
      await saveState();
      await broadcast({ type: 'GENERATING_REPORT' });

      try {
        session.report = await generateReport();
        session.phase = 'ENDED';
        await saveState();
        await broadcast({ type: 'REPORT_READY', report: session.report });
      } catch (e) {
        await broadcast({ type: 'ERROR', message: 'Report generation failed: ' + e.message });
      }
      return { ok: true };
    }

    case 'UTTERANCE': {
      await processUtterance(message.utterance);
      return { ok: true };
    }

    case 'FORCE_ASSESS': {
      await triggerAssessment();
      return { ok: true };
    }

    case 'RESET': {
      session = { ...DEFAULT_SESSION };
      await saveState();
      await broadcast({ type: 'STATE_RESET' });
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

// Initialize on service worker startup
loadState();
