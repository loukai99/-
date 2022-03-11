import './helpers/setUserDataDir';
// Be sure to call Sentry function as early as possible in the main process
import '../shared/sentry';

import { app, BrowserWindow, session, Tray, ipcMain, globalShortcut, nativeImage, splayerx, systemPreferences, BrowserView, webContents, inAppPurchase, screen, dialog, Notification, shell } from 'electron' // eslint-disable-line
import {
  throttle, debounce, uniq, uniqBy,
} from 'lodash';
import os from 'os';
import path, {
  basename, dirname, extname, join, resolve,
} from 'path';
import fs from 'fs';
import qs from 'querystring';
import rimraf from 'rimraf';
import mkdirp from 'mkdirp';
import { audioGrabService } from './helpers/AudioGrabService';
import { applePayVerify } from './helpers/ApplePayVerify';
import './helpers/electronPrototypes';
import {
  isVideo, isSubtitle,
  getToken, saveToken, getEnvironmentName,
  getIP, crossThreadCache, calcCurrentChannel, isAudio,
} from '../shared/utils';
import { mouse } from './helpers/mouse';
import MenuService from './menu/MenuService';
import registerMediaTasks from './helpers/mediaTasksPlugin';
import { BrowserViewManager } from './helpers/BrowserViewManager';
import InjectJSManager from '../../src/shared/pip/InjectJSManager';
import Locale from '../shared/common/localize';

import losslessStreamingInstance from './helpers/LosslessStreaming';

// requestSingleInstanceLock is not going to work for mas
// https://github.com/electron-userland/electron-packager/issues/923
if (!process.mas && !app.requestSingleInstanceLock()) {
  app.quit();
}

/**
 * Check for restore mark and delete all user data
 */
const userDataPath = app.getPath('userData');
if (fs.existsSync(path.join(userDataPath, 'NEED_TO_RESTORE_MARK'))) {
  try {
    app.clearRecentDocuments();
    const tbdPath = `${userDataPath}-TBD`;
    if (fs.existsSync(tbdPath)) rimraf.sync(tbdPath);
    fs.renameSync(userDataPath, tbdPath);
    rimraf(tbdPath, (err) => {
      if (err) console.error(err);
    });
  } catch (ex) {
    console.error(ex);
    try {
      rimraf.sync(`${userDataPath}/**/!(lockfile)`);
      console.log('Successfully removed all user data.');
    } catch (ex) {
      console.error(ex);
    }
  }
}

/**
 * Set `__static` path to static files in production
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-static-assets.html
 */
if (process.env.NODE_ENV !== 'development') {
  global.__static = path.join(__dirname, '/static').replace(/\\/g, '\\\\') // eslint-disable-line
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('--enable-features', 'OverlayScrollbar');

let isGlobal = false;
let sidebar = false;
let welcomeProcessDone = false;
let menuService = null;
let routeName = null;
let mainWindow = null;
let loginWindow = null;
let aboutWindow = null;
let preferenceWindow = null;
let browsingWindow = null;
let downloadWindow = null;
let lastDownloadDate = 0;
let paymentWindow = null;
let openUrlWindow = null;
let losslessStreamingWindow = null;
let browserViewManager = null;
let pipControlView = null;
let titlebarView = null;
let downloadListView = null;
let premiumView = null;
let maskView = null;
let maskEventTimer = 0;
let maskDisappearTimer = 0;
let manualAbort = false;
let isBrowsingWindowMax = false;
let availableChannels = [];
let tray = null;
let pipTimer = 0;
let needToRestore = false;
let isVip = true; // set no limits
let inited = false;
let hideBrowsingWindow = false;
let finalVideoToOpen = [];
let signInEndpoint = '';
let signInSite = '';
let applePayProductID = '';
let applePayCurrency = '';
let paymentWindowCloseTag = false;
let applePayVerifyLock = false;
let paymentOrigin = '';
const environmentName = getEnvironmentName();
const locale = new Locale();
const tmpVideoToOpen = [];
const tmpSubsToOpen = [];
const titlebarUrl = process.platform === 'darwin' ? `file:${resolve(__static, 'pip/macTitlebar.html')}` : `file:${resolve(__static, 'pip/winTitlebar.html')}`;
const maskUrl = process.platform === 'darwin' ? `file:${resolve(__static, 'pip/mask.html')}` : `file:${resolve(__static, 'pip/mask.html')}`;
const mainURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080'
  : `file://${__dirname}/index.html`;
const aboutURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/about.html'
  : `file://${__dirname}/about.html`;
const paymentURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/payment.html'
  : `file://${__dirname}/payment.html`;
const preferenceURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/preference.html'
  : `file://${__dirname}/preference.html`;
const openUrlWindowURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/openUrl.html'
  : `file://${__dirname}/openUrl.html`;
let loginURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9081/login.html'
  : `file://${__dirname}/login.html`;
const browsingURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/browsing.html'
  : `file://${__dirname}/browsing.html`;
const downloadURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/download.html'
  : `file://${__dirname}/download.html`;
const downloadListURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/downloadList.html'
  : `file://${__dirname}/downloadList.html`;
let premiumURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9081/premium.html'
  : `file://${__dirname}/premium.html`;
const losslessStreamingURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080/losslessStreaming.html'
  : `file://${__dirname}/losslessStreaming.html`;

const tempFolderPath = path.join(app.getPath('temp'), 'splayer');
if (!fs.existsSync(tempFolderPath)) mkdirp.sync(tempFolderPath);

function hackWindowsRightMenu(win) {
  if (win) {
    win.hookWindowMessage(278, () => {
      win.setEnabled(false);
      setTimeout(() => {
        win.setEnabled(true);
      }, 100);
      return true;
    });
  }
}

function handleBossKey() {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    if (process.platform === 'darwin' && mainWindow.isFullScreen()) {
      mainWindow.once('leave-full-screen', handleBossKey);
      mainWindow.setFullScreen(false);
      return;
    }
    mainWindow.webContents.send('mainCommit', 'PAUSED_UPDATE', true);
    mainWindow.webContents.send('mainCommit', 'isHiddenByBossKey', true);
    mainWindow.hide();
    if (process.platform === 'win32') {
      tray = new Tray(nativeImage.createFromDataURL(require('../../build/icons/1024x1024.png')));
      tray.on('click', () => {
        mainWindow.show();
        mainWindow.webContents.send('mainCommit', 'isHiddenByBossKey', false);
        // Destroy tray in its callback may cause app crash
        setTimeout(() => {
          if (!tray) return;
          tray.destroy();
          tray = null;
        }, 10);
      });
    }
  }
}

function pipControlViewTitle(isGlobal) {
  const danmu = locale.$t('browsing.danmu');
  const title = isGlobal ? locale.$t('browsing.exitPip') : locale.$t('browsing.exitPop');
  const pin = locale.$t('browsing.pin');
  pipControlView.webContents
    .executeJavaScript(InjectJSManager.updatePipControlTitle(title, danmu, pin));
}

function createPipControlView() {
  if (pipControlView && !pipControlView.isDestroyed()) pipControlView.destroy();
  pipControlView = new BrowserView({
    webPreferences: {
      preload: `${require('path').resolve(__static, 'pip/preload.js')}`,
    },
  });
  browsingWindow.addBrowserView(pipControlView);
  pipControlView.webContents.loadURL(`file:${require('path').resolve(__static, 'pip/pipControl.html')}`);
  pipControlView.setBackgroundColor('#00FFFFFF');
  pipControlView.setBounds({
    x: Math.round(browsingWindow.getSize()[0] - 65),
    y: Math.round(browsingWindow.getSize()[1] / 2 - 72),
    width: 50,
    height: 144,
  });
}

function createDownloadListView(title, list, url, isVip, resolution, path) {
  locale.refreshDisplayLanguage();
  if (downloadListView && !downloadListView.isDestroyed()) downloadListView.destroy();
  downloadListView = new BrowserView({
    webPreferences: {
      nodeIntegration: true,
      preload: `${require('path').resolve(__static, 'download/preload.js')}`,
    },
  });
  mainWindow.addBrowserView(downloadListView);
  downloadListView.setBackgroundColor('#00FFFFFF');
  const availableList = list.find(i => i.ext === 'mp4')
    ? list.filter(i => i.acodec !== 'none' && i.vcodec !== 'none').filter(i => i.ext === 'mp4').sort((a, b) => parseInt(a['format_note'], 10) - parseInt(b['format_note'], 10))
    : list.filter(i => i.acodec !== 'none' && i.vcodec !== 'none').sort((a, b) => parseInt(a['format_note'], 10) - parseInt(b['format_note'], 10));
  const hasFormatNote = availableList.findIndex(i => i['format_note']) !== -1;
  const uniqList = uniqBy(availableList, hasFormatNote ? 'format_note' : 'format');
  let commonDefaultIndex = hasFormatNote ? uniqList.findIndex(i => i['format_note'].toLowerCase().includes(resolution)) : 0;
  if (commonDefaultIndex === -1) {
    const index = uniqList.findIndex(i => parseInt(i['format_note'], 10) > 480);
    commonDefaultIndex = index !== -1 ? index - 1 : uniqList.length - 1;
  }
  const vipDefaultIndex = hasFormatNote && uniqList.findIndex(i => i['format_note'].toLowerCase().includes(resolution)) !== -1
    ? uniqList.findIndex(i => i['format_note'].toLowerCase().includes(resolution)) : uniqList.length - 1;
  const unknownList = uniqList.filter(i => !i['format_note']);
  const normalList = uniqList.filter(i => i['format_note']);
  const listInfo = unknownList.concat(normalList).map((i, index) => {
    let selected = index === 0;
    if (normalList.length) {
      selected = isVip ? index === vipDefaultIndex : index === commonDefaultIndex;
    }
    const definition = i['format_note'] ? i['format_note'] : locale.$t('browsing.download.unknownResolution');
    const defaultName = `${title} (${definition}).${i.ext}`;
    const darwinName = (defaultName.startsWith('.') ? defaultName.slice(1) : defaultName).replace(/[:\\]/g, '');
    const name = process.platform === 'darwin' ? darwinName : defaultName.replace(/[\\?<>*|:/]/g, '');
    return {
      definition, name, selected, id: i['format_id'], ext: i.ext,
    };
  });
  downloadListView.webContents.loadURL(downloadListURL).then(() => {
    downloadListView.webContents.send('init-download-list', {
      listInfo, path, url, isVip,
    });
    if (!isVip) {
      const lastTime = new Date(lastDownloadDate);
      const newTime = new Date();
      const lastDate = lastTime.getDate();
      const lastMonth = lastTime.getMonth();
      const lastYear = lastTime.getFullYear();
      const nowDate = newTime.getDate();
      const nowMonth = newTime.getMonth();
      const nowYear = newTime.getFullYear();
      const available = (lastDate !== nowDate || lastMonth !== nowMonth || lastYear !== nowYear)
        && Date.now() > lastDownloadDate;
      if (!available) downloadListView.webContents.send('update-download-state', 'limited');
    }
  });
  downloadListView.setBounds({
    x: sidebar ? 76 : 0,
    y: 40,
    width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
    height: mainWindow.getSize()[1] - 40,
  });
  downloadListView.setAutoResize({
    width: true,
    height: true,
  });
}

