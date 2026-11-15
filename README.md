# DSİ Yapım İhaleleri Teklif Analiz ve Sınır Değer Hesaplama Sistemi (`DSİ-İhaleZekası v2.5.0`)

**Devlet Su İşleri (DSİ)** yapım işi ihalelerine katılan müteahhitlik firmaları için geliştirilmiş; **4734 sayılı Kamu İhale Kanunu** ve **Kamu İhale Genel Tebliği (Madde 45.1.1)** hükümlerine birebir uyumlu, **%100 doğrulanmış resmi kamu verileriyle (`kik.gov.tr`, `ekap.kik.gov.tr`, `bolge01..26.dsi.gov.tr`)** çalışan kurulabilir masaüstü ihale karar destek ve rakip davranış öngörü yazılımıdır.

---

## 1. Projenin Amacı ve Çözüm Mimarisi

DSİ altyapı ve su yapıları ihalelerinde (Baraj, Gölet, Sulama, Taşkın Kontrol, İçmesuyu İsale Hattı ve Arıtma Tesisleri) ihaleyi kazanmanın en kritik aşaması, **Sınır Değerin ($SD$)** nerede oluşacağını ve ihaleye katılacak rakip müteahhitlerin hangi tenzilat (kırım) oranlarıyla teklif vereceğini doğru öngörmektir.

Bu sistem:
1. **Periyodik Resmi Veri Toplama Servisi (`OfficialDataSyncService`)** ile Kamu İhale Kurumu (`ekap.kik.gov.tr`) Kurul Kararları, EKAP "Bir Bakışta İhale" sonuç sayfaları ve tüm DSİ Bölge Müdürlüklerinin kendi web sayfalarını (`bolge01..26.dsi.gov.tr` — `/Ihale/IhaleListe`, `/Ihale/Arsiv`, `/Duyuru/DuyuruListe`; `bolge16.dsi.gov.tr` 2025 kararnamesi uyarınca arşiv/kapalı bölge notu olarak işlenir) `9-15s` kontrollü zaman aşımı ve `SemaphoreSlim(6)` eşzamanlılığıyla tarar. Yapım dışı ilanları eleyen gürültü filtresi, bölge çeşitliliği korumalı duyuru tamponu ve esnek web/RSS yüklenici+İKN eşleştirmesi ile veritabanını (`data/verified_db.json`) otomatik günceller.
2. **DSİ Kaynaklarından Bulunan Rakipler ve Bölge/Şube Analizi (`RegionalAnalysisEngine`)** ile hem KİK/EKAP hem de DSİ Bölge sayfaları + internet aramasından doğrulanan rakipleri **26 DSİ Bölge Müdürlüğü + DSI-GM (27 birim)** ve bağlı **85 DSİ Şube Müdürlüğü (`DSI_BRANCHES`)** bazında ayrıştırır.
3. **3 Katmanlı Rakip Davranış Algoritması ve 10.000 İterasyonlu Monte Carlo Simülasyonu (`MonteCarloTenderSimulator`)** ile yeni girilecek bir DSİ ihalesinde rakiplerin katılım olasılıklarını, tahmini teklif aralıklarını ve beklenen Sınır Değeri hesaplayarak kullanıcıya **3 Kademeli Teklif Stratejisi** (*İhtiyatlı Teklif*, *Önerilen İdeal Teklif*, *Sınır Değere Yakın Riskli Teklif*) sunar.

---

## 2. Temel Özellikler ve Modüller (8 Ana Bölüm)

