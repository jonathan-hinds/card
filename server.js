const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { MongoClient } = require('mongodb');

const mongoConfig = require('./config/mongo-config');
const gameConfig = require('./config/game-config.json');
const effectCatalog = require('./config/effects-catalog');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || mongoConfig.mongoUri;
const DATABASE_NAME = process.env.MONGO_DB_NAME || 'card-battles';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-token';

const TARGET_TYPES = new Set(['enemy', 'friendly', 'any']);
const EFFECT_PRIORITY = new Map([
  ['damage-boost-turn', 3],
  ['stamina-sapped-turn', 2],
]);
let effectMap = new Map();

const STARTING_HAND_DRAW = 3;


let usersCollection;
let cardsCollection;
let abilitiesCollection;
let effectsCollection;
let npcMemoryCollection;

const matchmakingQueue = [];
const matches = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url');
  const received = Buffer.from(signature);
  const comparison = Buffer.from(expected);
  if (received.length !== comparison.length) return null;
  if (!crypto.timingSafeEqual(received, comparison)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

async function ensureDatabase() {
  if (
    usersCollection &&
    cardsCollection &&
    abilitiesCollection &&
    effectsCollection &&
    npcMemoryCollection
  ) {
    return { usersCollection, cardsCollection, abilitiesCollection, effectsCollection, npcMemoryCollection };
  }
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  usersCollection = db.collection('players');
  cardsCollection = db.collection('cards');
  abilitiesCollection = db.collection('abilities');
  effectsCollection = db.collection('effects');
  npcMemoryCollection = db.collection('npc-memory');
  await usersCollection.createIndex({ username: 1 }, { unique: true });
  await cardsCollection.createIndex({ slug: 1 }, { unique: true });
  await abilitiesCollection.createIndex({ slug: 1 }, { unique: true });
  await effectsCollection.createIndex({ slug: 1 }, { unique: true });
  await npcMemoryCollection.createIndex({ slug: 1 }, { unique: true });
  await seedEffects(effectsCollection);
  await refreshEffectCache();
  await seedAbilities(abilitiesCollection);
  await seedCards(cardsCollection);
  return { usersCollection, cardsCollection, abilitiesCollection, effectsCollection, npcMemoryCollection };
}

async function loadNpcMemory() {
  const { npcMemoryCollection: collection } = await ensureDatabase();
  const memory =
    (await collection.findOne({ slug: 'npc-brain' })) ||
    (await collection.findOne({ slug: 'npc-brain', legacy: true }));
  if (memory) return memory;

  const baseline = {
    slug: 'npc-brain',
    totalBattles: 0,
    wins: 0,
    losses: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    updatedAt: new Date(),
  };
  await collection.insertOne(baseline);
  return baseline;
}

async function recordNpcMemory(match) {
  if (match.mode !== 'npc' || !match.npc || match?.npcStats?.recorded || match.status !== 'complete') return;
  const npcName = match.npc.name;
  const { npcMemoryCollection: collection } = await ensureDatabase();
  const memory = await loadNpcMemory();

  const npcWon = match.defeated !== npcName;
  const totalBattles = (memory.totalBattles || 0) + 1;
  const wins = (memory.wins || 0) + (npcWon ? 1 : 0);
  const losses = (memory.losses || 0) + (npcWon ? 0 : 1);
  const totalDamageDealt = (memory.totalDamageDealt || 0) + (match.npcStats?.damageDealt || 0);
  const totalDamageTaken = (memory.totalDamageTaken || 0) + (match.npcStats?.damageTaken || 0);

  await collection.updateOne(
    { slug: 'npc-brain' },
    {
      $set: {
        slug: 'npc-brain',
        totalBattles,
        wins,
        losses,
        totalDamageDealt,
        totalDamageTaken,
        lastOpponent: match.players.find((p) => p !== npcName),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  match.npcStats = match.npcStats || {};
  match.npcStats.recorded = true;
}

async function refreshEffectCache() {
  const collection = effectsCollection || (await ensureDatabase()).effectsCollection;
  const effects = await collection.find({}).toArray();
  effectMap = new Map(effects.map((effect) => [effect.slug, effect]));
  return effectMap;
}

async function seedEffects(collection) {
  for (const effect of effectCatalog) {
    await collection.updateOne(
      { slug: effect.slug },
      { $set: { ...effect }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }
}

async function seedAbilities(collection) {
  const basicAttack = {
    slug: 'basic-attack',
    name: 'Basic Attack',
    staminaCost: 1,
    damage: { min: 1, max: 3 },
    range: 1,
    description: 'Strike a nearby foe using the unit\'s basic training.',
    targetType: 'enemy',
    effects: [],
  };

  const battleFocus = {
    slug: 'battle-focus',
    name: 'Battle Focus',
    staminaCost: 1,
    description: 'Bolster an ally for the current turn with extra damage.',
    range: 1,
    targetType: 'friendly',
    effects: ['damage-boost-turn'],
  };

  const fatigue = {
    slug: 'fatigue',
    name: 'Fatigue',
    staminaCost: 1,
    description: 'Sap an enemy\'s stamina for the rest of the turn.',
    range: 1,
    targetType: 'enemy',
    effects: ['stamina-sapped-turn'],
  };

  await collection.updateOne(
    { slug: basicAttack.slug },
    { $set: { ...basicAttack }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );

  await collection.updateOne(
    { slug: battleFocus.slug },
    { $set: { ...battleFocus }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );

  await collection.updateOne(
    { slug: fatigue.slug },
    { $set: { ...fatigue }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

async function seedCards(collection) {
  const grunt = {
    slug: 'grunt',
    name: 'Grunt',
    stats: {
      health: 10,
      stamina: 3,
      speed: 1,
    },
    abilities: ['basic-attack'],
  };
  await collection.updateOne(
    { slug: grunt.slug },
    { $set: { ...grunt }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: 'Invalid token.' });
  }
  req.player = payload.username;
  next();
}

function sanitizePlayer(playerDoc) {
  if (!playerDoc) return null;
  const { passwordHash, salt, ...safe } = playerDoc;
  return safe;
}

function parseDamage(damage) {
  if (!damage || (damage.min === undefined && damage.max === undefined)) return null;
  const min = Number(damage.min ?? 0);
  const max = Number(damage.max ?? min);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw Object.assign(new Error('Damage requires valid min and max values.'), { status: 400 });
  }
  return { min, max };
}

function validateTargetType(targetType) {
  const value = targetType || 'enemy';
  if (!TARGET_TYPES.has(value)) {
    throw Object.assign(new Error('Invalid target type.'), { status: 400 });
  }
  return value;
}

function parseRange(range) {
  const value = range === undefined || range === null || range === '' ? 1 : Number(range);
  if (!Number.isFinite(value) || value < 0) {
    throw Object.assign(new Error('Range must be zero or greater.'), { status: 400 });
  }
  return value;
}

function cleanCardStats(stats) {
  const { attackRange, ...rest } = stats || {};
  const toNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };
  return {
    health: toNumber(rest.health),
    stamina: toNumber(rest.stamina),
    speed: toNumber(rest.speed),
  };
}

function buildActiveEffect(effect, turnOwner) {
  return {
    slug: effect.slug,
    name: effect.name,
    expiresAfterTurn: turnOwner,
    modifiers: effect.modifiers || {},
  };
}

function territoryAssignments(match) {
  const totalRows = match.board?.length || gameConfig.board.rows;
  const half = Math.floor(totalRows / 2);
  const assignments = {};
  const [northPlayer, southPlayer] = match.players;

  if (northPlayer) {
    assignments[northPlayer] = { side: 'north', rows: { start: 0, end: Math.max(0, half - 1) } };
  }

  if (southPlayer) {
    assignments[southPlayer] = {
      side: 'south',
      rows: { start: Math.max(0, totalRows - half), end: Math.max(0, totalRows - 1) },
    };
  }

  return assignments;
}

function isHomeTerritory(match, player, position) {
  if (!match || !player || position?.row === undefined) return false;
  const assignments = territoryAssignments(match);
  const territory = assignments[player];
  if (!territory) return false;
  return position.row >= territory.rows.start && position.row <= territory.rows.end;
}

function homeTerritoryDepth(match, player, position) {
  const assignments = territoryAssignments(match);
  const territory = assignments[player];
  if (!territory) return 0;

  if (territory.side === 'north') {
    return Math.max(0, territory.rows.end - position.row);
  }

  if (territory.side === 'south') {
    return Math.max(0, position.row - territory.rows.start);
  }

  return 0;
}

function updatePieceTerritory(match, position, piece) {
  if (!piece) return;
  piece.enemyTerritory = !isHomeTerritory(match, piece.owner, position);
}

function refreshPieceTerritories(match) {
  if (!match?.board) return;
  match.board.forEach((row, r) => {
    row.forEach((cell) => updatePieceTerritory(match, { row: r }, cell));
  });
}

function effectiveActionCost(piece, baseCost = 1) {
  const surcharge = piece?.enemyTerritory ? 1 : 0;
  return Math.max(0, baseCost + surcharge);
}

function abilityStaminaCost(piece, ability) {
  const baseCost = ability?.staminaCost ?? 1;
  return effectiveActionCost(piece, baseCost);
}

function createEmptyBoard() {
  const { rows, cols } = gameConfig.board;
  const board = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      row.push(null);
    }
    board.push(row);
  }
  return board;
}

function createRandomHand(cards, limit) {
  const hand = [];
  if (!cards.length || limit <= 0) return hand;
  for (let i = 0; i < limit; i += 1) {
    const pick = cards[Math.floor(Math.random() * cards.length)];
    const existing = hand.find((entry) => entry.slug === pick.slug);
    if (existing) {
      existing.count += 1;
    } else {
      hand.push({ slug: pick.slug, count: 1 });
    }
  }
  return hand;
}

function cloneHand(hand = []) {
  return JSON.parse(JSON.stringify(hand));
}

function totalCardCount(entries = []) {
  return entries.reduce((sum, entry) => sum + (entry.count || 0), 0);
}

function removeEmptyEntries(collection = []) {
  for (let i = collection.length - 1; i >= 0; i -= 1) {
    if (!collection[i] || collection[i].count <= 0) collection.splice(i, 1);
  }
}

function drawCards(deck = [], count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i += 1) {
    const remaining = totalCardCount(deck);
    if (remaining <= 0) break;

    const roll = Math.floor(Math.random() * remaining);
    let cursor = 0;
    let choice = null;
    deck.forEach((entry) => {
      if (choice || !entry?.count) return;
      cursor += entry.count;
      if (roll < cursor) choice = entry;
    });

    if (choice) {
      choice.count -= 1;
      drawn.push(choice.slug);
    }
  }

  removeEmptyEntries(deck);
  return drawn;
}

function addDrawnCardsToHand(hand = [], drawn = []) {
  drawn.forEach((slug) => {
    const existing = hand.find((card) => card.slug === slug);
    if (existing) {
      existing.count += 1;
    } else {
      hand.push({ slug, count: 1 });
    }
  });
}

function canMovePiece(piece, from, to) {
  const rowDiff = Math.abs(from.row - to.row);
  const colDiff = Math.abs(from.col - to.col);
  const distance = Math.max(rowDiff, colDiff);
  return distance <= piece.speed;
}

async function loadPlayer(username) {
  const { usersCollection: collection } = await ensureDatabase();
  const player = await collection.findOne({ username });
  return player;
}

async function getCardBySlug(slug) {
  const { cardsCollection: collection } = await ensureDatabase();
  return collection.findOne({ slug });
}

async function getAbilityBySlug(slug) {
  const { abilitiesCollection: collection } = await ensureDatabase();
  return collection.findOne({ slug });
}

function drawCardFromHand(hand, slug) {
  const entry = hand.find((item) => item.slug === slug);
  if (!entry || entry.count <= 0) return false;
  entry.count -= 1;
  return true;
}

function remainingPieces(playerState) {
  const boardCount = playerState.boardPieces || 0;
  const handCount = totalCardCount(playerState.hand || []);
  const deckCount = totalCardCount(playerState.deck || []);
  return boardCount + handCount + deckCount;
}

function summarizeMatch(match, viewer) {
  const maskHand = (hand) => hand.map((card) => ({ slug: card.slug, count: card.count }));
  const maskDeck = (deck) => deck.map((card) => ({ slug: card.slug, count: card.count }));
  refreshPieceTerritories(match);
  const territories = territoryAssignments(match);
  const viewerTerritory = territories[viewer] || territories[match.players[0]] || null;
  const concealedBoard = match.board.map((row) =>
    row.map((cell) => {
      if (!cell) return null;
      const visible = match.phase !== 'deploy' || cell.owner === viewer;
      if (visible) return { ...cell };
      return { owner: cell.owner, hidden: true };
    })
  );

  const view = {
    id: match.id,
    players: match.players,
    controllers: defaultControllers(match),
    mode: match.mode || 'versus',
    turn: match.turn,
    board: concealedBoard,
    boardSize: gameConfig.board,
    status: match.status,
    phase: match.phase || 'deploy',
    ready: { ...(match.ready || {}) },
    deployments: { ...(match.deployments || {}) },
    startingGoals: { ...(match.startingGoals || {}) },
    log: match.log,
    defeated: match.defeated,
    territories,
    perspective: {
      homeSide: viewerTerritory?.side || 'south',
      flipped: viewerTerritory?.side === 'north',
      homeRows: viewerTerritory?.rows || null,
    },
  };
  if (viewer === match.players[0] || viewer === match.players[1]) {
    view.hands = {
      [match.players[0]]: maskHand(match.hands[match.players[0]]),
      [match.players[1]]: maskHand(match.hands[match.players[1]]),
    };
    view.decks = {
      [match.players[0]]: maskDeck(match.decks?.[match.players[0]] || []),
      [match.players[1]]: maskDeck(match.decks?.[match.players[1]] || []),
    };
  }
  return view;
}

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const { usersCollection: collection } = await ensureDatabase();
    const salt = crypto.randomBytes(16);
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const user = {
      username: username.toLowerCase(),
      salt: salt.toString('hex'),
      passwordHash,
      hand: [],
      createdAt: new Date(),
    };

    await collection.insertOne(user);
    const token = createToken({ username: user.username, createdAt: Date.now() });
    res.status(201).json({ message: 'Account created successfully.', token, username: user.username });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'That username is already taken.' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Failed to register player.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const { usersCollection: collection } = await ensureDatabase();
    const player = await collection.findOne({ username: username.toLowerCase() });
    if (!player) {
      return res.status(401).json({ message: 'Username not found.' });
    }

    const salt = Buffer.from(player.salt, 'hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(player.passwordHash, 'hex'))) {
      return res.status(401).json({ message: 'Incorrect password.' });
    }

    const token = createToken({ username: player.username, createdAt: Date.now() });
    res.json({ message: 'Logged in successfully.', token, username: player.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Failed to log in.' });
  }
});

app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const { usersCollection: collection } = await ensureDatabase();
    const player = await collection.findOne({ username: req.player }, { projection: { passwordHash: 0, salt: 0 } });
    if (!player) {
      return res.status(404).json({ message: 'Player not found.' });
    }
    res.json({ player: sanitizePlayer(player) });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Failed to load profile.' });
  }
});

app.get('/api/effects', async (_req, res) => {
  try {
    await ensureDatabase();
    await refreshEffectCache();
    res.json({ effects: Array.from(effectMap.values()) });
  } catch (error) {
    console.error('Effect catalog load error:', error);
    res.status(500).json({ message: 'Failed to load effects.' });
  }
});

app.post('/api/effects', async (req, res) => {
  const effect = req.body || {};
  if (!effect.slug || !effect.name) {
    return res.status(400).json({ message: 'Effect requires slug and name.' });
  }

  const modifiers = {};

  const staminaChange = req.body.staminaChange;
  if (staminaChange !== undefined && staminaChange !== '') {
    const parsed = Number(staminaChange);
    if (!Number.isFinite(parsed)) {
      return res.status(400).json({ message: 'Stamina change must be a number.' });
    }
    modifiers.staminaChange = parsed;
  }

  const damageMinRaw = req.body.damageBonusMin;
  const damageMaxRaw = req.body.damageBonusMax;
  const hasDamageBonus =
    (damageMinRaw !== undefined && damageMinRaw !== '') || (damageMaxRaw !== undefined && damageMaxRaw !== '');
  if (hasDamageBonus) {
    const min = Number(damageMinRaw || 0);
    const max = Number(damageMaxRaw || damageMinRaw || 0);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return res.status(400).json({ message: 'Damage bonus requires valid min and max.' });
    }
    modifiers.damageBonus = { min, max };
  }

  const targetHint = TARGET_TYPES.has(effect.targetHint) ? effect.targetHint : undefined;
  const payload = {
    slug: effect.slug,
    name: effect.name,
    type: effect.type || 'neutral',
    targetHint,
    description: effect.description,
    modifiers: Object.keys(modifiers).length ? modifiers : undefined,
    duration: effect.duration || 'turn',
    createdAt: new Date(),
  };

  try {
    const { effectsCollection: collection } = await ensureDatabase();
    await collection.insertOne(payload);
    await refreshEffectCache();
    res.status(201).json({ message: 'Effect added.' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Effect slug already exists.' });
    }
    console.error('Effect insert error:', error);
    res.status(500).json({ message: 'Failed to add effect.' });
  }
});

app.put('/api/effects/:slug', async (req, res) => {
  const { slug } = req.params;
  const effect = req.body || {};
  if (!effect.slug || !effect.name) {
    return res.status(400).json({ message: 'Effect requires slug and name.' });
  }

  const modifiers = {};

  const staminaChange = req.body.staminaChange;
  if (staminaChange !== undefined && staminaChange !== '') {
    const parsed = Number(staminaChange);
    if (!Number.isFinite(parsed)) {
      return res.status(400).json({ message: 'Stamina change must be a number.' });
    }
    modifiers.staminaChange = parsed;
  }

  const damageMinRaw = req.body.damageBonusMin;
  const damageMaxRaw = req.body.damageBonusMax;
  const hasDamageBonus =
    (damageMinRaw !== undefined && damageMinRaw !== '') || (damageMaxRaw !== undefined && damageMaxRaw !== '');
  if (hasDamageBonus) {
    const min = Number(damageMinRaw || 0);
    const max = Number(damageMaxRaw || damageMinRaw || 0);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return res.status(400).json({ message: 'Damage bonus requires valid min and max.' });
    }
    modifiers.damageBonus = { min, max };
  }

  const targetHint = TARGET_TYPES.has(effect.targetHint) ? effect.targetHint : undefined;
  const payload = {
    slug: effect.slug,
    name: effect.name,
    type: effect.type || 'neutral',
    targetHint,
    description: effect.description,
    modifiers: Object.keys(modifiers).length ? modifiers : undefined,
    duration: effect.duration || 'turn',
    updatedAt: new Date(),
  };

  try {
    const { effectsCollection: collection } = await ensureDatabase();
    const result = await collection.updateOne({ slug }, { $set: payload });
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Effect not found.' });
    }
    await refreshEffectCache();
    res.json({ message: 'Effect updated.' });
  } catch (error) {
    console.error('Effect update error:', error);
    res.status(500).json({ message: 'Failed to update effect.' });
  }
});

