/**
 * What the English pack actually answers.
 *
 *   yarn run pack:en:check
 *
 * A measurement, made runnable so the number can be re-measured
 * after every rebuild rather than remembered. It asks the pack the way a
 * reader does — a word, a form of a word, a phrase — and reports what came
 * back and in what language.
 *
 * The word lists are deliberately made of the words a reader *stops on*: a
 * fluent reader does not look up "house", so a list of common words would
 * measure nothing but that the pack is not empty.
 */
const { available, define, setPackPath } = await import('../src/lib/server/languages/en.ts');

setPackPath(process.env.TSUNDOKU_EN_PACK ?? '');

if (!available()) {
	console.error('pack:en:check: no pack at TSUNDOKU_EN_PACK');
	process.exit(2);
}

/** Words that carry a story's weight: the ones a reader reaches for a dictionary over. */
const WORDS = `abate abide abject abound abscond absolution abstain accede acumen adamant
admonish adorn affable affluent aggrandise alacrity alcove allay alleviate allude
aloof amalgam ambiguity amble ameliorate amenity amiable amicable ample anachronism
anathema animosity annex annul anoint anomaly antecedent antipathy apathy apex
aplomb apocryphal appalling appease apprehensive arbitrary archaic arduous arrears
articulate ascetic ascribe askance aspersion assuage astute audacity austere
avarice aver aversion banal banter barren belligerent benevolent bequeath bereft
beseech besiege bewilder blight bolster boorish brevity brusque bucolic buoyant
cajole callous candour capitulate capricious castigate caustic censure chagrin
charisma chide circumspect clandestine clemency cloying coalesce coerce cogent
complacent comply concede conciliatory condone congenial conjecture connoisseur
consecrate conspicuous contempt contentious contrite contrived conundrum
convivial copious cordial corrugated covert covet coy credulous culminate culpable
cursory cynical dainty daunt debacle debilitate decorum deference deft
deleterious deliberate delineate delude demeaning demure denounce deplore depraved
deride derogatory desolate despondent destitute deter detractor detrimental
devious devise devoid dexterous didactic diffident dilapidated diligent diminish
discerning disdain dishevelled disparage disparate dispassionate dispel dissipate
dissonance distraught diverge docile dogmatic dormant dubious duplicity ebullient
eccentric echelon eclectic edifice efficacy effigy egregious elated elicit eloquence
elude emaciated embellish embezzle eminent enamoured encroach endemic enigma
enmity ennui ensnare entice enmity ephemeral epitome equity equivocal eradicate
erratic ersatz eschew esoteric espouse esteem estranged ethereal eulogy euphemism
evade evanescent exacerbate exalt exasperate exemplary exemplify exhaustive
exonerate expedient expedite expletive explicit exploit extant extol extraneous
exuberant facade fallacious falter fastidious fathom feasibility feign felicity
ferocious fervent fickle finesse flagrant flamboyant flippant florid flourish
fluctuate foment forbearance formidable fortitude fraught frugal furtive futile
garrulous gauche genial genteel germane glib glutinous gouge grandiloquent
gratuitous gregarious grievance grimace grovel guile gullible hackneyed halcyon
harbinger haughty hedonism heed herald heresy hiatus hinder hoary homogeneous
hubris humility hypocrisy idyllic ignominious illicit immaculate imminent
immutable impartial impassive impede impetuous implacable implicate impromptu
impudent impetus inane incessant incisive inclement incognito incongruous
inconsequential incorrigible incredulous incur incursion indefatigable indict
indifferent indigenous indignation indolent ineffable inept inert inexorable
ingenious ingenuous inherent inhibit iniquity innate innocuous inscrutable
insatiable inscrutable insolent insouciance instigate insular integral intrepid
intrinsic inundate invective irascible ire irk itinerant jejune jocular jubilant
judicious juncture juxtapose keen kindle kleptomania laborious laconic lambaste
languid languish latent laudable lavish lethargy levity liaise licentious limpid
lithe loath loathe lofty longevity loquacious lucid lucrative lugubrious
luminous lure lurid macabre magnanimous malevolent malign mandate manifest
meander melancholy mellow menace mercurial meticulous mettle mien misanthrope
misconstrue mitigate mollify monolithic morose mundane munificent myriad nadir
naive nascent nebulous nefarious negligence nomadic nominal nonchalant
notorious novice noxious nuance nullify obdurate obfuscate objective oblige
oblique obliterate oblivious obnoxious obscure obsequious obstinate obstreperous
obtuse obviate occlude odium officious ominous onerous opaque opulent ordeal
ornate orthodox ostensible ostentatious ostracise outlandish overhaul
painstaking palatable palliate palpable panacea paradox paragon paranoia
parch pariah parity parochial parsimonious partisan patent pathetic paucity
peculiar pedagogue pejorative penchant penitent pensive penury perception
peremptory perennial perfidy perfunctory perilous periphery pernicious
perpetuate perplex persevere pertinent perturb pervade perverse pessimism
petulant philanthropy phlegmatic pilfer pinnacle pique pitiful placate
placid plaintive platitude plausible plea plethora plunder poignant
polemic ponderous portentous posterity potent pragmatic precarious
precarious precipitate preclude precocious predilection predominant
preeminent premonition prerogative prescient prevalent pristine
proclivity procrastinate prodigal prodigious proficient profuse
prognosis proliferate prolific prolix prominent promulgate propensity
propitious proponent propriety prosaic prosper protagonist protean
protest prowess proximity prudent pugnacious punctilious pundit
purport purvey quandary quarrelsome quell querulous quiescent
quintessential quirk quixotic rambunctious rancour rapport rapture
raucous ravenous rebuff recalcitrant recant reciprocate reclusive
recompense reconcile rectitude redolent redress refine refractory
refute regale regurgitate reiterate relenting reluctant remediable
reminisce remiss remnant remuneration render repartee repellent
repercussion reprehensible reproach repudiate repugnant requisite
rescind resilient resolute respite resplendent restitution restive
reticent retrograde reverence rife riveting rudimentary ruminate
ruse rustic saccharine sagacious salient salubrious sanctimonious
sanguine sardonic satiate saturnine savour scathing scintillating
scoff scorn scrappy scrupulous scrutinise scurrilous sedate sedition
sedulous seemly serene servile severance shrewd simmering
sinister skeptic skittish slake slander sluggish smattering
smug solicitous solipsism solace solemn sombre soporific
sordid sparse spartan specious spendthrift sporadic spurious
spurn squalid stagnant staid stalwart stark staunch stealthy
stigma stipulate stoic stolid strain stratagem strident
stringent stupor stymie suave subdued subjugate sublime
subordinate subsequent subside substantial subterfuge subtle
succinct succumb sullen sumptuous sundry supercilious
supersede supplant supplicate surfeit surmise surmount
surpass surreptitious susceptible sustenance sycophant
tacit taciturn tangential tawdry tedious temerity temperate
tenacious tenuous tepid terse thwart timorous tirade
torpor tortuous tote tractable tranquil transient translucent
trepidation trepid trite trivial truculent truncate tumult
turbulent turgid turpitude ubiquity ulterior umbrage
unassuming uncanny unctuous undaunted undermine unequivocal
unfathomable unfetter ungainly unilateral unkempt unmoved
unpalatable unprecedented unruly unseemly untenable unwieldy
usurp utilitarian utter vacillate vacuous vagary valiant
 vanquish vapid variegated vehement vendetta veneer
venerable venerate veracity verbose verdant verify
veritable vernacular vertigo vestige vex viable
vicarious vicissitude vigilant vindicate vindictive
virtuoso virulent viscous vivacious vociferous volition
voluble voracious vouch vying wan wanton wary
wax wayward whim whimsical wield wince wistful
withering wizened woe wrath wrench yearn
yield zeal zealous zenith zephyr`
	.split(/\s+/)
	.filter(Boolean);

