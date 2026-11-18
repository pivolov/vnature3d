# Logo/Icon 3D Animator — план реализации

## Стек

- Vite, React и TypeScript в строгом режиме. Zustand для состояния редактора, CSS custom properties для темы и компоновки. Приложение работает в браузере, файлы обрабатываются локально.
- Three.js стабильной версии, SVGLoader и ExtrudeGeometry для первого вертикального среза. OrbitControls для навигации, TransformControls для редактирования трансформов. MeshPhysicalMaterial для материалов, RoomEnvironment и PMREM для студийного света. EffectComposer, SSAO и Bloom подключаются по мере необходимости.
- Vitest для геометрии, easing, spring и оптимизатора Lottie. ESLint и проверка типов входят в проверку проекта. Версии фиксируются при подключении в package.json и lock-файле.
- Web Workers для векторизации и этапов Lottie bake, работающих с числовыми данными. WebGL-рендер и предварительный просмотр используют общую сборку сцены.
- WebCodecs + mp4-muxer для детерминированного H.264. MediaRecorder как альтернативный режим при наличии поддерживаемого MIME-типа. lottie-web для предпросмотра и проверки, @dotlottie/dotlottie-js для проверки и упаковки .lottie. opentype.js для кривых из шрифтов, clipper-lib для контурных операций.
- IndexedDB для автосохранения. .l3d — версионированный JSON с встроенными пользовательскими ресурсами, необходимыми для восстановления проекта.

## Структура

| Путь | Ответственность |
| --- | --- |
| `src/core` | Схема, валидация, миграции, команды редактирования, сохранение |
| `src/geometry` | SVG, трассировка растра, примитивы, контурные операции, экструзия |
| `src/animation` | Вычисление сцены по времени, интерполяция, пресеты, аналитическая пружина |
| `src/render` | Сборка Three.js-сцены, вьюпорт, покадровый рендер |
| `src/export` | Видео и PNG, Lottie native, псевдо-3D, bake, оптимизация, .lottie и сниппеты |
| `src/ui` | Тулбар, слои и библиотека пресетов, вьюпорт, инспектор, таймлайн, диалоги |
| `src/workers` | Векторизация и обработка геометрии для bake с прогрессом и отменой |
| `src/utils` | Общие функции для чисел и файлов |
| `fixtures` | SVG со сложными контурами, эталоны трассировки и анимации |
| `docs` | План, контракт проекта и подтверждённые ограничения форматов |

## Модель проекта

Ниже схема планируемого формата. Геометрия хранится в нормализованных координатах сцены, углы в радианах, время в секундах, а настройки вывода в пикселях и битах в секунду. Цвет в проекте хранится в sRGB. При импорте вычисляем контуры и сохраняем их в проекте, чтобы результаты обновления библиотеки не меняли уже сохранённую модель.