app.delete('/api/effects/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const { effectsCollection: collection } = await ensureDatabase();
    const result = await collection.deleteOne({ slug });
    if (!result.deletedCount) {
      return res.status(404).json({ message: 'Effect not found.' });
    }
    await refreshEffectCache();
    res.json({ message: 'Effect deleted.' });
  } catch (error) {
    console.error('Effect delete error:', error);
    res.status(500).json({ message: 'Failed to delete effect.' });
  }
});

app.get('/api/abilities', async (_req, res) => {
  try {
    const { abilitiesCollection: collection } = await ensureDatabase();
    const abilities = await collection.find({}).sort({ name: 1 }).toArray();
    res.json({ abilities });
  } catch (error) {
    console.error('Ability catalog load error:', error);
    res.status(500).json({ message: 'Failed to load abilities.' });
  }
});

app.post('/api/abilities', async (req, res) => {
  const ability = req.body || {};
  const { attackRange, ...abilityPayload } = ability;
  if (!ability.slug || !ability.name || typeof ability.staminaCost === 'undefined') {
    return res.status(400).json({ message: 'Ability requires slug, name, and stamina cost.' });
  }

  let parsedDamage = null;
  try {
    parsedDamage = parseDamage(ability.damage);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || 'Invalid damage values.' });
  }

  let targetType;
  try {
    targetType = validateTargetType(ability.targetType);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  let range;
  try {
    range = parseRange(ability.range ?? attackRange);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  if (!effectMap.size) {
    await refreshEffectCache();
  }

  const requestedEffects = Array.isArray(ability.effects)
    ? ability.effects
    : ability.effects
      ? [ability.effects]
      : [];

  const unknownEffects = requestedEffects.filter((slug) => !effectMap.has(slug));
  if (unknownEffects.length) {
    return res
      .status(400)
      .json({ message: `Unknown effects: ${unknownEffects.join(', ')}` });
  }

  try {
    const { abilitiesCollection: collection } = await ensureDatabase();
    await collection.insertOne({
      ...abilityPayload,
      damage: parsedDamage || undefined,
      effects: requestedEffects,
      targetType,
      range,
      staminaCost: Number(ability.staminaCost),
      createdAt: new Date(),
    });
    res.status(201).json({ message: 'Ability added.' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Ability slug already exists.' });
    }
    console.error('Ability insert error:', error);
    res.status(500).json({ message: 'Failed to add ability.' });
  }
});

app.put('/api/abilities/:slug', async (req, res) => {
  const { slug } = req.params;
  const ability = req.body || {};
  const { attackRange, ...abilityPayload } = ability;
  if (!ability.slug || !ability.name || typeof ability.staminaCost === 'undefined') {
    return res.status(400).json({ message: 'Ability requires slug, name, and stamina cost.' });
  }

  let parsedDamage = null;
  try {
    parsedDamage = parseDamage(ability.damage);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || 'Invalid damage values.' });
  }

  let targetType;
  try {
    targetType = validateTargetType(ability.targetType);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  let range;
  try {
    range = parseRange(ability.range ?? attackRange);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  if (!effectMap.size) {
    await refreshEffectCache();
  }

  const requestedEffects = Array.isArray(ability.effects)
    ? ability.effects
    : ability.effects
      ? [ability.effects]
      : [];

  const unknownEffects = requestedEffects.filter((effectSlug) => !effectMap.has(effectSlug));
  if (unknownEffects.length) {
    return res.status(400).json({ message: `Unknown effects: ${unknownEffects.join(', ')}` });
  }

  try {
    const { abilitiesCollection: collection } = await ensureDatabase();
    const result = await collection.updateOne(
      { slug },
      {
        $set: {
          ...abilityPayload,
          damage: parsedDamage || undefined,
          effects: requestedEffects,
          targetType,
          range,
          staminaCost: Number(ability.staminaCost),
          updatedAt: new Date(),
        },
        $unset: { attackRange: '' },
      }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Ability not found.' });
    }
    res.json({ message: 'Ability updated.' });
  } catch (error) {
    console.error('Ability update error:', error);
    res.status(500).json({ message: 'Failed to update ability.' });
  }
});

app.delete('/api/abilities/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const { abilitiesCollection: collection } = await ensureDatabase();
    const result = await collection.deleteOne({ slug });
    if (!result.deletedCount) {
      return res.status(404).json({ message: 'Ability not found.' });
    }
    res.json({ message: 'Ability deleted.' });
  } catch (error) {
    console.error('Ability delete error:', error);
    res.status(500).json({ message: 'Failed to delete ability.' });
  }
});

