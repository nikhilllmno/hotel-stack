// Claude for proposal drafting and review. Key from hotel-stack/.env (ANTHROPIC_API_KEY).
client<llm> Claude {
  provider anthropic
  options {
    model "claude-opus-5-5"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 16000
  }
}
