# SecureShop

Node.js 24 ve Express ile hazırlanmış, Türkçe arayüzlü yerel e-ticaret ve uygulama güvenliği demosu. Katalog, şifre + tek kullanımlık kodla giriş, bellek içi sepet ve stok kontrollü sipariş akışı içerir. **Ödeme almaz; ticari üretim sistemi değildir.**

- [Ayrıntılı Türkçe proje rehberi](PROJE_REHBERI.md): kurulumdan bütün dosya/fonksiyonların işleyişine.
- [Kabul edilen kapsam ve kararlar](UYGULAMA_PLANI.md).
- [Güncel doğrulama kaydı](docs/DOGRULAMA.md).
- [AWS taslaklarının durumu](aws_deployment_architecture.md).

## Hızlı demo

Node.js 24 ve npm gerekir. Repo kökünde:

```bash
npm ci --ignore-scripts
cp -n .env.example .env
npm start
```

[Mağazayı aç](http://127.0.0.1:3000). Örnek yönetici: `admin` / `Admin@123!`. `NODE_ENV=development` modunda doğrulama kodu yalnız sunucunun terminalinde görünür. Gerçek telefon mesajı gönderilmez. `.env.example` içindeki `DB_MOCK=true` açık demo seçeneğidir; sunucu yeniden başlayınca demo verileri silinir. Sepet her iki veri modunda da yalnız sayfa belleğindedir.

Mevcut `.env` varsa `cp -n` onu değiştirmez. Ayarlarını örnek dosyayla karşılaştır. `.env` içindeki gerçek sırları Git'e ekleme.

## Yerel gerçek MySQL

Docker ve Compose gerekir. Örnek parolalar yalnız bilgisayarındaki yerel demo içindir.

```bash
docker compose up -d --wait
```

`.env` dosyasında `DB_MOCK=false` yap; diğer DB değerleri örnekteki `127.0.0.1:3307`, `secureshop` ve yerel demo parolası olarak kalsın.

```bash
npm run db:init
npm start
```

`db:init` yalnız **boş, yerel veritabanını** hazırlar. İkinci çalıştırmada mevcut tabloları değiştirmeden reddeder. Eski sürümün veritabanına güncelleme uygulamaz. Yeni kurulumda katalog ve örnek yönetici oluşturulur; Compose volume'ünde veriler kalır. `docker compose stop` verileri silmeden DB'yi durdurur. Eski DB'ye geçiş ve veri koruma sınırları rehberde anlatılır.

## Kontroller

```bash
npm run check
npm test
npm run test:mysql
npm audit --audit-level=low
```

MySQL komutu benzersiz isimli, geçici konteyner açar; örnek verilerle çalışır ve sonunda sadece o konteyneri kaldırır. Mevcut Compose DB'sine dokunmaz. Gerçek MySQL sonuçları, mock testlerinden ayrı raporlanır. Tarayıcı kontrolleri ve doğrulanmamış ortamlar [doğrulama kaydındadır](docs/DOGRULAMA.md).

## Çalışma sınırları

Oturumlar, giriş kodları, kilitler ve istek limitleri tek Node sürecinin belleğindedir. Yeniden başlatma bunları sıfırlar. Üretim başlangıcı açık korumalar içerir; MemoryStore istisnası gerçek bir üretim mimarisi sağlamaz. Çok sunucu, gerçek ödeme, hesap kurtarma ve canlı WhatsApp teslimatı bu sürümün kapsamı dışındadır.

`aws/*.sh` dosyaları eksik mimari taslaklardır ve ilk adımda hata koduyla dururlar. Canlı kaynak oluşturulmadı; maliyet veya başarılı dağıtım garantisi verilmez. Ayrıntılar [AWS notundadır](aws_deployment_architecture.md).

## Lisans

Bu proje [MIT Lisansı](LICENSE) ile lisanslanmıştır.
Copyright (c) 2026 Baran Demir B.

Üçüncü taraf bağımlılıklar kendi lisanslarına tabidir.
