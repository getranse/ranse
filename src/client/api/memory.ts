import type { CustomerMemoryEntry } from '../types/memory';
import { api } from './core';

export const memoryApi = {
  listCustomerMemory: (customerId: string) =>
    api<{ memory: CustomerMemoryEntry[] }>(`/api/memory/customers/${customerId}`),
  addCustomerMemory: (
    customerId: string,
    body: { fact_text: string; kind?: string; confidence?: number },
  ) =>
    api<{ memory: CustomerMemoryEntry }>(`/api/memory/customers/${customerId}`, {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, ...body }),
    }),
  redactCustomerMemory: (customerId: string, memoryId: string, reason: string) =>
    api(`/api/memory/customers/${customerId}/redact/${memoryId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
