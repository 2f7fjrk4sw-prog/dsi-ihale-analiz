# DSİ İhale Strateji ve Rakip Davranış Öngörü Sistemi (DSİ-İhaleZekası)

> **AI & Geliştirici Bağlam Dosyası (`PROJECT.md`)**  
> Bu belge, projenin mimarisini, KİK/DSİ mevzuat matematiğini, veri doğrulama kurallarını ve algoritma tasarımını standartlaştırmak amacıyla oluşturulmuştur. Bundan sonraki tüm geliştirme adımlarında bu dosya temel referans (Single Source of Truth) olarak kullanılacaktır.

---

## 1. Proje Vizyonu ve Amacı
Bir **DSİ (Devlet Su İşleri) müteahhitlik firmasının** İhale Hazırlık ve Teklif Birimi için geliştirilen; rakiplerin geçmiş KİK (Kamu İhale Kurumu / EKAP) yapım işi ihalelerindeki teklif davranışlarını ve kamuya açık operasyonel hareketlerini (aktif şantiye yükü, bölgesel hakimiyet, iş deneyimi grubu, ortak girişim geçmişi vb.) analiz ederek **güncel bir ihalede rakiplerin katılıp katılmayacağını, hangi kırım (tenkisat) aralığında teklif vereceğini ve Sınır Değerin (SD) nerede oluşacağını öngören** kurulabilir masaüstü karar destek yazılımıdır.

---

## 2. Kırmızı Çizgiler ve Temel İlkeler

1. **%100 Doğrulanmış Veri İlkesi (Verified Data Only / Zero-Hallucination):**
   - Sistemde hiçbir uydurma, tahmini veya kaynağı belirsiz ham veri barındırılamaz.
   - Her ihale ve teklif kaydı zorunlu olarak **İKN (İhale Kayıt Numarası - örn. `2025/145892`)**, **Veri Kaynağı Tipi** (`EKAP_SONUC_ILANI`, `IHALE_TUTANAGI`, `TICARET_SICIL`, `RESMI_BELGE`) ve **Doğrulama Durumu** (`DOGRULANDI`, `INCELEME_BEKLIYOR`, `REDDEDILDI`) alanlarına sahiptir.
   - **Algoritma Güvenlik Kilidi:** `DOGRULANDI` statüsünde olmayan hiçbir veri, istatistiksel hesaplamalara, Sınır Değer simülasyonuna veya rakip tahmin algoritmasına **kesinlikle dahil edilmez**.
   - **Matematiksel Tutarlılık Denetimi:** Veri girişinde veya dosya aktarımında Yaklaşık Maliyet ($YM$), Teklif Bedeli ($T_i$), Kırım Oranı (%) ve Sınır Değer ($SD$) KİK mevzuat formülüyle otomatik sağlamaya tabi tutulur; kuruş/oran uyuşmazlığı varsa sistem uyarı verir.

2. **Kullanıcı Dostu Yönetici Arayüzü (Executive UX):**
   - Karmaşık istatistiksel ve olasılıksal modelleri (Monte Carlo, Bayesyen güncelleme, standart sapma filtreleri), bir inşaat mühendisi veya şirket yöneticisinin tek bakışta anlayabileceği sade, görsel ve aksiyona dönüştürülebilir grafiklerle sunar.

3. **Kurulabilir ve Çevrimdışı Çalışabilen Masaüstü Programı (Installable Desktop App):**
   - Windows bilgisayarlara `.exe` kurulum sihirbazı (Setup) ile kurulabilen bağımsız masaüstü uygulamasıdır.
   - Tüm veriler müteahhidin kendi bilgisayarında yerel, şifrelenebilir ve yedeklenebilir **SQLite** veritabanında tutulur (ticari sır niteliğindeki teklif stratejileri dış sunuculara gönderilmez).

---

## 3. Teknik Mimari ve Dosya Haritası (Tech Stack & File Map)

- **Masaüstü Çatısı (Desktop Shell):** .NET 10 Native Windows Desktop (`WinExe` / `net10.0-windows`) — yerel gömülü HTTP/API sunucusu (`HttpListener` + `SHA-256` bütünlük mühürleyici) ve adanmış Edge App Masaüstü Pencere Yöneticisi (`DSIIhaleZekasi.exe`).
- **Kurulum Sihirbazı (Setup Installer):** Tek dosyalı (Single-File) Windows Kurulum Sihirbazı (`DSIIhaleZekasi_Kurulum_Setup.exe`) — gömülü `payload.zip` arşiviyle `%LOCALAPPDATA%\Programs\DSI_Ihale_Zekasi` dizinine kurulum yapar, Masaüstü ve Başlat Menüsü kısayollarını (`DSİ İhale Zekası.lnk`) otomatik oluşturur.
- **Önyüz (Frontend UI):** Modern HTML5 / CSS3 / Vanilla ES2024 JavaScript + Yüksek Çözünürlüklü HTML5 Canvas Strateji Eğrisi Grafiği (`src/ui/index.html`, `src/ui/styles.css`, `src/ui/app.js`).
- **Analitik ve Algoritma Motoru:** `src/ui/kik-engine.js` — Kamu İhale Genel Tebliği Madde 45.1.1 deterministik Sınır Değer motoru (`KikBoundaryEngine`), 3 katmanlı Rakip Davranış Öngörü motoru (`CompetitorPredictionEngine`), 10.000 iterasyonlu Monte Carlo Simülatörü (`MonteCarloTenderSimulator`) ve Akıllı EKAP Metin Ayrıştırıcı (`EkapSmartParser`).
- **Yerel Doğrulanmış Veritabanı:** `data/verified_db.json` ve `data/verified_db.json.sha256` — %100 KİK 45.1.1 matematik doğrulamalı yerel JSON veritabanı + Excel/CSV/JSON yedekleme ve içe/dışa aktarım modülü.

