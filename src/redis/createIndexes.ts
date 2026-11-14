import { createClient } from "redis";

import { ButtonInteractionRepository } from "./schemas/ButtonInteraction";
import { GuildPreferencesRepository } from "./schemas/GuildPreferences";
import { KeywordRepository } from "./schemas/Keyword";
import { PracticeQuestionRepository } from "./schemas/Question";
import { StickyMessageRepository } from "./schemas/StickyMessage";
import { ModPingRepository } from "./schemas/ModPing";
import { UserRepository } from "./schemas/User";
import { MessageOptOutRepository } from "./schemas/MessageOptOut";

export const redis = createClient({
	url: process.env.REDIS_URL,
});

await redis.connect();

const GuildPreferencesCache = new GuildPreferencesRepository(redis);
const StickyMessageCache = new StickyMessageRepository(redis);
const ModPingCache = new ModPingRepository(redis);
const PracticeQuestionCache = new PracticeQuestionRepository(redis);
const UserCache = new UserRepository(redis);
const ButtonInteractionCache = new ButtonInteractionRepository(redis);
const KeywordCache = new KeywordRepository(redis);
const MessageOptOutCache = new MessageOptOutRepository(redis);

await GuildPreferencesCache.createIndex();
await StickyMessageCache.createIndex();
await ModPingCache.createIndex();
await PracticeQuestionCache.createIndex();
await UserCache.createIndex();
await ButtonInteractionCache.createIndex();
await KeywordCache.createIndex();
await MessageOptOutCache.createIndex();

await redis.disconnect();
