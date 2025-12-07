import { formatAbility, formatStats, requireProfile, summarizeAbilities, wireLogout } from './common.js';

const catalogList = document.getElementById('catalog-list');
const addCardForm = document.getElementById('add-card-form');
const nameEl = document.getElementById('profile-name');
const metaEl = document.getElementById('profile-meta');
const logoutBtn = document.getElementById('logout');
const cardAbilitySelect = document.getElementById('card-ability');
const abilityList = document.getElementById('ability-list');
const addAbilityForm = document.getElementById('add-ability-form');
const abilityEffectSelect = document.getElementById('ability-effects');
const abilityTargetSelect = document.getElementById('ability-target');
const effectList = document.getElementById('effect-list');
const addEffectForm = document.getElementById('add-effect-form');
const cardMode = document.getElementById('card-mode');
const abilityMode = document.getElementById('ability-mode');
const effectMode = document.getElementById('effect-mode');

let abilities = [];
let effects = [];
let cards = [];
let cardEditingSlug = null;
let abilityEditingSlug = null;
let effectEditingSlug = null;

function formatEffects(effectSlugs = []) {
  if (!effectSlugs.length) return 'No effects';
  const names = effectSlugs
    .map((slug) => effects.find((effect) => effect.slug === slug)?.name || slug)
    .filter(Boolean);
  return names.join(', ');
}

function createEffectCard(effect) {
  const effectEl = document.createElement('div');
  effectEl.className = 'card catalog-card';
  const target = effect.targetHint || 'any';
  const staminaChange = effect.modifiers?.staminaChange;
  const damageBonus = effect.modifiers?.damageBonus;
  const staminaText = typeof staminaChange === 'number' ? `${staminaChange >= 0 ? '+' : ''}${staminaChange} STA` : null;
  const damageText = damageBonus ? `+${damageBonus.min}-${damageBonus.max} DMG` : null;
  const modifierSummary = [staminaText, damageText].filter(Boolean).join(' · ');

  effectEl.innerHTML = `
    <div class="card-header">
      <div>
        <p class="label">${effect.name}</p>
        <p class="muted">${effect.type || 'neutral'} · Target ${target}</p>
      </div>
      <p class="slug-label">${effect.slug}</p>
    </div>
    <p>${modifierSummary || 'No modifiers'}</p>
    <p class="muted">${effect.description || 'No description'}</p>
    <div class="card-actions">
      <button class="ghost" data-edit-effect="${effect.slug}">Edit</button>
      <button class="ghost danger" data-delete-effect="${effect.slug}">Delete</button>
    </div>
  `;
  return effectEl;
}

function createAbilityCard(ability, { showActions = true, compact = false } = {}) {
  const abilityEl = document.createElement('div');
  abilityEl.className = `card ability-card catalog-card${compact ? ' compact' : ''}`;
  const damage = ability.damage ? `${ability.damage.min}-${ability.damage.max}` : '—';
  const range = Number.isFinite(ability.range) || Number.isFinite(ability.attackRange)
    ? ability.range ?? ability.attackRange
    : '—';
  abilityEl.innerHTML = `
    <div class="card-header tight">
      <div>
        <p class="label">${ability.name}</p>
        <p class="muted small-text">${ability.description || 'No description'}</p>
      </div>
      <p class="slug-label">${ability.slug}</p>
    </div>
    <div class="ability-meta">
      <span>Target ${ability.targetType || 'enemy'}</span>
      <span>Cost ${ability.staminaCost} STA</span>
      <span>Range ${range}</span>
      <span>DMG ${damage}</span>
    </div>
    <p class="muted small-text">Effects: ${formatEffects(ability.effects)}</p>
    ${
      showActions
        ? `<div class="card-actions">
      <button class="ghost" data-edit-ability="${ability.slug}">Edit</button>
      <button class="ghost danger" data-delete-ability="${ability.slug}">Delete</button>
    </div>`
        : ''
    }
  `;
  return abilityEl;
}

async function refreshEffects() {
  const res = await fetch('/api/effects');
  const data = await res.json();
  effects = data.effects || [];

  if (abilityEffectSelect) {
    abilityEffectSelect.innerHTML = '<option value="">Select effects</option>';
    effects.forEach((effect) => {
      const opt = document.createElement('option');
      opt.value = effect.slug;
      opt.textContent = `${effect.name} (${effect.type})`;
      abilityEffectSelect.appendChild(opt);
    });
  }

  if (effectList) {
    effectList.innerHTML = '';
    effects.forEach((effect) => effectList.appendChild(createEffectCard(effect)));
  }
}

