const MAX_DECK_SIZE = 20;
const MAX_COPIES_PER_CARD = 3;

const tabs = document.querySelectorAll('.tab');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const statusBox = document.getElementById('status');
const deckStatusBox = document.getElementById('deck-status');

const authPanel = document.getElementById('auth-panel');
const mainMenu = document.getElementById('main-menu');
const deckBuilder = document.getElementById('deck-builder');

const profileName = document.getElementById('profile-name');
const profileMeta = document.getElementById('profile-meta');
const logoutButton = document.getElementById('logout');
const deckNavButton = document.querySelector('[data-nav="deck"]');
const backToMenuButton = document.getElementById('back-to-menu');

const cardGrid = document.getElementById('card-grid');
const cardSearch = document.getElementById('card-search');
const schoolFilter = document.getElementById('school-filter');
const filterPanel = document.getElementById('filter-panel');
const filterControls = document.getElementById('filter-controls');
const toggleFiltersButton = document.getElementById('toggle-filters');
const deckList = document.getElementById('deck-list');
const deckNameInput = document.getElementById('deck-name');
const deckCount = document.getElementById('deck-count');
const clearDeckButton = document.getElementById('clear-deck');
const saveDeckButton = document.getElementById('save-deck');
const cardModal = document.getElementById('card-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const closeModalButton = document.getElementById('close-modal');
const modalTitle = document.getElementById('modal-title');
const modalMeta = document.getElementById('modal-meta');
const modalText = document.getElementById('modal-text');
const modalTags = document.getElementById('modal-tags');
const modalAddButton = document.getElementById('modal-add');

let activeToken = localStorage.getItem('gothic_token') || '';
let activeUser = localStorage.getItem('gothic_user') || '';
let cardPool = [];
let deckState = new Map();
let cardsLoaded = false;
let decksLoaded = false;

function showStatus(message, variant = 'success', target = statusBox) {
  if (!target) return;
  target.textContent = message;
  target.className = `status ${variant}`;
}

function clearStatus(target = statusBox) {
  if (!target) return;
  target.textContent = '';
  target.className = 'status';
}

function showScreen(view) {
  authPanel.classList.toggle('hidden', view !== 'auth');
  mainMenu.classList.toggle('hidden', view !== 'menu');
  deckBuilder.classList.toggle('hidden', view !== 'deck');
}

function renderProfile(username) {
  profileName.textContent = username;
  profileMeta.textContent = 'Ready for the next duel';
}

function saveSession(token, username) {
  activeToken = token;
  activeUser = username;
  localStorage.setItem('gothic_token', token);
  localStorage.setItem('gothic_user', username);
  renderProfile(username);
  showScreen('menu');
}

function clearSession() {
  activeToken = '';
  activeUser = '';
  localStorage.removeItem('gothic_token');
  localStorage.removeItem('gothic_user');
  deckState.clear();
  cardsLoaded = false;
  decksLoaded = false;
  showScreen('auth');
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
    showScreen('menu');
  } catch (error) {
    clearSession();
    showStatus(error.message, 'error');
  }
}

function buildTags(card) {
  const types = new Set();
  card.effects.forEach((effect) => {
    if (effect.effectType) types.add(effect.effectType);
  });
  return Array.from(types);
}

function hideCardModal() {
  cardModal.classList.add('hidden');
}

function showCardModal(card) {
  modalTitle.textContent = card.name;
  modalMeta.innerHTML = '';
  const schoolBadge = document.createElement('span');
  schoolBadge.className = 'badge';
  schoolBadge.textContent = `${card.school} • ${card.cardType}`;
  const costBadge = document.createElement('span');
  costBadge.className = 'badge';
  costBadge.textContent = `Cost ${card.cost?.soulfire ?? 0}`;
  modalMeta.append(schoolBadge, costBadge);

  modalText.textContent = card.rulesText;
  modalTags.innerHTML = '';
  buildTags(card).forEach((tag) => {
    const chip = document.createElement('span');
    chip.textContent = tag;
    modalTags.appendChild(chip);
  });

  modalAddButton.onclick = () => addToDeck(card);
  cardModal.classList.remove('hidden');
}

