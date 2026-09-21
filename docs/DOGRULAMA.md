# SecureShop doğrulama kaydı

21 Eylül 2026. Node v24.14.1, npm11.11.0; Linux. Son uygulama kaynakları üzerinde yapılan kontroller aşağıdadır. Başlangıç commit'i `6df3c58430b2c216e3ecf5fdf6b3c9fb83fa0e6e`. İlk uygulama tesliminde commit/push yapılmamıştı; sonraki kullanıcı talimatıyla commit ve push kapsamı eklendi. Eski 56 testlik inceleme bulguları uygulama planında tarihli kayıt olarak korunur.

## Otomatik kontroller

- Önceki 56 test, bilinçli API değişiklikleriyle (OTP süre metadatası, yeniden gönderim beklemesi, sipariş UUID başlığı) korundu. Yeni davranışları doğrulayan ek testler eklendi.
- Temiz `npm ci --ignore-scripts --no-audit --no-fund` kurulumu geçti (435 paket). Son push öncesi `npm test -- --silent`: **9 test dosyasında100/100 geçti**,37,231 saniye. İlk uygulama teslimindeki92 testin üzerine8 istemci regresyonu eklendi. HTTP yaşam döngüsü, gerçek dosya logu, timeout, üretim çerezi ve rollback arızasında SQL bağlantısını atma dahil.
- `npm run check`: **60 proje dosyası** için JS/shell sözdizimi, yerel Markdown bağlantıları, rehber dosya envanteri, CSP inline yokluğu ve güvenli AWS fragmanları geçti. Kaynakların adlandırılmış fonksiyon/metotları ayrıca AST üzerinden rehber metniyle karşılaştırıldı; adı eksik kalan bulunmadı. Kod alıntısı kaynakla eşleştirildi.
- `git diff --check` geçti.
- Gerçek MySQL8.4: `npm run test:mysql`, **11/11 geçti**. Testler ayrı, benzersiz isimli Docker konteynerinde ve geçici DB depolamasında çalıştı; konteyner sonunda kaldırıldı. Mock adapter aynı altı veri sözleşmesini ayrıca çalıştırır.
- MySQL kapsamı: kullanıcı/telefon tekilliği; literal arama/ürün ekleme/sayfalama; DB kısıtları; rollback; newest-first ve özel alanların ayıklanması; dolu DB kurulumunun veri değiştirmeden reddi; aynı anahtarlı üç eşzamanlı HTTP isteğinde tek sipariş; iki kullanıcı/sonstok yarışında201+400; geç SQL hatasında geri alma ve aynı anahtarla yeniden başarı.
- Stok yarışı ilk gerçek MySQL çalışmasında201+500 verdi. Bulunmayan anahtar aralık kilitlerini azaltan READ COMMITTED işlem düzeyiyle düzeltildi;201+400 beklentisi korunarak geçti.
- Dependency güncellemesinden sonra uyumlu `npm audit fix --ignore-scripts` ile dolaylı paketler yenilendi; force kullanılmadı. Son `npm audit --json`: **0 bulgu** (kritik/yüksek/orta/düşük/info tümü0). `npm ci` sırasında Jest29 dolaylı ağacındaki inflight/glob deprecation uyarıları sürüyor; bunlar son audit'te açık advisory olarak raporlanmadı.

## Gerçek tarayıcı kontrolü

Yerel `127.0.0.1:3217`, development + DB_MOCK=true; bildirimler sahte. Kullanılan adres/telefon/sipariş verileri örnektir. Gerçek para, ürün sevkiyatı veya telefon mesajı yoktur.

