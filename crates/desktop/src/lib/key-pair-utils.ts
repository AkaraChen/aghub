export interface KeyPair {
	id: string;
	key: string;
	value: string;
}

let nextId = 0;
export const generateId = () => `keypair-${nextId++}`;

export const createEmptyKeyPair = (): KeyPair => ({
	id: generateId(),
	key: "",
	value: "",
});

export const keyPairToObject = (pairs: KeyPair[]): Record<string, string> => {
	return Object.fromEntries(pairs.map((pair) => [pair.key, pair.value]));
};

export const objectToKeyPairs = (obj: Record<string, string>): KeyPair[] => {
	return Object.entries(obj).map(([key, value]) => ({
		id: generateId(),
		key,
		value,
	}));
};