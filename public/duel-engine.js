const DEFAULT_LIMITS = {
  maxVitality: 20,
  maxWill: 10,
  maxSoulfire: 10,
  startingSoulfire: 3,
  openingHand: 5,
};

const PHASES = ['start', 'draw', 'main', 'end'];
const ZONES = Object.freeze({
  DECK: 'deck',
  HAND: 'hand',
  DISCARD: 'discard',
  VOID: 'void',
  HEX: 'hexes',
});

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class CardInstance {
  constructor(card) {
    this.card = card;
    this.id = makeId();
    this.hauntUsed = false;
  }
}

class PlayerState {
  constructor(name, deck, library, limits = DEFAULT_LIMITS) {
    this.name = name;
    this.deck = shuffle(deck.map((slug) => new CardInstance(library.find((c) => c.slug === slug))));
    this.hand = [];
    this.discard = [];
    this.void = [];
    this.hexes = [];
    this.vitality = limits.maxVitality;
    this.will = limits.maxWill;
    this.maxSoulfire = limits.startingSoulfire;
    this.currentSoulfire = limits.startingSoulfire;
    this.pendingChannel = 0;
    this.costModifiers = { increase: 0, reduction: 0 };
    this.ward = { amount: 0, focus: null, expiresTurn: 0 };
    this.burn = [];
    this.hasReshuffled = false;
    this.drewFromDeckThisTurn = false;
    this.hasHauntedThisTurn = false;
    this.limits = limits;
  }

  resetTurnFlags(turnNumber) {
    this.ward = { amount: 0, focus: null, expiresTurn: turnNumber };
    this.pendingChannel = 0;
    this.hasHauntedThisTurn = false;
    this.costModifiers = { increase: 0, reduction: 0 };
    this.drewFromDeckThisTurn = false;
  }

  gainWard(amount, focus, turnNumber) {
    if (this.ward.amount > 0) return; // single ward per turn rule
    this.ward = { amount, focus: focus || null, expiresTurn: turnNumber };
  }

  applyWard(amount, resource) {
    if (this.ward.amount <= 0) return amount;
    if (this.ward.focus && this.ward.focus !== resource) return amount;
    const prevented = Math.min(amount, this.ward.amount);
    this.ward.amount -= prevented;
    return amount - prevented;
  }

  addBurn(amount) {
    if (amount <= 0) return;
    const existing = this.burn.find((b) => b.value === amount);
    if (existing) {
      existing.value += amount;
    } else {
      this.burn.push({ value: amount, persistent: false });
    }
  }
}

class DuelEngine {
  constructor(cardLibrary, players, limits = DEFAULT_LIMITS) {
    this.cardLibrary = cardLibrary;
    this.players = players.map((cfg) => new PlayerState(cfg.name, cfg.deck, cardLibrary, limits));
    this.turn = 1;
    this.activeIndex = 0;
    this.phase = 'start';
    this.logs = [];
    this.firstPlayerSkipDraw = true;
    this.started = false;
  }

  log(entry) {
    this.logs.unshift({ id: makeId(), entry, turn: this.turn, phase: this.phase, ts: Date.now() });
  }

  get activePlayer() {
    return this.players[this.activeIndex];
  }

  get waitingPlayer() {
    return this.players[1 - this.activeIndex];
  }

  startGame() {
    this.players.forEach((player, index) => {
      player.deck = shuffle(player.deck);
      const opening = DEFAULT_LIMITS.openingHand + (index === 1 ? 1 : 0);
      this.drawCards(player, opening);
    });
    this.started = true;
    this.turn = 1;
    this.phase = 'start';
    this.log('Game start. First player ready.');
    this.startPhase();
  }

  nextPhase() {
    const currentIndex = PHASES.indexOf(this.phase);
    if (currentIndex === -1) return;
    if (currentIndex === PHASES.length - 1) {
      this.switchPlayer();
      this.startPhase();
      return;
    }

    this.phase = PHASES[currentIndex + 1];
    if (this.phase === 'draw') this.drawPhase();
    if (this.phase === 'main') this.mainPhase();
    if (this.phase === 'end') {
      this.endPhase();
      this.switchPlayer();
      this.startPhase();
    }
  }