app.get('/api/cards', async (_req, res) => {
  try {
    const { cardsCollection, abilitiesCollection } = await ensureDatabase();
    const [cards, abilities] = await Promise.all([
      cardsCollection.find({}).sort({ name: 1 }).toArray(),
      abilitiesCollection.find({}).toArray(),
    ]);
    const abilityMap = new Map(abilities.map((ability) => [ability.slug, ability]));
    const enriched = cards.map((card) => ({
      ...card,
      stats: cleanCardStats(card.stats),
      abilityDetails: (card.abilities || [])
        .map((slug) => (typeof slug === 'string' ? abilityMap.get(slug) : slug))
        .filter(Boolean),
    }));
    res.json({ cards: enriched, abilities });
  } catch (error) {
    console.error('Card catalog load error:', error);
    res.status(500).json({ message: 'Failed to load card catalog.' });
  }
});

app.post('/api/cards', async (req, res) => {
  const card = req.body || {};
  if (!card.slug || !card.name || !card.stats) {
    return res.status(400).json({ message: 'Card requires slug, name, and stats.' });
  }

  try {
    const { cardsCollection: collection } = await ensureDatabase();
    const payload = { ...card, stats: cleanCardStats(card.stats), createdAt: new Date() };
    await collection.insertOne(payload);
    res.status(201).json({ message: 'Card added.' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Card slug already exists.' });
    }
    console.error('Card insert error:', error);
    res.status(500).json({ message: 'Failed to add card.' });
  }
});

app.put('/api/cards/:slug', async (req, res) => {
  const { slug } = req.params;
  const updates = req.body || {};

  try {
    const { cardsCollection: collection } = await ensureDatabase();
    const { stats, ...rest } = updates;
    const setOps = { ...rest };
    if (stats) {
      setOps.stats = cleanCardStats(stats);
    }

    const updateOps = {};
    if (Object.keys(setOps).length) {
      updateOps.$set = setOps;
    }

    if (!stats) {
      updateOps.$unset = { 'stats.attackRange': '' };
    }

    const result = await collection.updateOne({ slug }, updateOps);
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Card not found.' });
    }
    res.json({ message: 'Card updated.' });
  } catch (error) {
    console.error('Card update error:', error);
    res.status(500).json({ message: 'Failed to update card.' });
  }
});

app.delete('/api/cards/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const { cardsCollection: collection } = await ensureDatabase();
    const result = await collection.deleteOne({ slug });
    if (!result.deletedCount) {
      return res.status(404).json({ message: 'Card not found.' });
    }
    res.json({ message: 'Card deleted.' });
  } catch (error) {
    console.error('Card delete error:', error);
    res.status(500).json({ message: 'Failed to delete card.' });
  }
});

app.get('/api/hand', requireAuth, async (req, res) => {
  try {
    const player = await loadPlayer(req.player);
    if (!player) return res.status(404).json({ message: 'Player not found.' });
    res.json({ hand: player.hand || [], limit: gameConfig.handSize });
  } catch (error) {
    console.error('Hand load error:', error);
    res.status(500).json({ message: 'Failed to load hand.' });
  }
});

