module.exports = [
  {
    slug: 'damage-boost-turn',
    name: 'Battle Focus',
    type: 'buff',
    targetHint: 'friendly',
    description: 'Grant +1 to +3 bonus damage until the end of the turn.',
    modifiers: { damageBonus: { min: 1, max: 3 } },
    duration: 'turn',
  },
  {
    slug: 'stamina-sapped-turn',
    name: 'Fatigue',
    type: 'debuff',
    targetHint: 'enemy',
    description: 'Reduce current stamina by 1 until the end of the turn.',
    modifiers: { staminaChange: -1 },
    duration: 'turn',
  },
];
