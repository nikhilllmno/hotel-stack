## ADDED Requirements

### Requirement: Stayntouch API Configuration
The system SHALL load Stayntouch API credentials from environment variables and hotel-specific business_id from the database.

#### Scenario: Configuration loaded from environment
- **WHEN** the system initializes the Stayntouch client
- **THEN** the system SHALL load STAYNTOUCH_BASE_URL and STAYNTOUCH_TOKEN from environment variables

#### Scenario: Missing required configuration
- **WHEN** required Stayntouch environment variables are not set
- **THEN** the system SHALL throw a StayntouchConfigurationError with appropriate error message

#### Scenario: Configuration validation
- **WHEN** Stayntouch configuration is loaded
- **THEN** the system SHALL validate that all required fields (base URL, token) are non-empty strings

#### Scenario: Business ID from database
- **WHEN** making API calls to Stayntouch
- **THEN** the system SHALL use the hotel's business_id from the database as the business_id parameter in API requests

### Requirement: Room Availability Retrieval
The system SHALL retrieve available room types and rate codes from Stayntouch using the availability endpoint with channel manager flag.

#### Scenario: Successful availability query
- **WHEN** querying availability for valid date range with adults and children count
- **THEN** the system SHALL call GET /hotels/{business_id}/availability with is_channel_manager=true and return room types with their rate codes

#### Scenario: Multiple rate codes per room type
- **WHEN** a room type has multiple rate codes in the availability response
- **THEN** the system SHALL select the first rate_id from the results array for that room type

#### Scenario: No availability for date range
- **WHEN** querying availability returns empty room_types array
- **THEN** the system SHALL return an empty availability result without error

#### Scenario: API authentication failure
- **WHEN** Stayntouch API returns 401 Unauthorized
- **THEN** the system SHALL throw StayntouchAPIError with authentication failure message

### Requirement: Room Rate Pricing Retrieval
The system SHALL retrieve detailed pricing information for each available room type using the room rates endpoint.

#### Scenario: Successful rate retrieval
- **WHEN** querying room rates with valid rate_id and room_type_id
- **THEN** the system SHALL call GET /hotels/{business_id}/availability/room_rates and return pricing breakdown including total_stay_cost, taxes, and per-night rates

#### Scenario: Multiple room types pricing
- **WHEN** availability returns multiple room types
- **THEN** the system SHALL query room rates for each room type sequentially using the first rate_id

#### Scenario: Rate query failure for one room
- **WHEN** rate retrieval fails for one room type but succeeds for others
- **THEN** the system SHALL log the error and continue processing remaining room types

#### Scenario: Decimal precision for monetary values
- **WHEN** processing any monetary values from Stayntouch API
- **THEN** the system SHALL ensure all amounts are stored with exactly two decimal places

### Requirement: Quote Creation with Raw Response Storage
The system SHALL create reservation quotes in the database with complete API response preservation within the existing quote_object JSONB structure.

#### Scenario: Quote created with raw response
- **WHEN** creating a quote from Stayntouch availability and rate data
- **THEN** the system SHALL store the complete room rates API response in the raw_response property within the quote_object JSONB field

#### Scenario: Quote fields populated from API response
- **WHEN** creating a quote from Stayntouch data
- **THEN** the system SHALL populate quote_object properties from the API response including total_stay_cost, total_inclusive_tax, total_exclusive_tax, and stay_dates array

#### Scenario: Historical data preservation
- **WHEN** a quote is retrieved from the database
- **THEN** the system SHALL return both the structured quote_object properties and the original raw_response for audit purposes

### Requirement: API Request Headers
The system SHALL include required headers for all Stayntouch API requests.

#### Scenario: API version header included
- **WHEN** making any request to Stayntouch API
- **THEN** the system SHALL include 'API-Version: 2.0' header

#### Scenario: Authorization header included
- **WHEN** making any request to Stayntouch API
- **THEN** the system SHALL include 'Authorization: Bearer {token}' header with the token from environment variables

### Requirement: Error Handling and Logging
The system SHALL handle Stayntouch API errors gracefully with appropriate logging.

#### Scenario: API timeout
- **WHEN** Stayntouch API request times out
- **THEN** the system SHALL throw StayntouchAPIError and log the timeout with request context

#### Scenario: Invalid API response structure
- **WHEN** Stayntouch API returns unexpected response structure
- **THEN** the system SHALL log a warning with the unexpected structure and handle gracefully with default values

#### Scenario: Network error
- **WHEN** network connectivity to Stayntouch fails
- **THEN** the system SHALL throw StayntouchAPIError with network error details and log with requestId

### Requirement: Rate Code and Room Type Mapping
The system SHALL correctly map Stayntouch rate codes and room type IDs to internal quote structure.

#### Scenario: Rate code stored in quote
- **WHEN** creating a quote from Stayntouch data
- **THEN** the system SHALL store the rate_code (e.g., "BAR", "BARBB") in the quote metadata

#### Scenario: Room type ID preserved
- **WHEN** creating a quote from Stayntouch data
- **THEN** the system SHALL store the room_type_id for future reservation creation

#### Scenario: Deposit and cancellation rules captured
- **WHEN** availability response includes deposit_rule_info and cancel_rule_info
- **THEN** the system SHALL store these rules in the quote for display to users
