import { text } from './common.ts';

export interface ResourceConfiguration {
  title: string;
  intro: string;
  theme: 'daylight' | 'midnight';
  layout: 'grid' | 'editorial';
  guestAccess: 'closed' | 'postcards';
}

export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function resourceConfiguration(value: unknown): ResourceConfiguration {
  const keys = ['title', 'intro', 'theme', 'layout', 'guestAccess'];
  if (!object(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key))) {
    throw Error('Use the complete declared Guestbook configuration.');
  }
  const title = text(value.title, 80), intro = text(value.intro, 240);
  if (!title || /[\u0000-\u001f\u007f]/.test(title + intro)) throw Error('Use an ordinary title and introduction.');
  if (value.theme !== 'daylight' && value.theme !== 'midnight') throw Error('Choose a supported theme.');
  if (value.layout !== 'grid' && value.layout !== 'editorial') throw Error('Choose a supported layout.');
  if (value.guestAccess !== 'closed' && value.guestAccess !== 'postcards') throw Error('Choose closed or moderated guest postcards.');
  return { title, intro, theme: value.theme, layout: value.layout, guestAccess: value.guestAccess };
}
