// T0's post pass (spec §7): one fullscreen fragment shader over the composited scene — a 4×4 Bayer dither, a cheap
// bloom of the light layer (L3) and a light vignette. No library; if anything fails the plain canvas stays.
import type { Hero } from './main';

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uGlow;
uniform vec2 uSize;
uniform vec4 uGlowRect;
in vec2 vUv;
out vec4 outColor;
const float B[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(',')});
float bayer(vec2 p) { ivec2 i = ivec2(mod(p, 4.0)); return B[i.y * 4 + i.x] / 16.0 - 0.5; }
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 g = (px - uGlowRect.xy) / uGlowRect.zw;
  vec3 bloom = vec3(0.0);
  vec2 step = 3.0 / vec2(textureSize(uGlow, 0));
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    float w = exp(-float(x * x + y * y) / 4.0);
    bloom += texture(uGlow, vec2(g.x, 1.0 - g.y) + vec2(x, y) * step).rgb * w;
  }
  c += bloom / 10.85 * 0.55;
  c += bayer(gl_FragCoord.xy) / 48.0;
  vec2 d = vUv - 0.5;
  float vignette = 1.0 - dot(d, d) * 0.55;
  outColor = vec4(c * vignette, 1.0);
}`;

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

function texture(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function installPost(hero: Hero): boolean {
  const paint = hero.renderer.paint;
  const glow = hero.renderer.layers[3];
  const out = document.createElement('canvas');
  out.className = 'scene-post';
  out.setAttribute('aria-hidden', 'true');
  const gl = out.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) return false;
  const vs = shader(gl, gl.VERTEX_SHADER, VERTEX), fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return false;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uSize = gl.getUniformLocation(prog, 'uSize'), uRect = gl.getUniformLocation(prog, 'uGlowRect');
  gl.uniform1i(gl.getUniformLocation(prog, 'uScene'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uGlow'), 1);
  const tScene = texture(gl, gl.NEAREST), tGlow = texture(gl, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  let alive = true;
  out.addEventListener('webglcontextlost', (e) => { e.preventDefault(); alive = false; out.remove(); paint.style.visibility = ''; });
  paint.after(out);
  paint.style.visibility = 'hidden';

  hero.onFrame.push(() => {
    if (!alive) return;
    if (out.width !== paint.width || out.height !== paint.height) { out.width = paint.width; out.height = paint.height; }
    gl.viewport(0, 0, out.width, out.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tScene);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tGlow);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glow);
    const r = hero.renderer.glowRect;
    gl.uniform2f(uSize, out.width, out.height);
    gl.uniform4f(uRect, r.x, r.y, r.w, r.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });
  return true;
}