function createTitlebarView() {
  if (titlebarView) titlebarView.destroy();
  titlebarView = new BrowserView({
    webPreferences: {
      preload: `${require('path').resolve(__static, 'pip/titlebarPreload.js')}`,
    },
  });
  browsingWindow.addBrowserView(titlebarView);
  titlebarView.webContents.loadURL(titlebarUrl);
  titlebarView.setBackgroundColor('#00FFFFFF');
  titlebarView.setBounds({
    x: 0, y: 0, width: browsingWindow.getSize()[0], height: 36,
  });
}

function createMaskView() {
  if (maskView) maskView.destroy();
  maskView = new BrowserView();
  browsingWindow.addBrowserView(maskView);
  maskView.webContents.loadURL(maskUrl);
  maskView.setBackgroundColor('#00FFFFFF');
  maskView.setBounds({
    x: 0, y: 0, width: browsingWindow.getSize()[0], height: browsingWindow.getSize()[1],
  });
  maskView.webContents.executeJavaScript(`
    document.body.style.backgroundColor = 'rgba(255, 255, 255, 0.18)';
  `);
}

function markNeedToRestore() {
  fs.closeSync(fs.openSync(path.join(app.getPath('userData'), 'NEED_TO_RESTORE_MARK'), 'w'));
}

function searchSubsInDir(dir) {
  const dirFiles = fs.readdirSync(dir);
  return dirFiles
    .filter(subtitleFilename => isSubtitle(subtitleFilename))
    .map(subtitleFilename => (join(dir, subtitleFilename)));
}
function searchForLocalVideo(subSrc) {
  const videoDir = dirname(subSrc);
  const videoBasename = basename(subSrc, extname(subSrc)).toLowerCase();
  const videoFilename = basename(subSrc).toLowerCase();
  const dirFiles = fs.readdirSync(videoDir);
  return dirFiles
    .filter((subtitleFilename) => {
      const lowerCasedName = subtitleFilename.toLowerCase();
      return (
        isVideo(lowerCasedName) // TODO: audio
        && lowerCasedName.slice(0, lowerCasedName.lastIndexOf('.')) === videoBasename
        && lowerCasedName !== videoFilename && !isSubtitle(lowerCasedName)
      );
    })
    .map(subtitleFilename => (join(videoDir, subtitleFilename)));
}
function getAllValidVideo(onlySubtitle, files) {
  try {
    const videoFiles = [];

    for (let i = 0; i < files.length; i += 1) {
      if (fs.statSync(files[i]).isDirectory()) {
        const dirPath = files[i];
        const dirFiles = fs.readdirSync(dirPath).map(file => path.join(dirPath, file));
        files.push(...dirFiles);
      }
    }
    if (!process.mas) {
      files.forEach((tempFilePath) => {
        const baseName = path.basename(tempFilePath);
        if (baseName.startsWith('.') || fs.statSync(tempFilePath).isDirectory()) return;
        if (isSubtitle((tempFilePath))) {
          const tempVideo = searchForLocalVideo(tempFilePath);
          videoFiles.push(...tempVideo);
        } else if (isVideo(tempFilePath) || isAudio(tempFilePath)) {
          videoFiles.push(tempFilePath);
        }
      });
    } else {
      files.forEach((tempFilePath) => {
        const baseName = path.basename(tempFilePath);
        if (baseName.startsWith('.') || fs.statSync(tempFilePath).isDirectory()) return;
        if (isVideo(tempFilePath) || isAudio(tempFilePath)) {
          videoFiles.push(tempFilePath);
        }
      });
    }
    return uniq(videoFiles);
  } catch (ex) {
    return [];
  }
}

function setBoundsCenterByOriginWindow(origin, win, width, height) {
  const displays = screen.getAllDisplays();
  const list = displays.map(e => ({
    x: e.workArea.x,
    left: Number((e.workArea.x + (e.workArea.width - width) / 2).toFixed(0)),
    top: Number((e.workArea.y + (e.workArea.height - height) / 2).toFixed(0)),
  })).sort((l, r) => l.x - r.x);
  if (origin && win && list.length > 1) {
    try {
      const pos = origin.getPosition();
      const bounds = pos[0] > list[1].x ? {
        x: list[1].left,
        y: list[1].top,
      } : {
        x: list[0].left,
        y: list[0].top,
      };
      win.setBounds(bounds);
    } catch (error) {
      console.log(error);
    }
  }
}

function createOpenUrlWindow() {
  const openUrlWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width: 450,
    height: 206,
    transparent: true,
    resizable: false,
    show: false,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
      preload: `${require('path').resolve(__static, 'openUrl/preload.js')}`,
    },
    acceptFirstMouse: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
  };
  if (!openUrlWindow) {
    openUrlWindow = new BrowserWindow(openUrlWindowOptions);
    // 如果播放窗口顶置，打开首选项也顶置
    if (mainWindow && mainWindow.isAlwaysOnTop()) {
      openUrlWindow.setAlwaysOnTop(true);
    }
    openUrlWindow.loadURL(`${openUrlWindowURL}`);
    openUrlWindow.on('closed', () => {
      openUrlWindow = null;
    });
  } else {
    openUrlWindow.focus();
  }
  openUrlWindow.once('ready-to-show', () => {
    openUrlWindow.show();
  });
  openUrlWindow.on('focus', () => {
    menuService?.enableMenu(false);
  });
  if (process.platform === 'win32') {
    hackWindowsRightMenu(openUrlWindow);
  }
  setBoundsCenterByOriginWindow(mainWindow, openUrlWindow, 540, 426);
}

function createPremiumView(e, route) {
  if (!premiumView) {
    premiumView = new BrowserView({
      webPreferences: {
        preload: `${require('path').resolve(__static, 'premium/preload.js')}`,
        webSecurity: false,
        nativeWindowOpen: true,
      },
    });
    premiumView.setBackgroundColor('#3B3B41');
    preferenceWindow.setBrowserView(premiumView);
    if (route) premiumView.webContents.loadURL(`${premiumURL}#/${route}`);
    else premiumView.webContents.loadURL(`${premiumURL}`);
    premiumView.webContents.userAgent = `${premiumView.webContents.userAgent.replace(/Electron\S+/i, '')} SPlayerX@2018 Platform/${os.platform()} Release/${os.release()} Version/${app.getVersion()} EnvironmentName/${environmentName}`;
    premiumView.setBounds({
      x: 110,
      y: 0,
      width: preferenceWindow.getSize()[0] - 110,
      height: preferenceWindow.getSize()[1],
    });
    if (process.env.NODE_ENV === 'development') {
      setTimeout(() => { // wait some time to prevent `Object not found` error
        premiumView.webContents.openDevTools();
      }, 1000);
    }
  } else if (premiumView && !premiumView.webContents.isDestroyed()) {
    premiumView.webContents.send('premium-route-change', route);
  }
}

function createPreferenceWindow(e, route) {
  const preferenceWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width: 592,
    height: 468,
    transparent: true,
    resizable: false,
    show: false,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
    },
    acceptFirstMouse: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
  };
  if (!preferenceWindow) {
    preferenceWindow = new BrowserWindow(preferenceWindowOptions);
    // 如果播放窗口顶置，打开首选项也顶置
    if (mainWindow && mainWindow.isAlwaysOnTop()) {
      preferenceWindow.setAlwaysOnTop(true);
    }
    if (route) preferenceWindow.loadURL(`${preferenceURL}#/${route}`);
    else preferenceWindow.loadURL(`${preferenceURL}`);
    preferenceWindow.on('closed', () => {
      preferenceWindow = null;
      if (paymentWindow) {
        paymentWindow.close();
      }
    });
    preferenceWindow.webContents.userAgent = `${preferenceWindow.webContents.userAgent.replace(/Electron\S+/i, '')}SPlayerX@2018 Platform/${os.platform()} Release/${os.release()} Version/${app.getVersion()} EnvironmentName/${environmentName}`;
  } else {
    if (!preferenceWindow.webContents.isDestroyed()) {
      preferenceWindow.webContents.send('route-change', route);
    }
    preferenceWindow.focus();
  }
  preferenceWindow.once('ready-to-show', () => {
    preferenceWindow.show();
  });
  preferenceWindow.on('focus', () => {
    menuService?.enableMenu(false);
  });
  if (process.platform === 'win32') {
    hackWindowsRightMenu(preferenceWindow);
  }
  setBoundsCenterByOriginWindow(mainWindow, preferenceWindow, 540, 426);
  if (!premiumView) {
    // 预先加载好PremiumView
    createPremiumView(e, route);
    preferenceWindow.removeBrowserView(premiumView);
  }
}

