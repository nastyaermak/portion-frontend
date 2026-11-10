// Спільне для всіх сторінок: токени, запити до API, шапка з кнопками входу.

const API_URL = 'http://127.0.0.1:8000/api';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';
const USER_KEY = 'user_name';

const auth = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  isLoggedIn: () => Boolean(localStorage.getItem(REFRESH_KEY)),
  getUserName: () => localStorage.getItem(USER_KEY) || '',

  saveTokens(access, refresh) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },

  saveUserName(name) {
    localStorage.setItem(USER_KEY, name);
  },

  // Logout: токени зберігаються лише на клієнті, тому просто видаляємо їх
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

// Один спільний запит на оновлення, навіть якщо кілька запитів
// одночасно отримали 401
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(API_URL + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: auth.getRefresh() }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('refresh failed');
        const data = await response.json();
        auth.saveTokens(data.access);
        return data.access;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Запит до API. Якщо access-токен прострочений (401), отримуємо новий
// через refresh-токен і повторюємо запит — користувачу не треба
// логінитися знову.
async function api(path, options = {}) {
  const send = () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = auth.getAccess();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API_URL + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  };

  let response = await send();
  if (response.status === 401 && auth.getRefresh()) {
    try {
      await refreshAccessToken();
    } catch (e) {
      // refresh теж прострочений — сесія закінчилась
      auth.clear();
      if (options.authRequired) {
        goToLogin();
        throw new Error('session expired');
      }
    }
    response = await send();
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && options.authRequired) goToLogin();
    const error = new Error((data && data.message) || 'Помилка запиту');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function currentPage() {
  return location.pathname.split('/').pop() + location.search;
}

// Неавторизованого відправляємо на логін і запам'ятовуємо, звідки він прийшов
function goToLogin() {
  location.href = 'login.html?next=' + encodeURIComponent(currentPage());
}

// Для сторінок тільки для залогінених
function requireAuth() {
  if (!auth.isLoggedIn()) {
    goToLogin();
    return false;
  }
  return true;
}

// Для логіну й реєстрації: залогіненому там нічого робити
function redirectIfLoggedIn() {
  if (auth.isLoggedIn()) {
    location.replace('profile.html');
    return true;
  }
  return false;
}

// Куди повернути після логіну. Дозволяємо лише сторінки цього сайту,
// щоб посилання на кшталт ?next=https://evil.com не працювали.
function nextPage() {
  const next = new URLSearchParams(location.search).get('next') || '';
  if (/^[\w-]+\.html(\?[^#]*)?$/.test(next) && !next.startsWith('login.html')
      && !next.startsWith('register.html')) {
    return next;
  }
  return 'profile.html';
}

async function login(username, password) {
  const tokens = await api('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  auth.saveTokens(tokens.access, tokens.refresh);
  const me = await api('/me');
  auth.saveUserName(me.display_name || me.username);
}

function logout() {
  auth.clear();
  location.href = 'index.html';
}

// Шапка: залогінений бачить своє ім'я і «Вийти», незалогінений — «Увійти»
function renderHeader() {
  const nav = $('<nav>');
  nav.append($('<a href="index.html">').text('Рецепти'));
  if (auth.isLoggedIn()) {
    nav.append(
      $('<a href="profile.html">').text('Мій кабінет'),
      $('<span class="user-name">').text(auth.getUserName()),
      $('<button class="secondary" id="logout-button">').text('Вийти').on('click', logout),
    );
  } else {
    nav.append(
      $('<a href="register.html">').text('Реєстрація'),
      $('<a class="button" id="login-button">')
        .attr('href', 'login.html?next=' + encodeURIComponent(currentPage()))
        .text('Увійти'),
    );
  }
  $('header').empty().append($('<a class="logo" href="index.html">').text('Порція 🥗'), nav);
}

// Показує помилки з бекенду під полями форми
function showFieldErrors(form, error) {
  form.find('.field-error').remove();
  const fields = (error.data && error.data.fields) || {};
  Object.entries(fields).forEach(([name, message]) => {
    const input = form.find(`[name="${name}"]`);
    if (input.length) {
      input.after($('<div class="field-error">').text(message));
    }
  });
  const general = fields.non_field_errors || (error.data && error.data.message) || error.message;
  form.find('.form-message').removeClass('success').addClass('error').text(general);
}
