# Вход в аккаунт Google — основа: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FreeTube входит в один аккаунт Google через окно входа и делает все запросы к `*.youtube.com` от его имени; аккаунт виден в настройках и в верхней панели, выход и истечение сессии обрабатываются.

**Architecture:** Cookies аккаунта живут в отдельном разделе Electron `persist:yt-account`. Главный процесс держит в памяти строку `Cookie` этого раздела и подмешивает её в запросы к `*.youtube.com` в существующем `onBeforeSendHeaders`; `set-cookie` из ответов YouTube сохраняются в раздел (продление сессии). Renderer получает строку cookies по IPC и передаёт её в `Session.create({ cookie })` YouTube.js — тот вычисляет `Authorization: SAPISIDHASH` и считает сессию `logged_in` (сам заголовок `Cookie` браузерный `fetch` выбрасывает).

**Tech Stack:** Electron 43, Vue 3 (`<script setup>`), Vuex 4, youtubei.js ^18, vue-i18n, pnpm, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-google-login-foundation-design.md`

## Global Constraints

- Личный форк: коммиты в ветку задачи, в upstream ничего не отправлять.
- Один аккаунт; без бренд-каналов, без импорта `cookies.txt`.
- Раздел аккаунта — строго `persist:yt-account`; общее хранилище FreeTube (`session.defaultSession`) не должно получить ни одного cookie аккаунта.
- Cookies аккаунта подмешиваются только к хостам `youtube.com` и `*.youtube.com`; `googlevideo.com`, `ytimg.com`, `ggpht.com`, `googleusercontent.com` — без них.
- Новых npm-зависимостей не добавлять. Тесты — встроенный `node:test` (Node 22 сам распознаёт ESM-синтаксис в `.js`).
- Пакетный менеджер — pnpm. Если `pnpm` не в PATH: `corepack enable` (или `npx pnpm@10 ...`).
- Строки интерфейса — только через i18n, ключи добавляются в `static/locales/en-US.yaml` и `static/locales/ru.yaml`.
- Коммиты — с `#2` в теме (хуки Makestead) и строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` — только явными путями.
- Раздел настроек виден только при `process.env.IS_ELECTRON && process.env.SUPPORTS_LOCAL_API`.

## Review Focus

1. **Ложный `loggedOut` от не-WEB клиентов** (плеер ходит клиентами iOS/Android/TV, где web-cookies не действуют и YouTube отвечает `loggedOut: true`) — не должен разлогинивать. Ожидание: выход только если повторная проверка `account.getInfo(true)` не нашла аккаунт. Закрывается в Task 5 (проверка перед выходом + ограничение частоты).
2. **Несколько окон FreeTube** — вход/выход в одном окне должен отразиться в остальных. Закрывается в Task 3/5 (широковещательное `GOOGLE_ACCOUNT_CHANGED`).
3. **Регистр заголовка `set-cookie`** (`Set-Cookie` vs `set-cookie`) и cookie с `Max-Age=0`/прошедшим `Expires` (Google так удаляет cookies) — должны удаляться из раздела, а не записываться. Закрывается тестами Task 2 и `storeRotatedCookies` в Task 3.
4. **Чужой домен в `set-cookie`** (`Domain=google.com`, `Domain=notyoutube.com`) — не записывается в раздел. Тест в Task 2.
5. **Окно входа закрыто на полпути / вход уже был выполнен ранее** — `login` возвращает фактическое состояние раздела, UI не ломается. Проверяется вручную в Task 3 и Task 7.

---

## Карта файлов

| Файл | Что | Задача |
|---|---|---|
| `src/main/googleAccountCookies.js` (новый) | Чистые функции: сборка/слияние заголовка `Cookie`, разбор `set-cookie` | 2 |
| `src/main/googleAccountCookies.test.js` (новый) | Тесты `node:test` для них | 2 |
| `src/main/googleAccount.js` (новый) | Раздел, окно входа, кеш заголовка, продление, выход | 1, 3 |
| `src/main/index.js` | Инициализация, подмешивание заголовков, перехват `set-cookie`, IPC | 1, 3 |
| `src/constants.js` | Каналы IPC | 1, 3 |
| `src/preload/interface.js` | Методы `ftElectron` | 1, 3 |
| `src/renderer/helpers/api/local.js` | `cookie` в сессии, детектор `loggedOut`, `getLocalAccountInfo` | 4 |
| `src/renderer/store/modules/googleAccount.js` (новый), `src/renderer/store/index.js` | Состояние аккаунта | 5 |
| `src/renderer/App.vue` | Запуск инициализации | 5 |
| `src/renderer/components/GoogleAccountSettings/GoogleAccountSettings.vue` (новый), `.css` | Раздел настроек | 6 |
| `src/renderer/views/Settings/Settings.vue` | Регистрация раздела, переход по `?section=` | 6 |
| `src/renderer/components/TopNav/TopNav.vue`, `TopNav.scss` | Аватар | 6 |
| `static/locales/en-US.yaml`, `static/locales/ru.yaml` | Строки | 6 |

---

### Task 1: Проверка осуществимости — окно входа Google

Цель — узнать, пускает ли Google во встроенное окно Electron. Код остаётся (он нужен дальше), но **если Google блокирует вход — остановиться, записать в журнал задачи #2 и вернуться к человеку.** Не продолжать с Task 2.

**Files:**
- Create: `src/main/googleAccount.js`
- Modify: `src/constants.js` (объект `IpcChannels`, строки 2–…)
- Modify: `src/preload/interface.js` (объект `export default { ... }`)
- Modify: `src/main/index.js` (после `session.defaultSession.setUserAgent(fixedUserAgent)` ~стр. 562; рядом с `ipcMain.handle(IpcChannels.GET_SYSTEM_LOCALE` ~стр. 1384)

**Interfaces:**
- Produces: `ACCOUNT_PARTITION: string`, `initGoogleAccount(userAgent: string): Promise<void>`, `openLoginWindow(parentWindow: BrowserWindow | null): Promise<boolean>`, `isGoogleAccountLoggedIn(): Promise<boolean>`; IPC `GOOGLE_ACCOUNT_LOGIN`; `window.ftElectron.loginGoogleAccount(): Promise<boolean>`.

