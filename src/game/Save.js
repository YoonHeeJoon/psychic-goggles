import { Gear } from './Gear.js';

// Save format versioning. Progress is one JSON object in localStorage; each
// version bump adds a migration step so older saves load into the new game.
//   v1  exploration, quest, characters, puzzles, achievements, stats
//   v2  gear (weapons, artifacts, materials), daily commissions, reputation

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'starwind.progress.v1';

export function migrateSave(prog, party) {
  const v = prog.v || 1;
  if (v < 2) {
    prog.rep = prog.rep || { village: { xp: 0, got: [] }, port: { xp: 0, got: [] } };
    prog.comm = prog.comm || null;
  }
  // always make sure every party member holds a weapon
  Gear.migrate(prog, party);
  prog.v = SAVE_VERSION;
  return prog;
}

// a portable copy of the save (download as .json)
export function exportSave(prog) {
  return JSON.stringify({ game: 'starwind', v: prog.v || SAVE_VERSION, exported: new Date().toISOString(), progress: prog }, null, 1);
}

// validate and store an exported save; returns an error message or null
export function importSave(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return '올바른 저장 파일이 아닙니다.';
  }
  const p = data && data.game === 'starwind' ? data.progress : null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.wp) || !Array.isArray(p.orbs) || !Array.isArray(p.chests)) return '별바람 군도의 저장 파일이 아닙니다.';
  if ((p.v || 1) > SAVE_VERSION) return '더 새로운 버전의 저장 파일입니다.';
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(p));
  } catch (e) {
    return '저장 공간에 쓸 수 없습니다.';
  }
  return null;
}
