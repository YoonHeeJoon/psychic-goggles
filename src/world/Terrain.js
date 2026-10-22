import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp } from '../core/noise.js';
import {
  terrainUniforms,
  makeLitShader,
  VERT_HEAD,
  FRAG_HEAD,
  FRAG_TAIL,
  NOISE_GLSL,
  LIGHT_GLSL,
} from '../render/shaders.js';

export const WORLD_SIZE = 1024;
export const HALF = WORLD_SIZE / 2;
export const RES = 513;
export const CELL = WORLD_SIZE / (RES - 1);
export const SEA_LEVEL = 0;
export const SPAWN = { x: -30, z: 70 };

// Landmark anchors other systems use (statue, giant tree, lake...)
export const LANDMARKS = {
  lake: { x: 125, z: 105, r: 62 },
  mountain: { x: 30, z: -300 },
  // frozen ledge east of the summit where the frost giant sleeps
  summit: { x: 52, z: -296, r: 21, h: 166 },
  giantTree: { x: -150, z: -40 },
  statue: { x: 40, z: -10 },
  village: { x: -185, z: 185, r: 46, h: 19 },
  ruins: { x: -265, z: -95, r: 34, h: 17.5 },
  arena: { x: 368, z: -45, r: 30, h: 20 },
  domain: { x: -80, z: -90, r: 12, h: 19 },
};

// ---- the autumn highlands (south-east): a maple plateau east of a river
// gorge, crossed by a long rope bridge, with a terraced harbour town on the
// coast below it and goblin camps on top.
export const HIGHLAND = { x: 222, z: 236, r: 92, h: 28 };
export const GORGE = [
  [170, 120],
  [156, 182],
  [146, 238],
  [150, 292],
  [161, 342],
  [170, 398],
];
export const BRIDGE = { ax: 119, az: 236, bx: 172, bz: 240 };
export const PORT = { tx: 228, tz: 262, px: 266, pz: 310, hTop: 24, hLow: 3.2 };
const PU = (() => {
  const dx = PORT.px - PORT.tx,
    dz = PORT.pz - PORT.tz,
    L = Math.hypot(dx, dz);
  return { ux: dx / L, uz: dz / L, L };
})();
// harbour-street coordinates: s runs down the street, t across it
export function portLocal(x, z) {
  const dx = x - PORT.tx,
    dz = z - PORT.tz;
  return { s: dx * PU.ux + dz * PU.uz, t: -dx * PU.uz + dz * PU.ux };
}
export function portWorld(s, t) {
  return [PORT.tx + PU.ux * s - PU.uz * t, PORT.tz + PU.uz * s + PU.ux * t];
}
export const PORT_LEN = PU.L;
export const PORT_DIR = Math.atan2(PU.ux, PU.uz); // yaw looking down the street
export function townHeight(s) {
  return lerp(PORT.hTop, PORT.hLow, clamp(s / PU.L, 0, 1));
}
// house lots either side of the street, each on its own levelled pad
export const PORT_LOTS = (() => {
  const out = [];
  for (let k = 0; k < 4; k++)
    for (const side of [-1, 1]) {
      const s = 9 + k * 12 + (side > 0 ? 3 : 0);
      const t = side * (k === 3 ? 12.5 : 11);
      const [x, z] = portWorld(s, t);
      // face the street (door side is the house's local +z)
      const rot = Math.atan2(side * PU.uz, -side * PU.ux);
      out.push({ x, z, s, t, side, rot, w: 7 + ((k + (side > 0 ? 1 : 0)) % 2) * 1.2, d: 5.8, h: townHeight(s), floors: k % 2 === 0 ? 2 : 1 });
    }
  return out;
})();
export const CAMPS = [
  { id: 'campA', name: '감시탑 야영지', x: 206, z: 192 },
  { id: 'campB', name: '붉은 단풍 야영지', x: 270, z: 222 },
];