function createLoginWindow(e, fromWindow, route) {
  const loginWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width: 412,
    height: 284,
    webPreferences: {
      experimentalFeatures: true,
      webSecurity: false,
      preload: `${require('path').resolve(__static, 'login/preload.js')}`,
    },
    transparent: true,
    resizable: false,
    show: true,
    acceptFirstMouse: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    backgroundColor: '#44444b',
  };
  if (!loginWindow) {
    loginWindow = new BrowserWindow(loginWindowOptions);
    // 登录窗口顶置
    loginWindow.setAlwaysOnTop(true);
    if (route) loginWindow.loadURL(`${loginURL}#/${route}`);
    else loginWindow.loadURL(`${loginURL}`);

    loginWindow.on('closed', () => {
      loginWindow = null;
    });
    loginWindow.webContents.userAgent = `${loginWindow.webContents.userAgent.replace(/Electron\S+/i, '')} SPlayerX@2018 Platform/${os.platform()} Release/${os.release()} Version/${app.getVersion()} EnvironmentName/${environmentName}`;
    if (process.env.NODE_ENV === 'development') {
      setTimeout(() => { // wait some time to prevent `Object not found` error
        if (loginWindow) loginWindow.openDevTools({ mode: 'detach' });
      }, 1000);
    }
  } else {
    loginWindow.focus();
  }
  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
  });
  loginWindow.on('focus', () => {
    menuService?.enableMenu(false);
  });
  if (process.platform === 'win32') {
    hackWindowsRightMenu(loginWindow);
  }
  // login window setbounds on mainwidnow
  const win = fromWindow === 'preference' ? preferenceWindow : mainWindow;
  setBoundsCenterByOriginWindow(win, loginWindow, 412, 284);
  if (fromWindow !== 'main' && mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('clear-signIn-callback');
  }
  if (fromWindow !== 'preference' && preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
    preferenceWindow.webContents.send('clear-signIn-callback');
  }
}

function createAboutWindow() {
  const aboutWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width: 230,
    height: 300,
    transparent: true,
    resizable: false,
    show: false,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
    },
    acceptFirstMouse: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
  };
  if (!aboutWindow) {
    aboutWindow = new BrowserWindow(aboutWindowOptions);
    // 如果播放窗口顶置，打开关于也顶置
    if (mainWindow && mainWindow.isAlwaysOnTop()) {
      aboutWindow.setAlwaysOnTop(true);
    }
    aboutWindow.loadURL(`${aboutURL}`);
    aboutWindow.on('closed', () => {
      aboutWindow = null;
    });
  }
  aboutWindow.once('ready-to-show', () => {
    aboutWindow.show();
  });
  if (process.platform === 'win32') {
    hackWindowsRightMenu(aboutWindow);
  }
}

function createDownloadWindow(args) {
  const downloadWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width: 460,
    minWidth: 460,
    maxWidth: 460,
    height: 500,
    minHeight: 500,
    resizable: true,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
      webviewTag: true,
      preload: `${require('path').resolve(__static, 'download/downloadWindowPreload.js')}`,
      devTools: false,
    },
    backgroundColor: '#FFFFFF',
    acceptFirstMouse: false,
    show: false,
  };
  downloadWindow = new BrowserWindow(downloadWindowOptions);
  downloadWindow.loadURL(`${downloadURL}`);
  downloadWindow.on('closed', () => {
    downloadWindow = null;
    if (process.platform === 'win32' && isGlobal) {
      app.quit();
    }
  });
  downloadWindow.once('ready-to-show', () => {
    if (args.show) downloadWindow.show();
    if (Object.prototype.toString.call(args.info).toLowerCase() === '[object array]') {
      downloadWindow.send('continue-download-video', args.info);
    } else if (Object.prototype.toString.call(args.info).toLowerCase() === '[object object]' && !manualAbort) {
      downloadWindow.send('download-video', args.info);
    }
    manualAbort = false;
  });
}
function createBrowsingWindow(args) {
  const browsingWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
      webviewTag: true,
    },
    backgroundColor: '#000000',
    acceptFirstMouse: false,
    show: false,
  };
  browsingWindow = new BrowserWindow(browsingWindowOptions);
  browsingWindow.loadURL(`${browsingURL}`);
  browsingWindow.on('closed', () => {
    browsingWindow = null;
    if (process.platform === 'win32' && isGlobal) {
      app.quit();
    }
  });
  browsingWindow.once('ready-to-show', () => {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (details.requestHeaders.Cookie) {
        if (downloadWindow) downloadWindow.send('download-headers', details.requestHeaders);
        if (mainWindow) mainWindow.send('get-info-cookie', details.requestHeaders.Cookie);
      }
      callback({ requestHeaders: details.requestHeaders });
    });
  });
  if (browsingWindow) {
    browsingWindow.setSize(args.size[0], args.size[1]);
    if (args.position.length) {
      browsingWindow.setPosition(args.position[0], args.position[1]);
    }
    browsingWindow.on('focus', () => {
      menuService?.updateFocusedWindow(false, mainWindow && mainWindow.isVisible());
    });
    browsingWindow.on('move', throttle(() => {
      if (!mainWindow) return;
      mainWindow.send('update-pip-pos', browsingWindow.getPosition());
    }, 100));
    browsingWindow.on('always-on-top-changed', (e, top) => {
      if (pipControlView) {
        pipControlView.webContents.executeJavaScript(InjectJSManager.updatePinState(top));
      }
    });
    browsingWindow.on('leave-full-screen', () => {
      if (hideBrowsingWindow) {
        hideBrowsingWindow = false;
        browsingWindow.hide();
        setTimeout(() => {
          mainWindow.focus();
        }, 0);
      }
    });
  }
}

function createPaymentWindow(url, orderID, channel) {
  if (!preferenceWindow) return;
  const width = channel === 'wxpay' ? 270 : 1200;
  const height = channel === 'wxpay' ? 462 : 890;
  const paymentWindowOptions = {
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width,
    height,
    transparent: true,
    resizable: false,
    show: false,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
      webviewTag: true,
    },
    acceptFirstMouse: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
  };
  if (!paymentWindow) {
    paymentWindow = new BrowserWindow(paymentWindowOptions);
    // 如果播放窗口顶置，打开关于也顶置
    if (mainWindow && mainWindow.isAlwaysOnTop()) {
      paymentWindow.setAlwaysOnTop(true);
    }
    paymentWindow.loadURL(`${paymentURL}?url=${url}&orderID=${orderID}&type=${channel}`);
    paymentWindow.on('closed', () => {
      if (premiumView && !premiumView.webContents.isDestroyed()
        && !paymentWindowCloseTag) {
        premiumView.webContents.send('close-payment');
      }
      if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
        preferenceWindow.webContents.send('close-payment');
      }
      paymentWindow = null;
      paymentWindowCloseTag = false;
    });
  } else {
    paymentWindow.focus();
    paymentWindow.setBounds({
      width,
      height,
    });
    paymentWindow.loadURL(`${paymentURL}?url=${url}&orderID=${orderID}&type=${channel}`);
  }
  paymentWindow.once('ready-to-show', () => {
    paymentWindow.show();
  });
  if (process.platform === 'win32') {
    hackWindowsRightMenu(paymentWindow);
  }
  setBoundsCenterByOriginWindow(preferenceWindow, paymentWindow, width, height);
  if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
    preferenceWindow.webContents.send('add-payment');
  }
}

function createLosslessStreamingWindow() {
  if (losslessStreamingWindow && !losslessStreamingWindow.webContents.isDestroyed()) {
    losslessStreamingWindow.focus();
    return;
  }
  const losslessStreamingWindowOptions = {
    frame: false,
    titleBarStyle: 'none',
    minWidth: 300,
    maxWidth: 300,
    minHeight: 350,
    width: 300,
    height: 400,
    transparent: true,
    resizable: true,
    show: false,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
    },
    acceptFirstMouse: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
  };
  if (!losslessStreamingWindow) {
    losslessStreamingWindow = new BrowserWindow(losslessStreamingWindowOptions);
    const info = losslessStreamingInstance.getInfo();
    losslessStreamingWindow.loadURL(`${losslessStreamingURL}?${qs.stringify(info)}`);
    losslessStreamingWindow.on('closed', () => {
      losslessStreamingWindow = null;
    });
  }
  losslessStreamingWindow.once('ready-to-show', () => {
    losslessStreamingWindow.show();
    losslessStreamingWindow.focus();
  });
  if (process.platform === 'win32') {
    hackWindowsRightMenu(losslessStreamingWindow);
  }
}


function openHistoryItem(evt, args) {
  if (!browserViewManager) browserViewManager = new BrowserViewManager();
  if (!availableChannels.find(i => [args.channel, calcCurrentChannel(args.url)]
    .includes(i.channel))) {
    mainWindow.send('add-temporary-site', args);
  } else {
    const newChannel = browserViewManager.openHistoryPage(args.channel, args.url);
    const view = newChannel.view ? newChannel.view : newChannel.page.view;
    mainWindow.addBrowserView(view);
    mainWindow.send('update-browser-state', {
      url: args.url,
      canGoBack: newChannel.canBack,
      canGoForward: newChannel.canForward,
    });
    const bounds = mainWindow.getBounds();
    if (process.platform === 'win32' && mainWindow.isMaximized() && (bounds.x < 0 || bounds.y < 0)) {
      view.setBounds({
        x: sidebar ? 76 : 0,
        y: 40,
        width: sidebar ? bounds.width + (bounds.x * 2) - 76
          : bounds.width + (bounds.x * 2),
        height: bounds.height - 40,
      });
    } else {
      view.setBounds({
        x: sidebar ? 76 : 0,
        y: 40,
        width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
        height: mainWindow.getSize()[1] - 40,
      });
    }
    view.setAutoResize({
      width: true, height: true,
    });
  }
}

