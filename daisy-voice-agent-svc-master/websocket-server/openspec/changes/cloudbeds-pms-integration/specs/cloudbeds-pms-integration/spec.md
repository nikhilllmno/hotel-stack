## ADDED Requirements

### Requirement: Cloudbeds Provider Registration
The system SHALL recognize `cloudbeds` as a valid PMS provider and route hotels configured with this provider to the Cloudbeds reservation service.

#### Scenario: Provider enum recognizes Cloudbeds
- **WHEN** a hotel's `pms_provider` column is set to `cloudbeds`
- **THEN** `PMSServiceFactory.getReservationService` SHALL return a Cloudbeds-backed implementation of `IPMSReservationService`

#### Scenario: Unsupported provider rejection unchanged
- **WHEN** a hotel's `pms_provider` is not one of the supported values (`resnexus`, `hostaway`, `stayntouch`, `cloudbeds`)
- **THEN** the factory SHALL throw `BadRequestError` as it does today

### Requirement: Per-Hotel Cloudbeds Credentials
The system SHALL source Cloudbeds credentials per hotel from the database rather than shared environment variables.

#### Scenario: PropertyID from hotels.business_id
- **WHEN** the Cloudbeds service makes any API call for a hotel
- **THEN** it SHALL use `hotels.business_id` as the `propertyID` / `propertyIDs` parameter

#### Scenario: API token from hotels.cloudbeds_api_token
- **WHEN** the Cloudbeds service makes any API call for a hotel
- **THEN** it SHALL read `hotels.cloudbeds_api_token` and send it as `Authorization: Bearer <token>`

#### Scenario: Missing token
- **WHEN** a Cloudbeds-configured hotel has a null or empty `cloudbeds_api_token`
- **THEN** the service SHALL throw `CloudbedsConfigurationError` with a message identifying the hotel id and missing field

### Requirement: Room Type Metadata Retrieval
The system SHALL fetch Cloudbeds room types and their rooms for a property.

#### Scenario: Retrieve rooms for a property
- **WHEN** the service needs room metadata for a property
- **THEN** it SHALL call `GET /getRooms?propertyIDs=<business_id>` and return the `data[0].rooms` array with `roomTypeID`, `roomTypeName`, `roomTypeNameShort`, `maxGuests`, and `roomDescription`

#### Scenario: Empty property
- **WHEN** Cloudbeds returns an empty `rooms` array
- **THEN** the service SHALL return an empty array without throwing

### Requirement: Single-Room Availability and Pricing
The system SHALL provide single-room availability with per-room-type quotes for a given date range and occupancy.

#### Scenario: Availability query delegates to getRoomTypes
- **WHEN** `getRoomAvailabilityWithQuote` is invoked with `start_date`, `end_date`, `num_adults`, `num_children`
- **THEN** the service SHALL call `GET /getRoomTypes?propertyIDs=<business_id>&startDate=<start_date>&endDate=<end_date>&adults=<num_adults>&children=<num_children>`

#### Scenario: Per-room-type rate retrieval
- **WHEN** `getRoomTypes` returns room types with `roomsAvailable > 0`
- **THEN** the service SHALL call `GET /getRate?roomTypeID=<id>&startDate=&endDate=&adults=&children=&propertyID=&detailedRates=true` for each and compute `base_rate` = sum of `roomRateDetailed[].rate`, `total_amount` = `totalRate`, and `taxes` = `max(0, total_amount - base_rate)`

#### Scenario: Zero-availability room types excluded
- **WHEN** a room type returns `roomsAvailable = 0`
- **THEN** the service SHALL exclude it from the quoted groups and SHALL report it with an `availability_in_requested_period` message in the response

#### Scenario: Raw response preservation
- **WHEN** a quote is produced from Cloudbeds data
- **THEN** the complete `getRate` response SHALL be stored in `PMSQuote.raw_response`

#### Scenario: Lite availability variant
- **WHEN** `getRoomAvailabilityWithQuoteLite` is invoked
- **THEN** the service SHALL return a simplified natural-language description per available room type, matching the format used by other PMS providers

### Requirement: Quote Generation
The system SHALL produce a `PMSQuote` for a single room / date range that satisfies the `IPMSReservationService.getQuote` contract.

#### Scenario: getQuote returns PMSQuote shape
- **WHEN** `getQuote` is called with a `PMSQuoteRequest`
- **THEN** it SHALL return an object with `base_rate`, `taxes`, `fees`, `total_amount`, `currency`, `amountCharged`, and `raw_response`

#### Scenario: Force full payment
- **WHEN** the hotel's `payment_configuration.force_full_payment` is true
- **THEN** `amountCharged` SHALL equal `total_amount`

#### Scenario: Two-decimal precision
- **WHEN** any monetary value is surfaced in a quote
- **THEN** it SHALL be rounded to exactly two decimal places

### Requirement: Reservation Creation
The system SHALL create a reservation in Cloudbeds via `POST /postReservation` using Stripe-derived payment identifiers when available.

#### Scenario: Credit path with Stripe ids
- **WHEN** `createReservation` is called and both `customer.payment_provider_customer_id` and the related `payment.booking_confirmation_id` are present
- **THEN** the request SHALL include `paymentMethod=credit`, `cardToken=<payment_provider_customer_id>`, `paymentAuthorizationCode=<booking_confirmation_id>`

