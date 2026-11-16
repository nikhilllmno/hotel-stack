import { Call, VapiCustomer, VapiPhoneNumber } from './EndOfCallReport';

export interface StatusUpdateObject {
  message?: StatusUpdateObjectMessage;
}

interface StatusUpdateObjectMessage {
  artifact?: any;
  assistant?: any;
  call?: Call;
  customer?: VapiCustomer;
  endedReason?: string;
  phoneNumber?: VapiPhoneNumber;

  // maintaining as string so that it remains future proof
  status?: string;
  timestamp?: number;
  type?: string;
}

export enum StatusUpdateType {
  InProgress = 'in-progress',
  Ended = 'ended',
}
