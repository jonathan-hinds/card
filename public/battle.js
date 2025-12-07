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
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');
const handEl = document.getElementById('hand');
const overlay = document.getElementById('action-overlay');
const overlayName = document.getElementById('selected-name');
const overlayStats = document.getElementById('selected-stats');
const moveBtn = document.getElementById('overlay-move');
const attackBtn = document.getElementById('overlay-attack');
const cancelBtn = document.getElementById('cancel-action');

let activeMatch = null;
let playerName = '';
let selectedHandSlug = '';
let selectedUnit = null;
let currentMode = null; // place | move | attack | null
const highlights = { moves: new Set(), range: new Set(), targets: new Set() };

const coordKey = (row, col) => `${row},${col}`;

function getPrimaryAbility(piece) {
  if (piece?.abilityDetails?.length) {
    const ability = piece.abilityDetails[0];
    return {
      title: ability.name || ability.slug || 'Ability',
      cost: Number.isFinite(ability.staminaCost) ? `${ability.staminaCost} STA` : '',
      damage: ability.damage
        ? `${ability.damage.min}-${ability.damage.max}`
        : '',
      description: ability.description || '—',
    };
  }
  const slug = Array.isArray(piece?.abilities) ? piece.abilities[0] : piece?.abilities;
  return { title: slug || 'Ability', cost: '', damage: '', description: '—' };
}

function resetHighlights() {
  highlights.moves.clear();
  highlights.range.clear();
  highlights.targets.clear();
}

function renderBoard(board) {
  const cols = board[0]?.length || 0;
  boardEl.style.setProperty('--board-cols', cols || 1);
  boardEl.innerHTML = '';
  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const cellEl = document.createElement('button');
      cellEl.type = 'button';
      cellEl.className = 'board-cell';
      cellEl.dataset.row = r;
      cellEl.dataset.col = c;

      const key = coordKey(r, c);
      if (highlights.moves.has(key)) cellEl.classList.add('highlight-move');
      if (highlights.range.has(key)) cellEl.classList.add('highlight-range');
      if (highlights.targets.has(key)) cellEl.classList.add('highlight-target');
      if (selectedUnit && selectedUnit.row === r && selectedUnit.col === c) {
        cellEl.classList.add('selected');
      }

      if (cell) {
        cellEl.classList.add(cell.owner === playerName ? 'owned' : 'enemy');
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

        const abilityDamage = document.createElement('p');
        abilityDamage.className = 'ability-damage';
        abilityDamage.textContent = ability.damage ? `DMG ${ability.damage}` : '';

        const abilityCost = document.createElement('p');
        abilityCost.className = 'ability-cost';
        abilityCost.textContent = ability.cost ? `Cost ${ability.cost}` : '';

        [abilityName, abilityDamage, abilityCost]
          .filter((el) => el.textContent)
          .forEach((el) => bodyEl.appendChild(el));

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
        cellEl.title = `(${r},${c}) empty`;
      }

    boardEl.appendChild(cellEl);
    });
  });
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
      metaEl.textContent = `Selected ${entry.slug}. Click a tile to deploy.`;
      overlay.classList.add('hidden');
      renderBoard(activeMatch.board);
      renderHand(hand);
    });
    handEl.appendChild(cardBtn);
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

function describePiece(piece) {
  if (!piece) return '';
  const sickness = piece.summoningSickness ? ' · Summoning Sickness' : '';
  return `HP ${piece.health} · STA ${piece.stamina}/${piece.staminaMax} · SPD ${piece.speed} · RNG ${piece.attackRange}${sickness}`;
}

function updateOverlay() {
  if (!selectedUnit || !activeMatch) {
    overlay.classList.add('hidden');
    return;
  }
  const piece = activeMatch.board?.[selectedUnit.row]?.[selectedUnit.col];
  if (!piece || piece.owner !== playerName) {
    overlay.classList.add('hidden');
    selectedUnit = null;
    currentMode = null;
    resetHighlights();
    return;
  }
  overlayName.textContent = `${piece.name} (${selectedUnit.row},${selectedUnit.col})`;
  overlayStats.textContent = describePiece(piece);
  overlay.classList.remove('hidden');

  const notYourTurn = activeMatch.turn !== playerName;
  moveBtn.disabled = piece.summoningSickness || piece.stamina <= 0 || notYourTurn;
  attackBtn.disabled = piece.summoningSickness || piece.stamina <= 0 || notYourTurn;
}