### Dizin Yapısı
```text
dsi-ihale-analiz/
├── PROJECT.md                              # AI & Geliştirici Mimari ve Matematik Referans Belgesi
├── DSIIhaleZekasi_Kurulum_Setup.exe        # Tek Tıkla Kurulabilir Windows Setup Sihirbazı
├── data/
│   ├── verified_db.json                    # KİK 45.1.1 Doğrulamalı Resmi İhale ve Rakip Veritabanı (v2.4.0)
│   └── verified_db.json.sha256             # SHA-256 Veri Bütünlük Mührü
├── src/
│   ├── ui/
│   │   ├── index.html                      # 8 Sekmeli Yönetici Karar Destek Arayüzü
│   │   ├── styles.css                      # Koyu Tema Mühendislik Stilleri ve Rapor Yazdırma Tasarımı
│   │   ├── kik-engine.js                   # KİK Md. 45.1.1 Motoru, Bölge/Şube Analizi ve 10.000 Monte Carlo Çekirdeği
│   │   └── app.js                          # Arayüz Kontrolcüsü, DSİ Kaynaklı Rakipler Sekmesi ve 3-Kanallı Veri Merkezi
│   ├── DesktopApp/
│   │   ├── DSIIhaleZekasi.csproj           # .NET 10 Masaüstü Uygulama Projesi
│   │   ├── Program.cs                      # Yerel Sunucu, Lock Korumalı API ve Masaüstü Pencere Yöneticisi
│   │   └── OfficialDataSyncService.cs      # Periyodik KİK/EKAP, 26 DSİ Bölge Sitesi ve İnternet Yüklenici Arama Servisi
│   └── Installer/
│       ├── DSIIhaleZekasi_Setup.csproj     # .NET 10 Kurulum Sihirbazı Projesi
│       └── SetupProgram.cs                 # Windows Kurulum Sihirbazı ve Kısayol Oluşturucu
└── dist/
    ├── app/                                # Derlenmiş Masaüstü Uygulaması (DSIIhaleZekasi.exe)
    └── installer/                          # Derlenmiş Setup Sihirbazı
```

---

## 4. KİK / DSİ Alan Matematiği ve Algoritma Tasarımı

### 4.1. KİK Yapım İşleri Sınır Değer ($SD$) Hesaplama Formülü (Mevzuat Birebir Uyumu)
Yaklaşık Maliyeti $YM$ olan bir DSİ yapım işi ihalesinde sunulan teklifler $T_1, T_2, \dots, T_m$ olsun:

1. **Birinci Eleme (Uç Tekliflerin Ayıklanması):**
   $$0.40 \times YM \le T_i \le 1.20 \times YM$$
   aralığı dışındaki teklifler hesaplama dışı bırakılır. Kalan $n$ adet geçerli teklifin aritmetik ortalaması ($T_{\text{ort},1}$) ve standart sapması ($\sigma$) bulunur:
   $$\sigma = \sqrt{\frac{1}{n-1} \sum_{i=1}^{n} (T_i - T_{\text{ort},1})^2}$$

2. **İkinci Eleme (Standart Sapma Aralığı):**
   $$T_{\text{ort},1} - \sigma \le T_i \le T_{\text{ort},1} + \sigma$$
   aralığında kalan tekliflerin aritmetik ortalaması ($T_{\text{ort},2}$) hesaplanır.

3. **Oran Katsayısı ($C$) ve $K$ Katsayısı:**
   $$C = \frac{T_{\text{ort},2}}{YM}$$
   - $C < 0.60 \implies K = C$
   - $0.60 \le C \le 1.00 \implies K = \frac{3.2 C - C^2 - 0.6}{C + 1}$
   - $C > 1.00 \implies K = \frac{C^2 - 0.8 C + 1.4}{C + 1}$

4. **Sınır Değer ($SD$) — Kamu İhale Genel Tebliği Madde 45.1.1 Resmi Formülü:**
   $$SD = \frac{K \times T_{\text{ort},2}}{C \times N}$$
   *(Burada **$N$ (Sınır Değer Katsayısı)**; Tebliğ Md. 45.1.1.1 uyarınca DSİ Altyapı Yapım İşlerinde [A Grubu: Baraj, Gölet, Sulama, Taşkın, İsale, Tünel] **$N = 1.20$**, Üstyapı/Mekanik/Elektrik işlerinde **$N = 1.00$** veya Bakanlıkça belirlenen özel katsayıdır).*

