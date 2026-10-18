package com.dsh.shell;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

import javax.net.ssl.SNIHostName;
import javax.net.ssl.SNIServerName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Loopback HTTP gateway to the tailnet endpoint.
 *
 * The phone's own resolver decides whether a named host is reachable, and on
 * Android that resolver can wedge — the failure surfaced as
 * ERR_NAME_NOT_RESOLVED while the tunnel itself answered pings. So the shell
 * owns the layer: the WebView talks to 127.0.0.1 in the clear and this gateway
 * opens the TLS connection to the tailnet address itself, passing the hostname
 * as SNI so the certificate is still verified against the name rather than the
 * address.
 *
 * Serving the page from a loopback origin also puts it inside a browser secure
 * context, which is what the clipboard, crypto.randomUUID and file selection
 * need and what a plain-HTTP fallback entry could not provide.
 *
 * The gateway is transparent by design: it forwards the request it received,
 * including its Host and Origin, so the host sees the loopback authority the
 * WebView actually used. It rewrites no application header.
 */
final class LoopbackProxy implements Closeable {

    private static final String TAG = "DshShell";
    /** Request head ceiling: a head larger than this is a broken client, not a request to serve. */
    private static final int MAX_HEAD_BYTES = 64 * 1024;
    private static final int COPY_BUFFER = 32 * 1024;

    private final GatewayCache cache;
    private final String upstreamHost;
    private final String upstreamAddress;
    private final int upstreamPort;
    private final ServerSocket listener;
    private final Thread acceptor;
    private final AtomicInteger live = new AtomicInteger();
    private volatile boolean closed;

    /**
     * @param listenPort loopback port to serve the WebView on.
     * @param upstreamHost hostname the certificate is issued for.
     * @param upstreamAddress resolved tailnet address to connect to.
     * @param upstreamPort TLS port on that address.
     */
    LoopbackProxy(int listenPort, String upstreamHost, String upstreamAddress, int upstreamPort, GatewayCache cache) throws IOException {
        this.cache = cache;
        this.upstreamHost = upstreamHost;
        this.upstreamAddress = upstreamAddress;
        this.upstreamPort = upstreamPort;
        this.listener = new ServerSocket();
        this.listener.setReuseAddress(true);
        this.listener.bind(new InetSocketAddress("127.0.0.1", listenPort));
        this.acceptor = new Thread(this::acceptLoop, "dsh-proxy-accept");
        this.acceptor.setDaemon(true);
    }

    /** @return the bound loopback port; 0 was requested as "any". */
    int port() {
        return listener.getLocalPort();
    }

    /** @return loopback origin the WebView should load. */
    String origin() {
        return "http://127.0.0.1:" + port() + "/";
    }

    void start() {
        acceptor.start();
    }

    @Override
    public void close() {
        closed = true;
        try {
            listener.close();
        } catch (IOException error) {
            Log.w(TAG, "proxy listener close: " + error.getMessage());
        }
    }

    private void acceptLoop() {
        while (!closed) {
            Socket client;
            try {
                client = listener.accept();
            } catch (IOException error) {
                if (!closed) Log.w(TAG, "proxy accept: " + error.getMessage());
                return;
            }
            Thread worker = new Thread(() -> serve(client), "dsh-proxy-" + live.incrementAndGet());
            worker.setDaemon(true);
            worker.start();
        }
    }

