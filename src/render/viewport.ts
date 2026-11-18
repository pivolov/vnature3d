import {
  AmbientLight, BoxHelper, Color, DirectionalLight, DoubleSide, FrontSide, BufferGeometry, GridHelper, Mesh, MeshPhysicalMaterial, NeutralToneMapping,
  OrthographicCamera, PerspectiveCamera, PMREMGenerator, Raycaster, Scene, Vector2, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { materials, type Layer, type Project, type Vec3 } from '../core/project';

type Callbacks = {
  select: (id: string) => void;
  move: (id: string, position: Vec3) => void;
  orbit: (position: Vec3, target: Vec3, zoom: number) => void;
};

import { effectiveLayer } from '../core/layers';
import { extrudeLayer } from '../geometry/extrusion';

const lighting = {
  studio: { ambient: 1.4, key: 3, fill: 1.1, rim: 2.1, tint: '#ffffff' },
  soft: { ambient: 2, key: 1.6, fill: 1.2, rim: 0.8, tint: '#ffffff' },
  dramatic: { ambient: 0.35, key: 4.3, fill: 0.2, rim: 3, tint: '#ffd2aa' },
  neon: { ambient: 0.65, key: 2.1, fill: 1.2, rim: 4, tint: '#ed6eff' },
};

function sameVector(a: Vec3, b: Vec3) {
  return a.every((value, i) => Math.abs(value - b[i]) < 1e-6);
}

export function mountViewport(host: HTMLDivElement, callbacks: Callbacks) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Трёхмерный предпросмотр');
  renderer.domElement.setAttribute('role', 'img');

  const scene = new Scene();
  const perspective = new PerspectiveCamera(35, 1, 0.05, 100);
  const orthographic = new OrthographicCamera(-3, 3, 3, -3, 0.05, 100);
  let camera: PerspectiveCamera | OrthographicCamera = perspective;
  const orbit = new OrbitControls<PerspectiveCamera | OrthographicCamera>(camera, renderer.domElement);
  orbit.minDistance = 2;
  orbit.maxDistance = 24;
  orbit.minZoom = 0.3;
  orbit.maxZoom = 4;
  const transform = new TransformControls(camera, renderer.domElement);
  transform.setSize(0.74);
  scene.add(transform.getHelper());

  const grid = new GridHelper(24, 48, '#424242', '#272727');
  grid.position.y = -2.2;
  scene.add(grid);
  const ambient = new AmbientLight('#f5f5f5');
  const key = new DirectionalLight('#fffaf4');
  key.position.set(3, 5, 5);
  const fill = new DirectionalLight('#ededed');
  fill.position.set(-4, 1, 4);
  const rim = new DirectionalLight();
  rim.position.set(1, 3, -5);
  scene.add(ambient, key, fill, rim);

  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.82;
  room.dispose();
  pmrem.dispose();

  const meshes = new Map<string, { layer: Layer; mesh: Mesh<BufferGeometry, MeshPhysicalMaterial> }>();
  const bounds = new BoxHelper(grid, new Color('#c9ef88'));
  bounds.visible = false;
  scene.add(bounds);
  let selected: Mesh | undefined;
  let lastCamera: Project['camera'] | undefined;
  let gizmo = false;
  let pendingFrame = 0;

  function draw() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      if (selected && bounds.visible) bounds.update();
      renderer.render(scene, camera);
    });
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    perspective.aspect = aspect;
    perspective.fov = aspect >= 1 ? 35 : Math.min(95, 35 / aspect);
    perspective.updateProjectionMatrix();
    const half = Math.max(2.85, 2.85 / aspect);
    orthographic.left = -half * aspect;
    orthographic.right = half * aspect;
    orthographic.top = half;
    orthographic.bottom = -half;
    orthographic.updateProjectionMatrix();
    renderer.setSize(w, h);
    draw();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  orbit.addEventListener('change', draw);
  orbit.addEventListener('end', () => {
    const position = camera.position.toArray();
    const target = orbit.target.toArray();
    if (lastCamera && (!sameVector(lastCamera.position, position) || !sameVector(lastCamera.target, target) || lastCamera.zoom !== camera.zoom)) {
      callbacks.orbit(position, target, camera.zoom);
    }
  });
  transform.addEventListener('change', draw);
  transform.addEventListener('dragging-changed', ({ value }) => { orbit.enabled = !value; });
  transform.addEventListener('mouseUp', () => {
    const object = transform.object;
    if (!object) return;
    const entry = meshes.get(object.name);
    const position = object.position.toArray();
    if (entry && !sameVector(entry.layer.position, position)) callbacks.move(object.name, position);
  });

  const ray = new Raycaster();
  const start = new Vector2();
  let picking = false;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    picking = event.button === 0 && !transform.axis;
    start.set(event.clientX, event.clientY);
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!picking || start.distanceTo(new Vector2(event.clientX, event.clientY)) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new Vector2(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height), camera);
    const hit = ray.intersectObjects([...meshes.values()].map(({ mesh }) => mesh).filter((mesh) => mesh.visible && !meshes.get(mesh.name)?.layer.locked), false)[0];
    if (hit) callbacks.select(hit.object.name);
  });

  return {
    update(project: Project, selectedId: string | null, showGrid: boolean, showGizmo: boolean) {
      if (lastCamera !== project.camera) {
        lastCamera = project.camera;
        camera = project.camera.projection === 'orthographic' ? orthographic : perspective;
        camera.position.set(...project.camera.position);
        camera.zoom = project.camera.zoom;
        camera.updateProjectionMatrix();
        orbit.object = camera;
        orbit.target.set(...project.camera.target);
        orbit.update();
        transform.camera = camera;
      }
      const preset = lighting[project.light];
      ambient.intensity = preset.ambient;
      key.intensity = preset.key;
      fill.intensity = preset.fill;
      rim.intensity = preset.rim;
      rim.color.set(preset.tint);
      grid.visible = showGrid;

      const ids = new Set(project.layers.map((layer) => layer.id));
      for (const [id, { mesh }] of meshes) {
        if (ids.has(id)) continue;
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        meshes.delete(id);
      }
      for (const sourceLayer of project.layers) {
        const layer = effectiveLayer(project, sourceLayer);
        const previous = meshes.get(layer.id);
        if (previous?.layer === layer) continue;
        const mesh = previous?.mesh ?? new Mesh(extrudeLayer(layer), new MeshPhysicalMaterial());
        if (!previous) {
          mesh.name = layer.id;
          scene.add(mesh);
        } else if (previous.layer.shapes !== layer.shapes || previous.layer.relief !== layer.relief || previous.layer.depth !== layer.depth ||
          previous.layer.bevel !== layer.bevel || previous.layer.bevelSegments !== layer.bevelSegments) {
          mesh.geometry.dispose();
          mesh.geometry = extrudeLayer(layer);
        }
        if (!previous || previous.layer.material !== layer.material || previous.layer.color !== layer.color ||
          previous.layer.emissive !== layer.emissive || previous.layer.roughness !== layer.roughness ||
          previous.layer.opacity !== layer.opacity || previous.layer.relief !== layer.relief) {
          const { roughness, metalness, clearcoat } = materials[layer.material];
          const side = layer.relief ? DoubleSide : FrontSide;
          const transparent = layer.opacity < 1;
          if (mesh.material.side !== side || mesh.material.transparent !== transparent) mesh.material.needsUpdate = true;
          mesh.material.setValues({ color: layer.color, emissive: layer.emissive ?? '#000000',
            roughness: layer.roughness ?? roughness, metalness, clearcoat, side, opacity: layer.opacity, transparent, depthWrite: !transparent });
        }
        mesh.position.set(...layer.position);
        mesh.scale.set(...(layer.scale ?? [1, 1, 1]));
        mesh.rotation.set(...layer.rotation);
        mesh.visible = layer.visible;
        meshes.set(layer.id, { layer, mesh });
      }

      const entry = selectedId ? meshes.get(selectedId) : undefined;
      const next = entry?.layer.locked ? undefined : entry?.mesh;
      if (selected !== next || gizmo !== showGizmo || transform.object?.visible === false || (showGizmo && next?.visible && !transform.object)) {
        transform.detach();
        if (showGizmo && next?.visible) transform.attach(next);
      }
      selected = next;
      gizmo = showGizmo;
      bounds.visible = !!(showGizmo && selected?.visible);
      if (bounds.visible && selected) bounds.setFromObject(selected);
      draw();
    },
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(pendingFrame);
      transform.dispose();
      orbit.dispose();
      for (const { mesh } of meshes.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      bounds.dispose();
      grid.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
