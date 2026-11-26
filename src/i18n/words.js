// The game's words in the language in force: pick, t, tname, tlist (the contract is in src/i18n.js, which re-exports these).
// Plain code, no page and no storage: the language is set by i18n.js (setLang, from the browser's stored choice), and the
// simulation's own texts (a battle's tally, a custom battle's blurb, a roster line) read it here without reaching for the page
// (port groundwork, the user's call, 2026-11-26).

import { UI } from './ui.js';
import { NAMES_ZH } from './names.js';
import { NAME_PARTS, NAME_PARTS_EAST, NAME_TITLES } from './names-parts.js';

let langNow = 'en';

export const getLang = () => langNow;

/** The language in force, set (i18n.js setLang checks it, stores it and tells the page). */
export function setLangNow(lang) {
  langNow = lang;
}

/** A `{ en, zh }` text in the language in force (en when the other is missing); a string as it is. */
export function pick(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'object') return String(text);
  return (langNow !== 'en' && text[langNow]) || text.en || '';
}

const fillVars = (template, vars) => (vars ? template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : template);

/** A UI string by key, its `{placeholders}` filled. */
export function t(key, vars) {
  const entry = UI[key];
  if (!entry) return key;
  return fillVars(pick(entry), vars);
}

/** A proper name kept English in the data, in the language in force. */
export function tname(english) {
  if (langNow === 'en' || english === null || english === undefined) return english ?? '';
  return NAMES_ZH[english] ?? kitTail(english) ?? personalName(english) ?? english;
}

// A kit's name past its dash, as a warrior's line shows it ('Knights Templar — mail, surcoat and great helm' → 'mail, surcoat
// and great helm'): its Chinese the same way ('圣殿骑士——锁子甲、罩袍、桶盔' → '锁子甲、罩袍、桶盔'). Built once, on first need.
let kitTails = null;
function kitTail(english) {
  if (!kitTails) {
    kitTails = new Map();
    for (const [name, zh] of Object.entries(NAMES_ZH)) {
      if (name.includes(' — ') && zh.includes('——')) kitTails.set(name.split(' — ').pop(), zh.split('——').pop());
    }
  }
  return kitTails.get(english);
}

/**
 * A soldier's own name, made of parts (cast.js: 'Wang Da', 'Sgt. Reyes', 'Hans von Uri', 'Wat the Miller'), in Chinese part by
 * part (src/i18n/names-parts.js): the longest run of words found first; East Asian names run together (王大, 井伊直政), any
 * other with the transliteration's dot (汉斯·冯·乌里); a title or rank after the name, as Chinese has it (雷耶斯中士).
 * A token with a digit in it (a second 'Wang 2', an android's 'H-1 Unit 523') is kept as it is, run onto the part before it.
 * All or nothing: a name with any part not in the tables stays English. Null when it is not one.
 */
function personalName(english) {
  const words = english.split(' ').filter(Boolean);
  const parts = [];
  const titles = [];
  let east = true;
  for (let at = 0; at < words.length;) {
    if (/\d/.test(words[at])) {
      if (parts.length) parts[parts.length - 1] += words[at];
      else parts.push(words[at]);
      at += 1;
      continue;
    }
    let found = false;
    for (let end = words.length; end > at && !found; end -= 1) {
      const run = words.slice(at, end).join(' ');
      const zh = NAME_TITLES[run] ?? NAME_PARTS_EAST[run] ?? NAME_PARTS[run];
      if (zh === undefined) continue;
      if (run in NAME_TITLES) titles.push(zh);
      else {
        if (!(run in NAME_PARTS_EAST)) east = false;
        if (zh) parts.push(zh);
      }
      at = end;
      found = true;
    }
    if (!found) return null;
  }
  if (!parts.length) return null;
  return parts.join(east ? '' : '·') + titles.join('');
}

/** Names joined as the language joins a list. */
export const tlist = (strings) => strings.map(tname).join(langNow === 'zh' ? '、' : ', ');

/** The separator between the parts of a line ("Sword · Plate"), which the two languages share. */
export const SEP = ' · ';