function registerMainWindowEvent(mainWindow) {
  if (!mainWindow) return;
  mainWindow.on('move', throttle(() => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'windowPosition', mainWindow.getPosition());
  }, 100));
  mainWindow.on('enter-full-screen', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isFullScreen', true);
    mainWindow.webContents.send('mainCommit', 'isMaximized', mainWindow.isMaximized());
  });
  mainWindow.on('leave-full-screen', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isFullScreen', false);
    mainWindow.webContents.send('mainCommit', 'isMaximized', mainWindow.isMaximized());
  });
  mainWindow.on('maximize', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isMaximized', true);
    mainWindow.webContents.send('mainCommit', 'windowPosition', mainWindow.getPosition());
  });
  mainWindow.on('unmaximize', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isMaximized', false);
    mainWindow.webContents.send('mainCommit', 'windowPosition', mainWindow.getPosition());
  });
  mainWindow.on('minimize', () => {
    menuService?.enableMenu(false);
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isMinimized', true);
  });
  mainWindow.on('restore', () => {
    menuService?.enableMenu(true);
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isMinimized', false);
  });
  mainWindow.on('show', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isMinimized', false);
  });
  mainWindow.on('focus', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isFocused', true);
    mainWindow.webContents.send('mainCommit', 'isHiddenByBossKey', false);
  });
  mainWindow.on('blur', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'isFocused', false);
  });
  mainWindow.on('scroll-touch-begin', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('scroll-touch-begin');
  });
  mainWindow.on('scroll-touch-end', () => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('scroll-touch-end');
  });


  registerMediaTasks();

  ipcMain.on('callBrowsingWindowMethod', (evt, method, args = []) => {
    try {
      browsingWindow[method](...args);
    } catch (ex) {
      console.error('callBrowsingWindowMethod', method, JSON.stringify(args), '\n', ex);
    }
  });
  ipcMain.on('update-available-channels', (e, channels) => {
    availableChannels = channels;
  });
  ipcMain.on('open-url-window', () => {
    createOpenUrlWindow();
  });
  ipcMain.on('send-url', (e, urlInfo) => {
    if (mainWindow) mainWindow.webContents.send('send-url', urlInfo);
  });
  ipcMain.on('browser-window-mask', () => {
    if (!browsingWindow.getBrowserViews().includes(maskView)) createMaskView();
    clearTimeout(maskEventTimer);
    maskEventTimer = setTimeout(() => {
      if (maskView) {
        maskView.webContents.executeJavaScript(`
          document.body.style.backgroundColor = 'rgba(255, 255, 255, 0)';
          `);
        clearTimeout(maskDisappearTimer);
        maskDisappearTimer = setTimeout(() => {
          if (browsingWindow) browsingWindow.removeBrowserView(maskView);
        }, 120);
      }
    }, 300);
  });
  ipcMain.on('setFocusedWindowPosition', (evt, args) => {
    try {
      BrowserWindow.getFocusedWindow().setPosition(args[0], args[1]);
    } catch (ex) {
      console.error('setFocusedWindowPosition error', JSON.stringify(args), '\n', ex);
    }
  });
  ipcMain.on('callMainWindowMethod', (evt, method, args = []) => {
    try {
      mainWindow[method](...args);
    } catch (ex) {
      console.error('callMainWindowMethod', method, JSON.stringify(args), '\n', ex);
    }
  });
  ipcMain.on('pip-watcher', (evt, args) => {
    browsingWindow.getBrowserViews()[0].webContents.executeJavaScript(args);
  });
  ipcMain.on('update-locale', () => {
    locale.refreshDisplayLanguage();
    if (pipControlView && !pipControlView.isDestroyed()) {
      pipControlViewTitle(isGlobal);
    }
  });
  ipcMain.on('pip-window-fullscreen', () => {
    if (browsingWindow && browsingWindow.isFocused()) {
      browsingWindow.setFullScreen(!browsingWindow.isFullScreen());
      titlebarView.webContents.executeJavaScript(InjectJSManager
        .updateFullScreenIcon(browsingWindow.isFullScreen(), isBrowsingWindowMax));
    }
  });
  ipcMain.on('pip-window-close', (evt, args) => {
    const views = browsingWindow.getBrowserViews();
    if (views.length) {
      views.forEach((view) => {
        browsingWindow.removeBrowserView(view);
      });
      browserViewManager.pipClose();
      mainWindow.send('update-pip-state', args);
    }
  });
  ipcMain.on('remove-main-window', () => {
    browserViewManager.pauseVideo(mainWindow.getBrowserViews()[0]);
    mainWindow.hide();
  });
  ipcMain.on('clear-browsers-by-channel', (evt, channel) => {
    if (!browserViewManager) return;
    browserViewManager.clearBrowserViewsByChannel(channel);
  });
  ipcMain.on('remove-browser', () => {
    if (!browserViewManager) return;
    if (mainWindow.getBrowserViews().length) browserViewManager.pauseVideo();
    mainWindow.getBrowserViews()
      .forEach(mainWindowView => mainWindow.removeBrowserView(mainWindowView));
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    if (browsingWindow) {
      const views = browsingWindow.getBrowserViews();
      views.forEach((view) => {
        browsingWindow.removeBrowserView(view);
      });
      browserViewManager.pipClose();
      browsingWindow.close();
    }
    browserViewManager.clearAllBrowserViews();
  });
  ipcMain.on('go-to-offset', (evt, val) => {
    if (!browserViewManager) return;
    mainWindow.removeBrowserView(mainWindow.getBrowserViews()[0]);
    const newBrowser = val === 1 ? browserViewManager.forward() : browserViewManager.back();
    if (newBrowser.page) {
      mainWindow.addBrowserView(newBrowser.page.view);
      mainWindow.send('update-browser-state', {
        url: newBrowser.page.url,
        canGoBack: newBrowser.canBack,
        canGoForward: newBrowser.canForward,
      });
      const bounds = mainWindow.getBounds();
      if (process.platform === 'win32' && mainWindow.isMaximized() && (bounds.x < 0 || bounds.y < 0)) {
        newBrowser.page.view.setBounds({
          x: sidebar ? 76 : 0,
          y: 40,
          width: sidebar ? bounds.width + (bounds.x * 2) - 76
            : bounds.width + (bounds.x * 2),
          height: bounds.height - 40,
        });
      } else {
        newBrowser.page.view.setBounds({
          x: sidebar ? 76 : 0,
          y: 40,
          width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
          height: mainWindow.getSize()[1] - 40,
        });
      }
      newBrowser.page.view.setAutoResize({
        width: true, height: true,
      });
    }
  });
  ipcMain.on('open-history-item', openHistoryItem);
  ipcMain.on('remove-web-page', () => {
    if (!browserViewManager) browserViewManager = new BrowserViewManager();
    const mainBrowser = mainWindow.getBrowserViews()[0];
    if (mainBrowser) {
      browserViewManager.pauseVideo();
      mainWindow.removeBrowserView(mainBrowser);
    }
  });
  ipcMain.on('change-channel', (evt, args) => {
    if (!browserViewManager) browserViewManager = new BrowserViewManager();
    const mainBrowser = mainWindow.getBrowserViews()[0];
    if (mainBrowser) {
      mainWindow.removeBrowserView(mainBrowser);
    } else {
      browserViewManager.setCurrentChannel('');
    }
    const newChannel = browserViewManager.changeChannel(args.channel, args);
    const view = newChannel.view ? newChannel.view : newChannel.page.view;
    const url = newChannel.view ? args.url : newChannel.page.url;
    mainWindow.addBrowserView(view);
    setTimeout(() => {
      mainWindow.send('update-browser-state', {
        url,
        canGoBack: newChannel.canBack,
        canGoForward: newChannel.canForward,
      });
    }, 150);
    if (!view.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      if (process.platform === 'win32' && mainWindow.isMaximized() && (bounds.x < 0 || bounds.y < 0)) {
        view.setBounds({
          x: sidebar ? 76 : 0,
          y: 40,
          width: sidebar ? bounds.width + (bounds.x * 2) - 76
            : bounds.width + (bounds.x * 2),
          height: bounds.height - 40,
        });
      } else {
        view.setBounds({
          x: sidebar ? 76 : 0,
          y: 40,
          width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
          height: mainWindow.getSize()[1] - 40,
        });
      }
      view.setAutoResize({
        width: true, height: true,
      });
    }
  });
  ipcMain.on('create-browser-view', (evt, args) => {
    if (!browserViewManager) browserViewManager = new BrowserViewManager();
    const currentMainBrowserView = browserViewManager.create(args.channel, args);
    mainWindow.send('update-browser-state', {
      url: args.url,
      canGoBack: currentMainBrowserView.canBack,
      canGoForward: currentMainBrowserView.canForward,
    });
  });
  ipcMain.on('update-danmu-state', (evt, val) => {
    pipControlView.webContents.executeJavaScript(InjectJSManager.initBarrageIcon(val));
  });
  ipcMain.on('pin', () => {
    mainWindow.send('pip-float-on-top');
  });
  ipcMain.on('pip', () => {
    mainWindow.send('handle-exit-pip');
  });
  ipcMain.on('danmu', () => {
    mainWindow.send('handle-danmu-display');
  });
  ipcMain.on('handle-danmu-display', (evt, code) => {
    browsingWindow.getBrowserViews()[0].webContents.executeJavaScript(code);
  });
  ipcMain.on('mousemove', () => {
    if (browsingWindow && browsingWindow.isFocused()) {
      pipControlView.webContents.executeJavaScript(InjectJSManager.updatePipControlState(true));
      titlebarView.webContents.executeJavaScript(InjectJSManager.updatePipTitlebarToShow(true));
      if (pipTimer) {
        clearTimeout(pipTimer);
      }
      pipTimer = setTimeout(() => {
        if (pipControlView && !pipControlView.isDestroyed()) {
          pipControlView.webContents
            .executeJavaScript(InjectJSManager.updatePipControlState(false));
          titlebarView.webContents
            .executeJavaScript(InjectJSManager.updatePipTitlebarToShow(false));
        }
      }, 3000);
    }
  });
  ipcMain.on('pip-btn-mousemove', () => {
    if (pipTimer) {
      clearTimeout(pipTimer);
    }
  });
  ipcMain.on('pip-btn-mouseout', () => {
    if (pipTimer) {
      clearTimeout(pipTimer);
    }
    pipTimer = setTimeout(() => {
      if (pipControlView && !pipControlView.isDestroyed()) {
        pipControlView.webContents.executeJavaScript(InjectJSManager.updatePipControlState(false));
      }
    }, 3000);
  });
  ipcMain.on('mouseout', () => {
    if (browsingWindow && browsingWindow.isFocused()) {
      if (pipTimer) {
        clearTimeout(pipTimer);
      }
      pipControlView.webContents.executeJavaScript(InjectJSManager.updatePipControlState(false));
      titlebarView.webContents.executeJavaScript(InjectJSManager.updatePipTitlebarToShow(false));
    }
  });
  ipcMain.on('maximizable', (evt, val) => {
    if (val) {
      titlebarView.webContents.executeJavaScript(InjectJSManager.updateTitlebarState('.titlebarMax', true)
        + InjectJSManager.updateTitlebarState('.titlebarFull', false));
    } else {
      titlebarView.webContents.executeJavaScript(InjectJSManager.updateTitlebarState('.titlebarMax', false)
        + InjectJSManager.updateTitlebarState('.titlebarFull', true));
    }
  });
  ipcMain.on('update-mouse-info', (evt, args) => {
    if (browsingWindow && browsingWindow.isFocused()) {
      browsingWindow.send('update-mouse-info', args);
    }
  });
  ipcMain.on('update-full-state', (evt, isFullScreen) => {
    titlebarView.webContents.executeJavaScript(InjectJSManager
      .updateFullScreenIcon(isFullScreen, isBrowsingWindowMax));
  });
  ipcMain.on('mouseup', (evt, type) => {
    switch (type) {
      case 'close':
        browsingWindow.close();
        break;
      case 'min':
        browsingWindow.minimize();
        break;
      case 'full':
        browsingWindow.setFullScreen(true);
        titlebarView.webContents.executeJavaScript(InjectJSManager
          .updateFullScreenIcon(true, isBrowsingWindowMax));
        break;
      case 'recover':
        browsingWindow.setFullScreen(false);
        browsingWindow.getBrowserViews()[0].webContents
          .executeJavaScript(InjectJSManager.changeFullScreen(false));
        titlebarView.webContents.executeJavaScript(InjectJSManager
          .updateFullScreenIcon(false, isBrowsingWindowMax));
        break;
      case 'max':
        if (browsingWindow.isMaximized()) {
          browsingWindow.unmaximize();
          isBrowsingWindowMax = false;
        } else {
          browsingWindow.maximize();
          isBrowsingWindowMax = true;
          if (process.platform === 'win32') {
            titlebarView.webContents.executeJavaScript(InjectJSManager.updateWinMaxIcon(true));
          }
        }
        break;
      case 'unmax':
        browsingWindow.unmaximize();
        isBrowsingWindowMax = false;
        if (process.platform === 'win32') {
          titlebarView.webContents.executeJavaScript(InjectJSManager.updateWinMaxIcon(false));
        }
        break;
      default:
        break;
    }
  });
  ipcMain.on('shift-pip', (evt, args) => {
    if (!browserViewManager) return;
    const mainWindowViews = mainWindow.getBrowserViews();
    mainWindowViews
      .forEach(mainWindowView => mainWindow.removeBrowserView(mainWindowView));
    const browViews = browsingWindow.getBrowserViews();
    browViews.forEach((view) => {
      browsingWindow.removeBrowserView(view);
    });
    const browsers = browserViewManager.changePip(args.channel);
    const pipBrowser = browsers.pipBrowser;
    const mainBrowser = browsers.mainBrowser;
    mainWindow.addBrowserView(mainBrowser.page.view);
    browsingWindow.addBrowserView(pipBrowser);
    createPipControlView();
    createTitlebarView();
    if (args.isGlobal) {
      isGlobal = args.isGlobal;
      browserViewManager.pauseVideo(mainWindow.getBrowserViews()[0]);
      mainWindow.hide();
    }
    mainBrowser.page.view.setBounds({
      x: sidebar ? 76 : 0,
      y: 40,
      width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
      height: mainWindow.getSize()[1] - 40,
    });
    mainBrowser.page.view.setAutoResize({
      width: true, height: true,
    });
    pipBrowser.setBounds({
      x: 0, y: 0, width: browsingWindow.getSize()[0], height: browsingWindow.getSize()[1],
    });
    pipBrowser.setAutoResize({
      width: true, height: true,
    });
    mainWindow.send('update-browser-state', {
      url: mainBrowser.page.url,
      canGoBack: mainBrowser.canBack,
      canGoForward: mainBrowser.canForward,
    });
    pipControlView.webContents
      .executeJavaScript(InjectJSManager.updateBarrageState(args.barrageOpen, args.opacity));
    menuService?.updateFocusedWindow(false, mainWindow && mainWindow.isVisible());
    browsingWindow.focus();
  });
  ipcMain.on('enter-pip', (evt, args) => {
    if (!browserViewManager) return;
    const browsers = browserViewManager.enterPip();
    const pipBrowser = browsers.pipBrowser;
    const mainBrowser = browsers.mainBrowser;
    if (!browsingWindow) {
      createBrowsingWindow({ size: args.pipInfo.pipSize, position: args.pipInfo.pipPos });
      mainWindow.send('init-pip-position');
      mainWindow.removeBrowserView(mainWindow.getBrowserViews()[0]);
      mainWindow.addBrowserView(mainBrowser.page.view);
      browsingWindow.addBrowserView(pipBrowser);
      createPipControlView();
      createTitlebarView();
      browsingWindow.show();
    } else {
      mainWindow.removeBrowserView(mainWindow.getBrowserViews()[0]);
      mainWindow.addBrowserView(mainBrowser.page.view);
      browsingWindow.addBrowserView(pipBrowser);
      browsingWindow.setSize(420, 236);
      createPipControlView();
      createTitlebarView();
      browsingWindow.show();
    }
    if (args.isGlobal) {
      isGlobal = args.isGlobal;
      mainWindow.hide();
    }
    browsingWindow.webContents.closeDevTools();
    browsingWindow.setAspectRatio(args.pipInfo.aspectRatio);
    browsingWindow.setMinimumSize(args.pipInfo.minimumSize[0], args.pipInfo.minimumSize[1]);
    browsingWindow.setSize(args.pipInfo.pipSize[0], args.pipInfo.pipSize[1]);
    mainBrowser.page.view.setBounds({
      x: sidebar ? 76 : 0,
      y: 40,
      width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
      height: mainWindow.getSize()[1] - 40,
    });
    mainBrowser.page.view.setAutoResize({
      width: true,
      height: true,
    });
    pipBrowser.setBounds({
      x: 0, y: 0, width: browsingWindow.getSize()[0], height: browsingWindow.getSize()[1],
    });
    pipBrowser.setAutoResize({
      width: true, height: true,
    });
    browsingWindow.send('update-pip-listener');
    mainWindow.send('update-browser-state', {
      url: mainBrowser.page.url,
      canGoBack: mainBrowser.canBack,
      canGoForward: mainBrowser.canForward,
    });
    pipControlView.webContents
      .executeJavaScript(InjectJSManager.updateBarrageState(args.barrageOpen, args.opacity));
    pipControlViewTitle(args.isGlobal);
    menuService?.updateFocusedWindow(false, mainWindow && mainWindow.isVisible());
    browsingWindow.focus();
  });
  ipcMain.on('update-pip-size', (evt, args) => {
    mainWindow.send('update-pip-size', args);
  });
  ipcMain.on('update-sidebar', (evt, sidebarstate) => {
    sidebar = sidebarstate;
    if (downloadListView && !downloadListView.isDestroyed()) {
      downloadListView.setBounds({
        x: sidebar ? 76 : 0,
        y: 40,
        width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
        height: mainWindow.getSize()[1] - 40,
      });
    }
  });
  ipcMain.on('set-bounds', (evt, args) => {
    if (pipControlView) pipControlView.setBounds(args.control);
    if (titlebarView) titlebarView.setBounds(args.titlebar);
  });
  ipcMain.on('show-download-list', (evt, info) => {
    if (!downloadListView || downloadListView.isDestroyed()) {
      createDownloadListView(info.title, info.list, info.url,
        true, info.resolution, info.path); // set no limits
    }
  });
  ipcMain.on('update-download-list', () => {
    isVip = true; // set no limits
    if (downloadListView && !downloadListView.isDestroyed()) {
      downloadListView.webContents.send('update-is-vip', isVip);
      if (!isVip) {
        const lastTime = new Date(lastDownloadDate);
        const newTime = new Date();
        const lastDate = lastTime.getDate();
        const lastMonth = lastTime.getMonth();
        const lastYear = lastTime.getFullYear();
        const nowDate = newTime.getDate();
        const nowMonth = newTime.getMonth();
        const nowYear = newTime.getFullYear();
        const available = (lastDate !== nowDate || lastMonth !== nowMonth || lastYear !== nowYear)
          && Date.now() > lastDownloadDate;
        if (!available) downloadListView.webContents.send('update-download-state', 'limited');
      }
    }
  });
  ipcMain.on('close-download-list', (evt, id) => {
    if (downloadListView && !downloadListView.isDestroyed()) {
      mainWindow.removeBrowserView(downloadListView);
      downloadListView.destroy();
    }
    manualAbort = true;
    if (downloadWindow && id) downloadWindow.send('abort-download', id);
  });
  ipcMain.on('open-download-list', () => {
    if (!downloadWindow) {
      createDownloadWindow({ show: true });
    } else {
      downloadWindow.show();
    }
  });
  ipcMain.on('downloading-network-error', (evt, id) => {
    if (downloadWindow) downloadWindow.send('downloading-network-error', id);
  });
  ipcMain.on('show-notification', (evt, info) => {
    const notification = new Notification({ title: locale.$t('browsing.download.downloadCompleted'), body: info.name });
    notification.show();
    notification.on('click', () => {
      shell.showItemInFolder(join(info.path, info.name));
    });
  });
  ipcMain.on('not-found-vc-packages', () => {
    const notification = new Notification({ title: locale.$t('browsing.download.vcRuntime') });
    notification.show();
    notification.on('click', () => {
      shell.openExternal('https://www.microsoft.com/en-US/download/details.aspx?id=5555');
    });
  });
  ipcMain.on('transfer-download-info', (evt, info) => {
    if (downloadWindow) {
      downloadWindow.send('transfer-download-info', info);
      downloadWindow.show();
      mainWindow.send('store-download-date');
    }
    mainWindow.removeBrowserView(downloadListView);
    downloadListView.destroy();
  });
  ipcMain.on('download-item-detail', (evt, info) => {
    if (downloadWindow) {
      downloadWindow.send('add-download-item', info);
    }
  });
  ipcMain.on('transfer-progress', (evt, progress) => {
    downloadWindow.send('transfer-progress', progress);
  });
  ipcMain.on('update-download-date', (evt, date) => {
    lastDownloadDate = date;
  });
  ipcMain.on('start-download-error', () => {
    if (downloadListView && !downloadListView.isDestroyed()) {
      downloadListView.webContents.send('start-download-error');
    }
  });
  ipcMain.on('download-video', (evt, info) => {
    manualAbort = false;
    if (downloadListView && !downloadListView.isDestroyed()) {
      downloadListView.webContents.send('update-download-state', 'loading');
    }
    if (!downloadWindow) {
      createDownloadWindow({
        show: false, info: Object.assign(info, { date: lastDownloadDate }),
      });
    } else downloadWindow.send('download-video', Object.assign(info, { date: lastDownloadDate }));
  });
  ipcMain.on('continue-download-list', (evt, data) => {
    if (!downloadWindow) createDownloadWindow({ show: false, info: data });
    else downloadWindow.send('continue-download-video', data);
  });
  ipcMain.on('exit-pip', (evt, args) => {
    if (!browserViewManager) return;
    browsingWindow.send('remove-pip-listener');
    mainWindow.show();
    mainWindow.getBrowserViews()
      .forEach(mainWindowView => mainWindow.removeBrowserView(mainWindowView));
    const browViews = browsingWindow.getBrowserViews();
    browViews.forEach((view) => {
      browsingWindow.removeBrowserView(view);
    });
    const exitBrowser = browserViewManager.exitPip();
    exitBrowser.page.view.webContents.executeJavaScript(args.jsRecover);
    if (args.cssRecover) exitBrowser.page.view.webContents.insertCSS(args.cssRecover);
    mainWindow.addBrowserView(exitBrowser.page.view);
    exitBrowser.page.view.setBounds({
      x: sidebar ? 76 : 0,
      y: 40,
      width: sidebar ? mainWindow.getSize()[0] - 76 : mainWindow.getSize()[0],
      height: mainWindow.getSize()[1] - 40,
    });
    exitBrowser.page.view.setAutoResize({
      width: true,
      height: true,
    });
    mainWindow.send('update-browser-state', {
      url: exitBrowser.page.url,
      canGoBack: exitBrowser.canBack,
      canGoForward: exitBrowser.canForward,
    });
    if (browsingWindow.isFullScreen()) {
      hideBrowsingWindow = true;
      browsingWindow.setFullScreen(false);
      exitBrowser.page.view.webContents.executeJavaScript('document.webkitCancelFullScreen();');
    } else {
      browsingWindow.hide();
    }
    mainWindow.show();
    menuService?.updateFocusedWindow(true, mainWindow && mainWindow.isVisible());
  });
  ipcMain.on('set-window-minimize', () => {
    if (mainWindow && mainWindow.isFocused()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      } else {
        mainWindow.minimize();
      }
    } else if (browsingWindow && browsingWindow.isFocused()) {
      if (browsingWindow.isMinimized()) {
        browsingWindow.restore();
      } else {
        browsingWindow.minimize();
      }
    }
  });
  // eslint-disable-next-line complexity
  ipcMain.on('set-window-maximize', () => {
    if (mainWindow && mainWindow.isFocused()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      if (mainWindow.getBrowserViews().length && !mainWindow.getBrowserViews()[0].isDestroyed()) {
        const bounds = mainWindow.getBounds();
        if (process.platform === 'win32' && mainWindow.isMaximized() && (bounds.x < 0 || bounds.y < 0)) {
          mainWindow.getBrowserViews()[0].setBounds({
            x: sidebar ? 76 : 0,
            y: 40,
            width: sidebar ? bounds.width + (bounds.x * 2) - 76
              : bounds.width + (bounds.x * 2),
            height: bounds.height - 40,
          });
        } else {
          mainWindow.getBrowserViews()[0].setBounds({
            x: sidebar ? 76 : 0,
            y: 40,
            width: sidebar ? mainWindow.getSize()[0] - 76
              : mainWindow.getSize()[0],
            height: mainWindow.getSize()[1] - 40,
          });
        }
      }
    } else if (browsingWindow && browsingWindow.isFocused()) {
      if (!isBrowsingWindowMax) {
        browsingWindow.maximize();
        isBrowsingWindowMax = true;
        if (process.platform === 'win32') {
          titlebarView.webContents.executeJavaScript(InjectJSManager.updateWinMaxIcon(true));
        }
      } else {
        browsingWindow.unmaximize();
        isBrowsingWindowMax = false;
        if (process.platform === 'win32') {
          titlebarView.webContents.executeJavaScript(InjectJSManager.updateWinMaxIcon(false));
        }
      }
    }
  });
  ipcMain.on('update-route-name', (e, route) => {
    routeName = route;
  });
  ipcMain.on('key-events', (e, keyCode) => {
    if (keyCode === 13) {
      browsingWindow.setFullScreen(!browsingWindow.isFullScreen());
      titlebarView.webContents.executeJavaScript(InjectJSManager
        .updateFullScreenIcon(browsingWindow.isFullScreen(), isBrowsingWindowMax));
    } else {
      browsingWindow.getBrowserViews()[0].webContents
        .executeJavaScript(InjectJSManager.emitKeydownEvent(keyCode));
    }
  });
  ipcMain.on('drop-subtitle', (event, args) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    args.forEach((file) => {
      if (isSubtitle((file)) || fs.statSync(file).isDirectory()) {
        tmpSubsToOpen.push(file);
      } else if (isVideo(file) || isAudio(file)) {
        tmpVideoToOpen.push(file);
      }
    });
    finalVideoToOpen = getAllValidVideo(!tmpVideoToOpen.length,
      tmpVideoToOpen.concat(tmpSubsToOpen));
    if (process.mas && !tmpVideoToOpen.length && tmpSubsToOpen.length && !finalVideoToOpen) {
      mainWindow.webContents.send('open-subtitle-in-mas', tmpSubsToOpen[0]);
    } else if (tmpVideoToOpen.length + tmpSubsToOpen.length > 0) {
      mainWindow.webContents.send('open-file', { onlySubtitle: !tmpVideoToOpen.length, files: finalVideoToOpen });
    }
    finalVideoToOpen.splice(0, finalVideoToOpen.length);
    tmpSubsToOpen.splice(0, tmpSubsToOpen.length);
    tmpVideoToOpen.splice(0, tmpVideoToOpen.length);
  });
  ipcMain.on('windowPositionChange', (event, args) => {
    if (!mainWindow || event.sender.isDestroyed()) return;
    mainWindow.setPosition(...args);
    event.sender.send('windowPositionChange-asyncReply', mainWindow.getPosition());
  });
  ipcMain.on('windowInit', (event) => {
    if (!mainWindow || event.sender.isDestroyed()) return;
    mainWindow.webContents.send('mainCommit', 'windowMinimumSize', mainWindow.getMinimumSize());
    mainWindow.webContents.send('mainCommit', 'windowPosition', mainWindow.getPosition());
    mainWindow.webContents.send('mainCommit', 'isFullScreen', mainWindow.isFullScreen());
    mainWindow.webContents.send('mainCommit', 'isFocused', mainWindow.isFocused());
  });
  ipcMain.on('need-to-restore', () => {
    needToRestore = true;
    markNeedToRestore();
  });
  ipcMain.on('relaunch', () => {
    const switches = process.argv.filter(a => a.startsWith('-'));
    const argv = process.argv.filter(a => !a.startsWith('-'))
      .slice(0, app.isPackaged ? 1 : 2).concat(switches);
    app.relaunch({ args: argv.slice(1), execPath: argv[0] });
    app.quit();
  });
  ipcMain.on('add-preference', createPreferenceWindow);

  ipcMain.on('add-browsing', (e, args) => {
    createBrowsingWindow(args);
  });
  ipcMain.on('clear-history', () => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('file.clearHistory');
    }
  });
  ipcMain.on('preference-to-main', (e, args) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('mainDispatch', 'setPreference', args);
    }
    if (loginWindow && !loginWindow.webContents.isDestroyed()) {
      loginWindow.webContents.send('setPreference', args);
    }
    if (premiumView && !premiumView.webContents.isDestroyed()) {
      premiumView.webContents.send('setPreference', args);
    }
    if (aboutWindow && !aboutWindow.webContents.isDestroyed()) {
      aboutWindow.webContents.send('setPreference', args);
    }
    if (downloadWindow && !downloadWindow.webContents.isDestroyed()) {
      downloadWindow.send('setPreference', args);
    }
    if (downloadListView && !downloadListView.isDestroyed()) {
      downloadListView.webContents.send('setPreference', args);
    }
    if (openUrlWindow && !openUrlWindow.webContents.isDestroyed()) {
      openUrlWindow.webContents.send('setPreference', args);
    }
  });
  ipcMain.on('main-to-preference', (e, args) => {
    if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
      preferenceWindow.webContents.send('preferenceDispatch', 'setPreference', args);
    }
  });
  /** grab audio logic in main process start */
  function audioGrabCallBack(data) {
    try {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('grab-audio-update', data);
      }
    } catch (error) {
      // empty
    }
  }
  ipcMain.on('grab-audio', (events, data) => {
    audioGrabService.start(data);
    audioGrabService.removeListener('data', audioGrabCallBack);
    audioGrabService.on('data', audioGrabCallBack);
  });
  ipcMain.on('grab-audio-continue', () => {
    audioGrabService.next();
  });
  ipcMain.on('grab-audio-stop', () => {
    audioGrabService.stop();
  });
  /** grab audio logic in main process end */

  ipcMain.on('add-login', createLoginWindow);

  // OBSOLETE: use app.on below
  ipcMain.on('login-captcha', () => {
    if (loginWindow && !loginWindow.webContents.isDestroyed()) {
      loginWindow.setSize(412, 336, true);
    }
  });

  ipcMain.on('account-enabled', () => {
    // get storage token
    getToken().then((account) => {
      if (account) {
        global['account'] = account;
        menuService?.updateAccount(account);
        audioGrabService.setToken(account.token);
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('sign-in', account);
        }
      } else {
        menuService?.updateAccount(undefined);
        audioGrabService.setToken(undefined);
      }
    }).catch(console.error);
  });

  ipcMain.on('sign-in-site', async (events, data) => {
    signInSite = data.replace('https', 'http'); // there's a http resource in aliyun afs js sdk
    if (process.env.NODE_ENV === 'production') {
      loginURL = `${signInSite}/static/splayer/login.html`;
      premiumURL = `${signInSite}/static/splayer/premium.html`;
    }
  });

  ipcMain.on('sign-in-end-point', async (events, data) => {
    signInEndpoint = data;
    // applePayVerify update endpoint
    applePayVerify.setEndpoint(data);
    if (process.platform === 'darwin' && !applePayVerifyLock) {
      applePayVerifyLock = true;
      try {
        await applePayVerify.verifyAfterOpenApp();
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('payment-success');
        }
      } catch (error) {
        // empty
      }
      applePayVerifyLock = false;
    }
  });

  ipcMain.on('add-payment', (events, data) => {
    createPaymentWindow(data.url, data.orderID, data.channel);
  });

  ipcMain.on('close-payment', () => {
    if (paymentWindow) {
      paymentWindow.close();
      paymentWindow = null;
    }
  });

  ipcMain.on('payment-fail', () => {
    if (premiumView && !premiumView.webContents.isDestroyed()) {
      premiumView.webContents.send('payment-fail', paymentOrigin);
    }
    if (paymentWindow && !paymentWindow.webContents.isDestroyed()) {
      paymentWindowCloseTag = true;
      paymentWindow.close();
      paymentWindow = null;
    }
  });

  ipcMain.on('payment-success', () => {
    if (premiumView && !premiumView.webContents.isDestroyed()) {
      premiumView.webContents.send('payment-success', paymentOrigin);
    }
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('payment-success');
    }
    if (paymentWindow && !paymentWindow.webContents.isDestroyed()) {
      paymentWindowCloseTag = true;
      paymentWindow.close();
      paymentWindow = null;
    }
  });

  ipcMain.on('show-premium-view', (e, route) => {
    createPremiumView(e, route);
    if (preferenceWindow) {
      preferenceWindow.addBrowserView(premiumView);
      const width = preferenceWindow.getSize()[0];
      const height = preferenceWindow.getSize()[1];
      preferenceWindow.setBounds({
        width,
        height: height + 1,
      });
      preferenceWindow.setBounds({
        width,
        height,
      });
    }
  });

  ipcMain.on('hide-premium-view', () => {
    if (premiumView && preferenceWindow) {
      preferenceWindow.removeBrowserView(premiumView);
    }
  });

  ipcMain.on('create-order-loading', (e, origin) => {
    paymentOrigin = origin;
    if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
      preferenceWindow.webContents.send('add-payment');
    }
  });

  ipcMain.on('create-order-done', () => {
    if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
      preferenceWindow.webContents.send('close-payment');
    }
  });

  ipcMain.on('close-preference', () => {
    if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
      preferenceWindow.close();
      preferenceWindow = null;
    }
  });
}

