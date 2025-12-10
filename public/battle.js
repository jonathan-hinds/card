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
const endTurnBtn = document.getElementById('end-turn');
const leaveMatchBtn = document.getElementById('leave-match');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');
const handEl = document.getElementById('hand');
const actionModal = document.getElementById('action-modal');
const overlay = document.getElementById('action-overlay');
const overlayName = document.getElementById('selected-name');
const overlayStats = document.getElementById('selected-stats');
const moveBtn = document.getElementById('overlay-move');
const overlayAbilities = document.getElementById('overlay-abilities');
const actionToolbar = document.getElementById('action-toolbar');
const actionContext = document.getElementById('action-context');
const cancelBtn = document.getElementById('cancel-action');
const closeActionModalBtn = document.getElementById('close-action-modal');
const sideSelector = document.getElementById('side-selector');
const staminaBanner = document.getElementById('stamina-banner');

let activeMatch = null;
let controllerName = '';
let currentSide = '';
let selectedHandSlug = '';
let selectedUnit = null;
let currentMode = null; // place | move | ability | null
let currentAbilitySlug = '';
let staminaBannerTimeout = null;
const highlights = { moves: new Set(), range: new Set(), targets: new Set() };

const coordKey = (row, col) => `${row},${col}`;

function perspective() {
  return activeMatch?.perspective || { flipped: false, homeRows: null };
}

function boardCoordsFromView(row, col) {
  const { rows, cols } = boardSize();
  if (!perspective().flipped) return { row, col };
  return { row: rows - 1 - row, col: cols - 1 - col };
}

function boardCoordsToView(row, col) {
  const { rows, cols } = boardSize();
  if (!perspective().flipped) return { row, col };
  return { row: rows - 1 - row, col: cols - 1 - col };
}

function homeTerritory() {
  if (!currentSide || !activeMatch?.territories) return null;
  return activeMatch.territories[currentSide] || null;
}

function isHomeRow(row) {
  const territory = homeTerritory();
  if (!territory?.rows) return false;
  return row >= territory.rows.start && row <= territory.rows.end;
}

function formattedCoords(position) {
  const coords = boardCoordsToView(position.row, position.col);
  return `(${coords.row},${coords.col})`;
}

function moveCost(piece) {
  return 1 + (piece?.enemyTerritory ? 1 : 0);
}

function abilityCost(piece, ability) {
  const base = Number.isFinite(ability?.staminaCost) ? ability.staminaCost : 1;
  return base + (piece?.enemyTerritory ? 1 : 0);
}

function cardHasStamina(piece) {
  return Number.isFinite(piece?.stamina) ? piece.stamina > 0 : false;
}

function getAbilityRangeValue(ability) {
  if (!ability) return null;
  if (Number.isFinite(ability.range)) return ability.range;
  if (Number.isFinite(ability.attackRange)) return ability.attackRange;
  return null;
}

function sideAwareHeaders(extra = {}) {
  const headers = { ...authHeaders(), ...extra };
  if (currentSide) headers['X-Player-Role'] = currentSide;
  return headers;
}

function getPrimaryAbility(piece) {
  if (piece?.abilityDetails?.length) {
    const ability = piece.abilityDetails[0];
    const attackRange = getAbilityRangeValue(ability) ?? 1;
    return {
      title: ability.name || ability.slug || 'Ability',
      cost: Number.isFinite(ability.staminaCost) ? `${ability.staminaCost} STA` : '',
      damage: ability.damage
        ? `${ability.damage.min}-${ability.damage.max}`
        : '',
      range: Number.isFinite(attackRange) ? `${attackRange}` : '',
      target: ability.targetType || 'enemy',
      description: ability.description || '—',
    };
  }
  const slug = Array.isArray(piece?.abilities) ? piece.abilities[0] : piece?.abilities;
  return { title: slug || 'Ability', cost: '', damage: '', range: '', description: '—' };
}

