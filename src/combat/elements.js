// Element application + reaction rules (original names, generic Korean terms).

export const REACTIONS = {
  vaporize: { name: '증발', color: '#ffcf6a' },
  melt: { name: '융해', color: '#ffb36a' },
  overload: { name: '과부하', color: '#ff7aa8' },
  freeze: { name: '빙결', color: '#b9f3ff' },
  charged: { name: '감전', color: '#d79bff' },
  superconduct: { name: '초전도', color: '#b9b4ff' },
  swirl: { name: '확산', color: '#7fffd8' },
  shatter: { name: '쇄빙', color: '#e8fbff' },
};

export const ELEMENT_COLORS = {
  phys: '#ffffff',
  wind: '#5fe3c0',
  fire: '#ff8a4a',
  water: '#4fc0ff',
  thunder: '#c690ff',
  ice: '#a8eeff',
};

// Returns the reaction triggered when `incoming` hits a target with `aura`.
export function resolveReaction(aura, incoming) {
  if (!incoming || incoming === 'phys') return null;
  if (incoming === 'wind') return aura && aura !== 'wind' ? { type: 'swirl', el: aura } : null;
  if (!aura || aura === incoming || aura === 'wind') return null;
  const has = (e) => aura === e || incoming === e;
  if (has('fire') && has('water')) return { type: 'vaporize', mult: incoming === 'water' ? 2 : 1.5 };
  if (has('fire') && has('ice')) return { type: 'melt', mult: incoming === 'fire' ? 2 : 1.5 };
  if (has('fire') && has('thunder')) return { type: 'overload' };
  if (has('water') && has('ice')) return { type: 'freeze' };
  if (has('water') && has('thunder')) return { type: 'charged' };
  if (has('ice') && has('thunder')) return { type: 'superconduct' };
  return null;
}
