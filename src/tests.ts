import {
    assert,
    assert_eq,
    Console_Logger,
    EMPTY_MAP,
    Mem_Logger,
    Nop_Logger,
    pop_count_32,
    to_string,
    unreachable,
    type Logger,
} from "./core";
import { Array_Set, Bitset, Bitset_32 } from "./uint_set";
import { PROPS, type Comparison_Condition, type Condition, type Mana_Cost_Some, type Query } from "./query/query";
import { parse_query } from "./query/parsing";
import { simplify_query } from "./query/combination";
import { remove_parenthesized_text, type Cards } from "./cards";
import { Subset_Store } from "./subset";
import { query_hash } from "./query/hash";
import { Query_Engine, type Query_Engine_Interface } from "./query/engine";
import { Indices } from "./query/indices";
import { Legacy_Query_Engine } from "./query/legacy";

type Query_Test_Defininition = {
    desc: string,
    query: string,
    expected: Array<string>,
    subsets?: { [id: string]: string },
    bench?: boolean,
};

export const query_test_definitions: Array<Query_Test_Defininition> = [
    {
        desc: 'name, ignore punctuation',
        query: 't.a/\\,m\'":i;yoc',
        expected: ['Tamiyo, Collector of Tales', 'Tamiyo, Compleated Sage'],
    },
    {
        desc: 'name, match split cards',
        query: "'FIRE //'",
        expected: ['Fire // Ice'],
    },
    {
        desc: 'name, match split cards inexact',
        query: "fire//ice",
        expected: ['Fire // Ice', 'Ghostfire Slice', 'Iceman and Firestar', 'Sword of Fire and Ice'],
    },
    {
        desc: 'name, match split cards with backslash',
        query: "fire\\ice",
        expected: ['Fire // Ice', 'Ghostfire Slice', 'Iceman and Firestar', 'Sword of Fire and Ice'],
    },
    {
        desc: "name, match double-faced cards",
        query: '"pathway // bould"',
        expected: ['Branchloft Pathway // Boulderloft Pathway'],
    },
    {
        desc: 'cmc=',
        query: 'cmc=0 t:sorcery vision',
        expected: ['Ancestral Vision'],
    },
    {
        // Same as =
        desc: 'cmc:',
        query: 'cmc:16',
        expected: ['Draco'],
    },
    {
        desc: 'cmc>',
        query: 'cmc>20',
        expected: ['Gleemax'],
    },
    {
        desc: 'cmc<=',
        query: 'cmc<=0 cinder',
        expected: ['Cinder Barrens', 'Cinder Glade', 'Cinder Marsh'],
    },
    {
        desc: 'mana=',
        query: 'm=rgwu',
        expected: ['Aragorn, the Uniter', 'Avatar Aang // Aang, Master of Elements', 'Elusen, the Giving', 'Ink-Treader Nephilim', 'Kynaios and Tiro of Meletis', 'Omnath, Locus of Creation', 'The Fantastic Four'],
    },
    {
        desc: 'mana!=',
        query: 'mana!=2wr agrus',
        expected: ['Agrus Kos, Eternal Soldier', 'Agrus Kos, Wojek Veteran'],
    },
    {
        desc: 'mana>',
        query: 'm>rgw cmc<=4 t:elf',
        expected: ['Fleetfoot Dancer', 'Obuun, Mul Daya Ancestor', 'Rocco, Cabaretti Caterer', 'Shalai and Hallar'],
    },
    {
        desc: 'mana<',
        query: 'm<rgw class',
        expected: ['Barbarian Class', 'Bard Class', 'Cleric Class', 'Fighter Class', 'Paladin Class'],
    },
    {
        desc: 'mana>=',
        query: 'mana>=rgw charm',
        expected: ['Cabaretti Charm', 'Naya Charm', "Rith's Charm"],
    },
    {
        // Same as >=
        desc: 'mana:',
        query: 'mana:rgw charm',
        expected: ['Cabaretti Charm', 'Naya Charm', "Rith's Charm"],
    },
    {
        desc: 'mana<=',
        query: 'mana<=rgw charm v',
        expected: ['Fever Charm', 'Ivory Charm', 'Vitality Charm'],
    },
    {
        desc: 'mana {C}',
        query: 'm>{c}cc',
        expected: ['Echoes of Eternity', 'Rise of the Eldrazi'],
    },
    {
        desc: 'mana generic',
        query: 'm>={7}{4}2 m<15',
        expected: ['Emrakul, the Promised End'],
    },
    {
        desc: 'mana generic X',
        query: 'm>XXX',
        expected: ['Crackle with Power', 'Doppelgang'],
    },
    {
        desc: 'mana hybrid',
        query: 'm={R/U}{R/U}{R/U}',
        expected: ['Crag Puca'],
    },
    {
        desc: 'mana monocolored hybrid',
        query: 'm>={2/r}{2/w}{2/b}',
        expected: ['Defibrillating Current', 'Reaper King', 'Reigning Victor'],
    },
    {
        desc: 'mana colorless hybrid',
        query: 'm>={C/B}',
        expected: ['Ulalek, Fused Atrocity'],
    },
    {
        desc: 'mana phyrexian',
        query: 'm={u/p}',
        expected: ['Gitaxian Probe', 'Mental Misstep'],
    },
    {
        desc: 'mana phyrexian hybrid',
        query: 'm:{w/G/P}',
        expected: ['Ajani, Sleeper Agent'],
    },
    {
        desc: 'mana<0',
        query: 'm<0 ever',
        expected: ['Blazemire Verge', 'Bleachbone Verge', 'Everglades', 'Evermind', 'Gloomlake Verge', 'Needleverge Pathway // Pillarverge Pathway', 'Riverpyre Verge', 'Thornspire Verge'],
    },
    {
        // This is a weird one, zero-cost and no-cost are less than any nonzero cost.
        desc: 'mana<{R}',
        query: 'm<{R} t:instant ve',
        expected: ['Evermind', 'Intervention Pact'],
    },
    {
        desc: 'mana with {0} and other symbols',
        query: 'm:{0}{r}{r}{r} ball',
        expected: ['Ball Lightning', 'Jaya Ballard'],
    },
    {
        desc: 'rarity=',
        query: 'rarity=c m>=ggg',
        expected: ['Kindercatch', 'Nyxborn Colossus'],
    },
    {
        // Same as =
        desc: 'rarity:',
        query: 'r:c m>=ggg',
        expected: ['Kindercatch', 'Nyxborn Colossus'],
    },
    {
        desc: 'rarity<',
        query: 'RARity<UNcommon m>=ggg',
        expected: ['Kindercatch', 'Nyxborn Colossus'],
    },
    {
        desc: 'rarity!=',
        query: 'r!=Special m:gggg GIANT',
        expected: ['Craw Giant'],
    },
    {
        desc: 'oracle:',
        query: 'o:rampage t:giant',
        expected: ['Craw Giant', 'Frost Giant'],
    },
    {
        // Same as :
        desc: 'oracle=',
        query: 'oracle="it deals 6 damage to each creature"',
        expected: ['Bloodfire Colossus', 'Tornado Elemental', 'Lord of Shatterskull Pass', 'Cathedral Membrane', 'Lavabrink Floodgates'],
    },
    {
        // Reminder text shouldn't match.
        desc: 'oracle reminder text',
        query: 'oracle:"to mill a card,"',
        expected: [],
    },
    {
        desc: 'fulloracle:',
        query: 'fulloracle:"to mill a card," t:instant',
        expected: ['Dig Up the Body', 'Wasteful Harvest'],
    },
    {
        desc: 'format:',
        query: 'f:premodern termina',
        expected: ['Terminal Moraine', 'Terminate', 'Aphetto Exterminator'],
    },
    {
        // Same as :
        desc: 'format=',
        query: 'format=premodern suppress',
        expected: ['Brutal Suppression', 'Suppress'],
    },
    {
        desc: 'color=',
        query: 'color=gr gut',
        expected: ['Guttural Response', 'Raggadragga, Goreguts Boss'],
    },
    {
        desc: 'color=0',
        query: 'color=0 m>{13}',
        expected: ['Emrakul, the Aeons Torn', 'Mox Lotus', 'Draco', 'Gleemax'],
    },
    {
        desc: 'color=colorless',
        query: 'color=colorless m>{13}',
        expected: ['Emrakul, the Aeons Torn', 'Mox Lotus', 'Draco', 'Gleemax'],
    },
    {
        // Same as >=
        desc: 'color:',
        query: 'c:gr scrapper',
        expected: ['Scuzzback Scrapper'],
    },
    {
        desc: 'color: with number',
        query: 'color:4 year<2010',
        expected: ['Dune-Brood Nephilim', 'Glint-Eye Nephilim', 'Ink-Treader Nephilim', 'Witch-Maw Nephilim', 'Yore-Tiller Nephilim'],
    },
    {
        desc: 'color< with number',
        query: 'c<2 abundant',
        expected: ['Abundant Countryside', 'Abundant Growth', 'Abundant Harvest', 'Abundant Maw'],
    },
    {
        desc: 'identity=',
        query: 'identity=gr glade',
        expected: ['Cinder Glade'],
    },
    {
        desc: 'identity=colorless',
        query: 'identity=colorless m>{13}',
        expected: ['Emrakul, the Aeons Torn', 'Mox Lotus', 'Draco', 'Gleemax'],
    },
    {
        // Same as <=
        desc: 'identity:',
        query: 'id:gr scrapper',
        expected: ['Elvish Scrapper', 'Gruul Scrapper', 'Khenra Scrapper', 'Narstad Scrapper', 'Scrapper Champion', 'Scuzzback Scrapper', 'Slagdrill Scrapper', 'Tuktuk Scrapper'],
    },
    {
        desc: 'identity: with number',
        query: 'id:4 year<2010',
        expected: ['Dune-Brood Nephilim', 'Glint-Eye Nephilim', 'Ink-Treader Nephilim', 'Witch-Maw Nephilim', 'Yore-Tiller Nephilim'],
    },
    {
        desc: 'identity> with number',
        query: 'id>4 year<2000',
        expected: ['Jack-in-the-Mox', 'Naked Singularity', 'Reality Twist', 'Sliver Queen'],
    },
    {
        desc: 'quotes "',
        query: '"boros guild"',
        expected: ['Boros Guildgate', 'Boros Guildmage'],
    },
    {
        desc: "quotes '",
        query: "o:'one item'",
        expected: ['Goblin Game', "Ladies' Knight"],
    },
    {
        desc: 'ignore single quote',
        query: "o:tamiyo's cmc>4",
        expected: ['Tamiyo, Compleated Sage'],
    },
    {
        desc: 'set',
        query: 's:war ajani',
        expected: ["Ajani's Pridemate", 'Ajani, the Greathearted'],
    },
    {
        desc: 'edition',
        query: 'e:RAV drake',
        expected: ['Drake Familiar', 'Snapping Drake', 'Tattered Drake'],
    },
    {
        desc: 'negation',
        query: '-t:land forest',
        expected: ['Deep Forest Hermit', 'Forest Bear', 'Great Forest Druid', 'Hei Bai, Forest Guardian', 'Jaheira, Friend of the Forest'],
    },
    {
        // SF seems to interpret this as "name does not contain the empty string".
        desc: 'empty negation',
        query: '-',
        expected: [],
    },
    {
        // SF seems to interpret this as "name does not contain the empty string".
        desc: 'effectively empty negation',
        query: '-.',
        expected: [],
    },
    {
        // Negation means "true if no version of this card matches the nested condition".
        desc: 'negate condition on version-specific property',
        query: '-f:premodern carpet',
        expected: ["Al-abara's Carpet"],
    },
    {
        desc: 'year=',
        query: 'year=2011 alloy',
        expected: ['Alloy Myr'],
    },
    {
        // Same as =
        desc: 'year:',
        query: 'year:1999 about',
        expected: ['About Face'],
    },
    {
        desc: 'year<=',
        query: 'year<=2011 alloy',
        expected: ['Alloy Golem', 'Alloy Myr'],
    },
    {
        desc: 'year, conflicting',
        query: 'year>=2020 year<=2011 alloy',
        expected: [],
    },
    {
        desc: 'date:',
        query: 'date:1993-08-05 rec',
        expected: ['Ancestral Recall', 'Resurrection'],
    },
    {
        desc: 'date>= and date<=',
        query: 'grave date<=2003-08 date>=2003-04',
        expected: ['Call to the Grave', 'Gravedigger', 'Grave Pact', 'Reaping the Graves'],
    },
    {
        desc: 'reprint',
        query: 'not:reprint set:m12 t:wizard',
        expected: ['Alabaster Mage', 'Azure Mage', "Jace's Archivist", 'Lord of the Unreal', 'Merfolk Mesmerist', 'Onyx Mage'],
    },
    {
        desc: 'disjunction',
        query: 'animate t:instant or abundance t:enchantment',
        expected: ['Abundance', 'Animate Land', 'Leyline of Abundance', 'Overabundance', 'Trace of Abundance'],
    },
    {
        desc: 'disjunction',
        query: '( mind OR power ) drain',
        expected: ['Drain Power', 'Mind Drain'],
    },
    {
        desc: 'parens',
        query: 'mana for (t:creature or t:artifact)',
        expected: ['Manaforce Mace', 'Manaforge Cinder', 'Manaform Hellkite'],
    },
    {
        desc: 'nested parens',
        query: 'mana for ((t:creature t:dragon) or t:artifact)',
        expected: ['Manaforce Mace', 'Manaform Hellkite'],
    },
    {
        desc: 'empty parens',
        query: 'draining or ()',
        expected: ['Draining Whelk'],
    },
    {
        desc: 'no space before opening paren',
        query: 'mox(ruby)',
        expected: [],
    },
    {
        desc: 'too many opening parens',
        query: '((mox) sapphire',
        expected: [],
    },
    {
        desc: 'too many closing parens',
        query: '(mox) sapphire)',
        expected: [],
    },
    {
        desc: 'large query tree',
        query: 'grave -t:ench -(stone or (t:land (cairn or lan)) or t:creature) -(t:instant or t:sorcery)',
        expected: ['Elephant Graveyard', 'Graveyard Shovel', "Titan's Grave", 'Watery Grave'],
    },
    {
        desc: 'even',
        query: 'cmc:even belly',
        expected: ['Blightbelly Rat', 'Fire-Belly Changeling', 'Lead-Belly Chimera'],
    },
    {
        desc: 'odd',
        query: 'cmc:odd belly',
        expected: ['Lavabelly Sliver', 'Poisonbelly Ogre', 'Ravenous Rotbelly'],
    },
    {
        desc: 'subset',
        query: 'subset:Simple',
        expected: ['Mana Matrix'],
        subsets: { 'Simple': '"Mana Matrix"' },
    },
    {
        desc: 'complex subset',
        query: 'subset:Complex',
        expected: ['Myr Matrix'],
        subsets: { 'Complex': 'r:r matrix o:creature cmc>=5' },
    },
    {
        desc: 'subset with spaces in name',
        query: 'subset:"A long name"',
        expected: ['Psychic Puppetry'],
        subsets: { 'A long name': '"Psychic Puppetry"' },
    },
];