function resetHighlights() {
  highlights.moves.clear();
  highlights.range.clear();
  highlights.targets.clear();
}

function showActionModal() {
  if (actionModal) actionModal.classList.remove('hidden');
}

function hideActionModal() {
  if (actionModal) actionModal.classList.add('hidden');
}

function showStaminaBanner(message = 'Out of stamina.') {
  if (!staminaBanner) return;
  staminaBanner.textContent = message;
  staminaBanner.classList.add('visible');
  if (staminaBannerTimeout) clearTimeout(staminaBannerTimeout);
  staminaBannerTimeout = setTimeout(() => staminaBanner.classList.remove('visible'), 1800);
}

function updateActionToolbar(message = '') {
  const activeMode = currentMode === 'move' || currentMode === 'ability';
  if (!actionToolbar) return;
  if (message && actionContext) {
    actionContext.textContent = message;
  } else if (activeMode && actionContext && !actionContext.textContent) {
    actionContext.textContent = metaEl.textContent;
  }
  actionToolbar.classList.toggle('hidden', !activeMode);
}

function clearSelection(message = 'Action cancelled.') {
  selectedHandSlug = '';
  selectedUnit = null;
  currentMode = null;
  currentAbilitySlug = '';
  resetHighlights();
  hideActionModal();
  updateActionToolbar();
  if (activeMatch?.board) renderBoard(activeMatch.board);
  if (message) metaEl.textContent = message;
}

function renderBoard(board) {
  const { rows, cols } = boardSize();
  boardEl.classList.toggle('board--flipped', Boolean(perspective().flipped));
  boardEl.style.setProperty('--board-cols', cols || 1);
  boardEl.innerHTML = '';

  for (let viewRow = 0; viewRow < rows; viewRow += 1) {
    for (let viewCol = 0; viewCol < cols; viewCol += 1) {
      const { row, col } = boardCoordsFromView(viewRow, viewCol);
      const cell = board?.[row]?.[col];
      const cellEl = document.createElement('button');
      cellEl.type = 'button';
      cellEl.className = 'board-cell';
      cellEl.dataset.row = viewRow;
      cellEl.dataset.col = viewCol;

      const key = coordKey(row, col);
      if (highlights.moves.has(key)) cellEl.classList.add('highlight-move');
      if (highlights.range.has(key)) cellEl.classList.add('highlight-range');
      if (highlights.targets.has(key)) cellEl.classList.add('highlight-target');
      if (selectedUnit && selectedUnit.row === row && selectedUnit.col === col) {
        cellEl.classList.add('selected');
      }

      cellEl.classList.add(isHomeRow(row) ? 'home-territory' : 'enemy-territory');

      if (cell) {
        cellEl.classList.add(cell.owner === currentSide ? 'owned' : 'enemy');
        if (cell.enemyTerritory) cellEl.classList.add('crossing-debuff');
        const ability = getPrimaryAbility(cell);
        const cardEl = document.createElement('div');
        cardEl.className = 'unit-card';

        const headerEl = document.createElement('div');
        headerEl.className = 'unit-header';
        const nameEl = document.createElement('span');
        nameEl.className = 'unit-name';
        nameEl.textContent = cell.name;
        const ownerEl = document.createElement('span');
        ownerEl.className = 'unit-owner';
        ownerEl.textContent = cell.owner;
        headerEl.append(nameEl, ownerEl);

        const bodyEl = document.createElement('div');
        bodyEl.className = 'unit-body';
        const abilityName = document.createElement('p');
        abilityName.className = 'ability-name';
        abilityName.textContent = ability.title;

        const abilityMeta = document.createElement('div');
        abilityMeta.className = 'ability-meta';

        const metaItems = [];

        if (ability.damage) {
          const abilityDamage = document.createElement('span');
          abilityDamage.className = 'ability-pill ability-damage';
          abilityDamage.textContent = `DMG ${ability.damage}`;
          metaItems.push(abilityDamage);
        }

        if (ability.range) {
          const abilityRange = document.createElement('span');
          abilityRange.className = 'ability-pill ability-range';
          abilityRange.textContent = `RNG ${ability.range}`;
          metaItems.push(abilityRange);
        }

        if (ability.cost) {
          const abilityCost = document.createElement('span');
          abilityCost.className = 'ability-pill ability-cost';
          abilityCost.textContent = `COST ${ability.cost}`;
          metaItems.push(abilityCost);
        }

        if (ability.target) {
          const abilityTarget = document.createElement('span');
          abilityTarget.className = 'ability-pill ability-target';
          abilityTarget.textContent = `TARGET ${ability.target}`;
          metaItems.push(abilityTarget);
        }

        bodyEl.appendChild(abilityName);
        if (metaItems.length) {
          metaItems.forEach((el) => abilityMeta.appendChild(el));
          bodyEl.appendChild(abilityMeta);
        }

        const statsEl = document.createElement('div');
        statsEl.className = 'unit-stats';
        const hpEl = document.createElement('span');
        hpEl.textContent = `HP ${cell.health}`;
        const staminaEl = document.createElement('span');
        staminaEl.textContent = `STA ${cell.stamina}/${cell.staminaMax}`;
        statsEl.append(hpEl, staminaEl);

        cardEl.append(headerEl, bodyEl, statsEl);
        cellEl.append(cardEl);

        cellEl.title = `${cell.owner} · ${cell.name} (${cell.health} hp, ${cell.stamina}/${cell.staminaMax} sta)`;
      } else {
        cellEl.title = `${formattedCoords({ row, col })} empty`;
      }

      boardEl.appendChild(cellEl);
    }
  }
}