/** Forms a reader meets instead of the word itself. */
const FORMS = [
	'gave',
	'given',
	'gives',
	'took',
	'taken',
	'went',
	'gone',
	'said',
	'made',
	'knew',
	'known',
	'thought',
	'told',
	'became',
	'brought',
	'began',
	'begun',
	'kept',
	'held',
	'stood',
	'understood',
	'fell',
	'fallen',
	'felt',
	'left',
	'led',
	'met',
	'paid',
	'ran',
	'rose',
	'risen',
	'spoke',
	'spoken',
	'saw',
	'seen',
	'sought',
	'taught',
	'mice',
	'feet',
	'teeth',
	'men',
	'women',
	'children',
	'people',
	'leaves',
	'knives',
	'loaves',
	'halves'
];

/** Phrases a reader hops over: the lookahead has to complete them. */
const PHRASES = [
	'give up',
	'look after',
	'put off',
	'take after',
	'run into',
	'come across',
	'get over',
	'turn down',
	'bring up',
	'break down',
	'carry on',
	'find out',
	'go on',
	'hold on',
	'keep up',
	'look forward to',
	'make up',
	'pass away',
	'point out',
	'set off',
	'sort out',
	'stand for',
	'take over',
	'work out'
];

type Group = { name: string; queries: { surface: string; after?: string }[] };

const groups: Group[] = [
	{ name: 'words', queries: WORDS.map((w) => ({ surface: w })) },
	{ name: 'forms', queries: FORMS.map((w) => ({ surface: w })) },
	{
		name: 'phrases',
		queries: PHRASES.map((p) => {
			const [first, ...rest] = p.split(' ');
			return { surface: first, after: ` ${rest.join(' ')} and then` };
		})
	}
];

for (const group of groups) {
	let hits = 0;
	let phraseHits = 0;
	let withPt = 0;
	let senses = 0;
	const misses: string[] = [];

	for (const q of group.queries) {
		const entries = define(q);
		if (!entries.length) {
			misses.push(q.surface);
			continue;
		}
		hits++;
		if (entries[0].headword.includes(' ')) phraseHits++;
		for (const sense of entries[0].senses) {
			senses++;
			if (sense.glosses.some((g) => g.lang === 'pt')) withPt++;
		}
	}

	const pct = ((hits / group.queries.length) * 100).toFixed(1);
	const ptPct = senses ? ((withPt / senses) * 100).toFixed(0) : '0';
	console.log(
		`${group.name}: ${hits}/${group.queries.length} (${pct}%) answered` +
			(group.name === 'phrases' ? `, ${phraseHits} as a phrase` : '') +
			` · first entry's senses with a PT gloss: ${ptPct}%` +
			(misses.length ? `\n  missed: ${misses.join(', ')}` : '')
	);
}
