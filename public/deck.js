import { authHeaders, formatStats, requireProfile, summarizeAbilities, wireLogout } from './common.js';

const handSelect = document.getElementById('hand-card-select');
const handList = document.getElementById('hand-list');
const handForm = document.getElementById('hand-form');
const clearHandBtn = document.getElementById('clear-hand');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');
const catalogGrid = document.getElementById('catalog-grid');

let catalog = [];

function createCardTile(card, withControls = false) {
  const abilities = card.abilityDetails || [];
  const tile = document.createElement('div');
  tile.className = 'card';
  tile.innerHTML = `
    <p class="label">${card.name}</p>
    <p class="muted">slug: ${card.slug}</p>
    <p>${formatStats(card)}</p>
    <p class="muted">Abilities: ${summarizeAbilities(abilities)}</p>
  `;

  if (withControls) {
    const controls = document.createElement('div');
    controls.className = 'inline-form';
    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = '10';
    qty.value = '1';
    qty.setAttribute('aria-label', `Quantity of ${card.name} to add`);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cta';
    add.textContent = 'Add to deck';
    add.addEventListener('click', async () => {
      const quantity = Number(qty.value) || 1;
      await addToHand(card.slug, quantity);
    });
    controls.appendChild(qty);
    controls.appendChild(add);
    tile.appendChild(controls);
  }

  return tile;
}

async function refreshCatalog() {
  const res = await fetch('/api/cards');
  const data = await res.json();
  catalog = data.cards || [];
  handSelect.innerHTML = '';
  catalogGrid.innerHTML = '';

  catalog.forEach((card) => {
    const option = document.createElement('option');
    option.value = card.slug;
    const abilities = card.abilityDetails || [];
    option.textContent = `${card.name} — ${formatStats(card)} — ${summarizeAbilities(abilities)}`;
    handSelect.appendChild(option);

    catalogGrid.appendChild(createCardTile(card, true));
  });
}

async function refreshHand() {
  const res = await fetch('/api/hand', { headers: { ...authHeaders() } });
  const data = await res.json();
  renderHand(data.hand || []);
}

async function addToHand(cardSlug, quantity) {
  const res = await fetch('/api/hand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ cardSlug, quantity }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || 'Failed to update hand');
    return;
  }
  refreshHand();
}

async function updateHandQuantity(cardSlug, quantity) {
  const res = await fetch(`/api/hand/${cardSlug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ quantity }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || 'Failed to update hand');
    return;
  }
  refreshHand();
}

function renderHand(entries) {
  handList.innerHTML = '';
  const catalogMap = new Map(catalog.map((card) => [card.slug, card]));

  entries.forEach((entry) => {
    const card =
      catalogMap.get(entry.slug) ||
      { slug: entry.slug, name: entry.slug, stats: { health: '?', stamina: '?', speed: '?' }, abilityDetails: [] };
    const cardTile = createCardTile(card);

    const controls = document.createElement('div');
    controls.className = 'inline-form';

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '0';
    qty.max = '10';
    qty.value = String(entry.count);
    qty.setAttribute('aria-label', `Quantity of ${card.name} in deck`);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'cta';
    saveBtn.textContent = 'Update';
    saveBtn.addEventListener('click', async () => {
      const quantity = Number(qty.value);
      if (Number.isNaN(quantity)) {
        alert('Enter a valid quantity');
        return;
      }
      await updateHandQuantity(entry.slug, quantity);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      await updateHandQuantity(entry.slug, 0);
    });

    controls.appendChild(qty);
    controls.appendChild(saveBtn);
    controls.appendChild(removeBtn);
    const countLabel = document.createElement('p');
    countLabel.className = 'muted';
    countLabel.textContent = `${entry.count} copies in deck`;
    cardTile.appendChild(countLabel);
    cardTile.appendChild(controls);
    handList.appendChild(cardTile);
  });
}

handForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(handForm);
  const payload = { cardSlug: form.get('cardSlug'), quantity: Number(form.get('quantity')) };
  await addToHand(payload.cardSlug, payload.quantity);
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
