# Вход в аккаунт Google — основа (подпроект 1 из 5)

Задача Makestead: #2 (мастер-задача #1). Личный форк, в upstream не отправляется.

## Цель

Дать FreeTube войти в один аккаунт Google/YouTube и делать **все** запросы Local API от его имени,
как официальный клиент. Этот подпроект — фундамент: вход, хранение и продление сессии, подстановка
авторизации в запросы, отображение аккаунта, выход. Функции поверх входа (контент 18+, подписки,
лайки/плейлисты/история, комментарии) — подпроекты #3–#6.

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Как получаем cookies | Только окно входа Google внутри FreeTube. Импорта `cookies.txt` нет. |
| Сколько аккаунтов | Один. Без бренд-каналов и переключения. |
| Какие запросы авторизованы | Все запросы к `*.youtube.com`, пока выполнен вход. |
| Архитектура | Отдельный раздел Electron `persist:yt-account` + подстановка `Cookie` в главном процессе. |

Почему не просто `cookie` в YouTube.js: YouTube.js работает в renderer через браузерный `fetch`,
который молча выбрасывает заголовок `Cookie`. Поэтому `Cookie` подставляет главный процесс, а
YouTube.js получает строку cookies только чтобы вычислить `Authorization: SAPISIDHASH` и считать
сессию `logged_in`.

## Пользовательский сценарий

**Настройки → «Аккаунт YouTube»** (раздел виден только при Local API как основном бэкенде):
- Не вошли: кнопка «Войти в Google» и предупреждение «Все запросы к YouTube будут идти от вашего
  аккаунта. Google увидит историю просмотров и поиска».
- Вошли: аватар, имя, handle/email, кнопка «Выйти».

**Вход:**
1. Модальное окно с `https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/`.
2. Логин/пароль/2FA вводятся на странице Google; FreeTube их не видит.
3. Окно закрывается само, когда в разделе есть cookie `SAPISID` (или `__Secure-3PAPISID`) и
   навигация дошла до `https://www.youtube.com/`. Затем запрашивается информация об аккаунте.
4. Окно закрыто без входа — состояние не меняется.

**Верхняя панель:** маленький аватар справа, клик ведёт в «Аккаунт YouTube». Нет входа — нет аватара.

**Сессия истекла** (YouTube отвечает `loggedOut`): автоматический выход, уведомление
«Сессия Google истекла, войдите снова», дальше анонимная работа.

**Invidious:** вход не удаляется, но не применяется; в разделе пометка «работает только с Local API».

## Устройство

### Главный процесс — `src/main/googleAccount.js`

- `ACCOUNT_PARTITION = 'persist:yt-account'`. Cookies аккаунта живут только тут; Chromium хранит
  их на диске зашифрованными средствами ОС (проверить при реализации, что шифрование включено).
- `openLoginWindow(parentWindow): Promise<boolean>` — модальный `BrowserWindow`,
  `webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false }`,
  без preload. User-Agent — тот же «очищенный» UA, что главный процесс ставит
  `session.defaultSession` (без `Electron`/`FreeTube`).
- `isLoggedIn(): Promise<boolean>` — есть ли `SAPISID` в разделе.
- `getCookieHeader(): Promise<string | null>` — строка `name=value; ...` для `https://www.youtube.com`.
  Кешируется; кеш сбрасывается по `session.fromPartition(ACCOUNT_PARTITION).cookies.on('changed')`.
- `storeRotatedCookies(setCookieHeaders)` — Google периодически обновляет cookies сессии
  (`__Secure-1PSIDTS`, `__Secure-3PSIDTS` и др.). Пришедшие в ответах youtube.com `set-cookie`
  записываются в раздел аккаунта, иначе сессия протухнет.
- `logout()` — `clearStorageData()` раздела + сброс кеша.

Чистые функции (выносятся отдельно для тестов):
- `buildCookieHeader(cookies)` — из массива cookies Electron в строку заголовка.
- `parseSetCookie(header)` — разбор строки `set-cookie` в объект для `cookies.set()`
  (name, value, domain, path, secure, httpOnly, expirationDate, sameSite).

