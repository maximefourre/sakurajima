/**
 * season.js — pure season resolver.
 *
 * Priority: valid ?season= query param, then valid persisted storage value,
 * then DEFAULT_SEASON. Membership is checked against SEASONS; invalid values
 * never collapse to spring before the next source has a chance to speak.
 */

import { SEASONS, DEFAULT_SEASON } from './config.js';

export const SEASON_QUERY_PARAM = 'season';
export const SEASON_STORAGE_KEY = 'sakurajima.season';

export function isSeason(value) {
  return Object.prototype.hasOwnProperty.call(SEASONS, value);
}

export function resolveSeason({ search = '', storage = null } = {}) {
  const requested = new URLSearchParams(search).get(SEASON_QUERY_PARAM);
  if (isSeason(requested)) return requested;

  if (storage) {
    try {
      const stored = storage.getItem(SEASON_STORAGE_KEY);
      if (isSeason(stored)) return stored;
    } catch { /* private mode / blocked storage — fall through */ }
  }

  return DEFAULT_SEASON;
}