function createMainWindow(openDialog, playlistId) {
  mainWindow = new BrowserWindow({
    useContentSize: true,
    frame: false,
    titleBarStyle: 'none',
    width: 720,
    height: 405,
    minWidth: 720,
    minHeight: 405,
    // it can be set true here and be changed during player starting
    transparent: false, // set to false to solve the backdrop-filter bug
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      experimentalFeatures: true,
      webviewTag: true,
    },
    // See https://github.com/electron/electron/blob/master/docs/api/browser-window.md#showing-window-gracefully
    backgroundColor: '#000000',
    acceptFirstMouse: false,
    show: false,
    ...({
      win32: {},
    })[process.platform],
  });
  if (
    (!welcomeProcessDone && fs.existsSync(path.join(userDataPath, 'WELCOME_PROCESS_MARK')))
    || welcomeProcessDone
  ) {
    welcomeProcessDone = true;
    finalVideoToOpen.length ? mainWindow.loadURL(`${mainURL}#/play`) : mainWindow.loadURL(mainURL);
  } else {
    mainWindow.loadURL(`${mainURL}#/welcome`);
  }
  mainWindow.webContents.userAgent = `${mainWindow.webContents.userAgent.replace(/Electron\S+/i, '')} SPlayerX@2018 Platform/${os.platform()} Release/${os.release()} Version/${app.getVersion()} EnvironmentName/${environmentName}`;
  menuService?.setMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    ipcMain.removeAllListeners(); // FIXME: decouple mainWindow and ipcMain
    mainWindow = null;
    menuService?.setMainWindow(null);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open file by file association. Currently support 1 file only.
    finalVideoToOpen = getAllValidVideo(!tmpVideoToOpen.length,
      tmpVideoToOpen.concat(tmpSubsToOpen));
    if (process.mas && !tmpVideoToOpen.length && tmpSubsToOpen.length && !finalVideoToOpen) {
      mainWindow.webContents.send('open-subtitle-in-mas', tmpSubsToOpen[0]);
    } else if (tmpVideoToOpen.length + tmpSubsToOpen.length > 0) {
      mainWindow.webContents.send('open-file', { onlySubtitle: !tmpVideoToOpen.length, files: finalVideoToOpen });
    }
    if (openDialog) mainWindow.webContents.send('open-dialog', playlistId);
    finalVideoToOpen.splice(0, finalVideoToOpen.length);
    tmpSubsToOpen.splice(0, tmpSubsToOpen.length);
    tmpVideoToOpen.splice(0, tmpVideoToOpen.length);
    inited = true;
  });

  registerMainWindowEvent(mainWindow);

  if (process.env.NODE_ENV === 'development') {
    setTimeout(() => { // wait some time to prevent `Object not found` error
      if (mainWindow) mainWindow.openDevTools({ mode: 'detach' });
    }, 1000);
  }
  mainWindow.on('focus', () => {
    menuService?.enableMenu(true);
  });
}

