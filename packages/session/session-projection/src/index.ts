/**
 * Service Definition and drive registry for the session-projection capability seam: the merge-extensible `SessionProjectionMap` type
 * table, the `ProjectionDefinition` state-driven computation unit contract,
 * and the `ctx.sessionProjections` registry that DRIVES every registered unit
 * forward eagerly over committed session events. Domain host plugins
 * contribute pure mathematics (init/apply/view); the framework owns the
 * subscription, the per-session watermark cache, and change notification;
 * carriers consume the snapshot read face and the change feed. Neither side
 * knows the other
 * (capability-seam three-way split). Design authority: the session-projection
 * RFC (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
 *
 * Whole-value event rule (load-bearing): a state-carrying log event MUST
 * carry the complete post-change state, never a bare delta — it keeps every
 * unit's transition trivially cheap and every served value self-describing.
 *
 * @module @deepseek-ai/dsh-session-projection
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ZodType } from 'zod'
import type { Session, SessionEvent, SessionEventType, SessionLogCut } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionProjections: SessionProjectionRegistry
  }
}

import type { SessionProjectionMap } from './types.ts'

export type { SessionProjectionMap } from './types.ts'

/**
 * One domain's state-driven computation unit: three pure synchronous
 * functions plus declarations — never an opaque getter. The framework
 * advances the unit watermark on every committed event and drives `apply`
 * only for {@link eventTypes}; the domain holds no subscriptions and owns
 * only the mathematics. All three functions MUST be synchronous (an async
 * unit would tear the carriers' consistency cut) and `state` MUST be plain
 * JSON (the persisted-cache precondition).
 */
export interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
  /** The projection key this unit owns (its `SessionProjectionMap` entry). */
  key: K
  /** Validates the wire payload (`view` output) before it leaves the host. */
  schema: ZodType<SessionProjectionMap[K]>
  /**
   * State for the empty log.
   * @returns the initial state.
   */
  init(): S
  /**
   * Event types passed to {@link apply}, or `'all'` when every event affects
   * the state. The registry advances the unit watermark across skipped events
   * without decoding packed events of unrelated types.
   */
  eventTypes: readonly SessionEventType[] | 'all'
  /**
   * Pure transition: previous state + one committed event → next state. A
   * unit uninterested in an event MUST return the same state reference — an
   * unchanged reference (`Object.is`) produces zero downstream work.
   * @param state - the state covering all prior events.
   * @param event - the next committed session event.
   * @returns the next state (same reference when the event is not the unit's).
   */
  apply(state: S, event: SessionEvent): S
  /**
   * State → wire payload (the read-side projection).
   * @param state - the current state.
   * @returns the whole current value for this unit's key.
   */
  view(state: S): SessionProjectionMap[K]
  /**
   * Persisted-cache invalidation version: bump whenever the serialized state fields or the
   * fold semantics change, so persisted `(sessionId, key, ver, seq, val)`
   * rows from an older unit are discarded instead of being forward-applied
   * into garbage. Non-negative integer.
   */
  stateVersion: number
}

/**
 * Change-feed listener: one unit's value changed for one session. `value` is
 * the schema-validated `view` output; `seq` is the unit's watermark at
 * emission (the seq of the event that caused the change).
 */
export type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: number,
) => void

/**
 * One consistent read cut over every registered unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log, mirroring `session/subscribed.lastSeq`).
 */
export interface ProjectionSnapshot {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current value per registered key. */
  values: Partial<SessionProjectionMap>
}

/**
 * One unit's checkpoint: its internal state (plain JSON by the unit
 * contract), the seq of the last event folded into it, and the unit
 * `stateVersion` that produced it — the persisted projection-cache row
 * `(sessionId, key, ver, seq, val)` minus the two outer keys. A row is
 * never authoritative, only a fold shortcut: `restore` discards it on a
 * version mismatch or when it claims events past the stored log end.
 */
export interface ProjectionCheckpointRow {
  /** The registering unit's `stateVersion` at fold time. */
  ver: number
  /** Seq of the last event folded into `val`; -1 for the empty log. */
  seq: number
  /** The unit's internal state — plain JSON per the unit contract. */
  val: unknown
}

/** Checkpoint rows keyed by projection key (one session's persisted cache value). */
export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>

/** Type-erased unit view the drive machinery works with (the registration contract already proved the typed form). */
interface ErasedDefinition {
  key: string
  schema: { parse(value: unknown): unknown }
  init(): unknown
  eventTypes: readonly SessionEventType[] | 'all'
  apply(state: unknown, event: SessionEvent): unknown
  view(state: unknown): unknown
  stateVersion: number
}

