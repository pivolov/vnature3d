# SPEC — Logo/Icon 3D Animator

Ты — senior-инженер (WebGL/Three.js, графика, motion-инструменты) и product-дизайнер. Задача — спроектировать и написать рабочий веб-инструмент «Logo/Icon 3D Animator»: упрощённый аналог Blender, заточенный под одну цель — превратить PNG/SVG (или нарисованную в приложении простую фигуру) в 3D-модель, анимировать её пресетами/таймлайном и экспортировать для мобильных приложений iOS и Android в Lottie (.json / .lottie) и MP4 высокого качества.

## 1. Цель и пользователь
Пользователь — моушн-дизайнер/UI-UX дизайнер. Ему нужно за 2–5 минут получить анимированный 3D-логотип/иконку для онбординга, сплэша, лоадера, пуш-экрана мобильного приложения. Интерфейс быстрый, понятный без инструкции, выглядит как профессиональный инструмент (тёмная тема, плотные панели, как Figma/Rive/Spline), а не как демо.

> Важно: Lottie — векторный 2D-формат, он не хранит настоящее 3D. Экспорт делается через «запекание» (bake): каждый кадр 3D-сцены проецируется в 2D-полигоны, которые становятся shape-слоями с ключевыми кадрами. Работает для плоско-затенённых и стилизованных моделей (экструзия логотипов и иконок), но не для фотореалистичных материалов. Для них есть MP4 и WebM с альфой.

## 2. Стек (жёстко)
- Vite + TypeScript, без бэкенда, всё локально в браузере.
- Three.js (актуальная стабильная), SVGLoader, ExtrudeGeometry, OrbitControls, TransformControls, postprocessing (EffectComposer, SSAO/Bloom — опционально, с переключателем).
- UI: React + Zustand. Стили — CSS variables, без тяжёлых UI-китов.
- Lottie: lottie-web для превью и валидации, dotLottie через @dotlottie/dotlottie-js.
- MP4: WebCodecs (VideoEncoder, H.264) + mp4-muxer; fallback на MediaRecorder. Покадровый детерминированный рендер: для каждого кадра выставляем время t, рендерим, кодируем.
- Web Workers для тяжёлых операций (векторизация, запекание Lottie).
- Если библиотека лучше — предложи замену с обоснованием ДО написания кода.

## 3. Вход: из чего делаем 3D
### 3.1 SVG (приоритетный путь)
- Парсинг через SVGLoader: path, rect, circle, ellipse, polygon, polyline, группы, transform, fill-rule (evenodd/nonzero), дыры в контурах.
- Каждый fill-цвет → отдельная фигура/слой со своим материалом, глубиной выдавливания (depth) и z-offset.
- Stroke: опция «конвертировать обводку в заливку» (offset path), иначе предупреждение.
- Корректная обработка viewBox, нормализация масштаба, центровка по центру масс.
- Градиенты: линейные/радиальные → градиентная текстура или аппроксимация цветовыми стопами; честно описать ограничения.
- Текст в SVG: предупреждать, что нужно конвертировать в кривые.

### 3.2 PNG/JPG
- С альфа-каналом: контур по альфе (marching squares) → упрощение (Douglas-Peucker/Visvalingam с допуском) → сглаживание в безье (Schneider fitting) → фигуры с дырами.
- Непрозрачный фон: порог + выбор цвета фона; режим многоцветной векторизации (квантование палитры до N цветов, ImageTracer-подобный алгоритм) → слои по цветам.
- Режим «Heightmap»: яркость → рельеф (displacement).
- Живое превью векторизации ДО выдавливания, ползунки: Threshold, Smoothing, Simplify, Min area, Colors count, Corner threshold.
- Предупреждение, если разрешение исходника < 512px.

### 3.3 Мини-редактор примитивов
Прямоугольник, круг, многоугольник, звезда, текст (opentype.js → кривые, шрифты из набора Google Fonts, загрузка своего .ttf/.otf), булевы операции (union/subtract/intersect через paper.js или clipper-lib).

## 4. 3D-моделирование (гибкая настройка)
На каждый слой отдельно и глобально:
- Depth, Z-offset, порядок слоёв.
- Bevel: размер, сегменты, тип (round / chamfer / flat), «мягкость» — живое превью.
- Inflate / Balloon (мягкий надутый объём в стиле 3D-иконок) — подразделение и смещение вершин по расстоянию до контура.
- Curve segments, Auto-smooth normals.
- Pivot: центр, центр масс, угол, произвольная точка перетаскиванием.
- Трансформы: position/rotation/scale, gizmo во вьюпорте, числовые поля.
- Группировка и иерархия слоёв (дерево как в Figma): скрыть/заблокировать/дублировать/переименовать, drag-and-drop порядок.
- Симметрия и массивы (вокруг оси, линейный).

