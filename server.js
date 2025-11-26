const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { MongoClient } = require('mongodb');

const mongoConfig = require('./config/mongo-config');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || mongoConfig.mongoUri;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-token';

let usersCollection;

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
  if (usersCollection) return usersCollection;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('gothic-arcade');
  usersCollection = db.collection('players');
  await usersCollection.createIndex({ username: 1 }, { unique: true });
  return usersCollection;
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
    const collection = await ensureDatabase();
    const salt = crypto.randomBytes(16);
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const user = {
      username: username.toLowerCase(),
      salt: salt.toString('hex'),
      passwordHash,
      createdAt: new Date(),
    };

    await collection.insertOne(user);
    const token = createToken({ username: user.username, createdAt: Date.now() });
    res.status(201).json({ message: 'Player registered successfully.', token, username: user.username });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'That handle is already watching the shadows.' });
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
    const collection = await ensureDatabase();
    const player = await collection.findOne({ username: username.toLowerCase() });
    if (!player) {
      return res.status(401).json({ message: 'No such wanderer has signed the ledger.' });
    }

    const salt = Buffer.from(player.salt, 'hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(player.passwordHash, 'hex'))) {
      return res.status(401).json({ message: 'The sigils do not match.' });
    }

    const token = createToken({ username: player.username, createdAt: Date.now() });
    res.json({ message: 'Welcome back to the abyss.', token, username: player.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Failed to log in.' });
  }
});

app.get('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: 'Invalid token.' });
  }

  try {
    const collection = await ensureDatabase();
    const player = await collection.findOne({ username: payload.username }, { projection: { passwordHash: 0, salt: 0 } });
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

