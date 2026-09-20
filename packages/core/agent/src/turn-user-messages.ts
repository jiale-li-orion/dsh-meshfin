/**
 * Which user messages one prepared turn carries.
 *
 * A pre-step listener reads or rewrites the request for a turn it did not open,
 * so it needs that turn's own user messages: the ones entered since the turn
 * began, followed by the batch this step proposes. The turn's `turn/start` is
 * the only boundary separating them from earlier turns, and scanning the log
 * backwards finds it without assuming the turn is the newest one.
 *
 * @module @deepseek-ai/dsh-agent/turn-user-messages
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionLogCut } from '@deepseek-ai/dsh-session'

/**
 * Collect the user messages logged after one turn's opening boundary, followed
 * by the ones the preparing step proposes.
 * @param log - stable session-log cut holding the turn.
 * @param turn - the turn whose opening boundary starts the scan.
 * @param proposed - messages the step has already decided to send.
 * @returns the entered messages in log order, then `proposed` in its own order.
 */
export function collectTurnUserMessages(
  log: SessionLogCut,
  turn: number,
  proposed: readonly UserMessage[],
): UserMessage[] {
  let start: number | undefined
  for (const event of log.reverseValuesOf(['turn/start'])) {
    if (event.data.turn === turn) {
      start = event.seq
      break
    }
  }
  const entered: UserMessage[] = []
  if (start !== undefined) {
    for (const event of log.valuesOf(['user/message'], start + 1)) entered.push(event.data)
  }
  return [...entered, ...proposed]
}