async function refreshAbilities() {
  const res = await fetch('/api/abilities');
  const data = await res.json();
  abilities = data.abilities || [];

  abilityList.innerHTML = '';
  abilities.forEach((ability) => {
    abilityList.appendChild(createAbilityCard(ability));
  });

  if (cardAbilitySelect) {
    cardAbilitySelect.innerHTML = '<option value="">Select ability</option>';
    abilities.forEach((ability) => {
      const opt = document.createElement('option');
      opt.value = ability.slug;
      opt.textContent = formatAbility(ability);
      cardAbilitySelect.appendChild(opt);
    });
  }
}

async function refreshCatalog() {
  const res = await fetch('/api/cards');
  const data = await res.json();
  cards = data.cards || [];
  catalogList.innerHTML = '';
  cards.forEach((card) => {
    const cardAbilities = card.abilityDetails?.length
      ? card.abilityDetails
      : (card.abilities || [])
          .map((slug) => abilities.find((ability) => ability.slug === slug))
          .filter(Boolean);

    const cardEl = document.createElement('div');
    cardEl.className = 'card catalog-card';
    cardEl.innerHTML = `
      <div class="card-header">
        <div>
          <p class="label">${card.name}</p>
          <p class="muted">${formatStats(card)}</p>
        </div>
        <p class="slug-label">${card.slug}</p>
      </div>
      <p class="muted">Abilities: ${cardAbilities.map((ability) => ability?.name).filter(Boolean).join(', ') || 'None'}</p>
    `;

    const abilityWrapper = document.createElement('div');
    abilityWrapper.className = 'ability-row';
    if (cardAbilities.length) {
      cardAbilities.forEach((ability) =>
        abilityWrapper.appendChild(createAbilityCard(ability, { showActions: false, compact: true }))
      );
    }
    cardEl.appendChild(abilityWrapper);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.innerHTML = `
      <button class="ghost" data-edit-card="${card.slug}">Edit</button>
      <button class="ghost danger" data-delete-card="${card.slug}">Delete</button>
    `;
    cardEl.appendChild(actions);

    catalogList.appendChild(cardEl);
  });
}

function setModeLabel(modeEl, slug) {
  if (!modeEl) return;
  modeEl.textContent = slug ? `Editing ${slug}` : 'Create';
}

addCardForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(addCardForm);
  const payload = {
    slug: form.get('slug'),
    name: form.get('name'),
    stats: {
      health: Number(form.get('health')),
      stamina: Number(form.get('stamina')),
      speed: Number(form.get('speed')),
    },
    abilities: form.get('ability') ? [form.get('ability')] : [],
  };
  const res = await fetch(cardEditingSlug ? `/api/cards/${cardEditingSlug}` : '/api/cards', {
    method: cardEditingSlug ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  alert(data.message || 'Updated catalog');
  if (res.ok) {
    addCardForm.reset();
    cardEditingSlug = null;
    setModeLabel(cardMode, null);
    refreshAbilities();
    refreshCatalog();
  }
});

addEffectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(addEffectForm);
  const payload = {
    slug: form.get('slug'),
    name: form.get('name'),
    type: form.get('type'),
    targetHint: form.get('targetHint') || undefined,
    description: form.get('description'),
    duration: form.get('duration'),
    staminaChange: form.get('staminaChange'),
    damageBonusMin: form.get('damageBonusMin'),
    damageBonusMax: form.get('damageBonusMax'),
  };

  const res = await fetch(effectEditingSlug ? `/api/effects/${effectEditingSlug}` : '/api/effects', {
    method: effectEditingSlug ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  alert(data.message || 'Updated effects');
  if (res.ok) {
    addEffectForm.reset();
    effectEditingSlug = null;
    setModeLabel(effectMode, null);
    await refreshEffects();
  }
});

addAbilityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(addAbilityForm);
  const minDmg = form.get('min');
  const maxDmg = form.get('max');
  const hasDamage = minDmg !== '' || maxDmg !== '';
  const effectsSelection = form.getAll('effects').filter(Boolean);
  const payload = {
    slug: form.get('slug'),
    name: form.get('name'),
    damage: hasDamage ? { min: Number(minDmg || 0), max: Number(maxDmg || minDmg || 0) } : undefined,
    staminaCost: Number(form.get('staminaCost')),
    range: Number(form.get('range')),
    targetType: form.get('targetType') || 'enemy',
    effects: effectsSelection,
    description: form.get('description'),
  };
  const res = await fetch(abilityEditingSlug ? `/api/abilities/${abilityEditingSlug}` : '/api/abilities', {
    method: abilityEditingSlug ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  alert(data.message || 'Updated abilities');
  if (res.ok) {
    addAbilityForm.reset();
    if (abilityTargetSelect) abilityTargetSelect.value = 'enemy';
    if (abilityEffectSelect) abilityEffectSelect.selectedIndex = 0;
    abilityEditingSlug = null;
    setModeLabel(abilityMode, null);
    refreshAbilities();
    refreshCatalog();
  }
});

addCardForm.addEventListener('reset', () => {
  cardEditingSlug = null;
  setModeLabel(cardMode, null);
});

