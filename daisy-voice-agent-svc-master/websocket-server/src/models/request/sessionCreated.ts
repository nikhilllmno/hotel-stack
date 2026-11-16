import { SessionType } from '../../dtos/enum/SessionType';

export interface VapiSessionCreatedMessage {
  type: string;
  assistant?: {
    variableValues?: {
      customer?: {
        number?: string | number;
      };
      assistant_phone_number?: string | number;
      session_type?: SessionType | string;
    };
  };
}

export interface VapiSessionCreatedPayload {
  message: VapiSessionCreatedMessage;
}
