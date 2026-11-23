import { Euler, Quaternion, Vector3 } from 'three';
import { defaultTimeline, evaluate, positionAt } from '../animation/timeline';
import { effectiveLayer } from '../core/layers';
import { defaultLighting, isGlass, keyDirection, materials, type Project } from '../core/project';
import { extrudeLayer } from '../geometry/extrusion';
import template from './blender.py?raw';

export function downloadBlender(project: Project, aspect: number) {
  const timeline = project.timeline ?? defaultTimeline;
  const span = timeline.duration * (timeline.loop === 'ping-pong' ? 2 : 1);
  const count = Math.ceil(span * timeline.fps);
  const times = timeline.tracks.length ? Array.from({ length: count + 1 }, (_, i) =>
    positionAt(Math.min(span, i / timeline.fps), timeline.duration, timeline.loop === 'ping-pong' ? 'ping-pong' : 'once')) : [0];
  const poses = times.map(time => evaluate(project, time));
  const layers = poses[0].layers.filter(layer => effectiveLayer(project, layer).visible).map((layer, index) => {
    const geometry = extrudeLayer(layer);
    const normals = geometry.getAttribute('normal');
    const position = geometry.getAttribute('position');
    const vertices: number[][] = [], faces: number[][] = [];
    const ids = new Map<string, number>();
    const corners = Array.from({ length: position.count }, (_, i) => {
      const point = [position.getX(i), -position.getZ(i), position.getY(i)];
      const key = point.join(',');
      if (!ids.has(key)) { ids.set(key, vertices.length); vertices.push(point); }
      return ids.get(key)!;
    });
    const loopNormals: number[][] = [];
    for (let i = 0; i < (geometry.index?.count ?? corners.length); i += 3) {
      const triangle = [0, 1, 2].map(offset => geometry.index?.getX(i + offset) ?? i + offset);
      const face = triangle.map(vertex => corners[vertex]);
      if (new Set(face).size !== 3) continue;
      faces.push(face);
      for (const vertex of triangle) loopNormals.push([normals.getX(vertex), -normals.getZ(vertex), normals.getY(vertex)]);
    }
    geometry.dispose();
    const preset = materials[layer.material];
    return { name: layer.name, vertices, faces, normals: loopNormals, metalness: preset.metalness,
      coat: preset.clearcoat, glass: isGlass(layer.material),
      frames: poses.map(pose => {
        const item = pose.layers[index]?.id === layer.id ? pose.layers[index] : pose.layers.find(candidate => candidate.id === layer.id)!;
        const q = new Quaternion().setFromEuler(new Euler(...item.rotation));
        return { position: [item.position[0], -item.position[2], item.position[1]], rotation: [q.w, q.x, -q.z, q.y],
          scale: [item.scale?.[0] ?? 1, item.scale?.[2] ?? 1, item.scale?.[1] ?? 1],
          roughness: item.roughness ?? preset.roughness, color: item.color, opacity: item.opacity, emissive: item.emissive ?? '#000000' };
      }) };
  });
  const lights = { ...defaultLighting, ...project.lighting };
  const [x, y, z] = keyDirection(lights);
  const data = { name: project.name, layers, fps: timeline.fps, count, aspect, lights, key: [x, -z, y],
    cameras: poses.map(({ camera }) => {
      const position = new Vector3(...camera.position);
      const target = new Vector3(...camera.target);
      return { position: [position.x, -position.z, position.y], target: [target.x, -target.z, target.y],
        projection: camera.projection, zoom: camera.zoom };
    }) };
  const script = template.replace('VD3D_PAYLOAD', () => JSON.stringify(JSON.stringify(data)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
  const url = URL.createObjectURL(new Blob([script], { type: 'text/x-python' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (project.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80) || 'VD3D') + '.py';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
