import { EMPTY_MAP } from "./core";
import { type Query } from "./query";
import { parse_query } from "./query_parsing";
const freeze = Object.freeze;

export const POOL_ALL = 'all';
const POOL_PREMODERN_PAUPER = 'pmp';
const POOL_PREMODERN_PAUPER_COMMANDER = 'pmpc';
const POOL_PREMODERN_PEASANT = 'pmpst';
const POOL_PREMODERN_PEASANT_COMMANDER = 'pmpstc';
const POOL_MODERN_PAUPER = 'mp';
const POOL_MODERN_PAUPER_COMMANDER = 'mpc';

export const POOLS: { readonly [K: string]: Query } = freeze({
    [POOL_ALL]: parse_query(EMPTY_MAP, ''),
    [POOL_PREMODERN_PAUPER]: parse_query(
        EMPTY_MAP,
        'date<2003-07-29 rarity:common',
    ),
    [POOL_PREMODERN_PAUPER_COMMANDER]: parse_query(
        EMPTY_MAP,
        'date<2003-07-29 rarity:uncommon type:creature',
    ),
    [POOL_PREMODERN_PEASANT]: parse_query(
        EMPTY_MAP,
        'date<2003-07-29 rarity<=uncommon -"Library of Alexandria" -"Strip Mine" -"Wasteland" -"Maze of Ith" -"Sol Ring"',
    ),
    [POOL_PREMODERN_PEASANT_COMMANDER]: parse_query(
        EMPTY_MAP,
        'date<2003-07-29 rarity:rare type:creature',
    ),
    [POOL_MODERN_PAUPER]: parse_query(
        EMPTY_MAP,
        'date>=2003-07-29 date<2014-07-18 rarity:common -"Rhystic Study"',
    ),
    [POOL_MODERN_PAUPER_COMMANDER]: parse_query(
        EMPTY_MAP,
        'date>=2003-07-29 date<2014-07-18 rarity:uncommon type:creature',
    ),
});