```ts
type Id = string;
type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Color = [number, number, number];
type Fps = 24 | 30 | 60;

type Project = {
  schemaVersion: 1;
  id: Id;
  name: string;
  assets: Record<Id, Asset>;
  layers: Layer[];
  scene: Scene;
  timeline: Timeline;
  output: Output;
};

type Asset = {
  name: string;
  kind: 'svg' | 'raster' | 'font' | 'texture' | 'hdr';
  mimeType: string;
  dataBase64: string;
};

type Segment =
  | { kind: 'line'; to: Vec2 }
  | { kind: 'quadratic'; control: Vec2; to: Vec2 }
  | { kind: 'cubic'; control1: Vec2; control2: Vec2; to: Vec2 };

type Contour = { start: Vec2; segments: Segment[] };
type Shape = { outer: Contour; holes: Contour[] };

type Gradient = {
  type: 'linear' | 'radial';
  start: Vec2;
  end: Vec2;
  stops: { offset: number; color: Color; opacity: number }[];
};

type Material = {
  color: Color;
  gradient?: Gradient;
  textureAssetId?: Id;
  metalness: number;
  roughness: number;
  clearcoat: number;
  transmission: number;
  ior: number;
  thickness: number;
  emissive: Color;
  opacity: number;
  sheen: number;
  iridescence: number;
  shading: 'physical' | 'toon';
};

type Transform = { position: Vec3; rotation: Vec3; scale: Vec3; pivot: Vec3 };
type Geometry = {
  depth: number;
  bevel: { size: number; segments: number; profile: 'round' | 'chamfer' | 'flat'; softness: number };
  inflate: number;
  curveSegments: number;
  smoothNormals: boolean;
};

type LayerBase = {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: Transform;
};

type MeshLayer = LayerBase & {
  kind: 'mesh';
  sourceAssetId?: Id;
  source: { kind: 'contours'; shapes: Shape[] } |
    { kind: 'heightmap'; assetId: Id; strength: number; resolution: number };
  geometry: Geometry;
  frontMaterial: Material;
  sideMaterial: Material;
  repeat?: { kind: 'linear'; count: number; step: Vec3 } |
    { kind: 'radial'; count: number; axis: Vec3; angle: number } |
    { kind: 'mirror'; axis: 'x' | 'y' | 'z' };
};

type Layer = MeshLayer | (LayerBase & { kind: 'group'; children: Layer[] });

type Camera = {
  position: Vec3;
  target: Vec3;
  projection: 'perspective' | 'orthographic';
  fov: number;
  orthographicHeight: number;
};
type Scene = {
  camera: Camera;
  lights: {
    role: 'key' | 'fill' | 'rim';
    position: Vec3;
    color: Color;
    intensity: number;
  }[];
  shadows: boolean;
  environment: { source: 'studio' | 'soft' | 'dramatic' } |
    { source: 'asset'; assetId: Id };
  environmentRotation: number;
  background: { kind: 'transparent' } |
    { kind: 'solid'; color: Color } |
    { kind: 'gradient'; gradient: Gradient } |
    { kind: 'blur'; assetId: Id; radius: number };
};

type Easing = { kind: 'linear' | 'hold' } |
  { kind: 'named'; family: 'sine' | 'quad' | 'cubic' | 'expo' | 'back' | 'elastic' | 'bounce';
    direction: 'in' | 'out' | 'in-out' } |
  { kind: 'bezier'; control1: Vec2; control2: Vec2 };

type Key<T> = { id: Id; time: number; value: T; easingToNext: Easing };
type Track =
  | { target: 'layer'; id: Id; field: 'position' | 'rotation' | 'scale'; keys: Key<Vec3>[] }
  | { target: 'layer'; id: Id; field: 'opacity'; keys: Key<number>[] }
  | { target: 'layer'; id: Id; field: 'depth' | 'bevelSize'; keys: Key<number>[] }
  | { target: 'material'; layerId: Id; slot: 'front' | 'side';
      field: 'color' | 'emissive'; keys: Key<Color>[] }
  | { target: 'material'; layerId: Id; slot: 'front' | 'side';
      field: 'roughness'; keys: Key<number>[] }
  | { target: 'camera'; field: 'position' | 'target'; keys: Key<Vec3>[] }
  | { target: 'camera'; field: 'fov' | 'orthographicHeight'; keys: Key<number>[] };

type Timeline = { duration: number; fps: Fps; playback: 'once' | 'loop' | 'ping-pong'; tracks: Track[] };

type Output = {
  width: number;
  height: number;
  video: {
    bitrate: number;
    mp4Background?: Color;
    supersampling: 1 | 2;
    motionBlurSamples: number;
  };
  lottie: { keyframeStep: number; tolerancePx: number };
};
```

Порядок массивов определяет порядок слоёв. Треки ссылаются на стабильные ID, ключи сортируются по времени. Валидатор проверяет конечность чисел, диапазоны, ссылки на ресурсы, уникальность ID и совместимость дорожки с её целью. Команды применяют изменение проекта одной транзакцией Undo/Redo. Zustand также держит выделение, позицию курсора и состояние панелей вне сохраняемой модели. Контролы вьюпорта при редактировании камеры применяют изменения через те же команды.

Анимация вычисляет состояние на заданный момент без зависимости от предыдущего кадра. Для вывода FPS берётся из таймлайна, размер из настроек композиции. Сетка, гизмо и безопасные зоны принадлежат вьюпорту. Mesh, WebGL-текстуры, кэш и декодированные изображения восстанавливаются из модели. После удаления или пересборки ресурсы освобождаются.

## Этапы и проверки

