// Re-export from loot-core types so the service can use them without
// a cross-package import (sync-server doesn't depend on loot-core).

export type SyncServerEnableBankingAccount = {
  account_id: string;
  name: string;
  balance: number;
  institution?: string;
  currency?: string;
  uid: string;
};

export type EnableBankingTransaction = {
  booking_date?: string;
  value_date?: string;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  creditor_name?: string;
  debtor_name?: string;
  remittance_information?: string[];
  transaction_id?: string;
};

export type EnableBankingBalance = {
  balance_amount: { amount: string; currency: string };
  balance_type: string;
};
