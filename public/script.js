const tabs = document.querySelectorAll('.tab');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const statusBox = document.getElementById('status');
const profileCard = document.getElementById('profile-card');
const profileName = document.getElementById('profile-name');
const profileMeta = document.getElementById('profile-meta');
const logoutButton = document.getElementById('logout');
const catalogList = document.getElementById('catalog-list');
const catalogSection = document.getElementById('card-catalog');
const handSection = document.getElementById('hand-builder');
const matchmakingSection = document.getElementById('matchmaking');
const matchSpace = document.getElementById('match-space');
const handSelect = document.getElementById('hand-card-select');
const handList = document.getElementById('hand-list');
const queueStatus = document.getElementById('queue-status');
const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const turnIndicator = document.getElementById('turn-indicator');
const deploySelect = document.getElementById('deploy-card');

let activeToken = localStorage.getItem('gothic_token') || '';
let activeMatch = null;

function authHeaders() {
  return activeToken ? { Authorization: `Bearer ${activeToken}` } : {};
}

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
  catalogSection.hidden = false;
  handSection.hidden = false;
  matchmakingSection.hidden = false;
  matchSpace.hidden = false;
  refreshCatalog();
  refreshHand();
  checkQueue();
}

function clearSession() {
  activeToken = '';
  localStorage.removeItem('gothic_token');
  localStorage.removeItem('gothic_user');
  profileCard.hidden = true;
  catalogSection.hidden = true;
  handSection.hidden = true;
  matchmakingSection.hidden = true;
  matchSpace.hidden = true;
  activeMatch = null;
  boardEl.innerHTML = '';
  logEl.innerHTML = '';
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
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error('Session expired.');
    const data = await res.json();
    const username = data.player.username;
    renderProfile(username);
    catalogSection.hidden = false;
    handSection.hidden = false;
    matchmakingSection.hidden = false;
    matchSpace.hidden = false;
    refreshCatalog();
    refreshHand();
    checkQueue();
    showStatus('Session restored.', 'success');
  } catch (error) {
    clearSession();
    showStatus(error.message, 'error');
  }
}

async function refreshCatalog() {
  const res = await fetch('/api/cards');
  const data = await res.json();
  if (!res.ok) return;
  catalogList.innerHTML = '';
  handSelect.innerHTML = '';
  data.cards.forEach((card) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.innerHTML = `
      <p class="label">${card.name}</p>
      <p class="muted">slug: ${card.slug}</p>
      <p>HP ${card.stats.health} · DMG ${card.stats.damage.min}-${card.stats.damage.max}</p>
      <p>Sta ${card.stats.stamina} · Spd ${card.stats.speed} · Range ${card.stats.attackRange}</p>
      <p class="muted">${(card.abilities || []).map((a) => a.name).join(', ')}</p>
    `;
    catalogList.appendChild(cardEl);

    const option = document.createElement('option');
    option.value = card.slug;
    option.textContent = card.name;
    handSelect.appendChild(option);
  });
  deploySelect.innerHTML = handSelect.innerHTML;
}

async function refreshHand() {
  const res = await fetch('/api/hand', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (!res.ok) return;
  handList.innerHTML = '';
  (data.hand || []).forEach((entry) => {
    const pill = document.createElement('div');
    pill.className = 'card';
    pill.innerHTML = `<p class="label">${entry.slug}</p><p>${entry.count} copies</p>`;
    handList.appendChild(pill);
  });
  deploySelect.value = (data.hand[0] || {}).slug || '';
}

const addCardForm = document.getElementById('add-card-form');
addCardForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(addCardForm);
  const payload = {
    slug: form.get('slug'),
    name: form.get('name'),
    stats: {
      health: Number(form.get('health')),
      damage: { min: Number(form.get('min')), max: Number(form.get('max')) },
      stamina: Number(form.get('stamina')),
      speed: Number(form.get('speed')),
      attackRange: Number(form.get('range')),
    },
    abilities: [],
  };
  const res = await fetch('/api/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  showStatus(data.message || 'Added.', res.ok ? 'success' : 'error');
  if (res.ok) {
    addCardForm.reset();
    refreshCatalog();
  }
});

const handForm = document.getElementById('hand-form');
handForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(handForm);
  const payload = {
    cardSlug: form.get('cardSlug'),
    quantity: Number(form.get('quantity')),
  };
  const res = await fetch('/api/hand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  showStatus(data.message || 'Updated hand.', res.ok ? 'success' : 'error');
  if (res.ok) refreshHand();
});

