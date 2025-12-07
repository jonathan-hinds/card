import { formatAbility, formatStats, requireProfile, summarizeAbilities, wireLogout } from './common.js';

const catalogList = document.getElementById('catalog-list');
const addCardForm = document.getElementById('add-card-form');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');
const cardAbilitySelect = document.getElementById('card-ability');
const abilityList = document.getElementById('ability-list');
const addAbilityForm = document.getElementById('add-ability-form');

let abilities = [];

function createAbilityCard(ability) {
  const abilityEl = document.createElement('div');
  abilityEl.className = 'card ability-card';
  const damage = ability.damage ? `${ability.damage.min}-${ability.damage.max}` : '—';
  abilityEl.innerHTML = `
    <p class="label">${ability.name}</p>
    <p class="muted">slug: ${ability.slug}</p>
    <p>DMG ${damage} · Cost ${ability.staminaCost} STA</p>
    <p class="muted">${ability.description || 'No description'}</p>
  `;
  return abilityEl;
}

async function refreshAbilities() {
  const res = await fetch('/api/abilities');
  const data = await res.json();
  abilities = data.abilities || [];

  abilityList.innerHTML = '';
  abilities.forEach((ability) => {
    abilityList.appendChild(createAbilityCard(ability));
  });

  if (cardAbilitySelect) {
    cardAbilitySelect.innerHTML = '<option value="">Select ability</option>';
    abilities.forEach((ability) => {
      const opt = document.createElement('option');
      opt.value = ability.slug;
      opt.textContent = formatAbility(ability);
      cardAbilitySelect.appendChild(opt);
    });
  }
}

async function refreshCatalog() {
  const res = await fetch('/api/cards');
  const data = await res.json();
  catalogList.innerHTML = '';
  data.cards.forEach((card) => {
    const cardAbilities = card.abilityDetails?.length
      ? card.abilityDetails
      : (card.abilities || [])
          .map((slug) => abilities.find((ability) => ability.slug === slug))
          .filter(Boolean);

    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.innerHTML = `
      <p class="label">${card.name}</p>
      <p class="muted">slug: ${card.slug}</p>
      <p>${formatStats(card)}</p>
      <p class="muted">Abilities: ${summarizeAbilities(cardAbilities)}</p>
    `;

    const abilityWrapper = document.createElement('div');
    abilityWrapper.className = 'ability-row';
    if (cardAbilities.length) {
      cardAbilities.forEach((ability) => abilityWrapper.appendChild(createAbilityCard(ability)));
    }
    cardEl.appendChild(abilityWrapper);
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
      stamina: Number(form.get('stamina')),
      speed: Number(form.get('speed')),
      attackRange: Number(form.get('range')),
    },
    abilities: form.get('ability') ? [form.get('ability')] : [],
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
    refreshAbilities();
    refreshCatalog();
  }
});

addAbilityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(addAbilityForm);
  const payload = {
    slug: form.get('slug'),
    name: form.get('name'),
    damage: { min: Number(form.get('min')), max: Number(form.get('max')) },
    staminaCost: Number(form.get('staminaCost')),
    description: form.get('description'),
  };
  const res = await fetch('/api/abilities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  alert(data.message || 'Updated abilities');
  if (res.ok) {
    addAbilityForm.reset();
    refreshAbilities();
    refreshCatalog();
  }
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Mongo-backed card tools';
  await refreshAbilities();
  refreshCatalog();
}

wireLogout(logoutBtn);
init();