---

### 4.2. Rakip Davranış Öngörü Algoritması (3 Katmanlı Model)

#### Katman 1: İhaleye Katılım Olasılığı Skoru — $P(\text{Katılım}_j)$
Her rakip firma ($j$) için hedef ihaleye katılma olasılığı aşağıdaki doğrulanmış metriklerin ağırlıklı lojistik fonksiyonu ile hesaplanır:
- **Bölgesel Hakimiyet ($B_j$):** Rakibin ilgili DSİ Bölge Müdürlüğü'nde (örn. DSİ 5. Bölge, DSİ 21. Bölge) son 3 yıldaki katılım oranı ve bölgede aktif şantiyesinin bulunması (Mobilizasyon avantajı).
- **İş Grubu ve Benzer İş Deneyimi Uyumu ($U_j$):** İhalenin istediği benzer iş grubu (A/I Baraj-Gölet, A/II Tünel, A/III Sulama-Taşkın, A/IV İsale Hattı, A/V HES) ile rakibin doğrulanmış iş deneyim belgesi ve geçmiş portföyünün eşleşmesi.
- **Kapasite Doygunluğu / Aktif Şantiye Yükü ($D_j$):** Rakibin kamuya açık verilerden (EKAP sözleşme ilanları) bilinen devam eden iş sayısı ve tahmini fiziki tamamlanma oranı:
  - *Biten şantiyesi olan rakip* $\rightarrow$ Makine parkını ve teknik personelini boşta bırakmamak için **katılım olasılığı yüksek, kırım davranışı agresif**.
  - *Yakın zamanda 2+ büyük ihale kazanmış rakip* $\rightarrow$ Teminat ve ekipman limiti doluluğu nedeniyle **katılım olasılığı düşük, teklifi muhafazakâr**.
- **Ortak Girişim (İş Ortaklığı) Eğilimi ($O_j$):** Rakibin tek başına yeterliliği yetmediği büyük ölçekli ihalelerde birlikte hareket ettiği partner firmalar.

#### Katman 2: Rakip Kırım Oranı (Tenkisat %) Tahmini — $\hat{k}_j$
Rakibin geçmişte katıldığı doğrulanmış ihalelerdeki teklif oranı $r_{j,t} = \frac{T_{j,t}}{YM_t}$ ve o ihaledeki Sınır Değer oranı $s_t = \frac{SD_t}{YM_t}$ üzerinden:
- **Zaman Ağırlıklı Ortalamalar (Time-Decay Weighting):**
  $$w_t = e^{-\lambda \cdot \Delta t_{\text{ay}}}$$
  Yakın tarihli ihaleler, eski ihalelere göre üstel olarak daha yüksek ağırlığa sahiptir.
- **Rakip Karakteristik Sınıflandırması:**
  1. *Sınır Değer Avcısı:* Tekliflerini sürekli beklenen $SD$'nin %0.5 ile %2.0 üzerinde konumlandıran disiplinli rakipler.
  2. *Agresif / Kırım Odaklı:* Şantiye açlığı veya bölge savunması nedeniyle $SD$ civarı veya altında riskli teklif verenler.
  3. *Muhafazakâr / Yüksek Teklifçi:* Sadece yüksek kâr marjıyla iş arayan, ortalama düşürmekten kaçınan rakipler.

#### Katman 3: Monte Carlo İhale Simülasyonu (10.000 İterasyon)
1. Potansiyel rakiplerin katılım olasılıklarına göre binlerce olası "İhale Katılımcı Listesi" simüle edilir.
2. Her katılımcının kendi tarihsel ortalama ve standart sapmasından (ve güncel kapasite düzeltmesinden) teklif üretilir.
3. Her iterasyonda KİK formülüyle **Sınır Değer ($SD$)** hesaplanır.
4. Sonuç olarak kullanıcıya:
   - **Beklenen Sınır Değer Aralığı** (%90 ve %70 güven bandı ile),
   - **Her Rakibin Tahmini Teklif Bandı**,
   - **Optimal Teklif Önerisi** (Sınır değerin altında kalıp elenme riskini minimize ederken 1. olma ihtimalini maksimize eden "Altın Teklif Noktası") sunulur.

---

## 5. Veritabanı Şeması (Özet)

