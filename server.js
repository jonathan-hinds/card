const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { MongoClient } = require('mongodb');

const mongoConfig = require('./config/mongo-config');
const { cards } = require('./config/card-definitions');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || mongoConfig.mongoUri;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-token';

let usersCollection;
let cardsCollection;
let decksCollection;
let database;

const MAX_DECK_SIZE = 20;
const MAX_COPIES_PER_CARD = 3;

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

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ message: 'Invalid token.' });
  }

  req.user = payload;
  next();
}

async function seedCards() {
  const bulkOps = cards.map((card) => ({
    updateOne: {
      filter: { slug: card.slug },
      update: { $set: { ...card, updatedAt: new Date() } },
      upsert: true,
    },
  }));

  if (bulkOps.length > 0) {
    await cardsCollection.bulkWrite(bulkOps, { ordered: false });
  }
}

async function ensureDatabase() {
  if (database) return database;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  database = client.db('gothic-arcade');
  usersCollection = database.collection('players');
  cardsCollection = database.collection('cards');
  decksCollection = database.collection('decks');

  await Promise.all([
    usersCollection.createIndex({ username: 1 }, { unique: true }),
    cardsCollection.createIndex({ slug: 1 }, { unique: true }),
    decksCollection.createIndex({ owner: 1, name: 1 }, { unique: true }),
  ]);

  await seedCards();

  return database;
}

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/cards', async (_, res) => {
  try {
    await ensureDatabase();
    const cardList = await cardsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ school: 1, name: 1 })
      .toArray();
    res.json({ cards: cardList });
  } catch (error) {
    console.error('Cards load error:', error);
    res.status(500).json({ message: 'Failed to load cards.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    await ensureDatabase();
    const salt = crypto.randomBytes(16);
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const user = {
      username: username.toLowerCase(),
      salt: salt.toString('hex'),
      passwordHash,
      createdAt: new Date(),
    };

    await usersCollection.insertOne(user);
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
    await ensureDatabase();
    const player = await usersCollection.findOne({ username: username.toLowerCase() });
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

app.get('/api/decks', authenticate, async (req, res) => {
  try {
    await ensureDatabase();
    const decks = await decksCollection
      .find({ owner: req.user.username }, { projection: { _id: 0, owner: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json({ decks });
  } catch (error) {
    console.error('Deck load error:', error);
    res.status(500).json({ message: 'Failed to load decks.' });
  }
});

app.post('/api/decks', authenticate, async (req, res) => {
  const { name, cards: deckCards } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'Deck name is required.' });
  }

  if (!Array.isArray(deckCards)) {
    return res.status(400).json({ message: 'Deck list must be an array.' });
  }

  const normalizedCards = deckCards.map((entry) => ({
    slug: entry.slug,
    quantity: Number(entry.quantity) || 0,
  }));

  const totalCards = normalizedCards.reduce((sum, card) => sum + card.quantity, 0);

  if (totalCards !== MAX_DECK_SIZE) {
    return res
      .status(400)
      .json({ message: `Deck must contain exactly ${MAX_DECK_SIZE} cards. Currently at ${totalCards}.` });
  }

  const invalidQuantity = normalizedCards.find(
    (card) => !card.slug || card.quantity < 1 || card.quantity > MAX_COPIES_PER_CARD,
  );

  if (invalidQuantity) {
    return res
      .status(400)
      .json({ message: `Each card must appear between 1 and ${MAX_COPIES_PER_CARD} times.` });
  }

  try {
    await ensureDatabase();

    const uniqueSlugs = [...new Set(normalizedCards.map((card) => card.slug))];
    const existing = await cardsCollection
      .find({ slug: { $in: uniqueSlugs } }, { projection: { slug: 1 } })
      .toArray();

    if (existing.length !== uniqueSlugs.length) {
      return res.status(400).json({ message: 'Deck contains unknown cards.' });
    }

    const now = new Date();
    const sanitizedName = name.trim().slice(0, 60);

    const deckResult = await decksCollection.findOneAndUpdate(
      { owner: req.user.username, name: sanitizedName },
      {
        $set: {
          cards: normalizedCards,
          updatedAt: now,
        },
        $setOnInsert: {
          owner: req.user.username,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 0, owner: 0 } },
    );

    res.status(201).json({ message: 'Deck saved.', deck: deckResult.value });
  } catch (error) {
    console.error('Deck save error:', error);
    res.status(500).json({ message: 'Failed to save deck.' });
  }
});

app.get('/api/profile', authenticate, async (req, res) => {
  try {
    await ensureDatabase();
    const player = await usersCollection.findOne(
      { username: req.user.username },
      { projection: { passwordHash: 0, salt: 0 } },
    );

    if (!player) {
      return res.status(404).json({ message: 'Player not found.' });
    }
    res.json({ player });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Failed to load profile.' });
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

