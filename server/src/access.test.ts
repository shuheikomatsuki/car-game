import { describe, expect, it } from 'vitest';
import { checkAccess } from './access';

const config = { allowedOrigins: 'https://example.github.io', allowedCountries: 'JP' };

describe('checkAccess', () => {
  it('accepts the game page from Japan', () => {
    expect(checkAccess('https://example.github.io', 'JP', config)).toBeNull();
  });

  it('rejects other sites and requests without an Origin', () => {
    expect(checkAccess('https://evil.example', 'JP', config)).toBe('origin');
    expect(checkAccess(null, 'JP', config)).toBe('origin');
    expect(checkAccess('https://example.github.io.evil.example', 'JP', config)).toBe('origin');
  });

  it('always accepts pages opened on this machine', () => {
    expect(checkAccess('http://localhost:5173', 'JP', config)).toBeNull();
    expect(checkAccess('http://127.0.0.1:4173', 'JP', config)).toBeNull();
    expect(checkAccess('https://localhost', 'JP', config)).toBe('origin');
  });

  it('rejects other countries and unknown locations', () => {
    expect(checkAccess('https://example.github.io', 'US', config)).toBe('region');
    expect(checkAccess('https://example.github.io', undefined, config)).toBe('region');
    expect(checkAccess('https://example.github.io', 'T1', config)).toBe('region');
  });

  it('lets "*" turn each check off', () => {
    const open = { allowedOrigins: '*', allowedCountries: '*' };
    expect(checkAccess(null, undefined, open)).toBeNull();
    expect(checkAccess('https://example.github.io', 'US', { ...config, allowedCountries: 'JP, us' })).toBeNull();
  });
});
