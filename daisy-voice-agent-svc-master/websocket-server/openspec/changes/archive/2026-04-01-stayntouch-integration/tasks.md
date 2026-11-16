## 1. Configuration Setup

- [x] 1.1 Add STAYNTOUCH_BASE_URL and STAYNTOUCH_TOKEN to .env.example
- [x] 1.2 Update config.ts to include Stayntouch environment variables with proper typing
- [x] 1.3 Add validation for required Stayntouch environment variables (base URL and token only)
- [ ] 1.4 Document Stayntouch configuration in README

## 2. Error Classes

- [x] 2.1 Create StayntouchAPIError class extending Error with statusCode property
- [x] 2.2 Create StayntouchConfigurationError class extending Error with statusCode property
- [x] 2.3 Create StayntouchRoomUnavailableError class extending Error with statusCode property

## 3. TypeScript Models and DTOs

- [x] 3.1 Create Stayntouch availability request/response DTOs (room types, rate codes, deposit/cancel rules)
- [x] 3.2 Create Stayntouch room rates request/response DTOs (pricing breakdown, stay dates)
- [x] 3.3 Update Quote model to include raw_response property within quote_object structure

## 4. Stayntouch Service Implementation

- [x] 4.1 Create /src/stayntouch directory structure
- [x] 4.2 Implement Stayntouch API client with axios configuration (API-Version header, Authorization)
- [x] 4.3 Implement getAvailability method to call availability endpoint with is_channel_manager=true
- [x] 4.4 Implement getRoomRates method to call room_rates endpoint for specific room type and rate
- [x] 4.5 Implement orchestration method that combines both API calls and returns unified availability data
- [x] 4.6 Add configuration loading logic from environment variables
- [x] 4.7 Implement first rate_id selection logic for each room type
- [x] 4.8 Add error handling with custom error classes for API failures, timeouts, and auth errors
- [x] 4.9 Add Winston logging with requestId context for all API calls and errors
- [x] 4.10 Ensure all monetary values are formatted to exactly two decimal places

## 5. Quote Repository Updates

- [x] 5.1 Update quote repository to handle raw_response property within quote_object on insert
- [x] 5.2 Update quote repository to return raw_response property on retrieval
- [x] 5.3 Add methods to query quotes by raw_response content if needed for debugging

## 6. PMS Factory Integration

- [x] 6.1 Update PMS factory to recognize 'stayntouch' as a valid provider type
- [x] 6.2 Add Stayntouch service instantiation logic in factory
- [x] 6.3 Ensure Stayntouch service implements common PMS provider interface (or adapt as needed)

## 7. Quote Creation Flow

- [x] 7.1 Update quote creation logic to populate raw_response property within quote_object with complete Stayntouch API response
- [x] 7.2 Map Stayntouch response fields to quote_object structure (total_stay_cost, taxes, stay_dates)
- [x] 7.3 Store rate_code and room_type_id in quote_object for future reservation creation
- [x] 7.4 Store deposit_rule_info and cancel_rule_info in quote_object for user display
- [x] 7.5 Handle empty availability responses gracefully (no error, just empty result)

## 8. Validation

- [x] 8.1 Add validation for availability request parameters (dates, adults, children)
- [x] 8.2 Add validation for room rates request parameters (rate_id, room_type_id)

## 9. Testing

- [ ] 9.1 Test availability API call with Stayntouch UAT environment
- [ ] 9.2 Test room rates API call for multiple room types
- [ ] 9.3 Test quote creation with raw_response property storage and retrieval within quote_object
- [ ] 9.4 Test error scenarios (missing env vars, API failures, invalid responses)
- [ ] 9.5 Verify two decimal place precision for all monetary values
- [ ] 9.6 Test with multiple rate codes to confirm first rate_id selection logic

## 10. Documentation

- [x] 10.1 Add inline code documentation for Stayntouch service methods
- [ ] 10.2 Document Stayntouch-specific configuration in README
- [x] 10.3 Add comments explaining two-step API flow and rate selection logic
