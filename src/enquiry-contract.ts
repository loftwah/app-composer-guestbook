import { enquiryValues } from './enquiry-model.ts';

export const enquiryContract = 1 as const;
export const enquiryRetentionDays = 30;
export const enquiryReceiptDays = 35;
export const enquiryQueueLimit = 16;
export const enquiryDailyLimit = 20;
export const enquiryStoredLimit = 200;
export const enquiryScopeLimit = 32;
export const enquiryOwnerDailyLimit = 100;
export type EnquiryState = 'pending' | 'reviewed' | 'rejected' | 'deleted' | 'expired';
export interface StandaloneScope { kind: 'standalone'; resource: string; configuration: number }
export interface ComposerScope { kind: 'composer.publication'; resource: string; configuration: number; stack: string; publication: number; instance: string }
export type EnquiryScope = StandaloneScope | ComposerScope;
export interface EnquirySubmission { intent: string; values: Record<string, unknown>; consent: true }

export class EnquiryError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const enquiryID = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{6,64}$/.test(value);
export const enquiryIntent = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const enquiryRevision = (value: unknown, zero = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (zero ? 0 : 1);
export const enquiryRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function enquiryKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!enquiryRecord(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new EnquiryError('Use only the declared private enquiry fields.');
  }
}
export async function enquiryDigest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
// Resource authority comes from the verified route. It is never accepted as a
// body selector; standalone and Composer provenance cannot fall back to each other.
export function enquiryScope(value: unknown, resource: string): EnquiryScope {
  if (!enquiryID(resource) || !enquiryRecord(value)) throw new EnquiryError('Choose this resource’s declared enquiry scope.');
  const kind = value.kind;
  if (kind === 'standalone') {
    enquiryKeys(value, ['kind', 'configuration']);
    if (!enquiryRevision(value.configuration)) throw new EnquiryError('Choose an activated configuration.');
    return {kind,resource,configuration:value.configuration};
  }
  if (kind === 'composer.publication') {
    enquiryKeys(value, ['kind', 'configuration', 'stack', 'publication', 'instance']);
    if (!enquiryRevision(value.configuration) || !enquiryRevision(value.publication) || !enquiryID(value.stack) || !enquiryID(value.instance)) {
      throw new EnquiryError('Choose an exact immutable Composer publication and visitor-book instance.');
    }
    return {kind,resource,configuration:value.configuration,stack:value.stack,publication:value.publication,instance:value.instance};
  }
  throw new EnquiryError('Choose the standalone or verified Composer publication scope.');
}
export async function enquiryScopeKey(scope: EnquiryScope) {
  return scope.kind === 'standalone' ? 'standalone' : await enquiryDigest('guestbook.enquiry-scope/1\0' + JSON.stringify(scope));
}
export function enquirySubmission(value: unknown): EnquirySubmission {
  enquiryKeys(value, ['contract', 'intent', 'values', 'consent']);
  if (value.contract !== enquiryContract || !enquiryIntent(value.intent)) throw new EnquiryError('Use this form’s private enquiry intent.');
  if (value.consent !== true) throw new EnquiryError('Confirm private delivery to this workspace. This does not permit publication or messages.');
  let values: Record<string, unknown>;
  try { values = enquiryValues(value.values); }
  catch (error) { throw new EnquiryError(error instanceof Error ? error.message : 'Check the declared brief fields.'); }
  if (new TextEncoder().encode(JSON.stringify(values)).byteLength > 10240) throw new EnquiryError('Keep the private brief within 10 KB of text. Your input is retained.');
  return {intent:value.intent,values,consent:true};
}
