const MAX_DECK_SIZE = 20;
const MAX_COPIES_PER_CARD = 3;

const Resource = Object.freeze({
  VITALITY: 'vitality',
  WILL: 'will',
  SOULFIRE: 'soulfire',
});

const tabs = document.querySelectorAll('.tab');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const statusBox = document.getElementById('status');
const deckStatusBox = document.getElementById('deck-status');

const authPanel = document.getElementById('auth-panel');
const mainMenu = document.getElementById('main-menu');
const deckBuilder = document.getElementById('deck-builder');
const duelHub = document.getElementById('duel-hub');
const duelTable = document.getElementById('duel-table');

const duelNavButton = document.querySelector('[data-nav="duel"]');
const duelToMenuButton = document.getElementById('duel-to-menu');
const duelExitButton = document.getElementById('duel-exit');
const startLocalDuelButton = document.getElementById('start-local-duel');
const duelDeckLabel = document.getElementById('duel-deck-label');
const duelStatusText = document.getElementById('duel-status');
const queueTypeLocal = document.getElementById('queue-type-local');
const queueTypeMatch = document.getElementById('queue-type-match');
const duelPhase = document.getElementById('duel-phase');
const turnIndicator = document.getElementById('turn-indicator');
const endTurnButton = document.getElementById('end-turn');

const playerNameLabel = document.getElementById('player-name');
const opponentNameLabel = document.getElementById('opponent-name');
const playerStatusText = document.getElementById('player-status');
const opponentStatusText = document.getElementById('opponent-status');
const playerStats = document.getElementById('player-stats');
const opponentStats = document.getElementById('opponent-stats');
const opponentHandBox = document.getElementById('opponent-hand');
const opponentHandZone = document.getElementById('opponent-hand-zone');
const opponentVoidZone = document.getElementById('opponent-void');
const opponentActiveZone = document.getElementById('opponent-active');
const opponentDiscardZone = document.getElementById('opponent-discard');
const playerVoidZone = document.getElementById('player-void');
const playerActiveZone = document.getElementById('player-active');
const playerDiscardZone = document.getElementById('player-discard');
const phaseTrack = document.getElementById('phase-track');
const duelLogBox = document.getElementById('duel-log');
const handGrid = document.getElementById('hand-grid');

const PHASES = ['Start', 'Draw', 'Main', 'End'];

const profileName = document.getElementById('profile-name');
const profileMeta = document.getElementById('profile-meta');
const logoutButton = document.getElementById('logout');
const deckNavButton = document.querySelector('[data-nav="deck"]');
const backToMenuButton = document.getElementById('back-to-menu');

const cardGrid = document.getElementById('card-grid');
const cardSearch = document.getElementById('card-search');
const deckList = document.getElementById('deck-list');
const deckNameInput = document.getElementById('deck-name');
const deckCount = document.getElementById('deck-count');
const clearDeckButton = document.getElementById('clear-deck');
const saveDeckButton = document.getElementById('save-deck');
const schoolChips = document.getElementById('school-chips');
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
let activeSchool = '';
let duelEngine = null;
let duelMode = 'local';

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
  const views = {
    auth: authPanel,
    menu: mainMenu,
    deck: deckBuilder,
    duel: duelHub,
    table: duelTable,
  };

  Object.entries(views).forEach(([key, element]) => {
    if (!element) return;
    element.classList.toggle('hidden', view !== key);
  });
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
  const filtered = cardPool.filter((card) => {
    const matchesSchool = !activeSchool || card.school === activeSchool;
    const matchesQuery =
      !query ||
      card.name.toLowerCase().includes(query) ||
      card.rulesText.toLowerCase().includes(query) ||
      card.school.toLowerCase().includes(query);
    return matchesSchool && matchesQuery;
  });
  renderCardGrid(filtered);
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

