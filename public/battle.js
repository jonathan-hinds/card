import {
  authHeaders,
  getActiveMatch,
  requireProfile,
  setActiveMatch,
  wireLogout,
} from './common.js';

const boardEl = document.getElementById('board');
const logEl = document.getElementById('log');
const turnIndicator = document.getElementById('turn-indicator');
const deploySelect = document.getElementById('deploy-card');
const deployForm = document.getElementById('deploy-form');
const moveForm = document.getElementById('move-form');
const attackForm = document.getElementById('attack-form');
const endTurnBtn = document.getElementById('end-turn');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');

let activeMatch = null;

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
  (lines || []).slice(-8).forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    logEl.appendChild(p);
  });
}

function renderMatch(match, username) {
  activeMatch = match;
  renderBoard(match.board);
  renderLog(match.log);
  turnIndicator.textContent = match.turn;
  deploySelect.innerHTML = '';
  const hand = match.hands ? match.hands[username] || [] : [];
  hand.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.slug;
    opt.textContent = `${entry.slug} (${entry.count})`;
    deploySelect.appendChild(opt);
  });
}

async function syncMatch(username) {
  const matchId = getActiveMatch();
  if (!matchId) return;
  const res = await fetch(`/api/matches/${matchId}`, { headers: { ...authHeaders() } });
  const data = await res.json();
  if (res.ok && data.match) {
    renderMatch(data.match, username);
  }
}

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
  if (res.ok) renderMatch(data.match, nameEl.textContent);
  metaEl.textContent = data.message || 'Deploy';
});

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
  if (res.ok) renderMatch(data.match, nameEl.textContent);
  metaEl.textContent = data.message || 'Move';
});

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
  if (res.ok) renderMatch(data.match, nameEl.textContent);
  metaEl.textContent = data.message || 'Attack';
});

endTurnBtn.addEventListener('click', async () => {
  if (!activeMatch) return;
  const res = await fetch(`/api/matches/${activeMatch.id}/end-turn`, { method: 'POST', headers: { ...authHeaders() } });
  const data = await res.json();
  if (res.ok) renderMatch(data.match, nameEl.textContent);
  metaEl.textContent = data.message || 'Turn ended';
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Waiting for match data…';

  const res = await fetch('/api/matchmaking/status', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (data.match) {
    setActiveMatch(data.match.id);
    renderMatch(data.match, profile.username);
  } else {
    metaEl.textContent = 'No active match. Return to matchmaking.';
  }

  setInterval(() => syncMatch(profile.username), 4000);
}

wireLogout(logoutBtn);
init();
