import { requireProfile, wireLogout } from './common.js';

const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Authenticated · choose a page to continue';
}

wireLogout(logoutBtn);
init();