### Материалы (MeshPhysicalMaterial), пресеты
Glossy plastic, Matte clay, Brushed metal, Chrome, Gold, Glass (transmission + IOR + thickness), Frosted glass, Neon/Emissive, Toon (ступенчатое затенение с контуром), Holographic/iridescent, Soft gradient.
Параметры: color/gradient, metalness, roughness, clearcoat, transmission, IOR, emissive, opacity, sheen. Опционально: своя текстура на лицевую грань, noise-bump.
Пресеты, хорошо переносимые в Lottie, помечены значком «Lottie-friendly».

### Сцена и свет
- Камера: perspective/orthographic, FOV, пресеты ракурсов (front, 3/4, top, isometric), guide-overlay безопасных зон: 1:1, 9:16, 9:19.5, 4:5, 16:9.
- HDRI: 3–5 встроенных процедурных (RoomEnvironment/PMREM), загрузка .hdr, вращение окружения.
- Свет: key/fill/rim, пресеты «студия», «мягкий», «драматичный», «неон». Тени: мягкие, contact shadow на «полу», вкл/выкл.
- Фон: прозрачный (важно!), сплошной, градиент, blur-подложка.

## 5. Анимация
### 5.1 Таймлайн (упрощённый After Effects/Rive)
- Дорожки на каждый слой и камеру: position, rotation, scale, opacity, параметры материала (color, emissive, roughness), bevel/depth.
- Ключи: добавление кликом, перетаскивание, копирование, удаление; Auto-key.
- Интерполяция: linear, ease in/out/in-out (sine, quad, cubic, expo, back, elastic, bounce), графический редактор кубических безье, hold/step.
- Graph editor (минимум value-curve на одной дорожке).
- Длительность, FPS (24/30/60), loop-режимы: once, loop, ping-pong, проверка бесшовности.
- Масштаб таймлайна, snap к кадрам, play/pause/scrub, hotkeys (Space, J/K/L, стрелки по кадрам, Ctrl+Z/Y, Ctrl+C/V, Del, K).
- Stagger/каскад по слоям (по порядку, от центра, случайно) — один ползунок.

### 5.2 Библиотека пресетов
Применяются к выделенным слоям или ко всей сцене, параметризуются, после применения становятся обычными ключами.
- Вход/выход: Fade+Scale In, Pop (overshoot), Drop & Bounce, Slide 3D, Flip Reveal, Unfold, Assemble, Explode/Disassemble, Zoom-through.
- Петли: Float, Slow Spin Y, Wobble, Pendulum, Breathing, Orbit camera, Tilt-follow, Shine sweep, Glow pulse.
- Акценты: Shake, Jelly (squash & stretch), Heartbeat, Spring, Rubber band.
- Лоадеры: Rotating segments, Morph pulse, Progress-fill.
- Шаблоны сцен: «Splash intro», «Onboarding hero», «Success check», «Loader loop» — комбинация пресетов + свет + материал.
- Каждый пресет: название, превью при наведении, параметры (duration, delay, intensity, easing, direction, stagger).
- Пружина (damped spring) — аналитически, не симуляцией, детерминированно, запекается в ключи.

## 6. Рендер и экспорт
### 6.1 MP4 (H.264) и WebM VP9 с альфой
- Разрешения: 720p, 1080p, 1440p, 4K, кастом, квадрат/вертикаль; FPS 24/30/60; битрейт Draft/Good/Max + ручной ввод; учёт device pixel ratio.
- Суперсэмплинг (×2 + даунскейл) или temporal accumulation для motion blur (ползунок samples).
- Детерминированный покадровый рендер: прогресс-бар, отмена, оценка времени и размера, без роста памяти.
- MP4 без альфы: при прозрачном фоне предложить выбор фона для MP4 либо WebM/PNG-sequence, сообщить в UI.
- Дополнительно: PNG-sequence (zip), GIF (опционально), одиночный PNG с альфой.

