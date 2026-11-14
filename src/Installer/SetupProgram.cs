using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

namespace DSIIhaleZekasiSetup
{
    internal static class SetupProgram
    {
        [STAThread]
        static void Main(string[] args)
        {
            ApplicationConfiguration.Initialize();

            string defaultTarget = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "DSI_Ihale_Zekasi"
            );

            bool isSilent = Array.Exists(args, a => a.Equals("--silent", StringComparison.OrdinalIgnoreCase));
            if (isSilent)
            {
                PerformInstall(defaultTarget, createDesktopShortcut: true, createStartMenuShortcut: true, launchAfter: false);
                return;
            }

            Application.Run(new SetupWizardForm(defaultTarget));
        }

        public static string PerformInstall(string targetDir, bool createDesktopShortcut, bool createStartMenuShortcut, bool launchAfter)
        {
            Directory.CreateDirectory(targetDir);

            using Stream? zipStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (zipStream == null)
            {
                throw new InvalidOperationException("Kurulum paketi (payload.zip) gömülü kaynaklarda bulunamadı.");
            }

            using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
            {
                foreach (var entry in archive.Entries)
                {
                    string fullPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                    if (!fullPath.StartsWith(Path.GetFullPath(targetDir), StringComparison.OrdinalIgnoreCase))
                        continue;

                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(fullPath);
                        continue;
                    }

                    string? entryDir = Path.GetDirectoryName(fullPath);
                    if (!string.IsNullOrEmpty(entryDir))
                        Directory.CreateDirectory(entryDir);

                    // Eğer kullanıcının daha önceden girdiği veya otomatik senkronize edilen (v2.1.0 / v2.2.0) verified_db.json varsa koru
                    if (entry.Name.Equals("verified_db.json", StringComparison.OrdinalIgnoreCase) && File.Exists(fullPath))
                    {
                        try
                        {
                            string existing = File.ReadAllText(fullPath);
                            if (existing.Contains("\"version\": \"2.1.0\"") || existing.Contains("\"version\": \"2.2.0\""))
                                continue;
                        }
                        catch { }
                    }

                    entry.ExtractToFile(fullPath, overwrite: true);
                }
            }

            string exePath = Path.Combine(targetDir, "DSIIhaleZekasi.exe");

            if (createDesktopShortcut)
            {
                string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                CreateShortcut(Path.Combine(desktopDir, "DSİ İhale Zekası.lnk"), exePath, targetDir);
            }

            if (createStartMenuShortcut)
            {
                string startMenuDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                CreateShortcut(Path.Combine(startMenuDir, "DSİ İhale Zekası.lnk"), exePath, targetDir);
            }

            if (launchAfter && File.Exists(exePath))
            {
                Process.Start(new ProcessStartInfo(exePath)
                {
                    WorkingDirectory = targetDir,
                    UseShellExecute = true
                });
            }

