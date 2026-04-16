# Biomechanics Analysis

Generate a biomechanics breakdown for a specific fighter and strike type.

## Usage

Tell me the fighter name and strike type, and I'll use the biomechanics framework to generate force estimates, kinetic chain data, and injury threshold analysis.

## Available Strike Types

- `right_cross` — straight right hand
- `left_hook` — lead hook
- `jab` — lead straight
- `uppercut` — rear uppercut
- `body_kick` — roundhouse to body
- `head_kick` — roundhouse to head
- `leg_kick` — low kick to thigh/calf
- `front_kick` — teep/push kick
- `knee` — clinch knee
- `elbow` — short elbow strike
- `hammerfist` — ground and pound

## Framework Usage

```javascript
const bio = require('./lib/biomechanics');

// Estimate force for a specific strike
const result = bio.estimateStrikeForce({
  bodyMassKg: 77,        // fighter weight in kg
  strikeType: 'right_cross',
  gloveOz: 4             // 4oz MMA, 10oz boxing, 16oz training
});

// Generate full kinetic chain
const chain = bio.kineticChain('right_cross', { bodyMassKg: 77 });

// Damage assessment against specific target
const damage = bio.damageAssessment({
  bodyMassKg: 77,
  strikeType: 'right_cross',
  target: 'head'  // head, body, nose
});
```

## API Endpoints

```
GET /api/biomechanics/estimate?mass=77&strike=right_cross&target=head
GET /api/biomechanics/chain?mass=77&strike=body_kick
GET /api/biomechanics/strikes   (list all available types + thresholds)
```

## Citation Requirements

Every force estimate must reference its source:
- Walilko, Viano & Bir (2005) — Olympic boxer punch force (Br J Sports Med)
- Kacprzak et al. (2025) — Effective mass scaling exponent
- Dunn et al. (2023) — Elite amateur striker forces (PLOS ONE)
- Corcoran et al. (2024) — Kick biomechanics meta-review