app.post('/api/hand', requireAuth, async (req, res) => {
  const { cardSlug, quantity = 1 } = req.body || {};
  if (!cardSlug) return res.status(400).json({ message: 'Card slug is required.' });
  if (quantity < 1) return res.status(400).json({ message: 'Quantity must be at least 1.' });

  try {
    const player = await loadPlayer(req.player);
    if (!player) return res.status(404).json({ message: 'Player not found.' });

    const card = await getCardBySlug(cardSlug);
    if (!card) return res.status(404).json({ message: 'Card not found.' });

    const hand = player.hand || [];
    const existing = hand.find((item) => item.slug === cardSlug);
    const currentTotal = hand.reduce((sum, entry) => sum + entry.count, 0);
    if (currentTotal + quantity > gameConfig.handSize) {
      return res.status(400).json({ message: `Hand limit is ${gameConfig.handSize} cards.` });
    }

    if (existing) {
      existing.count += quantity;
    } else {
      hand.push({ slug: cardSlug, count: quantity });
    }

    const { usersCollection: collection } = await ensureDatabase();
    await collection.updateOne({ username: req.player }, { $set: { hand } });
    res.status(201).json({ message: 'Card added to hand.', hand, limit: gameConfig.handSize });
  } catch (error) {
    console.error('Hand update error:', error);
    res.status(500).json({ message: 'Failed to update hand.' });
  }
});

app.put('/api/hand/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const { quantity } = req.body || {};

  if (quantity === undefined || quantity < 0) {
    return res.status(400).json({ message: 'Quantity must be zero or greater.' });
  }

  try {
    const player = await loadPlayer(req.player);
    if (!player) return res.status(404).json({ message: 'Player not found.' });

    const hand = player.hand || [];
    const existingIndex = hand.findIndex((item) => item.slug === slug);

    const totalWithoutCurrent = hand
      .filter((_, idx) => idx !== existingIndex)
      .reduce((sum, entry) => sum + entry.count, 0);

    if (quantity === 0) {
      if (existingIndex !== -1) hand.splice(existingIndex, 1);
    } else {
      const card = await getCardBySlug(slug);
      if (!card) return res.status(404).json({ message: 'Card not found.' });

      if (totalWithoutCurrent + quantity > gameConfig.handSize) {
        return res.status(400).json({ message: `Hand limit is ${gameConfig.handSize} cards.` });
      }

      if (existingIndex !== -1) {
        hand[existingIndex].count = quantity;
      } else {
        hand.push({ slug, count: quantity });
      }
    }

    const { usersCollection: collection } = await ensureDatabase();
    await collection.updateOne({ username: req.player }, { $set: { hand } });

    res.json({ message: 'Hand updated.', hand, limit: gameConfig.handSize });
  } catch (error) {
    console.error('Hand update error:', error);
    res.status(500).json({ message: 'Failed to update hand.' });
  }
});

app.post('/api/hand/clear', requireAuth, async (req, res) => {
  try {
    const { usersCollection: collection } = await ensureDatabase();
    await collection.updateOne({ username: req.player }, { $set: { hand: [] } });
    res.json({ message: 'Hand cleared.' });
  } catch (error) {
    console.error('Hand clear error:', error);
    res.status(500).json({ message: 'Failed to clear hand.' });
  }
});

app.post('/api/matchmaking/join', requireAuth, async (req, res) => {
  try {
    const existing = matchmakingQueue.find((entry) => entry === req.player);
    if (existing) return res.json({ message: 'Already in queue.' });

    const player = await loadPlayer(req.player);
    const totalCards = (player.hand || []).reduce((sum, entry) => sum + entry.count, 0);
    if (totalCards === 0) {
      return res.status(400).json({ message: 'Add cards to your hand before queuing.' });
    }

    matchmakingQueue.push(req.player);

    if (matchmakingQueue.length >= 2) {
      const p1 = matchmakingQueue.shift();
      const p2 = matchmakingQueue.shift();
      const matchId = crypto.randomUUID();
      const decks = {};
      const hands = {};
      const startingGoals = {};
      decks[p1] = cloneHand(player.hand);
      const otherPlayer = await loadPlayer(p2);
      decks[p2] = cloneHand(otherPlayer.hand);
      hands[p1] = [];
      hands[p2] = [];
      const p1Drawn = drawCards(decks[p1], STARTING_HAND_DRAW);
      const p2Drawn = drawCards(decks[p2], STARTING_HAND_DRAW);
      addDrawnCardsToHand(hands[p1], p1Drawn);
      addDrawnCardsToHand(hands[p2], p2Drawn);
      startingGoals[p1] = p1Drawn.length || STARTING_HAND_DRAW;
      startingGoals[p2] = p2Drawn.length || STARTING_HAND_DRAW;
      const match = {
        id: matchId,
        players: [p1, p2],
        controllers: { [p1]: p1, [p2]: p2 },
        decks,
        hands,
        startingGoals,
        board: createEmptyBoard(),
        turn: p1,
        turnPlays: 0,
        status: 'active',
        phase: 'deploy',
        ready: { [p1]: false, [p2]: false },
        deployments: { [p1]: 0, [p2]: 0 },
        log: [`Match ${matchId} created: ${p1} vs ${p2}`],
        defeated: null,
      };
      match.boardPieces = { [p1]: 0, [p2]: 0 };
      matches.set(matchId, match);
      return res.json({ message: 'Match found.', match: summarizeMatch(match, req.player) });
    }

    res.json({ message: 'Joined queue. Waiting for opponent...' });
  } catch (error) {
    console.error('Matchmaking join error:', error);
    res.status(500).json({ message: 'Failed to join queue.' });
  }
});

app.post('/api/matchmaking/leave', requireAuth, (req, res) => {
  const index = matchmakingQueue.findIndex((entry) => entry === req.player);
  if (index !== -1) matchmakingQueue.splice(index, 1);
  res.json({ message: 'Queue left.' });
});

app.post('/api/practice/start', requireAuth, async (req, res) => {
  try {
    const existing = findMatchForPlayer(req.player);
    if (existing && existing.mode === 'practice') {
      return res.json({ message: 'Practice match already active.', match: summarizeMatch(existing, req.player) });
    }
    if (existing && existing.mode !== 'practice') {
      return res.status(400).json({ message: 'Finish your current match before starting practice.' });
    }

    const queueIndex = matchmakingQueue.findIndex((entry) => entry === req.player);
    if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);

    const player = await loadPlayer(req.player);
    if (!player) return res.status(404).json({ message: 'Player not found.' });
    const totalCards = (player.hand || []).reduce((sum, entry) => sum + entry.count, 0);
    if (totalCards === 0) {
      return res.status(400).json({ message: 'Add cards to your hand before starting practice.' });
    }

    const matchId = crypto.randomUUID();
    const sparringPartner = `${req.player}-sparring`;
    const decks = {
      [req.player]: cloneHand(player.hand),
      [sparringPartner]: cloneHand(player.hand),
    };
    const hands = { [req.player]: [], [sparringPartner]: [] };
    const startingGoals = {};
    const playerDrawn = drawCards(decks[req.player], STARTING_HAND_DRAW);
    const partnerDrawn = drawCards(decks[sparringPartner], STARTING_HAND_DRAW);
    addDrawnCardsToHand(hands[req.player], playerDrawn);
    addDrawnCardsToHand(hands[sparringPartner], partnerDrawn);
    startingGoals[req.player] = playerDrawn.length || STARTING_HAND_DRAW;
    startingGoals[sparringPartner] = partnerDrawn.length || STARTING_HAND_DRAW;

    const match = {
      id: matchId,
      players: [req.player, sparringPartner],
      controllers: { [req.player]: req.player, [sparringPartner]: req.player },
      mode: 'practice',
      decks,
      hands,
      startingGoals,
      board: createEmptyBoard(),
      turn: req.player,
      turnPlays: 0,
      status: 'active',
      phase: 'deploy',
      ready: { [req.player]: false, [sparringPartner]: false },
      deployments: { [req.player]: 0, [sparringPartner]: 0 },
      log: [`Practice match ${matchId} created for ${req.player}.`],
      defeated: null,
    };
    match.boardPieces = { [req.player]: 0, [sparringPartner]: 0 };

    matches.set(matchId, match);
    res.status(201).json({ message: 'Practice match ready.', match: summarizeMatch(match, req.player) });
  } catch (error) {
    console.error('Practice start error:', error.message);
    res.status(500).json({ message: 'Failed to start practice match.' });
  }
});

