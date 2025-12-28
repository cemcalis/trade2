# Broker Platformu

TC kimlik ile kayıt, token tabanlı oturum, kimlik doğrulama, admin/broker onay akışları ve gerçek piyasa/haber API'leriyle entegre örnek platform.

## Özellikler
- TC kimlik + parola ile kayıt ve giriş, JWT tabanlı koruma.
- Kimlik fotoğrafı (ön/arka) yükleyip admin onayıyla doğrulama.
- 5 market kovası (kripto, BIST, forex, emtia, yabancı hisse) için 200 sembol listesi ve gerçek fiyat API çağrıları (Twelve Data).
- Doğrulanmış kullanıcılar için al-sat emirleri ve cüzdana yansıyan bakiyeler.
- Bakiye yatırma/çekme talepleri, admin onayında kısmi/ tam tutar güncelleme.
- Admin panel API'leriyle market akışını durdurma/fiyat override, kullanıcı/broker yönetimi ve bakiye düzenleme.
- Broker'ların alt kullanıcılarına toplu emir gönderip admin onayı beklemesi için batch sipariş kaydı.
- Güncel ekonomi haberleri (NewsAPI) ve statik ön yüz animasyonları.

## Kurulum
```bash
npm install
JWT_SECRET=super-secret MARKET_API_KEY=YOUR_TWELVEDATA_KEY NEWS_API_KEY=YOUR_NEWSAPI_KEY npm run dev
```

- Sunucu 3000 portunda çalışır, `public/` içeriği statik olarak servis edilir.
- İlk çalıştırmada `trading.db` SQLite dosyası oluşturulur ve `admin@broker.local / Admin123!` ile bir admin hesabı açılır.
- Kimlik yüklemeleri `uploads/` klasörüne kaydedilir (git'e dahil edilmez).

## API Özetleri
- `POST /api/auth/register` — tc_no, first_name, last_name, email, password
- `POST /api/auth/login` — tc_no, password → JWT
- `GET /api/profile` — JWT ile kullanıcı bilgisi
- `POST /api/users/:id/documents` — kimlik fotoğrafları (ön/back)
- `POST /api/admin/users/:id/verify` — admin onayı
- `GET /api/markets/:bucket` — canlı fiyat listesi (admin kontrolüne tabi)
- `POST /api/trades/order` — doğrulanmış kullanıcılar için işlem
- `POST /api/deposits/request`, `POST /api/withdrawals/request` — bakiye hareket talebi
- `POST /api/admin/cash/:id/approve` — admin kısmi/tam onay
- `POST /api/admin/users/:userId/balance` — manuel bakiye düzenleme
- `POST /api/admin/markets/control` — market akışı aç/kapat veya fiyat override
- `POST /api/broker/batch-order` — broker toplu emir kaydı
- `POST /api/admin/broker-orders/:id/approve` — admin onayı
- `GET /api/news` — günlük ekonomi haberleri

## Ön yüz
`public/index.html` minimal ama animasyonlu bir arayüz sağlar. Formlar doğrudan API'ye istek atar ve token saklar. Market sekmeleri, portföy ve haber kartları güncel veriyi gösterir.
