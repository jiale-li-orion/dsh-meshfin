/** Opaque identities owned by the session-context capability. */
/**
 * Brand a string as a {@link ContextUnitId}.
 * @param id - stable unit identity produced by Session Context.
 * @returns the branded unit identity.
 */
export function ContextUnitId(id) {
    return id;
}
/**
 * Brand a string as a {@link ContextRewriteId}.
 * @param id - durable rewrite identity.
 * @returns the branded rewrite identity.
 */
export function ContextRewriteId(id) {
    return id;
}
/**
 * Brand an encoded continuation state as a {@link ContextHistoryCursor}.
 * @param value - opaque cursor encoded by Session Context.
 * @returns the branded continuation cursor.
 */
export function ContextHistoryCursor(value) {
    return value;
}
//# sourceMappingURL=brand.js.map