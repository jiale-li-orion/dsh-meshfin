/**
 * Content type for one workspace file. The map is the workbench's single
 * source of truth for "what is this file": the directory listing tags each
 * file entry with it (so a panel and the viewer chain route on the same
 * value) and the byte route serves it as `Content-Type`. It covers the types
 * the built-in viewers render plus the plain-text and PDF cases a browser can
 * show on its own; everything else is `application/octet-stream`, which
 * downloads instead of executing.
 * @module @deepseek-ai/dsh-workbench/content-type
 */

/** Media type per lowercase file extension, without the leading dot. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  // Images
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'avif': 'image/avif',
  'bmp': 'image/bmp',
  'svg': 'image/svg+xml',
  // Audio
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'oga': 'audio/ogg',
  'm4a': 'audio/mp4',
  'flac': 'audio/flac',
  'aac': 'audio/aac',
  // Video
  'mp4': 'video/mp4',
  'm4v': 'video/mp4',
  'webm': 'video/webm',
  'ogv': 'video/ogg',
  'mov': 'video/quicktime',
  // Documents and text a browser renders or displays as-is
  'pdf': 'application/pdf',
  'txt': 'text/plain; charset=utf-8',
  'md': 'text/plain; charset=utf-8',
  'mdx': 'text/plain; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'jsonc': 'application/json; charset=utf-8',
  'json5': 'application/json; charset=utf-8',
  'ndjson': 'application/json; charset=utf-8',
  'csv': 'text/csv; charset=utf-8',
  'tsv': 'text/csv; charset=utf-8',
  // Source and configuration files the text viewer shows as-is. Everything
  // here maps to a non-executing type: the byte route serves these values as
  // `Content-Type`, so a markup file must never arrive as `text/html`.
  'ts': 'text/plain; charset=utf-8',
  'tsx': 'text/plain; charset=utf-8',
  'mts': 'text/plain; charset=utf-8',
  'cts': 'text/plain; charset=utf-8',
  'js': 'text/plain; charset=utf-8',
  'jsx': 'text/plain; charset=utf-8',
  'mjs': 'text/plain; charset=utf-8',
  'cjs': 'text/plain; charset=utf-8',
  'py': 'text/plain; charset=utf-8',
  'rb': 'text/plain; charset=utf-8',
  'go': 'text/plain; charset=utf-8',
  'rs': 'text/plain; charset=utf-8',
  'java': 'text/plain; charset=utf-8',
  'kt': 'text/plain; charset=utf-8',
  'swift': 'text/plain; charset=utf-8',
  'scala': 'text/plain; charset=utf-8',
  'c': 'text/plain; charset=utf-8',
  'h': 'text/plain; charset=utf-8',
  'cc': 'text/plain; charset=utf-8',
  'cpp': 'text/plain; charset=utf-8',
  'hpp': 'text/plain; charset=utf-8',
  'cs': 'text/plain; charset=utf-8',
  'php': 'text/plain; charset=utf-8',
  'lua': 'text/plain; charset=utf-8',
  'pl': 'text/plain; charset=utf-8',
  'r': 'text/plain; charset=utf-8',
  'dart': 'text/plain; charset=utf-8',
  'vue': 'text/plain; charset=utf-8',
  'svelte': 'text/plain; charset=utf-8',
  'sql': 'text/plain; charset=utf-8',
  'sh': 'text/plain; charset=utf-8',
  'bash': 'text/plain; charset=utf-8',
  'zsh': 'text/plain; charset=utf-8',
  'fish': 'text/plain; charset=utf-8',
  'ps1': 'text/plain; charset=utf-8',
  'bat': 'text/plain; charset=utf-8',
  'cmd': 'text/plain; charset=utf-8',
  'yml': 'text/plain; charset=utf-8',
  'yaml': 'text/plain; charset=utf-8',
  'toml': 'text/plain; charset=utf-8',
  'ini': 'text/plain; charset=utf-8',
  'cfg': 'text/plain; charset=utf-8',
  'conf': 'text/plain; charset=utf-8',
  'env': 'text/plain; charset=utf-8',
  'properties': 'text/plain; charset=utf-8',
  'xml': 'text/plain; charset=utf-8',
  'html': 'text/plain; charset=utf-8',
  'htm': 'text/plain; charset=utf-8',
  'css': 'text/plain; charset=utf-8',
  'scss': 'text/plain; charset=utf-8',
  'less': 'text/plain; charset=utf-8',
  'diff': 'text/plain; charset=utf-8',
  'patch': 'text/plain; charset=utf-8',
  'log': 'text/plain; charset=utf-8',
  'text': 'text/plain; charset=utf-8',
  'tex': 'text/plain; charset=utf-8',
  'rst': 'text/plain; charset=utf-8',
  'gitignore': 'text/plain; charset=utf-8',
  'gitattributes': 'text/plain; charset=utf-8',
  'editorconfig': 'text/plain; charset=utf-8',
  'npmrc': 'text/plain; charset=utf-8',
  'nvmrc': 'text/plain; charset=utf-8',
  'dockerignore': 'text/plain; charset=utf-8',
}

/** The type served when the extension is unknown or absent. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Media type for one path, chosen by its extension.
 * @param path - file path or name; only the extension is read.
 * @returns the media type, or {@link DEFAULT_CONTENT_TYPE} when unknown.
 */
export function contentTypeForPath(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return DEFAULT_CONTENT_TYPE
  const extension = path.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[extension] ?? DEFAULT_CONTENT_TYPE
}
