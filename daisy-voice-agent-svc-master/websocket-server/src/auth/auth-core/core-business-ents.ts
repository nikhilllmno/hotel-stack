const TOKEN_SCOPED_HOTEL_ID_CLAIM_KEYS = ['daisyId', 'hotelId'] as const;

/**
 * When claims.businessEnts includes a Daisy hotel id (daisyId, hotelId,
 * data.daisyId, or crossData.daisy_ref_id), return the first match; otherwise null.
 * Top-level businessEnts[].id is a Core entity id and is intentionally ignored.
 * Used for routes that scope the hotel from the token rather than the URL.
 * @example
 * hotelIdFromBusinessEnts({ businessEnts: [{ crossData: { daisy_ref_id: 'h1' } }] }) => 'h1'
 */
export function hotelIdFromBusinessEnts(
  claims: Record<string, unknown>,
): string | null {
  const businessEnts = claims.businessEnts;
  if (!Array.isArray(businessEnts)) {
    return null;
  }

  for (const entry of businessEnts) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const hotelId = daisyHotelIdFromEnt(entry as Record<string, unknown>);
    if (hotelId != null) {
      return hotelId;
    }
  }

  return null;
}

/**
 * When claims.businessEnts includes an entry whose daisyId, hotelId, data.daisyId,
 * or crossData.daisy_ref_id equals the hotel id parsed from the request route,
 * return that hotel id; otherwise null. Top-level businessEnts[].id is ignored.
 */
export function businessEntsMatchHotelId(
  claims: Record<string, unknown>,
  route: { path: string; originalUrl?: string },
): string | null {
  const hotelId = hotelIdFromRoute(route);
  if (hotelId == null) {
    return null;
  }

  const businessEnts = claims.businessEnts;
  if (!Array.isArray(businessEnts)) {
    return null;
  }

  for (const entry of businessEnts) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const ent = entry as Record<string, unknown>;
    if (entHasMatchingHotelId(ent, hotelId)) {
      return hotelId;
    }
  }

  return null;
}

function daisyHotelIdFromEnt(ent: Record<string, unknown>): string | null {
  for (const key of TOKEN_SCOPED_HOTEL_ID_CLAIM_KEYS) {
    const value = trimmedStringClaim(ent[key]);
    if (value != null) {
      return value;
    }
  }

  const data = ent.data;
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    const value = trimmedStringClaim((data as Record<string, unknown>).daisyId);
    if (value != null) {
      return value;
    }
  }

  const crossData = ent.crossData;
  const serviceRefs = ent.serviceRefs;

  if (
    serviceRefs != null &&
    typeof serviceRefs === 'object' &&
    !Array.isArray(serviceRefs)
  ) {
    const value = trimmedStringClaim(
      (serviceRefs as Record<string, unknown>).daisyId,
    );

    if (value != null) {
      return value;
    }
  }

  // Fallback only when serviceRefs has no valid daisyId.
  if (
    crossData != null &&
    typeof crossData === 'object' &&
    !Array.isArray(crossData)
  ) {
    const value = trimmedStringClaim(
      (crossData as Record<string, unknown>).daisy_ref_id,
    );

    if (value != null) {
      return value;
    }
  }

  return null;
}

function entHasMatchingHotelId(
  ent: Record<string, unknown>,
  hotelId: string,
): boolean {
  const entHotelId = daisyHotelIdFromEnt(ent);
  return entHotelId != null && entHotelId === hotelId;
}

function trimmedStringClaim(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function hotelIdFromRoute(args: {
  path: string;
  originalUrl?: string;
}): string | null {
  const fromPath = matchHotelIdInPath(args.path);
  if (fromPath != null) {
    return fromPath;
  }

  if (args.originalUrl != null && args.originalUrl !== '') {
    const pathOnly = args.originalUrl.split('?')[0] ?? '';
    return matchHotelIdInPath(pathOnly);
  }

  return null;
}

function matchHotelIdInPath(path: string): string | null {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const configMatch = normalized.match(
    /^(?:\/api)?\/hotel\/([^/]+)\/configuration\/?$/,
  );
  if (configMatch != null) {
    return trimHotelId(configMatch[1]);
  }

  const resourceMatch = normalized.match(/^(?:\/api)?\/hotel\/([^/]+)\/?$/);
  if (resourceMatch != null) {
    return trimHotelId(resourceMatch[1]);
  }

  return null;
}

function trimHotelId(hotelId: string | undefined): string | null {
  if (hotelId == null || hotelId.trim() === '') {
    return null;
  }
  return hotelId.trim();
}
