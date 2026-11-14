import { MessageOptOut } from "@/mongo";
import {
	type Entity,
	type RedisConnection,
	Repository,
	Schema,
} from "redis-om";

export interface ICachedMessageOptOut extends Entity {
	userId: string;
	optedOut: boolean;
}

const schema = new Schema("MessageOptOut", {
	userId: { type: "string" },
	optedOut: { type: "boolean" },
});

export class MessageOptOutRepository extends Repository {
	constructor(clientOrConnection: RedisConnection) {
		super(schema, clientOrConnection);
	}

	/** Returns whether the user is opted out, caching both answers. */
	async get(userId: string): Promise<boolean> {
		const cachedRes = (await this.fetch(userId)) as ICachedMessageOptOut;

		if (cachedRes.userId) return cachedRes.optedOut;

		const optedOut = Boolean(await MessageOptOut.exists({ userId }));

		await this.set(userId, {
			userId,
			optedOut,
		});

		return optedOut;
	}

	async set(
		userId: string,
		data: { userId: string; optedOut: boolean },
	): Promise<void> {
		await this.save(userId, data);

		await this.expire(userId, 120);
	}
}
