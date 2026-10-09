// Parametric hair model. Every visual and physical property of a groom is a
// parameter here; per-strand variation is derived from these with seeded noise.
//
// Units: lengths in meters, diameters in micrometers, angles in degrees.

/** Geometry of the strands in a region. */
export interface ShapeParams {
  /** Follicle density, hairs / cm². */
  density: number;
  /** Mean strand length (true arc length, before curl shrinkage). */
  length: number;
  /** Relative per-strand length variation (0..1). */
  lengthVar: number;
  /** Mean fiber diameter (µm). */
  diameter: number;
  diameterVar: number;
  /** Cross-section minor/major axis ratio (1 = round, ~0.5 = very elliptical). */
  ellipticity: number;
  /** Fraction of the length over which the tip tapers. */
  tipTaper: number;
  /** Angle between the emerging strand and the skin surface. */
  rootLift: number;
  /** How strongly the strand keeps following the skin flow before falling free (0..1). */
  surfaceFollow: number;
  /** Distance (m) strands may stack above the skin, creating volume. */
  volume: number;

  // Macro curl: resolved by the simulation (part of the rest shape).
  /** Planar wave amplitude (m). */
  waveAmp: number;
  /** Planar wave period (m of arc length). */
  wavePeriod: number;
  /** Helical curl radius (m). */
  curlRadius: number;
  /** Helical curl pitch (m per turn along the centerline). */
  curlPitch: number;
  /** Relative per-strand curl variation (0..1). */
  curlVar: number;

  // Micro curl: added at render time around the simulated centerline.
  /** Coil radius (m). */
  coilRadius: number;
  /** Coil pitch (m per turn). */
  coilPitch: number;
  /** Zig-zag kink amount for very tight (4B/4C) textures (0..1). */
  kink: number;

  /** Random fiber-scale displacement (0..1). */
  frizz: number;
  /** Fraction of strands that are flyaways (0..1). */
  flyaway: number;
  /** Strands per clump (≥1, 1 = no clumping). */
  clumpSize: number;
  /** How strongly strand tips are pulled to their clump leader (0..1). */
  clumpStrength: number;
}

/** Optical properties for the hair BSDF. */
export interface LookParams {
  /** Eumelanin concentration (Chiang et al. 2016 scale, ~0..8). */
  eumelanin: number;
  /** Pheomelanin concentration (~0..8). */
  pheomelanin: number;
  /** Fraction of unpigmented (grey/white) strands (0..1). */
  grey: number;
  /** Artificial dye color (linear RGB) and its strength. */
  dyeColor: [number, number, number];
  dye: number;
  /** Lightening toward the tips from sun/weathering (0..1). */
  tipBleach: number;
  /** Longitudinal roughness (β_m, 0..1). */
  roughness: number;
  /** Azimuthal roughness (β_n, 0..1). */
  azimuthalRoughness: number;
  /** Cuticle scale tilt (α, degrees). */
  cuticleTilt: number;
  /** Index of refraction of keratin. */
  ior: number;
  /** Water content (0..1): darker, glossier, clumpier, heavier. */
  wetness: number;
  /** Sebum / product (0..1): glossier, clumpier. */
  oiliness: number;
}

/** Dynamics. */
export interface PhysicsParams {
  /** Local bending stiffness (keeps curls / rest shape locally, 0..1). */
  bendStiffness: number;
  /** Global shape hold, like gel or a set style (0..1). */
  hold: number;
  /** How quickly hold fades from root to tip (higher = only near root). */
  holdFalloff: number;
  /** Velocity damping per second (0..1). */
  damping: number;
  /** Multiplier on gravity (heavier when wet). */
  gravity: number;
  /** Strand-strand friction via the velocity grid (0..1). */
  friction: number;
  /** Strand-strand repulsion that preserves volume (0..1). */
  repulsion: number;
}

export interface RegionParams {
  enabled: boolean;
  shape: ShapeParams;
  look: LookParams;
  physics: PhysicsParams;
}

export const defaultLook = (): LookParams => ({
  eumelanin: 1.3,
  pheomelanin: 0.25,
  grey: 0,
  dyeColor: [0.6, 0.1, 0.1],
  dye: 0,
  tipBleach: 0.1,
  roughness: 0.3,
  azimuthalRoughness: 0.35,
  cuticleTilt: 3,
  ior: 1.55,
  wetness: 0,
  oiliness: 0.1,
});

export const defaultShape = (): ShapeParams => ({
  density: 20,
  length: 0.01,
  lengthVar: 0.2,
  diameter: 70,
  diameterVar: 0.15,
  ellipticity: 0.8,
  tipTaper: 0.3,
  rootLift: 20,
  surfaceFollow: 0.9,
  volume: 0.001,
  waveAmp: 0,
  wavePeriod: 0.05,
  curlRadius: 0,
  curlPitch: 0.03,
  curlVar: 0.2,
  coilRadius: 0,
  coilPitch: 0.01,
  kink: 0,
  frizz: 0.05,
  flyaway: 0,
  clumpSize: 1,
  clumpStrength: 0,
});

