import { formats, type ExportFormat } from './config';

type FilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable: () => Promise<FileSystemWritableFileStream>;
}>;

const memoryLimit = 256 * 1024 * 1024;
const picker = () => (window as Window & { showSaveFilePicker?: FilePicker }).showSaveFilePicker;
export const canSaveDirectly = () => !!picker();

export async function outputFile(name: string, format: ExportFormat, direct: boolean, preview?: (blob: Blob) => void) {
  const media = formats[format];
  // eslint-disable-next-line no-control-regex -- exclude invalid filename characters from project names
  const filename = (name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'VS3D') + '.' + media.extension;
  const choose = direct ? picker() : undefined;
  const handle = choose && await choose.call(window, { suggestedName: filename, types: [{ description: media.label, accept: { [media.type]: ['.' + media.extension] } }] });
  const file = handle ? await handle.createWritable() : undefined;
  const parts: BlobPart[] = [];
  let pending = Promise.resolve();
  let failure: unknown;
  let size = 0;
  return {
    append(data: Uint8Array, position = size) {
      if (failure) return;
      if (!file && (position !== size || size + data.byteLength > memoryLimit)) {
        failure = new Error(position !== size ? 'Не удалось собрать файл.' : 'Файл превышает 256 МБ. Используйте запись сразу на диск или снизьте разрешение.');
        return;
      }
      size = Math.max(size, position + data.byteLength);
      const bytes = Uint8Array.from(data);
      if (file) {
        pending = pending.then(() => {
          if (failure) return;
          return file.write({ type: 'write', position, data: bytes });
        }).catch((error) => { failure = error; });
      } else parts.push(bytes);
    },
    async flush() {
      await pending;
      if (failure) throw failure;
    },
    async complete() {
      await this.flush();
      if (file) await file.close();
      else {
        const blob = new Blob(parts, { type: media.type });
        if (preview) { preview(blob); parts.length = 0; return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      parts.length = 0;
    },
    async abort() {
      await pending;
      if (file) await file.abort().catch(() => undefined);
      parts.length = 0;
    },
  };
}

export type OutputFile = Awaited<ReturnType<typeof outputFile>>;
