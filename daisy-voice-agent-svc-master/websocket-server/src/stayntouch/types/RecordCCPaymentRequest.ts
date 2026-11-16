export interface RecordCCPaymentRequest {
  amount: number;
  authorization_code: string;
  reference_text?: string;
  code?: string;
  token: string;
  masked_card_number: string;
  attach_cc_to_reservation: boolean;
  transaction_id: string;
  req_reference_no: string;
  expiry_date: string;
}
