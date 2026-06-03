const statusEl = document.getElementById('status');
const clientIdInput = document.getElementById('client-id');
const redirectUri = chrome.identity.getRedirectURL();
document.getElementById('redirect-uri').textContent = redirectUri;
document.getElementById('extension-id').textContent = chrome.runtime.id;

function setStatus(lines) {
  statusEl.textContent = Array.isArray(lines) ? lines.join('\n') : lines;
}

function updateLoginState() {
  const loginBtn = document.getElementById('login');
  const hasClient = Boolean(clientIdInput.value.trim());
  loginBtn.disabled = !hasClient;
  if (!hasClient) setStatus('Enter and save your OAuth Client ID before login.');
}

clientIdInput.addEventListener('input', updateLoginState);

chrome.storage.local.get(["oauthClientId", "oauthAccessToken", "oauthTokenExpiresAt"], ({ oauthClientId, oauthAccessToken, oauthTokenExpiresAt }) => {
  clientIdInput.value = oauthClientId || "";
  if (oauthAccessToken && Date.now() < (oauthTokenExpiresAt || 0)) {
    setStatus('Already logged in. You can run Drive Permission Check or open Quick Actions.');
  }
  updateLoginState();
});

document.getElementById('save-client').addEventListener('click', () => {
  const oauthClientId = clientIdInput.value.trim();
  chrome.storage.local.set({ oauthClientId }, () => {
    updateLoginState();
    setStatus(oauthClientId ? 'Client ID saved. You can now login.' : 'Client ID cleared.');
  });
});

document.getElementById('login').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'googleLogin' }, (res) => {
    if (!res?.ok) {
      const error = res?.error || 'Unknown error';
      if (error.includes('redirect_uri_mismatch')) {
        return setStatus([
          `Login failed: ${error}`,
          'Fix checklist:',
          '1) In Google Cloud, use OAuth client type: Web application.',
          `2) Add this exact redirect URI: ${redirectUri}`,
          '3) Ensure you saved the matching OAuth Client ID in this page.',
          '4) If extension ID changed, update redirect URI for the new ID.'
        ]);
      }
      return setStatus(`Login failed: ${error}`);
    }
    setStatus([`Signed in as: ${res.email || 'Unknown account'}`, `Scopes: ${res.scopes?.join(', ') || 'Unknown'}`]);
  });
});

document.getElementById('check').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'drivePermissionCheck' }, (res) => {
    if (!res?.ok) {
      setStatus([
        `Drive check failed: ${res?.error || 'Unknown error'}`,
        'Required permissions may include: drive.file, drive.appdata, drive.metadata.readonly'
      ]);
      return;
    }
    setStatus([
      `Account: ${res.email || 'Unknown'}`,
      `Can read profile: ${res.profileRead ? 'Yes' : 'No'}`,
      `Can write test file: ${res.writeCheck ? 'Yes' : 'No'}`,
      `Can edit test file: ${res.editCheck ? 'Yes' : 'No'}`,
      `Can delete test file: ${res.deleteCheck ? 'Yes' : 'No'}`,
      `Library file: ${res.libraryFile || 'refmanager-library.json'}`,
      `Drive checks completed at: ${new Date().toISOString()}`
    ]);
  });
});

document.getElementById('open-popup').addEventListener('click', () => chrome.windows.create({ url: chrome.runtime.getURL('src/popup.html'), type: 'popup', width: 420, height: 700 }));
document.getElementById('open-policy').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/privacy.html') }));
