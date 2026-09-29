import type { MediaEvidence } from '../../domain/media';
export type Variant = 'original' | 'display' | 'thumbnail';
export function mediaPath(hash: string, extension: string, variant: Variant = 'original'): string {
  if (!/^[a-f0-9]{64}$/.test(hash) || !['jpg','png'].includes(extension)) throw new Error('Invalid media path');
  const dir = variant === 'original' ? 'originals' : variant === 'display' ? 'display/v1' : 'thumbnails/v1';
  return `media/${dir}/${hash.slice(0, 2)}/${hash}.${extension}`;
}
export type Derivative = { bytes: number; checksum: string; width: number; height: number };
// All paths relative to the vault. The adapter owns streaming IO, never JS byte arrays.
export interface MediaFiles {
  copy(source: string, staging: string): Promise<void>;
  inspect(path: string): Promise<Omit<MediaEvidence, 'originalFilename' | 'sourceFidelity'>>;
  verify(path: string, hash: string, bytes: number): Promise<boolean>;
  publish(staging: string, final: string, hash: string, bytes: number): Promise<void>;
  derive(original: string, destination: string, edge: 320 | 2048): Promise<Derivative>;
  exists(path: string): Promise<boolean>;
  removeStaging(path: string): Promise<void>;
  uri(path: string): string;
}
