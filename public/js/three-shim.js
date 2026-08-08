// three >= 0.180 no longer ships a UMD build/three.min.js; load the ES
// module and expose the global that app.js's classic script expects.
// External file (not inline) because CSP is script-src 'self'.
// Module scripts are deferred, so announce readiness for late init.
import * as THREE from '/vendor/three/three.module.min.js';
window.THREE = THREE;
window.dispatchEvent(new Event('three:ready'));