    private void serve(Socket client) {
        try {
            client.setTcpNoDelay(true);
            InputStream fromClient = new BufferedInputStream(client.getInputStream());
            OutputStream toClient = new BufferedOutputStream(client.getOutputStream());
            byte[] head = readHead(fromClient);
            if (head == null) return;
            List<String> lines = splitHead(head);
            boolean upgrade = isUpgrade(lines);
            String requestLine = lines.get(0);
            String method = requestLine.substring(0, Math.max(0, requestLine.indexOf(' ')));
            String target = target(requestLine);
            String cacheKey = method + " " + target.split("#", 2)[0];
            boolean revisioned = GatewayCache.isCacheable(method, pathOnly(target));
            if (!upgrade && revisioned) {
                GatewayCache.Entry hit = cache.lookup(cacheKey);
                if (hit != null) {
                    replay(toClient, hit);
                    return;
                }
            }

            SSLSocket upstream = connect();
            try {
                OutputStream toUpstream = new BufferedOutputStream(upstream.getOutputStream());
                InputStream fromUpstream = new BufferedInputStream(upstream.getInputStream());
                toUpstream.write(rebuild(lines, upgrade));
                toUpstream.flush();

                if (isChunked(lines)) {
                    // The framing is the body: it is forwarded verbatim, or the
                    // host would wait for a terminator that never arrives.
                    copyChunked(fromClient, toUpstream);
                    toUpstream.flush();
                } else {
                    long bodyLength = contentLength(lines);
                    if (bodyLength > 0) {
                        copyExactly(fromClient, toUpstream, bodyLength);
                        toUpstream.flush();
                    }
                }

                if (upgrade) {
                    // The tunnel is open: from here the two sockets are one pipe.
                    splice(fromClient, toClient, fromUpstream, toUpstream);
                    return;
                }
                relay(fromUpstream, toClient, revisioned ? cacheKey : null);
            } finally {
                upstream.close();
            }
        } catch (IOException error) {
            Log.w(TAG, "proxy connection: " + error.getMessage());
        } finally {
            live.decrementAndGet();
            try {
                client.close();
            } catch (IOException ignored) {
                // Closing an already-failed socket is not a state worth reporting.
            }
        }
    }

    /**
     * Forward the response to the client, and for a cacheable URL keep a decoded
     * copy. The body is buffered only for the entries worth storing: a start-up
     * bundle, not a session response.
     */
    private void relay(InputStream fromUpstream, OutputStream toClient, String cacheKey) throws IOException {
        // A null key means this URL names no fixed content, so its body is
        // forwarded and forgotten: caching it could pin a value that changes.
        byte[] rawHead = readHead(fromUpstream);
        if (rawHead == null) return;
        toClient.write(rawHead);
        List<String> headLines = splitHead(rawHead);
        String status = headLines.isEmpty() ? "" : headLines.get(0);
        String contentType = header(headLines, "Content-Type");
        String encoding = header(headLines, "Content-Encoding");
        boolean store = cache != null
                && status.contains(" 200 ")
                && cacheKey != null
                && GatewayCache.isCacheableType(contentType)
                // Brotli has no decoder in the platform library, so a brotli body
                // is forwarded without being kept rather than stored compressed.
                && (encoding == null || encoding.toLowerCase(java.util.Locale.ROOT).contains("gzip"));
        ByteArrayOutputStream decoded = store ? new ByteArrayOutputStream(1 << 20) : null;
        boolean complete = false;
        Inflater inflater = decoded != null && encoding != null ? new Inflater(true) : null;
        byte[] buffer = new byte[COPY_BUFFER];
        byte[] inflated = new byte[COPY_BUFFER];
        int read;
        while ((read = fromUpstream.read(buffer)) >= 0) {
            toClient.write(buffer, 0, read);
            if (inflater == null) {
                if (decoded != null) decoded.write(buffer, 0, read);
                continue;
            }
            inflater.setInput(buffer, 0, read);
            try {
                while (!inflater.needsInput()) {
                    int produced = inflater.inflate(inflated);
                    if (produced <= 0) break;
                    decoded.write(inflated, 0, produced);
                }
            } catch (DataFormatException error) {
                // A corrupt body is still delivered verbatim; it just is not kept.
                Log.w(TAG, "cache decode failed, forwarding only: " + error.getMessage());
                decoded = null;
                inflater = null;
            }
        }
        // Reaching this line means the upstream ended the body on its own terms:
        // a read that failed mid-stream leaves through the exception above.
        complete = true;
        toClient.flush();
        if (decoded == null || !complete) return;
        // An identity response is also held to the length it declared for itself;
        // a compressed one is checked against the digest the entry records.
        String declared = header(headLines, "Content-Length");
        if (encoding == null && declared != null && decoded.size() != parseLength(declared)) {
            Log.w(TAG, "not caching a body whose length does not match its header: " + cacheKey);
            return;
        }
        cache.store(cacheKey, decoded.toByteArray(), contentType);
    }