export async function run_test_suite(cards: Cards, indices: Indices) {
    Console_Logger.time('run_test_suite');
    Console_Logger.time('run_test_suite_setup');

    const tests: { name: string, execute: (logger: Logger) => void | Promise<void> }[] = [];

    function test(name: string, execute: (logger: Logger) => void | Promise<void>) {
        tests.push({ name, execute });
    }

    test('pop_count_32', () => {
        assert_eq(pop_count_32(0), 0);
        assert_eq(pop_count_32(1), 1);
        assert_eq(pop_count_32(0xFFFFFFFF), 32);
        assert_eq(pop_count_32(0x80000000), 1);
        assert_eq(pop_count_32(0b10101010), 4);
        assert_eq(pop_count_32(0b111000), 3);
    });
    test('Bitset is instantiated correctly.', () => {
        const s = Bitset.with_cap(1000);
        assert_eq(s.data.length, 32);
        assert_eq(s.cap, 1000);
        assert_eq(s.size, 0);
    });
    test('Bitset fill.', () => {
        for (let cap = 0; cap < 96; cap++) {
            const s = Bitset.with_cap(cap);
            s.fill();

            assert_eq(s.size, cap);

            for (let i = 0; i < cap; i++) {
                assert(s.has(i));
            }

            // Only the relevant bits of the last u32 should be set.
            if (cap > 0) {
                let slot: number;

                switch (cap % 32) {
                    // Empty comments for alignment.
                    case /* */ 1: slot = 0b1; break;
                    case /* */ 2: slot = 0b11; break;
                    case /* */ 3: slot = 0b111; break;
                    case /* */ 4: slot = 0b1111; break;
                    case /* */ 5: slot = 0b11111; break;
                    case /* */ 6: slot = 0b111111; break;
                    case /* */ 7: slot = 0b1111111; break;
                    case /* */ 8: slot = 0b11111111; break;
                    case /* */ 9: slot = 0b111111111; break;
                    case /**/ 10: slot = 0b1111111111; break;
                    case /**/ 11: slot = 0b11111111111; break;
                    case /**/ 12: slot = 0b111111111111; break;
                    case /**/ 13: slot = 0b1111111111111; break;
                    case /**/ 14: slot = 0b11111111111111; break;
                    case /**/ 15: slot = 0b111111111111111; break;
                    case /**/ 16: slot = 0b1111111111111111; break;
                    case /**/ 17: slot = 0b11111111111111111; break;
                    case /**/ 18: slot = 0b111111111111111111; break;
                    case /**/ 19: slot = 0b1111111111111111111; break;
                    case /**/ 20: slot = 0b11111111111111111111; break;
                    case /**/ 21: slot = 0b111111111111111111111; break;
                    case /**/ 22: slot = 0b1111111111111111111111; break;
                    case /**/ 23: slot = 0b11111111111111111111111; break;
                    case /**/ 24: slot = 0b111111111111111111111111; break;
                    case /**/ 25: slot = 0b1111111111111111111111111; break;
                    case /**/ 26: slot = 0b11111111111111111111111111; break;
                    case /**/ 27: slot = 0b111111111111111111111111111; break;
                    case /**/ 28: slot = 0b1111111111111111111111111111; break;
                    case /**/ 29: slot = 0b11111111111111111111111111111; break;
                    case /**/ 30: slot = 0b111111111111111111111111111111; break;
                    case /**/ 31: slot = 0b1111111111111111111111111111111; break;
                    case /* */ 0: slot = 0b11111111111111111111111111111111; break;
                    default: unreachable();
                }

                assert_eq(s.data[s.data.length - 1], slot);
            }
        }
    });
    test('Bitset delete.', () => {
        const s = Bitset.with_cap(40);
        s.fill();

        s.delete(20);
        s.delete(39);

        assert_eq(s.size, 38);

        for (let i = 0; i < 20; i++) {
            assert(s.has(i));
        }

        assert(!s.has(20));

        for (let i = 21; i < 38; i++) {
            assert(s.has(i));
        }

        assert(!s.has(39));
    });
    test('Bitset invert.', () => {
        const s = Bitset.with_cap(36);

        for (let i = 0; i < 36; i++) {
            if (i % 3 === 0) {
                s.insert(i);
            }
        }

        s.invert();

        assert_eq(s.size, 24);

        for (let i = 0; i < 36; i++) {
            if (i % 3 === 0) {
                assert(!s.has(i));
            } else {
                assert(s.has(i));
            }
        }

        // Only 3 bits of the last u32 should be set.
        assert_eq(s.data[s.data.length - 1], 0b1101);
    });
    test('Bitset union_in.', () => {
        const a = Bitset.with_cap(35);
        const b = Bitset.with_cap(35);

        a.insert(0);
        a.insert(3);

        b.insert(1);
        b.insert(4);
        b.insert(7);
        b.insert(33);

        a.union(b);

        assert_eq(a.size, 6);

        assert(a.has(0));
        assert(a.has(1));
        assert(!a.has(2));
        assert(a.has(3));
        assert(a.has(4));
        assert(!a.has(5));
        assert(!a.has(6));
        assert(a.has(7));

        for (let i = 8; i < 33; i++) {
            assert(!a.has(i));
        }

        assert(a.has(33));
        assert(!a.has(34));
    });
    test('Bitset diff_in.', () => {
        const a = Bitset.with_cap(40);
        const b = Bitset.with_cap(40);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0) {
                a.insert(i);
            }

            if (i % 3 === 0) {
                b.insert(i);
            }
        }

        a.diff(b);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0 && i % 3 !== 0) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });
    test('Bitset_32 is instantiated correctly.', () => {
        const s = Bitset_32.with_cap(20);
        assert_eq(s.values, 0);
        assert_eq(s.cap, 20);
        assert_eq(s.size, 0);
    });
    test('Bitset_32 fill.', () => {
        const s = Bitset_32.with_cap(20);
        s.fill();

        assert_eq(s.size, 20);

        for (let i = 0; i < 20; i++) {
            assert(s.has(i));
        }

        // Only 20 bits should be set.
        assert_eq(s.values, 0xFFFFF);
    });
    test('Bitset_32 delete.', () => {
        const s = Bitset_32.with_cap(20);
        s.fill();

        s.delete(10);
        s.delete(15);

        assert_eq(s.size, 18);

        for (let i = 0; i < 20; i++) {
            if (i === 10 || i === 15) {
                assert(!s.has(i));
            } else {
                assert(s.has(i));
            }
        }
    });
    test('Bitset_32 invert.', () => {
        const s = Bitset_32.with_cap(30);

        for (let i = 0; i < 30; i++) {
            if (i % 3 === 0) {
                s.insert(i);
            }
        }

        s.invert();

        assert_eq(s.size, 20);

        for (let i = 0; i < 30; i++) {
            if (i % 3 === 0) {
                assert(!s.has(i));
            } else {
                assert(s.has(i));
            }
        }

        assert_eq(s.values, 0b110110110110110110110110110110);
    });
    test('Bitset_32 union_in.', () => {
        const a = Bitset_32.with_cap(25);
        const b = Bitset_32.with_cap(25);

        a.insert(0);
        a.insert(1);
        a.insert(3);
        a.insert(7);

        b.insert(1);
        b.insert(4);
        b.insert(7);
        b.insert(21);

        a.union(b);

        assert_eq(a.size, 6);

        for (let i = 0; i < 25; i++) {
            if ([0, 1, 3, 4, 7, 21].includes(i)) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });
    test('Bitset_32 diff_in.', () => {
        const a = Bitset_32.with_cap(32);
        const b = Bitset_32.with_cap(32);

        for (let i = 0; i < 32; i++) {
            if (i % 2 === 0) {
                a.insert(i);
            }

            if (i % 3 === 0) {
                b.insert(i);
            }
        }

        a.diff(b);

        for (let i = 0; i < 32; i++) {
            if (i % 2 === 0 && i % 3 !== 0) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });
    test('Array_Set is instantiated correctly.', () => {
        const s = Array_Set.with_cap(1000);
        assert_eq(s.data.length, 1000);
        assert_eq(s.size, 0);
    });
    test('Array_Set delete.', () => {
        const s = Array_Set.with_cap(40);

        for (let i = 0; i < 40; i++) {
            s.insert_unchecked(i);
        }

        s.delete(20);
        s.delete(39);

        assert_eq(s.size, 38);

        for (let i = 0; i < 20; i++) {
            assert(s.has(i));
        }

        assert(!s.has(20));

        for (let i = 21; i < 38; i++) {
            assert(s.has(i));
        }

        assert(!s.has(39));
    });
    test('Array_Set union_in.', () => {
        const a = Array_Set.with_cap(10);
        const b = Array_Set.with_cap(10);

        a.insert_unchecked(1);
        a.insert_unchecked(3);
        a.insert_unchecked(8);
        a.insert_unchecked(9);
        a.insert_unchecked(10);

        b.insert_unchecked(0);
        b.insert_unchecked(4);
        b.insert_unchecked(7);
        b.insert_unchecked(25);

        a.union(b);

        assert_eq(a.size, 9);

        for (let i = 0; i <= 25; i++) {
            if ([0, 1, 3, 4, 7, 8, 9, 10, 25].includes(i)) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });
    test('Array_Set diff_in.', () => {
        const a = Array_Set.with_cap(20);
        const b = Array_Set.with_cap(20);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0) {
                a.insert(i);
            }

            if (i % 3 === 0) {
                b.insert(i);
            }
        }

        a.diff(b);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0 && i % 3 !== 0) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });
    test('remove_parenthesized_text doesn\'t change text without parens.', () => {
        const fo = 'This is text.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text.')
    });
    test('remove_parenthesized_text removes spaces around.', () => {
        const fo = 'This is (reminder) text.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text.')
    });
    test('remove_parenthesized_text removes spaces around, but not punctuation.', () => {
        const fo = 'This is (reminder), text.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is, text.')
    });
    test('remove_parenthesized_text removes all reminder text.', () => {
        const fo = 'This is (reminder) text, this (here), too.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text, this, too.')
    });
    test('remove_parenthesized_text ignores extraneous right parens.', () => {
        const fo = 'This is (reminder)) text, this (here), too.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text, this, too.')
    });
    test('remove_parenthesized_text doesn\'t ignore extraneous left parens.', () => {
        const fo = 'This is ((reminder) text, this (here), too.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is')
    });
    test('query_hash produces identical hashes for identical queries and different hashes for different queries.', async () => {
        const conditions: Condition[] = [
            {
                type: 'true',
            },
            {
                type: 'false',
            },
            {
                type: 'not',
                condition: { type: 'true' },
            },
            {
                type: 'or',
                conditions: [{ type: 'true' }],
            },
            {
                type: 'and',
                conditions: [{ type: 'true' }],
            },
            ...(['eq', 'ne', 'lt', 'gt', 'le', 'ge'] as Comparison_Condition['type'][])
                .map(
                    type => ({
                        type,
                        prop: 'cmc',
                        value: 0,
                    } as Comparison_Condition)
                ),
            {
                type: 'eq',
                prop: 'cost',
                value: { none: false, symbols: new Map([['N', 2], ['R/G', 1]]) },
            },
            {
                type: 'substring',
                prop: 'name',
                value: 'jos',
            },
            {
                type: 'even',
                prop: 'cmc',
            },
            {
                type: 'odd',
                prop: 'cmc',
            },
            {
                type: 'range',
                prop: 'released_at',
                start: new Date('2022-04-10'),
                start_inc: true,
                end: new Date('2022-06-22'),
                end_inc: false,
            },
            {
                type: 'subset',
                id: 'identifier',
            },
        ];

        // We use this object to ensure we have a condition of every type. When new conditions are
        // added this will fail to compile.
        const conditions_encountered: { [t in Condition['type']]: boolean } = {
            true: false,
            false: false,
            not: false,
            or: false,
            and: false,
            eq: false,
            ne: false,
            lt: false,
            gt: false,
            le: false,
            ge: false,
            substring: false,
            even: false,
            odd: false,
            range: false,
            subset: false,
        };

        let prev_hash: bigint | null = null;

        for (const condition of conditions) {
            conditions_encountered[condition.type] = true;
            // We generate a query that's technically incorrect because its props attribute is
            // always empty. This doesn't matter for generating hashes, because this array simply
            // contains redundant data (that is ignored by the hash function) as an optmization for
            // the query evaluator.
            const original: Query = { props: [], condition };
            const original_hash = await query_hash(original);

            // Verify that no two queries with conditions of different types have the same hash.
            assert(original_hash !== prev_hash);
            prev_hash = original_hash;

            const copy: Query = structuredClone(original);
            const copy_hash = await query_hash(copy);

            assert_eq(copy_hash, original_hash);

            // Verify that a change to any propery of the query condition changes the hash.
            for (const k in condition) {
                if (k === 'type') {
                    continue;
                }

                const changed_queries: Query[] = [];
                const changed: any = structuredClone(original);
                changed_queries.push(changed);
                const value = (condition as any)[k];

                if (Array.isArray(value)) {
                    // Assume it's an array of conditions. Make a changed query with an extra
                    // element and one with a single element replaced (keeping the length the same).
                    assert(value.length >= 1);

                    changed.condition[k].push({ type: 'true' });

                    const replaced_element_query: any = structuredClone(original);
                    replaced_element_query.condition[k][0] = {
                        type: value[0].type === 'true' ? 'false' : 'true',
                    };
                    changed_queries.push(replaced_element_query);
                } else if (typeof value === 'boolean') {
                    changed.condition[k] = !value;
                } else if (typeof value === 'number') {
                    changed.condition[k] = value + 1;
                } else if (typeof value === 'string') {
                    const props_index = PROPS.indexOf(value as any);

                    if (props_index !== -1) {
                        // Assume it's a Prop.
                        changed.condition[k] = PROPS[(props_index + 1) % PROPS.length];
                    } else {
                        changed.condition[k] = value + 'x';
                    }
                } else if (value instanceof Date) {
                    changed.condition[k] = new Date(value.getTime() + 1);
                } else if ('type' in value) {
                    // Assume it's a condition.
                    changed.condition[k] = {
                        type: value.type === 'true' ? 'false' : 'true',
                    };
                } else {
                    // Assume it's a mana cost.
                    const mana_cost: Mana_Cost_Some = changed.condition[k];
                    assert(!mana_cost.symbols.has('X'));
                    (mana_cost.symbols as Map<string, number>).set('X', 1);
                }

                for (const changed_query of changed_queries) {
                    const changed_hash = await query_hash(changed_query);

                    assert(changed_hash !== copy_hash);
                }
            }
        }

        for (const [k, v] of Object.entries(conditions_encountered)) {
            assert(v, () => `No condition of type ${k} in test set.`);
        }
    });

    for (const def of query_test_definitions) {
        const MAX_MATCHES = 20;
        const expected = new Set(def.expected);
        assert(expected.size <= MAX_MATCHES);

        function test_query_helper(
            method: string,
            create_engine: (subset_store: Subset_Store) => Query_Engine_Interface,
        ) {
            test(`${def.desc} [${method}] [${def.query}]`, async logger => {
                const subset_store = new Subset_Store(logger);

                if (def.subsets) {
                    for (const [name, query] of Object.entries(def.subsets)) {
                        const subset = subset_store.create(
                            crypto.randomUUID(),
                            name,
                            parse_query(EMPTY_MAP, query),
                        );
                        assert(subset !== null);
                    }
                }

                const engine = create_engine(subset_store);
                const query = simplify_query(
                    subset_store.id_to_subset,
                    parse_query(subset_store.name_to_subset, def.query),
                );
                // Execute query without logging.
                const result = engine.execute(
                    Nop_Logger,
                    () => Nop_Logger,
                    query,
                );

                const actual = new Set([...result.keys()].map(idx => cards.name(idx)));

                if (!deep_eq(actual, expected)) {
                    // Execute query again to get logs for specific cards.
                    const missing_set = expected.difference(actual);
                    const unexpected_set = actual.difference(expected);
                    const log_set = new Set;

                    for (const c of missing_set) {
                        log_set.add(c);

                        // Ensure we log at most 10 cards.
                        if (log_set.size >= 10) {
                            break;
                        }
                    }

                    for (const c of unexpected_set) {
                        log_set.add(c);

                        // Ensure we log at most 10 cards.
                        if (log_set.size >= 10) {
                            break;
                        }
                    }

                    engine.execute(
                        logger,
                        idx => log_set.has(cards.name(idx)) ? logger : Nop_Logger,
                        query,
                    );

                    const max_warn = unexpected_set.size > 5 ? ' (showing max. 5)' : '';

                    throw Error(
                        `Expected to get ${expected.size} matches, got ${actual.size}. Also expected: ${to_string(missing_set)}, didn't expect: ${to_string([...unexpected_set].slice(0, 5))}${max_warn}.`
                    );
                }
            });
        }

        test_query_helper(
            'legacy',
            subset_store => new Legacy_Query_Engine(cards, subset_store, true, true),
        );
        test_query_helper(
            'engine',
            subset_store => new Query_Engine(cards, indices, subset_store),
        );
    }

    // Load all data in advance, so timings are more meaningful.
    await Promise.all(PROPS.map(p => cards.load(p)));

    indices.rebuild(Console_Logger, new Set(PROPS));

    Console_Logger.time_end('run_test_suite_setup');
    Console_Logger.time('run_test_suite_execute');

    let executed = 0;
    let succeeded = 0;

    for (const test of tests) {
        const logger = new Mem_Logger;
        let e = null;

        try {
            const result = test.execute(logger);

            if (result instanceof Promise) {
                await result;
            }

            succeeded++;
        } catch (ex) {
            e = ex;
        }

        executed++;

        if (e) {
            logger.log_to(Console_Logger);
            Console_Logger.error('FAILURE', test.name, e);
        } else {
            Console_Logger.info('SUCCESS', test.name);
        }
    }

    const failed = executed - succeeded;

    Console_Logger.time_end('run_test_suite_execute');
    Console_Logger.time_end('run_test_suite');

    if (executed === succeeded) {
        Console_Logger.info(`Ran ${executed} tests, all succeeded.`);
    } else {
        Console_Logger.info(`Ran ${executed} tests, ${failed} failed.`);
        alert(`${failed} Tests failed!`);
    }
}

function deep_eq<T>(a: T, b: T): boolean {
    if (a instanceof Set) {
        return b instanceof Set && a.size === b.size && a.isSubsetOf(b);
    } else if (Array.isArray(a) || (typeof a === 'object' && a !== null)) {
        throw Error(`Type of ${a} is unsupported.`);
    } else {
        return a === b;
    }
}