1. `competitors` (Rakip Firmalar: Vergi No/Mersis, Ünvan, Merkez İl, İş Deneyim Grupları, Güncel Şantiye Yükü, Doğrulama Kaynağı)
2. `tenders` (İhaleler: İKN, İhale Adı, DSİ Bölge Müdürlüğü, İş Grubu [A/I..A/V], İhale Tarihi, Yaklaşık Maliyet $YM$, Sınır Değer Katsayısı $R$, Hesaplanan/Resmi $SD$, Doğrulama Durumu, Belge/Tutanak Referansı)
3. `tender_bids` (İhale Teklifleri: İhale ID, Rakip ID, Ortak Girişim mi?, Teklif Bedeli $T_i$, Kırım Oranı %, Durum [Geçerli, Sınır Değer Altı, Elendi, Kazandı], Doğrulama Kaynağı)
4. `competitor_signals` (Kamuya Açık Hareketler: Rakip ID, Tarih, Sinyal Tipi [Yeni İhale Kazandı, Şantiye Bitti, Sermaye Artışı, Bölgede Şantiye Kurulumu], Etki Katsayısı, Resmi Kaynak/Link)
5. `audit_logs` (Veri Doğrulama ve Değişiklik Kayıtları: Veri bütünlüğü izlenebilirliği)

---

## 6. Uygulama Ekranları (Modüller)

1. **Gösterge Paneli (İhale Kokpiti):** Aktif takip edilen DSİ ihaleleri, doğrulanmış veri istatistikleri, hızlı simülasyon özeti.
2. **Doğrulanmış İhale & Teklif Kütüphanesi:** İKN bazlı geçmiş DSİ ihaleleri, tutanak girişi, Excel/CSV içe aktarma ve otomatik KİK matematik doğrulama denetçisi.
3. **Rakip İstihbarat Merkezi (Competitor X-Ray):** Rakiplerin geçmiş kırım grafikleri, bölge haritası, aktif şantiye doluluk takibi ve kamuya açık hareket sinyalleri.
4. **İhale Simülatörü & Teklif Strateji Motoru:** Yeni girilecek bir DSİ ihalesi için $YM$ tahmini, muhtemel rakiplerin seçimi, 10.000 Monte Carlo simülasyonu, Sınır Değer çan eğrisi ve Optimal Teklif Hesaplayıcı.
5. **Strateji Raporu Üretici:** Yönetime sunulacak tek sayfalık PDF/Excel İhale Strateji Özeti.

---

## 7. Onaylanmış Mimari Kararlar (Kullanıcı Kararları - 14.11.2026)

1. **Veri Besleme ve EKAP Entegrasyonu (Karar 1):**
   - EKAP'ın CAPTCHA ve e-Devlet güvenlik duvarları nedeniyle doğrudan bot ile kazıma yapılmaz; bunun yerine **3 Kanallı Doğrulanmış Veri Giriş Sistemi** uygulanır:
     1. **Akıllı EKAP Sonuç İlanı / Tutanak Ayrıştırıcı (Smart Parser):** Kullanıcının EKAP'tan kopyaladığı resmi Sonuç İlanı metnini veya İhale Komisyon Tutanağı tablosunu otomatik ayrıştırıp İKN, Yaklaşık Maliyet, Sınır Değer ve Rakip Tekliflerini çıkaran, ardından KİK formülüyle matematiksel sağlamasını yapan modül.
     2. **Toplu Excel / CSV Tutanak İçe Aktarma:** Geçmiş ihale arşivlerinin toplu yüklenmesi ve otomatik doğrulama denetimi.
     3. **İKN Doğrulamalı Manuel Resmi Tutanak Girişi:** Adım adım KİK matematik sağlamalı veri giriş formu.
2. **İhale Değerlendirme Modu (Karar 2):**
   - **Çoklu Mod Desteği:** Varsayılan olarak DSİ'de en yaygın uygulanan **"Sınır Değerin Altında Kalan Tekliflerin Otomatik Reddi (4734 Md. 38)"** seçilidir. Kullanıcı ihale şartnamesine göre **"Aşırı Düşük Teklif Açıklaması (ADTA) İstenen Mod"** veya **"Fiyat Dışı Unsur (FDU) Puanlamalı Mod"** arasında geçiş yapabilir.
3. **Yaklaşık Maliyet ($YM$) Belirsizlik Simülasyonu (Karar 3):**
   - **Esnek $YM$ Bandı:** Müteahhidin kendi keşif/metraj çalışmasıyla hesapladığı nokta $YM$ tahmini baz alınır; buna ek olarak İdarenin (DSİ) yaklaşık maliyetinin $\pm \%X$ (örn. $\%-5$ ile $\%+5$ arası) sapma olasılığı Monte Carlo simülasyonuna dahil edilerek **"Riskten Arındırılmış Güvenli Teklif Bandı"** hesaplanır.

---

## 8. Geliştirme Fazları (Roadmap)

