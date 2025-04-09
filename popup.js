document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const exportBtn = document.getElementById('exportBtn');
  const statusDiv = document.getElementById('status');

  // Check initial state
  chrome.storage.local.get(['isRecording'], (result) => {
    updateUI(result.isRecording);
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isRecording) {
      updateUI(changes.isRecording.newValue);
    }
  });

  startBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }
      const response = await chrome.runtime.sendMessage({ type: 'startRecording', tabId: tab.id });
      if (!response || !response.success) {
        throw new Error('Failed to start recording');
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      statusDiv.textContent = 'Error: ' + error.message;
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'stopRecording' });
      if (!response || !response.success) {
        throw new Error('Failed to stop recording');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      statusDiv.textContent = 'Error: ' + error.message;
    }
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'exportMarkdown' });
      if (!response || !response.success) {
        throw new Error('Failed to export recording');
      }
    } catch (error) {
      console.error('Error exporting recording:', error);
      statusDiv.textContent = 'Error: ' + error.message;
    }
  });

  function updateUI(isRecording) {
    startBtn.disabled = isRecording;
    stopBtn.disabled = !isRecording;
    exportBtn.disabled = !isRecording;
    statusDiv.textContent = isRecording ? 'Recording...' : 'Not Recording';
  }
}); 