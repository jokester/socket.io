import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';

const ___file = new URL(import.meta.url).pathname;

const ___dirname = path.dirname(___file);
const packagesDir = path.join(___dirname, '../packages');
const mocksDir = path.join(___dirname, '../packages');

async function getLocalSioDir(pkgName) {
  if (pkgName.includes('socket.io') || pkgName.includes('engine.io')) {
    return path.join(packagesDir, pkgName)
  }
  throw new Error(`Could not find package directory for ${pkgName}`)
}
/**
 * @param {string} pkgName
 * @returns {Promise<string>}
 */
async function findPackageDir2(pkgName) {
  try {
    // should be a file inside that package
    const resolved = import.meta.resolve(pkgName)
    const resolvedPath = new URL(resolved).pathname

    for (
      let dir = path.dirname(resolvedPath); dir !== path.dirname(dir); dir =path.dirname(dir)
    ) {
      if (path.basename(dir) === pkgName && fs.existsSync(path.join(dir, 'package.json'))) {
        return dir
      }
    }
    throw new Error(`Could not find package directory upward from ${resolved}`)
  } catch (e) {
    if (typeof e.path === 'string' && e.path.endsWith('/package.json')) {
      return path.dirname(e.path)
    }
    throw e
  }
}

/**
 * rewire sockket.io imports to bundle for Node.js
 * @type {esbuild.Plugin}
 */
const rewireSocketIoPackages = {
  name: 'rewireSocketIoPackages',
  setup(build) {
    build.onResolve({filter: /./}, async args => {
      switch (args.path) {
        case 'engine.io-parser':
        case 'socket.io':
        case 'socket.io-parser':
        case 'socket.io-adapter': {
          return {
            path: path.join(await getLocalSioDir(args.path), 'lib/index.ts')
          }
        }
        case 'engine.io': {
          return {
            path: path.join(await getLocalSioDir(args.path), 'lib/engine.io.ts')
          }
        }
      }
      return null
    })
  }
};

const rewireSocketIoServerlessImports = {

}

// Ensure the output directory exists
const outputDir = path.resolve(process.cwd(), 'dist');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Build and watch
esbuild.build({
  entryPoints: ['src/node/main.ts'], // Change this to your entrypoint file
  bundle: true,
  platform: 'node',
  target: 'node18',
  metafile: true,
  outfile: 'dist/node-main.js',
  plugins: [rewireSocketIoPackages],
}).then(result => {
  console.log('build finish', result);
}).catch((e) => {
  console.error('build fail', e)

  process.exit(1);
});
