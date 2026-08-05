Build a complete, playable, mobile-first MVP of a competitive real-time fantasy strategy game with **true 3D WebGL graphics**.

The result must look like a polished mobile game, not a prototype made with shapes, sprites, emojis, CSS castles, or flat images.

## Technology

Use:

* Vite
* TypeScript
* Babylon.js

Three.js is acceptable only if it produces a better result.

Do not use Unity WebGL, a heavy physics engine, expensive navigation meshes, or resource-heavy rendering.

The game must run smoothly in mobile browsers and Telegram Mini App WebViews.

## Core game

Create a landscape 1v1 arena featuring:

* A large blue 3D castle on the player side
* A large red 3D castle on the enemy side
* A central 3D flag objective
* Exactly four unit cards
* Animated 3D units
* Automatic movement and combat
* Lightweight enemy AI
* Flag capture and return mechanics
* Temporary enemy-gate opening
* Castle infiltration as the final victory condition

## True 3D requirement

The game world must use:

* Real 3D terrain
* Real 3D castles
* Real animated 3D characters
* Skeletal animations
* Real 3D arrows and projectiles
* Real perspective, depth, shadows, and occlusion
* Real movement across the XZ ground plane
* Lightweight 3D combat effects

The final MVP must not use 2D sprites or billboard characters as substitutes for 3D units.

## Visual style

Use a premium, colorful, stylized fantasy art direction.

The game should have the charm and readability of successful mobile strategy games, but all castles, units, UI, animations, sounds, and character designs must be original.

Do not copy Clash of Clans or Clash Royale assets or exact character designs.

Use:

* Low-to-medium polygon models
* Strong and readable character silhouettes
* Stylized PBR or hand-painted materials
* Attractive baked lighting and ambient occlusion
* Blue and red team accents
* Professional character animations
* Detailed-looking assets that remain lightweight

Prioritize polished stylized 3D rather than photorealism.

## Camera

Use a fixed perspective camera above and behind the player’s castle.

The camera must:

* Show the important battlefield
* Keep both castles and the central objective visible
* Use a tilted top-down angle
* Stay close enough to clearly see units
* Adapt to different landscape phone ratios
* Avoid free rotation and excessive movement

Subtle camera movement may be used for flag delivery, gate opening, castle breach, victory, and defeat.

## Battlefield

Create a symmetrical 3D fantasy arena containing:

* Blue castle at the bottom
* Red castle at the top
* Central raised flag platform
* Left, center, and right paths
* Clear deployment zones
* Stone roads
* Grass
* Small walls
* Bridges or raised sections
* Rocks, trees, bushes, banners, and torches

The environment must look complete but not cluttered.

Use instancing, shared materials, merged static meshes, and texture atlases for repeated decorations.

## Castles

Both castles must be large, detailed 3D fortresses containing:

* Main keep
* Visible entrance gate
* Two defensive towers
* Connected stone walls
* Battlements
* Team-colored banners
* Internal infiltration zone
* Gate opening animation
* Vulnerable and breached states

The castles must feel visually important and must not look like simple boxes.

Use simple collision volumes and mostly baked lighting.

## Gameplay loop

1. The player selects one of four cards.
2. The player taps a valid position in the blue deployment zone.
3. An animated 3D unit spawns there.
4. The unit follows a lightweight predefined route toward the central flag.
5. Nearby enemies automatically engage each other.
6. The first eligible unit reaching the flag captures it.
7. The carrier returns the flag to its own castle.
8. Friendly units escort the carrier while enemies attempt to stop it.
9. If the carrier dies, the flag drops at that exact position.
10. Either team can recover the dropped flag.
11. Delivering the flag temporarily opens the enemy castle gate.
12. During this attack window, friendly units advance toward the enemy castle.
13. If one unit enters the enemy castle interior, the defender becomes permanently unable to deploy units.
14. A short castle-breach countdown begins.
15. After the countdown, the attacking side wins.

## Castle infiltration rule

This rule must be implemented exactly.

When an attacker enters the enemy castle interior:

* Permanently lock the defender’s deployment
* Disable all four defender cards
* Stop the enemy AI or player from spawning new units
* Make the breach state irreversible
* Do not allow killing the infiltrator to cancel the breach
* Allow existing units outside the castle to finish their current actions
* Display “CASTLE BREACHED”
* Start a short final countdown
* Declare victory after the countdown

Infiltration is the final checkmate condition.

## Four units

Each unit must have:

* Idle animation
* Run animation
* Attack animation
* Hit animation
* Death animation
* Lightweight spawn effect

### 1. BRAX — cost 3

* Large armored warrior with shield and heavy weapon
* Broad, tanky, powerful silhouette; steel with blue accents
* High health and strong melee damage
* Slower movement: arrives as frontline pressure, not a rush
* Durable frontliner that holds the line and escorts the flag carrier

### 2. NYX — cost 3

* Sleek elite marksman: archer / crossbow sniper
* Tall, slim, precise silhouette; dark armor with green accents
* Lowest health in the roster
* Longest attack range and highest single-target damage
* Stays behind friendly melee units and fires pooled 3D arrows

### 3. VEX — cost 2

* Agile hooded rogue with twin daggers
* Light, fast, stealthy silhouette; dark outfit with purple accents
* Fastest unit in the roster, low health and combat power
* Prioritizes the flag and keeps full speed while carrying it
* Strong during the open-gate attack phase

### 4. FUSE — cost 5