| Bölüm | Modül Adı | Açıklama |
| :--- | :--- | :--- |
| **1** | **Genel Özet ve İhale Arşivi** | Sistemde kayıtlı 111 resmi DSİ ihalesinin, 122 tekil gerçek müteahhit firmanın, ortalama Sınır Değer indiriminin ve kazanan teklif marjlarının yönetici özeti. |
| **2** | **Yeni İhale Teklif ve Sınır Değer Hesaplama** | Girilecek ihalenin DSİ Bölge ve Şube Müdürlüğü, İş Grubu (`A/I`, `A/II`, `A/III`, `A/IV`, `A/V`, `B/III`), Yaklaşık Maliyet ($YM$) tahmini ve $\pm\%X$ sapma payına göre 10.000 iterasyonlu Monte Carlo simülasyonu ve kazanma/elenme eğrisi. |
| **3** | **Rakip Firma Kayıtları (Düzenlenmiş Dizin)** | Kaynak kökeni (`KİK / EKAP` vs `DSİ Web Keşfi`), arama kutusu, DSİ Bölge/Şube filtresi ve çoklu sıralama (ihale sayısı, A-Z, indirim, kapasite) seçenekleriyle düzenli rakip dizini ve detaylı karne görünümü. |
| **4** | **DSİ Kaynaklarından Bulunan Rakipler** | Bursa (`DSI-01`), İzmir (`DSI-02`) ve tüm 27 birim genelinde `bolge01..26.dsi.gov.tr` ihale/arşiv/duyuru sayfaları + esnek internet/TaahhütHaber/EKAP aramasından doğrulanan yükleniciler, DSİ proje/İKN eşleşmeleri ve kaynak bağlantıları. |
| **5** | **Bölge ve Şube Bazlı Rakip Analizi** | 26 DSİ Bölge + DSI-GM (27 birim) ve bağlı 85 DSİ Şube Müdürlüğü bazında hangi rakiplerin hangi şube ve bölgelerde iş yaptığı, şube/bölge sınır değer tenzilat ortalamaları ve hedef kırım tavsiyeleri. |
| **6** | **İhale Tutanağı ve Veri Girişi** | 3 kanallı doğrulanmış veri girişi: **(1)** Otomatik KİK 45.1.1 matematik denetimli tutanak formu, **(2)** Akıllı EKAP Sonuç İlanı metin okuyucu (`EkapSmartParser`), **(3)** Excel/CSV toplu içe ve dışa aktarım. |
| **7** | **Otomatik Resmi Veri Tarama (`OfficialDataSyncService`)** | `ekap.kik.gov.tr/EKAP/Vatandas/KurulKararGoster.aspx`, `BirBakistaIhale.aspx` ve `bolge01..26.dsi.gov.tr` (`/Ihale/IhaleListe`, `/Ihale/Arsiv`, `/Duyuru/DuyuruListe`) + esnek web/RSS yüklenici aramasını `9-15s` timeout, gürültü filtresi ve kilit korumalı (`SemaphoreSlim`) olarak tarayan arka plan servisi. |
| **8** | **KİK Madde 45.1.1 Sınır Değer Hesap Cetveli** | Açıklanan Yaklaşık Maliyet ve sunulan tekliflere göre $T_{\text{ort},1}$, standart sapma ($\sigma$), $T_{\text{ort},2}$, $C$, $K$ ve $N$ katsayılarını (virgülden sonra 3 basamak yuvarlamalı) adım adım gösteren resmi mevzuat cetveli. |

---

## 3. Kamu İhale Genel Tebliği Madde 45.1.1 Sınır Değer Matematiği

Sistem içerisindeki `KikBoundaryEngine` motoru, Kamu İhale Genel Tebliği Madde 45.1.1'de tanımlanan resmi formülü birebir uygular:

1. **1. Aşama (%40 – %120 YM Filtresi):**
   $$0.40 \times YM \le T_i \le 1.20 \times YM$$
   aralığındaki geçerli tekliflerin aritmetik ortalaması ($T_{\text{ort},1}$) ve örneklem standart sapması ($\sigma$) hesaplanır:
   $$\sigma = \sqrt{\frac{1}{n-1} \sum_{i=1}^{n} (T_i - T_{\text{ort},1})^2}$$
2. **2. Aşama ($T_{\text{ort},1} \pm \sigma$ Standart Sapma Filtresi):**
   $$T_{\text{ort},1} - \sigma \le T_i \le T_{\text{ort},1} + \sigma$$
   aralığında kalan tekliflerin ortalaması ($T_{\text{ort},2}$) alınır.
3. **$C$ ve $K$ Katsayıları (Virgülden Sonra 3 Basamak Yuvarlamalı):**
   $$C = \frac{T_{\text{ort},2}}{YM}$$
   - $C < 0.60 \implies K = C$
   - $0.60 \le C \le 1.00 \implies K = \frac{3.2 C - C^2 - 0.6}{C + 1}$
   - $C > 1.00 \implies K = \frac{C^2 - 0.8 C + 1.4}{C + 1}$
