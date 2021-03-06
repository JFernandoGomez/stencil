import { BuildConfig, BuildContext, BuildResults, Diagnostic } from '../../util/interfaces';
import { buildError, buildWarn, catchError, writeFiles } from '../util';
import { COLLECTION_MANIFEST_FILE_NAME } from '../../util/constants';
import { copyComponentAssets } from '../component-plugins/assets-plugin';
import { writeAppManifest } from '../manifest/manifest-data';


export function writeBuildFiles(config: BuildConfig, ctx: BuildContext, buildResults: BuildResults) {
  // serialize and write the manifest file if need be
  writeAppManifest(config, ctx, buildResults);

  buildResults.files = Object.keys(ctx.filesToWrite).sort();
  const totalFilesToWrite = buildResults.files.length;

  const timeSpan = config.logger.createTimeSpan(`writePhase started, fileUpdates: ${totalFilesToWrite}`, true);

  // create a copy of all the files to write
  const filesToWrite = Object.assign({}, ctx.filesToWrite);

  // clear out the files to write object for the next build
  ctx.filesToWrite = {};

  // 1) empty the destination directory
  // 2) write all of the files
  // 3) copy all of the assets
  // not doing write and copy at the same time incase they
  // both try to create the same directory at the same time
  return emptyDestDir(config, ctx).then(() => {
    // kick off writing files
    return writeFiles(config.sys, config.rootDir, filesToWrite).catch(err => {
      catchError(ctx.diagnostics, err);
    });

  }).then(() => {
    // kick off copying component assets
    // and copy www/build to dist/ if generateDistribution is enabled
    return Promise.all([
      copyComponentAssets(config, ctx),
      generateDistribution(config, ctx.diagnostics)
    ]);

  }).then(() => {
    timeSpan.finish(`writePhase finished`);
  });
}


export function generateDistribution(config: BuildConfig, diagnostics: Diagnostic[]): Promise<any> {
  if (!config.generateDistribution) {
    // don't bother
    return Promise.resolve();
  }

  return Promise.all([
    readPackageJson(config, diagnostics),
    generatePackageModuleResolve(config)
  ]);
}


function readPackageJson(config: BuildConfig, diagnostics: Diagnostic[]) {
  const packageJsonPath = config.sys.path.join(config.rootDir, 'package.json');

  return new Promise((resolve, reject) => {
    config.sys.fs.readFile(packageJsonPath, 'utf-8', (err, packageJsonText) => {
      if (err) {
        reject(`Missing "package.json" file for distribution: ${packageJsonPath}`);
        return;
      }

      try {
        const packageJsonData = JSON.parse(packageJsonText);
        validatePackageJson(config, diagnostics, packageJsonData);
        resolve();

      } catch (e) {
        reject(e);
      }
    });
  });
}


export function validatePackageJson(config: BuildConfig, diagnostics: Diagnostic[], packageJsonData: any) {
  let distDir = config.sys.path.relative(config.rootDir, config.distDir);
  distDir += '/';

  if (packageJsonData.files) {
    if ((packageJsonData.files as string[]).indexOf(distDir) === -1 && (packageJsonData.files as string[]).indexOf('./' + distDir) === -1) {
      const err = buildError(diagnostics);
      err.header = `package.json error`;
      err.messageText = `package.json "files" array must contain the distribution directory "${distDir}" when generating a distribution.`;
    }
  }

  const main = config.sys.path.join(config.sys.path.relative(config.rootDir, config.collectionDir), 'index.js');
  if (packageJsonData.main !== main) {
    const err = buildError(diagnostics);
    err.header = `package.json error`;
    err.messageText = `package.json "main" property is required when generating a distribution and must be set to: ${main}`;
  }

  const types = config.sys.path.join(config.sys.path.relative(config.rootDir, config.collectionDir), 'index.d.ts');
  if (packageJsonData.types !== types) {
    const err = buildError(diagnostics);
    err.header = `package.json error`;
    err.messageText = `package.json "types" property is required when generating a distribution and must be set to: ${types}`;
  }

  const browser = config.sys.path.join(config.sys.path.relative(config.rootDir, config.distDir), config.namespace.toLowerCase() + '.js');
  if (packageJsonData.browser !== browser) {
    const err = buildError(diagnostics);
    err.header = `package.json error`;
    err.messageText = `package.json "browser" property is required when generating a distribution and must be set to: ${browser}`;
  }

  const collection = config.sys.path.join(config.sys.path.relative(config.rootDir, config.collectionDir), COLLECTION_MANIFEST_FILE_NAME);
  if (packageJsonData.collection !== collection) {
    const err = buildError(diagnostics);
    err.header = `package.json error`;
    err.messageText = `package.json "collection" property is required when generating a distribution and must be set to: ${collection}`;
  }

  if (typeof config.namespace !== 'string' || config.namespace.toLowerCase().trim() === 'app') {
    const err = buildWarn(diagnostics);
    err.header = `config warning`;
    err.messageText = `When generating a distribution it is recommended to choose a unique namespace, which can be updated in the stencil.config.js file.`;
  }
}


function generatePackageModuleResolve(config: BuildConfig) {
  const packageResolver = config.sys.path.join(config.collectionDir, 'index.js');

  return new Promise((resolve, reject) => {
    config.sys.fs.writeFile(packageResolver, '', err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}


function emptyDestDir(config: BuildConfig, ctx: BuildContext) {
  // empty promises :(
  const emptyPromises: Promise<any>[] = [];

  if (!ctx.isRebuild) {
    // don't bother emptying the directories when it's a rebuild

    if (config.generateWWW && !config.emptyWWW) {
      config.logger.debug(`empty buildDir: ${config.buildDir}`);
      emptyPromises.push(config.sys.emptyDir(config.buildDir));
    }

    if (config.generateDistribution && !config.emptyDist) {
      config.logger.debug(`empty distDir: ${config.distDir}`);
      emptyPromises.push(config.sys.emptyDir(config.distDir));
    }

  }

  // let's empty out the build dest directory
  return Promise.all(emptyPromises);
}
