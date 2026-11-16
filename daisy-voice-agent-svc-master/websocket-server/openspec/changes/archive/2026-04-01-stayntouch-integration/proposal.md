## Why

Stayntouch is a Property Management System (PMS) provider that needs to be integrated into the Daisy Voice Agent Service to expand hotel compatibility beyond the existing ResNexus and Hostaway integrations. This integration enables hotels using Stayntouch to leverage the AI-powered voice and SMS reservation assistants, expanding the service's market reach.

## What Changes

- Add Stayntouch as a third PMS provider option alongside ResNexus and Hostaway
- Implement Stayntouch API client for room availability and rate retrieval
- Create reservation quote generation flow using Stayntouch's two-step availability API (room types → room rates)
- Store Stayntouch API credentials (base URL, API token) in environment variables; hotel-specific business_id from database
- Add `raw_response` property within existing `quote_object` JSONB field to preserve historical API response data
- Support Stayntouch's rate code and room type ID structure in the reservation flow

## Capabilities

### New Capabilities
- `stayntouch-pms-integration`: Integration with Stayntouch PMS API for room availability, rate retrieval, and reservation quote creation

### Modified Capabilities
<!-- No existing capabilities are being modified at the requirement level -->

## Impact

- **Code**: New Stayntouch service class in `/src/pms/` or `/src/stayntouch/`, updates to PMS factory pattern
- **APIs**: New internal endpoints or service methods for Stayntouch availability and rate queries
- **Configuration**: New environment variables for Stayntouch base URL and default token
- **Data Model**: Quote object structure updated to include `raw_response` property within existing `quote_object` JSONB field
- **Dependencies**: Potential new HTTP client configuration for Stayntouch API (API-Version header requirement)