/** Per-session per-unit watermark cache row. */
interface UnitCell {
  state: unknown
  /** Seq of the last event passed through `apply` (regardless of change). */
  observedSeq: number
}

/**
 * One live registration: the unit plus its per-session cells (dropped whole
 * once the last registrant releases it).
 *
 * `refs` exists because one unit definition already serves every session — the
 * cells are keyed by `Session` — while the registrants are now per-session:
 * an agent preset mounts the same tool package once per agent, so N sessions
 * on one preset register the same key N times. Without a count the first
 * registrant would own the disposer, and its session ending would strip the
 * projection from every other live session.
 */
interface Registration {
  readonly def: ErasedDefinition
  readonly cells: WeakMap<Session, UnitCell>
  readonly eventTypes: ReadonlySet<SessionEventType> | 'all'
  /** Live registrants sharing this unit; the last one out removes the key. */
  refs: number
}

/**
 * `ctx.sessionProjections`: the projection unit table and its drive. The
 * service subscribes to `session/event` once; every committed event advances
 * every registered unit's watermark, while only declared event types reach
 * `apply`. A changed state reference notifies the change feed with the
 * schema-validated view.
 * Cells build lazily — a unit registered after events flowed, or a session
 * older than the registry, folds `init` over the in-memory log on first
 * touch (event or read). Registration is an effect (disposer rides the
 * calling fiber): an unloaded domain plugin's key disappears from snapshots
 * and clients read it as capability absence. Domain
 * plugins register under `ctx.inject(['sessionProjections'], …)` so headless
 * assemblies without the registry stay unaffected. Registrants sharing a key
 * share one unit and are counted: the same tool package mounted in N agent
 * presets registers N times, and the key survives until the last one
 * unloads.
 */
export class SessionProjectionRegistry extends Service {
  private readonly registrations = new Map<string, Registration>()
  private readonly listeners = new Set<ProjectionChangeListener>()

  /**
   * Create and install the registry as `ctx.sessionProjections`.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.drive(session, event)
    })
  }

  /**
   * Register one domain's unit. The registration is an effect on the calling
   * context's fiber: disposing the fiber (or calling the returned disposer)
   * removes the key — and the unit's cached cells — from subsequent drives
   * and snapshots.
   * @param definition - key, state schema, pure unit functions, and stateVersion.
   * @returns the exact disposer that unregisters this unit.
   */
  register<K extends keyof SessionProjectionMap, S>(definition: ProjectionDefinition<K, S>): () => void {
    if (!Number.isSafeInteger(definition.stateVersion) || definition.stateVersion < 0) {
      throw new Error(`session projection ${JSON.stringify(definition.key)} stateVersion must be a non-negative integer, got ${String(definition.stateVersion)}`)
    }
    const dispose = this.ctx.effect(function* (this: SessionProjectionRegistry) {
      const key = definition.key as string
      const existing = this.registrations.get(key)
      if (existing === undefined) {
        this.registrations.set(key, {
          def: definition,
          cells: new WeakMap(),
          eventTypes: definition.eventTypes === 'all' ? 'all' : new Set(definition.eventTypes),
          refs: 1,
        })
      } else {
        // A differing `stateVersion` is the one incompatibility this can name:
        // the versioned contract says the cached state shape differs, so the
        // two registrants cannot share cells. Anything else about a definition
        // is functions, which no runtime comparison can tell apart.
        if (existing.def.stateVersion !== definition.stateVersion) {
          throw new Error(`session projection key ${JSON.stringify(key)} is already registered at stateVersion ${String(existing.def.stateVersion)}; refusing to share it with stateVersion ${String(definition.stateVersion)}`)
        }
        existing.refs += 1
      }
      yield () => {
        const live = this.registrations.get(key)
        /* v8 ignore next -- the disposer runs once per successful registration, so the entry it counted is still here */
        if (live === undefined) return
        live.refs -= 1
        if (live.refs === 0) this.registrations.delete(key)
      }
    }.bind(this), 'sessionProjections.register()')
    return () => void dispose()
  }

