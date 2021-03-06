'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const merge = require('merge-objects');
const glob = require('glob');

const markbotMain = require('./markbot-main');
const markbotIgnoreParser = require('./markbot-ignore-parser');
const exists = require('./file-exists');
const stripPath = require('./strip-path');

const accessibilityTemplates = [
  'accessibility',
  'aria-landmarks',
  'html',
  'forms',
];

const getFileCodeLang = function (fullPath) {
  return fullPath.match(/\.(html|css|js)$/)[1];
};

const getAlternativeExtensions = function (ext) {
  switch (ext) {
    // case 'md':
      // return 'md|yml';
      // break;
    default:
      return ext;
  }
};

const isCheckingAccessibility = function (markbotFile) {
  if (markbotFile.allFiles && markbotFile.allFiles.html && markbotFile.allFiles.html.accessibility) return true;

  if (markbotFile.html) {
    let i = 0, total = markbotFile.html.length;

    for (i = 0; i < total; i++) {
      if (markbotFile.html[i].accessibility) return true;
    }
  }

  return false;
};

const bindAccessibilityProperties = function (markbotFile) {
  const forcedProperties = [
    'outline',
  ];

  if (markbotFile.allFiles && markbotFile.allFiles.html && markbotFile.allFiles.html.accessibility) {
    forcedProperties.forEach((prop) => {
      markbotFile.allFiles.html[prop] = true;
    });
  }

  if (markbotFile.html) {
    let i = 0, total = markbotFile.html.length;

    for (i = 0; i < total; i++) {
      if (markbotFile.html[i].accessibility) {
        forcedProperties.forEach((prop) => {
          markbotFile.html[i][prop] = true;
        });
      }
    }
  }

  return markbotFile;
};

const findCompatibleFiles = function (folderpath, ignore, ext) {
  const fullPath = path.resolve(folderpath);
  const minFileExts = new RegExp(`min\.(${ext})$`);
  const ignoreRegExps = ignore.map((item) => new RegExp(`^${item}`));
  const totalIgnores = ignoreRegExps.length;
  let files = glob.sync(`${fullPath}/**/*.+(${ext})`);

  if (!files) return [];

  files = files.filter((file) => {
    let strippedFile = stripPath(file, folderpath);

    if (file.match(minFileExts)) return false;

    for (let i = 0; i < totalIgnores; i++) {
      if (ignoreRegExps[i].test(strippedFile)) return false;
    }

    return true;
  });

  return files;
};

const mergeInheritedFiles = function (markbotFile) {
  let newMarkbotFile = {
    inheritFilesNotFound: [],
  };
  let templates = [];

  if (typeof markbotFile.inherit === 'string') markbotFile.inherit = [markbotFile.inherit];

  markbotFile.inherit.forEach((templateId) => {
    let inheritPath = path.resolve(`${__dirname}/../templates/${templateId}.yml`);

    if (exists.check(inheritPath)) {
      try {
        let y = yaml.safeLoad(fs.readFileSync(inheritPath, 'utf8'));
        if (y) templates.push(y);
      } catch (e) {
        let ln = (e.mark && e.mark.line) ? e.mark.line + 1 : '?';
        markbotMain.debug(`Error in the \`${templateId}\` template MarkbotFile, line ${ln}: ${e.message}`);
      }
    } else {
      newMarkbotFile.inheritFilesNotFound.push(templateId);
    }
  });

  templates.forEach((file) => {
    if (file.allFiles && file.allFiles.functionality && !Array.isArray(file.allFiles.functionality)) file.allFiles.functionality = [file.allFiles.functionality];

    newMarkbotFile = merge(newMarkbotFile, file);
  });

  newMarkbotFile = merge(newMarkbotFile, markbotFile);

  return newMarkbotFile;
};

const bindFunctionalityToHtmlFiles = function (markbotFile) {
  if (markbotFile.allFiles && markbotFile.allFiles.functionality && markbotFile.html) {
    if (!markbotFile.functionality) markbotFile.functionality = [];

    markbotFile.html.forEach((file) => {
      markbotFile.allFiles.functionality.forEach((func) => {
        markbotFile.functionality.push(merge({ path: file.path }, func));
      })
    });
  }

  return markbotFile;
};

const bindScreenshotsToHtmlFiles = function (markbotFile) {
  if (markbotFile.allFiles && markbotFile.allFiles.html && markbotFile.allFiles.html.screenshots) {
    if (!markbotFile.screenshots) markbotFile.screenshots = [];

    markbotFile.html.forEach((item, i) => {
      markbotFile.screenshots.push({
        path: item.path,
        sizes: markbotFile.allFiles.html.screenshots,
      });
    });
  }

  return markbotFile;
};

const mergeAllFilesProperties = function (markbotFile, key) {
  if (!markbotFile[key]) return markbotFile;

  markbotFile[key].forEach((item, i) => {
    if (!markbotFile.allFiles[key]) return;

    if ('path' in markbotFile[key][i] && markbotFile.allFiles[key].except) {
      if (markbotFile.allFiles[key].except.includes(markbotFile[key][i].path)) return;
    }

    markbotFile[key][i] = merge(Object.assign({}, markbotFile.allFiles[key]), item);
  });

  return markbotFile;
};

