/**
 * Email notification opt-out preference (account-scoped, independent of
 * the device-scoped push toggle in pushService.ts).
 */

import { api } from './api';

export async function getEmailNotificationsEnabled(): Promise<boolean> {
  const { data } = await api.get<{ enabled: boolean }>('/notification-preferences/email');
  return data.enabled;
}

export async function setEmailNotificationsEnabled(enabled: boolean): Promise<void> {
  await api.patch('/notification-preferences/email', { enabled });
}
