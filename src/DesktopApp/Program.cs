using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace DSIIhaleZekasi
{
    internal static class Program
    {
        private static string _uiRoot = string.Empty;
        private static string _dbFilePath = string.Empty;
        private static HttpListener? _listener;
        private static OfficialDataSyncService? _syncService;
        private static bool _running = true;

        [STAThread]
        static void Main(string[] args)
        {
            ApplicationConfiguration.Initialize();

            bool smokeTest = Array.Exists(args, a => a.Equals("--smoke-test", StringComparison.OrdinalIgnoreCase));
            bool syncTest = Array.Exists(args, a => a.Equals("--sync-test", StringComparison.OrdinalIgnoreCase));
            bool forceWebView = Array.Exists(args, a => a.Equals("--webview", StringComparison.OrdinalIgnoreCase));

            ResolveAndExtractResources();
            _syncService = new OfficialDataSyncService(_dbFilePath);

            if (syncTest)
            {
                string syncResult = _syncService.RunSyncCycleAsync("CLI Doğrulama Taraması").GetAwaiter().GetResult();
                Console.WriteLine(syncResult);
                return;
            }

            int port = GetAvailablePort();
            string baseUrl = $"http://127.0.0.1:{port}/";

            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add(baseUrl);
                _listener.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Yerel uygulama sunucusu başlatılamadı:\n{ex.Message}",
                    "DSİ İhale Zekası — Başlatma Hatası",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            Task.Run(() => ServeLoopAsync(_listener));
            _syncService.StartBackgroundScheduler();

            if (smokeTest)
            {
                using var client = new System.Net.Http.HttpClient();
                string html = client.GetStringAsync(baseUrl).GetAwaiter().GetResult();
                string dbJson = client.GetStringAsync(baseUrl + "api/db").GetAwaiter().GetResult();
                File.WriteAllText(
                    Path.Combine(Path.GetTempPath(), "dsi_ihale_smoke.txt"),
                    $"SMOKE_TEST_OK|Port={port}|HtmlLen={html.Length}|DbLen={dbJson.Length}"
                );
                _running = false;
                _listener.Stop();
                return;
            }

            Application.Run(new MainDesktopForm(baseUrl, _dbFilePath, forceWebView));

            _running = false;
            try { _listener.Stop(); } catch { }
        }

        private static void ResolveAndExtractResources()
        {
            string appDataRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DSI_Ihale_Zekasi"
            );
            string appDataUiDir = Path.Combine(appDataRoot, "ui");
            string appDataDataDir = Path.Combine(appDataRoot, "data");

            Directory.CreateDirectory(appDataUiDir);
            Directory.CreateDirectory(appDataDataDir);

            // Gömülü kaynakları (EmbeddedResource) LocalAppData dizinine her zaman güncel olarak çıkar
            ExtractEmbeddedResource("ui/index.html", Path.Combine(appDataUiDir, "index.html"), overwrite: true);
            ExtractEmbeddedResource("ui/styles.css", Path.Combine(appDataUiDir, "styles.css"), overwrite: true);
            ExtractEmbeddedResource("ui/kik-engine.js", Path.Combine(appDataUiDir, "kik-engine.js"), overwrite: true);
            ExtractEmbeddedResource("ui/app.js", Path.Combine(appDataUiDir, "app.js"), overwrite: true);

            string appDataDbFile = Path.Combine(appDataDataDir, "verified_db.json");
            bool forceUpgradeDb = true;
            if (File.Exists(appDataDbFile))
            {
                try
                {
                    string existingJson = File.ReadAllText(appDataDbFile, Encoding.UTF8);
                    if (existingJson.Contains("\"version\": \"2.5.1\""))
                    {
                        forceUpgradeDb = false;
                    }
                }
                catch { }
            }
            ExtractEmbeddedResource("data/verified_db.json", appDataDbFile, overwrite: forceUpgradeDb);

            string exeDir = AppContext.BaseDirectory;
            string localUi = Path.Combine(exeDir, "ui");
            if (Directory.Exists(localUi) && File.Exists(Path.Combine(localUi, "index.html")))
            {
                _uiRoot = localUi;
            }
            else
            {
                _uiRoot = appDataUiDir;
            }

            string localDb = Path.Combine(exeDir, "data", "verified_db.json");
            if (File.Exists(localDb))
            {
                try
                {
                    string localJson = File.ReadAllText(localDb, Encoding.UTF8);
                    if (!localJson.Contains("\"officialSourcesOnly\": true") || !localJson.Contains("\"version\": \"2.5.1\""))
                    {
                        ExtractEmbeddedResource("data/verified_db.json", localDb, overwrite: true);
                    }
                }
                catch { }
                _dbFilePath = localDb;
            }
            else
            {
                _dbFilePath = appDataDbFile;
            }
        }

        private static void ExtractEmbeddedResource(string resourceName, string targetPath, bool overwrite)
        {
            try
            {
                if (!overwrite && File.Exists(targetPath))
                    return;

                using Stream? stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
                if (stream == null) return;

                string? dir = Path.GetDirectoryName(targetPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                using var fs = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.Read);
                stream.CopyTo(fs);
            }
            catch
            {
                // Dosya kullanımda ise mevcut halini koru
            }
        }

        private static int GetAvailablePort()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static async Task ServeLoopAsync(HttpListener listener)
        {
            while (_running && listener.IsListening)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await listener.GetContextAsync();
                }
                catch
                {
                    break;
                }

                _ = Task.Run(() => HandleRequestAsync(ctx));
            }
        }

        private static async Task HandleRequestAsync(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var resp = ctx.Response;

            try
            {
                string path = req.Url?.AbsolutePath ?? "/";

                if (path.Equals("/api/sync/status", StringComparison.OrdinalIgnoreCase) && _syncService != null)
                {
                    string json = await _syncService.GetStatusJsonAsync();
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = bytes.Length;
                    await resp.OutputStream.WriteAsync(bytes);
                    resp.Close();
                    return;
                }

                if (path.Equals("/api/sync/run", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "POST" && _syncService != null)
                {
                    string json;
                    try
                    {
                        json = await _syncService.RunSyncCycleAsync("Kullanıcı Manuel Resmi Kaynak Taraması");
                    }
                    catch (Exception syncEx)
                    {
                        var errObj = new JsonObject
                        {
                            ["ok"] = false,
                            ["error"] = syncEx.Message
                        };
                        json = errObj.ToJsonString();
                    }
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = bytes.Length;
                    await resp.OutputStream.WriteAsync(bytes);
                    resp.Close();
                    return;
                }

                if (path.Equals("/api/sync/config", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "POST" && _syncService != null)
                {
                    using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
                    string body = await reader.ReadToEndAsync();
                    var node = JsonNode.Parse(body)?.AsObject();
                    bool autoEnabled = node?["autoSyncEnabled"]?.GetValue<bool>() ?? true;
                    int intervalMin = node?["intervalMinutes"]?.GetValue<int>() ?? 30;
                    _syncService.UpdateConfig(autoEnabled, intervalMin);

                    string json = await _syncService.GetStatusJsonAsync();
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = bytes.Length;
                    await resp.OutputStream.WriteAsync(bytes);
                    resp.Close();
                    return;
                }

                if (path.Equals("/api/sync/fetch-url", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "POST" && _syncService != null)
                {
                    using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
                    string body = await reader.ReadToEndAsync();
                    var node = JsonNode.Parse(body)?.AsObject();
                    string targetUrl = node?["url"]?.GetValue<string>() ?? "";
                    string json = await _syncService.FetchAndImportSingleOfficialUrlAsync(targetUrl);
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = bytes.Length;
                    await resp.OutputStream.WriteAsync(bytes);
                    resp.Close();
                    return;
                }

                if (path.Equals("/api/browser-provider", StringComparison.OrdinalIgnoreCase))
                {
                    string? chromePath = FindChromeExecutablePath();
                    var infoObj = new JsonObject
                    {
                        ["provider"] = chromePath != null ? "Google Chrome" : "Sistem Varsayılan Tarayıcısı",
                        ["chromeAvailable"] = chromePath != null,
                        ["chromePath"] = chromePath ?? ""
                    };
                    byte[] bytes = Encoding.UTF8.GetBytes(infoObj.ToJsonString());
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = bytes.Length;
                    await resp.OutputStream.WriteAsync(bytes);
                    resp.Close();
                    return;
                }

                if (path.Equals("/api/open-url", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "POST")
                {
                    using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
                    string body = await reader.ReadToEndAsync();
                    var node = JsonNode.Parse(body)?.AsObject();
                    string targetUrl = node?["url"]?.GetValue<string>() ?? "";
                    var (opened, providerName, errorMsg) = LaunchUrlInChromeOrDefault(targetUrl, asAppWindow: false);
                    var resObj = new JsonObject
                    {
                        ["ok"] = opened,
                        ["provider"] = providerName,
                        ["error"] = errorMsg ?? ""
                    };
                    if (!opened) resp.StatusCode = 400;
                    byte[] bytes = Encoding.UTF8.GetBytes(resObj.ToJsonString());
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = bytes.Length;
                    await resp.OutputStream.WriteAsync(bytes);
                    resp.Close();
                    return;
                }

                if (path.Equals("/api/db", StringComparison.OrdinalIgnoreCase))
                {
                    if (req.HttpMethod == "GET")
                    {
                        if (File.Exists(_dbFilePath))
                        {
                            byte[] bytes;
                            await OfficialDataSyncService.DbFileLock.WaitAsync();
                            try
                            {
                                bytes = await File.ReadAllBytesAsync(_dbFilePath);
                            }
                            finally
                            {
                                OfficialDataSyncService.DbFileLock.Release();
                            }
                            resp.ContentType = "application/json; charset=utf-8";
                            resp.ContentLength64 = bytes.Length;
                            await resp.OutputStream.WriteAsync(bytes);
                        }
                        else
                        {
                            resp.StatusCode = 404;
                        }
                        resp.Close();
                        return;
                    }
                    else if (req.HttpMethod == "POST")
                    {
                        using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
                        string body = await reader.ReadToEndAsync();
                        if (!string.IsNullOrWhiteSpace(body) && body.Contains("\"competitors\"") && body.Contains("\"tenders\""))
                        {
                            string hex;
                            await OfficialDataSyncService.DbFileLock.WaitAsync();
                            try
                            {
                                string? dir = Path.GetDirectoryName(_dbFilePath);
                                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                                await File.WriteAllTextAsync(_dbFilePath, body, new UTF8Encoding(false));

                                using var sha = SHA256.Create();
                                byte[] hash = sha.ComputeHash(new UTF8Encoding(false).GetBytes(body));
                                hex = Convert.ToHexString(hash).ToUpperInvariant();
                                await File.WriteAllTextAsync(_dbFilePath + ".sha256", hex, new UTF8Encoding(false));
                            }
                            finally
                            {
                                OfficialDataSyncService.DbFileLock.Release();
                            }

                            byte[] okBytes = Encoding.UTF8.GetBytes("{\"status\":\"saved\",\"sha256\":\"" + hex + "\"}");
                            resp.ContentType = "application/json; charset=utf-8";
                            resp.ContentLength64 = okBytes.Length;
                            await resp.OutputStream.WriteAsync(okBytes);
                        }
                        else
                        {
                            resp.StatusCode = 400;
                        }
                        resp.Close();
                        return;
                    }
                }

                if (path == "/" || path == "")
                {
                    path = "/index.html";
                }

                string cleanRel = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                string filePath = Path.GetFullPath(Path.Combine(_uiRoot, cleanRel));

                if (!filePath.StartsWith(Path.GetFullPath(_uiRoot), StringComparison.OrdinalIgnoreCase) || !File.Exists(filePath))
                {
                    resp.StatusCode = 404;
                    resp.Close();
                    return;
                }

                resp.ContentType = GetMimeType(filePath);
                byte[] fileBytes = await File.ReadAllBytesAsync(filePath);
                resp.ContentLength64 = fileBytes.Length;
                await resp.OutputStream.WriteAsync(fileBytes);
                resp.Close();
            }
            catch (Exception ex)
            {
                try
                {
                    if ((req.Url?.AbsolutePath ?? "").StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
                    {
                        var errObj = new JsonObject { ["ok"] = false, ["error"] = ex.Message };
                        byte[] errBytes = Encoding.UTF8.GetBytes(errObj.ToJsonString());
                        resp.StatusCode = 500;
                        resp.ContentType = "application/json; charset=utf-8";
                        resp.ContentLength64 = errBytes.Length;
                        await resp.OutputStream.WriteAsync(errBytes);
                        resp.Close();
                    }
                    else
                    {
                        resp.StatusCode = 500;
                        resp.Close();
                    }
                }
                catch { }
            }
        }

        internal static string? FindChromeExecutablePath()
        {
            string[] candidates =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
            };

            foreach (string path in candidates)
            {
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                {
                    return path;
                }
            }

            string[] regKeys =
            {
                @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                @"HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
            };

            foreach (string key in regKeys)
            {
                try
                {
                    object? val = Registry.GetValue(key, null, null);
                    if (val is string regPath && File.Exists(regPath))
                    {
                        return regPath;
                    }
                }
                catch { }
            }

            return null;
        }

        internal static (bool Opened, string Provider, string? Error) LaunchUrlInChromeOrDefault(string targetUrl, bool asAppWindow)
        {
            if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out Uri? uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return (false, "Geçersiz URL", "Yalnızca http veya https adresleri açılabilir.");
            }

            string normalized = uri.AbsoluteUri;
            string? chromePath = FindChromeExecutablePath();
            if (chromePath != null)
            {
                try
                {
                    string args = asAppWindow
                        ? $"--new-window --app=\"{normalized}\""
                        : $"\"{normalized}\"";
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = chromePath,
                        Arguments = args,
                        UseShellExecute = false
                    });
                    return (true, "Google Chrome", null);
                }
                catch { }
            }

            try
            {
                Process.Start(new ProcessStartInfo(normalized) { UseShellExecute = true });
                return (true, "Sistem Varsayılan Tarayıcısı", null);
            }
            catch (Exception ex)
            {
                return (false, "Hata", ex.Message);
            }
        }

        private static string GetMimeType(string filePath)
        {
            return Path.GetExtension(filePath).ToLowerInvariant() switch
            {
                ".html" => "text/html; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".js" => "application/javascript; charset=utf-8",
                ".json" => "application/json; charset=utf-8",
                ".png" => "image/png",
                ".svg" => "image/svg+xml",
                ".ico" => "image/x-icon",
                _ => "application/octet-stream"
            };
        }
    }

    internal sealed class MainDesktopForm : Form
    {
        private readonly string _url;
        private readonly string _dbPath;
        private readonly bool _forceWebView;
        private readonly string? _chromePath;
        private WebView2? _webView;

        public MainDesktopForm(string url, string dbPath, bool forceWebView = false)
        {
            _url = url;
            _dbPath = dbPath;
            _forceWebView = forceWebView;
            _chromePath = Program.FindChromeExecutablePath();

            Text = "DSİ Yapım İhaleleri Teklif Analiz ve Sınır Değer Hesaplama Sistemi";
            Size = new Size(1460, 920);
            MinimumSize = new Size(560, 320);
            StartPosition = FormStartPosition.CenterScreen;
            WindowState = (!forceWebView && _chromePath != null) ? FormWindowState.Normal : FormWindowState.Maximized;
            BackColor = Color.FromArgb(241, 245, 249);
            ForeColor = Color.FromArgb(15, 23, 42);

            Load += OnFormLoadAsync;
            Shown += (_, _) =>
            {
                if (_forceWebView || _chromePath == null)
                {
                    TopMost = true;
                    Activate();
                    BringToFront();
                    TopMost = false;
                }
            };
        }

        private async void OnFormLoadAsync(object? sender, EventArgs e)
        {
            if (!_forceWebView && _chromePath != null)
            {
                BuildChromeProviderUI();
                Program.LaunchUrlInChromeOrDefault(_url, asAppWindow: true);
                return;
            }

            await InitializeEmbeddedWebViewAsync();
        }

        private async Task InitializeEmbeddedWebViewAsync()
        {
            try
            {
                Controls.Clear();
                WindowState = FormWindowState.Maximized;
                _webView = new WebView2
                {
                    Dock = DockStyle.Fill,
                    DefaultBackgroundColor = Color.FromArgb(241, 245, 249)
                };
                Controls.Add(_webView);

                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DSI_Ihale_Zekasi",
                    "WebView2Data"
                );
                Directory.CreateDirectory(userDataFolder);

                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await _webView.EnsureCoreWebView2Async(env);

                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _webView.CoreWebView2.NewWindowRequested += (_, args) =>
                {
                    args.Handled = true;
                    if (!string.IsNullOrWhiteSpace(args.Uri))
                    {
                        Program.LaunchUrlInChromeOrDefault(args.Uri, asAppWindow: false);
                    }
                };
                _webView.CoreWebView2.Navigate(_url);
            }
            catch
            {
                Controls.Clear();
                BuildChromeProviderUI();
                Program.LaunchUrlInChromeOrDefault(_url, asAppWindow: false);
            }
        }

        private void BuildChromeProviderUI()
        {
            Controls.Clear();
            WindowState = FormWindowState.Normal;
            Size = new Size(640, 310);
            BackColor = Color.FromArgb(15, 23, 42);
            ForeColor = Color.White;

            bool hasChrome = _chromePath != null;

            var lblTitle = new Label
            {
                Text = hasChrome
                    ? "DSİ İhale Zekası — İnternet Sağlayıcısı: Google Chrome"
                    : "DSİ İhale Zekası Çalışıyor",
                Font = new Font("Segoe UI", 13.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                AutoSize = true,
                Location = new Point(24, 22)
            };

            var lblInfo = new Label
            {
                Text = $"Yerel Sunucu: {_url}\n" +
                       $"Tarayıcı Motoru: {(hasChrome ? _chromePath : "Sistem Varsayılan Tarayıcısı")}\n" +
                       $"Veritabanı: {_dbPath}\n\n" +
                       "Tüm firma web siteleri ve EKAP/KİK/DSİ bağlantıları Google Chrome üzerinden açılır.\n" +
                       "Sunucunun açık kalması için bu pencereyi açık veya simge durumunda tutunuz.",
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(203, 213, 225),
                Size = new Size(585, 118),
                Location = new Point(24, 62)
            };

            var btnChromeApp = new Button
            {
                Text = "Google Chrome Uygulama Penceresi",
                Size = new Size(245, 38),
                Location = new Point(24, 196),
                BackColor = Color.FromArgb(14, 165, 233),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnChromeApp.Click += (_, _) => Program.LaunchUrlInChromeOrDefault(_url, asAppWindow: true);

            var btnChromeTab = new Button
            {
                Text = "Chrome Sekmesinde Aç",
                Size = new Size(175, 38),
                Location = new Point(280, 196),
                BackColor = Color.FromArgb(16, 185, 129),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnChromeTab.Click += (_, _) => Program.LaunchUrlInChromeOrDefault(_url, asAppWindow: false);

            var btnEmbedded = new Button
            {
                Text = "Uygulama İçi Pencere",
                Size = new Size(145, 38),
                Location = new Point(466, 196),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnEmbedded.Click += async (_, _) => await InitializeEmbeddedWebViewAsync();

            Controls.Add(lblTitle);
            Controls.Add(lblInfo);
            Controls.Add(btnChromeApp);
            Controls.Add(btnChromeTab);
            Controls.Add(btnEmbedded);
        }
    }
}
