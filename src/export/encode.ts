import { Muxer, StreamTarget } from 'mp4-muxer';
import { Zip, ZipPassThrough } from 'fflate';
import type { Project } from '../core/project';
import { checkExport, framePlan, type ExportConfig } from './config';
import type { OutputFile } from './output';
import { canvasContext, pngBlob, renderFrames } from './renderFrames';
import { createWebm } from './webm';

type Progress = (done: number, frames: number, detail: string) => void;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const yieldFrame = () => wait(0);

async function compatible(options: ExportConfig, alpha = false) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return;
  const mbs = Math.ceil(options.width / 16) * Math.ceil(options.height / 16);
  const rate = mbs * options.fps;
  const level = mbs <= 3600 && rate <= 108000 ? '1f' : mbs <= 5120 && rate <= 216000 ? '20' :
    mbs <= 8192 && rate <= 245760 ? '28' : mbs <= 8704 && rate <= 522240 ? '2a' : rate <= 983040 ? '33' : '34';
  const codecs = options.format === 'webm' ? ['vp09.00.51.08', 'vp09.00.41.08'] : ['6400', '4d00', '4200'].map((prefix) => 'avc1.' + prefix + level);
  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec, width: options.width, height: options.height, bitrate: alpha ? Math.max(100000, Math.round(options.bitrate * 0.27)) : options.bitrate,
      framerate: options.fps, alpha: 'discard', latencyMode: 'realtime',
      ...(options.format === 'mp4' ? { avc: { format: 'avc' } } : {}),
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* Try the next codec profile. */ }
  }
}

function recorderType(format: ExportConfig['format']) {
  if (typeof MediaRecorder === 'undefined') return;
  const choices = format === 'mp4' ? ['video/mp4;codecs=avc1.42001f', 'video/mp4'] : ['video/webm;codecs=vp9'];
  return choices.find((choice) => MediaRecorder.isTypeSupported(choice));
}

async function encodeVideo(canvas: HTMLCanvasElement, draw: (frame: number) => void | Promise<void>, plan: ReturnType<typeof framePlan>, options: ExportConfig,
  file: OutputFile, signal: AbortSignal, report: Progress) {
  const config = await compatible(options);
  const withAlpha = options.format === 'webm' && options.transparent;
  const maskConfig = withAlpha ? await compatible(options, true) : undefined;
  signal.throwIfAborted();
  if (!config || (withAlpha && !maskConfig)) {
    const type = !withAlpha && recorderType(options.format);
    if (type && !options.traceSamples) {
      report(0, plan.frames, 'Совместимый режим · в реальном времени');
      return recordVideo(canvas, draw, plan, options, type, file, signal, report);
    }
    throw new Error(withAlpha ? 'Браузер не поддерживает кодирование VP9 с прозрачностью. Используйте PNG ZIP.' :
      'В браузере нет подходящего видеокодека. Попробуйте меньшее разрешение, WebM или PNG ZIP.');
  }

  const mp4 = options.format === 'mp4' ? new Muxer({
    target: new StreamTarget({ onData: (data, position) => file.append(data, position) }),
    video: { codec: 'avc', width: options.width, height: options.height, frameRate: options.fps },
    fastStart: 'fragmented', minFragmentDuration: 1,
  }) : undefined;
  const webm = mp4 ? undefined : createWebm(file, options, plan.duration);
  const colorChunks = new Map<number, EncodedVideoChunk>();
  const alphaChunks = new Map<number, EncodedVideoChunk>();
  let encoded = 0;
  let failure: unknown;
  const error = (reason: unknown) => { failure = reason; };
  const timestamp = (frame: number) => Math.round(frame * 1e6 / options.fps);
  function drain() {
    let time = timestamp(encoded);
    while (colorChunks.has(time) && alphaChunks.has(time)) {
      webm?.add(colorChunks.get(time)!, alphaChunks.get(time)!);
      colorChunks.delete(time);
      alphaChunks.delete(time);
      time = timestamp(++encoded);
    }
  }
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      try {
        if (mp4) { mp4.addVideoChunk(chunk, metadata); encoded++; }
        else if (withAlpha) { colorChunks.set(chunk.timestamp, chunk); drain(); }
        else { webm?.add(chunk); encoded++; }
      } catch (reason) { error(reason); }
    },
    error,
  });
  let alphaEncoder: VideoEncoder | undefined;
  let alphaContext: CanvasRenderingContext2D | undefined;
  let alphaPlane: Uint8Array<ArrayBuffer> | undefined;
  const pixels = options.width * options.height;
  try {
    if (maskConfig) {
      alphaEncoder = new VideoEncoder({ output(chunk) {
        try { alphaChunks.set(chunk.timestamp, chunk); drain(); } catch (reason) { error(reason); }
      }, error });
      alphaEncoder.configure(maskConfig);
      alphaContext = canvasContext(canvas);
      alphaPlane = new Uint8Array(pixels + 2 * Math.ceil(options.width / 2) * Math.ceil(options.height / 2));
      alphaPlane.fill(128, pixels);
    }
    encoder.configure(config);
    for (let i = 0; i < plan.frames; i++) {
      signal.throwIfAborted();
      if (failure) throw failure;
      while (encoder.encodeQueueSize > 3 || (alphaEncoder?.encodeQueueSize ?? 0) > 3) {
        signal.throwIfAborted();
        if (failure) throw failure;
        await wait(4);
      }
      if (colorChunks.size > 24 || alphaChunks.size > 24) throw new Error('Кодировщики цвета и прозрачности рассинхронизировались.');
      await draw(i);
      const timing = { timestamp: timestamp(i), duration: timestamp(i + 1) - timestamp(i), alpha: 'discard' } as const;
      const keyFrame = i % (options.fps * 2) === 0;
      const frame = new VideoFrame(canvas, timing);
      try { encoder.encode(frame, { keyFrame }); } finally { frame.close(); }
      if (alphaEncoder && alphaContext && alphaPlane) {
        // Matroska alpha expects luma directly as 0–255. Encoding RGB through a
        // canvas frame would convert it to studio range and leave a visible matte.
        const source = alphaContext.getImageData(0, 0, options.width, options.height).data;
        for (let index = 0; index < pixels; index++) alphaPlane[index] = source[index * 4 + 3];
        const alphaFrame = new VideoFrame(alphaPlane, {
          format: 'I420', codedWidth: options.width, codedHeight: options.height, ...timing,
          colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true },
        });
        try { alphaEncoder.encode(alphaFrame, { keyFrame }); } finally { alphaFrame.close(); }
      }
      report(i + 1, plan.frames, 'Рендер и кодирование');
      await file.flush();
      await yieldFrame();
    }
    report(plan.frames, plan.frames, 'Сборка файла');
    await Promise.all([encoder.flush(), alphaEncoder?.flush()]);
    signal.throwIfAborted();
    if (failure) throw failure;
    if (encoded !== plan.frames) throw new Error('Кодировщик пропустил кадры. Уменьшите разрешение или частоту.');
    mp4?.finalize();
    webm?.close();
    await file.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    if (alphaEncoder && alphaEncoder.state !== 'closed') alphaEncoder.close();
  }
}

