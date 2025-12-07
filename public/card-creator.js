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
const effectTemplateSelect = document.getElementById('effect-template');
const modifierFields = {
  staminaChange: document.querySelector('[data-modifier="staminaChange"]'),
  damageBonus: Array.from(document.querySelectorAll('[data-modifier="damageBonus"]')),
};

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
      <p class="pill">${effect.slug}</p>
    </div>
    <p>${modifierSummary || 'No modifiers'}</p>
    <p class="muted">${effect.description || 'No description'}</p>
    <div class="card-actions">
      <button class="ghost" data-edit-effect="${effect.slug}">Edit</button>
    </div>
  `;
  return effectEl;
}

function toggleModifierFields(effect) {
  const showStamina = Boolean(effect?.modifiers?.staminaChange);
  const showDamage = Boolean(effect?.modifiers?.damageBonus);

  if (modifierFields.staminaChange) {
    modifierFields.staminaChange.classList.toggle('hidden', !showStamina);
    if (!showStamina) addEffectForm.staminaChange.value = '';
  }

  if (modifierFields.damageBonus?.length) {
    modifierFields.damageBonus.forEach((field) => field.classList.toggle('hidden', !showDamage));
    if (!showDamage) {
      addEffectForm.damageBonusMin.value = '';
      addEffectForm.damageBonusMax.value = '';
    }
  }
}

function applyEffectTemplate(effect) {
  if (!effect) {
    toggleModifierFields(null);
    return;
  }

  addEffectForm.type.value = effect.type || 'neutral';
  addEffectForm.targetHint.value = effect.targetHint || '';
  addEffectForm.duration.value = effect.duration || '';
  addEffectForm.description.value = effect.description || '';

  if (!addEffectForm.name.value) addEffectForm.name.value = effect.name;
  if (!addEffectForm.slug.value) addEffectForm.slug.value = `${effect.slug}-variant`;

  addEffectForm.staminaChange.value = effect.modifiers?.staminaChange ?? '';
  addEffectForm.damageBonusMin.value = effect.modifiers?.damageBonus?.min ?? '';
  addEffectForm.damageBonusMax.value = effect.modifiers?.damageBonus?.max ?? '';

  toggleModifierFields(effect);
}

function createAbilityCard(ability) {
  const abilityEl = document.createElement('div');
  abilityEl.className = 'card ability-card catalog-card';
  const damage = ability.damage ? `${ability.damage.min}-${ability.damage.max}` : '—';
  abilityEl.innerHTML = `
    <div class="card-header">
      <div>
        <p class="label">${ability.name}</p>
        <p class="muted">Target ${ability.targetType || 'enemy'} · Cost ${ability.staminaCost} STA</p>
      </div>
      <p class="pill">${ability.slug}</p>
    </div>
    <p>Damage ${damage}</p>
    <p class="muted">Effects: ${formatEffects(ability.effects)}</p>
    <p class="muted">${ability.description || 'No description'}</p>
    <div class="card-actions">
      <button class="ghost" data-edit-ability="${ability.slug}">Edit</button>
    </div>
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

  if (effectTemplateSelect) {
    effectTemplateSelect.innerHTML = '<option value="">Select a base effect</option>';
    const sorted = [...effects].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach((effect) => {
      const opt = document.createElement('option');
      opt.value = effect.slug;
      opt.textContent = effect.name;
      effectTemplateSelect.appendChild(opt);
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
        <p class="pill">${card.slug}</p>
      </div>
      <p class="muted">Abilities: ${summarizeAbilities(cardAbilities)}</p>
    `;

    const abilityWrapper = document.createElement('div');
    abilityWrapper.className = 'ability-row';
    if (cardAbilities.length) {
      cardAbilities.forEach((ability) => abilityWrapper.appendChild(createAbilityCard(ability)));
    }
    cardEl.appendChild(abilityWrapper);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.innerHTML = `<button class="ghost" data-edit-card="${card.slug}">Edit</button>`;
    cardEl.appendChild(actions);

    catalogList.appendChild(cardEl);
  });
}

function setModeLabel(modeEl, slug) {
  if (!modeEl) return;
  modeEl.textContent = slug ? `Editing ${slug}` : 'Create';
}

toggleModifierFields(null);

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
      attackRange: Number(form.get('range')),
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
    if (effectTemplateSelect) effectTemplateSelect.selectedIndex = 0;
    effectEditingSlug = null;
    toggleModifierFields(null);
    setModeLabel(effectMode, null);
    await refreshEffects();
  }
});

if (effectTemplateSelect) {
  effectTemplateSelect.addEventListener('change', () => {
    const selected = effects.find((effect) => effect.slug === effectTemplateSelect.value);
    applyEffectTemplate(selected);
  });
}

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
  if (effectTemplateSelect) effectTemplateSelect.selectedIndex = 0;
  toggleModifierFields(null);
  setModeLabel(effectMode, null);
});

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

  if (effectTemplateSelect) {
    const match = Array.from(effectTemplateSelect.options).find((opt) => opt.value === effect.slug);
    effectTemplateSelect.value = match ? effect.slug : '';
  }
  toggleModifierFields(effect);
}

function populateAbilityForm(ability) {
  abilityEditingSlug = ability.slug;
  setModeLabel(abilityMode, ability.slug);
  addAbilityForm.slug.value = ability.slug;
  addAbilityForm.name.value = ability.name;
  addAbilityForm.min.value = ability.damage?.min ?? '';
  addAbilityForm.max.value = ability.damage?.max ?? '';
  addAbilityForm.staminaCost.value = ability.staminaCost;
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
  addCardForm.range.value = card.stats?.attackRange ?? '';
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