| Этап | Результат | Проверка |
| --- | --- | --- |
| 0 | План | Все решения и вопросы зафиксированы в этом документе |
| 1 | Каркас React и первый срез SVG → экструзия | Импорт SVG с отверстиями, изменение глубины и bevel, материалы, свет, камера, Undo/Redo |
| 2 | PNG/JPG, примитивы, иерархия | Превью контура до экструзии, сохранение отверстий, порядок и операции со слоями |
| 3 | Ключи, кривые, сохранение | Сравнить позу при проигрывании и скраббинге в один момент, восстановить проект из IndexedDB и .l3d |
| 4 | Пресеты, шаблоны и spring | После применения видны редактируемые ключи, петля проверяется на стыке, пружина воспроизводится одинаково |
| 5 | MP4/WebM/PNG-sequence | Проверить размер, кадры, длительность, альфу там, где она поддерживается, и отмену длинного экспорта |
| 6 | Lottie, оптимизация, превью, .lottie и интеграция | Проверить выбор режима, размер и ошибки файла, воспроизведение в web, iOS и Android |
| 7 | Полировка | Прогнать импорт и экспорт на целевых браузерах, замерить FPS, проверить хоткеи и сообщения об ошибках |

С этапа 1 проверяем `npm run dev`, `npm run build`, `npm test`, `npm run lint`. SVG-парсер покрываем 5–10 файлами с viewBox, вложенными transform, fill-rule, отверстиями, stroke, градиентом и текстом. По мере реализации добавляем тесты easing, spring, simplify и сокращения ключей Lottie.

## Риски и технические решения

| Риск | Подход |
| --- | --- |
| Выбор режима Lottie | Native для плоской сцены с 2D-трансформами при совместимой проекции. Псевдо-3D для подходящих плоских слоёв с наклоном и параллаксом. Для полноценного объёма используем bake. Режим, упрощения материалов и прогноз размера показываем до скачивания. |
| Перекрытия и мерцание в bake | Порядок граней может меняться между кадрами, а порядок shape layers в Lottie статичен. Сначала проверяем проекцию на простых экструзиях. Для смены порядка проверяем разбиение клипа на участки со стабильным порядком и маскирование видимости; при пересечениях сравниваем с 3D-эталоном. При заметных артефактах или превышении бюджета рекомендуем видео. |
| Размер и совместимость Lottie | Отсечение, объединение соседних граней, квантование и сокращение ключей по допуску. Сохраняем совместимую топологию путей между интерполируемыми ключами. Предупреждаем при размере свыше 300 КБ и показываем число слоёв и ключей. Сопоставляем результат lottie-web с 3D-кадрами и проверяем контрольные файлы на iOS и Android. |
| Доступность H.264 и 4K | Проверяем конфигурацию через VideoEncoder.isConfigSupported и реальные лимиты GPU. Рендерим кадр по его номеру, задаём монотонные временные метки, ограничиваем очередь кодера и закрываем VideoFrame после передачи. Проверяем прогресс, отмену и пиковую память отдельно для очереди кодера и накопления контейнера. MediaRecorder используется как явно обозначенная запись в реальном времени. |
| Прозрачность | Для MP4 выбирается цвет подложки. VP9 с альфой предлагаем после проверки кодирования и декодирования тестового прозрачного кадра; PNG-sequence служит переносимым вариантом. |
| Геометрия и скорость импорта | Проверяем SVG на fixtures и выдаём предупреждения для неподдерживаемых конструкций. Векторизацию выносим в worker, ограничиваем разрешение превью, отменяем устаревшие вычисления. Сложность геометрии и скорость рендера измеряем на реальных SVG и PNG. |
| Объём .l3d и автосохранение | Base64 увеличивает размер ресурсов. Пишем ресурсы отдельно от изменяемого состояния внутри IndexedDB, объединяем их при экспорте .l3d, проверяем квоту и восстанавливаем последнюю успешно сохранённую версию. |

## Вопросы

1. Какой браузер приоритетен для редактора и экспорта? По умолчанию первый полноценный прогон на актуальном Chrome, для остальных проверяем доступные форматы.
2. Есть ли 3–5 логотипов или иконок, на которых нужно проверить импорт и внешний вид? До получения исходников используем собственные fixtures.
3. Есть ли ограничения по размеру Lottie в вашем приложении? По умолчанию показываем предупреждение на 300 КБ.
4. Какие минимальные версии iOS и Android и версии Lottie SDK нужно поддержать? Это нужно для выбора устройств и библиотек при проверке этапа 6.
