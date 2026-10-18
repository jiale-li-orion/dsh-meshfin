package com.dsh.shell;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;

/**
 * The shell's single window: one WebView over the DSH web application.
 *
 * The point of the shell is to own the layer a phone's own browser does not let
 * us control: which assets are cached, which resolver runs, and whether the
 * event stream survives the app being backgrounded.
 *
 * The page targets a browser, so every WebView default that differs from one is
 * overridden here rather than discovered later as a feature that silently does
 * nothing: pinch zoom, layout viewport, text scaling, file selection for
 * attachments, download handling, and links that open a new window.
 */
public class MainActivity extends Activity {

    private static final String TAG = "DshShell";
    private static final int FILE_CHOOSER_REQUEST = 1;

    /**
     * The tailnet endpoint this shell serves. The name is what the certificate
     * is issued for and what the gateway passes as SNI; the address is what it
     * dials, so no resolver on the phone is involved.
     */
    private static final String UPSTREAM_HOST = "node.tail0d75db.ts.net";
    private static final String UPSTREAM_ADDRESS = "100.77.160.68";
    private static final int UPSTREAM_PORT = 443;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private LoopbackProxy proxy;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // The client caches its own bundles by content revision; the shell must
        // not force every load to revalidate them.
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Lay out against the page's own viewport, like a phone browser does.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        // Pinch zoom is the escape hatch a cramped layout relies on in a
        // browser; an embedded WebView turns it off by default.
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        // WebView scales text by the system font scale while leaving the layout
        // width alone, which is what makes one page look cramped here and fine
        // in a browser. Web content follows the page, not the system setting.
        settings.setTextZoom(100);
        // A page that opens a link in a new window must not end up nowhere.
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });
        web.setWebChromeClient(new ShellChromeClient());
        web.setDownloadListener(new ShellDownloads());
        web.setBackgroundColor(0xFF151517);
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (state == null) web.loadUrl(startOrigin());
    }

    /**
     * Origin to load: the loopback gateway when it is up, the named origin when
     * it is not. The fallback keeps the app usable on a phone whose resolver
     * happens to work, at the cost of the secure context the loopback origin
     * provides.
     */
    /**
     * The page URL this shell loads.
     *
     * The shell is the only client that can know it is an app, so it says so on
     * the URL: the page samples that once and reports the class with every
     * prompt, which is how the model learns a message came from a phone app
     * rather than a phone browser. The query survives a reload of this URL and
     * nothing else depends on it.
     */
    private static String shellOrigin(String origin) {
        return origin + "?dsh-shell=android";
    }

    private String startOrigin() {
        try {
            proxy = new LoopbackProxy(0, UPSTREAM_HOST, UPSTREAM_ADDRESS, UPSTREAM_PORT,
                    new GatewayCache(new java.io.File(getFilesDir(), "gateway-cache")));
            proxy.start();
            Log.i(TAG, "gateway " + proxy.origin() + " -> " + UPSTREAM_HOST + " (" + UPSTREAM_ADDRESS + ":" + UPSTREAM_PORT + ")");
            return shellOrigin(proxy.origin());
        } catch (IOException error) {
            Log.w(TAG, "gateway unavailable, loading the named origin: " + error.getMessage());
            return shellOrigin("https://" + UPSTREAM_HOST + "/");
        }
    }

    @Override
    protected void onDestroy() {
        if (proxy != null) proxy.close();
        super.onDestroy();
    }

    /** Browser behaviour the page depends on: file selection, console, new-window links. */
    private final class ShellChromeClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
            } catch (ActivityNotFoundException error) {
                fileCallback = null;
                Log.w(TAG, "no activity can pick a file: " + error.getMessage());
                return false;
            }
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // One window is the design: a target="_blank" link is followed in
            // place instead of opening a second view nobody sees.
            WebView relay = new WebView(MainActivity.this);
            relay.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest request) {
                    web.loadUrl(request.getUrl().toString());
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(relay);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.i(TAG, message.message() + " @" + message.sourceId() + ":" + message.lineNumber());
            return true;
        }
    }

    /** Downloads the page starts are handed to the system downloader, as in a browser. */
    private final class ShellDownloads implements DownloadListener {

        @Override
        public void onDownloadStart(String url, String userAgent, String disposition, String mimeType, long length) {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                        URLUtil.guessFileName(url, disposition, mimeType));
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (manager != null) manager.enqueue(request);
            } catch (RuntimeException error) {
                Log.w(TAG, "download failed for " + url + ": " + error.getMessage());
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override
    protected void onRestoreInstanceState(Bundle state) {
        super.onRestoreInstanceState(state);
        web.restoreState(state);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
