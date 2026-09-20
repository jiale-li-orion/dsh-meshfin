/**
 * Human-readable byte size for one file row.
 * @param bytes - the size the listing reported, or undefined when it reported none.
 * @returns the formatted size, or an empty string when the size is unknown.
 */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