async function recordVideo(canvas: HTMLCanvasElement, draw: (frame: number) => void | Promise<void>, plan: ReturnType<typeof framePlan>, options: ExportConfig,
  mimeType: string, file: OutputFile, signal: AbortSignal, report: Progress) {
  await draw(0);
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let pending = Promise.resolve();
  let failure: unknown;
  let recorder: MediaRecorder | undefined;
  let bytes = 0;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: options.bitrate });
    const stopped = new Promise<void>((resolve) => {
      recorder!.onerror = () => { failure = new Error('Браузер остановил запись. Выберите другой формат.'); };
      recorder!.onstop = () => resolve();
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      pending = pending.then(async () => {
        if (signal.aborted) return;
        bytes += event.data.size;
        file.append(new Uint8Array(await event.data.arrayBuffer()));
        await file.flush();
      }).catch((error) => { failure = error; });
    };
    recorder.start(300);
    const start = performance.now();
    for (let i = 0; i < plan.frames; i++) {
      signal.throwIfAborted();
      if (failure) throw failure;
      if (i) await draw(i);
      track.requestFrame();
      report(i + 1, plan.frames, 'Совместимый режим · в реальном времени');
      await wait(Math.max(0, start + (i + 1) * 1000 / options.fps - performance.now()));
    }
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    await pending;
    if (failure) throw failure;
    if (!bytes) throw new Error('Резервный видеокодек не записал кадры. Попробуйте другой формат.');
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((item) => item.stop());
  }
}

export async function exportScene(project: Project, options: ExportConfig, playhead: number, file: OutputFile, signal: AbortSignal, report: Progress, preview?: (canvas: HTMLCanvasElement) => void) {
  const issue = checkExport(options);
  if (issue) throw new Error(issue);
  signal.throwIfAborted();
  const plan = framePlan(project, options, playhead);
  let current = 0;
  const renderer = options.traceSamples
    ? (await import('./traceFrames')).traceFrames(project, options, signal, (sample, canvas) => {
      if (sample > 0) preview?.(canvas);
      report(current, plan.frames, 'Трассировка · ' + sample + '/' + options.traceSamples + ' сэмплов');
    })
    : renderFrames(project, options);
  const draw = (frame: number) => {
    current = frame;
    return renderer.draw(sample => plan.time(frame, sample), options.format === 'png' ? 1 : options.motionSamples);
  };
  try {
    if (options.format === 'png') {
      await draw(0);
      const blob = await pngBlob(renderer.canvas);
      signal.throwIfAborted();
      file.append(new Uint8Array(await blob.arrayBuffer()));
      report(1, 1, 'Сборка файла');
    } else if (options.format === 'sequence') {
      let failure: unknown;
      const zip = new Zip((error, data) => { if (error) failure = error; else file.append(data); });
      try {
        for (let i = 0; i < plan.frames; i++) {
          signal.throwIfAborted();
          await draw(i);
          const blob = await pngBlob(renderer.canvas);
          signal.throwIfAborted();
          const entry = new ZipPassThrough('frame-' + String(i + 1).padStart(Math.max(4, String(plan.frames).length), '0') + '.png');
          zip.add(entry);
          entry.push(new Uint8Array(await blob.arrayBuffer()), true);
          if (failure) throw failure;
          await file.flush();
          report(i + 1, plan.frames, 'Рендер PNG');
          await yieldFrame();
        }
        zip.end();
        if (failure) throw failure;
      } finally { zip.terminate(); }
    } else await encodeVideo(renderer.canvas, draw, plan, options, file, signal, report);
    signal.throwIfAborted();
    await file.complete();
  } finally {
    renderer.dispose();
  }
}
