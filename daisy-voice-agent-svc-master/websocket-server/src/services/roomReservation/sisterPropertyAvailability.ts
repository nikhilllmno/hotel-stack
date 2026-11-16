import { SisterPropertyAvailabilityResult } from '../../models/response/roomReservation';

export const SISTER_PROPERTY_CHECK_FAILED =
  'Availability check failed for this property.';
export const SISTER_PROPERTY_CHECK_TIMED_OUT =
  'Availability check timed out for this property.';
export const CROSS_SELL_NOT_CONFIGURED =
  'Cross-sell is not configured for this hotel.';

/**
 * True when the PMS lite availability groups contain at least one bookable
 * room. Groups are either quote objects with `number_of_units_available` or
 * one-entry `{ [room name]: description }` records.
 */
export function hasBookableGroups(groups: unknown): boolean {
  if (!Array.isArray(groups) || groups.length === 0) return false;
  return groups.some((group: Record<string, unknown>) => {
    if (typeof group?.number_of_units_available === 'number') {
      return group.number_of_units_available > 0;
    }
    // Stayntouch lite mixes min-stay restriction descriptions ("room X is not
    // available due to…") into the same groups array as bookable rooms.
    const description = Object.values(group ?? {})[0];
    return (
      typeof description === 'string' &&
      !description.includes('is not available')
    );
  });
}

function describeSister(result: SisterPropertyAvailabilityResult): string {
  const details = [
    result.distance_miles != null
      ? `${result.distance_miles} miles away`
      : null,
    result.website ?? null,
  ].filter((detail): detail is string => !!detail);
  return details.length
    ? `${result.hotel_name} (${details.join(', ')})`
    : result.hotel_name;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One summary sentence for the agent, built from the per-hotel results. */
export function buildCrossSellMessage(
  results: SisterPropertyAvailabilityResult[],
): string {
  const available = results.filter((result) => result.available);
  const unchecked = results.filter((result) => result.error);

  if (available.length > 0) {
    const verb = available.length === 1 ? 'has' : 'have';
    return (
      `${joinNames(available.map(describeSister))} ${verb} availability for your dates. ` +
      `Rooms at a sister property can't be booked on this call: give the guest its website or phone number.`
    );
  }

  if (unchecked.length === 0) {
    return 'Unfortunately, none of the nearby sister properties have availability for your dates either.';
  }

  const uncheckedNames = joinNames(unchecked.map(describeSister));
  const fallback =
    unchecked.length === 1
      ? 'the guest can check its website or call it directly'
      : 'the guest can check their websites or call them directly';
  if (unchecked.length === results.length) {
    return `Availability couldn't be checked at ${uncheckedNames} right now; ${fallback}.`;
  }
  return `None of the other sister properties have availability for your dates. Availability couldn't be checked at ${uncheckedNames} right now; ${fallback}.`;
}