app.post('/api/npc/start', requireAuth, async (req, res) => {
  try {
    const existing = findMatchForPlayer(req.player);
    if (existing && existing.mode === 'npc') {
      return res.json({ message: 'NPC battle already active.', match: summarizeMatch(existing, req.player) });
    }
    if (existing && existing.mode !== 'npc') {
      return res.status(400).json({ message: 'Finish your current match before starting an NPC battle.' });
    }

    const queueIndex = matchmakingQueue.findIndex((entry) => entry === req.player);
    if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);

    const player = await loadPlayer(req.player);
    if (!player) return res.status(404).json({ message: 'Player not found.' });
    const totalCards = (player.hand || []).reduce((sum, entry) => sum + entry.count, 0);
    if (totalCards === 0) {
      return res.status(400).json({ message: 'Add cards to your hand before starting an NPC battle.' });
    }

    const { cardsCollection } = await ensureDatabase();
    const availableCards = await cardsCollection.find({}).toArray();
    const npcHand = createRandomHand(availableCards, gameConfig.handSize);
    if (!npcHand.length) {
      return res.status(400).json({ message: 'No cards available to build an NPC deck.' });
    }

    const matchId = crypto.randomUUID();
    const npcName = 'warden-npc';
    const decks = { [req.player]: cloneHand(player.hand), [npcName]: npcHand };
    const hands = { [req.player]: [], [npcName]: [] };
    const startingGoals = {};
    const playerDrawn = drawCards(decks[req.player], STARTING_HAND_DRAW);
    const npcDrawn = drawCards(decks[npcName], STARTING_HAND_DRAW);
    addDrawnCardsToHand(hands[req.player], playerDrawn);
    addDrawnCardsToHand(hands[npcName], npcDrawn);
    startingGoals[req.player] = playerDrawn.length || STARTING_HAND_DRAW;
    startingGoals[npcName] = npcDrawn.length || STARTING_HAND_DRAW;

    const match = {
      id: matchId,
      players: [req.player, npcName],
      controllers: { [req.player]: req.player, [npcName]: npcName },
      mode: 'npc',
      npc: { name: npcName },
      decks,
      hands,
      startingGoals,
      board: createEmptyBoard(),
      turn: req.player,
      turnPlays: 0,
      status: 'active',
      phase: 'deploy',
      ready: { [req.player]: false, [npcName]: false },
      deployments: { [req.player]: 0, [npcName]: 0 },
      log: [`NPC battle ${matchId} created for ${req.player}.`],
      defeated: null,
      npcStats: { damageDealt: 0, damageTaken: 0, recorded: false },
    };
    match.boardPieces = { [req.player]: 0, [npcName]: 0 };
    await placeStartingUnitsFor(match, npcName, match.startingGoals?.[npcName] || STARTING_HAND_DRAW, 1);
    match.ready[npcName] = true;
    match.log.push('The Warden has readied their forces.');
    matches.set(matchId, match);
    res.status(201).json({ message: 'NPC battle ready. Open the battlefield to face the Warden.', match: summarizeMatch(match, req.player) });
  } catch (error) {
    console.error('NPC start error:', error.message);
    res.status(500).json({ message: 'Failed to start NPC battle.' });
  }
});

function findMatchForPlayer(player) {
  for (const match of matches.values()) {
    if (match.players.includes(player) && match.status === 'active') return match;
  }
  return null;
}

function defaultControllers(match) {
  if (match.controllers) return match.controllers;
  const controllers = {};
  match.players.forEach((player) => {
    controllers[player] = player;
  });
  match.controllers = controllers;
  return controllers;
}

function resolveActingPlayer(match, controller, requested) {
  const controllers = defaultControllers(match);
  const desired = requested || controller;
  if (!match.players.includes(desired)) return null;
  if (controllers[desired] !== controller) return null;
  return desired;
}

app.get('/api/matchmaking/status', requireAuth, (req, res) => {
  const inQueue = matchmakingQueue.includes(req.player);
  const match = findMatchForPlayer(req.player);
  res.json({ inQueue, match: match ? summarizeMatch(match, req.player) : null });
});

app.post('/api/matches/:id/leave', requireAuth, async (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
    if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });

    const opponent = opponentOf(match, actingPlayer);
    completeMatch(match, actingPlayer, `${actingPlayer} forfeited. ${opponent} wins by default.`);

    if (match.mode === 'npc' && match.status === 'complete') {
      await recordNpcMemory(match);
    }

    res.json({ message: 'Match closed.', match: summarizeMatch(match, actingPlayer) });
  } catch (error) {
    console.error('Leave match error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to leave match.' });
  }
});

function ensureTurn(match, player) {
  if (match.turn !== player) {
    const err = new Error('Not your turn.');
    err.status = 400;
    throw err;
  }
}

function ensureActive(match) {
  if (match.status !== 'active') {
    const err = new Error('Match is finished.');
    err.status = 400;
    throw err;
  }
}

function completeMatch(match, defeated, reason) {
  if (match.status === 'complete') return;
  match.status = 'complete';
  match.defeated = defeated ?? match.defeated ?? null;
  if (reason) match.log.push(reason);
}

function opponentOf(match, player) {
  return match.players.find((p) => p !== player) || player;
}

function awakenDeployedUnits(match) {
  match.board.forEach((row) => {
    row.forEach((cell) => {
      if (cell) cell.summoningSickness = false;
    });
  });
}

function startTurn(match, player, { initial = false } = {}) {
  match.turn = player;
  match.turnPlays = 0;
  match.hands[player] = match.hands[player] || [];
  const drawn = drawCards(match.decks?.[player] || [], 1);
  if (drawn.length) {
    addDrawnCardsToHand(match.hands[player], drawn);
    match.log.push(`${player} drew a card${initial ? ' to start the battle' : ''}.`);
  } else {
    match.log.push(`${player} has no more cards to draw.`);
  }
}

function endTurn(match, actingPlayer) {
  match.board.forEach((row) => {
    row.forEach((cell) => {
      if (cell && cell.owner === actingPlayer) {
        cell.stamina = cell.staminaMax;
        cell.summoningSickness = false;
      }
    });
  });

  clearExpiredEffects(match, actingPlayer);

  startTurn(match, opponentOf(match, actingPlayer));
  match.log.push(`${actingPlayer} ended their turn.`);
}

function listPieces(match, owner) {
  const pieces = [];
  match.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell?.owner === owner) {
        pieces.push({ row: r, col: c, unit: cell });
      }
    });
  });
  return pieces;
}

function manhattanDistance(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function findNearestEnemy(match, owner, from) {
  const opponents = listPieces(match, opponentOf(match, owner));
  let best = null;
  opponents.forEach((pos) => {
    const distance = manhattanDistance(from, pos);
    if (!best || distance < best.distance) {
      best = { ...pos, distance };
    }
  });
  return best;
}

function findEmptyCells(match, owner = null) {
  const cells = [];
  match.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell) return;
      if (owner && !isHomeTerritory(match, owner, { row: r, col: c })) return;
      cells.push({ row: r, col: c });
    });
  });
  return cells;
}

function choosePlacementCell(match, target, aggression = 1, owner = null) {
  const empties = findEmptyCells(match, owner);
  if (!empties.length) return null;
  if (!target) return empties[Math.floor(Math.random() * empties.length)];

  const sorted = empties
    .map((cell) => ({ ...cell, distance: manhattanDistance(cell, target) }))
    .sort((a, b) => a.distance - b.distance);

  const bucket = Math.max(1, Math.round(sorted.length * Math.min(aggression, 1)));
  return sorted[Math.floor(Math.random() * bucket)] || sorted[0];
}

function homeAnchor(match, player) {
  const assignments = territoryAssignments(match);
  const territory = assignments[player];
  if (!territory) return null;

  const col = Math.floor((gameConfig.board.cols - 1) / 2);
  const row = territory.side === 'north' ? territory.rows.end : territory.rows.start;
  return { row, col };
}

function shouldPlayDefensively(match, owner, targetEnemy, enemyPieces) {
  const opponent = opponentOf(match, owner);
  const ownCount = match.boardPieces?.[owner] ?? listPieces(match, owner).length;
  const opponentCount = match.boardPieces?.[opponent] ?? listPieces(match, opponent).length;
  const outnumbered = opponentCount > ownCount;

  const anchor = homeAnchor(match, owner);
  const closestToAnchor = anchor
    ? enemyPieces.reduce((min, pos) => Math.min(min, manhattanDistance(anchor, pos)), Infinity)
    : Infinity;

  const threatenedAnchor = closestToAnchor <= 2;
  const enemyTooClose = targetEnemy?.distance !== undefined ? targetEnemy.distance <= 2 : false;

  return outnumbered || threatenedAnchor || enemyTooClose;
}