- [ ] **Step 1: Установить зависимости в рабочей копии**

Run (в `D:/Projects/FreeTube-worktrees/pool-1`): `corepack enable; pnpm install`
Expected: установка без ошибок, появилась `node_modules`.

- [ ] **Step 2: Добавить канал IPC**

В `src/constants.js`, в объект `IpcChannels` после `APP_READY: 'app-ready',`:

```js
  GOOGLE_ACCOUNT_LOGIN: 'google-account-login',
```

- [ ] **Step 3: Создать `src/main/googleAccount.js` (минимум для проверки)**

```js
import { BrowserWindow, session } from 'electron'

export const ACCOUNT_PARTITION = 'persist:yt-account'
const ACCOUNT_COOKIE_URL = 'https://www.youtube.com'
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'

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
```

- [ ] **Step 4: Подключить в `src/main/index.js`**

Импорт рядом с `import { handleOpenInExternalPlayer } from './externalPlayer'`:

```js
import { initGoogleAccount, openLoginWindow } from './googleAccount'
```

Сразу после `session.defaultSession.setUserAgent(fixedUserAgent)`:

```js
    await initGoogleAccount(fixedUserAgent)
```

(обработчик `app.on('ready', async (_, __) => {` уже `async`). Рядом с `ipcMain.handle(IpcChannels.GET_SYSTEM_LOCALE, ...)`:

```js
  ipcMain.handle(IpcChannels.GOOGLE_ACCOUNT_LOGIN, async (event) => {
    if (!isFreeTubeUrl(event.senderFrame.url)) {
      return false
    }

    return await openLoginWindow(BrowserWindow.fromWebContents(event.sender))
  })
```

- [ ] **Step 5: Метод в preload**

В `src/preload/interface.js`, в `export default { ... }` после `getSystemLocale`:

```js
  /**
   * @returns {Promise<boolean>}
   */
  loginGoogleAccount: () => {
    return ipcRenderer.invoke(IpcChannels.GOOGLE_ACCOUNT_LOGIN)
  },
```

- [ ] **Step 6: Ручная проверка входа (это и есть проверка осуществимости)**

Run: `pnpm dev`. В открывшемся FreeTube: DevTools (Ctrl+Shift+I) → Console:

```js
await window.ftElectron.loginGoogleAccount()
```

Expected: открывается окно Google; после ввода логина/пароля/2FA окно само закрывается, в консоли `true`. Повторный вызов — окно откроется и почти сразу закроется с `true` (сессия уже есть).

**Если** Google показывает «Не удалось войти — этот браузер или приложение может быть небезопасным» / «Couldn't sign you in»: закрыть окно (консоль вернёт `false`), записать в журнал #2 текст ошибки и скриншот (`attach_task_file`), **остановиться и спросить человека**. Не пробовать обходы самостоятельно.

- [ ] **Step 7: Commit**

```bash
git add src/main/googleAccount.js src/main/index.js src/constants.js src/preload/interface.js
git commit -m "feat: #2 окно входа Google в отдельном разделе" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Чистые функции для cookies

**Files:**
- Create: `src/main/googleAccountCookies.js`
- Test: `src/main/googleAccountCookies.test.js`

**Interfaces:**
- Produces:
  - `ACCOUNT_COOKIE_URL = 'https://www.youtube.com'`
  - `hasAuthCookie(cookies: {name: string}[]): boolean`
  - `buildCookieHeader(cookies: {name: string, value: string}[]): string` — `"a=1; b=2"`
  - `mergeCookieHeaders(existing: string | undefined, account: string | null): string` — cookies аккаунта перекрывают одноимённые существующие, порядок существующих сохраняется
  - `isYouTubeHost(hostname: string): boolean`
  - `parseSetCookie(header: string, now: number): CookiesSetDetails | null` — объект для `session.cookies.set()` (`url, name, value, path, domain?, secure?, httpOnly?, expirationDate?, sameSite?`); `null` для битой строки или домена вне youtube.com
  - `isExpired(cookie: {expirationDate?: number}, now: number): boolean`

- [ ] **Step 1: Написать тесты**

`src/main/googleAccountCookies.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCookieHeader,
  hasAuthCookie,
  isExpired,
  isYouTubeHost,
  mergeCookieHeaders,
  parseSetCookie,
} from './googleAccountCookies.js'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)

test('buildCookieHeader joins name=value pairs', () => {
  assert.equal(buildCookieHeader([{ name: 'SID', value: 'a' }, { name: 'SAPISID', value: 'b/c' }]), 'SID=a; SAPISID=b/c')
  assert.equal(buildCookieHeader([]), '')
})

test('hasAuthCookie looks for SAPISID or __Secure-3PAPISID', () => {
  assert.equal(hasAuthCookie([{ name: 'SAPISID' }]), true)
  assert.equal(hasAuthCookie([{ name: '__Secure-3PAPISID' }]), true)
  assert.equal(hasAuthCookie([{ name: 'SOCS' }, { name: 'CONSENT' }]), false)
})

test('mergeCookieHeaders lets account cookies win and keeps the rest', () => {
  assert.equal(mergeCookieHeaders('SOCS=CAI; PREF=tz=Europe.Moscow', 'SID=x; PREF=f6=40000000'), 'SOCS=CAI; PREF=f6=40000000; SID=x')
  assert.equal(mergeCookieHeaders(undefined, 'SID=x'), 'SID=x')
  assert.equal(mergeCookieHeaders('', 'SID=x'), 'SID=x')
  assert.equal(mergeCookieHeaders('SOCS=CAI', null), 'SOCS=CAI')
})

test('isYouTubeHost accepts youtube.com and its subdomains only', () => {
  assert.equal(isYouTubeHost('www.youtube.com'), true)
  assert.equal(isYouTubeHost('youtube.com'), true)
  assert.equal(isYouTubeHost('m.youtube.com'), true)
  assert.equal(isYouTubeHost('notyoutube.com'), false)
  assert.equal(isYouTubeHost('rr1---sn-abc.googlevideo.com'), false)
  assert.equal(isYouTubeHost('i.ytimg.com'), false)
})

