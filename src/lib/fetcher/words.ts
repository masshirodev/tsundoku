// The fetcher's own pages' words (the confirmation window and the options
// page; handoff `fetcher-options`, revision 1), in the app's two languages.
// The browser's language picks one; anything else reads English.

export type Language = 'en' | 'pt-BR';

export const WORDS = {
	en: {
		fetcher: 'TSUNDOKU FETCHER',
		asksYou: 'ASKS YOU',
		asksToReach: 'ASKS TO REACH',
		deviceOnPort: (port: string) => `A DEVICE ON YOUR OWN NETWORK · PORT ${port} ONLY`,
		addressEveryPort: 'AN ADDRESS ON YOUR OWN NETWORK · EVERY PORT',
		seen: (sites: number, since: string) =>
			`THE FETCHER REFUSED ${sites} ${sites === 1 ? 'SITE' : 'SITES'} SINCE ${since}, AND EVERY ANSWER CAME FROM THIS ADDRESS: THIS IS WHAT A PROXY LOOKS LIKE IN CHROME.`,
		mayReach: 'tsundoku’s extensions may then reach it, with this browser’s cookies for it.',
		cancel: 'CANCEL',
		allow: 'ALLOW',
		askOver: 'This ask is over. You can close this window.',
		options: 'FETCHER · OPTIONS',
		answersOnly: (origin: string) => `ANSWERS ${origin} ONLY`,
		intro:
			'The fetcher refuses the devices on your own network, because tsundoku runs extensions that other people write. When tsundoku is refused one you meant to reach, press ALLOW there, and the fetcher asks you in a window of its own.',
		allowedLabel: 'ALLOWED ON YOUR OWN NETWORK',
		none: 'NONE',
		count: (n: number) => `${n} · NEWEST FIRST`,
		empty: 'Nothing is allowed. Every device on your own network is refused.',
		everyPort: 'EVERY PORT',
		portOnly: (port: string) => `PORT ${port} ONLY`,
		proxyCovered: 'A PROXY AT THIS ADDRESS IS COVERED TOO',
		whenAsked: (day: string) => `ALLOWED WHEN TSUNDOKU ASKED, ${day}`,
		today: 'TODAY',
		remove: 'REMOVE',
		removeHint: 'REMOVE TAKES EFFECT AT ONCE · A REQUEST ALREADY ON ITS WAY FINISHES',
		removed: (host: string) => `REMOVED · ${host}`,
		refusedAgain: 'REFUSED AGAIN FROM NOW',
		undo: 'UNDO',
		addByHand: 'ADD BY HAND',
		open: 'OPEN',
		close: 'CLOSE',
		fieldLabel: 'A HOST, OR A WHOLE ADDRESS',
		fieldNote: 'CUT DOWN TO ITS HOST AND PORT',
		placeholder: 'nas.lan  or  192.168.1.20:8080',
		add: 'ADD',
		keeps: 'KEEPS',
		drops: (what: string) => `DROPS ${what}`,
		everyPortInstead: 'EVERY PORT INSTEAD',
		thisPortOnly: 'THIS PORT ONLY',
		mayReachHost: (host: string, port: string | null) =>
			port
				? `tsundoku’s extensions may then reach ${host} on port ${port}, with this browser’s cookies for it.`
				: `tsundoku’s extensions may then reach ${host} on every port, with this browser’s cookies for it.`,
		portRule: 'A HOST ALONE COVERS EVERY PORT ON IT · WITH :PORT, THAT PORT ONLY',
		noHost: 'NAMES NO HOST',
		noHostHint: 'A HOST IS ONE WORD, LIKE nas.lan, OR AN ADDRESS, LIKE 192.168.1.20',
		scheme: (scheme: string) => `${scheme} ISN’T FETCHED`,
		schemeHint: (host: string) =>
			`ONLY AN http OR https ADDRESS IS CUT DOWN TO ITS HOST · OR TYPE THE HOST ALONE: ${host}`,
		password: 'THIS ADDRESS HOLDS A NAME AND PASSWORD',
		passwordHint: (host: string) => `NOTHING WAS KEPT · TYPE THE HOST ALONE: ${host}`,
		publicHost: (host: string) => `${host} IS ON THE INTERNET`,
		publicHint:
			'THE FETCHER REACHES IT ALREADY · IF TSUNDOKU SAID IT ANSWERED FROM AN ADDRESS ON YOUR NETWORK, ALLOW THAT ADDRESS',
		covered: 'ALLOWED ALREADY',
		coveredHint: (by: string, port: string | null) =>
			port === null ? `${by} IS ON THE LIST FOR EVERY PORT` : `${by} IS ON THE LIST`,
		badPort: 'NO SUCH PORT',
		badPortHint: 'A PORT IS A NUMBER FROM 1 TO 65535'
	},
	'pt-BR': {
		fetcher: 'TSUNDOKU FETCHER',
		asksYou: 'PERGUNTA A VOCÊ',
		asksToReach: 'PEDE PARA ALCANÇAR',
		deviceOnPort: (port: string) => `UM APARELHO NA SUA PRÓPRIA REDE · SÓ A PORTA ${port}`,
		addressEveryPort: 'UM ENDEREÇO NA SUA PRÓPRIA REDE · TODAS AS PORTAS',
		seen: (sites: number, since: string) =>
			`O FETCHER RECUSOU ${sites} ${sites === 1 ? 'SITE' : 'SITES'} DESDE ${since}, E TODA RESPOSTA VEIO DESTE ENDEREÇO: É ASSIM QUE UM PROXY APARECE NO CHROME.`,
		mayReach:
			'As extensões do tsundoku poderão então alcançá-lo, com os cookies deste navegador para ele.',
		cancel: 'CANCELAR',
		allow: 'PERMITIR',
		askOver: 'Este pedido já terminou. Você pode fechar esta janela.',
		options: 'FETCHER · OPÇÕES',
		answersOnly: (origin: string) => `ATENDE SÓ ${origin}`,
		intro:
			'O fetcher recusa os aparelhos da sua própria rede, porque o tsundoku roda extensões escritas por outras pessoas. Quando o tsundoku for recusado em um que você quis alcançar, toque em PERMITIR lá, e o fetcher pergunta a você numa janela dele.',
		allowedLabel: 'PERMITIDOS NA SUA PRÓPRIA REDE',
		none: 'NENHUM',
		count: (n: number) => `${n} · MAIS NOVOS PRIMEIRO`,
		empty: 'Nada está permitido. Todo aparelho da sua própria rede é recusado.',
		everyPort: 'TODAS AS PORTAS',
		portOnly: (port: string) => `SÓ A PORTA ${port}`,
		proxyCovered: 'UM PROXY NESTE ENDEREÇO TAMBÉM ESTÁ COBERTO',
		whenAsked: (day: string) => `PERMITIDO QUANDO O TSUNDOKU PEDIU, ${day}`,
		today: 'HOJE',
		remove: 'REMOVER',
		removeHint: 'REMOVER VALE NA HORA · UM PEDIDO JÁ A CAMINHO TERMINA',
		removed: (host: string) => `REMOVIDO · ${host}`,
		refusedAgain: 'RECUSADO DE NOVO A PARTIR DE AGORA',
		undo: 'DESFAZER',
		addByHand: 'ADICIONAR À MÃO',
		open: 'ABRIR',
		close: 'FECHAR',
		fieldLabel: 'UM HOST, OU UM ENDEREÇO INTEIRO',
		fieldNote: 'CORTADO ATÉ O HOST E A PORTA',
		placeholder: 'nas.lan  ou  192.168.1.20:8080',
		add: 'ADICIONAR',
		keeps: 'GUARDA',
		drops: (what: string) => `DESCARTA ${what}`,
		everyPortInstead: 'TODAS AS PORTAS',
		thisPortOnly: 'SÓ ESTA PORTA',
		mayReachHost: (host: string, port: string | null) =>
			port
				? `As extensões do tsundoku poderão então alcançar ${host} na porta ${port}, com os cookies deste navegador para ele.`
				: `As extensões do tsundoku poderão então alcançar ${host} em todas as portas, com os cookies deste navegador para ele.`,
		portRule: 'UM HOST SOZINHO COBRE TODAS AS PORTAS · COM :PORTA, SÓ AQUELA PORTA',
		noHost: 'NÃO NOMEIA UM HOST',
		noHostHint: 'UM HOST É UMA PALAVRA, COMO nas.lan, OU UM ENDEREÇO, COMO 192.168.1.20',
		scheme: (scheme: string) => `${scheme} NÃO É BUSCADO`,
		schemeHint: (host: string) =>
			`SÓ UM ENDEREÇO http OU https É CORTADO ATÉ O HOST · OU DIGITE SÓ O HOST: ${host}`,
		password: 'ESTE ENDEREÇO TEM UM NOME E UMA SENHA',
		passwordHint: (host: string) => `NADA FOI GUARDADO · DIGITE SÓ O HOST: ${host}`,
		publicHost: (host: string) => `${host} ESTÁ NA INTERNET`,
		publicHint:
			'O FETCHER JÁ O ALCANÇA · SE O TSUNDOKU DISSE QUE ELE RESPONDEU DE UM ENDEREÇO DA SUA REDE, PERMITA ESSE ENDEREÇO',
		covered: 'JÁ PERMITIDO',
		coveredHint: (by: string, port: string | null) =>
			port === null ? `${by} ESTÁ NA LISTA PARA TODAS AS PORTAS` : `${by} ESTÁ NA LISTA`,
		badPort: 'ESSA PORTA NÃO EXISTE',
		badPortHint: 'UMA PORTA É UM NÚMERO DE 1 A 65535'
	}
} as const;

export type Words = (typeof WORDS)['en'];

/** The words for the browser's language: Portuguese for any `pt`, English otherwise. */
export function wordsFor(language: string | undefined): Words {
	return language?.toLowerCase().startsWith('pt') ? (WORDS['pt-BR'] as unknown as Words) : WORDS.en;
}
