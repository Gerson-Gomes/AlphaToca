import { randomUUID } from 'crypto';
import { mkdir, rm, rmdir, writeFile } from 'fs/promises';
import path from 'path';

// Contract documents live under `uploads/contracts/<contractId>/` so they
// never collide with `uploads/<propertyId>/` from property images — the
// contract id is a different UUID namespace and mixing them would make
// disk scans ambiguous. The local-filesystem strategy mirrors
// propertyImageStorageService (US-006/US-007), keeping a single storage
// convention across the codebase.
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const CONTRACT_ROOT = path.join(UPLOADS_ROOT, 'contracts');

export interface SavedContractDocument {
  url: string;
  absolutePath: string;
}

function contractDir(contractId: string): string {
  return path.join(CONTRACT_ROOT, contractId);
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

// Saves a single signed PDF to disk. Returns the relative URL (matching
// the `/uploads/contracts/<contractId>/<file>.pdf` shape expected by the
// download endpoint US-015) AND the absolute path so the caller can
// compensate (delete the file) if the downstream DB write rolls back.
export async function saveSignedContractPdf(
  contractId: string,
  buffer: Buffer,
): Promise<SavedContractDocument> {
  const dir = contractDir(contractId);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.pdf`;
  const absolutePath = path.join(dir, filename);

  try {
    await writeFile(absolutePath, buffer);
    return {
      url: `/uploads/contracts/${contractId}/${filename}`,
      absolutePath,
    };
  } catch (error) {
    await rm(absolutePath, { force: true }).catch(() => undefined);
    await rmdir(dir).catch(() => undefined);
    throw error;
  }
}

// Removes a previously-saved signed PDF by its storage URL. Tolerates
// ENOENT (the file is already gone) and non-empty directory removal so
// it's safe to call even when state has drifted. Non-throwing on ENOTEMPTY
// matches the cleanup semantics of propertyImageStorageService.
export async function cleanupContractDocument(
  contractId: string,
  url: string,
): Promise<void> {
  const filename = path.basename(url);
  const dir = contractDir(contractId);
  const absolutePath = path.join(dir, filename);

  try {
    await rm(absolutePath, { force: false });
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }

  try {
    await rmdir(dir);
  } catch (err) {
    if (isEnoent(err)) return;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') return;
    throw err;
  }
}

// Directly remove an absolute path — used for rollback after a
// transactional DB write failure. Does NOT attempt rmdir cleanup because
// the parent directory may be in mid-write by a concurrent caller; leave
// empty-dir cleanup to the next cleanupContractDocument pass.
export async function removeContractDocumentAbsolute(
  absolutePath: string,
): Promise<void> {
  try {
    await rm(absolutePath, { force: true });
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
}