### Изменения в `src/main/index.js`

- `onBeforeSendHeaders`: если вход выполнен и хост запроса — `*.youtube.com`, выставить
  `Cookie` из `getCookieHeader()` (дописав к нему существующую обработку `PREF` для watch-страниц)
  и `X-Youtube-Bootstrap-Logged-In: true` (сейчас жёстко `false`). Запросы к `googlevideo.com`,
  `ytimg.com`, `ggpht.com` не трогаем.
- `onHeadersReceived`: фильтр расширяется на `https://www.youtube.com/youtubei/*`. Если вход
  выполнен — `set-cookie` передаётся в `storeRotatedCookies`; затем, как и сейчас, удаляется из
  ответа, так что общее хранилище FreeTube (`CONSENT`, `SOCS`) остаётся анонимным.
- IPC-обработчики для каналов ниже.

Кеш `getCookieHeader()` нужен потому, что `onBeforeSendHeaders` вызывается на каждый запрос, а
`cookies.get()` асинхронен; колбэк обработчика допускает асинхронный вызов.

### IPC — `src/constants.js`, `src/preload/interface.js`

- `GOOGLE_ACCOUNT_LOGIN` → `Promise<boolean>`
- `GOOGLE_ACCOUNT_LOGOUT` → `Promise<void>`
- `GOOGLE_ACCOUNT_GET_COOKIE` → `Promise<string | null>`

### Renderer

- `src/renderer/helpers/api/local.js` → `createSession()`: если вход выполнен, передать
  `cookie` в `Session.create`. Строку получать через IPC один раз и кешировать в модуле;
  сбрасывать при входе/выходе.
- Vuex-модуль `googleAccount`: состояние `isLoggedIn`, `name`, `handle`, `avatarUrl`;
  действия `login`, `logout`, `refreshAccountInfo` (через `account/account_menu` YouTube.js).
  `refreshAccountInfo` вызывается при старте приложения и после входа.
- Компоненты: `GoogleAccountSettings` (раздел настроек, по образцу соседних `*Settings`) и аватар
  в `TopNav`.
- Обнаружение истёкшей сессии: при старте (`refreshAccountInfo`) и по ответам `youtubei`, где
  `responseContext.mainAppWebResponseContext.loggedOut === true` → `logout` + toast.
- Строки интерфейса — в `static/locales/ru.yaml` и `en-US.yaml`.

## Ошибки

- Google блокирует окно входа («браузер небезопасен») — задача упирается в это; см. «Порядок работ».
- Окно закрыто без входа → `login` возвращает `false`, UI без изменений.
- `account_menu` не ответил (сеть) → вход считается выполненным, имя/аватар не показаны, повтор при
  следующем старте.
- Истёкшая сессия → автоматический выход и уведомление (см. выше).

## Проверка

- Unit-тесты для `buildCookieHeader` и `parseSetCookie` (в т.ч. фильтрация по домену) на встроенном `node:test` — в проекте нет тестового фреймворка, новых зависимостей не добавляем. Запуск: `node --test src/main/googleAccount*.test.mjs`.
- Ручной сценарий: вход → имя/аватар видны → главная с персональными рекомендациями →
  перезапуск, вход сохранился → выход → запросы снова анонимны → повторный вход.
- `pnpm run lint` чистый (пакетный менеджер проекта — pnpm).

## Порядок работ

1. **Проверка осуществимости первым делом:** открыть окно входа Google в разделе
   `persist:yt-account` с очищенным UA и убедиться, что Google пускает. Если нет — остановиться и
   вернуться к человеку (варианты: другой UA, импорт `cookies.txt`).
2. Главный процесс: модуль, подстановка заголовков, продление cookies, IPC.
3. Renderer: `createSession`, Vuex-модуль, UI, обнаружение истёкшей сессии.

## Вне рамок

Бренд-каналы и несколько аккаунтов, импорт `cookies.txt`, всё из подпроектов #3–#6.