const bindAllFilesProperties = function (folderpath, ignoreFiles, markbotFile, next) {
  const keys = ['html', 'css', 'js', 'md', 'yml', 'files', 'functionality', 'performance'];

  keys.forEach((key) => {
    if (!markbotFile[key] && !markbotFile.allFiles[key]) return;

    if (markbotFile.allFiles[key] && !markbotFile[key]) {
      let files = findCompatibleFiles(folderpath, ignoreFiles, getAlternativeExtensions(key));

      if (!files) next(markbotFile);

      files.forEach((file) => {
        if (!markbotFile[key]) markbotFile[key] = [];

        markbotFile[key].push({ path: stripPath(file, folderpath), });
      });
    }

    markbotFile = mergeAllFilesProperties(markbotFile, key);
  });

  next(markbotFile);
};

const removeDuplicateScreenshotSizes = function (markbotFile) {
  if (!markbotFile.screenshots) return markbotFile;

  markbotFile.screenshots.forEach((item, i) => {
    if (Array.isArray(markbotFile.screenshots[i].sizes)) {
      markbotFile.screenshots[i].sizes = [...new Set(markbotFile.screenshots[i].sizes)];
    }
  });

  return markbotFile;
};

const mergeDuplicateFiles = function (markbotFile) {
  const keys = ['html', 'css', 'js', 'md', 'yml', 'files', 'performance'];

  keys.forEach((key) => {
    let paths = {};
    let dirs = {};

    if (!markbotFile[key]) return;

    markbotFile[key].forEach((item, i) => {
      if (!item.path) return;

      if (item.path in paths) {
        paths[item.path] = merge(paths[item.path], item);
      } else {
        paths[item.path] = item;
      }
    });

    markbotFile[key].forEach((item, i) => {
      if (!item.directory) return;

      if (item.directory in dirs) {
        dirs[item.directory] = merge(dirs[item.directory], item);
      } else {
        dirs[item.directory] = item;
      }
    });

    markbotFile[key] = [];

    Object.keys(paths).forEach((path) => {
      markbotFile[key].push(paths[path]);
    });

    Object.keys(dirs).forEach((path) => {
      markbotFile[key].push(dirs[path]);
    });
  });

  return removeDuplicateScreenshotSizes(markbotFile);
};

const populateDefaults = function (folderpath, ignoreFiles, markbotFile, next) {
  const markbotFileOriginal = JSON.parse(JSON.stringify(markbotFile));

  if (isCheckingAccessibility(markbotFile)) {
    if (markbotFile.inherit) {
      markbotFile.inherit = [...new Set(markbotFile.inherit.concat(accessibilityTemplates))];
    } else {
      markbotFile.inherit = accessibilityTemplates;
    }

    markbotFile = bindAccessibilityProperties(markbotFile);
  }

  if (!markbotFile.allFiles && !markbotFile.inherit) return next(markbotFile, ignoreFiles, markbotFileOriginal);
  if (markbotFile.inherit) markbotFile = mergeInheritedFiles(markbotFile);

  if (markbotFile.allFiles) {
    bindAllFilesProperties(folderpath, ignoreFiles, markbotFile, (mf) => {
      next(mergeDuplicateFiles(bindScreenshotsToHtmlFiles(bindFunctionalityToHtmlFiles(mf))), ignoreFiles, markbotFileOriginal);
    });
  } else {
    next(mergeDuplicateFiles(markbotFile), ignoreFiles, markbotFileOriginal);
  }
}

const getMarkbotFile = function (markbotFilePath, next) {
  let markbotFile, folderpath;

  try {
    markbotFile = yaml.safeLoad(fs.readFileSync(markbotFilePath, 'utf8'));
  } catch (e) {
    let ln = (e.mark && e.mark.line) ? e.mark.line + 1 : '?';
    markbotMain.debug(`Error in the folder’s MarkbotFile, line ${ln}: ${e.message}`);
  }

  folderpath = path.parse(markbotFilePath).dir;

  markbotIgnoreParser.parse(folderpath, (ignoreFiles) => {
    populateDefaults(folderpath, ignoreFiles, markbotFile, next);
  });
};

const buildFromFolder = function (folderpath, next) {
  let markbotFile;

  try {
    markbotFile = yaml.safeLoad(fs.readFileSync(path.resolve(__dirname + '/../templates/basic-dropped-folder.yml'), 'utf8'));
  } catch (e) {
    let ln = (e.mark && e.mark.line) ? e.mark.line + 1 : '?';
    markbotMain.debug(`Error in the \`basic-dropped-folder\` MarkbotFile, line ${ln}: ${e.message}`);
  }

  markbotIgnoreParser.parse(folderpath, (ignoreFiles) => {
    populateDefaults(folderpath, ignoreFiles, markbotFile, next);
  });
};

module.exports = {
  get: getMarkbotFile,
  buildFromFolder: buildFromFolder
};
