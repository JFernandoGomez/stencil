import { AssetsMeta, BuildConfig, BuildContext, ComponentOptions, ComponentMeta, ModuleFile } from '../../util/interfaces';
import { catchError, normalizePath } from '../util';
import { getAppDistDir, getAppWWWBuildDir } from '../app/generate-app-files';


export function normalizeAssetsDir(config: BuildConfig, userOpts: ComponentOptions, moduleFile: ModuleFile, cmpMeta: ComponentMeta)  {
  if (userOpts.assetsDir) {
    normalizeAssetDir(config, moduleFile, cmpMeta, userOpts.assetsDir);
  }

  if (Array.isArray(userOpts.assetsDirs)) {
    userOpts.assetsDirs.forEach(assetsDir => {
      normalizeAssetDir(config, moduleFile, cmpMeta, assetsDir);
    });
  }
}


function normalizeAssetDir(config: BuildConfig, moduleFile: ModuleFile, cmpMeta: ComponentMeta, assetsDir: string) {
  if (typeof assetsDir !== 'string' || assetsDir.trim() === '') return;

  const assetsMeta: AssetsMeta = {};

  // get the absolute path of the directory which the component is sitting in
  const componentDir = normalizePath(config.sys.path.dirname(moduleFile.tsFilePath));

  // get the relative path from the component file to the assets directory
  assetsDir = normalizePath(assetsDir.trim());

  if (config.sys.path.isAbsolute(assetsDir)) {
    // this path is absolute already!
    // add as the absolute path
    assetsMeta.absolutePath = assetsDir;

    // if this is an absolute path already, let's convert it to be relative
    assetsMeta.cmpRelativePath = config.sys.path.relative(componentDir, assetsDir);

  } else {
    // this path is relative to the component
    assetsMeta.cmpRelativePath = assetsDir;

    // create the absolute path to the asset dir
    assetsMeta.absolutePath = normalizePath(config.sys.path.join(componentDir, assetsDir));
  }

  (cmpMeta.assetsDirsMeta = cmpMeta.assetsDirsMeta || []).push(assetsMeta);
}


export function copyComponentAssets(config: BuildConfig, ctx: BuildContext) {

  if (skipAssetsCopy(config, ctx)) {
    // no need to recopy all assets again
    return Promise.resolve();
  }

  const timeSpan = config.logger.createTimeSpan(`copy assets started`, true);

  // get a list of all the directories to copy
  // these paths should be absolute
  const copyToBuildDir: AssetsMeta[] = [];
  const copyToCollectionDir: AssetsMeta[] = [];

  ctx.manifest.modulesFiles.forEach(moduleFile => {
    if (!moduleFile.cmpMeta.assetsDirsMeta || !moduleFile.cmpMeta.assetsDirsMeta.length) return;

    moduleFile.cmpMeta.assetsDirsMeta.forEach(assetsMeta => {
      copyToBuildDir.push(assetsMeta);

      if (!moduleFile.isCollectionDependency) {
        copyToCollectionDir.push(assetsMeta);
      }
    });
  });

  const dirCopyPromises: Promise<any>[] = [];

  // copy all of the files in asset directories to the app's build and/or dist directory
  copyToBuildDir.forEach(assetsMeta => {
    // figure out what the path is to the component directory
    if (config.generateWWW) {
      const wwwBuildDirDestination = normalizePath(config.sys.path.join(
        getAppWWWBuildDir(config),
        assetsMeta.cmpRelativePath
      ));

      // let's copy to the www/build directory!
      const copyToWWWBuildDir = config.sys.copy(assetsMeta.absolutePath, wwwBuildDirDestination);
      dirCopyPromises.push(copyToWWWBuildDir);
    }

    if (config.generateDistribution) {
      const distDirDestination = normalizePath(config.sys.path.join(
        getAppDistDir(config),
        assetsMeta.cmpRelativePath
      ));

      // let's copy to the www/build directory!
      const copyToDistDir = config.sys.copy(assetsMeta.absolutePath, distDirDestination);
      dirCopyPromises.push(copyToDistDir);
    }
  });


  // copy all of the files in asset directories to the dist/collection directory
  // but only do this copy when the generateCollection flag is set to true
  if (config.generateDistribution) {

    // copy all of the files in asset directories to the app's collection directory
    copyToCollectionDir.forEach(assetsMeta => {
      // figure out what the path is to the component directory
      const collectionDirDestination = normalizePath(config.sys.path.join(
        config.collectionDir,
        config.sys.path.relative(config.srcDir, assetsMeta.absolutePath)
      ));

      // let's copy to the dist/collection directory!
      const copyToCollectionDir = config.sys.copy(assetsMeta.absolutePath, collectionDirDestination);
      dirCopyPromises.push(copyToCollectionDir);
    });
  }

  return Promise.all(dirCopyPromises).catch(err => {
    catchError(ctx.diagnostics, err);

  }).then(() => {
    timeSpan.finish('copy assets finished');
  });
}


export function skipAssetsCopy(config: BuildConfig, ctx: BuildContext) {
  // always copy assets if it's not a rebuild
  if (!ctx.isRebuild) return false;

  // assume we want to skip copying assets again
  let shouldSkipAssetsCopy = true;

  // loop through each of the changed files
  ctx.changedFiles.forEach(changedFile => {
    // get the directory of where the changed file is in
    const changedFileDirPath = normalizePath(config.sys.path.dirname(changedFile));

    // loop through all the possible asset directories
    ctx.manifest.modulesFiles.forEach(moduleFile => {
      if (moduleFile.cmpMeta && moduleFile.cmpMeta.assetsDirsMeta) {

        // loop through each of the asset directories of each component
        moduleFile.cmpMeta.assetsDirsMeta.forEach(assetsDir => {
          // get the absolute of the asset directory
          const assetDirPath = normalizePath(assetsDir.absolutePath);

          // if the changed file directory is this asset directory
          // then we should recopy everything over again
          if (changedFileDirPath === assetDirPath) {
            shouldSkipAssetsCopy = false;
            return;
          }
        });

      }
    });

  });

  return shouldSkipAssetsCopy;
}
