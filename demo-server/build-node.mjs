import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';

async function getPkgsDir(pkgName) {
  if (pkgName.includes('socket.io') || pkgName.includes('engine.io')) {
    const localPath = path.join(path.resolve('../packages'), pkgName)
    return localPath
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
 * rewire imports to bundle ts file
 * @type {esbuild.Plugin}
 */
const resolveAliasPlugin = {
  name: 'resolve-alias',
  setup(build) {
    build.onResolve({filter: /./}, async args => {
      if (args.path.includes('socket.io') || args.path.includes('engine.io')) {
        console.log('onResolve', args);
      }
      switch (args.path) {
        case 'engine.io-parser':
        case 'socket.io':
        case 'socket.io-parser':
        case 'socket.io-adapter': {
          const rewired = path.join(await getPkgsDir(args.path), 'lib/index.ts');
          console.log('rewired', args.path, rewired);
          return {
            path: rewired
          }
        }
        case 'engine.io': {
          const rewired  =path.join(await getPkgsDir(args.path), 'lib/engine.io.ts');
          console.log('rewired', args.path, rewired);
          return {
            path: rewired
          }
        }
      }
      return null
    })
    0 && build.onResolve({ filter: /^@components|@utils/ }, args => {
      const aliasKey = Object.keys(alias).find(key => args.path.startsWith(key));
      if (aliasKey) {
        return { path: args.path.replace(aliasKey, alias[aliasKey]) };
      }
      return { path: args.path };
    });
  }
};

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
  plugins: [resolveAliasPlugin],
}).then(result => {
  console.log('build finish', result);
}).catch((e) => {
  console.error('build fail', e)

  process.exit(1);
});
