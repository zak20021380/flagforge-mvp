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
  readonly castleStone: PBRMaterial;
  readonly castleStoneLight: PBRMaterial;
  readonly castleStoneDark: PBRMaterial;
  readonly roofBlue: PBRMaterial;
  readonly roofBlueLight: PBRMaterial;
  readonly roofRed: PBRMaterial;
  readonly roofRedLight: PBRMaterial;
  readonly gateWood: PBRMaterial;
  readonly gateWoodLight: PBRMaterial;
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
  readonly objectiveCloth: PBRMaterial;
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
    this.road = pbr('mat-road', Color3.FromHexString('#756248'), 0.96);
    this.wood = pbr('mat-wood', Color3.FromHexString('#6e4028'), 0.9);
    this.metal = pbr('mat-metal', Color3.FromHexString('#687478'), 0.34, 0.72);
    this.gold = pbr('mat-gold', Color3.FromHexString('#dca83c'), 0.28, 0.8);
    this.water = pbr('mat-water', Color3.FromHexString('#2a7185'), 0.25, 0.05);
    this.water.alpha = 0.92;
    this.waterDeep = pbr('mat-water-deep', Color3.FromHexString('#154453'), 0.3, 0.05);
    this.foliage = pbr('mat-foliage', Color3.FromHexString('#2f6538'));
    this.foliageMid = pbr('mat-foliage-mid', Color3.FromHexString('#295b35'));
    this.foliageDeep = pbr('mat-foliage-deep', Color3.FromHexString('#193c2a'));
    this.foliageDark = pbr('mat-foliage-dark', Color3.FromHexString('#20452f'));
    this.trunk = pbr('mat-trunk', Color3.FromHexString('#59402f'));
    this.blue = pbr('mat-blue', Color3.FromHexString('#1f86f2'), 0.52, 0.08);
    this.blueDark = pbr('mat-blue-dark', Color3.FromHexString('#0e438f'), 0.58, 0.12);
    this.red = pbr('mat-red', Color3.FromHexString('#ee3f4b'), 0.52, 0.08);
    this.redDark = pbr('mat-red-dark', Color3.FromHexString('#8a1b29'), 0.58, 0.12);
    this.skin = pbr('mat-skin', Color3.FromHexString('#d69a72'));
    this.leather = pbr('mat-leather', Color3.FromHexString('#563321'), 0.93);
    this.cloth = pbr('mat-cloth', Color3.FromHexString('#d7c5a3'), 0.95);
    this.black = pbr('mat-black', Color3.FromHexString('#17202a'), 0.75, 0.12);
    this.white = pbr('mat-white', Color3.FromHexString('#dfe8e5'), 0.9);

    this.glowBlue = new StandardMaterial('mat-glow-blue', scene);
    this.glowBlue.diffuseColor = Color3.FromHexString('#239cff');
    this.glowBlue.emissiveColor = Color3.FromHexString('#0755b8');
    this.glowBlue.alpha = 0.74;

    this.glowRed = new StandardMaterial('mat-glow-red', scene);
    this.glowRed.diffuseColor = Color3.FromHexString('#ff3948');
    this.glowRed.emissiveColor = Color3.FromHexString('#aa1024');
    this.glowRed.alpha = 0.74;

    this.objectiveCloth = pbr('mat-objective-cloth', Color3.FromHexString('#d09a32'), 0.7, 0.08);

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
}
