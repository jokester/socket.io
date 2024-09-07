import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import debug from 'debug'
debug.inspectOpts.depth = 10;

const debugLogger = debug('demo-server:build');

const ___file = new URL(import.meta.url).pathname;

const ___dirname = path.dirname(___file);
const sioPackagesRoot = path.join(___dirname, '../packages');
const sioServerlessRoot = path.join(___dirname, '../socket.io-serverless');
const mocksRoot = path.join(sioServerlessRoot, 'mocks');

async function getLocalSioDir(pkgName) {
  if (pkgName.includes('socket.io') || pkgName.includes('engine.io')) {
    return path.join(sioPackagesRoot, pkgName)
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

/**
 * @type {esbuild.BuildOptions}
 */
const nodeBuildContext = {
  entryPoints: ['src/node/main.ts'], // Change this to your entrypoint file
  bundle: true,
  platform: 'node',
  target: 'node18',
  metafile: true,
  outfile: 'dist/node-main.js',
  plugins: [rewireSocketIoPackages],
}

/**
 * @type {esbuild.BuildOptions}
 */

const cfBuildContext = {
  entryPoints: ['src/cf/main.ts'],
  bundle: true,
  platform: 'neutral',
  metafile: true,
  outfile: 'dist/cf-main.js',
  plugins: [rewireSocketIoPackages]
}

async function buildNode() {
  const buildResult = await esbuild.build(nodeBuildContext);
  debugLogger('build finish', buildResult);
}

async function buildCf() {
  const buildResult = await esbuild.build(cfBuildContext);
  debugLogger('build finish', buildResult);
}

async function watchMain() {

}

async function main() {
  b

}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildCf().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