function chooseNpcPlacementCell(match, owner, aggression = 1, targetEnemy = null) {
  const empties = findEmptyCells(match, owner);
  if (!empties.length) return null;

  const opponent = opponentOf(match, owner);
  const enemyPieces = listPieces(match, opponent);
  const defensive = shouldPlayDefensively(match, owner, targetEnemy, enemyPieces);

  const scored = empties
    .map((cell) => {
      const distanceToTarget = targetEnemy ? manhattanDistance(cell, targetEnemy) : 0;
      const distanceToNearestEnemy = enemyPieces.length
        ? enemyPieces.reduce((min, pos) => Math.min(min, manhattanDistance(cell, pos)), Infinity)
        : gameConfig.board.rows + gameConfig.board.cols;
      const depth = homeTerritoryDepth(match, owner, cell);

      const safetyWeight = defensive ? 2 : 1;
      const safetyScore = distanceToNearestEnemy * safetyWeight + depth;
      const offensePenalty = distanceToTarget * Math.max(1, aggression);

      return {
        cell,
        total: safetyScore - offensePenalty,
        safetyScore,
        offensePenalty,
      };
    })
    .sort((a, b) => b.total - a.total);

  if (!scored.length) return null;

  const bucketSize = Math.max(1, Math.floor(scored.length * (defensive ? 0.25 : 0.15)));
  return scored[Math.floor(Math.random() * bucketSize)]?.cell || scored[0].cell;
}

async function placeStartingUnitsFor(match, player, goal = STARTING_HAND_DRAW, aggressionOverride = null) {
  const hand = match.hands[player] || [];
  const deployments = match.deployments || {};
  const targetEnemy = findNearestEnemy(match, player, { row: 0, col: 0 });
  const memory = aggressionOverride == null ? await loadNpcMemory() : null;
  const aggression = aggressionOverride ?? computeAggression(memory || {});

  while ((deployments[player] || 0) < goal) {
    const available = hand.find((entry) => entry.count > 0);
    if (!available) break;
    const card = await getCardBySlug(available.slug);
    const cell = choosePlacementCell(match, targetEnemy, aggression, player) || findEmptyCells(match, player)?.[0];
    if (!card || !cell) break;

    const unit = await buildUnit(card, player);
    drawCardFromHand(hand, available.slug);
    match.board[cell.row][cell.col] = unit;
    updatePieceTerritory(match, cell, unit);
    deployments[player] = (deployments[player] || 0) + 1;
    match.boardPieces[player] += 1;
    match.log.push(`${player} placed a starting unit.`);
  }
}

async function npcPlaceCard(match, aggressionOverride = null) {
  const npcName = match.npc?.name;
  if (!npcName || match.turnPlays >= 1) return false;
  const hand = match.hands[npcName] || [];
  const available = hand.find((entry) => entry.count > 0);
  if (!available) return false;

  const card = await getCardBySlug(available.slug);
  if (!card) return false;

  const targetEnemy = findNearestEnemy(match, npcName, { row: 0, col: 0 });
  const memory = aggressionOverride == null ? await loadNpcMemory() : null;
  const aggression = aggressionOverride ?? computeAggression(memory);
  const cell = chooseNpcPlacementCell(match, npcName, aggression, targetEnemy);
  if (!cell) return false;

  const unit = await buildUnit(card, npcName);
  drawCardFromHand(hand, available.slug);
  match.board[cell.row][cell.col] = unit;
  updatePieceTerritory(match, cell, unit);
  match.turnPlays += 1;
  match.boardPieces[npcName] += 1;
  match.log.push(`${npcName} deployed ${card.name} to (${cell.row},${cell.col}).`);
  return true;
}

function computeAggression(memory = {}) {
  const dealt = memory.totalDamageDealt || 0;
  const taken = memory.totalDamageTaken || 0;
  const battles = memory.totalBattles || 1;
  return 1 + (dealt - taken) / Math.max(1, battles);
}

function npcMoveToward(match, npcName, position) {
  const { row, col, unit } = position;
  if (unit.summoningSickness || unit.stamina <= 0 || unit.speed <= 0) return false;

  const target = findNearestEnemy(match, npcName, position);
  if (!target) return false;

  const bestOffense = selectBestOffensiveAbility(unit);
  const preferredRange = bestOffense?.range ?? 1;
  const distanceToTarget = chebyshevDistance(target, position);
  if (distanceToTarget <= preferredRange) return false;

  const rowStep = Math.sign(target.row - row);
  const colStep = Math.sign(target.col - col);
  const maxStep = Math.min(unit.speed, distanceToTarget - preferredRange);
  const nextRow = row + Math.max(-unit.speed, Math.min(unit.speed, rowStep * maxStep));
  const nextCol = col + Math.max(-unit.speed, Math.min(unit.speed, colStep * maxStep));

  if (nextRow === row && nextCol === col) return false;
  if (nextRow < 0 || nextRow >= match.board.length) return false;
  if (nextCol < 0 || nextCol >= match.board[0].length) return false;
  if (match.board[nextRow][nextCol]) return false;

  const moveCost = effectiveActionCost(unit, 1);
  if (unit.stamina < moveCost) return false;

  match.board[nextRow][nextCol] = unit;
  match.board[row][col] = null;
  unit.stamina -= moveCost;
  updatePieceTerritory(match, { row: nextRow, col: nextCol }, unit);
  match.log.push(`${npcName} advanced ${unit.name} to (${nextRow},${nextCol}).`);
  return { row: nextRow, col: nextCol, unit };
}

function npcAbilityTargets(match, npcName, position, ability) {
  const range = ability.range ?? ability.attackRange ?? 1;
  const targetType = TARGET_TYPES.has(ability.targetType) ? ability.targetType : 'enemy';
  const enemies = listPieces(match, opponentOf(match, npcName));
  const allies = listPieces(match, npcName);
  const candidates = [];

  const withinRange = (piece) => {
    const rowDiff = Math.abs(piece.row - position.row);
    const colDiff = Math.abs(piece.col - position.col);
    return Math.max(rowDiff, colDiff) <= range;
  };

  if (targetType === 'enemy' || targetType === 'any') {
    candidates.push(...enemies.filter(withinRange));
  }

  if (targetType === 'friendly' || targetType === 'any') {
    candidates.push(...allies.filter(withinRange));
  }

  return candidates;
}

function expectedDamageOutput(ability, attacker) {
  if (!ability?.damage) return 0;
  const damageMin = ability.damage?.min ?? 0;
  const damageMax = ability.damage?.max ?? damageMin;
  let expected = (damageMin + damageMax) / 2;

  const bonuses = (attacker.activeEffects || [])
    .map((effect) => effect.modifiers?.damageBonus)
    .filter(Boolean);

  bonuses.forEach((bonus) => {
    const min = bonus.min ?? 0;
    const max = bonus.max ?? min;
    expected += (min + max) / 2;
  });

  return Math.max(0, expected);
}

function selectBestOffensiveAbility(attacker) {
  const abilities = attacker.abilityDetails || [];
  let best = null;

  for (const ability of abilities) {
    if (!(ability.targetType === 'enemy' || ability.targetType === 'any')) continue;
    const potential = expectedDamageOutput(ability, attacker);
    if (potential <= 0) continue;

    if (!best || potential > best.potential) {
      best = { ability, potential, range: ability.range ?? ability.attackRange ?? 1 };
    }
  }

  return best;
}

function allyCanFollowUp(match, allyPosition) {
  if (!match?.board) return false;
  const ally = allyPosition?.unit;
  if (!ally || ally.summoningSickness || ally.stamina <= 0) return false;

  const enemies = listPieces(match, opponentOf(match, ally.owner));
  return (ally.abilityDetails || []).some((ability) => {
    if (!(ability.targetType === 'enemy' || ability.targetType === 'any')) return false;
    const abilityCost = abilityStaminaCost(ally, ability);
    if (ally.stamina < abilityCost) return false;

    return enemies.some((enemy) => chebyshevDistance(enemy, allyPosition) <= (ability.range ?? 1));
  });
}

function scoreAbilityChoice(ability, attacker, targetPosition, aggression, match) {
  const staminaCost = abilityStaminaCost(attacker, ability);
  const target = targetPosition?.unit;
  if (!target) return -Infinity;

  const damagePotential = expectedDamageOutput(ability, attacker);
  const isEnemyTarget = target.owner !== attacker.owner;
  let score = 0;

  if (isEnemyTarget) {
    score += damagePotential * Math.max(1, aggression);
    if (damagePotential >= target.health) {
      score += target.health + 3; // prioritize finishing blows
    }
  }

  if (!isEnemyTarget) {
    const effectValue = (ability.effects || []).reduce(
      (total, slug) => total + (EFFECT_PRIORITY.get(slug) || 1),
      0
    );
    score += effectValue * 2;
    if (target.health < target.maxHealth) score += 1; // prefer supporting damaged allies

    const followUpPotential = allyCanFollowUp(match, targetPosition);
    if (followUpPotential) score += 3; // prefer buffs that enable immediate strikes
    if (target === attacker) score += 1; // self-buffs are efficient when possible
  }

  if (ability.effects?.length) {
    score += ability.effects.length; // small nudge to use utility effects
  }

  score -= staminaCost * 0.5; // prefer efficient abilities

  return score;
}

function selectNpcAbility(match, npcName, position, aggression) {
  const attacker = position.unit;
  const abilities = attacker.abilityDetails || [];
  let bestChoice = null;
  let bestScore = -Infinity;

  for (const ability of abilities) {
    const staminaCost = abilityStaminaCost(attacker, ability);
    if (attacker.stamina < staminaCost) continue;

    const targets = npcAbilityTargets(match, npcName, position, ability);
    for (const target of targets) {
      const score = scoreAbilityChoice(ability, attacker, target, aggression, match);
      if (score > bestScore) {
        bestScore = score;
        bestChoice = { ability, target };
      }
    }
  }

  return bestChoice;
}