- [x] **Faz 0:** Proje mimarisinin kurgulanması ve `PROJECT.md` oluşturulması.
- [x] **Faz 1:** Kullanıcı ile kritik kararların (veri giriş yöntemi, öncelikli DSİ iş grupları, $YM$ belirsizlik modeli) netleştirilmesi.
- [x] **Faz 2:** Masaüstü Uygulama Çekirdeği (.NET 10 Yerel Sunucu & Masaüstü Pencere Yöneticisi) + Yerel Veritabanı Katmanının kurulması.
- [x] **Faz 3:** KİK 4734 Sınır Değer Motoru, Veri Doğrulama Denetçisi, Akıllı EKAP Metin/Tablo Ayrıştırıcı ve 10.000 İterasyonlu Monte Carlo Tahmin Algoritmasının kodlanması.
- [x] **Faz 4:** Kullanıcı dostu arayüz modüllerinin (İhale Kokpiti, Doğrulanmış Veri Kütüphanesi, Rakip X-Ray, İhale Simülatörü, Strateji Raporu) tamamlanması.
- [x] **Faz 5:** Windows Kurulum Sihirbazı (`DSIIhaleZekasi_Kurulum_Setup.exe`) üretimi, masaüstü kısayolu entegrasyonu ve doğrulama testleri.

---

## 9. Hızlı Derleme ve Güncelleme Komutları (AI / Geliştirici İçin)

Arayüz (`src/ui/`) veya masaüstü çekirdeğinde (`src/DesktopApp/`) bir değişiklik yapıldığında tek dosya kurulum sihirbazını yeniden üretmek için:

```powershell
dotnet publish "src/DesktopApp/DSIIhaleZekasi.csproj" -c Release -r win-x64 -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true --self-contained false -o "dist/app"
Copy-Item -Path "src/ui" -Destination "dist/app/ui" -Recurse -Force
Copy-Item -Path "data" -Destination "dist/app/data" -Recurse -Force
Compress-Archive -Path "dist/app/*" -DestinationPath "src/Installer/payload.zip" -Force
dotnet publish "src/Installer/DSIIhaleZekasi_Setup.csproj" -c Release -r win-x64 -p:PublishSingleFile=true --self-contained false -o "dist/installer"
Copy-Item "dist/installer/DSIIhaleZekasi_Kurulum_Setup.exe" "DSIIhaleZekasi_Kurulum_Setup.exe" -Force
```

---

## 10. %100 Resmi Kamu Veri Kaynağı Zorunluluğu (`officialSourcesOnly: true` - v2.1.0 — 20 Resmi Müteahhit & 18 Resmi DSİ İhalesi)

- Sistemde hiçbir kurgusal/örnek firma veya kurgusal ihale verisi yer almaz.
- Yalnızca aşağıdaki **5 Resmi Kamu Kurumu Kaynağı** (`OFFICIAL_SOURCE_TYPES`) kabul edilir:
  1. `KIK_KARAR`: **Kamu İhale Kurulu (KİK) Resmi Uyuşmazlık Kararı (`kik.gov.tr`)**
  2. `EKAP_SONUC`: **EKAP Resmi İhale Sonuç İlanı (`ekap.kik.gov.tr`)**
  3. `EKAP_TUTANAK`: **EKAP İhale Komisyon Kararı / Zarf Açma Tutanağı (`ekap.kik.gov.tr`)**
  4. `DSI_DUYURU`: **DSİ Genel Müdürlüğü / Bölge Müdürlüğü Resmi İhale Duyurusu (`dsi.gov.tr`)**
  5. `TTSG_SICIL`: **Türkiye Ticaret Sicili Gazetesi / Resmi İlan Portalı (`ticaretsicil.gov.tr` / `ilan.gov.tr`)**
