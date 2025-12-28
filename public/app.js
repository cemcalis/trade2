const api = (path, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = options.headers || {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  return fetch(path, { ...options, headers }).then((r) => {
    if (!r.ok) throw r; return r.json();
  });
};

const statusText = document.getElementById('status-text');
const balanceEl = document.getElementById('balance');
const verifiedEl = document.getElementById('verified');
const quotesEl = document.getElementById('quotes');
const tabs = document.querySelectorAll('.tab');
let currentBucket = 'crypto';

const updateStatus = (txt) => statusText.textContent = txt;
const showError = async (resp) => {
  let msg = 'Bilinmeyen hata';
  try { const data = await resp.json(); msg = data.error || JSON.stringify(data); } catch (_) {}
  alert(msg);
};

const loadProfile = () => api('/api/profile')
  .then((data) => {
    updateStatus(`Hoş geldiniz ${data.first_name}`);
    balanceEl.textContent = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(data.balance || 0);
    verifiedEl.textContent = data.verified ? 'Onaylı' : 'Beklemede';
  })
  .catch(() => updateStatus('Token doğrulanamadı'));

const loadQuotes = () => api(`/api/markets/${currentBucket}`)
  .then(({ quotes }) => {
    quotesEl.innerHTML = quotes.map((q) => `<div class="quote"><span>${q.symbol}</span><span class="price">${q.price ?? q.error}</span></div>`).join('');
  })
  .catch(async (err) => { await showError(err); });

const loadNews = () => fetch('/api/news')
  .then((r) => r.json())
  .then(({ articles }) => {
    const list = (articles || []).map((n) => `<div class="news__item"><a href="${n.url}" target="_blank" rel="noopener">${n.headline || n.title}</a><p>${n.source?.name || n.source} • ${new Date(n.publishedAt || n.published_at).toLocaleString('tr-TR')}</p></div>`).join('');
    document.getElementById('news-list').innerHTML = list;
  })
  .catch(() => document.getElementById('news-list').textContent = 'Haber kaynağı erişilemiyor');

const registerForm = document.getElementById('register-form');
registerForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(registerForm).entries());
  api('/api/auth/register', { method: 'POST', body: JSON.stringify(formData) })
    .then(() => { alert('Kayıt başarıyla oluşturuldu.'); })
    .catch(showError);
});

const loginForm = document.getElementById('login-form');
loginForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(loginForm).entries());
  api('/api/auth/login', { method: 'POST', body: JSON.stringify(formData) })
    .then((data) => {
      localStorage.setItem('token', data.token);
      updateStatus(`Bağlandı • Rol: ${data.role}`);
      loadProfile();
      loadQuotes();
      loadNews();
    })
    .catch(showError);
});

const idForm = document.getElementById('id-form');
idForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(idForm);
  const token = localStorage.getItem('token');
  if (!token) return alert('Önce giriş yapın');
  const headers = { Authorization: `Bearer ${token}` };
  fetch('/api/profile').then((r) => r.json()).then((profile) => {
    fetch(`/api/users/${profile.id}/documents`, { method: 'POST', body: fd, headers })
      .then((r) => r.json())
      .then(() => alert('Kimlik gönderildi, admin onayını bekleyin.'))
      .catch(showError);
  });
});

const cashForm = document.getElementById('cash-form');
cashForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const { amount, type } = Object.fromEntries(new FormData(cashForm).entries());
  api(type === 'deposit' ? '/api/deposits/request' : '/api/withdrawals/request', { method: 'POST', body: JSON.stringify({ amount: Number(amount) }) })
    .then(() => alert('Talep alındı.'))
    .catch(showError);
});

const tradeForm = document.getElementById('trade-form');
tradeForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(tradeForm).entries());
  payload.quantity = Number(payload.quantity);
  payload.price = Number(payload.price);
  api('/api/trades/order', { method: 'POST', body: JSON.stringify(payload) })
    .then((r) => { balanceEl.textContent = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(r.balance); alert('Emir iletildi'); })
    .catch(showError);
});

const bucketButtons = document.querySelectorAll('[data-bucket]');
bucketButtons.forEach((btn) => btn.addEventListener('click', () => {
  bucketButtons.forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentBucket = btn.dataset.bucket;
  loadQuotes();
}));

document.getElementById('refresh-news')?.addEventListener('click', loadNews);

if (localStorage.getItem('token')) {
  loadProfile();
  loadQuotes();
  loadNews();
}