function renderCardGrid(cards) {
  cardGrid.innerHTML = '';
  cards.forEach((card) => {
    const tile = document.createElement('article');
    tile.className = 'card-tile';
    tile.dataset.slug = card.slug;

    const header = document.createElement('div');
    header.className = 'card-header';

    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = card.name;

    const cost = document.createElement('p');
    cost.className = 'card-cost';
    cost.textContent = `${card.cost?.soulfire ?? 0}`;

    header.append(title, cost);

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const type = document.createElement('span');
    type.className = 'badge';
    type.textContent = card.cardType;

    const school = document.createElement('span');
    school.className = 'badge';
    school.textContent = card.school;

    meta.append(type, school);

    const body = document.createElement('p');
    body.className = 'card-text';
    body.textContent = card.rulesText;

    tile.append(header, body, meta);

    let holdTimeout;
    let holdTriggered = false;

    const startHold = () => {
      clearTimeout(holdTimeout);
      holdTriggered = false;
      holdTimeout = setTimeout(() => {
        holdTriggered = true;
        showCardModal(card);
      }, 400);
    };

    const endHold = () => {
      clearTimeout(holdTimeout);
      if (!holdTriggered) addToDeck(card);
    };

    tile.addEventListener('pointerdown', startHold);
    tile.addEventListener('pointerup', endHold);
    tile.addEventListener('pointerleave', () => clearTimeout(holdTimeout));
    tile.addEventListener('pointercancel', () => clearTimeout(holdTimeout));
    cardGrid.appendChild(tile);
  });
}

function applyFilters() {
  const query = cardSearch.value.toLowerCase();
  const school = schoolFilter.value;
  const filtered = cardPool.filter((card) => {
    const matchesSchool = !school || card.school === school;
    const matchesQuery =
      !query ||
      card.name.toLowerCase().includes(query) ||
      card.rulesText.toLowerCase().includes(query) ||
      card.school.toLowerCase().includes(query);
    return matchesSchool && matchesQuery;
  });
  renderCardGrid(filtered);
}

function toggleFilters() {
  if (!filterPanel || !filterControls || !toggleFiltersButton) return;
  const collapsed = filterPanel.classList.toggle('collapsed');
  if (collapsed) {
    filterControls.setAttribute('hidden', 'true');
  } else {
    filterControls.removeAttribute('hidden');
  }
  toggleFiltersButton.textContent = collapsed ? 'Show Filters' : 'Hide Filters';
  toggleFiltersButton.setAttribute('aria-expanded', String(!collapsed));
}

function updateDeckCount() {
  const total = Array.from(deckState.values()).reduce((sum, entry) => sum + entry.quantity, 0);
  deckCount.textContent = `${total} / ${MAX_DECK_SIZE}`;
  return total;
}

function renderDeckList() {
  deckList.innerHTML = '';
  const deckArray = Array.from(deckState.values()).sort((a, b) => {
    if (a.card.school === b.card.school) {
      return a.card.name.localeCompare(b.card.name);
    }
    return a.card.school.localeCompare(b.card.school);
  });

  deckArray.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'deck-item';
    item.dataset.slug = entry.card.slug;

    const left = document.createElement('div');
    const name = document.createElement('p');
    name.className = 'label';
    name.textContent = entry.card.name;
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `${entry.card.school} • ${entry.card.cardType}`;
    left.append(name, meta);

    const qty = document.createElement('div');
    qty.className = 'inline-count';
    qty.textContent = `x${entry.quantity}`;

    item.append(left, qty);
    item.addEventListener('click', () => removeFromDeck(entry.card.slug));
    deckList.appendChild(item);
  });

  updateDeckCount();
}