4. **Resmi Sınır Değer ($SD$):**
   $$SD = \frac{K \times T_{\text{ort},2}}{C \times N}$$
   *(DSİ Altyapı / Su Yapıları işlerinde $N = 1.20$, Üstyapı / Bina işlerinde $N = 1.00$ uygulanır).*

---

## 4. %100 Resmi Kamu Veri Kaynağı İlkesi (`officialSourcesOnly: true`)

Sistemde hiçbir kurgusal firma veya tahmini ihale verisi yer almaz. `data/verified_db.json` (`v2.5.0`) içerisindeki **111 doğrulanmış DSİ ihalesi** ve **122 tekil yüklenici firma / iş ortaklığı** (**26 DSİ Bölge + DSI-GM toplam 27 birim** ve **85 şube** kapsama alanı; Bursa `DSI-01` ve İzmir `DSI-02` ihaleleri dahil, `bolge16.dsi.gov.tr` 2025 kararnamesi kapsamında Ilısu Projesi arşiv birimi olarak işaretlenmiştir), doğrudan Kamu İhale Kurulu resmi kararları (`kik.gov.tr`), EKAP resmi sonuç kayıtları (`ekap.kik.gov.tr`), KİK Yapım İşleri Bültenleri ve DSİ Bölge/Şube Müdürlükleri resmi duyurularından (`dsi.gov.tr`) doğrulanmıştır:

- **İKN `2025/1888777`** (*KİK Kararı `2026/UY.II-1764`*): DSİ 11. Bölge — *Tekirdağ İnecik 1-2 ve Dedecik Barajları İçmesuyu İsale Hattı* (`YM: 1.505.809.084,70 TL`)
- **İKN `2025/2110590`** (*KİK Kararı `2026/UY.II-643`*): DSİ 1. Bölge — *Kocaeli Kandıra Arıklar Göleti Sulaması 2. Kısım* (`YM: 325.538.431,00 TL`)
- **İKN `2025/2255946`** (*KİK Kararı `2026/UY.I-873`*): DSİ 8. Bölge — *Erzurum Aziziye İlçe Merkezi Pulur Çayı 1. Kısım Taşkın Kontrol İnşaatı* (`Resmi SD: 131.368.425,68 TL`)
- **İKN `2025/1969352`** (*KİK Kararı `2026/UY.I-892`*): DSİ 12. Bölge — *Yozgat Aydıncık Kösrelik Göleti İkmali 2. Kısım* (`Resmi SD: 248.953.768,78 TL`)
- **İKN `2025/1751337`** (*KİK Kararı `2026/UY.I-949`*): DSİ 20. Bölge — *Kilis-Musabeyli ve Köyleri İçmesuyu Arıtma Tesisi* (`YM: 259.757.818,03 TL`, `Resmi SD: 204.478.967,60 TL`)
- **İKN `2025/1354433`** (*KİK Kararı `2026/UY.II-325`*): DSİ 21. Bölge — *Denizli-Sarayköy ve Muğla Akaryakıt İstasyonu Yapımı* (`YM: 32.290.955,37 TL`, `Resmi SD: 25.825.829,17 TL`)
- **İKN `2025/1163497`** (*EKAP Sonuç İlanı*): DSİ 6. Bölge — *Osmaniye İli Karaçay Deresi Islahı 6. Kısım* (`YM: 499.996.289,13 TL`)
- **İKN `2025/1053977`** (*EKAP Sonuç İlanı*): DSİ 6. Bölge — *Mersin Tarsus Karaevli Göleti Sulaması İkmali* (`YM: 215.658.151,27 TL`)
- **İKN `2025/635261`** (*KİK Kararı `2025/UY.I-2762`*): DSİ 12. Bölge — *Nevşehir Bayramhacılı Pompaj Sulaması Yenileme* (`YM: 945.038.470,00 TL`)
- **İKN `2025/489470`** (*EKAP Sonuç İlanı*): DSİ 9. Bölge — *Tunceli-Pertek Kacarlar Göleti Sulaması 2. Kısım* (`YM: 211.126.958,15 TL`)
- **İKN `2025/462536`** (*EKAP Bir Bakışta İhale*): DSİ 8. Bölge — *Erzurum Köprüköy Akçam Mahallesi Taşkın Koruma İnşaatı* (`YM: 23.614.428,45 TL`)
- **İKN `2024/1484027`** (*KİK Kararı `2025/UY.I-1439`*): DSİ 20. Bölge — *Kilis Musabeyli Barajı İkmali İnşaatı* (`YM: 1.549.891.000,00 TL`)
- **İKN `2024/1377593`** (*KİK Kararları `2025/UY.II-877` & `878`*): DSİ 4. Bölge — *Aksaray Uluırmak (Mamasın) Barajı Sulaması Ana İletim Hattı 2. Kısım* (`YM: 1.194.027.603,00 TL`)
- **İKN `2024/1152749`** (*EKAP Sonuç İlanı*): DSİ 5. Bölge — *Çankırı Kızlaryolu Barajı Yeniden Yerleşim Yeri Yapım İşi* (`YM: 1.299.571.040,96 TL`)
- Ve diğer resmi KİK/EKAP DSİ yapım ihaleleri (`2023/1580956`, `2023/1521358`, `2023/1471844`, `2023/1273876`, `2023/1241906`, `2023/1099327`, `2023/716691`, `2023/620107`, `2023/404580`).

