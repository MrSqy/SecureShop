# AWS mimari taslaklarının durumu

21 Eylül 2026: Bu repoda çalışan ve uçtan uca doğrulanmış bir AWS dağıtımı yoktur. Kabul edilen uygulama hedefi yerel demo ve yerel MySQL'dir. AWS hesabına erişilmedi, kaynak oluşturulmadı, gerçek WhatsApp mesajı gönderilmedi.

## Dosyalar gerçekte ne yapıyor?

- `aws/setup-aws.sh`: VPC, public/private subnet, güvenlik grupları, RDS, ALB, launch template, ASG ve CloudTrail için geçmiş taslak komutlar içerir.
- `aws/deploy-free-tier.sh`: tek EC2 + RDS yaklaşımının eski dosya adını korur. Adı ücretsiz kullanım garantisi değildir. HTTP yönlendirmesi ve eksik uygulama kurulumu içerir.
- `aws/userdata.sh`: EC2 açılışında Node, kullanıcı/dizin, SSM ayarları ve systemd hazırlamayı tasarlar. Kodun klonlanması hâlâ yorum satırıdır.
- `aws/schema.sql`: artık yerel MySQL 8.4 kurucusunun kullandığı tablo şemasıdır. Kendi başına veritabanı/kullanıcı oluşturmaz; seed verileri `src/models/seed.js` üzerinden yüklenir.

Üç shell dosyası **herhangi bir ağ veya kaynak işleminden önce `exit 1` ile durur**. Korumayı kaldırmak dağıtımı çalışır hâle getirmez. Altındaki komutlar yalnız inceleme için korunur. Satır devamı hataları düzeltildi; UserData base64 çıktısı GNU/Linux'ta satır sarmadan üretilir. Node referansları 24 oldu. Bu statik düzeltmeler canlı AWS kanıtı değildir.

## Açık mimari boşlukları

1. HTTPS sertifikası ve listener, doğrulanmış domain, TLS/DB CA güven zinciri, doğru proxy sınırı yok.
2. Kalıcı/paylaşılan oturum, OTP, kilit ve rate-limit deposu yok; iki EC2 örneğiyle oturum devamlılığı sağlanmaz.
3. Uygulama kodunu sürümlü dağıtma ve doğrulama tamamlanmamış; `npm start` artık `src/server.js` kullanır.
4. SSM sırlarının oluşturulması, erişim politikaları ve instance profile tamamlanmamış. Gizli değerler komut satırı/çıktılarda açığa çıkarılmamalı.
5. Private subnet dış erişimi, AZ/ASG kapsamı, CloudTrail bucket policy, WAF ve hata geri alma/söküm planları uçtan uca doğrulanmamış.
6. `ProtectSystem=strict` ile dosya log yazma izinleri ayrıca tasarlanmalı. Yeni yerel varsayılan konsol logudur; açık `LOG_DIR` yazılabilir dizin ister.
7. Yerel seed hesabı bilinen parolalıdır; üretim hesabı oluşturma yöntemi değildir. Demo kurucusu üretim modunda reddeder.
8. Graph API sürümü, WhatsApp şablon/onay/teslimat koşulları canlı servis üzerinden doğrulanmadı. Yerel development/test modu daima sahte gönderir.

## Maliyet ve sonraki çalışma

Dosyanın adı, instance türü veya eski ücretsiz katman açıklaması sıfır fatura garantisi sağlamaz. Hesap türü, bölge, krediler ve kullanım miktarı ayrıca değerlendirilmelidir. [AWS'nin resmi Free Tier açıklaması](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/) planların hesap tarihine göre değişebildiğini anlatır.

Canlı dağıtım istenirse önce hedef mimari, hesap/bölge, bütçe ve kaynak temizliği; sonra HTTPS, sır yönetimi, kalıcı durum, yedekleme, uygulama sürümü ve sağlık kontrolleri birlikte kararlaştırılmalıdır. Bu belgede o çalışma yapılmış sayılmaz.

Yerel shell doğrulaması `npm run check` içinde `bash -n`, taslakların erken durması ve gerçek `aws` yerine yalnız argüman yazan bir fonksiyonla RDS komut fragmanları üzerinden yapılır. Gerçek AWS CLI çağrısı yapılmaz.
