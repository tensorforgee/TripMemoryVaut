import { requireOptionalNativeModule } from 'expo';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { ArchiveIO } from './portable';

type NativeArchive = {
  verifyExternal(uri: string, expected: string, bytes: number): Promise<boolean>;
  copyExternal(source: string, destination: string): Promise<number>;
};
const pathPattern = /^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/;
function checked(path: string): string {
  if (!pathPattern.test(path) || path.includes('..') || path.includes('\\') || path.startsWith('/')) throw new Error('Invalid portable archive path');
  return path;
}
function directory(root: string, relative?: string): Directory {
  return relative ? new Directory(root, ...checked(relative).split('/')) : new Directory(root);
}
function file(root: string, relative: string): File { return new File(root, ...checked(relative).split('/')); }
function archiveDirectory(root: string, relative?: string): Directory {
  if(!root.startsWith('content://')) return directory(root,relative);
  let current=new Directory(root);
  for(const part of relative ? checked(relative).split('/') : []) {
    const child=current.list().find(entry=>entry instanceof Directory&&entry.name===part);
    if(!(child instanceof Directory)) throw new Error(`Archive directory is missing: ${relative}`);
    current=child;
  }
  return current;
}
function archiveFile(root: string, relative: string): File {
  if(!root.startsWith('content://')) return file(root,relative);
  const parts=checked(relative).split('/'); const name=parts.pop()!;
  const child=archiveDirectory(root,parts.join('/')||undefined).list().find(entry=>entry instanceof File&&entry.name===name);
  if(!(child instanceof File)) throw new Error(`Archive file is missing: ${relative}`);
  return child;
}
function ensureParent(root: string, relative: string): void {
  const parts=checked(relative).split('/'); parts.pop();
  if(parts.length) directory(root,parts.join('/')).create({intermediates:true,idempotent:true});
}
function native(): NativeArchive {
  const module=requireOptionalNativeModule<NativeArchive>('ArchiveMedia');
  if(!module) throw new Error('NATIVE_MEDIA_UNAVAILABLE: rebuild the Android development client.');
  return module;
}
async function copyDirectory(source: Directory, destination: Directory): Promise<void> {
  for(const entry of source.list()) {
    if(entry instanceof Directory) await copyDirectory(entry,destination.createDirectory(entry.name));
    else {
      const ext=entry.name.split('.').pop()?.toLowerCase();
      const mime=ext==='json'?'application/json':ext==='html'?'text/html':ext==='txt'?'text/plain':ext==='geojson'?'application/geo+json':ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='png'?'image/png':'application/octet-stream';
      const target=destination.createFile(entry.name,mime);
      const copied=await native().copyExternal(entry.uri,target.uri);
      if(copied!==entry.size) throw new Error(`Export copy size mismatch: ${entry.name}`);
    }
  }
}

export function nativeArchiveIO(): ArchiveIO {
  return {
    createRoot: async root=>{
      const target=directory(root);
      if(root.startsWith('content://')) {
        if(!target.exists) throw new Error('Selected archive destination is unavailable.');
        if(target.list().length) throw new Error('Selected archive destination must be empty.');
        return;
      }
      target.create({intermediates:true,idempotent:false});
    },
    removeRoot: async root=>{const value=directory(root);if(value.exists)value.delete();},
    writeText: async(root,path,contents)=>{ensureParent(root,path);const target=file(root,path);if(target.exists)target.delete();target.create({intermediates:true});target.write(contents);},
    readText: (root,path)=>archiveFile(root,path).text(),
    copyFromUri: async(source,root,path)=>{ensureParent(root,path);const target=file(root,path);if(target.exists)throw new Error(`Archive path already exists: ${path}`);await new File(source).copy(target);},
    copyTree: async(source,destination)=>copyDirectory(directory(source),directory(destination)),
    exists: async(root,path)=>{try{return archiveFile(root,path).exists;}catch{return false;}},
    size: async(root,path)=>archiveFile(root,path).size??-1,
    fileUri: (root,path)=>archiveFile(root,path).uri,
    sha256Text: contents=>digestStringAsync(CryptoDigestAlgorithm.SHA256,contents),
    verifyFile: async(root,path,sha256,bytes)=>native().verifyExternal(archiveFile(root,path).uri,sha256,bytes),
  };
}

export function newExportStagingRoot(): string { return new Directory(Paths.cache,'portable-exports',randomUUID()).uri; }
export async function pickExportDestination(packageName: string): Promise<string> {
  const parent=await Directory.pickDirectoryAsync();
  return parent.createDirectory(packageName).uri;
}
export async function pickRestorePackage(): Promise<string> { return (await Directory.pickDirectoryAsync()).uri; }