class DuelEngine {
  constructor(pool = []) {
    this.cardPool = pool;
    this.players = [];
    this.state = {
      activePlayer: 0,
      turn: 1,
      phaseIndex: 0,
      logs: [],
    };
  }

  snapshot() {
    return {
      ...this.state,
      phase: PHASES[this.state.phaseIndex],
      players: this.players.map((player) => ({
        ...player,
        hand: [...player.hand],
        deck: [...player.deck],
        discard: [...player.discard],
        void: [...player.void],
        inPlay: [...player.inPlay],
      })),
    };
  }

  getOpponentIndex(index) {
    return index === 0 ? 1 : 0;
  }

  getTargetWizard(effect, controllerIndex) {
    switch (effect.target) {
      case 'self':
      case 'controller':
      case 'attached-wizard':
        return controllerIndex;
      case 'enemy-wizard':
        return this.getOpponentIndex(controllerIndex);
      case 'any-wizard':
      case 'any-target':
      default: {
        if (['DAMAGE', 'DISCARD', 'ATTACH_HEX'].includes(effect.effectType)) {
          return this.getOpponentIndex(controllerIndex);
        }
        return controllerIndex;
      }
    }
  }

  applyWard(targetPlayer, amount, resourceType) {
    if (targetPlayer.ward.amount > 0) {
      this.log(`${targetPlayer.name} already has Ward this turn.`);
      return;
    }
    targetPlayer.ward = { amount, resourceType: resourceType || null };
    this.log(`${targetPlayer.name} gains Ward ${amount}.`);
  }

  applyBurn(targetPlayer, amount) {
    targetPlayer.burn.push(amount);
    this.log(`${targetPlayer.name} gains Burn ${amount}.`);
  }

  applyDamage(targetPlayer, amount, resourceType) {
    let pending = amount;
    if (targetPlayer.ward.amount > 0) {
      const prevented = Math.min(targetPlayer.ward.amount, pending);
      pending -= prevented;
      targetPlayer.ward.amount -= prevented;
      this.log(`${targetPlayer.name}'s Ward prevents ${prevented} damage.`);
    }

    if (pending <= 0) return 0;

    const key = resourceType === Resource.WILL ? 'will' : 'vitality';
    targetPlayer[key] = Math.max(0, targetPlayer[key] - pending);
    this.log(`${targetPlayer.name} loses ${pending} ${key === 'will' ? 'Will' : 'Vitality'}.`);
    return pending;
  }

  log(message) {
    this.state.logs.unshift({ message, at: new Date().toISOString() });
  }