    /** Answer one request from the on-disk cache, decoded and length-delimited. */
    private static void replay(OutputStream toClient, GatewayCache.Entry entry) throws IOException {
        StringBuilder head = new StringBuilder(160);
        head.append("HTTP/1.1 200 OK\r\n");
        head.append("Content-Type: ").append(entry.contentType == null ? "application/octet-stream" : entry.contentType).append("\r\n");
        head.append("Content-Length: ").append(entry.body.length).append("\r\n");
        head.append("Cache-Control: public, max-age=31536000, immutable\r\n");
        head.append("X-Dsh-Cache: hit\r\n");
        head.append("Connection: close\r\n\r\n");
        toClient.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        toClient.write(entry.body);
        toClient.flush();
    }

    /** @return a declared length, or -1 when it is absent or unparsable. */
    private static long parseLength(String value) {
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException error) {
            return -1;
        }
    }

    /** @return the request target (path plus query) of one request line. */
    private static String target(String requestLine) {
        int first = requestLine.indexOf(' ');
        if (first < 0) return "/";
        int second = requestLine.indexOf(' ', first + 1);
        return second < 0 ? requestLine.substring(first + 1) : requestLine.substring(first + 1, second);
    }

    private static String pathOnly(String target) {
        int query = target.indexOf('?');
        return query < 0 ? target : target.substring(0, query);
    }

    private static String header(List<String> lines, String name) {
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i);
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            if (line.substring(0, colon).trim().equalsIgnoreCase(name)) return line.substring(colon + 1).trim();
        }
        return null;
    }

    private SSLSocket connect() throws IOException {
        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        SSLSocket socket = (SSLSocket) factory.createSocket();
        SSLParameters parameters = socket.getSSLParameters();
        List<SNIServerName> names = new ArrayList<>(1);
        names.add(new SNIHostName(upstreamHost));
        parameters.setServerNames(names);
        // Verify the certificate against the name, not the address we dialed.
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        socket.setSSLParameters(parameters);
        socket.connect(new InetSocketAddress(upstreamAddress, upstreamPort), 15000);
        socket.startHandshake();
        socket.setTcpNoDelay(true);
        return socket;
    }

    /**
     * Rebuild the request for the upstream connection: same request line, same
     * headers, with one change — a non-upgrade request asks for a close so the
     * response body ends at EOF and needs no length bookkeeping here.
     */
    private static byte[] rebuild(List<String> lines, boolean upgrade) {
        StringBuilder out = new StringBuilder(512);
        out.append(lines.get(0)).append("\r\n");
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i);
            if (line.isEmpty()) continue;
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String name = line.substring(0, colon).trim();
            if (!upgrade && (name.equalsIgnoreCase("Connection") || name.equalsIgnoreCase("Proxy-Connection"))) continue;
            out.append(line).append("\r\n");
        }
        if (!upgrade) out.append("Connection: close\r\n");
        out.append("\r\n");
        return out.toString().getBytes(StandardCharsets.ISO_8859_1);
    }

    private static boolean isUpgrade(List<String> lines) {
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i).toLowerCase(java.util.Locale.ROOT);
            if (line.startsWith("upgrade:") && line.contains("websocket")) return true;
        }
        return false;
    }

    private static boolean isChunked(List<String> lines) {
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i).toLowerCase(java.util.Locale.ROOT);
            if (line.startsWith("transfer-encoding:") && line.contains("chunked")) return true;
        }
        return false;
    }

    /** Forward a chunked body frame by frame, ending after the zero-length chunk. */
    private static void copyChunked(InputStream from, OutputStream to) throws IOException {
        while (true) {
            String sizeLine = readLine(from);
            if (sizeLine == null) throw new IOException("client closed inside a chunked body");
            to.write((sizeLine + "\r\n").getBytes(StandardCharsets.ISO_8859_1));
            int semicolon = sizeLine.indexOf(';');
            String size = (semicolon < 0 ? sizeLine : sizeLine.substring(0, semicolon)).trim();
            long chunk;
            try {
                chunk = Long.parseLong(size, 16);
            } catch (NumberFormatException error) {
                throw new IOException("malformed chunk size: " + sizeLine);
            }
            if (chunk == 0) {
                // Trailers, then the blank line that ends the body.
                String trailer;
                while ((trailer = readLine(from)) != null && !trailer.isEmpty()) {
                    to.write((trailer + "\r\n").getBytes(StandardCharsets.ISO_8859_1));
                }
                to.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
                return;
            }
            copyExactly(from, to, chunk);
            to.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
            readLine(from);
        }
    }

    /** @return one CRLF-terminated line without its terminator, or null at EOF. */
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream(64);
        int next;
        while ((next = in.read()) >= 0) {
            if (next == '\n') {
                byte[] bytes = line.toByteArray();
                int length = bytes.length > 0 && bytes[bytes.length - 1] == '\r' ? bytes.length - 1 : bytes.length;
                return new String(bytes, 0, length, StandardCharsets.ISO_8859_1);
            }
            line.write(next);
            if (line.size() > 8192) throw new IOException("chunk header too long");
        }
        return null;
    }

    private static long contentLength(List<String> lines) {
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i);
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            if (!line.substring(0, colon).trim().equalsIgnoreCase("Content-Length")) continue;
            try {
                return Long.parseLong(line.substring(colon + 1).trim());
            } catch (NumberFormatException error) {
                return 0;
            }
        }
        return 0;
    }

    private static void copyExactly(InputStream from, OutputStream to, long length) throws IOException {
        byte[] buffer = new byte[COPY_BUFFER];
        long remaining = length;
        while (remaining > 0) {
            int read = from.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) throw new IOException("client closed mid-body");
            to.write(buffer, 0, read);
            remaining -= read;
        }
    }

    private static void splice(InputStream a, OutputStream aOut, InputStream b, OutputStream bOut) {
        Thread pump = new Thread(() -> pipe(a, bOut), "dsh-proxy-up");
        pump.setDaemon(true);
        pump.start();
        pipe(b, aOut);
    }

    private static void pipe(InputStream from, OutputStream to) {
        byte[] buffer = new byte[COPY_BUFFER];
        try {
            int read;
            while ((read = from.read(buffer)) >= 0) {
                to.write(buffer, 0, read);
                to.flush();
            }
        } catch (IOException ignored) {
            // Either side going away ends the pipe; the peer notices on its own read.
        }
    }

    /** @return the raw request head including the terminating blank line, or null at clean EOF. */
    private static byte[] readHead(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream(1024);
        int state = 0;
        int next;
        while ((next = in.read()) >= 0) {
            head.write(next);
            if ((state == 0 || state == 2) && next == '\r') state++;
            else if ((state == 1 || state == 3) && next == '\n') state++;
            else state = next == '\r' ? 1 : 0;
            if (state == 4) return head.toByteArray();
            if (head.size() > MAX_HEAD_BYTES) throw new IOException("request head exceeds " + MAX_HEAD_BYTES + " bytes");
        }
        return null;
    }

    private static List<String> splitHead(byte[] head) {
        String text = new String(head, StandardCharsets.ISO_8859_1);
        List<String> lines = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            int end = text.indexOf("\r\n", start);
            if (end < 0) break;
            lines.add(text.substring(start, end));
            start = end + 2;
        }
        return lines;
    }
}
