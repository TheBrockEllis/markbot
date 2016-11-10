'use strict';

const os = require('os');
const fs = require('fs');
const electron = require('electron');
const shell = electron.shell;
const markbot = electron.remote.require('./markbot');
const listener = electron.ipcRenderer;
const classify = require('../lib/classify');
const successMessages = require('./success-messages.json');
const robotBeeps = require('./robot-beeps.json');
const $body = document.querySelector('body');
const $dropbox = document.getElementById('dropbox');
const $checks = document.getElementById('checks-container');
const $checksLoader = document.getElementById('checks-loader');
const $messages = document.getElementById('messages');
const $messagesPositive = document.getElementById('messages-positive');
const $messagesLoader = document.getElementById('messages-loader');
const $messagesLoaderLabel = document.querySelector('.messages-loader-label');
const $messageHeader = document.getElementById('message-header');
const $robotLogo = document.querySelector('.robot-logo');
const $messageHeading = document.querySelector('h2.no-errors');
const $repoName = document.getElementById('folder');
const $signin = document.getElementById('sign-in');
// const $failure = document.getElementById('failure');
const $submit = document.getElementById('submit');
const $canvasBtn = document.getElementById('submit-btn');
const $messageCanvas = document.querySelector('.with-canvas-message');
const $messageNoCanvas = document.querySelector('.no-canvas-message');

let groups = {};
let checks = {};
let fullPath = false;
let hasErrors = false;
let checksCount = 0;
let checksCompleted = 0;
let checksRunning = false;
let summaryDisplayTimeout;

const buildCodeDiffErrorMessage = function (err, li) {
  var
    message = document.createElement('span'),
    code = document.createElement('section'),
    sawDiv = document.createElement('div'),
    expectedDiv = document.createElement('div'),
    sawHead = document.createElement('strong'),
    expectedHead = document.createElement('strong'),
    sawPre = document.createElement('pre'),
    expectedPre = document.createElement('pre')
  ;

  message.textContent = err.message;

  code.classList.add('error-code-block');
  sawDiv.classList.add('error-sample-saw');
  expectedDiv.classList.add('error-sample-expected');
  sawHead.textContent = 'Saw in your code:';
  expectedHead.textContent = 'Expected to see:';
  sawHead.classList.add('error-sample-head');
  expectedHead.classList.add('error-sample-head');

  err.code.saw.forEach(function (line, i) {
    var tag = document.createElement('code');
    tag.textContent = line;

    if (i == err.code.line) tag.classList.add('error-sample-line');

    sawPre.innerHTML += tag.outerHTML;
  });

  err.code.expected.forEach(function (line, i) {
    var tag = document.createElement('code');
    tag.textContent = line;

    if (i == err.code.line) tag.classList.add('error-sample-line');

    expectedPre.innerHTML += tag.outerHTML;
  });

  li.appendChild(message);

  sawDiv.appendChild(sawHead);
  sawDiv.appendChild(sawPre);
  expectedDiv.appendChild(expectedHead);
  expectedDiv.appendChild(expectedPre);

  code.appendChild(sawDiv);
  code.appendChild(expectedDiv);

  li.appendChild(code);
};

const displayDiffWindow = function (imgs, width) {
  markbot.showDifferWindow(imgs, width);
};

const buildImageDiffErrorMessage = function (err, li) {
  var
    message = document.createElement('span'),
    diff = document.createElement('span'),
    div = document.createElement('div'),
    imgWrap = document.createElement('div'),
    img = document.createElement('img'),
    expectedPercent = Math.ceil(err.diff.expectedPercent * 100),
    percent = Math.ceil(err.diff.percent * 100)
  ;

  div.classList.add('diff-wrap');
  message.textContent = err.message;
  diff.innerHTML = `${percent}% difference<br>Expecting less than ${expectedPercent}%`;
  imgWrap.classList.add('diff-img-wrap');
  img.src = `${err.images.diff}?${Date.now()}`;

  imgWrap.appendChild(img);
  div.appendChild(imgWrap);
  div.appendChild(diff);

  li.appendChild(message);
  li.appendChild(div);

  div.addEventListener('click', function () {
    displayDiffWindow(JSON.stringify(err.images), err.width);
  });
};

