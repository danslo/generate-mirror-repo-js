const fs = require('fs');
const repo = require('./repository');
const {isVersionGreaterOrEqual} = require('./utils');
const zip = require('jszip');
const {
  createPackagesForRef,
  createPackageForRef,
  createMagentoCommunityEditionMetapackage,
  createMagentoCommunityEditionProject,
  createMetaPackageFromRepoDir,
  archiveFilePath
} = require('./package-modules');


async function listTagsFrom(url, from) {
  return (await repo.listTags(url)).filter(tag => isVersionGreaterOrEqual(tag, from));
}

async function copyAdditionalPackages(archiveDir) {
  const dir = `${__dirname}/../resource/additional-packages`;
  const dest = `${archiveDir}/additional`

  if (fs.existsSync(dir)) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, {recursive: true});

    fs.readdir(dir, (err, files) => {
      if (err) {
        console.log('' + err);
        return;
      }
      const archives = (files || [])
        .filter(file => file.slice(-4) === '.zip')
        .filter(file => ! fs.existsSync(`${dest}/${file}`));
      console.log(`Copying ${archives.length} additional archive(s) into build directory.`);
      archives.map(file => {
        fs.copyFile(`${dir}/${file}`, `${dest}/${file}`, err => err && console.log(err))
      })
    })
  }
}

async function createMagentoCommunityEditionMetapackagesSinceTag(url, from, fixVersions) {
  const tags = await listTagsFrom(url, from);
  console.log(`Versions to process: ${tags.join(', ')}`);
  for (const tag of tags) {
    console.log(`Processing ${tag}`);
    await createMagentoCommunityEditionMetapackage(url, tag, {dependencyVersions: (fixVersions?.[tag] ?? {})});
  }
  return tags;
}

async function createProjectPackagesSinceTag(url, from, fixVersions) {
  const tags = await listTagsFrom(url, from);
  console.log(`Versions to process: ${tags.join(', ')}`);
  for (const tag of tags) {
    console.log(`Processing ${tag}`);
    await createMagentoCommunityEditionProject(url, tag, {dependencyVersions: (fixVersions?.[tag] ?? {})});
  }
  return tags;
}

async function createMetaPackagesFromRepoDir(url, from, path, fixVersions) {
  const tags = await listTagsFrom(url, from);
  console.log(`Versions to process: ${tags.join(', ')}`);
  const built = [];
  for (const tag of tags) {
    console.log(`Processing ${tag}`);
    try {
      await createMetaPackageFromRepoDir(url, path, tag, {dependencyVersions: (fixVersions?.[tag] ?? {})});
      built.push(tag);
    } catch (exception) {
      console.log(exception.message || exception);
    }
  }
  return built;
}

async function createPackagesSinceTag(url, from, modulesPath, excludes, fixVersions) {
  const tags = await listTagsFrom(url, from);
  console.log(`Versions to process: ${tags.join(', ')}`);
  const built = [];
  for (const tag of tags) {
    console.log(`Processing ${tag}`);
    try {
      await createPackagesForRef(url, modulesPath, tag, {excludes, dependencyVersions: (fixVersions?.[tag] ?? {})});
      built.push(tag)
    } catch (exception) {
      console.log(exception.message || exception);
    }
  }
  return built;
}

async function createPackageSinceTag(url, from, modulesPath, excludes, composerJsonPath, emptyDirsToAdd, fixVersions) {
  const tags = await listTagsFrom(url, from);
  console.log(`Versions to process: ${tags.join(', ')}`);
  const built = [];
  for (const tag of tags) {
    console.log(`Processing ${tag}`);
    let composerJsonFile = '';
    // Note: if the composerJsonFile ends with the "template.json" the composer dependencies will be calculated
    // This is only used for the magento2-base-package
    if (composerJsonPath && composerJsonPath.length) {
      composerJsonFile = (composerJsonPath || '').replace('template.json', `${tag}.json`);
      composerJsonFile = fs.existsSync(composerJsonFile)
        ? composerJsonFile
        : composerJsonPath;
    }
    try {
      await createPackageForRef(url, modulesPath, tag, {excludes, composerJsonPath: composerJsonFile, emptyDirsToAdd, dependencyVersions: (fixVersions?.[tag] ?? {})});
      built.push(tag);
    } catch (exception) {
      console.log(exception.message || exception);
    }
  }
  return built;
}

async function replacePackageFiles(name, version, files) {
  const packageFilePath = archiveFilePath(name, version);
  if (!fs.existsSync(packageFilePath)) {
    throw {message: `Could not find archive for replacement: ${name}:${version}.`};
  }

  fs.readFile(packageFilePath, function(_, data) {
    zip.loadAsync(data).then(function(contents) {
      files.forEach(function(file) {
        const replacementFilePath = `${__dirname}/../resource/replace/${name}/${version}/${file}`;
        if (!fs.existsSync(replacementFilePath)) {
          throw {message: `Replacement file does not exist: ${replacementFilePath}`}
        }
        contents.file(file, fs.readFileSync(replacementFilePath));
      })
      const stream = contents.generateNodeStream({streamFiles: false, platform: 'UNIX'});
      stream.pipe(fs.createWriteStream(packageFilePath));
    })
  });
}

/**
 * @param {{repoUrl:String, fromTag:String}} instructions Array with build instructions
 * @returns {Promise<void>}
 */
async function processMirrorInstruction(instructions) {
  let tags = [];

  const {repoUrl, fromTag, extraRefToRelease, fixVersions} = instructions;

  await Promise.all(
    (extraRefToRelease || []).map(extra => repo.createTagForRef(repoUrl, extra.ref, extra.release, extra.details))
  );

  for (const packageDir of (instructions.packageDirs || [])) {
    const {label, dir, excludes} = Object.assign({excludes: []}, packageDir);
    console.log(`Packaging ${label}`);
    tags = await createPackagesSinceTag(repoUrl, fromTag, dir, excludes, fixVersions)
    console.log(label, tags);
  }

  for (const individualPackage of (instructions.packageIndividual || [])) {
    const defaults = {excludes: [], composerJsonPath: '', emptyDirsToAdd: []};
    const {label, dir, excludes, composerJsonPath, emptyDirsToAdd} = Object.assign(defaults, individualPackage);
    console.log(`Packaging ${label}`);
    tags = await createPackageSinceTag(repoUrl, fromTag, dir, excludes, composerJsonPath, emptyDirsToAdd, fixVersions);
    console.log(label, tags);
  }

  for (const packageMeta of (instructions.packageMetaFromDirs || [])) {
    const {label, dir} = packageMeta;
    console.log(`Packaging ${label}`);
    tags = await createMetaPackagesFromRepoDir(repoUrl, fromTag, dir, fixVersions);
    console.log(label, tags);
  }

  for (const packageReplacement of (instructions.packageReplacements || [])) {
    await replacePackageFiles(...Object.values(packageReplacement));
  }

  if (instructions.magentoCommunityEditionMetapackage) {
    console.log('Packaging Magento Community Edition Product Metapackage');
    tags = await createMagentoCommunityEditionMetapackagesSinceTag(repoUrl, fromTag, fixVersions);
    console.log('Magento Community Edition Product Metapackage', tags);
  }

  if (instructions.magentoCommunityEditionProject) {
    console.log('Packaging Magento Community Edition Project');
    tags = await createProjectPackagesSinceTag(repoUrl, fromTag, fixVersions);
    console.log('Magento Community Edition Project', tags);
  }
  
  repo.clearCache();
}

module.exports = {
  copyAdditionalPackages,
  processMirrorInstruction
}