  switchPlayer() {
    this.activeIndex = 1 - this.activeIndex;
    this.turn += 1;
    this.phase = 'start';
  }

  startPhase() {
    this.phase = 'start';
    const player = this.activePlayer;
    player.resetTurnFlags(this.turn);
    player.maxSoulfire = Math.min(player.maxSoulfire + 1, player.limits.maxSoulfire);
    player.currentSoulfire = player.maxSoulfire;
    this.log(`${player.name} refreshes Soulfire to ${player.currentSoulfire}.`);
    player.burn = player.burn.flatMap((burnEntry) => {
      const damage = burnEntry.value;
      this.applyDamage(player, damage, 'vitality', `${burnEntry.value} Burn`);
      return burnEntry.persistent ? [burnEntry] : [];
    });
    player.hexes.forEach((hex) => {
      (hex.ongoing || []).forEach((effect) => {
        if (!effect.timing || effect.timing === 'start-of-turn') {
          this.resolveEffect(effect, {
            player: hex.controller || player,
            enemy: player,
            source: hex.card,
            context: { drain: null },
            controller: hex.controller || player,
          });
        }
      });
    });
  }

  drawPhase() {
    if (this.firstPlayerSkipDraw && this.activeIndex === 0 && this.turn === 1) {
      this.log('First player skips initial draw.');
      return;
    }
    this.drawCards(this.activePlayer, 1);
  }

  mainPhase() {
    this.phase = 'main';
  }

  endPhase() {
    const player = this.activePlayer;
    this.phase = 'end';
    this.cleanupHand(player);
    if (player.hasReshuffled && player.drewFromDeckThisTurn) {
      this.applyDamage(player, 1, 'will', 'Will loss after reshuffle');
    }
  }

  drawCards(player, count) {
    for (let i = 0; i < count; i += 1) {
      if (!player.deck.length) {
        this.reshuffle(player);
      }
      const card = player.deck.shift();
      if (card) {
        player.hand.push(card);
        player.drewFromDeckThisTurn = true;
      }
    }
    this.log(`${player.name} draws ${count} card(s).`);
  }

  reshuffle(player) {
    const recycle = [...player.discard, ...player.void, ...player.hexes];
    player.discard = [];
    player.void = [];
    player.hexes = [];
    recycle.forEach((item) => {
      if (item.card) {
        player.deck.push(new CardInstance(item.card));
      }
    });
    player.deck = shuffle(player.deck);
    player.hasReshuffled = true;
    this.log(`${player.name} reshuffles their discard, void, and hexes into a new deck.`);
  }

  cleanupHand(player) {
    if (player.hand.length <= 7) return;
    const overflow = player.hand.splice(7);
    player.discard.push(...overflow);
    this.log(`${player.name} discards ${overflow.length} down to hand size.`);
  }

  applyDamage(target, amount, resource, sourceLabel) {
    const remaining = target.applyWard(amount, resource);
    if (remaining <= 0) {
      this.log(`${target.name}'s Ward prevents the damage.`);
      return;
    }
    if (resource === 'vitality') {
      target.vitality = Math.max(0, target.vitality - remaining);
    } else {
      target.will = Math.max(0, target.will - remaining);
    }
    this.log(`${target.name} loses ${remaining} ${resource} from ${sourceLabel || 'an effect'}.`);
  }

  heal(target, amount, resource) {
    if (resource === 'vitality') {
      target.vitality = Math.min(target.limits.maxVitality, target.vitality + amount);
    } else {
      target.will = Math.min(target.limits.maxWill, target.will + amount);
    }
    this.log(`${target.name} restores ${amount} ${resource}.`);
  }

  discardAtRandom(player, amount) {
    for (let i = 0; i < amount; i += 1) {
      if (!player.hand.length) return;
      const index = Math.floor(Math.random() * player.hand.length);
      const [card] = player.hand.splice(index, 1);
      player.discard.push(card);
      this.log(`${player.name} discards ${card.card.name}.`);
    }
  }

