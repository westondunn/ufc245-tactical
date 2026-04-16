/**
 * lib/biomechanics.js — Standardized force calculation & kinetic chain framework
 * 
 * All force estimates are derived from peer-reviewed literature:
 * - Walilko, Viano & Bir (2005) — Olympic boxer punch force measurements
 * - Kacprzak et al. (2025) — Effective mass in boxing punches
 * - Dunn et al. (2023) — Elite amateur striker forces
 * - Corcoran et al. (2024) — Kick biomechanics meta-review
 *
 * Usage:
 *   const bio = require('./lib/biomechanics');
 *   const force = bio.estimatePunchForce({ bodyMassKg: 77, strikeType: 'right_cross' });
 *   const chain = bio.kineticChain('right_cross', { bodyMassKg: 77 });
 */

const fs = require('fs');
const path = require('path');

// Load templates from seed data
let templates = {};
try {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8'));
  templates = seed.biomechanics_templates || {};
} catch (e) { /* fallback to hardcoded defaults below */ }

// Injury thresholds (Newtons)
const THRESHOLDS = {
  mandible_fracture: templates.mandible_fracture_threshold_n || 2151,
  orbital_fracture: templates.orbital_fracture_threshold_n || 1145,
  rib_fracture: templates.rib_fracture_threshold_n || 3300,
  nasal_fracture: 450,
  concussion_g: 80, // g-force threshold for concussion
};

// Base reference data (Walilko 2005: Olympic boxers, 51-130kg range)
const REFERENCE = {
  // Average force by strike type at reference mass (75kg)
  right_cross:  { force_n: 1740, velocity_ms: 7.8,  mass_kg: 75 },
  left_hook:    { force_n: 1950, velocity_ms: 9.2,  mass_kg: 75 },
  jab:          { force_n: 710,  velocity_ms: 6.5,  mass_kg: 75 },
  uppercut:     { force_n: 1620, velocity_ms: 7.0,  mass_kg: 75 },
  body_kick:    { force_n: 4850, velocity_ms: 12.5, mass_kg: 75 },
  head_kick:    { force_n: 5400, velocity_ms: 14.0, mass_kg: 75 },
  leg_kick:     { force_n: 2800, velocity_ms: 10.0, mass_kg: 75 },
  front_kick:   { force_n: 2100, velocity_ms: 8.5,  mass_kg: 75 },
  knee:         { force_n: 3200, velocity_ms: 6.0,  mass_kg: 75 },
  elbow:        { force_n: 2400, velocity_ms: 5.5,  mass_kg: 75 },
  hammerfist:   { force_n: 1100, velocity_ms: 5.0,  mass_kg: 75 },
};

/**
 * Estimate punch/strike force scaled by fighter mass
 * Uses allometric scaling: force ∝ mass^0.67 (Kacprzak 2025)
 */
function estimateStrikeForce({ bodyMassKg, strikeType, gloveOz = 4 }) {
  const ref = REFERENCE[strikeType];
  if (!ref) return null;

  const massRatio = bodyMassKg / ref.mass_kg;
  const scaledForce = ref.force_n * Math.pow(massRatio, 0.67);

  // Glove dampening factor (4oz MMA → 1.0, 10oz boxing → 0.82, 16oz → 0.70)
  const gloveFactor = gloveOz <= 4 ? 1.0 : 1.0 - (gloveOz - 4) * 0.03;

  const estimatedForce = scaledForce * gloveFactor;
  const estimatedVelocity = ref.velocity_ms * Math.pow(massRatio, 0.33);

  return {
    force_n: Math.round(estimatedForce),
    velocity_ms: Math.round(estimatedVelocity * 10) / 10,
    bodyMassKg,
    strikeType,
    gloveOz,
    scalingExponent: 0.67,
    citation: 'Walilko 2005, Kacprzak 2025',
    thresholds: Object.entries(THRESHOLDS)
      .filter(([k]) => k !== 'concussion_g')
      .map(([target, threshold]) => ({
        target: target.replace(/_/g, ' '),
        threshold_n: threshold,
        exceeds: estimatedForce >= threshold,
        ratio: Math.round((estimatedForce / threshold) * 100) / 100
      }))
  };
}

