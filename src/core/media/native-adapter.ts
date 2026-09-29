import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { uuid } from '../../domain/validation';
import type { MediaFiles } from './files';

type NativeArchive = {
  copyToStaging(source: string, target: string): Promise<void>;
  inspect(uri: string): Promise<string>;
  verify(uri: string, hash: string, bytes: number): Promise<boolean>;
  publish(source: string, target: string, hash: string, bytes: number): Promise<void>;
  derive(source: string, target: string, edge: number): Promise<string>;
};
export function nativeMediaFiles(vaultId: string): MediaFiles {
  uuid(vaultId, 'vaultId');
  const root = new Directory(Paths.document, 'vaults', vaultId);
  const uri = (path: string) => {
    if (!/^(media|staging)\/[a-zA-Z0-9/._-]+$/.test(path) || path.includes('..')) throw new Error('Invalid relative media path');
    return new File(root, path).uri;
  };
  const native = () => {
    const module = requireOptionalNativeModule<NativeArchive>('ArchiveMedia');
    if (!module) throw new Error('NATIVE_MEDIA_UNAVAILABLE: rebuild the Android development client. iOS is not implemented.');
    return module;
  };
  return {
    uri,
    copy: (source, path) => native().copyToStaging(source, uri(path)),
    inspect: async path => JSON.parse(await native().inspect(uri(path))),
    verify: (path, hash, bytes) => native().verify(uri(path), hash, bytes),
    publish: (source, target, hash, bytes) => native().publish(uri(source), uri(target), hash, bytes),
    derive: async (source, target, edge) => JSON.parse(await native().derive(uri(source), uri(target), edge)),
    exists: async path => new File(uri(path)).exists,
    removeStaging: async path => {
      if (!/^staging\/[0-9a-f-]+\.part$/.test(path)) throw new Error('Only job staging may be removed');
      const file = new File(uri(path)); if (file.exists) file.delete();
    },
  };
}
