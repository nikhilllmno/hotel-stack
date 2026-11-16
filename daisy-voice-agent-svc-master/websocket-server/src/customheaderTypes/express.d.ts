// This file extends the Express Request type to include our custom properties
import 'express';
import { Request } from 'express';
export interface CustomRequest<
  T = any,
  P = any,
  B = any,
  L = any,
> extends Request<T, P, B, L> {
  phoneNumber?: string;
  sessionId?: string;
  assistantPhoneNumber?: string;
  sessionType?: string;
  businessId?: string;
  hotelId?: string;
}

export {};