  computeCost(player, card) {
    const base = card.cost?.soulfire ?? 0;
    const channelled = Math.max(1, base - player.pendingChannel);
    const modified = Math.max(1, channelled + player.costModifiers.increase - player.costModifiers.reduction);
    return modified;
  }

  playCard(cardId, options = {}) {
    if (this.phase !== 'main') {
      throw new Error('Cards can only be played during the Main Phase.');
    }
    const player = this.activePlayer;
    const handIndex = player.hand.findIndex((c) => c.id === cardId);
    if (handIndex === -1) throw new Error('Card not found in hand.');
    const instance = player.hand[handIndex];
    const card = instance.card;
    const enemy = this.waitingPlayer;

    const cost = this.computeCost(player, card);
    if (player.currentSoulfire < cost) throw new Error('Not enough Soulfire.');

    const ritualEffect = card.effects.find((e) => e.effectType === 'RITUAL_MODE');
    const useRitual = options.useRitual && ritualEffect;

    const ritualCost = useRitual ? ritualEffect.ritualCost : null;
    if (ritualCost && ritualCost.resource && player[ritualCost.resource] < ritualCost.amount) {
      throw new Error('Cannot pay Ritual cost.');
    }

    player.currentSoulfire -= cost;
    if (ritualCost && ritualCost.resource) {
      player[ritualCost.resource] = Math.max(0, player[ritualCost.resource] - ritualCost.amount);
    }
    const effects = useRitual && ritualEffect?.replaces?.length ? ritualEffect.replaces : card.effects;
    const context = { drain: null };
    this.log(`${player.name} casts ${card.name}${useRitual ? ' in Ritual mode' : ''}.`);

    effects.forEach((effect) => this.resolveEffect(effect, { player, enemy, source: card, context, controller: player }));

    player.pendingChannel = 0;
    player.hand.splice(handIndex, 1);
    player.discard.push(instance);
  }

  activateHaunt(instanceId) {
    const player = this.activePlayer;
    if (player.hasHauntedThisTurn) throw new Error('You already used Haunt this turn.');
    const index = player.void.findIndex((c) => c.id === instanceId && c.card.effects.some((e) => e.effectType === 'HAUNT'));
    if (index === -1) throw new Error('No Haunt available for that card.');
    const instance = player.void[index];
    const hauntEffect = instance.card.effects.find((e) => e.effectType === 'HAUNT');
    player.void.splice(index, 1);
    player.hasHauntedThisTurn = true;
    this.log(`${player.name} haunts with ${instance.card.name} from the Void.`);
    if (hauntEffect?.effect) {
      this.resolveEffect(hauntEffect.effect, {
        player,
        enemy: this.waitingPlayer,
        source: instance.card,
        context: { drain: null },
        controller: player,
      });
    }
  }

