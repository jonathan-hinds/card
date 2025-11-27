const tabs = document.querySelectorAll('.tab');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const statusBox = document.getElementById('status');
const profileCard = document.getElementById('profile-card');
const profileName = document.getElementById('profile-name');
const profileMeta = document.getElementById('profile-meta');
const logoutButton = document.getElementById('logout');

let activeToken = localStorage.getItem('gothic_token') || '';

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.target;
    if (target === 'register') {
      registerForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
    } else {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
    }
    statusBox.textContent = '';
    statusBox.className = 'status';
  });
});

async function sendAuth(route, payload) {
  const res = await fetch(`/api/auth/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Unknown error');
  return data;
}

function showStatus(message, variant = 'success') {
  statusBox.textContent = message;
  statusBox.className = `status ${variant}`;
}

function saveSession(token, username) {
  activeToken = token;
  localStorage.setItem('gothic_token', token);
  localStorage.setItem('gothic_user', username);
  renderProfile(username);
}

function clearSession() {
  activeToken = '';
  localStorage.removeItem('gothic_token');
  localStorage.removeItem('gothic_user');
  profileCard.hidden = true;
}

function renderProfile(username) {
  profileName.textContent = username;
  profileMeta.textContent = 'Ready for the next duel';
  profileCard.hidden = false;
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(registerForm);
  const payload = {
    username: form.get('username'),
    password: form.get('password'),
  };
  try {
    const data = await sendAuth('register', payload);
    showStatus(data.message, 'success');
    saveSession(data.token, data.username);
    registerForm.reset();
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  const payload = {
    username: form.get('username'),
    password: form.get('password'),
  };
  try {
    const data = await sendAuth('login', payload);
    showStatus(data.message, 'success');
    saveSession(data.token, data.username);
    loginForm.reset();
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

logoutButton.addEventListener('click', () => {
  clearSession();
  showStatus('Signed out. Session cleared.', 'success');
});

async function hydrateProfile() {
  if (!activeToken) return;
  try {
    const res = await fetch('/api/profile', {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    if (!res.ok) throw new Error('Session expired.');
    const data = await res.json();
    const username = data.player.username;
    renderProfile(username);
    showStatus('Session restored.', 'success');
  } catch (error) {
    clearSession();
    showStatus(error.message, 'error');
  }
}

hydrateProfile();