export const defaultPhysics = (): PhysicsParams => ({
  bendStiffness: 0.6,
  hold: 0.3,
  holdFalloff: 2,
  damping: 0.5,
  gravity: 1,
  friction: 0.2,
  repulsion: 0.2,
});

// ------------------------------------------------------------ hair textures

/**
 * Curl pattern presets following the Andre Walker typing system (1A–4C).
 * Wave/curl/coil values are approximate geometric fits, not measurements.
 */
export type CurlType =
  | '1A' | '1B' | '1C' | '2A' | '2B' | '2C' | '3A' | '3B' | '3C' | '4A' | '4B' | '4C';

type CurlPreset = Pick<
  ShapeParams,
  'waveAmp' | 'wavePeriod' | 'curlRadius' | 'curlPitch' | 'coilRadius' | 'coilPitch' | 'kink' | 'ellipticity' | 'frizz' | 'clumpSize' | 'clumpStrength'
>;

export const CURL_TYPES: Record<CurlType, CurlPreset> = {
  '1A': { waveAmp: 0, wavePeriod: 0.1, curlRadius: 0, curlPitch: 0.1, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.9, frizz: 0.01, clumpSize: 6, clumpStrength: 0.15 },
  '1B': { waveAmp: 0.002, wavePeriod: 0.12, curlRadius: 0, curlPitch: 0.1, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.85, frizz: 0.02, clumpSize: 8, clumpStrength: 0.2 },
  '1C': { waveAmp: 0.004, wavePeriod: 0.1, curlRadius: 0, curlPitch: 0.1, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.8, frizz: 0.04, clumpSize: 8, clumpStrength: 0.25 },
  '2A': { waveAmp: 0.006, wavePeriod: 0.07, curlRadius: 0, curlPitch: 0.1, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.75, frizz: 0.04, clumpSize: 10, clumpStrength: 0.35 },
  '2B': { waveAmp: 0.01, wavePeriod: 0.055, curlRadius: 0, curlPitch: 0.1, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.7, frizz: 0.06, clumpSize: 12, clumpStrength: 0.45 },
  '2C': { waveAmp: 0.014, wavePeriod: 0.045, curlRadius: 0.002, curlPitch: 0.045, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.65, frizz: 0.1, clumpSize: 14, clumpStrength: 0.5 },
  '3A': { waveAmp: 0, wavePeriod: 0.05, curlRadius: 0.014, curlPitch: 0.05, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.6, frizz: 0.08, clumpSize: 16, clumpStrength: 0.65 },
  '3B': { waveAmp: 0, wavePeriod: 0.05, curlRadius: 0.009, curlPitch: 0.032, coilRadius: 0, coilPitch: 0.01, kink: 0, ellipticity: 0.55, frizz: 0.1, clumpSize: 16, clumpStrength: 0.7 },
  '3C': { waveAmp: 0, wavePeriod: 0.05, curlRadius: 0.006, curlPitch: 0.022, coilRadius: 0.0012, coilPitch: 0.006, kink: 0, ellipticity: 0.5, frizz: 0.14, clumpSize: 14, clumpStrength: 0.7 },
  '4A': { waveAmp: 0.004, wavePeriod: 0.04, curlRadius: 0.004, curlPitch: 0.012, coilRadius: 0.0018, coilPitch: 0.005, kink: 0.1, ellipticity: 0.45, frizz: 0.2, clumpSize: 10, clumpStrength: 0.6 },
  '4B': { waveAmp: 0.006, wavePeriod: 0.03, curlRadius: 0.003, curlPitch: 0.01, coilRadius: 0.0014, coilPitch: 0.004, kink: 0.6, ellipticity: 0.4, frizz: 0.3, clumpSize: 6, clumpStrength: 0.4 },
  '4C': { waveAmp: 0.006, wavePeriod: 0.025, curlRadius: 0.0025, curlPitch: 0.008, coilRadius: 0.0011, coilPitch: 0.003, kink: 0.9, ellipticity: 0.35, frizz: 0.4, clumpSize: 4, clumpStrength: 0.3 },
};

export function applyCurlType(shape: ShapeParams, type: CurlType): void {
  Object.assign(shape, CURL_TYPES[type]);
}

/** Natural pigment presets (eumelanin, pheomelanin). */
export const PIGMENTS = {
  black: [8, 0.5],
  darkBrown: [3.5, 0.4],
  brown: [1.3, 0.3],
  lightBrown: [0.65, 0.3],
  darkBlonde: [0.4, 0.3],
  blonde: [0.18, 0.12],
  platinum: [0.04, 0.03],
  auburn: [0.9, 1.6],
  red: [0.3, 2.4],
  strawberry: [0.15, 1.0],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * Factor by which a micro coil shortens the visible centerline:
 * a helix of radius r and pitch p has arc length sqrt(1 + (2πr/p)²) per unit axis.
 */
export function coilShrink(radius: number, pitch: number): number {
  if (radius <= 0) return 1;
  return 1 / Math.sqrt(1 + ((2 * Math.PI * radius) / Math.max(pitch, 1e-5)) ** 2);
}