async function npcAttack(match, npcName, position, aggression) {
  const attacker = position.unit;
  if (attacker.summoningSickness) return false;

  const choice = selectNpcAbility(match, npcName, position, aggression ?? 1);
  if (!choice) return false;

  const { ability, target } = choice;
  const staminaCost = abilityStaminaCost(attacker, ability);

  const damage = calculateDamageRoll(ability, attacker);
  if (damage > 0) {
    target.unit.health -= damage;
    if (match.mode === 'npc') match.npcStats.damageDealt += damage;
  }
  attacker.stamina -= staminaCost;
  applyAbilityEffects(ability, target.unit, match, match.log, attacker);

  const effectSummary = (ability.effects || [])
    .map((slug) => effectMap.get(slug)?.name)
    .filter(Boolean)
    .join(', ');

  const damageFragment = damage > 0 ? ` for ${damage} damage` : '';
  const effectFragment = effectSummary ? ` and applied ${effectSummary}` : '';
  match.log.push(
    `${npcName}'s ${attacker.name} used ${ability.name}${damageFragment}${effectFragment} on ${target.unit.owner}'s ${target.unit.name}.`
  );

  if (target.unit.health <= 0) {
    match.board[target.row][target.col] = null;
    match.boardPieces[target.unit.owner] -= 1;
    match.log.push(`${target.unit.owner}'s ${target.unit.name} was defeated.`);
    defeatIfEmpty(match, target.unit.owner);
  }

  return true;
}

async function runNpcTurn(match) {
  const npcName = match.npc?.name;
  if (!npcName || match.turn !== npcName || match.status !== 'active') return;
  if (match.processingNpcTurn) return;

  const memory = await loadNpcMemory();
  const aggression = computeAggression(memory);

  match.processingNpcTurn = true;
  try {
    await npcPlaceCard(match, aggression);

    const pieces = listPieces(match, npcName);
    for (const startingPosition of pieces) {
      if (match.status !== 'active') break;

      let position = startingPosition;
      let safety = 0;
      while (match.status === 'active' && position.unit.stamina > 0 && safety < 10) {
        const didAttack = await npcAttack(match, npcName, position, aggression);
        if (didAttack) {
          safety += 1;
          continue;
        }

        const moved = npcMoveToward(match, npcName, position);
        if (!moved) break;

        position = moved;
        safety += 1;
      }
    }

    if (match.status === 'active') {
      endTurn(match, npcName);
      match.log.push(`${npcName} finished its strategy cycle.`);
    }

    if (match.mode === 'npc' && match.status === 'complete') {
      await recordNpcMemory(match);
    }
  } finally {
    match.processingNpcTurn = false;
  }
}

function calculateDamageRoll(ability, attacker) {
  if (!ability?.damage) return 0;
  const damageMin = ability.damage?.min ?? 0;
  const damageMax = ability.damage?.max ?? damageMin;
  let roll = Math.floor(Math.random() * (damageMax - damageMin + 1)) + damageMin;

  const bonuses = (attacker.activeEffects || []).map((effect) => effect.modifiers?.damageBonus).filter(Boolean);
  bonuses.forEach((bonus) => {
    const min = bonus.min ?? 0;
    const max = bonus.max ?? min;
    roll += Math.floor(Math.random() * (max - min + 1)) + min;
  });

  return roll;
}

function applyAbilityEffects(ability, target, match, log, source) {
  if (!ability.effects || !ability.effects.length) return;
  target.activeEffects = target.activeEffects || [];

  ability.effects.forEach((slug) => {
    const effect = effectMap.get(slug);
    if (!effect) return;
    const active = buildActiveEffect(effect, match.turn);
    target.activeEffects.push(active);

    if (typeof active.modifiers?.staminaChange === 'number') {
      target.stamina = Math.max(0, Math.min(target.staminaMax, target.stamina + active.modifiers.staminaChange));
    }

    const sourceOwner = source?.owner ? `${source.owner}'s ${source.name}` : 'An ability';
    const targetLabel = `${target.owner}'s ${target.name}`;
    log.push(`${sourceOwner} applied ${effect.name} to ${targetLabel}.`);
  });
}

function clearExpiredEffects(match, turnOwner) {
  match.board.forEach((row) => {
    row.forEach((cell) => {
      if (cell?.activeEffects?.length) {
        const expired = cell.activeEffects.filter((effect) => effect.expiresAfterTurn === turnOwner);
        expired.forEach((effect) => {
          if (typeof effect.modifiers?.staminaChange === 'number') {
            const reversal = -1 * effect.modifiers.staminaChange;
            cell.stamina = Math.min(cell.staminaMax, cell.stamina + reversal);
          }
        });
        cell.activeEffects = cell.activeEffects.filter((effect) => effect.expiresAfterTurn !== turnOwner);
      }
    });
  });
}

function assertCell(match, row, col) {
  const { rows, cols } = gameConfig.board;
  if (row < 0 || row >= rows || col < 0 || col >= cols) {
    const err = new Error('Cell out of bounds.');
    err.status = 400;
    throw err;
  }
}

function defeatIfEmpty(match, opponent) {
  const boardCount = match.boardPieces[opponent];
  const handCount = totalCardCount(match.hands[opponent] || []);
  const deckCount = totalCardCount(match.decks?.[opponent] || []);
  if (boardCount + handCount + deckCount === 0) {
    completeMatch(match, opponent, `${opponent} has no remaining units. ${match.turn} wins.`);
  }
}

async function buildUnit(card, owner) {
  const abilitySlugs = (card.abilities || [])
    .map((ability) => (typeof ability === 'string' ? ability : ability.slug))
    .filter(Boolean);
  const abilityDocs = await Promise.all(abilitySlugs.map((slug) => getAbilityBySlug(slug)));
  const abilityDetails = abilityDocs
    .filter(Boolean)
    .map((ability) => {
      let abilityRange = 1;
      try {
        abilityRange = parseRange(ability.range ?? ability.attackRange);
      } catch (error) {
        console.warn(`Invalid range for ability ${ability.slug}:`, error.message);
      }
      return {
        slug: ability.slug,
        name: ability.name,
        description: ability.description,
        staminaCost: ability.staminaCost,
        damage: ability.damage,
        range: abilityRange,
        targetType: validateTargetType(ability.targetType),
        effects: ability.effects || [],
      };
    });
  const stats = cleanCardStats(card.stats);
  return {
    owner,
    slug: card.slug,
    name: card.name,
    health: stats.health,
    stamina: stats.stamina,
    staminaMax: stats.stamina,
    speed: stats.speed,
    abilities: abilitySlugs,
    abilityDetails,
    summoningSickness: true,
    activeEffects: [],
    enemyTerritory: false,
  };
}

app.get('/api/matches/:id', requireAuth, (req, res) => {
  const match = matches.get(req.params.id);
  if (!match) return res.status(404).json({ message: 'Match not found.' });
  const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
  if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });

  const isNpcTurn =
    match.mode === 'npc' && match.status === 'active' && match.phase !== 'deploy' && match.turn === match.npc?.name;
  const maybeRunNpc = isNpcTurn ? runNpcTurn(match) : Promise.resolve();

  maybeRunNpc
    .then(() => res.json({ match: summarizeMatch(match, actingPlayer) }))
    .catch((error) => {
      console.error('Match fetch error:', error.message);
      res.status(500).json({ message: 'Failed to load match.' });
    });
});

app.post('/api/matches/:id/place', requireAuth, async (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
    if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);

    const inDeploy = match.phase === 'deploy';
    const startingGoal = match.startingGoals?.[actingPlayer] || STARTING_HAND_DRAW;
    if (!inDeploy) ensureTurn(match, actingPlayer);
    if (inDeploy && match.ready?.[actingPlayer]) {
      throw Object.assign(new Error('You are already readied up.'), { status: 400 });
    }

    const { row, col, cardSlug } = req.body || {};
    assertCell(match, row, col);
    if (match.board[row][col]) throw Object.assign(new Error('Cell occupied.'), { status: 400 });
    if (!isHomeTerritory(match, actingPlayer, { row, col })) {
      throw Object.assign(new Error('Deployments must stay on your side of the board.'), { status: 400 });
    }
    if (!inDeploy && match.turnPlays >= 1)
      throw Object.assign(new Error('Only one card can be played each turn.'), { status: 400 });
    if (inDeploy && (match.deployments?.[actingPlayer] || 0) >= startingGoal) {
      throw Object.assign(new Error('All starting units are already placed.'), { status: 400 });
    }

    const hand = match.hands[actingPlayer] || [];
    const didDraw = drawCardFromHand(hand, cardSlug);
    if (!didDraw) throw Object.assign(new Error('Card not in hand.'), { status: 400 });

    const card = await getCardBySlug(cardSlug);
    if (!card) throw Object.assign(new Error('Card data missing.'), { status: 404 });
    const unit = await buildUnit(card, actingPlayer);

    match.board[row][col] = unit;
    updatePieceTerritory(match, { row, col }, unit);
    if (inDeploy) {
      match.deployments[actingPlayer] = (match.deployments?.[actingPlayer] || 0) + 1;
    } else {
      match.turnPlays += 1;
    }
    match.boardPieces[actingPlayer] += 1;
    const placementLog = inDeploy
      ? `${actingPlayer} placed a starting unit.`
      : `${actingPlayer} deployed ${card.name} to (${row},${col}).`;
    match.log.push(placementLog);

    res.json({ match: summarizeMatch(match, actingPlayer) });
  } catch (error) {
    console.error('Place error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to place card.' });
  }
});

