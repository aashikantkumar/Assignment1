const EMAIL_REGEX = /[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
// Matches common phone formats: e.g., +1 234-567-8900, (123) 456-7890, 123-456-7890
const PHONE_REGEX = /(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}/g;
// Matches 13-16 digit numbers that look like credit cards (simple validation)
const CARD_REGEX = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b|\b\d{13,16}\b/g;
// Matches US SSN format: XXX-XX-XXXX
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

export interface RedactResult {
  redactedText: string;
  piiDetected: boolean;
}

export function redactPII(text: string): RedactResult {
  if (!text) {
    return { redactedText: '', piiDetected: false };
  }

  let redactedText = text;
  let piiDetected = false;

  const emailRedacted = redactedText.replace(EMAIL_REGEX, '[EMAIL]');
  if (emailRedacted !== redactedText) {
    piiDetected = true;
    redactedText = emailRedacted;
  }

  const phoneRedacted = redactedText.replace(PHONE_REGEX, '[PHONE]');
  if (phoneRedacted !== redactedText) {
    piiDetected = true;
    redactedText = phoneRedacted;
  }

  const cardRedacted = redactedText.replace(CARD_REGEX, '[CARD]');
  if (cardRedacted !== redactedText) {
    piiDetected = true;
    redactedText = cardRedacted;
  }

  const ssnRedacted = redactedText.replace(SSN_REGEX, '[SSN]');
  if (ssnRedacted !== redactedText) {
    piiDetected = true;
    redactedText = ssnRedacted;
  }

  return { redactedText, piiDetected };
}