  resolveEffect(effect, { player, enemy, source, context, controller }) {
    switch (effect.effectType) {
      case 'DAMAGE': {
        const target = this.pickTarget(effect.target, player, enemy, controller);
        if (!target) return;
        this.applyDamage(target, effect.amount, effect.resource, source.name);
        if (context.drain && effect.resource === 'vitality') {
          this.heal(controller, context.drain.amount, context.drain.resource || 'vitality');
          context.drain = null;
        }
        break;
      }
      case 'COST_PAYMENT': {
        const target = this.pickTarget(effect.target, player, enemy, controller);
        if (!target) return;
        target[effect.resource] = Math.max(0, target[effect.resource] - effect.amount);
        this.log(`${target.name} pays ${effect.amount} ${effect.resource}.`);
        break;
      }
      case 'DRAIN': {
        context.drain = { amount: effect.amount, resource: effect.resource };
        break;
      }
      case 'CHANNEL': {
        player.pendingChannel = Math.max(player.pendingChannel, effect.amount);
        this.log(`${player.name} gains Channel ${effect.amount}.`);
        break;
      }
      case 'BURN': {
        const target = this.pickTarget(effect.target, player, enemy, controller);
        target?.addBurn(effect.amount);
        this.log(`${target?.name} gains Burn ${effect.amount}.`);
        break;
      }
      case 'WARD': {
        const target = this.pickTarget(effect.target, player, enemy, controller);
        target?.gainWard(effect.amount, effect.resourceFocus, this.turn);
        this.log(`${target?.name} gains Ward ${effect.amount}.`);
        break;
      }
      case 'DRAW': {
        const target = this.pickTarget(effect.target, player, enemy, controller) || player;
        this.drawCards(target, effect.amount);
        break;
      }
      case 'DISCARD': {
        const target = this.pickTarget(effect.target, player, enemy, controller) || enemy;
        this.discardAtRandom(target, effect.amount);
        break;
      }
      case 'INSIGHT': {
        const lookCount = Math.min(effect.amount, player.deck.length);
        const peek = player.deck.slice(0, lookCount).map((c) => c.card.name).join(', ');
        this.log(`${player.name} uses Insight ${effect.amount}: ${peek || 'no cards to see'}.`);
        break;
      }
      case 'RETURN_FROM_VOID': {
        const target = this.pickTarget(effect.target, player, enemy, controller) || player;
        const index = target.void.findIndex((c) => c.card.slug === effect.slug);
        if (index >= 0) {
          target.deck.unshift(target.void.splice(index, 1)[0]);
          this.log(`${target.name} returns ${effect.slug} from the Void to the deck.`);
        }
        break;
      }
      case 'ATTACH_HEX': {
        const target = this.pickTarget(effect.target, player, enemy, controller);
        if (target) {
          target.hexes.push({ id: makeId(), card: source, ongoing: effect.ongoing || [], controller });
          this.log(`${source.name} attaches as a Hex to ${target.name}.`);
        }
        break;
      }
      case 'DISPEL': {
        const target = this.pickTarget(effect.target, player, enemy, controller);
        if (target) {
          const removed = target.hexes.splice(0, effect.amount || target.hexes.length);
          target.discard.push(...removed.map((h) => new CardInstance(h.card)));
          this.log(`${target.name} has ${removed.length} Hex(es) dispelled.`);
        }
        break;
      }
      case 'COST_INCREASE': {
        controller.costModifiers.increase += effect.amount;
        break;
      }
      case 'COST_REDUCTION': {
        controller.costModifiers.reduction += effect.amount;
        break;
      }
      case 'CONDITIONAL': {
        const conditionMet = this.evaluateCondition(effect.condition, player, enemy, controller);
        if (conditionMet && Array.isArray(effect.then)) {
          effect.then.forEach((nested) => this.resolveEffect(nested, { player, enemy, source, context, controller }));
        }
        break;
      }
      default:
        this.log(`Unhandled effect type: ${effect.effectType}`);
    }
  }

  evaluateCondition(condition, player, enemy, controller) {
    if (!condition) return false;
    if (condition.thresholdResource) {
      const target = this.pickTarget(condition.target, player, enemy, controller);
      const value = target?.[condition.thresholdResource] ?? 0;
      if (condition.comparison === 'or-less') return value <= condition.threshold;
      if (condition.comparison === 'or-more') return value >= condition.threshold;
    }
    if (condition.effectType === 'WARD') {
      const target = this.pickTarget(condition.target, player, enemy, controller);
      return (target?.ward?.amount || 0) > 0;
    }
    return false;
  }

  pickTarget(label, player, enemy, controller) {
    switch (label) {
      case 'self':
      case 'controller':
      case 'hex-controller':
        return controller;
      case 'any-wizard':
      case 'any-target':
      case 'enemy-wizard':
        return enemy;
      case 'attached-wizard':
        return enemy;
      default:
        return player;
    }
  }
}

window.DuelEngine = DuelEngine;
window.DUEL_CONSTANTS = { PHASES, ZONES, DEFAULT_LIMITS };
