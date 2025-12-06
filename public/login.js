import { saveSession } from './common.js';

const tabs = document.querySelectorAll('.tab');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const statusBox = document.getElementById('status');

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
    showStatus('', '');
  });
});

function showStatus(message, variant = 'success') {
  statusBox.textContent = message;
  statusBox.className = variant ? `status ${variant}` : 'status';
}

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

function handleSuccess(data) {
  saveSession(data.token, data.username);
  showStatus(data.message, 'success');
  window.location.href = '/menu.html';
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(registerForm);
  try {
    const data = await sendAuth('register', {
      username: form.get('username'),
      password: form.get('password'),
    });
    handleSuccess(data);
  } catch (err) {
    showStatus(err.message, 'error');
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  try {
    const data = await sendAuth('login', {
      username: form.get('username'),
      password: form.get('password'),
    });
    handleSuccess(data);
  } catch (err) {
    showStatus(err.message, 'error');
  }
});

// If a token already exists, go straight to the menu.
if (localStorage.getItem('gothic_token')) {
  window.location.href = '/menu.html';
}