app.post('/api/matches/:id/ready', requireAuth, async (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
    if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);

    if (match.phase !== 'deploy') {
      return res.status(400).json({ message: 'Battle has already begun.' });
    }

    const startingGoal = match.startingGoals?.[actingPlayer] || STARTING_HAND_DRAW;
    const placed = match.deployments?.[actingPlayer] || 0;
    if (placed < startingGoal) {
      return res.status(400).json({ message: 'Place all starting units before readying up.' });
    }

    match.ready[actingPlayer] = true;
    match.log.push(`${actingPlayer} is ready.`);

    const everyoneReady = match.players.every((p) => match.ready?.[p]);
    if (everyoneReady) {
      match.phase = 'battle';
      awakenDeployedUnits(match);
      match.log.push('Starting units revealed.');
      startTurn(match, match.turn, { initial: true });
    }

    res.json({ match: summarizeMatch(match, actingPlayer) });
  } catch (error) {
    console.error('Ready up error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to ready up.' });
  }
});

app.post('/api/matches/:id/move', requireAuth, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
    if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    if (match.phase === 'deploy') throw Object.assign(new Error('Finish deployment before moving.'), { status: 400 });
    ensureTurn(match, actingPlayer);

    const { fromRow, fromCol, toRow, toCol } = req.body || {};
    assertCell(match, fromRow, fromCol);
    assertCell(match, toRow, toCol);
    const piece = match.board[fromRow][fromCol];
    if (!piece || piece.owner !== actingPlayer) throw Object.assign(new Error('No piece to move.'), { status: 400 });
    if (piece.summoningSickness) throw Object.assign(new Error('Piece cannot act on the turn it was placed.'), { status: 400 });
    const moveCost = effectiveActionCost(piece, 1);
    if (piece.stamina < moveCost) throw Object.assign(new Error('Not enough stamina to move.'), { status: 400 });
    if (!canMovePiece(piece, { row: fromRow, col: fromCol }, { row: toRow, col: toCol })) {
      throw Object.assign(new Error('Move exceeds speed.'), { status: 400 });
    }
    if (match.board[toRow][toCol]) throw Object.assign(new Error('Destination occupied.'), { status: 400 });

    match.board[toRow][toCol] = piece;
    match.board[fromRow][fromCol] = null;
    piece.stamina -= moveCost;
    updatePieceTerritory(match, { row: toRow, col: toCol }, piece);
    match.log.push(`${actingPlayer} moved ${piece.name} to (${toRow},${toCol}).`);

    res.json({ match: summarizeMatch(match, actingPlayer) });
  } catch (error) {
    console.error('Move error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to move piece.' });
  }
});

app.post('/api/matches/:id/attack', requireAuth, async (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
    if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    if (match.phase === 'deploy') throw Object.assign(new Error('Finish deployment before attacking.'), { status: 400 });
    ensureTurn(match, actingPlayer);

    const { fromRow, fromCol, targetRow, targetCol, abilitySlug } = req.body || {};
    assertCell(match, fromRow, fromCol);
    assertCell(match, targetRow, targetCol);

    const attacker = match.board[fromRow][fromCol];
    const target = match.board[targetRow][targetCol];
    if (!attacker || attacker.owner !== actingPlayer) throw Object.assign(new Error('No attacker selected.'), { status: 400 });
    if (attacker.summoningSickness) throw Object.assign(new Error('Piece cannot act on the turn it was placed.'), { status: 400 });
    if (!target) throw Object.assign(new Error('No target at location.'), { status: 400 });

    const chosenAbilitySlug = abilitySlug || (attacker.abilities || [])[0] || 'basic-attack';
    if (!chosenAbilitySlug) throw Object.assign(new Error('No ability selected.'), { status: 400 });
    const knowsAbility = !attacker.abilities || attacker.abilities.length === 0 || attacker.abilities.includes(chosenAbilitySlug);
    if (!knowsAbility) {
      throw Object.assign(new Error('Unit does not know that ability.'), { status: 400 });
    }

    const ability = await getAbilityBySlug(chosenAbilitySlug);
    if (!ability) throw Object.assign(new Error('Ability not found.'), { status: 404 });
    const targetType = validateTargetType(ability.targetType);

    if (targetType === 'enemy' && target.owner === actingPlayer) {
      throw Object.assign(new Error('This ability targets enemies.'), { status: 400 });
    }
    if (targetType === 'friendly' && target.owner !== actingPlayer) {
      throw Object.assign(new Error('This ability targets friendly units.'), { status: 400 });
    }

    let attackRange;
    try {
      attackRange = parseRange(ability.range ?? ability.attackRange);
    } catch (error) {
      throw Object.assign(new Error('Invalid ability range.'), { status: 400 });
    }
    const rowDiff = Math.abs(fromRow - targetRow);
    const colDiff = Math.abs(fromCol - targetCol);
    const distance = Math.max(rowDiff, colDiff);
    if (distance > attackRange) {
      throw Object.assign(new Error('Target out of range.'), { status: 400 });
    }

    const staminaCost = abilityStaminaCost(attacker, ability);
    if (attacker.stamina < staminaCost) {
      throw Object.assign(new Error('Not enough stamina.'), { status: 400 });
    }

    const roll = calculateDamageRoll(ability, attacker);
    if (roll > 0) {
      target.health -= roll;
      if (match.mode === 'npc' && match.npc) {
        match.npcStats = match.npcStats || { damageDealt: 0, damageTaken: 0, recorded: false };
        if (attacker.owner === match.npc.name) {
          match.npcStats.damageDealt += roll;
        }
        if (target.owner === match.npc.name) {
          match.npcStats.damageTaken += roll;
        }
      }
    }
    attacker.stamina -= staminaCost;
    applyAbilityEffects(ability, target, match, match.log, attacker);

    const effectSummary = (ability.effects || [])
      .map((slug) => effectMap.get(slug)?.name)
      .filter(Boolean)
      .join(', ');

    const damageFragment = roll > 0 ? ` for ${roll} damage` : '';
    const effectFragment = effectSummary ? ` and applied ${effectSummary}` : '';
    match.log.push(
      `${actingPlayer}'s ${attacker.name} used ${ability.name}${damageFragment}${effectFragment} on ${target.owner}'s ${target.name}.`
    );

    if (target.health <= 0) {
      match.board[targetRow][targetCol] = null;
      match.boardPieces[target.owner] -= 1;
      match.log.push(`${target.owner}'s ${target.name} was defeated.`);
      defeatIfEmpty(match, target.owner);
    }

    if (match.mode === 'npc' && match.status === 'complete') {
      await recordNpcMemory(match);
    }

    res.json({ match: summarizeMatch(match, actingPlayer) });
  } catch (error) {
    console.error('Attack error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to attack.' });
  }
});

app.post('/api/matches/:id/end-turn', requireAuth, async (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    const actingPlayer = resolveActingPlayer(match, req.player, req.headers['x-player-role']);
    if (!actingPlayer) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    if (match.phase === 'deploy') {
      return res.status(400).json({ message: 'Both players must ready up before turns can end.' });
    }

    if (match.mode === 'npc' && match.turn === match.npc?.name && actingPlayer !== match.turn) {
      if (match.processingNpcTurn) {
        return res.status(202).json({
          match: summarizeMatch(match, actingPlayer),
          message: 'NPC turn is already in progress.',
        });
      }

      await runNpcTurn(match);

      if (match.mode === 'npc' && match.status === 'complete') {
        await recordNpcMemory(match);
      }

      return res.json({
        match: summarizeMatch(match, actingPlayer),
        message: 'NPC completed its pending turn.',
      });
    }

    ensureTurn(match, actingPlayer);

    endTurn(match, actingPlayer);

    if (match.mode === 'npc' && match.turn === match.npc?.name) {
      await runNpcTurn(match);
    }

    if (match.mode === 'npc' && match.status === 'complete') {
      await recordNpcMemory(match);
    }

    res.json({ match: summarizeMatch(match, actingPlayer) });
  } catch (error) {
    console.error('End turn error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to end turn.' });
  }
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server due to MongoDB error:', err);
    process.exit(1);
  });

