import { createReasoningStars, reasoningParticleLayers, writeFastReasoningStars, writeReasoningStars,
  type ReasoningParticleTransition } from './reasoning-starfield-model';

// A local decorative material, independent of the application's theme owner.
const COLORS = new Float32Array([
  .592, .388, .945, .831, .710, .953, .286, 0, .404, .145, .055, .478,
  .592, 0, .996, .780, .459, .914, .725, .576, 1, .400, .212, .820,
  .882, .690, 1, .498, .345, .957, .659, .275, .910, .212, .063, .400,
]);

// x/y centers, excursion and frequency, then the brightness frequency.
const FIELDS = [
  [.18, .36, .18, .42, .42, .50, .91], [.34, .62, .24, .38, .62, .47, 1.07],
  [.52, .30, .28, .36, .38, .58, .76], [.70, .68, .24, .36, .54, .41, 1.18],
  [.88, .36, .16, .40, .74, .64, 1.03], [.12, .72, .20, .30, .48, .70, .83],
  [.30, .44, .22, .42, .58, .52, 1.24], [.46, .72, .26, .32, .68, .56, .96],
  [.60, .26, .28, .38, .44, .60, 1.11], [.76, .54, .22, .40, .50, .66, .72],
  [.92, .66, .15, .30, .70, .46, 1.29], [.06, .32, .14, .40, .40, .60, .88],
];

const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;

const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform float elapsed;
uniform float showField;
uniform vec3 particleLayers;
uniform vec3 colors[12];
uniform vec3 fields[12];
uniform vec4 stars[14];
uniform vec4 fastStars[14];
void main() {
  vec2 point = vec2(uv.x * 1.55, .40 + uv.y * .18);
  vec3 mixed = vec3(0.);
  float total = 0.;
  for (int i = 0; i < 12; i++) {
    vec2 delta = point - fields[i].xy;
    float weight = exp(-dot(delta, delta) * 12.) * fields[i].z;
    mixed += colors[i] * weight;
    total += weight;
  }
  vec3 color = pow(clamp(mix(colors[3], mixed / max(total, .0001), .96), 0., 1.), vec3(.9));
  float grain = fract(sin(dot(uv * resolution * .5 + elapsed, vec2(12.9898, 78.233))) * 43758.5453) * 2. - 1.;
  color += grain * .012 + vec3(sin(elapsed * .5), cos(elapsed * .7), sin(elapsed * .6)) * .02;
  color = pow(max(color, vec3(0.)), vec3(.92));
  color *= showField;
  float alpha = showField;
  vec2 pixel = vec2(uv.x, 1. - uv.y) * resolution;
  for (int i = 0; i < 14; i++) {
    float starDistance = length(pixel - stars[i].xy - vec2(particleLayers.y, 0.));
    float dotAlpha = 1. - smoothstep(max(0., stars[i].z - .4), stars[i].z + .4, starDistance);
    float halo = exp(-starDistance * starDistance / 7.) * .34;
    float opacity = (1. - (1. - dotAlpha * .72) * (1. - halo)) * stars[i].w * particleLayers.x;
    color = mix(color, vec3(1.), opacity);
    alpha += (1. - alpha) * opacity;
  }
  for (int i = 0; i < 14; i++) {
    float starDistance = length(pixel - fastStars[i].xy);
    float dotAlpha = 1. - smoothstep(max(0., fastStars[i].z - .4), fastStars[i].z + .4, starDistance);
    float halo = exp(-starDistance * starDistance / 7.) * .34;
    float opacity = (1. - (1. - dotAlpha * .72) * (1. - halo)) * fastStars[i].w * particleLayers.z;
    color = mix(color, vec3(1.), opacity);
    alpha += (1. - alpha) * opacity;
  }
  gl_FragColor = vec4(color, alpha);
}
`;

export interface ReasoningStarfieldMode { maximum: boolean; fastMode: boolean; reducedMotion: boolean }
export interface ReasoningStarfieldRenderer {
  draw: (seconds: number, width: number, height: number, mode: ReasoningStarfieldMode) => boolean;
  dispose: () => void;
}

export function createReasoningStarfieldRenderer(canvas: HTMLCanvasElement): ReasoningStarfieldRenderer | undefined {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return undefined;
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const dispose = () => {
    shaders.forEach(shader => gl.deleteShader(shader));
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
  };
  if (!program || !buffer) { dispose(); return undefined; }
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type);
    if (!shader) { dispose(); return undefined; }
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { dispose(); return undefined; }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { dispose(); return undefined; }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['colors', 'fields', 'stars', 'fastStars', 'resolution', 'elapsed', 'showField', 'particleLayers']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  gl.uniform3fv(uniforms.colors, COLORS);
  const stars = createReasoningStars();
  const starBuffer = new Float32Array(stars.length * 4);
  const fastStarBuffer = new Float32Array(stars.length * 4);
  const layerBuffer = new Float32Array(3);
  const fieldBuffer = new Float32Array(FIELDS.length * 3);
  let transition: ReasoningParticleTransition | undefined;
  let fastStartedAt = 0;
  let fastStartPercent = 0;
  return {
    dispose,
    draw(seconds, width, height, mode) {
      if (!transition) transition = { enabled: mode.fastMode, changedAt: null };
      else if (transition.enabled !== mode.fastMode) {
        const currentLayers = reasoningParticleLayers(transition, seconds, mode.maximum);
        transition = { enabled: mode.fastMode, changedAt: mode.reducedMotion ? null : seconds, fastOpacityFrom: currentLayers.fastOpacity };
        if (mode.fastMode) { fastStartedAt = seconds; fastStartPercent = mode.maximum ? 100 : 0; }
      }
      const layers = reasoningParticleLayers(transition, seconds, mode.maximum);
      FIELDS.forEach(([x, y, dx, dy, fx, fy, brightness], index) => {
        const phase = index % 2 ? Math.PI / 2 : 0;
        fieldBuffer[index * 3] = (x + Math.sin(seconds * 1.25 * fx + phase) * dx) * 1.55;
        fieldBuffer[index * 3 + 1] = y + Math.cos(seconds * 1.25 * fy - phase) * dy;
        fieldBuffer[index * 3 + 2] = .7 + .3 * Math.sin(seconds * brightness + phase);
      });
      writeReasoningStars(stars, seconds, width, height, starBuffer);
      writeFastReasoningStars(seconds - fastStartedAt, width, height, fastStartPercent, fastStarBuffer);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform1f(uniforms.elapsed, seconds);
      gl.uniform1f(uniforms.showField, mode.maximum ? 1 : 0);
      layerBuffer[0] = mode.reducedMotion ? 0 : layers.ordinaryOpacity;
      layerBuffer[1] = mode.reducedMotion ? 0 : layers.ordinaryOffset;
      layerBuffer[2] = mode.reducedMotion ? 0 : layers.fastOpacity;
      gl.uniform3fv(uniforms.particleLayers, layerBuffer);
      gl.uniform3fv(uniforms.fields, fieldBuffer);
      gl.uniform4fv(uniforms.stars, starBuffer);
      gl.uniform4fv(uniforms.fastStars, fastStarBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return !mode.reducedMotion && (mode.maximum || mode.fastMode || layers.fastOpacity > 0);
    },
  };
}
