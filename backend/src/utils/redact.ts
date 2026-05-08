/**
 * Utility functions for redacting sensitive data in logs
 * Prevents exposure of PII, tokens, passwords, and other sensitive information
 */

/**
 * Strip HTML tags and null bytes from free-text inputs to prevent stored XSS.
 * Use on any user-supplied text field before persisting to the database.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')   // strip HTML tags
    .replace(/\0/g, '')        // strip null bytes
    .trim();
}

/**
 * Redact sensitive data from logs
 * Recursively searches for and redacts sensitive field names
 */
export const redactSensitiveData = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'session',
    'apiKey',
    'secret',
    'ssn',
    'creditCard',
    'cvv',
    'pin',
  ];

  const redacted = Array.isArray(data) ? [...data] : { ...data };

  for (const key in redacted) {
    const lowerKey = key.toLowerCase();
    
    // Check if key contains sensitive field name
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      redacted[key] = '[REDACTED]';
    } 
    // Recursively redact nested objects
    else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }

  return redacted;
};

/**
 * Redact email addresses (show only first 2 chars + domain)
 * Example: john.doe@example.com -> jo***@example.com
 */
export const redactEmail = (email: string): string => {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  return `${local.substring(0, 2)}***@${domain}`;
};

/**
 * Redact Entra ID (show only first/last 4 chars)
 * Example: 12345678-1234-1234-1234-123456789abc -> 1234...9abc
 */
export const redactEntraId = (id: string): string => {
  if (!id || id.length < 12) return '[REDACTED]';
  return `${id.substring(0, 4)}...${id.substring(id.length - 4)}`;
};
