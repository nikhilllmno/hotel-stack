/**
 * Identifies which flow asked for a reservation lookup, when the lookup has to
 * be interpreted differently depending on the caller.
 */
export enum ReservationLookupSource {
  /**
   * The door-code endpoint. A guest asked for their name at a door gives a
   * first name far more often than a bare surname, so a single-token name is
   * matched against the first name rather than the last.
   */
  DOOR_CODE = 'DOOR_CODE',
}