---

## 5. Proje Dizin Yapısı

```text
dsi-ihale-analiz/
├── README.md                               # Proje Tanıtım, Kurulum ve Kullanım Kılavuzu
├── PROJECT.md                              # AI & Geliştirici Mimari ve Mevzuat Referans Belgesi
├── DSIIhaleZekasi_Kurulum_Setup.exe        # Tek Tıkla Kurulabilir Windows Kurulum Sihirbazı (Setup)
├── DSIIhaleZekasi.exe                      # Doğrudan Çalıştırılabilir Masaüstü Uygulaması
├── data/
│   ├── verified_db.json                    # KİK 45.1.1 Doğrulamalı Resmi İhale ve Rakip Veritabanı (v2.5.0)
│   └── verified_db.json.sha256             # SHA-256 Veri Bütünlük Mührü
└── src/
    ├── ui/
    │   ├── index.html                      # 8 Sekmeli Resmi Kurumsal Karar Destek Arayüzü
    │   ├── styles.css                      # Kurumsal Stil ve Rapor Yazdırma Tasarımı
    │   ├── kik-engine.js                   # KİK Md. 45.1.1 Motoru, Bölgesel Analiz ve 10.000 Monte Carlo Çekirdeği
    │   └── app.js                          # Arayüz, Grafik ve Canlı Resmi Senkronizasyon Kontrolcüsü
    ├── DesktopApp/
    │   ├── DSIIhaleZekasi.csproj           # .NET 10 Native Masaüstü Uygulama Projesi (WebView2 + HttpListener)
    │   ├── Program.cs                      # Yerel Sunucu, REST API ve Masaüstü Pencere Yöneticisi
    │   └── OfficialDataSyncService.cs      # Periyodik KİK/EKAP ve DSİ Resmi Veri Toplama Servisi
    └── Installer/
        ├── DSIIhaleZekasi_Setup.csproj     # .NET 10 Kurulum Sihirbazı Projesi
        └── SetupProgram.cs                 # Windows Kurulum Sihirbazı ve Masaüstü Kısayol Oluşturucu
```

---

## 6. Kurulum ve Derleme

### A) Hazır Kurulum Sihirbazı İle Kurulum
Depo kök dizinindeki **`DSIIhaleZekasi_Kurulum_Setup.exe`** dosyasına çift tıklayarak kurulumu başlatabilir veya sessiz kurulum için:
```powershell
.\DSIIhaleZekasi_Kurulum_Setup.exe --silent
```
komutunu çalıştırabilirsiniz. Uygulama `%LOCALAPPDATA%\Programs\DSI_Ihale_Zekasi` dizinine kurulur ve Masaüstünüze **DSİ İhale Zekası** kısayolunu oluşturur.

### B) Kaynak Koddan Derleme (.NET 10 SDK)
```powershell
dotnet publish "src/DesktopApp/DSIIhaleZekasi.csproj" -c Release -r win-x64 -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true --self-contained false -o "dist/app"
```
