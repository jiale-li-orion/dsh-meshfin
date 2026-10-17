/**
 * The workbench's cross-plane protocol constants: where a listed file's bytes
 * are served and received. They live here — with the domain, not with the
 * routes that implement them — so the routes, the listing that advertises them,
 * and the browser that builds URLs from them all read one value.
 *
 * Both paths are exact routes on the Connection Fetch carrier, so they carry the
 * `/api` prefix that carrier owns: every request below it passes browser
 * authentication and the request-trust fence before a byte is served or stored.
 * @module @deepseek-ai/dsh-workbench/protocol
 */

/**
 * Path prefix of the workbench byte route:
 * `GET /api/workbench/file?sessionId=<id>&path=<path>`. Registered by
 * `dsh-workbench-bytes`, which reads this constant from the package root, so a
 * client and the route that answers it name one value.
 */
export const WORKBENCH_FILE_PATH = '/api/workbench/file'

/**
 * Path prefix of the workbench upload route:
 * `POST /api/workbench/upload?sessionId=<id>&name=<file name>` with the raw
 * bytes as the body. One file per request, so no multipart framing is involved
 * and the body streams to disk instead of being buffered.
 */
export const WORKBENCH_UPLOAD_PATH = '/api/workbench/upload'