  shuffle(cards) {
    const arr = [...cards];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  createPlayer(config, isFirst) {
    const deck = this.shuffle(config.deck || []);
    return {
      name: config.name || 'Player',
      vitality: 20,
      will: 10,
      maxSoulfire: 3,
      currentSoulfire: 3,
      ward: { amount: 0, resourceType: null },
      burn: [],
      channel: 0,
      spellsCastThisTurn: 0,
      hauntUsedThisTurn: false,
      deck,
      hand: [],
      discard: [],
      void: [],
      inPlay: [],
      hasReshuffled: false,
      drewAfterReshuffleThisTurn: false,
      skipNextDraw: isFirst,
    };
  }

  start({ players }) {
    this.players = players.map((player, index) => this.createPlayer(player, index === 0));
    this.state = { activePlayer: 0, turn: 1, phaseIndex: 0, logs: [] };

    this.drawCards(0, 5);
    this.drawCards(1, 6);
    this.log('Duel initialized. First player skips their first draw.');
    this.setPhase('Start');
    return this.snapshot();
  }

  setPhase(phaseName) {
    const index = PHASES.indexOf(phaseName);
    this.state.phaseIndex = Math.max(0, index);
    this.state.phase = phaseName;
    this.log(`Phase: ${phaseName}`);
    if (phaseName === 'Start') {
      this.runStartPhase();
      return this.setPhase('Draw');
    }
    if (phaseName === 'Draw') {
      this.runDrawPhase();
      return this.setPhase('Main');
    }
    if (phaseName === 'End') {
      this.runEndPhase();
    }
    return this.snapshot();
  }

  endTurn() {
    if (this.state.phase !== 'End') {
      this.setPhase('End');
    }
    this.state.activePlayer = this.state.activePlayer === 0 ? 1 : 0;
    this.state.turn += 1;
    this.state.phaseIndex = 0;
    this.players[this.state.activePlayer].drewAfterReshuffleThisTurn = false;
    this.players[this.state.activePlayer].spellsCastThisTurn = 0;
    this.players[this.state.activePlayer].hauntUsedThisTurn = false;
    return this.setPhase('Start');
  }

  runStartPhase() {
    const player = this.players[this.state.activePlayer];
    player.ward = { amount: 0, resourceType: null };
    player.channel = 0;
    player.spellsCastThisTurn = 0;
    player.hauntUsedThisTurn = false;
    player.maxSoulfire = Math.min(10, player.maxSoulfire + 1);
    player.currentSoulfire = player.maxSoulfire;
    this.log(`${player.name} refreshes to ${player.currentSoulfire} Soulfire.`);

    if (player.burn.length) {
      player.burn = player.burn.filter((value) => {
        this.applyDamage(player, value, Resource.VITALITY);
        return false; // Burn markers expire after triggering once
      });
    }

    this.resolveOngoing(player, 'start-of-turn');
  }

  runDrawPhase() {
    const player = this.players[this.state.activePlayer];
    if (player.skipNextDraw) {
      this.log(`${player.name} skips the first draw of the game.`);
      player.skipNextDraw = false;
      return;
    }
    this.drawCards(this.state.activePlayer, 1);
  }

  runEndPhase() {
    const player = this.players[this.state.activePlayer];
    this.resolveOngoing(player, 'end-of-turn');
    if (player.hand.length > 7) {
      const extra = player.hand.splice(7);
      player.discard.push(...extra);
      this.log(`${player.name} discards ${extra.length} down to 7 cards.`);
    }

    if (player.hasReshuffled && player.drewAfterReshuffleThisTurn) {
      player.will = Math.max(0, player.will - 1);
      this.log(`${player.name} loses 1 Will after drawing post-reshuffle.`);
    }
    player.drewAfterReshuffleThisTurn = false;
    player.ward = { amount: 0, resourceType: null };
    player.channel = 0;
  }

  drawCards(playerIndex, count) {
    for (let i = 0; i < count; i += 1) {
      this.drawCard(playerIndex);
    }
    return this.snapshot();
  }

  drawCard(playerIndex) {
    const player = this.players[playerIndex];
    if (!player) return null;

    if (player.deck.length === 0) {
      this.reshuffle(player);
    }

    const card = player.deck.shift();
    if (card) {
      player.hand.push(card);
      if (player.hasReshuffled) {
        player.drewAfterReshuffleThisTurn = true;
      }
      this.log(`${player.name} draws ${card.name}.`);
      return card;
    }
    this.log(`${player.name} could not draw a card.`);
    return null;
  }

  reshuffle(player) {
    const pool = [...player.discard, ...player.void, ...player.inPlay];
    player.discard = [];
    player.void = [];
    player.inPlay = [];
    player.deck = this.shuffle(pool);
    player.hasReshuffled = true;
    this.log(`${player.name} reshuffles their discard, void, and ongoing cards.`);
  }

  resolveOngoing(player, timing) {
    player.inPlay.forEach((hex) => {
      if (!hex.ongoing) return;
      hex.ongoing.forEach((effect) => {
        if (effect.timing && effect.timing !== timing) return;
        if (effect.effectType === 'DAMAGE') {
          const targetIndex = hex.attachedTo ?? this.players.indexOf(player);
          const target = this.players[targetIndex];
          this.applyDamage(target, effect.amount, effect.resource);
        }
        if (effect.effectType === 'STATUS_TRIGGER' && effect.status === 'no-spell-cast') {
          const targetIndex = hex.attachedTo ?? this.players.indexOf(player);
          const targetWizard = this.players[targetIndex];
          if (targetWizard.spellsCastThisTurn === 0) {
            this.applyDamage(targetWizard, effect.reaction.amount, effect.reaction.resource);
          }
        }
      });
    });
  }

  canPayAdditionalCost(player, cost) {
    if (!cost) return false;
    if (cost.resource === Resource.VITALITY) return player.vitality >= cost.amount;
    if (cost.resource === Resource.WILL) return player.will >= cost.amount;
    return false;
  }

  payAdditionalCost(player, cost, card) {
    if (!cost) return;
    if (cost.resource === Resource.VITALITY) {
      player.vitality = Math.max(0, player.vitality - cost.amount);
      this.log(`${player.name} pays ${cost.amount} Vitality for ${card.name}.`);
    }
    if (cost.resource === Resource.WILL) {
      player.will = Math.max(0, player.will - cost.amount);
      this.log(`${player.name} pays ${cost.amount} Will for ${card.name}.`);
    }
  }

  dispelHexes(targetIndex, amount) {
    let remaining = amount;
    this.players.forEach((owner) => {
      const kept = [];
      owner.inPlay.forEach((hex) => {
        if (remaining > 0 && hex.cardType === 'Hex' && hex.attachedTo === targetIndex) {
          owner.void.push(hex);
          remaining -= 1;
          this.log(`${hex.name} is dispelled.`);
        } else {
          kept.push(hex);
        }
      });
      owner.inPlay = kept;
    });
  }

  checkCondition(condition, controllerIndex) {
    if (!condition) return false;
    const targetIndex = this.getTargetWizard(condition, controllerIndex);
    const target = this.players[targetIndex];
    if (!target) return false;

    if (condition.effectType === 'WARD' && condition.target === 'controller') {
      return target.ward.amount > 0;
    }

    if (condition.thresholdResource) {
      const current = condition.thresholdResource === Resource.WILL ? target.will : target.vitality;
      if (condition.comparison === 'or-less') {
        return current <= condition.threshold;
      }
      if (condition.comparison === 'or-more') {
        return current >= condition.threshold;
      }
    }

    if (condition.voidSizeAtLeast) {
      return target.void.length >= condition.voidSizeAtLeast;
    }

    return false;
  }

  applyEffect(effect, context) {
    const controller = this.players[context.controllerIndex];
    const targetIndex = this.getTargetWizard(effect, context.controllerIndex);
    const target = this.players[targetIndex];

    switch (effect.effectType) {
      case 'COST_PAYMENT':
        if (effect.resource === Resource.VITALITY) {
          controller.vitality = Math.max(0, controller.vitality - effect.amount);
          this.log(`${controller.name} pays ${effect.amount} Vitality.`);
        }
        if (effect.resource === Resource.WILL) {
          controller.will = Math.max(0, controller.will - effect.amount);
          this.log(`${controller.name} pays ${effect.amount} Will.`);
        }
        break;
      case 'DAMAGE': {
        const dealt = this.applyDamage(target, effect.amount, effect.resource);
        if (effect.resource === Resource.VITALITY) {
          context.vitalityDamageDealt += dealt;
        }
        break;
      }
      case 'DRAIN':
        if (context.vitalityDamageDealt > 0) {
          controller.vitality = Math.min(20, controller.vitality + effect.amount);
          this.log(`${controller.name} drains ${effect.amount} Vitality.`);
        }
        break;
      case 'CHANNEL':
        controller.channel = Math.max(controller.channel, effect.amount);
        this.log(`${controller.name} gains Channel ${effect.amount} for their next spell this turn.`);
        break;
      case 'BURN':
        this.applyBurn(target, effect.amount);
        break;
      case 'WARD':
        this.applyWard(target, effect.amount, effect.resourceFocus);
        if (targetIndex === context.controllerIndex) {
          context.wardedSelfThisSpell = true;
        }
        break;
      case 'DRAW':
        this.drawCards(context.controllerIndex, effect.amount);
        break;
      case 'DISCARD':
        if (target.hand.length > 0) {
          const discarded = target.hand.shift();
          target.discard.push(discarded);
          this.log(`${target.name} discards ${discarded.name}.`);
        } else {
          this.log(`${target.name} has no cards to discard.`);
        }
        break;
      case 'ATTACH_HEX':
        context.lastAttachedTarget = targetIndex;
        if (effect.ongoing) {
          controller.inPlay.push({ ...context.card, attachedTo: targetIndex, ongoing: effect.ongoing });
          context.hexAttached = true;
        }
        break;
      case 'DISPEL':
        this.dispelHexes(targetIndex, effect.amount);
        break;
      case 'INSIGHT':
        this.log(`${controller.name} looks at the top ${effect.amount} cards (Insight).`);
        break;
      case 'CONDITIONAL':
        if (this.checkCondition(effect.condition, context.controllerIndex)) {
          (effect.then || []).forEach((next) => this.applyEffect(next, context));
        }
        break;
      default:
        break;
    }
  }

  playFromHand(playerIndex, handIndex) {
    const player = this.players[playerIndex];
    if (!player || playerIndex !== this.state.activePlayer) {
      this.log('Not your turn.');
      return this.snapshot();
    }
    if (this.state.phase !== 'Main') {
      this.log('You can only cast during your Main phase.');
      return this.snapshot();
    }
    const card = player.hand[handIndex];
    if (!card) return this.snapshot();

    let cost = card.cost?.soulfire ?? 0;
    if (player.channel > 0) {
      const reduction = Math.min(player.channel, cost - 1);
      cost = Math.max(1, cost - player.channel);
      this.log(`Channel reduces cost by ${reduction}.`);
      player.channel = 0;
    }
    if (player.currentSoulfire < cost) {
      this.log(`Not enough Soulfire to play ${card.name}.`);
      return this.snapshot();
    }

    player.currentSoulfire -= cost;
    player.hand.splice(handIndex, 1);
    player.spellsCastThisTurn += 1;

    const ritual = card.effects.find((effect) => effect.effectType === 'RITUAL_MODE');
    let effects = [...card.effects];
    if (ritual && this.canPayAdditionalCost(player, ritual.ritualCost)) {
      this.payAdditionalCost(player, ritual.ritualCost, card);
      effects = ritual.replaces;
      this.log(`${player.name} casts ${card.name} in Ritual mode.`);
    }

    const context = {
      controllerIndex: playerIndex,
      card,
      vitalityDamageDealt: 0,
      wardedSelfThisSpell: false,
      hexAttached: false,
    };

    effects.forEach((effect) => this.applyEffect(effect, context));

    if (card.cardType === 'Hex') {
      if (!context.hexAttached) {
        player.inPlay.push({ ...card, attachedTo: context.lastAttachedTarget ?? playerIndex });
      }
    } else {
      player.discard.push(card);
    }

    if (Array.isArray(card.effects) && card.effects.length) {
      this.log(`${player.name} plays ${card.name} (${card.cardType}) and resolves its effects.`);
    } else {
      this.log(`${player.name} plays ${card.name} (${card.cardType}).`);
    }

    return this.snapshot();
  }
}

function ensureDeckLabel() {
  const total = updateDeckCount();
  duelDeckLabel.textContent = total ? `${total}/20 cards ready` : 'No deck saved. Using demo list.';
}

function buildDeckForDuel() {
  const deck = [];
  deckState.forEach((entry) => {
    for (let i = 0; i < entry.quantity; i += 1) {
      deck.push({ ...entry.card });
    }
  });

  if (deck.length < MAX_DECK_SIZE) {
    const filler = cardPool.slice(0, MAX_DECK_SIZE - deck.length);
    deck.push(...filler.map((card) => ({ ...card })));
  }

  return deck.slice(0, MAX_DECK_SIZE);
}

function buildAIDeck() {
  const shuffled = [...cardPool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, MAX_DECK_SIZE).map((card) => ({ ...card }));
}

function renderStats(container, player, isActive) {
  if (!container || !player) return;
  container.innerHTML = '';
  const stats = [
    { label: 'Vitality', value: player.vitality },
    { label: 'Will', value: player.will },
    { label: 'Soulfire', value: `${player.currentSoulfire}/${player.maxSoulfire}` },
    { label: 'Deck', value: player.deck.length },
  ];
  stats.forEach((stat) => {
    const box = document.createElement('div');
    box.className = 'stat';
    const label = document.createElement('p');
    label.className = 'label';
    label.textContent = stat.label;
    const value = document.createElement('p');
    value.className = 'value';
    value.textContent = stat.value;
    box.append(label, value);
    if (isActive) {
      box.style.boxShadow = '0 0 0 1px #fff inset';
    }
    container.appendChild(box);
  });
}

function renderPileZone(container, labelText, cards, note) {
  if (!container) return;
  container.innerHTML = '';
  const label = document.createElement('p');
  label.className = 'label';
  label.textContent = labelText;
  const value = document.createElement('p');
  value.className = 'zone-value';
  value.textContent = cards.length;
  container.append(label, value);
  if (note) {
    const helper = document.createElement('p');
    helper.className = 'muted small';
    helper.textContent = note;
    container.appendChild(helper);
  }
  if (cards.length) {
    const preview = document.createElement('p');
    preview.className = 'muted small';
    preview.textContent = cards.map((c) => c.name).slice(0, 3).join(', ');
    container.appendChild(preview);
  }
}

function renderActiveZone(container, cards) {
  if (!container) return;
  container.innerHTML = '';
  const label = document.createElement('p');
  label.className = 'label';
  label.textContent = 'Active cards';
  container.appendChild(label);
  if (!cards.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'None in play';
    container.appendChild(empty);
    return;
  }

  const tags = document.createElement('div');
  tags.className = 'active-cards';
  cards.forEach((card) => {
    const chip = document.createElement('span');
    chip.className = 'active-tag';
    chip.textContent = card.name;
    tags.appendChild(chip);
  });
  container.appendChild(tags);
}

function renderOpponentHand(count) {
  if (!opponentHandBox || !opponentHandZone) return;
  opponentHandBox.innerHTML = '';
  const countText = document.createElement('p');
  countText.className = 'zone-value';
  countText.textContent = count;
  const note = document.createElement('p');
  note.className = 'muted small';
  note.textContent = 'Hidden from view';
  opponentHandBox.append(countText, note);
}

function renderPhaseTrack(activePhase) {
  if (!phaseTrack) return;
  phaseTrack.innerHTML = '';
  PHASES.forEach((phase) => {
    const chip = document.createElement('div');
    chip.className = `phase-chip ${phase === activePhase ? 'active' : ''}`;
    chip.textContent = phase;
    phaseTrack.appendChild(chip);
  });
}

function renderHand(hand) {
  if (!handGrid) return;
  handGrid.innerHTML = '';
  hand.forEach((card, index) => {
    const tile = document.createElement('div');
    tile.className = 'hand-card';
    const title = document.createElement('p');
    title.className = 'label';
    title.textContent = card.name;
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `${card.school} • ${card.cardType}`;
    const rules = document.createElement('p');
    rules.className = 'muted small';
    rules.textContent = card.rulesText;
    const cost = document.createElement('p');
    cost.className = 'muted small';
    cost.textContent = `Cost ${card.cost?.soulfire ?? 0} Soulfire`;
    tile.append(title, meta, rules, cost);
    tile.addEventListener('click', () => {
      duelEngine?.playFromHand(0, index);
      refreshDuelUI();
    });
    handGrid.appendChild(tile);
  });
}

function renderLog(logs) {
  if (!duelLogBox) return;
  duelLogBox.innerHTML = '';
  logs.forEach((entry) => {
    const line = document.createElement('p');
    line.textContent = entry.message;
    duelLogBox.appendChild(line);
  });
}

function refreshDuelUI() {
  if (!duelEngine) return;
  const snapshot = duelEngine.snapshot();
  const [you, foe] = snapshot.players;

  playerNameLabel.textContent = you.name;
  opponentNameLabel.textContent = foe.name;
  const playerActive = snapshot.activePlayer === 0;
  playerStatusText.textContent = playerActive ? 'Your turn' : 'Waiting';
  opponentStatusText.textContent = playerActive ? 'Waiting' : 'Their turn';

  renderStats(playerStats, you, playerActive);
  renderStats(opponentStats, foe, !playerActive);
  renderPileZone(opponentVoidZone, `${foe.name} Void`, foe.void);
  renderPileZone(opponentDiscardZone, `${foe.name} Discard`, foe.discard);
  renderActiveZone(opponentActiveZone, foe.inPlay);
  renderPileZone(playerVoidZone, `${you.name} Void`, you.void);
  renderPileZone(playerDiscardZone, `${you.name} Discard`, you.discard, 'Void & discard reshuffle if empty');
  renderActiveZone(playerActiveZone, you.inPlay);
  renderOpponentHand(foe.hand.length);
  renderPhaseTrack(snapshot.phase);
  renderHand(you.hand);
  renderLog(snapshot.logs);

  duelPhase.textContent = `${snapshot.phase} Phase`;
  const whoseTurn = snapshot.activePlayer === 0 ? 'Your turn' : "Opponent's turn";
  turnIndicator.textContent = `Turn ${snapshot.turn} — ${whoseTurn}`;
}

async function prepareDuelHub() {
  await loadCards();
  await loadDecks();
  ensureDeckLabel();
  setQueueMode(duelMode);
}

function startLocalDuel() {
  if (!cardPool.length) {
    showStatus('Cards not loaded yet.', 'error');
    return;
  }
  const playerDeck = buildDeckForDuel();
  const aiDeck = buildAIDeck();
  duelEngine = new DuelEngine(cardPool);
  duelEngine.start({
    players: [
      { name: activeUser || 'You', deck: playerDeck },
      { name: 'Rival Shade', deck: aiDeck },
    ],
  });
  showScreen('table');
  refreshDuelUI();
}

function exitDuel() {
  duelEngine = null;
  showScreen('menu');
}

function setQueueMode(mode) {
  duelMode = mode;
  queueTypeLocal.classList.toggle('active', mode === 'local');
  queueTypeMatch.classList.toggle('active', mode === 'match');
  duelStatusText.textContent = mode === 'local' ? 'Local test ready' : 'Queued (placeholder)';
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

duelNavButton.addEventListener('click', async () => {
  await prepareDuelHub();
  showScreen('duel');
});

duelToMenuButton.addEventListener('click', () => {
  showScreen('menu');
});

duelExitButton.addEventListener('click', exitDuel);
startLocalDuelButton.addEventListener('click', startLocalDuel);
queueTypeLocal.addEventListener('click', () => setQueueMode('local'));
queueTypeMatch.addEventListener('click', () => setQueueMode('match'));

endTurnButton.addEventListener('click', () => {
  if (!duelEngine) return;
  duelEngine.endTurn();
  refreshDuelUI();
});

clearDeckButton.addEventListener('click', resetDeck);
saveDeckButton.addEventListener('click', saveDeck);

cardSearch.addEventListener('input', applyFilters);

schoolChips.addEventListener('click', (event) => {
  const button = event.target.closest('.chip');
  if (!button) return;
  const school = button.dataset.school;
  activeSchool = school;
  schoolChips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('active', chip === button));
  applyFilters();
});

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