* Demolition expert with bombs and explosive gear
* Compact but dangerous silhouette with a bulky bomb pack; dark leather and metal with orange/red accents
* Medium durability
* Heavy, slow explosive hits
* By far the strongest damage against the gate and the castle

## Movement and targeting

Do not use expensive full-scene pathfinding.

Use:

* Three predefined routes
* Waypoints
* Simple route selection
* Lightweight local avoidance
* Basic separation between units
* Fixed-interval target updates
* Squared-distance checks
* Simple XZ movement

Units must not jitter, overlap heavily, spin constantly, or change targets every frame.

General targeting priority:

1. Current attacker
2. Enemy threatening the friendly flag carrier
3. Nearby enemy
4. Neutral or dropped flag
5. Friendly flag-carrier escort
6. Own castle when returning the flag
7. Enemy castle during the attack window

## Combat

Melee units must:

* Stop inside attack range
* Face the target
* Play the attack animation
* Apply damage at the correct animation moment
* Use lightweight impact effects

NYX must:

* Face their target
* Play the firing animation
* Spawn a pooled 3D arrow
* Apply damage on impact
* Return arrows to the pool

Do not use ragdolls.

Dead units should play a short death animation and then return to an object pool.

## Enemy AI

Create a lightweight AI that:

* Uses the same four cards
* Regenerates energy
* Deploys from the red zone
* Chooses between attack, defense, escort, and flag pressure
* Reacts when the player carries the flag
* Sometimes escorts its flag carrier with a BRAX
* Uses VEX during an open-gate opportunity
* Leans on FUSE once the castle assault window opens
* Stops spawning permanently after its castle is breached

Use simple weighted decisions and cooldowns, not complex AI.

## Energy and controls

* Maximum energy: 10
* Energy regenerates automatically
* Cards disable when energy is insufficient
* Tap a card, then tap the valid deployment zone
* Convert the tap into a 3D ground position using a lightweight raycast
* Display valid and invalid deployment feedback
* Make all controls touch-friendly

## Mobile UI

Top HUD:

* Player and enemy identity
* Match timer
* Current flag status
* Gate status
* Castle breach warning
* Victory and defeat messages

Bottom HUD:

* Exactly four cards
* Card portrait
* Energy cost
* Selected state
* Disabled state
* Energy bar
* Deployment-lock feedback

The HUD may use HTML/CSS, but the battlefield, castles, units, flag, projectiles, and effects must remain real 3D WebGL content.

Support landscape screens, safe areas, different phone ratios, and Telegram viewport changes without stretching the scene or overlapping UI.

## Performance

Mobile performance is a critical requirement.

Target stable 30 FPS on typical lower or mid-range Android phones and near 60 FPS on stronger devices.

Rules:

* Maximum 20–24 active units
* Pool units, arrows, and effects
* Use instancing for repeated props
* Merge static environment meshes
* Limit skinned meshes, materials, bones, and draw calls
* Prefer 512×512 unit textures
* Use 1024×1024 only for important shared atlases
* Avoid 2K and 4K textures
* Avoid dynamic shadows for every unit
* Use baked lighting and simple blob shadows
* Avoid particle spam, transparent overdraw, and heavy post-processing
* Avoid per-frame allocations
* Stagger AI and targeting updates
* Pause or reduce updates when the page is hidden
* Dispose resources when leaving the match

Use one ambient or hemispheric light and one directional light.

Include Mobile Low, Mobile Standard, and Desktop High quality settings, while keeping the default mobile mode attractive.

## Loading and audio

Load critical assets first:

* Battlefield
* Castles
* Four unit models
* Essential animations
* UI
* Important sounds

Show loading progress and a Start Battle button.

Load nonessential decorations afterward if necessary.

Add lightweight sounds for deployment, attacks, arrows, deaths, flag events, gate opening, castle breach, victory, and defeat.

Do not autoplay audio before user interaction.

## Code structure

Keep gameplay modular and configurable.

Separate:

* Scene and rendering
* Asset loading
* Units and pooling
* Movement
* Combat
* Targeting
* Flag logic
* Castle logic
* Enemy AI
* Energy
* Input
* UI
* Audio
* Match lifecycle
* Performance settings

Keep unit stats, energy costs, AI timing, gate duration, breach countdown, and performance limits in central configuration files.

## Validation restrictions

Do not automatically run:

* Playwright or Puppeteer
* Headless browsers
* Automated gameplay
* Long runtime tests
* Multi-unit simulations
* Automated screenshots
* Repeated builds
* Multiple Vite, Node, or browser processes

Only:

* Inspect code carefully
* Run the production build once
* Include TypeScript validation in that build
* Run lightweight isolated logic checks
* Reason through important edge cases
* Provide a short manual mobile test checklist

## Deliverables

Return:

1. Complete source code
2. All legally usable 3D assets
3. Four animated unit models
4. Two optimized castles
5. Complete 3D battlefield and flag
6. Enemy AI and full gameplay loop
7. Mobile HUD
8. Run and build instructions
9. Architecture summary
10. Asset license information
11. Balance configuration locations
12. Performance decisions and limitations
13. Manual mobile test checklist

## Final requirement

Do not deliver a flat prototype or primitive placeholder scene.

The first playable screen must immediately show:

* A polished real 3D battlefield
* Two large detailed castles
* Four attractive animated 3D unit types
* A central 3D flag
* Real depth and perspective
* Professional lighting
* Smooth combat
* Premium responsive mobile UI

The game must look impressive while remaining intentionally optimized for mobile WebGL and Telegram Mini Apps.
