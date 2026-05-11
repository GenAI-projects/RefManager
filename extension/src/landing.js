const statusEl = document.getElementById('status');
const clientIdInput = document.getElementById('client-id');

function setStatus(lines) {
  statusEl.textContent = Array.isArray(lines) ? lines.join('\n') : lines;
}

chrome.storage.local.get(["oauthClientId"], ({ oauthClientId }) => {
  clientIdInput.value = oauthClientId || "";
});

document.getElementById('save-client').addEventListener('click', () => {
  const oauthClientId = clientIdInput.value.trim();
  chrome.storage.local.set({ oauthClientId }, () => setStatus(oauthClientId ? "Client ID saved." : "Client ID cleared."));
});

document.getElementById('login').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'googleLogin' }, (res) => {
    if (!res?.ok) return setStatus(`Login failed: ${res?.error || 'Unknown error'}`);
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
      `Drive checks completed at: ${new Date().toISOString()}`
    ]);
  });
});

document.getElementById('open-popup').addEventListener('click', () => chrome.windows.create({ url: chrome.runtime.getURL('src/popup.html'), type: 'popup', width: 420, height: 700 }));
document.getElementById('open-policy').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/privacy.html') }));