const buildTableErrorMessage = function (err, li) {
  let table = document.createElement('table');
  let caption = document.createElement('caption');
  let thead = document.createElement('thead');
  let tbody = document.createElement('tbody');
  let theadRow = document.createElement('tr');

  caption.innerHTML = err.message;
  table.appendChild(caption);

  err.headings.forEach(function (item) {
    let th = document.createElement('th');

    th.innerHTML = item;
    th.setAttribute('scope', 'col');
    theadRow.appendChild(th);
  });

  err.rows.forEach(function (item) {
    let tr = document.createElement('tr');
    let th = document.createElement('th');

    th.innerHTML = item.title;
    th.setAttribute('scope', 'row');
    tr.appendChild(th);

    if (item.highlight) tr.classList.add('highlight');

    item.data.forEach(function (data) {
      let td = document.createElement('td');

      td.innerHTML = prepareErrorText(data);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  thead.appendChild(theadRow);
  table.appendChild(thead);
  table.appendChild(tbody);
  li.appendChild(table);
};

const buildErrorMessageFromObject = function (err, li) {
  switch (err.type) {
    case 'code-diff':
      buildCodeDiffErrorMessage(err, li);
      break;
    case 'image-diff':
      buildImageDiffErrorMessage(err, li);
      break;
    case 'table':
      buildTableErrorMessage(err, li);
      break;
  }
};

const escapeHTML = function (err) {
  if (typeof err !== 'string') return err;

  return err.replace(/[&<>]/g, function (tag) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;'
    }[tag];
  });
};

const transformCodeBlocks = function (err) {
  if (typeof err !== 'string') return err;

  while (err.match(/`/)) {
    err = err.replace(/`/, '<samp>');
    err = err.replace(/`/, '</samp>');
  }

  return err;
};

const transformLinks = function (err) {
  if (typeof err !== 'string') return err;

  if (err.match(/@@/)) {
    err = err.replace(/@@(.+?)@@/g, '<a href="$1">$1</a>');
  }

  return err;
};

const transformStrong = function (err) {
  if (typeof err !== 'string') return err;

  if (err.match(/\*\*/)) {
    err = err.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  return err;
};

const transformMark = function (err) {
  if (typeof err !== 'string') return err;

  if (err.match(/\*\*\*/)) {
    err = err.replace(/\*\*\*(.+?)\*\*\*/g, '<mark>$1</mark>');
  }

  return err;
};

const prepareErrorText = function (err) {
  return transformCodeBlocks(transformStrong(transformMark(transformLinks(escapeHTML(err)))));
};

const displayErrors = function (group, label, linkId, errors, status, isMessages) {
  const
    $errorGroup = document.createElement('div'),
    $groupHead = document.createElement('h2'),
    $messageList = document.createElement('ul')
  ;

  if (!isMessages) hasErrors = true;

  $groupHead.textContent = groups[group].label + ' — ' + label;
  $groupHead.id = linkId;

  errors.forEach(function (err) {
    const li = document.createElement('li');

    if (typeof err == 'object') {
      buildErrorMessageFromObject(err, li);

      if (err.status) status = err.status;
    } else {
      li.innerHTML = prepareErrorText(err);
    }

    $messageList.appendChild(li)
  });

  switch (status) {
    case 'bypassed':
      $errorGroup.dataset.state = 'bypassed';
      break;
    case 'skip':
      let skipLi = document.createElement('li');
      skipLi.textContent = 'More checks skipped because of the above errors';
      skipLi.dataset.state = 'skipped';
      $messageList.appendChild(skipLi)
      break;
  }

  $errorGroup.appendChild($groupHead);
  $errorGroup.appendChild($messageList);

  if (isMessages) {
    $messagesPositive.appendChild($errorGroup);
    $messagesPositive.dataset.state = 'visible';
  } else {
    $messages.dataset.state = 'visible';
    $messages.appendChild($errorGroup);
  }
};

const displaySummary = function (group, label, linkId, messages) {
  clearTimeout(summaryDisplayTimeout);
  $messageHeader.dataset.state = 'computing';
  $submit.dataset.state = 'hidden';
  $messagesLoader.dataset.state = 'visible';

  if (hasErrors && checksCompleted >= checksCount) {
    $messageHeader.dataset.state = 'errors';
    $messagesLoader.dataset.state = 'hidden';
    checksRunning = false;
    // $failure.dataset.state = 'visible';
  }

  if (!hasErrors && checksCompleted >= checksCount) {
    summaryDisplayTimeout = setTimeout(function () {
      clearTimeout(summaryDisplayTimeout);
      $messageHeader.dataset.state = 'no-errors';
      $messageHeading.innerHTML = successMessages[Math.floor(Math.random() * successMessages.length)] + '!';
      $submit.dataset.state = 'visible';
      checksRunning = false;
      $messages.dataset.state = 'hidden';
      $messagesLoader.dataset.state = 'hidden';
      // $failure.dataset.state = 'hidden';
    }, 100);
  }

  if (messages && messages.length > 0) displayErrors(group, label, linkId, messages, '', true);
};

const reset = function () {
  clearTimeout(summaryDisplayTimeout);
  hasErrors = false;
  $messages.innerHTML = '';
  $messagesPositive.innerHTML = '';
  $checks.innerHTML = '';
  $checksLoader.dataset.state = 'visible';
  $messagesLoader.dataset.state = 'visible';
  $messagesLoaderLabel.innerHTML = robotBeeps[Math.floor(Math.random() * robotBeeps.length)] + '…';
  $messages.dataset.state = 'hidden';
  $messagesPositive.dataset.state = 'hidden';
  $messageHeader.dataset.state = 'computing';
  // $failure.dataset.state = 'hidden';
  $submit.dataset.state = 'hidden';
  $canvasBtn.removeAttribute('disabled');
  $canvasBtn.dataset.state = '';
  $canvasBtn.setAttribute('hidden', true);
  $messageNoCanvas.removeAttribute('hidden');
  $messageCanvas.setAttribute('hidden', true);
  groups = {};
  checks = {};
  checksCount = 0;
  checksCompleted = 0;
  checksRunning = false;
  console.groupEnd();
  console.group();
};

const startChecks = function () {
  console.log(fullPath);
  markbot.newDebugGroup(fullPath);
  checksRunning = true;
  markbot.onFileDropped(fullPath);
};

const fileDropped = function (path) {
  if (localStorage.getItem('github-username')) {
    reset();
    fullPath = path;
    startChecks();
    $dropbox.dataset.state = 'hidden';
  }
};

$body.classList.add(`os-${os.platform()}`);

if (os.platform() == 'darwin') {
  if (parseInt(os.release().split('.')[0]) >= 14) {
    $body.classList.add('macosx-gte-1010');
  } else {
    $body.classList.add('macosx-lt-1010');
  }
}

$body.ondragover = function (e) {
  e.stopImmediatePropagation();
  e.stopPropagation();
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  return false;
};

$body.ondragleave = function (e) {
  e.stopImmediatePropagation();
  e.stopPropagation();
  e.preventDefault();
  return false;
};

$body.ondrop = function (e) {
  e.preventDefault();

  if (!fs.statSync(e.dataTransfer.files[0].path).isDirectory()) {
    alert('Drop a folder onto Markbot instead of a single file');
    return false;
  }

  fileDropped(e.dataTransfer.files[0].path);

  return false;
};

document.getElementById('username-form').addEventListener('submit', function (e) {
  e.preventDefault();
  localStorage.setItem('github-username', document.getElementById('username').value);
  markbot.enableSignOut(localStorage.getItem('github-username'));
  $signin.dataset.state = 'hidden';
});

document.getElementById('submit-btn').addEventListener('click', function (e) {
  e.preventDefault();

  if (!hasErrors && !checksRunning) {
    $canvasBtn.dataset.state = 'processing';
    $canvasBtn.setAttribute('disabled', true);

    markbot.submitToCanvas(localStorage.getItem('github-username'), function (err, data) {
      if (!err && data.code == 200) {
        $canvasBtn.dataset.state = 'done';
      } else {
        $canvasBtn.dataset.state = '';
        $canvasBtn.removeAttribute('disabled');
        if (data.message) alert(data.message);
      }
    });
  }
});

document.addEventListener('click', function (e) {
  if (e.target.matches('#messages a')) {
    e.preventDefault();
    shell.openExternal(e.target.href);
  }
});

window.addEventListener('will-navigate', function (e) {
  e.preventDefault();
});

$repoName.addEventListener('click', function (e) {
  e.preventDefault();
  markbot.revealFolder();
});

listener.on('app:file-missing', function (event) {
  reset();
  $dropbox.dataset.state = 'visible';
});

listener.on('app:file-exists', function (event, repo) {
  $repoName.innerHTML = repo;
});

listener.on('app:with-canvas', function (event) {
  $canvasBtn.removeAttribute('hidden');
  $messageNoCanvas.setAttribute('hidden', true);
  $messageCanvas.removeAttribute('hidden');
});

listener.on('check-group:new', function (event, id, label) {
  const
    $groupHead = document.createElement('h2'),
    $groupTitle = document.createElement('span')
  ;

  clearTimeout(summaryDisplayTimeout);

  groups[id] = {
    label: label,
    elem: document.createElement('ul')
  };

  $groupTitle.classList.add('title-wrap');
  $groupTitle.textContent = label;

  $groupHead.appendChild($groupTitle);

  $checksLoader.dataset.state = 'hidden';
  $checks.appendChild($groupHead);
  $checks.appendChild(groups[id].elem);
});

listener.on('check-group:item-new', function (event, group, id, label) {
  var
    checkLi = null,
    checkId = group + id,
    checkClass = classify(checkId)
  ;

  checksCount++;
  clearTimeout(summaryDisplayTimeout);

  if (!checks[checkId]) {
    checks[checkId] = document.createElement('a');
    checks[checkId].href = '#' + checkClass;
    checks[checkId].dataset.id = checkClass;
    checkLi = document.createElement('li');
    checkLi.appendChild(checks[checkId]);
    groups[group].elem.appendChild(checkLi);
  }

  checks[checkId].textContent = label;
  displaySummary();
});

listener.on('check-group:item-computing', function (event, group, id) {
  var checkId = group + id;

  checks[checkId].dataset.status = 'computing';
  clearTimeout(summaryDisplayTimeout);

  displaySummary();
});

listener.on('check-group:item-bypass', function (event, group, id, label, errors) {
  var checkId = group + id;

  checksCompleted++;
  checks[checkId].dataset.status = 'bypassed';
  displayErrors(group, label, checks[checkId].dataset.id, errors, 'bypassed');

  displaySummary();
});

listener.on('check-group:item-complete', function (event, group, id, label, errors, skip, messages) {
  var checkId = group + id;

  checksCompleted++;

  if (errors && errors.length > 0) {
    checks[checkId].dataset.status = 'failed';
    displayErrors(group, label, checks[checkId].dataset.id, errors, skip);
  } else {
    checks[checkId].dataset.status = 'succeeded';
  }

  displaySummary(group, label, checks[checkId].dataset.id, messages);
})

listener.on('app:open-repo', function (event, path) {
  reset();
  fullPath = path;
  startChecks();
  $dropbox.dataset.state = 'hidden';
});

listener.on('app:re-run', function (event) {
  if (fullPath && !checksRunning) {
    reset();
    startChecks();
    $dropbox.dataset.state = 'hidden';
  }
});

$robotLogo.addEventListener('click', function (e) {
  if (fullPath && !checksRunning) {
    reset();
    startChecks();
    $dropbox.dataset.state = 'hidden';
  }
});

listener.on('app:sign-out', function (event) {
  localStorage.clear();
  markbot.disableSignOut();
  markbot.disableFolderMenuFeatures();
  markbot.disableWebServer();
  window.location.reload();
});

listener.on('app:file-dropped', function (event, path) {
  fileDropped(path);
});

listener.on('debug', function (event, ...args) {
  markbot.debug(args);
  console.log(...args);
});

listener.on('alert', function (event, message) {
  alert(message);
});

if (localStorage.getItem('github-username')) {
  $signin.dataset.state = 'hidden';
  markbot.enableSignOut(localStorage.getItem('github-username'));
}
