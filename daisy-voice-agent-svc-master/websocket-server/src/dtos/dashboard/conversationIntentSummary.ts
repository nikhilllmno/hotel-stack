interface intentSumary {
  count: number;
  percentage: number;
}
export interface ConversationIntentSummary {
  ENQUIRY: intentSumary;
  UNSUCCESSFUL_RESERVATION_DUE_TO_PRICE: intentSumary;
  CALLBACK: intentSumary;
  NEW_RESERVATION: intentSumary;
  CANCEL_RESERVATION: intentSumary;
  MODIFY_RESERVATION: intentSumary;
  UNKNOWN: intentSumary;
}