['left-drag', 'left-up'].forEach((channel) => {
  mouse.on(channel, (...args) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (!focusedWindow || focusedWindow.webContents.isDestroyed()) return;
    if (focusedWindow.isMaximized()) return;
    if (process.platform === 'darwin' && focusedWindow !== browsingWindow) return;
    focusedWindow.send(`mouse-${channel}`, ...args);
  });
});

app.on('before-quit', () => {
  losslessStreamingInstance.dispose();
  if (downloadWindow) downloadWindow.webContents.send('quit');
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  if (needToRestore) {
    mainWindow.webContents.send('quit', needToRestore);
  } else {
    mainWindow.webContents.send('quit');
  }
});

app.on('quit', () => {
  mouse.dispose();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (app.isReady()) {
    createMainWindow();
  }
});

app.on('minimize', () => {
  if (mainWindow && mainWindow.isFocused()) {
    mainWindow.minimize();
  }
});

async function darwinOpenFilesToStart() {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) { // sencond instance
    if (!inited) return;
    finalVideoToOpen = getAllValidVideo(!tmpVideoToOpen.length,
      tmpVideoToOpen.concat(tmpSubsToOpen));
    if (!tmpVideoToOpen.length && tmpSubsToOpen.length) {
      const allSubFiles = [];
      tmpSubsToOpen.forEach((file) => {
        if (isSubtitle((file))) {
          allSubFiles.push(file);
        } else {
          allSubFiles.push(...searchSubsInDir(file));
        }
      });
      mainWindow.webContents.send('add-local-subtitles', allSubFiles);
    } else if (tmpVideoToOpen.length + tmpSubsToOpen.length > 0) {
      mainWindow.webContents.send('open-file', { onlySubtitle: !tmpVideoToOpen.length, files: finalVideoToOpen });
    }
    finalVideoToOpen.splice(0, finalVideoToOpen.length);
    tmpSubsToOpen.splice(0, tmpSubsToOpen.length);
    tmpVideoToOpen.splice(0, tmpVideoToOpen.length);
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (app.isReady() && !mainWindow) {
    createMainWindow();
  }
}
const darwinOpenFilesToStartDebounced = debounce(darwinOpenFilesToStart, 100);
if (process.platform === 'darwin') {
  app.on('will-finish-launching', () => {
    app.on('open-file', (event, file) => {
      // TODO: clean code to remove duplicated check
      let ext;
      let isDirectory;
      try {
        ext = path.extname(file);
        isDirectory = fs.statSync(file).isDirectory();
      } catch (ex) {
        return;
      }
      if (isSubtitle(ext) || isDirectory) {
        tmpSubsToOpen.push(file);
      } else if (isVideo(ext) || isAudio(ext)) {
        tmpVideoToOpen.push(file);
      }
      finalVideoToOpen = getAllValidVideo(!tmpVideoToOpen.length,
        tmpVideoToOpen.concat(tmpSubsToOpen));
      darwinOpenFilesToStartDebounced();
    });
  });
} else {
  const tmpFile = process.argv.slice(app.isPackaged ? 1 : 2);
  tmpFile.forEach((file) => {
    let ext;
    let isDirectory;
    try {
      ext = path.extname(file);
      isDirectory = fs.statSync(file).isDirectory();
    } catch (ex) {
      return;
    }
    if (isSubtitle(ext) || isDirectory) {
      tmpSubsToOpen.push(file);
    } else if (isVideo(ext) || isAudio(ext)) {
      tmpVideoToOpen.push(file);
    }
  });
  finalVideoToOpen = getAllValidVideo(!tmpVideoToOpen.length,
    tmpVideoToOpen.concat(tmpSubsToOpen));
  app.on('second-instance', (event, argv) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) {
      if (app.isReady()) createMainWindow();
    }
    const opendFiles = argv.slice(app.isPackaged ? 3 : 2);
    opendFiles.forEach((file) => {
      let ext;
      let isDirectory;
      try {
        ext = path.extname(file);
        isDirectory = fs.statSync(file).isDirectory();
      } catch (ex) {
        return;
      }
      if (isSubtitle(ext) || isDirectory) {
        tmpSubsToOpen.push(file);
      } else if (isVideo(ext) || isAudio(ext)) {
        tmpVideoToOpen.push(file);
      }
    });
    finalVideoToOpen = getAllValidVideo(!tmpVideoToOpen.length,
      tmpVideoToOpen.concat(tmpSubsToOpen));
    if (!tmpVideoToOpen.length && tmpSubsToOpen.length) {
      const allSubFiles = [];
      tmpSubsToOpen.forEach((file) => {
        if (isSubtitle((file))) {
          allSubFiles.push(file);
        } else {
          allSubFiles.push(...searchSubsInDir(file));
        }
      });
      mainWindow.webContents.send('add-local-subtitles', allSubFiles);
    } else if (tmpVideoToOpen.length + tmpSubsToOpen.length > 0) {
      mainWindow.webContents.send('open-file', { onlySubtitle: !tmpVideoToOpen.length, files: finalVideoToOpen });
    }
    finalVideoToOpen.splice(0, finalVideoToOpen.length);
    tmpSubsToOpen.splice(0, tmpSubsToOpen.length);
    tmpVideoToOpen.splice(0, tmpVideoToOpen.length);
  });
}

