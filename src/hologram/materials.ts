import { AdditiveBlending, Color, DoubleSide, LessEqualDepth, ShaderMaterial } from 'three';

/**
 * Holographic look for the skinned body and the equipment: fresnel rim glow,
 * soft inner shading from a key light (so the body reads as a volume), thin
 * contour lines in rest space that follow the skin as it moves (a "muscle
 * wireframe"), moving scanlines and a global flicker. Rendered additively
 * after a depth-only pre-pass, so only the front-most surface glows.
 */
const HOLO_VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform float uBreath;
  uniform float uChestBone;
  uniform float uSpineBone;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  varying vec3 vRest;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    vRest = position;
    #ifdef USE_SKINNING
      // Breathing: the rib cage expands along its normals.
      float chest = dot(skinWeight, vec4(equal(skinIndex, vec4(uChestBone))))
        + 0.6 * dot(skinWeight, vec4(equal(skinIndex, vec4(uSpineBone))));
      transformed += normal * chest * uBreath * 0.009;
    #endif
    #include <skinning_vertex>
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * objectNormal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vWorld = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlicker;
  uniform float uOpacity;
  uniform float uFade;
  uniform float uContours;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  varying vec3 vRest;
  void main() {
    vec3 n = normalize(vNormalW);
    float facing = abs(dot(n, normalize(vViewDir)));
    float fresnel = pow(1.0 - facing, 2.0);
    // Key light from the upper front-left gives the volume some shading.
    float key = max(dot(n, normalize(vec3(-0.4, 0.8, 0.6))), 0.0);
    float fill = max(dot(n, normalize(vec3(0.6, -0.2, -0.5))), 0.0);
    float shade = 0.1 + 0.42 * key + 0.12 * fill;
    // Contour lines in rest space (anti-aliased with screen-space derivatives).
    float coord = vRest.y * 38.0;
    float line = abs(fract(coord) - 0.5) / max(fwidth(coord), 1e-4);
    float contour = (1.0 - min(line, 1.0)) * uContours * (0.35 + 0.65 * key);
    float scan = 0.8 + 0.2 * sin(vWorld.y * 150.0 - uTime * 5.0);
    float band = smoothstep(0.0, 0.05, abs(fract(vWorld.y * 0.6 - uTime * 0.25) - 0.5));
    float glow = shade + 0.95 * fresnel + 0.28 * contour;
    float alpha = glow * scan * mix(1.5, 1.0, band) * uFlicker * uOpacity * uFade;
    vec3 color = uColor * (0.5 + 0.9 * fresnel + 0.5 * key) + vec3(0.25, 0.5, 0.55) * contour;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

export interface HoloOptions {
  opacity?: number;
  /** Rest-space contour lines (body only). */
  contours?: boolean;
  chestBone?: number;
  spineBone?: number;
}

export function createHoloMaterial(color = '#38e8ff', options: HoloOptions = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uFlicker: { value: 1 },
      uOpacity: { value: options.opacity ?? 1 },
      uFade: { value: 1 },
      uBreath: { value: 0 },
      uContours: { value: options.contours ? 1 : 0 },
      uChestBone: { value: options.chestBone ?? -1 },
      uSpineBone: { value: options.spineBone ?? -1 },
    },
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthFunc: LessEqualDepth,
    blending: AdditiveBlending,
  });
}

/**
 * Depth-only pre-pass (same vertex shader, so skinning matches exactly):
 * hides the far side of the body and anything behind it.
 */
export function createDepthMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBreath: { value: 0 },
      uChestBone: { value: -1 },
      uSpineBone: { value: -1 },
    },
    vertexShader: HOLO_VERTEX,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
    colorWrite: false,
    // Pushed back slightly so the glowing surface always passes against its own depth.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
}

const DISC_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Radial glow for the projector base disc. */
const DISC_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, r) * 0.45;
    float ring = smoothstep(0.035, 0.0, abs(r - 0.92)) * 0.9;
    float ripple = smoothstep(0.03, 0.0, abs(r - fract(uTime * 0.35))) * 0.35 * (1.0 - r);
    float grid = step(0.94, fract(r * 8.0)) * 0.12 * (1.0 - r);
    gl_FragColor = vec4(uColor, (core + ring + ripple + grid) * step(r, 1.0));
  }
`;

export function createDiscMaterial(color = '#38e8ff'): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 } },
    vertexShader: DISC_VERTEX,
    fragmentShader: DISC_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** Vertical light beam rising from the disc, fading upwards. */
const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 2.5) * 0.22;
    gl_FragColor = vec4(uColor, fade);
  }
`;

export function createBeamMaterial(color = '#38e8ff'): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) } },
    vertexShader: DISC_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}