function gorgeDistance(x, z) {
  let best = 1e9;
  for (let k = 0; k < GORGE.length - 1; k++) {
    const [ax, az] = GORGE[k];
    const [bx, bz] = GORGE[k + 1];
    const dx = bx - ax,
      dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

// The challenge domain is a floating platform far out over the northern sea.
export const DOMAIN_REALM = { x: 0, z: -1350, y: 140, r: 19 };

const C = (hex) => new THREE.Color(hex);
const PAL = {
  lush: C('#5c9b3d'),
  yellow: C('#93ae4a'),
  deep: C('#3f8137'),
  forest: C('#386d31'),
  alpine: C('#7a9258'),
  sand: C('#e6d6a6'),
  wetSand: C('#b8a57a'),
  seabed: C('#93a07a'),
  dirt: C('#b39462'),
};
// autumn highlands palette
const AUT = {
  gold: C('#c7a23e'),
  orange: C('#c97a30'),
  red: C('#a9462c'),
  floor: C('#86522c'),
  moss: C('#8f9a3e'),
};

export class Terrain {
  constructor(seed = 1337) {
    this.noise = new Simplex(seed);
    this.n2 = new Simplex(seed * 7 + 3);
    this.heights = new Float32Array(RES * RES);
    this.normals = new Float32Array(RES * RES * 3);
    this.colors = new Float32Array(RES * RES * 3);
    this.grass = new Float32Array(RES * RES);
    this.forest = new Float32Array(RES * RES);
    this.autumn = new Float32Array(RES * RES);
    this.paths = [];
    this.blockers = [];
  }

  // ---- structure footprints ------------------------------------------------
  // Circles where vegetation must not grow (buildings, waypoints, chests...).
  addBlocker(x, z, r) {
    this.blockers.push({ x, z, r });
  }
  blocked(x, z, pad = 0) {
    for (const b of this.blockers) {
      const dx = x - b.x,
        dz = z - b.z;
      const r = b.r + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  // Paint ground under structures: areas are circles {x,z,r,soft} or rotated
  // rects {x,z,hw,hd,rot,soft}; each can tint the colour and thin the grass.
  paintAreas(areas) {
    const tint = new THREE.Color();
    for (const a of areas) {
      const ext = (a.r ?? Math.hypot(a.hw, a.hd)) + (a.soft ?? 1);
      const i0 = Math.max(0, Math.floor((a.x - ext + HALF) / CELL)),
        i1 = Math.min(RES - 1, Math.ceil((a.x + ext + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((a.z - ext + HALF) / CELL)),
        j1 = Math.min(RES - 1, Math.ceil((a.z + ext + HALF) / CELL));
      if (a.color) tint.set(a.color);
      const cs = Math.cos(a.rot || 0),
        sn = Math.sin(a.rot || 0);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * CELL - a.x,
            z = -HALF + j * CELL - a.z;
          let d;
          if (a.r !== undefined) d = Math.hypot(x, z) - a.r;
          else {
            const lx = Math.abs(x * cs - z * sn) - a.hw,
              lz = Math.abs(x * sn + z * cs) - a.hd;
            d = Math.max(lx, lz);
          }
          const k = smoothstep(a.soft ?? 1, 0, d) * (a.amount ?? 1);
          if (k <= 0) continue;
          const idx = j * RES + i;
          if (a.grass !== undefined) this.grass[idx] = lerp(this.grass[idx], this.grass[idx] * a.grass, k);
          if (a.color) {
            const n = this.n2.noise2(x * 0.3 + a.x, z * 0.3 + a.z) * 0.08;
            this.colors[idx * 3] = lerp(this.colors[idx * 3], tint.r * (1 + n), k);
            this.colors[idx * 3 + 1] = lerp(this.colors[idx * 3 + 1], tint.g * (1 + n), k);
            this.colors[idx * 3 + 2] = lerp(this.colors[idx * 3 + 2], tint.b * (1 + n), k);
          }
        }
    }
    this.buildTextures();
  }

  // ---- generation -------------------------------------------------------
  rawHeight(x, z) {
    const N = this.noise;
    const wx = x + 38 * N.noise2(x * 0.0031, z * 0.0031);
    const wz = z + 38 * N.noise2(x * 0.0031 + 17.3, z * 0.0031 - 8.1);

    // island silhouette
    const r = Math.hypot(wx, wz * 1.06) / 460;
    const coast = N.fbm(wx * 0.0045 + 50, wz * 0.0045, 3) * 0.22;
    const island = smoothstep(1.04, 0.8, r + coast);

    // rolling hills
    let h = 10 + N.fbm(wx * 0.0042, wz * 0.0042, 5) * 24;
    h += N.fbm(x * 0.021, z * 0.021, 3) * 1.4;

    // terraced mesas -> climbable cliffs
    const mesaN = N.fbm(wx * 0.0028 - 80, wz * 0.0028 + 40, 3);
    const mesaMask = smoothstep(0.14, 0.2, mesaN);
    if (mesaMask > 0) {
      const mh = 16 + (mesaN - 0.14) * 95 + N.noise2(x * 0.03, z * 0.03) * 4;
      const step = 15;
      const tq = mh / step;
      const fl = Math.floor(tq);
      const terr = (fl + smoothstep(0.7, 1.0, tq - fl)) * step + N.fbm(x * 0.02, z * 0.02, 2) * 2.5;
      h = lerp(h, Math.max(h, terr), mesaMask);
    }

    // northern mountain massif
    const mx = x - LANDMARKS.mountain.x;
    const mz = z - LANDMARKS.mountain.z;
    const md = Math.hypot(mx * 0.85, mz);
    const massif = smoothstep(320, 15, md);
    const ridge = N.ridged(wx * 0.0058, wz * 0.0058, 5);
    h += Math.pow(massif, 1.7) * (115 + ridge * 80) + massif * ridge * 22;
    h += massif * N.ridged(wx * 0.02 + 9, wz * 0.02, 3) * 9 * smoothstep(20, 60, h);

    // giant tree hill: a lone round hill west of spawn
    const gd = Math.hypot(x - LANDMARKS.giantTree.x, z - LANDMARKS.giantTree.z);
    h = lerp(h, 34 - gd * 0.12, smoothstep(110, 30, gd) * 0.9);

    // statue plateau
    const sd2 = Math.hypot(x - LANDMARKS.statue.x, z - LANDMARKS.statue.z);
    h = lerp(h, 14, smoothstep(28, 12, sd2));

    // windmill village plateau and the forest ruins clearing
    const vd = Math.hypot(x - LANDMARKS.village.x, z - LANDMARKS.village.z);
    const vh = LANDMARKS.village.h + N.fbm(x * 0.02, z * 0.02, 2) * 0.5 + smoothstep(20, 46, vd) * 1.2;
    h = lerp(h, vh, smoothstep(LANDMARKS.village.r + 30, LANDMARKS.village.r, vd));
    const rd = Math.hypot(x - LANDMARKS.ruins.x, z - LANDMARKS.ruins.z);
    h = lerp(h, LANDMARKS.ruins.h + N.fbm(x * 0.03, z * 0.03, 2) * 0.7, smoothstep(LANDMARKS.ruins.r + 22, LANDMARKS.ruins.r, rd));

    // boss arena on the eastern cliffs, domain gate clearing
    const ad = Math.hypot(x - LANDMARKS.arena.x, z - LANDMARKS.arena.z);
    h = lerp(h, LANDMARKS.arena.h, smoothstep(LANDMARKS.arena.r + 22, LANDMARKS.arena.r, ad));
    const smd = Math.hypot(x - LANDMARKS.summit.x, z - LANDMARKS.summit.z);
    h = lerp(h, LANDMARKS.summit.h + N.fbm(x * 0.05, z * 0.05, 2) * 0.25, smoothstep(LANDMARKS.summit.r + 18, LANDMARKS.summit.r, smd));
    const dd = Math.hypot(x - LANDMARKS.domain.x, z - LANDMARKS.domain.z);
    h = lerp(h, LANDMARKS.domain.h, smoothstep(LANDMARKS.domain.r + 14, LANDMARKS.domain.r, dd));

    // spawn meadow: gentle rolling
    const sd = Math.hypot(x - SPAWN.x, z - SPAWN.z);
    const meadow = smoothstep(150, 45, sd);
    const meadowH = 8 + N.fbm(x * 0.008, z * 0.008, 3) * 4.5;
    h = lerp(h, meadowH, meadow * 0.85);

    // lake basin
    const lx = x - LANDMARKS.lake.x;
    const lz = z - LANDMARKS.lake.z;
    const ld = Math.hypot(lx, lz * 1.25) / (LANDMARKS.lake.r + 14 * N.noise2(x * 0.018, z * 0.018));
    h = lerp(h, Math.min(h, 1.4), smoothstep(1.35, 1.0, ld));
    h = lerp(h, -5.5, smoothstep(1.0, 0.5, ld));

    h = this.highlands(x, z, h);

    // coast profile: ocean floor -> shelf -> beach -> land
    const ocean = -22 + N.fbm(x * 0.01, z * 0.01, 2) * 3;
    const shelf = lerp(ocean, -0.6, smoothstep(0.05, 0.4, island));
    const beach = lerp(shelf, 1.5 + N.noise2(x * 0.03, z * 0.03) * 0.5, smoothstep(0.33, 0.5, island));
    let out = lerp(beach, h, smoothstep(0.45, 0.85, island));
    // deep harbour basin below the port plaza
    const [hx, hz] = portWorld(PU.L + 34, 2);
    const hb = Math.hypot(x - hx, z - hz);
    out = lerp(out, Math.min(out, -7), smoothstep(30, 16, hb));
    return this.harbourTown(x, z, out);
  }

  // harbour town: a ramp street with levelled lots and a quay at the bottom
  // (applied after the coast so the lowest terraces keep their height)
  harbourTown(x, z, h) {
    const N = this.noise;
    // harbour town: a ramp street with levelled lots, plaza at the bottom
    const { s, t } = portLocal(x, z);
    const tm = smoothstep(32, 22, Math.abs(t)) * smoothstep(-22, -8, s) * smoothstep(PU.L + 26, PU.L + 14, s);
    if (tm > 0) {
      let th = townHeight(s) + N.noise2(x * 0.06, z * 0.06) * 0.3;
      const plaza = smoothstep(PU.L - 8, PU.L - 3, s) * smoothstep(16, 12, Math.abs(t));
      th = lerp(th, PORT.hLow, plaza);
      for (const L of PORT_LOTS) {
        const ls = s - L.s,
          lt = t - L.t;
        const d = Math.max(Math.abs(ls) - (L.w / 2 + 2.2), Math.abs(lt) - (L.d / 2 + 2.6));
        th = lerp(th, L.h, smoothstep(1.4, 0, d));
      }
      h = lerp(h, th, tm);
    }
    return h;
  }


  // plateau, bluff, terraced harbour town and the river gorge
  highlands(x, z, h) {
    const N = this.noise;
    // maple plateau with cliff edges and soft terraces on top
    const hd = Math.hypot((x - HIGHLAND.x) * 0.95, z - HIGHLAND.z);
    const hm = smoothstep(HIGHLAND.r + 12, HIGHLAND.r - 10, hd + N.noise2(x * 0.021, z * 0.021) * 13);
    if (hm > 0) {
      const raw = HIGHLAND.h + N.fbm(x * 0.011 + 40, z * 0.011, 3) * 7;
      const step = 6;
      const fl = Math.floor(raw / step);
      const ph = (fl + smoothstep(0.75, 1.0, raw / step - fl)) * step + N.fbm(x * 0.03, z * 0.03, 2) * 1.2;
      h = lerp(h, Math.max(h, ph), hm);
    }
    // bluffs on both rims where the bridge is anchored
    const bd = Math.hypot(x - (BRIDGE.ax - 9), z - BRIDGE.az);
    h = lerp(h, Math.max(h, 29 + N.noise2(x * 0.05, z * 0.05) * 1.5), smoothstep(30, 10, bd));
    const bd2 = Math.hypot(x - (BRIDGE.bx + 10), z - BRIDGE.bz);
    h = lerp(h, Math.max(h, 30 + N.noise2(x * 0.05 + 9, z * 0.05) * 1.2), smoothstep(26, 9, bd2));
    // the river gorge, cut deep between the meadow and the plateau
    const gd = gorgeDistance(x, z) + N.noise2(x * 0.04, z * 0.04) * 2.5;
    h = lerp(h, -4.5, smoothstep(21, 8, gd));
    return h;
  }

  generate() {
    const H = this.heights;
    for (let j = 0; j < RES; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < RES; i++) {
        const x = -HALF + i * CELL;
        H[j * RES + i] = this.rawHeight(x, z);
      }
    }
    this.carvePaths();
    this.computeNormals();
    this.computeColors();
    this.buildTextures();
  }

  // Gentle dirt roads between points of interest (flattened slightly).
  carvePaths() {
    const pts = [
      [SPAWN.x, SPAWN.z],
      [LANDMARKS.statue.x, LANDMARKS.statue.z],
      [LANDMARKS.lake.x - 70, LANDMARKS.lake.z - 30],
    ];
    const pts2 = [
      [SPAWN.x, SPAWN.z],
      [-80, 30],
      [LANDMARKS.giantTree.x + 25, LANDMARKS.giantTree.z + 15],
    ];
    const pts3 = [
      [LANDMARKS.statue.x, LANDMARKS.statue.z],
      [50, -90],
      [40, -170],
    ];
    const V = LANDMARKS.village,
      R = LANDMARKS.ruins,
      G = LANDMARKS.giantTree;
    const pts4 = [
      [SPAWN.x, SPAWN.z],
      [-95, 128],
      [V.x + 30, V.z - 22],
      [V.x, V.z],
    ];
    const pts5 = [
      [G.x - 22, G.z - 8],
      [-215, -70],
      [R.x + 14, R.z + 6],
    ];
    // to the rope bridge, and across the highlands to the harbour and camps
    const pts6 = [
      [LANDMARKS.lake.x - 70, LANDMARKS.lake.z - 30],
      [70, 150],
      [94, 204],
      [BRIDGE.ax - 5, BRIDGE.az],
    ];
    const pts7 = [
      [BRIDGE.bx + 5, BRIDGE.bz],
      [198, 246],
      [PORT.tx - 5, PORT.tz - 7],
    ];
    const pts8 = [
      [198, 246],
      [CAMPS[0].x - 4, CAMPS[0].z + 16],
    ];
    const pts9 = [
      [PORT.tx - 5, PORT.tz - 7],
      [250, 238],
      [CAMPS[1].x - 14, CAMPS[1].z + 6],
    ];
    for (const p of [pts, pts2, pts3, pts4, pts5, pts6, pts7, pts8, pts9]) this.paths.push(this.makePathPolyline(p));
  }

  makePathPolyline(ctrl) {
    // Catmull-Rom-ish subdivision with noise wobble
    const out = [];
    for (let s = 0; s < ctrl.length - 1; s++) {
      const [ax, az] = ctrl[s];
      const [bx, bz] = ctrl[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 4);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const px = lerp(ax, bx, t);
        const pz = lerp(az, bz, t);
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        const w = this.n2.noise2(px * 0.012, pz * 0.012) * 14 * Math.sin(t * Math.PI);
        out.push([px + nx * w, pz + nz * w]);
      }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
  }

  pathDistance(x, z) {
    let best = 1e9;
    for (const poly of this.paths) {
      for (let k = 0; k < poly.length - 1; k++) {
        const [ax, az] = poly[k];
        const [bx, bz] = poly[k + 1];
        const dx = bx - ax,
          dz = bz - az;
        const l2 = dx * dx + dz * dz;
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = clamp(t, 0, 1);
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < best) best = d;
      }
    }
    return best;
  }

  computeNormals() {
    const H = this.heights;
    const Nn = this.normals;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const hl = H[j * RES + Math.max(i - 1, 0)];
        const hr = H[j * RES + Math.min(i + 1, RES - 1)];
        const hd = H[Math.max(j - 1, 0) * RES + i];
        const hu = H[Math.min(j + 1, RES - 1) * RES + i];
        let nx = hl - hr,
          ny = 2 * CELL,
          nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        const k = (j * RES + i) * 3;
        Nn[k] = nx / l;
        Nn[k + 1] = ny / l;
        Nn[k + 2] = nz / l;
      }
    }
  }

  computeColors() {
    const N = this.n2;
    const H = this.heights;
    const tmp = new THREE.Color();
    const aut = new THREE.Color();
    // pre-compute coarse path distance grid (every 4 cells) for speed
    const PR = Math.ceil(RES / 4) + 1;
    const pathGrid = new Float32Array(PR * PR);
    for (let j = 0; j < PR; j++)
      for (let i = 0; i < PR; i++) pathGrid[j * PR + i] = this.pathDistance(-HALF + i * 4 * CELL, -HALF + j * 4 * CELL);
    const pathAt = (i, j) => {
      const gi = i / 4,
        gj = j / 4;
      const i0 = Math.min(Math.floor(gi), PR - 2),
        j0 = Math.min(Math.floor(gj), PR - 2);
      const fi = gi - i0,
        fj = gj - j0;
      const a = pathGrid[j0 * PR + i0],
        b = pathGrid[j0 * PR + i0 + 1];
      const c = pathGrid[(j0 + 1) * PR + i0],
        d = pathGrid[(j0 + 1) * PR + i0 + 1];
      return lerp(lerp(a, b, fi), lerp(c, d, fi), fj);
    };

    for (let j = 0; j < RES; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < RES; i++) {
        const x = -HALF + i * CELL;
        const k = j * RES + i;
        const h = H[k];
        const ny = this.normals[k * 3 + 1];

        const patch = N.fbm(x * 0.006 + 200, z * 0.006, 3);
        const fine = N.noise2(x * 0.045, z * 0.045);
        tmp.copy(PAL.lush).lerp(PAL.yellow, smoothstep(-0.05, 0.45, patch));
        tmp.lerp(PAL.deep, smoothstep(0.1, 0.6, -patch) * 0.8);
        tmp.multiplyScalar(1 + fine * 0.06);

        // forests
        const sd = Math.hypot(x - SPAWN.x, z - SPAWN.z);
        let forest = smoothstep(0.08, 0.32, N.fbm(x * 0.0052 - 300, z * 0.0052 + 100, 3));
        forest *= smoothstep(40, 90, sd) * smoothstep(75, 45, h) * smoothstep(2.5, 6, h);
        this.forest[k] = forest;
        tmp.lerp(PAL.forest, forest * 0.55);

        // alpine
        tmp.lerp(PAL.alpine, smoothstep(45, 85, h) * 0.8);

        // autumn highlands: gold, amber and rust grass, leaf litter in woods
        const au = this.autumnMask(x, z);
        this.autumn[k] = au;
        if (au > 0.001) {
          aut.copy(AUT.gold).lerp(AUT.orange, smoothstep(-0.15, 0.35, patch));
          aut.lerp(AUT.red, smoothstep(0.15, 0.55, -patch) * 0.55);
          aut.lerp(AUT.moss, smoothstep(0.25, 0.6, fine) * 0.25);
          aut.multiplyScalar(1 + fine * 0.07);
          aut.lerp(AUT.floor, forest * 0.6);
          tmp.lerp(aut, au);
        }

        // path
        const pd = pathAt(i, j);
        const pathT = smoothstep(3.2, 1.6, pd + fine * 0.8);
        tmp.lerp(PAL.dirt, pathT * 0.9);

        // beach / seabed
        const sandT = smoothstep(2.6, 1.6, h + fine * 0.4);
        tmp.lerp(PAL.sand, sandT);
        tmp.lerp(PAL.wetSand, smoothstep(0.6, -0.2, h));
        tmp.lerp(PAL.seabed, smoothstep(-1.5, -6, h));

        this.colors[k * 3] = tmp.r;
        this.colors[k * 3 + 1] = tmp.g;
        this.colors[k * 3 + 2] = tmp.b;

        // grass density
        let g = smoothstep(2.0, 3.0, h) * smoothstep(0.8, 0.88, ny) * smoothstep(105, 80, h);
        g *= 1 - pathT;
        g *= 0.75 + 0.25 * smoothstep(-0.5, 0.3, fine);
        g *= 1 - forest * 0.35;
        this.grass[k] = clamp(g, 0, 1);
      }
    }
  }

  buildTextures() {
    const ht = new THREE.DataTexture(this.heights, RES, RES, THREE.RedFormat, THREE.FloatType);
    ht.magFilter = THREE.NearestFilter;
    ht.minFilter = THREE.NearestFilter;
    ht.needsUpdate = true;
    this.heightTex = ht;

    const data = new Uint8Array(RES * RES * 4);
    const c = new THREE.Color();
    for (let k = 0; k < RES * RES; k++) {
      c.setRGB(this.colors[k * 3], this.colors[k * 3 + 1], this.colors[k * 3 + 2]);
      const s = c.convertLinearToSRGB();
      data[k * 4] = clamp(s.r * 255, 0, 255);
      data[k * 4 + 1] = clamp(s.g * 255, 0, 255);
      data[k * 4 + 2] = clamp(s.b * 255, 0, 255);
      data[k * 4 + 3] = clamp(this.grass[k] * 255, 0, 255);
    }
    const ct = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    ct.colorSpace = THREE.SRGBColorSpace;
    ct.magFilter = THREE.LinearFilter;
    ct.minFilter = THREE.LinearFilter;
    ct.needsUpdate = true;
    this.colorTex = ct;

    terrainUniforms.uHeightTex.value = ht;
    terrainUniforms.uColorTex.value = ct;
    terrainUniforms.uWorldSize.value = WORLD_SIZE;
    terrainUniforms.uRes.value = RES;
  }

  // ---- queries ----------------------------------------------------------
  heightAt(x, z) {
    let gx = (x + HALF) / CELL;
    let gz = (z + HALF) / CELL;
    gx = clamp(gx, 0, RES - 1.001);
    gz = clamp(gz, 0, RES - 1.001);
    const i = Math.floor(gx),
      j = Math.floor(gz);
    const fx = gx - i,
      fz = gz - j;
    const H = this.heights;
    const a = H[j * RES + i],
      b = H[j * RES + i + 1];
    const c = H[(j + 1) * RES + i],
      d = H[(j + 1) * RES + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = CELL * 0.75;
    const hl = this.heightAt(x - e, z),
      hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e),
      hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  sampleField(arr, x, z) {
    let gx = clamp((x + HALF) / CELL, 0, RES - 1.001);
    let gz = clamp((z + HALF) / CELL, 0, RES - 1.001);
    const i = Math.floor(gx),
      j = Math.floor(gz);
    const fx = gx - i,
      fz = gz - j;
    return lerp(
      lerp(arr[j * RES + i], arr[j * RES + i + 1], fx),
      lerp(arr[(j + 1) * RES + i], arr[(j + 1) * RES + i + 1], fx),
      fz
    );
  }
  autumnMask(x, z) {
    const hd = Math.hypot((x - HIGHLAND.x) * 0.95, z - HIGHLAND.z);
    return smoothstep(HIGHLAND.r + 34, HIGHLAND.r - 6, hd + this.n2.noise2(x * 0.014, z * 0.014) * 18);
  }
  autumnAt(x, z) {
    return this.sampleField(this.autumn, x, z);
  }
  grassAt(x, z) {
    return this.sampleField(this.grass, x, z);
  }
  forestAt(x, z) {
    return this.sampleField(this.forest, x, z);
  }
  colorAt(x, z, out = new THREE.Color()) {
    const gx = clamp(Math.round((x + HALF) / CELL), 0, RES - 1);
    const gz = clamp(Math.round((z + HALF) / CELL), 0, RES - 1);
    const k = (gz * RES + gx) * 3;
    return out.setRGB(this.colors[k], this.colors[k + 1], this.colors[k + 2]);
  }

  // ---- mesh -------------------------------------------------------------
  buildMesh(step = 1) {
    const n = Math.floor((RES - 1) / step) + 1;
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const si = i * step,
          sj = j * step;
        const k = sj * RES + si;
        const o = (j * n + i) * 3;
        pos[o] = -HALF + si * CELL;
        pos[o + 1] = this.heights[k];
        pos[o + 2] = -HALF + sj * CELL;
        nor[o] = this.normals[k * 3];
        nor[o + 1] = this.normals[k * 3 + 1];
        nor[o + 2] = this.normals[k * 3 + 2];
        col[o] = this.colors[k * 3];
        col[o + 1] = this.colors[k * 3 + 1];
        col[o + 2] = this.colors[k * 3 + 2];
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i,
          b = a + 1,
          c = a + n,
          d = c + 1;
        idx[p++] = a;
        idx[p++] = c;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = c;
        idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mat = makeLitShader({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.mesh = mesh;
    return mesh;
  }
}

const TERRAIN_VERT = /* glsl */ `
${VERT_HEAD}
attribute vec3 aColor;
varying vec3 vColor;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main(){
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec3 transformedNormal = normalMatrix * normal;
  vWorldPos = worldPosition.xyz;
  vNormalW = normal;
  vColor = aColor;
  #include <shadowmap_vertex>
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const TERRAIN_FRAG = /* glsl */ `
${FRAG_HEAD}
${LIGHT_GLSL}
${NOISE_GLSL}
varying vec3 vColor;
varying vec3 vWorldPos;
varying vec3 vNormalW;

vec3 hash32(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
// x: distance to nearest feature, y: edge distance (F2-F1), z: cell hash
vec3 voronoi(vec2 x, out vec2 cell){
  vec2 n = floor(x);
  vec2 f = fract(x);
  float md = 8.0, md2 = 8.0;
  cell = n;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash32(n + g).xy * 0.85 + 0.075;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md){ md2 = md; md = d; cell = n + g; }
    else if (d < md2){ md2 = d; }
  }
  return vec3(sqrt(md), sqrt(md2) - sqrt(md), hash12(cell));
}

void main(){
  vec3 n = normalize(vNormalW);
  vec3 wp = vWorldPos;
  float dist = length(cameraPosition - wp);
  vec3 albedo = vColor;

  // painterly breakup of the grass colour
  float detailFade = 1.0 - smoothstep(60.0, 260.0, dist);
  float dn = snoise(wp.xz * 0.31) * 0.6 + snoise(wp.xz * 1.37) * 0.4 * detailFade;
  albedo *= 1.0 + dn * 0.08;
  float clump = smoothstep(0.35, 0.8, snoise(wp.xz * 0.11 + 4.0));
  albedo *= 1.0 - clump * 0.07 * smoothstep(3.0, 6.0, wp.y);

  // ---- rock: faceted slabs with cracks (planar mapped on the cliff face)
  float rn = snoise(wp.xz * 0.06 + wp.y * 0.04) * 0.07;
  float rockT = 1.0 - smoothstep(0.6 + rn, 0.76 + rn, n.y);
  float highRock = smoothstep(95.0, 125.0, wp.y) * smoothstep(0.97, 0.8, n.y);
  float rockAll = max(rockT, highRock * 0.85);
  vec3 lightN = n;
  if (rockAll > 0.01) {
    // fixed-axis triplanar voronoi (cells stretched horizontally on walls)
    vec3 tw = pow(abs(n), vec3(4.0));
    tw /= (tw.x + tw.y + tw.z);
    vec2 uvX = vec2(wp.z * 0.6, wp.y * 1.25);
    vec2 uvY = wp.xz;
    vec2 uvZ = vec2(wp.x * 0.6, wp.y * 1.25);
    vec3 vA = vec3(0.0);
    vec3 hA = vec3(0.0);
    vec2 cc;
    if (tw.x > 0.02) { vec3 v = voronoi(uvX * 0.21, cc); vA += v * tw.x; hA += hash32(cc) * tw.x; }
    if (tw.y > 0.02) { vec3 v = voronoi(uvY * 0.21, cc); vA += v * tw.y; hA += hash32(cc) * tw.y; }
    if (tw.z > 0.02) { vec3 v = voronoi(uvZ * 0.21, cc); vA += v * tw.z; hA += hash32(cc) * tw.z; }
    vec2 domUV = tw.x > tw.y && tw.x > tw.z ? uvX : (tw.y > tw.z ? uvY : uvZ);
    vec2 cellB;
    vec3 vB = voronoi(domUV * 0.62 + 7.3, cellB);     // small chips
    float near = 1.0 - smoothstep(70.0, 220.0, dist);
    vec3 hB = hash32(cellB);
    float layer = wp.y * 0.16 + snoise(wp.xz * 0.03) * 0.8;
    float band = smoothstep(0.35, 0.65, fract(layer)) * 0.5 + 0.5 * snoise(vec2(layer * 3.1, 0.0));
    vec3 rockA = vec3(0.19, 0.175, 0.165);
    vec3 rockB = vec3(0.36, 0.33, 0.28);
    vec3 rockWarm = vec3(0.42, 0.35, 0.26);
    vec3 rockCol = mix(rockA, rockB, clamp(hA.x * 0.6 + band * 0.25 + hB.y * 0.15 * near, 0.0, 1.0));
    rockCol = mix(rockCol, rockWarm, smoothstep(0.75, 1.0, hA.z) * 0.6);
    float crack = smoothstep(0.0, 0.07, vA.y);
    float chip = mix(1.0, smoothstep(0.0, 0.05, vB.y), near * 0.6);
    rockCol *= mix(0.45, 1.0, crack) * mix(0.75, 1.0, chip);
    // moss / dirt in crevices on gentler rock
    rockCol = mix(rockCol, albedo * 0.7, smoothstep(0.55, 0.7, n.y) * 0.5);
    albedo = mix(albedo, rockCol, rockAll);
    // facet normals give the stylised chiselled look
    vec3 tilt = (hA - 0.5) * vec3(0.9, 0.5, 0.9) + (hB - 0.5) * 0.35 * near;
    lightN = normalize(mix(n, normalize(n + tilt), rockAll));
  }

  // grass lip on cliff tops
  float lip = smoothstep(0.62, 0.7, n.y) * smoothstep(0.85, 0.74, n.y);
  albedo *= 1.0 + lip * 0.12;

  // snow caps
  float snowLine = 128.0 + snoise(wp.xz * 0.018) * 14.0;
  float snowT = smoothstep(snowLine, snowLine + 7.0, wp.y) * smoothstep(0.42, 0.68, lightN.y);
  albedo = mix(albedo, vec3(0.86, 0.9, 0.97), snowT);

  float under = smoothstep(0.2, -1.5, wp.y);
  albedo *= 1.0 - under * 0.25;

  // rain: darker soil, puddles in flat hollows
  float wet = uWet * (1.0 - snowT) * smoothstep(0.0, 0.4, wp.y);
  float flatK = smoothstep(0.86, 0.97, n.y);
  float puddle = wet * flatK * smoothstep(0.25, 0.55, snoise(wp.xz * 0.09) * 0.7 + snoise(wp.xz * 0.31) * 0.3) * (1.0 - rockAll);
  albedo *= 1.0 - 0.36 * wet;
  albedo = mix(albedo, albedo * 0.35, puddle);
  vec3 wetN = normalize(mix(lightN, vec3(0.0, 1.0, 0.0), puddle));

  float shadow = getShadowMask() * cloudShadow(vWorldPos, uSunDir);
  vec3 col = stylize(albedo, lightN, shadow, 1.0, 0.25 + rockAll * 0.1);
  vec3 V = normalize(cameraPosition - wp);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * snowT * pow(max(dot(lightN, H), 0.0), 40.0) * 0.25 * shadow;
  col += wetSheen(wetN, V, wet * (0.35 + 0.65 * flatK) + puddle * 1.4, shadow);

  gl_FragColor = vec4(col, 1.0);
  ${FRAG_TAIL}
}
`;