addAbilityForm.addEventListener('reset', () => {
  abilityEditingSlug = null;
  setModeLabel(abilityMode, null);
});

addEffectForm.addEventListener('reset', () => {
  effectEditingSlug = null;
  setModeLabel(effectMode, null);
});

async function deleteItem(url, slug, onSuccess) {
  const confirmed = window.confirm(`Delete ${slug}? This cannot be undone.`);
  if (!confirmed) return;

  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  alert(data.message || 'Delete request finished.');

  if (res.ok && typeof onSuccess === 'function') {
    await onSuccess();
  }
}

function populateEffectForm(effect) {
  effectEditingSlug = effect.slug;
  setModeLabel(effectMode, effect.slug);
  addEffectForm.slug.value = effect.slug;
  addEffectForm.name.value = effect.name;
  addEffectForm.type.value = effect.type || 'neutral';
  addEffectForm.targetHint.value = effect.targetHint || '';
  addEffectForm.duration.value = effect.duration || '';
  addEffectForm.staminaChange.value = effect.modifiers?.staminaChange ?? '';
  addEffectForm.damageBonusMin.value = effect.modifiers?.damageBonus?.min ?? '';
  addEffectForm.damageBonusMax.value = effect.modifiers?.damageBonus?.max ?? '';
  addEffectForm.description.value = effect.description || '';
}

function populateAbilityForm(ability) {
  abilityEditingSlug = ability.slug;
  setModeLabel(abilityMode, ability.slug);
  addAbilityForm.slug.value = ability.slug;
  addAbilityForm.name.value = ability.name;
  addAbilityForm.min.value = ability.damage?.min ?? '';
  addAbilityForm.max.value = ability.damage?.max ?? '';
  addAbilityForm.staminaCost.value = ability.staminaCost;
  addAbilityForm.range.value = ability.range ?? ability.attackRange ?? '';
  addAbilityForm.targetType.value = ability.targetType || 'enemy';
  Array.from(abilityEffectSelect.options).forEach((opt) => {
    opt.selected = ability.effects?.includes(opt.value) || false;
  });
  addAbilityForm.description.value = ability.description || '';
}

function populateCardForm(card) {
  cardEditingSlug = card.slug;
  setModeLabel(cardMode, card.slug);
  addCardForm.slug.value = card.slug;
  addCardForm.name.value = card.name;
  addCardForm.health.value = card.stats?.health ?? '';
  addCardForm.stamina.value = card.stats?.stamina ?? '';
  addCardForm.speed.value = card.stats?.speed ?? '';
  if (card.abilities?.length) {
    cardAbilitySelect.value = card.abilities[0];
  } else {
    cardAbilitySelect.selectedIndex = 0;
  }
}

document.body.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const effectSlug = target.dataset.editEffect;
  const abilitySlug = target.dataset.editAbility;
  const cardSlug = target.dataset.editCard;
  const deleteEffectSlug = target.dataset.deleteEffect;
  const deleteAbilitySlug = target.dataset.deleteAbility;
  const deleteCardSlug = target.dataset.deleteCard;

  if (effectSlug) {
    const effect = effects.find((item) => item.slug === effectSlug);
    if (effect) populateEffectForm(effect);
  }

  if (abilitySlug) {
    const ability = abilities.find((item) => item.slug === abilitySlug);
    if (ability) populateAbilityForm(ability);
  }

  if (cardSlug) {
    const card = cards.find((item) => item.slug === cardSlug);
    if (card) populateCardForm(card);
  }

  if (deleteEffectSlug) {
    deleteItem(`/api/effects/${deleteEffectSlug}`, deleteEffectSlug, async () => {
      if (effectEditingSlug === deleteEffectSlug) {
        addEffectForm.reset();
        setModeLabel(effectMode, null);
        effectEditingSlug = null;
      }
      await refreshEffects();
      await refreshAbilities();
    });
  }

  if (deleteAbilitySlug) {
    deleteItem(`/api/abilities/${deleteAbilitySlug}`, deleteAbilitySlug, async () => {
      if (abilityEditingSlug === deleteAbilitySlug) {
        addAbilityForm.reset();
        setModeLabel(abilityMode, null);
        abilityEditingSlug = null;
      }
      await refreshAbilities();
      await refreshCatalog();
    });
  }

  if (deleteCardSlug) {
    deleteItem(`/api/cards/${deleteCardSlug}`, deleteCardSlug, async () => {
      if (cardEditingSlug === deleteCardSlug) {
        addCardForm.reset();
        setModeLabel(cardMode, null);
        cardEditingSlug = null;
      }
      await refreshCatalog();
    });
  }
});

async function init() {
  const profile = await requireProfile();
  if (!profile) return;
  nameEl.textContent = profile.username;
  metaEl.textContent = 'Mongo-backed card tools';
  await refreshEffects();
  await refreshAbilities();
  refreshCatalog();
}

wireLogout(logoutBtn);
init();
