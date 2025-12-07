import { authHeaders, formatStats, requireProfile, summarizeAbilities, wireLogout } from './common.js';

const handSelect = document.getElementById('hand-card-select');
const handList = document.getElementById('hand-list');
const handForm = document.getElementById('hand-form');
const clearHandBtn = document.getElementById('clear-hand');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');

async function refreshCatalog() {
  const res = await fetch('/api/cards');
  const data = await res.json();
  handSelect.innerHTML = '';
  data.cards.forEach((card) => {
    const option = document.createElement('option');
    option.value = card.slug;
    const abilities = card.abilityDetails || [];
    option.textContent = `${card.name} — ${formatStats(card)} — ${summarizeAbilities(abilities)}`;
    handSelect.appendChild(option);
  });
}

async function refreshHand() {
  const res = await fetch('/api/hand', { headers: { ...authHeaders() } });
  const data = await res.json();
  handList.innerHTML = '';
  (data.hand || []).forEach((entry) => {
    const pill = document.createElement('div');
    pill.className = 'card';
    pill.innerHTML = `<p class="label">${entry.slug}</p><p>${entry.count} copies</p>`;
    handList.appendChild(pill);
  });
}

handForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(handForm);
  const payload = { cardSlug: form.get('cardSlug'), quantity: Number(form.get('quantity')) };
  await fetch('/api/hand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  refreshHand();
});

clearHandBtn.addEventListener('click', async () => {
  await fetch('/api/hand/clear', { method: 'POST', headers: { ...authHeaders() } });
  refreshHand();
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Fill your hand before matchmaking';
  await refreshCatalog();
  await refreshHand();
}

wireLogout(logoutBtn);
init();
