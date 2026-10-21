// Small inline SVG icon set (original artwork).
export function elementIcon(kind, color = 'currentColor', size = 24) {
  const s = `width="${size}" height="${size}" viewBox="0 0 24 24"`;
  switch (kind) {
    case 'wind':
      return `<svg ${s} fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"><path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M5 16.5h6"/></svg>`;
    case 'fire':
      return `<svg ${s} fill="${color}"><path d="M12.5 2c.8 3.6 5.5 5.6 5.5 11a6 6 0 0 1-12 0c0-3.2 1.8-4.8 2.6-7.4.9 1.4 1.8 2.4 3 3.1C12.2 6.6 12.6 4.6 12.5 2z"/><path d="M12 13.5c.4 1.5 2.4 2.2 2.4 4.1a2.4 2.4 0 0 1-4.8 0c0-1.4 1.6-2.4 2.4-4.1z" fill="#fff" opacity=".55"/></svg>`;
    case 'water':
      return `<svg ${s} fill="${color}"><path d="M12 2.5C9 7.3 5.8 10.4 5.8 14.6a6.2 6.2 0 0 0 12.4 0c0-4.2-3.2-7.3-6.2-12.1z"/><path d="M9 15a3 3 0 0 0 3 3" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7" stroke-linecap="round"/></svg>`;
    case 'thunder':
      return `<svg ${s} fill="${color}"><path d="M13.5 2 4.5 13.6h6.3L9.6 22l9.6-12.4h-6.6z"/></svg>`;
    case 'ice':
      return `<svg ${s} fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17"/><path d="m9.5 3.8 2.5 2 2.5-2M9.5 20.2l2.5-2 2.5 2"/></svg>`;
    case 'sword':
      return `<svg ${s} fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><path d="M14.5 3.5 20.5 3.5 20.5 9.5 9 21"/><path d="m4 15 5 5M6.5 17.5 3 21"/></svg>`;
    case 'star':
      return `<svg ${s} fill="${color}"><path d="m12 2 2.6 6.6L21.5 9l-5.3 4.5L18 20.5 12 16.8 6 20.5l1.8-7L2.5 9l6.9-.4z"/></svg>`;
    case 'clock':
      return `<svg ${s} fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
    case 'gem':
      return `<svg ${s} fill="${color}"><path d="M7 3h10l4 6-9 12L3 9z" opacity=".95"/><path d="M3 9h18M12 21 9 9l3-6 3 6z" stroke="#fff" stroke-width="1" fill="none" opacity=".6"/></svg>`;
    default:
      return '';
  }
}
