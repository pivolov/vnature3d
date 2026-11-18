import { AmbientLight, BufferGeometry, DirectionalLight, DoubleSide, FrontSide, Mesh, MeshPhysicalMaterial,
  NeutralToneMapping, OrthographicCamera, PerspectiveCamera, PMREMGenerator, Scene, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { effectiveLayer } from '../core/layers';
import { materials, type Layer, type Project } from '../core/project';
import { extrudeLayer } from '../geometry/extrusion';

const lighting = {
  studio: { ambient: 1.4, key: 3, fill: 1.1, rim: 2.1, tint: '#ffffff' },
  soft: { ambient: 2, key: 1.6, fill: 1.2, rim: 0.8, tint: '#ffffff' },
  dramatic: { ambient: 0.35, key: 4.3, fill: 0.2, rim: 3, tint: '#ffd2aa' },
  neon: { ambient: 0.65, key: 2.1, fill: 1.2, rim: 4, tint: '#ed6eff' },
};

export function projection(w: number, h: number, perspective = new PerspectiveCamera(35, 1, 0.05, 100),
  orthographic = new OrthographicCamera(-3, 3, 3, -3, 0.05, 100)) {
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
    return { perspective, orthographic };
}

export function createProjectScene(renderer: WebGLRenderer) {
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 0.8;
  const scene = new Scene();
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
  const sources = new WeakMap<object, Map<string, BufferGeometry>>();
  const references = new Map<BufferGeometry, { pool: Map<string, BufferGeometry>; key: string; count: number }>();
  function acquire(layer: Layer) {
    const source = layer.relief ?? layer.shapes;
    let pool = sources.get(source);
    if (!pool) { pool = new Map(); sources.set(source, pool); }
    const key = layer.depth + '/' + layer.bevel + '/' + layer.bevelSegments;
    const existing = pool.get(key);
    if (existing) {
      references.get(existing)!.count++;
      return existing;
    }
    const geometry = extrudeLayer(layer);
    pool.set(key, geometry);
    references.set(geometry, { pool, key, count: 1 });
    return geometry;
  }
  function release(geometry: BufferGeometry) {
    const ref = references.get(geometry);
    if (!ref || --ref.count) return;
    ref.pool.delete(ref.key);
    references.delete(geometry);
    geometry.dispose();
  }

  return {
    scene,
    meshes,
    update(project: Project) {
      const preset = lighting[project.light];
      ambient.intensity = preset.ambient;
      key.intensity = preset.key;
      fill.intensity = preset.fill;
      rim.intensity = preset.rim;
      rim.color.set(preset.tint);

      const ids = new Set(project.layers.map((layer) => layer.id));
      for (const [id, { mesh }] of meshes) {
        if (ids.has(id)) continue;
        scene.remove(mesh);
        release(mesh.geometry);
        mesh.material.dispose();
        meshes.delete(id);
      }
      for (const sourceLayer of project.layers) {
        const layer = effectiveLayer(project, sourceLayer);
        const previous = meshes.get(layer.id);
        if (previous?.layer === layer) continue;
        const mesh = previous?.mesh ?? new Mesh(acquire(layer), new MeshPhysicalMaterial());
        if (!previous) {
          mesh.name = layer.id;
          scene.add(mesh);
        } else if (previous.layer.shapes !== layer.shapes || previous.layer.relief !== layer.relief || previous.layer.depth !== layer.depth ||
          previous.layer.bevel !== layer.bevel || previous.layer.bevelSegments !== layer.bevelSegments) {
          const next = acquire(layer);
          release(mesh.geometry);
          mesh.geometry = next;
        }
        if (!previous || previous.layer.material !== layer.material || previous.layer.color !== layer.color ||
          previous.layer.emissive !== layer.emissive || previous.layer.roughness !== layer.roughness ||
          previous.layer.opacity !== layer.opacity || previous.layer.relief !== layer.relief || previous.layer.shine !== layer.shine) {
          const { roughness, metalness, clearcoat } = materials[layer.material];
          const side = layer.relief ? DoubleSide : FrontSide;
          const transparent = layer.opacity < 1;
          const map = layer.shine === undefined ? null : environment.texture;
          if (mesh.material.side !== side || mesh.material.transparent !== transparent || mesh.material.envMap !== map) mesh.material.needsUpdate = true;
          mesh.material.envMap = map;
          mesh.material.envMapIntensity = scene.environmentIntensity;
          mesh.material.envMapRotation.set(0.16, layer.shine ?? 0, 0.1);
          mesh.material.setValues({ color: layer.color, emissive: layer.emissive ?? '#000000',
            roughness: layer.roughness ?? roughness, metalness, clearcoat, side, opacity: layer.opacity, transparent, depthWrite: !transparent });
        }
        mesh.position.set(...layer.position);
        mesh.scale.set(...(layer.scale ?? [1, 1, 1]));
        mesh.rotation.set(...layer.rotation);
        mesh.visible = layer.visible;
        meshes.set(layer.id, { layer, mesh });
      }

    },
    dispose() {
      for (const { mesh } of meshes.values()) {
        release(mesh.geometry);
        mesh.material.dispose();
      }
      meshes.clear();
      environment.dispose();
    },
  };
}
