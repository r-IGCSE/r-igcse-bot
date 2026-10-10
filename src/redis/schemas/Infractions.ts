import type { RedisClientType } from "redis";

export type IInfraction = {
	rule: string;
	reason: string;
};

export class InfractionsRepository {
	constructor(private readonly client: RedisClientType) {}

	// returns every stored rule and reason
	async getAll(): Promise<IInfraction[]> {
		const infractions: IInfraction[] = [];

		for await (const key of this.client.scanIterator({
			MATCH: "Infraction:*",
			TYPE: "hash",
		})) {
			const infraction = await this.client.hGetAll(key);
			if (infraction.rule && infraction.reason) {
				infractions.push({
					rule: infraction.rule,
					reason: infraction.reason,
				});
			}
		}

		return infractions;
	}

	// returns matching reasons for autocomplete
	async autoComplete(phrase: string): Promise<string[]> {
		const normalizedPhrase = phrase.trim().toLowerCase();
		const infractions = await this.getAll();

		return infractions
			.map(({ rule, reason }) => `${rule}: ${reason}`)
			.filter((infraction) =>
				infraction.toLowerCase().includes(normalizedPhrase),
			)
			.toSorted();
	}

	// adds to db
	async set(infraction: IInfraction): Promise<void> {
		const key = `Infraction:${infraction.rule}:${infraction.reason}`;
		await this.client.hSet(key, infraction);
	}

	// removes from db
	async delete(infraction: IInfraction): Promise<void> {
		const key = `Infraction:${infraction.rule}:${infraction.reason}`;
		await this.client.del(key);
	}
}