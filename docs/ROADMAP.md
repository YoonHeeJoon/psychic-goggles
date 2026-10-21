# Roadmap

Each `/loop` iteration picks the next unchecked block, implements it, verifies it in headless
Chromium screenshots, then commits.

## Iteration 1 — world & traversal ✅
- [x] Vite + Three.js project, quality presets, post-processing
- [x] Procedural island terrain, rock/snow shading, paths, lake
- [x] Sky, clouds, day/night, fog, water
- [x] Instanced grass with wind + trampling, trees, bushes, flowers, rocks, giant tree
- [x] Procedural anime party (4 characters), toon + outline shading, face textures
- [x] Run / sprint / jump / glide / climb / swim, stamina, camera
- [x] HUD: minimap, party, HP, skills, stamina wheel, banners, menus

## Iteration 2 — combat ✅
- [x] Normal attack combos per weapon (sword, claymore, polearm, catalyst) with blade trails
- [x] Elemental skill (E) and burst (Q) per character, cooldowns, energy particles
- [x] Enemies: elemental slimes + masked goblins, AI, HP bars, aura icons, gem drops, respawn
- [x] Elemental reactions (vaporize, melt, overload, freeze, charged, superconduct, swirl, shatter)
- [x] Damage numbers, hit-stop, camera shake, plunge attack, dash i-frames, party down/revive

## Iteration 3 — exploration content ✅
- [x] Teleport waypoints, guardian statue, ruins, windmill village
- [x] Collectibles (wind orbs), treasure chests, gem currency
- [x] Wind currents (updrafts) for gliding, full map (M)
- [x] Climbable / walkable structures (houses, windmills, statue), saved progress

## Iteration 4 — polish ✅
- [x] Hair specular "angel ring", better face shading, idle variations
- [x] Ambient audio (wind, birds, footsteps, UI), music-free soundscape
- [x] Touch controls for mobile, performance pass (LOD, culling)
- [x] God rays / sun shafts, distant mountain impostors

## Iteration 5 — world life & story ✅
- [x] NPCs in the village (idle routines, speech bubbles), a short opening quest with dialogue UI
- [x] Cooking / gathering: pickable flowers, mushrooms and fruit with an inventory panel
- [x] Weather: rain showers with wet ground and rainbows, thunderstorms at night
- [x] Wildlife: birds that scatter, butterflies and fireflies, fish in the lake

## Iteration 6 — challenges & bosses ✅
- [x] Elemental puzzles (torches to light, wind pinwheels, timed trials) guarding exquisite chests
- [x] A boss arena: a giant elemental beast with phases, shield break and telegraphed attacks
- [x] Character level-ups / talents from gems, damage scaling and enemy levels by region
- [x] Domain-style challenge with a reward chest and a short cinematic intro

## Iteration 7 — feel & finish ✅
- [x] Gamepad support, rebindable keys, camera collision with trees and walls
- [x] Character switching flourish (swap VFX, voice-like chimes), elemental burst cut-in camera
- [x] Ambient music: procedural day / night / battle themes that cross-fade
- [x] Achievements / adventure log, photo mode

## Iteration 8 — beauty pass ✅
- [x] Screen-space ambient occlusion and contact shadows tuned for the toon look
  (half-res, depth-aware blur, cool tinted, characters masked via alpha 0.98)
- [x] Better water: refraction of the lake bed, shoreline waves, foam trails behind swimmers
  (frame copied by a framebuffer blit right before the water draws; per-channel absorption, caustics,
  contact foam, rollers by distance-to-shore, swash, wake rings)
- [x] Cloud shadows sweeping over the land, volumetric fog in valleys at dawn
  (cloud layer projected along the sun on every lit material; analytic height fog with drifting noise)
- [x] Character hair/cloth physics chains, footprints in sand and snow
  (vertex bend driven by a lagging tip spring + flutter, matching outline and shadow; instanced multiply decals)

## Iteration 9 — a second region
- [ ] Autumn highlands across a long rope bridge: maple forests, terraced fields, a cliffside port town
- [ ] New enemy families: goblin archers (ranged), shield brutes (break the guard), floating elemental casters, elite variants
- [ ] Enemy camps with watchtowers and loot, a second quest chapter with a short cutscene
- [ ] Region-specific music theme, map and minimap support for the new area

## Iteration 10 — systems depth
- [ ] Weapons and artifacts (stats, refinement), a simple gacha-free unlock path
- [ ] Daily commissions, reputation, a shop UI
- [ ] Co-op ready refactor: deterministic combat events, save versioning
