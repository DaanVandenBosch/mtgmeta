import {
    assert,
    assert_eq,
    Console_Logger,
    EMPTY_MAP,
    Mem_Logger,
    Nop_Logger,
    pop_count_32,
    to_string,
    type Logger,
} from "./core";
import { Array_Set, Bitset, Bitset_32 } from "./uint_set";
import { PROPS } from "./query";
import { parse_query } from "./query_parsing";
import { simplify_query } from "./query_combination";
import { find_cards_matching_query } from "./query_eval";
import { remove_parenthesized_text, type Cards } from "./cards";
import { Subset_Store } from "./subset";

export async function run_test_suite(cards: Cards) {
    Console_Logger.time('run_test_suite');
    Console_Logger.time('run_test_suite_setup');

    const tests: { name: string, execute: (logger: Logger) => void | Promise<void> }[] = [];

    function test(name: string, execute: (logger: Logger) => void | Promise<void>) {
        tests.push({ name, execute });
    }

    function test_query(
        name: string,
        query_string: string,
        expected_matches: string[],
        options: { subsets?: { [id: string]: string } } = {},
    ) {
        const MAX_MATCHES = 20;
        const expected = new Set(expected_matches);
        assert(expected.size <= MAX_MATCHES);

        test(`${name} [${query_string}]`, async logger => {
            const subset_store = new Subset_Store(logger);

            if (options.subsets) {
                for (const [name, query] of Object.entries(options.subsets)) {
                    const subset = subset_store.create(
                        crypto.randomUUID(),
                        name,
                        parse_query(EMPTY_MAP, query),
                    );
                    assert(subset !== null);
                }
            }

            const query = simplify_query(
                subset_store.id_to_subset,
                parse_query(subset_store.name_to_subset, query_string),
            );
            const result = await find_cards_matching_query(
                cards,
                subset_store,
                query,
                () => Nop_Logger,
            );

            const actual = new Set([...result.keys()].map(idx => cards.name(idx)));

            if (!deep_eq(actual, expected)) {
                const missing_set = expected.difference(actual);
                const unexpected_set = actual.difference(expected);
                const log_set = new Set();

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

                await find_cards_matching_query(
                    cards,
                    subset_store,
                    query,
                    idx => (log_set.has(cards.name(idx)) ? logger : Nop_Logger),
                );

                const max_warn = unexpected_set.size > 5 ? ' (showing max. 5)' : '';

                throw Error(
                    `Expected to get ${expected.size} matches, got ${actual.size}. Also expected: ${to_string(missing_set)}, didn't expect: ${to_string([...unexpected_set].slice(0, 5))}${max_warn}.`
                );
            }
        });
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
        Bitset.reset_mem();

        for (let i = 0; i < 32; i++) {
            Bitset.mem[i] = 0xFFFFFFFF;
        }

        const s = Bitset.with_cap(1000);
        assert_eq(s.m_off, 0);
        assert_eq(s.m_end, 32);
        assert_eq(s.cap, 1000);
        assert_eq(s.size, 0);

        for (let i = s.m_off; i < s.m_end; i++) {
            assert_eq(Bitset.mem[i], 0);
        }
    });
    test('Bitset fill.', () => {
        Bitset.reset_mem();
        const s = Bitset.with_cap(40);
        s.fill();

        assert_eq(s.size, 40);

        for (let i = 0; i < 40; i++) {
            assert(s.has(i));
        }

        // Only 8 bits of the last u32 should be set.
        assert_eq(Bitset.mem[s.m_end - 1], 0xFF);
    });
    test('Bitset delete.', () => {
        Bitset.reset_mem();
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
        Bitset.reset_mem();
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
        assert_eq(Bitset.mem[s.m_end - 1], 0b1101);
    });
    test('Bitset union_in.', () => {
        Bitset.reset_mem();
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
        Bitset.reset_mem();
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
        Array_Set.reset_mem();

        const s = new Array_Set;
        assert_eq(s.offset, 0);
        assert_eq(s.size, 0);
    });
    test('Array_Set delete.', () => {
        Array_Set.reset_mem();
        const s = new Array_Set;

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
        Array_Set.reset_mem();
        const a = new Array_Set;
        const b = new Array_Set;

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
        Array_Set.reset_mem();
        const a = new Array_Set;
        const b = new Array_Set;

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
    test_query(
        'name, ignore punctuation',
        't.a/\\,m\'":i;yoc',
        ['Tamiyo, Collector of Tales', 'Tamiyo, Compleated Sage'],
    );
    test_query(
        'name, match split cards',
        "'FIRE //'",
        ['Fire // Ice'],
    );
    test_query(
        'name, match split cards inexact',
        "fire//ice",
        ['Fire // Ice', 'Ghostfire Slice', 'Sword of Fire and Ice'],
    );
    test_query(
        'name, match split cards with backslash',
        "fire\\ice",
        ['Fire // Ice', 'Ghostfire Slice', 'Sword of Fire and Ice'],
    );
    test_query(
        "name, match double-faced cards",
        '"pathway // bould"',
        ['Branchloft Pathway // Boulderloft Pathway'],
    );
    test_query(
        'cmc=',
        'cmc=0 t:sorcery vision',
        ['Ancestral Vision'],
    );
    // Same as =
    test_query(
        'cmc:',
        'cmc:16',
        ['Draco'],
    );
    test_query(
        'cmc>',
        'cmc>20',
        ['Gleemax'],
    );
    test_query(
        'cmc<=',
        'cmc<=0 cinder',
        ['Cinder Barrens', 'Cinder Glade', 'Cinder Marsh'],
    );
    test_query(
        'mana=',
        'm=rgwu',
        ['Aragorn, the Uniter', 'Avatar Aang // Aang, Master of Elements', 'Elusen, the Giving', 'Ink-Treader Nephilim', 'Kynaios and Tiro of Meletis', 'Omnath, Locus of Creation'],
    );
    test_query(
        'mana!=',
        'mana!=2wr agrus',
        ['Agrus Kos, Eternal Soldier', 'Agrus Kos, Wojek Veteran'],
    );
    test_query(
        'mana>',
        'm>rgw cmc<=4 t:elf',
        ['Fleetfoot Dancer', 'Obuun, Mul Daya Ancestor', 'Rocco, Cabaretti Caterer', 'Shalai and Hallar'],
    );
    test_query(
        'mana<',
        'm<rgw class',
        ['Barbarian Class', 'Bard Class', 'Cleric Class', 'Fighter Class', 'Paladin Class'],
    );
    test_query(
        'mana>=',
        'mana>=rgw charm',
        ['Cabaretti Charm', 'Naya Charm', "Rith's Charm"],
    );
    // Same as >=
    test_query(
        'mana:',
        'mana:rgw charm',
        ['Cabaretti Charm', 'Naya Charm', "Rith's Charm"],
    );
    test_query(
        'mana<=',
        'mana<=rgw charm v',
        ['Fever Charm', 'Ivory Charm', 'Vitality Charm'],
    );
    test_query(
        'mana {C}',
        'm>{c}cc',
        ['Echoes of Eternity', 'Rise of the Eldrazi'],
    );
    test_query(
        'mana generic',
        'm>={7}{4}2 m<15',
        ['Emrakul, the Promised End'],
    );
    test_query(
        'mana generic X',
        'm>XXX',
        ['Crackle with Power', 'Doppelgang'],
    );
    test_query(
        'mana hybrid',
        'm={R/U}{R/U}{R/U}',
        ['Crag Puca'],
    );
    test_query(
        'mana monocolored hybrid',
        'm>={2/r}{2/w}{2/b}',
        ['Defibrillating Current', 'Reaper King', 'Reigning Victor'],
    );
    test_query(
        'mana colorless hybrid',
        'm>={C/B}',
        ['Ulalek, Fused Atrocity'],
    );
    test_query(
        'mana phyrexian',
        'm={u/p}',
        ['Gitaxian Probe', 'Mental Misstep'],
    );
    test_query(
        'mana phyrexian hybrid',
        'm:{w/G/P}',
        ['Ajani, Sleeper Agent'],
    );
    test_query(
        'mana<0',
        'm<0 ever',
        ['Blazemire Verge', 'Bleachbone Verge', 'Everglades', 'Evermind', 'Gloomlake Verge', 'Needleverge Pathway // Pillarverge Pathway', 'Riverpyre Verge', 'Thornspire Verge'],
    );
    // This is a weird one, zero-cost and no-cost are less than any nonzero cost.
    test_query(
        'mana<{R}',
        'm<{R} t:instant ve',
        ['Evermind', 'Intervention Pact'],
    );
    test_query(
        'rarity=',
        'rarity=c m>=ggg',
        ['Kindercatch', 'Nyxborn Colossus'],
    );
    // Same as =
    test_query(
        'rarity:',
        'r:c m>=ggg',
        ['Kindercatch', 'Nyxborn Colossus'],
    );
    test_query(
        'rarity<',
        'RARity<UNcommon m>=ggg',
        ['Kindercatch', 'Nyxborn Colossus'],
    );
    test_query(
        'rarity!=',
        'r!=Special m:gggg GIANT',
        ['Craw Giant'],
    );
    test_query(
        'oracle:',
        'o:rampage t:giant',
        ['Craw Giant', 'Frost Giant'],
    );
    // Same as :
    test_query(
        'oracle=',
        'oracle="it deals 6 damage to each creature"',
        ['Bloodfire Colossus', 'Tornado Elemental', 'Lord of Shatterskull Pass', 'Cathedral Membrane', 'Lavabrink Floodgates'],
    );
    // Reminder text shouldn't match.
    test_query(
        'oracle reminder text',
        'oracle:"to mill a card,"',
        [],
    );
    test_query(
        'fulloracle:',
        'fulloracle:"to mill a card," t:instant',
        ['Dig Up the Body', 'Wasteful Harvest'],
    );
    test_query(
        'format:',
        'f:premodern termina',
        ['Terminal Moraine', 'Terminate', 'Aphetto Exterminator'],
    );
    // Same as :
    test_query(
        'format=',
        'format=premodern suppress',
        ['Brutal Suppression', 'Suppress'],
    );
    test_query(
        'color=',
        'color=gr gut',
        ['Guttural Response', 'Raggadragga, Goreguts Boss'],
    );
    // Same as >=
    test_query(
        'color:',
        'c:gr scrapper',
        ['Scuzzback Scrapper'],
    );
    test_query(
        'color: with number',
        'color:4 year<2010',
        ['Dune-Brood Nephilim', 'Glint-Eye Nephilim', 'Ink-Treader Nephilim', 'Witch-Maw Nephilim', 'Yore-Tiller Nephilim'],
    );
    test_query(
        'color< with number',
        'c<2 abundant',
        ['Abundant Growth', 'Abundant Harvest', 'Abundant Maw'],
    );
    test_query(
        'identity=',
        'identity=gr glade',
        ['Cinder Glade'],
    );
    // Same as <=
    test_query(
        'identity:',
        'id:gr scrapper',
        ['Elvish Scrapper', 'Gruul Scrapper', 'Khenra Scrapper', 'Narstad Scrapper', 'Scrapper Champion', 'Scuzzback Scrapper', 'Slagdrill Scrapper', 'Tuktuk Scrapper'],
    );
    test_query(
        'identity: with number',
        'id:4 year<2010',
        ['Dune-Brood Nephilim', 'Glint-Eye Nephilim', 'Ink-Treader Nephilim', 'Witch-Maw Nephilim', 'Yore-Tiller Nephilim'],
    );
    test_query(
        'identity> with number',
        'id>4 year<2000',
        ['Jack-in-the-Mox', 'Naked Singularity', 'Reality Twist', 'Sliver Queen'],
    );
    test_query(
        'quotes "',
        '"boros guild"',
        ['Boros Guildgate', 'Boros Guildmage'],
    );
    test_query(
        "quotes '",
        "o:'one item'",
        ['Goblin Game', "Ladies' Knight"],
    );
    test_query(
        'ignore single quote',
        "o:tamiyo's cmc>4",
        ['Tamiyo, Compleated Sage'],
    );
    test_query(
        'set',
        's:war ajani',
        ["Ajani's Pridemate", 'Ajani, the Greathearted'],
    );
    test_query(
        'edition',
        'e:RAV drake',
        ['Drake Familiar', 'Snapping Drake', 'Tattered Drake'],
    );
    test_query(
        'negation',
        '-t:land forest',
        ['Deep Forest Hermit', 'Forest Bear', 'Jaheira, Friend of the Forest'],
    );
    // SF seems to interpret this as "name does not contain the empty string".
    test_query(
        'empty negation',
        '-',
        [],
    );
    // SF seems to interpret this as "name does not contain the empty string".
    test_query(
        'effectively empty negation',
        '-.',
        [],
    );
    // Negation means "true if no version of this card matches the nested condition".
    test_query(
        'negate condition on version-specific property',
        '-f:premodern carpet',
        ["Al-abara's Carpet"],
    );
    test_query(
        'year=',
        'year=2011 alloy',
        ['Alloy Myr'],
    );
    // Same as =
    test_query(
        'year:',
        'year:1999 about',
        ['About Face'],
    );
    test_query(
        'year<=',
        'year<=2011 alloy',
        ['Alloy Golem', 'Alloy Myr'],
    );
    test_query(
        'year, conflicting',
        'year>=2020 year<=2011 alloy',
        [],
    );
    test_query(
        'date:',
        'date:1993-08-05 rec',
        ['Ancestral Recall', 'Resurrection'],
    );
    test_query(
        'date>= and date<=',
        'date>=2003-04 date<=2003-08 grave',
        ['Call to the Grave', 'Gravedigger', 'Grave Pact', 'Reaping the Graves'],
    );
    test_query(
        'reprint',
        'not:reprint set:m12 t:wizard',
        ['Alabaster Mage', 'Azure Mage', "Jace's Archivist", 'Lord of the Unreal', 'Merfolk Mesmerist', 'Onyx Mage'],
    );
    test_query(
        'disjunction',
        'animate t:instant or abundance t:enchantment',
        ['Abundance', 'Animate Land', 'Leyline of Abundance', 'Overabundance', 'Trace of Abundance'],
    );
    test_query(
        'disjunction',
        '( mind OR power ) drain',
        ['Drain Power', 'Mind Drain'],
    );
    test_query(
        'parens',
        'mana for (t:creature or t:artifact)',
        ['Manaforce Mace', 'Manaforge Cinder', 'Manaform Hellkite'],
    );
    test_query(
        'nested parens',
        'mana for ((t:creature t:dragon) or t:artifact)',
        ['Manaforce Mace', 'Manaform Hellkite'],
    );
    test_query(
        'empty parens',
        'draining or ()',
        ['Draining Whelk'],
    );
    test_query(
        'no space before opening paren',
        'mox(ruby)',
        [],
    );
    test_query(
        'too many opening parens',
        '((mox) sapphire',
        [],
    );
    test_query(
        'too many closing parens',
        '(mox) sapphire)',
        [],
    );
    test_query(
        'subset',
        'subset:Simple',
        ['Mana Matrix'],
        { subsets: { 'Simple': '"Mana Matrix"' } },
    );
    test_query(
        'complex subset',
        'subset:Complex',
        ['Myr Matrix'],
        { subsets: { 'Complex': 'r:r matrix o:creature cmc>=5' } },
    );
    test_query(
        'subset with spaces in name',
        'subset:"A long name"',
        ['Psychic Puppetry'],
        { subsets: { 'A long name': '"Psychic Puppetry"' } },
    );

    // Load all data in advance, so timings are more meaningful.
    const loads = PROPS.map(p => cards.load(p));

    for (const load of loads) {
        await load;
    }

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