- Veritabanında (`data/verified_db.json`) **13 aktif DSİ Bölge Müdürlüğüne** yayılmış **20 gerçek yüklenici firma / iş ortaklığı** (`COMP-01` .. `COMP-20`) ve **18 gerçek DSİ yapım ihalesi** (`kik.gov.tr` Kurul Kararları ve `ekap.kik.gov.tr` Sonuç İlanları) yer almaktadır:
  1. **İKN `2025/1888777`** (*KİK Karar No: `2026/UY.II-1764`*): DSİ 11. Bölge — *Tekirdağ İnecik 1-2 ve Dedecik Barajları İçmesuyu İsale Hattı* (`YM: 1.505.809.084,70 TL`, `Sözleşme: 1.059.000.000,00 TL` — Özbek İnşaat & Muzaffer Kaygın İş Ortaklığı)
  2. **İKN `2025/2110590`** (*KİK Karar No: `2026/UY.II-643`*): DSİ 1. Bölge — *Kocaeli Kandıra Arıklar Göleti Sulaması 2. Kısım* (`YM: 325.538.431,00 TL`, `Sözleşme: 240.016.331,00 TL` — AK-TA Yapı & NİL-TA Petrol İş Ortaklığı; Salma İnşaat & Feridun Baltacı İş Ortaklığı)
  3. **İKN `2025/1053977`**: DSİ 6. Bölge — *Mersin Tarsus Karaevli Göleti Sulaması İkmali* (`YM: 215.658.151,27 TL`, `Sözleşme: 168.847.000,00 TL` — Mardest İnşaat A.Ş. & İhsan Güven İş Ortaklığı)
  4. **İKN `2025/1163497`**: DSİ 6. Bölge — *Osmaniye İli Karaçay Deresi Islahı 6. Kısım* (`YM: 499.996.289,13 TL`, `Sözleşme: 324.710.000,00 TL` — Bulak Yapı & Grup Lider İnşaat İş Ortaklığı)
  5. **İKN `2025/635261`** (*KİK Karar No: `2025/UY.I-2762`*): DSİ 12. Bölge — *Nevşehir Bayramhacılı Pompaj Sulaması Yenileme* (`YM: 945.038.470,00 TL`, `Sözleşme: 797.000.000,00 TL` — Özbek İnşaat & Muzaffer Kaygın İş Ortaklığı; HLS İnşaat Taahhüt A.Ş.)
  6. **İKN `2025/489470`**: DSİ 9. Bölge — *Tunceli-Pertek Kacarlar Göleti Sulaması 2. Kısım* (`YM: 211.126.958,15 TL`, `Sözleşme: 158.990.354,00 TL` — Adnan Ekmen İnşaat & GRŞ İnşaat İş Ortaklığı)
  7. **İKN `2024/1484027`** (*KİK Karar No: `2025/UY.I-1439`*): DSİ 20. Bölge — *Kilis Musabeyli Barajı İkmali İnşaatı* (`YM: 1.549.891.000,00 TL`, `Sözleşme: 976.123.000,00 TL` — Harbiye İnşaat Madencilik A.Ş.)
  8. **İKN `2024/1377593`** (*KİK Karar No: `2025/UY.II-877` ve `2025/UY.II-878`*): DSİ 4. Bölge — *Aksaray Uluırmak (Mamasın) Barajı Sulaması Ana İletim Hattı Sanat Yapıları 2. Kısım* (`YM: 1.194.027.603,00 TL`, `Sözleşme: 861.861.861,99 TL` — K2 Grup İnşaat & Everest Madencilik İş Ortaklığı; Uras Endüstri & Rahmi Özkan Tümer; Özbek İnşaat)
  9. **İKN `2024/1152749`**: DSİ 5. Bölge — *Çankırı Kızlaryolu Barajı Yeniden Yerleşim Yeri Yapım İşi* (`YM: 1.299.571.040,96 TL`, `Sözleşme: 954.541.049,13 TL` — İlici İnşaat A.Ş. & BTS Taahhüt İnşaat A.Ş. İş Ortaklığı)
  10. **İKN `2023/1580956`** (*KİK Karar No: `2024/UY.I-799`*): DSİ 20. Bölge — *Kahramanmaraş Onikişubat Kurucaova ve Tekir Mah. Taşkın Koruma* (`YM: 553.488.040,00 TL`, `Resmi SD: 428.163.434,00 TL` — Mete Altyapı & Güven Karaman İş Ortaklığı: `445.105.000,00 TL`; Ilgazlar İnşaat & SMH Grup: `427.027.027,00 TL`)
  11. **İKN `2023/1521358`**: DSİ 21. Bölge — *Aydın 211. Şube Müdürlüğü İdare Binası ve Tesisleri İnşaatı* (`YM: 149.987.147,00 TL`, `Sözleşme: 146.975.000,00 TL` — Pınar Telekomünikasyon İnşaat & Veysel Bilgen İş Ortaklığı)
  12. **İKN `2023/1471844`** (*KİK Karar No: `2024/UY.II-567`*): DSİ 7. Bölge — *Samsun 19 Mayıs İlçesi Engiz Çayı 2. Kısım Taşkın Koruma* (`YM: 164.927.094,00 TL`, `Resmi SD: 126.677.351,00 TL` — Öntürkler İnşaat Ltd. Şti.: `119.884.150,00 TL`)
  13. **İKN `2023/1241906`** (*KİK Karar No: `2024/UY.II-553`*): DSİ 11. Bölge — *Kırklareli-Kofçaz Kula 2 Göleti ve İletim Hattı İnşaatı* (`YM: 571.315.757,00 TL`, `Resmi SD: 407.516.472,00 TL` — Ilgazlar İnşaat & SMH Grup: `394.693.577,00 TL`; Erkilet İnşaat & Baran Yapı: `414.319.878,75 TL`)
  14. **İKN `2023/1273876`** (*KİK Karar No: `2024/UY.II-503`*): DSİ 25. Bölge — *Güney Marmara AT ve TİGH Projesi* (`YM: 665.721.432,16 TL`, `Sözleşme: 438.557.713,24 TL` — Sistem Elektromekanik & Körfez Haritacılık İş Ortaklığı)
  15. **İKN `2023/1099327`**: DSİ 1. Bölge — *Yalova İli Merkez Balaban Deresi Islahı 2. Kısım* (`YM: 199.939.920,44 TL`, `Resmi SD: 154.098.322,60 TL`, `Sözleşme: 156.999.905,00 TL` — Mete Altyapı İnşaat A.Ş.)
  16. **İKN `2023/716691`**: DSİ 12. Bölge — *Nevşehir-Avanos Sarıhıdır Pompaj Sulaması Yenileme* (`YM: 249.490.385,00 TL`, `Resmi SD: 205.625.455,00 TL` — Mete Altyapı İnşaat A.Ş.)
  17. **İKN `2023/620107`**: DSİ 8. Bölge — *Erzurum-Pasinler Küçüktüy Göleti İnşaatı* (`YM: 245.677.954,00 TL`, `Resmi SD: 178.555.729,00 TL` — Erkilet İnşaat & Eskikale İnşaat: `188.497.245,00 TL`; Yapıyol Altyapı & Solakoğlu: `195.871.633,00 TL`)
  18. **İKN `2023/404580`** (*KİK Karar No: `2023/UY.II-1278`*): DSİ Genel Müdürlüğü Barajlar ve HES Dairesi — *Balıkesir Kepsut Barajı Yapımı* (`YM: 1.386.328.596,00 TL`, `Resmi SD: 904.504.302,00 TL` — Burka Yapı & AB İş Makinaları: `829.712.548,00 TL`; BRJ İnşaat A.Ş.: `867.330.392,00 TL`)

