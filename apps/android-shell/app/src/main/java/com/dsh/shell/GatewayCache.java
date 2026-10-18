package com.dsh.shell;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Comparator;

/**
 * On-disk cache for the plugin bundles and assets the client loads at start.
 *
 * The host names each of those responses with a {@code rev} query value and
 * serves them as immutable, so one URL names one byte sequence and caching it
 * cannot pin stale content. {@code rev} is derived from build metadata — and,
 * for a combined bundle, from the revisions it was combined from — so it is not
 * a digest of the response body and this cache never recomputes it. What an
 * entry does verify is its own write: the stored digest must match the stored
 * bytes, which is what catches a body that was framed wrong or written only in
 * part. A start-up cost is otherwise paid on every launch, because a WebView's
 * own cache is a policy the app does not control; an app-private directory is.
 *
 * Bodies are stored decoded. The host may compress a response, and replaying
 * compressed bytes to a client that did not ask for them would be wrong, so the
 * entry records the identity form and the headers that stay true for it.
 */
final class GatewayCache implements Closeable {

    private static final String TAG = "DshShell";
    /** Cache ceiling: the whole start-up payload is about 12 MiB, so this leaves room for a few generations. */
    private static final long MAX_BYTES = 96L * 1024 * 1024;
    private static final String[] CACHEABLE_PREFIXES = {"/plugins/", "/assets/"};
    private static final String[] CACHEABLE_TYPES = {"javascript", "css", "json", "svg", "font", "image/png", "image/jpeg", "webmanifest", "plain"};
    /** Suffix of the sidecar holding an entry's content type and body digest. */
    private static final String META_SUFFIX = ".meta";
    /** Suffix the previous format used for the content type alone; deleted when met. */
    private static final String LEGACY_TYPE_SUFFIX = ".type";

    private final File root;

    GatewayCache(File root) {
        this.root = root;
        if (!root.exists() && !root.mkdirs()) Log.w(TAG, "cache directory not created: " + root);
    }

    /** @return true when the URL names immutable content and the method reads it. */
    static boolean isCacheable(String method, String path) {
        if (!"GET".equals(method)) return false;
        for (String prefix : CACHEABLE_PREFIXES) {
            if (path.startsWith(prefix)) return true;
        }
        return false;
    }

    /** One stored response: the body plus the headers that survive a replay. */
    static final class Entry {
        final byte[] body;
        final String contentType;

        Entry(byte[] body, String contentType) {
            this.body = body;
            this.contentType = contentType;
        }
    }

    /** @return the stored entry for one URL, or null when it is absent or unverifiable. */
    synchronized Entry lookup(String url) {
        File body = bodyFile(url);
        File meta = metaFile(url);
        if (!body.isFile()) return null;
        if (!meta.isFile()) {
            // An entry written by the previous format carries no digest, so its
            // bytes cannot be trusted and are worth less than a refetch.
            body.delete();
            legacyTypeFile(url).delete();
            return null;
        }
        try {
            byte[] bytes = readAll(body, body.length());
            String[] recorded = readMeta(meta);
            if (recorded == null || !recorded[1].equals(contentDigest(bytes))) {
                Log.w(TAG, "cache entry failed its own digest check, refetching: " + url);
                body.delete();
                meta.delete();
                return null;
            }
            // Touching the entry keeps the eviction order honest about use.
            body.setLastModified(System.currentTimeMillis());
            return new Entry(bytes, recorded[0].isEmpty() ? null : recorded[0]);
        } catch (IOException error) {
            Log.w(TAG, "cache read failed for " + url + ": " + error.getMessage());
            body.delete();
            meta.delete();
            return null;
        }
    }

    /**
     * @param url - the requested URL, whose {@code rev} already fixes its content.
     * @param body - the decoded response body.
     * @param contentType - the type to replay the body with.
     * @return true when the entry was stored.
     */
    synchronized boolean store(String url, byte[] body, String contentType) {
        if (body.length == 0) return false;
        File target = bodyFile(url);
        File temp = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(body);
        } catch (IOException error) {
            Log.w(TAG, "cache write failed for " + url + ": " + error.getMessage());
            temp.delete();
            return false;
        }
        if (!temp.renameTo(target)) {
            temp.delete();
            return false;
        }
        // The sidecar lands last: an entry without one is treated as absent, so a
        // write that stops between the two files cannot be read back as complete.
        try (FileOutputStream out = new FileOutputStream(metaFile(url))) {
            out.write((contentType == null ? "" : contentType).getBytes(StandardCharsets.UTF_8));
            out.write('\n');
            out.write(contentDigest(body).getBytes(StandardCharsets.UTF_8));
            out.write('\n');
        } catch (IOException error) {
            Log.w(TAG, "cache sidecar write failed for " + url + ": " + error.getMessage());
        }
        evict();
        return true;
    }

    /** @return true when this content type is worth storing. */
    static boolean isCacheableType(String contentType) {
        if (contentType == null) return false;
        String lower = contentType.toLowerCase(java.util.Locale.ROOT);
        for (String needle : CACHEABLE_TYPES) {
            if (lower.contains(needle)) return true;
        }
        return false;
    }

    @Override
    public void close() {
        // Nothing to release: every entry is flushed on write.
    }

    /** Drop the least recently used entries until the cache fits its ceiling. */
    private void evict() {
        File[] files = root.listFiles();
        if (files == null) return;
        long total = 0;
        for (File file : files) total += file.length();
        if (total <= MAX_BYTES) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            long length = file.length();
            if (!file.delete()) continue;
            total -= length;
            if (total <= MAX_BYTES) return;
        }
    }

    private File bodyFile(String url) {
        return new File(root, key(url));
    }

    private File metaFile(String url) {
        return new File(root, key(url) + META_SUFFIX);
    }

    private File legacyTypeFile(String url) {
        return new File(root, key(url) + LEGACY_TYPE_SUFFIX);
    }

    /** @return the recorded content type and body digest, or null when unparsable. */
    private static String[] readMeta(File file) {
        try {
            String value = new String(readAll(file, file.length()), StandardCharsets.UTF_8);
            String[] parts = value.split("\n", -1);
            if (parts.length < 2) return null;
            String digest = parts[1].trim();
            if (digest.length() != 64) return null;
            return new String[] {parts[0].trim(), digest};
        } catch (IOException error) {
            return null;
        }
    }

    private static byte[] readAll(File file, long length) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(0, Math.min(length, Integer.MAX_VALUE)));
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /** @return the hex SHA-256 of one body, as recorded in the entry's sidecar. */
    private static String contentDigest(byte[] body) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(body);
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte value : hash) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            /* v8 ignore next -- SHA-256 is required of every Android runtime */
            return "";
        }
    }

    /** @return a filesystem-safe stable key for one URL. */
    private static String key(String url) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(url.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte value : hash) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            /* v8 ignore next -- SHA-256 is required of every Android runtime */
            return Integer.toHexString(url.hashCode());
        }
    }
}