function renderHand(hand) {
  handEl.innerHTML = '';
  (hand || []).forEach((entry) => {
    const cardBtn = document.createElement('button');
    cardBtn.type = 'button';
    cardBtn.className = 'hand-card';
    cardBtn.dataset.slug = entry.slug;
    if (selectedHandSlug === entry.slug) cardBtn.classList.add('active');
    cardBtn.innerHTML = `<span class="label">${entry.slug}</span><span class="muted">${entry.count} remaining</span>`;
    cardBtn.addEventListener('click', () => {
      selectedHandSlug = entry.slug;
      selectedUnit = null;
      currentMode = 'place';
      resetHighlights();
      metaEl.textContent = `Selected ${entry.slug}. Click a tile on your side to deploy.`;
      hideActionModal();
      renderBoard(activeMatch.board);
      renderHand(hand);
    });
    handEl.appendChild(cardBtn);
  });
}

function parseLogLine(line) {
  if (typeof line !== 'string') return { type: 'info', title: 'Update', detail: String(line || '') };

  const attackMatch = line.match(
    /^(.+)'s (.+) used (.+?)(?: for (\d+) damage)?(?: and applied (.+))? on (.+)'s (.+)\.$/
  );
  if (attackMatch) {
    const [, actorPlayer, actorUnit, ability, damage, effects, targetPlayer, targetUnit] = attackMatch;
    const effectText = effects ? `Effects: ${effects}` : '';
    const damageText = damage ? `${damage} damage` : 'No damage';
    return {
      type: 'attack',
      title: 'Attack',
      action: ability,
      actor: { player: actorPlayer, unit: actorUnit },
      target: { player: targetPlayer, unit: targetUnit },
      detail: [damageText, effectText].filter(Boolean).join(' · '),
    };
  }

  const moveMatch = line.match(/^(.+) moved (.+) to \((\d+),(\d+)\)\.$/);
  if (moveMatch) {
    const [, actorPlayer, unit, row, col] = moveMatch;
    return {
      type: 'move',
      title: 'Movement',
      action: 'Advance',
      actor: { player: actorPlayer, unit },
      detail: `New position: (${row},${col})`,
    };
  }

  const deployMatch = line.match(/^(.+) deployed (.+) to \((\d+),(\d+)\)\.$/);
  if (deployMatch) {
    const [, actorPlayer, unit, row, col] = deployMatch;
    return {
      type: 'deploy',
      title: 'Deployment',
      action: 'Placed',
      actor: { player: actorPlayer, unit },
      detail: `Position: (${row},${col})`,
    };
  }

  const advanceMatch = line.match(/^(.+) advanced (.+) to \((\d+),(\d+)\)\.$/);
  if (advanceMatch) {
    const [, actorPlayer, unit, row, col] = advanceMatch;
    return {
      type: 'advance',
      title: 'Advance',
      action: 'NPC Movement',
      actor: { player: actorPlayer, unit },
      detail: `Position: (${row},${col})`,
    };
  }

  const defeatMatch = line.match(/^(.+)'s (.+) was defeated\.$/);
  if (defeatMatch) {
    const [, player, unit] = defeatMatch;
    return {
      type: 'defeat',
      title: 'Defeat',
      target: { player, unit },
      detail: `${unit} fell in battle`,
    };
  }

  const statusMatch = line.match(/^(.+) ended their turn\.$/);
  if (statusMatch) {
    const [, actorPlayer] = statusMatch;
    return {
      type: 'turn',
      title: 'Turn Ended',
      actor: { player: actorPlayer },
      detail: `${actorPlayer} passed control`,
    };
  }

  const effectMatch = line.match(/^(.+)'s (.+) is affected by (.+)\.$/);
  if (effectMatch) {
    const [, targetPlayer, unit, effect] = effectMatch;
    return {
      type: 'effect',
      title: 'Effect Applied',
      target: { player: targetPlayer, unit },
      detail: effect,
    };
  }

  return { type: 'info', title: 'Update', detail: line };
}

function buildParticipant(label, participant) {
  const wrapper = document.createElement('span');
  wrapper.className = 'event-chip';

  const tag = document.createElement('span');
  tag.className = 'event-chip__label';
  tag.textContent = label;

  const summary = document.createElement('strong');
  summary.textContent = participant.unit
    ? `${participant.player} · ${participant.unit}`
    : participant.player || '—';

  wrapper.append(tag, summary);
  return wrapper;
}

function getEventOwner(event, fallbackOwner) {
  if (event?.actor?.player) return event.actor.player;
  if (event?.target?.player) return event.target.player;
  return fallbackOwner || 'Unknown';
}

function groupEventsByTurn(events) {
  const groups = [];
  let currentOwner = null;
  let currentGroup = null;

  events.forEach((event) => {
    const owner = getEventOwner(event, currentOwner);
    const groupOwner = owner || 'Unknown';

    if (!currentGroup || groupOwner !== currentOwner) {
      currentGroup = { owner: groupOwner, events: [] };
      groups.push(currentGroup);
      currentOwner = groupOwner;
    }

    currentGroup.events.push(event);

    if (event.type === 'turn') {
      currentGroup = null;
      currentOwner = null;
    }
  });

  return groups;
}

function buildEventCard(event) {
  const card = document.createElement('article');
  card.className = `event-row event-${event.type}`;

  const header = document.createElement('div');
  header.className = 'event-row__header';
  const title = document.createElement('span');
  title.className = 'event-row__label';
  title.textContent = event.title;
  header.appendChild(title);
  if (event.action) {
    const action = document.createElement('span');
    action.className = 'event-row__action';
    action.textContent = event.action;
    header.appendChild(action);
  }
  card.appendChild(header);

  if (event.actor || event.target) {
    const participants = document.createElement('div');
    participants.className = 'event-row__participants';
    if (event.actor) participants.appendChild(buildParticipant('Actor', event.actor));
    if (event.target) participants.appendChild(buildParticipant('Target', event.target));
    card.appendChild(participants);
  }

  if (event.detail) {
    const detail = document.createElement('p');
    detail.className = 'event-row__detail';
    detail.textContent = event.detail;
    card.appendChild(detail);
  }

  return card;
}

function renderLog(lines) {
  logEl.innerHTML = '';
  const events = (lines || []).slice(-20).map((line) => parseLogLine(line));
  const groups = groupEventsByTurn(events);

  groups.forEach((group) => {
    const groupEl = document.createElement('section');
    const isSelf = group.owner === currentSide;
    groupEl.className = `log-group ${isSelf ? 'log-group--self' : 'log-group--opponent'}`;

    const header = document.createElement('div');
    header.className = 'log-group__header';
    header.textContent = isSelf ? 'Your turn' : `${group.owner}'s turn`;
    groupEl.appendChild(header);

    const eventsEl = document.createElement('div');
    eventsEl.className = 'log-group__events';
    group.events.forEach((event) => {
      eventsEl.appendChild(buildEventCard(event));
    });
    groupEl.appendChild(eventsEl);

    logEl.appendChild(groupEl);
  });
}

function describePiece(piece) {
  if (!piece) return '';
  const sickness = piece.summoningSickness ? ' · Summoning Sickness' : '';
  const territory = piece.enemyTerritory ? ' · Enemy Territory (+1 STA actions)' : '';
  const primary = getPrimaryAbility(piece);
  const rangeText = primary.range ? ` · RNG ${primary.range}` : '';
  return `HP ${piece.health} · STA ${piece.stamina}/${piece.staminaMax} · SPD ${piece.speed}${rangeText}${sickness}${territory}`;
}

function buildAbilityMeta(ability) {
  const parts = [];
  if (Number.isFinite(ability.staminaCost)) parts.push(`Cost ${ability.staminaCost} STA`);
  if (ability.damage) parts.push(`DMG ${ability.damage.min}-${ability.damage.max}`);
  const range = getAbilityRangeValue(ability);
  if (Number.isFinite(range)) parts.push(`RNG ${range}`);
  if (ability.targetType) parts.push(`Target ${ability.targetType}`);
  return parts.join(' · ');
}

function renderAbilityActions(piece) {
  if (!overlayAbilities) return;
  overlayAbilities.innerHTML = '';
  const abilities = piece?.abilityDetails || [];
  const notYourTurn = activeMatch?.turn !== currentSide;

  if (!abilities.length) {
    const empty = document.createElement('p');
    empty.className = 'muted small-text';
    empty.textContent = 'No abilities available';
    overlayAbilities.appendChild(empty);
    return;
  }

  abilities.forEach((ability) => {
    const adjustedCost = abilityCost(piece, ability);
    const abilityBtn = document.createElement('button');
    abilityBtn.type = 'button';
    abilityBtn.className = 'ability-action';
    abilityBtn.dataset.ability = ability.slug;
    abilityBtn.disabled = piece.summoningSickness || piece.stamina < adjustedCost || notYourTurn;
    abilityBtn.classList.toggle('active', currentAbilitySlug === ability.slug && currentMode === 'ability');

    const header = document.createElement('div');
    header.className = 'ability-action__header';
    const title = document.createElement('span');
    title.className = 'ability-action__name';
    title.textContent = ability.name || ability.slug || 'Ability';
    const cost = document.createElement('span');
    cost.className = 'ability-action__cost';
    cost.textContent = Number.isFinite(adjustedCost)
      ? `${adjustedCost} STA${piece.enemyTerritory ? ' (enemy side +1)' : ''}`
      : '—';
    header.append(title, cost);

    const meta = document.createElement('div');
    meta.className = 'ability-action__meta';
    meta.textContent = buildAbilityMeta(ability);

    const desc = document.createElement('p');
    desc.className = 'muted small-text ability-action__desc';
    desc.textContent = ability.description || '—';

    abilityBtn.append(header, meta, desc);
    abilityBtn.addEventListener('click', () => startAbilityTargeting(piece, ability));
    overlayAbilities.appendChild(abilityBtn);
  });
}

function startAbilityTargeting(piece, ability) {
  if (!piece || !ability) return;
  const { range, targets } = calculateTargets(piece, selectedUnit, ability);
  resetHighlights();
  range.forEach((space) => highlights.range.add(coordKey(space.row, space.col)));
  targets.forEach((space) => highlights.targets.add(coordKey(space.row, space.col)));
  currentMode = 'ability';
  currentAbilitySlug = ability.slug;
  renderBoard(activeMatch.board);
  renderAbilityActions(piece);
  const message = targets.length
    ? `Select a target for ${ability.name}.`
    : `No valid targets in range for ${ability.name}.`;
  metaEl.textContent = message;
  hideActionModal();
  updateActionToolbar(message);
}

function updateOverlay() {
  if (!selectedUnit || !activeMatch) {
    hideActionModal();
    updateActionToolbar();
    return;
  }
  const piece = activeMatch.board?.[selectedUnit.row]?.[selectedUnit.col];
  if (!piece || piece.owner !== currentSide) {
    hideActionModal();
    clearSelection('Selection cleared.');
    return;
  }
  const hasStamina = cardHasStamina(piece);
  overlayName.textContent = `${piece.name} ${formattedCoords(selectedUnit)}`;
  overlayStats.textContent = describePiece(piece);
  if (!hasStamina) {
    hideActionModal();
    updateActionToolbar();
    return;
  }
  if (currentMode === 'move' || currentMode === 'ability') {
    hideActionModal();
  } else {
    showActionModal();
  }
  updateActionToolbar();

  const notYourTurn = activeMatch.turn !== currentSide;
  moveBtn.disabled = piece.summoningSickness || piece.stamina < moveCost(piece) || notYourTurn;
  renderAbilityActions(piece);
}

function updateSideSelector(match) {
  const controllers = match.controllers || {};
  const options = match.players.filter((player) => (controllers[player] || player) === controllerName);
  sideSelector.innerHTML = '';
  options.forEach((player) => {
    const option = document.createElement('option');
    option.value = player;
    option.textContent = player;
    sideSelector.appendChild(option);
  });
  if (options.includes(match.turn) && controllers[match.turn] === controllerName) {
    currentSide = match.turn;
  }
  if (options.length && !options.includes(currentSide)) {
    currentSide = options[0];
  }
  sideSelector.value = currentSide || '';
}

function renderMatch(match) {
  activeMatch = match;
  updateSideSelector(match);
  renderBoard(match.board);
  renderLog(match.log);
  turnIndicator.textContent = match.turn;
  const isActive = match.status === 'active';
  boardEl.classList.toggle('board--inactive', !isActive);
  handEl.classList.toggle('hand-row--inactive', !isActive);
  endTurnBtn.disabled = !isActive;
  const hand = match.hands ? match.hands[currentSide] || [] : [];
  renderHand(hand);
  updateOverlay();
  if (!isActive) {
    setActiveMatch('');
    metaEl.textContent = match.defeated
      ? `${match.defeated} has been defeated. Match closed.`
      : 'Match finished.';
  }
}

async function syncMatch() {
  const matchId = getActiveMatch();
  if (!matchId) return;
  const res = await fetch(`/api/matches/${matchId}`, { headers: sideAwareHeaders() });
  const data = await res.json();
  if (res.ok && data.match) {
    renderMatch(data.match);
  } else if (res.status === 404) {
    setActiveMatch('');
    metaEl.textContent = 'Match no longer available.';
  }
}

function boardSize() {
  if (activeMatch?.boardSize) return activeMatch.boardSize;
  if (!activeMatch?.board) return { rows: 0, cols: 0 };
  return { rows: activeMatch.board.length, cols: activeMatch.board[0]?.length || 0 };
}

function calculateMoves(piece, position) {
  const { rows, cols } = boardSize();
  const spaces = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const rowDiff = Math.abs(position.row - r);
      const colDiff = Math.abs(position.col - c);
      const distance = Math.max(rowDiff, colDiff);
      if (distance === 0 || distance > piece.speed) continue;
      if (activeMatch.board[r][c]) continue;
      spaces.push({ row: r, col: c });
    }
  }
  return spaces;
}

