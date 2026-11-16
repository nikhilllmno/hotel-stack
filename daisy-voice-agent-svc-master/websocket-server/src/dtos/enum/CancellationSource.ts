export enum CancellationSource {
  CUSTOMER = 'CUSTOMER',
  DASHBOARD = 'DASHBOARD',
  SYSTEM = 'SYSTEM',
  /** Cancellation originated at the connected PMS (discovered via webhook), not within Dextr. */
  PMS = 'PMS',
}