#### Scenario: Missing Stripe ids fallback
- **WHEN** either `payment_provider_customer_id` or `booking_confirmation_id` is missing
- **THEN** the request SHALL fall back to `paymentMethod=cash` without `cardToken`/`paymentAuthorizationCode` and the service SHALL log a warning identifying the booking_id

#### Scenario: Single-room payload shape
- **WHEN** building the request body
- **THEN** the service SHALL send `startDate`, `endDate`, `guestFirstName`, `guestLastName`, `guestCountry`, `guestZip`, `guestEmail`, `rooms[0][roomTypeID]=<room_id>`, `rooms[0][quantity]=1`, `adults[0][roomTypeID]=<room_id>`, `adults[0][quantity]=<num_adults>`, `children[0][roomTypeID]=<room_id>`, `children[0][quantity]=<num_children>`

#### Scenario: Reservation id mapping
- **WHEN** Cloudbeds returns `{ success: true, reservationID }`
- **THEN** the service SHALL return a `CreateReservationResponse` whose `reservation_id` equals `reservationID`

#### Scenario: Creation failure
- **WHEN** Cloudbeds returns `success: false` or an HTTP error
- **THEN** the service SHALL throw `CloudbedsAPIError` including the Cloudbeds message

### Requirement: Reservation Cancellation
The system SHALL cancel a Cloudbeds reservation via `PUT /putReservation` with `status=canceled`.

#### Scenario: Successful cancellation
- **WHEN** `cancelReservation` is called with a Cloudbeds `external_id`
- **THEN** the service SHALL send `propertyID=<business_id>`, `reservationID=<external_id>`, `status=canceled` and return the mapped response

#### Scenario: Cancellation failure
- **WHEN** Cloudbeds returns `success: false`
- **THEN** the service SHALL throw `CloudbedsAPIError` including the Cloudbeds message

### Requirement: Stripe-Triggered Autocharge
The system SHALL record Stripe `invoice_payment.paid` autocharges in Cloudbeds via `POST /postPayment` for reservations whose `pms_provider` is `cloudbeds`.

#### Scenario: postPayment called after invoice_payment.paid
- **WHEN** `handleInvoicePaymentSucceeded` processes a successful invoice payment and a reservation has `pms_provider = cloudbeds`
- **THEN** the system SHALL call `POST /postPayment` with `propertyID`, `reservationID=<external_id>`, `type=credit`, `amount=<per-reservation share of invoice amount_paid>`, `description="Advance deposit"`, `cardType=""`

#### Scenario: Missing external_id skip
- **WHEN** a Cloudbeds reservation has no `external_id`
- **THEN** the system SHALL log a warning and skip `postPayment` for that reservation without failing other reservations

#### Scenario: Non-Cloudbeds reservations unaffected
- **WHEN** a reservation's `pms_provider` is not `cloudbeds`
- **THEN** the existing Hostaway offline-charge branch SHALL continue to execute unchanged

### Requirement: Deferred Modification and Multi-Room Operations
The system SHALL explicitly reject modification and multi-room flows for Cloudbeds until those capabilities are implemented.

#### Scenario: Modification guard
- **WHEN** `modifyReservation` or `getQuoteForModification` is invoked on a Cloudbeds hotel
- **THEN** the service SHALL throw `BadRequestError` with a message indicating the operation is not yet supported for Cloudbeds

#### Scenario: Multi-room guard
- **WHEN** `getMultiRoomAvailabilityWithQuote` or `getMultiRoomAvailabilityWithQuoteLite` is invoked on a Cloudbeds hotel
- **THEN** the service SHALL throw `BadRequestError` with a message indicating multi-room is not yet supported for Cloudbeds

### Requirement: Error Handling and Logging
The system SHALL handle Cloudbeds API errors uniformly with typed errors and context-aware logging.

#### Scenario: API error class
- **WHEN** Cloudbeds responds with `success: false` or an HTTP 4xx/5xx status
- **THEN** the client SHALL throw `CloudbedsAPIError` containing the upstream message, HTTP status, and request context

#### Scenario: Configuration error class
- **WHEN** required per-hotel credentials are missing
- **THEN** the service SHALL throw `CloudbedsConfigurationError`

#### Scenario: Room unavailable error class
- **WHEN** an availability call returns no room types or zero availability for all rooms in a requested window during a single-room booking attempt
- **THEN** the service SHALL throw `CloudbedsRoomUnavailableError`

#### Scenario: Winston logging with requestId
- **WHEN** any Cloudbeds API call begins or ends (success or error)
- **THEN** the service SHALL log via Winston with the requestId from AsyncLocalStorage

### Requirement: Raw Response Storage
The system SHALL preserve complete Cloudbeds API responses for quotes in the existing `quote_object` JSONB field for audit/debugging parity with other PMS providers.

#### Scenario: Quote raw_response populated
- **WHEN** a quote is generated from Cloudbeds `getRate` data
- **THEN** the response SHALL be stored under `PMSQuote.raw_response` and persisted into the `quote_object` JSONB on insert

#### Scenario: Quote raw_response returned on retrieval
- **WHEN** a quote is retrieved from the database
- **THEN** `raw_response` SHALL be returned alongside the structured quote fields
