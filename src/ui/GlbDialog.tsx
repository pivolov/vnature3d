import { useEffect, useRef, useState } from 'react';
import { AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, LoadingManager, Mesh, PerspectiveCamera, PMREMGenerator, Scene, Texture, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import js from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import wasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import { createWebGLRenderer } from '../render/webgl';

export default function GlbDialog({ file, close }: { file: File; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Открываем модель…');
  useEffect(() => {
    const container = host.current!;
    dialog.current?.showModal();
    let closed = false;
    const cleanup: (() => void)[] = [];
    async function open() {
      const bytes = await file.arrayBuffer();
      if (closed) return;
      if (bytes.byteLength < 20 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) throw new Error('Файл повреждён или имеет другой формат.');
      const manager = new LoadingManager();
      manager.setURLModifier(url => {
        if (/^(blob:|data:)/.test(url)) return url;
        throw new Error('Сохраните GLB со встроенными текстурами и буферами.');
      });
      const draco = new DRACOLoader().setDecoderPath({ js, wasm }).setWorkerLimit(1);
      cleanup.push(() => draco.dispose());
      const asset = await new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '');
      function releaseAsset() {
        const textures = new Set<Texture>();
        for (const root of asset.scenes) root.traverse(obj => {
          if (!(obj instanceof Mesh)) return;
          obj.geometry.dispose();
          for (const material of [obj.material].flat()) {
            for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
            material.dispose();
          }
        });
        for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.source.data instanceof ImageBitmap) texture.source.data.close(); }
      }
      if (closed) { releaseAsset(); return; }
      cleanup.push(releaseAsset);
      const bounds = new Box3().setFromObject(asset.scene);
      if (bounds.isEmpty()) throw new Error('В основной сцене файла нет геометрии.');
      const renderer = createWebGLRenderer({ antialias: true });
      cleanup.push(() => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
      container.append(renderer.domElement);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      const scene = new Scene();
      scene.background = new Color(0x666666);
      const room = new RoomEnvironment();
      const pmrem = new PMREMGenerator(renderer);
      const env = pmrem.fromScene(room);
      room.dispose(); pmrem.dispose();
      cleanup.push(() => env.dispose());
      scene.environment = env.texture;
      const key = new DirectionalLight(0xffffff, 2);
      key.position.set(3, 5, 4);
      scene.add(asset.scene, key, new HemisphereLight(0xffffff, 0x666666, 1));
      const radius = Math.max(0.00001, bounds.getSize(new Vector3()).length() / 2);
      const camera = new PerspectiveCamera(40, 1, radius / 1000, radius * 200);
      const controls = new OrbitControls(camera, renderer.domElement);
      cleanup.push(() => controls.dispose());
      bounds.getCenter(controls.target);
      const aspect = Math.max(0.01, container.clientWidth / container.clientHeight);
      const angle = Math.atan(Math.tan(Math.PI / 9) * Math.min(aspect, 1));
      camera.position.copy(controls.target).addScaledVector(new Vector3(1, 0.6, 2).normalize(), 1.08 * radius / Math.sin(angle));
      controls.update();
      const draw = () => renderer.render(scene, camera);
      controls.addEventListener('change', draw);
      const resize = () => {
        const { clientWidth: w, clientHeight: h } = container;
        if (!w || !h) return;
        camera.aspect = w / h; camera.updateProjectionMatrix();
        renderer.setSize(w, h); draw();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      cleanup.push(() => observer.disconnect());
      resize();
      if (asset.animations.length) {
        const mixer = new AnimationMixer(asset.scene);
        mixer.clipAction(asset.animations[0]).play();
        let previous = performance.now();
        renderer.setAnimationLoop(now => { mixer.update(Math.min((now - previous) / 1000, 0.1)); previous = now; draw(); });
        cleanup.push(() => { renderer.setAnimationLoop(null); mixer.stopAllAction(); });
      }
      setStatus('');
    }
    open().catch(error => { if (!closed) setStatus('Не удалось открыть GLB. ' + (error instanceof Error ? error.message : 'Проверьте файл.')); });
    return () => { closed = true; cleanup.reverse().forEach(dispose => dispose()); };
  }, [file]);
  return <dialog className="raster-dialog glb-dialog" ref={dialog} onCancel={close} aria-label="Просмотр GLB">
    <header className="dialog-heading"><h2>Просмотр GLB</h2><span title={file.name}>{file.name}</span></header>
    <div className="glb-view"><div ref={host} style={{ width: '100%', height: '100%' }} />{status && <p role="status">{status}</p>}</div>
    <div className="dialog-actions"><span>Потяните для поворота. Колесо или жест двумя пальцами меняет масштаб.</span><button onClick={close}>Закрыть</button></div>
  </dialog>;
}
