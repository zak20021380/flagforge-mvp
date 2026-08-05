import { Color3, DynamicTexture, PBRMaterial, Scene, StandardMaterial, Texture } from '@babylonjs/core';
import type { Team } from '../core/types';

/**
 * Small tiling wood-grain albedo map, drawn once per material at build time. It is deliberately
 * low-contrast: the ladder silhouette has to come from geometry, and this only stops the timber
 * from reading as a flat painted strip. `strength` is the darkest grain-line alpha.
 */
function createWoodGrainTexture(scene: Scene, name: string, strength: number): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const context = texture.getContext();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  // Grain runs along the plank length (V), so lines are drawn as vertical streaks of varying width.
  for (let index = 0; index < 26; index += 1) {
    const x = (index / 26) * size + Math.sin(index * 2.7) * 1.8;
    const width = 1 + ((index * 7) % 3);
    const alpha = strength * (0.35 + ((index * 13) % 7) / 10);
    context.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
    context.fillRect(x, 0, width, size);
  }
  // A couple of soft cross-cut bands break the streaks up so the grain does not look like stripes.
  for (let index = 0; index < 3; index += 1) {
    const y = ((index + 0.5) / 3) * size;
    context.fillStyle = `rgba(0, 0, 0, ${(strength * 0.3).toFixed(3)})`;
    context.fillRect(0, y, size, 2);
  }
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = 1;
  texture.vScale = 3;
  return texture;
}

/**
 * Flag cloth palettes. All states share the same design language (gold trim, ivory field shield
 * with a crown and a fortress device) and differ only in the cloth colour: strong royal blue for
 * the neutral objective, rich blue and deep crimson for the carried team states.
 */
interface FlagPalette {
  cloth: string;
  trim: string;
  trimDark: string;
  emblemField: string;
  emblem: string;
  emblemDetail: string;
}

const FLAG_NEUTRAL_PALETTE: FlagPalette = {
  cloth: '#2b4cc0',
  trim: '#d8a93f',
  trimDark: '#8a6a1f',
  emblemField: '#f2e7cd',
  emblem: '#16234a',
  emblemDetail: '#0b1530',
};

const FLAG_BLUE_PALETTE: FlagPalette = {
  cloth: '#2857c7',
  trim: '#d8a93f',
  trimDark: '#8a6a1f',
  emblemField: '#f2e7cd',
  emblem: '#1e43a8',
  emblemDetail: '#102a6b',
};

const FLAG_RED_PALETTE: FlagPalette = {
  cloth: '#a22038',
  trim: '#d8a93f',
  trimDark: '#8a6a1f',
  emblemField: '#f2e7cd',
  emblem: '#7e1426',
  emblemDetail: '#4a0a14',
};

