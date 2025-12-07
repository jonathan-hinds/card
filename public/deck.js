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

function createStatTags(stats) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tag-column';
  ['health', 'stamina', 'speed'].forEach((key) => {
    const label = document.createElement('p');
    label.className = 'slug-label';
    const prefix = key === 'health' ? 'HP' : key === 'stamina' ? 'STA' : 'SPD';
    const value = stats?.[key] ?? '—';
    label.textContent = `${prefix} ${value}`;
    wrapper.appendChild(label);
  });
  return wrapper;
}

function createAbilityCard(ability, { showActions = false, compact = false } = {}) {
  const abilityEl = document.createElement('div');
  abilityEl.className = `card ability-card catalog-card${compact ? ' compact' : ''}`;
  const damage = ability.damage ? `${ability.damage.min}-${ability.damage.max}` : '—';
  const range = Number.isFinite(ability.range) || Number.isFinite(ability.attackRange)
    ? ability.range ?? ability.attackRange
    : '—';
  const effects = ability.effects?.length ? ability.effects.join(', ') : 'No effects';
  abilityEl.innerHTML = `
    <div class="card-header tight">
      <div>
        <p class="label">${ability.name}</p>
        <p class="muted small-text ability-description">${ability.description || 'No description'}</p>
      </div>
    </div>
    <div class="ability-meta">
      <span>Target ${ability.targetType || 'enemy'}</span>
      <span>Cost ${ability.staminaCost ?? '—'} STA</span>
      <span>Range ${range}</span>
      <span>DMG ${damage}</span>
    </div>
    <p class="muted small-text ability-effects">Effects: ${effects}</p>
    ${
      showActions
        ? `<div class="card-actions">
      <button class="ghost" data-edit-ability="${ability.slug}">Edit</button>
      <button class="ghost danger" data-delete-ability="${ability.slug}">Delete</button>
    </div>`
        : ''
    }
  `;
  return abilityEl;
}

function resolveCardAbilities(card) {
  if (card.abilityDetails?.length) return card.abilityDetails;
  if (card.abilities?.length) {
    return card.abilities.map((slug) => ({
      slug,
      name: slug,
      staminaCost: '—',
      range: '—',
      targetType: 'enemy',
      description: 'No description',
      effects: [],
    }));
  }
  return [];
}

function createCardTile(card, { mode = 'catalog', count = 0 } = {}) {
  const abilities = resolveCardAbilities(card);
  const tile = document.createElement('div');
  tile.className = 'card catalog-card';
  tile.innerHTML = `
    <div class="card-header">
      <div>
        <p class="label">${card.name}</p>
        <div class="tag-column">${createStatTags(card.stats).innerHTML}</div>
      </div>
    </div>
    <p class="muted">Abilities: ${abilities.map((ability) => ability?.name).filter(Boolean).join(', ') || 'None'}</p>
  `;

  const abilityWrapper = document.createElement('div');
  abilityWrapper.className = 'ability-row';
  if (abilities.length) {
    abilities.forEach((ability) =>
      abilityWrapper.appendChild(createAbilityCard(ability, { showActions: false, compact: true }))
    );
  }
  tile.appendChild(abilityWrapper);

  if (mode === 'catalog') {
    const controls = document.createElement('div');
    controls.className = 'card-actions deck-actions';
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

  if (mode === 'hand') {
    const countLabel = document.createElement('p');
    countLabel.className = 'muted';
    countLabel.textContent = `${count} copies in deck`;
    tile.appendChild(countLabel);

    const controls = document.createElement('div');
    controls.className = 'card-actions deck-actions';

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '0';
    qty.max = '10';
    qty.value = String(count);
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
      await updateHandQuantity(card.slug, quantity);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      await updateHandQuantity(card.slug, 0);
    });

    controls.appendChild(qty);
    controls.appendChild(saveBtn);
    controls.appendChild(removeBtn);
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

    catalogGrid.appendChild(createCardTile(card, { mode: 'catalog' }));
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
    const cardTile = createCardTile(card, { mode: 'hand', count: entry.count });

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