### 6.2 Lottie (.json и .lottie)
- Режим bake: на каждый кадр (или N-й) проекция граней в 2D, сортировка по глубине (painter's algorithm), группировка по материалу/нормали, flat shading (+ gradient-aware lighting) → shape layers с path-keyframes и fill по keyframes.
- Оптимизации обязательны: слияние смежных граней одного цвета, backface/occlusion culling, квантование координат (1–2 знака), delta-упрощение ключей с допуском, лимиты ключей/слоёв, настраиваемый keyframe step.
- Native-режим: если анимация только из трансформов плоских слоёв (position/scale/rotation Z/opacity) — чистый Lottie без запекания геометрии. Определять автоматически и сообщать пользователю.
- Псевдо-3D: плоские слои с параллаксом и поворотом вокруг Y через scale.x и skew.
- Совместимость: только функции lottie-ios, lottie-android, lottie-web (без expressions, без 3D-слоёв AE, mattes осторожно). Фиксированная версия схемы, валидный JSON.
- Градиентные заливки (gf) там, где они лучше сохраняют вид материала.
- UI: размер файла, число слоёв и ключей, предупреждения (>300 KB), кнопка «Optimize more».
- Валидация: автозагрузка результата в lottie-web рядом с 3D-превью (side-by-side + оверлей разницы).
- Экспорт в .lottie (zip) опционально.
- Честное предупреждение в UI, чего Lottie не передаёт (физическое стекло, отражения, тени).

### 6.3 Пакет для разработчика
- Сниппеты интеграции: iOS (lottie-ios, Swift/SwiftUI LottieView, loop, playback), Android (lottie-android, Compose rememberLottieComposition + XML LottieAnimationView), React Native (lottie-react-native), Flutter (lottie). Кнопка «Copy snippet».
- Отчёт: размер, fps, длительность, размер композиции, рекомендации по производительности.

## 7. UI/UX
Раскладка: сверху тулбар (файл, undo/redo, экспорт, режимы); слева слои/иерархия и библиотека пресетов (табы); по центру 3D-вьюпорт с гизмо, сеткой, safe-area оверлеем; справа инспектор (Transform / Geometry / Material / Light / Camera) в аккордеонах; снизу таймлайн.
- Тёмная тема, аккуратная типографика, горячие клавиши, тултипы; пустое состояние с drag-and-drop «Перетащи SVG/PNG сюда» и тремя демо-примерами.
- Undo/Redo на всё (command pattern), автосохранение в IndexedDB, экспорт/импорт проекта (.l3d, JSON), восстановление сессии.
- Десктопный инструмент; вьюпорт не ломается при ресайзе.
- Производительность: 60 FPS в превью на среднем ноутбуке, debounce тяжёлых пересборок, instancing, dispose ресурсов.
- Ошибки: понятные сообщения (битый SVG, большой файл, нет WebCodecs), никаких молчаливых падений.

## 8. Архитектура и качество кода
Структура: `/src/core` (scene graph, project model), `/src/geometry` (svg→shapes, raster trace, extrusion, boolean), `/src/animation` (timeline, easing, presets, spring), `/src/render` (viewport, offline renderer), `/src/export` (mp4, lottie-bake, lottie-native, dotlottie, png-seq), `/src/ui`, `/src/workers`, `/src/utils`, `/fixtures`, `/docs`.
Единая модель проекта (JSON) — единственный источник правды. Строгая типизация, без `any`. Юнит-тесты: easing, spring, simplify, lottie keyframe reduction, SVG-парсер на 5–10 файлах.

## 9. Порядок работы
- **Этап 0 — План:** `docs/PLAN.md`: стек, структура, схема модели проекта, риски (особенно Lottie-bake и MP4), до 5 вопросов. Без кода.
- **Этап 1 — Каркас:** Vite+TS, layout, вьюпорт, SVG → экструзия, bevel, материалы-пресеты, свет, камера, undo/redo.
- **Этап 2 — PNG-векторизация**, мини-редактор примитивов, слои/иерархия.
- **Этап 3 — Таймлайн**, ключи, easing, graph editor, сохранение проекта.
- **Этап 4 — Пресеты анимаций**, шаблоны сцен, spring-физика.
- **Этап 5 — Экспорт MP4/WebM/PNG-seq** (покадровый оффлайн-рендер).
- **Этап 6 — Экспорт Lottie:** native → псевдо-3D → bake, оптимизатор, валидация, dotLottie, сниппеты.
- **Этап 7 — Полировка:** производительность, hotkeys, ошибки, тесты, README.

После каждого этапа: полный рабочий код, команды запуска, чек-лист проверки, остановка до моего «дальше». Самый рискованный этап — 6: сначала native и псевдо-3D, bake в последнюю очередь.

## 10. Правила
- Код полный и рабочий, без заглушек и псевдокода.
- Если что-то невозможно или даёт плохой результат — скажи прямо, предложи альтернативу.
- Версии библиотек фиксируй в `package.json`, проверяй импорты.
- Сначала вертикальный срез, потом расширение.
- Общение на русском, код и названия сущностей на английском.
