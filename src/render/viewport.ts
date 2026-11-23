import { BoxHelper, Color, GridHelper, Mesh, OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { type Project, type Vec3 } from '../core/project';
import { createProjectScene, projection } from './projectScene';

type Callbacks = {
  select: (id: string) => void;
  rotate: (id: string, rotation: Vec3) => void;
  move: (id: string, position: Vec3) => void;
  graphics: (restored: boolean) => void;
  orbit: (position: Vec3, target: Vec3, zoom: number) => void;
};

function sameVector(a: Vec3, b: Vec3) {
  return a.every((value, i) => Math.abs(value - b[i]) < 1e-6);
}

export function mountViewport(host: HTMLDivElement, callbacks: Callbacks) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x666666, 1);
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Трёхмерный предпросмотр');
  renderer.domElement.setAttribute('role', 'img');

  let model: ReturnType<typeof createProjectScene>;
  try { model = createProjectScene(renderer); }
  catch (error) { renderer.domElement.remove(); renderer.dispose(); renderer.forceContextLoss(); throw error; }
  const { scene, meshes } = model;
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
  grid.material.transparent = true;
  grid.material.opacity = 0.43;
  scene.add(grid);
  const bounds = new BoxHelper(grid, new Color('#c9ef88'));
  bounds.visible = false;
  scene.add(bounds);
  let selected: Mesh | undefined;
  let lastCamera: Project['camera'] | undefined;
  let gizmo = false;
  let pendingFrame = 0;

  let lost = false;
  function onLost(event: Event) {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    callbacks.graphics(false);
  }
  function onRestored() { callbacks.graphics(true); }
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);
  function draw() {
    if (lost || pendingFrame) return;
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
    projection(w, h, perspective, orthographic);
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
    if (transform.mode === 'rotate') {
      const rotation: Vec3 = [object.rotation.x, object.rotation.y, object.rotation.z];
      if (entry && !sameVector(entry.layer.rotation, rotation)) callbacks.rotate(object.name, rotation);
      return;
    }
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
    const candidate = picking;
    picking = false;
    if (!candidate || start.distanceTo(new Vector2(event.clientX, event.clientY)) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new Vector2(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height), camera);
    const hit = ray.intersectObjects([...meshes.values()].map(({ mesh }) => mesh).filter((mesh) => mesh.visible && mesh.material.opacity > 0.001 && !meshes.get(mesh.name)?.layer.locked), false)[0];
    if (hit) callbacks.select(hit.object.name);
  });

  return {
    update(project: Project, selectedId: string | null, showGrid: boolean, mode: 'translate' | 'rotate' | false) {
      const showGizmo = !!mode;
      if (mode && mode !== transform.mode) transform.setMode(mode);
      if (lastCamera !== project.camera) {
        lastCamera = project.camera;
        camera = project.camera.projection === 'orthographic' ? orthographic : perspective;
        camera.position.set(...project.camera.position);
        camera.zoom = project.camera.zoom;
        camera.updateProjectionMatrix();
        orbit.object = camera;
        orbit.target.set(...project.camera.target);
        orbit.update();
        // Orbit controls constrain pointer input, but an evaluated camera track
        // must keep the same pose in the editor and the offline renderer.
        camera.position.set(...project.camera.position);
        camera.zoom = project.camera.zoom;
        camera.lookAt(...project.camera.target);
        camera.updateProjectionMatrix();
        transform.camera = camera;
      }
      grid.visible = showGrid;
      model.update(project);

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
      model.dispose();
      bounds.dispose();
      grid.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
      if (!lost) renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
