import { authHeaders, getActiveMatch, requireProfile, setActiveMatch, wireLogout } from './common.js';

const joinQueueBtn = document.getElementById('join-queue');
const leaveQueueBtn = document.getElementById('leave-queue');
const openBattleBtn = document.getElementById('open-battlefield');
const practiceBtn = document.getElementById('start-practice');
const queueStatus = document.getElementById('queue-status');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');

async function checkStatus() {
  const res = await fetch('/api/matchmaking/status', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (data.match) {
    setActiveMatch(data.match.id);
    queueStatus.textContent =
      data.match.mode === 'practice'
        ? 'Practice match ready. Open the battlefield to spar against yourself.'
        : 'Match found. Open the battlefield to play.';
  } else if (data.inQueue) {
    queueStatus.textContent = 'Waiting in queue…';
  } else {
    queueStatus.textContent = 'Not queued.';
  }
}

joinQueueBtn.addEventListener('click', async () => {
  const res = await fetch('/api/matchmaking/join', { method: 'POST', headers: { ...authHeaders() } });
  const data = await res.json();
  if (data.match) setActiveMatch(data.match.id);
  queueStatus.textContent = data.message;
});

leaveQueueBtn.addEventListener('click', async () => {
  const res = await fetch('/api/matchmaking/leave', { method: 'POST', headers: { ...authHeaders() } });
  const data = await res.json();
  queueStatus.textContent = data.message;
});

practiceBtn.addEventListener('click', async () => {
  const res = await fetch('/api/practice/start', { method: 'POST', headers: { ...authHeaders() } });
  const data = await res.json();
  if (res.ok && data.match) setActiveMatch(data.match.id);
  queueStatus.textContent = data.message;
});

openBattleBtn.addEventListener('click', () => {
  const matchId = getActiveMatch();
  if (!matchId) {
    queueStatus.textContent = 'No active match yet.';
    return;
  }
  window.location.href = `/battle.html`;
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Queue when your hand is ready';
  checkStatus();
  setInterval(checkStatus, 5000);
}

wireLogout(logoutBtn);
init();