function renderMatch(match, username) {
  playerName = username;
  activeMatch = match;
  renderBoard(match.board);
  renderLog(match.log);
  turnIndicator.textContent = match.turn;
  const hand = match.hands ? match.hands[username] || [] : [];
  renderHand(hand);
  updateOverlay();
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

function calculateTargets(piece, position) {
  const { rows, cols } = boardSize();
  const range = [];
  const targets = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const rowDiff = Math.abs(position.row - r);
      const colDiff = Math.abs(position.col - c);
      const distance = Math.max(rowDiff, colDiff);
      if (distance === 0 || distance > piece.attackRange) continue;
      range.push({ row: r, col: c });
      const occupant = activeMatch.board[r][c];
      if (occupant && occupant.owner !== piece.owner) {
        targets.push({ row: r, col: c });
      }
    }
  }
  return { range, targets };
}

function selectUnit(row, col) {
  selectedUnit = { row, col };
  selectedHandSlug = '';
  currentMode = null;
  resetHighlights();
  updateOverlay();
  renderBoard(activeMatch.board);
  metaEl.textContent = 'Choose Move or Attack to act with this unit.';
}

async function placeCard(row, col) {
  if (!selectedHandSlug) return;
  const payload = { cardSlug: selectedHandSlug, row, col };
  const res = await fetch(`/api/matches/${activeMatch.id}/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok) {
    selectedHandSlug = '';
    currentMode = null;
    resetHighlights();
    renderMatch(data.match, playerName);
  }
  metaEl.textContent = data.message || (res.ok ? 'Deployed.' : 'Deploy failed.');
}

async function moveCard(toRow, toCol) {
  if (!selectedUnit) return;
  const payload = { fromRow: selectedUnit.row, fromCol: selectedUnit.col, toRow, toCol };
  const res = await fetch(`/api/matches/${activeMatch.id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok) {
    currentMode = null;
    resetHighlights();
    renderMatch(data.match, playerName);
    selectUnit(toRow, toCol);
  }
  metaEl.textContent = data.message || (res.ok ? 'Moved.' : 'Move failed.');
}

async function attackTarget(targetRow, targetCol) {
  if (!selectedUnit) return;
  const origin = { ...selectedUnit };
  const payload = { fromRow: selectedUnit.row, fromCol: selectedUnit.col, targetRow, targetCol };
  const res = await fetch(`/api/matches/${activeMatch.id}/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok) {
    currentMode = null;
    resetHighlights();
    renderMatch(data.match, playerName);
    selectUnit(origin.row, origin.col);
  }
  metaEl.textContent = data.message || (res.ok ? 'Attack resolved.' : 'Attack failed.');
}

boardEl.addEventListener('click', (event) => {
  const cellEl = event.target.closest('.board-cell');
  if (!cellEl || !activeMatch) return;
  const row = Number(cellEl.dataset.row);
  const col = Number(cellEl.dataset.col);
  const key = coordKey(row, col);
  const cell = activeMatch.board[row][col];

  if (currentMode === 'place' && selectedHandSlug) {
    if (!cell) placeCard(row, col);
    else metaEl.textContent = 'Tile occupied. Choose another spot to deploy.';
    return;
  }

  if (currentMode === 'move' && highlights.moves.has(key)) {
    moveCard(row, col);
    return;
  }

  if (currentMode === 'attack' && highlights.targets.has(key)) {
    attackTarget(row, col);
    return;
  }

  if (cell && cell.owner === playerName) {
    selectUnit(row, col);
  }
});

moveBtn.addEventListener('click', () => {
  if (!selectedUnit) return;
  const piece = activeMatch.board[selectedUnit.row][selectedUnit.col];
  const spaces = calculateMoves(piece, selectedUnit);
  resetHighlights();
  spaces.forEach((space) => highlights.moves.add(coordKey(space.row, space.col)));
  currentMode = 'move';
  renderBoard(activeMatch.board);
  metaEl.textContent = spaces.length ? 'Choose a highlighted tile to move.' : 'No reachable tiles.';
});

attackBtn.addEventListener('click', () => {
  if (!selectedUnit) return;
  const piece = activeMatch.board[selectedUnit.row][selectedUnit.col];
  const { range, targets } = calculateTargets(piece, selectedUnit);
  resetHighlights();
  range.forEach((space) => highlights.range.add(coordKey(space.row, space.col)));
  targets.forEach((space) => highlights.targets.add(coordKey(space.row, space.col)));
  currentMode = 'attack';
  renderBoard(activeMatch.board);
  metaEl.textContent = targets.length
    ? 'Select a striped tile to attack.'
    : 'No enemies in range.';
});

cancelBtn.addEventListener('click', () => {
  selectedHandSlug = '';
  selectedUnit = null;
  currentMode = null;
  resetHighlights();
  overlay.classList.add('hidden');
  renderBoard(activeMatch.board);
  metaEl.textContent = 'Action cancelled.';
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
  playerName = profile.username;
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
