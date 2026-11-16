## Context

The Daisy Voice Agent Service currently supports two PMS providers (ResNexus and Hostaway) through a factory pattern abstraction in `/src/pms/`. Hotels are configured with their PMS provider type and credentials in the `hotel_configurations` table. The reservation flow involves querying the PMS for availability, generating quotes, and creating reservations.

Stayntouch uses a different API structure than existing providers:
1. First call: GET availability endpoint with `is_channel_manager=true` to retrieve available room types with their rate codes
2. Second call: GET room_rates endpoint for each room type using the first rate_id from step 1
3. The second call returns detailed pricing breakdown including taxes, addons, and per-night costs

Current state:
- PMS factory pattern exists with ResNexus and Hostaway implementations
- Quote model stores reservation pricing data
- Hotel configurations table stores PMS provider settings

## Goals / Non-Goals

**Goals:**
- Integrate Stayntouch as a third PMS provider option
- Support Stayntouch's two-step availability API flow
- Store complete API response history in quote objects via `raw_response` field
- Enable hotels to configure Stayntouch credentials (base URL, API token, business ID)
- Maintain consistency with existing PMS provider patterns
- Support precision of two decimal places for all monetary values

**Non-Goals:**
- Reservation modification, cancellation, or multi-room booking flows (deferred)
- Payment processing integration (deferred)
- Discount application or pet fee handling (deferred)
- Migration of existing hotels from other PMS providers to Stayntouch
- Real-time webhook integration from Stayntouch

## Decisions

### 1. PMS Provider Implementation Location
**Decision:** Create `/src/stayntouch/` directory following the pattern of `/src/resNexus/` and `/src/hostaway/`

**Rationale:** Maintains consistency with existing codebase structure. Each PMS provider has its own directory for provider-specific logic, DTOs, and API client code.

**Alternatives considered:**
- Generic implementation in `/src/pms/`: Rejected because Stayntouch has unique API patterns that don't fit a generic abstraction
- Shared utilities approach: Rejected because it would complicate the existing clean separation

### 2. Two-Step API Call Strategy
**Decision:** Implement a service method that orchestrates both API calls internally and returns a unified result

**Rationale:** 
- Encapsulates Stayntouch-specific complexity
- Provides a clean interface to controllers/callers
- Allows for caching optimization in the future
- Matches the pattern where other PMS providers make single availability calls

**Alternatives considered:**
- Expose both calls separately: Rejected because it leaks Stayntouch-specific details to callers
- Make parallel calls for all room types: Rejected for initial implementation to avoid complexity; can optimize later

### 3. Rate Code Selection Logic
**Decision:** Use the first rate_id from the availability response for each room type

**Rationale:** 
- Explicit requirement from integration specification
- Simplifies initial implementation
- Logic can be enhanced later based on business requirements (e.g., cheapest rate, specific rate code priority)

**Alternatives considered:**
- Allow caller to specify rate selection strategy: Deferred as over-engineering for initial implementation
- Select cheapest rate automatically: Rejected because requirements specify "first rate"

### 4. Raw Response Storage
**Decision:** Add `raw_response` property within the existing `quote_object` JSONB column to store the complete Stayntouch API response

**Rationale:**
- Preserves complete historical data for auditing and debugging
- API response structure may change over time
- Enables future analytics without re-querying Stayntouch
- No database migration needed - uses existing quote_object JSONB structure
- Maintains consistency with existing quote data storage pattern

**Alternatives considered:**
- New JSONB column: Rejected because quote_object already exists and can hold this data
- Store in separate audit table: Rejected as over-engineering
- Store only selected fields: Rejected because it loses historical context

### 5. Configuration Storage
**Decision:** Store Stayntouch API credentials in environment variables, hotel-specific business_id in database

**Rationale:**
- API credentials (base URL, token) are shared across all hotels
- Each hotel has a unique business_id in Stayntouch system
- business_id is stored in the hotels table's existing business_id column
- Follows existing pattern where hotel-specific identifiers are in database
- Allows different hotels to use different Stayntouch business accounts

**Environment variables:**
- `STAYNTOUCH_BASE_URL`: API base URL (e.g., https://api.stayntouch.com/connect)
- `STAYNTOUCH_TOKEN`: API authentication token

**Database fields:**
- `hotels.business_id`: Hotel's unique identifier in Stayntouch (passed as parameter to API calls)

**Alternatives considered:**
- Global business_id in environment: Rejected because each hotel has its own business_id in Stayntouch
- Store token per hotel: Rejected because all hotels share the same API credentials

### 6. Error Handling Strategy
**Decision:** Create Stayntouch-specific error classes extending base Error with statusCode property

**Rationale:**
- Follows existing pattern (DuplicateUserError, InvalidCredentialsError, etc.)
- Enables proper HTTP response mapping
- Provides clear error context for logging and debugging

**Error classes needed:**
- `StayntouchAPIError`: For API communication failures
- `StayntouchConfigurationError`: For missing/invalid configuration
- `StayntouchRoomUnavailableError`: For no availability scenarios

## Risks / Trade-offs

**Risk:** Stayntouch API rate limits or performance issues with sequential room rate calls  
**Mitigation:** Start with sequential calls; monitor performance; implement parallel calls or caching if needed

**Risk:** API response structure changes breaking the integration  
**Mitigation:** Store raw_response for historical reference; implement version checking if Stayntouch provides API versioning

**Risk:** First rate selection logic may not always provide optimal pricing  
**Mitigation:** Document this limitation; design service method to allow future enhancement of rate selection strategy

**Trade-off:** Adding raw_response to quote_object increases JSONB field size  
**Acceptance:** Storage cost is minimal compared to value of historical data preservation

**Trade-off:** Sequential API calls add latency to quote generation  
**Acceptance:** Acceptable for initial implementation; can optimize with parallel calls later if needed

## Migration Plan

1. **Configuration:**
   - Add `STAYNTOUCH_BASE_URL` and `STAYNTOUCH_TOKEN` to `.env.example`
   - Update `config.ts` to include Stayntouch environment variables with proper typing
   - Document configuration in README
   - Note: business_id is retrieved from hotels.business_id column in database

2. **Deployment:**
   - Set environment variables in deployment environment
   - No downtime required (additive changes only)
   - No database migrations needed
   - Existing hotels continue using ResNexus/Hostaway unaffected

3. **Rollback Strategy:**
   - Revert code deployment
   - Remove environment variables if needed
   - No database changes to rollback

4. **Testing:**
   - Test with Stayntouch UAT environment first
   - Verify quote creation with sample date ranges
   - Confirm raw_response storage and retrieval

## Open Questions

- **Q:** Should we validate the Stayntouch API response structure strictly or handle it flexibly?  
  **A:** Start with flexible handling (optional chaining, default values) but log warnings for unexpected structures

- **Q:** How should we handle rooms with zero availability in the response?  
  **A:** Filter them out from the quote generation; only present available rooms to the user

- **Q:** Should we cache availability responses to reduce API calls?  
  **A:** Not in initial implementation; add if performance becomes an issue
