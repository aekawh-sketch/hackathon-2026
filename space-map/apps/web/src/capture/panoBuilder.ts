// Сборка фотосферы на телефоне (ТЗ 5.5, «склеено по датчикам»): каждый кадр камеры WebXR раскладывается
// на равнопромежуточную панораму 2:1 по повороту камеры из ARCore. Кадр «подкладывается под» уже снятое:
// в каждом месте главный — первый кадр, следующие закрывают только пустое, с мягким краем — без резких швов.
// Дыры (обычно под ногами) не заливаем и не дорисовываем (ТЗ 4.3) — они остаются тёмными.
import * as THREE from 'three';

/** Ширина панорамы: как у готовых панорам на сервере. */
const WIDTH = 4096;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Пиксель панорамы → направление в мире → точка в кадре камеры. Центр панорамы — вперёд (−z), верх — зенит.
const STAMP = /* glsl */ `
uniform sampler2D tCam;
uniform mat3 uWorldToCam;
uniform mat4 uProj;
varying vec2 vUv;
const float PI = 3.141592653589793;
void main() {
  float lon = (vUv.x - 0.5) * 2.0 * PI;
  float lat = (vUv.y - 0.5) * PI;
  vec3 dir = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
  vec3 c = uWorldToCam * dir;
  if (c.z > -0.01) discard;
  vec4 clip = uProj * vec4(c * 10.0, 1.0);
  vec2 ndc = clip.xy / clip.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) discard;
  float edge = min(1.0 - abs(ndc.x), 1.0 - abs(ndc.y));
  float w = smoothstep(0.0, 0.3, edge);
  vec3 color = texture2D(tCam, ndc * 0.5 + 0.5).rgb;
  gl_FragColor = vec4(color * w, w);
}`;

// Накопленное (цвет × вес, вес) → обычный цвет; пустое — тёмно-серое.
const RESOLVE = /* glsl */ `
uniform sampler2D tAcc;
varying vec2 vUv;
void main() {
  vec4 a = texture2D(tAcc, vUv);
  gl_FragColor = a.a > 0.004 ? vec4(a.rgb / a.a, 1.0) : vec4(0.12, 0.14, 0.18, 1.0);
}`;

export class PanoBuilder {
  frames = 0;
  readonly width: number;
  readonly height: number;
  private readonly acc: THREE.WebGLRenderTarget;
  private readonly stampMaterial: THREE.ShaderMaterial;
  private readonly resolveMaterial: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.width = Math.min(WIDTH, renderer.capabilities.maxTextureSize);
    this.height = this.width / 2;
    this.acc = new THREE.WebGLRenderTarget(this.width, this.height, { depthBuffer: false, type: THREE.UnsignedByteType });
    this.stampMaterial = new THREE.ShaderMaterial({
      uniforms: { tCam: { value: null }, uWorldToCam: { value: new THREE.Matrix3() }, uProj: { value: new THREE.Matrix4() } },
      vertexShader: VERTEX,
      fragmentShader: STAMP,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // «Под»: новый кадр ложится только туда, где ещё пусто (1 − альфа уже накопленного).
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneMinusDstAlphaFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneMinusDstAlphaFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.resolveMaterial = new THREE.ShaderMaterial({
      uniforms: { tAcc: { value: this.acc.texture } },
      vertexShader: VERTEX,
      fragmentShader: RESOLVE,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.stampMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.clear();
  }

  /** Положить кадр на сферу. Только внутри кадра WebXR: текстура камеры живёт до его конца. */
  stamp(camera: THREE.Texture, orientation: THREE.Quaternion, projection: THREE.Matrix4): void {
    const u = this.stampMaterial.uniforms;
    u.tCam!.value = camera;
    (u.uWorldToCam!.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(orientation.clone().invert()));
    (u.uProj!.value as THREE.Matrix4).copy(projection);
    this.quad.material = this.stampMaterial;
    this.offscreen(this.acc, false);
    this.frames++;
  }

  clear(): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const color = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.acc);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(color, alpha);
    r.setRenderTarget(prev);
    this.frames = 0;
  }

  /** Готовая панорама JPEG 2:1. Верх картинки — зенит. */
  async toBlob(quality = 0.9): Promise<Blob> {
    const out = new THREE.WebGLRenderTarget(this.width, this.height, { depthBuffer: false });
    this.quad.material = this.resolveMaterial;
    this.offscreen(out, true);
    const pixels = new Uint8Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(out, 0, 0, this.width, this.height, pixels);
    out.dispose();
    // В WebGL первая строка — низ; в картинке первой должна быть верхняя.
    const image = new ImageData(this.width, this.height);
    const row = this.width * 4;
    for (let y = 0; y < this.height; y++) image.data.set(pixels.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row);
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сохранить снимок'))), 'image/jpeg', quality));
  }

  dispose(): void {
    this.acc.dispose();
    this.stampMaterial.dispose();
    this.resolveMaterial.dispose();
    this.quad.geometry.dispose();
  }

  /** Отрисовка в свою текстуру посреди кадра WebXR: без камеры XR, без очистки, с возвратом прежней цели. */
  private offscreen(target: THREE.WebGLRenderTarget, clear: boolean): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const xr = r.xr.enabled;
    const autoClear = r.autoClear;
    r.xr.enabled = false;
    r.autoClear = clear;
    r.setRenderTarget(target);
    r.render(this.scene, this.ortho);
    r.setRenderTarget(prev);
    r.autoClear = autoClear;
    r.xr.enabled = xr;
  }
}