            return exePath;
        }

        private static void CreateShortcut(string shortcutPath, string targetExe, string workingDir)
        {
            try
            {
                Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object? shell = Activator.CreateInstance(shellType);
                if (shell == null) return;

                object? shortcut = shellType.InvokeMember(
                    "CreateShortcut",
                    BindingFlags.InvokeMethod,
                    null,
                    shell,
                    new object[] { shortcutPath }
                );

                if (shortcut == null) return;
                Type scType = shortcut.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "DSİ İhale Zekası — KİK Rakip Davranış ve Sınır Değer Öngörü Sistemi" });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            catch
            {
                // Kısayol oluşturulamazsa kurulumu kesme
            }
        }
    }

    internal sealed class SetupWizardForm : Form
    {
        private readonly TextBox _txtPath;
        private readonly CheckBox _chkDesktop;
        private readonly CheckBox _chkStartMenu;
        private readonly CheckBox _chkLaunch;
        private readonly Label _lblStatus;
        private readonly Button _btnInstall;

        public SetupWizardForm(string defaultTarget)
        {
            Text = "DSİ İhale Zekası v1.0 — Bilgisayar Kurulum Sihirbazı";
            Size = new Size(580, 410);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.FromArgb(11, 17, 32);
            ForeColor = Color.White;

            var lblHeader = new Label
            {
                Text = "DSİ İhale Zekası — Kurulum Sihirbazı",
                Font = new Font("Segoe UI", 15, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                AutoSize = true,
                Location = new Point(24, 22)
            };

            var lblSub = new Label
            {
                Text = "KİK 4734 Tebliğ Md. 45.1.1 Sınır Değer & 10.000 Monte Carlo Rakip Öngörü Sistemi",
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(148, 163, 184),
                AutoSize = true,
                Location = new Point(24, 54)
            };

            var lblPathLabel = new Label
            {
                Text = "Kurulum Klasörü:",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.White,
                AutoSize = true,
                Location = new Point(24, 96)
            };

            _txtPath = new TextBox
            {
                Text = defaultTarget,
                Font = new Font("Segoe UI", 9.5f),
                Size = new Size(420, 28),
                Location = new Point(24, 120),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };

            var btnBrowse = new Button
            {
                Text = "Gözat...",
                Size = new Size(88, 28),
                Location = new Point(452, 119),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnBrowse.Click += (_, _) =>
            {
                using var fbd = new FolderBrowserDialog { SelectedPath = _txtPath.Text };
                if (fbd.ShowDialog() == DialogResult.OK)
                {
                    _txtPath.Text = fbd.SelectedPath;
                }
            };

            _chkDesktop = new CheckBox
            {
                Text = "Masaüstüne kısayol oluştur (DSİ İhale Zekası)",
                Checked = true,
                AutoSize = true,
                Font = new Font("Segoe UI", 9.5f),
                Location = new Point(24, 168)
            };

            _chkStartMenu = new CheckBox
            {
                Text = "Başlat Menüsüne kısayol ekle",
                Checked = true,
                AutoSize = true,
                Font = new Font("Segoe UI", 9.5f),
                Location = new Point(24, 198)
            };

            _chkLaunch = new CheckBox
            {
                Text = "Kurulum tamamlandığında DSİ İhale Zekası programını hemen başlat",
                Checked = true,
                AutoSize = true,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(52, 211, 153),
                Location = new Point(24, 228)
            };

            _lblStatus = new Label
            {
                Text = "Kuruluma hazır. (%100 Doğrulanmış KİK Veritabanı pakete dahildir)",
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(148, 163, 184),
                Size = new Size(516, 36),
                Location = new Point(24, 268)
            };

            _btnInstall = new Button
            {
                Text = "🚀 Kurulumu Başlat ve Yükle",
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Size = new Size(260, 42),
                Location = new Point(24, 312),
                BackColor = Color.FromArgb(16, 185, 129),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            _btnInstall.Click += OnInstallClicked;

            var btnCancel = new Button
            {
                Text = "Kapat",
                Font = new Font("Segoe UI", 9.5f),
                Size = new Size(110, 42),
                Location = new Point(430, 312),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnCancel.Click += (_, _) => Close();

            Controls.Add(lblHeader);
            Controls.Add(lblSub);
            Controls.Add(lblPathLabel);
            Controls.Add(_txtPath);
            Controls.Add(btnBrowse);
            Controls.Add(_chkDesktop);
            Controls.Add(_chkStartMenu);
            Controls.Add(_chkLaunch);
            Controls.Add(_lblStatus);
            Controls.Add(_btnInstall);
            Controls.Add(btnCancel);
        }

        private void OnInstallClicked(object? sender, EventArgs e)
        {
            try
            {
                _btnInstall.Enabled = false;
                _lblStatus.ForeColor = Color.FromArgb(56, 189, 248);
                _lblStatus.Text = "Dosyalar çıkarılıyor ve kısayollar oluşturuluyor...";
                Application.DoEvents();

                string exePath = SetupProgram.PerformInstall(
                    _txtPath.Text.Trim(),
                    _chkDesktop.Checked,
                    _chkStartMenu.Checked,
                    _chkLaunch.Checked
                );

                _lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
                _lblStatus.Text = $"✓ Kurulum başarıyla tamamlandı: {exePath}";

                MessageBox.Show(
                    $"DSİ İhale Zekası bilgisayarınıza başarıyla kuruldu!\n\nKurulum Dizini:\n{_txtPath.Text}\n\nMasaüstünüzdeki 'DSİ İhale Zekası' kısayolundan istediğiniz zaman çalıştırabilirsiniz.",
                    "Kurulum Tamamlandı",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );

                Close();
            }
            catch (Exception ex)
            {
                _btnInstall.Enabled = true;
                _lblStatus.ForeColor = Color.FromArgb(244, 63, 94);
                _lblStatus.Text = "Hata: " + ex.Message;
                MessageBox.Show("Kurulum sırasında hata oluştu:\n" + ex.Message, "Kurulum Hatası", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