test('parseSetCookie parses attributes', () => {
  const cookie = parseSetCookie('__Secure-3PSIDTS=sidts-abc=; Domain=.youtube.com; Path=/; Expires=Wed, 29-Sep-2027 12:00:00 GMT; Secure; HttpOnly; SameSite=None', NOW)
  assert.deepEqual(cookie, {
    url: 'https://www.youtube.com',
    name: '__Secure-3PSIDTS',
    value: 'sidts-abc=',
    path: '/',
    domain: '.youtube.com',
    secure: true,
    httpOnly: true,
    expirationDate: Date.UTC(2027, 8, 29, 12, 0, 0) / 1000,
    sameSite: 'no_restriction'
  })
})

test('parseSetCookie: Max-Age wins over Expires regardless of order', () => {
  const cookie = parseSetCookie('A=1; Max-Age=3600; Expires=Wed, 29-Sep-2027 12:00:00 GMT', NOW)
  assert.equal(cookie.expirationDate, NOW / 1000 + 3600)
})

test('parseSetCookie normalises domain and SameSite', () => {
  assert.equal(parseSetCookie('A=1; Domain=youtube.com', NOW).domain, '.youtube.com')
  assert.equal(parseSetCookie('A=1; SameSite=Lax', NOW).sameSite, 'lax')
  assert.equal(parseSetCookie('A=1; samesite=strict', NOW).sameSite, 'strict')
})

test('parseSetCookie without Domain is a host-only cookie', () => {
  const cookie = parseSetCookie('YSC=abc; Path=/', NOW)
  assert.equal(cookie.domain, undefined)
  assert.equal(cookie.value, 'abc')
})

test('parseSetCookie rejects foreign domains and broken lines', () => {
  assert.equal(parseSetCookie('A=1; Domain=google.com', NOW), null)
  assert.equal(parseSetCookie('A=1; Domain=.notyoutube.com', NOW), null)
  assert.equal(parseSetCookie('novalue', NOW), null)
  assert.equal(parseSetCookie('=1', NOW), null)
})

