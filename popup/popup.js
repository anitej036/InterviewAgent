document.addEventListener('DOMContentLoaded', async () => {
  // Check if API key already set
  const res = await chrome.runtime.sendMessage({ type: 'GET_API_KEY' });
  if (res?.key) {
    document.getElementById('current-key-display').textContent = `✓ Key set: ${res.key}`;
    document.getElementById('current-key-display').classList.remove('hidden');
  }

  // Save button
  document.getElementById('save-btn').addEventListener('click', async () => {
    const key = document.getElementById('api-key').value.trim();
    if (!key) {
      setStatus('Enter an API key first.', 'error');
      return;
    }
    if (!key.startsWith('sk-ant-')) {
      setStatus('Invalid key format. Should start with sk-ant-', 'error');
      return;
    }
    await chrome.runtime.sendMessage({ type: 'SET_API_KEY', key });
    document.getElementById('api-key').value = '';
    document.getElementById('current-key-display').textContent = `✓ Key set: ${key.substring(0, 12)}...`;
    document.getElementById('current-key-display').classList.remove('hidden');
    setStatus('✓ API key saved for this session.', 'ok');
  });

  // Clear button
  document.getElementById('clear-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'SET_API_KEY', key: '' });
    document.getElementById('api-key').value = '';
    document.getElementById('current-key-display').classList.add('hidden');
    setStatus('Key cleared.', 'ok');
  });

  // Open side panel
  document.getElementById('open-panel-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('meet.google.com')) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } else {
      setStatus('Please navigate to meet.google.com first.', 'error');
    }
  });
});

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = `status ${type}`;
}