app.on('ready', () => {
  menuService = new MenuService();
  if (process.platform === 'darwin') {
    systemPreferences.subscribeNotification('AppleInterfaceThemeChangedNotification', () => {
      if (routeName === 'browsing-view') {
        menuService?.updatePipIcon();
      }
    });
    systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
    systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
  }
  createMainWindow();
  app.name = 'SPlayer';
  globalShortcut.register('CmdOrCtrl+Shift+I+O+P', () => {
    if (mainWindow) mainWindow.openDevTools({ mode: 'detach' });
  });
  globalShortcut.register('CmdOrCtrl+Shift+J+K+L', () => {
    if (preferenceWindow) preferenceWindow.openDevTools({ mode: 'detach' });
  });
  globalShortcut.register('CmdOrCtrl+Shift+A+S+D', () => {
    if (loginWindow) loginWindow.openDevTools({ mode: 'detach' });
  });
  globalShortcut.register('CmdOrCtrl+Shift+Q+W+E', () => {
    if (premiumView) premiumView.webContents.openDevTools();
  });
  globalShortcut.register('CmdOrCtrl+Shift+Z+X+C', () => {
    if (paymentWindow) paymentWindow.openDevTools({ mode: 'detach' });
  });

  if (process.platform === 'win32') {
    globalShortcut.register('CmdOrCtrl+`', () => {
      handleBossKey();
    });
  }
});

