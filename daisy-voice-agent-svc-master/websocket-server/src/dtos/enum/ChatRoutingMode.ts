export enum ChatRoutingMode {
  AI = 'AI',
  DIRECT = 'DIRECT',
}

export interface ChatRoutingResult {
  mode: ChatRoutingMode;
  agent_may_reply: boolean;
}