function calculateTargets(piece, position, abilityOverride = null) {
  const { rows, cols } = boardSize();
  const range = [];
  const targets = [];
  const ability = abilityOverride || piece?.abilityDetails?.[0];
  const abilityRange = getAbilityRangeValue(ability) ?? 1;
  const targetType = ability?.targetType || 'enemy';

  if (!ability) return { range, targets };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const rowDiff = Math.abs(position.row - r);
      const colDiff = Math.abs(position.col - c);
      const distance = Math.max(rowDiff, colDiff);
      if (distance === 0 || distance > abilityRange) continue;
      range.push({ row: r, col: c });
      const occupant = activeMatch.board[r][c];
      if (!occupant) continue;
      if (targetType === 'enemy' && occupant.owner !== piece.owner) targets.push({ row: r, col: c });
      if (targetType === 'friendly' && occupant.owner === piece.owner) targets.push({ row: r, col: c });
      if (targetType === 'any') targets.push({ row: r, col: c });
    }
  }
  return { range, targets };
}

function selectUnit(row, col) {
  selectedUnit = { row, col };
  selectedHandSlug = '';
  currentMode = null;
  currentAbilitySlug = '';
  resetHighlights();
  const piece = activeMatch.board?.[row]?.[col];
  if (!piece) {
    updateOverlay();
    renderBoard(activeMatch.board);
    metaEl.textContent = 'Selection cleared.';
    return;
  }
  const hasStamina = cardHasStamina(piece);
  metaEl.textContent = hasStamina
    ? 'Choose Move or an ability to act with this unit.'
    : `${piece?.name || 'This unit'} is out of stamina.`;
  if (!hasStamina) showStaminaBanner(metaEl.textContent);
  updateOverlay();
  renderBoard(activeMatch.board);
}