function drawFlagTrim(texture: DynamicTexture, palette: FlagPalette, width: number, height: number): void {
  const ctx = texture.getContext();
  const band = 9;
  ctx.fillStyle = palette.trim;
  ctx.fillRect(0, 0, width, band);
  ctx.fillRect(0, height - band, width, band);
  ctx.fillRect(0, 0, band, height);
  ctx.fillRect(width - band, 0, band, height);
  ctx.fillStyle = palette.trimDark;
  ctx.fillRect(band, band, width - band * 2, 1.5);
  ctx.fillRect(band, height - band - 1.5, width - band * 2, 1.5);
  ctx.fillRect(band, band, 1.5, height - band * 2);
  ctx.fillRect(width - band - 1.5, band, 1.5, height - band * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(band + 4, band + 4, width - (band + 4) * 2, 1);
  ctx.fillRect(band + 4, height - band - 5, width - (band + 4) * 2, 1);
  ctx.fillRect(band + 4, band + 4, 1, height - (band + 4) * 2);
  ctx.fillRect(width - band - 5, band + 4, 1, height - (band + 4) * 2);
  ctx.fillStyle = palette.trimDark;
  const corner = 4.5;
  ctx.fillRect(band, band, corner, corner);
  ctx.fillRect(width - band - corner, band, corner, corner);
  ctx.fillRect(band, height - band - corner, corner, corner);
  ctx.fillRect(width - band - corner, height - band - corner, corner, corner);
}

function drawFlagCrown(texture: DynamicTexture, palette: FlagPalette, cx: number, top: number, scale = 1): void {
  const ctx = texture.getContext();
  const half = 48 * scale;
  const y = (offset: number): number => top + offset * scale;
  ctx.beginPath();
  ctx.moveTo(cx - half, y(50));
  ctx.lineTo(cx - half + 4 * scale, y(6));
  ctx.lineTo(cx - half + 23 * scale, y(27));
  ctx.lineTo(cx - 5 * scale, top);
  ctx.lineTo(cx + 5 * scale, y(27));
  ctx.lineTo(cx + half - 4 * scale, y(6));
  ctx.lineTo(cx + half, y(50));
  ctx.closePath();
  ctx.fillStyle = palette.trim;
  ctx.fill();
  ctx.strokeStyle = palette.trimDark;
  ctx.lineWidth = 3 * scale;
  ctx.stroke();
  ctx.fillStyle = palette.trim;
  ctx.beginPath();
  ctx.arc(cx - half + 4 * scale, y(6), 5 * scale, 0, Math.PI * 2);
  ctx.arc(cx, top, 5 * scale, 0, Math.PI * 2);
  ctx.arc(cx + half - 4 * scale, y(6), 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.trimDark;
  ctx.lineWidth = 2 * scale;
  ctx.stroke();
  ctx.fillStyle = palette.trimDark;
  ctx.fillRect(cx - half, y(42), half * 2, 7 * scale);
  ctx.fillStyle = palette.emblemField;
  ctx.fillRect(cx - half + 7 * scale, y(44), 9 * scale, 3 * scale);
  ctx.fillRect(cx - 4.5 * scale, y(44), 9 * scale, 3 * scale);
  ctx.fillRect(cx + half - 16 * scale, y(44), 9 * scale, 3 * scale);
}

function drawFlagShield(texture: DynamicTexture, palette: FlagPalette, cx: number, top: number, scale = 1): void {
  const ctx = texture.getContext();
  const outline: ReadonlyArray<readonly [number, number]> = [
    [-54, 0], [-54, 66], [-20, 116], [20, 116], [54, 66], [54, 0],
  ];
  ctx.beginPath();
  for (let index = 0; index < outline.length; index += 1) {
    const [ox, oy] = outline[index];
    if (index === 0) {
      ctx.moveTo(cx + ox * scale, top + oy * scale);
    } else if (index === 2 || index === 4) {
      const sign = index === 2 ? -1 : 1;
      ctx.quadraticCurveTo(cx + sign * 52 * scale, top + 108 * scale, cx + ox * scale, top + oy * scale);
    } else {
      ctx.lineTo(cx + ox * scale, top + oy * scale);
    }
  }
  ctx.closePath();
  ctx.fillStyle = palette.emblemField;
  ctx.fill();
  ctx.strokeStyle = palette.trim;
  ctx.lineWidth = 7 * scale;
  ctx.stroke();
  ctx.strokeStyle = palette.trimDark;
  ctx.lineWidth = 2.5 * scale;
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = palette.trimDark;
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  for (let index = 0; index < outline.length; index += 1) {
    const [ox, oy] = outline[index];
    const px = cx + ox * 0.84 * scale;
    const py = top + (104 + (oy - 104) * 0.84) * scale;
    if (index === 0) {
      ctx.moveTo(px, py);
    } else if (index === 2 || index === 4) {
      const sign = index === 2 ? -1 : 1;
      ctx.quadraticCurveTo(cx + sign * 44 * scale, top + 106 * scale, px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawFlagTower(texture: DynamicTexture, palette: FlagPalette, cx: number, top: number, scale = 1): void {
  const ctx = texture.getContext();
  const half = 31 * scale;
  ctx.fillStyle = palette.emblem;
  for (let index = 0; index < 4; index += 1) {
    ctx.fillRect(cx - half + index * 15.5 * scale, top, 9 * scale, 8 * scale);
  }
  ctx.fillRect(cx - half, top + 6 * scale, half * 2, 44 * scale);
  ctx.beginPath();
  ctx.moveTo(cx - 16 * scale, top + 50 * scale);
  ctx.lineTo(cx - 16 * scale, top + 30 * scale);
  ctx.arc(cx, top + 30 * scale, 16 * scale, Math.PI, 0);
  ctx.lineTo(cx + 16 * scale, top + 50 * scale);
  ctx.closePath();
  ctx.fillStyle = palette.emblemDetail;
  ctx.fill();
  ctx.strokeStyle = palette.trim;
  ctx.lineWidth = 2.5 * scale;
  ctx.stroke();
  ctx.fillStyle = palette.trim;
  ctx.fillRect(cx - 24 * scale, top + 13 * scale, 4.5 * scale, 10 * scale);
  ctx.fillRect(cx + 19.5 * scale, top + 13 * scale, 4.5 * scale, 10 * scale);
}

/**
 * 2:1 horizontal banner cloth with stitched gold trim and a centred gold crown-and-fortress
 * device. The design is authored with the crown at the top of the canvas and the fortress at the
 * bottom; the cloth grid maps canvas top to the upper pole edge, so the emblem always reads
 * upright on the flying banner.
 */
function createFlagTexture(scene: Scene, name: string, palette: FlagPalette): DynamicTexture {
  const width = 512;
  const height = 256;
  const texture = new DynamicTexture(name, { width, height }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = palette.cloth;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.32, width / 2, height / 2, height * 0.72);
  vignette.addColorStop(0, 'rgba(255,255,255,0.05)');
  vignette.addColorStop(0.6, 'rgba(0,0,0,0.03)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < 6; index += 1) {
    const x = ((index + 0.5) / 6) * width + (index % 2 === 0 ? -12 : 12);
    const fold = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
    fold.addColorStop(0, 'rgba(0,0,0,0)');
    fold.addColorStop(0.5, index % 2 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.11)');
    fold.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fold;
    ctx.fillRect(x - 26, 0, 52, height);
  }
  drawFlagTrim(texture, palette, width, height);
  const emblemScale = 1.1;
  drawFlagCrown(texture, palette, width / 2, 34, emblemScale);
  drawFlagShield(texture, palette, width / 2, 102, emblemScale);
  drawFlagTower(texture, palette, width / 2, 132, emblemScale);
  texture.update(false);
  return texture;
}

export class MaterialLibrary {
  readonly grass: PBRMaterial;
  readonly paving: PBRMaterial;
  readonly stoneMoss: PBRMaterial;
  readonly stone: PBRMaterial;
  readonly stoneLight: PBRMaterial;
  readonly stoneWarm: PBRMaterial;
  readonly stoneDark: PBRMaterial;
  readonly castleStone: PBRMaterial;
  readonly castleStoneLight: PBRMaterial;
  readonly castleStoneDark: PBRMaterial;
  readonly roofBlue: PBRMaterial;
  readonly roofBlueLight: PBRMaterial;
  readonly roofRed: PBRMaterial;
  readonly roofRedLight: PBRMaterial;
  readonly gateWood: PBRMaterial;
  readonly gateWoodLight: PBRMaterial;
  readonly ladderWood: PBRMaterial;
  readonly ladderWoodDark: PBRMaterial;
  readonly road: PBRMaterial;
  readonly wood: PBRMaterial;
  readonly metal: PBRMaterial;
  readonly gold: PBRMaterial;
  readonly water: PBRMaterial;
  readonly waterDeep: PBRMaterial;
  readonly foliage: PBRMaterial;
  readonly foliageMid: PBRMaterial;
  readonly foliageDeep: PBRMaterial;
  readonly foliageDark: PBRMaterial;
  readonly trunk: PBRMaterial;
  readonly blue: PBRMaterial;
  readonly blueDark: PBRMaterial;
  readonly red: PBRMaterial;
  readonly redDark: PBRMaterial;
  readonly blueCloth: PBRMaterial;
  readonly blueArmor: PBRMaterial;
  readonly blueAccent: PBRMaterial;
  readonly redCloth: PBRMaterial;
  readonly redArmor: PBRMaterial;
  readonly redAccent: PBRMaterial;
  readonly darkSteel: PBRMaterial;
  readonly brassTrim: PBRMaterial;
  readonly skin: PBRMaterial;
  readonly leather: PBRMaterial;
  readonly cloth: PBRMaterial;
  readonly black: PBRMaterial;
  readonly white: PBRMaterial;
  readonly glowBlue: StandardMaterial;
  readonly glowRed: StandardMaterial;
  readonly objectiveCloth: PBRMaterial;
  readonly flagNeutral: PBRMaterial;
  readonly flagBlue: PBRMaterial;
  readonly flagRed: PBRMaterial;
  readonly blobShadow: StandardMaterial;

  constructor(scene: Scene) {
    const pbr = (name: string, color: Color3, roughness = 0.85, metallic = 0): PBRMaterial => {
      const material = new PBRMaterial(name, scene);
      material.albedoColor = color;
      material.roughness = roughness;
      material.metallic = metallic;
      material.environmentIntensity = 0.42;
      return material;
    };

    // Saturated ground and a wider stone-value range keep every arena layer distinct in daylight.
    this.grass = pbr('mat-grass', Color3.FromHexString('#337a3a'));
    this.paving = pbr('mat-paving', Color3.FromHexString('#6c5f50'), 0.95);
    this.stoneMoss = pbr('mat-stone-moss', Color3.FromHexString('#3e5040'), 0.95);
    this.stone = pbr('mat-stone', Color3.FromHexString('#6b7572'), 0.9);
    this.stoneLight = pbr('mat-stone-light', Color3.FromHexString('#98948a'), 0.9);
    this.stoneWarm = pbr('mat-stone-warm', Color3.FromHexString('#5f5144'), 0.96);
    this.stoneDark = pbr('mat-stone-dark', Color3.FromHexString('#3d4750'), 0.92);
    // Castle stone family: warmer dressed stone, light trim for courses/crenellations and a
    // deep shadow tone for recesses and plinths. Matte, never glossy.
    this.castleStone = pbr('mat-castle-stone', Color3.FromHexString('#6c7573'), 0.93);
    this.castleStoneLight = pbr('mat-castle-stone-light', Color3.FromHexString('#a9a497'), 0.9);
    this.castleStoneDark = pbr('mat-castle-stone-dark', Color3.FromHexString('#414b52'), 0.95);
    // Player roofs read as glazed slate rather than plastic: a deeper, cleaner blue for the mass
    // and one lighter tone reserved for eaves and ridge trim.
    this.roofBlue = pbr('mat-roof-blue', Color3.FromHexString('#2a5da5'), 0.68, 0.06);
    this.roofBlueLight = pbr('mat-roof-blue-light', Color3.FromHexString('#4d87cf'), 0.6, 0.06);
    this.roofRed = pbr('mat-roof-red', Color3.FromHexString('#91303a'), 0.72, 0.06);
    // Rival counterpart of roofBlueLight, one value step up from roofRed for eaves and ridge trim.
    this.roofRedLight = pbr('mat-roof-red-light', Color3.FromHexString('#c04c50'), 0.64, 0.06);
    this.gateWood = pbr('mat-gate-wood', Color3.FromHexString('#5b3925'), 0.92);
    this.gateWoodLight = pbr('mat-gate-wood-light', Color3.FromHexString('#6d452a'), 0.9);
    // Siege-ladder timber: a warm mid oak for the stiles and a brighter, more saturated tone for
    // the rungs. The one value step between them is what makes each step read as a separate plank
    // from the gameplay camera; both carry the same hand-painted grain so they read as sawn wood
    // rather than flat brown strips. Matte, never metallic.
    this.ladderWood = pbr('mat-ladder-wood', Color3.FromHexString('#8a5a2f'), 0.86);
    this.ladderWood.albedoTexture = createWoodGrainTexture(scene, 'tex-ladder-wood', 0.16);
    this.ladderWoodDark = pbr('mat-ladder-wood-dark', Color3.FromHexString('#5a3418'), 0.88);
    this.ladderWoodDark.albedoTexture = createWoodGrainTexture(scene, 'tex-ladder-wood-dark', 0.2);
    this.road = pbr('mat-road', Color3.FromHexString('#756248'), 0.96);
    this.wood = pbr('mat-wood', Color3.FromHexString('#7d4c32'), 0.86);
    this.metal = pbr('mat-metal', Color3.FromHexString('#7a8690'), 0.28, 0.78);
    this.gold = pbr('mat-gold', Color3.FromHexString('#dca83c'), 0.28, 0.8);
    this.water = pbr('mat-water', Color3.FromHexString('#2a7185'), 0.25, 0.05);
    this.water.alpha = 0.92;
    this.waterDeep = pbr('mat-water-deep', Color3.FromHexString('#154453'), 0.3, 0.05);
    this.foliage = pbr('mat-foliage', Color3.FromHexString('#2f6538'));
    this.foliageMid = pbr('mat-foliage-mid', Color3.FromHexString('#295b35'));
    this.foliageDeep = pbr('mat-foliage-deep', Color3.FromHexString('#193c2a'));
    this.foliageDark = pbr('mat-foliage-dark', Color3.FromHexString('#20452f'));
    this.trunk = pbr('mat-trunk', Color3.FromHexString('#59402f'));
    this.blue = pbr('mat-blue', Color3.FromHexString('#2b9aff'), 0.45, 0.10);
    this.blueDark = pbr('mat-blue-dark', Color3.FromHexString('#1456a8'), 0.50, 0.14);
    this.red = pbr('mat-red', Color3.FromHexString('#ff4d58'), 0.45, 0.10);
    this.redDark = pbr('mat-red-dark', Color3.FromHexString('#a82438'), 0.50, 0.14);
    // Team cloth is the big readable block (tabard, sleeves, capes). It must survive the portrait
    // gameplay camera (~60 units out): royal blue vs deep crimson, strongly saturated and a full
    // value step brighter than the old navy/maroon, which read as near-black at distance.
    this.blueCloth = pbr('mat-blue-cloth', Color3.FromHexString('#2b5fe0'), 0.88, 0.02);
    this.blueArmor = pbr('mat-blue-armor', Color3.FromHexString('#c8ced8'), 0.22, 0.82);
    // Accents carry the readable markings: crests, shoulder caps and shield faces. Luminous blue
    // and hot red stay distinct even when both teams clash side by side on the flag deck.
    this.blueAccent = pbr('mat-blue-accent', Color3.FromHexString('#3fa9ff'), 0.28, 0.6);
    this.redCloth = pbr('mat-red-cloth', Color3.FromHexString('#c01f38'), 0.88, 0.02);
    this.redArmor = pbr('mat-red-armor', Color3.FromHexString('#2e2a28'), 0.32, 0.72);
    this.redAccent = pbr('mat-red-accent', Color3.FromHexString('#ff3d50'), 0.28, 0.6);
    this.darkSteel = pbr('mat-dark-steel', Color3.FromHexString('#3a4550'), 0.32, 0.76);
    this.brassTrim = pbr('mat-brass-trim', Color3.FromHexString('#c89840'), 0.35, 0.72);
    this.skin = pbr('mat-skin', Color3.FromHexString('#e0a882'), 0.82);
    this.leather = pbr('mat-leather', Color3.FromHexString('#6b4030'), 0.88);
    this.cloth = pbr('mat-cloth', Color3.FromHexString('#dccba8'), 0.92);
    this.black = pbr('mat-black', Color3.FromHexString('#1e2830'), 0.70, 0.14);
    this.white = pbr('mat-white', Color3.FromHexString('#e8f0ec'), 0.85);

    this.glowBlue = new StandardMaterial('mat-glow-blue', scene);
    this.glowBlue.diffuseColor = Color3.FromHexString('#239cff');
    this.glowBlue.emissiveColor = Color3.FromHexString('#0755b8');
    this.glowBlue.alpha = 0.74;

    this.glowRed = new StandardMaterial('mat-glow-red', scene);
    this.glowRed.diffuseColor = Color3.FromHexString('#ff3948');
    this.glowRed.emissiveColor = Color3.FromHexString('#aa1024');
    this.glowRed.alpha = 0.74;

    this.objectiveCloth = pbr('mat-objective-cloth', Color3.FromHexString('#d09a32'), 0.7, 0.08);

    const flagMaterial = (name: string, palette: FlagPalette): PBRMaterial => {
      const material = new PBRMaterial(name, scene);
      material.albedoTexture = createFlagTexture(scene, `tex-${name}`, palette);
      material.roughness = 0.86;
      material.metallic = 0.02;
      material.environmentIntensity = 0.42;
      material.backFaceCulling = false;
      return material;
    };
    this.flagNeutral = flagMaterial('mat-flag-neutral', FLAG_NEUTRAL_PALETTE);
    this.flagBlue = flagMaterial('mat-flag-blue', FLAG_BLUE_PALETTE);
    this.flagRed = flagMaterial('mat-flag-red', FLAG_RED_PALETTE);

    this.blobShadow = new StandardMaterial('mat-blob-shadow', scene);
    this.blobShadow.diffuseColor = Color3.Black();
    this.blobShadow.alpha = 0.22;
    this.blobShadow.disableLighting = true;
  }

  team(team: Team): PBRMaterial {
    return team === 'blue' ? this.blue : this.red;
  }

  /**
   * Environment-only materials never change after the arena is built, so their effects can be
   * frozen once. Team, unit and glow materials are left alone because gameplay reassigns them.
   */
  freezeEnvironmentMaterials(): void {
    for (const material of [
      this.grass, this.paving, this.stoneMoss, this.waterDeep,
      this.foliage, this.foliageMid, this.foliageDeep, this.foliageDark, this.trunk,
    ]) {
      material.freeze();
    }
  }

  teamDark(team: Team): PBRMaterial {
    return team === 'blue' ? this.blueDark : this.redDark;
  }

  /** Emblem-bearing banner cloth for the carried objective, matching the carrying team. */
  flagTeam(team: Team): PBRMaterial {
    return team === 'blue' ? this.flagBlue : this.flagRed;
  }

  roofTeam(team: Team): PBRMaterial {
    return team === 'blue' ? this.roofBlue : this.roofRed;
  }

  /** Lighter roof value, reserved for eaves and ridge trim on both castles. */
  roofTeamLight(team: Team): PBRMaterial {
    return team === 'blue' ? this.roofBlueLight : this.roofRedLight;
  }

  teamGlow(team: Team): StandardMaterial {
    return team === 'blue' ? this.glowBlue : this.glowRed;
  }

  teamCloth(team: Team): PBRMaterial {
    return team === 'blue' ? this.blueCloth : this.redCloth;
  }

  teamArmor(team: Team): PBRMaterial {
    return team === 'blue' ? this.blueArmor : this.redArmor;
  }

  teamAccent(team: Team): PBRMaterial {
    return team === 'blue' ? this.blueAccent : this.redAccent;
  }
}
