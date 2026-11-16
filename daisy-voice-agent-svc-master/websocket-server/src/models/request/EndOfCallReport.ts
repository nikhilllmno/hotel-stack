export interface EndOfCallStatus {
  message: EndOfCallStatusMessage;
}

export interface CallTransferRequest {
  message: CallTransferRequestMessage;
}

interface CallTransferRequestMessage {
  timestamp: number;
  type: 'transfer-destination-request';
  call: CallDetails;
  phoneNumber: PhoneNumberDetails;
  customer: CustomerDetails;
}

interface CallDetails {
  id: string;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  cost: number;
  monitor: {
    listenUrl: string;
    controlUrl: string;
  };
  customer: CustomerDetails;
}

interface PhoneNumberDetails {
  id: string;
  orgId: string;
  assistantId: string;
  number: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  provider: string;
  status: string;
  providerResourceId: string;
}

interface CustomerDetails {
  number: string;
  sipUri: string;
}

/** Nested mono tracks in VAPI artifact.recording (2025+ shape). */
export interface VapiCallRecordingMonoArtifact {
  combinedUrl?: string;
  assistantUrl?: string;
  customerUrl?: string;
}

/** VAPI call recording artifact (artifact.recording in end-of-call-report). */
export interface VapiCallRecordingArtifact {
  monoUrl?: string;
  stereoUrl?: string;
  /** Legacy flat URL or nested mono track object. */
  mono?: string | VapiCallRecordingMonoArtifact;
  stereo?: string;
}

export interface VapiCallArtifact {
  recording?: VapiCallRecordingArtifact;
  /** @deprecated Use artifact.recording instead */
  recordingUrl?: string;
  structuredOutputs?: Record<string, unknown>;
}

export interface EndOfCallStatusMessage {
  analysis: Analysis;
  artifact: VapiCallArtifact;
  assistant: any;
  call: Call;
  cost: number;
  costBreakdown: CostBreakdown;
  costs: Cost[];
  customer: VapiCustomer;
  durationMinutes: number;
  durationMs: number;
  durationSeconds: number;
  endedAt: Date;
  endedReason: string;
  messages: MessageObject[];
  phoneNumber: VapiPhoneNumber;
  /** @deprecated Use artifact.recording instead */
  recordingUrl?: string;
  startedAt: Date;
  /** @deprecated Use artifact.recording instead */
  stereoRecordingUrl?: string;
  summary: string;
  timestamp: number;
  transcript: string;
  type: string;
}

interface Analysis {
  structuredData: GuestIntentAndSatisfaction;
  successEvaluation: string;
  summary: string;
}

interface GuestIntentAndSatisfaction {
  guestSatisfactionScore: number;
  intent: GuestIntent[] | string;
}

export enum GuestIntent {
  NEW_RESERVATION = 'NEW_RESERVATION',
  MODIFY_RESERVATION = 'MODIFY_RESERVATION',
  CANCEL_RESERVATION = 'CANCEL_RESERVATION',
  UNSUCCESSFUL_RESERVATION_DUE_TO_PRICE = 'UNSUCCESSFUL_RESERVATION_DUE_TO_PRICE',
  ENQUIRY = 'ENQUIRY',
  CALLBACK = 'CALLBACK',
  UNKNOWN = 'UNKNOWN',
}

export interface MessageObject {
  message?: string;
  // maintaining as string so that it remains future proof
  role: string;
  secondsFromStart: number;
  time: number;
  duration?: number;
  endTime?: number;
  source?: string;
  toolCalls?: ToolCall[];
  name?: string;
  result?: any;
  toolCallId?: string;
}

export enum MessageRole {
  Bot = 'bot',
  System = 'system',
  ToolCallResult = 'tool_call_result',
  ToolCalls = 'tool_calls',
  User = 'user',
}

export interface ToolCall {
  function: ToolCallFunction;
  id: string;
  type: string;
}

interface ToolCallFunction {
  arguments: string;
  name: string;
}

interface VariableValues {
  'account-sid': string;
  'application-sid': string;
  cid: string;
  'forwarded-for': string;
  'originating-carrier': string;
  'voip-carrier-sid': string;
}

export interface Call {
  assistantId: string;
  assistantOverrides: AssistantOverrides;
  createdAt: Date;
  customer: VapiCustomer;
  id: string;
  monitor: Monitor;
  orgId: string;
  phoneCallProvider: string;
  phoneCallProviderDetails: PhoneCallProviderDetails;
  phoneCallProviderId: string;
  phoneCallTransport: string;
  phoneNumberId: string;
  status: string;
  transport: Transport;
  type: string;
  updatedAt: Date;
}

interface AssistantOverrides {
  variableValues: VariableValues;
}

export interface VapiCustomer {
  number: string;
  sipUri: string;
}

interface Monitor {
  controlUrl: string;
  listenUrl: string;
}

interface PhoneCallProviderDetails {
  sbcCallId: string;
}

interface Transport {
  callSid: string;
  provider: string;
  sbcCallSid: string;
}

export interface CostBreakdown {
  analysisCostBreakdown: AnalysisCostBreakdown;
  chat: number;
  knowledgeBaseCost: number;
  llm: number;
  llmCompletionTokens: number;
  llmPromptTokens: number;
  stt: number;
  total: number;
  tts: number;
  ttsCharacters: number;
  vapi: number;
  voicemailDetectionCost: number;
}

interface AnalysisCostBreakdown {
  structuredData: number;
  structuredDataCompletionTokens: number;
  structuredDataPromptTokens: number;
  successEvaluation: number;
  successEvaluationCompletionTokens: number;
  successEvaluationPromptTokens: number;
  summary: number;
  summaryCompletionTokens: number;
  summaryPromptTokens: number;
}

interface Cost {
  cost: number;
  minutes?: number;
  transcriber?: TranscriberClass;
  type: string;
  completionTokens?: number;
  model?: TranscriberClass;
  promptTokens?: number;
  characters?: number;
  voice?: CostVoice;
  subType?: string;
  analysisType?: string;
}

interface TranscriberClass {
  model: string;
  provider: string;
}

interface CostVoice {
  model: string;
  provider: string;
  voiceId: string;
}

export interface VapiPhoneNumber {
  assistantId: string;
  createdAt: Date;
  id: string;
  name: string;
  number: string;
  orgId: string;
  provider: string;
  providerResourceId: string;
  smsEnabled: boolean;
  status: string;
  updatedAt: Date;
}

export enum CustomerSentiment {
  POSITIVE = 'positive',
  NEGATIVE = 'negative',
  NEUTRAL = 'neutral',
  MIXED = 'mixed',
  UNKNOWN = 'unknown',
}