  /**
   * Subscribe to the change feed. The registration is an effect on the
   * calling context's fiber.
   * @param listener - called once per unit whose state reference changed, per committed event.
   * @returns the exact disposer that unsubscribes.
   */
  onChanged(listener: ProjectionChangeListener): () => void {
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    }, 'sessionProjections.onChanged()')
    return () => void dispose()
  }

  /**
   * One consistent cut over every registered unit for one session, read from
   * the watermark cache (missing cells fold lazily over the in-memory log).
   * Fully synchronous — every value and `asOfSeq` reflect the same log
   * position. Each value passes its unit's schema before leaving.
   * @param session - the session whose projection values are read.
   * @returns the snapshot; `values` is empty when no unit is registered.
   */
  snapshot(session: Session): ProjectionSnapshot {
    this.initializeMissing(session, session.seq)
    const values: Record<string, unknown> = {}
    for (const registration of this.registrations.values()) {
      const cell = registration.cells.get(session) as UnitCell
      values[registration.def.key] = registration.def.schema.parse(registration.def.view(cell.state))
    }
    return { asOfSeq: session.seq - 1, values: values }
  }

  /**
   * State-level checkpoint of every registered unit for one session, read
   * from the watermark cache (missing cells fold lazily over the in-memory
   * log). This is the write side of the persisted projection cache: the
   * returned rows are the `(key → {ver, seq, val})` part of the durable
   * `(sessionId, key, ver, seq, val)`
   * rows. Every `val` is a DETACHED structured clone — never the live
   * cell reference: the watermark cache is this registry's authoritative
   * mutable state, and a caller reaching the live reference could corrupt
   * every subsequent snapshot and frame through it (plain JSON by the unit
   * contract, so the clone is total).
   * @param session - the session whose unit states are checkpointed.
   * @returns one row per registered key; empty when no unit is registered.
   */
  checkpoint(session: Session): ProjectionCheckpoint {
    this.initializeMissing(session, session.seq)
    const rows: ProjectionCheckpoint = {}
    for (const registration of this.registrations.values()) {
      const cell = registration.cells.get(session) as UnitCell
      rows[registration.def.key] = {
        ver: registration.def.stateVersion,
        seq: cell.observedSeq,
        val: structuredClone(cell.state),
      }
    }
    return rows
  }

  /**
   * The stored seq a {@link restore} tail read over `checkpoint` must start
   * at: one event BELOW the lowest usable watermark (a row is usable when
   * its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
   * pulls the floor to `0` — that key must refold the full log). The
   * one-below anchor is load-bearing: the tail then proves how far the
   * stored log still extends, so {@link restore} can detect a log that
   * shrank below a row's watermark (crash-repair truncation) instead of
   * serving the stale row as current — an empty tail read from the anchor
   * yields an end below every watermark and the restore rejects for a full
   * re-read.
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @returns the seq to hand the persistence `readFrom`, or `undefined`
   *   when no unit is registered (no read needed — {@link restore} would
   *   serve empty values regardless).
   */
  restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined {
    let floor: number | undefined
    for (const registration of this.registrations.values()) {
      const row = checkpoint[registration.def.key]
      const need = row !== undefined && row.ver === registration.def.stateVersion
        ? Math.max(row.seq + 1, 0)
        : 0
      floor = floor === undefined ? need : Math.min(floor, need)
    }
    return floor === undefined ? undefined : Math.max(floor - 1, 0)
  }

  /**
   * View a checkpoint's rows without any log read: for every registered
   * unit whose row's `ver` matches, serve the schema-validated
   * `view` of the stored state; mismatched or absent rows leave their key
   * absent (a cold or listing consumer treats it as not-yet-available and a
   * fuller read path refolds it). The zero-I/O rung of the read ladder —
   * values are as stale as their rows, never wrong.
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @returns whole values per key with a usable row; empty when none.
   */
  viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap> {
    const values: Record<string, unknown> = {}
    for (const registration of this.registrations.values()) {
      const def = registration.def
      const row = checkpoint[def.key]
      if (row === undefined || row.ver !== def.stateVersion) continue
      values[def.key] = def.schema.parse(def.view(row.val))
    }
    return values
  }

  /**
   * Cold read: fold every registered unit over a stored log suffix, seeding
   * each from its checkpoint row when usable — the one read recipe (cached
   * state + forward tail replay + `view`) applied without a live `Session`.
   * Call with the events returned by a persistence
   * `readFrom(id, restoreFloor(checkpoint))` and that same floor as
   * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
   * so a shrunk log is detected here. A row is usable iff its
   * `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
   * (`seq >= baseSeq - 1`), and it does not claim events past the
   * supplied end (`seq <= endSeq`); an unusable row is discarded
   * and its key refolds from `init` — which is only sound over the full
   * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
   * from seq 0, e.g. after a crash-repair truncation shrank the log below
   * a row's watermark).
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @param events - the stored events with `seq >= baseSeq`, in seq order.
   * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
   * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
   *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
   *   refreshed checkpoint rows at that cut, ready for a durable write-back.
   */
  restore(checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: number):
  { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint } {
    const endSeq = events.at(-1)?.seq ?? baseSeq - 1
    return this.restoreEvents(checkpoint, events, baseSeq, endSeq)
  }

  /**
   * Cold full-log read over a stable Session cut. Selected-type definitions use
   * the packed log index; an `'all'` definition still observes every event.
   * @param checkpoint - persisted rows for one session (possibly stale or empty).
   * @param log - stable complete logical log cut.
   * @param baseSeq - first sequence represented by the supplied cut.
   * @returns the projection snapshot and refreshed checkpoint at the cut end.
   */
  restoreLog(
    checkpoint: ProjectionCheckpoint,
    log: SessionLogCut,
    baseSeq: number = 0,
  ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint } {
    const cells = this.restoreLogCells(checkpoint, log, baseSeq, [...this.registrations.values()], false)
    return this.projectCut(cells, log.length - 1)
  }

  /**
   * Initialize absent live cells from a persisted checkpoint and the Session's
   * stable current log. Each unit resumes from its own usable watermark, so a
   * missing or version-mismatched lightweight unit does not force unrelated
   * units to replay packed stream events from seq zero. Existing cells remain
   * authoritative and are never replaced.
   * @param session - live Session whose absent cells should be initialized.
   * @param checkpoint - persisted rows for the same Session lifecycle.
   */
  restoreSession(session: Session, checkpoint: ProjectionCheckpoint): void {
    const missing = [...this.registrations.values()]
      .filter(registration => registration.cells.get(session) === undefined)
    if (missing.length === 0) return

    const log = session.readLog()
    const cells = this.restoreLogCells(checkpoint, log, 0, missing, true)
    // Validate every restored value before publishing any cell. A corrupt
    // cache row is a shortcut failure, not permission to leave a partially
    // initialized registry state behind.
    for (const cell of cells) {
      const def = cell.registration.def
      def.schema.parse(def.view(cell.state))
    }
    const observedSeq = log.length - 1
    for (const cell of cells) {
      cell.registration.cells.set(session, { state: cell.state, observedSeq })
    }
  }

  /** Restore selected registrations from independent checkpoint watermarks. */
  private restoreLogCells(
    checkpoint: ProjectionCheckpoint,
    log: SessionLogCut,
    baseSeq: number,
    registrations: readonly Registration[],
    detachCheckpointState: boolean,
  ): Array<{ registration: Registration; state: unknown }> {
    const endSeq = log.length - 1
    const cells: Array<{ registration: Registration; state: unknown; from: number }> = []
    const groups = new Map<number, Array<{ registration: Registration; state: unknown; from: number }>>()
    for (const registration of registrations) {
      const def = registration.def
      const row = this.usableRow(checkpoint, def, baseSeq, endSeq)
      const cell = {
        registration,
        state: row === undefined
          ? def.init()
          : detachCheckpointState ? structuredClone(row.val) : row.val,
        from: row === undefined ? baseSeq : row.seq + 1,
      }
      cells.push(cell)
      if (cell.from >= log.length) continue
      const group = groups.get(cell.from)
      if (group === undefined) groups.set(cell.from, [cell])
      else group.push(cell)
    }

    for (const [from, group] of groups) {
      const all = group.some(cell => cell.registration.eventTypes === 'all')
      const selected = new Set<SessionEventType>()
      if (!all) {
        for (const cell of group) {
          for (const type of cell.registration.eventTypes as ReadonlySet<SessionEventType>) selected.add(type)
        }
      }
      const events = all
        ? log.values(from, log.length)
        : log.valuesOf([...selected], from, log.length)
      for (const event of events) {
        for (const cell of group) {
          if (this.consumes(cell.registration, event)) {
            cell.state = cell.registration.def.apply(cell.state, event)
          }
        }
      }
    }
    return cells
  }

  /** Fold one logical event iterable into every registered projection unit. */
  private restoreEvents(
    checkpoint: ProjectionCheckpoint,
    events: Iterable<SessionEvent>,
    baseSeq: number,
    endSeq: number,
  ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint } {
    const cells: Array<{ registration: Registration; state: unknown; from: number }> = []
    for (const registration of this.registrations.values()) {
      const def = registration.def
      const row = this.usableRow(checkpoint, def, baseSeq, endSeq)
      cells.push({
        registration,
        state: row === undefined ? def.init() : row.val,
        from: row === undefined ? baseSeq - 1 : row.seq,
      })
    }
    for (const event of events) {
      for (const cell of cells) {
        if (event.seq > cell.from && this.consumes(cell.registration, event)) {
          cell.state = cell.registration.def.apply(cell.state, event)
        }
      }
    }
    return this.projectCut(cells, endSeq)
  }

  /**
   * Resolve one unit's checkpoint row against a restore window. A discarded
   * row refolds from `init`, which is only sound over the full log, so an
   * unusable row above seq 0 throws (the caller re-reads from seq 0).
   * @param checkpoint - persisted rows for one session.
   * @param def - the unit whose row is resolved.
   * @param baseSeq - first seq the supplied log represents.
   * @param endSeq - last seq the supplied log represents.
   * @returns the usable row, or `undefined` when the unit must refold from `init`.
   */
  private usableRow(
    checkpoint: ProjectionCheckpoint,
    def: ErasedDefinition,
    baseSeq: number,
    endSeq: number,
  ): ProjectionCheckpointRow | undefined {
    const row = checkpoint[def.key]
    const usable = row !== undefined
      && row.ver === def.stateVersion
      && row.seq >= baseSeq - 1
      && row.seq <= endSeq
    if (!usable && baseSeq > 0) {
      throw new Error(
        `session projection ${JSON.stringify(def.key)} cannot restore from seq ${baseSeq}: `
        + 'its checkpoint row is missing, version-mismatched, or beyond the supplied log end; re-read from seq 0',
      )
    }
    return usable ? row : undefined
  }

  /**
   * Project folded cells into the read face at one cut: every unit's `view`
   * output is schema-validated before it leaves the host, and each unit's
   * refreshed checkpoint row carries the state at that cut.
   * @param cells - folded states of the units included in this cut.
   * @param endSeq - last seq every value and row reflects.
   * @returns the snapshot cut at `endSeq` plus the refreshed checkpoint rows.
   */
  private projectCut(
    cells: readonly { registration: Registration; state: unknown }[],
    endSeq: number,
  ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint } {
    const values: Record<string, unknown> = {}
    const refreshed: ProjectionCheckpoint = {}
    for (const cell of cells) {
      const def = cell.registration.def
      values[def.key] = def.schema.parse(def.view(cell.state))
      refreshed[def.key] = { ver: def.stateVersion, seq: endSeq, val: cell.state }
    }
    return {
      snapshot: { asOfSeq: endSeq, values },
      checkpoint: refreshed,
    }
  }

  /** Build every absent unit cell through one logical log scan. */
  private initializeMissing(session: Session, end: number): void {
    const missing = [...this.registrations.values()]
      .filter(registration => registration.cells.get(session) === undefined)
      .map(registration => ({
        registration,
        cell: { state: registration.def.init(), observedSeq: -1 } satisfies UnitCell,
      }))
    if (missing.length === 0) return

    const all = missing.some(({ registration }) => registration.eventTypes === 'all')
    const selected = new Set<SessionEventType>()
    if (!all) {
      for (const { registration } of missing) {
        for (const type of registration.eventTypes as ReadonlySet<SessionEventType>) selected.add(type)
      }
    }
    const cut = session.readLog()
    const events = all ? cut.values(0, end) : cut.valuesOf([...selected], 0, end)
    for (const event of events) {
      for (const item of missing) {
        if (this.consumes(item.registration, event)) {
          item.cell.state = item.registration.def.apply(item.cell.state, event)
        }
      }
    }
    for (const item of missing) {
      item.cell.observedSeq = end - 1
      item.registration.cells.set(session, item.cell)
    }
  }

  /** Whether one unit consumes this event rather than only advancing its watermark. */
  private consumes(registration: Registration, event: SessionEvent): boolean {
    return registration.eventTypes === 'all' || registration.eventTypes.has(event.type)
  }

  /** Eager drive: pass one committed event through every registered unit; notify on changed references. */
  private drive(session: Session, event: SessionEvent): void {
    this.initializeMissing(session, event.seq)
    for (const registration of this.registrations.values()) {
      const cell = registration.cells.get(session) as UnitCell
      const next = this.consumes(registration, event)
        ? registration.def.apply(cell.state, event)
        : cell.state
      const changed = !Object.is(next, cell.state)
      cell.state = next
      cell.observedSeq = event.seq
      if (changed && this.listeners.size > 0) {
        const value = registration.def.schema.parse(registration.def.view(next))
        for (const listener of this.listeners) {
          listener(session, registration.def.key as Extract<keyof SessionProjectionMap, string>, value, event.seq)
        }
      }
    }
  }
}

export default SessionProjectionRegistry
