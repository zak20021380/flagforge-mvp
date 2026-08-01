import { Color3, PBRMaterial, Scene, StandardMaterial } from '@babylonjs/core';
import type { Team } from '../core/types';

export class MaterialLibrary {
  readonly grass: PBRMaterial;
  readonly paving: PBRMaterial;
  readonly stoneMoss: PBRMaterial;
  readonly stone: PBRMaterial;
  readonly stoneLight: PBRMaterial;
  readonly stoneWarm: PBRMaterial;
  readonly stoneDark: PBRMaterial;
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
  readonly skin: PBRMaterial;
  readonly leather: PBRMaterial;
  readonly cloth: PBRMaterial;
  readonly black: PBRMaterial;
  readonly white: PBRMaterial;
  readonly glowBlue: StandardMaterial;
  readonly glowRed: StandardMaterial;
  readonly torchGlow: StandardMaterial;
  readonly torchGlowWarm: StandardMaterial;
  readonly objectiveCloth: PBRMaterial;
  readonly blobShadow: StandardMaterial;

  constructor(scene: Scene) {
    const pbr = (name: string, color: Color3, roughness = 0.85, metallic = 0): PBRMaterial => {
      const material = new PBRMaterial(name, scene);
      material.albedoColor = color;
      material.roughness = roughness;
      material.metallic = metallic;
      material.environmentIntensity = 0.62;
      return material;
    };

    // Rich grass and restrained stone keep the battlefield readable without pale, minty fills.
    this.grass = pbr('mat-grass', Color3.FromHexString('#3d7739'));
    this.paving = pbr('mat-paving', Color3.FromHexString('#777166'), 0.95);
    this.stoneMoss = pbr('mat-stone-moss', Color3.FromHexString('#465744'), 0.95);
    this.stone = pbr('mat-stone', Color3.FromHexString('#717b7a'), 0.92);
    this.stoneLight = pbr('mat-stone-light', Color3.FromHexString('#85877d'), 0.94);
    this.stoneWarm = pbr('mat-stone-warm', Color3.FromHexString('#625e56'), 0.96);
    this.stoneDark = pbr('mat-stone-dark', Color3.FromHexString('#3f494c'), 0.94);
    this.road = pbr('mat-road', Color3.FromHexString('#817862'), 0.96);
    this.wood = pbr('mat-wood', Color3.FromHexString('#6e4028'), 0.9);
    this.metal = pbr('mat-metal', Color3.FromHexString('#687478'), 0.34, 0.72);
    this.gold = pbr('mat-gold', Color3.FromHexString('#d8a845'), 0.28, 0.8);
    this.water = pbr('mat-water', Color3.FromHexString('#2a7185'), 0.25, 0.05);
    this.water.alpha = 0.92;
    this.waterDeep = pbr('mat-water-deep', Color3.FromHexString('#154453'), 0.3, 0.05);
    this.foliage = pbr('mat-foliage', Color3.FromHexString('#2f6538'));
    this.foliageMid = pbr('mat-foliage-mid', Color3.FromHexString('#295b35'));
    this.foliageDeep = pbr('mat-foliage-deep', Color3.FromHexString('#193c2a'));
    this.foliageDark = pbr('mat-foliage-dark', Color3.FromHexString('#20452f'));
    this.trunk = pbr('mat-trunk', Color3.FromHexString('#59402f'));
    this.blue = pbr('mat-blue', Color3.FromHexString('#3c8df0'), 0.52, 0.08);
    this.blueDark = pbr('mat-blue-dark', Color3.FromHexString('#174783'), 0.58, 0.12);
    this.red = pbr('mat-red', Color3.FromHexString('#e84f55'), 0.52, 0.08);
    this.redDark = pbr('mat-red-dark', Color3.FromHexString('#79212c'), 0.58, 0.12);
    this.skin = pbr('mat-skin', Color3.FromHexString('#d69a72'));
    this.leather = pbr('mat-leather', Color3.FromHexString('#563321'), 0.93);
    this.cloth = pbr('mat-cloth', Color3.FromHexString('#d7c5a3'), 0.95);
    this.black = pbr('mat-black', Color3.FromHexString('#17202a'), 0.75, 0.12);
    this.white = pbr('mat-white', Color3.FromHexString('#dfe8e5'), 0.9);

    this.glowBlue = new StandardMaterial('mat-glow-blue', scene);
    this.glowBlue.diffuseColor = Color3.FromHexString('#3aa7ff');
    this.glowBlue.emissiveColor = Color3.FromHexString('#1368bf');
    this.glowBlue.alpha = 0.64;

    this.glowRed = new StandardMaterial('mat-glow-red', scene);
    this.glowRed.diffuseColor = Color3.FromHexString('#ff4f58');
    this.glowRed.emissiveColor = Color3.FromHexString('#a71c2c');
    this.glowRed.alpha = 0.64;

    this.torchGlow = new StandardMaterial('mat-torch-glow', scene);
    this.torchGlow.diffuseColor = Color3.FromHexString('#ff9b3d');
    this.torchGlow.emissiveColor = Color3.FromHexString('#ff6a1a');

    // Second flame material so torch groups can flicker out of phase with each other while
    // still costing only two material updates per frame (no extra lights, no per-mesh work).
    this.torchGlowWarm = new StandardMaterial('mat-torch-glow-warm', scene);
    this.torchGlowWarm.diffuseColor = Color3.FromHexString('#ffb457');
    this.torchGlowWarm.emissiveColor = Color3.FromHexString('#ff7d24');

    this.objectiveCloth = pbr('mat-objective-cloth', Color3.FromHexString('#c89b43'), 0.7, 0.08);

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

  teamGlow(team: Team): StandardMaterial {
    return team === 'blue' ? this.glowBlue : this.glowRed;
  }
}