- Şifre formunda Enter, terminaldeki geçici kodla doğrulama, oturum paneline geçiş çalıştı.
- `27"` araması doğru monitörü getirdi.
- Kapalı sepet erişilebilirlik ağacında görünmedi. Açılınca odak kapat düğmesindeydi; Escape sonrası `cartToggleBtn`'ye döndü.
- 35 stoklu ürün34 kez artırılarak35 adede ulaştı; artış düğmesi devre dışı kaldı.
- Apostrof/Türkçe/`<script>` benzeri örnek adresle Enter üzerinden sipariş#1 kaydedildi; tutar12.249,65USD, stok35→0; tükenen ürünün ekleme düğmesi kapandı.
- Sipariş detayında adres özgün metin olarak göründü; adres DOM'unda script elemanı sayısı0. Sipariş durumu Türkçe Alındı gösterildi.
- 390×844 mobil viewport'ta hesap/sipariş görünümü kontrol edildi; yatay taşma yok.320×740 dar görünümde de documentWidth308 <= viewport320 doğrulandı.
- Mobil kayıt formunda yanlış telefon alanı ayrı işaretlendi, Türkçe açıklama geldi ve odak o alana taşındı. Doğru örnek telefonla kayıt başarıyla tamamlandı, şifre girişine dönüldü.
- Çıkış başarılı yanıt sonrası hesap/sepet/sipariş detayı temizlendi.
- Tarayıcı console incelemesinde bu aşamada CSP veya JavaScript hatası görülmedi.

- Dar mobil320px görünümde yeni örnek müşteriyle giriş, boş kendi sipariş geçmişi, sepet/adres ve49,99USD sipariş#2 tamamlandı. Sepet DOM'unda taşan çocuk eleman yoktu. Ürün ekleyip sayfayı yenileme sonrasında sayaç1→0, oturum açık kaldı.
- Sunucu SIGTERM ile durdurulup Ara basıldığında “Sunucudan yanıt alınamadı” gösterildi; boş katalog başarı mesajına dönüşmedi. Aynı portta yeniden başlayan sunucuya Siparişlerim isteği eski oturum için401 verdi; kullanıcı/özel görünüm temizlenip yeniden giriş duyuruldu.

## Gerçek kurulum ve yanıt kaybı deneyi

README Compose yolu ayrıca benzersiz `secureshop-acceptance-a61e9` proje adı ve33197loopback portuyla çalıştırıldı. `docker compose ... up -d --wait` sağlıklı oldu, gerçek `npm run db:init` boş DB'yi kurdu. Uygulama DB_MOCK=false ile dinlemeye başladı; gerçek tarayıcıda admin/OTP giriş ve SQL destekli sipariş çalıştı. Bu kurulum normal kullanıcının mevcut Compose projesi veya volume'ü değildi.

Yerel geçici HTTP ara sunucusu3219,3217'deki uygulamaya iletti. İlk deneyde başarılı201 yanıtından sonra bağlantı kesildi; tarayıcıda aynı order#1 başarısı göründü, stok160→159. İkinci deneyde bir sonraki yeni sipariş MySQL'e commit edildikten sonra yanıt502 ile değiştirildi. Arayüz readonly adresler, kapalı adet/temizle düğmeleri ve “Aynı siparişi tekrar dene” gösterdi. Kullanıcı düğmesine basılınca aynı order#2 döndü. Son salt okunur SQL denetimi **orderIds=[2,1], orderCount=2, stock=158**: iki kasıtlı yeni alışveriş için iki sipariş; yeniden denemeler ek kayıt/stok düşüşü üretmedi. Bildirimler tüm deneylerde sahteydi.

Bu deney gerçek ağda rastgele paket kaybı iddiası değildir; commit sonrasındaki kayıp/hatalı yanıt kontrollü olarak enjekte edildi. Ara sunucu ve uygulama süreçleri kapatıldı; test projesinin konteyner/ağ/volume kaynakları yalnız kendi proje adıyla kaldırıldı. Önce durdurup yeniden başlatma sonrasıSQL kontrolü de **2 sipariş/158 stok** değerlerinin volume üzerinde korunduğunu doğruladı.

## Kanıt sınırları

Gerçek WhatsApp/Meta teslimatı, canlı AWS, tam erişilebilirlik taraması/ekran okuyucu cihazı, çok sunucu veya üretim dağıtımı **doğrulanmadı**. HTTP header/proxy testi gerçek TLS sunucusu kurulduğunu kanıtlamaz. Telefon ekranı yerine mobil viewport kullanıldı. MySQL için Docker imajı8.4 ve yukarıda açıklanan gerçek Compose/db:init yolu kullanıldı.

