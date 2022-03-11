/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line no-console
console.log('preloaded~~~~~~~');
const { ipcRenderer, remote } = require('electron');

let mousedown = false;
let isDragging = false;
let offset = null;
let windowSize = null;
let pipTimer = 0;
function sendToHost(channel, message) {
  ipcRenderer.send(channel, message);
}
function getRatio() {
  return window.devicePixelRatio || 1;
}

window.onload = () => {
  const pipBtns = document.querySelector('.pip-buttons');
  if (window.location.href.includes('bilibili') && document.querySelector('iframe')) {
    document.querySelector('iframe').contentWindow.addEventListener('mousedown', (evt) => {
      if (!pipBtns && remote.getCurrentWindow()
        && remote.getCurrentWindow().getBrowserViews().length > 1) {
        if (evt.target.classList[0] === 'bilibili-live-player-video-danmaku') {
          offset = [evt.clientX, evt.clientY];
          if (getRatio() !== 1) {
            windowSize = remote.getCurrentWindow().getSize();
          }
        }
      }
      if (offset) {
        mousedown = true;
        sendToHost('update-mouse-info', { offset, windowSize });
      }
    }, true);
    document.querySelector('iframe').contentWindow.addEventListener('mousemove', () => {
      if (!pipBtns && remote.getCurrentWindow()
        && remote.getCurrentWindow().getBrowserViews().length > 1) {
        if (pipTimer) clearTimeout(pipTimer);
        sendToHost('mousemove', 'isMoving');
      }
      if (mousedown) isDragging = true;
    });
  }
};
document.addEventListener('DOMContentLoaded', () => {
  const danmu = document.querySelector('.danmu');
  const pip = document.querySelector('.pip');
  const floatTop = document.querySelector('.pin');
  const pipBtns = document.querySelector('.pip-buttons');
  // eslint-disable-next-line complexity
  function handleMousedown(evt) {
    if (!pipBtns && remote.getCurrentWindow()
      && remote.getCurrentWindow().getBrowserViews().length > 1) {
      const url = window.location.href;
      switch (true) {
        case url.includes('bilibili'):
          if (evt.target.tagName === 'VIDEO' || evt.target.parentElement.classList[0] === 'bilibili-live-player-video-operable-container' || ['bilibili-live-player-video-controller-container', 'bilibili-live-player-video-danmaku', 'bilibili-player-video-panel-image-detail', 'bilibili-player-video-panel', 'bilibili-player-video-subtitle', 'bilibili-player-video-top-title', 'bilibili-player-video-toast-top', 'bilibili-player-ending-panel', 'bilibili-player-electric-panel', 'bilibili-player-electric-panel-wrap'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('youtube'):
          if (evt.target.tagName === 'VIDEO' || ['ytp-ad-overlay-container', 'ytp-cued-thumbnail-overlay-image', 'ytp-upnext-paused', 'ytp-ad-text'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('iqiyi'):
          if (['VIDEO', 'CANVAS'].includes(evt.target.tagName)) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('douyu'):
          if (['VIDEO'].includes(evt.target.tagName) || ['video-container-dbc7dc', 'roomSmallPlayerFloatLayout', 'layout-Player-videoSub'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('huya'):
          if (['VIDEO', 'BODY'].includes(evt.target.tagName) || ['player-video', '_2yrglNsCHp7K38jZqGHfoV', '_3bvIa9Kka-wJ8cwRu3Uylw'].includes(evt.target.classList[0]) || evt.target.id === 'yanzhi-bg') {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('v.qq'):
          if (['txp_shadow', 'txp_ad_link'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('youku'):
          if (['youku-layer-wuliao', 'yk-trigger-layer'].includes(evt.target.classList[0]) || evt.target.parentElement.parentElement.classList[0] === 'h5-ext-layer') {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('twitch'):
          if (['VIDEO'].includes(evt.target.tagName) || ['pl-overlay', 'player-overlay', 'player-center-content', 'avap-ads-container'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('coursera'):
          if (['VIDEO'].includes(evt.target.tagName) || ['rc-VideoControlsContainer', 'rc-ControlBar'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('ted'):
          if ([' d:f@sm w:full h:full flx-d:r@sm a-i:s-b@sm ', ' sb pos:a pos:c w:full ', 'css-1c17hto', 'css-13wb0ss', 'css-1su2wlu', 'z-i:0 d:f j-c:s-a a-i:c l-h:d h:full', ' pos:a pos:c w:full z-i:2 p-x:9 '].includes(evt.target.classList.value)) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('lynda'):
          if (['mejs-captions-text', 'player', 'mejs-overlay', 'mejs-captions-position', 'mejs-captions-layer'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('masterclass'):
        case url.includes('open.163'):
        case url.includes('imooc'):
          if (['VIDEO'].includes(evt.target.tagName)) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('sports.qq'):
          if (['txp_ad_link', 'txp_shadow'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        case url.includes('study.163'):
        case url.includes('icourse163'):
          if (['bbg'].includes(evt.target.classList[0])) {
            offset = [evt.clientX, evt.clientY];
            if (getRatio() !== 1) {
              windowSize = remote.getCurrentWindow().getSize();
            }
          }
          break;
        default:
          offset = [evt.clientX, evt.clientY];
          if (getRatio() !== 1) {
            windowSize = remote.getCurrentWindow().getSize();
          }
          break;
      }
      if (offset) {
        mousedown = true;
        sendToHost('update-mouse-info', { offset, windowSize });
      }
    }
  }
  if (pipBtns) {
    pipBtns.style.display = 'flex';
    pipBtns.addEventListener('mousemove', () => {
      if (pipTimer) clearTimeout(pipTimer);
      sendToHost('pip-btn-mousemove');
      pipBtns.style.display = 'flex';
    });
    pipTimer = setTimeout(() => {
      pipBtns.style.display = 'none';
    }, 3000);
  }
  if (danmu) {
    danmu.addEventListener('mouseup', () => {
      sendToHost('danmu', 'danmu');
    });
  }
  if (floatTop) {
    floatTop.addEventListener('mouseup', () => {
      sendToHost('pin', 'pin');
    });
  }
  if (pip) {
    pip.addEventListener('mouseup', () => {
      sendToHost('pip', 'pip');
    });
  }
  window.addEventListener('mouseout', (evt) => {
    if (pipBtns) {
      sendToHost('pip-btn-mouseout');
    } else if (remote.getCurrentWindow()
      && remote.getCurrentWindow().getBrowserViews().length > 1) {
      const winSize = remote.getCurrentWindow().getSize();
      if (evt.clientX <= 0 || evt.clientX >= winSize[0] || evt.clientY >= winSize[1]) {
        sendToHost('mouseout', 'out');
      }
    }
  }, true);
  window.addEventListener('mousedown', handleMousedown, true);
  window.addEventListener('mousemove', (evt) => {
    if (!pipBtns && remote.getCurrentWindow()
      && remote.getCurrentWindow().getBrowserViews().length > 1) {
      if (pipTimer) clearTimeout(pipTimer);
      sendToHost('mousemove', 'isMoving');
    }
    if (mousedown) isDragging = true;
  }, true);
  window.addEventListener('click', (evt) => {
    if (isDragging && !pipBtns && offset) evt.stopImmediatePropagation();
    mousedown = false;
    isDragging = false;
    offset = null;
    windowSize = null;
    if (!pipBtns) sendToHost('update-mouse-info', { offset, windowSize });
  }, true);
  window.addEventListener('drop', (evt) => {
    evt.preventDefault();
    const files = Array.prototype.map.call(evt.dataTransfer.files, f => f.path);
    sendToHost('drop', { files });
  });
  window.addEventListener('dragover', (evt) => {
    evt.preventDefault();
    // evt.dataTransfer.dropEffect = process.platform === 'darwin' ? 'copy' : '';
    sendToHost('dragover', { dragover: true });
  });
  window.addEventListener('dragleave', (evt) => {
    evt.preventDefault();
    sendToHost('dragleave', { dragover: false });
  });
  window.addEventListener('keydown', (evt) => {
    if (pipBtns || (evt.keyCode === 13 && remote.getCurrentWindow()
      && remote.getCurrentWindow().getBrowserViews().length > 1)) {
      sendToHost('key-events', evt.keyCode);
    }
    if (document.webkitIsFullScreen && evt.keyCode === 27) {
      document.webkitCancelFullScreen();
    } else if ([67, 79, 80].includes(evt.keyCode)) {
      sendToHost('keydown', { targetName: evt.target.tagName });
    }
  });
});

const oauthRegex = [
  /^https:\/\/cnpassport.youku.com\//i,
  /^https:\/\/passport.iqiyi.com\/apis\/thirdparty/i,
  /^https:\/\/udb3lgn.huya.com\//i,
  /^https:\/\/api.weibo.com\/oauth2/i,
  /^https:\/\/graph.qq.com\//i,
  /^https:\/\/open.weixin.qq.com\//i,
  /^https:\/\/openapi.baidu.com\//i,
  /^https:\/\/auth.alipay.com\/login\//i,
  /^https:\/\/account.xiaomi.com\/pass\//i,
  /^https:\/\/www.facebook.com\/v[0-9].[0-9]\/dialog\/oauth/i,
  /^https:\/\/accounts.google.com\/signin\/oauth\//i,
  /^https:\/\/accounts.google.com\/CheckCookie\?/i,
  /^\/passport\/user\/tplogin\?/i,
  /^https:\/\/www.imooc.com\/passport\//i,
];

// Some websites intercept links to open a blank window, then set its location, e.g. iqiyi.com
const originWindowOpen = window.open.bind(window);
window.open = function customWindowOpen(url, strWindowName, strWindowFeatures) {
  if (url === 'about:blank') {
    return {
      set location(url) {
        if (url && url !== 'about:blank') customWindowOpen(url, strWindowName, strWindowFeatures);
      },
    };
  }

  if (oauthRegex.some(re => re.test(url))) {
    return originWindowOpen(url, strWindowName, strWindowFeatures);
  }

  sendToHost('open-url', { url });
  return {};
};
