// ============================================================================
//  MeshfinTile — a big, mouse-resizable "block" that lives on the Windows desktop
//  and launches the Meshfin Web shortcut (start-meshfin.cmd) when clicked.
//
//  Why this exists: Windows cannot make one desktop icon bigger than the rest
//  (icon size is a single global setting, max 256px) and Active Desktop is gone
//  since Windows 8. So this is a real window that behaves like part of the
//  desktop:
//
//    * it is parented into the desktop window (Progman) and z-ordered ABOVE
//      the icon layer (SysListView32), so it sits on the wallpaper, is clicked
//      like a desktop item, and never floats over your other windows
//    * raw Win32 layered window (WS_POPUP + WS_EX_LAYERED) painted through
//      UpdateLayeredWindow with a 32bpp *premultiplied* DIB — per-pixel alpha,
//      so the artwork keeps its glow and transparent corners fall through
//    * WS_EX_NOACTIVATE + WM_MOUSEACTIVATE/MA_NOACTIVATE: clicking never steals
//      focus from what you are working on
//    * no taskbar button (WS_EX_TOOLWINDOW), and SC_MINIMIZE is swallowed so
//      Win+D / Show Desktop does not hide it
//
//  Interaction:
//    * left-click                -> launch dsh web
//    * left-drag on the body     -> move (position remembered in meshfin-tile.ini)
//    * left-drag on the corner   -> resize with the mouse (a grip is drawn in
//      the bottom-right corner and the cursor becomes a resize arrow)
//    * mouse wheel over the tile -> resize in steps
//    * right-click               -> menu: launch / size presets / open folder /
//      quit
//
//  Build (no SDK needed, csc ships with Windows):
//    csc.exe /nologo /target:winexe /out:MeshfinTile.exe
//            /reference:System.Drawing.dll MeshfinTile.cs
//
//  NOTE: csc.exe in .NET Framework v4.0.30319 is a C# 5 compiler — this file
//  deliberately avoids C# 6+ syntax.
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace MeshfinTile
{
    internal static class Native
    {
        // Window styles
        public const int WS_POPUP = unchecked((int)0x80000000);
        public const int WS_CHILD = 0x40000000;
        public const int WS_EX_LAYERED = 0x00080000;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        public const int SW_SHOWNOACTIVATE = 4;

        // UpdateLayeredWindow
        public const int ULW_ALPHA = 0x00000002;
        public const byte AC_SRC_OVER = 0x00;
        public const byte AC_SRC_ALPHA = 0x01;

        // Messages
        public const int WM_PAINT = 0x000F;
        public const int WM_ERASEBKGND = 0x0014;
        public const int WM_SETCURSOR = 0x0020;
        public const int WM_MOUSEACTIVATE = 0x0021;
        public const int WM_MOUSEMOVE = 0x0200;
        public const int WM_LBUTTONDOWN = 0x0201;
        public const int WM_LBUTTONUP = 0x0202;
        public const int WM_RBUTTONUP = 0x0205;
        public const int WM_MOUSEWHEEL = 0x020A;
        public const int WM_TIMER = 0x0113;
        public const int WM_SYSCOMMAND = 0x0112;
        public const int WM_DESTROY = 0x0002;
        public const int WM_NULL = 0x0000;
        public const int SC_MINIMIZE = 0xF020;
        public const int MA_NOACTIVATE = 3;
        public const int HTCLIENT = 1;

        // SetWindowPos
        public const int SWP_NOSIZE = 0x0001;
        public const int SWP_NOMOVE = 0x0002;
        public const int SWP_NOACTIVATE = 0x0010;
        public const int SWP_NOZORDER = 0x0004;
        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

        // Menus
        public const int MF_STRING = 0x00000000;
        public const int MF_POPUP = 0x00000010;
        public const int MF_SEPARATOR = 0x00000800;
        public const int MF_CHECKED = 0x00000008;
        public const int TPM_RIGHTBUTTON = 0x0002;
        public const int TPM_RETURNCMD = 0x0100;

        public const int IDC_ARROW = 32512;
        public const int IDC_SIZENWSE = 32642;
        public const int IDC_HAND = 32649;
        public const int DIB_RGB_COLORS = 0;
        public const int SPI_GETWORKAREA = 0x0030;

        public delegate IntPtr WndProc(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WNDCLASSEX
        {
            public int cbSize;
            public int style;
            public WndProc lpfnWndProc;
            public int cbClsExtra;
            public int cbWndExtra;
            public IntPtr hInstance;
            public IntPtr hIcon;
            public IntPtr hCursor;
            public IntPtr hbrBackground;
            public string lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SIZE
        {
            public int cx;
            public int cy;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct BITMAPINFOHEADER
        {
            public int biSize;
            public int biWidth;
            public int biHeight;
            public short biPlanes;
            public short biBitCount;
            public int biCompression;
            public int biSizeImage;
            public int biXPelsPerMeter;
            public int biYPelsPerMeter;
            public int biClrUsed;
            public int biClrImportant;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct BITMAPINFO
        {
            public BITMAPINFOHEADER bmiHeader;
            public int bmiColors;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public int message;
            public IntPtr wParam;
            public IntPtr lParam;
            public int time;
            public int ptX;
            public int ptY;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr GetModuleHandle(string name);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern ushort RegisterClassEx(ref WNDCLASSEX wc);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName,
            int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
            IntPtr instance, IntPtr param);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int cmdShow);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter,
            int x, int y, int cx, int cy, int flags);

        [DllImport("user32.dll")]
        public static extern IntPtr DefWindowProc(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern void PostQuitMessage(int exitCode);

        [DllImport("user32.dll")]
        public static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);

        [DllImport("user32.dll")]
        public static extern bool TranslateMessage(ref MSG msg);

        [DllImport("user32.dll")]
        public static extern IntPtr DispatchMessage(ref MSG msg);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT pt);

        [DllImport("user32.dll")]
        public static extern bool ScreenToClient(IntPtr hWnd, ref POINT pt);

        [DllImport("user32.dll")]
        public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);

        [DllImport("user32.dll")]
        public static extern IntPtr SetCapture(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern bool ValidateRect(IntPtr hWnd, IntPtr rect);

        [DllImport("user32.dll")]
        public static extern IntPtr SetTimer(IntPtr hWnd, IntPtr id, uint elapse, IntPtr timerProc);

        [DllImport("user32.dll")]
        public static extern bool KillTimer(IntPtr hWnd, IntPtr id);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr LoadCursor(IntPtr instance, int cursor);

        [DllImport("user32.dll")]
        public static extern IntPtr SetCursor(IntPtr cursor);

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst,
            ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc,
            int crKey, ref BLENDFUNCTION pblend, int dwFlags);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool DeleteDC(IntPtr hDC);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateDIBSection(IntPtr hDC, ref BITMAPINFO bmi,
            int usage, out IntPtr bits, IntPtr section, int offset);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int index);

        [DllImport("user32.dll")]
        public static extern bool SystemParametersInfo(int action, int param, ref RECT rect, int flags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        public static extern IntPtr GetShellWindow();

        public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumProc callback, IntPtr lparam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder buffer, int count);

        public const int GWL_STYLE = -16;

        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string className, string windowName);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        [DllImport("user32.dll")]
        public static extern IntPtr GetParent(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr CreatePopupMenu();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern bool AppendMenu(IntPtr menu, int flags, IntPtr idNewItem, string newItem);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int TrackPopupMenu(IntPtr menu, int flags, int x, int y,
            int reserved, IntPtr hWnd, IntPtr rect);

        [DllImport("user32.dll")]
        public static extern bool DestroyMenu(IntPtr menu);
    }

    /// <summary>Persisted tile geometry, stored next to the exe (screen coordinates).</summary>
    internal sealed class TileConfig
    {
        public const int MinSize = 128;
        public const int MaxSize = 1600;
        public const int DefaultSize = 420;

        /// <summary>Tile height in pixels; the width follows the skin aspect.</summary>
        public int Size = DefaultSize;
        public int X = int.MinValue;
        public int Y = int.MinValue;

        /// <summary>Selected skin file name inside skins/, empty means the first one.</summary>
        public string Skin = "";

        /// <summary>1-based skin index from --skin; 0 means "use Skin or the first".</summary>
        public int SkinIndex;

        /// <summary>Draw the DeepSeek balance chip on the tile.</summary>
        public bool ShowBalance = true;

        /// <summary>Seconds between balance fetches (clamped when loaded).</summary>
        public int BalanceSeconds = 60;

        /// <summary>WSL path of the balance fetcher; empty disables the balance chip.</summary>
        public string BalanceScript = "";

        private static string PathFor(string appDir)
        {
            return Path.Combine(appDir, "meshfin-tile.ini");
        }

        public static TileConfig Load(string appDir)
        {
            TileConfig cfg = new TileConfig();
            try
            {
                string path = PathFor(appDir);
                if (!File.Exists(path)) return cfg;
                string[] lines = File.ReadAllLines(path);
                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i].Trim();
                    if (line.Length == 0 || line[0] == '#') continue;
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string key = line.Substring(0, eq).Trim().ToLowerInvariant();
                    string val = line.Substring(eq + 1).Trim();
                    if (key == "skin")
                    {
                        cfg.Skin = val;
                        continue;
                    }
                    if (key == "balancescript")
                    {
                        cfg.BalanceScript = val;
                        continue;
                    }
                    int parsed;
                    if (!int.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                        continue;
                    if (key == "size" && parsed >= MinSize && parsed <= MaxSize) cfg.Size = parsed;
                    else if (key == "x") cfg.X = parsed;
                    else if (key == "y") cfg.Y = parsed;
                    else if (key == "balance") cfg.ShowBalance = parsed != 0;
                    else if (key == "balanceseconds" && parsed >= 15 && parsed <= 3600) cfg.BalanceSeconds = parsed;
                }
            }
            catch
            {
                // A broken config must never keep the tile from starting.
            }
            return cfg;
        }

        public void Save(string appDir)
        {
            try
            {
                StringBuilder sb = new StringBuilder();
                sb.AppendLine("# MeshfinTile geometry (screen coordinates). Delete this file to reset.");
                sb.AppendLine("size=" + Size.ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("x=" + X.ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("y=" + Y.ToString(CultureInfo.InvariantCulture));
                if (Skin.Length > 0) sb.AppendLine("skin=" + Skin);
                sb.AppendLine("balance=" + (ShowBalance ? "1" : "0"));
                sb.AppendLine("balanceseconds=" + BalanceSeconds.ToString(CultureInfo.InvariantCulture));
                if (BalanceScript.Length > 0) sb.AppendLine("balancescript=" + BalanceScript);
                File.WriteAllText(PathFor(appDir), sb.ToString());
            }
            catch
            {
                // Saving is best effort.
            }
        }
    }

    /// <summary>
    /// The DeepSeek account balance shown on the tile. The API key exists only
    /// inside WSL, so one background thread runs the WSL fetcher and then reads
    /// back the snapshot file it wrote: the number on the tile is exactly the
    /// file an agent reads at the same path. A failed fetch leaves the previous
    /// snapshot untouched, so the chip ages instead of inventing a value.
    /// </summary>
    internal sealed class BalanceWatcher
    {
        /// <summary>WSL path of the fetcher, normally set in meshfin-tile.ini; empty disables fetching.</summary>
        public const string DefaultScript = "";

        private readonly string _script;
        private readonly int _intervalSeconds;
        private readonly string _snapshotPath;
        private readonly ManualResetEvent _wake = new ManualResetEvent(false);
        private readonly object _gate = new object();
        private Thread _thread;
        private volatile bool _stop;

        private int _generation;
        private bool _hasValue;
        private string _total = "";
        private string _currency = "";
        private bool _available;
        private DateTime _fetchedUtc = DateTime.MinValue;
        private string _error = "";

        /// <param name="appDir">Directory holding the tile, where the snapshot is written.</param>
        /// <param name="script">WSL path of the fetcher; empty leaves the balance chip off.</param>
        /// <param name="intervalSeconds">Seconds between fetches.</param>
        public BalanceWatcher(string appDir, string script, int intervalSeconds)
        {
            _script = script.Length > 0 ? script : DefaultScript;
            _intervalSeconds = Math.Max(15, intervalSeconds);
            _snapshotPath = Path.Combine(appDir, "balance.json");
        }

        /// <summary>Snapshot file, shared by the tile and any reader with file access.</summary>
        public string SnapshotPath { get { return _snapshotPath; } }

        /// <summary>Bumped once per published state, so the UI repaints on change.</summary>
        public int Generation { get { lock (_gate) return _generation; } }

        /// <summary>True when the snapshot carries a balance.</summary>
        public bool HasValue { get { lock (_gate) return _hasValue; } }

        /// <summary>Balance digits exactly as the snapshot carries them.</summary>
        public string Total { get { lock (_gate) return _total; } }

        /// <summary>Snapshot currency code, e.g. CNY.</summary>
        public string Currency { get { lock (_gate) return _currency; } }

        /// <summary>The endpoint reported the account as usable.</summary>
        public bool Available { get { lock (_gate) return _available; } }

        /// <summary>Last fetch failure, empty when the last fetch succeeded.</summary>
        public string Error { get { lock (_gate) return _error; } }

        /// <summary>Age of the snapshot, or <see cref="TimeSpan.MaxValue"/> when there is none.</summary>
        public TimeSpan Age
        {
            get
            {
                lock (_gate)
                {
                    return _fetchedUtc == DateTime.MinValue
                        ? TimeSpan.MaxValue
                        : DateTime.UtcNow - _fetchedUtc;
                }
            }
        }

        /// <summary>Currency glyph for the chip.</summary>
        public string Symbol
        {
            get
            {
                string currency = Currency;
                if (currency == "CNY") return "\u00a5";
                if (currency == "USD") return "$";
                return currency.Length > 0 ? currency + " " : "";
            }
        }

        /// <summary>Start the refresh loop; calling it twice is a no-op.</summary>
        public void Start()
        {
            // No fetcher configured: there is nothing to poll, so no thread runs.
            if (_script.Length == 0) return;
            if (_thread != null) return;
            _thread = new Thread(Loop);
            _thread.IsBackground = true;
            _thread.Name = "dshtile-balance";
            _thread.Start();
        }

        /// <summary>Stop the refresh loop and wait briefly for the thread to leave.</summary>
        public void Stop()
        {
            _stop = true;
            _wake.Set();
            Thread thread = _thread;
            _thread = null;
            if (thread != null) thread.Join(5000);
        }

        /// <summary>Fetch again now instead of waiting for the next interval.</summary>
        public void RefreshNow()
        {
            _wake.Set();
        }

        private void Loop()
        {
            while (!_stop)
            {
                RefreshOnce();
                if (_stop) break;
                _wake.WaitOne(_intervalSeconds * 1000);
                _wake.Reset();
            }
        }

        private void RefreshOnce()
        {
            string error = "";
            try
            {
                ProcessStartInfo start = new ProcessStartInfo("wsl.exe");
                start.Arguments = "-- python3 \"" + _script + "\" --out \"" + ToWslPath(_snapshotPath) + "\"";
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                using (Process process = Process.Start(start))
                {
                    // The fetcher prints one small line; reading both pipes keeps
                    // a chatty failure from blocking the child on a full buffer.
                    process.StandardOutput.ReadToEnd();
                    string diagnostic = process.StandardError.ReadToEnd();
                    if (!process.WaitForExit(30000))
                    {
                        try { process.Kill(); } catch { }
                        error = "余额抓取超时";
                    }
                    else if (process.ExitCode != 0)
                    {
                        error = LastLine(diagnostic);
                    }
                }
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            Publish(error);
        }

        private void Publish(string error)
        {
            bool hasValue = false;
            bool available = false;
            string total = "";
            string currency = "";
            DateTime fetched = DateTime.MinValue;
            try
            {
                if (File.Exists(_snapshotPath))
                {
                    string json = File.ReadAllText(_snapshotPath, Encoding.UTF8);
                    total = JsonField(json, "total_balance");
                    currency = JsonField(json, "currency");
                    available = JsonField(json, "is_available") == "true";
                    DateTimeOffset parsed;
                    if (DateTimeOffset.TryParse(JsonField(json, "fetched_at"), CultureInfo.InvariantCulture,
                            DateTimeStyles.RoundtripKind, out parsed))
                    {
                        fetched = parsed.UtcDateTime;
                    }
                    hasValue = total.Length > 0;
                }
            }
            catch (Exception ex)
            {
                if (error.Length == 0) error = ex.Message;
            }
            lock (_gate)
            {
                _hasValue = hasValue;
                _total = total;
                _currency = currency;
                _available = available;
                _fetchedUtc = fetched;
                _error = error;
                _generation++;
            }
            TileApp.Log("[balance] " + (hasValue ? currency + " " + total : "no snapshot")
                + (error.Length > 0 ? " error=" + error : ""));
        }

        /// <summary>Last non-empty line of a fetcher diagnostic, for the tile and menu.</summary>
        private static string LastLine(string text)
        {
            string[] lines = (text ?? "").Split('\n');
            for (int i = lines.Length - 1; i >= 0; i--)
            {
                string line = lines[i].Trim();
                if (line.Length > 0) return line;
            }
            return "余额抓取失败";
        }

        /// <summary>Read one scalar field from the snapshot (its shape is defined by the fetcher).</summary>
        private static string JsonField(string json, string key)
        {
            string needle = "\"" + key + "\"";
            int at = json.IndexOf(needle, StringComparison.Ordinal);
            if (at < 0) return "";
            at = json.IndexOf(':', at + needle.Length);
            if (at < 0) return "";
            int i = at + 1;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
            if (i < json.Length && json[i] == '"')
            {
                int end = json.IndexOf('"', i + 1);
                return end < 0 ? "" : json.Substring(i + 1, end - i - 1);
            }
            int start = i;
            while (i < json.Length && json[i] != ',' && json[i] != '\n' && json[i] != '}') i++;
            return json.Substring(start, i - start).Trim();
        }

        /// <summary>Translate a Windows drive path into the WSL mount view.</summary>
        private static string ToWslPath(string windowsPath)
        {
            string full = Path.GetFullPath(windowsPath);
            if (full.Length >= 2 && full[1] == ':')
            {
                return "/mnt/" + char.ToLowerInvariant(full[0]) + full.Substring(2).Replace('\\', '/');
            }
            return full.Replace('\\', '/');
        }
    }

    /// <summary>One artwork the tile can wear.</summary>
    internal sealed class Skin
    {
        /// <summary>File name inside skins/, e.g. "2-heart.png".</summary>
        public string FileName;
        /// <summary>Menu label (the file name without extension).</summary>
        public string Label;
        /// <summary>The decoded artwork, held in memory.</summary>
        public Image Art;
        /// <summary>width / height, so the window can keep the picture's shape.</summary>
        public double Aspect;
    }

    /// <summary>The whole program: one desktop-embedded layered window.</summary>
    internal sealed class TileApp
    {
        private const string WindowClass = "MeshfinTileWndClass";
        private const string MutexName = "MeshfinTile-SingleInstance-{6B1F0E5A}";
        private static readonly IntPtr TimerId = new IntPtr(1);

        private const int CmdLaunch = 1;
        private const int CmdOpenFolder = 2;
        private const int CmdQuit = 3;
        private const int CmdResetSize = 4;
        private const int CmdSizeBase = 100;
        private const int CmdSkinBase = 200;
        private const int CmdRefreshBalance = 5;
        private const int CmdToggleBalance = 6;

        private static readonly int[] SizePresets = new int[] { 320, 420, 520, 640, 768 };

        private readonly string _appDir;
        private readonly TileConfig _config;
        private readonly List<Skin> _skins = new List<Skin>();
        private int _skinIndex;
        private IntPtr _hwnd;
        private IntPtr _hBitmap;
        private IntPtr _resizeCursor;
        private IntPtr _handCursor;
        private int _bitmapSize;
        private bool _quitting;

        // Drag / resize state
        private bool _dragging;
        private bool _resizing;
        private Native.POINT _dragOriginCursor;
        private int _dragOriginX;
        private int _dragOriginY;
        private int _dragOriginSize;
        private int _dragDistance;
        private bool _hoverGrip;
        private bool _hoverArrow;
        private bool _arrowPress;

        private Native.WndProc _wndProcDelegate;

        private readonly BalanceWatcher _balance;
        private int _renderedBalanceGeneration = -1;
        private bool _bubblePress;
        private Rectangle _bubbleBounds = Rectangle.Empty;
        private Image _bubbleArt;

        private readonly bool _embed;

        public TileApp(string appDir, TileConfig config, bool embed)
        {
            _appDir = appDir;
            _config = config;
            _embed = embed;
            _balance = new BalanceWatcher(appDir, config.BalanceScript, config.BalanceSeconds);
        }

        internal static void Log(string message)
        {
            try
            {
                string path = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "tile.log");
                File.AppendAllText(path, DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + message + "\r\n");
            }
            catch { }
        }

        private Skin Current
        {
            get { return _skins.Count == 0 ? null : _skins[_skinIndex]; }
        }

        /// <summary>Window width for a given height, from the skin's aspect ratio.</summary>
        private int TileWidth(int height)
        {
            Skin skin = Current;
            double aspect = skin == null ? 1.0 : skin.Aspect;
            return Math.Max(16, (int)Math.Round(height * aspect));
        }

        /// <summary>Size of the two round corner buttons, in pixels.</summary>
        private int ButtonSize(int w, int h)
        {
            return Math.Max(40, Math.Min(78, (int)(Math.Min(w, h) * 0.09)));
        }

        /// <summary>
        /// The resize handle is a solid chip drawn *inside* the tile. It must be
        /// opaque: pixels with alpha 0 in a layered window are click-through, and
        /// the artwork's rounded corners are exactly that.
        /// </summary>
        private Rectangle GripRect(int w, int h)
        {
            int chip = ButtonSize(w, h);
            int inset = Math.Max(18, chip / 3);
            return new Rectangle(w - inset - chip, h - inset - chip, chip, chip);
        }

        /// <summary>The "next skin" button in the top-right corner.</summary>
        private Rectangle ArrowRect(int w, int h)
        {
            int chip = ButtonSize(w, h);
            int inset = Math.Max(18, chip / 3);
            return new Rectangle(w - inset - chip, inset, chip, chip);
        }

        public void Run()
        {
            LoadSkins();
            _resizeCursor = Native.LoadCursor(IntPtr.Zero, Native.IDC_SIZENWSE);
            _handCursor = Native.LoadCursor(IntPtr.Zero, Native.IDC_HAND);

            _wndProcDelegate = WindowProc;
            Native.WNDCLASSEX wc = new Native.WNDCLASSEX();
            wc.cbSize = Marshal.SizeOf(typeof(Native.WNDCLASSEX));
            wc.lpfnWndProc = _wndProcDelegate;
            wc.hInstance = Native.GetModuleHandle(null);
            wc.hCursor = Native.LoadCursor(IntPtr.Zero, Native.IDC_ARROW);
            wc.lpszClassName = WindowClass;
            ushort atom = Native.RegisterClassEx(ref wc);
            if (atom == 0)
            {
                int err = Marshal.GetLastWin32Error();
                if (err != 1410) throw new InvalidOperationException("RegisterClassEx failed: " + err);
            }

            // Explorer can restart and take the desktop window with it; recreate
            // our window instead of dying with it.
            while (!_quitting)
            {
                CreateAndRunWindow(wc.hInstance);
                if (_quitting) break;
                Log("window was destroyed (explorer restart?); recreating in 3s");
                Thread.Sleep(3000);
            }
        }

        private void CreateAndRunWindow(IntPtr hInstance)
        {
            Point pos = ResolvePosition();
            _config.X = pos.X;
            _config.Y = pos.Y;

            int winW = TileWidth(_config.Size);
            int winH = _config.Size;

            _hwnd = Native.CreateWindowEx(
                Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE,
                WindowClass, "DSH Web", Native.WS_POPUP,
                pos.X, pos.Y, winW, winH,
                IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);
            if (_hwnd == IntPtr.Zero)
                throw new InvalidOperationException("CreateWindowEx failed: " + Marshal.GetLastWin32Error());

            EmbedOnDesktop();
            ApplyTile(_config.Size, pos.X, pos.Y);
            Native.ShowWindow(_hwnd, Native.SW_SHOWNOACTIVATE);
            Native.SetTimer(_hwnd, TimerId, 1000, IntPtr.Zero);
            _balance.Start();

            Log("created hwnd=" + _hwnd.ToInt64().ToString("X", CultureInfo.InvariantCulture)
                + " parent=" + Native.GetParent(_hwnd).ToInt64().ToString("X", CultureInfo.InvariantCulture)
                + " size=" + winW + "x" + winH + " at " + pos.X + "," + pos.Y
                + " skin=" + (Current == null ? "none" : Current.FileName));

            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                Native.TranslateMessage(ref msg);
                Native.DispatchMessage(ref msg);
            }
            _hwnd = IntPtr.Zero;
        }

        /// <summary>
        /// Find the window that hosts the desktop icon layer (SHELLDLL_DefView).
        /// On Windows 11 with a wallpaper slideshow the icon view can live under a
        /// WorkerW window instead of Progman, and only the real host keeps the
        /// tile above the wallpaper.
        /// </summary>
        private static IntPtr _hostProbe;
        private static IntPtr _defViewProbe;

        private static IntPtr FindIconHost(out IntPtr defView)
        {
            IntPtr shell = Native.GetShellWindow();
            IntPtr dv = shell != IntPtr.Zero
                ? Native.FindWindowEx(shell, IntPtr.Zero, "SHELLDLL_DefView", null)
                : IntPtr.Zero;
            if (dv != IntPtr.Zero)
            {
                defView = dv;
                return shell;
            }

            _hostProbe = IntPtr.Zero;
            _defViewProbe = IntPtr.Zero;
            Native.EnumWindows(EnumTopLevelProbe, IntPtr.Zero);
            defView = _defViewProbe;
            return _hostProbe;
        }

        private static bool EnumTopLevelProbe(IntPtr hwnd, IntPtr lparam)
        {
            IntPtr dv = Native.FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (dv != IntPtr.Zero)
            {
                _hostProbe = hwnd;
                _defViewProbe = dv;
                return false;
            }
            return true;
        }

        private static string ClassNameOf(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "(null)";
            StringBuilder sb = new StringBuilder(256);
            Native.GetClassName(hwnd, sb, sb.Capacity);
            return sb.Length == 0 ? "(empty)" : sb.ToString();
        }

        /// <summary>Log the desktop window hierarchy (for --diagnose).</summary>
        public static void Diagnose()
        {
            IntPtr shell = Native.GetShellWindow();
            Log("diagnose: GetShellWindow=0x" + shell.ToInt64().ToString("X", CultureInfo.InvariantCulture)
                + " class=" + ClassNameOf(shell));
            IntPtr dv;
            IntPtr host = FindIconHost(out dv);
            Log("diagnose: icon host=0x" + host.ToInt64().ToString("X", CultureInfo.InvariantCulture)
                + " class=" + ClassNameOf(host)
                + " DefView=0x" + dv.ToInt64().ToString("X", CultureInfo.InvariantCulture)
                + " class=" + ClassNameOf(dv));
            if (dv != IntPtr.Zero)
            {
                IntPtr lv = Native.FindWindowEx(dv, IntPtr.Zero, "SysListView32", null);
                Log("diagnose: listview=0x" + lv.ToInt64().ToString("X", CultureInfo.InvariantCulture)
                    + " class=" + ClassNameOf(lv));
            }
        }

        /// <summary>
        /// Make the tile a child of the desktop window and put it above the icon
        /// layer, so it lives on the wallpaper and receives clicks.
        /// </summary>
        private void EmbedOnDesktop()
        {
            if (!_embed)
            {
                // Default: a plain top-level window held at the bottom of the
                // z-order. Verified on Windows 11 24H2: visible above the
                // wallpaper, clickable, and never in front of real windows.
                Native.SetWindowPos(_hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                Log("mode: bottom-most top-level window (default; pass --embed for desktop-embedded mode)");
                return;
            }

            IntPtr defView;
            IntPtr host = FindIconHost(out defView);
            if (host == IntPtr.Zero)
            {
                Native.SetWindowPos(_hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                Log("no desktop host window; falling back to bottom-most top-level window");
                return;
            }

            Native.SetParent(_hwnd, host);
            KeepAboveIcons();
            Log("embedded into desktop host 0x" + host.ToInt64().ToString("X", CultureInfo.InvariantCulture)
                + " (" + ClassNameOf(host) + "), DefView 0x" + defView.ToInt64().ToString("X", CultureInfo.InvariantCulture));
        }

        private void KeepAboveIcons()
        {
            if (_hwnd == IntPtr.Zero) return;
            // GetParent() reports 0 for the shell window, so trust WS_CHILD.
            int style = Native.GetWindowLong(_hwnd, Native.GWL_STYLE);
            if ((style & Native.WS_CHILD) == 0)
            {
                // Top-level variant: stay behind every normal window.
                Native.SetWindowPos(_hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                return;
            }
            // HWND_TOP among the desktop host's children = above the icon list view.
            Native.SetWindowPos(_hwnd, Native.HWND_TOP, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        /// <summary>
        /// Load every artwork in skins/ (sorted by file name = cycle order) and
        /// select the one remembered in meshfin-tile.ini. Falls back to the two legacy
        /// images next to the exe when skins/ is absent.
        /// </summary>
        private void LoadSkins()
        {
            _skins.Clear();

            string dir = Path.Combine(_appDir, "skins");
            if (Directory.Exists(dir))
            {
                string[] files = Directory.GetFiles(dir);
                Array.Sort(files, StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < files.Length; i++)
                {
                    string ext = Path.GetExtension(files[i]).ToLowerInvariant();
                    if (ext != ".png" && ext != ".jpg" && ext != ".jpeg") continue;
                    Skin skin = TryLoadSkin(files[i]);
                    if (skin != null) _skins.Add(skin);
                }
            }

            if (_skins.Count == 0)
            {
                string[] fallback = new string[] { "dsh-tile.png", "dsh-web.png" };
                for (int i = 0; i < fallback.Length && _skins.Count == 0; i++)
                {
                    string path = Path.Combine(_appDir, fallback[i]);
                    if (!File.Exists(path)) continue;
                    Skin skin = TryLoadSkin(path);
                    if (skin != null) _skins.Add(skin);
                }
            }

            _skinIndex = 0;
            if (_config.Skin.Length > 0)
            {
                for (int i = 0; i < _skins.Count; i++)
                {
                    if (string.Equals(_skins[i].FileName, _config.Skin, StringComparison.OrdinalIgnoreCase))
                    {
                        _skinIndex = i;
                        break;
                    }
                }
            }

            if (_config.SkinIndex > 0 && _config.SkinIndex <= _skins.Count)
                _skinIndex = _config.SkinIndex - 1;

            // The balance bubble ships as artwork next to the exe; the label
            // inside it is part of the picture, so only the number is drawn.
            string bubblePath = Path.Combine(_appDir, "balance-bubble.png");
            try
            {
                using (Image raw = Image.FromFile(bubblePath))
                {
                    Bitmap copy = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
                    using (Graphics g = Graphics.FromImage(copy))
                    {
                        g.CompositingMode = CompositingMode.SourceCopy;
                        g.DrawImageUnscaled(raw, 0, 0);
                    }
                    _bubbleArt = copy;
                }
            }
            catch (Exception ex)
            {
                Log("balance bubble artwork unavailable: " + ex.Message);
            }

            Log("skins loaded=" + _skins.Count + " current="
                + (_skins.Count == 0 ? "none" : _skins[_skinIndex].FileName)
                + " aspect=" + (_skins.Count == 0 ? "1" : _skins[_skinIndex].Aspect.ToString("0.###", CultureInfo.InvariantCulture)));
        }

        private Skin TryLoadSkin(string path)
        {
            try
            {
                using (Image raw = Image.FromFile(path))
                {
                    Bitmap copy = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
                    using (Graphics g = Graphics.FromImage(copy))
                    {
                        g.CompositingMode = CompositingMode.SourceCopy;
                        g.DrawImageUnscaled(raw, 0, 0);
                    }
                    Skin skin = new Skin();
                    skin.FileName = Path.GetFileName(path);
                    skin.Label = Path.GetFileNameWithoutExtension(path);
                    skin.Art = copy;
                    skin.Aspect = (double)copy.Width / copy.Height;
                    return skin;
                }
            }
            catch (Exception ex)
            {
                Log("skin " + Path.GetFileName(path) + " failed: " + ex.Message);
                return null;
            }
        }

        private Point ResolvePosition()
        {
            int screenW = Native.GetSystemMetrics(0);
            int screenH = Native.GetSystemMetrics(1);
            Native.RECT work = new Native.RECT();
            Native.SystemParametersInfo(Native.SPI_GETWORKAREA, 0, ref work, 0);

            if (_config.X != int.MinValue && _config.Y != int.MinValue)
            {
                int w = TileWidth(_config.Size);
                int h = _config.Size;
                int x = Math.Max(-w + 80, Math.Min(_config.X, screenW - 80));
                int y = Math.Max(-h + 80, Math.Min(_config.Y, screenH - 80));
                return new Point(x, y);
            }
            const int margin = 40;
            int right = work.Right > 0 ? work.Right : screenW;
            int bottom = work.Bottom > 0 ? work.Bottom : screenH;
            int defW = TileWidth(_config.Size);
            return new Point(right - defW - margin, bottom - _config.Size - margin);
        }

        /// <summary>Move the tile to a screen position (converted for the parent).</summary>
        private void MoveTo(int screenX, int screenY, int height)
        {
            Native.POINT pt = new Native.POINT();
            pt.X = screenX;
            pt.Y = screenY;
            IntPtr parent = Native.GetParent(_hwnd);
            if (parent != IntPtr.Zero) Native.ScreenToClient(parent, ref pt);
            Native.SetWindowPos(_hwnd, IntPtr.Zero, pt.X, pt.Y,
                TileWidth(height), height, Native.SWP_NOACTIVATE);
        }

        private Bitmap RenderTile(int w, int h, bool highlightGrip, bool highlightArrow)
        {
            // Premultiplied ARGB is exactly what UpdateLayeredWindow(ULW_ALPHA) wants.
            Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.Clear(Color.Transparent);

                Skin skin = Current;
                if (skin != null && skin.Art != null)
                {
                    g.DrawImage(skin.Art, new Rectangle(0, 0, w, h));
                }
                else
                {
                    int basis = Math.Min(w, h);
                    using (SolidBrush brush = new SolidBrush(Color.FromArgb(255, 24, 78, 168)))
                    using (Pen pen = new Pen(Color.FromArgb(255, 120, 200, 255), Math.Max(2f, basis / 64f)))
                    {
                        int inset = basis / 16;
                        Rectangle rect = new Rectangle(inset, inset, w - inset * 2, h - inset * 2);
                        g.FillEllipse(brush, rect);
                        g.DrawEllipse(pen, rect);
                    }
                    using (Font font = new Font("Segoe UI", basis / 6f, FontStyle.Bold, GraphicsUnit.Pixel))
                    using (SolidBrush text = new SolidBrush(Color.White))
                    {
                        StringFormat fmt = new StringFormat();
                        fmt.Alignment = StringAlignment.Center;
                        fmt.LineAlignment = StringAlignment.Center;
                        g.DrawString("DSH", font, text, new RectangleF(0, 0, w, h), fmt);
                    }
                }

                DrawBalance(g, w, h);
                DrawGrip(g, w, h, highlightGrip);
                DrawArrowButton(g, w, h, highlightArrow);
                DrawArrowButton(g, w, h, highlightArrow);
            }
            return bmp;
        }

        /// <summary>
        /// The balance bubble: the cloud artwork at the top-left with the
        /// balance drawn after its "余额：" label, inside the tile bitmap so it
        /// moves and scales with the tile. It shows the snapshot an agent reads
        /// from balance.json next to the exe, and a click without dragging asks
        /// the watcher to fetch again.
        /// </summary>
        private void DrawBalance(Graphics g, int w, int h)
        {
            _bubbleBounds = Rectangle.Empty;
            if (!_config.ShowBalance) return;
            int basis = Math.Min(w, h);
            if (basis < 150) return;   // below this the bubble would not be readable
            if (_bubbleArt == null) return;

            int inset = (int)(basis / 26f);
            int bubbleW = (int)(w * 0.60f);
            int bubbleH = Math.Max(1, (int)Math.Round(bubbleW * (double)_bubbleArt.Height / _bubbleArt.Width));
            Rectangle box = new Rectangle(inset, inset, bubbleW, bubbleH);
            g.DrawImage(_bubbleArt, box);
            _bubbleBounds = box;

            // Geometry read off the artwork: the label's colon ends at 35.5% of
            // the width, its glyphs sit on the vertical centre at 54.5%, and the
            // label cap height is 22.5% of the height.
            float fontSize = Math.Max(11f, bubbleH * 0.28f);
            RectangleF textBox = new RectangleF(
                box.Left + box.Width * 0.385f,
                box.Top + box.Height * 0.545f - bubbleH * 0.30f,
                box.Width * 0.58f,
                bubbleH * 0.60f);
            using (Font font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel))
            using (SolidBrush ink = new SolidBrush(BubbleInk()))
            using (StringFormat left = new StringFormat())
            {
                left.Alignment = StringAlignment.Near;
                left.LineAlignment = StringAlignment.Center;
                g.DrawString(BubbleText(), font, ink, textBox, left);
            }
        }

        /// <summary>The bubble's caption: the balance, or a dash while there is no snapshot.</summary>
        private string BubbleText()
        {
            if (!_balance.HasValue) return "--";
            return _balance.Symbol + _balance.Total;
        }

        /// <summary>Ink carries freshness: the label's own slate when current, amber when stale, red without a snapshot.</summary>
        private Color BubbleInk()
        {
            if (!_balance.HasValue) return Color.FromArgb(255, 168, 60, 60);
            bool stale = _balance.Age > TimeSpan.FromSeconds(Math.Max(180, _config.BalanceSeconds * 3));
            if (stale || !_balance.Available) return Color.FromArgb(255, 168, 106, 30);
            return Color.FromArgb(255, 68, 87, 111);
        }

        /// <summary>The corner resize affordance: a solid chip with diagonal lines.</summary>

        /// <summary>The corner resize affordance: a solid chip with diagonal lines.</summary>

        /// <summary>Human age of the snapshot, for the stale chip.</summary>
        private static string Describe(TimeSpan age)
        {
            if (age.TotalSeconds < 90) return "刚刚";
            if (age.TotalMinutes < 90) return (int)age.TotalMinutes + " 分钟前";
            return (int)age.TotalHours + " 小时前";
        }

        /// <summary>The corner resize affordance: a solid chip with diagonal lines.</summary>
        private void DrawGrip(Graphics g, int w, int h, bool highlight)
        {
            Rectangle chip = GripRect(w, h);
            float radius = chip.Width * 0.28f;
            float border = Math.Max(1.6f, Math.Min(w, h) / 220f);
            int bgAlpha = highlight ? 205 : 150;
            int lineAlpha = highlight ? 255 : 190;

            using (GraphicsPath path = RoundedRect(chip, radius))
            using (SolidBrush back = new SolidBrush(Color.FromArgb(bgAlpha, 8, 26, 62)))
            using (Pen edge = new Pen(Color.FromArgb(highlight ? 230 : 150, 150, 215, 255), border))
            using (Pen pen = new Pen(Color.FromArgb(lineAlpha, 255, 255, 255), Math.Max(1.6f, chip.Width / 22f)))
            {
                g.FillPath(back, path);
                g.DrawPath(edge, path);

                float pad = chip.Width * 0.28f;
                float step = chip.Width * 0.18f;
                for (int i = 0; i < 3; i++)
                {
                    float off = pad + i * step;
                    g.DrawLine(pen,
                        chip.Left + off, chip.Bottom - pad,
                        chip.Right - pad, chip.Top + off);
                }
            }
        }

        /// <summary>The "next skin" button: a circular arrow in the top-right corner.</summary>
        private void DrawArrowButton(Graphics g, int w, int h, bool highlight)
        {
            Rectangle btn = ArrowRect(w, h);
            float d = btn.Width;
            int bgAlpha = highlight ? 205 : 150;

            using (SolidBrush back = new SolidBrush(Color.FromArgb(bgAlpha, 8, 26, 62)))
            using (Pen edge = new Pen(Color.FromArgb(highlight ? 235 : 155, 150, 215, 255), Math.Max(1.6f, d / 40f)))
            {
                g.FillEllipse(back, btn);
                g.DrawEllipse(edge, btn);
            }

            float cx = btn.Left + d / 2f;
            float cy = btn.Top + d / 2f;
            float r = d * 0.30f;
            float penW = Math.Max(1.8f, d / 13f);
            int ink = highlight ? 255 : 210;

            using (Pen pen = new Pen(Color.FromArgb(ink, 255, 255, 255), penW))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                // A 300 degree clockwise arc: the gap at the top right takes the head.
                g.DrawArc(pen, cx - r, cy - r, r * 2f, r * 2f, -60f, 300f);

                double th = -60.0 * Math.PI / 180.0;
                float px = cx + (float)(Math.Cos(th) * r);
                float py = cy + (float)(Math.Sin(th) * r);
                float tx = -(float)Math.Sin(th);   // clockwise tangent
                float ty = (float)Math.Cos(th);
                float nx = -ty;
                float ny = tx;
                float a = penW * 1.9f;
                PointF apex = new PointF(px + tx * a * 1.15f, py + ty * a * 1.15f);
                PointF b1 = new PointF(px + nx * a * 0.85f, py + ny * a * 0.85f);
                PointF b2 = new PointF(px - nx * a * 0.85f, py - ny * a * 0.85f);
                using (SolidBrush head = new SolidBrush(Color.FromArgb(ink, 255, 255, 255)))
                {
                    g.FillPolygon(head, new PointF[] { apex, b1, b2 });
                }
            }
        }

        private static GraphicsPath RoundedRect(Rectangle rect, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float d = radius * 2f;
            path.AddArc(rect.Left, rect.Top, d, d, 180f, 90f);
            path.AddArc(rect.Right - d, rect.Top, d, d, 270f, 90f);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0f, 90f);
            path.AddArc(rect.Left, rect.Bottom - d, d, d, 90f, 90f);
            path.CloseFigure();
            return path;
        }

        private void ApplyTile(int height, int screenX, int screenY)
        {
            int w = TileWidth(height);
            int h = height;
            Bitmap bmp = RenderTile(w, h, _hoverGrip, _hoverArrow);
            IntPtr hBitmap = CreatePremultipliedDib(bmp);
            int bmpW = bmp.Width;
            int bmpH = bmp.Height;
            bmp.Dispose();

            if (hBitmap == IntPtr.Zero)
            {
                Log("CreateDIBSection failed: " + Marshal.GetLastWin32Error());
                return;
            }

            IntPtr screenDc = Native.GetDC(IntPtr.Zero);
            IntPtr memDc = Native.CreateCompatibleDC(screenDc);
            IntPtr oldBitmap = IntPtr.Zero;
            try
            {
                oldBitmap = Native.SelectObject(memDc, hBitmap);

                Native.POINT dst = new Native.POINT();
                dst.X = screenX;
                dst.Y = screenY;
                Native.SIZE sizeStruct = new Native.SIZE();
                sizeStruct.cx = bmpW;
                sizeStruct.cy = bmpH;
                Native.POINT src = new Native.POINT();
                src.X = 0;
                src.Y = 0;
                Native.BLENDFUNCTION blend = new Native.BLENDFUNCTION();
                blend.BlendOp = Native.AC_SRC_OVER;
                blend.BlendFlags = 0;
                blend.SourceConstantAlpha = 255;
                blend.AlphaFormat = Native.AC_SRC_ALPHA;

                bool ok = Native.UpdateLayeredWindow(_hwnd, screenDc, ref dst, ref sizeStruct,
                    memDc, ref src, 0, ref blend, Native.ULW_ALPHA);
                if (!ok) Log("UpdateLayeredWindow failed: " + Marshal.GetLastWin32Error());
            }
            finally
            {
                if (oldBitmap != IntPtr.Zero) Native.SelectObject(memDc, oldBitmap);
                Native.DeleteDC(memDc);
                Native.ReleaseDC(IntPtr.Zero, screenDc);
            }

            if (_hBitmap != IntPtr.Zero) Native.DeleteObject(_hBitmap);
            _hBitmap = hBitmap;
            _bitmapSize = bmpW;
        }

        private static IntPtr CreatePremultipliedDib(Bitmap bmp)
        {
            Native.BITMAPINFO bmi = new Native.BITMAPINFO();
            bmi.bmiHeader.biSize = Marshal.SizeOf(typeof(Native.BITMAPINFOHEADER));
            bmi.bmiHeader.biWidth = bmp.Width;
            bmi.bmiHeader.biHeight = -bmp.Height;
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = Native.DIB_RGB_COLORS;

            IntPtr bits;
            IntPtr hBitmap = Native.CreateDIBSection(IntPtr.Zero, ref bmi, Native.DIB_RGB_COLORS,
                out bits, IntPtr.Zero, 0);
            if (hBitmap == IntPtr.Zero) return IntPtr.Zero;

            BitmapData data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height),
                ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            try
            {
                int rowBytes = bmp.Width * 4;
                byte[] row = new byte[rowBytes];
                for (int y = 0; y < bmp.Height; y++)
                {
                    Marshal.Copy((IntPtr)(data.Scan0.ToInt64() + y * data.Stride), row, 0, rowBytes);
                    Marshal.Copy(row, 0, (IntPtr)(bits.ToInt64() + y * rowBytes), rowBytes);
                }
            }
            finally
            {
                bmp.UnlockBits(data);
            }
            return hBitmap;
        }

        private enum Zone { None, Body, Grip, Arrow, Bubble }

        private bool InsideZone(Native.POINT pt, Rectangle rect, int slack)
        {
            return pt.X >= _config.X + rect.Left - slack
                && pt.Y >= _config.Y + rect.Top - slack
                && pt.X <= _config.X + rect.Right + slack
                && pt.Y <= _config.Y + rect.Bottom + slack;
        }

        private Zone ZoneAt(Native.POINT screenPt)
        {
            int w = TileWidth(_config.Size);
            int h = _config.Size;
            if (!_bubbleBounds.IsEmpty && InsideZone(screenPt, _bubbleBounds, 0)) return Zone.Bubble;
            Rectangle grip = GripRect(w, h);
            int slack = Math.Max(8, grip.Width / 5);
            if (InsideZone(screenPt, grip, slack)) return Zone.Grip;
            Rectangle arrow = ArrowRect(w, h);
            if (InsideZone(screenPt, arrow, slack)) return Zone.Arrow;
            if (screenPt.X >= _config.X && screenPt.X <= _config.X + w
                && screenPt.Y >= _config.Y && screenPt.Y <= _config.Y + h) return Zone.Body;
            return Zone.None;
        }

        private IntPtr WindowProc(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam)
        {
            switch (msg)
            {
                case Native.WM_MOUSEACTIVATE:
                    return (IntPtr)Native.MA_NOACTIVATE;

                case Native.WM_SETCURSOR:
                    Native.POINT cursorPt;
                    Native.GetCursorPos(out cursorPt);
                    Zone cursorZone = ZoneAt(cursorPt);
                    if (cursorZone == Zone.Grip)
                    {
                        Native.SetCursor(_resizeCursor);
                        return (IntPtr)1;
                    }
                    if (cursorZone == Zone.Arrow)
                    {
                        Native.SetCursor(_handCursor);
                        return (IntPtr)1;
                    }
                    Native.SetCursor(Native.LoadCursor(IntPtr.Zero, Native.IDC_ARROW));
                    return (IntPtr)1;

                case Native.WM_SYSCOMMAND:
                    if (((int)wParam & 0xFFF0) == Native.SC_MINIMIZE)
                        return IntPtr.Zero;   // Win+D must not hide the tile
                    break;

                case Native.WM_PAINT:
                    Native.ValidateRect(hWnd, IntPtr.Zero);
                    return IntPtr.Zero;

                case Native.WM_ERASEBKGND:
                    return (IntPtr)1;

                case Native.WM_TIMER:
                    KeepAboveIcons();
                    if (_balance.Generation != _renderedBalanceGeneration)
                    {
                        _renderedBalanceGeneration = _balance.Generation;
                        ApplyTile(_config.Size, _config.X, _config.Y);
                    }
                    return IntPtr.Zero;

                case Native.WM_LBUTTONDOWN:
                {
                    Native.POINT pt;
                    Native.GetCursorPos(out pt);
                    Zone zone = ZoneAt(pt);
                    _dragging = true;
                    _resizing = (zone == Zone.Grip);
                    _arrowPress = (zone == Zone.Arrow);
                    _bubblePress = (zone == Zone.Bubble);
                    _dragDistance = 0;
                    _dragOriginCursor = pt;
                    _dragOriginX = _config.X;
                    _dragOriginY = _config.Y;
                    _dragOriginSize = _config.Size;
                    Native.SetCapture(hWnd);
                    Log("mouse down at " + pt.X + "," + pt.Y + " zone=" + zone
                        + " tile=" + _config.X + "," + _config.Y + " " + _config.Size);
                    return IntPtr.Zero;
                }

                case Native.WM_MOUSEMOVE:
                {
                    Native.POINT now;
                    Native.GetCursorPos(out now);

                    if (!_dragging)
                    {
                        Zone hoverZone = ZoneAt(now);
                        bool overGrip = (hoverZone == Zone.Grip);
                        bool overArrow = (hoverZone == Zone.Arrow);
                        if (overGrip != _hoverGrip || overArrow != _hoverArrow)
                        {
                            _hoverGrip = overGrip;
                            _hoverArrow = overArrow;
                            ApplyTile(_config.Size, _config.X, _config.Y);
                        }
                        return IntPtr.Zero;
                    }

                    int dx = now.X - _dragOriginCursor.X;
                    int dy = now.Y - _dragOriginCursor.Y;
                    _dragDistance = Math.Abs(dx) + Math.Abs(dy);
                    if (_dragDistance < 3) return IntPtr.Zero;
                    if (_dragDistance < 40) Log("drag move dx=" + dx + " dy=" + dy
                        + " resize=" + _resizing + " size=" + _config.Size);

                    if (_resizing)
                    {
                        // Grow from the top-left corner, following the cursor.
                        int wanted = _dragOriginSize + Math.Max(dx, dy);
                        int size = Math.Max(TileConfig.MinSize, Math.Min(TileConfig.MaxSize, wanted));
                        if (size != _config.Size)
                        {
                            _config.Size = size;
                            MoveTo(_config.X, _config.Y, size);
                            ApplyTile(size, _config.X, _config.Y);
                        }
                    }
                    else
                    {
                        _config.X = _dragOriginX + dx;
                        _config.Y = _dragOriginY + dy;
                        MoveTo(_config.X, _config.Y, _config.Size);
                        ApplyTile(_config.Size, _config.X, _config.Y);
                    }
                    return IntPtr.Zero;
                }

                case Native.WM_LBUTTONUP:
                {
                    if (!_dragging) break;
                    bool wasResize = _resizing;
                    bool wasArrow = _arrowPress;
                    bool wasBubble = _bubblePress;
                    _dragging = false;
                    _resizing = false;
                    _arrowPress = false;
                    _bubblePress = false;
                    Native.ReleaseCapture();
                    if (_dragDistance < 6)
                    {
                        if (wasArrow) NextSkin();
                        else if (wasBubble) { _balance.RefreshNow(); Log("balance refresh requested"); }
                        else if (!wasResize) Launch();
                    }
                    else
                    {
                        _config.Save(_appDir);
                        Log((wasResize ? "resized to " : "moved to ") + _config.Size + " " + _config.X + "," + _config.Y);
                    }
                    return IntPtr.Zero;
                }

                case Native.WM_MOUSEWHEEL:
                {
                    int delta = (short)((wParam.ToInt64() >> 16) & 0xFFFF);
                    int step = Math.Max(20, _config.Size / 12);
                    int wanted = _config.Size + (delta > 0 ? step : -step);
                    int size = Math.Max(TileConfig.MinSize, Math.Min(TileConfig.MaxSize, wanted));
                    if (size != _config.Size)
                    {
                        _config.Size = size;
                        MoveTo(_config.X, _config.Y, size);
                        ApplyTile(size, _config.X, _config.Y);
                        _config.Save(_appDir);
                    }
                    return IntPtr.Zero;
                }

                case Native.WM_RBUTTONUP:
                    ShowMenu();
                    return IntPtr.Zero;

                case Native.WM_DESTROY:
                    Native.KillTimer(hWnd, TimerId);
                    _balance.Stop();
                    if (_hBitmap != IntPtr.Zero)
                    {
                        Native.DeleteObject(_hBitmap);
                        _hBitmap = IntPtr.Zero;
                    }
                    if (_quitting) Native.PostQuitMessage(0);
                    else Native.PostQuitMessage(0);   // Run() recreates the window
                    return IntPtr.Zero;
            }
            return Native.DefWindowProc(hWnd, msg, wParam, lParam);
        }

        /// <summary>Menu label carrying the current balance and its last failure.</summary>
        private string BalanceMenuLabel()
        {
            if (!_balance.HasValue) return "余额：（暂无数据）";
            string label = "余额：" + _balance.Symbol + _balance.Total + "（点此刷新）";
            if (_balance.Error.Length > 0) label += "  上次失败：" + _balance.Error;
            return label;
        }

        private void ShowMenu()
        {
            Native.POINT pt;
            Native.GetCursorPos(out pt);

            IntPtr menu = Native.CreatePopupMenu();
            IntPtr sizeMenu = Native.CreatePopupMenu();
            IntPtr skinMenu = Native.CreatePopupMenu();
            try
            {
                Native.AppendMenu(menu, Native.MF_STRING, (IntPtr)CmdLaunch, "启动 DSH Web");
                for (int i = 0; i < SizePresets.Length; i++)
                {
                    int flags = Native.MF_STRING;
                    if (_config.Size == SizePresets[i]) flags |= Native.MF_CHECKED;
                    Native.AppendMenu(sizeMenu, flags, (IntPtr)(CmdSizeBase + i),
                        SizePresets[i].ToString(CultureInfo.InvariantCulture) + " px");
                }
                Native.AppendMenu(menu, Native.MF_POPUP, sizeMenu, "尺寸");
                for (int i = 0; i < _skins.Count; i++)
                {
                    int flags = Native.MF_STRING;
                    if (i == _skinIndex) flags |= Native.MF_CHECKED;
                    Native.AppendMenu(skinMenu, flags, (IntPtr)(CmdSkinBase + i),
                        (i + 1).ToString(CultureInfo.InvariantCulture) + "/"
                        + _skins.Count.ToString(CultureInfo.InvariantCulture) + "  " + _skins[i].Label);
                }
                Native.AppendMenu(menu, Native.MF_POPUP, skinMenu, "皮肤（左键点右上角箭头切换）");
                Native.AppendMenu(menu, Native.MF_STRING, (IntPtr)CmdResetSize,
                    "重置尺寸为 " + TileConfig.DefaultSize + " px");
                Native.AppendMenu(menu, Native.MF_STRING, (IntPtr)CmdOpenFolder, "打开所在文件夹");
                Native.AppendMenu(menu, Native.MF_STRING, (IntPtr)CmdRefreshBalance, BalanceMenuLabel());
                Native.AppendMenu(menu, _config.ShowBalance ? Native.MF_STRING | Native.MF_CHECKED : Native.MF_STRING,
                    (IntPtr)CmdToggleBalance, "显示余额");
                Native.AppendMenu(menu, Native.MF_SEPARATOR, IntPtr.Zero, null);
                Native.AppendMenu(menu, Native.MF_STRING, (IntPtr)CmdQuit, "退出启动块");

                Native.SetForegroundWindow(_hwnd);
                int cmd = Native.TrackPopupMenu(menu, Native.TPM_RETURNCMD | Native.TPM_RIGHTBUTTON,
                    pt.X, pt.Y, 0, _hwnd, IntPtr.Zero);
                Native.PostMessage(_hwnd, Native.WM_NULL, IntPtr.Zero, IntPtr.Zero);

                if (cmd == CmdLaunch) Launch();
                else if (cmd == CmdOpenFolder) OpenFolder();
                else if (cmd == CmdRefreshBalance) _balance.RefreshNow();
                else if (cmd == CmdToggleBalance)
                {
                    _config.ShowBalance = !_config.ShowBalance;
                    _config.Save(_appDir);
                    ApplyTile(_config.Size, _config.X, _config.Y);
                }
                else if (cmd == CmdResetSize) SetTileSize(TileConfig.DefaultSize);
                else if (cmd == CmdQuit)
                {
                    _quitting = true;
                    Native.DestroyWindow(_hwnd);
                }
                else if (cmd >= CmdSizeBase && cmd < CmdSizeBase + SizePresets.Length)
                    SetTileSize(SizePresets[cmd - CmdSizeBase]);
                else if (cmd >= CmdSkinBase && cmd < CmdSkinBase + _skins.Count)
                    SetSkin(cmd - CmdSkinBase);
            }
            finally
            {
                Native.DestroyMenu(skinMenu);
                Native.DestroyMenu(sizeMenu);
                Native.DestroyMenu(menu);
            }
        }

        private void SetTileSize(int size)
        {
            int cx = _config.X + TileWidth(_config.Size) / 2;
            int cy = _config.Y + _config.Size / 2;

            _config.Size = Math.Max(TileConfig.MinSize, Math.Min(TileConfig.MaxSize, size));
            _config.X = cx - TileWidth(_config.Size) / 2;
            _config.Y = cy - _config.Size / 2;
            ClampToScreen();

            MoveTo(_config.X, _config.Y, _config.Size);
            ApplyTile(_config.Size, _config.X, _config.Y);
            _config.Save(_appDir);
        }

        /// <summary>Keep the tile from drifting completely off the primary screen.</summary>
        private void ClampToScreen()
        {
            int screenW = Native.GetSystemMetrics(0);
            int screenH = Native.GetSystemMetrics(1);
            int w = TileWidth(_config.Size);
            int h = _config.Size;
            _config.X = Math.Max(-w + 80, Math.Min(_config.X, screenW - 80));
            _config.Y = Math.Max(-h + 80, Math.Min(_config.Y, screenH - 80));
        }

        private void SetSkin(int index)
        {
            if (index < 0 || index >= _skins.Count) return;
            _skinIndex = index;
            _config.Skin = _skins[index].FileName;
            ClampToScreen();
            MoveTo(_config.X, _config.Y, _config.Size);
            ApplyTile(_config.Size, _config.X, _config.Y);
            _config.Save(_appDir);
            Log("skin -> " + _skins[index].FileName + " ("
                + TileWidth(_config.Size) + "x" + _config.Size + ")");
        }

        private void NextSkin()
        {
            if (_skins.Count == 0) return;
            SetSkin((_skinIndex + 1) % _skins.Count);
        }

        private void Launch()
        {
            // The launcher sits one level above the tile, beside the other Windows files.
            string cmd = Path.GetFullPath(Path.Combine(_appDir, "..", "start-meshfin.cmd"));
            if (!File.Exists(cmd))
            {
                Log("start-meshfin.cmd missing: " + cmd);
                return;
            }
            try
            {
                System.Diagnostics.ProcessStartInfo info = new System.Diagnostics.ProcessStartInfo();
                info.FileName = cmd;
                info.WorkingDirectory = _appDir;
                info.UseShellExecute = true;
                System.Diagnostics.Process.Start(info);
                Log("launched " + cmd);
            }
            catch (Exception ex)
            {
                Log("launch failed: " + ex.Message);
            }
        }

        private void OpenFolder()
        {
            try
            {
                System.Diagnostics.ProcessStartInfo info = new System.Diagnostics.ProcessStartInfo();
                info.FileName = _appDir;
                info.UseShellExecute = true;
                System.Diagnostics.Process.Start(info);
            }
            catch { }
        }

        public static void Main(string[] args)
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew) return;

                try
                {
                    Native.SetProcessDPIAware();

                    string appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                    if (Array.IndexOf(args, "--diagnose") >= 0)
                    {
                        Diagnose();
                        return;
                    }
                    TileConfig config = TileConfig.Load(appDir);
                    ApplyCommandLine(config, args);
                    // A configured fetcher is the precondition for the balance chip.
                    if (config.BalanceScript.Length == 0) config.ShowBalance = false;
                    new TileApp(appDir, config, Array.IndexOf(args, "--embed") >= 0).Run();
                }
                catch (Exception ex)
                {
                    Log("fatal: " + ex);
                }
            }
        }

        private static void ApplyCommandLine(TileConfig config, string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                int value;
                if (a == "--size" && i + 1 < args.Length
                    && int.TryParse(args[i + 1], out value) && value >= TileConfig.MinSize && value <= TileConfig.MaxSize)
                {
                    config.Size = value;
                    i++;
                }
                else if (a == "--skin" && i + 1 < args.Length
                    && int.TryParse(args[i + 1], out value) && value >= 1)
                {
                    config.SkinIndex = value;
                    i++;
                }
                else if (a == "--reset")
                {
                    config.X = int.MinValue;
                    config.Y = int.MinValue;
                }
            }
        }
    }
}
