// ============================================================
// InterviewAgent - Content Script (Google Meet Integration)
// ============================================================

let isCapturing = false;
let recognition = null;
let captionObserver = null;
let lastEmittedText = '';
let lastEmittedTime = 0;
let myName = '';

// ─── Google Meet Caption Selectors ───────────────────────────
// Google Meet renders captions in a container div.
// These selectors are checked in order — Meet updates their DOM periodically.
const CAPTION_CONTAINER_SELECTORS = [
  '[jsname="tgaKEf"]',
  '.iOzk7',
  '[data-is-rounded="true"] ~ div',
  '[jscontroller="kAPMuc"] div',
];

const SPEAKER_NAME_SELECTORS = [
  '[jsname="bVqjv"]',
  '.zs7s8d',
  '[data-participant-id] span',
  '[data-self-name]',
];

// ─── Caption Observer (Primary Method) ───────────────────────

function startCaptionObserver() {
  if (captionObserver) captionObserver.disconnect();

  captionObserver = new MutationObserver(() => {
    harvestCaptions();
  });

  captionObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also poll every 800ms as a safety net
  const pollInterval = setInterval(() => {
    if (!isCapturing) {
      clearInterval(pollInterval);
      return;
    }
    harvestCaptions();
  }, 800);
}

function harvestCaptions() {
  // Try each known caption container selector
  for (const selector of CAPTION_CONTAINER_SELECTORS) {
    const containers = document.querySelectorAll(selector);
    for (const container of containers) {
      const text = container.textContent?.trim();
      if (!text || text.length < 4) continue;

      const now = Date.now();
      // Debounce: skip if same text within 2 seconds
      if (text === lastEmittedText && now - lastEmittedTime < 2000) continue;

      lastEmittedText = text;
      lastEmittedTime = now;

      // Try to identify the speaker
      const speaker = detectSpeakerFromDOM(container);

      emitUtterance(text, speaker, 'caption');
      return; // Prevent duplicates across selectors
    }
  }
}

function detectSpeakerFromDOM(nearElement) {
  // Try to find the speaker name near the caption element
  let el = nearElement;
  for (let i = 0; i < 6; i++) {
    if (!el) break;
    for (const sel of SPEAKER_NAME_SELECTORS) {
      const nameEl = el.querySelector ? el.querySelector(sel) : null;
      if (nameEl?.textContent?.trim()) {
        return classifySpeaker(nameEl.textContent.trim());
      }
    }
    el = el.parentElement;
  }

  // Try active speaker tile in the main grid
  const activeTile = document.querySelector('[data-participant-id][class*="active"]') ||
                     document.querySelector('[aria-label*="is speaking"]');
  if (activeTile) {
    const nameEl = activeTile.querySelector('span, div');
    if (nameEl?.textContent?.trim()) {
      return classifySpeaker(nameEl.textContent.trim());
    }
  }

  return 'unknown';
}

function getMyName() {
  if (myName) return myName;
  const selfSelectors = [
    '[data-self-name]',
    '[data-is-muted] + span',
    '[aria-label*="You"]',
  ];
  for (const sel of selfSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) {
      myName = el.textContent.trim();
      return myName;
    }
  }
  return '';
}

function classifySpeaker(name) {
  const me = getMyName();
  if (me && name.toLowerCase().includes(me.toLowerCase())) return 'interviewer';
  if (name && name.toLowerCase() !== 'you' && name.length > 0) return 'candidate';
  if (name.toLowerCase() === 'you') return 'interviewer';
  return 'unknown';
}

// ─── Web Speech API (Fallback / Supplement) ──────────────────

function startSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn('InterviewAgent: Web Speech API not available');
    return;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false; // Only final results to avoid noise
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (!event.results[i].isFinal) continue;
      const text = event.results[i][0].transcript.trim();
      if (text.length < 4) continue;

      // Speaker is 'unknown' from speech API — Claude will infer from context
      emitUtterance(text, 'unknown', 'speech_api');
    }
  };

  recognition.onend = () => {
    if (isCapturing) {
      setTimeout(() => {
        try { recognition?.start(); } catch (e) {}
      }, 300);
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.warn('Speech recognition error:', e.error);
    }
  };

  try {
    recognition.start();
  } catch (e) {
    console.warn('Could not start speech recognition:', e.message);
  }
}

// ─── Emit Utterance ───────────────────────────────────────────

function emitUtterance(text, speaker, source) {
  chrome.runtime.sendMessage({
    type: 'UTTERANCE',
    utterance: { text, speaker, source, timestamp: Date.now() },
  }).catch(() => {}); // Extension may have been reloaded
}

// ─── Caption Banner ───────────────────────────────────────────

function showCaptionPrompt() {
  const existing = document.getElementById('ia-caption-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'ia-caption-banner';
  banner.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: #1a73e8; color: white; padding: 10px 18px;
    border-radius: 8px; z-index: 99999; font-family: Google Sans, sans-serif;
    font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    display: flex; align-items: center; gap: 8px; cursor: pointer;
  `;
  banner.innerHTML = `
    <span>🤖 InterviewAgent:</span>
    <strong>Enable captions (CC) in Meet for best accuracy</strong>
    <span style="margin-left:8px;opacity:0.7">✕</span>
  `;
  banner.onclick = () => banner.remove();
  document.body.appendChild(banner);
  setTimeout(() => banner?.remove(), 7000);
}

function areCaptionsEnabled() {
  for (const sel of CAPTION_CONTAINER_SELECTORS) {
    if (document.querySelector(sel)) return true;
  }
  return false;
}

// ─── Message Handler ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CAPTURE') {
    isCapturing = true;

    // Start caption observer (primary)
    startCaptionObserver();

    // Start Web Speech API as supplement (catches what captions miss)
    startSpeechRecognition();

    // If captions aren't on, prompt the interviewer
    if (!areCaptionsEnabled()) {
      setTimeout(showCaptionPrompt, 1500);
    }

    sendResponse({ ok: true });
  }

  if (message.type === 'STOP_CAPTURE') {
    isCapturing = false;

    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }

    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }

    sendResponse({ ok: true });
  }
});
