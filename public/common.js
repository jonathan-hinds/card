const STORAGE_TOKEN = 'gothic_token';
const STORAGE_USER = 'gothic_user';
const STORAGE_MATCH = 'gothic_match';

export function getToken() {
  return localStorage.getItem(STORAGE_TOKEN) || '';
}

export function getUsername() {
  return localStorage.getItem(STORAGE_USER) || '';
}

export function saveSession(token, username) {
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_USER, username);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_MATCH);
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function setActiveMatch(id) {
  if (id) {
    localStorage.setItem(STORAGE_MATCH, id);
  } else {
    localStorage.removeItem(STORAGE_MATCH);
  }
}

export function getActiveMatch() {
  return localStorage.getItem(STORAGE_MATCH) || '';
}

export async function requireProfile() {
  const token = getToken();
  if (!token) {
    window.location.href = '/index.html';
    return null;
  }

  try {
    const res = await fetch('/api/profile', { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error('Session expired');
    const data = await res.json();
    return data.player;
  } catch (err) {
    clearSession();
    window.location.href = '/index.html';
    return null;
  }
}

export function wireLogout(button) {
  if (!button) return;
  button.addEventListener('click', () => {
    clearSession();
    window.location.href = '/index.html';
  });
}

export function formatStats(card) {
  return `HP ${card.stats.health} · Sta ${card.stats.stamina} · Spd ${card.stats.speed}`;
}

export function formatAbility(ability) {
  if (!ability) return 'Unknown ability';
  const damage = ability.damage ? `${ability.damage.min}-${ability.damage.max}` : '—';
  const target = ability.targetType ? ` · Target ${ability.targetType}` : '';
  const range = Number.isFinite(ability.range) || Number.isFinite(ability.attackRange)
    ? ` · Range ${ability.range ?? ability.attackRange}`
    : '';
  const effectCount = ability.effects?.length ? ` · Effects ${ability.effects.length}` : '';
  return `${ability.name} · DMG ${damage} · Cost ${ability.staminaCost} STA${range}${target}${effectCount}`;
}

export function summarizeAbilities(abilities = []) {
  if (!abilities.length) return 'No abilities assigned';
  return abilities.map((ability) => formatAbility(ability)).join(' | ');
}
