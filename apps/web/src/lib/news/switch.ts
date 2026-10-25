/**
 * The news desk's on/off switch. Switching it ON after it was off first marks
 * every game, night and week of the recent past as skipped, so the desk never
 * writes about the time it was off; only then is it switched on, so the news
 * service never sees it on with that backlog still open. Any other change
 * (off, or on while already on) only sets the switch.
 */
export interface NewsSwitchDeps {
  getEnabled(): Promise<boolean>
  setEnabled(on: boolean): Promise<void>
  skipBacklog(now: Date): Promise<void>
  now(): Date
}

export async function switchNewsDesk(on: boolean, deps: NewsSwitchDeps): Promise<void> {
  if (on && !(await deps.getEnabled())) await deps.skipBacklog(deps.now())
  await deps.setEnabled(on)
}
