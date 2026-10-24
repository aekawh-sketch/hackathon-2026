// Абстракция хранилища (ТЗ 4.6). Сейчас — локальный диск (том Docker, общий с воркером); S3 подключается вторым драйвером.
// Ключи строит только сервер; проверка формата не даёт выйти за каталог хранилища.
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

export interface Storage {
  put(key: string, data: Buffer | string): Promise<void>;
  read(key: string): Promise<{ stream: Readable; size: number } | null>;
  delete(prefix: string): Promise<void>;
  /** Копия файла под новым ключом (дублирование площадки вместе с панорамами). false — исходного файла нет. */
  copy(from: string, to: string): Promise<boolean>;
  /** Путь на диске — для воркера склейки, который работает с файлами. */
  pathOf(key: string): string;
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

export function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Недопустимый ключ хранилища: ${key}`);
}

export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  pathOf(key: string): string {
    assertKey(key);
    return join(this.root, key);
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // Запись во временный файл и переименование: читатель не увидит наполовину записанный файл.
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  async read(key: string) {
    const path = this.pathOf(key);
    try {
      const s = await stat(path);
      if (!s.isFile()) return null;
      return { stream: createReadStream(path), size: s.size };
    } catch {
      return null;
    }
  }

  async copy(from: string, to: string): Promise<boolean> {
    const src = this.pathOf(from);
    const dst = this.pathOf(to);
    if (!(await stat(src).catch(() => null))?.isFile()) return false;
    await mkdir(dirname(dst), { recursive: true });
    const tmp = `${dst}.${process.pid}.${Date.now()}.tmp`;
    await copyFile(src, tmp);
    await rename(tmp, dst);
    return true;
  }

  async delete(prefix: string): Promise<void> {
    await rm(this.pathOf(prefix), { recursive: true, force: true });
  }
}
