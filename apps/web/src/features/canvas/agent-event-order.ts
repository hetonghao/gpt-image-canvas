export function acceptsAgentTerminalEvent(
  activeRunId: string | null,
  cancelledRunIds: ReadonlySet<string>,
  eventRunId: string | undefined
): boolean {
  return eventRunId === undefined || eventRunId === activeRunId || cancelledRunIds.has(eventRunId);
}
