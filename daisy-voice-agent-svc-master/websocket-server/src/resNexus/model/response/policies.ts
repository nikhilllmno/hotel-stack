export interface GetPoliciesResponse {
  policies: Policies;
  response_errors: string[];
}

export interface Policies {
  GeneralPolicies: string;
  AdditionalPolicies: string;
  ArrivalTimes: string;
  InitialDepositPolicies: string;
  ScheduledDepositPolicies: string;
  ChildrenAndPetPolicies: string;
  CreditCardSecurity: string;
}
