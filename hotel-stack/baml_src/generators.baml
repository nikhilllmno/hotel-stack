// Generates src/hotelcore/baml_client (Pydantic types + typed functions). Run: uv run baml-cli generate
generator target {
  output_type "python/pydantic"
  output_dir "../src/hotelcore"
  default_client_mode "sync"
  version "0.226.3"
}
