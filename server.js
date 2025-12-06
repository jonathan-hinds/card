const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { MongoClient } = require('mongodb');

const mongoConfig = require('./config/mongo-config');
const gameConfig = require('./config/game-config.json');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || mongoConfig.mongoUri;
const DATABASE_NAME = process.env.MONGO_DB_NAME || 'card-battles';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-token';

let usersCollection;
let cardsCollection;

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
  if (usersCollection && cardsCollection) return { usersCollection, cardsCollection };
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  usersCollection = db.collection('players');
  cardsCollection = db.collection('cards');
  await usersCollection.createIndex({ username: 1 }, { unique: true });
  await cardsCollection.createIndex({ slug: 1 }, { unique: true });
  await seedCards(cardsCollection);
  return { usersCollection, cardsCollection };
}

async function seedCards(collection) {
  const grunt = {
    slug: 'grunt',
    name: 'Grunt',
    stats: {
      health: 10,
      damage: { min: 1, max: 3 },
      stamina: 3,
      speed: 1,
      attackRange: 1,
    },
    abilities: [
      {
        name: 'Basic Attack',
        staminaCost: 1,
        description: 'Strike a nearby foe for 1-3 damage.',
      },
    ],
    createdAt: new Date(),
  };
  await collection.updateOne({ slug: grunt.slug }, { $setOnInsert: grunt }, { upsert: true });
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

function canMovePiece(piece, from, to) {
  const distance = Math.abs(from.row - to.row) + Math.abs(from.col - to.col);
  return distance <= piece.speed;
}

function withinRange(attacker, from, to) {
  const distance = Math.abs(from.row - to.row) + Math.abs(from.col - to.col);
  return distance <= attacker.attackRange;
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

function drawCardFromHand(hand, slug) {
  const entry = hand.find((item) => item.slug === slug);
  if (!entry || entry.count <= 0) return false;
  entry.count -= 1;
  return true;
}

function remainingPieces(playerState) {
  const boardCount = playerState.boardPieces || 0;
  const handCount = (playerState.hand || []).reduce((sum, card) => sum + card.count, 0);
  return boardCount + handCount;
}

function summarizeMatch(match, viewer) {
  const maskHand = (hand) => hand.map((card) => ({ slug: card.slug, count: card.count }));
  const view = {
    id: match.id,
    players: match.players,
    turn: match.turn,
    board: match.board,
    boardSize: gameConfig.board,
    status: match.status,
    log: match.log,
    defeated: match.defeated,
  };
  if (viewer === match.players[0] || viewer === match.players[1]) {
    view.hands = {
      [match.players[0]]: maskHand(match.hands[match.players[0]]),
      [match.players[1]]: maskHand(match.hands[match.players[1]]),
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

app.get('/api/cards', async (_req, res) => {
  try {
    const { cardsCollection: collection } = await ensureDatabase();
    const cards = await collection.find({}).sort({ name: 1 }).toArray();
    res.json({ cards });
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
    await collection.insertOne({ ...card, createdAt: new Date() });
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
    const result = await collection.updateOne({ slug }, { $set: updates });
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Card not found.' });
    }
    res.json({ message: 'Card updated.' });
  } catch (error) {
    console.error('Card update error:', error);
    res.status(500).json({ message: 'Failed to update card.' });
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
      const hands = {};
      hands[p1] = JSON.parse(JSON.stringify(player.hand));
      const otherPlayer = await loadPlayer(p2);
      hands[p2] = JSON.parse(JSON.stringify(otherPlayer.hand));
      const match = {
        id: matchId,
        players: [p1, p2],
        hands,
        board: createEmptyBoard(),
        turn: p1,
        turnPlays: 0,
        status: 'active',
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

function findMatchForPlayer(player) {
  for (const match of matches.values()) {
    if (match.players.includes(player)) return match;
  }
  return null;
}

app.get('/api/matchmaking/status', requireAuth, (req, res) => {
  const inQueue = matchmakingQueue.includes(req.player);
  const match = findMatchForPlayer(req.player);
  res.json({ inQueue, match: match ? summarizeMatch(match, req.player) : null });
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
  const handCount = (match.hands[opponent] || []).reduce((sum, entry) => sum + entry.count, 0);
  if (boardCount + handCount === 0) {
    match.status = 'complete';
    match.defeated = opponent;
    match.log.push(`${opponent} has no remaining units. ${match.turn} wins.`);
  }
}

async function buildUnit(card, owner) {
  return {
    owner,
    slug: card.slug,
    name: card.name,
    health: card.stats.health,
    stamina: card.stats.stamina,
    staminaMax: card.stats.stamina,
    speed: card.stats.speed,
    attackRange: card.stats.attackRange,
    damage: card.stats.damage,
    summoningSickness: true,
  };
}

app.get('/api/matches/:id', requireAuth, (req, res) => {
  const match = matches.get(req.params.id);
  if (!match) return res.status(404).json({ message: 'Match not found.' });
  if (!match.players.includes(req.player)) return res.status(403).json({ message: 'Not a participant.' });
  res.json({ match: summarizeMatch(match, req.player) });
});

app.post('/api/matches/:id/place', requireAuth, async (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    if (!match.players.includes(req.player)) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    ensureTurn(match, req.player);

    const { row, col, cardSlug } = req.body || {};
    assertCell(match, row, col);
    if (match.board[row][col]) throw Object.assign(new Error('Cell occupied.'), { status: 400 });
    if (match.turnPlays >= 1) throw Object.assign(new Error('Only one card can be played each turn.'), { status: 400 });

    const hand = match.hands[req.player] || [];
    const didDraw = drawCardFromHand(hand, cardSlug);
    if (!didDraw) throw Object.assign(new Error('Card not in hand.'), { status: 400 });

    const card = await getCardBySlug(cardSlug);
    if (!card) throw Object.assign(new Error('Card data missing.'), { status: 404 });
    const unit = await buildUnit(card, req.player);

    match.board[row][col] = unit;
    match.turnPlays += 1;
    match.boardPieces[req.player] += 1;
    match.log.push(`${req.player} deployed ${card.name} to (${row},${col}).`);

    res.json({ match: summarizeMatch(match, req.player) });
  } catch (error) {
    console.error('Place error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to place card.' });
  }
});

app.post('/api/matches/:id/move', requireAuth, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    if (!match.players.includes(req.player)) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    ensureTurn(match, req.player);

    const { fromRow, fromCol, toRow, toCol } = req.body || {};
    assertCell(match, fromRow, fromCol);
    assertCell(match, toRow, toCol);
    const piece = match.board[fromRow][fromCol];
    if (!piece || piece.owner !== req.player) throw Object.assign(new Error('No piece to move.'), { status: 400 });
    if (piece.summoningSickness) throw Object.assign(new Error('Piece cannot act on the turn it was placed.'), { status: 400 });
    if (piece.stamina <= 0) throw Object.assign(new Error('No stamina left to move.'), { status: 400 });
    if (!canMovePiece(piece, { row: fromRow, col: fromCol }, { row: toRow, col: toCol })) {
      throw Object.assign(new Error('Move exceeds speed.'), { status: 400 });
    }
    if (match.board[toRow][toCol]) throw Object.assign(new Error('Destination occupied.'), { status: 400 });

    match.board[toRow][toCol] = piece;
    match.board[fromRow][fromCol] = null;
    piece.stamina -= 1;
    match.log.push(`${req.player} moved ${piece.name} to (${toRow},${toCol}).`);

    res.json({ match: summarizeMatch(match, req.player) });
  } catch (error) {
    console.error('Move error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to move piece.' });
  }
});

app.post('/api/matches/:id/attack', requireAuth, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    if (!match.players.includes(req.player)) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    ensureTurn(match, req.player);

    const { fromRow, fromCol, targetRow, targetCol } = req.body || {};
    assertCell(match, fromRow, fromCol);
    assertCell(match, targetRow, targetCol);

    const attacker = match.board[fromRow][fromCol];
    const defender = match.board[targetRow][targetCol];
    if (!attacker || attacker.owner !== req.player) throw Object.assign(new Error('No attacker selected.'), { status: 400 });
    if (attacker.summoningSickness) throw Object.assign(new Error('Piece cannot act on the turn it was placed.'), { status: 400 });
    if (!defender) throw Object.assign(new Error('No target at location.'), { status: 400 });
    if (defender.owner === req.player) throw Object.assign(new Error('Cannot attack your own unit.'), { status: 400 });
    if (attacker.stamina <= 0) throw Object.assign(new Error('Not enough stamina.'), { status: 400 });
    if (!withinRange(attacker, { row: fromRow, col: fromCol }, { row: targetRow, col: targetCol })) {
      throw Object.assign(new Error('Target out of range.'), { status: 400 });
    }

    const roll = Math.floor(Math.random() * (attacker.damage.max - attacker.damage.min + 1)) + attacker.damage.min;
    defender.health -= roll;
    attacker.stamina -= 1;
    match.log.push(`${req.player}'s ${attacker.name} used Basic Attack for ${roll} damage.`);

    if (defender.health <= 0) {
      match.board[targetRow][targetCol] = null;
      match.boardPieces[defender.owner] -= 1;
      match.log.push(`${defender.owner}'s ${defender.name} was defeated.`);
      defeatIfEmpty(match, defender.owner);
    }

    res.json({ match: summarizeMatch(match, req.player) });
  } catch (error) {
    console.error('Attack error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Failed to attack.' });
  }
});

app.post('/api/matches/:id/end-turn', requireAuth, (req, res) => {
  try {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    if (!match.players.includes(req.player)) return res.status(403).json({ message: 'Not a participant.' });
    ensureActive(match);
    ensureTurn(match, req.player);

    // Reset the current player's pieces for the next turn
    match.board.forEach((row) => {
      row.forEach((cell) => {
        if (cell && cell.owner === req.player) {
          cell.stamina = cell.staminaMax;
          cell.summoningSickness = false;
        }
      });
    });

    match.turn = match.players.find((p) => p !== req.player);
    match.turnPlays = 0;
    match.log.push(`${req.player} ended their turn.`);

    res.json({ match: summarizeMatch(match, req.player) });
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