const clearHandBtn = document.getElementById('clear-hand');
clearHandBtn.addEventListener('click', async () => {
  const res = await fetch('/api/hand/clear', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  const data = await res.json();
  showStatus(data.message || 'Cleared hand.', res.ok ? 'success' : 'error');
  if (res.ok) refreshHand();
});

const joinQueueBtn = document.getElementById('join-queue');
const leaveQueueBtn = document.getElementById('leave-queue');

joinQueueBtn.addEventListener('click', async () => {
  const res = await fetch('/api/matchmaking/join', { method: 'POST', headers: { ...authHeaders() } });
  const data = await res.json();
  queueStatus.textContent = data.message;
  if (data.match) {
    activeMatch = data.match;
    renderMatch(activeMatch);
  }
});

leaveQueueBtn.addEventListener('click', async () => {
  const res = await fetch('/api/matchmaking/leave', { method: 'POST', headers: { ...authHeaders() } });
  const data = await res.json();
  queueStatus.textContent = data.message;
});

async function checkQueue() {
  const res = await fetch('/api/matchmaking/status', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (data.match) {
    activeMatch = data.match;
    renderMatch(activeMatch);
    queueStatus.textContent = 'Match ready.';
  } else if (data.inQueue) {
    queueStatus.textContent = 'Waiting in queue...';
  } else {
    queueStatus.textContent = 'Not queued.';
  }
}

function renderBoard(board) {
  boardEl.innerHTML = '';
  board.forEach((row, r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'board-row';
    row.forEach((cell, c) => {
      const cellEl = document.createElement('div');
      cellEl.className = 'board-cell';
      cellEl.innerHTML = cell
        ? `<span>${cell.owner[0].toUpperCase()}</span><small>${cell.health}hp/${cell.stamina}sta</small>`
        : '';
      cellEl.title = cell
        ? `${cell.owner} · ${cell.name} (${cell.health} hp, ${cell.stamina}/${cell.staminaMax} sta)`
        : `(${r},${c}) empty`;
      rowEl.appendChild(cellEl);
    });
    boardEl.appendChild(rowEl);
  });
}

function renderLog(lines) {
  logEl.innerHTML = '';
  lines.slice(-8).forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    logEl.appendChild(p);
  });
}

function renderMatch(match) {
  activeMatch = match;
  renderBoard(match.board);
  renderLog(match.log || []);
  turnIndicator.textContent = match.turn;
  deploySelect.innerHTML = '';
  const hand = match.hands ? match.hands[localStorage.getItem('gothic_user')] || [] : [];
  hand.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.slug;
    opt.textContent = `${entry.slug} (${entry.count})`;
    deploySelect.appendChild(opt);
  });
}

async function syncMatch() {
  if (!activeMatch) return;
  const res = await fetch(`/api/matches/${activeMatch.id}`, { headers: { ...authHeaders() } });
  const data = await res.json();
  if (res.ok) renderMatch(data.match);
}

const deployForm = document.getElementById('deploy-form');
deployForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeMatch) return;
  const payload = {
    cardSlug: deploySelect.value,
    row: Number(document.getElementById('deploy-row').value),
    col: Number(document.getElementById('deploy-col').value),
  };
  const res = await fetch(`/api/matches/${activeMatch.id}/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  showStatus(data.message || 'Deploy', res.ok ? 'success' : 'error');
  if (res.ok) renderMatch(data.match);
});

const moveForm = document.getElementById('move-form');
moveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeMatch) return;
  const payload = {
    fromRow: Number(document.getElementById('move-from-row').value),
    fromCol: Number(document.getElementById('move-from-col').value),
    toRow: Number(document.getElementById('move-to-row').value),
    toCol: Number(document.getElementById('move-to-col').value),
  };
  const res = await fetch(`/api/matches/${activeMatch.id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  showStatus(data.message || 'Move', res.ok ? 'success' : 'error');
  if (res.ok) renderMatch(data.match);
});

const attackForm = document.getElementById('attack-form');
attackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeMatch) return;
  const payload = {
    fromRow: Number(document.getElementById('attack-from-row').value),
    fromCol: Number(document.getElementById('attack-from-col').value),
    targetRow: Number(document.getElementById('attack-target-row').value),
    targetCol: Number(document.getElementById('attack-target-col').value),
  };
  const res = await fetch(`/api/matches/${activeMatch.id}/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  showStatus(data.message || 'Attack', res.ok ? 'success' : 'error');
  if (res.ok) renderMatch(data.match);
});

const endTurnBtn = document.getElementById('end-turn');
endTurnBtn.addEventListener('click', async () => {
  if (!activeMatch) return;
  const res = await fetch(`/api/matches/${activeMatch.id}/end-turn`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  const data = await res.json();
  showStatus(data.message || 'End turn', res.ok ? 'success' : 'error');
  if (res.ok) renderMatch(data.match);
});

hydrateProfile();
setInterval(syncMatch, 4000);