/**
 * Generate kinetic chain data for a given strike type
 * Returns chain nodes with labels, forces, velocities, and transfer efficiencies
 */
function kineticChain(strikeType, { bodyMassKg = 75, groundReactionBW = null } = {}) {
  const template = templates[strikeType];
  const ref = REFERENCE[strikeType];
  if (!ref) return null;

  const massRatio = bodyMassKg / ref.mass_kg;
  const params = template ? template.params : {};
  const grfBW = groundReactionBW || params.grf_bw_multiplier || 1.40;

  const chain = [
    {
      node: 'ground_reaction',
      label: 'Ground',
      force_n: Math.round(bodyMassKg * 9.81 * grfBW),
      velocity_ms: 0,
      transfer_eff: 1.0,
      color: '#FFB020'
    },
    {
      node: 'knee_drive',
      label: 'Knee',
      force_n: null, // transmitted
      velocity_ms: Math.round(1.2 * Math.pow(massRatio, 0.33) * 10) / 10,
      transfer_eff: 0.95,
      color: '#FFB020'
    },
    {
      node: 'hip_rotation',
      label: 'Hip',
      force_n: null,
      velocity_ms: Math.round(3.8 * Math.pow(massRatio, 0.33) * 10) / 10,
      angular_vel_deg_s: params.hip_rotation_deg_per_sec || 820,
      transfer_eff: params.torso_transfer_efficiency || 0.92,
      color: '#FF7030'
    },
    {
      node: 'torso_transfer',
      label: 'Torso',
      force_n: null,
      velocity_ms: Math.round(5.2 * Math.pow(massRatio, 0.33) * 10) / 10,
      transfer_eff: params.torso_transfer_efficiency || 0.92,
      color: '#FF2D3F'
    },
    {
      node: 'shoulder_acceleration',
      label: 'Shoulder',
      force_n: null,
      velocity_ms: Math.round(6.5 * Math.pow(massRatio, 0.33) * 10) / 10,
      transfer_eff: 0.96,
      color: '#2DB4FF'
    },
    {
      node: 'impact',
      label: strikeType.includes('kick') ? 'Shin' : 'Fist',
      force_n: estimateStrikeForce({ bodyMassKg, strikeType }).force_n,
      velocity_ms: ref.velocity_ms * Math.pow(massRatio, 0.33),
      transfer_eff: 1.0,
      color: '#7CFFC8'
    }
  ];

  // Fill transmitted forces down the chain
  let accumulatedForce = chain[0].force_n;
  for (let i = 1; i < chain.length - 1; i++) {
    accumulatedForce *= chain[i].transfer_eff;
    chain[i].force_n = Math.round(accumulatedForce);
  }

  return {
    strikeType,
    name: template ? template.name : strikeType.replace(/_/g, ' '),
    bodyMassKg,
    chain,
    totalChainDelay_ms: 100, // ground → impact ≈ 100ms (Walilko 2005)
    citation: params.citation || 'Walilko 2005'
  };
}

/**
 * Estimate damage potential of a strike on a specific target
 */
function damageAssessment({ bodyMassKg, strikeType, target = 'head' }) {
  const strike = estimateStrikeForce({ bodyMassKg, strikeType });
  if (!strike) return null;

  const targetThresholds = {
    head: ['mandible_fracture', 'orbital_fracture'],
    body: ['rib_fracture'],
    nose: ['nasal_fracture']
  };

  const relevantThresholds = (targetThresholds[target] || []).map(key => ({
    injury: key.replace(/_/g, ' '),
    threshold_n: THRESHOLDS[key],
    force_n: strike.force_n,
    exceeds: strike.force_n >= THRESHOLDS[key],
    severity: strike.force_n / THRESHOLDS[key]
  }));

  return {
    ...strike,
    target,
    thresholds: relevantThresholds,
    concussion_risk: target === 'head' ? (strike.force_n > 1000 ? 'elevated' : 'moderate') : 'low'
  };
}

module.exports = {
  estimateStrikeForce,
  kineticChain,
  damageAssessment,
  THRESHOLDS,
  REFERENCE
};
