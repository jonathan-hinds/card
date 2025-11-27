const Schools = Object.freeze({
  BLOOD: 'Blood',
  SHADOW: 'Shadow',
  FLAME: 'Flame',
  GRAVE: 'Grave',
  HEX: 'Hex',
});

const CardType = Object.freeze({
  ATTACK: 'Attack Spell',
  HEX: 'Hex',
  RITUAL: 'Ritual',
});

const ResourceType = Object.freeze({
  VITALITY: 'vitality',
  WILL: 'will',
  SOULFIRE: 'soulfire',
});

const Target = Object.freeze({
  SELF: 'self',
  ANY_WIZARD: 'any-wizard',
  ANY_TARGET: 'any-target',
  ENEMY_WIZARD: 'enemy-wizard',
  CONTROLLER: 'controller',
  HEX_CONTROLLER: 'hex-controller',
  ATTACHED_WIZARD: 'attached-wizard',
});

const EffectType = Object.freeze({
  DAMAGE: 'DAMAGE',
  COST_PAYMENT: 'COST_PAYMENT',
  DRAIN: 'DRAIN',
  CHANNEL: 'CHANNEL',
  BURN: 'BURN',
  WARD: 'WARD',
  DRAW: 'DRAW',
  DISCARD: 'DISCARD',
  RITUAL_MODE: 'RITUAL_MODE',
  HAUNT: 'HAUNT',
  INSIGHT: 'INSIGHT',
  RETURN_FROM_VOID: 'RETURN_FROM_VOID',
  ATTACH_HEX: 'ATTACH_HEX',
  DISPEL: 'DISPEL',
  COST_INCREASE: 'COST_INCREASE',
  COST_REDUCTION: 'COST_REDUCTION',
  STATUS_TRIGGER: 'STATUS_TRIGGER',
  CONDITIONAL: 'CONDITIONAL',
});

const DamageTiming = Object.freeze({
  START_OF_TURN: 'start-of-turn',
  RESOLUTION: 'resolution',
});