app.on('window-all-closed', () => {
  if (
    (routeName === 'welcome-privacy' || routeName === 'language-setting')
    || process.platform !== 'darwin') {
    app.quit();
  }
});

const oauthRegex = [
  /^https:\/\/cnpassport.youku.com\//i,
  /^https:\/\/udb3lgn.huya.com\//i,
  /^https:\/\/passport.iqiyi.com\/apis\/thirdparty/i,
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
app.on('web-contents-created', (webContentsCreatedEvent, contents) => {
  if (contents.getType() === 'browserView') {
    contents.on('new-window', (newWindowEvent, url) => {
      if (!oauthRegex.some(re => re.test(url))) {
        newWindowEvent.preventDefault();
      }
    });
  }
});

app.on('bossKey', handleBossKey);
app.on('add-preference', createPreferenceWindow);
app.on('add-login', createLoginWindow);
app.on('add-window-about', createAboutWindow);
app.on('add-window-losslessStreaming', createLosslessStreamingWindow);
app.on('check-for-updates', () => {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('check-for-updates');
});
app.on('open-history-item', (evt, args) => {
  openHistoryItem(evt, args);
  mainWindow.send('update-current-channel', args.channel);
});

app.on('menu-create-main-window', () => {
  if (!mainWindow) createMainWindow();
  else if (mainWindow.isMinimized()) {
    mainWindow.restore();
  } else if (!mainWindow.isVisible() && (!browsingWindow || !browsingWindow.isVisible())) {
    mainWindow.show();
  }
});

app.on('menu-open-dialog', (playlistId) => {
  createMainWindow(true, playlistId);
});

app.on('activate', () => {
  if (!mainWindow) {
    if (app.isReady()) createMainWindow();
  } else if (!mainWindow.isVisible() && (!browsingWindow || !browsingWindow.isVisible())) {
    mainWindow.show();
  }
  if (browsingWindow && browsingWindow.isMinimized()) {
    browsingWindow.restore();
  }
  if (mainWindow && mainWindow.isMinimized()) {
    mainWindow.restore();
  }
});

app.on('refresh-token', async (account) => {
  global['account'] = account;
  menuService?.updateAccount(account);
  audioGrabService.setToken(account.token);
  saveToken(account.token);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('sign-in', account);
  }
  if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
    preferenceWindow.webContents.send('sign-in', account);
  }
  if (premiumView && !premiumView.webContents.isDestroyed()) {
    premiumView.webContents.send('sign-in', account);
  }
  if (paymentWindow && !paymentWindow.webContents.isDestroyed()) {
    paymentWindow.webContents.send('sign-in', account);
  }
});

app.on('login-captcha', () => {
  if (loginWindow && !loginWindow.webContents.isDestroyed()) {
    loginWindow.setSize(412, 336, true);
  }
});

app.on('sign-in', async () => { // eslint-disable-line complexity
  // if applePayVerify is waiting for sign in handle
  if (!applePayVerifyLock && applePayVerify.isWaitingSignIn()) {
    applePayVerifyLock = true;
    try {
      const success = await applePayVerify.verifyAfterSignIn();
      if (premiumView && !premiumView.webContents.isDestroyed() && success) {
        // notify web handle success
        premiumView.webContents.send('applePay-success', paymentOrigin);
      }
      if (mainWindow && !mainWindow.webContents.isDestroyed() && success) {
        mainWindow.webContents.send('payment-success');
      }
    } catch (error) {
      if (premiumView && !premiumView.webContents.isDestroyed()) {
        premiumView.webContents.send('applePay-fail', paymentOrigin, error);
      }
    }
    applePayVerifyLock = false;
  } else if (!applePayVerifyLock) {
    applePayVerifyLock = true;
    try {
      await applePayVerify.verifyAfterOpenApp();
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('payment-success');
      }
    } catch (error) {
      // empty
    }
    applePayVerifyLock = false;
  }
});

app.on('sign-out-confirm', () => {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('sign-out-confirm', undefined);
  }
});

app.on('sign-out', () => {
  global['account'] = undefined;
  menuService?.updateAccount(undefined);
  audioGrabService.setToken(undefined);
  saveToken('');
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('sign-in', undefined);
  }
  if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
    preferenceWindow.webContents.send('sign-in', undefined);
  }
  if (premiumView && !premiumView.webContents.isDestroyed()) {
    premiumView.webContents.send('sign-in', undefined);
  }
  if (paymentWindow && !paymentWindow.webContents.isDestroyed()) {
    paymentWindow.webContents.send('sign-in', undefined);
  }
});

app.on('route-account', (e) => {
  if (preferenceWindow && !preferenceWindow.webContents.isDestroyed()) {
    preferenceWindow.webContents.send('route-change');
  } else {
    createPreferenceWindow(e, 'account');
  }
});

app.on('losslessStreaming-select', (src) => {
  losslessStreamingInstance.start(src);
});
app.on('losslessStreaming-stop', () => {
  losslessStreamingInstance.stop();
});
app.on('losslessStreaming-info-update', (info, prevInfo) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('losslessStreaming-info-update', info, prevInfo);
  }
  if (!info.enabled) {
    if (losslessStreamingWindow) {
      losslessStreamingWindow.close();
      losslessStreamingWindow = null;
    }
  }
  app.emit('losslessStreaming-menu-update', info);
  if (prevInfo && !prevInfo.enabled && info.enabled) app.emit('add-window-losslessStreaming');
});
app.on('losslessStreaming-menu-update', (info) => {
  info = info || losslessStreamingInstance.getInfo();
  menuService?.updateMenuItemEnabled('file.losslessStreaming.getInfo', info.enabled);
  menuService?.updateMenuItemEnabled('file.losslessStreaming.stop', info.enabled);
});

app.getDisplayLanguage = () => {
  locale.refreshDisplayLanguage();
  return locale.displayLanguage;
};

// export getIp to static login preload.js
app.getIP = getIP;

app.crossThreadCache = crossThreadCache;

// export endpoints to static login preload.js
app.getSignInEndPoint = () => signInEndpoint;
app.getSignInSite = () => signInSite;

// apple pay
if (process.platform === 'darwin') {
  // Listen for transactions as soon as possible.
  inAppPurchase.on('transactions-updated', (event, transactions) => {
    if (!Array.isArray(transactions)) {
      return;
    }
    // Check each transaction.
    transactions.forEach(async (transaction) => { // eslint-disable-line complexity
      // const payment = transaction.payment;
      switch (transaction.transactionState) {
        case 'purchasing':
          break;
        case 'purchased':
          // eslint-disable-next-line no-case-declarations
          let receipt;
          try {
            receipt = fs.readFileSync(inAppPurchase.getReceiptURL());
          } catch (error) {
            // empty
          }
          try {
            const verifySuccess = await applePayVerify.verifyAfterPay({
              date: transaction.transactionDate,
              payment: {
                transactionID: transaction.transactionIdentifier,
                productID: applePayProductID,
                receipt: receipt.toString('base64'),
                currency: applePayCurrency,
              },
            });
            if (premiumView && !premiumView.webContents.isDestroyed() && verifySuccess) {
              // notify web handle success
              premiumView.webContents.send('applePay-success', paymentOrigin);
            }
            if (mainWindow && !mainWindow.webContents.isDestroyed() && verifySuccess) {
              mainWindow.webContents.send('payment-success');
            }
          } catch (error) {
            if (premiumView && !premiumView.webContents.isDestroyed()) {
              premiumView.webContents.send('applePay-fail', paymentOrigin, error);
            }
          }
          break;
        case 'failed':
          // Finish the transaction.
          inAppPurchase.finishTransactionByDate(transaction.transactionDate);
          if (premiumView && !premiumView.webContents.isDestroyed()) {
            premiumView.webContents.send('applePay-fail', paymentOrigin, 'not support');
          }
          break;
        case 'restored':
          break;
        case 'deferred':
          break;
        default:
          break;
      }
    });
  });

  // apple pay
  app.applePay = (product, id, currency, quantity, callback) => {
    applePayProductID = id;
    applePayCurrency = currency;
    // Check if the user is allowed to make in-app purchase.
    if (!inAppPurchase.canMakePayments()) {
      if (premiumView && !premiumView.webContents.isDestroyed()) {
        premiumView.webContents.send('applePay-fail', paymentOrigin, 'not support');
      }
      return;
    }
    // Retrieve and display the product descriptions.
    inAppPurchase.getProducts([product]).then((products) => {
      // Check the parameters.
      if (!Array.isArray(products) || products.length <= 0) {
        if (premiumView && !premiumView.webContents.isDestroyed()) {
          premiumView.webContents.send('applePay-fail', paymentOrigin, 'Unable to retrieve the product informations.');
        }
        return;
      }
      // Purchase the selected product.
      inAppPurchase.purchaseProduct(product, quantity).then(callback, (err) => {
        console.error(err);
      });
    }, (err) => {
      console.error(err);
    });
  };
}
