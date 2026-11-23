import { copyFile, mkdir, lstat, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { safeName } from './paths.js';
import { hash } from './cache.js';
import { fail } from './util.js';

// An explicit export leaves the normal library and analysis cache intact.
export async function savePdfToFolder(file, directory) {
  if (!isAbsolute(directory) || /[\x00-\x1f]/.test(directory)) throw fail('이 컴퓨터에서 확인한 저장 폴더의 절대 경로를 사용하세요.');
  const folder = resolve(directory);
  await mkdir(folder, { recursive:true, mode:0o700 });
  if (!(await lstat(folder)).isDirectory()) throw fail('실제 폴더 경로를 선택하세요. 바로가기에는 저장하지 않습니다.');
  let name = safeName(file.title || '강의자료.pdf');
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  const digest = hash(await readFile(file.path));
  for (let n=0; n<1000; n++) {
    const path = join(folder, n ? `${name.replace(/\.pdf$/i,'')} (${n}).pdf` : name);
    try { await copyFile(file.path, path, constants.COPYFILE_EXCL); return {path, directory:folder, title:name, reused:false}; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await lstat(path);
      if (info.isFile() && hash(await readFile(path)) === digest) return {path,directory:folder,title:name,reused:true};
    }
  }
  throw fail('같은 이름의 파일이 너무 많아요. 다른 폴더를 선택해 주세요.');
}