test('isExpired detects deletions', () => {
  assert.equal(isExpired(parseSetCookie('A=; Max-Age=0', NOW), NOW), true)
  assert.equal(isExpired(parseSetCookie('A=; Expires=Thu, 01-Jan-1970 00:00:01 GMT', NOW), NOW), true)
  assert.equal(isExpired(parseSetCookie('A=1; Max-Age=60', NOW), NOW), false)
  assert.equal(isExpired(parseSetCookie('A=1', NOW), NOW), false)
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test src/main/googleAccountCookies.test.js`
Expected: FAIL — `Cannot find module ... googleAccountCookies.js`.

- [ ] **Step 3: Реализация**

`src/main/googleAccountCookies.js`:

```js
export const ACCOUNT_COOKIE_URL = 'https://www.youtube.com'

const AUTH_COOKIE_NAMES = ['SAPISID', '__Secure-3PAPISID']

/**
 * @param {{ name: string }[]} cookies
 */
export function hasAuthCookie(cookies) {
  return cookies.some(cookie => AUTH_COOKIE_NAMES.includes(cookie.name))
}

/**
 * @param {{ name: string, value: string }[]} cookies
 */
export function buildCookieHeader(cookies) {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

/**
 * @param {string} header
 * @returns {[string, string][]}
 */
function splitCookieHeader(header) {
  return header
    .split(';')
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => {
      const separator = part.indexOf('=')
      return separator === -1 ? [part, ''] : [part.substring(0, separator), part.substring(separator + 1)]
    })
}

/**
 * Account cookies override same-named cookies from the default session (e.g. PREF).
 * @param {string | undefined} existing
 * @param {string | null} account
 */
export function mergeCookieHeaders(existing, account) {
  if (!account) {
    return existing ?? ''
  }

  if (!existing) {
    return account
  }

  const merged = new Map(splitCookieHeader(existing))
  for (const [name, value] of splitCookieHeader(account)) {
    merged.set(name, value)
  }

  return Array.from(merged, ([name, value]) => `${name}=${value}`).join('; ')
}

/**
 * @param {string} hostname
 */
export function isYouTubeHost(hostname) {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
}

/**
 * Parses a single `set-cookie` header value into the details for `session.cookies.set()`.
 * @param {string} header
 * @param {number} now milliseconds since the epoch
 * @returns {Electron.CookiesSetDetails | null}
 */
export function parseSetCookie(header, now) {
  const [pair, ...attributes] = header.split(';')
  const separator = pair.indexOf('=')

  if (separator <= 0) {
    return null
  }

  /** @type {Electron.CookiesSetDetails} */
  const cookie = {
    url: ACCOUNT_COOKIE_URL,
    name: pair.substring(0, separator).trim(),
    value: pair.substring(separator + 1).trim(),
    path: '/'
  }

  let maxAge
  let expires

  for (const attribute of attributes) {
    const attributeSeparator = attribute.indexOf('=')
    const key = (attributeSeparator === -1 ? attribute : attribute.substring(0, attributeSeparator)).trim().toLowerCase()
    const value = attributeSeparator === -1 ? '' : attribute.substring(attributeSeparator + 1).trim()

    switch (key) {
      case 'domain': {
        const domain = value.toLowerCase().replace(/^\./, '')
        if (!isYouTubeHost(domain)) {
          return null
        }
        cookie.domain = `.${domain}`
        break
      }
      case 'path':
        cookie.path = value || '/'
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'max-age': {
        const seconds = Number(value)
        if (Number.isFinite(seconds)) {
          maxAge = seconds
        }
        break
      }
      case 'expires': {
        const timestamp = Date.parse(value)
        if (!Number.isNaN(timestamp)) {
          expires = timestamp / 1000
        }
        break
      }
      case 'samesite': {
        const sameSite = value.toLowerCase()
        cookie.sameSite = sameSite === 'strict' || sameSite === 'lax' ? sameSite : 'no_restriction'
        break
      }
    }
  }

  if (maxAge !== undefined) {
    cookie.expirationDate = now / 1000 + maxAge
  } else if (expires !== undefined) {
    cookie.expirationDate = expires
  }

  return cookie
}

/**
 * @param {{ expirationDate?: number }} cookie
 * @param {number} now milliseconds since the epoch
 */
export function isExpired(cookie, now) {
  return cookie.expirationDate !== undefined && cookie.expirationDate * 1000 <= now
}
```

- [ ] **Step 4: Тесты проходят**

Run: `node --test src/main/googleAccountCookies.test.js`
Expected: PASS, все 10 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/main/googleAccountCookies.js src/main/googleAccountCookies.test.js
git commit -m "feat: #2 разбор и сборка cookies аккаунта" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Главный процесс — подмешивание cookies, продление, выход, IPC

**Files:**
- Modify: `src/main/googleAccount.js`
- Modify: `src/main/index.js` (`onBeforeSendHeaders` ~стр. 586–642, `trackingCookieRequestFilter`/`onHeadersReceived` ~стр. 646–667, IPC рядом с `GOOGLE_ACCOUNT_LOGIN`)
- Modify: `src/constants.js`, `src/preload/interface.js`

**Interfaces:**
- Consumes: всё из Task 2; `openLoginWindow` из Task 1.
- Produces (main): `getCachedCookieHeader(): string | null` (синхронно; `null` — вход не выполнен), `refreshCookieCache(): Promise<string | null>`, `storeRotatedCookies(headers: string[]): Promise<void>`, `logoutGoogleAccount(): Promise<void>`.
- Produces (IPC): `GOOGLE_ACCOUNT_LOGOUT`, `GOOGLE_ACCOUNT_GET_COOKIE`, событие `GOOGLE_ACCOUNT_CHANGED` во все окна после входа/выхода.
- Produces (preload): `logoutGoogleAccount(): Promise<void>`, `getGoogleAccountCookie(): Promise<string | null>`, `onGoogleAccountChanged(handler: () => void): void`.

- [ ] **Step 1: Каналы IPC**

В `src/constants.js`, в `IpcChannels` после `GOOGLE_ACCOUNT_LOGIN`:

```js
  GOOGLE_ACCOUNT_LOGOUT: 'google-account-logout',
  GOOGLE_ACCOUNT_GET_COOKIE: 'google-account-get-cookie',
  GOOGLE_ACCOUNT_CHANGED: 'google-account-changed',
```

- [ ] **Step 2: Переписать `src/main/googleAccount.js` на общие функции + кеш**

Полное содержимое файла:

```js
import { BrowserWindow, session } from 'electron'

import {
  ACCOUNT_COOKIE_URL,
  buildCookieHeader,
  hasAuthCookie,
  isExpired,
  parseSetCookie,
} from './googleAccountCookies'

export const ACCOUNT_PARTITION = 'persist:yt-account'
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'

/** `null` means not signed in */
let cachedCookieHeader = null
let refreshTimeout = null

function accountSession() {
  return session.fromPartition(ACCOUNT_PARTITION)
}

async function readAccountCookies() {
  return await accountSession().cookies.get({ url: ACCOUNT_COOKIE_URL })
}

export async function refreshCookieCache() {
  const cookies = await readAccountCookies()
  cachedCookieHeader = hasAuthCookie(cookies) ? buildCookieHeader(cookies) : null
  return cachedCookieHeader
}

/**
 * Synchronous, as it is used in `onBeforeSendHeaders` for every request
 * @returns {string | null}
 */
export function getCachedCookieHeader() {
  return cachedCookieHeader
}

/**
 * @param {string} userAgent the same cleaned-up user agent as the default session
 */
export async function initGoogleAccount(userAgent) {
  const accountSession_ = accountSession()
  accountSession_.setUserAgent(userAgent)

  accountSession_.cookies.on('changed', () => {
    clearTimeout(refreshTimeout)
    refreshTimeout = setTimeout(() => {
      refreshCookieCache().catch(console.error)
    }, 100)
  })

  await refreshCookieCache()
}

export async function isGoogleAccountLoggedIn() {
  return hasAuthCookie(await readAccountCookies())
}

/**
 * Keeps the account session alive: YouTube rotates some of the session cookies in its responses.
 * @param {string[]} setCookieHeaders
 */
export async function storeRotatedCookies(setCookieHeaders) {
  if (cachedCookieHeader === null) {
    return
  }

  const cookies = accountSession().cookies
  const now = Date.now()

  await Promise.all(setCookieHeaders.map(async (header) => {
    const cookie = parseSetCookie(header, now)

    if (cookie === null) {
      return
    }

    if (isExpired(cookie, now)) {
      await cookies.remove(ACCOUNT_COOKIE_URL, cookie.name)
    } else {
      await cookies.set(cookie)
    }
  }))
}

export async function logoutGoogleAccount() {
  clearTimeout(refreshTimeout)
  await accountSession().clearStorageData()
  cachedCookieHeader = null
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

    loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    let finished = false
    const finish = async () => {
      if (finished) {
        return
      }
      finished = true

      const header = await refreshCookieCache()
      if (!loginWindow.isDestroyed()) {
        loginWindow.close()
      }
      resolve(header !== null)
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
```

- [ ] **Step 3: Подмешивание заголовков в `onBeforeSendHeaders`**

В `src/main/index.js` расширить импорты:

```js
import {
  getCachedCookieHeader,
  initGoogleAccount,
  logoutGoogleAccount,
  openLoginWindow,
  storeRotatedCookies,
} from './googleAccount'
import { isYouTubeHost, mergeCookieHeaders } from './googleAccountCookies'
```

В колбэке `onBeforeSendHeaders` сразу после `const urlObj = new URL(url)`:

```js
      const accountCookie = isYouTubeHost(urlObj.hostname) ? getCachedCookieHeader() : null
```

В ветке `if (url.startsWith('https://www.youtube.com/youtubei/'))` заменить строку `requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'` на:

```js
        requestHeaders['X-Youtube-Bootstrap-Logged-In'] = accountCookie ? 'true' : 'false'
```

Перед `callback({ requestHeaders })` (после всей цепочки `if/else if`, вместе с её комментарием `// eslint-disable-next-line n/no-callback-literal`):

```js
      if (accountCookie) {
        requestHeaders.Cookie = mergeCookieHeaders(requestHeaders.Cookie, accountCookie)
      }
```

- [ ] **Step 4: Перехват `set-cookie` в `onHeadersReceived`**

Добавить в `trackingCookieRequestFilter.urls`:

```js
        'https://www.youtube.com/youtubei/*',
```

Заменить тело обработчика `session.defaultSession.webRequest.onHeadersReceived(trackingCookieRequestFilter, ...)` на:

```js
    session.defaultSession.webRequest.onHeadersReceived(trackingCookieRequestFilter, ({ url, responseHeaders }, callback) => {
      if (responseHeaders) {
        const setCookieKey = Object.keys(responseHeaders).find(key => key.toLowerCase() === 'set-cookie')

        if (setCookieKey) {
          // keep the default session anonymous, but let a signed-in account keep its rotated session cookies
          storeRotatedCookies(responseHeaders[setCookieKey]).catch(console.error)
          delete responseHeaders[setCookieKey]
        }

        if (!url.startsWith('https://www.youtube.com/youtubei/')) {
          delete responseHeaders['content-security-policy']
          delete responseHeaders['cross-origin-opener-policy']
          delete responseHeaders['report-to']
          delete responseHeaders['reporting-endpoints']
        }
      }

      // eslint-disable-next-line n/no-callback-literal
      callback({ responseHeaders })
    })
```

(Побочный эффект: `set-cookie` ответов `youtubei` больше не попадают в общее хранилище даже без входа — для FreeTube это только плюс к приватности.)

- [ ] **Step 5: IPC-обработчики**

Заменить обработчик `GOOGLE_ACCOUNT_LOGIN` из Task 1 и добавить рядом:

```js
  function notifyGoogleAccountChanged() {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.GOOGLE_ACCOUNT_CHANGED)
    }
  }

  ipcMain.handle(IpcChannels.GOOGLE_ACCOUNT_LOGIN, async (event) => {
    if (!isFreeTubeUrl(event.senderFrame.url)) {
      return false
    }

    const loggedIn = await openLoginWindow(BrowserWindow.fromWebContents(event.sender))
    notifyGoogleAccountChanged()
    return loggedIn
  })

  ipcMain.handle(IpcChannels.GOOGLE_ACCOUNT_LOGOUT, async (event) => {
    if (!isFreeTubeUrl(event.senderFrame.url)) {
      return
    }

    await logoutGoogleAccount()
    notifyGoogleAccountChanged()
  })

  ipcMain.handle(IpcChannels.GOOGLE_ACCOUNT_GET_COOKIE, (event) => {
    if (!isFreeTubeUrl(event.senderFrame.url)) {
      return null
    }

    return getCachedCookieHeader()
  })
```

(`BrowserWindow.getAllWindows()` включает и само окно входа, если оно ещё не уничтожено — у него нет preload, событие просто некому слушать.)

- [ ] **Step 6: Методы preload**

В `src/preload/interface.js` после `loginGoogleAccount`:

```js
  /**
   * @returns {Promise<void>}
   */
  logoutGoogleAccount: () => {
    return ipcRenderer.invoke(IpcChannels.GOOGLE_ACCOUNT_LOGOUT)
  },

  /**
   * @returns {Promise<string | null>}
   */
  getGoogleAccountCookie: () => {
    return ipcRenderer.invoke(IpcChannels.GOOGLE_ACCOUNT_GET_COOKIE)
  },

  /**
   * @param {() => void} handler
   */
  onGoogleAccountChanged: (handler) => {
    ipcRenderer.on(IpcChannels.GOOGLE_ACCOUNT_CHANGED, () => handler())
  },
```

- [ ] **Step 7: Тесты Task 2 и lint**

Run: `node --test src/main/googleAccountCookies.test.js` → PASS.
Run: `pnpm run eslint-lint` → без ошибок в изменённых файлах.

- [ ] **Step 8: Ручная проверка главного процесса**

`pnpm dev`, в консоли DevTools:

```js
await window.ftElectron.loginGoogleAccount()          // true (или окно сразу закроется, если вход уже был)
(await window.ftElectron.getGoogleAccountCookie()).includes('SAPISID=')   // true
```

DevTools → Network: открыть любое видео, выбрать запрос `youtubei/v1/next` → Request Headers показывает `X-Youtube-Bootstrap-Logged-In: true`. (Заголовок `Cookie` DevTools renderer может не показать — он подставляется ниже по стеку; это нормально.) Запрос к `*.googlevideo.com` — без cookies аккаунта.

Затем:

```js
await window.ftElectron.logoutGoogleAccount()
await window.ftElectron.getGoogleAccountCookie()      // null
await window.ftElectron.loginGoogleAccount()          // окно открывается снова и просит войти (раздел очищен)
```

Закрыть окно входа крестиком, не входя → `false`.

- [ ] **Step 9: Commit**

```bash
git add src/main/googleAccount.js src/main/index.js src/constants.js src/preload/interface.js
git commit -m "feat: #2 подмешивание cookies аккаунта и продление сессии" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: YouTube.js — сессия от имени аккаунта и информация об аккаунте

**Files:**
- Modify: `src/renderer/helpers/api/local.js` (`createSession` ~стр. 72–100 и новые экспорты рядом с `createInnertube`)

**Interfaces:**
- Consumes: `window.ftElectron.getGoogleAccountCookie()` — не напрямую; значение передаёт store (Task 5).
- Produces:
  - `setGoogleAccountCookie(cookie: string | null): void`
  - `setGoogleLoggedOutHandler(handler: (() => void) | null): void`
  - `getLocalAccountInfo(): Promise<{ name: string, handle: string, avatarUrl: string } | null>` — `null`, если YouTube не видит выбранного аккаунта; бросает при сетевой ошибке.

- [ ] **Step 1: Состояние аккаунта в модуле и детектор `loggedOut`**

Перед `async function createSession(`:

```js
/** @type {string | null} */
let googleAccountCookie = null

/** @type {(() => void) | null} */
let googleLoggedOutHandler = null

/**
 * @param {string | null} cookie the account cookie string from the main process, `null` when signed out
 */
export function setGoogleAccountCookie(cookie) {
  googleAccountCookie = cookie || null
  clearLocalSearchSuggestionsSession()
}

/**
 * @param {(() => void) | null} handler called when YouTube reports the request as logged out
 */
export function setGoogleLoggedOutHandler(handler) {
  googleLoggedOutHandler = handler
}

/**
 * @param {import('youtubei.js').Types.FetchFunction} fetchFunction
 * @returns {import('youtubei.js').Types.FetchFunction}
 */
function withLoggedOutDetection(fetchFunction) {
  return async (input, init) => {
    const response = await fetchFunction(input, init)

    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url)

    if (googleLoggedOutHandler && url.includes('/youtubei/') && response.headers.get('content-type')?.includes('json')) {
      response.clone().json()
        .then((data) => {
          if (data?.responseContext?.mainAppWebResponseContext?.loggedOut === true) {
            googleLoggedOutHandler?.()
          }
        })
        .catch(() => {})
    }

    return response
  }
}
```

(`clearLocalSearchSuggestionsSession` объявлена ниже как `export function` — hoisting делает вызов корректным; сброс нужен, чтобы подсказки поиска пересоздали сессию уже с/без cookie.)

- [ ] **Step 2: Передать cookie в `Session.create`**

В `createSession` перед `return await Session.create({`:

```js
  const baseFetch = fetchFunc ?? ((input, init) => fetch(input, init))
```

В объекте опций заменить

```js
    // use browser fetch
    fetch: (fetchFunc ?? ((input, init) => fetch(input, init))),
```

на

```js
    // signed-in Google account: YouTube.js computes the SAPISIDHASH authorization from it,
    // the Cookie header itself is dropped by the browser and added by the main process instead
    cookie: googleAccountCookie ?? undefined,

    // use browser fetch
    fetch: googleAccountCookie ? withLoggedOutDetection(baseFetch) : baseFetch,
```

- [ ] **Step 3: `getLocalAccountInfo`**

После `createInnertube`:

```js
/**
 * @returns {Promise<{ name: string, handle: string, avatarUrl: string } | null>}
 */
export async function getLocalAccountInfo() {
  const innertube = await createInnertube()

  // getInfo(false) uses the TV client, which doesn't accept web cookies
  const accounts = await innertube.account.getInfo(true)
  const account = accounts.find(item => item.is_selected) ?? accounts[0]

  if (!account) {
    return null
  }

  return {
    name: account.account_name.toString(),
    handle: account.channel_handle?.toString() ?? '',
    avatarUrl: account.account_photo[0]?.url ?? ''
  }
}
```

- [ ] **Step 4: Lint**

Run: `pnpm run eslint-lint` → без ошибок.

- [ ] **Step 5: Ручная проверка**

`pnpm dev` (вход выполнен после Task 3). В консоли DevTools импорт модуля недоступен, поэтому проверка — через Task 5. Здесь только убедиться, что приложение без входа работает как раньше: `logoutGoogleAccount()`, перезапуск, открыть главную, поиск, видео — всё грузится.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/helpers/api/local.js
git commit -m "feat: #2 сессия YouTube.js от имени аккаунта" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Состояние аккаунта (Vuex) и запуск

**Files:**
- Create: `src/renderer/store/modules/googleAccount.js`
- Modify: `src/renderer/store/index.js`
- Modify: `src/renderer/App.vue` (`onMounted`, сразу после `await store.dispatch('grabUserSettings')`)
- Modify: `static/locales/en-US.yaml`, `static/locales/ru.yaml` (ключ `Google Account.Session Expired`)

**Interfaces:**
- Consumes: `setGoogleAccountCookie`, `setGoogleLoggedOutHandler`, `getLocalAccountInfo` (Task 4); `window.ftElectron.*` (Task 3).
- Produces: getter `getGoogleAccount → { isLoggedIn: boolean, name: string, handle: string, avatarUrl: string }`; actions `setupGoogleAccount`, `initGoogleAccount`, `loginGoogleAccount → Promise<boolean>`, `logoutGoogleAccount`, `refreshGoogleAccountInfo`, `handleGoogleLoggedOut`.

- [ ] **Step 1: Модуль store**

`src/renderer/store/modules/googleAccount.js`:

```js
import i18n from '../../i18n/index'
import { showToast } from '../../helpers/utils'
import {
  getLocalAccountInfo,
  setGoogleAccountCookie,
  setGoogleLoggedOutHandler,
} from '../../helpers/api/local'

// the player uses non-web clients that always report "loggedOut", so re-check at most once a minute
const LOGGED_OUT_RECHECK_INTERVAL_MS = 60_000

let lastLoggedOutRecheck = 0

function signedOutAccount() {
  return { isLoggedIn: false, name: '', handle: '', avatarUrl: '' }
}

const state = {
  googleAccount: signedOutAccount()
}

const getters = {
  getGoogleAccount(state) {
    return state.googleAccount
  }
}

const actions = {
  async setupGoogleAccount({ dispatch }) {
    setGoogleLoggedOutHandler(() => dispatch('handleGoogleLoggedOut'))

    // login/logout in any window is broadcast to all of them
    window.ftElectron.onGoogleAccountChanged(() => dispatch('initGoogleAccount'))

    await dispatch('initGoogleAccount')
  },

  async initGoogleAccount({ commit, dispatch }) {
    const cookie = await window.ftElectron.getGoogleAccountCookie()
    setGoogleAccountCookie(cookie)

    if (!cookie) {
      commit('setGoogleAccount', signedOutAccount())
      return
    }

    commit('setGoogleAccount', { ...signedOutAccount(), isLoggedIn: true })
    await dispatch('refreshGoogleAccountInfo')
  },

  async loginGoogleAccount() {
    // the state is updated through the GOOGLE_ACCOUNT_CHANGED broadcast
    return await window.ftElectron.loginGoogleAccount()
  },

  async logoutGoogleAccount() {
    await window.ftElectron.logoutGoogleAccount()
  },

  async refreshGoogleAccountInfo({ commit, dispatch }) {
    let info
    try {
      info = await getLocalAccountInfo()
    } catch (error) {
      // network issues: stay signed in, the name and avatar will be fetched on the next start
      console.error(error)
      return
    }

    if (info === null) {
      await dispatch('logoutGoogleAccount')
      showToast(i18n.global.t('Google Account.Session Expired'))
      return
    }

    commit('setGoogleAccount', { isLoggedIn: true, ...info })
  },

  async handleGoogleLoggedOut({ dispatch }) {
    const now = Date.now()
    if (now - lastLoggedOutRecheck < LOGGED_OUT_RECHECK_INTERVAL_MS) {
      return
    }
    lastLoggedOutRecheck = now

    await dispatch('refreshGoogleAccountInfo')
  }
}

const mutations = {
  setGoogleAccount(state, googleAccount) {
    state.googleAccount = googleAccount
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
```

- [ ] **Step 2: Зарегистрировать модуль**

`src/renderer/store/index.js`: импорт `import googleAccount from './modules/googleAccount'` после `import player from './modules/player'`, и `googleAccount,` в `modules` после `player,`.

- [ ] **Step 3: Запуск в `App.vue`**

В `onMounted` сразу после `await store.dispatch('grabUserSettings')`:

```js
  if (process.env.IS_ELECTRON && process.env.SUPPORTS_LOCAL_API) {
    store.dispatch('setupGoogleAccount')
  }
```

(Без `await` — сетевой запрос информации об аккаунте не должен задерживать старт.)

- [ ] **Step 4: Строка уведомления**

`static/locales/en-US.yaml` — новый корневой ключ в конце файла:

```yaml
Google Account:
  Session Expired: Your Google session has expired, please sign in again
```

`static/locales/ru.yaml` — в конце файла:

```yaml
Google Account:
  Session Expired: Сессия Google истекла, войдите снова
```

- [ ] **Step 5: Lint**

Run: `pnpm run lint; pnpm run lint-yml` → без ошибок.

- [ ] **Step 6: Ручная проверка**

`pnpm dev` с выполненным входом. DevTools → Network → при старте есть запрос `youtubei/v1/account/accounts_list` с ответом, содержащим имя аккаунта. Открыть главную — рекомендации персональные (отличаются от анонимных). Открыть второе окно (Ctrl+N), в первом выполнить `await window.ftElectron.logoutGoogleAccount()` — во втором окне запросы тоже становятся анонимными (`X-Youtube-Bootstrap-Logged-In: false`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/store/modules/googleAccount.js src/renderer/store/index.js src/renderer/App.vue static/locales/en-US.yaml static/locales/ru.yaml
git commit -m "feat: #2 состояние аккаунта Google в store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Интерфейс — раздел настроек и аватар

**Files:**
- Create: `src/renderer/components/GoogleAccountSettings/GoogleAccountSettings.vue`, `GoogleAccountSettings.css`
- Modify: `src/renderer/views/Settings/Settings.vue`
- Modify: `src/renderer/components/TopNav/TopNav.vue`, `TopNav.scss`
- Modify: `static/locales/en-US.yaml`, `static/locales/ru.yaml` (секция `Settings`)

**Interfaces:**
- Consumes: getter `getGoogleAccount`, actions `loginGoogleAccount`, `logoutGoogleAccount` (Task 5); getter `getBackendPreference` (существующий).
- Produces: раздел настроек с `type: 'google-account'`; маршрут `/settings?section=google-account` прокручивает к нему.

- [ ] **Step 1: Строки**

`static/locales/en-US.yaml`, внутри `Settings:` после блока `SponsorBlock Settings:` (стр. ~677, с тем же отступом в 2 пробела):

```yaml
  Google Account Settings:
    Google Account Settings: YouTube Account
    Sign In: Sign in with Google
    Sign Out: Sign out
    Sign In Failed: You were not signed in
    Warning: All requests to YouTube will be made from your account. Google will see your watch and search history.
    Local API Only: The account is only used with the Local API backend.
```

`static/locales/ru.yaml`, внутри `Settings:` после блока `SponsorBlock Settings:` (стр. ~565):

```yaml
  Google Account Settings:
    Google Account Settings: Аккаунт YouTube
    Sign In: Войти в Google
    Sign Out: Выйти
    Sign In Failed: Вход не выполнен
    Warning: Все запросы к YouTube будут идти от вашего аккаунта. Google увидит историю просмотров и поиска.
    Local API Only: Аккаунт используется только с Local API.
```

- [ ] **Step 2: Компонент раздела**

`src/renderer/components/GoogleAccountSettings/GoogleAccountSettings.vue`:

```vue
<template>
  <FtSettingsSection
    :title="t('Settings.Google Account Settings.Google Account Settings')"
  >
    <p
      v-if="backendPreference !== 'local'"
      class="googleAccountNote"
    >
      {{ t('Settings.Google Account Settings.Local API Only') }}
    </p>
    <FtFlexBox
      v-if="googleAccount.isLoggedIn"
      class="settingsFlexStart460px googleAccountRow"
    >
      <img
        v-if="googleAccount.avatarUrl"
        class="googleAccountAvatar"
        :src="googleAccount.avatarUrl"
        alt=""
      >
      <div class="googleAccountNames">
        <span class="googleAccountName">{{ googleAccount.name }}</span>
        <span
          v-if="googleAccount.handle"
          class="googleAccountHandle"
        >{{ googleAccount.handle }}</span>
      </div>
      <FtButton
        :label="t('Settings.Google Account Settings.Sign Out')"
        @click="handleSignOut"
      />
    </FtFlexBox>
    <template v-else>
      <p class="googleAccountNote">
        {{ t('Settings.Google Account Settings.Warning') }}
      </p>
      <FtFlexBox class="settingsFlexStart460px">
        <FtButton
          :label="t('Settings.Google Account Settings.Sign In')"
          :icon="['fas', 'circle-user']"
          @click="handleSignIn"
        />
      </FtFlexBox>
    </template>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'

const { t } = useI18n()

const busy = ref(false)

/** @type {import('vue').ComputedRef<{ isLoggedIn: boolean, name: string, handle: string, avatarUrl: string }>} */
const googleAccount = computed(() => store.getters.getGoogleAccount)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

async function handleSignIn() {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    const loggedIn = await store.dispatch('loginGoogleAccount')
    if (!loggedIn) {
      showToast(t('Settings.Google Account Settings.Sign In Failed'))
    }
  } finally {
    busy.value = false
  }
}

async function handleSignOut() {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    await store.dispatch('logoutGoogleAccount')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped src="./GoogleAccountSettings.css" />
```

(`FtButton` не имеет свойства `disabled`, поэтому повторные клики отсекает `busy` в обработчиках.)

`src/renderer/components/GoogleAccountSettings/GoogleAccountSettings.css`:

```css
.googleAccountNote {
  margin-block: 0 12px;
  opacity: 0.8;
}

.googleAccountRow {
  align-items: center;
  gap: 12px;
}

.googleAccountAvatar {
  block-size: 48px;
  border-radius: 50%;
  inline-size: 48px;
}

.googleAccountNames {
  display: flex;
  flex-direction: column;
}

.googleAccountName {
  font-weight: bold;
}

.googleAccountHandle {
  opacity: 0.8;
}
```

- [ ] **Step 3: Зарегистрировать раздел в `Settings.vue`**

Импорт после `import PasswordSettings ...`:

```js
import GoogleAccountSettings from '../../components/GoogleAccountSettings/GoogleAccountSettings.vue'
```

В `settingsComponentsData`, после блока `sponsor-block`:

```js
    ...(process.env.IS_ELECTRON && process.env.SUPPORTS_LOCAL_API
      ? [{
          type: 'google-account',
          title: t('Settings.Google Account Settings.Google Account Settings'),
          icon: ['fas', 'circle-user'],
          component: GoogleAccountSettings
        }]
      : []),
```

Переход по `?section=`: импорт `import { useRoute } from 'vue-router'`, под `const { locale, t } = useI18n()` — `const route = useRoute()`. В конец `handleMounted()`:

```js
  const requestedSection = route.query.section
  if (typeof requestedSection === 'string' && settingsSectionComponents.value.some(section => section.type === requestedSection)) {
    navigateToSection(requestedSection)
  }
```

(`navigateToSection` объявлена ниже как `function` — hoisting.)

- [ ] **Step 4: Аватар в `TopNav.vue`**

Заменить `<FtProfileSelector class="side profiles" />` на:

```vue
    <div class="side profiles">
      <RouterLink
        v-if="googleAccount.isLoggedIn && googleAccount.avatarUrl"
        class="googleAccountLink"
        :title="googleAccount.name"
        :to="{ path: '/settings', query: { section: 'google-account' } }"
      >
        <img
          class="googleAccountAvatar"
          :src="googleAccount.avatarUrl"
          alt=""
        >
      </RouterLink>
      <FtProfileSelector />
    </div>
```

В `<script setup>` рядом с другими `computed` из store:

```js
/** @type {import('vue').ComputedRef<{ isLoggedIn: boolean, name: string, avatarUrl: string }>} */
const googleAccount = computed(() => store.getters.getGoogleAccount)
```

(`computed` и `store` в `TopNav.vue` уже импортированы.)

`TopNav.scss`, внутри `.side { ... }` после блока `&.profiles { ... }`:

```scss
  .googleAccountLink {
    display: flex;
    margin-inline-end: 6px;
  }

  .googleAccountAvatar {
    block-size: 28px;
    border-radius: 50%;
    inline-size: 28px;
  }
```

- [ ] **Step 5: Lint**

Run: `pnpm run lint; pnpm run lint-yml` → без ошибок.

- [ ] **Step 6: Ручная проверка UI**

`pnpm dev`:
- Настройки → «Аккаунт YouTube» есть в меню; без входа — предупреждение и кнопка «Войти в Google».
- Вход → окно Google → после входа раздел показывает аватар, имя, handle и «Выйти»; в верхней панели справа появился аватар.
- Клик по аватару → открываются настройки и прокручиваются к «Аккаунт YouTube».
- Закрыть окно входа, не войдя → уведомление «Вход не выполнен», раздел без изменений.
- Переключить бэкенд на Invidious (Настройки → Общие) → в разделе появилась пометка «только с Local API».
- Верхняя панель при узком окне (< 680 px) не разъехалась.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/GoogleAccountSettings/GoogleAccountSettings.vue src/renderer/components/GoogleAccountSettings/GoogleAccountSettings.css src/renderer/views/Settings/Settings.vue src/renderer/components/TopNav/TopNav.vue src/renderer/components/TopNav/TopNav.scss static/locales/en-US.yaml static/locales/ru.yaml
git commit -m "feat: #2 раздел «Аккаунт YouTube» и аватар в панели" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Сквозная проверка

**Files:** нет изменений (только если проверка найдёт ошибку — тогда исправление в файле-владельце и отдельный коммит).

- [ ] **Step 1: Автоматические проверки**

Run: `node --test src/main/googleAccountCookies.test.js` → PASS.
Run: `pnpm run lint-all` → без ошибок.

- [ ] **Step 2: Полный ручной сценарий из спеки**

`pnpm dev`, по порядку:
1. Без входа: главная, поиск, видео работают как раньше.
2. Вход через настройки → имя и аватар видны в разделе и в верхней панели.
3. Главная показывает персональные рекомендации; поиск работает; видео проигрывается (в т.ч. проверить, что плеер **не** разлогинил — через минуту аватар на месте).
4. Закрыть FreeTube полностью, открыть снова → вход сохранился, аватар подтянулся.
5. «Выйти» → аватар исчез, `X-Youtube-Bootstrap-Logged-In: false` в запросах `youtubei`.
6. Повторный вход → окно Google снова спрашивает логин (раздел действительно очищен).
7. Истечение сессии (по желанию человека, необратимо для других устройств): в настройках безопасности Google завершить сеанс этого устройства → перезапустить FreeTube → уведомление «Сессия Google истекла», выход выполнен. Если `getInfo(true)` вместо пустого списка **бросает** ошибку — выход не произойдёт: записать в журнал #2 как находку.

- [ ] **Step 3: Итог в журнал задачи #2**

Записать, что проверено, что нет, и найденные ограничения (например, отсутствие ротации `__Secure-*PSIDTS`, если сессия протухает быстро).