function addToDeck(card) {
  const total = updateDeckCount();
  if (total >= MAX_DECK_SIZE) {
    showStatus('Deck is full.', 'error', deckStatusBox);
    return;
  }

  const existing = deckState.get(card.slug) || { card, quantity: 0 };
  if (existing.quantity >= MAX_COPIES_PER_CARD) {
    showStatus(`Max ${MAX_COPIES_PER_CARD} copies per card.`, 'error', deckStatusBox);
    return;
  }

  deckState.set(card.slug, { card, quantity: existing.quantity + 1 });
  renderDeckList();
}

function removeFromDeck(slug) {
  const entry = deckState.get(slug);
  if (!entry) return;
  if (entry.quantity <= 1) {
    deckState.delete(slug);
  } else {
    deckState.set(slug, { ...entry, quantity: entry.quantity - 1 });
  }
  renderDeckList();
}

function hydrateDeckFromSaved(deck) {
  deckState.clear();
  deck.cards.forEach((slot) => {
    const card = cardPool.find((c) => c.slug === slot.slug);
    if (card) {
      deckState.set(slot.slug, { card, quantity: slot.quantity });
    }
  });
  if (deck.name) {
    deckNameInput.value = deck.name;
  }
  renderDeckList();
  showStatus('Loaded saved deck.', 'success', deckStatusBox);
}

async function loadCards() {
  if (cardsLoaded) return;
  try {
    const res = await fetch('/api/cards');
    if (!res.ok) throw new Error('Failed to load cards.');
    const data = await res.json();
    cardPool = data.cards || [];
    cardsLoaded = true;
    applyFilters();
  } catch (error) {
    showStatus(error.message, 'error', deckStatusBox);
  }
}

async function loadDecks() {
  if (decksLoaded || !activeToken) return;
  try {
    const res = await fetch('/api/decks', {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    if (!res.ok) throw new Error('Unable to load saved decks.');
    const data = await res.json();
    if (data.decks && data.decks.length > 0) {
      hydrateDeckFromSaved(data.decks[0]);
    }
    decksLoaded = true;
  } catch (error) {
    showStatus(error.message, 'error', deckStatusBox);
  }
}

async function saveDeck() {
  const payload = {
    name: deckNameInput.value || 'First Steps',
    cards: Array.from(deckState.values()).map((entry) => ({ slug: entry.card.slug, quantity: entry.quantity })),
  };

  if (!payload.cards.length) {
    showStatus('Add cards before saving.', 'error', deckStatusBox);
    return;
  }

  try {
    const res = await fetch('/api/decks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to save deck.');
    showStatus(data.message, 'success', deckStatusBox);
  } catch (error) {
    showStatus(error.message, 'error', deckStatusBox);
  }
}

function resetDeck() {
  deckState.clear();
  renderDeckList();
  clearStatus(deckStatusBox);
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
  clearStatus(deckStatusBox);
  showStatus('Signed out. Session cleared.', 'success');
});

deckNavButton.addEventListener('click', async () => {
  if (!activeToken) {
    showStatus('Log in to build a deck.', 'error');
    return;
  }
  showScreen('deck');
  await loadCards();
  await loadDecks();
  applyFilters();
});

backToMenuButton.addEventListener('click', () => {
  showScreen('menu');
  clearStatus(deckStatusBox);
});

clearDeckButton.addEventListener('click', resetDeck);
saveDeckButton.addEventListener('click', saveDeck);

cardSearch.addEventListener('input', applyFilters);
schoolFilter.addEventListener('change', applyFilters);
toggleFiltersButton.addEventListener('click', toggleFilters);

closeModalButton.addEventListener('click', hideCardModal);
modalBackdrop.addEventListener('click', hideCardModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideCardModal();
});

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
    clearStatus();
  });
});

hydrateProfile();
applyFilters();
renderDeckList();
