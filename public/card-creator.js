import { formatStats, requireProfile, wireLogout } from './common.js';

const catalogList = document.getElementById('catalog-list');
const addCardForm = document.getElementById('add-card-form');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');

async function refreshCatalog() {
  const res = await fetch('/api/cards');
  const data = await res.json();
  catalogList.innerHTML = '';
  data.cards.forEach((card) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.innerHTML = `
      <p class="label">${card.name}</p>
      <p class="muted">slug: ${card.slug}</p>
      <p>${formatStats(card)}</p>
      <p class="muted">${(card.abilities || []).map((a) => a.name).join(', ') || 'Abilities pending'}</p>
    `;
    catalogList.appendChild(cardEl);
  });
}

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
  alert(data.message || 'Updated catalog');
  if (res.ok) {
    addCardForm.reset();
    refreshCatalog();
  }
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Mongo-backed card tools';
  refreshCatalog();
}

wireLogout(logoutBtn);
init();