async function placeCard(row, col) {
  if (!selectedHandSlug) return;
  const payload = { cardSlug: selectedHandSlug, row, col };
  const res = await fetch(`/api/matches/${activeMatch.id}/place`, {
    method: 'POST',
    headers: sideAwareHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok) {
    selectedHandSlug = '';
    currentMode = null;
    resetHighlights();
    renderMatch(data.match);
  }
  metaEl.textContent = data.message || (res.ok ? 'Deployed.' : 'Deploy failed.');
}

async function moveCard(toRow, toCol) {
  if (!selectedUnit) return;
  const payload = { fromRow: selectedUnit.row, fromCol: selectedUnit.col, toRow, toCol };
  const res = await fetch(`/api/matches/${activeMatch.id}/move`, {
    method: 'POST',
    headers: sideAwareHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok) {
    currentMode = null;
    resetHighlights();
    renderMatch(data.match);
    selectUnit(toRow, toCol);
  }
  metaEl.textContent = data.message || (res.ok ? 'Moved.' : 'Move failed.');
}

async function attackTarget(targetRow, targetCol, abilitySlug = '') {
  if (!selectedUnit) return;
  const origin = { ...selectedUnit };
  const payload = { fromRow: selectedUnit.row, fromCol: selectedUnit.col, targetRow, targetCol };
  if (abilitySlug) payload.abilitySlug = abilitySlug;
  const res = await fetch(`/api/matches/${activeMatch.id}/attack`, {
    method: 'POST',
    headers: sideAwareHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok) {
    currentMode = null;
    currentAbilitySlug = '';
    resetHighlights();
    renderMatch(data.match);
    selectUnit(origin.row, origin.col);
  }
  metaEl.textContent = data.message || (res.ok ? 'Attack resolved.' : 'Attack failed.');
}

boardEl.addEventListener('click', (event) => {
  const cellEl = event.target.closest('.board-cell');
  if (!cellEl || !activeMatch || activeMatch.status !== 'active') return;
  const viewRow = Number(cellEl.dataset.row);
  const viewCol = Number(cellEl.dataset.col);
  const { row, col } = boardCoordsFromView(viewRow, viewCol);
  const key = coordKey(row, col);
  const cell = activeMatch.board[row][col];

  if (currentMode === 'place' && selectedHandSlug) {
    if (!isHomeRow(row)) {
      metaEl.textContent = 'You can only deploy units on your side of the battlefield.';
    } else if (!cell) placeCard(row, col);
    else metaEl.textContent = 'Tile occupied. Choose another spot to deploy.';
    return;
  }

  if (currentMode === 'move' && highlights.moves.has(key)) {
    moveCard(row, col);
    return;
  }

  if (currentMode === 'ability' && highlights.targets.has(key)) {
    attackTarget(row, col, currentAbilitySlug);
    return;
  }

  if (cell && cell.owner === currentSide) {
    selectUnit(row, col);
  }
});

moveBtn.addEventListener('click', () => {
  if (!selectedUnit || activeMatch?.status !== 'active') return;
  const piece = activeMatch.board[selectedUnit.row][selectedUnit.col];
  const spaces = calculateMoves(piece, selectedUnit);
  resetHighlights();
  spaces.forEach((space) => highlights.moves.add(coordKey(space.row, space.col)));
  currentMode = 'move';
  currentAbilitySlug = '';
  renderBoard(activeMatch.board);
  const message = spaces.length ? 'Choose a highlighted tile to move.' : 'No reachable tiles.';
  metaEl.textContent = message;
  hideActionModal();
  updateActionToolbar(message);
});

cancelBtn.addEventListener('click', () => clearSelection());

if (closeActionModalBtn) {
  closeActionModalBtn.addEventListener('click', () => clearSelection('Selection closed.'));
}

if (actionModal) {
  actionModal.addEventListener('click', (event) => {
    if (event.target?.dataset?.dismissAction !== undefined) {
      clearSelection('Selection closed.');
    }
  });
}

sideSelector.addEventListener('change', () => {
  currentSide = sideSelector.value;
  selectedHandSlug = '';
  selectedUnit = null;
  currentMode = null;
  resetHighlights();
  metaEl.textContent = `Viewing as ${currentSide}.`;
  syncMatch();
});

endTurnBtn.addEventListener('click', async () => {
  if (!activeMatch || activeMatch.status !== 'active') return;
  const res = await fetch(`/api/matches/${activeMatch.id}/end-turn`, { method: 'POST', headers: sideAwareHeaders() });
  const data = await res.json();
  if (res.ok) renderMatch(data.match);
  metaEl.textContent = data.message || 'Turn ended';
});

leaveMatchBtn.addEventListener('click', async () => {
  if (!activeMatch) {
    setActiveMatch('');
    window.location.href = '/play.html';
    return;
  }

  const res = await fetch(`/api/matches/${activeMatch.id}/leave`, {
    method: 'POST',
    headers: sideAwareHeaders(),
  });
  const data = await res.json();
  if (res.ok) {
    setActiveMatch('');
    renderMatch(data.match || activeMatch);
    metaEl.textContent = data.message || 'Match closed.';
    setTimeout(() => {
      window.location.href = '/play.html';
    }, 500);
  } else {
    metaEl.textContent = data.message || 'Unable to leave match.';
  }
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  controllerName = profile.username;
  currentSide = profile.username;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Waiting for match data…';

  const res = await fetch('/api/matchmaking/status', { headers: { ...authHeaders() } });
  const data = await res.json();
  if (data.match) {
    setActiveMatch(data.match.id);
    renderMatch(data.match);
  } else {
    setActiveMatch('');
    metaEl.textContent = 'No active match. Return to matchmaking.';
  }

  setInterval(() => syncMatch(), 4000);
}

wireLogout(logoutBtn);
init();
