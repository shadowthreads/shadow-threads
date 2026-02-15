import { type DomainName } from './types';

const FIELD_WHITELIST: Record<DomainName, readonly string[]> = {
  facts: ['value', 'confidence'],
  decisions: ['answer', 'rationale', 'confidence'],
  constraints: ['rule', 'strength', 'scope'],
  risks: ['probability', 'impact', 'mitigation'],
  assumptions: ['statement', 'confidence'],
};

export function getFieldWhitelist(domain: DomainName): readonly string[] {
  return FIELD_WHITELIST[domain];
}
