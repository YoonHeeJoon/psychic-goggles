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

## Iteration 9 — a second region ✅
- [x] Autumn highlands across a long rope bridge: maple forests, terraced fields, a cliffside port town
  (plateau + river gorge + bluffs shaped in the height function; harbour street in its own s/t frame with levelled
  lots; sagging plank bridge with thin walkable solids you can pass beneath; maple tree variants, autumn ground,
  GPU-animated falling leaves)
- [x] New enemy families: goblin archers (ranged), shield brutes (break the guard), floating elemental casters, elite variants
- [x] Enemy camps with watchtowers and loot, a second quest chapter with a short cutscene
  (camp clear → stolen lantern → lighthouse beacon + ship sailing in; old saves continue into chapter 2)
- [x] Region-specific music theme, map and minimap support for the new area
  (+ far enemies now LOD out their outlines and shadows: −30~40% draw calls in busy views)

## Iteration 10 — systems depth ✅
- [x] Weapons and artifacts (stats, refinement), a simple gacha-free unlock path
  (12 weapons with ascension + refinement, 5-slot artifacts in 3 sets with rolled substats; one stat block
  feeds crit, energy recharge and damage bonuses into combat; loot from chests, elites, domain, boss)
- [x] Daily commissions, reputation, a shop UI
  (date-seeded hunt/gather/deliver/scout jobs, notice boards, HUD tracker; two reputation tracks with rewards;
  market + smithy shop panel)
- [x] Save versioning (v2 migration) and portable saves (export / import JSON)
- [ ] Deterministic combat events for co-op (deferred)

## Iteration 11 — seasons & sky ✅
- [x] Snowfall on the peaks, aurora nights, shooting stars
  (camera-wrapped GPU snow that grows with altitude and fades at the lens; aurora curtains layered in the sky
  shader on most clear nights, with the clouds thinning out; shooting-star streaks)
- [x] Festival night in the harbour town: lanterns released over the sea, fireworks
  (every night from 19:00 — instanced sky lanterns drifting out to sea, peony/ring/willow/double shells with
  trails and distance-delayed booms, a wish-lantern stall, a festival music theme)
- [x] Fishing at the pier and lake (timing mini-game), boat rides across the harbour
  (charge-and-cast, float nibbles and bite, strike window, tension-bar reeling; 4 fish with sizes and records,
  3 fish dishes; a sailing boat with an unfurling sail, heel, wake, shallow-water collision and docking)

## Iteration 12 — new heroes ✅
- [x] Two new playable characters: ice (frozen / superconduct / melt) and earth (shields, crystallize)
  (설하, a bow user: auto-aimed arrows with a frost-bloom finisher, frost-lotus trap, icicle blizzard with a storm wall;
  카룬, a claymore guardian: a stone pillar you can stand on, rock-spike quake; crystallize shards and a shield system
  that soaks damage before HP, with a bubble and an HP-bar overlay)
- [x] Party setup screen: pick four of six, character showcase with idle animation and stats
  (companions are met out in the world and join after a talk; save v3 keeps who you met and the chosen four)
- [x] Freezing water to walk on it, ice-locked puzzles, earth pillars to climb on
  (an ice character in front freezes hex floes underfoot that really carry you, then melt; ice skills freeze water;
  a chest frozen in ice (melt with fire) and a cracked boulder (earth or heavy blows))

## Iteration 13 — the frozen summit
- [ ] Chapter 3: climb the frozen summit with the new companions (ice paths and pillars as part of the route)
- [ ] Biting cold on the peak: a cold meter, warmth from braziers and fire, blizzard weather above the treeline
- [ ] A second world boss on the summit with its own arena and phases
