/**
 * Cloudbeds-style bracket-notation form encoder.
 *
 * Cloudbeds accepts urlencoded bodies with nested arrays serialized as
 *   rooms[0][roomTypeID]=123&rooms[0][quantity]=1
 *
 * `URLSearchParams` does not natively produce that shape, so this helper
 * walks the payload, turns plain nested arrays / objects into the bracket
 * form, and URL-encodes the resulting key/value pairs. Primitive values
 * (string / number / boolean) are written as-is; `null` / `undefined`
 * are skipped so optional fields do not leak empty values to Cloudbeds.
 */

function append(
  pairs: string[],
  key: string,
  value: string | number | boolean,
): void {
  pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

function walk(pairs: string[], prefix: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(pairs, `${prefix}[${index}]`, item);
    });
    return;
  }

  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      walk(pairs, `${prefix}[${key}]`, entry);
    }
    return;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    append(pairs, prefix, value);
  }
  // Any other exotic type (function, symbol, bigint) is skipped on purpose.
}

/**
 * Serializes `payload` into an `application/x-www-form-urlencoded` body
 * using Cloudbeds bracket notation for nested arrays and objects.
 *
 * Accepts loosely-typed `Record<string, unknown>` payloads because request
 * shapes (e.g. `CloudbedsPostReservationRequest`) mix primitives and
 * nested arrays that don't fit a single narrow literal type. Runtime
 * walking handles each case safely.
 *
 * @example
 *   encodeForm({ propertyID: '320454', rooms: [{ roomTypeID: 1, quantity: 2 }] })
 *   // => 'propertyID=320454&rooms%5B0%5D%5BroomTypeID%5D=1&rooms%5B0%5D%5Bquantity%5D=2'
 */
export function encodeForm(payload: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    walk(pairs, key, value);
  }
  return pairs.join('&');
}
