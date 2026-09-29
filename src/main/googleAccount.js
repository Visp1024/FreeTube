import { BrowserWindow, session } from 'electron'

export const ACCOUNT_PARTITION = 'persist:yt-account'
const ACCOUNT_COOKIE_URL = 'https://www.youtube.com'
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'
// Google refuses to sign in inside embedded Chromium, but lets a Firefox user agent through
const LOGIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'

function accountSession() {
  return session.fromPartition(ACCOUNT_PARTITION)
}

async function readAccountCookies() {
  return await accountSession().cookies.get({ url: ACCOUNT_COOKIE_URL })
}

function hasAuthCookie(cookies) {
  return cookies.some(cookie => cookie.name === 'SAPISID' || cookie.name === '__Secure-3PAPISID')
}

/**
 * @param {string} userAgent the same cleaned-up user agent as the default session
 */
export async function initGoogleAccount(userAgent) {
  accountSession().setUserAgent(userAgent)
}

/**
 * The login window has its own session, so it needs the same proxy as the default one
 * @param {Electron.ProxyConfig} config
 */
export async function setGoogleAccountProxy(config) {
  await accountSession().setProxy(config)
}

export async function isGoogleAccountLoggedIn() {
  return hasAuthCookie(await readAccountCookies())
}

/**
 * @param {BrowserWindow | null} parentWindow
 * @returns {Promise<boolean>} whether the account partition holds a signed-in session afterwards
 */
export function openLoginWindow(parentWindow) {
  return new Promise((resolve) => {
    const loginWindow = new BrowserWindow({
      parent: parentWindow ?? undefined,
      modal: !!parentWindow,
      width: 500,
      height: 720,
      autoHideMenuBar: true,
      webPreferences: {
        partition: ACCOUNT_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    loginWindow.webContents.setUserAgent(LOGIN_USER_AGENT)
    loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    let finished = false
    const finish = async () => {
      if (finished) {
        return
      }
      finished = true

      const loggedIn = await isGoogleAccountLoggedIn()
      if (!loginWindow.isDestroyed()) {
        loginWindow.close()
      }
      resolve(loggedIn)
    }

    loginWindow.webContents.on('did-navigate', async (_event, url) => {
      if (url.startsWith('https://www.youtube.com/') && await isGoogleAccountLoggedIn()) {
        finish()
      }
    })

    loginWindow.on('closed', () => {
      finish()
    })

    loginWindow.loadURL(LOGIN_URL)
  })
}
