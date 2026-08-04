# Flagforge Arena — Mobile 3D Strategy MVP

A complete playable 1v1 fantasy strategy MVP built with Vite, TypeScript, and Babylon.js. The arena, castles, characters, flag, arrows, effects, and card portraits are original lightweight procedural assets included in the project.

## Run

```bash
npm install
npm run dev
```

Open the local URL in a landscape browser. For a production bundle:

```bash
npm run build
npm run preview
```

## Controls

1. Press **Prepare Arena** and choose a quality tier.
2. Press **Start Battle**.
3. Tap one of the four cards.
4. Tap inside the translucent blue deployment zone.
5. Units move, target, fight, capture the flag, escort carriers, and attack automatically.

## Win condition

- Capture the central flag and return it to the blue castle.
- The blue gate only opens once the blue carrier reaches the gate carrying the flag, and closes a moment after the flag is secured. The same rule is mirrored for the red castle.
- Securing the flag starts the 13-second assault phase.
- Get any surviving blue unit past the red defences and into the red castle interior.
- Infiltration permanently locks all red deployment.
- Killing the infiltrator does not cancel the breach.
- The final five-second breach countdown ends the match.

The same rules apply to the enemy AI.

## Units

| Unit | Cost | Role |
|---|---:|---|
| Vanguard | 3 | Balanced front-line melee fighter |
| Ranger | 3 | Long-range unit using pooled real 3D arrows |
| Raider | 2 | Fast objective runner and gate attacker |
| Iron Guard | 5 | High-health escort that reduces nearby ally damage |

## Architecture

- `src/render/arena.ts` — scene, camera, lighting, battlefield, bridges, instanced decorations
- `src/render/castle.ts` — detailed procedural castles, animated gates, breach state
- `src/render/unitRig.ts` — original articulated 3D unit rigs and runtime animations
- `src/game/unitManager.ts` — pooling, movement, separation, targeting, combat, death recycling
- `src/game/flag.ts` — capture, carry, exact-position drop, delivery, reset
- `src/game/castleLogic.ts` — shared flag-return gate condition, assault windows, irreversible infiltration, deployment lock, countdown
- `src/game/enemyAI.ts` — weighted lightweight AI using the same cards and energy rules
- `src/game/projectiles.ts` — pooled 3D arrows
- `src/game/effects.ts` — pooled spawn and impact effects
- `src/game/energy.ts` — energy regeneration and spending
- `src/ui/gameUI.ts` — loading flow, mobile HUD, four cards, alerts, end screen
- `src/audio/audioManager.ts` — user-gesture-gated lightweight Web Audio cues
- `src/core/config.ts` — central balance and quality settings

## Balance configuration

Edit `src/core/config.ts`:

- Unit health, speed, damage, range, costs, cooldowns
- Maximum active units
- Energy regeneration
- Gate-open duration
- Breach countdown
- AI timing
- Quality tiers and shadow-map sizes

## Performance decisions

- Maximum 24 active units
- No physics engine and no navigation mesh
- Three waypoint routes with simple XZ movement
- Staggered target refresh intervals
- Squared-distance targeting checks
- Unit, arrow, and effect pooling
- Instanced trees, rocks, and bushes
- One hemispheric light and one directional light
- One shadow generator; no per-unit lights
- Blob shadows plus limited real shadows
- No textures, post-processing, ragdolls, browser automation, or runtime simulation tests
- Render/update loop pauses while the page is hidden
- Mobile Low, Mobile Standard, and Desktop High tiers

## Current MVP limitations

- Models are original procedural low-poly rigs rather than imported artist-authored GLB characters.
- Animations use lightweight articulated bone-style transform hierarchies rather than high-bone-count skinned meshes.
- Multiplayer networking, accounts, matchmaking, progression, and monetization are intentionally outside this local 1v1 AI MVP.
- Audio is synthesized with Web Audio to avoid downloadable sound files.

## Manual mobile test checklist

1. Rotate the phone to landscape and confirm HUD safe-area spacing.
2. Prepare **Mobile Low**, start the battle, and deploy all four unit types.
3. Confirm cards gray out when energy is insufficient.
4. Confirm units use left, center, and right routes without heavy overlap.
5. Confirm Rangers fire visible 3D arrows and arrows recycle after impact.
6. Kill a flag carrier and confirm the flag drops at the death position.
7. Return the flag and confirm your own castle gate opens only as the carrier reaches the gate with the flag, then closes shortly after delivery.
8. Enter the enemy castle and confirm all enemy spawning stops permanently.
9. Kill the infiltrator during the countdown and confirm the breach continues.
10. Background and restore the Mini App; confirm the match resumes without duplicate loops.