const cards = [
  {
    slug: 'bloodlash',
    name: 'Bloodlash',
    school: Schools.BLOOD,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 3, resource: ResourceType.VITALITY, target: Target.ANY_WIZARD },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.VITALITY, target: Target.CONTROLLER },
      { effectType: EffectType.DRAIN, amount: 1, resource: ResourceType.VITALITY },
    ],
    rulesText: 'Deal 3 damage to any wizard. You lose 1 Vitality. DRAIN 1.',
    role: 'Cheap, efficient burn that lets Blood decks spend their own life as a resource and then patch it up.',
  },
  {
    slug: 'sanguine-bargain',
    name: 'Sanguine Bargain',
    school: Schools.BLOOD,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.COST_PAYMENT, amount: 2, resource: ResourceType.VITALITY, target: Target.CONTROLLER },
      { effectType: EffectType.CHANNEL, amount: 2 },
      { effectType: EffectType.DRAW, amount: 1 },
    ],
    rulesText: 'Lose 2 Vitality. CHANNEL 2. Draw 1 card.',
    role: 'Classic pay-life-to-accelerate spell that powers big turns at a cost.',
  },
  {
    slug: 'blood-ward',
    name: 'Blood Ward',
    school: Schools.BLOOD,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      {
        effectType: EffectType.WARD,
        amount: 3,
        target: Target.ANY_WIZARD,
        resourceFocus: ResourceType.VITALITY,
      },
      {
        effectType: EffectType.CONDITIONAL,
        condition: { effectType: EffectType.WARD, target: Target.CONTROLLER },
        then: [{ effectType: EffectType.DRAIN, amount: 1, resource: ResourceType.VITALITY }],
      },
    ],
    rulesText:
      'Choose a wizard. Until end of turn, that wizard has WARD 3. If you chose yourself, DRAIN 1 the next time WARD prevents damage this turn.',
    role: 'Flexible defensive trick that rewards self-targeting with a small heal.',
  },
  {
    slug: 'crimson-rite',
    name: 'Crimson Rite',
    school: Schools.BLOOD,
    cardType: CardType.RITUAL,
    cost: { soulfire: 3 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 3, resource: ResourceType.VITALITY, target: Target.ANY_TARGET },
      {
        effectType: EffectType.RITUAL_MODE,
        ritualCost: { resource: ResourceType.VITALITY, amount: 3 },
        replaces: [
          { effectType: EffectType.DAMAGE, amount: 5, resource: ResourceType.VITALITY, target: Target.ANY_TARGET },
          { effectType: EffectType.DRAIN, amount: 2, resource: ResourceType.VITALITY },
        ],
      },
    ],
    rulesText:
      'Deal 3 damage to any target. RITUAL — Lose 3 Vitality: If you pay the Ritual cost, instead deal 5 damage to any target and this spell has DRAIN 2.',
    role: 'Mid-game finisher; you choose when to pay life for a bigger swing and heal-back.',
  },
  {
    slug: 'mind-fracture',
    name: 'Mind Fracture',
    school: Schools.SHADOW,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.WILL, target: Target.ANY_WIZARD },
      {
        effectType: EffectType.CONDITIONAL,
        condition: { thresholdResource: ResourceType.WILL, threshold: 5, comparison: 'or-less', target: Target.ENEMY_WIZARD },
        then: [{ effectType: EffectType.DISCARD, amount: 1, target: Target.ENEMY_WIZARD }],
      },
    ],
    rulesText: 'Target wizard loses 2 Will. TORMENT — If they have 5 or less Will after this resolves, they also discard 1 card.',
    role: 'Core Will-pressure spell that escalates when the opponent is low.',
  },
  {
    slug: 'whispered-secrets',
    name: 'Whispered Secrets',
    school: Schools.SHADOW,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.INSIGHT, amount: 3 },
      { effectType: EffectType.DRAW, amount: 1 },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.WILL, target: Target.CONTROLLER },
    ],
    rulesText: 'INSIGHT 3. Then draw 1 card and lose 1 Will.',
    role: 'Shadow-flavored card quality; you trade sanity for smooth draws.',
  },
  {
    slug: 'lingering-fear',
    name: 'Lingering Fear',
    school: Schools.SHADOW,
    cardType: CardType.HEX,
    cost: { soulfire: 3 },
    effects: [
      {
        effectType: EffectType.ATTACH_HEX,
        target: Target.ENEMY_WIZARD,
        ongoing: [
          {
            effectType: EffectType.DAMAGE,
            amount: 1,
            resource: ResourceType.WILL,
            target: Target.ATTACHED_WIZARD,
            timing: DamageTiming.START_OF_TURN,
          },
        ],
      },
      {
        effectType: EffectType.HAUNT,
        effect: { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ANY_WIZARD },
      },
    ],
    rulesText: 'Attach to an enemy wizard. At the start of that wizard’s turn, they lose 1 Will. HAUNT — Exile from your Void: target wizard loses 1 Will.',
    role: 'Slow Will damage that still bites from the Void via Haunt.',
  },
  {
    slug: 'dark-channeling',
    name: 'Dark Channeling',
    school: Schools.SHADOW,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.WILL, target: Target.CONTROLLER },
      { effectType: EffectType.CHANNEL, amount: 2 },
      {
        effectType: EffectType.CONDITIONAL,
        condition: { thresholdResource: ResourceType.WILL, threshold: 5, comparison: 'or-less', target: Target.CONTROLLER },
        then: [{ effectType: EffectType.CHANNEL, amount: 3 }],
      },
    ],
    rulesText:
      'Lose 1 Will. CHANNEL 2. TORMENT — If you have 5 or less Will after this resolves, the next spell you cast this turn instead costs 3 less Soulfire (to a minimum of 1).',
    role: 'Shadow’s all-in power spike fueled by your dwindling sanity.',
  },
  {
    slug: 'scorch',
    name: 'Scorch',
    school: Schools.FLAME,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.VITALITY, target: Target.ANY_TARGET },
      { effectType: EffectType.BURN, amount: 1, target: Target.ANY_WIZARD },
    ],
    rulesText: 'Deal 2 damage to any target. BURN 1 if you targeted a wizard.',
    role: 'Efficient burn that leaves a delayed sting.',
  },
  {
    slug: 'wildfire-surge',
    name: 'Wildfire Surge',
    school: Schools.FLAME,
    cardType: CardType.ATTACK,
    cost: { soulfire: 3 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 3, resource: ResourceType.VITALITY, target: Target.ENEMY_WIZARD },
      { effectType: EffectType.BURN, amount: 2, target: Target.ENEMY_WIZARD },
      { effectType: EffectType.CHANNEL, amount: 1 },
    ],
    rulesText: 'Deal 3 damage to target wizard. BURN 2. CHANNEL 1.',
    role: 'Aggro curve-topper pushing face damage and chaining another spell.',
  },
  {
    slug: 'overload-pyre',
    name: 'Overload Pyre',
    school: Schools.FLAME,
    cardType: CardType.RITUAL,
    cost: { soulfire: 4 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 4, resource: ResourceType.VITALITY, target: Target.ENEMY_WIZARD },
      {
        effectType: EffectType.RITUAL_MODE,
        ritualCost: { discard: 1 },
        replaces: [
          { effectType: EffectType.DAMAGE, amount: 4, resource: ResourceType.VITALITY, target: Target.ENEMY_WIZARD },
          { effectType: EffectType.BURN, amount: 3, target: Target.ENEMY_WIZARD },
        ],
      },
    ],
    rulesText: 'Deal 4 damage to target wizard. RITUAL — Discard 1 card: If paid, deal 4 damage and BURN 3 them instead.',
    role: 'Heavy closer that trades a card for a lethal burn clock.',
  },
  {
    slug: 'blazing-focus',
    name: 'Blazing Focus',
    school: Schools.FLAME,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.INSIGHT, amount: 2 },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.VITALITY, target: Target.CONTROLLER },
    ],
    rulesText: 'INSIGHT 2. Then deal 1 damage to yourself.',
    role: 'Lets aggressive decks dig for key burn pieces at a tiny self-hit.',
  },
  {
    slug: 'grave-echo',
    name: 'Grave Echo',
    school: Schools.GRAVE,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ANY_WIZARD },
      { effectType: EffectType.HAUNT, effect: { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ANY_WIZARD } },
    ],
    rulesText: 'Target wizard loses 1 Will. HAUNT — Exile from your Void: target wizard loses 1 Will.',
    role: 'Simple Will ping that hits twice with Haunt.',
  },
  {
    slug: 'unearthed-secrets',
    name: 'Unearthed Secrets',
    school: Schools.GRAVE,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.INSIGHT, amount: 3 },
      { effectType: EffectType.RETURN_FROM_VOID, amount: 1, cardTypes: [CardType.ATTACK, CardType.RITUAL] },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.WILL, target: Target.CONTROLLER },
    ],
    rulesText: 'INSIGHT 3. You may return up to 1 spell from your Void to your hand. Then lose 1 Will.',
    role: 'Grave glue card; fixes draws and turns your Void into a resource.',
  },
  {
    slug: 'ghastly-drain',
    name: 'Ghastly Drain',
    school: Schools.GRAVE,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.VITALITY, target: Target.ANY_WIZARD },
      { effectType: EffectType.DRAIN, amount: 1, resource: ResourceType.VITALITY },
      {
        effectType: EffectType.CONDITIONAL,
        condition: { voidSizeAtLeast: 3, target: Target.ENEMY_WIZARD },
        then: [{ effectType: EffectType.DRAIN, amount: 2, resource: ResourceType.VITALITY }],
      },
    ],
    rulesText: 'Target wizard loses 2 Vitality. DRAIN 1. If that wizard has 3 or more cards in their Void, DRAIN 2 instead.',
    role: 'Synergizes with long games and self-mill; scales as Voids grow.',
  },
  {
    slug: 'funeral-rite',
    name: 'Funeral Rite',
    school: Schools.GRAVE,
    cardType: CardType.RITUAL,
    cost: { soulfire: 3 },
    effects: [
      { effectType: EffectType.DISCARD, amount: 1, target: Target.ANY_WIZARD },
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ANY_WIZARD },
      {
        effectType: EffectType.RITUAL_MODE,
        ritualCost: { exileFromVoid: 1 },
        replaces: [
          { effectType: EffectType.DISCARD, amount: 1, target: Target.ENEMY_WIZARD },
          { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.WILL, target: Target.ENEMY_WIZARD },
        ],
        additional: [{ effectType: EffectType.COST_PAYMENT, amount: 0, resource: ResourceType.WILL }],
      },
    ],
    rulesText:
      'Each player discards 1 card, then loses 1 Will. RITUAL — Exile 1 card from your Void: If paid, instead your opponent discards 1 card and loses 2 Will, and you lose no Will.',
    role: 'Control piece that weaponizes your stocked Void for a big Will hit.',
  },
  {
    slug: 'chains-of-obligation',
    name: 'Chains of Obligation',
    school: Schools.HEX,
    cardType: CardType.HEX,
    cost: { soulfire: 2 },
    effects: [
      {
        effectType: EffectType.ATTACH_HEX,
        target: Target.ENEMY_WIZARD,
        ongoing: [
          {
            effectType: EffectType.COST_INCREASE,
            target: Target.ATTACHED_WIZARD,
            amount: 1,
            scope: 'first-spell-each-turn',
            resource: ResourceType.SOULFIRE,
          },
          {
            effectType: EffectType.CONDITIONAL,
            condition: { thresholdResource: ResourceType.WILL, threshold: 5, comparison: 'or-less', target: Target.ATTACHED_WIZARD },
            then: [
              {
                effectType: EffectType.COST_INCREASE,
                target: Target.ATTACHED_WIZARD,
                amount: 2,
                scope: 'first-spell-each-turn',
                resource: ResourceType.SOULFIRE,
              },
            ],
          },
        ],
      },
    ],
    rulesText:
      'Attach to an enemy wizard. The first spell that wizard casts each turn costs 1 additional Soulfire. TORMENT — If that wizard has 5 or less Will when this triggers, that spell instead costs 2 additional Soulfire.',
    role: 'Tempo tax that tightens against low-Will foes.',
  },
  {
    slug: 'misfortune-mark',
    name: 'Misfortune Mark',
    school: Schools.HEX,
    cardType: CardType.HEX,
    cost: { soulfire: 2 },
    effects: [
      {
        effectType: EffectType.ATTACH_HEX,
        target: Target.ANY_WIZARD,
        ongoing: [
          {
            effectType: EffectType.STATUS_TRIGGER,
            status: EffectType.BURN,
            reaction: { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ATTACHED_WIZARD },
          },
        ],
      },
      { effectType: EffectType.HAUNT, effect: { effectType: EffectType.BURN, amount: 1, target: Target.ANY_WIZARD } },
    ],
    rulesText:
      'Attach to a wizard. Whenever that wizard takes BURN damage, they also lose 1 Will. HAUNT — Exile from your Void: give target wizard BURN 1.',
    role: 'Links Burn to Will pressure and splashes delayed Burn from the Void.',
  },
  {
    slug: 'cursed-insight',
    name: 'Cursed Insight',
    school: Schools.HEX,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.INSIGHT, amount: 2 },
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.CONTROLLER },
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ENEMY_WIZARD },
    ],
    rulesText: 'INSIGHT 2. Each wizard loses 1 Will.',
    role: 'Symmetrical sanity tax that control decks can exploit.',
  },
  {
    slug: 'hexbound-ward',
    name: 'Hexbound Ward',
    school: Schools.HEX,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      {
        effectType: EffectType.WARD,
        amount: 3,
        target: Target.ANY_WIZARD,
        resourceFocus: ResourceType.VITALITY,
      },
      {
        effectType: EffectType.CONDITIONAL,
        condition: { thresholdResource: ResourceType.WILL, threshold: 5, comparison: 'or-less', target: Target.ANY_WIZARD },
        then: [
          {
            effectType: EffectType.WARD,
            amount: 1,
            target: Target.ANY_WIZARD,
            resourceFocus: ResourceType.WILL,
          },
        ],
      },
    ],
    rulesText:
      'Choose a wizard. That wizard gains WARD 3 against Vitality damage until end of turn. TORMENT — If that wizard has 5 or less Will, they also gain WARD 1 against Will loss until end of turn.',
    role: 'Defensive curse that can protect either player and shine when Will is low.',
  },
  {
    slug: 'crimson-cut',
    name: 'Crimson Cut',
    school: Schools.BLOOD,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.VITALITY, target: Target.ANY_WIZARD },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.VITALITY, target: Target.CONTROLLER },
    ],
    rulesText: 'Deal 2 damage to any wizard. You lose 1 Vitality.',
    role: 'Efficient early chip damage that nudges your own life down for synergy.',
  },
  {
    slug: 'blood-tithe',
    name: 'Blood Tithe',
    school: Schools.BLOOD,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.VITALITY, target: Target.ANY_WIZARD },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.VITALITY, target: Target.CONTROLLER },
      { effectType: EffectType.DRAIN, amount: 2, resource: ResourceType.VITALITY },
    ],
    rulesText: 'Deal 2 damage to any wizard. You lose 1 Vitality. DRAIN 2.',
    role: 'Reliable swing for Blood decks to hurt foes and patch up.',
  },
  {
    slug: 'veil-severance',
    name: 'Veil Severance',
    school: Schools.SHADOW,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DISPEL, amount: 2, target: Target.ANY_WIZARD },
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.HEX_CONTROLLER },
    ],
    rulesText: 'Dispel up to 2 Hexes attached to any wizards. For each Hex dispelled this way, its controller loses 1 Will.',
    role: 'Surgical anti-curse tool that shreds sanity of those relying on Hexes.',
  },
  {
    slug: 'night-whisper',
    name: 'Night Whisper',
    school: Schools.SHADOW,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.DISCARD, amount: 1, target: Target.ENEMY_WIZARD },
      { effectType: EffectType.COST_PAYMENT, amount: 1, resource: ResourceType.WILL, target: Target.CONTROLLER },
    ],
    rulesText: 'Target wizard discards 1 card. You lose 1 Will.',
    role: 'Ultra-clean discard spell that synergizes with Shadow’s low-Will themes.',
  },
  {
    slug: 'firebolt',
    name: 'Firebolt',
    school: Schools.FLAME,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [{ effectType: EffectType.DAMAGE, amount: 3, resource: ResourceType.VITALITY, target: Target.ANY_TARGET }],
    rulesText: 'Deal 3 damage to any target.',
    role: 'Straightforward burn that fits cleanly anywhere on the curve.',
  },
  {
    slug: 'purging-flame',
    name: 'Purging Flame',
    school: Schools.FLAME,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DISPEL, amount: 1, target: Target.ANY_WIZARD },
      { effectType: EffectType.DAMAGE, amount: 2, resource: ResourceType.VITALITY, target: Target.HEX_CONTROLLER },
    ],
    rulesText: 'Dispel target Hex. Then deal 2 damage to that Hex’s controller.',
    role: 'Aggressive answer to curses that turns cleansing into direct damage.',
  },
  {
    slug: 'grave-purge',
    name: 'Grave Purge',
    school: Schools.GRAVE,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.DISPEL, amount: 1, target: Target.ANY_WIZARD },
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.HEX_CONTROLLER },
    ],
    rulesText: 'Dispel target Hex. Its controller loses 1 Will.',
    role: 'Lean Grave answer to Hexes that nudges the Will race.',
  },
  {
    slug: 'bone-chill',
    name: 'Bone Chill',
    school: Schools.GRAVE,
    cardType: CardType.ATTACK,
    cost: { soulfire: 1 },
    effects: [
      { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ANY_WIZARD },
      {
        effectType: EffectType.CONDITIONAL,
        condition: { voidSizeAtLeast: 3, target: Target.ANY_WIZARD },
        then: [{ effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ANY_WIZARD }],
      },
    ],
    rulesText: 'Target wizard loses 1 Will. If that wizard has 3 or more cards in their Void, they lose 1 additional Will.',
    role: 'Will poke that scales with game length and Void activity.',
  },
  {
    slug: 'hexbreak-edict',
    name: 'Hexbreak Edict',
    school: Schools.HEX,
    cardType: CardType.ATTACK,
    cost: { soulfire: 2 },
    effects: [
      { effectType: EffectType.DISPEL, amount: 2, target: Target.ANY_WIZARD },
      {
        effectType: EffectType.WARD,
        amount: 2,
        target: Target.ANY_WIZARD,
      },
    ],
    rulesText: 'Choose a wizard. Dispel up to 2 Hexes attached to that wizard. That wizard gains WARD 2 until end of turn.',
    role: 'Flexible protection and reset button, often cast on yourself.',
  },
  {
    slug: 'hex-of-weariness',
    name: 'Hex of Weariness',
    school: Schools.HEX,
    cardType: CardType.HEX,
    cost: { soulfire: 1 },
    effects: [
      {
        effectType: EffectType.ATTACH_HEX,
        target: Target.ENEMY_WIZARD,
        ongoing: [
          {
            effectType: EffectType.STATUS_TRIGGER,
            status: 'no-spell-cast',
            reaction: { effectType: EffectType.DAMAGE, amount: 1, resource: ResourceType.WILL, target: Target.ATTACHED_WIZARD },
            timing: 'end-of-turn',
          },
        ],
      },
    ],
    rulesText: 'Attach to an enemy wizard. At the end of that wizard’s turn, if they did not cast a spell this turn, they lose 1 Will.',
    role: 'Tax on passivity that pressures opponents for banking resources.',
  },
];

module.exports = {
  Schools,
  CardType,
  ResourceType,
  Target,
  EffectType,
  DamageTiming,
  cards,
};
