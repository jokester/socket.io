import * as esbuild from 'esbuild';
import debug from 'debug';
import fsp from 'node:fs/promises';

const logger = debug('sio-worker:build');

const result = await esbuild.build({
  bundle: true,
  platform: 'node',
  outfile: '/dev/null',
  treeShaking: true,
  metafile: true,
  // logLevel: 'verbose',
  entryPoints: ['src/index.ts'],
});

logger('esbuild result', result);

importer: for (const [importerFile, value] of Object.entries(
  result.metafile.inputs
)) {
  const {imports, bytes} = value;
  // logger('input', name, value);

  // polyfill exists but is crappy
  const dangerousPolyfills = ['timer', 'http', 'https', 'crypto'].flatMap(o => [
    o,
    `node:${o}`,
  ]);

  const dangerousModules = ['node_modules/ws'];

  const dangousImports = ['uws'];

  importee: for (const importee of value.imports) {
    const usedDangerousModule = dangerousModules.some(m =>
      importee.path.includes(m)
    );
    if (usedDangerousModule) {
      logger(
        'import',
        importerFile,
        importee.original,
        importee.path
        // importee
      );

      break importee;
    }

    continue;

    const usedDangerousPolyfill = dangerousPolyfills.some(
      p => importee.path === p
    );

    if (usedDangerousPolyfill) {
      // logger( 'import', importerFile, importee.original, importee.path, importee );
      console.warn(
        'dangerous import',
        JSON.stringify(importee.path),
        'in',
        importerFile
      );
      continue;
    }
    if (
      [
        // 'events',
        // Uncaught TypeError: globalThis.XMLHttpRequest is not a constructor
        'base64id',
        'userver',
        'socket.io-adapter',
        'cluster-adapter',
      ].some(
        name =>
          importee.path.includes(name) || importee.original?.includes(name)
      ) ||
      ['ws', 'socket.io-adapter'].some(
        path => !importerFile.includes(path) && importee.path.includes(path)
      )
    ) {
    }
  }
}

await fsp.writeFile(
  `esbuild-meta.json`,
  JSON.stringify(result.metafile, null, 2)
);
