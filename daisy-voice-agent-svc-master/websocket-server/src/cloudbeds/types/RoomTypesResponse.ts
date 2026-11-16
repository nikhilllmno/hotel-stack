/** Catalog-only query — returns all room type definitions without date/availability filtering. */
export interface CloudbedsGetRoomTypesCatalogQuery {
  propertyIDs: string;
}

/**
 * `GET /getRoomTypes` response shapes.
 *
 * `roomsAvailable` reports the per-property inventory for the requested
 * window. `roomRate` is the headline nightly rate (pre-tax, per Cloudbeds
 * docs) and is useful only as a quick availability signal — detailed
 * pricing lives in the `getRate` response.
 */

export interface CloudbedsRoomType {
  propertyID: string;
  roomTypeID: string;
  roomTypeName: string;
  roomTypeNameShort?: string;
  roomTypeDescription?: string;
  isPrivate?: boolean;
  maxGuests?: number;
  adultsIncluded?: number;
  childrenIncluded?: number;
  infantsIncluded?: number;
  roomsAvailable: number;
  roomTypeUnits?: number;
  roomRate?: number;
  roomTypePhotos?: string[];
  roomTypeFeatures?: string[];
}

export interface CloudbedsPropertyRoomTypes {
  propertyID: string;
  propertyName?: string;
  roomTypes: CloudbedsRoomType[];
}

export type CloudbedsRoomTypesResponseData = CloudbedsPropertyRoomTypes[];

/** Catalog response — flat array of room types, no date/availability params needed. */
export type CloudbedsRoomTypesCatalogResponseData = CloudbedsRoomType[];

/**
 * `GET /getAvailableRoomTypes` response — flattened, per-room-type array
 * (same shape as the catalog response) that `CloudbedsClient.getAvailableRoomTypes`
 * produces after normalizing the raw nested payload below. Cloudbeds support
 * recommends this endpoint over `getRoomTypes` as a workaround for a bug
 * where `getRoomTypes` intermittently errors for same-day check-ins.
 */
export type CloudbedsAvailableRoomTypesResponseData = CloudbedsRoomType[];

/**
 * Raw `GET /getAvailableRoomTypes` wire payload — nested per property,
 * unlike `getRoomTypes`/the catalog endpoint. Room entries omit `propertyID`
 * (only present on the parent) and Cloudbeds sends the numeric fields
 * (`roomsAvailable`, `maxGuests`, `adultsIncluded`, `childrenIncluded`,
 * `infantsIncluded`) as strings here. A room type is listed once per rate
 * plan (`ratePlanNamePublic`/`roomRateID`); `getRate` takes no rate plan
 * selector and always resolves to the plan named `"default"`, so
 * `CloudbedsClient.getAvailableRoomTypes` keeps only that entry per room
 * type and coerces the numeric fields when flattening into
 * `CloudbedsAvailableRoomTypesResponseData`.
 */
export interface CloudbedsAvailableRoomTypesRawEntry {
  propertyID: string;
  propertyCurrency?: {
    currencyCode: string;
    currencySymbol: string;
    currencyPosition: string;
  };
  propertyRooms: Array<
    Omit<
      CloudbedsRoomType,
      | 'propertyID'
      | 'roomsAvailable'
      | 'maxGuests'
      | 'adultsIncluded'
      | 'childrenIncluded'
      | 'infantsIncluded'
    > & {
      roomsAvailable: number | string;
      maxGuests?: number | string;
      adultsIncluded?: number | string;
      childrenIncluded?: number | string;
      infantsIncluded?: number | string;
      roomRateID?: string;
      ratePlanNamePublic?: string;
      ratePlanNamePrivate?: string;
    }
  >;
}

export type CloudbedsAvailableRoomTypesRawResponseData =
  CloudbedsAvailableRoomTypesRawEntry[];
