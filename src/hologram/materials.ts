import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';

/**
 * Holographic look: fresnel rim glow, moving scanlines and a global flicker,
 * rendered additively so overlapping limbs glow brighter.
 */
const HOLO_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vWorldY;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vWorldY = worldPos.y;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlicker;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vWorldY;
  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewDir)));
    float fresnel = pow(1.0 - facing, 2.2);
    float scan = 0.72 + 0.28 * sin(vWorldY * 140.0 - uTime * 5.0);
    float band = smoothstep(0.0, 0.04, abs(fract(vWorldY * 0.6 - uTime * 0.25) - 0.5));
    float glow = 0.16 + 0.95 * fresnel;
    float alpha = glow * scan * mix(1.6, 1.0, band) * uFlicker * uOpacity;
    gl_FragColor = vec4(uColor * (0.55 + 1.3 * fresnel), clamp(alpha, 0.0, 1.0));
  }
`;

export function createHoloMaterial(color = '#38e8ff', opacity = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uFlicker: { value: 1 },
      uOpacity: { value: opacity },
    },
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
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
