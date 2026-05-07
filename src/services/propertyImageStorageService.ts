import { randomUUID } from 'crypto';
import { mkdir, rm, rmdir, writeFile } from 'fs/promises';
import path from 'path';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export interface SavedPropertyImage {
  url: string;
  isCover: boolean;
}

function propertyDir(propertyId: string): string {
  return path.join(UPLOADS_ROOT, propertyId);
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function savePropertyImages(
  propertyId: string,
  files: Express.Multer.File[],
): Promise<SavedPropertyImage[]> {
  if (files.length === 0) return [];

  const dir = propertyDir(propertyId);
  await mkdir(dir, { recursive: true });

  const saved: SavedPropertyImage[] = [];
  const writtenAbsolutePaths: string[] = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = MIME_TO_EXT[file.mimetype];
      if (!ext) {
        throw new Error('INVALID_FILE_TYPE');
      }

      const filename = `${randomUUID()}.${ext}`;
      const absolutePath = path.join(dir, filename);

      await writeFile(absolutePath, file.buffer);
      writtenAbsolutePaths.push(absolutePath);

      saved.push({
        url: `/uploads/${propertyId}/${filename}`,
        isCover: i === 0,
      });
    }

    return saved;
  } catch (error) {
    await Promise.all(
      writtenAbsolutePaths.map((p) =>
        rm(p, { force: true }).catch(() => undefined),
      ),
    );
    await rmdir(dir).catch(() => undefined);
    throw error;
  }
}

export async function cleanupPropertyImages(
  propertyId: string,
  urls: string[],
): Promise<void> {
  const dir = propertyDir(propertyId);

  await Promise.all(
    urls.map(async (url) => {
      const filename = path.basename(url);
      const absolutePath = path.join(dir, filename);
      try {
        await rm(absolutePath, { force: false });
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
    }),
  );

  try {
    await rmdir(dir);
  } catch (err) {
    if (isEnoent(err)) return;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') return;
    throw err;
  }
}
