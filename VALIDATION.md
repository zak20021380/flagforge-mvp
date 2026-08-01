# Validation report

## Completed

- Full source inspection after implementation
- Strict TypeScript syntax/type-flow check across all project source files
- `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` checks
- Isolated energy spend, overspend rejection, regeneration, and maximum-cap check
- Manual reasoning through these edge cases:
  - Flag drops at the carrier's current XZ position on death
  - Either team can recover a neutral or dropped flag
  - Flag delivery opens only the opposing gate
  - Gate windows expire without resetting an existing breach
  - Castle infiltration sets one irreversible `breachedTeam`
  - Defender deployment remains locked even if the infiltrator dies
  - Existing active units continue updating after deployment lock
  - Enemy AI checks deployment lock before every spawn decision
  - The five-second breach countdown is independent of infiltrator survival
  - Active units, arrows, and effects return to pools
  - Match updates stop while the page is hidden

## Environment limitation

The sandbox package registry returned 404 responses for npm packages, and direct public-registry access was unavailable. Therefore `npm install` and the real Vite production build could not be completed in this environment.

A local strict TypeScript compatibility check passed using temporary Babylon.js declaration shims. Those temporary shims are not included in the project and do not replace the real Babylon.js package.

Run this once on a normal machine with npm access:

```bash
npm install
npm run build
```

No browser automation, headless browser, gameplay simulation, screenshot automation, repeated build, or long-running runtime test was used.
