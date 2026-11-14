// Recombines the packed [colour | matte] face frame into a transparent cutout.
import * as THREE from 'three';

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D map;
  uniform float mirror;
  uniform float enhance;
  uniform float fade;
  uniform float grey;
  uniform vec3 tint;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    if (mirror > 0.5) uv.x = 1.0 - uv.x;
    // Left half is colour, right half is the matte. Stay clear of the seam.
    vec2 cuv = vec2(clamp(uv.x * 0.5, 0.004, 0.496), uv.y);
    vec3 col = texture2D(map, cuv).rgb;
    vec2 muv = cuv + vec2(0.5, 0.0);
    float t = 0.006;
    float a = texture2D(map, muv).r * 0.4
            + texture2D(map, vec2(clamp(muv.x + t, 0.504, 0.996), muv.y)).r * 0.15
            + texture2D(map, vec2(clamp(muv.x - t, 0.504, 0.996), muv.y)).r * 0.15
            + texture2D(map, muv + vec2(0.0, t * 2.0)).r * 0.15
            + texture2D(map, muv - vec2(0.0, t * 2.0)).r * 0.15;
    a = smoothstep(0.32, 0.68, a);
    // Feather the outer frame so very big hair or a hat never ends in a hard crop line.
    vec2 edge = smoothstep(vec2(0.0), vec2(0.07), vUv) * smoothstep(vec2(0.0), vec2(0.07), 1.0 - vUv);
    a *= edge.x * edge.y;

    // Optional "studio light": a gentle lift and warmth. It grades the real
    // pixels; it never reshapes or replaces the face.
    vec3 lit = col * 1.07 + 0.015;
    lit = mix(vec3(dot(lit, vec3(0.299, 0.587, 0.114))), lit, 1.08);
    col = mix(col, lit, enhance);
    col *= tint;
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))) * 0.75, grey);

    gl_FragColor = vec4(col, a * fade);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

export function createFaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: null },
      mirror: { value: 0 },
      enhance: { value: 0 },
      fade: { value: 0 },
      grey: { value: 0 },
      tint: { value: new THREE.Color(1, 0.97, 0.93) },
    },
  });
}

export type FaceSource = { kind: 'canvas'; canvas: HTMLCanvasElement; live: () => boolean } | { kind: 'video'; el: HTMLVideoElement };

/** Builds a raw (non colour-managed) texture so the matte half is read linearly. */
export function createFaceTexture(source: FaceSource): THREE.Texture {
  const tex = source.kind === 'canvas' ? new THREE.CanvasTexture(source.canvas) : new THREE.VideoTexture(source.el);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