---

## 11. Periyodik Resmi Veri Toplama ve Otomatik Senkronizasyon Sistemi (`OfficialDataSyncService` — Faz 6 Tamamlandı)

### 11.1. Mimari ve Çalışma Prensibi
`src/DesktopApp/OfficialDataSyncService.cs` içerisinde geliştirilen arka plan servisi, uygulama çalıştığı sürece (`System.Threading.Timer` ile varsayılan her 30 dakikada bir + uygulama açılışında + kullanıcı **"Resmi Kaynakları Şimdi Tara"** butonuna bastığında) aşağıdaki **4 Resmi Kamu Veri Kanalını** HTTPS üzerinden tarar:

1. **Kanal 1 — EKAP Vatandaş Kurul Kararları (`https://ekap.kik.gov.tr/EKAP/Vatandas/KurulKararGoster.aspx?KararId=...`):**
   - Doğrudan KİK Kurul Kararı HTML sayfasını indirir; `İHALEYİ YAPAN İDARE` alanında **Devlet Su İşleri (DSİ)** geçen kararları filtreler.
   - `Karar No`, `Karar Tarihi`, `İhale Kayıt Numarası (İKN)`, `İhale Adı`, `DSİ Bölge Müdürlüğü`, `İhale Tarihi`, `Yaklaşık Maliyet`, `Sınır Değer`, `İhale Üzerinde Bırakılan İstekli`, `Başvuru Sahibi` ve metin içindeki tüm `TL` teklif tutarlarını otomatik ayrıştırır.
2. **Kanal 2 — EKAP "Bir Bakışta İhale" Resmi Sonuç Sayfaları (`https://ekap.kik.gov.tr/EKAP/Ortak/BirBakistaIhale.aspx?IdareId=...&IhaleId=...`):**
   - Sonuç ilanı yayımlanmış DSİ ihalelerinin `İKN`, `İhale Adı`, `DSİ Bölge Müdürlüğü`, `Yaklaşık Maliyet`, `İlk Sözleşme Bedeli`, `En Yüksek/En Düşük Teklif` ve `Sözleşme İmzalayan Yüklenici` bilgilerini doğrudan ayrıştırır.
3. **Kanal 3 — Kamu İhale & DSİ Yeni İhale Keşif İndeksi (RSS/Atom):**
   - Yeni indekslenen `KurulKararGoster.aspx` ve `BirBakistaIhale.aspx` bağlantılarını otomatik keşfederek izleme kuyruğuna (`official_sync_state.json`) ekler.
4. **Kanal 4 — DSİ Genel Müdürlüğü ve 26 Bölge Müdürlüğü Resmi Web Siteleri (`https://dsi.gov.tr` & `https://bolge01.dsi.gov.tr` .. `https://bolge26.dsi.gov.tr`):**
   - DSİ Bölge Müdürlüklerinin `/Duyuru/Detay/...` ve `/Haber/Detay/...` resmi sayfalarını eşzamanlı tarayarak yeni ihale ve şantiye duyurularını **Canlı Resmi Duyuru Radarı** tablosuna aktarır.