AWS shell doğrulaması yalnız sözdizimi, erken ret ve dış servis yerine argüman yazan taklitle sınırlıdır. Scriptler kendi başına canlı kaynak oluşturmaz; ilk adımda durur. Oturum/OTP/kilit/rate-limit bellekte, mock veri süreç ömrüyle sınırlıdır. Sayfa yenilenirse sepet ve istemcinin belirsiz sipariş anahtarı kaybolur; kayıtlı sipariş geçmişi kontrol edilmelidir.

İlk uygulama tesliminde bütün kabul kontrolleri tamamlandı. İnceleme ve uygulama test sunucuları, hata ara sunucusu ve tarayıcı sekmesi kapatıldı; geçici viewport ayarı sıfırlandı. Normal kullanıcı Compose projesi, mevcut verileri ve başka repolar değiştirilmedi.


## Push öncesi ek kontrol

Mevcut92 regresyon37,078 saniyede, gerçek MySQL11 testi2,264 saniyede yeniden geçti; audit yine0 bulgu verdi. Ardından istemci sipariş tekrarında yeni bir hata düzeltildi. Yerel commitler AWS taslakları; bütünleşik uygulama/rehber; ek tekrar düzeltmesi olarak ayrıldı. Uzak geçmiş yeniden yazılmadı.

`tests/frontend.test.js`, yayımlanan public/app.js kaynağını Node vm içinde küçük DOM/fetch taklitleriyle çalıştırır. Yanıt kaybını izleyen429/403/409/404/tanınmayan400; CSRF yenileme zinciri; kesin validasyon reddi; stok yenileme olmak üzere8 senaryo vardır. Eski kodda6 başarısız/2 başarılı, düzeltmede8 başarılı; son tam çalışmada100/100 geçti. Bu test gerçek tarayıcı motoru veya SQL testi diye sunulmaz.

Gerçek tarayıcı kabulü ayrıca development + DB_MOCK=true ile yapıldı.3219'daki yerel ara sunucu ilk başarılı siparişin yanıtını502 yaptı; ikinci denemeyi uygulamaya iletmeden429 döndürdü; üçüncüyü normal iletti. Üç POST aynı UUID'yi kullandı. İlk iki yanıtta adres/adet/Temizle kilitli kaldı, üçüncü yanıt HTTP200 ile **sipariş#1,49,99USD** döndürdü. Katalogda stok160→159, sipariş geçmişinde **tek kayıt** görüldü. Bu ek denemenin verisi süreç belleğindeydi; gerçek MySQL kanıtı yukarıdaki ayrı11 test ve önceki Compose deneyidir. Geçici sekme ve iki test süreci çalışma sonunda kapatıldı.

Uzak CI sonucu yerel test sonucundan ayrıdır. Bu kayıt push öncesi hazırlanmıştır; gönderilen commit'in sonucu [Security CI iş akışından](https://github.com/MrSqy/SecureShop/actions/workflows/security-ci.yml) kontrol edilir.


## İlk uzak CI ve action bakımı

[65a910a commit'inin Security CI çalışması](https://github.com/MrSqy/SecureShop/actions/runs/35639448629) gerçekten GitHub üzerinde başarılı oldu: unit işi 1 dakika 21 saniye, mysql işi 39 saniye. Temiz kurulum, check, npm test, audit ve ayrı MySQL komutları geçti. Bu sonuç artık yerel testten çıkarılmış bir varsayım değildir.

Bu çalışmada checkout@v4 ve setup-node@v4 için Node20 motoru uyarısı görüldü. Resmi yayın notları ve action.yml dosyaları kontrol edilerek checkout **v7.0.1**, setup-node **v7.0.0** seçildi; ikisi Node24 kullanır. Workflow'un push/pull_request olayları, Node24 uygulama sürümü, npm cache ve test komutları değişmedi. Bu son bakım commit'inin uzak sonucu ayrıca kontrol edilir. GitHub'ın ubuntu-latest için gelecekteki Ubuntu26 geçiş duyurusu ürün testi hatası değildir; runner değiştiğinde davranış yeniden değerlendirilmelidir.