### 11.2. Canlı Senkronizasyon İle Veritabanına Eklenen Yeni Resmi İhaleler ve Müteahhitler (`v2.2.0` — 32 Resmi Müteahhit & 23 Resmi DSİ İhalesi)
- **İKN `2025/1751337`** (*KİK Karar No: `2026/UY.I-949`*): DSİ 20. Bölge — *Kilis-Musabeyli ve Köyleri İçmesuyu Arıtma Tesisi* (`YM: 259.757.818,03 TL`, `Resmi SD: 204.478.967,60 TL` — `COMP-21` Spg Danışmanlık Yatırım Yapım İşletme Ltd. Şti.)
- **İKN `2025/2255946`** (*KİK Karar No: `2026/UY.I-873`*): DSİ 8. Bölge — *Erzurum Aziziye İlçe Merkezi Pulur Çayı 1. Kısım Taşkın Kontrol İnşaatı* (`YM: 180.451.134,18 TL`, `Resmi SD: 131.368.425,68 TL` — `COMP-22` Mavi Altyapı A.Ş. [`124.879.515,50 TL`]; `COMP-23` Dila Yapı Madencilik & Ahmet Kartal İş Ortaklığı)
- **İKN `2025/1354433`** (*KİK Karar No: `2026/UY.II-325`*): DSİ 21. Bölge — *Denizli-Sarayköy ve Muğla Akaryakıt İstasyonu Yapımı* (`YM: 32.290.955,37 TL`, `Resmi SD: 25.825.829,17 TL` — `COMP-25` Alayont Mimarlık Mühendislik İnşaat Ltd. Şti. [`31.229.137,50 TL`]; `COMP-26` Ergün Bilir [`33.400.000,00 TL`]; `COMP-24` Çınar İstasyonları Petrol İnşaat Ltd. Şti. [`43.511.008,17 TL`])
- **İKN `2025/1969352`** (*KİK Karar No: `2026/UY.I-892`*): DSİ 12. Bölge — *Yozgat Aydıncık Kösrelik Göleti İkmali 2. Kısım* (`YM: 335.517.208,60 TL`, `Resmi SD: 248.953.768,78 TL` — `COMP-30` Özdemireller Harf. Nak. Tic. ve San. Ltd. Şti.; `COMP-27` Gökalp Proje Müşavirlik A.Ş.; `COMP-28` Arkon Müş. Müh. İnş. Tic. Ltd. Şti.; `COMP-29` Agreon İnş. Ltd. Şti. & Pakyol İnş. A.Ş. İş Ortaklığı; `COMP-31` Hitit Taah. İnş. San. Tic. Ltd. Şti.)
- **İKN `2025/462536`** (*EKAP Bir Bakışta İhale Resmi Sonuç Kaydı*): DSİ 8. Bölge — *Erzurum Köprüköy Akçam Mahallesi Taşkın Koruma İnşaatı* (`YM: 23.614.428,45 TL`, `Sözleşme: 16.332.479,10 TL` — `COMP-32` Ali Osman Birinci)

### 11.3. Yerel HTTP API Uç Noktaları
- `GET /api/sync/status`: Canlı senkronizasyon durumu, kaynak sağlık tablosu, DSİ duyuru radarı ve işlem günlüğü.
- `POST /api/sync/run`: Tüm resmi kaynakları anında tarar ve `verified_db.json` + `SHA-256` mührünü günceller.
- `POST /api/sync/config`: Otomatik tarama durumunu (`autoSyncEnabled`) ve periyodunu (`intervalMinutes`) günceller.
- `POST /api/sync/fetch-url`: Kullanıcının girdiği tekil `.kik.gov.tr` veya `.dsi.gov.tr` URL'sini anında indirip ayrıştırarak veritabanına ekler.

---

## 12. DSİ Şube Müdürlükleri Kırılımı ve Doğrulanmış Veritabanı Genişlemesi (`v2.3.0` — 51 Resmi Müteahhit, 35 Resmi DSİ İhalesi, 84 DSİ Şube Müdürlüğü)

- **Şube Düzeyinde Rakip Analizi (`DSI_BRANCHES` & `inferDsiBranch`):** Tüm ihaleler ve müteahhit kayıtları artık yalnızca DSİ Bölge Müdürlüğü düzeyinde değil, bağlı **84 DSİ Şube Müdürlüğü** (`DSI-01-11` Bursa .. `DSI-26-261` Artvin ve `DSI-GM-BARAJ`) düzeyinde de sınıflandırılmaktadır.
- **Şube Deneyimi ve Teklif Öngörü Ağırlığı:** `CompetitorPredictionEngine`, aynı DSİ Şube Müdürlüğü'nde iş/teklif geçmişi bulunan firmalara **`%100` Şube Deneyimli** etiketi, ek katılım eğilimi ve **`1.35x`** tarihsel benzerlik ağırlığı uygular.
- **Yeni Doğrulanmış Kayıtlar (`v2.3.0`):** `dsi.gov.tr` (DSİ 1., 6., 10., 18., 20., 21., 22. Bölgeler ve Şubeler), EKAP Sonuç İlanları (`2024/1911692`, `2024/1911693`, `2024/1792851`, `2024/1878585`, `2024/1878583`, `2024/1541999`, `2024/1633720`, `2025/1043449`) ve KİK Kurul Kararları (`2025/UY.II-874` / `2024/1548525`, `2024/UY.I-603` / `2023/894949`) ile doğrulanan **12 ek DSİ Bölge/Şube ihalesi** ve **19 yeni yüklenici firma (`COMP-33` .. `COMP-51`)** sisteme işlenmiştir.
- **Canlı DSİ Web Radarı Genişlemesi:** `OfficialDataSyncService`, DSİ Merkez ve Bölge Müdürlükleri ağında 17 hedef adresi (`bolge01`..`bolge22` + `dsi.gov.tr`) ve şube eşleme (`MapIdareAndTitleToDsiBranch`) kurallarıyla otomatik izlemektedir.
